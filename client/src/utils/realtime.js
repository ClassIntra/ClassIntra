// 第三方应用的全局实时事件客户端，不依赖 Chat 应用。
//
// 传输策略（体验优先）：
//   1. 优先复用核心 wsManager 的单一 WebSocket 连接。wsManager 在 load 时自动连接，
//      自带重连、心跳，并在 X5 / 旧 Android WebView 或 WS 不可用时自动降级为 HTTP 长轮询；
//   2. 事件下行统一走 WS（降级时经 chat poll 队列投递），发布上行优先走 WS，
//      WS 未就绪时退回 HTTP（wsManager.publish）。
// 这样第三方应用无需再单独维护一条 HTTP 长轮询连接。
import wsManager from '@/utils/websocket';

function RealtimeClient() {
  this.listeners = {};
  this.connected = false;
  this.stopped = true;
  this._bound = null;
}

RealtimeClient.prototype.on = function(event, handler) {
  if (typeof handler !== 'function') return function() {};
  if (!this.listeners[event]) this.listeners[event] = [];
  this.listeners[event].push(handler);
  return this.off.bind(this, event, handler);
};

RealtimeClient.prototype.off = function(event, handler) {
  var list = this.listeners[event] || [];
  var index = list.indexOf(handler);
  if (index !== -1) list.splice(index, 1);
};

RealtimeClient.prototype._emit = function(event, payload, message) {
  var list = (this.listeners[event] || []).slice();
  for (var i = 0; i < list.length; i++) {
    try { list[i](payload, message); } catch (e) {}
  }
};

// 挂载 wsManager 事件监听（只挂一次）
RealtimeClient.prototype._attach = function() {
  var self = this;
  if (self._bound) return;
  self._bound = {
    // 下行：wsManager 收到 type 为 extension_event 的消息时触发
    onEvent: function(data) {
      if (!data || !data.type) return;
      self._emit(data.type, data, data);
    },
    onConnected: function(data) {
      self.connected = true;
      self._emit('connected', data || {});
    },
    onStateChange: function(state) {
      if (!state) return;
      if (state.state === 'connected') {
        self.connected = true;
      } else if (state.state === 'disconnected' || state.state === 'reconnecting') {
        self.connected = false;
      }
    }
  };
  wsManager.on('extension_event', self._bound.onEvent);
  wsManager.on('connected', self._bound.onConnected);
  wsManager.on('_connectionStateChange', self._bound.onStateChange);
};

RealtimeClient.prototype._detach = function() {
  if (!this._bound) return;
  wsManager.off('extension_event', this._bound.onEvent);
  wsManager.off('connected', this._bound.onConnected);
  wsManager.off('_connectionStateChange', this._bound.onStateChange);
  this._bound = null;
};

RealtimeClient.prototype.connect = function() {
  var self = this;
  if (!localStorage.getItem('token')) return;
  if (!self.stopped) return;
  self.stopped = false;
  self._attach();
  // 复用已有连接；启动阶段可能早于 wsManager 的 load 自动连接，这里主动触发一次
  try {
    if (typeof wsManager.ensureConnected === 'function') wsManager.ensureConnected();
  } catch (e) {}
  self.connected = (typeof wsManager.isReady === 'function') ? !!wsManager.isReady() : false;
  if (self.connected) self._emit('connected', {});
};

RealtimeClient.prototype.publish = function(event, payload, appName) {
  var appNameStr = appName || '';
  var body = {
    type: 'realtime_publish',
    event: event,
    payload: (payload === undefined ? null : payload),
    app_name: appNameStr
  };
  // 上行优先走 WS；未就绪时 wsManager 会自动入队，重连后补发
  if (typeof wsManager.send === 'function' && typeof wsManager.isReady === 'function' && wsManager.isReady()) {
    var result = wsManager.send(body);
    return Promise.resolve({ code: 200, message: 'ok', data: { transport: 'ws', result: result } });
  }
  // 退回 HTTP（与旧行为一致）
  if (typeof wsManager.publish === 'function') {
    return wsManager.publish(event, payload, appNameStr);
  }
  return Promise.reject(new Error('realtime 通道不可用'));
};

RealtimeClient.prototype.isReady = function() {
  return (typeof wsManager.isReady === 'function') ? !!wsManager.isReady() : this.connected;
};

RealtimeClient.prototype.getConnectionState = function() {
  if (typeof wsManager.getConnectionState === 'function') {
    try { return wsManager.getConnectionState(); } catch (e) {}
  }
  return this.connected ? 'connected' : (this.stopped ? 'disconnected' : 'connecting');
};

RealtimeClient.prototype.subscribe = function(event, handler) {
  return this.on('extension_event', function(message) {
    if (message && message.event === event) handler(message.payload, message);
  });
};

RealtimeClient.prototype.disconnect = function() {
  this.stopped = true;
  this.connected = false;
  this._detach();
  // 不主动断开 wsManager：它是全局聊天/通知共用连接，仅解除本客户端的订阅
};

var realtime = new RealtimeClient();
export default realtime;
