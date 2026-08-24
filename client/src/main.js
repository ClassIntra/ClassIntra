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
import { globalErrorHandler } from '@shared/errors';
import { getServiceRegistry } from '@/core/service-registry';
import { getEventBus } from '@/core/event-bus';
import { getThemeEngine } from '@/core/theme-engine';
import { getHotkeyManager } from '@/core/hotkey-manager';
import { getSearchRegistry } from '@/core/search-registry';
import { getIntegrationManager } from '@/integrations';
import api from '@/utils/api';
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

// ========== 阶段 3-5：ServiceRegistry 注册核心服务 ==========
var serviceRegistry = getServiceRegistry();
serviceRegistry.register('eventBus', function() { return getEventBus(); });
serviceRegistry.register('store', function() { return store; });
serviceRegistry.register('themeEngine', function() { return getThemeEngine(); });
serviceRegistry.register('hotkey', function() { return getHotkeyManager(); });
serviceRegistry.register('integration', function() { return getIntegrationManager(); });
serviceRegistry.register('search', function() { return getSearchRegistry(); });
// 暴露到 Vue 原型，供组件通过 this.$services.resolve('xxx') 访问
Vue.prototype.$services = serviceRegistry;

// ========== 阶段 5：全局搜索 ==========
// 设置 window.__router 供 SearchRegistry 的应用搜索使用（点击应用结果跳转路由）
window.__router = router;

window.ClassIntraMarket = {
  version: '1',
  apps: {},
  define: function(definition) {
    var result = define(definition);
    this.apps[result.name] = result;
    return result;
  },
  createContext: function(appName) {
    return {
      appName: appName,
      api: api,
      router: router,
      store: store,
      user: store.state.auth && store.state.auth.user,
      theme: getThemeEngine(),
      eventBus: getEventBus(),
      toast: { alert: function(options) { return Vue.prototype.$modal.alert(options); } },
      modal: Vue.prototype.$modal
    };
  }
};

marketRegistry.refresh().then(function(apps) {
  router.registerMarketApps(apps);
}).catch(function() {});

new Vue({
  router: router,
  store: store,
  render: function(h) { return h(App); }
}).$mount('#app');

if (typeof window.__onVueReady === 'function') {
  window.__onVueReady();
}
