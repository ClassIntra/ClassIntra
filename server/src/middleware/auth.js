var jwtUtil = require('../utils/jwt');
var constants = require('../utils/constants');
var db = require('../utils/db');

// 认证 cookie 的**唯一来源**：名字取自 constants（设置/清除/读取共用），属性只此一处。
// ⚠️ 设置与清除必须使用**完全相同**的属性：浏览器按 name+domain+path 匹配删除，
//    清除时少一个 Path 就会删不掉，留下一个"幽灵 cookie"持续干扰后续请求。
var AUTH_COOKIE = constants.AUTH_COOKIE;
var AUTH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' && process.env.HTTPS === 'true',
  sameSite: 'lax',
  path: '/'
};

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE, token, Object.assign(
    { maxAge: 7 * 24 * 60 * 60 * 1000 },
    AUTH_COOKIE_OPTS
  ));
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE, AUTH_COOKIE_OPTS);
}

function requireAuth(req, res, next) {
  var token = constants.extractToken(req);
  if (!token) {
    return res.status(401).json({ code: 401, message: '未登录' });
  }
  // 统一走 utils/jwt 的验签入口。
  //
  // ⚠️ 这里**不能**自己调 jwt.verify(token, config.jwt.secret)：签发已切到 RS256，
  // 而共享密钥只认 HS256，直接调会把所有新 token 判成 invalid algorithm，
  // 表现为「登录成功、下一秒就被登出」，而 verifyToken 里的 try/catch
  // 恰好把真实原因吃掉了，日志里什么都看不到。
  //
  // 改造 JWT 时**所有**验签入口都必须一起改，本文件是最容易漏的一处
  // —— 它不 import utils/jwt，光看 utils/jwt.js 会以为已经改完了。
  //
  // verifyToken 不抛异常、返回 { valid, data }，所以失败分支单独判。
  var result = jwtUtil.verifyToken(token);
  if (!result.valid) {
    // 验签失败：这个 token 已经没用了。若它是**陈旧 cookie** 带上来的，不清掉就会
    // 一直遮挡后续请求（前端每次拿它来当凭据）—— 用户会陷入"重新登录也没用"的怪圈。
    clearAuthCookie(res);
    return res.status(401).json({ code: 401, message: '登录已过期' });
  }

  // 头里的凭据胜出后，cookie 必须**同步成这个胜出的 token**，不能简单清掉。
  //
  // ⚠️ 2026-10-09 由"清掉"改为"同步"，原因是一个会静默丢功能的坑：
  //   浏览器里有一大类请求**根本带不了 Authorization 头** —— `<img src>`、`<video src>`、
  //   点开下载链接（本仓的富文本图片就是裸 `/api/cloud/files/<id>`，见
  //   client/src/utils/rich-text-renderer.js 与 RecordModal.vue）。
  //   它们只能靠 cookie 认证。若这里把不一致的 cookie 删掉，这些请求就彻底没有凭据可用 →
  //   图片全部加载失败，而 XHR 一切正常，排查时极易误判成"图挂了"。
  //   所以 cookie 的定位是"替带不了头的请求兜底"，它必须始终镜像当前胜出的那个 token。
  //   （cookie 名/属性仍只在 constants.AUTH_COOKIE + AUTH_COOKIE_OPTS 一处定义）
  var cookieToken = (req.cookies && req.cookies[AUTH_COOKIE]) || '';
  if (cookieToken !== token) setAuthCookie(res, token);

  req.user = result.data;
  // 检测班管（user_id 以00结尾）
  req.user.is_class_admin = constants.isClassAdmin(req.user.user_id);
  try {
    var dbRow = db.prepare('SELECT status, ban_expires_at, ban_reason, role, officer_permissions, officer_title, is_admin FROM users WHERE user_id = ?').get(req.user.user_id);
    if (dbRow) {
      req.user.role = dbRow.role || 'user';
      req.user.officer_permissions = dbRow.officer_permissions || '[]';
      req.user.officer_title = dbRow.officer_title || '';
      req.user.is_admin = (dbRow.is_admin === 1 || req.user.is_class_admin) ? 1 : 0;
      if (dbRow.status === 'disabled') {
        if (dbRow.ban_expires_at) {
          var expiresAt = new Date(dbRow.ban_expires_at + 'Z');
          if (expiresAt <= new Date()) {
            db.prepare('UPDATE users SET status = \'active\', ban_expires_at = NULL, ban_reason = NULL WHERE user_id = ?').run(req.user.user_id);
          } else {
            return res.status(403).json({ code: 403, message: '该账号已被禁用', ban_expires_at: dbRow.ban_expires_at, ban_reason: dbRow.ban_reason });
          }
        } else {
          return res.status(403).json({ code: 403, message: '该账号已被禁用', ban_reason: dbRow.ban_reason || '' });
        }
      }
    }
  } catch (e) {
    console.error('Auth DB error:', e.message);
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ code: 401, message: '未登录' });
  }
  // 班管始终有全部权限
  if (req.user.is_class_admin || req.user.is_admin === 1) {
    return next();
  }
  // 检查班干角色
  if (req.user.role === 'officer') {
    try {
      req.user.officer_permissions = JSON.parse(req.user.officer_permissions || '[]');
    } catch (e2) {
      req.user.officer_permissions = [];
    }
    return next();
  }
  // 再次从数据库确认
  try {
    var row = db.prepare('SELECT is_admin, role, officer_permissions FROM users WHERE user_id = ?').get(req.user.user_id);
    if (row) {
      if (row.is_admin === 1 || constants.isClassAdmin(req.user.user_id)) {
        req.user.is_admin = 1;
        req.user.is_class_admin = true;
        return next();
      }
      if (row.role === 'officer') {
        req.user.role = 'officer';
        try {
          req.user.officer_permissions = JSON.parse(row.officer_permissions || '[]');
        } catch (e2) {
          req.user.officer_permissions = [];
        }
        return next();
      }
    }
  } catch (e) {
    console.error('Admin check DB error:', e.message);
    return res.status(403).json({ code: 403, message: '无权限访问' });
  }
  return res.status(403).json({ code: 403, message: '无权限访问' });
}

function requirePermission(permission) {
  return function(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ code: 401, message: '未登录' });
    }
    // 班管始终有全部权限
    if (req.user.is_class_admin || req.user.is_admin === 1) {
      return next();
    }
    // 班干检查具体权限
    if (req.user.role === 'officer' && Array.isArray(req.user.officer_permissions)) {
      if (req.user.officer_permissions.indexOf(permission) !== -1) {
        return next();
      }
    }
    return res.status(403).json({ code: 403, message: '无权限执行此操作' });
  };
}

module.exports = { requireAuth: requireAuth, requireAdmin: requireAdmin, requirePermission: requirePermission, setAuthCookie: setAuthCookie, clearAuthCookie: clearAuthCookie };
