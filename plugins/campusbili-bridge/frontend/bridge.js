// CampusBili Bridge 前端桥接模块（v1.1）
// =====================================
// ClassIntra 侧的统一联动入口，封装所有与 CampusBili 的 postMessage 通信。
//
// 设计原则：
// 1. 单一职责：所有 CampusBili 联动通信只通过此模块
// 2. 契约驱动：消息格式严格遵循 shared/contract.js
// 3. 安全第一：父→子 postMessage 必须用具体 origin；父端按 iframe source 过滤
// 4. 握手优先：完整 HELLO → WELCOME → READY 流程，版本协商 + 通道白名单生效
// 5. 解耦：Browser.vue / island-notify.js 不再直接调用 postMessage
//
// 使用方式（推荐订阅式）：
//   import { mountBridge } from '@/integrations/campusbili-bridge-client';
//   var bridge = mountBridge(iframe, {
//     user: currentUser,
//     allowedChannels: ['handshake', 'identity-injection', 'video-control', ...]
//   });
//   bridge.on('back', function(payload) { router.push({name:'Desktop'}); });
//   bridge.on('playback-status', function(payload) { islandNotify.showVideoIsland(payload); });
//   bridge.on('ready', function() { console.log('CampusBili 就绪'); });
//   bridge.sendVideoControl('play');

import {
  PROTOCOL_VERSION,
  MSG_TYPE,
  SOURCE_CLASSINTRA,
  SOURCE_CAMPUSBILI,
  ACTIONS_PARENT_TO_CHILD,
  ACTIONS_CHILD_TO_PARENT,
  VIDEO_COMMANDS,
  DEFAULT_CHANNELS,
  createMessage,
  createIdentityMessage,
  createHelloMessage,
  createWelcomeMessage,
  createReadyMessage,
  validateMessage,
  getMessageDirection,
  negotiateVersion,
  isActionAllowed,
  isIdentityAllowed,
  intersectChannels,
  extractOrigin
} from '../shared/contract.js';

// ========== 握手状态枚举 ==========
var STATE = {
  DISCONNECTED: 'disconnected',
  HELLO_RECEIVED: 'hello-received',
  WELCOME_SENT: 'welcome-sent',
  READY: 'ready'
};

// ========== 桥接实例 ==========
// 每个 iframe 对应一个 BridgeInstance，独立管理消息收发
function BridgeInstance(iframe) {
  this._iframe = iframe;
  this._origin = '';
  this._messageHandler = null;
  // 订阅表：{ action: [handler] }，'__identity__' 用于身份注入，'__ready__' 用于就绪事件
  this._handlers = {};
  // 一次性订阅表：{ action: [handler] }
  this._onceHandlers = {};
  // 兼容旧接口：onAction 默认回调
  this._legacyOnAction = null;
  this._started = false;
  // 握手状态
  this._state = STATE.DISCONNECTED;
  this._negotiatedVersion = '';
  this._allowedChannels = DEFAULT_CHANNELS; // 父端允许的通道（来自 manifest）
  this._childChannels = DEFAULT_CHANNELS;  // 子端声明的通道
  this._activeChannels = DEFAULT_CHANNELS; // 协商后实际生效的通道（交集）
  this._user = null;
  // 握手超时定时器
  this._handshakeTimer = null;
}

// 启动桥接
// options: {
//   user: Object,             - 用户信息（用于握手时通过 WELCOME 注入）
//   allowedChannels: string[],- 父端允许的通道（来自 manifest.integration.channels）
//   handshakeTimeout: number, - 握手超时毫秒数（默认 15000）
//   onAction: Function,      - 兼容旧接口：function(action, payload, msg)
//   onReady: Function,        - 就绪回调（等价于 bridge.on('ready', ...)）
//   onError: Function         - 错误回调：function(err)
// }
BridgeInstance.prototype.mount = function(options) {
  var self = this;
  if (self._started) return;
  options = options || {};
  self._started = true;
  // 计算 iframe 的 origin（用于 postMessage targetOrigin，绝不 '*')
  self._origin = extractOrigin(self._iframe.src || '');
  self._user = options.user || null;
  self._allowedChannels = (Array.isArray(options.allowedChannels) && options.allowedChannels.length > 0)
    ? options.allowedChannels
    : DEFAULT_CHANNELS;
  self._activeChannels = self._allowedChannels.slice();

  // 兼容旧接口
  if (typeof options.onAction === 'function') self._legacyOnAction = options.onAction;
  if (typeof options.onReady === 'function') self.on('ready', options.onReady);
  if (typeof options.onError === 'function') self.on('error', options.onError);

  // 监听 message 事件
  self._messageHandler = function(event) { self._onMessage(event); };
  window.addEventListener('message', self._messageHandler);

  // 启动握手超时计时器（加固根基：避免子端无响应时父端永久等待）
  // handshakeTimeout=0 表示禁用（用于测试或已知子端不支持握手的场景）
  var timeout = (typeof options.handshakeTimeout === 'number') ? options.handshakeTimeout : 15000;
  if (timeout > 0) {
    self._handshakeTimer = setTimeout(function() {
      if (self._state === STATE.DISCONNECTED) {
        self._emit('error', new Error('握手超时：子端未在 ' + timeout + 'ms 内发起 HELLO/PING'));
      } else if (self._state === STATE.WELCOME_SENT) {
        self._emit('error', new Error('握手超时：子端未在 ' + timeout + 'ms 内回复 READY'));
      }
    }, timeout);
  }

  // 注：v1.1 不再 mount 时立即注入身份。等子端 HELLO 后通过 WELCOME 注入。
  // 兼容：若子端为旧版本（不发 HELLO 只发 PING），收到 PING 时也注入身份。
};

