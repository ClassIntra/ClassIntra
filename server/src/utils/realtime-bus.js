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
  leaveAllChannels(userId);
}

// ============================================================
// 频道（channel）—— 第三方应用的多人体/房间场景
// ============================================================
// 背景：publish() 是「广播给所有在线用户」，一个联机应用如果真的按帧广播，
// 全平台每个人的 WS 都会收到与自己无关的位移数据。频道把在线用户按房间分组，
// 事件只投给同频道成员。
//
// 设计取舍：
//   - 频道只活在内存里。进程重启后客户端重新 join 即可（join 幂等），
//     没有持久化负担，也不会因为应用卸载留下幽灵房间。
//   - 命名必须带应用前缀 `app:<appName>:<room>`，由路由层校验应用是否启用，
//     防止 A 应用的用户混进 B 应用的频道偷事件。
//   - members 用 Set：加入/退出 O(1)，几十人的房间足够。
var channels = {};
var CHANNEL_LIMIT = 64;          // 单进程频道数上限：脚本刷内存的兜底
var CHANNEL_MEMBER_LIMIT = 300;  // 单频道成员上限：一个班不会超过这个数

function ensureChannel(channel, appName) {
  var entry = channels[channel];
  if (entry) {
    entry.updatedAt = Date.now();
    return entry;
  }
  // 上限保护：拒绝新频道而不是无限增长
  if (Object.keys(channels).length >= CHANNEL_LIMIT) return null;
  entry = channels[channel] = {
    members: new Set(),
    app: appName || '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  return entry;
}

function joinChannel(userId, channel, appName) {
  if (!userId || !channel) return false;
  var entry = ensureChannel(channel, appName);
  if (!entry) return false;
  var id = String(userId);
  if (!entry.members.has(id) && entry.members.size >= CHANNEL_MEMBER_LIMIT) return false;
  entry.members.add(id);
  // 保证长轮询兜底的队列存在：WS 客户端本来就 register，HTTP 客户端也需要
  register(userId);
  return true;
}

function leaveChannel(userId, channel) {
  var entry = channels[channel];
  if (!entry) return false;
  entry.members.delete(String(userId));
  if (!entry.members.size) delete channels[channel];
  return true;
}

function leaveAllChannels(userId) {
  var id = String(userId);
  Object.keys(channels).forEach(function (name) {
    var entry = channels[name];
    if (!entry) return;
    entry.members.delete(id);
    if (!entry.members.size) delete channels[name];
  });
}

function channelMembers(channel) {
  var entry = channels[channel];
  if (!entry) return [];
  var out = [];
  entry.members.forEach(function (uid) { out.push(uid); });
  return out;
}

// 只投给频道成员。复用 publishToUsers：队列（长轮询）+ deliveryHook（WS）双通道。
function publishToChannel(channel, event) {
  var entry = channels[channel];
  if (!entry || !entry.members.size) return 0;
  var ids = channelMembers(channel);
  publishToUsers(ids, event);
  return ids.length;
}

function channelStats() {
  var list = [];
  Object.keys(channels).forEach(function (name) {
    list.push({ channel: name, app: channels[name].app, members: channels[name].members.size });
  });
  return list;
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

module.exports = {
  register: register,
  unregister: unregister,
  publish: publish,
  publishToUsers: publishToUsers,
  consume: consume,
  setDeliveryHook: setDeliveryHook,
  isRegistered: function(userId) { return !!queues[userId]; },
  // 频道能力（第三方应用的多人体/房间场景）
  joinChannel: joinChannel,
  leaveChannel: leaveChannel,
  leaveAllChannels: leaveAllChannels,
  channelMembers: channelMembers,
  publishToChannel: publishToChannel,
  channelStats: channelStats
};
