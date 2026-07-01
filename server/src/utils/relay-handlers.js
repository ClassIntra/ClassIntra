/**
 * relay-handlers.js - 联动事件处理器注册
 *
 * 所有中继事件的处理器集中注册在此文件。
 * 每个处理器接收 (payload, ctx) 参数：
 *   payload: 中继消息的 payload 对象
 *   ctx: 处理器上下文，包含 db, broadcast, sendToClient, ss, stmts 等快捷访问
 *
 * 添加新事件只需：
 *   1. 在此文件中 bus.register('event_type', handler)
 *   2. 在发送端调用 bus.emit('event_type', data)
 *   无需修改其他任何文件
 */

var bus = require('./relay-bus');

// ========== 跨班云盘文件预取 ==========

var config = require('../config');
var fs = require('fs');
var path = require('path');
var http = require('http');

// 根据 relay WS URL 推导 HTTP URL：ws://host:10011 → http://host:9001
function getPeerHttpUrl(serverId) {
  // 从 RELAY_SERVERS 查 peer 的 WS URL
  var servers = config.relay.servers || [];
  for (var i = 0; i < servers.length; i++) {
    var wsUrl = servers[i];
    try {
      var parsed = new URL(wsUrl);
      var httpUrl = 'http://' + parsed.hostname + ':' + (config.port || 9001);
      return httpUrl;
    } catch (e) {}
  }
  return null;
}

// 扫描消息内容中的云盘文件 URL，对本地缺失的文件从源服务器拉取
function preFetchCloudFiles(content, sourceServerId) {
  if (!content || typeof content !== 'string') return;
  var hashes = [];
  var matches = content.match(/\/api\/cloud\/files\/([a-f0-9]{64})(?:\.\w+)?/g);
  if (!matches) return;

  for (var i = 0; i < matches.length; i++) {
    var hashMatch = matches[i].match(/([a-f0-9]{64})/);
    if (hashMatch && hashes.indexOf(hashMatch[1]) === -1) {
      hashes.push(hashMatch[1]);
    }
  }
  if (hashes.length === 0) return;

  var db = require('./db');
  var cloudDir = path.resolve(config.resourcesDir, 'cloud');
  var sharedDir = path.join(cloudDir, 'shared');
  var relaySecret = config.relay.secret || '';

  // 异步拉取，不阻塞消息处理
  hashes.forEach(function(hash) {
    // 检查本地是否已有
    var existing = db.prepare('SELECT hash FROM cloud_files WHERE hash = ? AND deleted = 0').get(hash);
    if (existing) return;

    var peerUrl = getPeerHttpUrl(sourceServerId);
    if (!peerUrl) return;

    var fetchUrl = peerUrl + '/api/cloud/peer-fetch/' + hash;
    console.log('[CloudSync] 预取文件:', hash, 'from', peerUrl);

    var req = http.get(fetchUrl, { headers: { 'X-Relay-Secret': relaySecret } }, function(response) {
      if (response.statusCode !== 200) {
        console.warn('[CloudSync] 预取失败:', hash, 'HTTP', response.statusCode);
        return;
      }

      var fileHash = response.headers['x-file-hash'] || hash;
      var fileName = decodeURIComponent(response.headers['x-file-name'] || '');
      var mimeType = response.headers['x-file-mime'] || 'application/octet-stream';

      var chunks = [];
      response.on('data', function(chunk) { chunks.push(chunk); });
      response.on('end', function() {
        var buffer = Buffer.concat(chunks);
        try {
          // 验证哈希
          var crypto = require('crypto');
          var actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
          if (actualHash !== fileHash) {
            console.warn('[CloudSync] 哈希不匹配:', fileHash, '实际:', actualHash);
            return;
          }

          // 保存到 shared/
          var ext = path.extname(fileName) || '.bin';
          var prefix = fileHash.substring(0, 2);
          var prefixDir = path.join(sharedDir, prefix);
          if (!fs.existsSync(prefixDir)) fs.mkdirSync(prefixDir, { recursive: true });
          var destPath = path.join(prefixDir, fileHash + ext);
          var storagePath = prefix + '/' + fileHash + ext;

          fs.writeFileSync(destPath, buffer);

          // 创建数据库记录（owner 标记为跨班来源）
          db.prepare('INSERT OR IGNORE INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path) VALUES (?, ?, ?, ?, ?, ?)').run(fileHash, '__relay__', fileName, buffer.length, mimeType, storagePath);
          console.log('[CloudSync] 预取完成:', fileHash, '(' + (buffer.length / 1024).toFixed(1) + ' KB) from', sourceServerId);
        } catch (e) {
          console.error('[CloudSync] 保存失败:', fileHash, e.message);
        }
      });
    });

    req.on('error', function(e) {
      console.warn('[CloudSync] 请求失败:', hash, e.message);
    });
    req.setTimeout(30000, function() {
      req.destroy();
      console.warn('[CloudSync] 请求超时:', hash);
    });
  });
}

// ===================================================================
// 聊天消息
// ===================================================================

