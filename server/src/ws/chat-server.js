var WebSocket = require('ws');
var db = require('../utils/db');
var exp = require('../utils/exp');
var jwtUtil = require('../utils/jwt');
var config = require('../config');
var time = require('../utils/time');
var relaySync = require('../utils/relay-sync');
var crashLogger = require('../utils/crash-logger');
var constants = require('../utils/constants');
var relayBus = require('../utils/relay-bus');
// 加载事件处理器注册
require('../utils/relay-handlers');

var PORT = parseInt(config.wsPort || process.env.WS_PORT || 10001, 10);
var RELAY_PORT = parseInt(config.relayPort || process.env.RELAY_PORT, 10) || 10011;

var wss = new WebSocket.Server({
  port: PORT,
  maxPayload: 5 * 1024 * 1024
});

var relayWss = new WebSocket.Server({
  port: RELAY_PORT,
  maxPayload: 8 * 1024 * 1024
});

relayWss.on('error', function(err) {
  console.error('[Relay] Server error:', err.message);
});

relayWss.on('connection', function(ws) {
  handleRelayConnection(ws);
});

console.log('Relay server listening on port', RELAY_PORT);

loadClassGroupIds();

wss.on('error', function(err) {
  if (err.code === 'EADDRINUSE') {
    console.error('[WebSocket] Port ' + PORT + ' is already in use! Another instance may be running.');
    console.error('[WebSocket] Run "cn kill" or "cn stop" to stop the existing process.');
    console.error('[WebSocket] WebSocket server will not start. Chat features will be unavailable.');
  } else {
    console.error('[WebSocket] Server error:', err.message);
  }
});

var clients = {};      // { user_id: websocket }
var onlineUsers = {};  // { user_id: { user_id, net_name, real_name, gender, status } }

var messageRateLimit = {};
var recentClientMsgs = {};
var MAX_RECENT_CLIENT_MSGS = 100;

var RELAY_SERVERS = (process.env.RELAY_SERVERS || '').split(',').filter(function(s) { return s.trim() !== ''; });
var relayEnabled = true; // 默认启用，启动时从数据库读取
var RELAY_SECRET = process.env.RELAY_SECRET || '';
if (!RELAY_SECRET && config.relay.servers.length > 0) {
  console.error('[Relay] CRITICAL: RELAY_SECRET not set but relay servers configured!');
  console.error('[Relay] Remote admin commands will NOT be verified. Set RELAY_SECRET in .env for security.');
  console.error('[Relay] Continuing with unauthenticated relay - NOT recommended for production.');
}
var RELAY_SERVER_ID = process.env.RELAY_SERVER_ID || '';
if (!RELAY_SERVER_ID) {
  // 尝试从数据库读取持久化的 server_id
  try {
    var existingServerId = db.prepare("SELECT value FROM system_settings WHERE key = 'relay_server_id'").get();
    if (existingServerId && existingServerId.value) {
      RELAY_SERVER_ID = existingServerId.value;
    } else {
      RELAY_SERVER_ID = 'server-' + Math.random().toString(36).substr(2, 8);
      db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('relay_server_id', ?)").run(RELAY_SERVER_ID);
    }
  } catch (e) {
    RELAY_SERVER_ID = 'server-' + Math.random().toString(36).substr(2, 8);
    console.warn('[Relay] Could not persist server_id:', e.message);
  }
}
var relayPeers = [];
var remoteOnlineUsers = {};
var CLASS_GROUP_IDS = [];
function loadClassGroupIds() {
  try {
    var rows = db.prepare("SELECT id FROM groups WHERE id LIKE 'class_%'").all();
    CLASS_GROUP_IDS = rows.map(function(r) { return r.id; });
    console.log('[ChatServer] Loaded class groups:', CLASS_GROUP_IDS.join(', '));
  } catch (e) {
    CLASS_GROUP_IDS = ['class_08', 'class_18']; // fallback
    console.error('[ChatServer] Failed to load class groups, using fallback:', e.message);
  }
}

function isDuplicateClientMsg(userId, content) {
  if (!recentClientMsgs[userId]) return false;
  var now = Date.now();
  for (var i = recentClientMsgs[userId].length - 1; i >= 0; i--) {
    if (now - recentClientMsgs[userId][i].ts > 10000) {
      recentClientMsgs[userId].splice(0, i + 1);
      break;
    }
    if (recentClientMsgs[userId][i].content === content) return true;
  }
  return false;
}
function trackClientMsg(userId, content) {
  if (!recentClientMsgs[userId]) recentClientMsgs[userId] = [];
  recentClientMsgs[userId].push({ content: content, ts: Date.now() });
  if (recentClientMsgs[userId].length > MAX_RECENT_CLIENT_MSGS) {
    recentClientMsgs[userId].splice(0, recentClientMsgs[userId].length - MAX_RECENT_CLIENT_MSGS);
  }
}

var RELAY_PW_KEY = process.env.RELAY_SECRET || '';
if (!RELAY_PW_KEY && config.relay.servers.length > 0) {
  console.error('[Relay] FATAL: RELAY_SECRET must be set for relay password obfuscation');
}
function obfuscatePw(hash) {
  if (!hash || !RELAY_PW_KEY) return hash || '';
  var result = '';
  for (var i = 0; i < hash.length; i++) {
    result += String.fromCharCode(hash.charCodeAt(i) ^ RELAY_PW_KEY.charCodeAt(i % RELAY_PW_KEY.length));
  }
  return Buffer.from(result, 'binary').toString('base64');
}

function getUserClassId(userId) {
  // 6位格式 YYCCNN
  if (userId.length === 6 && /^\d{6}$/.test(userId)) {
    var yy = userId.substring(0, 2);
    var cc = userId.substring(2, 4);
    var nn = userId.substring(4, 6);
    if (nn === '00') return 'class_' + cc; // YYCC00 = 班管，仅可见该班
    return cc; // YYCCNN = 普通学生，CC为班级号
  }
  // 兼容旧格式 4位: 前两位为班级号
  if (userId.indexOf('08') === 0) return '08';
  if (userId.indexOf('18') === 0) return '18';
  // 班管（通过 isClassAdmin 检测）
  if (constants.isClassAdmin(userId)) {
    var ccAdmin = userId.substring(2, 4);
    return 'class_' + ccAdmin;
  }
  return '';
}

function canUserSeeGroup(userId, groupId) {
  var cls = getUserClassId(userId);
  // 班管可见对应班级群
  if (typeof cls === 'string' && cls.indexOf('class_') === 0) {
    return cls === groupId;
  }
  // 普通学生：从 groupId 提取班级号比较（如 class_08 → 08）
  if (groupId.indexOf('class_') === 0) {
    var groupClass = groupId.substring('class_'.length);
    return cls === groupClass;
  }
  return true;
}

function ensureUserInClassGroups(userId) {
  var cls = getUserClassId(userId);
  var groupsToJoin = [];
  if (typeof cls === 'string' && cls.indexOf('class_') === 0) {
    groupsToJoin.push(cls); // 班管加入对应班级群
  } else if (cls) {
    groupsToJoin.push('class_' + cls);
  }

  for (var i = 0; i < groupsToJoin.length; i++) {
    var group = stmtGetGroup.get(groupsToJoin[i]);
    if (group) {
      var members = parseMembersJson(group.members_json);
      if (members.indexOf(userId) === -1) {
        members.push(userId);
        stmtUpdateGroupMembers.run(JSON.stringify(members), groupsToJoin[i]);
      }
    }
  }
}

var relayCallbacks = {};

function checkWsRateLimit(userId, maxCount, windowMs) {
  var now = Date.now();
  if (!messageRateLimit[userId] || now - messageRateLimit[userId].windowStart > windowMs) {
    messageRateLimit[userId] = { count: 1, windowStart: now };
    return true;
  }
  messageRateLimit[userId].count++;
  return messageRateLimit[userId].count <= maxCount;
}

// ===== Prepared statements =====

var stmtInsertChatMessage = db.prepare(
  'INSERT INTO chat_messages (room_id, sender_id, sender_name, content, type, extra_json) VALUES (?, ?, ?, ?, ?, ?)'
);

var stmtGetChatHistory = db.prepare(
  'SELECT id, sender_id, sender_name, content, type, extra_json, created_at FROM chat_messages WHERE room_id = ? ORDER BY id DESC LIMIT ?'
);

var stmtGetChatHistoryOffset = db.prepare(
  'SELECT id, sender_id, sender_name, content, type, extra_json, created_at FROM chat_messages WHERE room_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
);

var stmtCountChatMessages = db.prepare(
  'SELECT COUNT(*) as total FROM chat_messages WHERE room_id = ?'
);

var stmtInsertPrivateMessage = db.prepare(
  'INSERT INTO private_messages (sender_id, receiver_id, content, type, extra_json) VALUES (?, ?, ?, ?, ?)'
);

var stmtGetPrivateHistory = db.prepare(
  'SELECT id, sender_id, receiver_id, content, type, extra_json, read, created_at FROM private_messages ' +
  'WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ' +
  'ORDER BY id DESC LIMIT ?'
);

var stmtInsertGroup = db.prepare(
  'INSERT INTO groups (id, name, creator_id, members_json) VALUES (?, ?, ?, ?)'
);

var stmtGetGroup = db.prepare(
  'SELECT id, name, creator_id, members_json, announcement, announcement_at, created_at FROM groups WHERE id = ?'
);

var stmtUpdateGroupMembers = db.prepare(
  'UPDATE groups SET members_json = ? WHERE id = ?'
);

var stmtGetUserGroups = db.prepare(
  'SELECT id, name, creator_id, members_json, announcement, announcement_at, created_at FROM groups'
);

var stmtDeleteGroupMessages = db.prepare(
  'DELETE FROM group_messages WHERE group_id = ?'
);

var stmtDeleteGroup = db.prepare(
  'DELETE FROM groups WHERE id = ?'
);

var stmtUpdateGroupCreator = db.prepare(
  'UPDATE groups SET creator_id = ? WHERE id = ?'
);

var stmtUpdateGroupAnnouncement = db.prepare(
  "UPDATE groups SET announcement = ?, announcement_at = datetime('now') WHERE id = ?"
);

var stmtUpdateGroupName = db.prepare(
  'UPDATE groups SET name = ? WHERE id = ?'
);

var stmtRecallChatMessage = db.prepare(
  'UPDATE chat_messages SET recalled = 1 WHERE id = ? AND sender_id = ?'
);

var stmtRecallPrivateMessage = db.prepare(
  'UPDATE private_messages SET recalled = 1 WHERE id = ? AND sender_id = ?'
);

var stmtRecallGroupMessage = db.prepare(
  'UPDATE group_messages SET recalled = 1 WHERE id = ? AND sender_id = ?'
);

var stmtGetChatMessage = db.prepare(
  'SELECT id, sender_id, created_at FROM chat_messages WHERE id = ?'
);

var stmtGetPrivateMessage = db.prepare(
  'SELECT id, sender_id, created_at FROM private_messages WHERE id = ?'
);

var stmtGetGroupMessage = db.prepare(
  'SELECT id, sender_id, created_at FROM group_messages WHERE id = ?'
);

var stmtGetGroupHistory = db.prepare(
  'SELECT id, sender_id, sender_name, content, type, extra_json, recalled, created_at FROM group_messages WHERE group_id = ? ORDER BY id DESC LIMIT ?'
);

var stmtGetGroupHistoryOffset = db.prepare(
  'SELECT id, sender_id, sender_name, content, type, extra_json, recalled, created_at FROM group_messages WHERE group_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
);

var stmtCountGroupMessages = db.prepare(
  'SELECT COUNT(*) as total FROM group_messages WHERE group_id = ?'
);

