// 中间件：集成 Token 鉴权（对外查询 API 用）
// ============================================================
// 与 requireAuth 的分工：
//   requireAuth        → 人类用户的 JWT（Authorization: Bearer）
//   requireIntegration → 机器对机器的集成 token（X-ClassIntra-Token）
//
// 为什么不用 Bearer：避免和用户 JWT 混在一个头里，调试时一眼能分清是谁在调。
//
// 安全边界：
//   - 只认数据库里 active=1 且未过期的集成
//   - scope 逐端点校验（缺一个就 403，不静默放行）
//   - 每 token 每分钟 120 次（内存窗口），防止一个集成把班级服务器打满
//   - 当前只开放读接口；写接口需要单独设计幂等与审计，不在这里开口子

var tokenStore = require('../integrations/token-store');

var WINDOW_MS = 60000;
var MAX_PER_WINDOW = 120;
var buckets = {}; // integrationId → { at, count }

function rateOk(id) {
  var now = Date.now();
  var b = buckets[id];
  if (!b || now - b.at > WINDOW_MS) {
    buckets[id] = { at: now, count: 1 };
    return true;
  }
  b.count++;
  return b.count <= MAX_PER_WINDOW;
}

function readToken(req) {
  var t = req.headers['x-classintra-token'];
  if (Array.isArray(t)) t = t[0];
  return String(t || '').trim();
}

function requireIntegration(scope) {
  return function (req, res, next) {
    var token = readToken(req);
    if (!token) {
      return res.status(401).json({ code: 401, message: '缺少 X-ClassIntra-Token' });
    }
    var integration = null;
    try {
      integration = tokenStore.verifyToken(token);
    } catch (e) {
      return res.status(500).json({ code: 500, message: '集成校验失败' });
    }
    if (!integration) {
      return res.status(401).json({ code: 401, message: 'Token 无效、已撤销或已过期' });
    }
    if (!rateOk(integration.id)) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ code: 429, message: '请求过于频繁（120 次/分钟）' });
    }
    if (scope && (integration.scopes || []).indexOf(scope) === -1) {
      return res.status(403).json({
        code: 403,
        message: '缺少 scope: ' + scope + '（当前：' + (integration.scopes || []).join(', ') + '）'
      });
    }
    req.integration = integration;
    next();
  };
}

module.exports = { requireIntegration: requireIntegration };