bus.register('new_message', function(payload, ctx) {
  if (!payload.message) return;
  var msg = payload.message;
  preFetchCloudFiles(msg.content, ctx.sourceServer);
  try {
    var existingMsg = ctx.db.prepare(
      'SELECT id FROM chat_messages WHERE sender_id = ? AND content = ? AND (created_at = ? OR (created_at IS NULL AND ? IS NULL)) LIMIT 1'
    ).get(msg.sender_id, msg.content, msg.created_at, msg.created_at);
    if (existingMsg) {
      console.log('[Relay-Dedup] Duplicate new_message, skipping: id=' + existingMsg.id);
      return;
    }
    var extraJson = JSON.stringify({
      relayed_from: ctx.sourceServer,
      original_id: msg.id || null,
      reply_to: msg.reply_to || null
    });
    var result = ctx.stmts.insertRelayedChatMessage.run(
      'public', msg.sender_id, msg.sender_name, msg.content, msg.type || 'text', extraJson, msg.created_at || null
    );
    ctx.relaySync.updateWatermark('chat_messages', result.lastInsertRowid);
    if (result.lastInsertRowid) {
      var extraObj = {};
      try { extraObj = JSON.parse(extraJson || '{}'); } catch (e) {}
      extraObj.original_id = msg.id;
      ctx.db.prepare('UPDATE chat_messages SET extra_json = ? WHERE id = ?').run(JSON.stringify(extraObj), result.lastInsertRowid);
    }
    ctx.broadcast({
      type: 'new_message',
      message: {
        id: result.lastInsertRowid,
        type: msg.type || 'text',
        content: msg.content,
        sender_id: msg.sender_id,
        sender_name: msg.sender_name,
        reply_to: msg.reply_to || null,
        created_at: msg.created_at || null
      }
    });
  } catch (e) { console.error('[RelayBus] new_message error:', e.message); }
});

bus.register('private_message', function(payload, ctx) {
  if (!payload.message) return;
  var pm = payload.message;
  preFetchCloudFiles(pm.content, ctx.sourceServer);
  try {
    var existingPm = ctx.db.prepare(
      'SELECT id FROM private_messages WHERE sender_id = ? AND receiver_id = ? AND content = ? AND (created_at = ? OR (created_at IS NULL AND ? IS NULL)) LIMIT 1'
    ).get(pm.from_user_id || pm.sender_id, pm.to_user_id, pm.content, pm.created_at, pm.created_at);
    if (existingPm) {
      console.log('[Relay] Duplicate private_message, skipping');
      return;
    }
    var extraJson = JSON.stringify({
      relayed_from: ctx.sourceServer,
      original_id: pm.id || null,
      reply_to: pm.reply_to || null
    });
    var result = ctx.stmts.insertRelayedPrivateMessage.run(
      pm.from_user_id || pm.sender_id, pm.to_user_id, pm.content, pm.type || 'text', extraJson, pm.read || 0, pm.created_at || null
    );
    ctx.relaySync.updateWatermark('private_messages', result.lastInsertRowid);
    if (result.lastInsertRowid) {
      var extraObj = {};
      try { extraObj = JSON.parse(extraJson); } catch (e) {}
      extraObj.original_id = pm.id;
      ctx.db.prepare('UPDATE private_messages SET extra_json = ? WHERE id = ?').run(JSON.stringify(extraObj), result.lastInsertRowid);
    }
    // 只推送给接收方（发送方在源服务器已收到private_message_sent）
    if (ctx.clients[pm.to_user_id]) {
      ctx.sendToClient(pm.to_user_id, {
        type: 'private_message',
        from_user_id: pm.from_user_id || pm.sender_id,
        message: {
          id: result.lastInsertRowid,
          type: pm.type || 'text',
          content: pm.content,
          sender_id: pm.from_user_id || pm.sender_id,
          sender_name: pm.sender_name || '',
          from_user_id: pm.from_user_id || pm.sender_id,
          to_user_id: pm.to_user_id,
          reply_to: pm.reply_to || null,
          created_at: pm.created_at || null
        }
      });
    }
  } catch (e) { console.error('[RelayBus] private_message error:', e.message); }
});

bus.register('group_message', function(payload, ctx) {
  if (!payload.message) return;
  var gm = payload.message;
  preFetchCloudFiles(gm.content, ctx.sourceServer);
  var gmGroupId = payload.group_id;
  var gmGroup = ctx.stmts.getGroup.get(gmGroupId);
  if (gmGroup) {
    try {
      var existingGm = ctx.db.prepare(
        'SELECT id FROM group_messages WHERE group_id = ? AND sender_id = ? AND content = ? AND (created_at = ? OR (created_at IS NULL AND ? IS NULL)) LIMIT 1'
      ).get(gmGroupId, gm.sender_id, gm.content, gm.created_at, gm.created_at);
      if (existingGm) {
        console.log('[Relay] Duplicate group_message, skipping');
        return;
      }
      var extraJson = JSON.stringify({
        relayed_from: ctx.sourceServer,
        original_id: gm.id || null,
        reply_to: gm.reply_to || null
      });
      var result = ctx.stmts.insertRelayedGroupMessage.run(
        gmGroupId, gm.sender_id, gm.sender_name, gm.content, gm.type || 'text', extraJson, gm.created_at || null
      );
      ctx.relaySync.updateWatermark('group_messages', result.lastInsertRowid);
      if (result.lastInsertRowid) {
        var extraObj = {};
        try { extraObj = JSON.parse(extraJson); } catch (e) {}
        extraObj.original_id = gm.id;
        ctx.db.prepare('UPDATE group_messages SET extra_json = ? WHERE id = ?').run(JSON.stringify(extraObj), result.lastInsertRowid);
      }
      var members = ctx.parseMembersJson(gmGroup.members_json);
      var localMsg = {
        id: result.lastInsertRowid,
        type: gm.type || 'text',
        content: gm.content,
        sender_id: gm.sender_id,
        sender_name: gm.sender_name || '',
        reply_to: gm.reply_to || null,
        recalled: 0,
        created_at: gm.created_at || null
      };
      for (var i = 0; i < members.length; i++) {
        if (members[i] === gm.sender_id) continue;
        ctx.sendToClient(members[i], { type: 'group_message', group_id: gmGroupId, message: localMsg });
      }
    } catch (e) { console.error('[RelayBus] group_message error:', e.message); }
  } else {
    // fallback: 群组不在本地，仅推送给本地在线的成员（消息无法撤回，因为没有本地DB记录）
    var allMemberIds = [gm.sender_id];
    if (payload.member_ids && Array.isArray(payload.member_ids)) {
      allMemberIds = payload.member_ids;
    }
    var fallbackMsg = {
      id: gm.id, type: gm.type || 'text', content: gm.content,
      sender_id: gm.sender_id, sender_name: gm.sender_name || '',
      reply_to: gm.reply_to || null, recalled: 0, created_at: gm.created_at || null,
      _fallback: true
    };
    for (var j = 0; j < allMemberIds.length; j++) {
      if (allMemberIds[j] === gm.sender_id) continue;
      if (ctx.clients[allMemberIds[j]]) {
        ctx.sendToClient(allMemberIds[j], { type: 'group_message', group_id: gmGroupId, message: fallbackMsg });
      }
    }
  }
});

