// 前端核心：RuntimeKernel 运行时内核
// ============================================================
// 本文件是「生态一体化」的运行时基座，提供三项能力：
//
//   1. 分阶段启动编排（BootOrchestrator）
//      - 把启动流程切为有序阶段，任一 handler 抛错只记录 + 派发事件，不阻断后续阶段
//      - 借鉴 Ditto packages/core/src/lifecycle-orchestrator.ts 的错误隔离模式
//      - 收益：故障降级。即使 realtime 连接失败，应用仍能挂载并给出可用界面
//
//   2. 统一模块注册表（ModuleRegistry）
//      - 统一管理四类模块：app / plugin / theme / component
//      - 定位判据见 docs/ecosystem-design.md §1.5
//      - 四类的差异用「能力位（capability flags）」表达，而非四套代码路径
//
//   3. 生命周期状态机 + 资源审计（LifecycleMachine / ResourceAuditor）
//      - 显式状态机：idle → loading → active → suspended → idle
//      - 非法跃迁主动抛错，不静默容错
//      - 挂载期快照 window 键 / 劫持计时器与监听器 / 记录 storage 命名空间
//      - 卸载或挂起时自动回收，解决平板耗电问题
//
// 编码约定：全文件使用 var / function / 单引号 / 2 空格缩进（Chrome 80 兼容基线）

// ============================================================
// 一、BootOrchestrator —— 分阶段启动编排
// ============================================================

// 启动阶段顺序（固定）。每个阶段可注册零到多个 handler。
// 阶段语义：
//   polyfills   —— 补齐 Chrome 80 缺失的 API
//   errors      —— 安装全局错误处理（必须早于其他一切业务逻辑）
//   components  —— 注册全局组件
//   services    —— 注册核心服务到 ServiceRegistry
//   sdk         —— 暴露 window.ClassIntraMarket
//   realtime    —— 建立实时通道连接
//   market      —— 扫描并同步市场应用清单
//   mount       —— 挂载 Vue 根实例
//   ready       —— 全部就绪，通知外部
var BOOT_STAGES = [
  'polyfills',
  'errors',
  'components',
  'services',
  'sdk',
  'realtime',
  'market',
  'mount',
  'ready'
];

function BootOrchestrator() {
  this._handlers = {};   // { stage: [ { name, fn, required } ] }
  this._stage = 'created';
  this._errors = [];     // [ { stage, name, error } ]
  this._listeners = [];  // [ fn({ stage, error }) ]
  this._duration = {};   // { stage: ms }
  var i;
  for (i = 0; i < BOOT_STAGES.length; i++) {
    this._handlers[BOOT_STAGES[i]] = [];
  }
}

// 注册阶段 handler
// stage:    BOOT_STAGES 之一
// name:     handler 名（用于日志与错误归因）
// fn:       function() 或返回 Promise 的函数
// options:  { required: false } —— required=true 时若该 handler 失败会额外上报为致命
BootOrchestrator.prototype.onStage = function(stage, name, fn, options) {
  if (BOOT_STAGES.indexOf(stage) === -1) {
    throw new Error('[BootOrchestrator] 未知阶段: ' + stage);
  }
  if (typeof fn !== 'function') {
    throw new Error('[BootOrchestrator] handler ' + name + ' 必须是函数');
  }
  var opts = options || {};
  this._handlers[stage].push({
    name: name,
    fn: fn,
    required: opts.required === true
  });
  return this;
};

// 订阅阶段错误（用于诊断面板 / 上报）
BootOrchestrator.prototype.onStageError = function(listener) {
  this._listeners.push(listener);
  var self = this;
  return function() {
    var idx = self._listeners.indexOf(listener);
    if (idx !== -1) self._listeners.splice(idx, 1);
  };
};

