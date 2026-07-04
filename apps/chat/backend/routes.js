var express = require('express');
var router = express.Router();
var db = require('../../../server/src/utils/db');
var auth = require('../../../server/src/middleware/auth');
var time = require('../../../server/src/utils/time');
var constants = require('../../../server/src/utils/constants');
var relaySync = require('../../../server/src/utils/relay-sync');
var chatServer = null;

function getChatServer() {
  if (!chatServer) {
    try { chatServer = require('../../../server/src/ws/chat-server'); } catch (e) { console.error('[Chat] Operation failed:', e.message); }
  }
  return chatServer;
}

router.use(auth.requireAuth);

function verifyGroupMember(groupId, userId) {
  var group = db.prepare(
    'SELECT id, name, creator_id, members_json, announcement, announcement_at FROM groups WHERE id = ?'
  ).get(groupId);
  if (!group) {
    return { error: true, code: 404, message: '群组不存在' };
  }
  var members = [];
  try { members = JSON.parse(group.members_json); } catch (e) { console.error('[Chat] Operation failed:', e.message); }
  if (members.indexOf(userId) === -1) {
    return { error: true, code: 403, message: '您不是该群组成员' };
  }
  return { error: false, group: group, members: members };
}

function isWithinTwoMinutes(createdAt) {
  var msgTime = new Date(time.toISOString(createdAt)).getTime();
  var now = Date.now();
  return (now - msgTime) <= 120000;
}