bus.register('message_recalled', function(payload, ctx) {
  var recallType = payload.message_type;
  var recallOriginalId = payload.original_message_id;

  if (recallType === 'public') {
    var localMsg = null;
    if (recallOriginalId) {
      try {
        localMsg = ctx.db.prepare("SELECT id, sender_id FROM chat_messages WHERE json_extract(extra_json, '$.original_id') = ?").get(String(recallOriginalId));
      } catch (e) {}
    }
    if (localMsg) {
      ctx.stmts.recallChatMessage.run(localMsg.id, localMsg.sender_id);
      ctx.broadcast({ type: 'message_recalled', message_type: 'public', message_id: localMsg.id });
    } else {
      console.warn('[Relay] message_recalled: public message not found for original_id=' + recallOriginalId);
    }
  } else if (recallType === 'private') {
    var localPm = null;
    if (recallOriginalId) {
      try {
        localPm = ctx.db.prepare("SELECT id, sender_id, receiver_id FROM private_messages WHERE json_extract(extra_json, '$.original_id') = ?").get(String(recallOriginalId));
      } catch (e) {}
    }
    if (localPm) {
      ctx.stmts.recallPrivateMessage.run(localPm.id, localPm.sender_id);
      ctx.sendToClient(localPm.receiver_id, { type: 'message_recalled', message_type: 'private', message_id: localPm.id, chat_id: localPm.sender_id });
      ctx.sendToClient(localPm.sender_id, { type: 'message_recalled', message_type: 'private', message_id: localPm.id, chat_id: localPm.receiver_id });
    } else {
      console.warn('[Relay] message_recalled: private message not found for original_id=' + recallOriginalId);
    }
  } else if (recallType === 'group' && payload.group_id) {
    var localGm = null;
    if (recallOriginalId) {
      try {
        localGm = ctx.db.prepare("SELECT id, sender_id FROM group_messages WHERE group_id = ? AND json_extract(extra_json, '$.original_id') = ?").get(payload.group_id, String(recallOriginalId));
      } catch (e) {}
    }
    if (localGm) {
      ctx.stmts.recallGroupMessage.run(localGm.id, localGm.sender_id);
      var group = ctx.stmts.getGroup.get(payload.group_id);
      if (group) {
        var members = ctx.parseMembersJson(group.members_json);
        for (var i = 0; i < members.length; i++) {
          ctx.sendToClient(members[i], { type: 'message_recalled', message_type: 'group', group_id: payload.group_id, message_id: localGm.id });
        }
      }
    } else {
      console.warn('[Relay] message_recalled: group message not found for original_id=' + recallOriginalId + ' group_id=' + payload.group_id);
    }
  }
});

// ===================================================================
// 用户状态
// ===================================================================

bus.register('user_online', function(payload, ctx) {
  if (!payload.user_info) return;
  try {
    if (!ctx.onlineUsers[payload.user_id]) {
      var rUserInfo = payload.user_info;
      if (rUserInfo) {
        rUserInfo.remote = true;
        rUserInfo.server_id = ctx.sourceServer;
        ctx.remoteOnlineUsers[payload.user_id] = rUserInfo;
        ctx.broadcast({ type: 'remote_user_online', user_id: payload.user_id, user_info: rUserInfo });
      }
    }
  } catch (e) { console.error('[RelayBus] user_online error:', e.message); }
});

bus.register('user_offline', function(payload, ctx) {
  try {
    if (ctx.remoteOnlineUsers[payload.user_id]) {
      delete ctx.remoteOnlineUsers[payload.user_id];
      ctx.broadcast({ type: 'remote_user_offline', user_id: payload.user_id });
    }
  } catch (e) { console.error('[RelayBus] user_offline error:', e.message); }
});

bus.register('user_status_change', function(payload, ctx) {
  try {
    if (ctx.onlineUsers[payload.user_id]) {
      ctx.onlineUsers[payload.user_id].status = payload.status;
      ctx.broadcast({ type: 'user_status_change', user_id: payload.user_id, status: payload.status });
    }
  } catch (e) { console.error('[RelayBus] user_status_change error:', e.message); }
});