// 执行单个阶段。返回 { ok, errors }
BootOrchestrator.prototype._runStage = function(stage) {
  var self = this;
  var handlers = self._handlers[stage] || [];
  var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  var chain = Promise.resolve();
  var stageErrors = [];

  handlers.forEach(function(h) {
    chain = chain.then(function() {
      return Promise.resolve()
        .then(function() { return h.fn(); })
        .catch(function(e) {
          var rec = { stage: stage, name: h.name, error: e, required: h.required };
          stageErrors.push(rec);
          self._errors.push(rec);
          try {
            console.error('[RuntimeKernel] 阶段 "' + stage + '" 的 handler "' + h.name + '" 失败:', e);
          } catch (_) {}
          self._listeners.forEach(function(l) {
            try { l(rec); } catch (_) {}
          });
          // 关键：不 rethrow，继续执行本阶段后续 handler 与下一阶段
        });
    });
  });

  return chain.then(function() {
    var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    self._duration[stage] = Math.round(t1 - t0);
    return { ok: stageErrors.length === 0, errors: stageErrors };
  });
};

// 按顺序执行全部阶段（单阶段失败不中断）
BootOrchestrator.prototype.run = function() {
  var self = this;
  var chain = Promise.resolve();
  BOOT_STAGES.forEach(function(stage) {
    chain = chain.then(function() {
      self._stage = stage;
      return self._runStage(stage);
    });
  });
  return chain.then(function() {
    self._stage = 'ready';
    return {
      errors: self._errors.slice(),
      duration: Object.assign({}, self._duration)
    };
  });
};

// 当前阶段
BootOrchestrator.prototype.getStage = function() {
  return this._stage;
};

// 所有错误
BootOrchestrator.prototype.getErrors = function() {
  return this._errors.slice();
};

// 阶段耗时（毫秒）
BootOrchestrator.prototype.getDuration = function() {
  return Object.assign({}, this._duration);
};

// ============================================================
// 二、LifecycleMachine —— 生命周期状态机
// ============================================================

// 状态：idle（未装载）→ loading（装载中）→ active（运行中）⇄ suspended（挂起）→ idle（已卸载）
var LIFECYCLE_TRANSITIONS = {
  'idle':      ['loading'],
  'loading':   ['active', 'idle'],       // loading → idle 表示装载失败回退
  'active':    ['suspended', 'idle'],
  'suspended': ['active', 'idle'],
  'error':     ['loading', 'idle']       // 错误态可重试
};

function LifecycleMachine(name, hooks) {
  this.name = name;
  this._state = 'idle';
  this._hooks = hooks || {};   // { onMount, onUnmount, onSuspend, onResume }
  this._history = [];          // [ { from, to, at } ]（封顶 HISTORY_CAP，防长驻应用无限增长）
}

// 状态机历史封顶（诊断用途足够，长驻应用如悬浮层会持续产生跃迁）
var HISTORY_CAP = 64;

LifecycleMachine.prototype.getState = function() {
  return this._state;
};

// 校验跃迁合法性。非法跃迁抛错（不静默容错）
LifecycleMachine.prototype._assert = function(to) {
  var allowed = LIFECYCLE_TRANSITIONS[this._state] || [];
  if (allowed.indexOf(to) === -1) {
    throw new Error(
      '[LifecycleMachine] ' + this.name + ' 非法状态跃迁: ' + this._state + ' → ' + to +
      '（允许: ' + (allowed.join(', ') || '无') + '）'
    );
  }
};

LifecycleMachine.prototype._to = function(state) {
  var from = this._state;
  this._state = state;
  this._history.push({ from: from, to: state, at: Date.now() });
  if (this._history.length > HISTORY_CAP) this._history.shift();
};

// 装载：idle → loading → active
LifecycleMachine.prototype.mount = function(payload) {
  var self = this;
  self._assert('loading');
  self._to('loading');
  return Promise.resolve()
    .then(function() {
      if (typeof self._hooks.onMount === 'function') {
        return self._hooks.onMount(payload);
      }
    })
    .then(function(result) {
      self._to('active');
      return result;
    })
    .catch(function(e) {
      // 装载失败：回退 idle 并记录 error 态
      self._state = 'error';
      self._history.push({ from: 'loading', to: 'error', at: Date.now() });
      throw e;
    });
};

