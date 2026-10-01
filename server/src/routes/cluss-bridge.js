// Cluss 联动桥（ClassIntra 侧，**只读**）
//
// 用途：让 Cluss 能校验 ClassIntra 的账号，实现「ClassIntra 用户直接登录 Cluss」。
//
// ---- 设计约束（重要）----
// 1. 本文件对 ClassIntra 现有逻辑零改动、零侵入：不碰 auth.js，不碰用户表写入，
//    只在 app.js 里多挂一个路由前缀。
// 2. 只提供两个端点，都是**只读**：查存在性、校验口令。没有任何写操作，
//    因此不可能出现「通过本桥注册/改密/提权」的路径。
// 3. 认证用 X-Bridge-Secret，与 ClassIntra 既有的 RELAY_SECRET 共用同一密钥，
//    避免再多一个需要运维同步的密钥。未配置密钥时**直接拒绝服务**（不放行）。
// 4. 校验成功会返回 password_hash —— 这是 Cluss 侧离线登录所需（与既有的
//    /api/auth/relay-verify 行为一致）。风险面由「必须持有共享密钥」这一条把住。

var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../utils/db');
var config = require('../config');
var pwdUtil = require('../utils/password');

// 时序安全的字符串比较（防止密钥被时序探测逐字节猜出）
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  var bufA = Buffer.from(a);
  var bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireBridgeSecret(req, res, next) {
  var secret = config.relay.secret || '';
  if (!secret) {
    // 与 relay-verify 同策略：密钥没配就拒绝，绝不裸奔
    return res.status(503).json({ code: 503, message: '未配置 RELAY_SECRET，联动桥不可用' });
  }
  var provided = req.headers['x-bridge-secret'] || '';
  if (!safeCompare(String(provided), secret)) {
    return res.status(403).json({ code: 403, message: '密钥校验失败' });
  }
  next();
}

// ============================================================
// GET /api/cluss-bridge/ping —— 存活探测（Cluss 启动时判断联动是否可用）
// ============================================================
router.get('/ping', requireBridgeSecret, function(req, res) {
  res.json({
    code: 200,
    message: 'ok',
    data: { service: 'classintra', bridge: 'cluss', time: new Date().toISOString() }
  });
});

// ============================================================
// POST /api/cluss-bridge/verify —— 校验账号口令
// body: { account, password }
//
// 命中规则与 ClassIntra 登录一致：学号 / 网名 / 姓名三选一
// 注意：**不校验 pre_records 名单**——能走到这里说明该账号本就已在 ClassIntra 的
// users 表里（即当初就是通过名单注册进来的），名单闸门在注册时已经生效过。
// ============================================================
router.post('/verify', requireBridgeSecret, function(req, res) {
  try {
    var account = String(req.body.account || '').trim();
    var password = req.body.password;

    if (!account || !password) {
      return res.status(400).json({ code: 400, message: '缺少账号或密码' });
    }

    // 与 auth.js 的登录同款候选排序：学号精确 > 有本地密码 > 建号顺序
    var candidates = db.prepare(
      'SELECT * FROM users WHERE user_id = ? OR net_name = ? OR real_name = ?'
    ).all(account, account, account);

    if (!candidates.length) {
      return res.status(404).json({ code: 404, message: '账号不存在' });
    }

    candidates.sort(function(a, b) {
      var aExact = a.user_id === account ? 0 : 1;
      var bExact = b.user_id === account ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      var aHasPwd = a.password_hash ? 0 : 1;
      var bHasPwd = b.password_hash ? 0 : 1;
      if (aHasPwd !== bHasPwd) return aHasPwd - bHasPwd;
      return (a.id || 0) - (b.id || 0);
    });

    var matched = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c.password_hash) continue;   // 跨班同步行没有本地密码，无法在此校验
      var ok = false;
      try {
        ok = pwdUtil.verifyPassword(password, c.password_hash);
      } catch (e) {
        console.warn('[ClussBridge] 密码校验异常，跳过: user_id=' + c.user_id + ' err=' + e.message);
        continue;
      }
      if (ok) { matched = c; break; }
    }

    if (!matched) {
      return res.status(401).json({ code: 401, message: '账号或密码错误' });
    }

    if (matched.status === 'disabled') {
      return res.status(403).json({ code: 403, message: '该账号已被禁用' });
    }

    // user_id 编码 YYCCNN：YY=年份后两位，NN=班级，CC=班内编号
    var userId = String(matched.user_id);
    var enrollmentYear = '';
    var classNo = '';
    if (/^\d{6}$/.test(userId)) {
      enrollmentYear = '20' + userId.slice(0, 2);
      classNo = userId.slice(2, 4);
    }

    console.log('[ClussBridge] 联动校验通过: %s (%s)', matched.user_id, matched.real_name);

    return res.json({
      code: 200,
      message: 'ok',
      data: {
        user: {
          user_id: matched.user_id,
          net_name: matched.net_name,
          real_name: matched.real_name,
          gender: matched.gender || '',
          status: matched.status,
          // 必须返回：Cluss 侧落库时用于离线登录校验（同 relay-verify 的既有约定）
          password_hash: matched.password_hash,
          enrollment_year: enrollmentYear,
          class_no: classNo
        }
      }
    });
  } catch (err) {
    console.error('[ClussBridge] verify error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;