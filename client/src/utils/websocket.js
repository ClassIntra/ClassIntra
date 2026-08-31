var WebSocketManager = function() {
  this.ws = null;
  this.url = '';
  this.connected = false;
  this.authenticated = false;
  this.reconnectAttempts = 0;
  this.maxReconnectAttempts = 10;
  this.reconnectDelay = 3000;
  this.heartbeatInterval = 30000;
  this.heartbeatTimer = null;
  this.reconnectTimer = null;
  this.listeners = {};
  this.token = '';
  this._lastConnectedData = null;
  this._intentionalDisconnect = false;
  this._lastPongReceived = true;
  this._offlineQueue = [];
  this._maxOfflineQueue = 50;
  this._connectionState = 'disconnected';
  // 旧版腾讯 X5 / Android WebView 经常暴露 WebSocket 对象，但无法稳定完成握手，直接使用 HTTP 长轮询。
  var userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  this._x5Browser = /TBS|MQQBrowser|X5|Android.*Version\/4\./i.test(userAgent);
  // HTTP 长轮询回退
  this._transport = this._x5Browser ? 'poll' : 'ws';     // 'ws' or 'poll'
  this._pollTimer = null;
  this._pollLastTs = 0;       // 上次 poll 拉到的事件 ts
  this._pollInFlight = false;
  this._pollStopped = false;
  this._pollRetryDelay = 1000; // 错误重试延迟（指数退避，初始 1s，最大 30s）
  this._wsSupported = (typeof WebSocket !== 'undefined');
};

// ===== WebSocket transport =====

WebSocketManager.prototype.connect = function(url) {
  var self = this;
  // 若已切换到 poll 模式，直接走 poll
  if (self._transport === 'poll') {
    self._startPolling();
    return;
  }
  // 检测浏览器是否支持 WebSocket
  if (!self._wsSupported) {
    console.warn('[WS] WebSocket not supported, falling back to HTTP polling');
    self._switchToPolling();
    return;
  }
  self.url = url || self.url;
  self._intentionalDisconnect = false;
  self._pollStopped = false;
  self.token = localStorage.getItem('token') || '';

  if (self.ws && (self.ws.readyState === WebSocket.CONNECTING || self.ws.readyState === WebSocket.OPEN)) {
    return;
  }

  var wsUrl = self.url;
  if (self.token) {
    var separator = wsUrl.indexOf('?') > -1 ? '&' : '?';
    wsUrl += separator + 'token=' + encodeURIComponent(self.token);
  }

  self.connectTimeout = setTimeout(function() {
    if (!self.connected) {
      console.warn('WebSocket connection timeout');
      self.emit('_wsTimeout', {});
      if (self.ws) {
        self.ws.onclose = null;
        self.ws.close();
        self.ws = null;
      }
      self.scheduleReconnect();
    }
  }, 10000);

  try {
    self.ws = new WebSocket(wsUrl);
  } catch (e) {
    clearTimeout(self.connectTimeout);
    self.scheduleReconnect();
    return;
  }

  self.ws.onopen = function() {
    clearTimeout(self.connectTimeout);
    self.connected = true;
    self._connectionState = 'connected';
    self.emit('_connectionStateChange', { state: 'connected' });
    self.reconnectAttempts = 0;
    self.startHeartbeat();
    self.emit('_wsOpen', {});
    self._sendConnectMessage();
    self._flushOfflineQueue();
  };

  self.ws.onmessage = function(event) {
    try {
      var data = JSON.parse(event.data);
      if (data.type === 'connected') {
        self.authenticated = true;
        self._lastConnectedData = data;
      }
      if (data.type === 'pong') {
        self._lastPongReceived = true;
        return;
      }
      if (data.type) {
        self.emit(data.type, data);
      }
      self.emit('_message', data);
    } catch (e) {}
  };

  self.ws.onclose = function() {
    clearTimeout(self.connectTimeout);
    self.connected = false;
    self._connectionState = 'disconnected';
    self.emit('_connectionStateChange', { state: 'disconnected' });
    self.authenticated = false;
    self.stopHeartbeat();
    self.emit('_wsClose', {});
    // 若已超过最大重试次数，切换到 polling
    if (self.reconnectAttempts >= self.maxReconnectAttempts) {
      console.warn('[WS] Max reconnect attempts reached, switching to HTTP polling');
      self._switchToPolling();
    } else {
      self.scheduleReconnect();
    }
  };

  self.ws.onerror = function() {
    clearTimeout(self.connectTimeout);
    self.emit('_wsError', {});
  };
};