// 挂起：active → suspended（回收高耗资源，保留 DOM）
LifecycleMachine.prototype.suspend = function() {
  var self = this;
  self._assert('suspended');
  self._to('suspended');
  if (typeof self._hooks.onSuspend === 'function') {
    try { self._hooks.onSuspend(); } catch (e) {
      console.error('[LifecycleMachine] ' + self.name + ' onSuspend 失败:', e);
    }
  }
  return self._state;
};

// 恢复：suspended → active
LifecycleMachine.prototype.resume = function() {
  var self = this;
  self._assert('active');
  self._to('active');
  if (typeof self._hooks.onResume === 'function') {
    try { self._hooks.onResume(); } catch (e) {
      console.error('[LifecycleMachine] ' + self.name + ' onResume 失败:', e);
    }
  }
  return self._state;
};

// 卸载：任意态 → idle
LifecycleMachine.prototype.unmount = function() {
  var self = this;
  var prev = self._state;
  // 卸载允许从 active / suspended / error 发起
  var allowed = LIFECYCLE_TRANSITIONS[prev] || [];
  if (allowed.indexOf('idle') === -1 && prev !== 'idle') {
    throw new Error('[LifecycleMachine] ' + self.name + ' 无法从 ' + prev + ' 卸载');
  }
  if (prev === 'idle') return 'idle';
  self._to('idle');
  if (typeof self._hooks.onUnmount === 'function') {
    try { self._hooks.onUnmount(); } catch (e) {
      console.error('[LifecycleMachine] ' + self.name + ' onUnmount 失败:', e);
    }
  }
  return self._state;
};

LifecycleMachine.prototype.getHistory = function() {
  return this._history.slice();
};

// ============================================================
// 三、ResourceAuditor —— 资源审计与自动回收
// ============================================================

// 挂载前对全局环境做快照；挂载后对比，识别「新增的全局污染」；
// 同时劫持计时器与事件监听器，记录第三方创建的资源句柄，卸载时统一回收。
function ResourceAuditor(name) {
  this.name = name;
  this._active = false;
  this._windowSnapshot = null;      // 挂载前的 window 键集合
  this._timers = [];               // [ { id, kind } ]
  this._listeners = [];            // [ { target, type, fn, options } ]
  this._intervals = [];            // 兼容旧记录
  this._origSetTimeout = null;
  this._origClearTimeout = null;
  this._origSetInterval = null;
  this._origClearInterval = null;
  this._origAddEventListener = null;
  this._origRemoveEventListener = null;
  this._inHijack = false;          // 是否已登记进共享劫持栈
  this._storagePrefixes = [];      // 该应用使用的 storage 命名空间前缀
}

// ============================================================
// 共享劫持（引用计数）
// ------------------------------------------------------------
// 旧实现每个审计器各自劫持并各自恢复 window.setTimeout —— 当两个应用
// 同时挂载（如悬浮层应用 + 页面应用）时产生嵌套劫持，恢复顺序一旦交叉
// （内层先结束、外层后结束），外层保存的「原始函数」其实是内层的包装器，
// end() 后包装器永久残留，全站 setTimeout 从此经过死包装器。
// 现改为全局唯一一份包装器：创建时归属栈顶审计器，清除时从全部审计器
// 移除记录；最后一个审计器结束时才恢复原生函数。
// ============================================================
var _hijack = {
  installed: false,
  stack: [],                        // 活跃审计器栈（栈顶 = 最内层应用）
  origSetTimeout: null,
  origClearTimeout: null,
  origSetInterval: null,
  origClearInterval: null,
  origAddEventListener: null,
  origRemoveEventListener: null
};

