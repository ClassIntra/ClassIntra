// Polyfills for Chrome 78+ compatibility (Mermaid v11 requires ES2022 APIs)
(function() {
  // Object.hasOwn (ES2022, Chrome 93+)
  if (!Object.hasOwn) {
    Object.hasOwn = function(obj, prop) {
      return Object.prototype.hasOwnProperty.call(obj, prop);
    };
  }
  // String.prototype.replaceAll (ES2021, Chrome 85+)
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function(search, replacement) {
      if (typeof search === 'string') {
        return String(this).split(search).join(replacement);
      }
      if (Object.prototype.toString.call(search) === '[object RegExp]') {
        if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
        return String(this).replace(search, replacement);
      }
      return String(this).split(String(search)).join(replacement);
    };
  }
  // Promise.any + AggregateError (ES2021, Chrome 85+)
  if (!Promise.any) {
    var AggregateErrorImpl = typeof AggregateError !== 'undefined' ? AggregateError : (function(errors, message) {
      var e = Error.call(this, message);
      this.errors = errors;
      this.message = message || '';
      this.name = 'AggregateError';
      if (Error.captureStackTrace) Error.captureStackTrace(this, AggregateErrorImpl);
      return this;
    });
    if (typeof AggregateError === 'undefined') {
      AggregateErrorImpl.prototype = Object.create(Error.prototype);
      AggregateErrorImpl.prototype.constructor = AggregateErrorImpl;
      window.AggregateError = AggregateErrorImpl;
      self.AggregateError = AggregateErrorImpl;
    }
    Promise.any = function(promises) {
      return new Promise(function(resolve, reject) {
        var errors = [];
        var remaining = 0;
        var list = Array.from(promises || []);
        if (list.length === 0) {
          reject(new AggregateErrorImpl([], 'All promises were rejected'));
          return;
        }
        remaining = list.length;
        for (var i = 0; i < list.length; i++) {
          (function(idx) {
            Promise.resolve(list[idx]).then(function(val) {
              resolve(val);
            }, function(err) {
              errors[idx] = err;
              remaining--;
              if (remaining === 0) {
                reject(new AggregateErrorImpl(errors, 'All promises were rejected'));
              }
            });
          })(i);
        }
      });
    };
  }
  // Array.prototype.at (ES2022, Chrome 92+)
  if (!Array.prototype.at) {
    Array.prototype.at = function(index) {
      var len = this.length;
      var relativeIndex = index < 0 ? len + index : index;
      if (relativeIndex < 0 || relativeIndex >= len) return undefined;
      return this[relativeIndex];
    };
  }
  // String.prototype.at (ES2022, Chrome 92+)
  if (!String.prototype.at) {
    String.prototype.at = function(index) {
      var len = this.length;
      var relativeIndex = index < 0 ? len + index : index;
      if (relativeIndex < 0 || relativeIndex >= len) return undefined;
      return this.charAt(relativeIndex);
    };
  }
})();

import Vue from 'vue';
import App from './App.vue';
import router from './router';
import store from './store';
import ModalDialog from './components/ModalDialog.vue';
import LoadingSkeleton from './components/LoadingSkeleton.vue';
import ErrorBoundary from './components/ErrorBoundary.vue';
import AppShell from './components/AppShell.vue';
import { globalErrorHandler } from '@shared/errors';
import { getServiceRegistry } from '@/core/service-registry';
import { getEventBus } from '@/core/event-bus';
import { getThemeEngine } from '@/core/theme-engine';
import { getHotkeyManager } from '@/core/hotkey-manager';
import { getSearchRegistry } from '@/core/search-registry';
import { getIntegrationManager } from '@/integrations';
import { getRuntimeKernel } from '@/core/runtime-kernel';
import { getPerfPolicy } from '@/core/perf-policy';
import { createContext } from '@/core/market-sdk';
import api from '@/utils/api';
import wsManager from '@/utils/websocket';
import realtime from '@/utils/realtime';
import { marketRegistry, define } from '@/core/market-registry';
import { ROUTE_APP_MAP } from '@/core/router-aggregator';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles/global.scss';

Vue.config.productionTip = false;
Vue.config.errorHandler = function(err, vm, info) {
  console.error('[Vue Error]', info, err);
  globalErrorHandler.handle(err);
};

window.onerror = function(msg, url, line, col, error) {
  console.error('[Global Error]', msg, url, line, col, error);
  globalErrorHandler.handle(error || msg);
};

