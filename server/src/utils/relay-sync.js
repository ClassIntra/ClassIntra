var db = require('./db');
var resolveUniqueName = require('./unique-name').resolveUniqueName;
var time = require('./time');

var lastSyncResult = null;
var lastSyncTime = null;

function getSyncState() {
  var state = {};
  var watermarks = {};
  try {
    var rows = db.prepare('SELECT data_type, watermark FROM sync_watermarks').all();
    for (var i = 0; i < rows.length; i++) {
      watermarks[rows[i].data_type] = rows[i].watermark;
    }
  } catch (e) {}

  state.last_chat_id = watermarks.chat_messages || 0;
  if (state.last_chat_id === 0) {
    try {
      var lastChat = db.prepare('SELECT id FROM chat_messages ORDER BY id DESC LIMIT 1').get();
      state.last_chat_id = lastChat ? lastChat.id : 0;
    } catch (e) { state.last_chat_id = 0; }
  }

  state.last_pm_id = watermarks.private_messages || 0;
  if (state.last_pm_id === 0) {
    try {
      var lastPm = db.prepare('SELECT id FROM private_messages ORDER BY id DESC LIMIT 1').get();
      state.last_pm_id = lastPm ? lastPm.id : 0;
    } catch (e) { state.last_pm_id = 0; }
  }

  state.last_gm_id = watermarks.group_messages || 0;
  if (state.last_gm_id === 0) {
    try {
      var lastGm = db.prepare('SELECT id FROM group_messages ORDER BY id DESC LIMIT 1').get();
      state.last_gm_id = lastGm ? lastGm.id : 0;
    } catch (e) { state.last_gm_id = 0; }
  }

  state.last_post_id = watermarks.community_posts || 0;
  if (state.last_post_id === 0) {
    try {
      var lastPost = db.prepare('SELECT id FROM community_posts ORDER BY id DESC LIMIT 1').get();
      state.last_post_id = lastPost ? lastPost.id : 0;
    } catch (e) { state.last_post_id = 0; }
  }

  state.last_comment_id = watermarks.community_comments || 0;
  if (state.last_comment_id === 0) {
    try {
      var lastComment = db.prepare('SELECT id FROM community_comments ORDER BY id DESC LIMIT 1').get();
      state.last_comment_id = lastComment ? lastComment.id : 0;
    } catch (e) { state.last_comment_id = 0; }
  }

  state.last_reaction_id = watermarks.message_reactions || 0;
  if (state.last_reaction_id === 0) {
    try {
      var lastReaction = db.prepare('SELECT id FROM message_reactions ORDER BY id DESC LIMIT 1').get();
      state.last_reaction_id = lastReaction ? lastReaction.id : 0;
    } catch (e) { state.last_reaction_id = 0; }
  }

  state.last_bookmark_id = watermarks.community_bookmarks || 0;
  if (state.last_bookmark_id === 0) {
    try {
      var lastBookmark = db.prepare('SELECT id FROM community_bookmarks ORDER BY id DESC LIMIT 1').get();
      state.last_bookmark_id = lastBookmark ? lastBookmark.id : 0;
    } catch (e) { state.last_bookmark_id = 0; }
  }

  state.last_like_id = watermarks.community_likes || 0;
  if (state.last_like_id === 0) {
    try {
      var lastLike = db.prepare('SELECT id FROM community_likes ORDER BY id DESC LIMIT 1').get();
      state.last_like_id = lastLike ? lastLike.id : 0;
    } catch (e) { state.last_like_id = 0; }
  }

  state.last_exp_log_id = watermarks.exp_log || 0;
  if (state.last_exp_log_id === 0) {
    try {
      var lastExpLog = db.prepare('SELECT id FROM exp_log ORDER BY id DESC LIMIT 1').get();
      state.last_exp_log_id = lastExpLog ? lastExpLog.id : 0;
    } catch (e) { state.last_exp_log_id = 0; }
  }

  state.last_broadcast_id = watermarks.broadcasts || 0;
  if (state.last_broadcast_id === 0) {
    try {
      // 用 id 而非 rowid（AUTOINCREMENT 单调、不复用，是稳定游标）
      var lastBroadcast = db.prepare('SELECT MAX(id) as id FROM broadcasts').get();
      state.last_broadcast_id = lastBroadcast ? lastBroadcast.id : 0;
    } catch (e) { state.last_broadcast_id = 0; }
  }

  try {
    var lastGroup = db.prepare('SELECT created_at FROM groups ORDER BY created_at DESC LIMIT 1').get();
    state.last_group_time = lastGroup ? lastGroup.created_at : null;
  } catch (e) {
    state.last_group_time = null;
  }

  try {
    var userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
    state.user_count = userCount ? userCount.cnt : 0;
  } catch (e) {
    state.user_count = 0;
  }

  try {
    var groupWatermark = db.prepare('SELECT watermark FROM sync_watermarks WHERE data_type = ?').get('groups');
    state.last_group_watermark = groupWatermark ? groupWatermark.watermark : 0;
  } catch (e) {
    state.last_group_watermark = 0;
  }

  try {
    var lastTombstone = db.prepare('SELECT deleted_at FROM sync_tombstones ORDER BY deleted_at DESC LIMIT 1').get();
    state.last_tombstone_time = lastTombstone ? lastTombstone.deleted_at : '1970-01-01';
  } catch (e) {
    state.last_tombstone_time = '1970-01-01';
  }

  try {
    var lastUserUpdate = db.prepare('SELECT MAX(updated_at) as max_updated FROM users WHERE updated_at IS NOT NULL').get();
    var lastUserCreate = db.prepare('SELECT MAX(created_at) as max_created FROM users').get();
    // 使用 created_at 和 updated_at 中较大的值作为水位线
    var maxUpdated = (lastUserUpdate && lastUserUpdate.max_updated) ? lastUserUpdate.max_updated : null;
    var maxCreated = (lastUserCreate && lastUserCreate.max_created) ? lastUserCreate.max_created : null;
    if (maxUpdated && maxCreated) {
      state.last_user_sync_time = maxUpdated > maxCreated ? maxUpdated : maxCreated;
    } else {
      state.last_user_sync_time = maxUpdated || maxCreated || null;
    }
  } catch (e) {
    state.last_user_sync_time = null;
  }

  return state;
}

