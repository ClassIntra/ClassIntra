// 前端集成层：PostMessage Bridge
// 参考 Ditto packages/core/src/ipc/bus.ts
//
// 设计要点：
// 1. 强制 origin 白名单（绝不 '*'），防跨域攻击
// 2. envelope 信封格式校验，非法消息直接丢弃
// 3. request/response 模式：返回 Promise，超时 reject ClassIntraError
// 4. 支持 iframe 嵌入（ClassIntra 作为父页面）和被嵌入（ClassIntra 作为 iframe）
// 5. channel 路由：按 channel 分发到注册的 handler

import { createEnvelope, validateEnvelope, MSG_TYPE, CHANNELS, DEFAULT_TIMEOUT_MS } from '@shared/integration-contract';
import { ClassIntraError } from '@shared/errors';
import api from '@/utils/api';

function PostMessageBridge() {
  this._handlers = {};          // { channel: [handler] }
  this._pendingRequests = {};   // { requestId: { resolve, reject, timer } }
  this._allowedOrigins = [];    // 允许的 origin 白名单
  this._started = false;
  this._targetWindow = null;    // 目标 window（被嵌入时是 parent，嵌入时是 iframe.contentWindow）
  this._targetOrigin = null;    // 目标 origin
}

// 启动桥接
// 1. 从 /api/integrations/origins 拉取白名单
// 2. addEventListener('message')
PostMessageBridge.prototype.start = function() {
  var self = this;
  if (self._started) return Promise.resolve();
  self._started = true;

  // 监听 message 事件
  self._onMessageHandler = function(event) { self._onMessage(event); };
  window.addEventListener('message', self._onMessageHandler);

  // 拉取 origin 白名单
  return api.get('/api/integrations/origins').then(function(res) {
    if (res.data && res.data.code === 200 && res.data.data && Array.isArray(res.data.data.origins)) {
      self._allowedOrigins = res.data.data.origins;
    }
  }).catch(function() {
    // 拉取失败时白名单为空，所有外部消息被拒绝
    self._allowedOrigins = [];
  });
};

// 设置目标 window（用于主动向 iframe 或 parent 发消息）
PostMessageBridge.prototype.setTarget = function(targetWindow, targetOrigin) {
  this._targetWindow = targetWindow;
  this._targetOrigin = targetOrigin;
};

// 注册 channel 处理器
// handler: function(envelope) => 返回值或 Promise，作为 response payload
PostMessageBridge.prototype.on = function(channel, handler) {
  if (!CHANNELS[channel]) {
    console.warn('[postmessage-bridge] channel "' + channel + '" 未注册');
    return;
  }
  if (!this._handlers[channel]) this._handlers[channel] = [];
  this._handlers[channel].push(handler);
};

// 发送请求（等待响应）
// 返回 Promise，超时 reject ClassIntraError('INTEGRATION_TIMEOUT')
PostMessageBridge.prototype.request = function(channel, payload, timeoutMs) {
  var self = this;
  if (!self._targetWindow || !self._targetOrigin) {
    return Promise.reject(new ClassIntraError('CLASSINTRA_INTEGRATION_NO_TARGET', '未设置目标 window'));
  }
  var envelope = createEnvelope({
    channel: channel,
    kind: 'request',
    payload: payload,
    source: 'classintra'
  });
  var timeout = timeoutMs || DEFAULT_TIMEOUT_MS;

  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      if (self._pendingRequests[envelope.id]) {
        delete self._pendingRequests[envelope.id];
        reject(new ClassIntraError('CLASSINTRA_INTEGRATION_TIMEOUT', '请求超时: ' + channel));
      }
    }, timeout);

    self._pendingRequests[envelope.id] = {
      resolve: resolve,
      reject: reject,
      timer: timer
    };

    self._targetWindow.postMessage(envelope, self._targetOrigin);
  });
};

// 发送响应
PostMessageBridge.prototype.respond = function(requestId, channel, payload, targetWindow, targetOrigin) {
  if (!targetWindow || !targetOrigin) return;
  var envelope = createEnvelope({
    channel: channel,
    kind: 'response',
    payload: payload,
    requestId: requestId,
    source: 'classintra'
  });
  targetWindow.postMessage(envelope, targetOrigin);
};

// 发送事件（单向，不等待响应）
PostMessageBridge.prototype.send = function(channel, payload) {
  if (!this._targetWindow || !this._targetOrigin) return;
  var envelope = createEnvelope({
    channel: channel,
    kind: 'event',
    payload: payload,
    source: 'classintra'
  });
  this._targetWindow.postMessage(envelope, this._targetOrigin);
};

