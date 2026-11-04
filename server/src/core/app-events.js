// 应用事件总线（进程内）
// ============================================================
// 解决什么问题：
//   第三方后端想知道「发了新公告 / 有人发帖 / 应用被停用」，此前只能轮询数据库。
//   这里给一个进程内订阅点，插件与应用后端可以直接：
//
//     var bus = require(path.resolve(process.cwd(), 'src/core/app-events'));
//     bus.on('announcement.published', function (payload) { ... }, 'my-app');
//
//   第三个参数是归属（owner）：卸载应用时按 owner 整批退订，避免回调指向已删除的代码。
//
// 与出站 Webhook 的分工：
//   app-events  → 进程内（插件/应用后端自己消费，零延迟）
//   outbound    → 进程外（班级门户/大屏，HTTP + 签名）
//
// 约定：
//   - emit 同步执行，单个订阅者抛错不影响其他订阅者
//   - 不做事件持久化（要可靠送达请用 outbound webhook + 接收端幂等）
//
// 编码约定：var / function。

var listeners = {}; // event → [{ owner, fn }]
var MAX_LISTENERS_PER_EVENT = 50;

function on(event, fn, owner) {
  if (!event || typeof fn !== 'function') return function () {};
  var list = listeners[event] || (listeners[event] = []);
  if (list.length >= MAX_LISTENERS_PER_EVENT) {
    console.warn('[app-events] 订阅者过多，已忽略: ' + event);
    return function () {};
  }
  var entry = { owner: String(owner || ''), fn: fn };
  list.push(entry);
  return function off() {
    var idx = list.indexOf(entry);
    if (idx !== -1) list.splice(idx, 1);
  };
}

function off(event, fn) {
  var list = listeners[event];
  if (!list) return 0;
  var before = list.length;
  listeners[event] = list.filter(function (e) { return e.fn !== fn; });
  return before - listeners[event].length;
}

// 按归属整批退订（应用卸载 / 插件暂停时调用）
function offOwner(owner) {
  var target = String(owner || '');
  var removed = 0;
  Object.keys(listeners).forEach(function (event) {
    var list = listeners[event];
    var kept = list.filter(function (e) {
      if (e.owner === target) { removed++; return false; }
      return true;
    });
    if (kept.length) listeners[event] = kept;
    else delete listeners[event];
  });
  return removed;
}

function emit(event, payload) {
  var list = listeners[event];
  if (!list || !list.length) return 0;
  var snapshot = list.slice();
  var delivered = 0;
  for (var i = 0; i < snapshot.length; i++) {
    try {
      snapshot[i].fn(payload || {});
      delivered++;
    } catch (e) {
      try {
        console.warn('[app-events] 订阅者执行失败 ' + event + ' (owner=' + snapshot[i].owner + '): ' + (e && e.message));
      } catch (_) {}
    }
  }
  return delivered;
}

// 诊断：谁在监听什么（管理端/探针排障用）
function stats() {
  var out = {};
  Object.keys(listeners).forEach(function (event) {
    out[event] = listeners[event].map(function (e) { return e.owner || '(anonymous)'; });
  });
  return out;
}

module.exports = {
  on: on,
  off: off,
  offOwner: offOwner,
  emit: emit,
  stats: stats
};
