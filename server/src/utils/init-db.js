var db = require('./db');
var bcrypt = require('bcryptjs');

function initDatabase() {
  db.exec([
    'CREATE TABLE IF NOT EXISTS users (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  net_name TEXT NOT NULL UNIQUE,',
    '  real_name TEXT NOT NULL UNIQUE,',
    '  user_id TEXT NOT NULL UNIQUE,',
    '  gender TEXT DEFAULT \'\',',
    '  password_hash TEXT NOT NULL,',
    '  status TEXT DEFAULT \'active\',',
    '  is_admin INTEGER DEFAULT 0,',
    '  info_json TEXT DEFAULT \'{}\',',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  last_login TEXT DEFAULT NULL',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS pre_records (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  real_name TEXT NOT NULL UNIQUE,',
    '  user_id TEXT NOT NULL UNIQUE,',
    '  gender TEXT DEFAULT \'\'',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS broadcasts (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  content TEXT NOT NULL,',
    '  priority TEXT DEFAULT \'normal\',',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS announcements (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  title TEXT NOT NULL,',
    '  content TEXT NOT NULL,',
    '  type TEXT DEFAULT \'notice\',',
    '  author_id TEXT NOT NULL,',
    '  author_name TEXT DEFAULT \'\',',
    '  pinned INTEGER DEFAULT 0,',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS chat_messages (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  room_id TEXT DEFAULT \'public\',',
    '  sender_id TEXT NOT NULL,',
    '  sender_name TEXT NOT NULL,',
    '  content TEXT NOT NULL,',
    '  type TEXT DEFAULT \'text\',',
    '  recalled INTEGER DEFAULT 0,',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS private_messages (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  sender_id TEXT NOT NULL,',
    '  receiver_id TEXT NOT NULL,',
    '  content TEXT NOT NULL,',
    '  type TEXT DEFAULT \'text\',',
    '  read INTEGER DEFAULT 0,',
    '  recalled INTEGER DEFAULT 0,',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS groups (',
    '  id TEXT PRIMARY KEY,',
    '  name TEXT NOT NULL,',
    '  creator_id TEXT NOT NULL,',
    '  members_json TEXT DEFAULT \'[]\',',
    '  announcement TEXT DEFAULT \'\',',
    '  announcement_at TEXT DEFAULT NULL,',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS group_messages (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  group_id TEXT NOT NULL,',
    '  sender_id TEXT NOT NULL,',
    '  sender_name TEXT NOT NULL,',
    '  content TEXT NOT NULL,',
    '  type TEXT DEFAULT \'text\',',
    '  recalled INTEGER DEFAULT 0,',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS conversations (',
    '  id TEXT PRIMARY KEY,',
    '  user_id TEXT NOT NULL,',
    '  title TEXT DEFAULT \'新对话\',',
    '  messages_json TEXT DEFAULT \'[]\',',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS user_settings (',
    '  user_id TEXT PRIMARY KEY,',
    '  theme TEXT DEFAULT \'light\',',
    '  wallpaper TEXT DEFAULT \'default\',',
    '  notifications_json TEXT DEFAULT \'{"superIsland":true,"chat":true,"sound":false}\',',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS admin_logs (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  admin_id TEXT NOT NULL,',
    '  action TEXT NOT NULL,',
    '  target TEXT DEFAULT \'\',',
    '  detail TEXT DEFAULT \'\',',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec('CREATE INDEX IF NOT EXISTS idx_users_real_name ON users(real_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_net_name ON users(net_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_private_messages_parties ON private_messages(sender_id, receiver_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at)');

  var convColumns = db.prepare("PRAGMA table_info(conversations)").all();
  var convColNames = convColumns.map(function(c) { return c.name; });
  if (convColNames.indexOf('summary') === -1) {
    db.exec("ALTER TABLE conversations ADD COLUMN summary TEXT DEFAULT ''");
  }
  if (convColNames.indexOf('summary_at') === -1) {
    db.exec("ALTER TABLE conversations ADD COLUMN summary_at TEXT DEFAULT NULL");
  }

  var settingsCols = db.prepare("PRAGMA table_info(user_settings)").all().map(function(c) { return c.name; });
  if (settingsCols.indexOf('ai_settings_json') === -1) {
    db.exec("ALTER TABLE user_settings ADD COLUMN ai_settings_json TEXT DEFAULT '{\"system_prompt\":\"\",\"pinned_conversations\":[]}'");
  }

  var columns = db.prepare("PRAGMA table_info(groups)").all();
  var hasAnnouncement = columns.some(function(c) { return c.name === 'announcement'; });
  if (!hasAnnouncement) {
    db.exec("ALTER TABLE groups ADD COLUMN announcement TEXT DEFAULT ''");
    db.exec("ALTER TABLE groups ADD COLUMN announcement_at TEXT DEFAULT NULL");
  }

  var chatColumns = db.prepare("PRAGMA table_info(chat_messages)").all();
  var hasChatRecalled = chatColumns.some(function(c) { return c.name === 'recalled'; });
  if (!hasChatRecalled) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN recalled INTEGER DEFAULT 0");
  }
  var hasChatExtra = chatColumns.some(function(c) { return c.name === 'extra_json'; });
  if (!hasChatExtra) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN extra_json TEXT DEFAULT '{}'");
  }

  var pmColumns = db.prepare("PRAGMA table_info(private_messages)").all();
  var hasPmRecalled = pmColumns.some(function(c) { return c.name === 'recalled'; });
  if (!hasPmRecalled) {
    db.exec("ALTER TABLE private_messages ADD COLUMN recalled INTEGER DEFAULT 0");
  }
  var hasPmExtra = pmColumns.some(function(c) { return c.name === 'extra_json'; });
  if (!hasPmExtra) {
    db.exec("ALTER TABLE private_messages ADD COLUMN extra_json TEXT DEFAULT '{}'");
  }

  var gmColumns = db.prepare("PRAGMA table_info(group_messages)").all();
  var hasGmRecalled = gmColumns.some(function(c) { return c.name === 'recalled'; });
  if (!hasGmRecalled) {
    db.exec("ALTER TABLE group_messages ADD COLUMN recalled INTEGER DEFAULT 0");
  }
  var hasGmExtra = gmColumns.some(function(c) { return c.name === 'extra_json'; });
  if (!hasGmExtra) {
    db.exec("ALTER TABLE group_messages ADD COLUMN extra_json TEXT DEFAULT '{}'");
  }

  var allPreRecords = [];
  try {
    var preRecordsData = require('../../config/pre-records.json');
    // 动态读取所有班级 (classXX)，不再硬编码 class08/class18
    Object.keys(preRecordsData).forEach(function(key) {
      if (/^class\d{2}$/.test(key)) {
        var classRecords = preRecordsData[key];
        if (Array.isArray(classRecords)) {
          allPreRecords = allPreRecords.concat(classRecords);
        }
      }
    });
  } catch (e) {
    console.warn('[init-db] pre-records.json not found, skipping pre-records import');
  }

  // 清除旧的预注册名单后重新导入，避免多次 setup 导致 ID 冲突
  db.exec('DELETE FROM pre_records');

  var insertPreRecord = db.prepare(
    'INSERT OR IGNORE INTO pre_records (real_name, user_id, gender) VALUES (@real_name, @user_id, @gender)'
  );

  var insertManyPreRecords = db.transaction(function(records) {
    for (var i = 0; i < records.length; i++) {
      insertPreRecord.run(records[i]);
    }
  });

  insertManyPreRecords(allPreRecords);

  var config = require('../config');
  var adminIds = config.adminUserIds;

  // 班管账号不预创建，由真实用户通过预注册名单注册后自动获得 is_admin=1
  // 此处仅确保已注册的班管用户保持 is_admin=1（如重启/迁移后）
  for (var adi = 0; adi < adminIds.length; adi++) {
    var aid = adminIds[adi];
    var existingAdmin = db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(aid);
    if (existingAdmin) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE user_id = ?').run(aid);
    }
    // 用户尚未注册时不创建占位账号，等用户在注册页面用真实姓名注册
  }

  // 开发者账号：ID 999999，密码通过 DEV_PASSWORD 环境变量设置
  // 仅在 DEV_PASSWORD 有值时创建，用于开发和测试
  var devPassword = process.env.DEV_PASSWORD || '';
  if (devPassword) {
    var devHash = bcrypt.hashSync(devPassword, 10);
    var insertDev = db.prepare(
      'INSERT OR IGNORE INTO users (net_name, real_name, user_id, gender, password_hash, status, is_admin, info_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    insertDev.run('开发者', '开发账号', '999999', '', devHash, 'active', 1, '{"dev":true}');
    console.log('[init-db] Dev account created: 999999');
  }
  // 清理非配置管理员的 is_admin 权限
  var allAdmins = db.prepare('SELECT user_id FROM users WHERE is_admin = 1').all();
  for (var cai = 0; cai < allAdmins.length; cai++) {
    if (adminIds.indexOf(allAdmins[cai].user_id) === -1) {
      db.prepare('UPDATE users SET is_admin = 0 WHERE user_id = ?').run(allAdmins[cai].user_id);
    }
  }

  var insertBroadcast = db.prepare(
    'INSERT OR IGNORE INTO broadcasts (content, priority) VALUES (?, ?)'
  );
  insertBroadcast.run('欢迎使用 ClassNet 系统！', 'normal');

  // 按班级分组预注册成员（动态提取 6 位 YYCCNN 格式中的 CC 班级号）
  var classMembers = {};
  for (var pi = 0; pi < allPreRecords.length; pi++) {
    var pr = allPreRecords[pi];
    var cls = '';
    if (pr.user_id.length === 6 && /^\d{6}$/.test(pr.user_id)) {
      cls = pr.user_id.substring(2, 4);
    } else if (pr.user_id.length === 4 && /^\d{4}$/.test(pr.user_id)) {
      // 兼容旧格式：后两位为班级号
      cls = pr.user_id.substring(2, 4);
    }
    if (cls && cls !== '00') {
      if (!classMembers[cls]) classMembers[cls] = [];
      classMembers[cls].push(pr.user_id);
    }
  }
  // 将班管加入对应班级群
  var classKeys = Object.keys(classMembers);
  for (var ai = 0; ai < adminIds.length; ai++) {
    var aid = adminIds[ai];
    var acc = '';
    if (aid.length === 6 && /^\d{6}$/.test(aid)) {
      acc = aid.substring(2, 4);
    }
    // 班管加入对应班级群
    if (acc && classKeys.indexOf(acc) !== -1 && classMembers[acc].indexOf(aid) === -1) {
      classMembers[acc].push(aid);
    }
  }

  var insertClassGroup = db.prepare(
    'INSERT OR IGNORE INTO groups (id, name, creator_id, members_json) VALUES (?, ?, ?, ?)'
  );
  for (var gi = 0; gi < classKeys.length; gi++) {
    var classNum = classKeys[gi];
    var groupId = 'class_' + classNum;
    var groupName = parseInt(classNum, 10) + '班群';
    insertClassGroup.run(groupId, groupName, adminIds[0] || '000001', JSON.stringify(classMembers[classNum]));
  }

  try {
    db.prepare("DELETE FROM group_messages WHERE group_id = 'cross_class'").run();
    db.prepare("DELETE FROM groups WHERE id = 'cross_class'").run();
  } catch (e) {}

  // 社区系统表
  db.exec([
    'CREATE TABLE IF NOT EXISTS community_posts (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  type TEXT NOT NULL DEFAULT \'forum\',',
    '  title TEXT DEFAULT \'\',',
    '  content TEXT NOT NULL,',
    '  anonymous INTEGER DEFAULT 0,',
    '  visible_groups TEXT DEFAULT \'[]\',',
    '  hidden_groups TEXT DEFAULT \'[]\',',
    '  like_count INTEGER DEFAULT 0,',
    '  comment_count INTEGER DEFAULT 0,',
    '  extra_json TEXT DEFAULT \'{}\',',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS community_comments (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  post_id INTEGER NOT NULL,',
    '  user_id TEXT NOT NULL,',
    '  parent_id INTEGER DEFAULT NULL,',
    '  content TEXT NOT NULL,',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS community_likes (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  target_type TEXT NOT NULL,',
    '  target_id TEXT NOT NULL,',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  UNIQUE(user_id, target_type, target_id)',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS community_groups (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  name TEXT NOT NULL UNIQUE,',
    '  creator_id TEXT DEFAULT NULL,',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS community_bookmarks (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  post_id INTEGER NOT NULL,',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  UNIQUE(user_id, post_id)',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS message_reactions (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  message_id INTEGER NOT NULL,',
    '  message_type TEXT NOT NULL,',
    '  user_id TEXT NOT NULL,',
    '  emoji TEXT NOT NULL,',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  UNIQUE(message_id, message_type, user_id, emoji)',
    ')'
  ].join('\n'));

  // 社区系统索引
  db.exec('CREATE INDEX IF NOT EXISTS idx_community_posts_type ON community_posts(type, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_community_posts_user ON community_posts(user_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_community_comments_post ON community_comments(post_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_community_likes_target ON community_likes(target_type, target_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_community_bookmarks_user ON community_bookmarks(user_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_message_reactions_msg ON message_reactions(message_id, message_type)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS user_experience (',
    '  user_id TEXT PRIMARY KEY,',
    '  exp INTEGER DEFAULT 0,',
    '  level INTEGER DEFAULT 0,',
    '  last_login_date TEXT,',
    '  last_login_exp_given INTEGER DEFAULT 0,',
    '  show_level_community INTEGER DEFAULT 1,',
    '  show_level_chat INTEGER DEFAULT 1,',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  var expColumns = db.prepare("PRAGMA table_info(user_experience)").all();
  var expColNames = expColumns.map(function(c) { return c.name; });
  if (expColNames.indexOf('last_login_date') === -1) {
    db.exec("ALTER TABLE user_experience ADD COLUMN last_login_date TEXT");
  }
  if (expColNames.indexOf('last_login_exp_given') === -1) {
    db.exec("ALTER TABLE user_experience ADD COLUMN last_login_exp_given INTEGER DEFAULT 0");
  }
  if (expColNames.indexOf('last_daily_login') !== -1 && expColNames.indexOf('last_login_date') !== -1) {
    db.prepare("UPDATE user_experience SET last_login_date = last_daily_login WHERE last_login_date IS NULL AND last_daily_login IS NOT NULL").run();
  }
  if (expColNames.indexOf('login_streak') === -1) {
    db.exec("ALTER TABLE user_experience ADD COLUMN login_streak INTEGER DEFAULT 0");
  }
  if (expColNames.indexOf('max_login_streak') === -1) {
    db.exec("ALTER TABLE user_experience ADD COLUMN max_login_streak INTEGER DEFAULT 0");
  }

  db.exec([
    'CREATE TABLE IF NOT EXISTS exp_log (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  action TEXT NOT NULL,',
    '  exp_gained INTEGER NOT NULL,',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec('CREATE INDEX IF NOT EXISTS idx_exp_log_user ON exp_log(user_id, created_at DESC)');

  db.exec("CREATE INDEX IF NOT EXISTS idx_chat_messages_original_id ON chat_messages(json_extract(extra_json, '$.original_id'))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_private_messages_original_id ON private_messages(json_extract(extra_json, '$.original_id'))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_group_messages_original_id ON group_messages(json_extract(extra_json, '$.original_id'))");

  var postsColumns = db.prepare("PRAGMA table_info(community_posts)").all();
  var postsColNames = postsColumns.map(function(c) { return c.name; });
  if (postsColNames.indexOf('share_count') === -1) {
    db.exec("ALTER TABLE community_posts ADD COLUMN share_count INTEGER DEFAULT 0");
  }
  if (postsColNames.indexOf('tags') === -1) {
    db.exec("ALTER TABLE community_posts ADD COLUMN tags TEXT DEFAULT '[]'");
  }
  if (postsColNames.indexOf('featured') === -1) {
    db.exec("ALTER TABLE community_posts ADD COLUMN featured INTEGER DEFAULT 0");
  }

  var commentsColumns = db.prepare("PRAGMA table_info(community_comments)").all();
  var commentsColNames = commentsColumns.map(function(c) { return c.name; });
  if (commentsColNames.indexOf('like_count') === -1) {
    db.exec("ALTER TABLE community_comments ADD COLUMN like_count INTEGER DEFAULT 0");
  }

  db.exec("CREATE TABLE IF NOT EXISTS cloud_notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT DEFAULT '', content TEXT DEFAULT '', tags TEXT DEFAULT '[]', folder TEXT DEFAULT '默认', visibility TEXT DEFAULT 'private', is_pinned INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))");
  db.exec("CREATE TABLE IF NOT EXISTS cloud_note_folders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, name))");

  // 跨班帖子ID映射表（relay post ID remapping）
  db.exec("CREATE TABLE IF NOT EXISTS post_id_mappings (original_id TEXT PRIMARY KEY, local_id INTEGER NOT NULL, source_server TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))");

  // 迁移 community_likes.target_id 从 INTEGER 到 TEXT
  var likesColumns = db.prepare("PRAGMA table_info(community_likes)").all();
  var likesTargetCol = likesColumns.find(function(c) { return c.name === 'target_id'; });
  if (likesTargetCol && likesTargetCol.type === 'INTEGER') {
    db.exec('ALTER TABLE community_likes RENAME TO community_likes_old');
    db.exec([
      'CREATE TABLE community_likes (',
      '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
      '  user_id TEXT NOT NULL,',
      '  target_type TEXT NOT NULL,',
      '  target_id TEXT NOT NULL,',
      '  created_at TEXT DEFAULT (datetime(\'now\')),',
      '  UNIQUE(user_id, target_type, target_id)',
      ')'
    ].join('\n'));
    db.exec('INSERT INTO community_likes (id, user_id, target_type, target_id, created_at) SELECT id, user_id, target_type, CAST(target_id AS TEXT), created_at FROM community_likes_old');
    db.exec('DROP TABLE community_likes_old');
    db.exec('CREATE INDEX IF NOT EXISTS idx_community_likes_target ON community_likes(target_type, target_id)');
  }

  // 默认分组
  var insertDefaultGroup = db.prepare('INSERT OR IGNORE INTO community_groups (name) VALUES (?)');
  insertDefaultGroup.run('男');
  insertDefaultGroup.run('女');

  // 用户 profile 字段迁移
  var userColumns = db.prepare("PRAGMA table_info(users)").all();
  var profileFields = ['wechat', 'qq', 'phone', 'address', 'signature', 'privacy_settings'];
  var existingCols = userColumns.map(function(c) { return c.name; });
  if (existingCols.indexOf('wechat') === -1) {
    db.exec("ALTER TABLE users ADD COLUMN wechat TEXT DEFAULT ''");
    db.exec("ALTER TABLE users ADD COLUMN qq TEXT DEFAULT ''");
    db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''");
    db.exec("ALTER TABLE users ADD COLUMN address TEXT DEFAULT ''");
    db.exec("ALTER TABLE users ADD COLUMN signature TEXT DEFAULT ''");
    db.exec("ALTER TABLE users ADD COLUMN privacy_settings TEXT DEFAULT '{\"wechat\":false,\"qq\":false,\"phone\":false,\"address\":false,\"signature\":false}'");
  }

  var userUpdatedAtCol = existingCols.indexOf('updated_at');
  if (userUpdatedAtCol === -1) {
    db.exec("ALTER TABLE users ADD COLUMN updated_at TEXT DEFAULT NULL");
  }

  var banExpiresCol = existingCols.indexOf('ban_expires_at');
  if (banExpiresCol === -1) {
    db.exec("ALTER TABLE users ADD COLUMN ban_expires_at TEXT DEFAULT NULL");
  }
  var banReasonCol = existingCols.indexOf('ban_reason');
  if (banReasonCol === -1) {
    db.exec("ALTER TABLE users ADD COLUMN ban_reason TEXT DEFAULT NULL");
  }

  var roleCol = existingCols.indexOf('role');
  if (roleCol === -1) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    db.exec("UPDATE users SET role = 'admin' WHERE is_admin = 1");
  }

  var officerPermsCol = existingCols.indexOf('officer_permissions');
  if (officerPermsCol === -1) {
    db.exec("ALTER TABLE users ADD COLUMN officer_permissions TEXT DEFAULT '[]'");
  }

  var officerTitleCol = existingCols.indexOf('officer_title');
  if (officerTitleCol === -1) {
    db.exec("ALTER TABLE users ADD COLUMN officer_title TEXT DEFAULT ''");
  }

  var settingsCols = db.prepare("PRAGMA table_info(user_settings)").all().map(function(c) { return c.name; });
  var resourceSettingsCol = settingsCols.indexOf('resource_settings_json');
  if (resourceSettingsCol === -1) {
    db.exec("ALTER TABLE user_settings ADD COLUMN resource_settings_json TEXT DEFAULT '{\"video_visible\":true,\"music_visible\":true}'");
  }

  var aiSettingsCol = settingsCols.indexOf('ai_settings_json');
  if (aiSettingsCol === -1) {
    db.exec("ALTER TABLE user_settings ADD COLUMN ai_settings_json TEXT DEFAULT '{\"system_prompt\":\"\",\"pinned_conversations\":[],\"model\":\"default\"}'");
  }

  var deepseekEnabledCol = settingsCols.indexOf('deepseek_enabled');
  if (deepseekEnabledCol === -1) {
    db.exec("ALTER TABLE user_settings ADD COLUMN deepseek_enabled INTEGER DEFAULT 0");
  }

  var convPersonaCol = convColNames.indexOf('persona');
  if (convPersonaCol === -1) {
    db.exec("ALTER TABLE conversations ADD COLUMN persona TEXT DEFAULT ''");
  }

  db.exec([
    'CREATE TABLE IF NOT EXISTS user_kv_store (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  key TEXT NOT NULL,',
    '  value TEXT DEFAULT \'\',',
    '  updated_at TEXT DEFAULT (datetime(\'now\')),',
    '  UNIQUE(user_id, key)',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_kv_store_user_key ON user_kv_store(user_id, key)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS sync_watermarks (',
    '  data_type TEXT PRIMARY KEY,',
    '  watermark INTEGER NOT NULL DEFAULT 0,',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS sync_tombstones (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  data_type TEXT NOT NULL,',
    '  record_id TEXT NOT NULL,',
    '  deleted_at TEXT DEFAULT (datetime(\'now\')),',
    '  UNIQUE(data_type, record_id)',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_tombstones_type ON sync_tombstones(data_type, deleted_at)');

  var musicFavCols = [];
  try { musicFavCols = db.prepare("PRAGMA table_info(music_favorites)").all(); } catch (e) {}
  if (musicFavCols.length > 0) {
    var mfColNames = musicFavCols.map(function(c) { return c.name; });
    var mfNeedsMigration = musicFavCols.some(function(c) { return c.name === 'user_id' && c.type === 'INTEGER'; })
      || mfColNames.indexOf('song_file') !== -1;
    if (mfNeedsMigration) {
      db.exec('DROP TABLE IF EXISTS music_favorites');
    }
  }

  var musicPlCols = [];
  try { musicPlCols = db.prepare("PRAGMA table_info(music_playlists)").all(); } catch (e) {}
  if (musicPlCols.length > 0) {
    var mpNeedsMigration = musicPlCols.some(function(c) { return c.name === 'user_id' && c.type === 'INTEGER'; });
    if (mpNeedsMigration) {
      db.exec('DROP TABLE IF EXISTS music_playlist_songs');
      db.exec('DROP TABLE IF EXISTS music_playlists');
    }
  }

  var musicPsCols = [];
  try { musicPsCols = db.prepare("PRAGMA table_info(music_playlist_songs)").all(); } catch (e) {}
  if (musicPsCols.length > 0) {
    var mpsColNames = musicPsCols.map(function(c) { return c.name; });
    var mpsNeedsMigration = mpsColNames.indexOf('song_file') !== -1;
    if (mpsNeedsMigration) {
      db.exec('DROP TABLE IF EXISTS music_playlist_songs');
    }
  }

  db.exec([
    'CREATE TABLE IF NOT EXISTS music_favorites (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  song_id TEXT NOT NULL,',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  UNIQUE(user_id, song_id)',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_music_favorites_user ON music_favorites(user_id)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS music_playlists (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  name TEXT NOT NULL,',
    '  description TEXT DEFAULT \'\',',
    '  cover_url TEXT DEFAULT \'\',',
    '  share_code TEXT DEFAULT \'\',',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_music_playlists_user ON music_playlists(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_music_playlists_share ON music_playlists(share_code)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS music_playlist_songs (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  playlist_id INTEGER NOT NULL,',
    '  song_id TEXT NOT NULL,',
    '  sort_order INTEGER DEFAULT 0,',
    '  added_at TEXT DEFAULT (datetime(\'now\')),',
    '  UNIQUE(playlist_id, song_id),',
    '  FOREIGN KEY (playlist_id) REFERENCES music_playlists(id) ON DELETE CASCADE',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_music_playlist_songs_playlist ON music_playlist_songs(playlist_id)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS weather_alert_settings (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  schedule_time TEXT NOT NULL,',
    '  enabled INTEGER DEFAULT 1,',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS system_settings (',
    '  key TEXT PRIMARY KEY,',
    '  value TEXT NOT NULL,',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)').run('server_mode', 'single');

  // 应用管控表 — 管理员/班干控制每个应用的启用与禁用
  db.exec([
    'CREATE TABLE IF NOT EXISTS app_control (',
    '  app_name TEXT PRIMARY KEY,',
    '  enabled INTEGER DEFAULT 1,',
    '  updated_by TEXT DEFAULT \'\',',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));
  // 初始化 8 个桌面应用的默认启用记录
  var defaultApps = ['chat', 'community', 'ai-chat', 'notes', 'resource', 'weather', 'music', 'settings'];
  var initAppStmt = db.prepare("INSERT OR IGNORE INTO app_control (app_name, enabled) VALUES (?, 1)");
  for (var di = 0; di < defaultApps.length; di++) {
    initAppStmt.run(defaultApps[di]);
  }

  // 上传码表 — 已登录用户生成码，供未登录浏览器免登录上传文件
  db.exec([
    'CREATE TABLE IF NOT EXISTS upload_codes (',
    '  code TEXT PRIMARY KEY,',
    '  owner_id TEXT NOT NULL,',
    '  fail_count INTEGER DEFAULT 0,',
    '  locked_until TEXT DEFAULT NULL,',
    '  created_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_upload_codes_owner ON upload_codes(owner_id)');

  var watermarkTypes = [
    { type: 'chat_messages', query: 'SELECT MAX(id) as max_id FROM chat_messages' },
    { type: 'private_messages', query: 'SELECT MAX(id) as max_id FROM private_messages' },
    { type: 'group_messages', query: 'SELECT MAX(id) as max_id FROM group_messages' },
    { type: 'community_posts', query: 'SELECT MAX(id) as max_id FROM community_posts' },
    { type: 'community_comments', query: 'SELECT MAX(id) as max_id FROM community_comments' },
    { type: 'message_reactions', query: 'SELECT MAX(id) as max_id FROM message_reactions' },
    { type: 'community_bookmarks', query: 'SELECT MAX(id) as max_id FROM community_bookmarks' },
    { type: 'exp_log', query: 'SELECT MAX(id) as max_id FROM exp_log' },
    { type: 'broadcasts', query: 'SELECT MAX(rowid) as max_id FROM broadcasts' }
  ];
  var initWatermarkStmt = db.prepare('INSERT OR IGNORE INTO sync_watermarks (data_type, watermark) VALUES (?, ?)');
  for (var wi = 0; wi < watermarkTypes.length; wi++) {
    try {
      var maxRow = db.prepare(watermarkTypes[wi].query).get();
      var maxId = (maxRow && maxRow.max_id) ? maxRow.max_id : 0;
      initWatermarkStmt.run(watermarkTypes[wi].type, maxId);
    } catch (e) {}
  }
}

module.exports = { initDatabase: initDatabase };

if (require.main === module) {
  initDatabase();
  console.log('Database initialized successfully');
}