var stmtInsertGroupMessage = db.prepare(
  'INSERT INTO group_messages (group_id, sender_id, sender_name, content, type, extra_json) VALUES (?, ?, ?, ?, ?, ?)'
);

var stmtGetUserInfo = db.prepare(
  'SELECT user_id, net_name, real_name, gender, status FROM users WHERE user_id = ?'
);

var stmtInsertRelayedChatMessage = db.prepare(
  'INSERT INTO chat_messages (room_id, sender_id, sender_name, content, type, extra_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);

var stmtInsertRelayedPrivateMessage = db.prepare(
  'INSERT INTO private_messages (sender_id, receiver_id, content, type, extra_json, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);

var stmtInsertRelayedGroupMessage = db.prepare(
  'INSERT INTO group_messages (group_id, sender_id, sender_name, content, type, extra_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);

var stmtMarkPrivateRead = db.prepare(
  'UPDATE private_messages SET read = 1 WHERE sender_id = ? AND receiver_id = ? AND read = 0'
);

// ===== Helper functions =====

function broadcast(message, excludeClientId, skipRelay) {
  if (message.type === 'new_message' || message.type === 'private_message' || message.type === 'group_message') {
    console.log('[Broadcast] type=' + message.type + ' skipRelay=' + skipRelay + ' msgId=' + ((message.message && message.message.id) || 'none') + ' sender=' + ((message.message && message.message.sender_id) || 'none'));
  }
  var data = JSON.stringify(message);
  var disconnected = [];
  for (var clientId in clients) {
    if (clientId !== excludeClientId) {
      try {
        if (clients[clientId].bufferedAmount > 512 * 1024) continue;
        clients[clientId].send(data);
      } catch (e) {
        disconnected.push(clientId);
      }
    }
  }
  for (var i = 0; i < disconnected.length; i++) {
    handleDisconnect(disconnected[i]);
  }
}

// 仅广播给本地客户端，不中继到其他服务器
function broadcastToClients(message) {
  broadcast(message, null, true);
}

function handleDisconnect(userId) {
  if (clients[userId]) {
    delete clients[userId];
  }
  if (onlineUsers[userId]) {
    delete onlineUsers[userId];
    relayBus.emit('user_offline', { user_id: userId });
  }
  delete messageRateLimit[userId];
}

function sendToClient(userId, message) {
  if (clients[userId] && clients[userId].readyState === WebSocket.OPEN) {
    try {
      var data = JSON.stringify(message);
      if (data.length > 1024 * 1024) {
        console.warn('[WS] Dropping large message to user', userId, '- size:', Math.round(data.length / 1024), 'KB');
        return false;
      }
      if (clients[userId].bufferedAmount > 512 * 1024) {
        return false;
      }
      clients[userId].send(data);
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

function parseMembersJson(membersJsonStr) {
  try {
    return JSON.parse(membersJsonStr);
  } catch (e) {
    return [];
  }
}

function generateRelayMsgId() {
  return RELAY_SERVER_ID + '-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
}

function relayToPeers(message) {
  if (!relayEnabled) return;
  if (relayPeers.length === 0) return;
  if (!message.relay_msg_id) {
    message.relay_msg_id = generateRelayMsgId();
  }
  var category = message.category || (message.payload && message.payload.type) || 'unknown';
  console.log('[Relay-Send] category=' + category + ' relay_msg_id=' + message.relay_msg_id + ' peers=' + relayPeers.length + ' peerIds=[' + relayPeers.map(function(p) { return p.serverId; }).join(',') + ']');
  var data = JSON.stringify(message);
  if (data.length > 10 * 1024 * 1024) {
    console.error('[Relay] Dropping oversized relay message:', Math.round(data.length / 1024 / 1024), 'MB');
    return;
  }
  var sentTo = {};
  var disconnected = [];
  for (var i = relayPeers.length - 1; i >= 0; i--) {
    var peerServerId = relayPeers[i].serverId;
    if (sentTo[peerServerId]) continue;
    if (relayPeers[i].ws.readyState === WebSocket.OPEN) {
      try {
        if (relayPeers[i].ws.bufferedAmount > 5 * 1024 * 1024) continue;
        relayPeers[i].ws.send(data);
        sentTo[peerServerId] = true;
      } catch (e) {
        disconnected.push(i);
      }
    } else if (relayPeers[i].ws.readyState !== WebSocket.CONNECTING) {
      disconnected.push(i);
    }
  }
  for (var j = disconnected.length - 1; j >= 0; j--) {
    relayPeers.splice(disconnected[j], 1);
  }
}

function removeRelayPeerByServerId(serverId) {
  var removed = false;
  for (var i = relayPeers.length - 1; i >= 0; i--) {
    if (relayPeers[i].serverId === serverId) {
      try { relayPeers[i].ws.close(); } catch (e) {}
      relayPeers.splice(i, 1);
      removed = true;
    }
  }
  return removed;
}

function onRelayEvent(eventType, callback) {
  if (!relayCallbacks[eventType]) {
    relayCallbacks[eventType] = [];
  }
  relayCallbacks[eventType].push(callback);
}

function emitRelayEvent(eventType, data) {
  if (relayCallbacks[eventType]) {
    for (var i = 0; i < relayCallbacks[eventType].length; i++) {
      try { relayCallbacks[eventType][i](data); } catch (e) {}
    }
  }
}

function processRelayedMessage(data) {
  relayBus.processRelayed(data);
}

// ===== 初始化联动事件总线 =====
relayBus.init({
  db: db,
  broadcast: broadcast,
  sendToClient: sendToClient,
  onlineUsers: onlineUsers,
  clients: clients,
  remoteOnlineUsers: remoteOnlineUsers,
  relaySync: relaySync,
  relayToPeers: relayToPeers,
  handleDisconnect: handleDisconnect,
  emitRelayEvent: emitRelayEvent,
  getSyncStmts: relaySync.getSyncStmts,
  stmtInsertRelayedChatMessage: stmtInsertRelayedChatMessage,
  stmtInsertRelayedPrivateMessage: stmtInsertRelayedPrivateMessage,
  stmtInsertRelayedGroupMessage: stmtInsertRelayedGroupMessage,
  stmtGetGroup: stmtGetGroup,
  stmtInsertGroup: stmtInsertGroup,
  stmtUpdateGroupMembers: stmtUpdateGroupMembers,
  stmtUpdateGroupName: stmtUpdateGroupName,
  stmtUpdateGroupAnnouncement: stmtUpdateGroupAnnouncement,
  stmtUpdateGroupCreator: stmtUpdateGroupCreator,
  stmtDeleteGroupMessages: stmtDeleteGroupMessages,
  stmtDeleteGroup: stmtDeleteGroup,
  stmtRecallChatMessage: stmtRecallChatMessage,
  stmtRecallPrivateMessage: stmtRecallPrivateMessage,
  stmtRecallGroupMessage: stmtRecallGroupMessage,
  parseMembersJson: parseMembersJson,
  obfuscatePw: obfuscatePw,
  deobfuscatePw: function(encoded) {
    if (!encoded || !RELAY_PW_KEY) return encoded || '';
    try {
      var decoded = Buffer.from(encoded, 'base64').toString('binary');
      var result = '';
      for (var i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) ^ RELAY_PW_KEY.charCodeAt(i % RELAY_PW_KEY.length));
      }
      return result;
    } catch (e) {
      return encoded;
    }
  },
  RELAY_SERVER_ID: RELAY_SERVER_ID
});

function handleRelayConnection(ws) {
  if (!relayEnabled) {
    console.log('[Relay] Relay is disabled, rejecting inbound connection');
    try { ws.close(); } catch (e) {}
    return;
  }
  var authenticated = false;
  var peerServerId = '';
  var peerHeartbeat = null;

  var authTimeout = setTimeout(function() {
    if (!authenticated) {
      try { ws.close(); } catch (e) {}
    }
  }, 10000);

  ws.on('message', function(rawMessage) {
    if (rawMessage.length > 10 * 1024 * 1024) {
      console.error('[Relay] Dropping oversized message:', Math.round(rawMessage.length / 1024 / 1024), 'MB');
      return;
    }
    var data;
    try { data = JSON.parse(rawMessage); } catch (e) { return; }

    if (!authenticated) {
      if (data.type === 'relay_auth') {
        clearTimeout(authTimeout);
        if (!RELAY_SECRET || data.secret !== RELAY_SECRET) {
          // RELAY_SECRET 未配置时拒绝所有中继认证（避免空字符串导致认证被跳过）
          try { ws.close(); } catch (e) {}
          return;
        }
        authenticated = true;
        peerServerId = data.server_id || 'unknown';
        console.log('[Relay] Inbound auth from:', peerServerId, '- removing existing peers with same ID, current relayPeers count:', relayPeers.length);
        removeRelayPeerByServerId(peerServerId);
        relayPeers.push({ ws: ws, serverId: peerServerId });
        console.log('[Relay] After inbound push, relayPeers:', relayPeers.map(function(p) { return p.serverId; }).join(','));
        ws.send(JSON.stringify({
          type: 'relay_auth_ok',
          server_id: RELAY_SERVER_ID
        }));
        console.log('[Relay] Peer connected:', peerServerId);

        ws.isAlive = true;
        peerHeartbeat = setInterval(function() {
          if (ws.readyState === WebSocket.OPEN) {
            if (ws.isAlive === false) {
              console.warn('[Relay] Server heartbeat timeout for peer:', peerServerId);
              try { ws.terminate(); } catch (e) {}
              return;
            }
            ws.isAlive = false;
            try { ws.send(JSON.stringify({ type: 'relay_ping' })); } catch (e) {}
          }
        }, 30000);

        var onlineUsersList = [];
        for (var uid in onlineUsers) {
          onlineUsersList.push(onlineUsers[uid]);
        }
        ws.send(JSON.stringify({
          type: 'relay_sync',
          server_id: RELAY_SERVER_ID,
          online_users: onlineUsersList
        }));

        var mySyncState = relaySync.getSyncState();
        ws.send(JSON.stringify({
          type: 'relay_catchup_request',
          server_id: RELAY_SERVER_ID,
          sync_state: mySyncState
        }));
        console.log('[Relay] Sent catchup request to', peerServerId, 'my state:', JSON.stringify(mySyncState));
      }
      return;
    }

    if (data.type === 'relay_message') {
      try {
        crashLogger.trackActivity('relay_message', (data.payload && data.payload.type) || 'unknown');
        processRelayedMessage(data);
      } catch (e) {
        console.error('[Relay] Error processing relay message:', e.message);
        crashLogger.writeCrashLog('RELAY_HANDLER_ERROR', e);
      }
    }

    if (data.type === 'relay_ping') {
      try { ws.send(JSON.stringify({ type: 'relay_pong', server_id: RELAY_SERVER_ID })); } catch (e) {}
    }

    if (data.type === 'relay_pong') {
      ws.isAlive = true;
    }

    if (data.type === 'relay_sync') {
      try {
        var syncUsers = data.online_users || [];
        var addedCount = 0;
        for (var si = 0; si < syncUsers.length; si++) {
          if (!onlineUsers[syncUsers[si].user_id]) {
            syncUsers[si].remote = true;
            syncUsers[si].server_id = data.server_id;
            remoteOnlineUsers[syncUsers[si].user_id] = syncUsers[si];
            addedCount++;
          }
        }
        if (addedCount > 0) {
          broadcast({ type: 'remote_users_sync', remote_users: remoteOnlineUsers }, null, true);
        }
        console.log('[Relay] Synced', addedCount, '/', syncUsers.length, 'users from', data.server_id);
      } catch (e) { console.error('[Relay] Error handling relay_sync:', e.message); }
    }

    if (data.type === 'relay_catchup_request') {
      try {
        if (crashLogger.isMemoryPressure()) {
          console.warn('[Relay] Skipping catchup request - memory pressure:', JSON.stringify(crashLogger.getMemoryMB()));
          ws.send(JSON.stringify({
            type: 'relay_catchup_response',
            server_id: RELAY_SERVER_ID,
            sync_state: relaySync.getSyncState(),
            data: { has_more: { overall: false }, next_state: {} }
          }));
          return;
        }
        var remoteState = data.sync_state || {};
        console.log('[Relay] Received catchup request from', data.server_id, 'remote state:', JSON.stringify(remoteState));
        var catchupData = relaySync.buildCatchupResponse(remoteState);
        var myState = relaySync.getSyncState();
        var response = JSON.stringify({
          type: 'relay_catchup_response',
          server_id: RELAY_SERVER_ID,
          sync_state: myState,
          data: catchupData
        });
        if (response.length > 10 * 1024 * 1024) {
          console.error('[Relay] Catchup response too large:', Math.round(response.length / 1024 / 1024), 'MB - truncating');
          var truncatedData = {};
          var dataKeys = Object.keys(catchupData);
          for (var tdi = 0; tdi < dataKeys.length; tdi++) {
            if (Array.isArray(catchupData[dataKeys[tdi]]) && dataKeys[tdi] !== 'has_more') {
              truncatedData[dataKeys[tdi]] = catchupData[dataKeys[tdi]].slice(0, 100);
            } else if (dataKeys[tdi] !== 'next_state' && dataKeys[tdi] !== 'has_more') {
              truncatedData[dataKeys[tdi]] = catchupData[dataKeys[tdi]];
            }
          }
          truncatedData.has_more = {};
          var truncTypes = ['chat_messages', 'private_messages', 'group_messages', 'posts', 'comments', 'likes', 'reactions', 'bookmarks', 'exp_logs', 'broadcasts', 'users', 'user_experience', 'user_settings'];
          var truncAnyMore = false;
          for (var tti = 0; tti < truncTypes.length; tti++) {
            var tt = truncTypes[tti];
            if (Array.isArray(truncatedData[tt]) && (truncatedData[tt].length >= 100 || (catchupData.has_more && catchupData.has_more[tt]))) {
              truncatedData.has_more[tt] = true;
              truncAnyMore = true;
            } else {
              truncatedData.has_more[tt] = false;
            }
          }
          truncatedData.has_more.overall = true;
          truncatedData.next_state = {};
          if (truncatedData.chat_messages && truncatedData.chat_messages.length > 0) truncatedData.next_state.last_chat_id = truncatedData.chat_messages[truncatedData.chat_messages.length - 1].id;
          if (truncatedData.private_messages && truncatedData.private_messages.length > 0) truncatedData.next_state.last_pm_id = truncatedData.private_messages[truncatedData.private_messages.length - 1].id;
          if (truncatedData.group_messages && truncatedData.group_messages.length > 0) truncatedData.next_state.last_gm_id = truncatedData.group_messages[truncatedData.group_messages.length - 1].id;
          if (truncatedData.posts && truncatedData.posts.length > 0) truncatedData.next_state.last_post_id = truncatedData.posts[truncatedData.posts.length - 1].id;
          if (truncatedData.comments && truncatedData.comments.length > 0) truncatedData.next_state.last_comment_id = truncatedData.comments[truncatedData.comments.length - 1].id;
          if (truncatedData.reactions && truncatedData.reactions.length > 0) truncatedData.next_state.last_reaction_id = truncatedData.reactions[truncatedData.reactions.length - 1].id;
          if (truncatedData.bookmarks && truncatedData.bookmarks.length > 0) truncatedData.next_state.last_bookmark_id = truncatedData.bookmarks[truncatedData.bookmarks.length - 1].id;
          if (truncatedData.likes && truncatedData.likes.length > 0) truncatedData.next_state.last_like_id = truncatedData.likes[truncatedData.likes.length - 1].id;
          if (truncatedData.exp_logs && truncatedData.exp_logs.length > 0) truncatedData.next_state.last_exp_log_id = truncatedData.exp_logs[truncatedData.exp_logs.length - 1].id;
          if (truncatedData.broadcasts && truncatedData.broadcasts.length > 0) truncatedData.next_state.last_broadcast_id = truncatedData.broadcasts[truncatedData.broadcasts.length - 1].id;
          if (truncatedData.users && truncatedData.users.length > 0) truncatedData.next_state.last_user_sync_time = truncatedData.users[truncatedData.users.length - 1].created_at || null;
          if (truncatedData.user_experience && truncatedData.user_experience.length > 0) truncatedData.next_state.last_exp_user_id = truncatedData.user_experience[truncatedData.user_experience.length - 1].user_id;
          if (truncatedData.user_settings && truncatedData.user_settings.length > 0) truncatedData.next_state.last_settings_user_id = truncatedData.user_settings[truncatedData.user_settings.length - 1].user_id;
          response = JSON.stringify({
            type: 'relay_catchup_response',
            server_id: RELAY_SERVER_ID,
            sync_state: myState,
            data: truncatedData
          });
        }
        ws.send(response);
        console.log('[Relay] Sent catchup response to', data.server_id, '- size:', Math.round(response.length / 1024), 'KB');
      } catch (e) { console.error('[Relay] Error handling relay_catchup_request:', e.message); }
    }

    if (data.type === 'relay_catchup_response') {
      var syncData = data.data || {};
      var remoteSyncState = data.sync_state || {};
      var hasMore = (syncData.has_more && syncData.has_more.overall) || false;
      var nextState = syncData.next_state || {};
      console.log('[Relay] Received catchup response from', data.server_id, 'has_more:', hasMore);
      if (crashLogger.isMemoryPressure()) {
        console.warn('[Relay] Skipping catchup apply - memory pressure:', JSON.stringify(crashLogger.getMemoryMB()));
        return;
      }
      try {
        var syncResult = relaySync.applySyncData(syncData);
        console.log('[Relay] Applied sync data from', data.server_id, ':', JSON.stringify(syncResult));

        if (hasMore && nextState) {
          var batchState = Object.assign({}, remoteSyncState);
          if (nextState.last_chat_id) batchState.last_chat_id = Math.max(batchState.last_chat_id || 0, nextState.last_chat_id);
          if (nextState.last_pm_id) batchState.last_pm_id = Math.max(batchState.last_pm_id || 0, nextState.last_pm_id);
          if (nextState.last_gm_id) batchState.last_gm_id = Math.max(batchState.last_gm_id || 0, nextState.last_gm_id);
          if (nextState.last_post_id) batchState.last_post_id = Math.max(batchState.last_post_id || 0, nextState.last_post_id);
          if (nextState.last_comment_id) batchState.last_comment_id = Math.max(batchState.last_comment_id || 0, nextState.last_comment_id);
          if (nextState.last_reaction_id) batchState.last_reaction_id = Math.max(batchState.last_reaction_id || 0, nextState.last_reaction_id);
          if (nextState.last_bookmark_id) batchState.last_bookmark_id = Math.max(batchState.last_bookmark_id || 0, nextState.last_bookmark_id);
          if (nextState.last_like_id) batchState.last_like_id = Math.max(batchState.last_like_id || 0, nextState.last_like_id);
          if (nextState.last_exp_log_id) batchState.last_exp_log_id = Math.max(batchState.last_exp_log_id || 0, nextState.last_exp_log_id);
          if (nextState.last_broadcast_id) batchState.last_broadcast_id = Math.max(batchState.last_broadcast_id || 0, nextState.last_broadcast_id);
          if (nextState.last_user_sync_time) batchState.last_user_sync_time = nextState.last_user_sync_time;
          if (nextState.last_exp_user_id) batchState.last_exp_user_id = nextState.last_exp_user_id;
          if (nextState.last_settings_user_id) batchState.last_settings_user_id = nextState.last_settings_user_id;
          if (nextState.last_group_time) batchState.last_group_time = nextState.last_group_time;
          if (nextState.last_tombstone_time) batchState.last_tombstone_time = nextState.last_tombstone_time;
          setTimeout(function() {
            try {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'relay_catchup_request',
                  server_id: RELAY_SERVER_ID,
                  sync_state: batchState
                }));
                console.log('[Relay] Sent next batch catchup request to', data.server_id);
              }
            } catch (e) {}
          }, 500);
        } else {
          if (remoteSyncState.last_chat_id > 0 || remoteSyncState.last_pm_id > 0 || remoteSyncState.last_gm_id > 0) {
            var myState = relaySync.getSyncState();
            var needReverseCatchup = false;
            if (myState.last_chat_id > (remoteSyncState.last_chat_id || 0)) needReverseCatchup = true;
            if (myState.last_pm_id > (remoteSyncState.last_pm_id || 0)) needReverseCatchup = true;
            if (myState.last_gm_id > (remoteSyncState.last_gm_id || 0)) needReverseCatchup = true;
            if (myState.last_post_id > (remoteSyncState.last_post_id || 0)) needReverseCatchup = true;

            if (needReverseCatchup) {
              var reverseCatchupData = relaySync.buildCatchupResponse(remoteSyncState);
              var reverseResponse = JSON.stringify({
                type: 'relay_catchup_response',
                server_id: RELAY_SERVER_ID,
                sync_state: myState,
                data: reverseCatchupData
              });
              if (reverseResponse.length > 5 * 1024 * 1024) {
                console.error('[Relay] Reverse catchup too large, skipping');
              } else {
                ws.send(reverseResponse);
                console.log('[Relay] Sent reverse catchup to', data.server_id);
              }
            }
          }
        }
      } catch (e) {
        console.error('[Relay] Error applying sync data:', e.message);
      }
    }
  });

  ws.on('close', function() {
    clearTimeout(authTimeout);
    clearInterval(peerHeartbeat);
    var disconnectedServerId = null;
    for (var i = 0; i < relayPeers.length; i++) {
      if (relayPeers[i].ws === ws) {
        disconnectedServerId = relayPeers[i].serverId;
        console.log('[Relay] Peer disconnected:', disconnectedServerId);
        relayPeers.splice(i, 1);
        break;
      }
    }
    if (disconnectedServerId) {
      var toRemove = [];
      for (var ruid in remoteOnlineUsers) {
        if (remoteOnlineUsers[ruid].server_id === disconnectedServerId) {
          toRemove.push(ruid);
        }
      }
      for (var ti = 0; ti < toRemove.length; ti++) {
        delete remoteOnlineUsers[toRemove[ti]];
        broadcast({ type: 'remote_user_offline', user_id: toRemove[ti] }, null, true);
      }
    }
  });

  ws.on('error', function() {});
}