// 广播事件到所有子 iframe
PostMessageBridge.prototype.broadcast = function(channel, payload) {
  var envelopes = [];
  var iframes = document.querySelectorAll('iframe');
  for (var i = 0; i < iframes.length; i++) {
    var iframe = iframes[i];
    var origin = _extractIframeOrigin(iframe.src);
    if (origin && this._isOriginAllowed(origin)) {
      var envelope = createEnvelope({
        channel: channel,
        kind: 'event',
        payload: payload,
        source: 'classintra'
      });
      try {
        iframe.contentWindow.postMessage(envelope, origin);
        envelopes.push(envelope);
      } catch (e) {
        console.warn('[postmessage-bridge] 广播失败:', e.message);
      }
    }
  }
  return envelopes;
};

// 接收消息处理
PostMessageBridge.prototype._onMessage = function(event) {
  var self = this;
  // 1. 校验 origin
  if (!self._isOriginAllowed(event.origin)) {
    return; // 非白名单 origin，静默丢弃
  }
  // 2. 校验 envelope
  var env = event.data;
  var result = validateEnvelope(env);
  if (!result.valid) {
    console.warn('[postmessage-bridge] envelope 校验失败:', result.errors.join('; '));
    return;
  }
  // 3. 按 kind 分发
  if (env.kind === 'response' || env.kind === 'error') {
    // 响应类：查找 pending request
    var pending = self._pendingRequests[env.requestId];
    if (pending) {
      clearTimeout(pending.timer);
      delete self._pendingRequests[env.requestId];
      if (env.kind === 'error') {
        pending.reject(new ClassIntraError('CLASSINTRA_INTEGRATION_ERROR', env.error && env.error.message || '远程错误'));
      } else {
        pending.resolve(env.payload);
      }
    }
    return;
  }

  // request/event 类：调用注册的 handler
  var handlers = self._handlers[env.channel];
  if (!handlers || handlers.length === 0) {
    // 无 handler，如果是 request 则回复 error
    if (env.kind === 'request' && event.source) {
      self.respond(env.id, env.channel, null, event.source, event.origin);
      var errEnvelope = createEnvelope({
        channel: env.channel,
        kind: 'error',
        requestId: env.id,
        error: { message: 'channel "' + env.channel + '" 无 handler' },
        source: 'classintra'
      });
      try { event.source.postMessage(errEnvelope, event.origin); } catch (e) {}
    }
    return;
  }

  // 调用第一个 handler（多 handler 时只取第一个的返回值）
  var handler = handlers[0];
  try {
    var ret = handler(env);
    // 如果是 request 且 handler 返回 Promise 或值，回复 response
    if (env.kind === 'request' && event.source) {
      Promise.resolve(ret).then(function(payload) {
        self.respond(env.id, env.channel, payload, event.source, event.origin);
      }).catch(function(err) {
        var errEnv = createEnvelope({
          channel: env.channel,
          kind: 'error',
          requestId: env.id,
          error: { message: err.message || String(err) },
          source: 'classintra'
        });
        try { event.source.postMessage(errEnv, event.origin); } catch (e) {}
      });
    }
  } catch (e) {
    console.error('[postmessage-bridge] handler 异常:', e);
    if (env.kind === 'request' && event.source) {
      var errEnv = createEnvelope({
        channel: env.channel,
        kind: 'error',
        requestId: env.id,
        error: { message: e.message || String(e) },
        source: 'classintra'
      });
      try { event.source.postMessage(errEnv, event.origin); } catch (_) {}
    }
  }
};

// 检查 origin 是否在白名单中
PostMessageBridge.prototype._isOriginAllowed = function(origin) {
  if (!origin || !Array.isArray(this._allowedOrigins)) return false;
  var normalized = String(origin).toLowerCase().replace(/\/$/, '');
  for (var i = 0; i < this._allowedOrigins.length; i++) {
    var allowed = String(this._allowedOrigins[i]).toLowerCase().replace(/\/$/, '');
    if (allowed === normalized) return true;
    // 支持通配符
    if (allowed.indexOf('*') !== -1) {
      var regexStr = allowed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+');
      try {
        if (new RegExp('^' + regexStr + '$').test(normalized)) return true;
      } catch (e) {}
    }
  }
  return false;
};

// 工具：从 iframe.src 提取 origin
function _extractIframeOrigin(src) {
  if (!src || typeof src !== 'string') return '';
  try {
    var match = src.match(/^(https?:\/\/[^/]+)/i);
    return match ? match[1].toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

// 停止桥接
PostMessageBridge.prototype.stop = function() {
  if (this._onMessageHandler) {
    window.removeEventListener('message', this._onMessageHandler);
    this._onMessageHandler = null;
  }
  // 取消所有 pending requests
  var keys = Object.keys(this._pendingRequests);
  for (var i = 0; i < keys.length; i++) {
    var pending = this._pendingRequests[keys[i]];
    clearTimeout(pending.timer);
    pending.reject(new ClassIntraError('CLASSINTRA_INTEGRATION_CLOSED', '桥接已关闭'));
  }
  this._pendingRequests = {};
  this._started = false;
};

// ========== 单例 ==========
var _instance = null;
function getPostMessageBridge() {
  if (!_instance) {
    _instance = new PostMessageBridge();
  }
  return _instance;
}

export { PostMessageBridge, getPostMessageBridge };