/**
 * 清除握手超时计时器（握手进行中或完成时调用）
 */
BridgeInstance.prototype._clearHandshakeTimer = function() {
  if (this._handshakeTimer) {
    clearTimeout(this._handshakeTimer);
    this._handshakeTimer = null;
  }
};

// 卸载桥接
BridgeInstance.prototype.unmount = function() {
  if (this._handshakeTimer) {
    clearTimeout(this._handshakeTimer);
    this._handshakeTimer = null;
  }
  if (this._messageHandler) {
    window.removeEventListener('message', this._messageHandler);
    this._messageHandler = null;
  }
  this._handlers = {};
  this._onceHandlers = {};
  this._legacyOnAction = null;
  this._started = false;
  this._state = STATE.DISCONNECTED;
};

// ========== 订阅 API ==========

/**
 * 注册动作处理器
 * @param {string} action   - 动作名（ACTIONS_CHILD_TO_PARENT.* 或特殊 'ready' / 'error' / 'hello' / 'ping'）
 * @param {Function} handler - function(payload, msg)
 * @returns {this} 链式调用
 */
BridgeInstance.prototype.on = function(action, handler) {
  if (typeof action !== 'string' || typeof handler !== 'function') return this;
  if (!this._handlers[action]) this._handlers[action] = [];
  this._handlers[action].push(handler);
  return this;
};

/**
 * 注册一次性动作处理器（触发一次后自动移除）
 */
BridgeInstance.prototype.once = function(action, handler) {
  if (typeof action !== 'string' || typeof handler !== 'function') return this;
  if (!this._onceHandlers[action]) this._onceHandlers[action] = [];
  this._onceHandlers[action].push(handler);
  return this;
};

/**
 * 取消订阅
 * @param {string} action
 * @param {Function} [handler] - 不传则移除该 action 所有 handler
 */
BridgeInstance.prototype.off = function(action, handler) {
  if (typeof action !== 'string') return this;
  if (typeof handler === 'function') {
    if (this._handlers[action]) {
      this._handlers[action] = this._handlers[action].filter(function(h) { return h !== handler; });
    }
    if (this._onceHandlers[action]) {
      this._onceHandlers[action] = this._onceHandlers[action].filter(function(h) { return h !== handler; });
    }
  } else {
    this._handlers[action] = [];
    this._onceHandlers[action] = [];
  }
  return this;
};

// ========== 状态查询 ==========

BridgeInstance.prototype.isReady = function() {
  return this._state === STATE.READY;
};

BridgeInstance.prototype.getState = function() {
  return this._state;
};

BridgeInstance.prototype.getActiveChannels = function() {
  return this._activeChannels.slice();
};

BridgeInstance.prototype.getNegotiatedVersion = function() {
  return this._negotiatedVersion;
};

/**
 * 获取调试快照（加固根基 + 方便后续开发）
 * 返回当前桥接实例的运行时状态，用于排查握手异常、通道协商问题等
 * @returns {Object} 调试信息快照
 */
BridgeInstance.prototype.getDebugInfo = function() {
  return {
    state: this._state,
    started: this._started,
    origin: this._origin,
    protocolVersion: PROTOCOL_VERSION,
    negotiatedVersion: this._negotiatedVersion,
    allowedChannels: this._allowedChannels.slice(),
    childChannels: this._childChannels.slice(),
    activeChannels: this._activeChannels.slice(),
    hasUser: !!(this._user && this._user.user_id),
    hasIframe: !!(this._iframe && this._iframe.contentWindow),
    handshakeTimerActive: !!this._handshakeTimer,
    handlerCount: Object.keys(this._handlers).reduce(function(sum, k) {
      return sum + (Array.isArray(this._handlers[k]) ? this._handlers[k].length : 0);
    }.bind(this), 0)
  };
};

// ========== 主动发送消息（父→子）==========

