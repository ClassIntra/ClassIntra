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

function extractToken(req) {
  var token = req.cookies && req.cookies.token;
  if (!token && req.headers.authorization) {
    token = req.headers.authorization.replace(/^Bearer\s+/i, '');
  }
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }
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
  isClassAdmin: isClassAdmin,
  isSystemAdmin: isSystemAdmin,
  getAdminClass: getAdminClass,
  isAdmin: isAdmin,
  extractToken: extractToken,
  safeJsonParse: safeJsonParse,
  relayEvent: relayEvent
};