function connectToRelayPeers() {
  if (!relayEnabled) {
    console.log('[Relay] Relay is disabled, skipping connection');
    return;
  }
  if (RELAY_SERVERS.length === 0) return;

  for (var i = 0; i < RELAY_SERVERS.length; i++) {
    (function(rawUrl) {
      var targetUrl = rawUrl;
      var fallbackUrl = null;
      try {
        var urlObj = new URL(rawUrl);
        var urlPort = parseInt(urlObj.port, 10);
        if (urlPort === PORT) {
          urlObj.port = RELAY_PORT;
          targetUrl = urlObj.toString();
          fallbackUrl = rawUrl;
        } else if (urlPort === RELAY_PORT) {
          var fallbackObj = new URL(rawUrl);
          fallbackObj.port = PORT + '';
          fallbackObj.pathname = '/relay';
          fallbackUrl = fallbackObj.toString();
        }
      } catch (e) {}

      var reconnectAttempts = 0;
      var maxReconnectDelay = 60000;
      var lastConnectTime = 0;
      var relayHeartbeat = null;
      var lastErrorTime = 0;
      var peerState = 'disconnected';
      var connectUrl = targetUrl;
      var triedFallback = false;
      var authSucceeded = false;

      function connect() {
        var now = Date.now();
        if (now - lastConnectTime < 1000) {
          setTimeout(connect, 1000 - (now - lastConnectTime));
          return;
        }
        lastConnectTime = now;
        authSucceeded = false;
        peerState = 'connecting';
        console.log('[Relay] Connecting to:', connectUrl, '(attempt', reconnectAttempts + 1, ')');
        var relayWs;
        try {
          relayWs = new WebSocket(connectUrl);
        } catch (e) {
          console.error('[Relay] Failed to create WebSocket:', e.message);
          peerState = 'error';
          scheduleReconnect();
          return;
        }

        var authTimeout = setTimeout(function() {
          try { relayWs.close(); } catch (e) {}
          console.warn('[Relay] Auth timeout for:', targetUrl);
        }, 15000);

        relayWs.on('open', function() {
          reconnectAttempts = 0;
          peerState = 'authenticating';
          relayWs.send(JSON.stringify({
            type: 'relay_auth',
            secret: RELAY_SECRET,
            server_id: RELAY_SERVER_ID
          }));
        });

        relayWs.on('message', function(rawMessage) {
          if (rawMessage.length > 10 * 1024 * 1024) {
            console.error('[Relay] Client dropping oversized message:', Math.round(rawMessage.length / 1024 / 1024), 'MB');
            return;
          }
          var data;
          try { data = JSON.parse(rawMessage); } catch (e) { return; }

          if (data.type === 'relay_auth_ok') {
            clearTimeout(authTimeout);
            authSucceeded = true;
            peerState = 'connected';
            var remoteServerId = data.server_id || 'unknown';
            console.log('[Relay] Outbound auth ok from:', remoteServerId, '- removing existing peers with same ID, current relayPeers count:', relayPeers.length);
            removeRelayPeerByServerId(remoteServerId);
            relayPeers.push({ ws: relayWs, serverId: remoteServerId, connectedAt: Date.now(), state: peerState });
            console.log('[Relay] After outbound push, relayPeers:', relayPeers.map(function(p) { return p.serverId; }).join(','));
            console.log('[Relay] Authenticated with:', remoteServerId);

            var onlineUsersList = [];
            for (var uid in onlineUsers) {
              onlineUsersList.push(onlineUsers[uid]);
            }
            relayWs.send(JSON.stringify({
              type: 'relay_sync',
              server_id: RELAY_SERVER_ID,
              online_users: onlineUsersList
            }));

            var mySyncState = relaySync.getSyncState();
            relayWs.send(JSON.stringify({
              type: 'relay_catchup_request',
              server_id: RELAY_SERVER_ID,
              sync_state: mySyncState
            }));
            console.log('[Relay] Sent catchup request to', remoteServerId, 'my state:', JSON.stringify(mySyncState));

            relayWs.isAlive = true;
            relayHeartbeat = setInterval(function() {
              if (relayWs.readyState === WebSocket.OPEN) {
                if (relayWs.isAlive === false) {
                  console.warn('[Relay] Heartbeat timeout, terminating connection to', targetUrl);
                  relayWs.terminate();
                  return;
                }
                relayWs.isAlive = false;
                try { relayWs.send(JSON.stringify({ type: 'relay_ping' })); } catch (e) {}
              }
            }, 30000);

            return;
          }

          if (data.type === 'relay_message') {
            try {
              processRelayedMessage(data);
            } catch (e) {
              console.error('[Relay] Error processing relay message:', e.message);
            }
          }

          if (data.type === 'relay_sync') {
            try {
              var syncUsers = data.online_users || [];
              var addedCount = 0;
              for (var si = 0; si < syncUsers.length; si++) {
                if (!onlineUsers[syncUsers[si].user_id]) {
                  syncUsers[si].remote = true;
                  syncUsers[si].server_id = data.server_id;
                  remoteOnlineUsers[syncUsers[si].user_id] = syncUsers[si];
                  addedCount++;
                }
              }
              if (addedCount > 0) {
                broadcast({ type: 'remote_users_sync', remote_users: remoteOnlineUsers }, null, true);
              }
              console.log('[Relay] Synced', addedCount, '/', syncUsers.length, 'users from', data.server_id);
            } catch (e) { console.error('[Relay] Error handling relay_sync:', e.message); }
          }

          if (data.type === 'relay_catchup_request') {
            try {
              if (crashLogger.isMemoryPressure()) {
                console.warn('[Relay] Skipping catchup request (client) - memory pressure:', JSON.stringify(crashLogger.getMemoryMB()));
                relayWs.send(JSON.stringify({
                  type: 'relay_catchup_response',
                  server_id: RELAY_SERVER_ID,
                  sync_state: relaySync.getSyncState(),
                  data: { has_more: { overall: false }, next_state: {} }
                }));
                return;
              }
              var remoteState = data.sync_state || {};
              console.log('[Relay] Received catchup request from', data.server_id);
              var catchupData = relaySync.buildCatchupResponse(remoteState);
              var myState = relaySync.getSyncState();
              var response = JSON.stringify({
                type: 'relay_catchup_response',
                server_id: RELAY_SERVER_ID,
                sync_state: myState,
                data: catchupData
              });
              if (response.length > 5 * 1024 * 1024) {
                console.error('[Relay] Catchup response too large:', Math.round(response.length / 1024 / 1024), 'MB - truncating');
                var cliTruncData = {};
                var cliDataKeys = Object.keys(catchupData);
                for (var cdi = 0; cdi < cliDataKeys.length; cdi++) {
                  if (Array.isArray(catchupData[cliDataKeys[cdi]]) && cliDataKeys[cdi] !== 'has_more') {
                    cliTruncData[cliDataKeys[cdi]] = catchupData[cliDataKeys[cdi]].slice(0, 100);
                  } else if (cliDataKeys[cdi] !== 'next_state' && cliDataKeys[cdi] !== 'has_more') {
                    cliTruncData[cliDataKeys[cdi]] = catchupData[cliDataKeys[cdi]];
                  }
                }
                cliTruncData.has_more = {};
                var cliTruncTypes = ['chat_messages', 'private_messages', 'group_messages', 'posts', 'comments', 'likes', 'reactions', 'bookmarks', 'exp_logs', 'broadcasts', 'users', 'user_experience', 'user_settings'];
                for (var cti = 0; cti < cliTruncTypes.length; cti++) {
                  var ctt = cliTruncTypes[cti];
                  if (Array.isArray(cliTruncData[ctt]) && (cliTruncData[ctt].length >= 100 || (catchupData.has_more && catchupData.has_more[ctt]))) {
                    cliTruncData.has_more[ctt] = true;
                  } else {
                    cliTruncData.has_more[ctt] = false;
                  }
                }
                cliTruncData.has_more.overall = true;
                cliTruncData.next_state = {};
                if (cliTruncData.chat_messages && cliTruncData.chat_messages.length > 0) cliTruncData.next_state.last_chat_id = cliTruncData.chat_messages[cliTruncData.chat_messages.length - 1].id;
                if (cliTruncData.private_messages && cliTruncData.private_messages.length > 0) cliTruncData.next_state.last_pm_id = cliTruncData.private_messages[cliTruncData.private_messages.length - 1].id;
                if (cliTruncData.group_messages && cliTruncData.group_messages.length > 0) cliTruncData.next_state.last_gm_id = cliTruncData.group_messages[cliTruncData.group_messages.length - 1].id;
                if (cliTruncData.posts && cliTruncData.posts.length > 0) cliTruncData.next_state.last_post_id = cliTruncData.posts[cliTruncData.posts.length - 1].id;
                if (cliTruncData.comments && cliTruncData.comments.length > 0) cliTruncData.next_state.last_comment_id = cliTruncData.comments[cliTruncData.comments.length - 1].id;
                if (cliTruncData.reactions && cliTruncData.reactions.length > 0) cliTruncData.next_state.last_reaction_id = cliTruncData.reactions[cliTruncData.reactions.length - 1].id;
                if (cliTruncData.bookmarks && cliTruncData.bookmarks.length > 0) cliTruncData.next_state.last_bookmark_id = cliTruncData.bookmarks[cliTruncData.bookmarks.length - 1].id;
                if (cliTruncData.likes && cliTruncData.likes.length > 0) cliTruncData.next_state.last_like_id = cliTruncData.likes[cliTruncData.likes.length - 1].id;
                if (cliTruncData.exp_logs && cliTruncData.exp_logs.length > 0) cliTruncData.next_state.last_exp_log_id = cliTruncData.exp_logs[cliTruncData.exp_logs.length - 1].id;
                if (cliTruncData.broadcasts && cliTruncData.broadcasts.length > 0) cliTruncData.next_state.last_broadcast_id = cliTruncData.broadcasts[cliTruncData.broadcasts.length - 1].id;
                if (cliTruncData.users && cliTruncData.users.length > 0) cliTruncData.next_state.last_user_sync_time = cliTruncData.users[cliTruncData.users.length - 1].created_at || null;
                if (cliTruncData.user_experience && cliTruncData.user_experience.length > 0) cliTruncData.next_state.last_exp_user_id = cliTruncData.user_experience[cliTruncData.user_experience.length - 1].user_id;
                if (cliTruncData.user_settings && cliTruncData.user_settings.length > 0) cliTruncData.next_state.last_settings_user_id = cliTruncData.user_settings[cliTruncData.user_settings.length - 1].user_id;
                response = JSON.stringify({
                  type: 'relay_catchup_response',
                  server_id: RELAY_SERVER_ID,
                  sync_state: myState,
                  data: cliTruncData
                });
              }
              relayWs.send(response);
              console.log('[Relay] Sent catchup response to', data.server_id, '- size:', Math.round(response.length / 1024), 'KB');
            } catch (e) { console.error('[Relay] Error handling catchup request:', e.message); }
          }

          if (data.type === 'relay_catchup_response') {
            var syncData = data.data || {};
            var remoteSyncState = data.sync_state || {};
            var hasMore = (syncData.has_more && syncData.has_more.overall) || false;
            var nextState = syncData.next_state || {};
            console.log('[Relay] Received catchup response from', data.server_id, 'has_more:', hasMore);
            if (crashLogger.isMemoryPressure()) {
              console.warn('[Relay] Skipping catchup apply (client) - memory pressure:', JSON.stringify(crashLogger.getMemoryMB()));
              return;
            }
            try {
              var syncResult = relaySync.applySyncData(syncData);
              console.log('[Relay] Applied sync data from', data.server_id, ':', JSON.stringify(syncResult));

              if (hasMore && nextState) {
                var batchState = Object.assign({}, remoteSyncState);
                if (nextState.last_chat_id) batchState.last_chat_id = Math.max(batchState.last_chat_id || 0, nextState.last_chat_id);
                if (nextState.last_pm_id) batchState.last_pm_id = Math.max(batchState.last_pm_id || 0, nextState.last_pm_id);
                if (nextState.last_gm_id) batchState.last_gm_id = Math.max(batchState.last_gm_id || 0, nextState.last_gm_id);
                if (nextState.last_post_id) batchState.last_post_id = Math.max(batchState.last_post_id || 0, nextState.last_post_id);
                if (nextState.last_comment_id) batchState.last_comment_id = Math.max(batchState.last_comment_id || 0, nextState.last_comment_id);
                if (nextState.last_reaction_id) batchState.last_reaction_id = Math.max(batchState.last_reaction_id || 0, nextState.last_reaction_id);
                if (nextState.last_bookmark_id) batchState.last_bookmark_id = Math.max(batchState.last_bookmark_id || 0, nextState.last_bookmark_id);
                if (nextState.last_like_id) batchState.last_like_id = Math.max(batchState.last_like_id || 0, nextState.last_like_id);
                if (nextState.last_exp_log_id) batchState.last_exp_log_id = Math.max(batchState.last_exp_log_id || 0, nextState.last_exp_log_id);
                if (nextState.last_broadcast_id) batchState.last_broadcast_id = Math.max(batchState.last_broadcast_id || 0, nextState.last_broadcast_id);
                if (nextState.last_user_sync_time) batchState.last_user_sync_time = nextState.last_user_sync_time;
                if (nextState.last_exp_user_id) batchState.last_exp_user_id = nextState.last_exp_user_id;
                if (nextState.last_settings_user_id) batchState.last_settings_user_id = nextState.last_settings_user_id;
                if (nextState.last_group_time) batchState.last_group_time = nextState.last_group_time;
                if (nextState.last_tombstone_time) batchState.last_tombstone_time = nextState.last_tombstone_time;
                setTimeout(function() {
                  try {
                    if (relayWs.readyState === WebSocket.OPEN) {
                      relayWs.send(JSON.stringify({
                        type: 'relay_catchup_request',
                        server_id: RELAY_SERVER_ID,
                        sync_state: batchState
                      }));
                      console.log('[Relay] Sent next batch catchup request to', data.server_id);
                    }
                  } catch (e) {}
                }, 500);
              } else {
                if (remoteSyncState.last_chat_id > 0 || remoteSyncState.last_pm_id > 0 || remoteSyncState.last_gm_id > 0) {
                  var myState = relaySync.getSyncState();
                  var needReverseCatchup = false;
                  if (myState.last_chat_id > (remoteSyncState.last_chat_id || 0)) needReverseCatchup = true;
                  if (myState.last_pm_id > (remoteSyncState.last_pm_id || 0)) needReverseCatchup = true;
                  if (myState.last_gm_id > (remoteSyncState.last_gm_id || 0)) needReverseCatchup = true;
                  if (myState.last_post_id > (remoteSyncState.last_post_id || 0)) needReverseCatchup = true;

                  if (needReverseCatchup) {
                    var reverseCatchupData = relaySync.buildCatchupResponse(remoteSyncState);
                    var reverseResponse = JSON.stringify({
                      type: 'relay_catchup_response',
                      server_id: RELAY_SERVER_ID,
                      sync_state: myState,
                      data: reverseCatchupData
                    });
                    if (reverseResponse.length > 5 * 1024 * 1024) {
                      console.error('[Relay] Reverse catchup too large, skipping');
                    } else {
                      relayWs.send(reverseResponse);
                      console.log('[Relay] Sent reverse catchup to', data.server_id);
                    }
                  }
                }
              }
            } catch (e) {
              console.error('[Relay] Error applying sync data:', e.message);
            }
          }

          if (data.type === 'relay_pong') {
            relayWs.isAlive = true;
          }
        });

        relayWs.on('close', function(code, reason) {
          clearTimeout(authTimeout);
          clearInterval(relayHeartbeat);
          peerState = 'disconnected';
          for (var j = 0; j < relayPeers.length; j++) {
            if (relayPeers[j].ws === relayWs) {
              relayPeers.splice(j, 1);
              break;
            }
          }
          var logClose = code !== 1005 || !lastConnectTime || (Date.now() - lastConnectTime > 60000);
          if (logClose) {
            console.warn('[Relay] Connection closed to', connectUrl, 'code:', code, 'reason:', reason || 'none');
          }
          if (!authSucceeded && !triedFallback && fallbackUrl) {
            triedFallback = true;
            connectUrl = fallbackUrl;
            console.log('[Relay] Trying fallback URL:', fallbackUrl);
            setTimeout(connect, 1000);
          } else {
            scheduleReconnect();
          }
        });

        relayWs.on('error', function(err) {
          lastErrorTime = Date.now();
          peerState = 'error';
          console.error('[Relay] Connection error to', connectUrl, ':', err ? err.message : 'unknown');
        });
      }

      function scheduleReconnect() {
        reconnectAttempts++;
        connectUrl = targetUrl;
        triedFallback = false;
        var delay = Math.min(3000 * reconnectAttempts, maxReconnectDelay);
        var jitter = Math.floor(Math.random() * 1000);
        console.log('[Relay] Reconnecting to', targetUrl, 'in', delay + jitter, 'ms (attempt', reconnectAttempts, ')');
        setTimeout(connect, delay + jitter);
      }

      connect();
    })(RELAY_SERVERS[i].trim());
  }
}