function _installHijack() {
  var h = _hijack;
  if (h.installed || typeof window === 'undefined' ||
      typeof window.setTimeout !== 'function' || typeof window.setInterval !== 'function') return;
  h.origSetTimeout = window.setTimeout;
  h.origClearTimeout = window.clearTimeout;
  h.origSetInterval = window.setInterval;
  h.origClearInterval = window.clearInterval;

  // 定时器回调包装：报错时归因到创建时的审计器（应用名）再原样重抛，
  // 不改变任何语义 —— 只是让"哪个应用的定时器炸了"在控制台可定位
  function wrapCallback(fn, ownerName) {
    if (typeof fn !== 'function' || !ownerName) return fn;
    return function() {
      try {
        return fn.apply(this, arguments);
      } catch (e) {
        try { console.error('[app:' + ownerName + '] 定时器回调异常:', e); } catch (_) {}
        throw e;
      }
    };
  }

  window.setTimeout = function(fn, delay) {
    var args = Array.prototype.slice.call(arguments, 2);
    var top = h.stack[h.stack.length - 1];
    if (top) top._timers.push({ id: null, kind: 'pending' }); // 占位，下面回填真实 id
    var pendingIdx = top ? top._timers.length - 1 : -1;
    var id = h.origSetTimeout.apply(window, [wrapCallback(fn, top ? top.name : ''), delay].concat(args));
    if (top && pendingIdx !== -1) top._timers[pendingIdx] = { id: id, kind: 'timeout' };
    return id;
  };
  window.clearTimeout = function(id) {
    for (var i = 0; i < h.stack.length; i++) h.stack[i]._removeTimer(id);
    return h.origClearTimeout.call(window, id);
  };
  window.setInterval = function(fn, delay) {
    var args = Array.prototype.slice.call(arguments, 2);
    var top = h.stack[h.stack.length - 1];
    if (top) top._timers.push({ id: null, kind: 'pending' });
    var pendingIdx = top ? top._timers.length - 1 : -1;
    var id = h.origSetInterval.apply(window, [wrapCallback(fn, top ? top.name : ''), delay].concat(args));
    if (top && pendingIdx !== -1) top._timers[pendingIdx] = { id: id, kind: 'interval' };
    return id;
  };
  window.clearInterval = function(id) {
    for (var i2 = 0; i2 < h.stack.length; i2++) h.stack[i2]._removeTimer(id);
    return h.origClearInterval.call(window, id);
  };

  if (typeof window.addEventListener === 'function' && typeof window.removeEventListener === 'function') {
    h.origAddEventListener = window.addEventListener;
    h.origRemoveEventListener = window.removeEventListener;
    window.addEventListener = function(type, fn, options) {
      var top = h.stack[h.stack.length - 1];
      if (top) top._listeners.push({ target: 'window', type: type, fn: fn, options: options });
      return h.origAddEventListener.call(window, type, fn, options);
    };
    window.removeEventListener = function(type, fn, options) {
      for (var i3 = 0; i3 < h.stack.length; i3++) h.stack[i3]._removeListener('window', type, fn);
      return h.origRemoveEventListener.call(window, type, fn, options);
    };
  }
  h.installed = true;
}

function _uninstallHijack() {
  var h = _hijack;
  if (!h.installed) return;
  window.setTimeout = h.origSetTimeout;
  window.clearTimeout = h.origClearTimeout;
  window.setInterval = h.origSetInterval;
  window.clearInterval = h.origClearInterval;
  if (h.origAddEventListener) window.addEventListener = h.origAddEventListener;
  if (h.origRemoveEventListener) window.removeEventListener = h.origRemoveEventListener;
  h.installed = false;
}

