/**
 * app-navbar-store.js - 第三方应用 → 宿主导航栏 的动作注册表
 *
 * 为什么需要它：
 *   AppShell 的 AppNavBar 一直留有右侧 actions 插槽，但 MarketRuntime 没接——
 *   应用就算启用系统导航栏（manifest.layout.navbar 不设 'custom'），右侧也放不了
 *   自己的按钮。于是棋类等应用被迫 navbar:'custom' 自绘一整套标题栏（返回+标题+
 *   状态+操作），重复实现、样式各搞各的，还多吃一行高度 —— 这就是「空间浪费」。
 *
 * 设计：
 *   - 模块级单例 + 显式订阅（ES5、无响应式依赖），MarketRuntime 订阅后把状态
 *     复制进自己的 data，走 Vue 响应式渲染。
 *   - 按 appName 隔离：应用切换/卸载时由 MarketRuntime 调 clear()，
 *     防止 A 应用注册的按钮漏进 B 应用的导航栏。
 *   - 应用侧入口是 SDK 的 context.ui.hostNavbar（见 market-sdk.js），
 *     本模块不直接暴露给应用。
 *
 * 编码约定：var/function、单引号、2 空格（Chrome 80 兼容基线）。
 */

var _state = {
  appName: '',      // 当前注册归属（用于切换应用时整批失效）
  title: '',        // 应用覆盖的导航栏标题（空串 = 用 manifest.label）
  statusEl: null,   // 应用注入导航栏中轴的状态段节点（如棋类的「轮到黑方 · 房 1234 · 红方」）
  actions: []       // [{ id, label, icon, variant, disabled, onClick }]
};

var _listeners = [];

function _notify() {
  var snapshot = get();
  for (var i = 0; i < _listeners.length; i++) {
    try { _listeners[i](snapshot); } catch (e) { /* 订阅方异常不影响其他订阅者 */ }
  }
}

function _sanitizeAction(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  // element 型：直接挂载应用已有的 DOM 节点（如棋类现成的按钮组/连接灯）。
  // 好处：应用侧的显隐/禁用/忙碌锁逻辑照常作用于原节点，render 零改动，
  // 节点被搬进宿主导航栏后样式仍走应用自己的全局 CSS。
  if (raw.element && raw.element.nodeType === 1) {
    return {
      id: String(raw.id || 'el-' + index),
      element: raw.element
    };
  }
  var item = {
    id: String(raw.id || 'act-' + index),
    label: String(raw.label || ''),
    icon: raw.icon ? String(raw.icon) : '',
    variant: raw.variant === 'danger' ? 'danger' : raw.variant === 'tinted' ? 'tinted' : 'plain',
    disabled: !!raw.disabled
  };
  if (typeof raw.onClick === 'function') item.onClick = raw.onClick;
  return item;
}

// 应用覆盖导航栏标题；空串表示交还给 manifest.label
function setTitle(appName, title) {
  if (_state.appName && _state.appName !== appName) return; // 非活跃应用不得越权
  var next = String(title || '');
  // 同值短路：render 是热路径（棋类每次点击都会刷新标题），不短路会白跑一轮订阅回调
  if (_state.appName === appName && _state.title === next && _state.title !== '') return;
  _state.appName = appName;
  _state.title = next;
  _notify();
}

// 应用把状态段（DOM 节点）注入导航栏中轴：紧跟标题右侧的灰色小字，
// 形态如「轮到黑方 · 房 1234 · 红方」。传 null/非法值 = 交还（节点留在应用页内）。
function setStatus(appName, element) {
  if (_state.appName && _state.appName !== appName) return;
  _state.appName = appName;
  _state.statusEl = (element && element.nodeType === 1) ? element : null;
  _notify();
}

// 全量替换右侧动作。数组元素：{ id, label, icon, variant, disabled, onClick }
function setActions(appName, actions) {
  if (_state.appName && _state.appName !== appName) return;
  _state.appName = appName;
  var list = [];
  var raw = Array.isArray(actions) ? actions : [];
  for (var i = 0; i < raw.length && i < 6; i++) {   // 右侧最多 6 个，防溢出
    var item = _sanitizeAction(raw[i], i);
    if (item) list.push(item);
  }
  _state.actions = list;
  _notify();
}

// 应用卸载/切换时清理。传 appName 时只清自己的；不带参全清（兜底）。
function clear(appName) {
  if (appName && _state.appName && _state.appName !== appName) return;
  _state.appName = '';
  _state.title = '';
  _state.statusEl = null;
  _state.actions = [];
  _notify();
}

function get() {
  return {
    appName: _state.appName,
    title: _state.title,
    statusEl: _state.statusEl,
    actions: _state.actions.slice()
  };
}

function subscribe(fn) {
  if (typeof fn !== 'function') return function() {};
  _listeners.push(fn);
  return function() {
    var idx = _listeners.indexOf(fn);
    if (idx > -1) _listeners.splice(idx, 1);
  };
}

export {
  setTitle,
  setStatus,
  setActions,
  clear,
  get,
  subscribe
};
