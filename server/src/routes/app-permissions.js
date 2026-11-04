/**
 * 第三方应用的运行时权限（声明 + 用时授权）
 *
 * 两条路径，语义不同，别混：
 *   /api/app-permissions/:app          —— 用户自己：查我授予了哪些、授予/撤销
 *   /api/app-permissions/admin/:app    —— 班管：看全班谁授予了什么、代撤销
 *
 * 服务端是权威：
 *   - 能力必须在 SENSITIVE 白名单里（防止应用自造能力名绕过）
 *   - 应用必须在 manifest.capabilities 里声明过（不能「没声明却来要」）
 *   - 应用必须已安装且启用（停用的应用连授权都不该发生）
 */

var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var db = require('../utils/db');
var manifestLoader = require('../core/manifest-loader');

// 需要用户明确授权的敏感能力。
// 不含 system.share / device.filePicker：这两项有浏览器自身的用户手势兜底，
// 再加一层只会让开发者多点一次而无安全增益。
var SENSITIVE = [
  'device.camera',
  'device.microphone',
  'system.notification',
  'system.clipboard.read'
];

function isSensitive(cap) {
  return SENSITIVE.indexOf(cap) !== -1;
}

// 父能力覆盖子能力：声明 system.clipboard 的应用，等价于可以申请 system.clipboard.read。
// 单一事实源：校验与「敏感能力全集」都用这张表，避免两处各写一份后漂移。
var PARENT_CAPABILITY = { 'system.clipboard.read': 'system.clipboard' };

function declareCovers(declared, capability) {
  if (declared.indexOf(capability) !== -1) return true;
  var parent = PARENT_CAPABILITY[capability];
  return !!(parent && declared.indexOf(parent) !== -1);
}

// 该应用实际需要授权的能力清单（按 manifest 声明过滤）
function sensitiveOf(app) {
  var declared = Array.isArray(app && app.capabilities) ? app.capabilities : [];
  var out = [];
  for (var i = 0; i < SENSITIVE.length; i++) {
    if (declareCovers(declared, SENSITIVE[i])) out.push(SENSITIVE[i]);
  }
  return out;
}

function findInstalledApp(name) {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(String(name || ''))) return null;
  try {
    var apps = manifestLoader.loadManifests();
    for (var i = 0; i < apps.length; i++) {
      if (apps[i].name === name) return apps[i];
    }
  } catch (e) {}
  return null;
}

function isAppEnabled(name) {
  try {
    var row = db.prepare('SELECT enabled FROM app_control WHERE app_name = ?').get(name);
    return !row || row.enabled !== 0;
  } catch (e) {
    return true;
  }
}

// 校验「应用 + 能力」这一对是否成立；返回错误信息或 null
function validatePair(app, capability) {
  if (!app) return '应用未安装';
  if (!isSensitive(capability)) return '不支持的能力: ' + capability;
  var declared = Array.isArray(app.capabilities) ? app.capabilities : [];
  // 细粒度权限名（system.clipboard.read）在能力目录里没有独立条目，
  // 必须允许父能力覆盖，否则它会变成「任何应用都声明不了」的死项。
  if (!declareCovers(declared, capability)) {
    var parent = PARENT_CAPABILITY[capability];
    return (app.label || app.name) + ' 未在 manifest 中声明 ' + (parent || capability) + '，不能申请该权限';
  }
  return null;
}

function grantedList(appName, userId) {
  try {
    return db.prepare(
      'SELECT capability, granted_via, granted_at FROM app_permissions WHERE app_name = ? AND user_id = ? ORDER BY capability'
    ).all(appName, String(userId));
  } catch (e) {
    return [];
  }
}

// ========== 用户侧 ==========

// 我的授权状态：已授予列表 + 该应用的敏感能力全集（前端据此决定要不要弹窗）
router.get('/:app', auth.requireAuth, function (req, res) {
  var appName = String(req.params.app || '');
  var app = findInstalledApp(appName);
  if (!app) return res.status(404).json({ code: 404, message: '应用未安装: ' + appName });
  if (!isAppEnabled(appName)) return res.status(403).json({ code: 403, message: '应用已被暂停' });

  var declared = sensitiveOf(app);
  var rows = grantedList(appName, req.user.user_id);
  res.json({
    code: 200,
    data: {
      app: appName,
      sensitive: declared,
      granted: rows.map(function (r) { return r.capability; }),
      detail: rows
    }
  });
});