// 开始审计：登记进共享劫持栈 + 快照 window
ResourceAuditor.prototype.begin = function() {
  if (this._active) return;
  this._active = true;
  var self = this;

  // 1. 快照 window 键
  self._windowSnapshot = {};
  try {
    Object.keys(window).forEach(function(k) {
      self._windowSnapshot[k] = true;
    });
  } catch (e) {
    self._windowSnapshot = {};
  }

  // 2. 登记进共享劫持栈（首个审计器负责安装包装器）
  _installHijack();
  if (_hijack.installed) {
    self._origSetTimeout = _hijack.origSetTimeout;
    self._origClearTimeout = _hijack.origClearTimeout;
    self._origSetInterval = _hijack.origSetInterval;
    self._origClearInterval = _hijack.origClearInterval;
    self._origAddEventListener = _hijack.origAddEventListener;
    self._origRemoveEventListener = _hijack.origRemoveEventListener;
    self._inHijack = true;
    _hijack.stack.push(self);
  }
};

ResourceAuditor.prototype._removeTimer = function(id) {
  for (var i = this._timers.length - 1; i >= 0; i--) {
    if (this._timers[i].id === id) {
      this._timers.splice(i, 1);
      return;
    }
  }
};

ResourceAuditor.prototype._removeListener = function(target, type, fn) {
  for (var i = this._listeners.length - 1; i >= 0; i--) {
    var l = this._listeners[i];
    if (l.target === target && l.type === type && l.fn === fn) {
      this._listeners.splice(i, 1);
      return;
    }
  }
};

// 回收计时器（挂起或卸载时调用）。返回回收数量。
ResourceAuditor.prototype.recycleTimers = function() {
  var self = this;
  var count = 0;
  if (typeof window === 'undefined') return 0;
  self._timers.forEach(function(t) {
    try {
      if (t.kind === 'interval') {
        self._origClearInterval.call(window, t.id);
      } else {
        self._origClearTimeout.call(window, t.id);
      }
      count++;
    } catch (e) {}
  });
  self._timers = [];
  return count;
};

// 记录 storage 命名空间（第三方应使用 ci:app:<name>: 前缀）
ResourceAuditor.prototype.noteStoragePrefix = function(prefix) {
  if (this._storagePrefixes.indexOf(prefix) === -1) {
    this._storagePrefixes.push(prefix);
  }
};

// 结束审计：退出共享劫持栈，回收全部资源。返回审计报告。
ResourceAuditor.prototype.end = function() {
  if (!this._active) {
    return { timersRecycled: 0, listenersRemoved: 0, windowLeaks: [], storagePrefixes: [] };
  }
  var self = this;

  // 1. 回收所有未清理的计时器
  var timersRecycled = self.recycleTimers();

  // 2. 移除所有未清理的 window 监听器
  var listenersRemoved = 0;
  if (typeof window !== 'undefined' && self._origRemoveEventListener) {
    self._listeners.forEach(function(l) {
      try {
        self._origRemoveEventListener.call(window, l.type, l.fn, l.options);
        listenersRemoved++;
      } catch (e) {}
    });
  }
  self._listeners = [];

  // 3. 退出共享劫持栈；最后一个审计器结束时恢复原生全局 API
  //    （乱序结束安全：外层先走也只是出栈，包装器继续服务栈内审计器）
  if (self._inHijack) {
    var idx = _hijack.stack.indexOf(self);
    if (idx !== -1) _hijack.stack.splice(idx, 1);
    if (_hijack.stack.length === 0) _uninstallHijack();
    self._inHijack = false;
  }

  // 4. 对比 window 键，找出新增的全局污染
  var leaks = [];
  try {
    var now = {};
    Object.keys(window).forEach(function(k) { now[k] = true; });
    Object.keys(now).forEach(function(k) {
      if (!self._windowSnapshot[k]) leaks.push(k);
    });
  } catch (e) {}

  var report = {
    timersRecycled: timersRecycled,
    listenersRemoved: listenersRemoved,
    windowLeaks: leaks,
    storagePrefixes: self._storagePrefixes.slice()
  };

  self._active = false;
  self._windowSnapshot = null;

  if (leaks.length > 0) {
    try {
      console.warn('[ResourceAuditor] "' + self.name + '" 卸载后残留全局变量:', leaks.join(', '));
    } catch (_) {}
  }

  return report;
};

