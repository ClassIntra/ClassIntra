// 前端核心：市场 SDK 工厂
// ============================================================
// 为第三方应用构造 context 对象。这是第三方应用的唯一编程接口。
//
// 五大命名空间（详见 docs/ecosystem-design.md §4）：
//   context.ui      —— 预制 iOS DOM 片段（12 个）
//   context.data    —— 数据能力（api / realtime / storage）
//   context.system  —— 系统能力（user / theme / router / toast / modal / navbar）
//   context.app     —— 应用自身（name / version / manifest / config / log / onDestroy）
//   context.compat  —— 兼容探测（chromeVersion / isX5 / has）
//
// 关键设计：
//   - 能力按需：命名空间隔离，避免把所有内部对象暴露给第三方
//   - 契约优于约定：context.app.onDestroy 注册清理函数，卸载时自动调用
//   - 存储隔离：context.data.storage 强制 ci:app:<name>: 前缀
//   - 兼容探测：第三方可据此做降级分支（如 flex-gap 缺失）
//
// 编码约定：全文件使用 var / function / 单引号 / 2 空格缩进（Chrome 80 兼容基线）

import { ui, ensureStyles } from '@/core/market-sdk-ui';
import { getTokenInjector, collectTokens } from '@/core/token-injector';

// ============================================================
// 一、版本与兼容探测（context.compat）
// ============================================================

// 解析当前 Chrome 主版本号
function detectChromeVersion() {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return 0;
  var ua = navigator.userAgent;
  var m = ua.match(/Chrome\/(\d+)/);
  if (m && m[1]) return parseInt(m[1], 10);
  // X5 内核标识
  m = ua.match(/MQQBrowser\/(\d+)/);
  if (m && m[1]) return parseInt(m[1], 10);
  return 0;
}

// 是否运行在腾讯 X5 / TBS 内核
function detectIsX5() {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
  var ua = navigator.userAgent;
  return /MQQBrowser|TBS|X5|TencentTraveler/i.test(ua);
}

// 探测能力支持
function detectCapability(name) {
  if (typeof document === 'undefined') return false;
  switch (name) {
    case 'flex-gap':
      // Chrome 84+ 原生支持 flex gap
      return detectChromeVersion() >= 84;
    case 'backdrop-filter':
      return typeof CSS !== 'undefined' && (CSS.supports ? CSS.supports('backdrop-filter', 'blur(1px)') : false);
    case 'webp':
      return typeof CSS !== 'undefined' && (CSS.supports ? CSS.supports('background-image', 'url("x.webp")') : false);
    case 'container-query':
      return typeof CSS !== 'undefined' && (CSS.supports ? CSS.supports('container-type', 'inline-size') : false);
    case 'clipboard':
      return typeof navigator !== 'undefined' && !!(navigator.clipboard);
    case 'resize-observer':
      return typeof ResizeObserver !== 'undefined';
    case 'intersection-observer':
      return typeof IntersectionObserver !== 'undefined';
    case 'passive-events':
      return true; // Chrome 51+ 支持，基线内
    case 'css-vars':
      return typeof CSS !== 'undefined' && CSS.supports && CSS.supports('--ci-test', '1');
    case 'local-storage':
      try {
        if (typeof localStorage === 'undefined') return false;
        localStorage.setItem('__ci_probe__', '1');
        localStorage.removeItem('__ci_probe__');
        return true;
      } catch (e) { return false; }
    default:
      return false;
  }
}

// ============================================================
// 二、存储命名空间（context.data.storage）
// ============================================================

