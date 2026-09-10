// 前端核心：PerfPolicy 性能策略
//
// 设计目标（docs/ecosystem-design.md §5.5.3）：
//   把「德芙般流畅」变成可自动执行的策略——设备能力不足或滚动期间，
//   自动把 backdrop-filter 毛玻璃降级为半透明纯色，保留视觉近似，不改变布局。
//
// 三层降级（对应 §5.5.3）：
//   第 1 层：设备能力探测 → [data-perf="low"]
//   第 2 层：滚动状态感知 → [data-scrolling="1"]
//   第 3 层：用户显式开关 → 复用 [data-no-motion="true"]
//
// 设计要点：
// 1. 全部通过 documentElement 上的 data-* 属性驱动，纯 CSS 响应，零 DOM 遍历
// 2. 滚动监听使用 passive: true + rAF 节流，避免阻塞主线程
// 3. 单例模式 getPerfPolicy()，与 theme-engine 保持一致的风格
// 4. 不做破坏性操作：只加/删属性，所有样式降级由 CSS 声明

// 低端设备判定阈值
var LOW_MEMORY_GB = 4;      // deviceMemory 低于此值视为低端
var LOW_CORES = 4;          // hardwareConcurrency 低于此值视为低端
var SCROLL_IDLE_MS = 120;   // 滚动停止后多久恢复毛玻璃

// X5 / TBS 内核特征（腾讯 X5 在部分低端机上毛玻璃代价显著）
var X5_UA_PATTERN = /MQQBrowser|TBS|XWEB/i;

function PerfPolicy() {
  this._initialized = false;
  this._scrollTimer = null;
  this._rafId = null;
  this._isScrolling = false;
  this._perfLevel = 'high';  // 'high' | 'low'
  this._listeners = [];      // 等级变化订阅者
  this._scrollHandler = null;
  this._eventBus = null;     // 由 init(options) 注入
  this._reasons = [];
}

// 探测设备能力，返回 'high' | 'low'
PerfPolicy.prototype._detectLevel = function() {
  if (typeof navigator === 'undefined') return 'high';

  var reasons = [];

  // 1. 内存（Chrome 63+ 支持 deviceMemory）
  var mem = navigator.deviceMemory;
  if (typeof mem === 'number' && mem > 0 && mem < LOW_MEMORY_GB) {
    reasons.push('deviceMemory=' + mem + 'GB');
  }

  // 2. CPU 核心数
  var cores = navigator.hardwareConcurrency;
  if (typeof cores === 'number' && cores > 0 && cores < LOW_CORES) {
    reasons.push('hardwareConcurrency=' + cores);
  }

  // 3. UA 特征（X5/TBS 单独标记，供 CSS 可选使用）
  var ua = navigator.userAgent || '';
  if (X5_UA_PATTERN.test(ua)) {
    document.documentElement.setAttribute('data-engine', 'x5');
  }

  // 4. 用户显式节省数据模式（设备可能处于低电量策略）
  if (navigator.connection && navigator.connection.saveData === true) {
    reasons.push('saveData=on');
  }

  this._reasons = reasons;
  return reasons.length > 0 ? 'low' : 'high';
};

// 初始化：探测设备 + 挂载滚动监听
// options.eventBus：可选，传入则监听动效开关变化（由 main.js 装配时注入）
PerfPolicy.prototype.init = function(options) {
  if (this._initialized) return this;
  if (typeof document === 'undefined') return this;
  this._initialized = true;

  var root = document.documentElement;
  var self = this;
  var opts = options || {};
  this._eventBus = opts.eventBus || null;

  // --- 第 1 层：设备能力 ---
  this._perfLevel = this._detectLevel();
  if (this._perfLevel === 'low') {
    root.setAttribute('data-perf', 'low');
  } else {
    root.removeAttribute('data-perf');
  }

  // --- 第 3 层：用户显式开关（与 theme-engine 的 data-no-motion 联动） ---
  // 若用户已关闭动画，说明倾向省电，同样降级毛玻璃
  this._syncFromMotionSwitch();
  try {
    var bus = this._eventBus;
    if (bus && typeof bus.on === 'function') {
      bus.on('theme:motion-toggled', function() { self._syncFromMotionSwitch(); });
    }
  } catch (e) {}

  // --- 第 2 层：滚动状态感知 ---
  this._attachScrollWatcher();

  return this;
};

