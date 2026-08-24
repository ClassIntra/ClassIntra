import Vue from 'vue';
import VueRouter from 'vue-router';
import api from '@/utils/api';
import { appRoutes, ROUTE_APP_MAP } from '@/core/router-aggregator';
import MarketRuntime from '@/components/MarketRuntime.vue';

Vue.use(VueRouter);

// ROUTE_APP_MAP 现由 @/core/router-aggregator 从 apps/*/manifest.json 聚合产生
// browser 路由不通过 manifest 注册（写死在下方路由表）
// 注：超能岛浏览器不通过应用管控，改为 per-user browser_enabled 控制
ROUTE_APP_MAP['/browser'] = 'browser';
// 启用应用列表缓存（null=未加载，数组=已加载）
var enabledAppsCache = null;
var enabledAppsLoading = null;

// 获取启用应用列表（带缓存，避免每次路由跳转都请求后端）
function getEnabledApps() {
  if (enabledAppsCache !== null) {
    return Promise.resolve(enabledAppsCache);
  }
  if (enabledAppsLoading) {
    return enabledAppsLoading;
  }
  enabledAppsLoading = api.get('/system/app-control').then(function(response) {
    var data = response.data.data || {};
    enabledAppsCache = data.enabled_apps || [];
    enabledAppsLoading = null;
    return enabledAppsCache;
  }).catch(function() {
    // 降级：全部启用
    enabledAppsCache = ['chat', 'community', 'ai-chat', 'notes', 'resource', 'weather', 'music', 'settings', 'timetable', 'calendar', 'countdown', 'browser'];
    enabledAppsLoading = null;
    return enabledAppsCache;
  });
  return enabledAppsLoading;
}

// 清除应用管控缓存（管理员修改后可调用以刷新）
function clearAppControlCache() {
  enabledAppsCache = null;
  enabledAppsLoading = null;
}

var routes = [
  {
    path: '/login',
    name: 'Login',
    component: function() { return import('@/views/Login.vue'); }
  },
  {
    path: '/register',
    name: 'Register',
    component: function() { return import('@/views/Register.vue'); }
  },
  {
    path: '/banned',
    name: 'Banned',
    component: function() { return import('@/views/Banned.vue'); }
  },
  {
    path: '/',
    name: 'Desktop',
    component: function() { return import('@/views/Desktop.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/announcements',
    name: 'Announcements',
    component: function() { return import('@/views/Announcements.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/browser',
    name: 'Browser',
    component: function() { return import('@/views/Browser.vue'); },
    meta: { requiresAuth: true }
  }
].concat(appRoutes).concat([
  {
    path: '*',
    redirect: '/'
  }
]);

var router = new VueRouter({
  mode: 'history',
  routes: routes
});

router.beforeEach(function(to, from, next) {
  var token = localStorage.getItem('token');
  var user = (function() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { localStorage.removeItem('user'); return null; } })();

  if (user && user.status === 'disabled' && to.name !== 'Banned') {
    next({ name: 'Banned' });
    return;
  }

  if (to.name === 'Banned') {
    next();
    return;
  }

  if (to.meta.requiresAuth && !token) {
    next({ name: 'Login' });
    return;
  }

  if (unloadedMarketRoutes[to.path]) {
    next({ name: 'Desktop' });
    return;
  }

  // 应用管控：检查目标路由对应的应用是否启用
  var appName = ROUTE_APP_MAP[to.path];
  if (appName && to.meta.requiresAuth && token) {
    // 管理员/班干不受应用管控限制（确保能管理）
    var isAdminUser = user && (user.is_admin === 1 || user.is_admin === true || user.is_class_admin === true || user.role === 'officer');
    if (isAdminUser && !to.meta.market) {
      proceedWithAdminCheck(to, next);
      return;
    }
    // 超能岛浏览器：不通过应用管控，改为检查 per-user 的 browser_enabled 字段
    // browser_enabled 在 Admin → 用户列表 → 编辑用户 → 超能岛浏览器 中配置
    if (appName === 'browser') {
      var browserEnabled = user && user.info && user.info.browser_enabled;
      if (browserEnabled) {
        proceedWithAdminCheck(to, next);
      } else {
        next({ name: 'Desktop' });
      }
      return;
    }
    getEnabledApps().then(function(enabledApps) {
      if (enabledApps.indexOf(appName) === -1) {
        // 应用被禁用，重定向到桌面
        next({ name: 'Desktop' });
      } else {
        proceedWithAdminCheck(to, next);
      }
    });
    return;
  }

  proceedWithAdminCheck(to, next);
});

// 处理 requiresAdmin 路由的权限检查（从原 beforeEach 抽取）
function proceedWithAdminCheck(to, next) {
  if (to.meta.requiresAdmin) {
    var token = localStorage.getItem('token');
    var user = (function() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { return null; } })();
    if (user && (user.is_admin === 1 || user.is_admin === true || user.is_class_admin === true || user.role === 'officer')) {
      next();
    } else if (token) {
      api.get('/auth/check-status').then(function(response) {
        var data = response.data;
        if (data.code === 200 && data.data && data.data.user_info) {
          var userInfo = data.data.user_info;
          localStorage.setItem('user', JSON.stringify(userInfo));
          try { router.app.$store.commit('auth/SET_USER', userInfo); } catch (e) {}
          if (userInfo.is_admin === 1 || userInfo.is_admin === true || userInfo.is_class_admin === true || userInfo.role === 'officer') {
            next();
          } else {
            next({ name: 'Desktop' });
          }
        } else {
          next({ name: 'Desktop' });
        }
      }).catch(function() {
        next({ name: 'Desktop' });
      });
    } else {
      next({ name: 'Desktop' });
    }
  } else {
    next();
  }
}

// 导出缓存清除函数，供管理页面调用
router.clearAppControlCache = clearAppControlCache;
var marketRoutes = {};
var unloadedMarketRoutes = {};
router.registerMarketApps = function(apps) {
  var nextRoutes = {};
  (Array.isArray(apps) ? apps : []).forEach(function(app) {
    if (!app || !app.name || !app.route) return;
    nextRoutes[app.name] = app;
    delete unloadedMarketRoutes[app.route];
    var existing = marketRoutes[app.name];
    if (existing && existing.route === app.route) {
      existing.app = app;
      return;
    }
    if (ROUTE_APP_MAP[app.route] && ROUTE_APP_MAP[app.route] !== app.name) return;
    ROUTE_APP_MAP[app.route] = app.name;
    marketRoutes[app.name] = { route: app.route };
    router.addRoutes([{
      path: app.route,
      name: 'Market_' + app.name,
      component: MarketRuntime,
      props: { appName: app.name },
      meta: { requiresAuth: true, appName: app.name, market: true }
    }]);
  });
  Object.keys(marketRoutes).forEach(function(name) {
    if (!nextRoutes[name]) {
      var route = marketRoutes[name].route;
      unloadedMarketRoutes[route] = true;
      delete ROUTE_APP_MAP[route];
      delete marketRoutes[name];
    }
  });
};

export default router;
