// CampusBili Bridge 联动契约（v1.1）
// =====================================
// ClassIntra 与 CampusBili 之间 postMessage 通信的权威定义。
// 所有联动消息必须符合此契约规范。
//
// 消息流向：
//   ClassIntra（父） → CampusBili（iframe 子）  ：下发指令（video-control / request-mute / welcome）
//   CampusBili（子） → ClassIntra（父）         ：上报事件（share-request / hello / ready）
//
// 握手流程（v1.1 新增）：
//   1. 子 mount → 发送 HELLO（携带子端协议版本 + 支持的通道列表）
//   2. 父收到 HELLO → 校验版本兼容性 → 发送 WELCOME（携带身份 + 允许的通道 + 协议版本）
//   3. 子收到 WELCOME → 标记就绪 → 发送 READY
//   4. 双向通信开始
//   注：PING 作为兜底保留，未实现握手的旧子站点仍可通过 PING 触发身份注入
//
// 安全要求：
//   1. 父→子 postMessage 必须用具体 origin（禁止 '*'）
//   2. 子→父 postMessage 可用 '*'（子站点不掌握父 origin 配置，父端按 source 白名单过滤）
//   3. 父端必须校验 event.source === iframe.contentWindow，防止其他页面伪造
//   4. 通道白名单：父端按 manifest.integration.channels 声明过滤，子端按 WELCOME.allowedChannels 过滤

// ========== 协议常量 ==========
var PROTOCOL_VERSION = '1.1';
var MSG_TYPE = 'campusbili-bridge';

// 消息来源标识
var SOURCE_CLASSINTRA = 'classintra-browser';
var SOURCE_CAMPUSBILI = 'campusbili';

// ========== 动作枚举 ==========
// 父→子（ClassIntra → CampusBili）下发的指令
var ACTIONS_PARENT_TO_CHILD = {
  // 握手响应：身份注入 + 允许通道 + 协议版本（v1.1）
  WELCOME: 'handshake-welcome',
  // 请求子站点默认静音视频（加载时下发一次）
  REQUEST_MUTE: 'request-mute',
  // 视频控制指令（payload.command: play/pause/seek, payload.value: seek 秒数）
  VIDEO_CONTROL: 'video-control',
  // 请求立即上报一次播放状态
  REQUEST_PLAYBACK_STATUS: 'request-playback-status',
  // 请求子站点上报页面信息（title/url）
  REQUEST_PAGE_INFO: 'request-page-info'
};

// 子→父（CampusBili → ClassIntra）上报的事件
var ACTIONS_CHILD_TO_PARENT = {
  // 握手发起：上报子端协议版本 + 支持通道（v1.1）
  HELLO: 'handshake-hello',
  // 握手完成：子端已就绪（v1.1）
  READY: 'handshake-ready',
  // 子站点请求返回 ClassIntra 桌面（如左上角返回按钮）
  BACK: 'classintra-back',
  // 子站点主动 ping 父窗口（兜底：未实现握手的旧子站点通过此触发身份注入）
  PING: 'classintra-ping',
  // 保留协议常量供旧客户端兼容；ClassIntra 当前不再将播放状态展示到超能岛。
  PLAYBACK_STATUS: 'campusbili-playback-status',
  // 分享请求（payload: { url, title, aid, bvid, pic, owner }）
  SHARE_REQUEST: 'campusbili-share-request',
  // 页面信息上报（payload: { title, url }）
  PAGE_INFO: 'campusbili-page-info'
};

// 合并所有动作名（用于校验）
var ALL_ACTIONS = {};
Object.keys(ACTIONS_PARENT_TO_CHILD).forEach(function(k) { ALL_ACTIONS[ACTIONS_PARENT_TO_CHILD[k]] = true; });
Object.keys(ACTIONS_CHILD_TO_PARENT).forEach(function(k) { ALL_ACTIONS[ACTIONS_CHILD_TO_PARENT[k]] = true; });