WebSocketManager.prototype.disconnect = function() {
  this.stopHeartbeat();
  if (this.connectTimeout) {
    clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
  }
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  this._intentionalDisconnect = true;
  if (this.ws) {
    this.ws.onclose = null;
    this.ws.close();
    this.ws = null;
  }
  this._stopPolling();
  this.connected = false;
  this.authenticated = false;
};

WebSocketManager.prototype.send = function(data) {
  // WS 模式优先
  if (this._transport === 'ws' && this.ws && this.ws.readyState === WebSocket.OPEN) {
    var payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.ws.send(payload);
    return;
  }
  // Poll 模式：通过 HTTP 发送
  if (this._transport === 'poll') {
    this._sendViaHttp(data);
    return;
  }
  // WS 暂未就绪，入队
  if (this._offlineQueue.length < this._maxOfflineQueue) {
    this._offlineQueue.push(data);
  }
};

WebSocketManager.prototype._flushOfflineQueue = function() {
  while (this._offlineQueue.length > 0) {
    var data = this._offlineQueue.shift();
    this.send(data);
  }
};

WebSocketManager.prototype.getConnectionState = function() {
  return this._connectionState;
};

WebSocketManager.prototype.on = function(event, callback) {
  if (!this.listeners[event]) {
    this.listeners[event] = [];
  }
  this.listeners[event].push(callback);
};

WebSocketManager.prototype.off = function(event, callback) {
  if (!this.listeners[event]) return;
  if (!callback) {
    this.listeners[event] = [];
    return;
  }
  var idx = this.listeners[event].indexOf(callback);
  if (idx > -1) {
    this.listeners[event].splice(idx, 1);
  }
};

WebSocketManager.prototype.emit = function(event, data) {
  if (!this.listeners[event]) return;
  for (var i = 0; i < this.listeners[event].length; i++) {
    try {
      this.listeners[event][i](data);
    } catch (e) {}
  }
};

WebSocketManager.prototype.startHeartbeat = function() {
  var self = this;
  self.stopHeartbeat();
  self._lastPongReceived = true;
  self.heartbeatTimer = setInterval(function() {
    if (self.ws && self.ws.readyState === WebSocket.OPEN) {
      if (!self._lastPongReceived) {
        console.warn('WebSocket heartbeat: no pong received, reconnecting');
        self.ws.onclose = null;
        self.ws.close();
        self.ws = null;
        self.connected = false;
        self.authenticated = false;
        self.stopHeartbeat();
        self.scheduleReconnect();
        return;
      }
      self._lastPongReceived = false;
      self.send({ type: 'ping' });
    }
  }, self.heartbeatInterval);
};

