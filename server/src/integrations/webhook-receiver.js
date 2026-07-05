// 后端集成层：Webhook 接收器
// 参考 Ditto packages/integration/src/webhook-receiver.ts
//
// 设计要点：
// 1. 接收外部系统 POST 请求，验证 token + HMAC 签名
// 2. 防重放：timestamp 必须在 5 分钟内
// 3. 验证通过后通过 relayBus.emitLocal 广播到本地事件流
// 4. 限流：按 token 限流（复用 rate-limit 中间件）
// 5. 错误响应不泄露内部信息（统一返回 401/403/429）

var tokenStore = require('./token-store');
var relayBus = require('../utils/relay-bus');

// 时间戳容差（5 分钟）
var TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Webhook 接收中间件
 * POST /api/integrations/webhook
 * Headers: X-ClassIntra-Token, X-ClassIntra-Signature, X-ClassIntra-Timestamp, X-ClassIntra-Event
 */
function createWebhookReceiver() {
  return function(req, res) {
    var token = req.headers['x-classintra-token'];
    var signature = req.headers['x-classintra-signature'];
    var timestamp = req.headers['x-classintra-timestamp'];
    var event = req.headers['x-classintra-event'] || 'custom.event';

    // 1. 检查必要 headers
    if (!token || !signature || !timestamp) {
      return res.status(401).json({ code: 401, message: '缺少必要的认证 headers' });
    }

    // 2. 验证 timestamp（防重放）
    var ts = parseInt(timestamp, 10);
    if (isNaN(ts)) {
      return res.status(401).json({ code: 401, message: 'timestamp 格式无效' });
    }
    var now = Date.now();
    if (Math.abs(now - ts) > TIMESTAMP_TOLERANCE_MS) {
      return res.status(401).json({ code: 401, message: 'timestamp 超出容差范围' });
    }

    // 3. 验证 token
    var integration = tokenStore.verifyToken(token);
    if (!integration) {
      return res.status(401).json({ code: 401, message: 'token 无效或已过期' });
    }

    // 4. 验证 HMAC 签名
    var rawBody = req._rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    var valid = tokenStore.verifyWebhookSignature(integration.secret_hash, timestamp, rawBody, signature);
    if (!valid) {
      return res.status(401).json({ code: 401, message: '签名验证失败' });
    }

    // 5. 广播到本地事件流
    var channel = 'integration:' + event;
    var payload = {
      event: event,
      data: req.body,
      integration: {
        id: integration.id,
        name: integration.name,
        scopes: integration.scopes
      },
      receivedAt: new Date().toISOString()
    };

    try {
      relayBus.emitLocal(channel, payload);
    } catch (e) {
      console.error('[webhook-receiver] relayBus.emitLocal 失败:', e.message);
    }

    // 6. 记录日志（可扩展为持久化）
    try {
      relayBus.emitLocal('integration:log', {
        integrationId: integration.id,
        integrationName: integration.name,
        event: event,
        success: true,
        timestamp: payload.receivedAt
      });
    } catch (e) {}

    res.json({
      code: 200,
      message: 'webhook 接收成功',
      data: {
        event: event,
        receivedAt: payload.receivedAt
      }
    });
  };
}

module.exports = {
  createWebhookReceiver: createWebhookReceiver,
  TIMESTAMP_TOLERANCE_MS: TIMESTAMP_TOLERANCE_MS
};
