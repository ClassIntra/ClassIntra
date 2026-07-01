var express = require('express');
var router = express.Router();
var os = require('os');
var fs = require('fs');
var path = require('path');
var db = require('../utils/db');
var auth = require('../middleware/auth');
var time = require('../utils/time');
var constants = require('../utils/constants');

// 获取管理员的班级号（班管返回CC，班干也返回对应班级）
function getUserAdminClass(userId) {
  return constants.getAdminClass(userId);
}

// 检查管理员是否能操作指定用户（班管只能操作本班用户，班干通过前缀匹配）
function canAdminManageUser(adminUserId, targetUserId) {
  var adminClass = getUserAdminClass(adminUserId);
  if (!adminClass) {
    // 班干或其他授权用户：通过 user_id 班级前缀判断
    if (adminUserId && adminUserId.length >= 4 && targetUserId && targetUserId.length >= 4) {
      return adminUserId.substring(2, 4) === targetUserId.substring(2, 4);
    }
    return false;
  }
  // 班管只能操作本班用户
  if (targetUserId && targetUserId.length >= 4) {
    return targetUserId.substring(2, 4) === adminClass;
  }
  return false;
}

// All admin routes require auth + admin
router.use(auth.requireAuth);
router.use(auth.requireAdmin);

// Helper: log admin action
function logAction(adminId, action, target, detail) {
  try {
    var stmt = db.prepare("INSERT INTO admin_logs (admin_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, datetime('now'))");
    stmt.run(adminId, action, target || '', detail || '');
    // 自动清除超过1000条的旧日志
    try {
      var count = db.prepare('SELECT COUNT(*) as total FROM admin_logs').get().total;
      if (count > 1000) {
        db.prepare('DELETE FROM admin_logs WHERE id IN (SELECT id FROM admin_logs ORDER BY created_at ASC LIMIT ?)').run(count - 1000);
      }
    } catch (e) {
      // ignore cleanup errors
    }
  } catch (e) {
    console.error('Failed to log admin action:', e.message);
  }
}

// GET /api/admin/users - User list with pagination and search
router.get('/users', auth.requirePermission('manage_users'), function(req, res) {
  var page = parseInt(req.query.page) || 1;
  var limit = parseInt(req.query.limit) || 20;
  var search = req.query.search || '';
  var status = req.query.status || '';
  var classFilter = req.query.class || ''; // 班级过滤
  var adminUserId = req.user ? req.user.user_id : '';

  if (page < 1) page = 1;
  if (limit < 1) limit = 20;
  if (limit > 10000) limit = 10000;

  var offset = (page - 1) * limit;
  var whereClause = 'WHERE 1=1';
  var params = [];

  // 班级管理员只能看本班用户
  var adminClass = getUserAdminClass(adminUserId);
  if (adminClass) {
    // 班管：只看本班用户 (YYCCXX 格式，CC = adminClass)
    whereClause += ' AND u.user_id LIKE ?';
    params.push('__' + adminClass + '%');
  } else if (req.user && req.user.role === 'officer') {
    // 班干：通过 user_id 班级前缀过滤本班（YYCCNN 取第 3-4 位为班号）
    var officerClass = req.user.user_id.substring(2, 4);
    whereClause += ' AND u.user_id LIKE ?';
    params.push('__' + officerClass + '%');
  } else if (classFilter) {
    // 超管/其他：可按班级筛选查看
    whereClause += ' AND u.user_id LIKE ?';
    params.push('__' + classFilter + '%');
  }

  if (search) {
    whereClause += ' AND (u.net_name LIKE ? OR u.real_name LIKE ? OR u.user_id LIKE ?)';
    params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
  }

  if (status) {
    whereClause += ' AND u.status = ?';
    params.push(status);
  }

  // 修复 LIKE 参数中的占位符
  var cohortPrefix = (process.env.COHORT || '25');
  var fixedParams = params.map(function(p) {
    if (typeof p === 'string' && p.indexOf('__') === 0) {
      return cohortPrefix + p.substring(2);
    }
    return p;
  });

  var countStmt = db.prepare('SELECT COUNT(*) as total FROM users u ' + whereClause);
  var countResult = countStmt.get.apply(countStmt, fixedParams);
  var total = countResult.total;

  var dataStmt = db.prepare(
    'SELECT u.id, u.net_name, u.real_name, u.user_id, u.gender, u.status, u.is_admin, u.role, u.officer_title, u.officer_permissions, u.ban_expires_at, u.ban_reason, u.info_json, u.created_at, u.last_login, ' +
    'COALESCE(s.deepseek_enabled, 0) as deepseek_enabled, COALESCE(s.ai_settings_json, \'{}\') as ai_settings_json ' +
    'FROM users u LEFT JOIN user_settings s ON u.user_id = s.user_id ' +
    whereClause + ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?'
  );
  var dataParams = fixedParams.concat([limit, offset]);
  var users = dataStmt.all.apply(dataStmt, dataParams);

  for (var i = 0; i < users.length; i++) {
    if (users[i].created_at) users[i].created_at = time.toISOString(users[i].created_at);
    if (users[i].last_login) users[i].last_login = time.toISOString(users[i].last_login);
    if (users[i].ban_expires_at) users[i].ban_expires_at = time.toISOString(users[i].ban_expires_at);
    users[i].is_admin = users[i].is_admin ? true : false;
    users[i].is_class_admin = constants.isClassAdmin(String(users[i].user_id));
    users[i].info = JSON.parse(users[i].info_json || '{}');
    delete users[i].info_json;
    users[i].deepseek_enabled = users[i].deepseek_enabled === 1;
    try {
      var aiSettings = JSON.parse(users[i].ai_settings_json || '{}');
      users[i].ai_model = aiSettings.model || 'default';
    } catch (e) {
      users[i].ai_model = 'default';
    }
    delete users[i].ai_settings_json;
    // 统一解析 officer_permissions 为数组
    try {
      users[i].officer_permissions = JSON.parse(users[i].officer_permissions || '[]');
    } catch (e) {
      users[i].officer_permissions = [];
    }
  }

  res.json({
    code: 200,
    message: 'ok',
    data: {
      users: users,
      total: total,
      page: page,
      limit: limit
    }
  });
});

// PATCH /api/admin/users/:id/status - Enable/disable user
router.patch('/users/:id/status', auth.requirePermission('manage_users'), function(req, res) {
  var userId = req.params.id;
  var newStatus = req.body.status;
  var reason = req.body.reason || '';
  var duration = req.body.duration || 0;
  var adminUserId = req.user ? req.user.user_id : '';

  if (!newStatus || (newStatus !== 'active' && newStatus !== 'disabled')) {
    return res.status(400).json({ code: 400, message: '无效的状态值' });
  }

  // 班管权限检查
  var targetUser = db.prepare('SELECT is_admin, role, user_id FROM users WHERE id = ?').get(userId);
  if (!targetUser) return res.status(404).json({ code: 404, message: '用户不存在' });
  if (!canAdminManageUser(adminUserId, targetUser.user_id)) {
    return res.status(403).json({ code: 403, message: '无权操作其他班级用户' });
  }

  // 班管无法被封禁
  if (newStatus === 'disabled') {
    if (targetUser && constants.isClassAdmin(String(targetUser.user_id))) {
      return res.status(403).json({ code: 403, message: '无法封禁班管' });
    }
  }

  var banExpiresAt = null;
  if (newStatus === 'disabled' && duration > 0) {
    banExpiresAt = new Date(Date.now() + duration * 60000).toISOString().replace('T', ' ').substring(0, 19);
  }

  var stmt;
  if (newStatus === 'disabled') {
    stmt = db.prepare('UPDATE users SET status = ?, ban_expires_at = ?, ban_reason = ?, updated_at = datetime(\'now\') WHERE id = ?');
    stmt.run(newStatus, banExpiresAt, reason, userId);
  } else {
    stmt = db.prepare('UPDATE users SET status = ?, ban_expires_at = NULL, ban_reason = NULL, updated_at = datetime(\'now\') WHERE id = ?');
    stmt.run(newStatus, userId);
  }

  var result = stmt;
  if (!result) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  var targetUser = db.prepare('SELECT user_id FROM users WHERE id = ?').get(userId);

  try {
    var relayBus = require('../utils/relay-bus');
    // 管理操作需同步到远程服务器，确保跨服务器用户状态一致
    relayBus.emit('admin_user_status_changed', {
      user_id: targetUser.user_id,
      status: newStatus,
      reason: reason,
      ban_expires_at: banExpiresAt
    });
  } catch (e) { console.error('[Admin] Broadcast event failed:', e.message); }

  if (newStatus === 'disabled' && targetUser) {
    try {
      var chatServer3 = require('../ws/chat-server');
      chatServer3.sendToClient(targetUser.user_id, {
        type: 'account_banned',
        status: 'disabled',
        reason: reason,
        ban_expires_at: banExpiresAt
      });
    } catch (e) { console.error('[Admin] Relay event failed:', e.message); }
  }

  if (newStatus === 'active' && targetUser) {
    try {
      var chatServer4 = require('../ws/chat-server');
      chatServer4.sendToClient(targetUser.user_id, {
        type: 'account_banned',
        status: 'active',
        reason: '',
        ban_expires_at: null
      });
    } catch (e) { console.error('[Admin] Relay event failed:', e.message); }
  }

  logAction(req.user.user_id, newStatus === 'disabled' ? 'disable_user' : 'enable_user', targetUser ? targetUser.user_id : userId, reason || (newStatus === 'disabled' ? 'Banned for ' + (duration > 0 ? duration + ' minutes' : 'permanently') : 'Manually enabled'));

  res.json({ code: 200, message: '状态更新成功' });
});