// 当前审计状态（未卸载时的实时信息）
ResourceAuditor.prototype.getStatus = function() {
  return {
    active: this._active,
    pendingTimers: this._timers.length,
    pendingListeners: this._listeners.length,
    storagePrefixes: this._storagePrefixes.slice()
  };
};

// ============================================================
// 四、ModuleRegistry —— 四类模块统一注册表
// ============================================================
//
// 四类的定位（详见 docs/ecosystem-design.md §1.5）：
//   app       —— 有独立界面与路由，桌面有入口
//   plugin    —— 无界面，只扩展后端能力
//   theme     —— 只改视觉令牌，无界面无 API
//   component —— 系统内部 UI 资产，不对外分发
//
// 差异用「能力位」表达：hasUI / hasRoute / hasDesktopEntry / hasBackend / affectsVisualOnly

var MODULE_KINDS = ['app', 'plugin', 'theme', 'component'];

// 每一类的能力位定义（这是四类定位的可执行表达）
var KIND_CAPABILITIES = {
  'app':       { hasUI: true,  hasRoute: true,  hasDesktopEntry: true,  hasBackend: 'optional', affectsVisualOnly: false },
  'plugin':    { hasUI: false, hasRoute: false, hasDesktopEntry: false, hasBackend: true,       affectsVisualOnly: false },
  'theme':     { hasUI: false, hasRoute: false, hasDesktopEntry: false, hasBackend: false,      affectsVisualOnly: true  },
  'component': { hasUI: true,  hasRoute: false, hasDesktopEntry: false, hasBackend: false,      affectsVisualOnly: false }
};

function ModuleRegistry() {
  this._modules = {};   // { '<kind>:<name>': record }
  this._listeners = [];
}

// 注册模块
// kind: 'app' | 'plugin' | 'theme' | 'component'
// name: 模块名
// meta: { label, version, source, manifest, route, ... }
ModuleRegistry.prototype.register = function(kind, name, meta) {
  if (MODULE_KINDS.indexOf(kind) === -1) {
    throw new Error('[ModuleRegistry] 未知模块类型: ' + kind + '（允许: ' + MODULE_KINDS.join(', ') + '）');
  }
  if (!name) {
    throw new Error('[ModuleRegistry] 模块名必填');
  }
  var key = kind + ':' + name;
  var record = {
    kind: kind,
    name: name,
    meta: meta || {},
    capabilities: KIND_CAPABILITIES[kind],
    machine: null,       // LifecycleMachine 实例（app / plugin 才有）
    auditor: null,       // ResourceAuditor 实例（app 才有）
    registeredAt: Date.now()
  };
  this._modules[key] = record;
  this._emit();
  return record;
};

ModuleRegistry.prototype.get = function(kind, name) {
  return this._modules[kind + ':' + name] || null;
};

ModuleRegistry.prototype.list = function(kind) {
  var self = this;
  var keys = Object.keys(self._modules);
  var result = [];
  keys.forEach(function(k) {
    var m = self._modules[k];
    if (!kind || m.kind === kind) result.push(m);
  });
  return result;
};

// 按类型统计
ModuleRegistry.prototype.summary = function() {
  var self = this;
  var out = {};
  MODULE_KINDS.forEach(function(k) { out[k] = 0; });
  Object.keys(self._modules).forEach(function(k) {
    out[self._modules[k].kind]++;
  });
  return out;
};

ModuleRegistry.prototype.remove = function(kind, name) {
  delete this._modules[kind + ':' + name];
  this._emit();
};

ModuleRegistry.prototype.onChange = function(listener) {
  this._listeners.push(listener);
  var self = this;
  return function() {
    var idx = self._listeners.indexOf(listener);
    if (idx !== -1) self._listeners.splice(idx, 1);
  };
};