// ===== Message handlers =====

function handleConnect(ws, data) {
  var userId = data.user_id;
  var token = data.token;

  if (!userId || !token) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少 user_id 或 token' }));
    return;
  }

  var result = jwtUtil.verifyToken(token);
  if (!result.valid) {
    ws.send(JSON.stringify({ type: 'error', message: 'Token 验证失败' }));
    return;
  }

  var decoded = result.data;
  if (decoded.user_id !== data.user_id) {
    ws.send(JSON.stringify({ type: 'error', message: '用户身份验证失败' }));
    return;
  }

  // If this user already has a connection, close the old one
  if (clients[userId] && clients[userId].readyState === WebSocket.OPEN) {
    try {
      clients[userId]._replaced = true;
      clients[userId].close();
    } catch (e) {
    }
  }

  // Register client
  clients[userId] = ws;
  ws.userId = userId;

  // Load user info from database
  var userRow = stmtGetUserInfo.get(userId);
  var userInfo;
  if (userRow) {
    userInfo = {
      user_id: userRow.user_id,
      net_name: userRow.net_name,
      real_name: userRow.real_name,
      gender: userRow.gender,
      status: 'online'
    };
  } else {
    userInfo = {
      user_id: userId,
      net_name: userId,
      real_name: userId,
      gender: '',
      status: 'online'
    };
  }

  onlineUsers[userId] = userInfo;

  ensureUserInClassGroups(userId);

  // Load last 50 public chat messages
  var history = [];
  try {
    var rows = stmtGetChatHistory.all('public', 50);
    for (var i = rows.length - 1; i >= 0; i--) {
      var extraData = {};
      try { extraData = JSON.parse(rows[i].extra_json || '{}'); } catch (e) {}
      history.push({
        id: rows[i].id,
        type: rows[i].type,
        content: rows[i].content,
        sender_id: rows[i].sender_id,
        sender_name: rows[i].sender_name,
        reply_to: extraData.reply_to || null,
        created_at: time.toISOString(rows[i].created_at)
      });
    }
  } catch (e) {
    // ignore db errors for history
  }

  // Load user's groups
  var userGroups = [];
  try {
    var allGroups = stmtGetUserGroups.all();
    for (var g = 0; g < allGroups.length; g++) {
      if (!canUserSeeGroup(userId, allGroups[g].id)) continue;
      var groupMembers = parseMembersJson(allGroups[g].members_json);
      if (groupMembers.indexOf(userId) !== -1) {
        var isClassGroup = CLASS_GROUP_IDS.indexOf(allGroups[g].id) !== -1;
        userGroups.push({
          group_id: allGroups[g].id,
          group_name: allGroups[g].name,
          creator_id: allGroups[g].creator_id,
          member_count: groupMembers.length,
          members: groupMembers,
          announcement: allGroups[g].announcement || '',
          announcement_at: allGroups[g].announcement_at ? time.toISOString(allGroups[g].announcement_at) : null,
          created_at: time.toISOString(allGroups[g].created_at),
          is_class_group: isClassGroup
        });
      }
    }
  } catch (e) {
    // ignore db errors for groups
  }

  // Send welcome
  var onlineUsersList = [];
  var onlineUserIds = Object.keys(onlineUsers);
  for (var oui = 0; oui < onlineUserIds.length; oui++) {
    onlineUsersList.push(onlineUsers[onlineUserIds[oui]]);
  }
  var remoteUsersList = [];
  var remoteUserIds = Object.keys(remoteOnlineUsers);
  for (var rui = 0; rui < remoteUserIds.length; rui++) {
    remoteUsersList.push(remoteOnlineUsers[remoteUserIds[rui]]);
  }

  ws.send(JSON.stringify({
    type: 'connected',
    user_id: userId,
    users: onlineUsersList,
    remote_users: remoteUsersList,
    history: history,
    groups: userGroups
  }));

  // Broadcast user online
  relayBus.emit('user_online', { user_id: userId, user_info: userInfo }, userId);
}