router.get('/users/:id/ban-info', function(req, res) {
  var userId = req.params.id;
  var user = db.prepare('SELECT status, ban_expires_at, ban_reason FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }
  res.json({ code: 200, message: 'ok', data: user });
});

router.patch('/users/:id', function(req, res) {
  var userId = req.params.id;
  var updates = req.body;
  var adminUserId = req.user ? req.user.user_id : '';

  // 班管权限检查
  var targetUser = db.prepare('SELECT user_id FROM users WHERE id = ?').get(userId);
  if (!targetUser) return res.status(404).json({ code: 404, message: '用户不存在' });
  if (!canAdminManageUser(adminUserId, targetUser.user_id)) {
    return res.status(403).json({ code: 403, message: '无权操作其他班级用户' });
  }

  var fields = [];
  var values = [];

  var allowedFields = ['net_name', 'real_name', 'gender'];
  for (var i = 0; i < allowedFields.length; i++) {
    var field = allowedFields[i];
    if (updates[field] !== undefined) {
      fields.push(field + ' = ?');
      values.push(updates[field]);
    }
  }

  if (updates.is_admin !== undefined) {
    if (!constants.isClassAdmin(req.user.user_id) && req.user.is_admin !== 1) {
      return res.status(403).json({ code: 403, message: '无权修改管理员角色' });
    }
    fields.push('is_admin = ?');
    values.push(updates.is_admin ? 1 : 0);
    if (!updates.is_admin) {
      fields.push('role = ?');
      values.push('user');
      fields.push('officer_permissions = ?');
      values.push('[]');
      fields.push('officer_title = ?');
      values.push('');
    }
  }

  if (req.body.info !== undefined) {
    fields.push('info_json = ?');
    values.push(JSON.stringify(req.body.info));
  }

  if (fields.length === 0) {
    return res.status(400).json({ code: 400, message: '无有效更新字段' });
  }

  fields.push('updated_at = datetime(\'now\')');
  values.push(userId);

  var stmt = db.prepare('UPDATE users SET ' + fields.join(', ') + ' WHERE id = ?');
  var result = stmt.run.apply(stmt, values);

  if (result.changes === 0) {
    return res.status(404).json({ code: 404, message: '用户不存在' });
  }

  var targetUser = db.prepare('SELECT user_id FROM users WHERE id = ?').get(userId);
  if (targetUser) {
    try {
      var relayBus = require('../utils/relay-bus');
      var updatedUser = db.prepare('SELECT * FROM users WHERE user_id = ?').get(targetUser.user_id);
      relayBus.emit('user_profile_updated', {
        user_id: targetUser.user_id,
        net_name: updatedUser ? updatedUser.net_name : updates.net_name,
        real_name: updatedUser ? updatedUser.real_name : updates.real_name,
        gender: updatedUser ? updatedUser.gender : updates.gender,
        info_json: updatedUser ? updatedUser.info_json : undefined,
        wechat: updatedUser ? updatedUser.wechat : undefined,
        qq: updatedUser ? updatedUser.qq : undefined,
        phone: updatedUser ? updatedUser.phone : undefined,
        address: updatedUser ? updatedUser.address : undefined,
        signature: updatedUser ? updatedUser.signature : undefined,
        privacy_settings: updatedUser ? updatedUser.privacy_settings : undefined
      });
    } catch (e) { console.error('[Admin] Broadcast event failed:', e.message); }
    if (updates.is_admin !== undefined) {
      try {
        var relayBus2 = require('../utils/relay-bus');
        relayBus2.emit('admin_user_status_changed', {
          user_id: targetUser.user_id,
          status: updates.is_admin ? 'admin_promoted' : 'admin_demoted'
        });
      } catch (e) { console.error('[Admin] Broadcast event failed:', e.message); }
    }
  }

  logAction(req.user.user_id, 'edit_user', targetUser ? targetUser.user_id : userId, JSON.stringify(updates));

  res.json({ code: 200, message: '用户信息已更新' });
});

// DELETE /api/admin/users/:id - Delete user
router.delete('/users/:id', function(req, res) {
  var userId = req.params.id;
  var adminUserId = req.user ? req.user.user_id : '';

  // Get user info before deletion for logging
  var getStmt = db.prepare('SELECT user_id, net_name, real_name, is_admin FROM users WHERE id = ?');
  var user = getStmt.get(userId);

  if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });

  // 班管权限检查
  if (!canAdminManageUser(adminUserId, user.user_id)) {
    return res.status(403).json({ code: 403, message: '无权操作其他班级用户' });
  }

  // 班管无法被删除
  if (constants.isClassAdmin(String(user.user_id))) {
    return res.status(403).json({ code: 403, message: '无法删除班管' });
  }

  // Delete user
  var deleteStmt = db.prepare('DELETE FROM users WHERE id = ?');
  deleteStmt.run(userId);

  // 记录墓碑，确保追赶同步时传播删除操作
  try {
    var relaySync = require('../utils/relay-sync');
    relaySync.recordTombstone('users', user.user_id);
  } catch (e) {}

  // 删除操作需同步到远程服务器
  try {
    var relayBus = require('../utils/relay-bus');
    relayBus.emit('user_deleted', {
      user_id: user.user_id
    });
  } catch (e) { console.error('[Admin] Broadcast event failed:', e.message); }

  logAction(req.user.user_id, 'delete_user', user.user_id, 'Deleted user: ' + user.net_name + ' (' + user.real_name + ')');

  res.json({ code: 200, message: '用户已删除' });
});

var VALID_OFFICER_PERMISSIONS = [
  'manage_broadcast',
  'manage_resources',
  'view_logs',
  'manage_chat',
  'manage_community',
  'manage_users',
  'manage_announcements',
  'manage_app_control'
];

router.get('/officers', function(req, res) {
  try {
    var officers = db.prepare(
      'SELECT user_id, net_name, real_name, role, officer_permissions, officer_title, created_at FROM users WHERE role = ?'
    ).all('officer');
    for (var i = 0; i < officers.length; i++) {
      try {
        officers[i].officer_permissions = JSON.parse(officers[i].officer_permissions || '[]');
      } catch (e) {
        officers[i].officer_permissions = [];
      }
    }
    res.json({ code: 200, message: 'ok', data: officers });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取班干列表失败' });
  }
});

router.post('/officers', function(req, res) {
  if (!constants.isClassAdmin(req.user.user_id) && req.user.is_admin !== 1) {
    return res.status(403).json({ code: 403, message: '无权操作' });
  }
  var userId = req.body.user_id;
  var permissions = req.body.permissions || [];
  var title = req.body.title || '';
  if (!userId) {
    return res.status(400).json({ code: 400, message: '缺少用户ID' });
  }
  // 班管只能操作本班用户
  if (!canAdminManageUser(req.user.user_id, userId)) {
    return res.status(403).json({ code: 403, message: '无权操作其他班级用户' });
  }
  var filteredPerms = permissions.filter(function(p) {
    return VALID_OFFICER_PERMISSIONS.indexOf(p) !== -1;
  });
  try {
    var user = db.prepare('SELECT user_id, is_admin FROM users WHERE user_id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在' });
    }
    if (user.is_admin === 1) {
      return res.status(400).json({ code: 400, message: '管理员不能设为班干' });
    }
    db.prepare('UPDATE users SET role = ?, officer_permissions = ?, officer_title = ? WHERE user_id = ?')
      .run('officer', JSON.stringify(filteredPerms), title, userId);
    logAction(req.user.user_id, 'set_officer', userId, 'Title: ' + title + ', Permissions: ' + filteredPerms.join(','));
    try {
      var cs = require('../ws/chat-server');
      cs.sendToClient(userId, { type: 'officer_permissions_changed', user_id: userId, role: 'officer', permissions: filteredPerms, title: title });
    } catch (e2) {}
    res.json({ code: 200, message: '班干设置成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '设置班干失败' });
  }
});

router.delete('/officers/:userId', function(req, res) {
  if (!constants.isClassAdmin(req.user.user_id) && req.user.is_admin !== 1) {
    return res.status(403).json({ code: 403, message: '无权操作' });
  }
  var userId = req.params.userId;
  // 班管只能操作本班用户
  if (!canAdminManageUser(req.user.user_id, userId)) {
    return res.status(403).json({ code: 403, message: '无权操作其他班级用户' });
  }
  try {
    db.prepare('UPDATE users SET role = ?, officer_permissions = ?, officer_title = ? WHERE user_id = ?')
      .run('user', '[]', '', userId);
    logAction(req.user.user_id, 'remove_officer', userId, '');
    try {
      var cs2 = require('../ws/chat-server');
      cs2.sendToClient(userId, { type: 'officer_permissions_changed', user_id: userId, role: 'user', permissions: [], title: '' });
    } catch (e3) {}
    res.json({ code: 200, message: '班干已移除' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '移除班干失败' });
  }
});