ModuleRegistry.prototype._emit = function() {
  var self = this;
  self._listeners.forEach(function(l) {
    try { l(self.summary()); } catch (e) {}
  });
};

// ============================================================
// 五、ResourceGovernor —— 资源治理器
// ============================================================
// 操作系统的进程有资源上限（超出即 OOM-kill / cgroup 限流），Web 平台没有
// 等价物——第三方应用泄漏计时器只会慢慢拖垮整站。治理器周期巡检各应用
// 审计器的未回收资源数，超阈值即挂起该应用的生命周期机（回收计时器、
// 保留 DOM），并记录动作供诊断。阈值刻意放宽（正常应用远达不到），
// 只拦截明确的泄漏行为。
function ResourceGovernor(kernel) {
  this._kernel = kernel;
  this._timerId = null;
  this._actions = [];       // 最近动作（封顶 GOVERNOR_LOG_CAP）
  this.thresholds = { timers: 120, listeners: 80 };
}

var GOVERNOR_LOG_CAP = 20;
var GOVERNOR_INTERVAL_MS = 30000;

ResourceGovernor.prototype.start = function(options) {
  if (this._timerId) return;
  var opts = options || {};
  if (opts.timers) this.thresholds.timers = opts.timers;
  if (opts.listeners) this.thresholds.listeners = opts.listeners;
  var self = this;
  this._timerId = setInterval(function() {
    try { self.tick(); } catch (e) {}
  }, GOVERNOR_INTERVAL_MS);
};

ResourceGovernor.prototype.stop = function() {
  if (this._timerId) {
    clearInterval(this._timerId);
    this._timerId = null;
  }
};

// 巡检一轮：超阈值且处于 active 态的应用 → 挂起（kernel.suspend 会回收计时器）。
// 冒烟测试直接调用本方法（不依赖 setInterval）。
ResourceGovernor.prototype.tick = function() {
  var self = this;
  var machines = this._kernel._machines;
  Object.keys(machines).forEach(function(name) {
    var machine = machines[name];
    var auditor = self._kernel._auditors[name];
    if (!auditor || !auditor._active) return;
    if (machine.getState() !== 'active') return;
    var status = auditor.getStatus();
    var overTimers = status.pendingTimers > self.thresholds.timers;
    var overListeners = status.pendingListeners > self.thresholds.listeners;
    if (!overTimers && !overListeners) return;
    try {
      self._kernel.suspend(name);
      self._actions.push({
        name: name,
        at: Date.now(),
        action: 'suspend',
        timers: status.pendingTimers,
        listeners: status.pendingListeners
      });
      if (self._actions.length > GOVERNOR_LOG_CAP) self._actions.shift();
      console.warn('[Governor] 应用 "' + name + '" 资源超阈（timers=' + status.pendingTimers +
        ', listeners=' + status.pendingListeners + '），已挂起并回收计时器');
    } catch (e) {
      console.error('[Governor] 挂起 "' + name + '" 失败:', e);
    }
  });
};

ResourceGovernor.prototype.getRecentActions = function() {
  return this._actions.slice();
};

// ============================================================
// 六、RuntimeKernel —— 内核聚合入口
// ============================================================

function RuntimeKernel() {
  this.boot = new BootOrchestrator();
  this.modules = new ModuleRegistry();
  this.governor = new ResourceGovernor(this); // 资源治理器（main.js sdk 阶段 start）
  this._machines = {};    // { '<kind>:<name>': LifecycleMachine }
  this._auditors = {};    // { '<kind>:<name>': ResourceAuditor }
  this._version = '1';
}

