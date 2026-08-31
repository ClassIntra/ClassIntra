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

function publish(event) {
  var now = Date.now();
  var ids = Object.keys(queues);
  for (var i = 0; i < ids.length; i++) {
    queues[ids[i]].push({ ts: now, event: event });
    if (queues[ids[i]].length > QUEUE_MAX) queues[ids[i]].splice(0, queues[ids[i]].length - QUEUE_MAX);
  }
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

module.exports = { register: register, unregister: unregister, publish: publish, consume: consume, isRegistered: function(userId) { return !!queues[userId]; } };