function updateWatermark(dataType, newId) {
  if (!newId || newId <= 0) return;
  try {
    var current = db.prepare('SELECT watermark FROM sync_watermarks WHERE data_type = ?').get(dataType);
    if (!current || newId > current.watermark) {
      db.prepare('INSERT OR REPLACE INTO sync_watermarks (data_type, watermark, updated_at) VALUES (?, ?, datetime(\'now\'))').run(dataType, newId);
    }
  } catch (e) {}
}

var BATCH_SIZE = 200;
var MAX_TOTAL_ITEMS = 1000;
var LOW_MEM_BATCH_SIZE = 50;
var currentBatchSize = BATCH_SIZE;

function getEffectiveBatchSize() {
  try {
    var mem = process.memoryUsage();
    if (mem.rss > 500 * 1024 * 1024) return LOW_MEM_BATCH_SIZE;
    if (mem.rss > 350 * 1024 * 1024) return 100;
  } catch (e) {}
  return BATCH_SIZE;
}

function getMissedChatMessages(sinceId) {
  try {
    return db.prepare(
      'SELECT id, room_id, sender_id, sender_name, content, type, extra_json, recalled, created_at FROM chat_messages WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).all(sinceId, currentBatchSize);
  } catch (e) {
    return [];
  }
}

function getMissedPrivateMessages(sinceId) {
  try {
    return db.prepare(
      'SELECT id, sender_id, receiver_id, content, type, extra_json, read, recalled, created_at FROM private_messages WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).all(sinceId, currentBatchSize);
  } catch (e) {
    return [];
  }
}

function getMissedGroupMessages(sinceId) {
  try {
    return db.prepare(
      'SELECT id, group_id, sender_id, sender_name, content, type, extra_json, recalled, created_at FROM group_messages WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).all(sinceId, currentBatchSize);
  } catch (e) {
    return [];
  }
}

function getMissedPosts(sinceId) {
  try {
    return db.prepare(
      'SELECT id, user_id, type, title, content, anonymous, visible_groups, hidden_groups, like_count, comment_count, extra_json, tags, share_count, created_at FROM community_posts WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).all(sinceId, currentBatchSize);
  } catch (e) {
    return [];
  }
}

function getMissedComments(sinceId) {
  try {
    return db.prepare(
      'SELECT id, post_id, user_id, parent_id, content, like_count, created_at FROM community_comments WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).all(sinceId, currentBatchSize);
  } catch (e) {
    return [];
  }
}

function getMissedLikes(sinceId) {
  try {
    return db.prepare(
      'SELECT id, user_id, target_type, target_id, created_at FROM community_likes WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).all(sinceId || 0, currentBatchSize);
  } catch (e) {
    return [];
  }
}

function getMissedReactions(sinceId) {
  try {
    return db.prepare(
      'SELECT id, message_id, message_type, user_id, emoji, created_at FROM message_reactions WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).all(sinceId, currentBatchSize);
  } catch (e) {
    return [];
  }
}

function getMissedBookmarks(sinceId) {
  try {
    return db.prepare(
      'SELECT id, user_id, post_id, created_at FROM community_bookmarks WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).all(sinceId, currentBatchSize);
  } catch (e) {
    return [];
  }
}

function getMissedExpLogs(sinceId) {
  try {
    return db.prepare(
      'SELECT id, user_id, action, exp_gained, created_at FROM exp_log WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).all(sinceId, currentBatchSize);
  } catch (e) {
    return [];
  }
}

function getMissedBroadcasts(sinceId) {
  try {
    // ⚠️ 用 id 而非 rowid 作游标。broadcasts.id 是 INTEGER PRIMARY KEY AUTOINCREMENT，
    //    单调递增且 DELETE 后不会复用；而 rowid 在清理（大批 DELETE）后会把空位分配给
    //    新插入行 —— 实测清理过广播表后 rowid 从 8944 回落到 5438，导致
    //    `rowid > last_broadcast_id` 这个游标永远收敛不了，对端每轮都回灌 200 条。
    // 另外：系统欢迎语不外发（见 isSystemWelcomeBroadcast 说明），避免对端被污染。
    var rows = db.prepare(
      'SELECT id, content, priority, created_at FROM broadcasts WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).all(sinceId, currentBatchSize);
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      if (!isSystemWelcomeBroadcast(rows[i].content)) out.push(rows[i]);
    }
    return out;
  } catch (e) {
    return [];
  }
}

function getMissedGroups(sinceTime) {
  try {
    if (sinceTime) {
      return db.prepare('SELECT id, name, creator_id, members_json, announcement, announcement_at, created_at FROM groups WHERE created_at > ? ORDER BY created_at ASC LIMIT ?').all(sinceTime, currentBatchSize);
    }
    return db.prepare('SELECT id, name, creator_id, members_json, announcement, announcement_at, created_at FROM groups ORDER BY created_at ASC LIMIT ?').all(currentBatchSize);
  } catch (e) {
    return [];
  }
}

function getAllUsers(sinceTime) {
  try {
    if (sinceTime) {
      return db.prepare('SELECT user_id, net_name, real_name, gender, password_hash, status, is_admin, info_json, wechat, qq, phone, address, signature, privacy_settings, created_at FROM users WHERE created_at > ? OR (updated_at IS NOT NULL AND updated_at > ?) ORDER BY created_at ASC').all(sinceTime, sinceTime);
    }
    return db.prepare('SELECT user_id, net_name, real_name, gender, password_hash, status, is_admin, info_json, wechat, qq, phone, address, signature, privacy_settings, created_at FROM users').all();
  } catch (e) {
    return [];
  }
}

function getMissedUsers(sinceTime) {
  try {
    if (sinceTime) {
      return db.prepare('SELECT user_id, net_name, real_name, gender, status, is_admin, info_json, wechat, qq, phone, address, signature, privacy_settings, created_at FROM users WHERE created_at > ? OR (updated_at IS NOT NULL AND updated_at > ?) ORDER BY created_at ASC LIMIT 200').all(sinceTime, sinceTime);
    }
    return db.prepare('SELECT user_id, net_name, real_name, gender, status, is_admin, info_json, wechat, qq, phone, address, signature, privacy_settings, created_at FROM users ORDER BY created_at ASC LIMIT 200').all();
  } catch (e) {
    return [];
  }
}

function getMissedUserExperience(sinceUserId) {
  try {
    if (sinceUserId) {
      return db.prepare('SELECT user_id, exp, level, show_level_community, show_level_chat, last_login_date, last_login_exp_given FROM user_experience WHERE user_id > ? ORDER BY user_id ASC LIMIT ?').all(sinceUserId, currentBatchSize);
    }
    return db.prepare('SELECT user_id, exp, level, show_level_community, show_level_chat, last_login_date, last_login_exp_given FROM user_experience ORDER BY user_id ASC LIMIT ?').all(currentBatchSize);
  } catch (e) {
    return [];
  }
}

function getMissedUserSettings(sinceUserId) {
  try {
    if (sinceUserId) {
      return db.prepare('SELECT user_id, theme, wallpaper, notifications_json FROM user_settings WHERE user_id > ? ORDER BY user_id ASC LIMIT ?').all(sinceUserId, currentBatchSize);
    }
    return db.prepare('SELECT user_id, theme, wallpaper, notifications_json FROM user_settings ORDER BY user_id ASC LIMIT ?').all(currentBatchSize);
  } catch (e) {
    return [];
  }
}

var syncStmts = null;

function getSyncStmts() {
  if (syncStmts) return syncStmts;
  syncStmts = {
    chatInsert: db.prepare('INSERT INTO chat_messages (room_id, sender_id, sender_name, content, type, extra_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    chatCheck: db.prepare('SELECT id, recalled FROM chat_messages WHERE sender_id = ? AND content = ? AND created_at = ? LIMIT 1'),
    chatRecallUpdate: db.prepare('UPDATE chat_messages SET recalled = 1 WHERE id = ? AND recalled = 0'),
    pmInsert: db.prepare('INSERT INTO private_messages (sender_id, receiver_id, content, type, extra_json, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    pmCheck: db.prepare('SELECT id, recalled FROM private_messages WHERE sender_id = ? AND receiver_id = ? AND content = ? AND created_at = ? LIMIT 1'),
    pmRecallUpdate: db.prepare('UPDATE private_messages SET recalled = 1 WHERE id = ? AND recalled = 0'),
    gmInsert: db.prepare('INSERT INTO group_messages (group_id, sender_id, sender_name, content, type, extra_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    gmCheck: db.prepare('SELECT id, recalled FROM group_messages WHERE group_id = ? AND sender_id = ? AND content = ? AND created_at = ? LIMIT 1'),
    gmRecallUpdate: db.prepare('UPDATE group_messages SET recalled = 1 WHERE id = ? AND recalled = 0'),
    postInsert: db.prepare('INSERT OR IGNORE INTO community_posts (id, user_id, type, title, content, anonymous, visible_groups, hidden_groups, like_count, comment_count, extra_json, tags, share_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    commentInsert: db.prepare('INSERT OR IGNORE INTO community_comments (id, post_id, user_id, parent_id, content, like_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    likeInsert: db.prepare('INSERT OR IGNORE INTO community_likes (id, user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?)'),
    reactionInsert: db.prepare('INSERT OR IGNORE INTO message_reactions (message_id, message_type, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)'),
    bookmarkInsert: db.prepare('INSERT OR IGNORE INTO community_bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)'),
    expLogInsert: db.prepare('INSERT INTO exp_log (user_id, action, exp_gained, created_at) VALUES (?, ?, ?, ?)'),
    expLogCheck: db.prepare('SELECT id FROM exp_log WHERE user_id = ? AND action = ? AND created_at = ? LIMIT 1'),
    bcCheck: db.prepare('SELECT rowid FROM broadcasts WHERE content = ? AND created_at = ? LIMIT 1'),
    // 时间窗去重：同一 content 在窗口内已存在则视为回灌、拒绝入库。
    // 为什么不是 (content) 全局唯一：管理员可能隔几天再发一次同样的广播，必须允许。
    // 为什么需要它：(content, created_at) 唯一索引挡不住对端用「不同时间戳回灌同一内容」——
    // 实测对端 8i 把一条欢迎语以相隔 2.5 分钟的时间戳灌了 491 次。
    bcRecentCheck: db.prepare(
      'SELECT rowid FROM broadcasts WHERE content = ? AND created_at >= ? LIMIT 1'
    ),
    // OR IGNORE 依赖迁移 005 建的唯一索引 (content, created_at)。
    // 历史教训：该索引缺失时 OR IGNORE 退化为普通 INSERT，catchup 回灌每轮都新增行，
    // 又抬高同步水位线，形成两台服务器互推的正反馈风暴（实测每秒约 40 条）。
    bcInsert: db.prepare('INSERT OR IGNORE INTO broadcasts (content, priority, created_at) VALUES (?, ?, ?)'),
    groupInsert: db.prepare('INSERT OR IGNORE INTO groups (id, name, creator_id, members_json, announcement, announcement_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    groupUpdate: db.prepare('UPDATE groups SET members_json = ?, announcement = ?, announcement_at = ? WHERE id = ?'),
    groupCheck: db.prepare('SELECT id FROM groups WHERE id = ?'),
    userInsert: db.prepare('INSERT OR IGNORE INTO users (user_id, net_name, real_name, gender, password_hash, status, is_admin, info_json, wechat, qq, phone, address, signature, privacy_settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    userUpdate: db.prepare('UPDATE users SET net_name = ?, real_name = ?, gender = ?, status = ?, is_admin = ?, info_json = ?, wechat = ?, qq = ?, phone = ?, address = ?, signature = ?, privacy_settings = ? WHERE user_id = ?'),
    userUpdateWithPw: db.prepare('UPDATE users SET net_name = ?, real_name = ?, gender = ?, status = ?, is_admin = ?, info_json = ?, wechat = ?, qq = ?, phone = ?, address = ?, signature = ?, privacy_settings = ?, password_hash = ? WHERE user_id = ?'),
    userCheck: db.prepare('SELECT user_id, password_hash FROM users WHERE user_id = ?'),
    expInsert: db.prepare('INSERT OR IGNORE INTO user_experience (user_id, exp, level, show_level_community, show_level_chat, last_login_date, last_login_exp_given) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    expUpdate: db.prepare('UPDATE user_experience SET exp = ?, level = ?, show_level_community = ?, show_level_chat = ? WHERE user_id = ?'),
    expCheck: db.prepare('SELECT user_id FROM user_experience WHERE user_id = ?'),
    expGetLocal: db.prepare('SELECT exp FROM user_experience WHERE user_id = ?'),
    settingsInsert: db.prepare('INSERT OR IGNORE INTO user_settings (user_id, theme, wallpaper, notifications_json) VALUES (?, ?, ?, ?)'),
    settingsUpdate: db.prepare('UPDATE user_settings SET theme = ?, wallpaper = ?, notifications_json = ? WHERE user_id = ?'),
    settingsCheck: db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?'),
    tombstoneInsert: db.prepare('INSERT OR IGNORE INTO sync_tombstones (data_type, record_id, deleted_at) VALUES (?, ?, ?)'),
    chatCheckRecent: db.prepare('SELECT id, recalled, created_at FROM chat_messages WHERE sender_id = ? AND content = ? ORDER BY id DESC LIMIT 5'),
    pmCheckRecent: db.prepare('SELECT id, recalled, created_at FROM private_messages WHERE sender_id = ? AND receiver_id = ? AND content = ? ORDER BY id DESC LIMIT 5'),
    gmCheckRecent: db.prepare('SELECT id, recalled, created_at FROM group_messages WHERE group_id = ? AND sender_id = ? AND content = ? ORDER BY id DESC LIMIT 5')
  };
  return syncStmts;
}

// 时间戳归一化（去非数字取前 14 位），容忍本地格式与 ISO 格式差异
function normTs(v) {
  return String(v || '').replace(/[^0-9]/g, '').substring(0, 14);
}

// 判断是否为「系统欢迎语」广播。
// 这类内容由每台服务器的 init-db.js 在**空库时**各自写入一条，属于本机初始化产物，
// 不应该从中继对端回灌 —— 对端历史上因风暴累积了数百条（每条时间戳不同），
// 一旦回灌就会污染本机超能岛的「最近一条」展示。
function isSystemWelcomeBroadcast(content) {
  var s = String(content || '');
  return s.indexOf('欢迎使用 ') === 0 && s.indexOf(' 系统！') === s.length - 4;
}

// catchup 回灌去重：精确 created_at 未命中时，再按 sender+content+归一化时间戳 比对最近几条
// （本机产生的消息中继到对端后，对端 catchup 会把同一消息以另一种时间格式灌回来）
function syncDupRecent(recentStmt, values, createdAt) {
  // ⚠️ better-sqlite3 的 statement 方法必须以 statement 自身为 this 调用。
  // 曾写成 recentStmt.all.apply(null, values) → 抛 `TypeError: Illegal invocation`，
  // 被外层 try/catch 静默吞掉，导致去重整段失效。
  var recent = recentStmt.all.apply(recentStmt, values);
  var tsKey = normTs(createdAt);
  for (var i = 0; i < recent.length; i++) {
    if (createdAt && (recent[i].created_at === createdAt || normTs(recent[i].created_at) === tsKey)) {
      return recent[i];
    }
  }
  return null;
}

function applySyncData(syncData) {
  var result = { chat: 0, pm: 0, gm: 0, posts: 0, comments: 0, likes: 0, reactions: 0, bookmarks: 0, exp_logs: 0, broadcasts: 0, groups: 0, users: 0, user_experience: 0, user_settings: 0, tombstones: 0 };
  // 本次同步「新插入」的消息行（去重命中的不算）。
  // 用途：catchup 只把数据写库，若不补推，在线用户必须刷新页面才能看到 —— 这是
  // 「跨班聊天不实时、要反复刷新」的直接原因之一。返回值交调用方投递。
  var newlyApplied = { private_messages: [], group_messages: [], chat_messages: [] };
  var s = getSyncStmts();

  // 使用事务保护，确保原子性
  var applyTransaction = db.transaction(function() {

  if (syncData.chat_messages && syncData.chat_messages.length > 0) {
    for (var i = 0; i < syncData.chat_messages.length; i++) {
      var m = syncData.chat_messages[i];
      try {
        var existing = s.chatCheck.get(m.sender_id, m.content, m.created_at);
        if (!existing) existing = syncDupRecent(s.chatCheckRecent, [m.sender_id, m.content], m.created_at);
        if (existing) {
          if (m.recalled && !existing.recalled) {
            s.chatRecallUpdate.run(existing.id);
          }
          continue;
        }
        var extraObj = {};
        try { extraObj = JSON.parse(m.extra_json || '{}'); } catch (e2) {}
        extraObj.synced = true;
        extraObj.original_id = m.id;
        s.chatInsert.run(m.room_id, m.sender_id, m.sender_name, m.content, m.type || 'text', JSON.stringify(extraObj), m.created_at);
        result.chat++;
      } catch (e) {}
    }
  }

  if (syncData.private_messages && syncData.private_messages.length > 0) {
    for (var j = 0; j < syncData.private_messages.length; j++) {
      var pm = syncData.private_messages[j];
      try {
        var pmExisting = s.pmCheck.get(pm.sender_id, pm.receiver_id, pm.content, pm.created_at);
        if (!pmExisting) pmExisting = syncDupRecent(s.pmCheckRecent, [pm.sender_id, pm.receiver_id, pm.content], pm.created_at);
        if (pmExisting) {
          if (pm.recalled && !pmExisting.recalled) {
            s.pmRecallUpdate.run(pmExisting.id);
          }
          continue;
        }
        var pmExtraObj = {};
        try { pmExtraObj = JSON.parse(pm.extra_json || '{}'); } catch (e2) {}
        pmExtraObj.synced = true;
        pmExtraObj.original_id = pm.id;
        var pmIns = s.pmInsert.run(pm.sender_id, pm.receiver_id, pm.content, pm.type || 'text', JSON.stringify(pmExtraObj), pm.read || 0, pm.created_at);
        result.pm++;
        // 记录新插入的行，供调用方向在线客户端补推（否则用户必须刷新页面才能看到）
        newlyApplied.private_messages.push({
          id: pmIns.lastInsertRowid,
          sender_id: pm.sender_id,
          receiver_id: pm.receiver_id,
          content: pm.content,
          type: pm.type || 'text',
          created_at: pm.created_at
        });
      } catch (e) {}
    }
  }

  if (syncData.group_messages && syncData.group_messages.length > 0) {
    for (var k = 0; k < syncData.group_messages.length; k++) {
      var gm = syncData.group_messages[k];
      try {
        var gmExisting = s.gmCheck.get(gm.group_id, gm.sender_id, gm.content, gm.created_at);
        if (!gmExisting) gmExisting = syncDupRecent(s.gmCheckRecent, [gm.group_id, gm.sender_id, gm.content], gm.created_at);
        if (gmExisting) {
          if (gm.recalled && !gmExisting.recalled) {
            s.gmRecallUpdate.run(gmExisting.id);
          }
          continue;
        }
        var gmExtraObj = {};
        try { gmExtraObj = JSON.parse(gm.extra_json || '{}'); } catch (e2) {}
        gmExtraObj.synced = true;
        gmExtraObj.original_id = gm.id;
        var gmIns = s.gmInsert.run(gm.group_id, gm.sender_id, gm.sender_name, gm.content, gm.type || 'text', JSON.stringify(gmExtraObj), gm.created_at);
        result.gm++;
        newlyApplied.group_messages.push({
          id: gmIns.lastInsertRowid,
          group_id: gm.group_id,
          sender_id: gm.sender_id,
          sender_name: gm.sender_name,
          content: gm.content,
          type: gm.type || 'text',
          created_at: gm.created_at
        });
      } catch (e) {}
    }
  }

  if (syncData.posts && syncData.posts.length > 0) {
    for (var p = 0; p < syncData.posts.length; p++) {
      var post = syncData.posts[p];
      try {
        s.postInsert.run(
          post.id, post.user_id, post.type || 'forum', post.title || '', post.content || '',
          post.anonymous || 0, post.visible_groups || '[]', post.hidden_groups || '[]',
          post.like_count || 0, post.comment_count || 0, post.extra_json || '{}',
          post.tags || '[]', post.share_count || 0, post.created_at
        );
        result.posts++;
      } catch (e) {}
    }
  }

  if (syncData.comments && syncData.comments.length > 0) {
    for (var c = 0; c < syncData.comments.length; c++) {
      var comment = syncData.comments[c];
      try {
        s.commentInsert.run(comment.id, comment.post_id, comment.user_id, comment.parent_id, comment.content, comment.like_count || 0, comment.created_at);
        result.comments++;
      } catch (e) {}
    }
  }

  if (syncData.likes && syncData.likes.length > 0) {
    for (var l = 0; l < syncData.likes.length; l++) {
      var like = syncData.likes[l];
      try {
        s.likeInsert.run(like.id, like.user_id, like.target_type, String(like.target_id), like.created_at);
        result.likes++;
      } catch (e) {}
    }
  }

  if (syncData.reactions && syncData.reactions.length > 0) {
    for (var r = 0; r < syncData.reactions.length; r++) {
      var reaction = syncData.reactions[r];
      try {
        s.reactionInsert.run(reaction.message_id, reaction.message_type, reaction.user_id, reaction.emoji, reaction.created_at);
        result.reactions++;
      } catch (e) {}
    }
  }

  if (syncData.bookmarks && syncData.bookmarks.length > 0) {
    for (var bm = 0; bm < syncData.bookmarks.length; bm++) {
      var bookmark = syncData.bookmarks[bm];
      try {
        s.bookmarkInsert.run(bookmark.user_id, bookmark.post_id, bookmark.created_at);
        result.bookmarks++;
      } catch (e) {}
    }
  }

  if (syncData.exp_logs && syncData.exp_logs.length > 0) {
    for (var el = 0; el < syncData.exp_logs.length; el++) {
      var expLog = syncData.exp_logs[el];
      try {
        var expLogExisting = s.expLogCheck.get(expLog.user_id, expLog.action, expLog.created_at);
        if (expLogExisting) continue;
        s.expLogInsert.run(expLog.user_id, expLog.action, expLog.exp_gained, expLog.created_at);
        result.exp_logs++;
      } catch (e) {}
    }
  }

  if (syncData.broadcasts && syncData.broadcasts.length > 0) {
    // 同一 content 的时间窗去重窗：7 天内已存在同内容广播则不再回灌。
    // 对端反复回灌的历史脏数据时间戳跨度为两周（6/16~6/30），
    // 7 天窗足以覆盖；同时不影响「管理员隔几天再发同样内容」。
    var BC_DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    var bcWindowStart = new Date(Date.now() - BC_DEDUP_WINDOW_MS).toISOString().replace('T', ' ').substring(0, 19);
    for (var b = 0; b < syncData.broadcasts.length; b++) {
      var bc = syncData.broadcasts[b];
      try {
        // ⓪ 系统欢迎语无条件拒收。历史风暴在对端 8i 累积了 491 条 ClassNet + 182 条
        //    ClassIntra 欢迎语，每次 catchup 都会整批推过来；它们不是用户内容，
        //    本机每台服务器各自写一条即可，从对端回灌永远是脏数据。
        if (isSystemWelcomeBroadcast(bc.content)) continue;
        // ① 先查同内容是否已在窗口内 —— 挡住「不同时间戳回灌同一内容」
        var bcRecent = s.bcRecentCheck.get(bc.content, bcWindowStart);
        if (bcRecent) continue;
        // ② 唯一索引 (content, created_at) 保证同一时刻的同内容幂等：命中则 ignore，changes=0。
        // 用 changes 判定是否真正插入，避免把「已存在」也计入 result.broadcasts
        // 而被调用方当作新数据二次外发（这正是死循环的放大器）。
        var bcRes = s.bcInsert.run(bc.content, bc.priority || 'normal', bc.created_at);
        if (bcRes && bcRes.changes > 0) result.broadcasts++;
      } catch (e) {}
    }
  }

  if (syncData.groups && syncData.groups.length > 0) {
    for (var g = 0; g < syncData.groups.length; g++) {
      var grp = syncData.groups[g];
      try {
        var grpExisting = s.groupCheck.get(grp.id);
        if (grpExisting) {
          s.groupUpdate.run(grp.members_json, grp.announcement || '', grp.announcement_at || null, grp.id);
        } else {
          s.groupInsert.run(grp.id, grp.name, grp.creator_id, grp.members_json, grp.announcement || '', grp.announcement_at || null, grp.created_at);
        }
        result.groups++;
      } catch (e) {}
    }
  }

  if (syncData.users && syncData.users.length > 0) {
    for (var u = 0; u < syncData.users.length; u++) {
      var user = syncData.users[u];
      if (!user || !user.user_id) continue;
      try {
        var existingUser = s.userCheck.get(user.user_id);
        if (existingUser) {
          // 追赶同步时，只更新非空字段，不覆盖本地管理员权限
          // 使用动态SQL构建，只更新有值的字段
          var updateFields = [];
          var updateValues = [];
          if (user.net_name && user.net_name !== '') {
            updateFields.push('net_name = ?');
            updateValues.push(resolveUniqueName(db, user.net_name, user.user_id, 'net_name', '用户'));
          }
          if (user.real_name && user.real_name !== '') {
            updateFields.push('real_name = ?');
            updateValues.push(resolveUniqueName(db, user.real_name, user.user_id, 'real_name', '跨班用户'));
          }
          if (user.gender && user.gender !== '') {
            updateFields.push('gender = ?');
            updateValues.push(user.gender);
          }
          if (user.info_json && user.info_json !== '{}') {
            updateFields.push('info_json = ?');
            updateValues.push(user.info_json);
          }
          if (user.wechat && user.wechat !== '') {
            updateFields.push('wechat = ?');
            updateValues.push(user.wechat);
          }
          if (user.qq && user.qq !== '') {
            updateFields.push('qq = ?');
            updateValues.push(user.qq);
          }
          if (user.phone && user.phone !== '') {
            updateFields.push('phone = ?');
            updateValues.push(user.phone);
          }
          if (user.address && user.address !== '') {
            updateFields.push('address = ?');
            updateValues.push(user.address);
          }
          if (user.signature && user.signature !== '') {
            updateFields.push('signature = ?');
            updateValues.push(user.signature);
          }
          if (user.privacy_settings && user.privacy_settings !== '{}') {
            updateFields.push('privacy_settings = ?');
            updateValues.push(user.privacy_settings);
          }
          // 不覆盖本地的 is_admin 和 status（各服务器独立管理）
          // 不覆盖 password_hash（各服务器独立管理密码）
          if (updateFields.length > 0) {
            updateFields.push('updated_at = datetime(\'now\')');
            updateValues.push(user.user_id);
            db.prepare('UPDATE users SET ' + updateFields.join(', ') + ' WHERE user_id = ?').run(updateValues);
          }
        } else {
          s.userInsert.run(
            user.user_id,
            resolveUniqueName(db, user.net_name, user.user_id, 'net_name', '用户'),
            resolveUniqueName(db, user.real_name, user.user_id, 'real_name', '跨班用户'),
            user.gender || '',
            '', user.status || 'active', user.is_admin || 0,
            user.info_json || '{}', user.wechat || '', user.qq || '',
            user.phone || '', user.address || '', user.signature || '',
            user.privacy_settings || '{}', user.created_at || new Date().toISOString()
          );
        }
        result.users++;
      } catch (e) {
        console.warn('[Relay-Sync] 用户同步跳过 user=' + (user && user.user_id) + ' err=' + e.message);
      }
    }
  }

  if (syncData.user_experience && syncData.user_experience.length > 0) {
    for (var ue = 0; ue < syncData.user_experience.length; ue++) {
      var uexp = syncData.user_experience[ue];
      if (!uexp || !uexp.user_id) continue;
      try {
        var existingExp = s.expCheck.get(uexp.user_id);
        if (existingExp) {
          var localExp = s.expGetLocal.get(uexp.user_id);
          if (uexp.exp > (localExp ? localExp.exp : 0)) {
            s.expUpdate.run(uexp.exp, uexp.level, uexp.show_level_community, uexp.show_level_chat, uexp.user_id);
          }
        } else {
          s.expInsert.run(uexp.user_id, uexp.exp, uexp.level, uexp.show_level_community, uexp.show_level_chat, uexp.last_login_date, uexp.last_login_exp_given || 0);
        }
        result.user_experience++;
      } catch (e) {}
    }
  }

  if (syncData.user_settings && syncData.user_settings.length > 0) {
    for (var us = 0; us < syncData.user_settings.length; us++) {
      var usetting = syncData.user_settings[us];
      if (!usetting || !usetting.user_id) continue;
      try {
        var existingSetting = s.settingsCheck.get(usetting.user_id);
        if (existingSetting) {
          s.settingsUpdate.run(usetting.theme, usetting.wallpaper, usetting.notifications_json, usetting.user_id);
        } else {
          s.settingsInsert.run(usetting.user_id, usetting.theme, usetting.wallpaper, usetting.notifications_json);
        }
        result.user_settings++;
      } catch (e) {}
    }
  }

  if (syncData.tombstones && syncData.tombstones.length > 0) {
    result.tombstones = applyTombstones(syncData.tombstones);
  }

  }); // end of applyTransaction

  try {
    applyTransaction();
  } catch (e) {
    console.error('[relay-sync] Transaction failed, rolled back:', e.message);
    return { chat: 0, pm: 0, gm: 0, posts: 0, comments: 0, likes: 0, reactions: 0, bookmarks: 0, exp_logs: 0, broadcasts: 0, groups: 0, users: 0, user_experience: 0, user_settings: 0, tombstones: 0, error: e.message };
  }

  lastSyncResult = result;
  lastSyncTime = new Date().toISOString();

  // 附带本次新插入的消息行，供调用方补推给在线客户端
  result.newly_applied = newlyApplied;
  return result;
}

function buildCatchupResponse(remoteState) {
  currentBatchSize = getEffectiveBatchSize();
  var response = {};

  response.chat_messages = getMissedChatMessages(remoteState.last_chat_id || 0);
  response.private_messages = getMissedPrivateMessages(remoteState.last_pm_id || 0);
  response.group_messages = getMissedGroupMessages(remoteState.last_gm_id || 0);
  response.posts = getMissedPosts(remoteState.last_post_id || 0);
  response.comments = getMissedComments(remoteState.last_comment_id || 0);
  response.likes = getMissedLikes(remoteState.last_like_id || 0);
  response.reactions = getMissedReactions(remoteState.last_reaction_id || 0);
  response.bookmarks = getMissedBookmarks(remoteState.last_bookmark_id || 0);
  response.exp_logs = getMissedExpLogs(remoteState.last_exp_log_id || 0);
  response.broadcasts = getMissedBroadcasts(remoteState.last_broadcast_id || 0);

  var lastTombstoneTime = remoteState.last_tombstone_time || '1970-01-01';
  response.tombstones = getTombstones(lastTombstoneTime);

  response.groups = getMissedGroups(remoteState.last_group_time || null);

  var sinceTime = remoteState.last_user_sync_time || null;
  response.users = getMissedUsers(sinceTime);
  response.user_experience = getMissedUserExperience(remoteState.last_exp_user_id || null);
  response.user_settings = getMissedUserSettings(remoteState.last_settings_user_id || null);

  response.has_more = {};
  var dataTypes = ['chat_messages', 'private_messages', 'group_messages', 'posts', 'comments', 'likes', 'reactions', 'bookmarks', 'exp_logs', 'broadcasts', 'groups', 'users', 'user_experience', 'user_settings'];
  var totalItems = 0;
  for (var ti = 0; ti < dataTypes.length; ti++) {
    if (Array.isArray(response[dataTypes[ti]])) totalItems += response[dataTypes[ti]].length;
  }
  if (totalItems > MAX_TOTAL_ITEMS) {
    var priorityTypes = ['chat_messages', 'private_messages', 'group_messages', 'posts', 'comments'];
    var keptCount = 0;
    for (var ki = 0; ki < dataTypes.length; ki++) {
      var kt = dataTypes[ki];
      if (!Array.isArray(response[kt])) continue;
      if (keptCount >= MAX_TOTAL_ITEMS) {
        response[kt] = [];
        continue;
      }
      if (keptCount + response[kt].length > MAX_TOTAL_ITEMS) {
        response[kt] = response[kt].slice(0, MAX_TOTAL_ITEMS - keptCount);
      }
      keptCount += response[kt].length;
    }
  }
  var anyMore = false;
  for (var di = 0; di < dataTypes.length; di++) {
    var dt = dataTypes[di];
    if (Array.isArray(response[dt]) && response[dt].length >= currentBatchSize) {
      response.has_more[dt] = true;
      anyMore = true;
    } else {
      response.has_more[dt] = false;
    }
  }
  if (totalItems > MAX_TOTAL_ITEMS) anyMore = true;
  response.has_more.overall = anyMore;

  response.next_state = {};
  if (response.chat_messages.length > 0) {
    response.next_state.last_chat_id = response.chat_messages[response.chat_messages.length - 1].id;
  }
  if (response.private_messages.length > 0) {
    response.next_state.last_pm_id = response.private_messages[response.private_messages.length - 1].id;
  }
  if (response.group_messages.length > 0) {
    response.next_state.last_gm_id = response.group_messages[response.group_messages.length - 1].id;
  }
  if (response.posts.length > 0) {
    response.next_state.last_post_id = response.posts[response.posts.length - 1].id;
  }
  if (response.comments.length > 0) {
    response.next_state.last_comment_id = response.comments[response.comments.length - 1].id;
  }
  if (response.reactions.length > 0) {
    response.next_state.last_reaction_id = response.reactions[response.reactions.length - 1].id;
  }
  if (response.bookmarks.length > 0) {
    response.next_state.last_bookmark_id = response.bookmarks[response.bookmarks.length - 1].id;
  }
  if (response.likes.length > 0) {
    response.next_state.last_like_id = response.likes[response.likes.length - 1].id;
  }
  if (response.exp_logs.length > 0) {
    response.next_state.last_exp_log_id = response.exp_logs[response.exp_logs.length - 1].id;
  }
  if (response.broadcasts.length > 0) {
    response.next_state.last_broadcast_id = response.broadcasts[response.broadcasts.length - 1].id;
  }
  if (response.groups.length > 0) {
    response.next_state.last_group_time = response.groups[response.groups.length - 1].created_at;
  }
  if (response.users.length > 0) {
    var lastUser = response.users[response.users.length - 1];
    var lastUserTime = lastUser.updated_at || lastUser.created_at || null;
    response.next_state.last_user_sync_time = lastUserTime;
  }
  if (response.user_experience.length > 0) {
    response.next_state.last_exp_user_id = response.user_experience[response.user_experience.length - 1].user_id;
  }
  if (response.user_settings.length > 0) {
    response.next_state.last_settings_user_id = response.user_settings[response.user_settings.length - 1].user_id;
  }

  return response;
}

function getSyncStatus() {
  return {
    last_sync_time: lastSyncTime,
    last_sync_result: lastSyncResult,
    server_id: process.env.RELAY_SERVER_ID || '',
    sync_state: getSyncState()
  };
}

function updateGroupWatermark() {
  try {
    var count = db.prepare('SELECT COUNT(*) as cnt FROM groups').get().cnt;
    db.prepare('INSERT OR REPLACE INTO sync_watermarks (data_type, watermark, updated_at) VALUES (?, ?, datetime(\'now\'))').run('groups', count);
  } catch (e) {}
}

function recordTombstone(dataType, recordId) {
  try {
    db.prepare('INSERT OR IGNORE INTO sync_tombstones (data_type, record_id, deleted_at) VALUES (?, ?, datetime(\'now\'))').run(dataType, String(recordId));
  } catch (e) {
    console.error('[relay-sync] Error recording tombstone:', e.message);
  }
}

function getTombstones(sinceTime) {
  try {
    return db.prepare('SELECT data_type, record_id, deleted_at FROM sync_tombstones WHERE deleted_at > ? ORDER BY deleted_at ASC LIMIT 500').all(sinceTime || '1970-01-01');
  } catch (e) {
    return [];
  }
}

function applyTombstones(tombstones) {
  if (!tombstones || tombstones.length === 0) return 0;
  var count = 0;
  for (var i = 0; i < tombstones.length; i++) {
    var t = tombstones[i];
    try {
      if (t.data_type === 'community_posts') {
        db.prepare('DELETE FROM community_comments WHERE post_id = ?').run(Number(t.record_id));
        db.prepare("DELETE FROM community_likes WHERE target_type = 'post' AND target_id = ?").run(t.record_id);
        db.prepare('DELETE FROM community_bookmarks WHERE post_id = ?').run(Number(t.record_id));
        db.prepare('DELETE FROM community_posts WHERE id = ?').run(Number(t.record_id));
        count++;
      } else if (t.data_type === 'community_comments') {
        db.prepare("DELETE FROM community_likes WHERE target_type = 'comment' AND target_id = ?").run(t.record_id);
        db.prepare('DELETE FROM community_comments WHERE id = ?').run(Number(t.record_id));
        db.prepare('DELETE FROM community_comments WHERE parent_id = ?').run(Number(t.record_id));
        count++;
      } else if (t.data_type === 'group_messages') {
        db.prepare('DELETE FROM group_messages WHERE group_id = ?').run(t.record_id);
        count++;
      } else if (t.data_type === 'private_messages') {
        // record_id 格式为 user1_user2
        var parts = String(t.record_id).split('_');
        if (parts.length === 2) {
          db.prepare('DELETE FROM private_messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)').run(parts[0], parts[1], parts[1], parts[0]);
        }
        count++;
      } else if (t.data_type === 'users') {
        db.prepare('DELETE FROM user_experience WHERE user_id = ?').run(t.record_id);
        db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(t.record_id);
        db.prepare('DELETE FROM users WHERE user_id = ?').run(t.record_id);
        count++;
      } else if (t.data_type === 'groups') {
        db.prepare('DELETE FROM group_messages WHERE group_id = ?').run(t.record_id);
        db.prepare('DELETE FROM groups WHERE id = ?').run(t.record_id);
        count++;
      }
      db.prepare('INSERT OR IGNORE INTO sync_tombstones (data_type, record_id, deleted_at) VALUES (?, ?, ?)').run(t.data_type, t.record_id, t.deleted_at);
    } catch (e) {
      console.error('[relay-sync] Error applying tombstone:', t.data_type, t.record_id, e.message);
    }
  }
  return count;
}

module.exports = {
  getSyncState: getSyncState,
  buildCatchupResponse: buildCatchupResponse,
  applySyncData: applySyncData,
  getSyncStatus: getSyncStatus,
  updateWatermark: updateWatermark,
  updateGroupWatermark: updateGroupWatermark,
  recordTombstone: recordTombstone,
  getTombstones: getTombstones,
  applyTombstones: applyTombstones,
  getSyncStmts: getSyncStmts
};
