// 头像数据仓库：按 userId 批量拉取「云盘头像 hash + 裁切参数」并缓存
//
// 为什么要有这一层：社区帖子流/群成员列表一屏几十个头像，如果每个 UserAvatar
// 自己发一次请求，弱网平板上会瞬间打出几十并发。这里把请求**合并成一个批量的**，
// 并按 userId 缓存，重复渲染零请求。
//
// 失效策略：TTL 5 分钟 + 手动 invalidate()（用户在设置里改了头像后调用）。
// 不做 WebSocket 推送 —— 头像是低频变更数据，为它养一条长连接不值当。
//
// ⚠️ 2026-10-23 重写合并逻辑（修「头像有时不显示」）：
//   旧实现有个竞态：请求一旦发出，之后才来的 id 只被 push 进 inflightIds 数组，
//   而请求参数在发出时就已经快照好了 —— 这批后到的 id 永远不会被真正查询，
//   还因为"看起来在飞"而被后续调用反复跳过，于是它们的头像永远是空的。
//   现在改成「排队 + 微任务合并 + 串行链」：
//     · 同一次渲染（同一个 tick）内所有组件的 id 会先排进队列；
//     · 微任务里把队列一次性取走发一个请求（一屏 50 个头像也只有 1 次网络）；
//     · 请求期间新来的 id 排到下一批，通过 chain 串行执行，不会丢。
//
// ⚠️ 另一个配套前提：cache 是模块级普通对象，**不是 Vue 响应式数据**。
//    组件必须自己把 getAvatar() 的结果放进组件 data 才会触发重渲染
//    （见 UserAvatar.vue 的 resolvedAvatar）。
//
// ⚠️ 2026-10-24 批量请求加一次自动重试（修「头像有时加载不出来」）：
//    批量请求偶发失败时组件不会自愈（没有二次 ensureAvatars 的触发点），
//    头像会一直挂在文字兜底上。现在 runBatch 失败后退避 800ms 自动补一次。

import api from './api';

var CACHE_TTL = 5 * 60 * 1000;
var BATCH_MAX = 100;   // 与后端 /api/user/avatar/batch 的 ids 上限一致

var cache = {};        // userId -> { data, at }
var queued = [];       // 已排队但还没发出去的 userId
var inflight = [];     // 当前批次正在请求的 userId
var chain = Promise.resolve();  // 串行执行链：保证一批查完才发下一批
var scheduled = false;          // 是否已排了微任务
var scheduledPromise = null;
var listeners = [];             // 数据到达时的订阅回调（供组件刷新用）

function isFresh(entry) {
  return entry && (Date.now() - entry.at) < CACHE_TTL;
}

function pickMissing(ids) {
  var missing = [];
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i] || '');
    if (!id) continue;
    if (isFresh(cache[id])) continue;
    // 已排队 / 正在请求 的都不再重复排
    if (queued.indexOf(id) !== -1 || inflight.indexOf(id) !== -1) continue;
    if (missing.indexOf(id) === -1) missing.push(id);
  }
  return missing;
}

function notify(uids) {
  for (var i = 0; i < listeners.length; i++) {
    try { listeners[i](uids); } catch (e) { /* 单个订阅者出错不拖垮别人 */ }
  }
}

function runBatch(ids, attempt) {
  inflight = ids.slice();
  var wanted = ids.slice();
  var tryNum = attempt || 0;
  return api.get('/user/avatar/batch', { params: { ids: wanted.join(',') } })
    .then(function(res) {
      var avatars = (res.data && res.data.data && res.data.data.avatars) || {};
      var now = Date.now();
      Object.keys(avatars).forEach(function(uid) {
        cache[uid] = { data: avatars[uid], at: now };
      });
      // 请求过但服务端没返回的（没设头像）也按空值缓存，避免反复查同一个人
      wanted.forEach(function(uid) {
        if (!cache[uid]) cache[uid] = { data: { has_avatar: false, hash: '', crop: null }, at: now };
      });
    })
    .catch(function() {
      // 失败不写缓存：下次渲染会重试，但也不让页面卡住
      wanted.forEach(function(uid) { delete cache[uid]; });
      // ⚠️ 但不能就这样放手：批量请求偶发失败（弱网平板上一次 ConnectionReset）
      // 时，页面上已挂载的 UserAvatar 拿不到数据、也不会再发起请求，头像就一直
      // 是文字兜底，直到用户碰巧重载或重进页面 —— 这就是「头像有时加载不出来」
      // 的前端可修部分（img 侧已有 &r=1 重试，批量侧原来是空白）。
      // 自动补一次（退避 800ms）：inflight 仍占着这批 id，期间不会重复发。
      if (tryNum < 1) {
        return new Promise(function(r) { setTimeout(r, 800); }).then(function() {
          return runBatch(wanted, tryNum + 1);
        });
      }
    })
    .then(function() {
      inflight = [];
      notify(wanted);
    });
}