router.patch('/officers/:userId/permissions', function(req, res) {
  if (!constants.isClassAdmin(req.user.user_id) && req.user.is_admin !== 1) {
    return res.status(403).json({ code: 403, message: '无权操作' });
  }
  var userId = req.params.userId;
  // 班管只能操作本班用户
  if (!canAdminManageUser(req.user.user_id, userId)) {
    return res.status(403).json({ code: 403, message: '无权操作其他班级用户' });
  }
  var permissions = req.body.permissions || [];
  var title = req.body.title;
  var filteredPerms = permissions.filter(function(p) {
    return VALID_OFFICER_PERMISSIONS.indexOf(p) !== -1;
  });
  try {
    if (title !== undefined) {
      db.prepare('UPDATE users SET officer_permissions = ?, officer_title = ? WHERE user_id = ?')
        .run(JSON.stringify(filteredPerms), title, userId);
    } else {
      db.prepare('UPDATE users SET officer_permissions = ? WHERE user_id = ?')
        .run(JSON.stringify(filteredPerms), userId);
    }
    logAction(req.user.user_id, 'update_officer_perms', userId, 'Title: ' + (title || '') + ', Permissions: ' + filteredPerms.join(','));
    try {
      var cs3 = require('../ws/chat-server');
      cs3.sendToClient(userId, { type: 'officer_permissions_changed', user_id: userId, role: 'officer', permissions: filteredPerms, title: title !== undefined ? title : undefined });
    } catch (e4) {}
    res.json({ code: 200, message: '权限更新成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '权限更新失败' });
  }
});

router.get('/available-officers', function(req, res) {
  try {
    var sql = 'SELECT user_id, net_name, real_name FROM users WHERE role != ? AND is_admin = 0 AND status = ?';
    var sqlParams = ['officer', 'active'];
    // 班管/班干只能看本班用户
    var adminClass = getUserAdminClass(req.user.user_id);
    if (adminClass) {
      sql += ' AND user_id LIKE ?';
      sqlParams.push('__' + adminClass + '%');
    } else if (req.user && req.user.role === 'officer') {
      var officerClass = req.user.user_id.substring(2, 4);
      sql += ' AND user_id LIKE ?';
      sqlParams.push('__' + officerClass + '%');
    }
    // cohortPrefix 修复：将 __CC% 转为 YYCC%
    var cohortPrefix = (process.env.COHORT || '25');
    sqlParams = sqlParams.map(function(p) {
      if (typeof p === 'string' && p.indexOf('__') === 0) return cohortPrefix + p.substring(2);
      return p;
    });
    var stmt = db.prepare(sql);
    var users = stmt.all.apply(stmt, sqlParams);
    res.json({ code: 200, message: 'ok', data: users });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取用户列表失败' });
  }
});

// ======== Announcements ========

router.get('/announcements', function(req, res) {
  try {
    var announcements = db.prepare('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT 100').all();
    for (var i = 0; i < announcements.length; i++) {
      if (announcements[i].created_at) announcements[i].created_at = time.toISOString(announcements[i].created_at);
    }
    res.json({ code: 200, message: 'ok', data: announcements });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取公告失败' });
  }
});

router.post('/announcements', auth.requirePermission('manage_announcements'), function(req, res) {
  var title = req.body.title;
  var content = req.body.content;
  var type = req.body.type || 'notice';
  if (!title || !title.trim()) return res.status(400).json({ code: 400, message: '标题不能为空' });
  if (!content || !content.trim()) return res.status(400).json({ code: 400, message: '内容不能为空' });
  if (['notice', 'homework'].indexOf(type) === -1) type = 'notice';
  var authorName = req.user.net_name || req.user.real_name || '';
  try {
    var result = db.prepare(
      "INSERT INTO announcements (title, content, type, author_id, author_name, pinned, created_at) VALUES (?, ?, ?, ?, ?, 0, datetime('now'))"
    ).run(title.trim(), content.trim(), type, req.user.user_id, authorName);
    logAction(req.user.user_id, 'create_announcement', String(result.lastInsertRowid), type + ': ' + title.trim());
    res.json({ code: 200, message: '公告发布成功', data: { id: result.lastInsertRowid } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '发布公告失败' });
  }
});

router.patch('/announcements/:id/pin', auth.requirePermission('manage_announcements'), function(req, res) {
  var id = req.params.id;
  var pinned = req.body.pinned ? 1 : 0;
  try {
    db.prepare('UPDATE announcements SET pinned = ? WHERE id = ?').run(pinned, id);
    logAction(req.user.user_id, 'pin_announcement', String(id), pinned ? 'pin' : 'unpin');
    res.json({ code: 200, message: pinned ? '已置顶' : '已取消置顶' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '操作失败' });
  }
});

router.delete('/announcements/:id', auth.requirePermission('manage_announcements'), function(req, res) {
  var id = req.params.id;
  try {
    db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
    logAction(req.user.user_id, 'delete_announcement', String(id), '');
    res.json({ code: 200, message: '公告已删除' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '删除失败' });
  }
});

router.put('/announcements/:id', auth.requirePermission('manage_announcements'), function(req, res) {
  var id = req.params.id;
  var title = req.body.title;
  var content = req.body.content;
  var type = req.body.type;
  if (!title || !title.trim()) return res.status(400).json({ code: 400, message: '标题不能为空' });
  if (!content || !content.trim()) return res.status(400).json({ code: 400, message: '内容不能为空' });
  if (type && ['notice', 'homework'].indexOf(type) === -1) type = 'notice';
  try {
    var existing = db.prepare('SELECT id FROM announcements WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ code: 404, message: '公告不存在' });
    if (type) {
      db.prepare('UPDATE announcements SET title = ?, content = ?, type = ? WHERE id = ?').run(title.trim(), content.trim(), type, id);
    } else {
      db.prepare('UPDATE announcements SET title = ?, content = ? WHERE id = ?').run(title.trim(), content.trim(), id);
    }
    logAction(req.user.user_id, 'edit_announcement', String(id), title.trim());
    res.json({ code: 200, message: '公告已更新' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '更新失败' });
  }
});

// POST /api/admin/broadcasts - Send broadcast
router.post('/broadcasts', auth.requirePermission('manage_broadcast'), function(req, res) {
  var content = req.body.content;
  var priority = req.body.priority || 'normal';

  if (!content || !content.trim()) {
    return res.status(400).json({ code: 400, message: '广播内容不能为空' });
  }

  if (['normal', 'important', 'urgent'].indexOf(priority) === -1) {
    priority = 'normal';
  }

  var stmt = db.prepare("INSERT INTO broadcasts (content, priority, created_at) VALUES (?, ?, datetime('now'))");
  var result = stmt.run(content.trim(), priority);

  var adminUser = db.prepare('SELECT net_name FROM users WHERE user_id = ?').get(req.user.user_id);
  var senderName = adminUser ? adminUser.net_name : '管理员';

  var newBroadcast = {
    id: result.lastInsertRowid,
    content: content.trim(),
    priority: priority,
    sender_name: senderName,
    created_at: time.nowISO()
  };

  try {
    var chatServer = require('../ws/chat-server');
    chatServer.broadcastToIsland({
      type: 'broadcast',
      content: content.trim(),
      priority: priority
    });
  } catch (e) {
    console.error('Failed to push broadcast to Super Island:', e.message);
  }

  logAction(req.user.user_id, 'send_broadcast', String(result.lastInsertRowid), 'Priority: ' + priority);

  res.json({ code: 200, message: '广播发送成功', data: newBroadcast });
});

// GET /api/admin/broadcasts - List broadcasts
router.get('/broadcasts', function(req, res) {
  var stmt = db.prepare('SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 100');
  var broadcasts = stmt.all();
  var adminUser = db.prepare('SELECT net_name FROM users WHERE user_id = ?').get(req.user.user_id);
  var senderName = adminUser ? adminUser.net_name : '管理员';
  for (var i = 0; i < broadcasts.length; i++) {
    if (!broadcasts[i].sender_name) {
      broadcasts[i].sender_name = senderName;
    }
    if (broadcasts[i].created_at) broadcasts[i].created_at = time.toISOString(broadcasts[i].created_at);
  }
  res.json({ code: 200, message: 'ok', data: broadcasts });
});

router.post('/clear-chat', function(req, res) {
  if (!constants.isClassAdmin(req.user.user_id) && req.user.is_admin !== 1) {
    return res.status(403).json({ code: 403, message: '无权清除聊天记录' });
  }

  var room = req.body.room || 'public';
  try {
    if (room === 'public') {
      var count = db.prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE room_id = ?').get('public').cnt;
      db.prepare('DELETE FROM chat_messages WHERE room_id = ?').run('public');
      var relaySync = require('../utils/relay-sync');
      relaySync.updateWatermark('chat_messages', 0);
      logAction(req.user.user_id, 'clear_public_chat', 'public', 'Cleared ' + count + ' messages');
      try {
        var chatServer = require('../ws/chat-server');
        chatServer.broadcast({ type: 'chat_cleared', room_id: 'public' });
      } catch (e) { console.error('[Admin] Relay event failed:', e.message); }
      res.json({ code: 200, message: '公共聊天记录已清除，共删除 ' + count + ' 条消息' });
    } else {
      var groupId = room;
      var group = db.prepare('SELECT id, name FROM groups WHERE id = ?').get(groupId);
      if (!group) {
        return res.status(404).json({ code: 404, message: '群组不存在' });
      }
      var count = db.prepare('SELECT COUNT(*) as cnt FROM group_messages WHERE group_id = ?').get(groupId).cnt;
      db.prepare('DELETE FROM group_messages WHERE group_id = ?').run(groupId);
      logAction(req.user.user_id, 'clear_group_chat', String(groupId), 'Cleared ' + count + ' messages from group: ' + group.name);
      try {
        var chatServer = require('../ws/chat-server');
        chatServer.broadcast({ type: 'chat_cleared', room_id: 'group_' + groupId });
      } catch (e) { console.error('[Admin] Relay event failed:', e.message); }
      res.json({ code: 200, message: '群组聊天记录已清除，共删除 ' + count + ' 条消息' });
    }
  } catch (e) {
    console.error('Clear chat error:', e.message);
    res.status(500).json({ code: 500, message: '清除聊天记录失败' });
  }
});

router.get('/groups', function(req, res) {
  try {
    var groups = db.prepare('SELECT id, name, creator_id, created_at FROM groups ORDER BY created_at DESC').all();
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].created_at) groups[i].created_at = time.toISOString(groups[i].created_at);
    }
    res.json({ code: 200, message: 'ok', data: groups });
  } catch (e) {
    res.json({ code: 200, message: 'ok', data: [] });
  }
});

