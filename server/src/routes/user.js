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

// ===== 头像（云盘选取 + 缩放裁选）=====
//
// 存的是云盘文件 hash + 裁切参数，不复制图片：
//   - 读取走 /api/cloud/files/<hash>?w=<px>，云盘已有 sharp 实时缩放 + LRU 缓存；
//   - 裁切在前端按同一套公式渲染（client/src/utils/avatar-crop.js），
//     所以任何尺寸的容器裁出来的区域都一致，改裁切不用重新传图。
//
// 为什么不让请求方传文件：校园 MDM 平板上传原图 3~8MB 会打满网关，
// 而云盘上传通道（分片/取件码/弱网重试）已经打磨过，复用是最优解。

var AVATAR_HASH_RE = /^[a-f0-9]{64}$/;

// 归一化裁切参数：zoom ∈ [1,4]，ox/oy ∈ [-1,1]；缺省补 0/1。
// 非法值一律回落默认，避免前端算出 NaN 把头像渲染成空气。
function normalizeCrop(raw) {
  var c = { zoom: 1, ox: 0, oy: 0 };
  if (!raw) return c;
  var zoom = parseFloat(raw.zoom);
  var ox = parseFloat(raw.ox);
  var oy = parseFloat(raw.oy);
  if (isFinite(zoom)) c.zoom = Math.min(4, Math.max(1, zoom));
  if (isFinite(ox)) c.ox = Math.min(1, Math.max(-1, ox));
  if (isFinite(oy)) c.oy = Math.min(1, Math.max(-1, oy));
  return c;
}

// 校验 hash 确实是「这个用户的云盘里可见的文件」
function isHashOwnedBy(userId, hash) {
  if (!AVATAR_HASH_RE.test(hash)) return false;
  try {
    var row = db.prepare(
      'SELECT cuf.file_hash FROM cloud_user_files cuf ' +
      'JOIN cloud_files cf ON cuf.file_hash = cf.hash ' +
      "WHERE cuf.user_id = ? AND cuf.file_hash = ? AND cf.deleted = 0 AND IFNULL(cf.status,'ok') != 'hidden'"
    ).get(userId, hash);
    return !!row;
  } catch (e) {
    return false;
  }
}

function readAvatarRow(userId) {
  return db.prepare('SELECT avatar_hash, avatar_crop FROM users WHERE user_id = ?').get(userId) || null;
}

// 头像改了要告诉对端（8i / 18i 双班），否则"我在 18i 设了头像，8i 的同学只看到文字头像"。
//
// 为什么走 user_profile_updated 这条既有通道，而不是再写一套同步：
//   1. 图片文件本身由 Syncthing 同步（Resources/cloud 不在 .stignore 里），
//      对端磁盘上已经有这张图，不需要搬字节 —— 广播两个字段就够；
//   2. 复用现成事件不用新增协议/接口，失败也只是"晚一点看到"，不会损坏数据。
// 前端拿到 404 时 UserAvatar 会自动回落文字头像，所以对端文件还没同步到也不可怕。
function broadcastAvatar(userId) {
  try {
    var relayBus = require('../utils/relay-bus');
    var row = readAvatarRow(userId);
    relayBus.emit('user_profile_updated', {
      user_id: userId,
      avatar_hash: (row && row.avatar_hash) || '',
      avatar_crop: (row && row.avatar_crop) || ''
    });
  } catch (e) {
    console.error('[User] 头像同步广播失败:', e.message);
  }
}

function buildAvatarPayload(row) {
  var hash = (row && row.avatar_hash) || '';
  var crop = { zoom: 1, ox: 0, oy: 0 };
  try {
    if (row && row.avatar_crop) {
      var parsed = JSON.parse(row.avatar_crop);
      if (parsed) crop = normalizeCrop(parsed);
    }
  } catch (e) { /* 损坏的 JSON 用默认裁切 */ }
  return {
    has_avatar: !!hash,
    hash: hash,
    crop: crop,
    // 列表用小尺寸（128px 足够 40px 的头像槽，2x 屏也够），详情/裁剪预览用 512
    thumb_url: hash ? '/api/cloud/files/' + hash + '?w=128' : '',
    full_url: hash ? '/api/cloud/files/' + hash + '?w=512' : ''
  };
}