bus.register('user_typing', function(payload, ctx) {
  try {
    if (payload.group_id) {
      var group = ctx.stmts.getGroup.get(payload.group_id);
      if (group) {
        var members = ctx.parseMembersJson(group.members_json);
        for (var i = 0; i < members.length; i++) {
          if (members[i] !== payload.from_user_id) {
            ctx.sendToClient(members[i], {
              type: 'user_typing', from_user_id: payload.from_user_id,
              from_user_name: payload.from_user_name, group_id: payload.group_id, is_typing: payload.is_typing
            });
          }
        }
      }
    } else if (payload.target_user_id && ctx.clients[payload.target_user_id]) {
      ctx.sendToClient(payload.target_user_id, {
        type: 'user_typing', from_user_id: payload.from_user_id,
        from_user_name: payload.from_user_name, is_typing: payload.is_typing
      });
    }
  } catch (e) { console.error('[RelayBus] user_typing error:', e.message); }
});

// ===================================================================
// 用户数据同步
// ===================================================================

bus.register('user_registered', function(payload, ctx) {
  try {
    var existing = ctx.db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(payload.user_id);
    if (!existing) {
      ctx.db.prepare(
        'INSERT OR IGNORE INTO users (user_id, net_name, real_name, gender, password_hash, status, is_admin, info_json, wechat, qq, phone, address, signature, privacy_settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        payload.user_id, payload.net_name, payload.real_name, payload.gender || '',
        '', 'active', payload.is_admin || 0,
        payload.info_json || '{}', payload.wechat || '', payload.qq || '',
        payload.phone || '', payload.address || '', payload.signature || '',
        payload.privacy_settings || '{}',
        payload.created_at || new Date().toISOString()
      );
      console.log('[Relay] Synced new user:', payload.user_id, payload.net_name);
    }
  } catch (e) { console.error('[RelayBus] user_registered error:', e.message); }
});

bus.register('user_login', function(payload, ctx) {
  try {
    ctx.db.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE user_id = ?').run(payload.user_id);
    ctx.db.prepare('UPDATE users SET updated_at = datetime(\'now\') WHERE user_id = ?').run(payload.user_id);
  } catch (e) { console.error('[RelayBus] user_login error:', e.message); }
}, { localOnly: true });

bus.register('password_changed', function(payload, ctx) {
  try {
    ctx.db.prepare('UPDATE users SET password_hash = ? WHERE user_id = ?').run(payload.password_hash, payload.user_id);
    console.log('[Relay] Synced password change for user:', payload.user_id);
  } catch (e) { console.error('[RelayBus] password_changed error:', e.message); }
});

bus.register('user_profile_updated', function(payload, ctx) {
  try {
    // 动态SQL：只更新非空字段，不覆盖 is_admin、status、password_hash
    var fields = [];
    var values = [];
    var profileFields = ['net_name', 'real_name', 'gender', 'info_json', 'wechat', 'qq', 'phone', 'address', 'signature', 'privacy_settings'];
    for (var i = 0; i < profileFields.length; i++) {
      var f = profileFields[i];
      if (payload[f] !== undefined && payload[f] !== null && payload[f] !== '') {
        fields.push(f + ' = ?');
        values.push(payload[f]);
      }
    }
    if (fields.length > 0) {
      values.push(payload.user_id);
      ctx.db.prepare('UPDATE users SET ' + fields.join(', ') + ', updated_at = datetime(\'now\') WHERE user_id = ?').run(values);
      console.log('[Relay] Synced profile update for user:', payload.user_id);
    }
    var broadcastData = { type: 'user_profile_updated', user_id: payload.user_id };
    var bFields = ['net_name', 'real_name', 'gender', 'info_json', 'wechat', 'qq', 'phone', 'address', 'signature', 'privacy_settings'];
    for (var k = 0; k < bFields.length; k++) {
      if (payload[bFields[k]] !== undefined && payload[bFields[k]] !== null && payload[bFields[k]] !== '') {
        broadcastData[bFields[k]] = payload[bFields[k]];
      }
    }
    ctx.broadcast(broadcastData);
  } catch (e) { console.error('[RelayBus] user_profile_updated error:', e.message); }
});

bus.register('admin_user_status_changed', function(payload, ctx) {
  try {
    ctx.db.prepare('UPDATE users SET status = ?, ban_reason = ?, ban_expires_at = ? WHERE user_id = ?').run(
      payload.status, payload.reason || '', payload.ban_expires_at || null, payload.user_id
    );
    console.log('[Relay] Synced admin status change for user:', payload.user_id, '->', payload.status);
    ctx.broadcast({ type: 'admin_user_status_changed', user_id: payload.user_id, status: payload.status });
    // 封禁时踢下线
    if (payload.status === 'disabled' && ctx.clients[payload.user_id]) {
      try {
        ctx.sendToClient(payload.user_id, {
          type: 'account_banned',
          status: 'disabled',
          reason: payload.reason || '',
          ban_expires_at: payload.ban_expires_at || null
        });
        ctx.clients[payload.user_id].close();
      } catch (e) {}
    }
  } catch (e) { console.error('[RelayBus] admin_user_status_changed error:', e.message); }
});

