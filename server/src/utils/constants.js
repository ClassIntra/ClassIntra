var config = require('../config');

// 班管检测：user_id 格式 YYCC00（末两位为00）
// 每个班级的班管拥有其班级的全部管理权限
// 开发者账号 999999 拥有全部管理权限
function isClassAdmin(userId) {
  if (!userId) return false;
  if (userId === '999999') return true; // 开发者账号
  if (userId.length !== 6) return false;
  if (!/^\d{6}$/.test(userId)) return false;
  // 末两位为 00 且中间两位不为 00
  var cc = userId.substring(2, 4);
  var nn = userId.substring(4, 6);
  return nn === '00' && cc !== '00';
}

// 获取管理员的班级号（仅班管返回CC，否则返回null）
function getAdminClass(userId) {
  if (!userId) return null;
  if (userId.length === 6 && /^\d{6}$/.test(userId)) {
    var cc = userId.substring(2, 4);
    var nn = userId.substring(4, 6);
    if (nn === '00' && cc !== '00') return cc;
  }
  return null;
}

// 系统级管理员：开发者账号 999999，或 .env BOT_ADMIN_IDS 登记的机器人账号。
// 这类账号没有 YYCCxx 形式的班号，无法参与「按班级」的权限比对，
// 因此在跨班用户操作、PM2 控制等处直接放行（等价于开发者账号的豁免）。
function isSystemAdmin(userId) {
  if (!userId) return false;
  if (String(userId) === '999999') return true;
  return (config.botAdminIds || []).indexOf(String(userId)) !== -1;
}

// 判断用户是否为管理员（班管或班干）
function isAdmin(userId) {
  if (isClassAdmin(userId)) return true;
  // 也检查config中的adminUserIds（兼容旧配置）
  if (config.adminUserIds && config.adminUserIds.indexOf(String(userId)) !== -1) return true;
  return false;
}

// 认证 cookie 名：设置 / 清除 / 读取的**唯一来源**。
// 三处各写一遍字面量，迟早有一处改漏 —— 那时清除与设置属性不一致，浏览器删不掉，
// 会留下一个"幽灵 cookie"持续干扰后续请求。
var AUTH_COOKIE = 'token';

// 提取 token：**Authorization 头 → cookie → query**，头必须优先。
//
// ⚠️ 顺序是刻意定的，对应一次真实故障「明明刚登录，却被提示登录已过期并踢回登录页」：
//   前端 utils/api.js 每次请求都从 store（localStorage）取**最新** token 放进
//   Authorization 头；而 `token` 这个 cookie **同 host 全端口共享、且 httpOnly
//   （JS 碰不到）**，是浏览器里的"环境态"。同一个账号在两处登录过（多端口、多标签、
//   或先登录 A 后登录 B）时，localStorage 是新的、cookie 是上一次的旧的 ——
//   老实现 cookie 优先，于是拿陈旧 cookie 去验签 → 401 → 前端拦截器**直接清掉会话
//   并跳登录页**，用户正在填的内容、页面状态一起丢，而且他什么错都没犯。
//   口径：Authorization 头是"本次请求显式携带的凭据"，cookie 只是兜底
//   （浏览器直接打开 API 地址、无法设置请求头的场景）。
function extractToken(req) {
  var token = '';
  if (req.headers && req.headers.authorization) {
    token = req.headers.authorization.replace(/^Bearer\s+/i, '');
  }
  if (!token && req.cookies) token = req.cookies[AUTH_COOKIE];
  if (!token && req.query && req.query.token) token = req.query.token;
  return token || '';
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str || '{}');
  } catch (e) {
    return fallback || {};
  }
}

function relayEvent(eventType, payload) {
  try {
    var relayBus = require('./relay-bus');
    relayBus.emit(eventType, payload);
  } catch (e) {
    console.error('Relay event failed:', eventType, e.message);
  }
}

module.exports = {
  AUTH_COOKIE: AUTH_COOKIE,
  isClassAdmin: isClassAdmin,
  isSystemAdmin: isSystemAdmin,
  getAdminClass: getAdminClass,
  isAdmin: isAdmin,
  extractToken: extractToken,
  safeJsonParse: safeJsonParse,
  relayEvent: relayEvent
};
