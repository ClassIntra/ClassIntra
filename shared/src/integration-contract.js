// 共享层：集成协议契约（阶段 4 预留）
// 参考 Ditto packages/integration/src/contract.ts
//
// 本期仅定义接口契约和类型常量，具体实现见阶段 4：
// - client/src/core/integration-manager.js — postMessage 双向通信
// - server/src/routes/integrations.js — webhook 接收 + HMAC 验签
// - server/src/services/integration-token-service.js — token 签发与管理
//
// 设计要点：
// 1. postMessage 协议：外部嵌入页 ↔ ClassIntra，使用受限的消息类型白名单
// 2. webhook 协议：ClassIntra → 外部系统，HMAC-SHA256 签名 + 时间戳防重放
// 3. 双向事件命名空间：ci:out:*（ outbound webhook）、ci:in:*（inbound postMessage）

// ========== 集成协议版本 ==========
// 与 constants.js INTEGRATION_PROTOCOL_VERSION 保持同步
var PROTOCOL_VERSION = '1.0';

// ========== postMessage 消息类型白名单 ==========
// 外部页面可发送给 ClassIntra 的消息类型
var INBOUND_MESSAGE_TYPES = {
  READY: 'ci:in:ready',           // 外部页面就绪，请求初始数据
  REQUEST_DATA: 'ci:in:request',  // 请求数据（如用户信息、事件列表）
  NAVIGATE: 'ci:in:navigate',     // 导航到指定路由
  ACTION: 'ci:in:action',         // 触发动作（如创建事件）
  SUBSCRIBE: 'ci:in:subscribe'    // 订阅事件流
};

// ClassIntra 发送给外部页面的消息类型
var OUTBOUND_MESSAGE_TYPES = {
  READY: 'ci:out:ready',           // ClassIntra 就绪
  DATA: 'ci:out:data',             // 数据响应
  EVENT: 'ci:out:event',           // 事件推送
  ERROR: 'ci:out:error',           // 错误响应
  UNSUBSCRIBED: 'ci:out:unsub'     // 取消订阅
};

// ========== webhook 事件类型 ==========
// ClassIntra 向外部系统推送的事件
var WEBHOOK_EVENTS = {
  USER_SIGNED_IN: 'user.signed_in',
  USER_SIGNED_OUT: 'user.signed_out',
  MESSAGE_RECEIVED: 'message.received',
  ANNOUNCEMENT_PUBLISHED: 'announcement.published',
  COUNTDOWN_REACHED: 'countdown.reached',
  CALENDAR_EVENT_CREATED: 'calendar.event_created',
  CUSTOM_EVENT: 'custom.event'
};

// ========== 接口契约（JSDoc 风格，供阶段 4 实现） ==========

/**
 * postMessage 入站消息格式
 * @typedef {Object} InboundMessage
 * @property {string} type - 消息类型（见 INBOUND_MESSAGE_TYPES）
 * @property {string} id - 消息 id（用于响应关联）
 * @property {string} version - 协议版本
 * @property {Object} payload - 消息体
 */

/**
 * postMessage 出站消息格式
 * @typedef {Object} OutboundMessage
 * @property {string} type - 消息类型（见 OUTBOUND_MESSAGE_TYPES）
 * @property {string} id - 关联的入站消息 id（响应类消息）
 * @property {string} version - 协议版本
 * @property {Object} payload - 消息体
 * @property {Error} [error] - 错误信息（type=ERROR 时）
 */

/**
 * webhook 推送格式
 * @typedef {Object} WebhookPayload
 * @property {string} event - 事件类型（见 WEBHOOK_EVENTS）
 * @property {string} timestamp - ISO 8601 时间戳
 * @property {string} signature - HMAC-SHA256 签名（hex）
 * @property {Object} data - 事件数据
 */

/**
 * 集成配置（存储在 integrations 表中）
 * @typedef {Object} IntegrationConfig
 * @property {number} id - 集成 id
 * @property {string} name - 集成名称
 * @property {string} token - HMAC 签名 token
 * @property {string} webhook_url - webhook 推送 URL
 * @property {string[]} subscribed_events - 订阅的事件列表
 * @property {boolean} active - 是否启用
 * @property {string} created_at - 创建时间
 * @property {string} expires_at - 过期时间
 */

// ========== 预留函数签名（阶段 4 实现） ==========

/**
 * 验证 webhook 签名（阶段 4 实现）
 * @param {string} payload - 原始 payload 字符串
 * @param {string} signature - 签名（hex）
 * @param {string} token - HMAC token
 * @returns {boolean} 签名是否有效
 */
function verifyWebhookSignature(payload, signature, token) {
  // 阶段 4 实现：crypto.createHmac('sha256', token).update(payload).digest('hex')
  throw new Error('verifyWebhookSignature 尚未实现（阶段 4）');
}

/**
 * 构造出站 postMessage（阶段 4 实现）
 */
function buildOutboundMessage(type, payload, correlationId) {
  throw new Error('buildOutboundMessage 尚未实现（阶段 4）');
}

export {
  PROTOCOL_VERSION,
  INBOUND_MESSAGE_TYPES,
  OUTBOUND_MESSAGE_TYPES,
  WEBHOOK_EVENTS,
  verifyWebhookSignature,
  buildOutboundMessage
};