bus.register('user_deleted', function(payload, ctx) {
  try {
    ctx.db.prepare('DELETE FROM user_experience WHERE user_id = ?').run(payload.user_id);
    ctx.db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(payload.user_id);
    ctx.db.prepare('DELETE FROM community_likes WHERE user_id = ?').run(payload.user_id);
    ctx.db.prepare('DELETE FROM community_bookmarks WHERE user_id = ?').run(payload.user_id);
    ctx.db.prepare('DELETE FROM users WHERE user_id = ?').run(payload.user_id);
    ctx.relaySync.recordTombstone('users', payload.user_id);
    // 清理本地在线状态，使用emitLocal避免触发user_offline中继（用户已删除，不应中继离线状态）
    if (ctx.clients[payload.user_id]) {
      try { ctx.clients[payload.user_id].close(); } catch (e) {}
      delete ctx.clients[payload.user_id];
    }
    if (ctx.onlineUsers[payload.user_id]) {
      delete ctx.onlineUsers[payload.user_id];
      ctx.broadcast({ type: 'user_offline', user_id: payload.user_id });
    }
    console.log('[Relay] Synced user deletion:', payload.user_id);
  } catch (e) { console.error('[RelayBus] user_deleted error:', e.message); }
});

bus.register('user_settings_updated', function(payload, ctx) {
  try {
    var existing = ctx.ss.settingsCheck.get(payload.user_id);
    if (existing) {
      ctx.ss.settingsUpdate.run(payload.theme, payload.wallpaper, payload.notifications_json, payload.user_id);
    } else {
      ctx.ss.settingsInsert.run(payload.user_id, payload.theme, payload.wallpaper, payload.notifications_json);
    }
    console.log('[Relay] Synced settings for user:', payload.user_id);
    ctx.sendToClient(payload.user_id, { type: 'user_settings_updated', theme: payload.theme, wallpaper: payload.wallpaper });
  } catch (e) { console.error('[RelayBus] user_settings_updated error:', e.message); }
});

bus.register('exp_updated', function(payload, ctx) {
  try {
    var existingExp = ctx.ss.expCheck.get(payload.user_id);
    if (existingExp) {
      var localExp = ctx.ss.expGetLocal.get(payload.user_id);
      if (payload.exp > (localExp ? localExp.exp : 0)) {
        ctx.ss.expUpdate.run(payload.exp, payload.level, payload.show_level_community, payload.show_level_chat, payload.user_id);
      }
    } else {
      ctx.ss.expInsert.run(payload.user_id, payload.exp, payload.level, payload.show_level_community, payload.show_level_chat, null, 0);
    }
    console.log('[Relay] Synced exp for user:', payload.user_id);
    ctx.sendToClient(payload.user_id, { type: 'exp_updated', user_id: payload.user_id, exp: payload.exp, level: payload.level });
  } catch (e) { console.error('[RelayBus] exp_updated error:', e.message); }
});

// ===================================================================
// 社区事件
// ===================================================================

