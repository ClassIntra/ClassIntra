/* ClassIntra 静态站适配器（iframe ↔ 宿主 RPC 桥）
 * ============================================================
 * 静态站形态（frontend.static）的应用在 iframe 中运行，与宿主同源。
 * 引入本脚本（<script src="/ci-adapter.js"></script>）即可获得系统能力：
 *
 *   CI.user()                     → Promise<{ user_id, net_name, role, is_admin, is_class_admin }>
 *   CI.theme()                    → Promise<{ id, tokens }>（当前主题与令牌表）
 *   CI.back()                     → 返回桌面（AppShell 返回语义）
 *   CI.toast({ message, type })   → 系统级 toast（success/error/info）
 *   CI.onTheme(fn)                → 订阅主题变化（fn({id, tokens})，自动取消：页面卸载）
 *
 * 协议：postMessage { __ci: 1, id, method, params } → { __ci: 1, id, ok, result }
 *       推送：{ __ci: 1, event, data }（event: theme-changed）
 * 未接入宿主（独立打开页面）时所有调用安全降级（reject / 不推送）。
 * 纯 ES5，Chrome 80 基线。
 */
(function() {
  'use strict';
  var seq = 0;
  var pending = {};
  var themeListeners = [];
  var ready = null;

  function post(msg) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, '*');
        return true;
      }
    } catch (e) {}
    return false;
  }

  function rpc(method, params) {
    return new Promise(function(resolve, reject) {
      var id = 'ci' + (++seq);
      var sent = post({ __ci: 1, id: id, method: method, params: params || {} });
      if (!sent) {
        reject(new Error('CI adapter: 未运行在 ClassIntra 宿主内'));
        return;
      }
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function() {
        if (pending[id]) {
          pending[id].reject(new Error('CI adapter: 调用超时（' + method + '）'));
          delete pending[id];
        }
      }, 4000);
    });
  }

  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || d.__ci !== 1) return;
    if (d.event === 'theme-changed') {
      for (var i = 0; i < themeListeners.length; i++) {
        try { themeListeners[i](d.data || {}); } catch (err) {}
      }
      return;
    }
    if (d.id && pending[d.id]) {
      var p = pending[d.id];
      delete pending[d.id];
      if (d.ok) p.resolve(d.result);
      else p.reject(new Error(d.result || 'CI adapter: 调用失败'));
    }
  });

  window.CI = {
    version: '1',
    user: function() { return rpc('user'); },
    theme: function() { return rpc('theme'); },
    back: function() { return rpc('back'); },
    toast: function(options) { return rpc('toast', options || {}); },
    onTheme: function(fn) {
      if (typeof fn !== 'function') return function() {};
      themeListeners.push(fn);
      return function() {
        var idx = themeListeners.indexOf(fn);
        if (idx !== -1) themeListeners.splice(idx, 1);
      };
    }
  };
})();