// GET /api/admin/server-stats - Server performance stats
router.get('/server-stats', auth.requirePermission('view_logs'), function(req, res) {
  var totalMem = os.totalmem();
  var freeMem = os.freemem();
  var usedMem = totalMem - freeMem;
  var cpus = os.cpus();

  var cpuPercent = 0;
  var loadAvg = os.loadavg();
  if (cpus.length > 0 && loadAvg[0] > 0) {
    cpuPercent = Math.min(100, Math.round((loadAvg[0] / cpus.length) * 100));
  } else {
    var usage = process.cpuUsage();
    var totalUsage = usage.user + usage.system;
    cpuPercent = Math.min(100, Math.round(totalUsage / 10000));
  }

  var diskPercent = 0;
  try {
    var execSync = require('child_process').execSync;
    if (process.platform === 'win32') {
      var output = execSync('wmic logicaldisk get size,freespace /format:value', { encoding: 'utf-8', windowsHide: true });
      var totalSize = 0;
      var freeSize = 0;
      var instances = output.split('\r\r\n\r\r\n');
      for (var di = 0; di < instances.length; di++) {
        var inst = instances[di].trim();
        if (!inst) continue;
        var freeMatch = inst.match(/FreeSpace=(\d+)/);
        var sizeMatch = inst.match(/Size=(\d+)/);
        if (freeMatch) freeSize += parseInt(freeMatch[1]);
        if (sizeMatch) totalSize += parseInt(sizeMatch[1]);
      }
      if (totalSize > 0) diskPercent = Math.round(((totalSize - freeSize) / totalSize) * 100);
    } else {
      var dfOutput = execSync("df -k / | tail -1 | awk '{print $2,$3,$4}'", { encoding: 'utf-8', windowsHide: true }).trim();
      var parts = dfOutput.split(/\s+/);
      if (parts.length >= 2) {
        var totalK = parseInt(parts[0]) || 0;
        var usedK = parseInt(parts[1]) || 0;
        if (totalK > 0) diskPercent = Math.round((usedK / totalK) * 100);
      }
    }
  } catch (e) { console.error('[Admin] Relay event failed:', e.message); }

  var totalUsers = 0;
  var lastLogin = null;
  try {
    totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
    var lastRow = db.prepare('SELECT last_login FROM users WHERE last_login IS NOT NULL ORDER BY last_login DESC LIMIT 1').get();
    if (lastRow && lastRow.last_login) {
      lastLogin = time.toISOString(lastRow.last_login);
    }
  } catch (e) { console.error('[Admin] Relay event failed:', e.message); }

  var groupCount = 0;
  try {
    groupCount = db.prepare('SELECT COUNT(*) as cnt FROM groups').get().cnt;
  } catch (e) { console.error('[Admin] Relay event failed:', e.message); }

  var stats = {
    cpu: {
      cores: cpus.length,
      model: cpus[0] ? cpus[0].model : 'Unknown',
      usage: cpuPercent,
      loadAvg: loadAvg
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      usagePercent: Math.round((usedMem / totalMem) * 100)
    },
    disk: {
      usagePercent: diskPercent
    },
    uptime: os.uptime(),
    platform: os.platform(),
    nodeVersion: process.version,
    total_users: totalUsers,
    last_user_login: lastLogin || '-',
    group_count: groupCount,
    version: '1.0.0',
    connections: {
      http: 0,
      websocket: 0
    },
    timestamp: new Date().toISOString()
  };

  try {
    var chatServer = require('../ws/chat-server');
    if (chatServer.getOnlineCount) {
      stats.connections.websocket = chatServer.getOnlineCount();
    }
  } catch (e) { console.error('[Admin] Relay event failed:', e.message); }

  res.json({ code: 200, message: 'ok', data: stats });
});

// GET /api/admin/logs - Admin operation logs
router.get('/logs', auth.requirePermission('view_logs'), function(req, res) {
  var page = parseInt(req.query.page) || 1;
  var limit = parseInt(req.query.limit) || 20;
  var offset = (page - 1) * limit;

  var countStmt = db.prepare('SELECT COUNT(*) as total FROM admin_logs');
  var total = countStmt.get().total;

  var stmt = db.prepare('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT ? OFFSET ?');
  var logs = stmt.all(limit, offset);

  for (var i = 0; i < logs.length; i++) {
    if (logs[i].created_at) logs[i].created_at = time.toISOString(logs[i].created_at);
  }

  res.json({
    code: 200,
    message: 'ok',
    data: {
      logs: logs,
      total: total,
      page: page,
      limit: limit
    }
  });
});

// GET /api/admin/relay-status - Relay connection status
router.get('/relay-status', function(req, res) {
  var chatServer = require('../ws/chat-server');
  var mode = 'single';
  try {
    var modeRow = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('server_mode');
    if (modeRow) mode = modeRow.value;
  } catch (e) {}

  var status = {
    mode: mode,
    relay_enabled: chatServer.getRelayEnabled(),
    server_id: process.env.RELAY_SERVER_ID || '',
    configured_peers: (process.env.RELAY_SERVERS || '').split(',').filter(function(s) { return s.trim() !== ''; }),
    connected_peers: (function() {
      try {
        var peers = chatServer.getRelayPeers();
        return peers.map(function(p) {
          return {
            server_id: p.serverId || 'unknown',
            state: p.ws ? p.ws.readyState : -1
          };
        });
      } catch (e) {
        return [];
      }
    })(),
    remote_online_count: 0,
    sync_status: null
  };

  try {
    var remoteUsers = chatServer.getRemoteOnlineUsers();
    status.remote_online_count = Object.keys(remoteUsers).length;
  } catch (e) { console.error('[Admin] Relay event failed:', e.message); }

  try {
    var relaySync = require('../utils/relay-sync');
    status.sync_status = relaySync.getSyncStatus();
  } catch (e) { console.error('[Admin] Relay event failed:', e.message); }

  res.json({ code: 200, message: 'ok', data: status });
});