function handleTextMessage(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  if (!checkWsRateLimit(userId, 30, 60000)) {
    ws.send(JSON.stringify({ type: 'error', message: '发送过于频繁，请稍后再试' }));
    return;
  }

  var content = data.content;
  if (!content || typeof content !== 'string' || content.trim() === '') {
    ws.send(JSON.stringify({ type: 'error', message: '消息内容不能为空' }));
    return;
  }
  if (isDuplicateClientMsg(userId, content)) {
    return;
  }
  trackClientMsg(userId, content);

  var userInfo = onlineUsers[userId] || {};
  var senderName = userInfo.net_name || userInfo.real_name || userId;

  var msgType = data.msg_type || 'text';
  if (msgType !== 'text' && msgType !== 'community_forward' && msgType !== 'music_playlist' && msgType !== 'ai_forward' && msgType !== 'ai_batch') {
    msgType = 'text';
  }

  var extraJson = '{}';
  if (data.reply_to) {
    extraJson = JSON.stringify({ reply_to: data.reply_to });
  }

  var result = stmtInsertChatMessage.run('public', userId, senderName, content, msgType, extraJson);

  var msgExtraObj = {};
  try { msgExtraObj = JSON.parse(extraJson); } catch (e3) {}
  msgExtraObj.original_id = result.lastInsertRowid;
  db.prepare('UPDATE chat_messages SET extra_json = ? WHERE id = ?').run(JSON.stringify(msgExtraObj), result.lastInsertRowid);

  relaySync.updateWatermark('chat_messages', result.lastInsertRowid);

  var messageObj = {
    id: result.lastInsertRowid,
    type: msgType,
    content: content,
    sender_id: userId,
    sender_name: senderName,
    reply_to: data.reply_to || null,
    temp_id: data.temp_id || null,
    created_at: time.nowISO()
  };

  relayBus.emit('new_message', { message: Object.assign({}, messageObj, { temp_id: undefined }), temp_id: data.temp_id || null }, userId);

  sendToClient(userId, {
    type: 'message_sent',
    message_id: result.lastInsertRowid,
    temp_id: data.temp_id || null,
    success: true
  });

  try { exp.addExp(userId, 'send_message'); } catch (e) {}
}

function handleEmojiMessage(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var content = data.content;
  if (!content || typeof content !== 'string' || content.trim() === '') {
    ws.send(JSON.stringify({ type: 'error', message: '表情内容不能为空' }));
    return;
  }
  if (isDuplicateClientMsg(userId, content)) {
    return;
  }
  trackClientMsg(userId, content);

  var userInfo = onlineUsers[userId] || {};
  var senderName = userInfo.net_name || userInfo.real_name || userId;

  var result = stmtInsertChatMessage.run('public', userId, senderName, content, 'emoji', '{}');

  var emojiExtraObj = {};
  emojiExtraObj.original_id = result.lastInsertRowid;
  db.prepare('UPDATE chat_messages SET extra_json = ? WHERE id = ?').run(JSON.stringify(emojiExtraObj), result.lastInsertRowid);

  relaySync.updateWatermark('chat_messages', result.lastInsertRowid);

  var emojiMsg = {
    id: result.lastInsertRowid,
    type: 'emoji',
    content: content,
    sender_id: userId,
    sender_name: senderName,
    reply_to: null,
    temp_id: data.temp_id || null,
    created_at: time.nowISO()
  };

  relayBus.emit('new_message', { message: emojiMsg, temp_id: data.temp_id || null }, userId);

  sendToClient(userId, {
    type: 'message_sent',
    message_id: result.lastInsertRowid,
    temp_id: data.temp_id || null,
    success: true
  });
}