// 与动效开关联动：关闭动画时同时降级毛玻璃
PerfPolicy.prototype._syncFromMotionSwitch = function() {
  if (typeof document === 'undefined') return;
  var root = document.documentElement;
  var motionOff = root.getAttribute('data-no-motion') === 'true';
  if (motionOff) {
    root.setAttribute('data-glass', 'flat');
  } else if (this._perfLevel !== 'low') {
    // 非低端设备且动画开启时，移除降级标记（滚动状态会另行叠加）
    if (root.getAttribute('data-scrolling') !== '1') {
      root.removeAttribute('data-glass');
    }
  }
};

// 滚动期间降级毛玻璃，停止后恢复
PerfPolicy.prototype._attachScrollWatcher = function() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (typeof window.addEventListener !== 'function') return;

  var self = this;

  this._scrollHandler = function() {
    if (!self._isScrolling) {
      self._isScrolling = true;
      // 低端设备本就降级，无需叠加滚动标记
      if (self._perfLevel !== 'low') {
        document.documentElement.setAttribute('data-scrolling', '1');
      }
    }
    if (self._scrollTimer) clearTimeout(self._scrollTimer);
    self._scrollTimer = setTimeout(function() {
      self._isScrolling = false;
      document.documentElement.removeAttribute('data-scrolling');
      self._syncFromGlassState();
    }, SCROLL_IDLE_MS);
  };

  // passive: true —— 明确告知浏览器不调用 preventDefault，不阻塞滚动
  try {
    window.addEventListener('scroll', this._scrollHandler, { passive: true, capture: true });
  } catch (e) {
    // 老引擎不支持 options 对象时降级为普通监听
    try { window.addEventListener('scroll', this._scrollHandler, true); } catch (_) {}
  }
};

// 滚动结束后，重新判定是否需要保持毛玻璃降级
PerfPolicy.prototype._syncFromGlassState = function() {
  var root = document.documentElement;
  if (this._perfLevel === 'low' || root.getAttribute('data-no-motion') === 'true') {
    root.setAttribute('data-glass', 'flat');
  } else {
    root.removeAttribute('data-glass');
  }
};

// 订阅等级变化（供诊断页/设置页使用）
PerfPolicy.prototype.subscribe = function(fn) {
  if (typeof fn !== 'function') return function() {};
  this._listeners.push(fn);
  return function() {
    var idx = this._listeners.indexOf(fn);
    if (idx !== -1) this._listeners.splice(idx, 1);
  }.bind(this);
};

// 外部强制设定等级（设置页提供「省电模式」）
PerfPolicy.prototype.setLevel = function(level) {
  var next = level === 'low' ? 'low' : 'high';
  if (next === this._perfLevel) return;
  this._perfLevel = next;
  var root = document.documentElement;
  if (next === 'low') {
    root.setAttribute('data-perf', 'low');
    root.setAttribute('data-glass', 'flat');
  } else {
    root.removeAttribute('data-perf');
    this._syncFromGlassState();
  }
  this._listeners.forEach(function(fn) {
    try { fn(next); } catch (e) {}
  });
};

// 获取当前性能等级
PerfPolicy.prototype.getLevel = function() {
  return this._perfLevel;
};

// 供诊断使用
PerfPolicy.prototype.getStatus = function() {
  return {
    level: this._perfLevel,
    reasons: this._reasons || [],
    scrolling: this._isScrolling,
    x5: typeof document !== 'undefined' &&
        document.documentElement.getAttribute('data-engine') === 'x5'
  };
};

// 销毁（通常不需要，但在热重载/测试中避免监听器泄漏）
PerfPolicy.prototype.destroy = function() {
  if (this._scrollHandler && typeof window !== 'undefined') {
    try { window.removeEventListener('scroll', this._scrollHandler, true); } catch (e) {}
  }
  if (this._scrollTimer) clearTimeout(this._scrollTimer);
  this._scrollHandler = null;
  this._initialized = false;
};

// ========== 单例 ==========
var _instance = null;

function getPerfPolicy() {
  if (!_instance) _instance = new PerfPolicy();
  return _instance;
}

export { PerfPolicy, getPerfPolicy };
export default PerfPolicy;
