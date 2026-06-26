import Vue from 'vue';
import VueRouter from 'vue-router';
import api from '@/utils/api';

Vue.use(VueRouter);

// 应用管控：路由路径到应用名的映射
var ROUTE_APP_MAP = {
  '/chat': 'chat',
  '/community': 'community',
  '/ai-chat': 'ai-chat',
  '/notes': 'notes',
  '/resource': 'resource',
  '/weather': 'weather',
  '/music': 'music',
  '/settings': 'settings'
};
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
    enabledAppsCache = ['chat', 'community', 'ai-chat', 'notes', 'resource', 'weather', 'music', 'settings'];
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
  },
  {
    path: '/chat',
    name: 'Chat',
    component: function() { return import('@/views/Chat.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/community',
    name: 'Community',
    component: function() { return import('@/views/Community.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/weather',
    name: 'Weather',
    component: function() { return import('@/views/Weather.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/music',
    name: 'Music',
    component: function() { return import('@/views/Music.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/ai-chat',
    name: 'AIChat',
    component: function() { return import('@/views/AIChat.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/notes',
    name: 'Notes',
    component: function() { return import('@/views/Notes.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/resource',
    name: 'Resource',
    component: function() { return import('@/views/Resource.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/cloud',
    name: 'CloudDrive',
    component: function() { return import('@/views/CloudDrive.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/cloud-upload',
    name: 'CloudUpload',
    component: function() { return import('@/views/CloudUpload.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/guest-upload',
    name: 'GuestUpload',
    component: function() { return import('@/views/GuestUpload.vue'); }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: function() { return import('@/views/Settings.vue'); },
    meta: { requiresAuth: true }
  },
  {
    path: '/admin',
    name: 'Admin',
    component: function() { return import('@/views/Admin.vue'); },
    meta: { requiresAuth: true, requiresAdmin: true }
  },
  {
    path: '*',
    redirect: '/'
  }
];

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

  // 应用管控：检查目标路由对应的应用是否启用
  var appName = ROUTE_APP_MAP[to.path];
  if (appName && to.meta.requiresAuth && token) {
    // 管理员/班干不受应用管控限制（确保能管理）
    var isAdminUser = user && (user.is_admin === 1 || user.is_admin === true || user.role === 'officer');
    if (isAdminUser) {
      proceedWithAdminCheck(to, next);
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
    if (user && (user.is_admin === 1 || user.is_admin === true || user.role === 'officer')) {
      next();
    } else if (token) {
      api.get('/auth/check-status').then(function(response) {
        var data = response.data;
        if (data.code === 200 && data.data && data.data.user_info) {
          var userInfo = data.data.user_info;
          localStorage.setItem('user', JSON.stringify(userInfo));
          try { router.app.$store.commit('auth/SET_USER', userInfo); } catch (e) {}
          if (userInfo.is_admin === 1 || userInfo.is_admin === true || userInfo.role === 'officer') {
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

export default router;
