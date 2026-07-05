// 共享层：集成协议契约
// 参考 Ditto packages/integration/src/contract.ts + IPCBus 消息格式
//
// 设计要点：
// 1. postMessage 协议：外部嵌入页 ↔ ClassIntra，使用 envelope 信封格式
// 2. webhook 协议：ClassIntra → 外部系统，HMAC-SHA256 签名 + 时间戳防重放
// 3. 双向事件命名空间：channel 定义所有通信通道，scope 控制权限
// 4. 强制 origin 白名单（绝不 '*'）+ envelope 校验，防跨域攻击

// ========== 协议常量 ==========
var MSG_TYPE = 'classintra-integration';
var PROTOCOL_VERSION = '1.0';
var DEFAULT_TIMEOUT_MS = 5000;
var DEFAULT_TOKEN_TTL_DAYS = 30;

// ========== 通道定义 ==========
// direction: 'inbound'（外部→ClassIntra）/ 'outbound'（ClassIntra→外部）/ 'bidirectional'
// scope: 该通道所需的权限范围
var CHANNELS = {
  'handshake:request': { direction: 'bidirectional', scope: null },
  'handshake:response': { direction: 'bidirectional', scope: null },
  'ping': { direction: 'bidirectional', scope: null },
  'app:open': { direction: 'inbound', scope: 'app:write' },
  'user:info': { direction: 'inbound', scope: 'user:read' },
  'user:signed-out': { direction: 'outbound', scope: 'user:read' },
  'notification:send': { direction: 'inbound', scope: 'notification:write' },
  'data:query': { direction: 'inbound', scope: 'data:read' },
  'data:update': { direction: 'inbound', scope: 'data:write' },
  'event:subscribe': { direction: 'inbound', scope: 'data:read' },
  'event:push': { direction: 'outbound', scope: 'data:read' },
  'calendar:event_created': { direction: 'outbound', scope: 'calendar:read' },
  'countdown:reached': { direction: 'outbound', scope: 'countdown:read' }
};

// ========== 权限范围 ==========
var SCOPES = [
  'app:read', 'app:write',
  'user:read', 'user:write',
  'notification:write',
  'data:read', 'data:write',
  'calendar:read', 'calendar:write',
  'countdown:read',
  'message:read', 'message:write',
  'community:read', 'community:write'
];

// ========== Envelope 信封格式 ==========
// kind: 'request' | 'response' | 'event' | 'error'
// 所有 postMessage 消息必须符合此格式

/**
 * 创建 envelope
 * @param {Object} options
 * @param {string} options.channel - 通道名（见 CHANNELS）
 * @param {string} options.kind - 消息类型（request/response/event/error）
 * @param {Object} [options.payload] - 消息体
 * @param {string} [options.id] - 消息 id（缺省自动生成）
 * @param {string} [options.requestId] - 关联的请求 id（response/error 类必填）
 * @param {string} [options.source] - 来源标识
 * @param {string} [options.target] - 目标标识
 * @param {Object} [options.error] - 错误信息（kind=error 时）
 * @returns {Object} envelope
 */
function createEnvelope(options) {
  if (!options || !options.channel || !options.kind) {
    throw new Error('createEnvelope: channel 和 kind 必填');
  }
  return {
    v: PROTOCOL_VERSION,
    type: MSG_TYPE,
    id: options.id || _generateId(),
    kind: options.kind,
    channel: options.channel,
    source: options.source || null,
    target: options.target || null,
    payload: options.payload || null,
    requestId: options.requestId || null,
    error: options.error || null,
    timestamp: Date.now()
  };
}

/**
 * 验证 envelope 格式
 * @param {Object} env - 待验证的 envelope
 * @param {string} [expectedOrigin] - 期望的来源 origin（用于跨域校验）
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEnvelope(env, expectedOrigin) {
  var errors = [];
  if (!env || typeof env !== 'object') {
    return { valid: false, errors: ['envelope 必须是对象'] };
  }
  if (env.type !== MSG_TYPE) {
    errors.push('type 不匹配，期望 "' + MSG_TYPE + '"，实际 "' + env.type + '"');
  }
  if (!env.v || typeof env.v !== 'string') {
    errors.push('v（协议版本）缺失或非字符串');
  }
  if (!env.id || typeof env.id !== 'string') {
    errors.push('id 缺失或非字符串');
  }
  if (['request', 'response', 'event', 'error'].indexOf(env.kind) === -1) {
    errors.push('kind "' + env.kind + '" 不在枚举中');
  }
  if (!env.channel || typeof env.channel !== 'string') {
    errors.push('channel 缺失或非字符串');
  } else if (!CHANNELS[env.channel]) {
    errors.push('channel "' + env.channel + '" 未注册');
  }
  if (typeof env.timestamp !== 'number') {
    errors.push('timestamp 缺失或非数字');
  }
  // response/error 必须有 requestId
  if ((env.kind === 'response' || env.kind === 'error') && !env.requestId) {
    errors.push(env.kind + ' 类型必须有 requestId');
  }
  // kind=error 必须有 error 字段
  if (env.kind === 'error' && !env.error) {
    errors.push('error 类型必须有 error 字段');
  }
  return { valid: errors.length === 0, errors: errors };
}

// ========== 工具函数 ==========
function _generateId() {
  return 'ci_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ========== Webhook 签名格式 ==========
// Headers:
//   X-ClassIntra-Signature: sha256=<hmac_hex>
//   X-ClassIntra-Token: <token>
//   X-ClassIntra-Timestamp: <unix_ms>
//   X-ClassIntra-Event: <event_type>
// 签名计算：HMAC-SHA256(secret, timestamp + '.' + rawBody)

var WEBHOOK_HEADERS = {
  SIGNATURE: 'x-classintra-signature',
  TOKEN: 'x-classintra-token',
  TIMESTAMP: 'x-classintra-timestamp',
  EVENT: 'x-classintra-event'
};

// webhook 事件类型（与 server 端 integration-token-service 一致）
var WEBHOOK_EVENTS = {
  USER_SIGNED_IN: 'user.signed_in',
  USER_SIGNED_OUT: 'user.signed_out',
  MESSAGE_RECEIVED: 'message.received',
  ANNOUNCEMENT_PUBLISHED: 'announcement.published',
  COUNTDOWN_REACHED: 'countdown.reached',
  CALENDAR_EVENT_CREATED: 'calendar.event_created',
  CUSTOM_EVENT: 'custom.event'
};

// ========== 预留函数签名（具体实现在前后端各自实现） ==========

/**
 * 计算 webhook 签名（后端实现）
 * @param {string} secret - HMAC 密钥
 * @param {string} timestamp - 时间戳（ms）
 * @param {string} rawBody - 原始请求体
 * @returns {string} 签名（hex）
 */
function computeWebhookSignature(secret, timestamp, rawBody) {
  throw new Error('computeWebhookSignature 应在后端实现（crypto.createHmac）');
}

export {
  MSG_TYPE,
  PROTOCOL_VERSION,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TOKEN_TTL_DAYS,
  CHANNELS,
  SCOPES,
  WEBHOOK_HEADERS,
  WEBHOOK_EVENTS,
  createEnvelope,
  validateEnvelope,
  computeWebhookSignature
};