window.addEventListener('unhandledrejection', function(event) {
  console.error('[Unhandled Rejection]', event.reason);
  globalErrorHandler.handle(event.reason);
});

Vue.component('ModalDialog', ModalDialog);
Vue.component('LoadingSkeleton', LoadingSkeleton);
Vue.component('ErrorBoundary', ErrorBoundary);
Vue.component('AppShell', AppShell);

var ModalPlugin = {
  install: function(VueConstructor) {
    VueConstructor.prototype.$modal = {
      _instance: null,
      _setInstance: function(instance) {
        this._instance = instance;
      },
      alert: function(options) {
        if (this._instance) return this._instance.alert(options);
        return Promise.resolve(true);
      },
      confirm: function(options) {
        if (this._instance) return this._instance.confirm(options);
        return Promise.resolve(false);
      },
      prompt: function(options) {
        if (this._instance) return this._instance.prompt(options);
        return Promise.resolve(null);
      }
    };
  }
};

Vue.use(ModalPlugin);

router.onError(function(error) {
  console.error('[Router] Navigation error:', error.message);
});

var originalPush = router.push;
router.push = function(location) {
  return originalPush.call(this, location).catch(function(err) {
    if (err && err.name !== 'NavigationDuplicated' && err.name !== 'NavigationAborted') {
      console.error('[Router] Push error:', err);
    }
    return Promise.reject(err);
  });
};

var originalReplace = router.replace;
router.replace = function(location) {
  return originalReplace.call(this, location).catch(function(err) {
    if (err && err.name !== 'NavigationDuplicated' && err.name !== 'NavigationAborted') {
      console.error('[Router] Replace error:', err);
    }
    return Promise.reject(err);
  });
};

// ============================================================
// 启动流程：分阶段编排（RuntimeKernel.boot）
// ============================================================
// 每个阶段可注册多个 handler。任一 handler 抛错只记录 + 派发事件，不阻断后续阶段，
// 从而把「一处失败导致整页白屏」降级为「该环节缺失但应用仍可用」。
// 阶段顺序见 client/src/core/runtime-kernel.js 的 BOOT_STAGES。
// ============================================================

var kernel = getRuntimeKernel();
var boot = kernel.boot;

// 收集第三方应用清理函数（供 MarketRegistry 卸载时调用）
var _contextDisposers = {};

// 内核诊断错误：打印一条汇总，便于排查
boot.onStageError(function(rec) {
  try {
    console.error('[Boot] 阶段 "' + rec.stage + '" 的 "' + rec.name + '" 失败（已降级继续）:', rec.error && rec.error.message);
  } catch (e) {}
});

// ---------- 阶段：services ----------
boot.onStage('services', 'serviceRegistry', function() {
  var serviceRegistry = getServiceRegistry();
  serviceRegistry.register('eventBus', function() { return getEventBus(); });
  serviceRegistry.register('store', function() { return store; });
  serviceRegistry.register('themeEngine', function() { return getThemeEngine(); });
  serviceRegistry.register('hotkey', function() { return getHotkeyManager(); });
  serviceRegistry.register('integration', function() { return getIntegrationManager(); });
  serviceRegistry.register('search', function() { return getSearchRegistry(); });
  serviceRegistry.register('perfPolicy', function() { return getPerfPolicy(); });
  // 暴露到 Vue 原型，供组件通过 this.$services.resolve('xxx') 访问
  Vue.prototype.$services = serviceRegistry;
  // 让 AppShell / 第三方可通过全局访问主题引擎（订阅主题变化）
  window.__getThemeEngine = function() { return getThemeEngine(); };

  // 性能策略：设备能力探测 + 毛玻璃降级（§5.5.3）
  // 在 services 阶段初始化，早于任何视图挂载，避免首屏先渲染再降级导致的闪变
  try {
    getPerfPolicy().init({ eventBus: getEventBus() });
    window.__getPerfPolicy = function() { return getPerfPolicy(); };
  } catch (e) {
    console.error('[main] PerfPolicy 初始化失败:', e);
  }

  // 注册四类模块到统一注册表（定位见 docs/ecosystem-design.md §1.5）
  kernel.modules.register('component', 'AppShell', { label: '应用统一容器', version: '1' });
});

