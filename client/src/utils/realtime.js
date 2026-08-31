// 第三方应用的全局 HTTP 实时事件客户端，不依赖 Chat 应用。
function RealtimeClient() {
  this.listeners = {};
  this.connected = false;
  this.stopped = true;
  this.lastTs = 0;
  this.pollTimer = null;
  this.inFlight = false;
}

RealtimeClient.prototype._headers = function() {
  var token = localStorage.getItem('token') || '';
  return { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' };
};

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

RealtimeClient.prototype.connect = function() {
  var self = this;
  if (!localStorage.getItem('token') || !self.stopped) return;
  self.stopped = false;
  fetch('/api/realtime/poll/register', { method: 'POST', headers: self._headers(), credentials: 'same-origin', body: '{}' })
    .then(function(response) { if (!response.ok) throw new Error('realtime register failed: ' + response.status); return response.json(); })
    .then(function(result) {
      if (!result || result.code !== 200) throw new Error('realtime register invalid response');
      self.connected = true;
      self.lastTs = result.data && result.data.server_time || Date.now();
      self._emit('connected', result.data || {});
      self._poll();
    })
    .catch(function(error) {
      self.connected = false;
      self._emit('error', error);
      if (!self.stopped) self.pollTimer = setTimeout(function() { self.stopped = true; self.connect(); }, 5000);
    });
};

RealtimeClient.prototype._poll = function() {
  var self = this;
  if (self.stopped || self.inFlight) return;
  self.inFlight = true;
  fetch('/api/realtime/poll?since=' + encodeURIComponent(self.lastTs), { method: 'GET', headers: self._headers(), credentials: 'same-origin' })
    .then(function(response) { if (!response.ok) throw new Error('realtime poll failed: ' + response.status); return response.json(); })
    .then(function(result) {
      var events = result.data && result.data.events || [];
      for (var i = 0; i < events.length; i++) {
        var item = events[i];
        if (item.ts > self.lastTs) self.lastTs = item.ts;
        if (item.event && item.event.type) self._emit(item.event.type, item.event, item.event);
      }
      if (result.data && result.data.server_time > self.lastTs) self.lastTs = result.data.server_time;
    })
    .catch(function(error) { self._emit('error', error); })
    .then(function() { self.inFlight = false; if (!self.stopped) self.pollTimer = setTimeout(function() { self._poll(); }, 100); });
};

RealtimeClient.prototype.publish = function(event, payload, appName) {
  return fetch('/api/realtime/publish', { method: 'POST', headers: this._headers(), credentials: 'same-origin', body: JSON.stringify({ event: event, payload: payload, app_name: appName || '' }) })
    .then(function(response) { if (!response.ok) throw new Error('realtime publish failed: ' + response.status); return response.json(); });
};

RealtimeClient.prototype.subscribe = function(event, handler) {
  return this.on('extension_event', function(message) {
    if (message && message.event === event) handler(message.payload, message);
  });
};

RealtimeClient.prototype.disconnect = function() {
  var self = this;
  self.stopped = true;
  self.connected = false;
  if (self.pollTimer) clearTimeout(self.pollTimer);
  self.pollTimer = null;
  fetch('/api/realtime/poll/unregister', { method: 'POST', headers: self._headers(), credentials: 'same-origin', body: '{}' }).catch(function() {});
};

var realtime = new RealtimeClient();
export default realtime;