function handlePrivateMessage(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  if (!checkWsRateLimit(userId, 30, 60000)) {
    ws.send(JSON.stringify({ type: 'error', message: '发送过于频繁，请稍后再试' }));
    return;
  }

  var targetUserId = data.target_user_id;
  var content = data.content;

  if (!targetUserId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少目标用户ID' }));
    return;
  }
  if (!content || typeof content !== 'string' || content.trim() === '') {
    ws.send(JSON.stringify({ type: 'error', message: '消息内容不能为空' }));
    return;
  }
  if (isDuplicateClientMsg(userId, targetUserId + ':' + content)) {
    return;
  }
  trackClientMsg(userId, targetUserId + ':' + content);

  var msgType = data.msg_type || 'text';
  if (msgType !== 'text' && msgType !== 'community_forward' && msgType !== 'music_playlist' && msgType !== 'ai_forward' && msgType !== 'ai_batch') {
    msgType = 'text';
  }

  var extraJson = '{}';
  if (data.reply_to) {
    extraJson = JSON.stringify({ reply_to: data.reply_to });
  }

  var result = stmtInsertPrivateMessage.run(userId, targetUserId, content, msgType, extraJson);

  var pmExtraObj = {};
  try { pmExtraObj = JSON.parse(extraJson || '{}'); } catch (e3) {}
  pmExtraObj.original_id = result.lastInsertRowid;
  db.prepare('UPDATE private_messages SET extra_json = ? WHERE id = ?').run(JSON.stringify(pmExtraObj), result.lastInsertRowid);

  relaySync.updateWatermark('private_messages', result.lastInsertRowid);

  var senderInfo = onlineUsers[userId] || {};
  var senderName = senderInfo.net_name || senderInfo.real_name || userId;

  var messageObj = {
    id: result.lastInsertRowid,
    type: msgType,
    content: content,
    sender_id: userId,
    sender_name: senderName,
    from_user_id: userId,
    to_user_id: targetUserId,
    reply_to: data.reply_to || null,
    temp_id: data.temp_id || null,
    created_at: time.nowISO()
  };

  sendToClient(targetUserId, {
    type: 'private_message',
    from_user_id: userId,
    temp_id: data.temp_id || null,
    message: messageObj
  });

  sendToClient(userId, {
    type: 'private_message_sent',
    message_id: result.lastInsertRowid,
    temp_id: data.temp_id || null,
    target_user_id: targetUserId,
    success: true
  });

  relayBus.relayOnly('private_message', {
    from_user_id: userId,
    to_user_id: targetUserId,
    message: Object.assign({}, messageObj, { temp_id: undefined })
  });

  try { exp.addExp(userId, 'send_message'); } catch (e) {}
}

function handleGetPrivateHistory(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var targetUserId = data.target_user_id;
  if (!targetUserId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少目标用户ID' }));
    return;
  }

  var rows = stmtGetPrivateHistory.all(userId, targetUserId, targetUserId, userId, 50);
  var messages = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var extraData = {};
    try { extraData = JSON.parse(rows[i].extra_json || '{}'); } catch (e) {}
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

  ws.send(JSON.stringify({
    type: 'private_message_history',
    target_user_id: targetUserId,
    messages: messages
  }));
}

function handleCreateGroup(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var groupName = data.group_name;
  var memberIds = data.member_ids;

  if (!groupName || typeof groupName !== 'string' || groupName.trim() === '') {
    ws.send(JSON.stringify({ type: 'error', message: '群组名称不能为空' }));
    return;
  }
  if (!memberIds || !Array.isArray(memberIds)) {
    ws.send(JSON.stringify({ type: 'error', message: '成员列表无效' }));
    return;
  }

  var groupId = 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

  // Include creator in members
  var allMembers = [userId];
  for (var i = 0; i < memberIds.length; i++) {
    if (allMembers.indexOf(memberIds[i]) === -1) {
      allMembers.push(memberIds[i]);
    }
  }

  if (allMembers.length < 2) {
    ws.send(JSON.stringify({ type: 'error', message: '请至少选择1名群成员' }));
    return;
  }

  var membersJson = JSON.stringify(allMembers);

  try {
    stmtInsertGroup.run(groupId, groupName, userId, membersJson);
    relaySync.updateGroupWatermark();
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', message: '创建群组失败' }));
    return;
  }

  // Notify all members
  for (var j = 0; j < allMembers.length; j++) {
    sendToClient(allMembers[j], {
      type: 'group_created',
      group_id: groupId,
      group_name: groupName,
      success: true
    });
  }

  relayBus.relayOnly('group_created', {
    group_id: groupId, group_name: groupName, creator_id: userId, member_ids: allMembers
  });
}

function handleGroupMessage(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  if (!checkWsRateLimit(userId, 30, 60000)) {
    ws.send(JSON.stringify({ type: 'error', message: '发送过于频繁，请稍后再试' }));
    return;
  }

  var groupId = data.group_id;
  var content = data.content;

  if (!groupId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
    return;
  }
  if (!content || typeof content !== 'string' || content.trim() === '') {
    ws.send(JSON.stringify({ type: 'error', message: '消息内容不能为空' }));
    return;
  }
  if (isDuplicateClientMsg(userId, groupId + ':' + content)) {
    return;
  }
  trackClientMsg(userId, groupId + ':' + content);

  var group = stmtGetGroup.get(groupId);
  if (!group) {
    ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
    return;
  }

  if (!canUserSeeGroup(userId, groupId)) {
    ws.send(JSON.stringify({ type: 'error', message: '无权访问该群组' }));
    return;
  }

  var members = parseMembersJson(group.members_json);
  if (members.indexOf(userId) === -1) {
    ws.send(JSON.stringify({ type: 'error', message: '你不是该群组成员' }));
    return;
  }

  var userInfo = onlineUsers[userId] || {};
  var senderName = userInfo.net_name || userInfo.real_name || userId;

  var msgType = data.msg_type || 'text';
  if (msgType !== 'text' && msgType !== 'community_forward' && msgType !== 'music_playlist' && msgType !== 'ai_forward' && msgType !== 'ai_batch') {
    msgType = 'text';
  }

  var extraJson = '{}';
  if (data.reply_to) {
    extraJson = JSON.stringify({ reply_to: data.reply_to });
  }

  var result = stmtInsertGroupMessage.run(groupId, userId, senderName, content, msgType, extraJson);

  var gmExtraObj = {};
  try { gmExtraObj = JSON.parse(extraJson || '{}'); } catch (e3) {}
  gmExtraObj.original_id = result.lastInsertRowid;
  db.prepare('UPDATE group_messages SET extra_json = ? WHERE id = ?').run(JSON.stringify(gmExtraObj), result.lastInsertRowid);

  relaySync.updateWatermark('group_messages', result.lastInsertRowid);

  var messageObj = {
    id: result.lastInsertRowid,
    type: msgType,
    content: content,
    sender_id: userId,
    sender_name: senderName,
    reply_to: data.reply_to || null,
    temp_id: data.temp_id || null,
    recalled: 0,
    created_at: time.nowISO()
  };

  for (var i = 0; i < members.length; i++) {
    if (members[i] === userId) continue;
    sendToClient(members[i], {
      type: 'group_message',
      group_id: groupId,
      temp_id: data.temp_id || null,
      message: messageObj
    });
  }
  sendToClient(userId, {
    type: 'group_message_sent',
    group_id: groupId,
    message_id: result.lastInsertRowid,
    temp_id: data.temp_id || null,
    success: true
  });

  relayBus.relayOnly('group_message', {
    group_id: groupId, member_ids: members, message: Object.assign({}, messageObj, { temp_id: undefined })
  });

  try { exp.addExp(userId, 'send_message'); } catch (e) {}
}

function handleJoinGroup(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var groupId = data.group_id;
  if (!groupId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
    return;
  }

  var group = stmtGetGroup.get(groupId);
  if (!group) {
    ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
    return;
  }

  var members = parseMembersJson(group.members_json);
  if (members.indexOf(userId) !== -1) {
    ws.send(JSON.stringify({ type: 'error', message: '你已经是该群组成员' }));
    return;
  }

  members.push(userId);
  stmtUpdateGroupMembers.run(JSON.stringify(members), groupId);
  relaySync.updateGroupWatermark();

  for (var i = 0; i < members.length; i++) {
    sendToClient(members[i], {
      type: 'group_member_joined',
      group_id: groupId,
      user_id: userId
    });
  }

  relayBus.relayOnly('group_member_joined', {
    group_id: groupId, user_id: userId
  });
}

function handleLeaveGroup(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var groupId = data.group_id;
  if (!groupId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
    return;
  }

  if (CLASS_GROUP_IDS.indexOf(groupId) !== -1) {
    ws.send(JSON.stringify({ type: 'error', message: '班级群不可退出' }));
    return;
  }

  var group = stmtGetGroup.get(groupId);
  if (!group) {
    ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
    return;
  }

  // Creator cannot leave
  if (group.creator_id === userId) {
    ws.send(JSON.stringify({ type: 'error', message: '群主请先转让群聊或解散群聊' }));
    return;
  }

  var members = parseMembersJson(group.members_json);
  var idx = members.indexOf(userId);
  if (idx === -1) {
    ws.send(JSON.stringify({ type: 'error', message: '你不是该群组成员' }));
    return;
  }

  members.splice(idx, 1);
  stmtUpdateGroupMembers.run(JSON.stringify(members), groupId);
  relaySync.updateGroupWatermark();

  var allNotify = members.slice();
  allNotify.push(userId);
  for (var i = 0; i < allNotify.length; i++) {
    sendToClient(allNotify[i], {
      type: 'group_member_left',
      group_id: groupId,
      user_id: userId
    });
  }

  relayBus.relayOnly('group_member_left', {
    group_id: groupId, user_id: userId
  });
}

function handleGetGroups(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var allGroups = stmtGetUserGroups.all();
  var userGroups = [];
  for (var i = 0; i < allGroups.length; i++) {
    if (!canUserSeeGroup(userId, allGroups[i].id)) continue;
    var members = parseMembersJson(allGroups[i].members_json);
    if (members.indexOf(userId) !== -1) {
      userGroups.push({
        group_id: allGroups[i].id,
        group_name: allGroups[i].name,
        creator_id: allGroups[i].creator_id,
        member_count: members.length,
        announcement: allGroups[i].announcement || '',
        announcement_at: allGroups[i].announcement_at ? time.toISOString(allGroups[i].announcement_at) : null,
        created_at: time.toISOString(allGroups[i].created_at)
      });
    }
  }

  ws.send(JSON.stringify({
    type: 'groups_list',
    groups: userGroups
  }));
}

function handleGetGroupMembers(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var groupId = data.group_id;
  if (!groupId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
    return;
  }

  var group = stmtGetGroup.get(groupId);
  if (!group) {
    ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
    return;
  }

  var members = parseMembersJson(group.members_json);

  ws.send(JSON.stringify({
    type: 'group_members_list',
    group_id: groupId,
    members: members
  }));
}

function handleLoadMore(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var offset = data.offset || 0;
  var limit = data.limit || 20;

  if (offset < 0) offset = 0;
  if (limit < 1) limit = 1;
  if (limit > 100) limit = 100;

  var rows = stmtGetChatHistoryOffset.all('public', limit, offset);
  var totalRow = stmtCountChatMessages.get('public');
  var total = totalRow.total;

  var messages = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var extraData = {};
    try { extraData = JSON.parse(rows[i].extra_json || '{}'); } catch (e) {}
    messages.push({
      id: rows[i].id,
      type: rows[i].type,
      content: rows[i].content,
      sender_id: rows[i].sender_id,
      sender_name: rows[i].sender_name,
      reply_to: extraData.reply_to || null,
      created_at: time.toISOString(rows[i].created_at)
    });
  }

  var hasMore = (offset + limit) < total;

  ws.send(JSON.stringify({
    type: 'history_messages',
    messages: messages,
    has_more: hasMore
  }));
}

