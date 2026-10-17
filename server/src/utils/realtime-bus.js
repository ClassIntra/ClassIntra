// 核心级 HTTP 实时事件队列，不依赖 Chat 应用。
var queues = {};
var lastSeen = {};
var QUEUE_MAX = 200;
var QUEUE_TTL = 5 * 60 * 1000;

function register(userId) {
  if (!userId) return;
  queues[userId] = queues[userId] || [];
  lastSeen[userId] = Date.now();
}

function unregister(userId) {
  delete queues[userId];
  delete lastSeen[userId];
}

// 投递钩子：由 WebSocket 服务器注册，发布事件时同步推送到实时通道（如 WS / 长轮询），
// 使第三方应用无需轮询即可经 WebSocket 收到事件。未注册时为 null，行为与旧版一致。
var deliveryHook = null;

function setDeliveryHook(fn) {
  deliveryHook = (typeof fn === 'function') ? fn : null;
}

function deliver(targetIds, event) {
  if (typeof deliveryHook !== 'function') return;
  try { deliveryHook(targetIds, event); } catch (e) {}
}

function publish(event) {
  publishToUsers(Object.keys(queues), event);
}

function publishToUsers(userIds, event) {
  var now = Date.now();
  var ids = Array.isArray(userIds) ? userIds : [];
  for (var i = 0; i < ids.length; i++) {
    if (!queues[ids[i]]) continue;
    queues[ids[i]].push({ ts: now, event: event });
    if (queues[ids[i]].length > QUEUE_MAX) queues[ids[i]].splice(0, queues[ids[i]].length - QUEUE_MAX);
  }
  // 定向投递：让 WS / 长轮询客户端即时收到，无需轮询（不走队列，避免与队列重复投递）。
  if (ids.length > 0) deliver(ids, event);
}

function consume(userId, since) {
  if (!queues[userId]) return [];
  lastSeen[userId] = Date.now();
  var result = queues[userId].filter(function(item) { return item.ts > since; });
  var cutoff = Date.now() - QUEUE_TTL;
  queues[userId] = queues[userId].filter(function(item) { return item.ts >= cutoff; });
  return result;
}

setInterval(function() {
  var now = Date.now();
  Object.keys(lastSeen).forEach(function(userId) {
    if (now - lastSeen[userId] > QUEUE_TTL) unregister(userId);
  });
}, 60000).unref();

module.exports = { register: register, unregister: unregister, publish: publish, publishToUsers: publishToUsers, consume: consume, setDeliveryHook: setDeliveryHook, isRegistered: function(userId) { return !!queues[userId]; } };
