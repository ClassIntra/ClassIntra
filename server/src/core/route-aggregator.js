// 后端聚合层：路由聚合器
// 扫描 apps/*/backend/，按 manifest.json 声明挂载到 express
// 支持 manifest.backend.rateLimit 自动应用限流中间件

var fs = require('fs');
var path = require('path');
var manifestLoader = require('./manifest-loader');
var rateLimitLib = require('../middleware/rate-limit').createRateLimiter;

// 挂载所有应用的后端路由到 express app
function mountAppRoutes(app) {
  var manifests = manifestLoader.loadManifests();
  var mounted = 0;
  manifests.forEach(function(m) {
    if (!m.backend || !m.backend.mountPath || !m.backend.entry) return;
    var entryPath = manifestLoader.getAppEntryPath(m.name, m.backend.entry);
    if (!fs.existsSync(entryPath)) {
      console.error('[route-aggregator] 后端入口不存在:', m.name, entryPath);
      return;
    }
    try {
      // 清除 require 缓存（开发时热加载）
      delete require.cache[require.resolve(entryPath)];
      var router = require(entryPath);
      // 应用 manifest 中声明的 rateLimit
      if (m.backend.rateLimit) {
        var opts = m.backend.rateLimit;
        var rlOpts = { max: opts.max, windowMs: opts.windowMs };
        if (opts.message) rlOpts.message = opts.message;
        app.use(m.backend.mountPath, rateLimitLib(rlOpts));
      }
      app.use(m.backend.mountPath, router);
      mounted++;
      console.log('[route-aggregator] 挂载应用路由:', m.name, '->', m.backend.mountPath);
    } catch (e) {
      console.error('[route-aggregator] 挂载应用路由失败:', m.name, e.message);
    }
  });
  console.log('[route-aggregator] 共挂载 ' + mounted + ' 个应用路由');
}

// 获取所有已声明 backend 的应用列表（供管理后台展示）
function getBackendApps() {
  var manifests = manifestLoader.loadManifests();
  return manifests
    .filter(function(m) { return m.backend && m.backend.mountPath; })
    .map(function(m) {
      return {
        name: m.name,
        label: m.label,
        mountPath: m.backend.mountPath,
        hasRateLimit: !!m.backend.rateLimit
      };
    });
}

module.exports = {
  mountAppRoutes: mountAppRoutes,
  getBackendApps: getBackendApps
};