WebSocketManager.prototype.stopHeartbeat = function() {
  if (this.heartbeatTimer) {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
};

WebSocketManager.prototype.scheduleReconnect = function() {
  var self = this;
  if (self._intentionalDisconnect || self.reconnectAttempts >= self.maxReconnectAttempts) {
    // 超过最大重试次数，切换到 polling
    if (self._wsSupported && self._transport === 'ws') {
      console.warn('[WS] Max reconnect attempts reached, switching to HTTP polling');
      self._switchToPolling();
    }
    return;
  }
  self.reconnectAttempts++;
  self._connectionState = 'reconnecting';
  self.emit('_connectionStateChange', { state: 'reconnecting', attempt: self.reconnectAttempts });
  var delay = self.reconnectDelay * Math.min(self.reconnectAttempts, 5);
  self.reconnectTimer = setTimeout(function() {
    self.connect();
  }, delay);
};

WebSocketManager.prototype._sendConnectMessage = function() {
  var token = localStorage.getItem('token') || '';
  var userStr = localStorage.getItem('user') || 'null';
  var user = null;
  try { user = JSON.parse(userStr); } catch (e) {}
  if (token && user && user.user_id) {
    this.send({
      type: 'connect',
      user_id: user.user_id,
      token: token
    });
  }
};

WebSocketManager.prototype.getLastConnectedData = function() {
  return this._lastConnectedData;
};

WebSocketManager.prototype.isReady = function() {
  return this.connected && this.authenticated;
};

WebSocketManager.prototype.ensureConnected = function() {
  if (this.connected) return;
  var token = localStorage.getItem('token');
  if (token) {
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = window.location.hostname;
    var wsPort = window.__WS_PORT__ || (window.location.protocol === 'https:' ? '443' : '10001');
    this.connect(protocol + '//' + host + ':' + wsPort + '/ws');
  }
};

// ===== HTTP 长轮询回退 =====

WebSocketManager.prototype._switchToPolling = function() {
  if (this._transport === 'poll') return;
  this._transport = 'poll';
  // 清理 WS 残留
  if (this.ws) {
    try { this.ws.onclose = null; this.ws.close(); } catch (e) {}
    this.ws = null;
  }
  this.stopHeartbeat();
  this.connected = false;
  this.authenticated = false;
  this._startPolling();
};

WebSocketManager.prototype._getPollHeaders = function() {
  var token = localStorage.getItem('token') || '';
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? ('Bearer ' + token) : ''
  };
};

WebSocketManager.prototype._startPolling = function() {
  var self = this;
  if (self._pollTimer || self._pollInFlight) return;
  self._pollStopped = false;
  self._pollRetryDelay = 1000; // 重置指数退避延迟
  self._connectionState = 'connecting';
  self.emit('_connectionStateChange', { state: 'connecting', transport: 'poll' });

  // 1. 注册 poller
  fetch('/api/chat/poll/register', {
    method: 'POST',
    headers: self._getPollHeaders(),
    credentials: 'same-origin',
    body: JSON.stringify({})
  }).then(function(response) {
    if (!response.ok) throw new Error('register failed: ' + response.status);
    return response.json();
  }).then(function(result) {
    if (!result || result.code !== 200 || !result.data) {
      throw new Error('register invalid response');
    }
    var data = result.data;
    self._pollLastTs = data.server_time || Date.now();
    self._lastConnectedData = data;
    self.authenticated = true;
    self.connected = true;
    self._connectionState = 'connected';
    self.emit('_connectionStateChange', { state: 'connected', transport: 'poll' });
    // 模拟 WS connected 消息
    self.emit('connected', data);
    self.emit('_message', data);
    // 刷新离线队列
    self._flushOfflineQueue();
    // 2. 启动长轮询循环
    self._schedulePoll();
  }).catch(function(err) {
    console.error('[Poll] Register failed:', err.message);
    self.connected = false;
    self.authenticated = false;
    self._connectionState = 'disconnected';
    self.emit('_connectionStateChange', { state: 'disconnected', transport: 'poll', error: err.message });
    // 指数退避重试，最大 30s
    self._pollRetryDelay = Math.min(self._pollRetryDelay * 2, 30000);
    self._pollTimer = setTimeout(function() {
      self._pollTimer = null;
      self._startPolling();
    }, self._pollRetryDelay);
  });
};

WebSocketManager.prototype._schedulePoll = function() {
  var self = this;
  if (self._pollStopped) return;
  if (self._pollTimer) return;
  self._pollTimer = setTimeout(function() {
    self._pollTimer = null;
    self._doPoll();
  }, 100);
};

