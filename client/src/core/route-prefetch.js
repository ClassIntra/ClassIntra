// 前端核心：应用路由 chunk 空闲预取
// ============================================================
// 目的：路由是懒加载的（Community 解压后 1.1MB），点开应用那一刻才
// 下载 + 解析 + 求值，是「点应用要等」的主因。本模块在桌面空闲时
// 提前把常用应用的 chunk 拉下来并完成模块求值（ES 模块缓存，二次 import
// 零成本），用户点图标时只剩挂载组件的开销。
//
// 为什么不用 <link rel=prefetch>：预取只解决网络，不解决 Android9/Chrome80
// 上 1.1MB 模块解析求值的几百毫秒；而 import() 在空闲期完成这两步。
//
// 安全阀（不干扰使用）：
//   - 桌面就绪后 2.6s 才启动，且每块之间 900ms 间隔
//   - requestIdleCallback 优先（Chrome 80 支持），无则退化为 setTimeout
//   - saveData / 2G / 页面不可见 → 不启动
//   - 任何一块失败静默跳过（权限/网络问题不影响正常导航）
//   - localStorage.ci_prefetch === 'off' 可全局关闭（排障用）
//
// 编码约定：var / function / 单引号（Chrome 80 基线）

var START_DELAY_MS = 2600;
var STEP_GAP_MS = 900;
var MAX_CHUNKS = 4;

var _started = false;
var _queue = [];
var _index = 0;

function canPrefetch() {
  try {
    if (localStorage.getItem('ci_prefetch') === 'off') return false;
  } catch (e) {}
  try {
    var c = navigator.connection || {};
    if (c.saveData) return false;
    if (c.effectiveType && /^(slow-)?2g$/.test(c.effectiveType)) return false;
  } catch (e) {}
  if (typeof document !== 'undefined' && document.hidden) return false;
  return true;
}

function schedule(fn) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout: 4000 });
  } else {
    setTimeout(fn, 800);
  }
}

// 取路由记录上的懒加载工厂（未加载时为 function）并调用：
// 触发 chunk 下载 + 模块求值；ES 模块缓存保证随后导航不再重复下载。
function warmOne(router, path) {
  var matched;
  try {
    matched = router.match(path);
  } catch (e) {
    return;
  }
  var records = (matched && matched.matched) || [];
  for (var i = 0; i < records.length; i++) {
    var comp = records[i] && records[i].components && records[i].components.default;
    if (typeof comp !== 'function') continue;
    try {
      var p = comp();
      if (p && typeof p.catch === 'function') p.catch(function() {});
    } catch (e) {}
    return;
  }
}

function step(router) {
  if (_index >= _queue.length) return;
  // 中途状态变了就停：页面隐藏/省流模式/已离开桌面（预取只服务「从桌面启动应用」，
  // 用户已进应用时继续拉 chunk 只会和应用自身的请求抢带宽、抢主线程）
  if (!canPrefetch()) return;
  if (typeof location !== 'undefined' && location.pathname !== '/') return;
  var path = _queue[_index++];
  warmOne(router, path);
  if (_index < _queue.length) {
    setTimeout(function() { schedule(function() { step(router); }); }, STEP_GAP_MS);
  }
}

// 启动预取。paths 按优先级排列（前面的先拉）。
export function prefetchRoutes(router, paths) {
  if (_started || !router || !paths || !paths.length) return;
  if (!canPrefetch()) return;
  _started = true;
  _queue = paths.slice(0, MAX_CHUNKS);
  _index = 0;
  setTimeout(function() {
    if (!canPrefetch()) return;
    schedule(function() { step(router); });
  }, START_DELAY_MS);
}

// 诊断用（DevRuntime / 探针）
export function getPrefetchState() {
  return { started: _started, total: _queue.length, done: _index, queue: _queue.slice() };
}

export default { prefetchRoutes: prefetchRoutes, getPrefetchState: getPrefetchState };