// 创建带前缀的存储包装，强制隔离。
// 所有键会被自动加上 'ci:app:<appName>:' 前缀，避免与宿主或其他应用冲突。
function createNamespacedStorage(appName, auditor) {
  var prefix = 'ci:app:' + appName + ':';
  if (auditor && typeof auditor.noteStoragePrefix === 'function') {
    auditor.noteStoragePrefix(prefix);
  }

  function fullKey(key) {
    return prefix + String(key);
  }

  return {
    // 命名空间前缀（供诊断）
    prefix: prefix,
    get: function(key, fallback) {
      try {
        var raw = localStorage.getItem(fullKey(key));
        if (raw === null) return fallback === undefined ? null : fallback;
        try { return JSON.parse(raw); } catch (e) { return raw; }
      } catch (e) {
        return fallback === undefined ? null : fallback;
      }
    },
    set: function(key, value) {
      try {
        var raw = (typeof value === 'string') ? value : JSON.stringify(value);
        localStorage.setItem(fullKey(key), raw);
        return true;
      } catch (e) {
        // 配额溢出等
        return false;
      }
    },
    remove: function(key) {
      try { localStorage.removeItem(fullKey(key)); return true; } catch (e) { return false; }
    },
    keys: function() {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(prefix) === 0) {
            out.push(k.slice(prefix.length));
          }
        }
      } catch (e) {}
      return out;
    },
    clear: function() {
      var self = this;
      var ks = self.keys();
      ks.forEach(function(k) { self.remove(k); });
      return ks.length;
    }
  };
}

// ============================================================
// 三、SDK 工厂
// ============================================================

