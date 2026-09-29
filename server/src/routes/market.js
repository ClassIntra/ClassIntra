// 市场路由：第三方应用市场的 REST API
// GET  /api/market/sources            获取可用市场源（需登录）
// GET  /api/market/installed          获取已安装的第三方应用（需登录）
// GET  /api/market/catalog            获取市场目录（需登录，服务端代理拉取）
// POST /api/market/install            安装应用（仅管理员/班管）
// POST /api/market/update             更新应用（仅管理员/班管）
// POST /api/market/uninstall          卸载应用（仅管理员/班管）

var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var marketService = require('../core/market-service');

function broadcastMarketChange(action, appName, result) {
  try {
    var chatServer = require('../ws/chat-server');
    chatServer.broadcast({
      type: 'market_app_changed',
      action: action,
      appName: appName,
      version: result && result.version ? result.version : ''
    });
  } catch (e) {
    console.error('[market] 广播应用变更失败:', e.message);
  }
}

// 可用市场源列表
router.get('/sources', auth.requireAuth, function(req, res) {
  res.json({ code: 200, data: { sources: marketService.getSources() } });
});

// 已安装的第三方应用
router.get('/installed', auth.requireAuth, function(req, res) {
  try {
    var apps = marketService.listInstalled();
    var isAdmin = req.user && (
      req.user.is_admin === 1 ||
      req.user.is_admin === true ||
      req.user.is_class_admin ||
      req.user.role === 'officer'
    );
    if (!isAdmin) {
      apps = apps.filter(function(app) { return app.enabled; });
    }
    res.json({ code: 200, data: { apps: apps } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取已安装应用失败' });
  }
});

// 市场目录（支持 ?source=gitee|github|local，默认 gitee）
router.get('/catalog', auth.requireAuth, function(req, res) {
  var sourceId = req.query.source || 'gitee';
  marketService.getCatalogWithFallback(sourceId).then(function(result) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({ code: 200, data: { source: result.source.id, catalog: result.catalog } });
  }).catch(function(e) {
    res.status(502).json({ code: 502, message: e.message || '获取市场目录失败' });
  });
});

// 市场目录静态资源代理（应用图标等）。
// <img> 标签无法携带 Authorization 头，且接入设备未必能直连市场源，
// 故与 /market-static 同等公开级别：路径校验 + 扩展名白名单 + 15MB 上限（在 market-service 内）。
router.get('/asset', function(req, res) {
  marketService.fetchAsset(String(req.query.source || 'gitee'), String(req.query.path || '')).then(function(result) {
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-cache'); // 不做强缓存，靠 ETag 协商
    // SVG 直接在浏览器打开时其中的 <script> 会执行，CSP 禁止一切内联资源（XSS 缓解）
    if (String(result.contentType).indexOf('svg') > -1) {
      res.setHeader('Content-Security-Policy', "default-src 'none'");
    }
    res.send(result.buffer);
  }).catch(function(e) {
    res.status(404).json({ code: 404, message: e.message || '资源不存在' });
  });
});

// 安装应用
router.post('/install', auth.requireAuth, auth.requireAdmin, function(req, res) {
  var name = req.body && req.body.name;
  var source = (req.body && req.body.source) || 'gitee';
  if (!name) return res.status(400).json({ code: 400, message: '缺少应用名' });
  marketService.installApp(name, source).then(function(result) {
    broadcastMarketChange('installed', name, result);
    res.json({ code: 200, data: result, message: '安装成功' });
  }).catch(function(e) {
    console.error('[market] 安装失败:', name, e.message);
    res.status(400).json({ code: 400, message: e.message || '安装失败' });
  });
});

// 更新应用
router.post('/update', auth.requireAuth, auth.requireAdmin, function(req, res) {
  var name = req.body && req.body.name;
  var source = (req.body && req.body.source) || 'gitee';
  if (!name) return res.status(400).json({ code: 400, message: '缺少应用名' });
  marketService.updateApp(name, source).then(function(result) {
    broadcastMarketChange('updated', name, result);
    res.json({ code: 200, data: result, message: '更新成功' });
  }).catch(function(e) {
    console.error('[market] 更新失败:', name, e.message);
    res.status(400).json({ code: 400, message: e.message || '更新失败' });
  });
});

// 卸载应用
router.post('/uninstall', auth.requireAuth, auth.requireAdmin, function(req, res) {
  var name = req.body && req.body.name;
  if (!name) return res.status(400).json({ code: 400, message: '缺少应用名' });
  marketService.uninstallApp(name).then(function(result) {
    broadcastMarketChange('uninstalled', name, result);
    res.json({ code: 200, data: result, message: '卸载成功' });
  }).catch(function(e) {
    console.error('[market] 卸载失败:', name, e.message);
    res.status(400).json({ code: 400, message: e.message || '卸载失败' });
  });
});

// ========== 插件市场 ==========

// 已安装插件列表
router.get('/plugins-installed', auth.requireAuth, function(req, res) {
  res.json({ code: 200, data: marketService.listInstalledPlugins() });
});

// 安装插件（管理员）
router.post('/install-plugin', auth.requireAuth, auth.requireAdmin, function(req, res) {
  var name = req.body && req.body.name;
  var source = (req.body && req.body.source) || 'gitee';
  if (!name) return res.status(400).json({ code: 400, message: '缺少插件名' });
  marketService.installPlugin(name, source).then(function(result) {
    broadcastMarketChange('plugin-installed', name, result);
    res.json({ code: 200, data: result, message: '插件安装成功' });
  }).catch(function(e) {
    console.error('[market] 插件安装失败:', name, e.message);
    res.status(400).json({ code: 400, message: e.message || '插件安装失败' });
  });
});

// 卸载插件（管理员）
router.post('/uninstall-plugin', auth.requireAuth, auth.requireAdmin, function(req, res) {
  var name = req.body && req.body.name;
  if (!name) return res.status(400).json({ code: 400, message: '缺少插件名' });
  marketService.uninstallPlugin(name).then(function(result) {
    broadcastMarketChange('plugin-uninstalled', name, result);
    res.json({ code: 200, data: result, message: '插件卸载成功' });
  }).catch(function(e) {
    console.error('[market] 插件卸载失败:', name, e.message);
    res.status(400).json({ code: 400, message: e.message || '插件卸载失败' });
  });
});

// ========== 应用/插件配置（manifest.config 声明 → 安装时引导填写，值存数据库 app_config 表） ==========

// 读取配置状态（管理员）：schema + 已存值（secret 不回显明文，只回 configured 布尔）+ required 缺失项
router.get('/app-config', auth.requireAuth, auth.requireAdmin, function(req, res) {
  var name = String(req.query.name || '');
  if (!name) return res.status(400).json({ code: 400, message: '缺少应用名' });
  var manifest = marketService.getConfigurableManifest(name);
  if (!manifest) return res.status(404).json({ code: 404, message: '应用或插件未安装: ' + name });
  try {
    var appConfig = require('../utils/app-config');
    var status = appConfig.getConfigStatus(name, Array.isArray(manifest.config) ? manifest.config : []);
    res.json({ code: 200, data: {
      name: name,
      label: manifest.label || name,
      schema: status.schema,
      values: status.values,
      configured: status.configured,
      missingRequired: status.missingRequired
    }});
  } catch (e) {
    console.error('[market] 读取配置失败:', name, e.message);
    res.status(500).json({ code: 500, message: e.message || '读取配置失败' });
  }
});

// 保存配置（管理员）：secret 传空字符串表示保持原值不变；保存后即时生效（无需重启）
router.post('/app-config', auth.requireAuth, auth.requireAdmin, function(req, res) {
  var body = req.body || {};
  var name = String(body.name || '');
  var values = body.values;
  if (!name) return res.status(400).json({ code: 400, message: '缺少应用名' });
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return res.status(400).json({ code: 400, message: '缺少配置值' });
  }
  var manifest = marketService.getConfigurableManifest(name);
  if (!manifest) return res.status(404).json({ code: 404, message: '应用或插件未安装: ' + name });
  var schema = Array.isArray(manifest.config) ? manifest.config : [];
  var knownKeys = {};
  schema.forEach(function (item) { if (item && item.key) knownKeys[item.key] = item; });
  try {
    var appConfig = require('../utils/app-config');
    var patch = {};
    Object.keys(values).forEach(function (key) {
      if (!knownKeys[key]) return; // 只接受 schema 内声明的 key，拒绝写入任意键
      var item = knownKeys[key];
      if (values[key] === null || values[key] === undefined) return;
      var str = String(values[key]);
      if (item.type === 'secret' && str === '') return; // secret 留空 = 保持原值
      patch[key] = str;
    });
    appConfig.saveValues(name, patch);
    var status = appConfig.getConfigStatus(name, schema);
    res.json({ code: 200, data: {
      name: name,
      configured: status.configured,
      missingRequired: status.missingRequired
    }, message: '配置已保存，即时生效' });
  } catch (e) {
    console.error('[market] 保存配置失败:', name, e.message);
    res.status(400).json({ code: 400, message: e.message || '保存配置失败' });
  }
});

module.exports = router;