// 注入 ClassIntra 用户身份到 iframe（兼容旧接口）
BridgeInstance.prototype._injectIdentity = function(user) {
  if (!this._iframe || !this._iframe.contentWindow) return;
  if (!this._origin) return; // 无法确定 origin，拒绝发送（安全要求）
  // 通道白名单校验
  if (!isIdentityAllowed(this._activeChannels)) {
    this._emit('error', new Error('identity-injection 通道未允许'));
    return;
  }
  var msg = createIdentityMessage({
    user_id: user.user_id,
    net_name: user.net_name,
    is_admin: user.is_admin,
    role: user.role
  });
  this._postToChild(msg);
};

// 发送 WELCOME 握手响应（v1.1）
BridgeInstance.prototype._sendWelcome = function() {
  if (!this._iframe || !this._iframe.contentWindow) return;
  if (!this._origin) return;
  var userPayload = this._user ? {
    user_id: this._user.user_id,
    net_name: this._user.net_name,
    is_admin: this._user.is_admin,
    role: this._user.role
  } : null;
  var msg = createWelcomeMessage(userPayload, this._allowedChannels, PROTOCOL_VERSION);
  this._postToChild(msg);
};

// 请求子站点默认静音视频
BridgeInstance.prototype._requestMute = function() {
  this._sendAction(ACTIONS_PARENT_TO_CHILD.REQUEST_MUTE);
};

// 发送视频控制指令
// command: 'play' | 'pause' | 'seek', value: seek 时为秒数
BridgeInstance.prototype.sendVideoControl = function(command, value) {
  var payload = { command: command };
  if (typeof value === 'number') payload.value = value;
  this._sendAction(ACTIONS_PARENT_TO_CHILD.VIDEO_CONTROL, payload);
};

// 请求立即上报播放状态
BridgeInstance.prototype.requestPlaybackStatus = function() {
  this._sendAction(ACTIONS_PARENT_TO_CHILD.REQUEST_PLAYBACK_STATUS);
};

// 请求上报页面信息
BridgeInstance.prototype.requestPageInfo = function() {
  this._sendAction(ACTIONS_PARENT_TO_CHILD.REQUEST_PAGE_INFO);
};

// 注入身份（外部调用，用于 iframe load 后重新注入，兼容旧接口）
BridgeInstance.prototype.injectIdentity = function(user) {
  this._user = user || this._user;
  // 已握手就绪：直接注入身份；未就绪：等 WELCOME 流程
  if (this._state === STATE.READY || this._state === STATE.WELCOME_SENT) {
    this._injectIdentity(this._user);
    this._requestMute();
  }
};

// 通用：发送指令消息
BridgeInstance.prototype._sendAction = function(action, payload) {
  if (!this._iframe || !this._iframe.contentWindow) return;
  if (!this._origin) return; // 安全要求：未知 origin 不发送
  // 通道白名单校验
  if (!isActionAllowed(action, this._activeChannels)) {
    this._emit('error', new Error('动作 ' + action + ' 不在允许通道内'));
    return;
  }
  var msg = createMessage(SOURCE_CLASSINTRA, action, payload);
  this._postToChild(msg);
};

// 内部：postMessage 到 iframe，统一错误处理
BridgeInstance.prototype._postToChild = function(msg) {
  try {
    this._iframe.contentWindow.postMessage(msg, this._origin);
  } catch (e) {
    console.warn('[campusbili-bridge] postMessage 失败:', e.message);
    this._emit('error', e);
  }
};

// ========== 接收消息处理（子→父）==========

BridgeInstance.prototype._onMessage = function(event) {
  // 1. 仅处理来自当前 iframe 的消息（防伪造）
  if (!this._iframe || event.source !== this._iframe.contentWindow) return;

  // 2. 校验消息格式
  var msg = event.data;
  var result = validateMessage(msg);
  if (!result.valid) {
    // 静默丢弃非法消息（避免日志噪声）
    return;
  }

  // 3. 按方向分发
  var direction = getMessageDirection(msg);
  if (direction === 'identity') {
    // 子端发回的身份注入回执（未使用，预留）
    return;
  }
  if (direction !== 'child-to-parent') return;

  // 4. 通道白名单校验（握手消息本身不限制，避免死锁）
  var isHandshakeAction = (msg.action === ACTIONS_CHILD_TO_PARENT.HELLO ||
                          msg.action === ACTIONS_CHILD_TO_PARENT.READY ||
                          msg.action === ACTIONS_CHILD_TO_PARENT.PING);
  if (!isHandshakeAction) {
    if (!isActionAllowed(msg.action, this._activeChannels)) {
      // 子端发了不在允许通道内的动作，静默丢弃
      return;
    }
  }

  // 5. 按动作处理
  switch (msg.action) {
    case ACTIONS_CHILD_TO_PARENT.HELLO:
      this._handleHello(msg);
      return;
    case ACTIONS_CHILD_TO_PARENT.PING:
      // 兼容旧子端：收到 PING 也注入身份（但不走完整握手）
      this._handlePing(msg);
      return;
    case ACTIONS_CHILD_TO_PARENT.READY:
      this._handleReady(msg);
      return;
  }

  // 6. 业务消息：触发订阅
  this._emit(msg.action, msg.payload, msg);
};

