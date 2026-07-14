// 后端聚合层：路由聚合器
// 扫描 apps/ 与 plugins/ 下的 backend/，按 manifest.json 声明挂载到 express
// 支持 manifest.backend.rateLimit 自动应用限流中间件

var fs = require('fs');
var path = require('path');
var manifestLoader = require('./manifest-loader');
var rateLimitLib = require('../middleware/rate-limit').createRateLimiter;

// 挂载单个 backend 声明（主 backend 或 extraBackends 中的一项）
// backend 形如 { mountPath, entry, rateLimit? }
// m 为完整 manifest 对象，携带 _sourceDir 用于解析入口路径
function _mountOne(app, m, backend) {
  if (!backend || !backend.mountPath || !backend.entry) return false;
  var appName = m.name;
  // _sourceDir 标记 manifest 来源目录（apps/ 或 plugins/）
  var entryPath = manifestLoader.getAppEntryPath(appName, backend.entry, m._sourceDir);
  if (!fs.existsSync(entryPath)) {
    console.error('[route-aggregator] 后端入口不存在:', appName, entryPath);
    return false;
  }
  try {
    // 清除 require 缓存（开发时热加载）
    delete require.cache[require.resolve(entryPath)];
    var router = require(entryPath);
    // 应用 manifest 中声明的 rateLimit
    if (backend.rateLimit) {
      var opts = backend.rateLimit;
      var rlOpts = { max: opts.max, windowMs: opts.windowMs };
      if (opts.message) rlOpts.message = opts.message;
      app.use(backend.mountPath, rateLimitLib(rlOpts));
    }
    app.use(backend.mountPath, router);
    console.log('[route-aggregator] 挂载应用路由:', appName, '->', backend.mountPath);
    return true;
  } catch (e) {
    console.error('[route-aggregator] 挂载应用路由失败:', appName, e.message);
    return false;
  }
}

// 挂载所有应用/插件的后端路由到 express app
// 支持 manifest.backend（主）和 manifest.extraBackends（数组，附加挂载点）
function mountAppRoutes(app) {
  var manifests = manifestLoader.loadManifests();
  var mounted = 0;
  var appCount = 0;
  var pluginCount = 0;
  manifests.forEach(function(m) {
    // 主 backend
    if (_mountOne(app, m, m.backend)) {
      mounted++;
      if (m._sourceType === 'plugin') pluginCount++; else appCount++;
    }
    // 附加 backends（extraBackends 数组，向后兼容无该字段的老 manifest）
    if (Array.isArray(m.extraBackends)) {
      m.extraBackends.forEach(function(eb) {
        if (_mountOne(app, m, eb)) {
          mounted++;
          if (m._sourceType === 'plugin') pluginCount++; else appCount++;
        }
      });
    }
  });
  console.log('[route-aggregator] 共挂载 ' + mounted + ' 个路由（应用 ' + appCount + ' + 插件 ' + pluginCount + '）');
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