bus.register('community_event', function(payload, ctx) {
  var cAction = payload.action;

  if (cAction === 'create_post' && payload.post) {
    var rp = payload.post;
    try {
      var rpExtra = {};
      try { rpExtra = JSON.parse(rp.extra_json || '{}'); } catch (e) {}
      if (!rpExtra.relayed_from) rpExtra.relayed_from = ctx.sourceServer;
      rpExtra.original_id = rp.id;

      // Try to insert with original ID first
      var insertResult = ctx.db.prepare(
        'INSERT OR IGNORE INTO community_posts (id, user_id, type, title, content, anonymous, visible_groups, hidden_groups, like_count, comment_count, extra_json, tags, share_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        rp.id, rp.user_id, rp.type || 'forum', rp.title || '', rp.content || '',
        rp.anonymous || 0, rp.visible_groups || '[]', rp.hidden_groups || '[]',
        0, 0, JSON.stringify(rpExtra), rp.tags || '[]', 0, rp.created_at || new Date().toISOString()
      );

      var localPostId = rp.id;
      if (insertResult.changes === 0) {
        // ID conflict - insert without specifying ID (auto-increment)
        var localResult = ctx.db.prepare(
          'INSERT INTO community_posts (user_id, type, title, content, anonymous, visible_groups, hidden_groups, like_count, comment_count, extra_json, tags, share_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          rp.user_id, rp.type || 'forum', rp.title || '', rp.content || '',
          rp.anonymous || 0, rp.visible_groups || '[]', rp.hidden_groups || '[]',
          0, 0, JSON.stringify(rpExtra), rp.tags || '[]', 0, rp.created_at || new Date().toISOString()
        );
        localPostId = localResult.lastInsertRowid;
        // Store the ID mapping for subsequent comment/like lookups
        ctx.db.prepare('INSERT OR REPLACE INTO post_id_mappings (original_id, local_id, source_server) VALUES (?, ?, ?)').run(
          String(rp.id), localPostId, ctx.sourceServer
        );
        console.log('[Relay] Post ID remapped:', rp.id, '->', localPostId);
      }
      ctx.relaySync.updateWatermark('community_posts', localPostId);

      // Broadcast with the local post ID
      var broadcastPost = Object.assign({}, rp, { id: localPostId });
      ctx.broadcast(Object.assign({}, payload, { post: broadcastPost }));
    } catch (e) { console.error('[RelayBus] community_event create_post error:', e.message); }
  } else if (cAction === 'create_comment' && payload.comment) {
    var rc = payload.comment;
    try {
      // Resolve post_id: check if original post_id exists locally, if not try mapping
      var localPostIdForComment = rc.post_id;
      var postExists = ctx.db.prepare('SELECT id FROM community_posts WHERE id = ?').get(rc.post_id);
      if (!postExists) {
        var mapping = ctx.db.prepare('SELECT local_id FROM post_id_mappings WHERE original_id = ?').get(String(rc.post_id));
        if (mapping) {
          localPostIdForComment = mapping.local_id;
        }
      }
      ctx.ss.commentInsert.run(rc.id, localPostIdForComment, rc.user_id, rc.parent_id, rc.content, 0, rc.created_at || new Date().toISOString());
      ctx.db.prepare('UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = ?').run(localPostIdForComment);
      ctx.relaySync.updateWatermark('community_comments', rc.id);
    } catch (e) { console.error('[RelayBus] community_event create_comment error:', e.message); }
  } else if (cAction === 'create_like' && payload.like) {
    var rl = payload.like;
    try {
      // Resolve target_id for post/comment likes via mapping
      var localTargetId = String(rl.target_id);
      if (rl.target_type === 'post') {
        var postCheck = ctx.db.prepare('SELECT id FROM community_posts WHERE id = ?').get(Number(rl.target_id));
        if (!postCheck) {
          var postMapping = ctx.db.prepare('SELECT local_id FROM post_id_mappings WHERE original_id = ?').get(String(rl.target_id));
          if (postMapping) {
            localTargetId = String(postMapping.local_id);
          }
        }
      }
      var likeResult = ctx.db.prepare('INSERT OR IGNORE INTO community_likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)').run(
        rl.user_id, rl.target_type, localTargetId, new Date().toISOString()
      );
      if (likeResult.lastInsertRowid) {
        ctx.relaySync.updateWatermark('community_likes', likeResult.lastInsertRowid);
      }
      if (rl.target_type === 'post') {
        ctx.db.prepare('UPDATE community_posts SET like_count = like_count + 1 WHERE id = ?').run(Number(localTargetId));
      } else if (rl.target_type === 'comment') {
        ctx.db.prepare('UPDATE community_comments SET like_count = like_count + 1 WHERE id = ?').run(Number(localTargetId));
      }
    } catch (e) { console.error('[RelayBus] community_event create_like error:', e.message); }
  } else if (cAction === 'delete_post' && payload.post_id) {
    try {
      // Resolve local post ID via mapping
      var delPostId = payload.post_id;
      var delPostCheck = ctx.db.prepare('SELECT id FROM community_posts WHERE id = ?').get(delPostId);
      if (!delPostCheck) {
        var delMapping = ctx.db.prepare('SELECT local_id FROM post_id_mappings WHERE original_id = ?').get(String(delPostId));
        if (delMapping) { delPostId = delMapping.local_id; }
      }
      var commentIds = ctx.db.prepare('SELECT id FROM community_comments WHERE post_id = ?').all(delPostId).map(function(c) { return c.id; });
      if (commentIds.length > 0) {
        var placeholders = commentIds.map(function() { return '?'; }).join(',');
        ctx.db.prepare('DELETE FROM community_likes WHERE target_type = \'comment\' AND target_id IN (' + placeholders + ')').run(commentIds);
      }
      ctx.db.prepare('DELETE FROM community_likes WHERE target_type = \'post\' AND target_id = ?').run(String(delPostId));
      ctx.db.prepare('DELETE FROM community_bookmarks WHERE post_id = ?').run(delPostId);
      ctx.db.prepare('DELETE FROM community_comments WHERE post_id = ?').run(delPostId);
      ctx.db.prepare('DELETE FROM community_posts WHERE id = ?').run(delPostId);
      ctx.db.prepare('DELETE FROM post_id_mappings WHERE local_id = ? OR original_id = ?').run(delPostId, String(payload.post_id));
      ctx.relaySync.recordTombstone('community_posts', delPostId);
    } catch (e) { console.error('[RelayBus] community_event delete_post error:', e.message); }
  } else if (cAction === 'delete_like' && payload.like) {
    var dl = payload.like;
    try {
      var dlTargetId = String(dl.target_id);
      if (dl.target_type === 'post') {
        var dlPostCheck = ctx.db.prepare('SELECT id FROM community_posts WHERE id = ?').get(Number(dl.target_id));
        if (!dlPostCheck) {
          var dlPostMapping = ctx.db.prepare('SELECT local_id FROM post_id_mappings WHERE original_id = ?').get(String(dl.target_id));
          if (dlPostMapping) { dlTargetId = String(dlPostMapping.local_id); }
        }
      }
      var dlResult = ctx.db.prepare('DELETE FROM community_likes WHERE user_id = ? AND target_type = ? AND target_id = ?').run(
        dl.user_id, dl.target_type, dlTargetId
      );
      if (dlResult.changes > 0) {
        if (dl.target_type === 'post') {
          ctx.db.prepare('UPDATE community_posts SET like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END WHERE id = ?').run(Number(dlTargetId));
        } else if (dl.target_type === 'comment') {
          ctx.db.prepare('UPDATE community_comments SET like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END WHERE id = ?').run(Number(dlTargetId));
        }
      }
    } catch (e) { console.error('[RelayBus] community_event delete_like error:', e.message); }
  } else if (cAction === 'share_post' && payload.post_id) {
    try {
      // Resolve local post ID via mapping
      var sharePostId = payload.post_id;
      var sharePostCheck = ctx.db.prepare('SELECT id FROM community_posts WHERE id = ?').get(sharePostId);
      if (!sharePostCheck) {
        var shareMapping = ctx.db.prepare('SELECT local_id FROM post_id_mappings WHERE original_id = ?').get(String(sharePostId));
        if (shareMapping) { sharePostId = shareMapping.local_id; }
      }
      ctx.db.prepare('UPDATE community_posts SET share_count = share_count + 1 WHERE id = ?').run(sharePostId);
    } catch (e) { console.error('[RelayBus] community_event share_post error:', e.message); }
  }

  // 触发本地广播
  ctx.broadcast(payload);
});