// ========== 视频控制命令 ==========
var VIDEO_COMMANDS = {
  PLAY: 'play',
  PAUSE: 'pause',
  SEEK: 'seek'
};

// ========== 通道能力映射 ==========
// 每个 manifest.integration.channels 项对应一组动作，用于白名单校验
// 注意：'identity-injection' 通道对应无 action 的身份注入消息（兼容旧路径）
var CHANNEL_ACTIONS = {
  'handshake': ['handshake-hello', 'handshake-welcome', 'handshake-ready'],
  'identity-injection': ['__identity__'], // 特殊：无 action 的身份注入消息
  'request-mute': ['request-mute'],
  'video-control': ['video-control'],
  'playback-status': ['campusbili-playback-status', 'request-playback-status'],
  'share-request': ['campusbili-share-request'],
  'back-button': ['classintra-back'],
  'ping': ['classintra-ping'],
  'page-info': ['campusbili-page-info', 'request-page-info']
};

// 默认允许的全部通道（向后兼容：未声明 channels 时使用）
var DEFAULT_CHANNELS = Object.keys(CHANNEL_ACTIONS);

// ========== 播放状态 payload 结构 ==========
// playback-status payload 标准字段：
//   isPlaying: boolean    是否正在播放
//   ended: boolean        是否已结束
//   currentTime: number   当前播放时间（秒）
//   duration: number      总时长（秒）
//   title: string         视频标题
//   pic: string           视频封面 URL
//   bvid: string          视频 BV 号
//   aid: number           视频 AV 号
//   owner: string         UP 主名称

// ========== 工厂函数 ==========

/**
 * 创建联动消息
 * @param {string} source  - 来源标识（SOURCE_CLASSINTRA / SOURCE_CAMPUSBILI）
 * @param {string} action  - 动作枚举（见 ACTIONS_*）
 * @param {Object} [payload] - 消息体（可选）
 * @returns {Object} 标准消息对象
 */
function createMessage(source, action, payload) {
  return {
    type: MSG_TYPE,
    v: PROTOCOL_VERSION,
    source: source,
    action: action,
    payload: payload || null,
    timestamp: Date.now()
  };
}

/**
 * 创建身份注入消息（特殊：无 action，source 即标识）
 * 兼容 v1.0：WELCOME 之外的旧式身份注入仍保留
 * @param {Object} user - 用户信息 { user_id, net_name, is_admin, role }
 * @returns {Object} 身份注入消息
 */
function createIdentityMessage(user) {
  return {
    type: MSG_TYPE,
    v: PROTOCOL_VERSION,
    source: SOURCE_CLASSINTRA,
    user: user,
    timestamp: Date.now()
  };
}

/**
 * 创建 HELLO 消息（子→父，握手发起）
 * @param {string} childVersion   - 子端协议版本（如 '1.1'）
 * @param {string[]} childChannels - 子端支持的通道列表
 * @returns {Object} HELLO 消息
 */
function createHelloMessage(childVersion, childChannels) {
  return createMessage(SOURCE_CAMPUSBILI, ACTIONS_CHILD_TO_PARENT.HELLO, {
    v: childVersion || PROTOCOL_VERSION,
    channels: Array.isArray(childChannels) ? childChannels : DEFAULT_CHANNELS
  });
}

/**
 * 创建 WELCOME 消息（父→子，握手响应）
 * 携带身份 + 允许的通道 + 协议版本
 * @param {Object} user             - 用户信息
 * @param {string[]} allowedChannels - 父端允许的通道（来自 manifest）
 * @param {string} parentVersion    - 父端协议版本
 * @returns {Object} WELCOME 消息
 */
function createWelcomeMessage(user, allowedChannels, parentVersion) {
  return createMessage(SOURCE_CLASSINTRA, ACTIONS_PARENT_TO_CHILD.WELCOME, {
    user: user,
    allowedChannels: Array.isArray(allowedChannels) ? allowedChannels : DEFAULT_CHANNELS,
    v: parentVersion || PROTOCOL_VERSION
  });
}