WebSocketManager.prototype._doPoll = function() {
  var self = this;
  if (self._pollStopped) return;
  if (self._pollInFlight) {
    // 上一次 poll 还在进行，等待后重新调度
    self._pollTimer = setTimeout(function() {
      self._pollTimer = null;
      self._schedulePoll();
    }, 1000);
    return;
  }
  self._pollInFlight = true;
  var url = '/api/chat/poll?since=' + encodeURIComponent(self._pollLastTs);
  fetch(url, {
    method: 'GET',
    headers: self._getPollHeaders(),
    credentials: 'same-origin'
  }).then(function(response) {
    if (!response.ok) throw new Error('poll failed: ' + response.status);
    return response.json();
  }).then(function(result) {
    if (!result || result.code !== 200 || !result.data) {
      throw new Error('poll invalid response');
    }
    var events = result.data.events || [];
    for (var i = 0; i < events.length; i++) {
      var evt = events[i];
      if (evt.ts && evt.ts > self._pollLastTs) {
        self._pollLastTs = evt.ts;
      }
      if (evt.event) {
        if (evt.event.type) {
          self.emit(evt.event.type, evt.event);
        }
        self.emit('_message', evt.event);
      }
    }
    // 更新 server_time 作为下次 since
    if (result.data.server_time && result.data.server_time > self._pollLastTs) {
      self._pollLastTs = result.data.server_time;
    }
    self._pollInFlight = false;
    // 成功后重置重试延迟
    self._pollRetryDelay = 1000;
    // 短间隔继续 poll
    self._schedulePoll();
  }).catch(function(err) {
    console.error('[Poll] Fetch error:', err.message);
    self._pollInFlight = false;
    // 指数退避：每次失败翻倍延迟，最大 30s
    var delay = self._pollRetryDelay;
    self._pollRetryDelay = Math.min(self._pollRetryDelay * 2, 30000);
    self._pollTimer = setTimeout(function() {
      self._pollTimer = null;
      self._schedulePoll();
    }, delay);
  });
};

WebSocketManager.prototype._stopPolling = function() {
  this._pollStopped = true;
  if (this._pollTimer) {
    clearTimeout(this._pollTimer);
    this._pollTimer = null;
  }
  // 注销 poller（异步，忽略错误）
  try {
    fetch('/api/chat/poll/unregister', {
      method: 'POST',
      headers: this._getPollHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({})
    }).catch(function() {});
  } catch (e) {}
};

WebSocketManager.prototype._sendViaHttp = function(data) {
  var self = this;
  var payload = typeof data === 'string' ? data : JSON.stringify(data);
  var body;
  try { body = JSON.parse(payload); } catch (e) { body = { type: 'text', content: payload }; }
  fetch('/api/chat/poll/send', {
    method: 'POST',
    headers: self._getPollHeaders(),
    credentials: 'same-origin',
    body: JSON.stringify(body)
  }).then(function(response) {
    if (!response.ok) throw new Error('send failed: ' + response.status);
    return response.json();
  }).then(function(result) {
    if (!result || result.code !== 200 || !result.data) return;
    var responses = result.data.responses || [];
    for (var i = 0; i < responses.length; i++) {
      var evt = responses[i];
      if (evt && evt.type) {
        self.emit(evt.type, evt);
      }
      self.emit('_message', evt);
    }
  }).catch(function(err) {
    console.error('[Poll] Send error:', err.message);
    // 发送失败入队，等待重试
    if (self._offlineQueue.length < self._maxOfflineQueue) {
      self._offlineQueue.push(data);
    }
  });
};

var instance = new WebSocketManager();

var autoConnect = function() {
  var token = localStorage.getItem('token');
  if (token && !instance.connected) {
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = window.location.hostname;
    var wsPort = window.__WS_PORT__ || (window.location.protocol === 'https:' ? '443' : '10001');
    instance.connect(protocol + '//' + host + ':' + wsPort + '/ws');
  }
};

if (typeof window !== 'undefined') {
  if (document.readyState === 'complete') {
    setTimeout(autoConnect, 100);
  } else {
    window.addEventListener('load', function() {
      setTimeout(autoConnect, 100);
    });
  }
}

export default instance;
export { autoConnect };
