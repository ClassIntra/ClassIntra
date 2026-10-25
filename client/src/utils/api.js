import axios from 'axios';
import store from '@/store';
import router from '@/router';

var api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  withCredentials: true
});

api.interceptors.request.use(function(config) {
  // 断网时只放行心跳请求，其他请求直接拒绝
  if (!store.state.network.online && config.url && config.url.indexOf('/auth/check-status') === -1) {
    return Promise.reject({ __offline: true, message: '网络不可用' });
  }
  var token = store.state.auth.token;
  if (token) {
    config.headers.Authorization = 'Bearer ' + token;
  }
  var noCachePaths = ['/auth/', '/chat/', '/community/posts', '/community/search', '/community/my/', '/community/bookmarks', '/community/ranking', '/community/reactions', '/user/settings', '/music/'];
  var needsNoCache = false;
  if (config.method === 'get') {
    for (var i = 0; i < noCachePaths.length; i++) {
      if (config.url && config.url.indexOf(noCachePaths[i]) !== -1) {
        needsNoCache = true;
        break;
      }
    }
  }
  if (needsNoCache || config.method !== 'get') {
    config.headers['Cache-Control'] = 'no-cache, no-store';
    config.headers['Pragma'] = 'no-cache';
  }
  if (needsNoCache && config.method === 'get') {
    config.params = config.params || {};
    config.params._t = Date.now();
  }
  return config;
});

var _isLoggingOut = false;
var _networkFailCount = 0;
var _NETWORK_FAIL_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// 401 静默自救（用户体验优先）
//
// 原则：**不要因为一次本可恢复的 401，就把人踢回登录页。**
// 被踢走意味着他正在填的表单、正在看的页面、正在写的内容全丢；而多数情况下
// 他的登录态其实是好的 —— 典型是浏览器里残留的旧 cookie 盖住了有效凭据，
// 或者 token 刚过期而本可以顺手续一次。
//
// 做法：拿到 401 时先用当前 token 静默换一个新 token（refresh-token），
// 成功就**原样重发**刚才那次请求 —— 用户完全无感；失败才按老规矩登出 + 跳登录页，
// 并且给一句明确的原因（而不是让他莫名其妙地"瞬移"到登录页）。
// ---------------------------------------------------------------------------
var _refreshPromise = null;         // 并发 401 共用同一次刷新，避免刷新风暴
var _AUTH_RETRY_FLAG = '__authRetried';

// 这些端点自身不参与自救：登录/注册/登出/刷新，避免把错误状态搅混、或递归刷新
var _NO_RETRY_URLS = ['/auth/login', '/auth/register', '/auth/logout', '/auth/refresh-token'];

function isNoRetryUrl(url) {
  if (typeof url !== 'string') return false;
  for (var i = 0; i < _NO_RETRY_URLS.length; i++) {
    if (url.indexOf(_NO_RETRY_URLS[i]) !== -1) return true;
  }
  return false;
}

// 用当前 token 静默续签；成功返回新 token，失败 reject
function silentRefresh() {
  if (_refreshPromise) return _refreshPromise;
  var token = store.state.auth.token;
  if (!token) return Promise.reject(new Error('no token'));

  // 用**裸 axios**（不经过本实例的拦截器）：避免 401 → 刷新 → 再 401 的递归
  _refreshPromise = axios.post('/api/auth/refresh-token', null, {
    headers: { Authorization: 'Bearer ' + token },
    timeout: 10000
  }).then(function(resp) {
    var body = resp.data || {};
    if (body.code !== 200 || !body.data || !body.data.token) {
      throw new Error((body && body.message) || '续签失败');
    }
    store.commit('auth/SET_TOKEN', body.data.token);
    if (body.data.user_info) store.commit('auth/SET_USER', body.data.user_info);
    return body.data.token;
  });

  function done() { _refreshPromise = null; }
  _refreshPromise.then(done, done);
  return _refreshPromise;
}

// 真正要登出时才走这里：清会话 + 跳登录页 + 说明原因
function forceLogout(reason) {
  if (_isLoggingOut) return;
  _isLoggingOut = true;
  if (reason) {
    try {
      // 只支持 success / error / info 三种样式（App.vue 的 .global-toast.*）
      store.commit('toast/SHOW_TOAST', { message: reason, type: 'error', duration: 4000 });
    } catch (e) { /* toast 失败不能影响登出 */ }
  }
  store.dispatch('auth/logout');
  router.push({ name: 'Login' });
  setTimeout(function() { _isLoggingOut = false; }, 1000);
}

api.interceptors.response.use(
  function(response) {
    // 请求成功，重置失败计数并标记在线
    _networkFailCount = 0;
    if (!store.state.network.online) {
      store.commit('network/SET_ONLINE', true);
    }
    return response;
  },
  function(error) {
    // 断网拦截的请求，静默拒绝
    if (error.__offline) {
      return Promise.reject(error);
    }
    // 网络错误（无响应）时累计失败次数，连续5次才触发保护
    if (!error.response) {
      _networkFailCount++;
      if (_networkFailCount >= _NETWORK_FAIL_THRESHOLD && store.state.network.online) {
        store.commit('network/SET_ONLINE', false);
        // 同步隐藏所有内容
        document.documentElement.classList.add('offline-secure');
        document.title = '';
      }
    } else {
      // 有响应，服务器在线，重置计数
      _networkFailCount = 0;
    }
    // 403「该账号已被禁用」：**任何**接口都可能返回它（浏览途中被封最常见）。
    // 之前只有 /auth/check-status 的响应对它做了处理，其它页面会被 axios 当普通错误吞掉，
    // 于是用户看到的不是「你被封禁了」，而是「这个人没发过帖子」这种假空态。
    // 这里统一广播一次，由 App.vue 落到账号状态并跳转封禁页。
    if (error.response && error.response.status === 403) {
      var banBody = error.response.data;
      if (banBody && Number(banBody.code) === 403 && /已被禁用/.test(String(banBody.message || ''))) {
        try {
          window.dispatchEvent(new CustomEvent('classintra-account-disabled', {
            detail: { reason: banBody.ban_reason || '', expiresAt: banBody.ban_expires_at || null }
          }));
        } catch (e) { /* 页面自身的错误态会兜底 */ }
      }
    }

    if (error.response && error.response.status === 401) {
      // 公开页面（登录/注册/封禁页）不跳转，避免心跳检测把未登录用户踢出注册页
      var publicRoutes = ['Login', 'Register', 'Banned'];
      var currentRouteName = router.currentRoute && router.currentRoute.name;
      var onPublicRoute = publicRoutes.indexOf(currentRouteName) !== -1;
      var cfg = error.config || {};

      // ① 先尝试静默续签 + 原样重发：成功则用户无感
      if (!onPublicRoute && !isNoRetryUrl(cfg.url) && !cfg[_AUTH_RETRY_FLAG] && store.state.auth.token) {
        cfg[_AUTH_RETRY_FLAG] = true;   // 每个请求只自救一次，防止无限重试
        return silentRefresh().then(function() {
          return api(cfg);              // 拦截器会用新 token 重新装上 Authorization
        }).catch(function() {
          // ② 续签也失败 → 这次是真的要重新登录了，给出明确原因再跳
          forceLogout('登录状态已失效，请重新登录');
          return Promise.reject(error);
        });
      }

      // 不该自救（或已经试过）→ 按老规矩处理
      if (!onPublicRoute) forceLogout('登录状态已失效，请重新登录');
    }
    return Promise.reject(error);
  }
);

export default api;