function handleMarkRead(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var targetUserId = data.target_user_id || data.chat_id;
  if (!targetUserId) {
    return;
  }

  var result = stmtMarkPrivateRead.run(targetUserId, userId);

  if (result.changes > 0) {
    sendToClient(targetUserId, {
      type: 'message_read',
      reader_id: userId,
      message_ids: data.message_ids || []
    });
  }

  relayBus.relayOnly('private_message_read', {
    reader_id: userId,
    target_user_id: targetUserId,
    message_ids: data.message_ids || []
  });
}

function handleStatusUpdate(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var status = data.status;
  if (!status || typeof status !== 'string') {
    ws.send(JSON.stringify({ type: 'error', message: '状态无效' }));
    return;
  }

  if (onlineUsers[userId]) {
    onlineUsers[userId].status = status;
  }

  relayBus.emit('user_status_change', { user_id: userId, status: status });
}

function handleTyping(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var isTyping = data.is_typing;
  var userInfo = onlineUsers[userId] || {};
  var userName = userInfo.net_name || userInfo.real_name || userId;

  if (data.group_id) {
    var group = stmtGetGroup.get(data.group_id);
    if (group) {
      var members = parseMembersJson(group.members_json);
      for (var i = 0; i < members.length; i++) {
        if (members[i] !== userId) {
          sendToClient(members[i], {
            type: 'user_typing',
            from_user_id: userId,
            from_user_name: userName,
            group_id: data.group_id,
            is_typing: !!isTyping
          });
        }
      }
      relayBus.relayOnly('user_typing', {
        from_user_id: userId, from_user_name: userName, group_id: data.group_id, is_typing: !!isTyping
      });
    }
  } else if (data.target_user_id) {
    sendToClient(data.target_user_id, {
      type: 'user_typing',
      from_user_id: userId,
      from_user_name: userName,
      is_typing: !!isTyping
    });
    relayBus.relayOnly('user_typing', {
      from_user_id: userId, from_user_name: userName, target_user_id: data.target_user_id, is_typing: !!isTyping
    });
  }
}

function handleDissolveGroup(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var groupId = data.group_id;
  if (!groupId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
    return;
  }

  if (CLASS_GROUP_IDS.indexOf(groupId) !== -1) {
    ws.send(JSON.stringify({ type: 'error', message: '班级群不可解散' }));
    return;
  }

  var group = stmtGetGroup.get(groupId);
  if (!group) {
    ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
    return;
  }

  if (group.creator_id !== userId) {
    ws.send(JSON.stringify({ type: 'error', message: '只有群主才能解散群组' }));
    return;
  }

  var members = parseMembersJson(group.members_json);

  stmtDeleteGroupMessages.run(groupId);
  stmtDeleteGroup.run(groupId);
  relaySync.updateGroupWatermark();

  for (var i = 0; i < members.length; i++) {
    sendToClient(members[i], {
      type: 'group_dissolved',
      group_id: groupId
    });
  }

  relayBus.relayOnly('group_dissolved', {
    group_id: groupId, member_ids: members
  });
}

function handleTransferGroup(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var groupId = data.group_id;
  var newOwnerId = data.new_owner_id ? String(data.new_owner_id) : null;
  if (!groupId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
    return;
  }

  if (CLASS_GROUP_IDS.indexOf(groupId) !== -1) {
    ws.send(JSON.stringify({ type: 'error', message: '班级群不可转让' }));
    return;
  }

  if (!newOwnerId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少新群主ID' }));
    return;
  }

  try {
    var group = stmtGetGroup.get(groupId);
    if (!group) {
      ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
      return;
    }

    if (String(group.creator_id) !== String(userId)) {
      ws.send(JSON.stringify({ type: 'error', message: '只有群主才能转让群组' }));
      return;
    }

    var members = parseMembersJson(group.members_json);
    // 确保成员ID统一为字符串进行比较
    var membersStr = members.map(function(m) { return String(m); });
    if (membersStr.indexOf(newOwnerId) === -1) {
      ws.send(JSON.stringify({ type: 'error', message: '新群主不是该群组成员' }));
      return;
    }

    stmtUpdateGroupCreator.run(newOwnerId, groupId);
    relaySync.updateGroupWatermark();

    for (var j = 0; j < members.length; j++) {
      sendToClient(members[j], {
        type: 'group_transferred',
        group_id: groupId,
        old_owner_id: userId,
        new_owner_id: newOwnerId
      });
    }

    relayBus.relayOnly('group_transferred', {
      group_id: groupId, old_owner_id: userId, new_owner_id: newOwnerId
    });

  } catch (e) {
    console.error('[WS] Transfer group error:', e.message);
    ws.send(JSON.stringify({ type: 'error', message: '转让群组失败' }));
  }
}

function handleInviteToGroup(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var groupId = data.group_id;
  var inviteUserid = data.invite_user_id;
  if (!groupId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
    return;
  }
  if (!inviteUserid) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少被邀请用户ID' }));
    return;
  }

  if (CLASS_GROUP_IDS.indexOf(groupId) !== -1) {
    ws.send(JSON.stringify({ type: 'error', message: '班级群不可邀请成员' }));
    return;
  }

  var group = stmtGetGroup.get(groupId);
  if (!group) {
    ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
    return;
  }

  var members = parseMembersJson(group.members_json);
  if (members.indexOf(userId) === -1) {
    ws.send(JSON.stringify({ type: 'error', message: '你不是该群组成员' }));
    return;
  }

  if (members.indexOf(inviteUserid) !== -1) {
    ws.send(JSON.stringify({ type: 'error', message: '该用户已是群组成员' }));
    return;
  }

  members.push(inviteUserid);
  stmtUpdateGroupMembers.run(JSON.stringify(members), groupId);
  relaySync.updateGroupWatermark();

  for (var i = 0; i < members.length; i++) {
    if (members[i] !== inviteUserid) {
      sendToClient(members[i], {
        type: 'group_member_joined',
        group_id: groupId,
        user_id: inviteUserid,
        user_name: (onlineUsers[inviteUserid] || {}).net_name || inviteUserid,
        invited_by: userId
      });
    }
  }

  sendToClient(inviteUserid, {
    type: 'group_member_joined',
    group_id: groupId,
    user_id: inviteUserid,
    user_name: (onlineUsers[inviteUserid] || {}).net_name || inviteUserid,
    invited_by: userId,
    group_name: group.name
  });

  relayBus.relayOnly('group_member_joined', {
    group_id: groupId, user_id: inviteUserid, invited_by: userId, group_name: group.name
  });
}

function handleSetAnnouncement(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var groupId = data.group_id;
  var announcement = data.announcement;
  if (!groupId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
    return;
  }

  var group = stmtGetGroup.get(groupId);
  if (!group) {
    ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
    return;
  }

  if (group.creator_id !== userId) {
    ws.send(JSON.stringify({ type: 'error', message: '只有群主才能设置公告' }));
    return;
  }

  if (!announcement || typeof announcement !== 'string' || announcement.trim() === '') {
    ws.send(JSON.stringify({ type: 'error', message: '公告内容不能为空' }));
    return;
  }
  if (announcement.length > 500) {
    ws.send(JSON.stringify({ type: 'error', message: '公告内容不能超过500字符' }));
    return;
  }

  stmtUpdateGroupAnnouncement.run(announcement, groupId);
  relaySync.updateGroupWatermark();

  var updatedGroup = stmtGetGroup.get(groupId);
  var announcementAt = updatedGroup ? time.toISOString(updatedGroup.announcement_at) : time.nowISO();

  var members = parseMembersJson(group.members_json);
  for (var i = 0; i < members.length; i++) {
    sendToClient(members[i], {
      type: 'group_announcement',
      group_id: groupId,
      announcement: announcement,
      announced_by: userId,
      announcement_at: announcementAt
    });
  }

  relayBus.relayOnly('group_announcement', {
    group_id: groupId, announcement: announcement, announced_by: userId, announcement_at: announcementAt
  });
}

function handleKickMember(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var groupId = data.group_id;
  var targetUserId = data.target_user_id;
  if (!groupId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
    return;
  }

  if (CLASS_GROUP_IDS.indexOf(groupId) !== -1) {
    ws.send(JSON.stringify({ type: 'error', message: '班级群不可踢人' }));
    return;
  }

  if (!targetUserId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少目标用户ID' }));
    return;
  }

  var group = stmtGetGroup.get(groupId);
  if (!group) {
    ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
    return;
  }

  if (group.creator_id !== userId) {
    ws.send(JSON.stringify({ type: 'error', message: '只有群主才能移出成员' }));
    return;
  }

  if (targetUserId === userId) {
    ws.send(JSON.stringify({ type: 'error', message: '不能移出自己' }));
    return;
  }

  var members = parseMembersJson(group.members_json);
  var idx = members.indexOf(targetUserId);
  if (idx === -1) {
    ws.send(JSON.stringify({ type: 'error', message: '该用户不是群组成员' }));
    return;
  }

  members.splice(idx, 1);
  stmtUpdateGroupMembers.run(JSON.stringify(members), groupId);
  relaySync.updateGroupWatermark();

  for (var i = 0; i < members.length; i++) {
    sendToClient(members[i], {
      type: 'group_member_kicked',
      group_id: groupId,
      user_id: targetUserId,
      kicked_by: userId
    });
  }

  sendToClient(targetUserId, {
    type: 'group_member_left',
    group_id: groupId,
    user_id: targetUserId
  });

  relayBus.relayOnly('group_member_kicked', {
    group_id: groupId, user_id: targetUserId, kicked_by: userId
  });
}

function handleRenameGroup(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var groupId = data.group_id;
  var newName = data.new_name;
  if (!groupId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
    return;
  }
  if (!newName || typeof newName !== 'string' || newName.trim() === '') {
    ws.send(JSON.stringify({ type: 'error', message: '群组名称不能为空' }));
    return;
  }
  if (newName.length > 30) {
    ws.send(JSON.stringify({ type: 'error', message: '群组名称不能超过30个字符' }));
    return;
  }

  if (CLASS_GROUP_IDS.indexOf(groupId) !== -1) {
    ws.send(JSON.stringify({ type: 'error', message: '班级群不可改名' }));
    return;
  }

  var group = stmtGetGroup.get(groupId);
  if (!group) {
    ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
    return;
  }

  if (group.creator_id !== userId) {
    ws.send(JSON.stringify({ type: 'error', message: '只有群主才能修改群名' }));
    return;
  }

  stmtUpdateGroupName.run(newName.trim(), groupId);
  relaySync.updateGroupWatermark();

  var members = parseMembersJson(group.members_json);
  for (var i = 0; i < members.length; i++) {
    sendToClient(members[i], {
      type: 'group_renamed',
      group_id: groupId,
      new_name: newName.trim()
    });
  }

  relayBus.relayOnly('group_renamed', {
    group_id: groupId, new_name: newName.trim()
  });
}

