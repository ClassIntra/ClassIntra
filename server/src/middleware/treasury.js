// 学元财政权中间件 · 单一真相源
// ============================================================
// 2026-11-12 之前，组网从班封锁（requireTreasury）只定义在 routes/xueyuan.js，
// 而 /api/xy 门面的资金端点一律挂 auth.requireAdmin —— 于是 member 角色的
// 班管可以 POST /api/xy/issue 直接印赠金，绕过「学元管理整体移交给主班」。
//
// 修法：把判定抽到中间件，两个门面共用一份；再给混合端点（学生/卖家本人
// 也能用）提供只拦「管理员越权」的变体。
//
// 语义与旧 xueyuan.js 完全一致：
//   · 只认班管 / 系统管理员，普通班干（officer）没有财政权
//   · member 角色下封锁本班班管；系统管理员豁免（排障需要）
//   · 从班班管的其他班级管理（用户/公告/资源…）不受影响
//
// 编码约定：var / function（服务端 CommonJS 风格）

var xyMesh = require('../services/xy-mesh');

var BLOCKED_MSG = '本班学元管理已移交组网主班统一管理，如有需要请联系主班班管';

function isAdminUser(req) {
  return !!(req.user && (req.user.is_class_admin || req.user.is_admin === 1));
}

// 纯管理端点（发行 / 充值 / 扣减 / 核销 / 账本概览…）
function requireTreasury(req, res, next) {
  if (!req.user) return res.status(401).json({ code: 401, message: '未登录' });
  if (xyMesh.blockTreasury(req.user.user_id)) {
    return res.status(403).json({ code: 403, message: BLOCKED_MSG });
  }
  if (isAdminUser(req)) return next();
  return res.status(403).json({ code: 403, message: '只有班管可以管理学元发行' });
}

// 混合端点：学生 / 卖家本人照常放行；只有「以管理员身份越权操作别人的单」
// 时才检查组网封锁。用于 /api/xy 的订单动作 —— 它们本来靠 assertAccess 判归属，
// 但 isAdmin 会放行，从班班管因此能替任何人支付 / 结算 / 退款。
function treasuryForAdmins(req, res, next) {
  if (!req.user) return res.status(401).json({ code: 401, message: '未登录' });
  if (!isAdminUser(req)) return next();
  if (xyMesh.blockTreasury(req.user.user_id)) {
    return res.status(403).json({ code: 403, message: BLOCKED_MSG });
  }
  return next();
}

module.exports = {
  BLOCKED_MSG: BLOCKED_MSG,
  requireTreasury: requireTreasury,
  treasuryForAdmins: treasuryForAdmins
};