/**
 * 创建 READY 消息（子→父，握手完成）
 * @returns {Object} READY 消息
 */
function createReadyMessage() {
  return createMessage(SOURCE_CAMPUSBILI, ACTIONS_CHILD_TO_PARENT.READY);
}

// ========== 校验函数 ==========

/**
 * 校验消息格式
 * @param {Object} msg - 待校验的消息对象
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateMessage(msg) {
  var errors = [];
  if (!msg || typeof msg !== 'object') {
    return { valid: false, errors: ['消息必须是对象'] };
  }
  if (msg.type !== MSG_TYPE) {
    return { valid: false, errors: ['type 不匹配，期望 "' + MSG_TYPE + '"'] };
  }
  // 兼容历史：身份注入消息无 action 字段（仅 source + user）
  var isIdentityMsg = !msg.action && msg.source === SOURCE_CLASSINTRA && msg.user;
  if (!isIdentityMsg) {
    if (!msg.action || typeof msg.action !== 'string') {
      errors.push('action 缺失或非字符串');
    } else if (!ALL_ACTIONS[msg.action]) {
      errors.push('action "' + msg.action + '" 未注册');
    }
  }
  if (msg.source !== SOURCE_CLASSINTRA && msg.source !== SOURCE_CAMPUSBILI) {
    errors.push('source "' + msg.source + '" 不在白名单');
  }
  if (typeof msg.timestamp !== 'number' || msg.timestamp <= 0) {
    errors.push('timestamp 缺失或非正数');
  }
  return { valid: errors.length === 0, errors: errors };
}

/**
 * 判断消息方向
 * @param {Object} msg - 已校验的消息
 * @returns {'parent-to-child'|'child-to-parent'|'identity'|'unknown'}
 */
function getMessageDirection(msg) {
  if (msg.source === SOURCE_CLASSINTRA && !msg.action && msg.user) return 'identity';
  if (msg.source === SOURCE_CLASSINTRA) return 'parent-to-child';
  if (msg.source === SOURCE_CAMPUSBILI) return 'child-to-parent';
  return 'unknown';
}

// ========== 版本协商 ==========

/**
 * 版本兼容性协商
 * 当前策略：主版本号一致即兼容；子版本号差异不影响
 * @param {string} parentVersion - 父端协议版本（如 '1.1'）
 * @param {string} childVersion  - 子端协议版本（如 '1.0'）
 * @returns {{ compatible: boolean, negotiated: string, reason: string }}
 */
function negotiateVersion(parentVersion, childVersion) {
  var p = _parseVersion(parentVersion);
  var c = _parseVersion(childVersion);
  if (!p || !c) {
    return { compatible: false, negotiated: '', reason: '版本号格式不合法' };
  }
  if (p.major !== c.major) {
    return { compatible: false, negotiated: '', reason: '主版本不兼容（父 ' + parentVersion + ' / 子 ' + childVersion + '）' };
  }
  // 取较低版本作为协商版本（保守策略）
  var negotiated = (p.minor < c.minor) ? parentVersion : childVersion;
  return { compatible: true, negotiated: negotiated, reason: '兼容' };
}

// 内部：解析版本号
function _parseVersion(v) {
  if (typeof v !== 'string') return null;
  var parts = v.split('.');
  if (parts.length < 2) return null;
  var major = parseInt(parts[0], 10);
  var minor = parseInt(parts[1], 10);
  if (isNaN(major) || isNaN(minor)) return null;
  return { major: major, minor: minor };
}

// ========== 通道白名单 ==========

/**
 * 动作映射到所属通道
 * @param {string} action - 动作名（或 '__identity__' 表示身份注入）
 * @returns {string|null} 通道名，未匹配返回 null
 */