function flush() {
  if (!queued.length) return Promise.resolve();
  var batch = queued.slice(0, BATCH_MAX);
  queued = queued.slice(BATCH_MAX);
  return runBatch(batch).then(function() {
    // 队列里还有（超过 BATCH_MAX 的大群）：继续发，不能让剩下的 id
    // 干等到下一次 ensureAvatars 调用——那种"群里第 101 个人没头像"的 bug
    // 就是这么来的。
    return flush();
  });
}

// 确保这批 userId 的头像数据已加载；返回的 Promise 在这一批查完后 resolve
export function ensureAvatars(ids) {
  var missing = pickMissing(ids);
  if (missing.length === 0) return Promise.resolve();
  queued = queued.concat(missing);

  if (scheduled) return scheduledPromise;

  scheduled = true;
  // 微任务：等同一个 tick 内所有组件都把 id 排进来之后再发，合并成一次请求
  scheduledPromise = chain = chain.then(function() {
    scheduled = false;
    return flush();
  });
  return scheduledPromise;
}

// 订阅「某批头像数据到达」。返回取消订阅函数。
// 用途：已经挂在页面上的 UserAvatar，在数据晚到时能再刷一次（而不是靠 computed 碰运气）
export function onAvatarsUpdated(fn) {
  listeners.push(fn);
  return function() {
    var i = listeners.indexOf(fn);
    if (i !== -1) listeners.splice(i, 1);
  };
}

export function getAvatar(userId) {
  var entry = cache[String(userId || '')];
  return entry ? entry.data : null;
}

// 直接把已知的头像数据写进缓存（overview 已带回作者头像时免一次批量请求）。
// map: { userId: { has_avatar, hash, crop } }；非法条目直接跳过。
export function seedAvatars(map) {
  if (!map) return;
  var keys = Object.keys(map);
  var touched = [];
  for (var i = 0; i < keys.length; i++) {
    var uid = String(keys[i]);
    var v = map[keys[i]];
    if (!v || typeof v !== 'object' || !v.hash) continue;
    cache[uid] = { data: v, at: Date.now() };
    touched.push(uid);
  }
  if (touched.length) notify(touched);
}

export function invalidate(userId) {
  var affected = [];
  if (userId) {
    var uid = String(userId);
    affected.push(uid);
    delete cache[uid];
  } else {
    affected = Object.keys(cache);
    cache = {};
  }
  // 只清缓存不够：已经挂在页面上的 UserAvatar 手里还攥着旧数据（resolvedAvatar），
  // 用户在设置里换完头像回到聊天，看到的还是旧的那张。通知订阅者重新拉一次。
  notify(affected);
}

// 重新拉取某些 userId（invalidate 后由组件回调触发）
export function refreshAvatars(ids) {
  ensureAvatars(ids);
}

// 按显示尺寸挑合适的云盘缩放档位（后端 sharp 实时缩放，任何档位都支持）：
//   小头像（≤80px，列表/评论/群成员）用 ?w=128 —— 2x 屏也够，单张 ~3-5KB
//   中头像（81~160px，主页/「我的」骑跨头像）用 ?w=256 —— 保真与体积的平衡点
//   大头像（>160px，灯箱放大）用 ?w=512 —— 原图级保真
// 档位宁细勿粗：主页 96px 头像用 512 会白拉 30-60KB，弱网下差距明显
export function pickUrl(avatar, size) {
  if (!avatar || !avatar.has_avatar || !avatar.hash) return '';
  var w = 128;
  if ((size || 40) > 160) w = 512;
  else if ((size || 40) > 80) w = 256;
  return '/api/cloud/files/' + avatar.hash + '?w=' + w;
}