// ---------- 阶段：sdk ----------
boot.onStage('sdk', 'sdkExpose', function() {
  // 设置 window.__router 供 SearchRegistry 的应用搜索使用
  window.__router = router;

  var marketSdk = {
    version: '1',
    apps: {},

    define: function(definition) {
      var result = define(definition);
      marketSdk.apps[result.name] = result;
      // 注册到统一模块表（类型：app）
      try {
        kernel.modules.register('app', result.name, {
          label: (definition && (definition.label || definition.name)) || result.name,
          source: 'market',
          manifest: (definition && definition.manifest) || null
        });
      } catch (e) {}
      return result;
    },

    // 构造第三方应用上下文（五大命名空间，见 client/src/core/market-sdk.js）
    createContext: function(appName, appManifest) {
      var themeEngine = getThemeEngine();
      var context = createContext(appName, {
        api: api,
        websocket: wsManager,
        realtime: realtime,
        router: router,
        store: store,
        themeEngine: themeEngine,
        eventBus: getEventBus(),
        modal: Vue.prototype.$modal,
        manifest: appManifest || null,
        appVersion: (appManifest && appManifest.version) || '0.0.0',
        // 让 SDK 能拿到该应用的资源审计器（记录 storage 前缀）
        getAuditor: function(name) {
          return kernel.getAuditor(name);
        }
      });

      // 注销登记：应用卸载时统一释放（幂等）
      _contextDisposers[appName] = function() {
        if (context && context.__internal && typeof context.__internal.dispose === 'function') {
          return context.__internal.dispose();
        }
        return 0;
      };

      // 同步注册到生命周期机（若尚未创建）
      if (!kernel.getMachine(appName)) {
        kernel.attachLifecycle(appName, {});
      }

      return context;
    },

    // 供运行时调用：释放指定应用的上下文（契约：先执行 onDestroy，再回收资源）
    disposeContext: function(appName) {
      var fn = _contextDisposers[appName];
      if (typeof fn === 'function') {
        delete _contextDisposers[appName];
        return fn();
      }
      return 0;
    },

    // 内核诊断（开发调试用；第三方不应依赖）
    diagnostics: function() {
      try { return kernel.diagnostics(); } catch (e) { return null; }
    },

    // 模块注册表摘要：应用/插件/主题/组件的数量
    moduleSummary: function() {
      try { return kernel.modules.summary(); } catch (e) { return {}; }
    }
  };

  window.ClassIntraMarket = marketSdk;
  window.ClassIntra = window.ClassIntraMarket; // 别名（文档中的 window.ClassIntra 写法）
});

// ---------- 阶段：realtime ----------
boot.onStage('realtime', 'connect', function() {
  // 全局实时事件通道：第三方应用可直接订阅，不依赖 Chat 应用。
  if (localStorage.getItem('token')) {
    try { realtime.connect(); } catch (e) {
      // 实时通道失败不阻断启动：应用仍可挂载，只是收不到推送
      console.warn('[Boot] realtime 连接失败（降级为无实时）:', e && e.message);
    }
  }
});

// ---------- 阶段：market ----------
boot.onStage('market', 'refreshApps', function() {
  var initialPath = window.location.pathname + window.location.search + window.location.hash;
  return marketRegistry.refresh().then(function(apps) {
    router.registerMarketApps(apps);
    if (initialPath !== '/' && router.currentRoute && router.currentRoute.path !== initialPath) {
      return router.replace(initialPath).catch(function() {});
    }
    return null;
  }).catch(function(err) {
    // 市场清单拉取失败不阻断启动：已安装应用的路由可能在本地缓存中
    console.warn('[Boot] 市场应用刷新失败（降级）:', err && err.message);
  });
});

// ---------- 阶段：mount ----------
boot.onStage('mount', 'mountApp', function() {
  new Vue({
    router: router,
    store: store,
    render: function(h) { return h(App); }
  }).$mount('#app');
});

// ---------- 执行编排 ----------
boot.run().then(function(result) {
  if (result.errors.length > 0) {
    try {
      console.warn('[Boot] 启动完成，但有 ' + result.errors.length + ' 个降级项:',
        result.errors.map(function(e) { return e.stage + '/' + e.name; }).join(', '));
    } catch (e) {}
  }
  // 就绪回调（保持既有约定）
  if (typeof window.__onVueReady === 'function') {
    window.__onVueReady();
  }
}).catch(function(err) {
  // 编排器自身不应抛错；此处为兜底
  console.error('[Boot] 编排器异常:', err);
  try {
    new Vue({
      router: router,
      store: store,
      render: function(h) { return h(App); }
    }).$mount('#app');
    if (typeof window.__onVueReady === 'function') window.__onVueReady();
  } catch (e) {
    console.error('[Boot] 兜底挂载失败:', e);
  }
});