function actionToChannel(action) {
  var channels = Object.keys(CHANNEL_ACTIONS);
  for (var i = 0; i < channels.length; i++) {
    var ch = channels[i];
    var actions = CHANNEL_ACTIONS[ch];
    for (var j = 0; j < actions.length; j++) {
      if (actions[j] === action) return ch;
    }
  }
  return null;
}

/**
 * 判断动作是否被允许的通道集合覆盖
 * @param {string} action           - 动作名（或 '__identity__'）
 * @param {string[]} allowedChannels - 允许的通道列表
 * @returns {boolean}
 */
function isActionAllowed(action, allowedChannels) {
  if (!Array.isArray(allowedChannels) || allowedChannels.length === 0) return true; // 未声明=全允许（向后兼容）
  var ch = actionToChannel(action);
  if (!ch) return false; // 未知动作默认拒绝
  return allowedChannels.indexOf(ch) !== -1;
}

/**
 * 判断身份注入消息是否被允许
 * @param {string[]} allowedChannels
 * @returns {boolean}
 */
function isIdentityAllowed(allowedChannels) {
  return isActionAllowed('__identity__', allowedChannels);
}

/**
 * 取两个通道列表的交集（用于握手时计算双方共同支持的通道）
 * @param {string[]} a
 * @param {string[]} b
 * @returns {string[]}
 */
function intersectChannels(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return [];
  return a.filter(function(ch) { return b.indexOf(ch) !== -1; });
}

// ========== 工具函数 ==========

/**
 * 从 URL 提取 origin（用于 postMessage targetOrigin）
 * @param {string} url
 * @returns {string} origin 或空字符串
 */
function extractOrigin(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    var match = url.match(/^(https?:\/\/[^/]+)/i);
    return match ? match[1].toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

// ========== 导出 ==========
// 同时支持 ES Module（前端）和 CommonJS（后端校验）
var exportsObj = {
  PROTOCOL_VERSION: PROTOCOL_VERSION,
  MSG_TYPE: MSG_TYPE,
  SOURCE_CLASSINTRA: SOURCE_CLASSINTRA,
  SOURCE_CAMPUSBILI: SOURCE_CAMPUSBILI,
  ACTIONS_PARENT_TO_CHILD: ACTIONS_PARENT_TO_CHILD,
  ACTIONS_CHILD_TO_PARENT: ACTIONS_CHILD_TO_PARENT,
  VIDEO_COMMANDS: VIDEO_COMMANDS,
  CHANNEL_ACTIONS: CHANNEL_ACTIONS,
  DEFAULT_CHANNELS: DEFAULT_CHANNELS,
  // 工厂
  createMessage: createMessage,
  createIdentityMessage: createIdentityMessage,
  createHelloMessage: createHelloMessage,
  createWelcomeMessage: createWelcomeMessage,
  createReadyMessage: createReadyMessage,
  // 校验
  validateMessage: validateMessage,
  getMessageDirection: getMessageDirection,
  // 版本协商
  negotiateVersion: negotiateVersion,
  // 通道白名单
  actionToChannel: actionToChannel,
  isActionAllowed: isActionAllowed,
  isIdentityAllowed: isIdentityAllowed,
  intersectChannels: intersectChannels,
  // 工具
  extractOrigin: extractOrigin
};

// CommonJS 兼容（后端 require 时可用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = exportsObj;
}

export {
  PROTOCOL_VERSION,
  MSG_TYPE,
  SOURCE_CLASSINTRA,
  SOURCE_CAMPUSBILI,
  ACTIONS_PARENT_TO_CHILD,
  ACTIONS_CHILD_TO_PARENT,
  VIDEO_COMMANDS,
  CHANNEL_ACTIONS,
  DEFAULT_CHANNELS,
  createMessage,
  createIdentityMessage,
  createHelloMessage,
  createWelcomeMessage,
  createReadyMessage,
  validateMessage,
  getMessageDirection,
  negotiateVersion,
  actionToChannel,
  isActionAllowed,
  isIdentityAllowed,
  intersectChannels,
  extractOrigin
};