router.get('/messages', function(req, res) {
  try {
    var limit = parseInt(req.query.limit) || 50;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;
    var beforeId = req.query.before_id ? parseInt(req.query.before_id) : null;
    var rows;
    if (beforeId) {
      rows = db.prepare(
        'SELECT id, sender_id, sender_name, content, type, extra_json, recalled, created_at FROM chat_messages WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
      ).all('public', beforeId, limit);
    } else {
      rows = db.prepare(
        'SELECT id, sender_id, sender_name, content, type, extra_json, recalled, created_at FROM chat_messages WHERE room_id = ? ORDER BY id DESC LIMIT ?'
      ).all('public', limit);
    }
    var messages = [];
    for (var i = rows.length - 1; i >= 0; i--) {
      var extraData = {};
      try { extraData = JSON.parse(rows[i].extra_json || '{}'); } catch (e) { console.error('[Chat] Operation failed:', e.message); }
      messages.push({
        id: rows[i].id,
        sender_id: rows[i].sender_id,
        sender_name: rows[i].sender_name,
        content: rows[i].content,
        type: rows[i].type,
        recalled: rows[i].recalled || 0,
        reply_to: extraData.reply_to || null,
        created_at: time.toISOString(rows[i].created_at)
      });
    }
    var hasMore = rows.length >= limit;
    res.json({ code: 200, message: 'ok', data: messages, has_more: hasMore });
  } catch (err) {
    console.error('Get chat messages error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: [] });
  }
});

router.get('/contacts', function(req, res) {
  try {
    var rows = db.prepare(
      'SELECT user_id, net_name, real_name, gender, status, role, officer_title FROM users WHERE user_id != ? ORDER BY net_name'
    ).all(req.user.user_id);
    var userIds = [];
    for (var i = 0; i < rows.length; i++) {
      userIds.push(rows[i].user_id);
    }
    var lastMsgMap = {};
    if (userIds.length > 0) {
      try {
        var lastMsgRows = db.prepare(
          'SELECT pm1.sender_id, pm1.receiver_id, pm1.content, pm1.type, pm1.recalled, pm1.created_at ' +
          'FROM private_messages pm1 ' +
          'INNER JOIN ( ' +
          '  SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS other_id, MAX(id) AS max_id ' +
          '  FROM private_messages ' +
          '  WHERE sender_id = ? OR receiver_id = ? ' +
          '  GROUP BY other_id ' +
          ') pm2 ON pm1.id = pm2.max_id'
        ).all(req.user.user_id, req.user.user_id, req.user.user_id);
        for (var j = 0; j < lastMsgRows.length; j++) {
          var row = lastMsgRows[j];
          var otherId = row.sender_id === req.user.user_id ? row.receiver_id : row.sender_id;
          lastMsgMap[otherId] = row;
        }
      } catch (e) {
        console.error('Get last messages error:', e);
      }
    }
    var contacts = [];
    for (var k = 0; k < rows.length; k++) {
      var contact = {
        user_id: rows[k].user_id,
        net_name: rows[k].net_name,
        real_name: rows[k].real_name,
        gender: rows[k].gender,
        status: rows[k].status
      };
      var lastMsg = lastMsgMap[rows[k].user_id];
      if (lastMsg) {
        contact.last_message = lastMsg.recalled ? '[消息已撤回]' : lastMsg.content;
        contact.last_message_type = lastMsg.type;
        contact.last_message_sender_id = lastMsg.sender_id;
        contact.last_message_at = time.toISOString(lastMsg.created_at);
      }
      contacts.push(contact);
    }
    res.json({ code: 200, message: 'ok', data: contacts });
  } catch (err) {
    console.error('Get contacts error:', err);
    res.json({ code: 200, message: 'ok', data: [] });
  }
});

router.get('/groups', function(req, res) {
  try {
    var allGroups = db.prepare(
      'SELECT id, name, creator_id, members_json, announcement, announcement_at, created_at FROM groups'
    ).all();
    var userGroupIds = [];
    var groupMemberMap = {};
    for (var i = 0; i < allGroups.length; i++) {
      var members = [];
      try { members = JSON.parse(allGroups[i].members_json); } catch (e) { console.error('[Chat] Operation failed:', e.message); }
      if (members.indexOf(req.user.user_id) !== -1) {
        userGroupIds.push(allGroups[i].id);
        groupMemberMap[allGroups[i].id] = members;
      }
    }
    var lastGroupMsgMap = {};
    if (userGroupIds.length > 0) {
      try {
        var placeholders = userGroupIds.map(function() { return '?'; }).join(',');
        var lastGroupMsgSql =
          'SELECT gm1.group_id, gm1.content, gm1.type, gm1.sender_id, gm1.sender_name, gm1.recalled, gm1.created_at ' +
          'FROM group_messages gm1 ' +
          'INNER JOIN ( ' +
          '  SELECT group_id, MAX(id) AS max_id FROM group_messages WHERE group_id IN (' + placeholders + ') GROUP BY group_id ' +
          ') gm2 ON gm1.id = gm2.max_id';
        var stmt = db.prepare(lastGroupMsgSql);
        var lastGroupMsgRows = stmt.all.apply(stmt, userGroupIds);
        for (var j = 0; j < lastGroupMsgRows.length; j++) {
          lastGroupMsgMap[lastGroupMsgRows[j].group_id] = lastGroupMsgRows[j];
        }
      } catch (e) {
        console.error('Get last group messages error:', e);
      }
    }
    var CLASS_GROUP_IDS = db.prepare("SELECT id FROM groups WHERE id LIKE 'class_%'").all().map(function(r) { return r.id; });
    function getUserClassId(userId) {
      // 6位格式 YYCCNN
      if (userId.length === 6 && /^\d{6}$/.test(userId)) {
        var yy = userId.substring(0, 2);
        var cc = userId.substring(2, 4);
        var nn = userId.substring(4, 6);
        if (nn === '00') return 'class_' + cc; // YYCC00 = 班管
        return cc; // YYCCNN = 普通学生
      }
      // 兼容旧格式
      if (userId.indexOf('08') === 0) return '08';
      if (userId.indexOf('18') === 0) return '18';
      if (constants.isAdmin(userId)) return 'all';
      return '';
    }
    function canUserSeeGroup(userId, groupId) {
      var cls = getUserClassId(userId);
      if (cls === 'all') return true;
      // 仅对班级群（class_ 前缀）做班级归属限制
      if (groupId.indexOf('class_') === 0) {
        if (typeof cls === 'string' && cls.indexOf('class_') === 0) {
          return cls === groupId;        // 班管只能看自己班
        }
        if (typeof cls === 'string' && cls.indexOf('cohort_') === 0) {
          return true;                   // 年级长可看所有班级群
        }
        var groupClass = groupId.substring('class_'.length);
        return cls === groupClass;       // 学生只能看自己班
      }
      // 非班级群（用户创建的群聊）：所有人可见
      return true;
    }
    var userGroups = [];
    for (var k = 0; k < allGroups.length; k++) {
      var gMembers = groupMemberMap[allGroups[k].id];
      if (!gMembers) continue;
      if (!canUserSeeGroup(req.user.user_id, allGroups[k].id)) continue;
      var groupObj = {
        group_id: allGroups[k].id,
        group_name: allGroups[k].name,
        creator_id: allGroups[k].creator_id,
        member_count: gMembers.length,
        announcement: allGroups[k].announcement,
        announcement_at: allGroups[k].announcement_at ? time.toISOString(allGroups[k].announcement_at) : null,
        created_at: time.toISOString(allGroups[k].created_at),
        is_class_group: CLASS_GROUP_IDS.indexOf(allGroups[k].id) !== -1
      };
      var lastGroupMsg = lastGroupMsgMap[allGroups[k].id];
      if (lastGroupMsg) {
        groupObj.last_message = lastGroupMsg.recalled ? '[消息已撤回]' : lastGroupMsg.content;
        groupObj.last_message_type = lastGroupMsg.type;
        groupObj.last_message_sender = lastGroupMsg.sender_name;
        groupObj.last_message_sender_id = lastGroupMsg.sender_id;
        groupObj.last_message_at = time.toISOString(lastGroupMsg.created_at);
      }
      userGroups.push(groupObj);
    }
    res.json({ code: 200, message: 'ok', data: userGroups });
  } catch (err) {
    console.error('Get groups error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: [] });
  }
});

router.post('/groups', function(req, res) {
  try {
    var groupName = req.body.group_name;
    if (!groupName || !groupName.trim()) {
      return res.status(400).json({ code: 400, message: '群组名称不能为空', data: null });
    }
    var memberIds = req.body.member_ids || [];
    if (!Array.isArray(memberIds)) {
      return res.status(400).json({ code: 400, message: 'member_ids 格式不正确', data: null });
    }
    // 轻量格式校验：member_id 为 6 位数字（YYCCNN 格式）
    // 不校验本地 users 表存在性——多服务器中继模式下 CC 用户可能尚未同步到本地
    for (var i = 0; i < memberIds.length; i++) {
      var mid = memberIds[i];
      if (typeof mid !== 'string' || mid.length !== 6 || !/^\d{6}$/.test(mid)) {
        return res.status(400).json({ code: 400, message: '成员ID格式不正确: ' + mid, data: null });
      }
    }
    var members = [req.user.user_id];
    for (var i = 0; i < memberIds.length; i++) {
      if (memberIds[i] !== req.user.user_id && members.indexOf(memberIds[i]) === -1) {
        members.push(memberIds[i]);
      }
    }
    if (members.length < 2) {
      return res.status(400).json({ code: 400, message: '群组至少需要2名成员', data: null });
    }
    var groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    db.prepare(
      'INSERT INTO groups (id, name, creator_id, members_json) VALUES (?, ?, ?, ?)'
    ).run(groupId, groupName.trim(), req.user.user_id, JSON.stringify(members));
    res.json({
      code: 200,
      message: '群组创建成功',
      data: {
        group_id: groupId,
        group_name: groupName.trim(),
        creator_id: req.user.user_id,
        member_count: members.length,
        created_at: time.nowISO()
      }
    });
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.get('/groups/:groupId/messages', function(req, res) {
  try {
    var groupId = req.params.groupId;
    var result = verifyGroupMember(groupId, req.user.user_id);
    if (result.error) {
      return res.status(result.code).json({ code: result.code, message: result.message, data: null });
    }

    var limit = parseInt(req.query.limit) || 50;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;
    var beforeId = req.query.before_id ? parseInt(req.query.before_id) : null;
    var rows;
    if (beforeId) {
      rows = db.prepare(
        'SELECT id, sender_id, sender_name, content, type, extra_json, recalled, created_at FROM group_messages WHERE group_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
      ).all(groupId, beforeId, limit + 1);
    } else {
      var offset = parseInt(req.query.offset) || 0;
      if (offset < 0) offset = 0;
      rows = db.prepare(
        'SELECT id, sender_id, sender_name, content, type, extra_json, recalled, created_at FROM group_messages WHERE group_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
      ).all(groupId, limit + 1, offset);
    }

    var hasMore = rows.length > limit;
    if (hasMore) {
      rows = rows.slice(0, limit);
    }

    var messages = [];
    for (var i = rows.length - 1; i >= 0; i--) {
      var extraData = {};
      try { extraData = JSON.parse(rows[i].extra_json || '{}'); } catch (e) { console.error('[Chat] Operation failed:', e.message); }
      messages.push({
        id: rows[i].id,
        sender_id: rows[i].sender_id,
        sender_name: rows[i].sender_name,
        content: rows[i].content,
        type: rows[i].type,
        recalled: rows[i].recalled,
        reply_to: extraData.reply_to || null,
        created_at: time.toISOString(rows[i].created_at)
      });
    }

    res.json({ code: 200, message: 'ok', data: { messages: messages, has_more: hasMore } });
  } catch (err) {
    console.error('Get group messages error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.get('/groups/:groupId/members', function(req, res) {
  try {
    var groupId = req.params.groupId;
    var result = verifyGroupMember(groupId, req.user.user_id);
    if (result.error) {
      return res.status(result.code).json({ code: result.code, message: result.message, data: null });
    }

    var memberIds = result.members;
    var members = [];
    for (var i = 0; i < memberIds.length; i++) {
      var user = db.prepare(
        'SELECT user_id, net_name, real_name, gender FROM users WHERE user_id = ?'
      ).get(memberIds[i]);
      if (user) {
        members.push(user);
      }
    }

    res.json({
      code: 200,
      message: 'ok',
      data: {
        members: members,
        creator_id: result.group.creator_id
      }
    });
  } catch (err) {
    console.error('Get group members error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.get('/groups/:groupId/announcement', function(req, res) {
  try {
    var groupId = req.params.groupId;
    var result = verifyGroupMember(groupId, req.user.user_id);
    if (result.error) {
      return res.status(result.code).json({ code: result.code, message: result.message, data: null });
    }

    res.json({
      code: 200,
      message: 'ok',
      data: {
        announcement: result.group.announcement,
        announcement_at: result.group.announcement_at ? time.toISOString(result.group.announcement_at) : null,
        announced_by: result.group.creator_id
      }
    });
  } catch (err) {
    console.error('Get group announcement error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.get('/private/:userId', function(req, res) {
  try {
    var targetUserId = req.params.userId;
    var limit = parseInt(req.query.limit) || 50;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;
    var beforeId = req.query.before_id ? parseInt(req.query.before_id) : null;
    var rows;
    if (beforeId) {
      rows = db.prepare(
        'SELECT id, sender_id, receiver_id, content, type, extra_json, read, created_at FROM private_messages ' +
        'WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND id < ? ' +
        'ORDER BY id DESC LIMIT ?'
      ).all(req.user.user_id, targetUserId, targetUserId, req.user.user_id, beforeId, limit);
    } else {
      rows = db.prepare(
        'SELECT id, sender_id, receiver_id, content, type, extra_json, read, created_at FROM private_messages ' +
        'WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ' +
        'ORDER BY id DESC LIMIT ?'
      ).all(req.user.user_id, targetUserId, targetUserId, req.user.user_id, limit);
    }
    var messages = [];
    for (var i = rows.length - 1; i >= 0; i--) {
      var extraData = {};
      try { extraData = JSON.parse(rows[i].extra_json || '{}'); } catch (e) { console.error('[Chat] Operation failed:', e.message); }
      messages.push({
        id: rows[i].id,
        sender_id: rows[i].sender_id,
        receiver_id: rows[i].receiver_id,
        content: rows[i].content,
        type: rows[i].type,
        read: rows[i].read,
        reply_to: extraData.reply_to || null,
        created_at: time.toISOString(rows[i].created_at)
      });
    }
    var hasMore = rows.length >= limit;
    res.json({ code: 200, message: 'ok', data: messages, has_more: hasMore });
  } catch (err) {
    console.error('Get private messages error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: [] });
  }
});

router.get('/unread-private', function(req, res) {
  try {
    var rows = db.prepare(
      'SELECT sender_id, COUNT(*) as count, MAX(content) as last_content, MAX(created_at) as last_at ' +
      'FROM private_messages WHERE receiver_id = ? AND read = 0 GROUP BY sender_id ORDER BY last_at DESC'
    ).all(req.user.user_id);
    var result = [];
    for (var i = 0; i < rows.length; i++) {
      var sender = db.prepare('SELECT user_id, net_name FROM users WHERE user_id = ?').get(rows[i].sender_id);
      result.push({
        sender_id: rows[i].sender_id,
        sender_name: sender ? sender.net_name : rows[i].sender_id,
        unread_count: rows[i].count,
        last_content: rows[i].last_content || '',
        last_at: time.toISOString(rows[i].last_at)
      });
    }
    res.json({ code: 200, message: 'ok', data: result });
  } catch (err) {
    console.error('Get unread private error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: [] });
  }
});

router.post('/messages/:messageId/recall', function(req, res) {
  try {
    var messageId = req.params.messageId;
    var msg = db.prepare(
      'SELECT id, sender_id, created_at FROM chat_messages WHERE id = ?'
    ).get(messageId);
    if (!msg) {
      return res.status(404).json({ code: 404, message: '消息不存在', data: null });
    }
    if (msg.sender_id !== req.user.user_id) {
      return res.status(403).json({ code: 403, message: '只能撤回自己发送的消息', data: null });
    }
    if (!isWithinTwoMinutes(msg.created_at)) {
      return res.status(400).json({ code: 400, message: '消息已超过2分钟，无法撤回', data: null });
    }
    db.prepare(
      'UPDATE chat_messages SET recalled = 1 WHERE id = ? AND sender_id = ?'
    ).run(messageId, req.user.user_id);
    var ws = getChatServer();
    if (ws && ws.broadcast) {
      ws.broadcast({
        type: 'message_recalled',
        message_type: 'public',
        message_id: messageId,
        recalled_by: req.user.user_id
      });
    }
    res.json({ code: 200, message: '消息已撤回', data: null });
  } catch (err) {
    console.error('Recall chat message error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.post('/private/:messageId/recall', function(req, res) {
  try {
    var messageId = req.params.messageId;
    var msg = db.prepare(
      'SELECT id, sender_id, receiver_id, created_at FROM private_messages WHERE id = ?'
    ).get(messageId);
    if (!msg) {
      return res.status(404).json({ code: 404, message: '消息不存在', data: null });
    }
    if (msg.sender_id !== req.user.user_id && msg.receiver_id !== req.user.user_id) {
      return res.status(403).json({ code: 403, message: '无权操作此消息', data: null });
    }
    if (msg.sender_id !== req.user.user_id) {
      return res.status(403).json({ code: 403, message: '只能撤回自己发送的消息', data: null });
    }
    if (!isWithinTwoMinutes(msg.created_at)) {
      return res.status(400).json({ code: 400, message: '消息已超过2分钟，无法撤回', data: null });
    }
    db.prepare(
      'UPDATE private_messages SET recalled = 1 WHERE id = ? AND sender_id = ?'
    ).run(messageId, req.user.user_id);
    var ws = getChatServer();
    if (ws && ws.sendToClient) {
      ws.sendToClient(msg.receiver_id, {
        type: 'message_recalled',
        message_type: 'private',
        chat_id: msg.sender_id,
        message_id: messageId,
        recalled_by: req.user.user_id
      });
      ws.sendToClient(req.user.user_id, {
        type: 'message_recalled',
        message_type: 'private',
        chat_id: msg.receiver_id,
        message_id: messageId,
        recalled_by: req.user.user_id
      });
    }
    res.json({ code: 200, message: '消息已撤回', data: null });
  } catch (err) {
    console.error('Recall private message error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.post('/groups/:groupId/recall/:messageId', function(req, res) {
  try {
    var groupId = req.params.groupId;
    var messageId = req.params.messageId;
    var result = verifyGroupMember(groupId, req.user.user_id);
    if (result.error) {
      return res.status(result.code).json({ code: result.code, message: result.message, data: null });
    }

    var msg = db.prepare(
      'SELECT id, sender_id, created_at FROM group_messages WHERE id = ? AND group_id = ?'
    ).get(messageId, groupId);
    if (!msg) {
      return res.status(404).json({ code: 404, message: '消息不存在', data: null });
    }
    if (msg.sender_id !== req.user.user_id) {
      return res.status(403).json({ code: 403, message: '只能撤回自己发送的消息', data: null });
    }
    if (!isWithinTwoMinutes(msg.created_at)) {
      return res.status(400).json({ code: 400, message: '消息已超过2分钟，无法撤回', data: null });
    }
    db.prepare(
      'UPDATE group_messages SET recalled = 1 WHERE id = ? AND sender_id = ?'
    ).run(messageId, req.user.user_id);
    var ws = getChatServer();
    if (ws && ws.broadcast) {
      ws.broadcast({
        type: 'message_recalled',
        message_type: 'group',
        group_id: groupId,
        message_id: messageId,
        recalled_by: req.user.user_id
      });
    }
    res.json({ code: 200, message: '消息已撤回', data: null });
  } catch (err) {
    console.error('Recall group message error:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
  }
});

router.delete('/messages/public', auth.requireAdmin, function(req, res) {
  var userId = req.user.user_id;
  try {
    var count = db.prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE room_id = ?').get('public').cnt;
    db.prepare('DELETE FROM chat_messages WHERE room_id = ?').run('public');
    res.json({ code: 200, message: '公共聊天记录已清除，共删除 ' + count + ' 条消息' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '清除失败' });
  }
});

router.delete('/messages/private/:userId', auth.requireAuth, function(req, res) {
  var targetUserId = req.params.userId;
  var currentUserId = req.user.user_id;
  // 只能删除自己参与的对话
  try {
    var count = db.prepare('SELECT COUNT(*) as cnt FROM private_messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)').get(currentUserId, targetUserId, targetUserId, currentUserId).cnt;
    db.prepare('DELETE FROM private_messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)').run(currentUserId, targetUserId, targetUserId, currentUserId);
    relaySync.recordTombstone('private_messages', currentUserId + '_' + targetUserId);
    res.json({ code: 200, message: '私聊记录已清除，共删除 ' + count + ' 条消息' });
  } catch (e) {
    console.error('[Chat] Operation failed:', e.message);
    res.status(500).json({ code: 500, message: '清除失败' });
  }
});

router.delete('/messages/group/:groupId', auth.requireAdmin, function(req, res) {
  var groupId = req.params.groupId;
  try {
    var count = db.prepare('SELECT COUNT(*) as cnt FROM group_messages WHERE group_id = ?').get(groupId).cnt;
    db.prepare('DELETE FROM group_messages WHERE group_id = ?').run(groupId);
    relaySync.recordTombstone('group_messages', groupId);
    res.json({ code: 200, message: '群聊记录已清除，共删除 ' + count + ' 条消息' });
  } catch (e) {
    res.status(500).json({ code: 500, message: '清除失败' });
  }
});

// 确认群公告
router.post('/groups/:groupId/acknowledge-announcement', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var groupId = req.params.groupId;
  try {
    var existing = db.prepare('SELECT id FROM user_kv_store WHERE user_id = ? AND key = ?').get(userId, 'announcement_ack_' + groupId);
    if (existing) {
      db.prepare('UPDATE user_kv_store SET value = ?, updated_at = datetime(\'now\') WHERE id = ?').run(String(Date.now()), existing.id);
    } else {
      db.prepare('INSERT INTO user_kv_store (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime(\'now\'))').run(userId, 'announcement_ack_' + groupId, String(Date.now()));
    }
    res.json({ code: 200, message: 'ok' });
  } catch (e) {
    console.error('[Chat] Acknowledge announcement error:', e.message);
    res.status(500).json({ code: 500, message: '操作失败' });
  }
});

// 获取群公告确认状态
router.get('/groups/:groupId/announcement-status', auth.requireAuth, function(req, res) {
  var userId = req.user.user_id;
  var groupId = req.params.groupId;
  try {
    var row = db.prepare('SELECT value FROM user_kv_store WHERE user_id = ? AND key = ?').get(userId, 'announcement_ack_' + groupId);
    var group = db.prepare('SELECT announcement_at FROM groups WHERE id = ?').get(groupId);
    res.json({
      code: 200,
      data: {
        acknowledged_at: row ? row.value : null,
        announcement_at: group ? group.announcement_at : null
      }
    });
  } catch (e) {
    console.error('[Chat] Get announcement status error:', e.message);
    res.status(500).json({ code: 500, message: '操作失败' });
  }
});

module.exports = router;