// GET /api/admin/server-mode - 获取服务器模式
router.get('/server-mode', function(req, res) {
  try {
    var row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('server_mode');
    var mode = row ? row.value : 'single';
    var chatServer = require('../ws/chat-server');
    res.json({ code: 200, data: { mode: mode, relay_enabled: chatServer.getRelayEnabled() } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取服务器模式失败' });
  }
});

// POST /api/admin/server-mode - 设置服务器模式
router.post('/server-mode', function(req, res) {
  var mode = req.body.mode;
  if (mode !== 'single' && mode !== 'multi') {
    return res.status(400).json({ code: 400, message: '无效的模式，仅支持 single 或 multi' });
  }
  try {
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run('server_mode', mode);
    var chatServer = require('../ws/chat-server');
    chatServer.setRelayEnabled(mode === 'multi');
    logAction(req.user.user_id, 'set_server_mode', 'server_mode', mode);
    res.json({ code: 200, message: mode === 'single' ? '已切换为单服务器模式' : '已切换为多服务器模式' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '设置服务器模式失败' });
  }
});

// POST /api/admin/relay-disconnect - 手动断开中继
router.post('/relay-disconnect', function(req, res) {
  try {
    var chatServer = require('../ws/chat-server');
    chatServer.disconnectRelay();
    logAction(req.user.user_id, 'relay_disconnect', '', 'Manually disconnected relay');
    res.json({ code: 200, message: '已断开所有中继连接' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '断开中继失败' });
  }
});

// POST /api/admin/relay-connect - 手动连接中继
router.post('/relay-connect', function(req, res) {
  try {
    var chatServer = require('../ws/chat-server');
    if (!chatServer.getRelayEnabled()) {
      return res.status(400).json({ code: 400, message: '当前为单服务器模式，请先切换为多服务器模式' });
    }
    chatServer.connectRelay();
    logAction(req.user.user_id, 'relay_connect', '', 'Manually connected relay');
    res.json({ code: 200, message: '正在连接中继服务器...' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '连接中继失败' });
  }
});

// POST /api/admin/trigger-sync - Manually trigger catchup sync
router.post('/trigger-sync', function(req, res) {
  try {
    var chatServer = require('../ws/chat-server');
    var relaySync = require('../utils/relay-sync');
    var peers = chatServer.getRelayPeers();
    if (!peers || peers.length === 0) {
      return res.json({ code: 200, message: '没有已连接的联动服务器' });
    }
    var mySyncState = relaySync.getSyncState();
    var catchupRequest = JSON.stringify({
      type: 'relay_catchup_request',
      server_id: process.env.RELAY_SERVER_ID || '',
      sync_state: mySyncState
    });
    var sentCount = 0;
    for (var i = 0; i < peers.length; i++) {
      try {
        var WebSocket = require('ws');
        if (peers[i].ws && peers[i].ws.readyState === WebSocket.OPEN) {
          peers[i].ws.send(catchupRequest);
          sentCount++;
        }
      } catch (e) { console.error('[Admin] Relay event failed:', e.message); }
    }
    res.json({ code: 200, message: '同步请求已发送到 ' + sentCount + ' 个服务器' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '触发同步失败' });
  }
});

router.get('/consistency-check', auth.requireAdmin, function(req, res) {
  var result = {};
  try {
    result.chat_count = db.prepare('SELECT COUNT(*) as cnt FROM chat_messages').get().cnt;
    result.pm_count = db.prepare('SELECT COUNT(*) as cnt FROM private_messages').get().cnt;
    result.gm_count = db.prepare('SELECT COUNT(*) as cnt FROM group_messages').get().cnt;
    result.post_count = db.prepare('SELECT COUNT(*) as cnt FROM community_posts').get().cnt;
    result.comment_count = db.prepare('SELECT COUNT(*) as cnt FROM community_comments').get().cnt;
    result.like_count = db.prepare('SELECT COUNT(*) as cnt FROM community_likes').get().cnt;
    result.reaction_count = db.prepare('SELECT COUNT(*) as cnt FROM message_reactions').get().cnt;
    result.bookmark_count = db.prepare('SELECT COUNT(*) as cnt FROM community_bookmarks').get().cnt;
    result.user_count = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
    result.group_count = db.prepare('SELECT COUNT(*) as cnt FROM groups').get().cnt;
    result.exp_log_count = db.prepare('SELECT COUNT(*) as cnt FROM exp_log').get().cnt;
    result.broadcast_count = db.prepare('SELECT COUNT(*) as cnt FROM broadcasts').get().cnt;
    result.tombstone_count = db.prepare('SELECT COUNT(*) as cnt FROM sync_tombstones').get().cnt;
    result.watermarks = db.prepare('SELECT data_type, watermark, updated_at FROM sync_watermarks ORDER BY data_type').all();
  } catch (e) {
    return res.json({ code: 500, message: e.message });
  }
  res.json({ code: 200, message: 'ok', data: result });
});

router.get('/syncthing-status', function(req, res) {
  var config = require('../config');
  var syncthingConfig = config.syncthing;

  if (!syncthingConfig.apiKey) {
    return res.json({ code: 200, message: 'ok', data: { configured: false, message: 'Syncthing API Key 未配置' } });
  }

  var axios = require('axios');
  var baseUrl = 'http://' + syncthingConfig.host + ':' + syncthingConfig.port;

  var headers = { 'X-API-Key': syncthingConfig.apiKey };

  Promise.all([
    axios.get(baseUrl + '/rest/system/status', { headers: headers, timeout: 5000 }).catch(function(e) { return { data: null, error: e.message }; }),
    axios.get(baseUrl + '/rest/config', { headers: headers, timeout: 5000 }).catch(function(e) { return { data: null, error: e.message }; }),
    axios.get(baseUrl + '/rest/folder/status', { headers: headers, timeout: 5000 }).catch(function(e) { return { data: null, error: e.message }; })
  ]).then(function(results) {
    var systemStatus = results[0].data;
    var folderConfig = results[1].data;
    var folderStatus = results[2].data;

    var folders = [];
    if (folderConfig && folderConfig.folders) {
      var statusMap = {};
      if (folderStatus) {
        for (var k = 0; k < folderStatus.length; k++) {
          statusMap[folderStatus[k].id] = folderStatus[k];
        }
      }
      for (var i = 0; i < folderConfig.folders.length; i++) {
        var f = folderConfig.folders[i];
        var st = statusMap[f.id] || {};
        folders.push({
          id: f.id,
          label: f.label,
          path: f.path,
          state: st.state || 'unknown',
          globalFiles: st.globalFiles || 0,
          localFiles: st.localFiles || 0,
          needFiles: st.needFiles || 0,
          needBytes: st.needBytes || 0,
          lastScan: st.lastScan || null
        });
      }
    }

    var data = {
      configured: true,
      myID: systemStatus ? systemStatus.myID : null,
      version: systemStatus ? systemStatus.version : null,
      uptime: systemStatus ? systemStatus.uptime : 0,
      folders: folders,
      errors: []
    };

    if (!systemStatus) data.errors.push('无法获取系统状态');
    if (!folderConfig) data.errors.push('无法获取文件夹配置');

    res.json({ code: 200, message: 'ok', data: data });
  }).catch(function(e) {
    res.json({ code: 200, message: 'ok', data: { configured: true, error: '连接 Syncthing 失败: ' + e.message } });
  });
});

router.get('/tailscale-status', function(req, res) {
  var config = require('../config');
  var tailscaleConfig = config.tailscale;

  if (!tailscaleConfig.enabled) {
    return res.json({ code: 200, message: 'ok', data: { enabled: false, message: 'Tailscale 集成未启用' } });
  }

  var execSync = require('child_process').execSync;
  var result = { enabled: true, self: {}, peers: [], relay_ip: tailscaleConfig.relayIp };

  try {
    var output = execSync(tailscaleConfig.statusCommand, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    var status = JSON.parse(output);

    if (status.Self) {
      result.self = {
        hostname: status.Self.HostName || '',
        dnsName: status.Self.DNSName || '',
        tailscaleIPs: status.Self.TailscaleIPs || [],
        os: status.Self.OS || '',
        online: status.Self.Online || false
      };
    }

    if (status.Peer) {
      var peerKeys = Object.keys(status.Peer);
      for (var i = 0; i < peerKeys.length; i++) {
        var peer = status.Peer[peerKeys[i]];
        result.peers.push({
          hostname: peer.HostName || '',
          dnsName: peer.DNSName || '',
          tailscaleIPs: peer.TailscaleIPs || [],
          os: peer.OS || '',
          online: peer.Online || false,
          lastSeen: peer.LastSeen || null,
          relay: peer.Relay || ''
        });
      }
    }
  } catch (e) {
    result.error = '获取 Tailscale 状态失败: ' + e.message;
  }

  try {
    var ipOutput = execSync('tailscale ip -4 2>/dev/null || echo ""', { encoding: 'utf-8', timeout: 3000, windowsHide: true }).trim();
    if (ipOutput) result.self.tailscaleIPs = result.self.tailscaleIPs || [];
    if (ipOutput && result.self.tailscaleIPs.indexOf(ipOutput) === -1) {
      result.self.tailscaleIPs.unshift(ipOutput);
    }
  } catch (e) { console.error('[Admin] Relay event failed:', e.message); }

  res.json({ code: 200, message: 'ok', data: result });
});

router.get('/resource-settings', auth.requirePermission('manage_resources'), function(req, res) {
  try {
    var row = db.prepare('SELECT resource_settings_json FROM user_settings WHERE user_id = ?').get('__system__');
    var settings = {};
    if (row && row.resource_settings_json) {
      settings = JSON.parse(row.resource_settings_json);
    }
    // 兼容旧版 media_visible：如果存在旧字段，迁移为两个独立字段
    if (typeof settings.media_visible !== 'undefined' && typeof settings.video_visible === 'undefined' && typeof settings.music_visible === 'undefined') {
      settings.video_visible = settings.media_visible;
      settings.music_visible = settings.media_visible;
      delete settings.media_visible;
    }
    res.json({
      code: 200,
      message: 'ok',
      data: {
        video_visible: settings.video_visible !== false,
        music_visible: settings.music_visible !== false
      }
    });
  } catch (e) {
    res.json({ code: 200, message: 'ok', data: { video_visible: true, music_visible: true } });
  }
});

router.post('/resource-settings', auth.requirePermission('manage_resources'), function(req, res) {
  try {
    var videoVisible = req.body.video_visible;
    var musicVisible = req.body.music_visible;
    // 兼容旧版 media_visible 参数
    if (typeof videoVisible === 'undefined' && typeof musicVisible === 'undefined' && typeof req.body.media_visible !== 'undefined') {
      videoVisible = req.body.media_visible;
      musicVisible = req.body.media_visible;
    }
    if (typeof videoVisible === 'undefined' && typeof musicVisible === 'undefined') {
      return res.status(400).json({ code: 400, message: '缺少参数' });
    }
    var row = db.prepare('SELECT resource_settings_json FROM user_settings WHERE user_id = ?').get('__system__');
    var settings = {};
    if (row && row.resource_settings_json) {
      settings = JSON.parse(row.resource_settings_json);
    }
    // 清除旧字段
    delete settings.media_visible;
    if (typeof videoVisible !== 'undefined') {
      settings.video_visible = !!videoVisible;
    }
    if (typeof musicVisible !== 'undefined') {
      settings.music_visible = !!musicVisible;
    }
    var existing = db.prepare('SELECT 1 FROM user_settings WHERE user_id = ?').get('__system__');
    if (existing) {
      db.prepare('UPDATE user_settings SET resource_settings_json = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(JSON.stringify(settings), '__system__');
    } else {
      db.prepare('INSERT INTO user_settings (user_id, resource_settings_json, updated_at) VALUES (?, ?, datetime(\'now\'))').run('__system__', JSON.stringify(settings));
    }
    res.json({ code: 200, message: 'ok', data: { video_visible: settings.video_visible, music_visible: settings.music_visible } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '保存失败' });
  }
});

// GET /api/admin/chat-stats - Chat statistics and online users
router.get('/chat-stats', auth.requirePermission('manage_chat'), function(req, res) {
  try {
    var chatServer = require('../ws/chat-server');
    var onlineUsers = chatServer.getOnlineUsers ? chatServer.getOnlineUsers() : [];
    var onlineCount = onlineUsers.length;
    var totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE status = ?').get('active').cnt;
    var groupCount = 0;
    try { groupCount = db.prepare('SELECT COUNT(*) as cnt FROM groups').get().cnt; } catch (e) {}
    var recentMessages = 0;
    try {
      var row = db.prepare("SELECT COUNT(*) as cnt FROM group_messages WHERE created_at > datetime('now', '-24 hours')").get();
      recentMessages = row ? row.cnt : 0;
    } catch (e) {}
    var groups = [];
    try {
      groups = db.prepare('SELECT g.group_id, g.group_name, g.creator_id, g.created_at, (SELECT COUNT(*) FROM group_members WHERE group_id = g.group_id) as member_count FROM groups g ORDER BY g.created_at DESC LIMIT 100').all();
    } catch (e) {}
    res.json({
      code: 200,
      message: 'ok',
      data: {
        online_count: onlineCount,
        total_users: totalUsers,
        group_count: groupCount,
        recent_messages_24h: recentMessages,
        online_users: onlineUsers,
        groups: groups
      }
    });
  } catch (e) {
    res.json({ code: 200, message: 'ok', data: { online_count: 0, total_users: 0, group_count: 0, recent_messages_24h: 0, online_users: [], groups: [] } });
  }
});

// DELETE /api/admin/chat/messages/:messageId - Delete a chat message
router.delete('/chat/messages/:messageId', auth.requirePermission('manage_chat'), function(req, res) {
  var messageId = req.params.messageId;
  if (!messageId) return res.status(400).json({ code: 400, message: '缺少消息ID' });
  try {
    var msg = db.prepare('SELECT * FROM group_messages WHERE message_id = ?').get(messageId);
    if (!msg) return res.status(404).json({ code: 404, message: '消息不存在' });
    db.prepare('DELETE FROM group_messages WHERE message_id = ?').run(messageId);
    try {
      var chatServer = require('../ws/chat-server');
      chatServer.broadcastToIsland({
        type: 'message_deleted',
        message_id: messageId,
        group_id: msg.group_id,
        deleted_by: req.user.user_id
      });
    } catch (e) {}
    logAction(req.user.user_id, 'delete_chat_message', messageId, 'Group: ' + msg.group_id);
    res.json({ code: 200, message: '消息已删除' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '删除失败' });
  }
});

// GET /api/admin/chat/groups/:groupId/messages - Get group messages for admin
router.get('/chat/groups/:groupId/messages', auth.requirePermission('manage_chat'), function(req, res) {
  var groupId = req.params.groupId;
  var limit = parseInt(req.query.limit) || 50;
  var before = req.query.before || '';
  if (limit > 200) limit = 200;
  try {
    var msgs;
    if (before) {
      msgs = db.prepare('SELECT * FROM group_messages WHERE group_id = ? AND created_at < (SELECT created_at FROM group_messages WHERE message_id = ?) ORDER BY created_at DESC LIMIT ?').all(groupId, before, limit);
    } else {
      msgs = db.prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT ?').all(groupId, limit);
    }
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].created_at) msgs[i].created_at = time.toISOString(msgs[i].created_at);
    }
    msgs.reverse();
    res.json({ code: 200, message: 'ok', data: { messages: msgs } });
  } catch (e) {
    res.json({ code: 200, message: 'ok', data: { messages: [] } });
  }
});

function isClassAdminUser(req) {
  return req.user && constants.isClassAdmin(req.user.user_id);
}

var _pm2Module = null;
function getPm2() {
  if (_pm2Module) return _pm2Module;
  try {
    _pm2Module = require('pm2');
    return _pm2Module;
  } catch (e) {
    return null;
  }
}

function pm2Connect(callback) {
  var pm2 = getPm2();
  if (!pm2) return callback(new Error('PM2 module not installed'));
  pm2.connect(function(err) {
    if (err) {
      try { pm2.disconnect(); } catch (e) {}
      return callback(new Error('PM2 daemon not running. Start PM2 first: pm2 start ecosystem.config.js'));
    }
    callback(null, pm2);
  });
}

router.get('/pm2/status', function(req, res) {
  if (!isClassAdminUser(req)) return res.status(403).json({ code: 403, message: '仅班管可操作' });
  pm2Connect(function(err, pm2) {
    if (err) return res.status(500).json({ code: 500, message: err.message });
    pm2.list(function(err2, list) {
      pm2.disconnect();
      if (err2) return res.status(500).json({ code: 500, message: err2.message });
      var processes = list.map(function(p) {
        return {
          pid: p.pid,
          name: p.name,
          pm_id: p.pm_id,
          status: p.pm2_env.status,
          mode: p.pm2_env.exec_mode,
          restarts: p.pm2_env.restart_time,
          uptime: p.pm2_env.pm_uptime,
          cpu: p.monit ? p.monit.cpu : 0,
          memory: p.monit ? p.monit.memory : 0,
          memory_limit: p.pm2_env.max_memory_restart || null,
          node_version: p.pm2_env.node_version || null,
          script: p.pm2_env.pm_exec_path || null,
          cwd: p.pm2_env.pm_cwd || null,
          error_file: p.pm2_env.pm_err_log_path || null,
          out_file: p.pm2_env.pm_out_log_path || null
        };
      });
      res.json({ code: 200, message: 'ok', data: { processes: processes, timestamp: new Date().toISOString() } });
    });
  });
});

router.post('/pm2/restart', function(req, res) {
  if (!isClassAdminUser(req)) return res.status(403).json({ code: 403, message: '仅班管可操作' });
  pm2Connect(function(err, pm2) {
    if (err) return res.status(500).json({ code: 500, message: err.message });
    pm2.restart('classintra-server', function(err2, proc) {
      pm2.disconnect();
      if (err2) return res.status(500).json({ code: 500, message: err2.message });
      logAction(req.user.user_id, 'pm2_restart', 'classintra-server', 'Restarted via admin panel');
      res.json({ code: 200, message: 'Restarted', data: { name: 'classintra-server' } });
    });
  });
});

router.post('/pm2/stop', function(req, res) {
  if (!isClassAdminUser(req)) return res.status(403).json({ code: 403, message: '仅班管可操作' });
  pm2Connect(function(err, pm2) {
    if (err) return res.status(500).json({ code: 500, message: err.message });
    pm2.stop('classintra-server', function(err2, proc) {
      pm2.disconnect();
      if (err2) return res.status(500).json({ code: 500, message: err2.message });
      logAction(req.user.user_id, 'pm2_stop', 'classintra-server', 'Stopped via admin panel');
      res.json({ code: 200, message: 'Stopped', data: { name: 'classintra-server' } });
    });
  });
});

router.post('/pm2/start', function(req, res) {
  if (!isClassAdminUser(req)) return res.status(403).json({ code: 403, message: '仅班管可操作' });
  pm2Connect(function(err, pm2) {
    if (err) return res.status(500).json({ code: 500, message: err.message });
    pm2.start('classintra-server', function(err2, proc) {
      pm2.disconnect();
      if (err2) return res.status(500).json({ code: 500, message: err2.message });
      logAction(req.user.user_id, 'pm2_start', 'classintra-server', 'Started via admin panel');
      res.json({ code: 200, message: 'Started', data: { name: 'classintra-server' } });
    });
  });
});

router.post('/pm2/flush-logs', function(req, res) {
  if (!isClassAdminUser(req)) return res.status(403).json({ code: 403, message: '仅班管可操作' });
  pm2Connect(function(err, pm2) {
    if (err) return res.status(500).json({ code: 500, message: err.message });
    pm2.flush('classintra-server', function(err2) {
      pm2.disconnect();
      if (err2) return res.status(500).json({ code: 500, message: err2.message });
      logAction(req.user.user_id, 'pm2_flush', 'classintra-server', 'Flushed logs via admin panel');
      res.json({ code: 200, message: 'Logs flushed' });
    });
  });
});

router.get('/pm2/logs', function(req, res) {
  if (!isClassAdminUser(req)) return res.status(403).json({ code: 403, message: '仅班管可操作' });
  var lines = parseInt(req.query.lines) || 100;
  var logDir = path.resolve(__dirname, '../../logs');
  var result = { out: [], error: [] };
  try {
    var outFile = path.join(logDir, 'server-out.log');
    var outContent = fs.readFileSync(outFile, 'utf8');
    var outLines = outContent.trim().split('\n');
    result.out = outLines.slice(-lines);
  } catch (e) { result.outError = e.message; }
  try {
    var errFile = path.join(logDir, 'server-error.log');
    var errContent = fs.readFileSync(errFile, 'utf8');
    var errLines = errContent.trim().split('\n');
    result.error = errLines.slice(-lines);
  } catch (e) { result.errorError = e.message; }
  res.json({ code: 200, message: 'ok', data: result });
});

router.get('/pm2/describe', function(req, res) {
  if (!isClassAdminUser(req)) return res.status(403).json({ code: 403, message: '仅班管可操作' });
  pm2Connect(function(err, pm2) {
    if (err) return res.status(500).json({ code: 500, message: err.message });
    pm2.describe('classintra-server', function(err2, desc) {
      pm2.disconnect();
      if (err2) return res.status(500).json({ code: 500, message: err2.message });
      var d = desc && desc[0] ? desc[0] : null;
      if (!d) return res.json({ code: 200, message: 'ok', data: null });
      var info = {
        pid: d.pid,
        name: d.name,
        status: d.pm2_env ? d.pm2_env.status : 'unknown',
        mode: d.pm2_env ? d.pm2_env.exec_mode : 'unknown',
        restarts: d.pm2_env ? d.pm2_env.restart_time : 0,
        uptime: d.pm2_env ? d.pm2_env.pm_uptime : null,
        cpu: d.monit ? d.monit.cpu : 0,
        memory: d.monit ? d.monit.memory : 0,
        unstable_restarts: d.pm2_env ? d.pm2_env.unstable_restarts : 0,
        created_at: d.pm2_env ? d.pm2_env.created_at : null,
        script: d.pm2_env ? d.pm2_env.pm_exec_path : null,
        cwd: d.pm2_env ? d.pm2_env.pm_cwd : null,
        node_args: d.pm2_env ? d.pm2_env.node_args : [],
        env: d.pm2_env ? d.pm2_env.env : {},
        error_file: d.pm2_env ? d.pm2_env.pm_err_log_path : null,
        out_file: d.pm2_env ? d.pm2_env.pm_out_log_path : null
      };
      res.json({ code: 200, message: 'ok', data: info });
    });
  });
});

// AI 模型管理仅限班管（不是班干）
function requireClassAdmin(req, res, next) {
  if (!req.user || !constants.isClassAdmin(req.user.user_id)) {
    return res.status(403).json({ code: 403, message: '仅班管可管理AI设置' });
  }
  next();
}

router.get('/ai-settings', requireClassAdmin, function(req, res) {
  var page = parseInt(req.query.page) || 1;
  var limit = parseInt(req.query.limit) || 50;
  var search = req.query.search || '';
  var offset = (page - 1) * limit;

  var whereClause = 'WHERE 1=1';
  var params = [];
  if (search) {
    whereClause += ' AND (u.net_name LIKE ? OR u.real_name LIKE ? OR u.user_id LIKE ?)';
    params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
  }

  var countStmt = db.prepare('SELECT COUNT(*) as total FROM users u ' + whereClause);
  var countResult = countStmt.get.apply(countStmt, params);
  var total = countResult.total;

  var dataStmt = db.prepare(
    'SELECT u.id, u.net_name, u.real_name, u.user_id, u.status, ' +
    'COALESCE(s.deepseek_enabled, 0) as deepseek_enabled, ' +
    'COALESCE(s.ai_settings_json, \'{}\') as ai_settings_json ' +
    'FROM users u LEFT JOIN user_settings s ON u.user_id = s.user_id ' +
    whereClause + ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?'
  );
  var dataParams = params.concat([limit, offset]);
  var users = dataStmt.all.apply(dataStmt, dataParams);

  for (var i = 0; i < users.length; i++) {
    users[i].deepseek_enabled = users[i].deepseek_enabled === 1;
    try {
      var aiSettings = JSON.parse(users[i].ai_settings_json || '{}');
      users[i].ai_model = aiSettings.model || 'default';
    } catch (e) {
      users[i].ai_model = 'default';
    }
    delete users[i].ai_settings_json;
  }

  res.json({ code: 200, message: 'ok', data: { users: users, total: total, page: page, limit: limit } });
});

router.patch('/ai-settings/:userId/deepseek', requireClassAdmin, function(req, res) {
  var targetUserId = req.params.userId;
  var enabled = req.body.enabled ? 1 : 0;

  var existing = db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(targetUserId);
  if (existing) {
    db.prepare('UPDATE user_settings SET deepseek_enabled = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(enabled, targetUserId);
  } else {
    db.prepare("INSERT INTO user_settings (user_id, deepseek_enabled, ai_settings_json, created_at, updated_at) VALUES (?, ?, '{\"system_prompt\":\"\",\"pinned_conversations\":[],\"model\":\"default\"}', datetime('now'), datetime('now'))")
      .run(targetUserId, enabled);
  }

  logAction(req.user.user_id, 'toggle_deepseek', targetUserId, 'deepseek_enabled=' + enabled);
  res.json({ code: 200, message: 'ok', data: { user_id: targetUserId, deepseek_enabled: enabled === 1 } });
});

router.post('/ai-settings/batch-deepseek', requireClassAdmin, function(req, res) {
  var userIds = req.body.user_ids || [];
  var enabled = req.body.enabled ? 1 : 0;

  if (!userIds.length) {
    return res.status(400).json({ code: 400, message: '请选择用户' });
  }

  for (var i = 0; i < userIds.length; i++) {
    var uid = userIds[i];
    var existing = db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(uid);
    if (existing) {
      db.prepare('UPDATE user_settings SET deepseek_enabled = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(enabled, uid);
    } else {
      db.prepare("INSERT INTO user_settings (user_id, deepseek_enabled, ai_settings_json, created_at, updated_at) VALUES (?, ?, '{\"system_prompt\":\"\",\"pinned_conversations\":[],\"model\":\"default\"}', datetime('now'), datetime('now'))")
        .run(uid, enabled);
    }
  }

  logAction(req.user.user_id, 'batch_toggle_deepseek', userIds.join(','), 'deepseek_enabled=' + enabled);
  res.json({ code: 200, message: 'ok' });
});

// ======== 天气提醒设置 ========

// GET /api/admin/weather-alert/settings - 获取所有天气提醒时间设置
router.get('/weather-alert/settings', function(req, res) {
  try {
    var schedules = db.prepare('SELECT * FROM weather_alert_settings ORDER BY schedule_time ASC').all();
    for (var i = 0; i < schedules.length; i++) {
      schedules[i].enabled = schedules[i].enabled ? true : false;
      if (schedules[i].created_at) schedules[i].created_at = time.toISOString(schedules[i].created_at);
    }
    res.json({ code: 200, data: { schedules: schedules } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取天气提醒设置失败' });
  }
});

// POST /api/admin/weather-alert/settings - 添加新的提醒时间
router.post('/weather-alert/settings', function(req, res) {
  var scheduleTime = req.body.schedule_time;
  if (!scheduleTime) {
    return res.status(400).json({ code: 400, message: '缺少提醒时间' });
  }
  // 验证 HH:MM 格式
  if (!/^\d{2}:\d{2}$/.test(scheduleTime)) {
    return res.status(400).json({ code: 400, message: '时间格式错误，应为 HH:MM' });
  }
  var parts = scheduleTime.split(':');
  var hour = parseInt(parts[0]);
  var minute = parseInt(parts[1]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return res.status(400).json({ code: 400, message: '时间范围无效' });
  }
  // 不允许重复时间
  var existing = db.prepare('SELECT id FROM weather_alert_settings WHERE schedule_time = ?').get(scheduleTime);
  if (existing) {
    return res.status(400).json({ code: 400, message: '该提醒时间已存在' });
  }
  try {
    var result = db.prepare("INSERT INTO weather_alert_settings (schedule_time, enabled, created_at) VALUES (?, 1, datetime('now'))").run(scheduleTime);
    var row = db.prepare('SELECT * FROM weather_alert_settings WHERE id = ?').get(result.lastInsertRowid);
    row.enabled = row.enabled ? true : false;
    if (row.created_at) row.created_at = time.toISOString(row.created_at);
    logAction(req.user.user_id, 'add_weather_alert', String(result.lastInsertRowid), 'Schedule: ' + scheduleTime);
    res.json({ code: 200, message: '添加成功', data: row });
  } catch (e) {
    res.status(500).json({ code: 500, message: '添加天气提醒失败' });
  }
});

// DELETE /api/admin/weather-alert/settings/:id - 删除指定提醒时间
router.delete('/weather-alert/settings/:id', function(req, res) {
  var id = req.params.id;
  try {
    var row = db.prepare('SELECT * FROM weather_alert_settings WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ code: 404, message: '提醒设置不存在' });
    }
    db.prepare('DELETE FROM weather_alert_settings WHERE id = ?').run(id);
    logAction(req.user.user_id, 'delete_weather_alert', String(id), 'Schedule: ' + row.schedule_time);
    res.json({ code: 200, message: '删除成功' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '删除天气提醒失败' });
  }
});

// PATCH /api/admin/weather-alert/settings/:id - 更新提醒时间
router.patch('/weather-alert/settings/:id', function(req, res) {
  var id = req.params.id;
  var scheduleTime = req.body.schedule_time;
  var enabled = req.body.enabled;

  var row = db.prepare('SELECT * FROM weather_alert_settings WHERE id = ?').get(id);
  if (!row) {
    return res.status(404).json({ code: 404, message: '提醒设置不存在' });
  }

  var fields = [];
  var values = [];

  if (scheduleTime !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(scheduleTime)) {
      return res.status(400).json({ code: 400, message: '时间格式错误，应为 HH:MM' });
    }
    var parts = scheduleTime.split(':');
    var hour = parseInt(parts[0]);
    var minute = parseInt(parts[1]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return res.status(400).json({ code: 400, message: '时间范围无效' });
    }
    // 检查重复（排除自身）
    var dup = db.prepare('SELECT id FROM weather_alert_settings WHERE schedule_time = ? AND id != ?').get(scheduleTime, id);
    if (dup) {
      return res.status(400).json({ code: 400, message: '该提醒时间已存在' });
    }
    fields.push('schedule_time = ?');
    values.push(scheduleTime);
  }

  if (enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (fields.length === 0) {
    return res.status(400).json({ code: 400, message: '无有效更新字段' });
  }

  values.push(id);
  var updateStmt = db.prepare('UPDATE weather_alert_settings SET ' + fields.join(', ') + ' WHERE id = ?');
  updateStmt.run.apply(updateStmt, values);

  var updated = db.prepare('SELECT * FROM weather_alert_settings WHERE id = ?').get(id);
  updated.enabled = updated.enabled ? true : false;
  if (updated.created_at) updated.created_at = time.toISOString(updated.created_at);
  logAction(req.user.user_id, 'update_weather_alert', String(id), 'Schedule: ' + (scheduleTime || row.schedule_time));
  res.json({ code: 200, message: '更新成功', data: updated });
});

// GET /api/admin/weather-alert/check - 手动触发天气检查
router.get('/weather-alert/check', function(req, res) {
  var weatherRoute = require('./weather');
  weatherRoute.checkWeatherAlert().then(function(result) {
    res.json({
      code: 200,
      data: {
        has_rain: result.has_rain,
        rain_text: result.rain_text,
        has_warning: result.has_warning,
        warnings: result.warnings,
        current_weather: result.current
      }
    });
  }).catch(function(err) {
    res.status(500).json({ code: 500, message: '天气检查失败: ' + err.message });
  });
});

// POST /api/admin/weather-alert/broadcast - 手动广播天气提醒
router.post('/weather-alert/broadcast', function(req, res) {
  var alertType = req.body.alert_type || 'both';
  var rainText = req.body.rain_text || '';
  var warnings = req.body.warnings || [];

  if (['rain', 'warning', 'both'].indexOf(alertType) === -1) {
    return res.status(400).json({ code: 400, message: '无效的提醒类型' });
  }

  try {
    var relayBus = require('../utils/relay-bus');
    // 天气预警仅广播本地，不中继到其他服务器
    relayBus.emitLocal('weather_alert', {
      alert_type: alertType,
      rain_text: rainText,
      warnings: warnings,
      timestamp: new Date().toISOString()
    });
    logAction(req.user.user_id, 'broadcast_weather_alert', '', 'Type: ' + alertType);
    res.json({ code: 200, message: '天气提醒已广播' });
  } catch (e) {
    console.error('[Admin] Weather alert broadcast failed:', e.message);
    res.status(500).json({ code: 500, message: '广播天气提醒失败' });
  }
});

// ===== 应用管控 =====
// 管理员/班干控制每个桌面应用的启用与禁用，禁用的应用不在用户桌面显示

// 桌面应用元数据（与前端 Desktop.vue dockApps 保持一致）
var DESKTOP_APPS = [
  { name: 'chat', label: '聊天', icon: 'fa-solid fa-comments', color: '#007AFF' },
  { name: 'community', label: '社区', icon: 'fa-solid fa-people-group', color: '#FF9500' },
  { name: 'ai-chat', label: 'AI', icon: 'fa-solid fa-robot', color: '#AF52DE' },
  { name: 'notes', label: '笔记', icon: 'fa-solid fa-note-sticky', color: '#FFCC00' },
  { name: 'resource', label: '资源', icon: 'fa-solid fa-folder', color: '#5856D6' },
  { name: 'weather', label: '天气', icon: 'fa-solid fa-cloud-sun-rain', color: '#5AC8FA' },
  { name: 'music', label: '音乐', icon: 'fa-solid fa-music', color: '#FF2D55' },
  { name: 'settings', label: '设置', icon: 'fa-solid fa-gear', color: '#8E8E93' }
];

// GET /api/admin/app-control - 获取所有应用及启用状态
router.get('/app-control', auth.requirePermission('manage_app_control'), function(req, res) {
  try {
    var rows = db.prepare('SELECT app_name, enabled, updated_by, updated_at FROM app_control').all();
    var statusMap = {};
    for (var i = 0; i < rows.length; i++) {
      statusMap[rows[i].app_name] = {
        enabled: rows[i].enabled ? true : false,
        updated_by: rows[i].updated_by || '',
        updated_at: rows[i].updated_at || ''
      };
    }
    var apps = DESKTOP_APPS.map(function(app) {
      var status = statusMap[app.name] || { enabled: true, updated_by: '', updated_at: '' };
      return {
        name: app.name,
        label: app.label,
        icon: app.icon,
        color: app.color,
        enabled: status.enabled,
        updated_by: status.updated_by,
        updated_at: status.updated_at
      };
    });
    res.json({ code: 200, data: { apps: apps } });
  } catch (e) {
    console.error('[Admin] Get app-control failed:', e.message);
    res.status(500).json({ code: 500, message: '获取应用管控状态失败' });
  }
});

// PUT /api/admin/app-control/:appName - 更新应用启用状态
router.put('/app-control/:appName', auth.requirePermission('manage_app_control'), function(req, res) {
  var appName = req.params.appName;
  // 验证应用名合法
  var validApp = null;
  for (var i = 0; i < DESKTOP_APPS.length; i++) {
    if (DESKTOP_APPS[i].name === appName) { validApp = DESKTOP_APPS[i]; break; }
  }
  if (!validApp) {
    return res.status(400).json({ code: 400, message: '无效的应用名称' });
  }
  // settings 应用不允许禁用（确保用户始终能访问设置）
  if (appName === 'settings' && !req.body.enabled) {
    return res.status(400).json({ code: 400, message: '设置应用不允许禁用' });
  }
  var enabled = req.body.enabled ? 1 : 0;
  try {
    db.prepare("INSERT INTO app_control (app_name, enabled, updated_by, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(app_name) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .run(appName, enabled, req.user.user_id || '');
    logAction(req.user.user_id, enabled ? 'enable_app' : 'disable_app', appName, validApp.label);
    res.json({ code: 200, message: enabled ? '应用已启用' : '应用已禁用', data: { app_name: appName, enabled: enabled ? true : false } });
  } catch (e) {
    console.error('[Admin] Update app-control failed:', e.message);
    res.status(500).json({ code: 500, message: '更新应用状态失败' });
  }
});

// ===== 远程管理代理 =====
// 班管通过中继通道管理本班在其他服务器上的数据

// POST /api/admin/remote-action - 发送远程管理命令
router.post('/remote-action', auth.requirePermission('manage_users'), function(req, res) {
  var adminUserId = req.user ? req.user.user_id : '';
  var adminClass = getUserAdminClass(adminUserId);

  // 班管可进行远程管理
  if (!adminClass && !constants.isClassAdmin(adminUserId)) {
    return res.status(403).json({ code: 403, message: '无远程管理权限' });
  }

  var action = req.body.action;     // 'ban', 'unban', 'edit', 'delete', 'list'
  var targetUserId = req.body.targetUserId || '';
  var params = req.body.params || {};

  if (!action) return res.status(400).json({ code: 400, message: '缺少 action 参数' });

  try {
    var chatServer = require('../ws/chat-server');
    var crypto = require('crypto');
    var requestId = 'ra_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    var timestamp = Date.now();

    // 生成请求签名，防止伪造
    var signPayload = adminUserId + ':' + action + ':' + targetUserId + ':' + timestamp + ':' + requestId;
    var relaySecret = process.env.RELAY_SECRET || '';
    var signature = relaySecret ? crypto.createHmac('sha256', relaySecret).update(signPayload).digest('hex') : '';

    // 通过中继通道发送远程管理命令
    var relayBus = require('../utils/relay-bus');
    relayBus.relayOnly('remote_admin_action', {
      request_id: requestId,
      admin_user_id: adminUserId,
      action: action,
      target_user_id: targetUserId,
      params: params,
      timestamp: timestamp,
      signature: signature
    });

    res.json({ code: 200, message: '远程管理命令已发送', request_id: requestId });
  } catch (e) {
    res.status(500).json({ code: 500, message: '发送远程命令失败: ' + e.message });
  }
});

// GET /api/admin/remote-servers - 获取已连接的远程服务器列表
router.get('/remote-servers', function(req, res) {
  var adminUserId = req.user ? req.user.user_id : '';
  var adminClass = getUserAdminClass(adminUserId);
  if (adminClass) {
    return res.status(403).json({ code: 403, message: '班级管理员无法查看远程服务器' });
  }

  try {
    var chatServer = require('../ws/chat-server');
    var peers = chatServer.getRelayPeers();
    var serverList = peers.map(function(p) {
      return {
        server_id: p.serverId,
        connected: true,
        online_users: (p.onlineUserCount || 0)
      };
    });
    res.json({ code: 200, data: { servers: serverList } });
  } catch (e) {
    res.status(500).json({ code: 500, message: '获取远程服务器列表失败' });
  }
});

// 注册远程管理命令处理器
try {
  var chatServerForHandler = require('../ws/chat-server');
  chatServerForHandler.onRelayEvent('remote_admin_action', function(data) {
    // 收到来自其他服务器的远程管理命令，在本服务器执行
    var action = data.action;
    var targetUserId = data.target_user_id;
    var params = data.params || {};
    var adminUserId = data.admin_user_id;

    // 验证请求签名，防止伪造
    var relaySecret = process.env.RELAY_SECRET || '';
    if (!relaySecret) {
      console.warn('[RemoteAdmin] RELAY_SECRET not configured, rejecting remote action');
      return;
    }
    if (data.signature) {
      var crypto = require('crypto');
      var signPayload = adminUserId + ':' + action + ':' + targetUserId + ':' + data.timestamp + ':' + data.request_id;
      var expectedSig = crypto.createHmac('sha256', relaySecret).update(signPayload).digest('hex');
      if (data.signature !== expectedSig) {
        console.warn('[RemoteAdmin] Signature verification failed for request: ' + data.request_id);
        return;
      }
      // 检查时间戳，防止重放攻击（5分钟有效期）
      if (data.timestamp && Date.now() - data.timestamp > 300000) {
        console.warn('[RemoteAdmin] Request expired: ' + data.request_id);
        return;
      }
    } else {
      console.warn('[RemoteAdmin] Missing signature for request: ' + data.request_id);
      return;
    }

    // 验证来源管理员权限：仅班管可执行远程操作
    var adminClass = getUserAdminClass(adminUserId);
    if (!adminClass && !constants.isClassAdmin(adminUserId)) {
      console.warn('[RemoteAdmin] Non-admin remote action rejected: ' + adminUserId);
      return;
    }

    console.log('[RemoteAdmin] Executing remote action: ' + action + ' on user ' + targetUserId + ' from admin ' + adminUserId);

    if (action === 'ban' || action === 'unban') {
      var newStatus = action === 'ban' ? 'disabled' : 'active';
      // 班管无法被封禁（远程操作同样保护）
      if (action === 'ban' && constants.isClassAdmin(targetUserId)) {
        console.warn('[RemoteAdmin] Cannot ban class admin: ' + targetUserId);
        return;
      }
      var targetUser = db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(targetUserId);
      if (targetUser) {
        db.prepare('UPDATE users SET status = ?, ban_reason = ?, ban_expires_at = ? WHERE user_id = ?').run(
          newStatus, params.reason || '', params.ban_expires_at || null, targetUserId
        );
        var relayBusLocal = require('../utils/relay-bus');
        relayBusLocal.emit('admin_user_status_changed', {
          user_id: targetUserId,
          status: newStatus,
          reason: params.reason || '',
          ban_expires_at: params.ban_expires_at || null
        });
      }
    } else if (action === 'edit') {
      var fields = [];
      var values = [];
      ['net_name', 'real_name', 'gender'].forEach(function(f) {
        if (params[f] !== undefined) { fields.push(f + ' = ?'); values.push(params[f]); }
      });
      if (fields.length > 0) {
        values.push(targetUserId);
        db.prepare('UPDATE users SET ' + fields.join(', ') + ' WHERE user_id = ?').run(values);
        var relayBusEdit = require('../utils/relay-bus');
        var editUpdatedUser = db.prepare('SELECT * FROM users WHERE user_id = ?').get(targetUserId);
        relayBusEdit.emitLocal('user_profile_updated', {
          user_id: targetUserId,
          net_name: editUpdatedUser ? editUpdatedUser.net_name : params.net_name,
          real_name: editUpdatedUser ? editUpdatedUser.real_name : params.real_name,
          gender: editUpdatedUser ? editUpdatedUser.gender : params.gender,
          info_json: editUpdatedUser ? editUpdatedUser.info_json : undefined,
          wechat: editUpdatedUser ? editUpdatedUser.wechat : undefined,
          qq: editUpdatedUser ? editUpdatedUser.qq : undefined,
          phone: editUpdatedUser ? editUpdatedUser.phone : undefined,
          address: editUpdatedUser ? editUpdatedUser.address : undefined,
          signature: editUpdatedUser ? editUpdatedUser.signature : undefined,
          privacy_settings: editUpdatedUser ? editUpdatedUser.privacy_settings : undefined
        });
      }
    } else if (action === 'delete') {
      var delUser = db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(targetUserId);
      if (delUser && !constants.isClassAdmin(targetUserId)) {
        db.prepare('DELETE FROM user_experience WHERE user_id = ?').run(targetUserId);
        db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(targetUserId);
        db.prepare('DELETE FROM community_likes WHERE user_id = ?').run(targetUserId);
        db.prepare('DELETE FROM community_bookmarks WHERE user_id = ?').run(targetUserId);
        db.prepare('DELETE FROM users WHERE user_id = ?').run(targetUserId);
        try {
          var relaySync = require('../utils/relay-sync');
          relaySync.recordTombstone('users', targetUserId);
        } catch (e) {}
        var relayBusDel = require('../utils/relay-bus');
        relayBusDel.emit('user_deleted', {
          user_id: targetUserId
        });
      }
    } else if (action === 'list') {
      // 远程查询用户列表 - 通过中继返回结果
      var classFilter = params.class || '';
      var whereClause = 'WHERE 1=1';
      var qParams = [];
      if (classFilter) {
        var cohortPrefix = (process.env.COHORT || '25');
        whereClause += ' AND user_id LIKE ?';
        qParams.push(cohortPrefix + classFilter + '%');
      }
      var users = db.prepare('SELECT user_id, net_name, real_name, gender, status, is_admin FROM users ' + whereClause + ' LIMIT 100').all.apply(db, qParams);
      var relayBusList = require('../utils/relay-bus');
      relayBusList.relayOnly('remote_admin_response', {
        request_id: data.request_id,
        action: 'list',
        users: users
      });
    }
  });

  // 注册远程响应处理器
  chatServerForHandler.onRelayEvent('remote_admin_response', function(data) {
    console.log('[RemoteAdmin] Received response for request: ' + data.request_id + ' action: ' + data.action);
    // 响应通过中继事件系统传递，前端通过轮询获取
    // 存储到临时变量供 API 查询
    if (!global._remoteAdminResponses) global._remoteAdminResponses = {};
    global._remoteAdminResponses[data.request_id] = {
      data: data,
      timestamp: Date.now()
    };
    // 清理超过60秒的响应
    var now = Date.now();
    Object.keys(global._remoteAdminResponses).forEach(function(key) {
      if (now - global._remoteAdminResponses[key].timestamp > 60000) {
        delete global._remoteAdminResponses[key];
      }
    });
  });
} catch (e) {
  console.error('[RemoteAdmin] Failed to register handler:', e.message);
}

// GET /api/admin/remote-response/:requestId - 查询远程管理响应
router.get('/remote-response/:requestId', function(req, res) {
  var requestId = req.params.requestId;
  var responses = global._remoteAdminResponses || {};
  var response = responses[requestId];
  if (response) {
    res.json({ code: 200, data: response.data });
    delete responses[requestId];
  } else {
    res.json({ code: 202, message: '等待响应' });
  }
});

module.exports = router;