// createContext 的依赖注入参数
// deps: {
//   api, realtime, router, store, themeEngine, eventBus, modal,
//   getAuditor, define   —— 见 main.js 的装配处
// }
function createContext(appName, deps) {
  var d = deps || {};

  // 确保 UI 片段的样式已注入
  try { ensureStyles(); } catch (e) {}

  // --- 清理函数登记表（context.app.onDestroy 的实现） ---
  var cleanups = [];
  var _disposed = false;

  // 取当前应用的资源审计器（用于记录 storage 前缀）
  var auditor = null;
  try {
    if (typeof d.getAuditor === 'function') auditor = d.getAuditor(appName);
  } catch (e) { auditor = null; }

  // --- context.app ---
  var appApi = {
    name: appName,
    version: d.appVersion || '0.0.0',
    manifest: d.manifest || null,
    // 注册清理函数：应用卸载时被调用（契约优于约定）
    onDestroy: function(fn) {
      if (typeof fn !== 'function') return;
      if (_disposed) {
        // 已卸载则立即执行，避免泄漏
        try { fn(); } catch (e) {}
        return;
      }
      cleanups.push(fn);
    },
    // 日志：统一前缀，便于第三方问题归因
    log: function() {
      var args = Array.prototype.slice.call(arguments);
      try {
        console.log.apply(console, ['[app:' + appName + ']'].concat(args));
      } catch (e) {}
    },
    warn: function() {
      var args = Array.prototype.slice.call(arguments);
      try {
        console.warn.apply(console, ['[app:' + appName + ']'].concat(args));
      } catch (e) {}
    },
    error: function() {
      var args = Array.prototype.slice.call(arguments);
      try {
        console.error.apply(console, ['[app:' + appName + ']'].concat(args));
      } catch (e) {}
    },
    // 配置：从 manifest.config 读取（应用自定义配置的存放处）
    config: (d.manifest && d.manifest.config) || {}
  };

  // --- context.data ---
  var dataApi = {
    api: d.api || null,
    realtime: d.realtime || null,
    websocket: d.websocket || null,
    storage: createNamespacedStorage(appName, auditor),
    // 便捷方法：拉取 JSON
    get: function(url, options) {
      if (d.api && typeof d.api.get === 'function') return d.api.get(url, options);
      return Promise.reject(new Error('api 不可用'));
    },
    post: function(url, body, options) {
      if (d.api && typeof d.api.post === 'function') return d.api.post(url, body, options);
      return Promise.reject(new Error('api 不可用'));
    }
  };

  // --- context.system ---
  var systemApi = {
    // 当前用户（响应式引用，而非快照）
    get user() {
      try {
        return (d.store && d.store.state && d.store.state.auth && d.store.state.auth.user) || null;
      } catch (e) { return null; }
    },
    get isLoggedIn() {
      try {
        return !!(d.store && d.store.state && d.store.state.auth && d.store.state.auth.token);
      } catch (e) { return false; }
    },
    // 路由
    get route() {
      try {
        return (d.router && d.router.currentRoute) || null;
      } catch (e) { return null; }
    },
    router: d.router || null,
    // 主题引擎
    theme: d.themeEngine || null,
    // 令牌读取
    getToken: function(name) {
      try {
        return (collectTokens() || {})[name] || '';
      } catch (e) { return ''; }
    },
    // 事件总线
    eventBus: d.eventBus || null,
    // 提示
    toast: {
      alert: function(options) {
        try {
          if (d.modal && typeof d.modal.alert === 'function') return d.modal.alert(options);
        } catch (e) {}
        return Promise.resolve(true);
      },
      confirm: function(options) {
        try {
          if (d.modal && typeof d.modal.confirm === 'function') return d.modal.confirm(options);
        } catch (e) {}
        return Promise.resolve(false);
      },
      prompt: function(options) {
        try {
          if (d.modal && typeof d.modal.prompt === 'function') return d.modal.prompt(options);
        } catch (e) {}
        return Promise.resolve(null);
      }
    },
    modal: d.modal || null,
    // 返回桌面（应用内提供「退出」入口时使用）
    goDesktop: function() {
      try {
        if (d.router) d.router.push({ name: 'Desktop' });
      } catch (e) {}
    },
    // 跳转路由
    navigate: function(location) {
      try {
        if (d.router) return d.router.push(location);
      } catch (e) {}
      return Promise.resolve();
    }
  };

  // --- context.compat ---
  var chromeVersion = detectChromeVersion();
  var compatApi = {
    chromeVersion: chromeVersion,
    isX5: detectIsX5(),
    // 能力探测：has('flex-gap') / has('backdrop-filter') ...
    has: function(name) {
      return detectCapability(name);
    },
    // 兼容提示：低于基线时给出统一建议
    isBelowBaseline: chromeVersion > 0 && chromeVersion < 80
  };

  // --- context.ui ---
  var uiApi = {
    button: ui.button,
    card: ui.card,
    list: ui.list,
    badge: ui.badge,
    segmented: ui.segmented,
    toggle: ui.toggle,
    searchBar: ui.searchBar,
    emptyState: ui.emptyState,
    spinner: ui.spinner,
    toast: ui.toast,
    sectionTitle: ui.sectionTitle,
    toolbar: ui.toolbar,
    el: ui.el
  };

  // --- 组装 context ---
  var context = {
    appName: appName,
    version: '1',
    ui: uiApi,
    data: dataApi,
    system: systemApi,
    app: appApi,
    compat: compatApi,

    // ---- 以下为向后兼容层（v1 旧字段），保证既有第三方应用不失效 ----
    // TODO: v2 移除
    get api() { return dataApi.api; },
    get websocket() { return dataApi.websocket; },
    get realtime() { return dataApi.realtime; },
    get realtimeEvents() { return dataApi.realtime; },
    get route() { return systemApi.route; },
    get router() { return systemApi.router; },
    get store() { return d.store || null; },
    get user() { return systemApi.user; },
    get theme() { return systemApi.theme; },
    get eventBus() { return systemApi.eventBus; },
    get toast() { return systemApi.toast; },
    get modal() { return systemApi.modal; },

    // 内部 API：供 MarketRuntime 调用，第三方请勿依赖
    __internal: {
      isDisposed: function() { return _disposed; }
    }
  };

  // 销毁：执行所有注册的清理函数（幂等）
  context.__internal.dispose = function() {
    if (_disposed) return 0;
    _disposed = true;
    var count = 0;
    // 逆序执行（后注册的先清理）
    for (var i = cleanups.length - 1; i >= 0; i--) {
      try {
        cleanups[i]();
        count++;
      } catch (e) {
        try { console.error('[app:' + appName + '] onDestroy 清理失败:', e); } catch (_) {}
      }
    }
    cleanups = [];
    return count;
  };

  return context;
}

export {
  createContext,
  createNamespacedStorage,
  detectChromeVersion,
  detectIsX5,
  detectCapability
};
