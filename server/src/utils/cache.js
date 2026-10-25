// 进程内缓存（带容量上限 + LRU 淘汰 + 命中率统计）
//
// ⚠️ 历史问题：原实现只有 TTL，**没有容量上限**。
//    每来一个不同的 key 就往对象里塞一个槽位，永不淘汰 ——
//    一旦有人用它缓存「按 userId / IP / 文件名」拼出来的高基数 key，
//    内存会一直涨到进程 OOM，而且从外部完全看不出来（没有命中率、没有大小）。
//    在单机 SQLite 的部署形态下，这种「静默增长」比崩溃更难查。
//
// 现在的语义：
//   - max：最多保留多少个 key，超出按 LRU（最久未使用）淘汰
//   - ttl：每个 key 的存活时间，get 时惰性判断（不用后台定时器扫）
//   - stats()：暴露 hits / misses / size / evictions，便于排查「缓存到底有没有用」
//
// 用法：
//   var cache = require('../utils/cache');                        // 默认实例 max=500 / ttl=60s
//   cache.set('k', v, 30000); cache.get('k'); cache.clear();
//   var scoped = require('../utils/cache').create({ max: 2000 });  // 独立实例，互不干扰
//
// 刻意不做的事：
//   - 不引入依赖（redis / lru-cache）。单机单进程，一把 Map 就是最优解。
//   - 不做后台定时清理。惰性过期够用，定时器只会带来「忘记 unref 导致进程不退出」的新坑。

var DEFAULTS = { max: 500, ttl: 60000 };

function createCache(options) {
  var opts = options || {};
  var max = (typeof opts.max === 'number' && opts.max > 0) ? opts.max : DEFAULTS.max;
  var defaultTtl = (typeof opts.ttl === 'number' && opts.ttl > 0) ? opts.ttl : DEFAULTS.ttl;

  // Map 的迭代顺序 = 插入顺序；delete + set 即「移到队尾」，天然 LRU
  var store = new Map();
  var hits = 0, misses = 0, evictions = 0, expirations = 0;

  function expired(item) {
    return item.exp > 0 && Date.now() >= item.exp;
  }

  function get(key) {
    var item = store.get(key);
    if (!item) { misses++; return null; }
    if (expired(item)) {
      store.delete(key);
      expirations++;
      misses++;
      return null;
    }
    store.delete(key);        // 命中后移到队尾（最近使用）
    store.set(key, item);
    hits++;
    return item.data;
  }

  function set(key, data, ttl) {
    var ms = (typeof ttl === 'number' && ttl > 0) ? ttl : defaultTtl;
    if (store.has(key)) store.delete(key);
    store.set(key, { data: data, exp: ms > 0 ? Date.now() + ms : 0 });
    // 容量控制：插入后判断，淘汰最久未使用的（队首）
    while (store.size > max) {
      var oldest = store.keys().next();
      if (oldest.done) break;
      store.delete(oldest.value);
      evictions++;
    }
    return data;
  }

  function del(key) { return store.delete(key); }

  function clear(key) {
    if (typeof key !== 'undefined') { store.delete(key); return; }
    store.clear();
    hits = misses = evictions = expirations = 0;
  }

  function has(key) {
    var item = store.get(key);
    if (!item) return false;
    if (expired(item)) {
      store.delete(key);
      expirations++;
      return false;
    }
    return true;
  }

  function stats() {
    var total = hits + misses;
    return {
      size: store.size,
      max: max,
      hits: hits,
      misses: misses,
      hitRate: total ? +(hits / total).toFixed(4) : 0,
      evictions: evictions,
      expirations: expirations
    };
  }

  return { get: get, set: set, del: del, clear: clear, has: has, stats: stats };
}

// 默认实例：get / set / clear 与旧 API 完全兼容，可直接替换
var defaultCache = createCache(DEFAULTS);
defaultCache.create = createCache;
defaultCache.DEFAULTS = DEFAULTS;

module.exports = defaultCache;