bus.register('community_group_created', function(payload, ctx) {
  try {
    ctx.db.prepare('INSERT OR IGNORE INTO community_groups (id, name, creator_id, created_at) VALUES (?, ?, ?, ?)').run(
      payload.id, payload.name, payload.creator_id, payload.created_at || new Date().toISOString()
    );
  } catch (e) { console.error('[RelayBus] community_group_created error:', e.message); }
  ctx.broadcast({ type: 'community_group_created', id: payload.id, name: payload.name, creator_id: payload.creator_id });
});

// ===================================================================
// 广播通知
// ===================================================================

bus.register('broadcast_event', function(payload, ctx) {
  var bn = payload.notification || {};
  try {
    ctx.db.prepare("INSERT INTO broadcasts (content, priority, created_at) VALUES (?, ?, datetime('now'))").run(
      bn.content || '', bn.priority || 'normal'
    );
  } catch (e) { console.error('[RelayBus] broadcast_event error:', e.message); }
  ctx.broadcast({
    type: 'super_island_notification',
    notification: {
      type: 'broadcast',
      content: bn.content,
      priority: bn.priority,
      relayed_from: ctx.sourceServer
    }
  });
}, { localOnly: true });

// ===================================================================
// 消息反应 & 收藏
// ===================================================================

bus.register('message_reaction_added', function(payload, ctx) {
  try {
    ctx.ss.reactionInsert.run(payload.message_id, payload.message_type, payload.user_id, payload.emoji, payload.created_at || new Date().toISOString());
    console.log('[Relay] Synced reaction added');
  } catch (e) { console.error('[RelayBus] message_reaction_added error:', e.message); }
  ctx.broadcast({ type: 'message_reaction_added', message_id: payload.message_id, message_type: payload.message_type, user_id: payload.user_id, emoji: payload.emoji });
});

bus.register('message_reaction_removed', function(payload, ctx) {
  try {
    ctx.db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND message_type = ? AND user_id = ? AND emoji = ?').run(
      payload.message_id, payload.message_type, payload.user_id, payload.emoji
    );
    console.log('[Relay] Synced reaction removed');
  } catch (e) { console.error('[RelayBus] message_reaction_removed error:', e.message); }
  ctx.broadcast({ type: 'message_reaction_removed', message_id: payload.message_id, message_type: payload.message_type, user_id: payload.user_id, emoji: payload.emoji });
});

bus.register('bookmark_updated', function(payload, ctx) {
  try {
    if (payload.action === 'add') {
      ctx.ss.bookmarkInsert.run(payload.user_id, payload.post_id, payload.created_at || new Date().toISOString());
    } else if (payload.action === 'remove') {
      ctx.db.prepare('DELETE FROM community_bookmarks WHERE user_id = ? AND post_id = ?').run(payload.user_id, payload.post_id);
    }
    console.log('[Relay] Synced bookmark:', payload.action, payload.user_id, payload.post_id);
  } catch (e) { console.error('[RelayBus] bookmark_updated error:', e.message); }
  ctx.broadcast({ type: 'bookmark_updated', action: payload.action, user_id: payload.user_id, post_id: payload.post_id });
});

// ===================================================================
// 群组操作
// ===================================================================

bus.register('group_created', function(payload, ctx) {
  try {
    var existingGroup = ctx.stmts.getGroup.get(payload.group_id);
    if (!existingGroup) {
      ctx.stmts.insertGroup.run(payload.group_id, payload.group_name, payload.creator_id, JSON.stringify(payload.member_ids || []));
      ctx.relaySync.updateGroupWatermark();
    }
    var memberIds = payload.member_ids || [];
    for (var i = 0; i < memberIds.length; i++) {
      ctx.sendToClient(memberIds[i], { type: 'group_created', group_id: payload.group_id, group_name: payload.group_name, success: true });
    }
  } catch (e) { console.error('[RelayBus] group_created error:', e.message); }
});

bus.register('group_member_joined', function(payload, ctx) {
  try {
    var group = ctx.stmts.getGroup.get(payload.group_id);
    if (group) {
      var members = ctx.parseMembersJson(group.members_json);
      if (members.indexOf(payload.user_id) === -1) {
        members.push(payload.user_id);
        ctx.stmts.updateGroupMembers.run(JSON.stringify(members), payload.group_id);
        ctx.relaySync.updateGroupWatermark();
      }
      for (var i = 0; i < members.length; i++) {
        ctx.sendToClient(members[i], {
          type: 'group_member_joined', group_id: payload.group_id, user_id: payload.user_id,
          invited_by: payload.invited_by || null, group_name: payload.group_name || group.name
        });
      }
    }
  } catch (e) { console.error('[RelayBus] group_member_joined error:', e.message); }
});