// GET /api/user/avatar —— 当前用户的头像设置
router.get('/avatar', function(req, res) {
  try {
    var row = readAvatarRow(req.user.user_id);
    return res.json({ code: 200, message: 'ok', data: buildAvatarPayload(row) });
  } catch (err) {
    console.error('[User] get avatar error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// PUT /api/user/avatar —— 设置头像 { hash, crop }
router.put('/avatar', function(req, res) {
  try {
    var hash = String(req.body.hash || '').trim();
    if (!hash) {
      return res.status(400).json({ code: 400, message: '缺少云盘文件 hash' });
    }
    if (!isHashOwnedBy(req.user.user_id, hash)) {
      return res.status(403).json({ code: 403, message: '该文件不在你的云盘里' });
    }
    var crop = normalizeCrop(req.body.crop);
    var cropJson = JSON.stringify(crop);
    db.prepare('UPDATE users SET avatar_hash = ?, avatar_crop = ? WHERE user_id = ?')
      .run(hash, cropJson, req.user.user_id);
    broadcastAvatar(req.user.user_id);
    return res.json({ code: 200, message: 'ok', data: buildAvatarPayload(readAvatarRow(req.user.user_id)) });
  } catch (err) {
    console.error('[User] set avatar error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// PATCH /api/user/avatar —— 只改裁切参数（不换图）
router.patch('/avatar', function(req, res) {
  try {
    var row = readAvatarRow(req.user.user_id);
    if (!row || !row.avatar_hash) {
      return res.status(400).json({ code: 400, message: '还没有设置头像' });
    }
    var crop = normalizeCrop(req.body.crop);
    db.prepare('UPDATE users SET avatar_crop = ? WHERE user_id = ?')
      .run(JSON.stringify(crop), req.user.user_id);
    broadcastAvatar(req.user.user_id);
    return res.json({ code: 200, message: 'ok', data: buildAvatarPayload(readAvatarRow(req.user.user_id)) });
  } catch (err) {
    console.error('[User] patch avatar error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// DELETE /api/user/avatar —— 还原成文字头像
router.delete('/avatar', function(req, res) {
  try {
    db.prepare("UPDATE users SET avatar_hash = '', avatar_crop = '' WHERE user_id = ?")
      .run(req.user.user_id);
    broadcastAvatar(req.user.user_id);
    return res.json({ code: 200, message: 'ok', data: { has_avatar: false, hash: '', crop: { zoom: 1, ox: 0, oy: 0 }, thumb_url: '', full_url: '' } });
  } catch (err) {
    console.error('[User] delete avatar error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// GET /api/user/avatar/batch?ids=250800,250801 —— 批量取他人头像（列表场景一次拿完）
// 只暴露 hash 与裁切参数，不含任何敏感字段；上限 100 个 id 防滥用。
router.get('/avatar/batch', function(req, res) {
  try {
    var raw = String(req.query.ids || '');
    var ids = raw.split(',').map(function(s) { return s.trim(); })
      .filter(function(s) { return /^\d{4,8}$/.test(s); })
      .slice(0, 100);
    if (ids.length === 0) {
      return res.json({ code: 200, message: 'ok', data: { avatars: {} } });
    }
    var placeholders = ids.map(function() { return '?'; }).join(',');
    var stmt = db.prepare(
      'SELECT user_id, avatar_hash, avatar_crop FROM users WHERE user_id IN (' + placeholders + ')'
    );
    // better-sqlite3 的 all() 直接收数组参数（内部自动展开）。
    // ⚠️ 不要写成 stmt.all.apply(stmt, ids) —— 原生绑定函数不接受 apply，
    //    会抛 "TypeError: Illegal invocation"（2026-10-23 踩过）。
    var rows = stmt.all(ids);
    var avatars = {};
    for (var i = 0; i < ids.length; i++) avatars[ids[i]] = { has_avatar: false, hash: '', crop: { zoom: 1, ox: 0, oy: 0 } };
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      if (!r.avatar_hash) continue;
      var crop = { zoom: 1, ox: 0, oy: 0 };
      try { if (r.avatar_crop) crop = normalizeCrop(JSON.parse(r.avatar_crop)); } catch (e) {}
      avatars[r.user_id] = {
        has_avatar: true,
        hash: r.avatar_hash,
        crop: crop,
        thumb_url: '/api/cloud/files/' + r.avatar_hash + '?w=128'
      };
    }
    return res.json({ code: 200, message: 'ok', data: { avatars: avatars } });
  } catch (err) {
    console.error('[User] avatar batch error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// ===== 个人封面（与头像同一套设计：云盘 hash + 裁切参数）=====
//
// 封面与头像的唯一区别是**容器形状**：头像是正方 1:1，封面是宽横幅（约 3:1）。
// 前端的 computeCropTransform 已经按矩形泛化（正方是它的特例），所以存参策略完全通用。

function readCoverRow(userId) {
  return db.prepare('SELECT cover_hash, cover_crop FROM users WHERE user_id = ?').get(userId) || null;
}

function buildCoverPayload(row) {
  var hash = (row && row.cover_hash) || '';
  var crop = { zoom: 1, ox: 0, oy: 0 };
  try {
    if (row && row.cover_crop) {
      var parsed = JSON.parse(row.cover_crop);
      if (parsed) crop = normalizeCrop(parsed);
    }
  } catch (e) { /* 损坏的 JSON 用默认裁切 */ }
  return {
    has_cover: !!hash,
    hash: hash,
    crop: crop,
    // 封面横幅约 3:1：列表/详情用 720 档（横屏平板全宽也够），裁剪预览用 900
    url: hash ? '/api/cloud/files/' + hash + '?w=720' : '',
    full_url: hash ? '/api/cloud/files/' + hash + '?w=900' : ''
  };
}

function broadcastCover(userId) {
  try {
    var relayBus = require('../utils/relay-bus');
    var row = readCoverRow(userId);
    relayBus.emit('user_profile_updated', {
      user_id: userId,
      cover_hash: (row && row.cover_hash) || '',
      cover_crop: (row && row.cover_crop) || ''
    });
  } catch (e) {
    console.error('[User] 封面同步广播失败:', e.message);
  }
}

// GET /api/user/cover/:userId —— 读任意用户的封面（个人主页用，公开字段）
router.get('/cover/:userId', function(req, res) {
  try {
    var row = readCoverRow(req.params.userId);
    return res.json({ code: 200, message: 'ok', data: buildCoverPayload(row) });
  } catch (err) {
    console.error('[User] get cover error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// GET /api/user/cover —— 当前用户的封面设置
router.get('/cover', function(req, res) {
  try {
    var row = readCoverRow(req.user.user_id);
    return res.json({ code: 200, message: 'ok', data: buildCoverPayload(row) });
  } catch (err) {
    console.error('[User] get cover error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// PUT /api/user/cover —— 设置封面 { hash, crop }
router.put('/cover', function(req, res) {
  try {
    var hash = String(req.body.hash || '').trim();
    if (!hash) {
      return res.status(400).json({ code: 400, message: '缺少云盘文件 hash' });
    }
    if (!isHashOwnedBy(req.user.user_id, hash)) {
      return res.status(403).json({ code: 403, message: '该文件不在你的云盘里' });
    }
    var crop = normalizeCrop(req.body.crop);
    db.prepare('UPDATE users SET cover_hash = ?, cover_crop = ? WHERE user_id = ?')
      .run(hash, JSON.stringify(crop), req.user.user_id);
    broadcastCover(req.user.user_id);
    return res.json({ code: 200, message: 'ok', data: buildCoverPayload(readCoverRow(req.user.user_id)) });
  } catch (err) {
    console.error('[User] set cover error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// PATCH /api/user/cover —— 只改裁切参数（不换图）
router.patch('/cover', function(req, res) {
  try {
    var row = readCoverRow(req.user.user_id);
    if (!row || !row.cover_hash) {
      return res.status(400).json({ code: 400, message: '还没有设置封面' });
    }
    var crop = normalizeCrop(req.body.crop);
    db.prepare('UPDATE users SET cover_crop = ? WHERE user_id = ?')
      .run(JSON.stringify(crop), req.user.user_id);
    broadcastCover(req.user.user_id);
    return res.json({ code: 200, message: 'ok', data: buildCoverPayload(readCoverRow(req.user.user_id)) });
  } catch (err) {
    console.error('[User] patch cover error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// DELETE /api/user/cover —— 撤掉封面，回到纯色默认背景
router.delete('/cover', function(req, res) {
  try {
    db.prepare("UPDATE users SET cover_hash = '', cover_crop = '' WHERE user_id = ?")
      .run(req.user.user_id);
    broadcastCover(req.user.user_id);
    return res.json({ code: 200, message: 'ok', data: { has_cover: false, hash: '', crop: { zoom: 1, ox: 0, oy: 0 }, url: '', full_url: '' } });
  } catch (err) {
    console.error('[User] delete cover error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// ===== 关注 =====
//
// 独立的轻量关系表，不复用聊天/群那套：语义是单向关注（类似动态流），
// 不是好友双向确认。后面要做「关注的人的帖子」时间线也是查这张表。

// GET /api/user/follow/:userId —— 我是否关注了 TA + 双方的关注/粉丝数
router.get('/follow/:userId', function(req, res) {
  try {
    var me = req.user.user_id;
    var target = String(req.params.userId || '');
    if (!target) {
      return res.status(400).json({ code: 400, message: '缺少用户 ID' });
    }
    var following = !!db.prepare(
      'SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?'
    ).get(me, target);
    // 对方是否关注我 —— 用来显示「互相关注」，这是关注体系里最常被问的一句话
    var followedBy = !!db.prepare(
      'SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?'
    ).get(target, me);
    var followers = db.prepare(
      'SELECT COUNT(*) AS cnt FROM user_follows WHERE followee_id = ?'
    ).get(target).cnt;
    var followingCount = db.prepare(
      'SELECT COUNT(*) AS cnt FROM user_follows WHERE follower_id = ?'
    ).get(target).cnt;
    return res.json({
      code: 200, message: 'ok',
      data: { following: following, followed_by: followedBy, followers: followers, following_count: followingCount }
    });
  } catch (err) {
    console.error('[User] follow status error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// POST /api/user/follow/:userId —— 关注
router.post('/follow/:userId', function(req, res) {
  try {
    var me = req.user.user_id;
    var target = String(req.params.userId || '');
    if (!target) {
      return res.status(400).json({ code: 400, message: '缺少用户 ID' });
    }
    if (me === target) {
      return res.status(400).json({ code: 400, message: '不能关注自己' });
    }
    var exists = db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(target);
    if (!exists) {
      return res.status(404).json({ code: 404, message: '用户不存在' });
    }
    // INSERT OR IGNORE：重复关注不报错（联合主键兜底），语义上是幂等的
    db.prepare(
      'INSERT OR IGNORE INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)'
    ).run(me, target, Date.now());
    return res.json({ code: 200, message: 'ok', data: { following: true } });
  } catch (err) {
    console.error('[User] follow error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// DELETE /api/user/follow/:userId —— 取消关注
router.delete('/follow/:userId', function(req, res) {
  try {
    var me = req.user.user_id;
    var target = String(req.params.userId || '');
    if (!target) {
      return res.status(400).json({ code: 400, message: '缺少用户 ID' });
    }
    db.prepare('DELETE FROM user_follows WHERE follower_id = ? AND followee_id = ?').run(me, target);
    return res.json({ code: 200, message: 'ok', data: { following: false } });
  } catch (err) {
    console.error('[User] unfollow error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

// GET /api/user/follow/:userId/followers —— 谁关注了 TA（粉丝列表）
// GET /api/user/follow/:userId/following —— TA 关注了谁
//
// 统一返回「用户摘要 + 我是否关注了他」，前端一次渲染即可，不用再逐人查状态。
// 隐私：只给 net_name / 签名 / 头像，**不返回 real_name 与联系方式**
//（这些字段有各自的隐私开关，列表场景没必要也不该批量暴露）。
var FOLLOW_LIST_LIMIT = 30;

function buildFollowList(req, res, direction) {
  try {
    var target = String(req.params.userId || '');
    var viewer = req.user.user_id;
    if (!target) {
      return res.status(400).json({ code: 400, message: '缺少用户 ID' });
    }
    var page = Math.max(1, parseInt(req.query.page) || 1);
    var limit = Math.min(FOLLOW_LIST_LIMIT, Math.max(1, parseInt(req.query.limit) || FOLLOW_LIST_LIMIT));
    var offset = (page - 1) * limit;

    // direction = 'followers'：筛 followee_id = target，取 follower_id
    // direction = 'following'：筛 follower_id = target，取 followee_id
    var whereCol = direction === 'followers' ? 'f.followee_id' : 'f.follower_id';
    var pickCol = direction === 'followers' ? 'f.follower_id' : 'f.followee_id';

    var total = db.prepare(
      'SELECT COUNT(*) AS cnt FROM user_follows f WHERE ' + whereCol + ' = ?'
    ).get(target).cnt;

    var rows = db.prepare(
      'SELECT ' + pickCol + ' AS uid, f.created_at AS since ' +
      'FROM user_follows f WHERE ' + whereCol + ' = ? ' +
      'ORDER BY f.created_at DESC LIMIT ? OFFSET ?'
    ).all(target, limit, offset);

    var users = [];
    for (var i = 0; i < rows.length; i++) {
      var u = db.prepare(
        'SELECT user_id, net_name, signature, avatar_hash, avatar_crop, status FROM users WHERE user_id = ?'
      ).get(rows[i].uid);
      if (!u) continue;
      // 被封禁的账号不在列表里露出，避免"点了进不去"
      if (u.status === 'disabled') continue;
      var mine = db.prepare(
        'SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?'
      ).get(viewer, u.user_id);
      users.push({
        user_id: u.user_id,
        net_name: u.net_name,
        signature: u.signature || '',
        has_avatar: !!u.avatar_hash,
        avatar_hash: u.avatar_hash || '',
        avatar_crop: u.avatar_crop || '',
        is_following: !!mine,
        is_self: String(u.user_id) === String(viewer),
        since: rows[i].since
      });
    }

    return res.json({
      code: 200, message: 'ok',
      data: { users: users, total: total, page: page, has_more: offset + users.length < total }
    });
  } catch (err) {
    console.error('[User] follow list error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
}

router.get('/follow/:userId/followers', function(req, res) {
  return buildFollowList(req, res, 'followers');
});

router.get('/follow/:userId/following', function(req, res) {
  return buildFollowList(req, res, 'following');
});

module.exports = router;
