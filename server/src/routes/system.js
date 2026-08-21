var express = require('express');
var router = express.Router();
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var APP_VERSION = '1.0.0';
var VERSION_FILE = path.join(__dirname, '../../version.json');

function getVersionInfo() {
  if (fs.existsSync(VERSION_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    } catch (e) {}
  }
  return {
    version: APP_VERSION,
    buildHash: '',
    buildTime: '',
    minClientVersion: '1.0.0',
    changelog: '',
    forceUpdate: false,
    updateUrl: ''
  };
}

router.get('/version', function(req, res) {
  var info = getVersionInfo();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    code: 200,
    data: {
      version: info.version,
      buildHash: info.buildHash || '',
      buildTime: info.buildTime || '',
      minClientVersion: info.minClientVersion || APP_VERSION,
      changelog: info.changelog || '',
      forceUpdate: !!info.forceUpdate,
      updateUrl: info.updateUrl || '',
      timestamp: Date.now()
    }
  });
});

router.get('/heartbeat', function(req, res) {
  var info = getVersionInfo();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    code: 200,
    data: {
      status: 'running',
      version: info.version,
      minClientVersion: info.minClientVersion || APP_VERSION,
      forceUpdate: !!info.forceUpdate,
      action: info.forceUpdate ? 'force_reload' : 'none',
      timestamp: Date.now()
    }
  });
});

router.get('/health', function(req, res) {
  var checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {}
  };

  try {
    var db = require('../utils/db');
    db.prepare('SELECT 1').get();
    checks.checks.database = { status: 'ok' };
  } catch (e) {
    checks.checks.database = { status: 'error', message: 'Database unreachable' };
    checks.status = 'unhealthy';
  }

  try {
    var chatServer = require('../ws/chat-server');
    var onlineCount = chatServer.getOnlineCount ? chatServer.getOnlineCount() : 0;
    checks.checks.websocket = { status: 'ok', online_count: onlineCount };
  } catch (e) {
    checks.checks.websocket = { status: 'error', message: 'WebSocket server not available' };
  }

  try {
    var relaySync = require('../utils/relay-sync');
    var syncStatus = relaySync.getSyncStatus ? relaySync.getSyncStatus() : null;
    checks.checks.relay = { status: syncStatus ? 'ok' : 'not_configured', details: syncStatus };
  } catch (e) {
    checks.checks.relay = { status: 'not_configured' };
  }

  var memUsage = process.memoryUsage();
  checks.checks.memory = {
    status: memUsage.heapUsed < 500 * 1024 * 1024 ? 'ok' : 'warning',
    heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
    rss_mb: Math.round(memUsage.rss / 1024 / 1024)
  };

  var statusCode = checks.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json({ code: statusCode, data: checks });
});

router.post('/set-version', function(req, res) {
  var token = req.headers.authorization;
  if (!token) {
    return res.status(401).json({ code: 401, message: '未授权' });
  }
  var jwtUtil = require('../utils/jwt');
  var result = jwtUtil.verifyToken(token.replace('Bearer ', ''));
  var constants = require('../utils/constants');
  if (!result.valid || !result.data || !constants.isClassAdmin(String(result.data.user_id))) {
    return res.status(403).json({ code: 403, message: '无权限' });
  }

  var body = req.body || {};
  var versionData = {
    version: body.version || APP_VERSION,
    buildHash: body.buildHash || crypto.randomBytes(8).toString('hex'),
    buildTime: new Date().toISOString(),
    minClientVersion: body.minClientVersion || APP_VERSION,
    changelog: body.changelog || '',
    forceUpdate: !!body.forceUpdate,
    updateUrl: body.updateUrl || ''
  };

  try {
    fs.writeFileSync(VERSION_FILE, JSON.stringify(versionData, null, 2));
  } catch (e) {
    return res.status(500).json({ code: 500, message: '版本信息保存失败' });
  }

  var chatServer = require('../ws/chat-server');
  chatServer.broadcast({
    type: 'app_update_available',
    version: versionData.version,
    forceUpdate: versionData.forceUpdate,
    changelog: versionData.changelog,
    minClientVersion: versionData.minClientVersion
  });

  res.json({ code: 200, message: '版本信息已更新', data: versionData });
});

// GET /api/system/app-control - 获取启用的应用列表（需登录）
// 返回启用的应用名数组，桌面据此过滤禁用应用
// 同时返回系统功能开关（lock_screen），客户端据此决定是否启用锁屏
router.get('/app-control', function(req, res) {
  var auth = require('../middleware/auth');
  auth.requireAuth(req, res, function() {
    try {
      var db = require('../utils/db');
      var rows = db.prepare('SELECT app_name, enabled FROM app_control').all();
      var enabledApps = [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].enabled) enabledApps.push(rows[i].app_name);
      }
      var lockRow = db.prepare("SELECT value FROM system_settings WHERE key = 'lock_screen'").get();
      var lockScreenEnabled = lockRow ? lockRow.value !== '0' : true;
      res.json({ code: 200, data: { enabled_apps: enabledApps, lock_screen: lockScreenEnabled } });
    } catch (e) {
      // 数据库异常时返回全部启用（降级处理，不影响用户使用）
      // admin 仍由前端 Desktop.vue 的 visibleRoles 过滤，普通用户不可见
      res.json({ code: 200, data: { enabled_apps: ['chat', 'community', 'ai-chat', 'notes', 'resource', 'weather', 'music', 'settings', 'timetable', 'calendar', 'countdown', 'admin', 'calculator', 'browser'], lock_screen: true } });
    }
  });
});

module.exports = router;