bus.register('group_member_left', function(payload, ctx) {
  try {
    var group = ctx.stmts.getGroup.get(payload.group_id);
    if (group) {
      var members = ctx.parseMembersJson(group.members_json);
      var idx = members.indexOf(payload.user_id);
      if (idx !== -1) {
        members.splice(idx, 1);
        ctx.stmts.updateGroupMembers.run(JSON.stringify(members), payload.group_id);
        ctx.relaySync.updateGroupWatermark();
      }
      var allNotify = members.slice();
      allNotify.push(payload.user_id);
      for (var i = 0; i < allNotify.length; i++) {
        ctx.sendToClient(allNotify[i], { type: 'group_member_left', group_id: payload.group_id, user_id: payload.user_id });
      }
    }
  } catch (e) { console.error('[RelayBus] group_member_left error:', e.message); }
});

bus.register('group_member_kicked', function(payload, ctx) {
  try {
    var group = ctx.stmts.getGroup.get(payload.group_id);
    if (group) {
      var members = ctx.parseMembersJson(group.members_json);
      var idx = members.indexOf(payload.user_id);
      if (idx !== -1) {
        members.splice(idx, 1);
        ctx.stmts.updateGroupMembers.run(JSON.stringify(members), payload.group_id);
        ctx.relaySync.updateGroupWatermark();
      }
      for (var i = 0; i < members.length; i++) {
        ctx.sendToClient(members[i], { type: 'group_member_kicked', group_id: payload.group_id, user_id: payload.user_id, kicked_by: payload.kicked_by });
      }
      ctx.sendToClient(payload.user_id, { type: 'group_member_left', group_id: payload.group_id, user_id: payload.user_id });
    }
  } catch (e) { console.error('[RelayBus] group_member_kicked error:', e.message); }
});

bus.register('group_dissolved', function(payload, ctx) {
  try {
    var group = ctx.stmts.getGroup.get(payload.group_id);
    if (group) {
      var members = ctx.parseMembersJson(group.members_json);
      ctx.stmts.deleteGroupMessages.run(payload.group_id);
      ctx.stmts.deleteGroup.run(payload.group_id);
      ctx.relaySync.updateGroupWatermark();
      for (var i = 0; i < members.length; i++) {
        ctx.sendToClient(members[i], { type: 'group_dissolved', group_id: payload.group_id });
      }
    }
  } catch (e) { console.error('[RelayBus] group_dissolved error:', e.message); }
});

bus.register('group_renamed', function(payload, ctx) {
  try {
    var group = ctx.stmts.getGroup.get(payload.group_id);
    if (group) {
      ctx.stmts.updateGroupName.run(payload.new_name, payload.group_id);
      ctx.relaySync.updateGroupWatermark();
      var members = ctx.parseMembersJson(group.members_json);
      for (var i = 0; i < members.length; i++) {
        ctx.sendToClient(members[i], { type: 'group_renamed', group_id: payload.group_id, new_name: payload.new_name });
      }
    }
  } catch (e) { console.error('[RelayBus] group_renamed error:', e.message); }
});

bus.register('group_announcement', function(payload, ctx) {
  try {
    var group = ctx.stmts.getGroup.get(payload.group_id);
    if (group) {
      ctx.stmts.updateGroupAnnouncement.run(payload.announcement, payload.group_id);
      ctx.relaySync.updateGroupWatermark();
      var members = ctx.parseMembersJson(group.members_json);
      for (var i = 0; i < members.length; i++) {
        ctx.sendToClient(members[i], {
          type: 'group_announcement', group_id: payload.group_id, announcement: payload.announcement,
          announced_by: payload.announced_by, announcement_at: payload.announcement_at
        });
      }
    }
  } catch (e) { console.error('[RelayBus] group_announcement error:', e.message); }
});

bus.register('group_transferred', function(payload, ctx) {
  try {
    var group = ctx.stmts.getGroup.get(payload.group_id);
    if (group) {
      ctx.stmts.updateGroupCreator.run(payload.new_owner_id, payload.group_id);
      ctx.relaySync.updateGroupWatermark();
      var members = ctx.parseMembersJson(group.members_json);
      for (var i = 0; i < members.length; i++) {
        ctx.sendToClient(members[i], {
          type: 'group_transferred', group_id: payload.group_id,
          old_owner_id: payload.old_owner_id, new_owner_id: payload.new_owner_id
        });
      }
    }
  } catch (e) { console.error('[RelayBus] group_transferred error:', e.message); }
});

bus.register('private_message_read', function(payload, ctx) {
  try {
    if (ctx.clients[payload.target_user_id]) {
      ctx.sendToClient(payload.target_user_id, {
        type: 'message_read', reader_id: payload.reader_id, message_ids: payload.message_ids || []
      });
    }
  } catch (e) { console.error('[RelayBus] private_message_read error:', e.message); }
});

// ===================================================================
// 远程管理 & 其他
// ===================================================================

bus.register('remote_admin_action', function(payload, ctx) {
  ctx.emitRelayEvent('remote_admin_action', payload);
});

bus.register('remote_admin_response', function(payload, ctx) {
  ctx.emitRelayEvent('remote_admin_response', payload);
});

bus.register('app_update_available', function(payload, ctx) {
  ctx.broadcast({ type: 'app_update_available', version: payload.version, url: payload.url, notes: payload.notes });
});

console.log('[RelayBus] Registered', Object.keys(bus.registry).length, 'event handlers');
