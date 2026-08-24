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

// 市场目录（支持 ?source=github|local，默认 github）
router.get('/catalog', function(req, res) {
  var sourceId = req.query.source || 'github';
  marketService.getCatalog(sourceId).then(function(catalog) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({ code: 200, data: { source: sourceId, catalog: catalog } });
  }).catch(function(e) {
    res.status(502).json({ code: 502, message: e.message || '获取市场目录失败' });
  });
});

// 安装应用
router.post('/install', auth.requireAuth, auth.requireAdmin, function(req, res) {
  var name = req.body && req.body.name;
  var source = (req.body && req.body.source) || 'github';
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
  var source = (req.body && req.body.source) || 'github';
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

module.exports = router;