// 处理 HELLO 握手发起
BridgeInstance.prototype._handleHello = function(msg) {
  // 收到 HELLO：握手进行中。保留超时计时器，使其在 WELCOME_SENT 状态下继续等待 READY
  var payload = msg.payload || {};
  var childVersion = payload.v || PROTOCOL_VERSION;
  var childChannels = Array.isArray(payload.channels) ? payload.channels : DEFAULT_CHANNELS;

  // 版本协商
  var negotiation = negotiateVersion(PROTOCOL_VERSION, childVersion);
  if (!negotiation.compatible) {
    this._emit('error', new Error('版本不兼容：' + negotiation.reason));
    return;
  }
  this._negotiatedVersion = negotiation.negotiated;

  // 通道协商：取父端允许通道 ∩ 子端支持通道
  this._childChannels = childChannels;
  this._activeChannels = intersectChannels(this._allowedChannels, childChannels);
  // 必须包含 handshake 和 identity-injection 才能继续
  if (this._activeChannels.indexOf('handshake') === -1 ||
      this._activeChannels.indexOf('identity-injection') === -1) {
    this._emit('error', new Error('通道协商失败：缺少必备通道'));
    return;
  }

  this._state = STATE.HELLO_RECEIVED;
  this._emit('hello', payload, msg);

  // 发送 WELCOME（携带身份 + 允许通道 + 协议版本）
  this._sendWelcome();
  this._state = STATE.WELCOME_SENT;

  // 兼容旧 PING 路径：WELCOME 后也请求一次静音
  this._requestMute();
};

// 处理 PING（兼容旧子端）
BridgeInstance.prototype._handlePing = function(msg) {
  // 兼容旧子端不走完整握手：停止超时计时，避免误报 READY 超时
  this._clearHandshakeTimer();
  this._state = STATE.HELLO_RECEIVED;
  this._emit('ping', null, msg);
  // 直接注入身份（不走 WELCOME 流程）
  if (this._user) {
    this._injectIdentity(this._user);
    this._requestMute();
  }
  // PING 不进入 READY 状态（旧子端不会发 READY）
};

// 处理 READY
BridgeInstance.prototype._handleReady = function(msg) {
  if (this._state !== STATE.WELCOME_SENT && this._state !== STATE.READY) {
    // READY 在 WELCOME 之前到达，或重复到达
    return;
  }
  // 握手完成：停止超时计时
  this._clearHandshakeTimer();
  this._state = STATE.READY;
  this._emit('ready', null, msg);
};

// 内部：触发订阅
BridgeInstance.prototype._emit = function(action, payload, msg) {
  // 兼容旧 onAction
  if (this._legacyOnAction && action !== 'error') {
    try { this._legacyOnAction(action, payload, msg); } catch (e) { console.error('[campusbili-bridge] legacy onAction 异常:', e); }
  }
  // 持久订阅
  var handlers = this._handlers[action];
  if (handlers) {
    for (var i = 0; i < handlers.length; i++) {
      try { handlers[i](payload, msg); } catch (e) { console.error('[campusbili-bridge] handler 异常:', e); }
    }
  }
  // 一次性订阅
  var onceHandlers = this._onceHandlers[action];
  if (onceHandlers && onceHandlers.length > 0) {
    this._onceHandlers[action] = [];
    for (var j = 0; j < onceHandlers.length; j++) {
      try { onceHandlers[j](payload, msg); } catch (e) { console.error('[campusbili-bridge] once handler 异常:', e); }
    }
  }
};

// ========== 单例管理 ==========
// 每次只能有一个 CampusBili iframe 被桥接（ClassIntra 同时只浏览一个页面）
var _currentInstance = null;

// 获取当前桥接实例
function getCurrentBridge() {
  return _currentInstance;
}

// 为指定 iframe 创建并挂载桥接
// 返回新的 BridgeInstance
function mountBridge(iframe, options) {
  // 卸载之前的实例
  if (_currentInstance) {
    _currentInstance.unmount();
    _currentInstance = null;
  }
  _currentInstance = new BridgeInstance(iframe);
  _currentInstance.mount(options);
  return _currentInstance;
}

// 卸载当前桥接
function unmountBridge() {
  if (_currentInstance) {
    _currentInstance.unmount();
    _currentInstance = null;
  }
}

export {
  BridgeInstance,
  STATE,
  getCurrentBridge,
  mountBridge,
  unmountBridge
};