// 为某个应用装载生命周期机 + 资源审计
RuntimeKernel.prototype.attachLifecycle = function(name, hooks) {
  var self = this;
  var machine = new LifecycleMachine(name, hooks);
  var auditor = new ResourceAuditor(name);
  self._machines[name] = machine;
  self._auditors[name] = auditor;

  // 把审计器交给 hooks，让应用可在挂载期记录 storage 前缀
  if (hooks && typeof hooks === 'object') {
    hooks.auditor = auditor;
  }

  // 自动在挂载时开启审计、卸载时结束审计
  var userOnMount = (hooks && hooks.onMount) || null;
  machine._hooks.onMount = function(payload) {
    auditor.begin();
    if (typeof userOnMount === 'function') return userOnMount(payload);
  };

  var userOnUnmount = (hooks && hooks.onUnmount) || null;
  machine._hooks.onUnmount = function() {
    var userErr = null;
    if (typeof userOnUnmount === 'function') {
      try { userOnUnmount(); } catch (e) { userErr = e; }
    }
    var report = auditor.end();
    if (userErr) throw userErr;
    return report;
  };

  return { machine: machine, auditor: auditor };
};

RuntimeKernel.prototype.getMachine = function(name) {
  return this._machines[name] || null;
};

RuntimeKernel.prototype.getAuditor = function(name) {
  return this._auditors[name] || null;
};

// 摘除某个应用的生命周期机与审计器（应用整体卸载时调用）。
// 若机器仍在运行态则先走 unmount（内含 auditor.end 回收），
// 之后从内核登记表中删除 —— 否则 _machines/_auditors 永久泄漏，
// diagnostics() 也会一直显示已卸载的应用。返回审计报告（无登记返回 null）。
RuntimeKernel.prototype.detachLifecycle = function(name) {
  var self = this;
  var machine = self._machines[name];
  var auditor = self._auditors[name];
  if (!machine && !auditor) return null;
  var report = null;
  if (machine && machine.getState() !== 'idle') {
    try { machine.unmount(); } catch (e) {
      console.error('[RuntimeKernel] detachLifecycle unmount 失败:', name, e);
    }
  }
  if (auditor && auditor._active) {
    try { report = auditor.end(); } catch (e) {
      console.error('[RuntimeKernel] detachLifecycle auditor.end 失败:', name, e);
    }
  }
  delete self._machines[name];
  delete self._auditors[name];
  return report;
};

// 挂起指定应用（回收计时器但保留 DOM）
RuntimeKernel.prototype.suspend = function(name) {
  var machine = this._machines[name];
  var auditor = this._auditors[name];
  if (!machine) return null;
  var state = machine.suspend();
  // 挂起时回收计时器（这是省电的关键）
  var recycled = auditor ? auditor.recycleTimers() : 0;
  return { state: state, timersRecycled: recycled };
};

RuntimeKernel.prototype.resume = function(name) {
  var machine = this._machines[name];
  if (!machine) return null;
  return machine.resume();
};

// 内核概览（用于诊断面板）
RuntimeKernel.prototype.diagnostics = function() {
  var self = this;
  var apps = {};
  Object.keys(self._machines).forEach(function(name) {
    var m = self._machines[name];
    var a = self._auditors[name];
    apps[name] = {
      state: m.getState(),
      history: m.getHistory(),
      resources: a ? a.getStatus() : null
    };
  });
  return {
    version: self._version,
    bootStage: self.boot.getStage(),
    bootErrors: self.boot.getErrors(),
    bootDuration: self.boot.getDuration(),
    modules: self.modules.summary(),
    apps: apps,
    governor: {
      thresholds: self.governor.thresholds,
      recentActions: self.governor.getRecentActions()
    }
  };
};

// ============================================================
// 单例
// ============================================================
var _kernel = null;

function getRuntimeKernel() {
  if (!_kernel) {
    _kernel = new RuntimeKernel();
  }
  return _kernel;
}

export {
  BOOT_STAGES,
  MODULE_KINDS,
  KIND_CAPABILITIES,
  BootOrchestrator,
  LifecycleMachine,
  ResourceAuditor,
  ModuleRegistry,
  ResourceGovernor,
  RuntimeKernel,
  getRuntimeKernel
};