function handleRecallMessage(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var messageType = data.message_type;
  var messageId = data.message_id;
  var groupId = data.group_id;

  if (!messageType) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少消息类型' }));
    return;
  }
  if (!messageId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少消息ID' }));
    return;
  }

  var messageRow;
  if (messageType === 'public') {
    messageRow = stmtGetChatMessage.get(messageId);
  } else if (messageType === 'private') {
    messageRow = stmtGetPrivateMessage.get(messageId);
  } else if (messageType === 'group') {
    messageRow = stmtGetGroupMessage.get(messageId);
  } else {
    ws.send(JSON.stringify({ type: 'error', message: '未知的消息类型' }));
    return;
  }

  if (!messageRow) {
    ws.send(JSON.stringify({ type: 'error', message: '消息不存在' }));
    return;
  }

  if (messageRow.sender_id !== userId) {
    ws.send(JSON.stringify({ type: 'error', message: '只能撤回自己的消息' }));
    return;
  }

  var createdAtStr = messageRow.created_at;
  var createdAtMs = new Date(time.toISOString(createdAtStr)).getTime();
  var nowMs = Date.now();
  if (nowMs - createdAtMs > 120000) {
    ws.send(JSON.stringify({ type: 'error', message: '消息已超过2分钟，无法撤回' }));
    return;
  }

  if (messageType === 'public') {
    stmtRecallChatMessage.run(messageId, userId);
    relayBus.emit('message_recalled', {
      message_type: 'public',
      message_id: messageId,
      original_message_id: messageId,
      sender_id: userId
    });
  } else if (messageType === 'private') {
    stmtRecallPrivateMessage.run(messageId, userId);
    var otherUserId = messageRow.receiver_id || data.target_user_id;
    sendToClient(userId, {
      type: 'message_recalled',
      message_type: 'private',
      chat_id: otherUserId,
      message_id: messageId
    });
    sendToClient(otherUserId, {
      type: 'message_recalled',
      message_type: 'private',
      chat_id: userId,
      message_id: messageId
    });

    relayBus.relayOnly('message_recalled', {
      message_type: 'private', message_id: messageId, original_message_id: messageId,
      sender_id: userId, receiver_id: messageRow.receiver_id || data.target_user_id, chat_id: otherUserId
    });

  } else if (messageType === 'group') {
    if (!groupId) {
      ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
      return;
    }
    var group = stmtGetGroup.get(groupId);
    if (!group) {
      ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
      return;
    }
    var members = parseMembersJson(group.members_json);
    if (members.indexOf(userId) === -1) {
      ws.send(JSON.stringify({ type: 'error', message: '你不是该群组成员' }));
      return;
    }
    stmtRecallGroupMessage.run(messageId, userId);
    for (var i = 0; i < members.length; i++) {
      sendToClient(members[i], {
        type: 'message_recalled',
        message_type: 'group',
        group_id: groupId,
        message_id: messageId
      });
    }

    relayBus.relayOnly('message_recalled', {
      message_type: 'group', message_id: messageId, original_message_id: messageId,
      sender_id: userId, group_id: groupId
    });

  }
}

function handleGetGroupHistory(ws, data) {
  var userId = ws.userId;
  if (!userId) {
    ws.send(JSON.stringify({ type: 'error', message: '未连接' }));
    return;
  }

  var groupId = data.group_id;
  var offset = data.offset || 0;
  var limit = data.limit || 50;

  if (!groupId) {
    ws.send(JSON.stringify({ type: 'error', message: '缺少群组ID' }));
    return;
  }

  if (offset < 0) offset = 0;
  if (limit < 1) limit = 1;
  if (limit > 100) limit = 100;

  var group = stmtGetGroup.get(groupId);
  if (!group) {
    ws.send(JSON.stringify({ type: 'error', message: '群组不存在' }));
    return;
  }

  var members = parseMembersJson(group.members_json);
  if (members.indexOf(userId) === -1) {
    ws.send(JSON.stringify({ type: 'error', message: '你不是该群组成员' }));
    return;
  }

  var rows;
  if (offset > 0) {
    rows = stmtGetGroupHistoryOffset.all(groupId, limit, offset);
  } else {
    rows = stmtGetGroupHistory.all(groupId, limit);
  }

  var totalRow = stmtCountGroupMessages.get(groupId);
  var total = totalRow.total;

  var messages = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    var extraData = {};
    try { extraData = JSON.parse(rows[i].extra_json || '{}'); } catch (e) {}
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

  var hasMore = (offset + limit) < total;

  ws.send(JSON.stringify({
    type: 'group_message_history',
    group_id: groupId,
    messages: messages,
    has_more: hasMore
  }));
}

// ===== Main connection handler =====

wss.on('connection', function connection(ws, req) {
  ws.isAlive = true;
  ws.userId = null;

  ws.on('pong', function() {
    ws.isAlive = true;
  });

  ws.on('message', function incoming(rawMessage) {
    var data;
    try {
      data = JSON.parse(rawMessage);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: '无效的JSON格式' }));
      return;
    }

    try {
      crashLogger.trackActivity('ws_message', data.type + ' user=' + (ws.userId || 'unknown'));
      switch (data.type) {
        case 'connect':
          handleConnect(ws, data);
          break;
        case 'text':
          handleTextMessage(ws, data);
          break;
        case 'emoji':
          handleEmojiMessage(ws, data);
          break;
        case 'private_message':
          handlePrivateMessage(ws, data);
          break;
        case 'get_private_history':
          handleGetPrivateHistory(ws, data);
          break;
        case 'create_group':
          handleCreateGroup(ws, data);
          break;
        case 'group_message':
          handleGroupMessage(ws, data);
          break;
        case 'join_group':
          handleJoinGroup(ws, data);
          break;
        case 'leave_group':
          handleLeaveGroup(ws, data);
          break;
        case 'get_groups':
          handleGetGroups(ws, data);
          break;
        case 'get_group_members':
          handleGetGroupMembers(ws, data);
          break;
        case 'load_more':
          handleLoadMore(ws, data);
          break;
        case 'status_update':
          handleStatusUpdate(ws, data);
          break;
        case 'typing':
          handleTyping(ws, data);
          break;
        case 'dissolve_group':
          handleDissolveGroup(ws, data);
          break;
        case 'transfer_group':
          handleTransferGroup(ws, data);
          break;
        case 'invite_to_group':
          handleInviteToGroup(ws, data);
          break;
        case 'set_announcement':
          handleSetAnnouncement(ws, data);
          break;
        case 'kick_member':
          handleKickMember(ws, data);
          break;
        case 'rename_group':
          handleRenameGroup(ws, data);
          break;
        case 'recall_message':
          handleRecallMessage(ws, data);
          break;
        case 'get_group_history':
          handleGetGroupHistory(ws, data);
          break;
        case 'mark_read':
          handleMarkRead(ws, data);
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        default:
          ws.send(JSON.stringify({ type: 'error', message: '未知的消息类型: ' + data.type }));
      }
    } catch (e) {
      console.error('[WS] Error handling message type:', data.type, e.message);
      crashLogger.writeCrashLog('WS_HANDLER_ERROR', e);
      try {
        ws.send(JSON.stringify({ type: 'error', message: '服务器处理消息时出错' }));
      } catch (sendErr) {}
    }
  });

  ws.on('close', function() {
    if (ws.userId && !ws._replaced) {
      handleDisconnect(ws.userId);
    }
  });

  ws.on('error', function(err) {
    console.error('WebSocket error for user', ws.userId, err);
    if (ws.userId && !ws._replaced) {
      handleDisconnect(ws.userId);
    }
  });
});

// ===== Heartbeat mechanism =====

var heartbeatInterval = setInterval(function() {
  try {
    var disconnected = [];
    for (var userId in clients) {
      var ws = clients[userId];
      if (ws.isAlive === false) {
        try { ws.close(); } catch (e) {}
        disconnected.push(userId);
      } else {
        ws.isAlive = false;
        try {
          ws.ping();
        } catch (e) {
          try { ws.close(); } catch (e2) {}
          disconnected.push(userId);
        }
      }
    }
    for (var i = 0; i < disconnected.length; i++) {
      handleDisconnect(disconnected[i]);
    }
  } catch (e) {
    console.error('[Heartbeat] Error:', e.message);
    crashLogger.writeCrashLog('HEARTBEAT_ERROR', e);
  }
}, 30000);

wss.on('close', function() {
  clearInterval(heartbeatInterval);
});

// ===== Super Island integration =====

function broadcastToIsland(notification) {
  if (notification.type === 'broadcast') {
    relayBus.emitLocal('broadcast_event', { notification: notification });
  } else {
    broadcast({
      type: 'super_island_notification',
      notification: notification
    }, null, true);
  }
}

function getOnlineCount() {
  return Object.keys(clients).length;
}

function getOnlineUsers() {
  var result = [];
  var userIds = Object.keys(clients);
  for (var i = 0; i < userIds.length; i++) {
    var ws = clients[userIds[i]];
    if (ws && ws.userId) {
      result.push({
        user_id: ws.userId,
        net_name: ws.netName || '',
        connected_at: ws.connectedAt || ''
      });
    }
  }
  try {
    var db = require('../utils/db');
    for (var j = 0; j < result.length; j++) {
      var row = db.prepare('SELECT net_name, real_name FROM users WHERE user_id = ?').get(result[j].user_id);
      if (row) {
        result[j].net_name = row.net_name || result[j].net_name;
        result[j].real_name = row.real_name || '';
      }
    }
  } catch (e) {}
  return result;
}

function getRemoteOnlineUsers() {
  return remoteOnlineUsers;
}

function getRelayPeers() {
  return relayPeers;
}

function relayCustomEvent(eventType, data, excludeClientId) {
  relayBus.emit(eventType, data, excludeClientId);
}

module.exports = {
  broadcastToIsland: broadcastToIsland,
  getOnlineCount: getOnlineCount,
  getOnlineUsers: getOnlineUsers,
  getRemoteOnlineUsers: getRemoteOnlineUsers,
  getRelayPeers: getRelayPeers,
  onRelayEvent: onRelayEvent,
  relayCustomEvent: relayCustomEvent,
  broadcast: broadcast,
  broadcastToClients: broadcastToClients,
  sendToClient: sendToClient,
  getRelayEnabled: function() { return relayEnabled; },
  setRelayEnabled: function(enabled) {
    relayEnabled = enabled;
    if (!enabled) {
      for (var i = relayPeers.length - 1; i >= 0; i--) {
        try { relayPeers[i].ws.close(); } catch (e) {}
      }
      relayPeers = [];
      console.log('[Relay] Disabled and disconnected all peers');
    } else {
      console.log('[Relay] Enabled, will connect to peers');
      connectToRelayPeers();
    }
  },
  disconnectRelay: function() {
    for (var i = relayPeers.length - 1; i >= 0; i--) {
      try { relayPeers[i].ws.close(); } catch (e) {}
    }
    relayPeers = [];
    console.log('[Relay] Manually disconnected all peers');
  },
  connectRelay: function() {
    if (relayEnabled) {
      connectToRelayPeers();
    }
  }
};

// 启动时读取服务器模式
try {
  var modeRow = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('server_mode');
  if (modeRow && modeRow.value === 'single') {
    relayEnabled = false;
    console.log('[Relay] Server mode is single, relay disabled');
  } else {
    relayEnabled = true;
    console.log('[Relay] Server mode is multi, relay enabled');
  }
} catch (e) {
  console.log('[Relay] Could not read server mode, defaulting to enabled');
}

setTimeout(connectToRelayPeers, 2000);

setInterval(function() {
  if (relayPeers.length === 0) return;
  var mySyncState = relaySync.getSyncState();
  var catchupRequest = JSON.stringify({
    type: 'relay_catchup_request',
    server_id: RELAY_SERVER_ID,
    sync_state: mySyncState
  });
  for (var i = 0; i < relayPeers.length; i++) {
    try {
      if (relayPeers[i].ws.readyState === WebSocket.OPEN) {
        relayPeers[i].ws.send(catchupRequest);
      }
    } catch (e) {}
  }
  console.log('[Relay] Periodic catchup request sent to', relayPeers.length, 'peers');
}, 300000);

console.log('WebSocket Chat Server running on port ' + PORT);
if (RELAY_SERVERS.length > 0) {
  console.log('[Relay] Will connect to:', RELAY_SERVERS.join(', '));
}
