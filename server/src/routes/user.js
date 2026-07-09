var express = require('express');
var router = express.Router();
var db = require('../utils/db');
var pwdUtil = require('../utils/password');
var auth = require('../middleware/auth');
var time = require('../utils/time');

// All routes require authentication
router.use(auth.requireAuth);

// Helper: build user_info object (never include password_hash)
function buildUserInfo(row) {
  return {
    user_id: row.user_id,
    net_name: row.net_name,
    real_name: row.real_name,
    gender: row.gender,
    status: row.status,
    is_admin: row.is_admin,
    info: JSON.parse(row.info_json || '{}'),
    created_at: time.toISOString(row.created_at),
    last_login: time.toISOString(row.last_login)
  };
}

// GET /api/user/profile
router.get('/profile', function(req, res) {
  try {
    var user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.user.user_id);
    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在', data: null });
    }
    var user_info = buildUserInfo(user);
    return res.json({ code: 200, message: 'ok', data: user_info });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// PATCH /api/user/profile
router.patch('/profile', function(req, res) {
  try {
    var net_name = req.body.net_name;
    var info = req.body.info;

    // If net_name is being updated, check it's not taken by another user
    if (net_name) {
      var existingUser = db.prepare('SELECT user_id FROM users WHERE net_name = ? AND user_id != ?').get(net_name, req.user.user_id);
      if (existingUser) {
        return res.status(409).json({ code: 409, message: '该网名已被使用', data: null });
      }
    }

    // Build update fields
    var updates = [];
    var params = [];

    if (net_name) {
      updates.push('net_name = ?');
      params.push(net_name);
    }

    if (info) {
      // Validate info is an object with allowed fields
      var allowedFields = ['birthday', 'wechat', 'qq', 'email', 'phone', 'address', 'signature'];
      var currentInfo = {};
      var currentUser = db.prepare('SELECT info_json FROM users WHERE user_id = ?').get(req.user.user_id);
      if (currentUser && currentUser.info_json) {
        currentInfo = JSON.parse(currentUser.info_json);
      }

      for (var i = 0; i < allowedFields.length; i++) {
        var field = allowedFields[i];
        if (info.hasOwnProperty(field)) {
          currentInfo[field] = info[field];
        }
      }

      updates.push('info_json = ?');
      params.push(JSON.stringify(currentInfo));
    }

    if (updates.length === 0) {
      return res.status(400).json({ code: 400, message: '没有需要更新的字段', data: null });
    }

    params.push(req.user.user_id);
    var profileStmt = db.prepare('UPDATE users SET ' + updates.join(', ') + ' WHERE user_id = ?');
    profileStmt.run.apply(profileStmt, params);

    db.prepare('UPDATE users SET updated_at = datetime(\'now\') WHERE user_id = ?').run(req.user.user_id);

    try {
      var relayBus = require('../utils/relay-bus');
      var updatedRow = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.user.user_id);
      if (updatedRow) {
        relayBus.emit('user_profile_updated', {
          user_id: req.user.user_id,
          net_name: updatedRow.net_name,
          info_json: updatedRow.info_json,
          wechat: updatedRow.wechat,
          qq: updatedRow.qq,
          phone: updatedRow.phone,
          address: updatedRow.address,
          signature: updatedRow.signature,
          privacy_settings: updatedRow.privacy_settings
        });
      }
    } catch (e) { console.error('[User] Relay event failed:', e.message); }

    // Return updated user info
    var updatedUser = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.user.user_id);
    var user_info = buildUserInfo(updatedUser);
    return res.json({ code: 200, message: '资料更新成功', data: user_info });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// POST /api/user/change-password
router.post('/change-password', function(req, res) {
  try {
    var current_password = req.body.current_password;
    var new_password = req.body.new_password;
    var confirm_password = req.body.confirm_password;

    // Validate all fields
    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ code: 400, message: '请填写所有密码字段', data: null });
    }

    // 1. Verify current password
    var user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.user.user_id);
    if (!user) {
      return res.status(404).json({ code: 404, message: '用户不存在', data: null });
    }

    if (!pwdUtil.verifyPassword(current_password, user.password_hash)) {
      return res.status(401).json({ code: 401, message: '当前密码错误', data: null });
    }

    // 2. Check new password strength
    var strengthResult = pwdUtil.checkPasswordStrength(new_password);
    if (!strengthResult.valid) {
      return res.status(400).json({ code: 400, message: strengthResult.message, data: null });
    }

    // 3. Check new passwords match
    if (new_password !== confirm_password) {
      return res.status(400).json({ code: 400, message: '两次输入的新密码不一致', data: null });
    }

    // 4. Update password hash
    var new_hash = pwdUtil.hashPassword(new_password);
    db.prepare('UPDATE users SET password_hash = ? WHERE user_id = ?').run(new_hash, req.user.user_id);

    db.prepare('UPDATE users SET updated_at = datetime(\'now\') WHERE user_id = ?').run(req.user.user_id);

    try {
      var relayBus = require('../utils/relay-bus');
      relayBus.emit('password_changed', {
        user_id: req.user.user_id,
        password_hash: new_hash
      });
    } catch (e) { console.error('[User] Relay event failed:', e.message); }

    return res.json({ code: 200, message: '密码修改成功', data: null });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// GET /api/user/settings
router.get('/settings', function(req, res) {
  try {
    var settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.user_id);

    // Create default settings if not exists
    if (!settings) {
      db.prepare(
        'INSERT INTO user_settings (user_id, theme, wallpaper, notifications_json) VALUES (?, ?, ?, ?)'
      ).run(req.user.user_id, 'light', 'default', '{"superIsland":true,"chat":true,"sound":false}');

      settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.user_id);
    }

    // 解析桌面布局 JSON（损坏时返回 null，前端用默认布局）
    var desktopLayout = null;
    try {
      if (settings.desktop_layout_json) {
        desktopLayout = JSON.parse(settings.desktop_layout_json);
      }
    } catch (e) {
      console.error('[User] desktop_layout_json 解析失败，前端将使用默认布局:', e.message);
      desktopLayout = null;
    }

    var result = {
      user_id: settings.user_id,
      theme: settings.theme,
      wallpaper: settings.wallpaper,
      avatar_color: settings.avatar_color || '',
      notifications: JSON.parse(settings.notifications_json || '{}'),
      desktop_layout: desktopLayout,
      updated_at: time.toISOString(settings.updated_at)
    };

    return res.json({ code: 200, message: 'ok', data: result });
  } catch (err) {
    console.error('Get settings error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// POST /api/user/settings
router.post('/settings', function(req, res) {
  try {
    var theme = req.body.theme;
    var wallpaper = req.body.wallpaper;
    var notifications = req.body.notifications;
    var avatarColor = req.body.avatar_color;
    var desktopLayout = req.body.desktop_layout;

    // Build updates
    var updates = [];
    var params = [];

    if (theme) {
      updates.push('theme = ?');
      params.push(theme);
    }

    if (wallpaper) {
      updates.push('wallpaper = ?');
      params.push(wallpaper);
    }

    if (notifications) {
      updates.push('notifications_json = ?');
      params.push(JSON.stringify(notifications));
    }

    if (avatarColor !== undefined) {
      updates.push('avatar_color = ?');
      params.push(avatarColor);
    }

    // 桌面布局持久化：校验结构后序列化存储
    if (desktopLayout !== undefined) {
      var validated = validateDesktopLayout(desktopLayout);
      if (validated === null) {
        return res.status(400).json({ code: 400, message: '桌面布局数据格式无效', data: null });
      }
      updates.push('desktop_layout_json = ?');
      params.push(JSON.stringify(validated));
    }

    if (updates.length === 0) {
      return res.status(400).json({ code: 400, message: '没有需要更新的设置', data: null });
    }

    updates.push("updated_at = datetime('now')");

    // Upsert into user_settings
    var existing = db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(req.user.user_id);

    if (existing) {
      params.push(req.user.user_id);
      var updateStmt = db.prepare('UPDATE user_settings SET ' + updates.join(', ') + ' WHERE user_id = ?');
      updateStmt.run.apply(updateStmt, params);
    } else {
      db.prepare(
        'INSERT INTO user_settings (user_id, theme, wallpaper, notifications_json) VALUES (?, ?, ?, ?)'
      ).run(req.user.user_id, 'light', 'default', '{"superIsland":true,"chat":true,"sound":false}');

      params.push(req.user.user_id);
      var updateStmt2 = db.prepare('UPDATE user_settings SET ' + updates.join(', ') + ' WHERE user_id = ?');
      updateStmt2.run.apply(updateStmt2, params);
    }

    db.prepare('UPDATE users SET updated_at = datetime(\'now\') WHERE user_id = ?').run(req.user.user_id);

    // Return updated settings
    var settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.user_id);
    var updatedDesktopLayout = null;
    try {
      if (settings.desktop_layout_json) {
        updatedDesktopLayout = JSON.parse(settings.desktop_layout_json);
      }
    } catch (e) {
      updatedDesktopLayout = null;
    }
    var result = {
      user_id: settings.user_id,
      theme: settings.theme,
      wallpaper: settings.wallpaper,
      avatar_color: settings.avatar_color || '',
      notifications: JSON.parse(settings.notifications_json || '{}'),
      desktop_layout: updatedDesktopLayout,
      updated_at: time.toISOString(settings.updated_at)
    };

    try {
      var relayBus = require('../utils/relay-bus');
      relayBus.emit('user_settings_updated', {
        user_id: req.user.user_id,
        theme: settings.theme,
        wallpaper: settings.wallpaper,
        notifications_json: settings.notifications_json
      });
    } catch (e) { console.error('[User] Relay event failed:', e.message); }

    return res.json({ code: 200, message: '设置更新成功', data: result });
  } catch (err) {
    console.error('Update settings error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// 校验桌面布局数据结构，合法则返回规范化对象，否则返回 null
// 结构：{ version, pages:[{id, slots:[24]}], dock:[name...], pinnedApps:[name...], folders:{id:{id,name,apps}} }
function validateDesktopLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return null;
  if (!Array.isArray(layout.pages) || layout.pages.length < 1 || layout.pages.length > 9) return null;
  if (!Array.isArray(layout.dock) || layout.dock.length > 12) return null;
  if (!Array.isArray(layout.pinnedApps)) return null;
  if (layout.folders !== null && (typeof layout.folders !== 'object' || Array.isArray(layout.folders))) return null;

  var MAX_SLOTS = 24;
  // 规范化单个 slot：合法返回 {type,...}，非法/空返回 null
  function normalizeSlot(slot) {
    if (slot === null) return null;
    if (!slot || typeof slot !== 'object') return null;
    if (slot.type === 'app' && typeof slot.name === 'string' && slot.name) {
      return { type: 'app', name: slot.name };
    }
    if (slot.type === 'folder' && typeof slot.id === 'string' && slot.id) {
      return { type: 'folder', id: slot.id };
    }
    return null;
  }

  var pages = layout.pages.map(function(page, pi) {
    if (!page || typeof page !== 'object') return null;
    if (!Array.isArray(page.slots) || page.slots.length !== MAX_SLOTS) return null;
    var slots = page.slots.map(normalizeSlot);
    return { id: typeof page.id === 'string' ? page.id : ('page-' + pi), slots: slots };
  });
  if (pages.indexOf(null) !== -1) return null;

  // 校验 dock / pinnedApps 元素为字符串
  var dock = layout.dock.filter(function(name) { return typeof name === 'string' && name; });
  var pinnedApps = layout.pinnedApps.filter(function(name) { return typeof name === 'string' && name; });

  // 校验 folders 结构
  var folders = {};
  if (layout.folders) {
    var folderKeys = Object.keys(layout.folders);
    for (var i = 0; i < folderKeys.length; i++) {
      var fid = folderKeys[i];
      var f = layout.folders[fid];
      if (!f || typeof f !== 'object') continue;
      if (typeof f.id !== 'string' || typeof f.name !== 'string') continue;
      if (!Array.isArray(f.apps)) continue;
      folders[fid] = {
        id: f.id,
        name: f.name,
        apps: f.apps.filter(function(name) { return typeof name === 'string' && name; })
      };
    }
  }

  // 校验 widgets 结构（{ pageId: [{ id, type, slot, w, h, config }] }）
  // 持久化小组件配置，跨设备同步
  var widgets = {};
  if (layout.widgets && typeof layout.widgets === 'object' && !Array.isArray(layout.widgets)) {
    var widgetPageIds = Object.keys(layout.widgets);
    for (var wi = 0; wi < widgetPageIds.length; wi++) {
      var pageId = widgetPageIds[wi];
      var widgetList = layout.widgets[pageId];
      if (!Array.isArray(widgetList)) continue;
      widgets[pageId] = [];
      for (var wj = 0; wj < widgetList.length; wj++) {
        var w = widgetList[wj];
        if (!w || typeof w !== 'object') continue;
        if (typeof w.id !== 'string' || typeof w.type !== 'string') continue;
        widgets[pageId].push({
          id: w.id,
          type: w.type,
          slot: typeof w.slot === 'number' ? w.slot : 0,
          w: Math.max(1, Math.min(4, parseInt(w.w, 10) || 2)),
          h: Math.max(1, Math.min(4, parseInt(w.h, 10) || 2)),
          config: (w.config && typeof w.config === 'object') ? w.config : {}
        });
      }
    }
  }

  return {
    version: typeof layout.version === 'number' ? layout.version : 1,
    pages: pages,
    dock: dock,
    pinnedApps: pinnedApps,
    folders: folders,
    widgets: widgets
  };
}

// GET /api/user/remote-profile/:userId
router.get('/remote-profile/:userId', function(req, res) {
  try {
    var targetUserId = req.params.userId;
    try {
      var chatServer = require('../ws/chat-server');
      var remoteUsers = chatServer.getRemoteOnlineUsers();
      if (remoteUsers[targetUserId]) {
        var ru = remoteUsers[targetUserId];
        return res.json({
          code: 200,
          message: 'ok',
          data: {
            user_id: ru.user_id,
            net_name: ru.net_name || ru.user_id,
            real_name: ru.real_name || '',
            gender: ru.gender || '',
            remote: true,
            server_id: ru.server_id || ''
          }
        });
      }
    } catch (e) { console.error('[User] Relay event failed:', e.message); }
    return res.status(404).json({ code: 404, message: '远程用户不在线', data: null });
  } catch (err) {
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

module.exports = router;
