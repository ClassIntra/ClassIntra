// 后端聚合层：路由聚合器
// 扫描 apps/ 与 plugins/ 下的 backend/，按 manifest.json 声明挂载到 express
// 支持 manifest.backend.rateLimit 自动应用限流中间件

var fs = require('fs');
var path = require('path');
var manifestLoader = require('./manifest-loader');
var rateLimitLib = require('../middleware/rate-limit').createRateLimiter;
var hotReload = require('./hot-reload');

// 读取 app_control 表中的模块启停状态（与 market-service 调度器共用同一份真相）。
// 无记录视为启用；表未就绪或查询失败一律按启用处理，保证正常环境行为不变。
function _isModuleEnabled(name) {
  try {
    var db = require('../utils/db');
    var row = db.prepare('SELECT enabled FROM app_control WHERE app_name = ?').get(name);
    return !row || !!row.enabled;
  } catch (e) {
    return true;
  }
}

// 插件启停闸门：被暂停的插件不对外提供任何接口。
// 采用「请求期校验」而不是「启动期跳过挂载」，让暂停/启用即时生效、无需重启进程。
function _pluginGate(manifest) {
  var label = manifest.label || manifest.name;
  return function (req, res, next) {
    if (_isModuleEnabled(manifest.name)) return next();
    res.status(404).json({ code: 404, message: '插件「' + label + '」已暂停' });
  };
}

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
    // 插件启停闸门（置于限流与路由之前）：声明 canDisable === false 的插件常开，不受管控
    if (m._sourceType === 'plugin' && m.canDisable !== false) {
      app.use(backend.mountPath, _pluginGate(m));
    }
    // rateLimit 挂在代理/路由外层，热重载时限流规则保持不变
    if (backend.rateLimit) {
      var opts = backend.rateLimit;
      var rlOpts = { max: opts.max, windowMs: opts.windowMs };
      if (opts.message) rlOpts.message = opts.message;
      app.use(backend.mountPath, rateLimitLib(rlOpts));
    }
    if (hotReload.enabled()) {
      // 开发模式：惰性热重载代理（CLASSINTRA_HOT_RELOAD=1）
      var watchDir = path.dirname(entryPath);
      app.use(backend.mountPath, hotReload.createHotProxy(appName + ':' + backend.mountPath, entryPath, watchDir));
      console.log('[route-aggregator] 挂载应用路由(热重载):', appName, '->', backend.mountPath);
    } else {
      // 生产模式：一次性加载
      delete require.cache[require.resolve(entryPath)];
      var router = require(entryPath);
      app.use(backend.mountPath, router);
      console.log('[route-aggregator] 挂载应用路由:', appName, '->', backend.mountPath);
    }
    return true;
  } catch (e) {
    console.error('[route-aggregator] 挂载应用路由失败:', appName, e.message);
    return false;
  }
}

// 挂载所有应用/插件的后端路由到 express app
// 支持 manifest.backend（主）和 manifest.extraBackends（数组，附加挂载点）
// 注意：market 来源（market-apps/ 第三方应用）不在此挂载，由 market-service 热挂载（支持安装/卸载/更新不重启）
function mountAppRoutes(app) {
  var manifests = manifestLoader.loadManifests();
  var mounted = 0;
  var appCount = 0;
  var pluginCount = 0;
  var marketCount = 0;
  manifests.forEach(function(m) {
    // market 应用仅统计，挂载交给 market-service.init()
    if (m._sourceType === 'market') {
      if (m.backend && m.backend.mountPath) marketCount++;
      return;
    }
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
  console.log('[route-aggregator] 共挂载 ' + mounted + ' 个路由（应用 ' + appCount + ' + 插件 ' + pluginCount + '）' +
    (marketCount > 0 ? '，市场应用 ' + marketCount + ' 个待 market-service 热挂载' : ''));
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