// 授予 / 撤销（本人）
router.post('/:app', auth.requireAuth, function (req, res) {
  var appName = String(req.params.app || '');
  var capability = String((req.body && req.body.capability) || '');
  var granted = req.body && req.body.granted !== false;

  var app = findInstalledApp(appName);
  if (!app) return res.status(404).json({ code: 404, message: '应用未安装: ' + appName });
  if (!isAppEnabled(appName)) return res.status(403).json({ code: 403, message: '应用已被暂停' });
  var err = validatePair(app, capability);
  if (err) return res.status(400).json({ code: 400, message: err });

  try {
    if (granted) {
      db.prepare(
        'INSERT INTO app_permissions (app_name, user_id, capability, granted_via, granted_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(app_name, user_id, capability) DO UPDATE SET granted_via = excluded.granted_via, granted_at = excluded.granted_at'
      ).run(appName, String(req.user.user_id), capability, 'prompt', Date.now());
    } else {
      db.prepare('DELETE FROM app_permissions WHERE app_name = ? AND user_id = ? AND capability = ?')
        .run(appName, String(req.user.user_id), capability);
    }
    res.json({
      code: 200,
      message: granted ? '已授权' : '已撤销',
      data: { app: appName, capability: capability, granted: granted }
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: '保存授权失败: ' + e.message });
  }
});

// ========== 班管侧 ==========

// 汇总：某应用被哪些用户授予了哪些敏感能力
router.get('/admin/:app', auth.requireAuth, auth.requireAdmin, function (req, res) {
  var appName = String(req.params.app || '');
  var app = findInstalledApp(appName);
  if (!app) return res.status(404).json({ code: 404, message: '应用未安装: ' + appName });

  try {
    var rows = db.prepare(
      'SELECT p.user_id, p.capability, p.granted_via, p.granted_at, u.net_name, u.real_name ' +
      'FROM app_permissions p LEFT JOIN users u ON u.user_id = p.user_id ' +
      'WHERE p.app_name = ? ORDER BY p.granted_at DESC LIMIT 500'
    ).all(appName);

    // 按用户聚合成一行，管理端不必自己拼
    var map = {};
    rows.forEach(function (r) {
      var key = String(r.user_id);
      if (!map[key]) {
        map[key] = {
          userId: key,
          name: r.net_name || r.real_name || key,
          capabilities: [],
          lastAt: 0
        };
      }
      map[key].capabilities.push({ capability: r.capability, via: r.granted_via, at: r.granted_at });
      if ((r.granted_at || 0) > map[key].lastAt) map[key].lastAt = r.granted_at || 0;
    });

    var users = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.lastAt - a.lastAt; });

    res.json({
      code: 200,
      data: {
        app: appName,
        label: app.label || appName,
        sensitive: sensitiveOf(app),
        users: users,
        totalGrants: rows.length
      }
    });
  } catch (e) {
    res.status(500).json({ code: 500, message: '读取授权失败: ' + e.message });
  }
});

// 代撤销：给了 user_id 就撤该用户，不给就撤全班（capability 同理）
router.post('/admin/revoke', auth.requireAuth, auth.requireAdmin, function (req, res) {
  var body = req.body || {};
  var appName = String(body.name || '');
  if (!findInstalledApp(appName)) return res.status(404).json({ code: 404, message: '应用未安装: ' + appName });
  var userId = body.userId ? String(body.userId) : '';
  var capability = body.capability ? String(body.capability) : '';
  if (capability && !isSensitive(capability)) {
    return res.status(400).json({ code: 400, message: '不支持的能力: ' + capability });
  }

  try {
    var sql = 'DELETE FROM app_permissions WHERE app_name = ?';
    var params = [appName];
    if (userId) { sql += ' AND user_id = ?'; params.push(userId); }
    if (capability) { sql += ' AND capability = ?'; params.push(capability); }
    var info = db.prepare(sql).run(params);
    res.json({ code: 200, message: '已撤销 ' + info.changes + ' 条授权', data: { removed: info.changes } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '撤销失败: ' + e.message });
  }
});

module.exports = router;
module.exports.SENSITIVE_CAPABILITIES = SENSITIVE;
