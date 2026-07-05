// 迁移 v0：基线 schema
// 一次性抽取自原 init-db.js 的所有 CREATE TABLE / ALTER TABLE / CREATE INDEX
// 此迁移执行后，数据库 schema 与改造前完全等价
//
// 幂等性：所有 CREATE TABLE 使用 IF NOT EXISTS，所有 ALTER TABLE 前用 PRAGMA table_info 检查列是否存在
// 因此对现有数据库执行不会报错，对全新数据库会创建全部表

function up(db) {
  // ========== 核心用户表 ==========
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

  // ========== 聊天系统表 ==========
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

  // ========== 核心索引 ==========
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_real_name ON users(real_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_net_name ON users(net_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_private_messages_parties ON private_messages(sender_id, receiver_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at)');

  // ========== conversations 增量列迁移 ==========
  var convColumns = db.prepare("PRAGMA table_info(conversations)").all();
  var convColNames = convColumns.map(function(c) { return c.name; });
  if (convColNames.indexOf('summary') === -1) {
    db.exec("ALTER TABLE conversations ADD COLUMN summary TEXT DEFAULT ''");
  }
  if (convColNames.indexOf('summary_at') === -1) {
    db.exec("ALTER TABLE conversations ADD COLUMN summary_at TEXT DEFAULT NULL");
  }
  if (convColNames.indexOf('persona') === -1) {
    db.exec("ALTER TABLE conversations ADD COLUMN persona TEXT DEFAULT ''");
  }

  // ========== user_settings 增量列迁移 ==========
  var settingsCols = db.prepare("PRAGMA table_info(user_settings)").all().map(function(c) { return c.name; });
  if (settingsCols.indexOf('ai_settings_json') === -1) {
    db.exec("ALTER TABLE user_settings ADD COLUMN ai_settings_json TEXT DEFAULT '{\"system_prompt\":\"\",\"pinned_conversations\":[]}'");
  }
  if (settingsCols.indexOf('resource_settings_json') === -1) {
    db.exec("ALTER TABLE user_settings ADD COLUMN resource_settings_json TEXT DEFAULT '{\"video_visible\":true,\"music_visible\":true}'");
  }
  if (settingsCols.indexOf('deepseek_enabled') === -1) {
    db.exec("ALTER TABLE user_settings ADD COLUMN deepseek_enabled INTEGER DEFAULT 0");
  }
  if (settingsCols.indexOf('desktop_layout_json') === -1) {
    db.exec("ALTER TABLE user_settings ADD COLUMN desktop_layout_json TEXT DEFAULT NULL");
  }
  // ai_settings_json 默认值升级（含 model 字段）
  // 注：此 UPDATE 仅对使用默认值的行生效，不影响用户已自定义的设置
  try {
    db.prepare("UPDATE user_settings SET ai_settings_json = '{\"system_prompt\":\"\",\"pinned_conversations\":[],\"model\":\"default\"}' WHERE ai_settings_json = '{\"system_prompt\":\"\",\"pinned_conversations\":[]}'").run();
  } catch (e) {}

  // ========== groups 增量列迁移 ==========
  var columns = db.prepare("PRAGMA table_info(groups)").all();
  var hasAnnouncement = columns.some(function(c) { return c.name === 'announcement'; });
  if (!hasAnnouncement) {
    db.exec("ALTER TABLE groups ADD COLUMN announcement TEXT DEFAULT ''");
    db.exec("ALTER TABLE groups ADD COLUMN announcement_at TEXT DEFAULT NULL");
  }

  // ========== 聊天消息增量列迁移 ==========
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

  // ========== 社区系统表 ==========
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

  // ========== 用户经验系统 ==========
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

  // ========== 聊天消息 original_id 索引（基于 JSON 提取） ==========
  db.exec("CREATE INDEX IF NOT EXISTS idx_chat_messages_original_id ON chat_messages(json_extract(extra_json, '$.original_id'))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_private_messages_original_id ON private_messages(json_extract(extra_json, '$.original_id'))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_group_messages_original_id ON group_messages(json_extract(extra_json, '$.original_id'))");

  // ========== 社区帖子增量列迁移 ==========
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

  // ========== 云笔记 ==========
  db.exec("CREATE TABLE IF NOT EXISTS cloud_notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT DEFAULT '', content TEXT DEFAULT '', tags TEXT DEFAULT '[]', folder TEXT DEFAULT '默认', visibility TEXT DEFAULT 'private', is_pinned INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))");
  db.exec("CREATE TABLE IF NOT EXISTS cloud_note_folders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, name))");

  // cloud_notes 增量迁移：画板数据 + 笔记类型
  try { db.exec("ALTER TABLE cloud_notes ADD COLUMN canvas_data TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE cloud_notes ADD COLUMN type TEXT DEFAULT 'note'"); } catch(e) {}

  // ========== 云盘去重存储 ==========
  db.exec([
    'CREATE TABLE IF NOT EXISTS cloud_files (',
    '  hash TEXT PRIMARY KEY,',
    '  owner_user_id TEXT NOT NULL,',
    '  original_name TEXT NOT NULL,',
    '  size INTEGER NOT NULL,',
    '  mime_type TEXT NOT NULL,',
    '  storage_path TEXT NOT NULL,',
    '  deleted INTEGER NOT NULL DEFAULT 0,',
    '  created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_cf_owner ON cloud_files(owner_user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cf_deleted ON cloud_files(deleted)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS cloud_user_files (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  file_hash TEXT NOT NULL,',
    '  display_name TEXT NOT NULL,',
    '  folder TEXT NOT NULL DEFAULT \'\',',
    '  uploaded_at TEXT NOT NULL DEFAULT (datetime(\'now\')),',
    '  FOREIGN KEY (file_hash) REFERENCES cloud_files(hash),',
    '  UNIQUE(user_id, file_hash, folder)',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_cuf_user ON cloud_user_files(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cuf_user_folder ON cloud_user_files(user_id, folder)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cuf_hash ON cloud_user_files(file_hash)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS cloud_old_url_map (',
    '  old_filename TEXT PRIMARY KEY,',
    '  file_hash TEXT NOT NULL,',
    '  created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS cloud_folders (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  name TEXT NOT NULL,',
    '  share_code TEXT DEFAULT NULL,',
    '  created_at TEXT NOT NULL DEFAULT (datetime(\'now\')),',
    '  UNIQUE(user_id, name)',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_cfolders_user ON cloud_folders(user_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cfolders_share ON cloud_folders(share_code) WHERE share_code IS NOT NULL');
  // 迁移：添加 hide_from_all 列
  try { db.exec('ALTER TABLE cloud_folders ADD COLUMN hide_from_all INTEGER NOT NULL DEFAULT 0'); } catch (e) {}

  // ========== CC 帖子 ID 映射 ==========
  db.exec("CREATE TABLE IF NOT EXISTS post_id_mappings (original_id TEXT PRIMARY KEY, local_id INTEGER NOT NULL, source_server TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))");

  // ========== community_likes 类型迁移（INTEGER → TEXT） ==========
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

  // ========== 用户 profile 字段迁移 ==========
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

  if (existingCols.indexOf('updated_at') === -1) {
    db.exec("ALTER TABLE users ADD COLUMN updated_at TEXT DEFAULT NULL");
  }
  if (existingCols.indexOf('ban_expires_at') === -1) {
    db.exec("ALTER TABLE users ADD COLUMN ban_expires_at TEXT DEFAULT NULL");
  }
  if (existingCols.indexOf('ban_reason') === -1) {
    db.exec("ALTER TABLE users ADD COLUMN ban_reason TEXT DEFAULT NULL");
  }
  if (existingCols.indexOf('role') === -1) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    db.exec("UPDATE users SET role = 'admin' WHERE is_admin = 1");
  }
  if (existingCols.indexOf('officer_permissions') === -1) {
    db.exec("ALTER TABLE users ADD COLUMN officer_permissions TEXT DEFAULT '[]'");
  }
  if (existingCols.indexOf('officer_title') === -1) {
    db.exec("ALTER TABLE users ADD COLUMN officer_title TEXT DEFAULT ''");
  }

  // ========== KV 存储 + 同步水位 ==========
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

  // ========== 音乐系统（旧表清理 + 重建） ==========
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

  // ========== 天气预警 + 系统设置 ==========
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

  // ========== 应用管控表 ==========
  db.exec([
    'CREATE TABLE IF NOT EXISTS app_control (',
    '  app_name TEXT PRIMARY KEY,',
    '  enabled INTEGER DEFAULT 1,',
    '  updated_by TEXT DEFAULT \'\',',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));

  // ========== 日历事件表 ==========
  db.exec([
    'CREATE TABLE IF NOT EXISTS calendar_events (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  title TEXT NOT NULL,',
    '  description TEXT DEFAULT \'\',',
    '  event_date TEXT NOT NULL,',
    '  start_time TEXT DEFAULT \'\',',
    '  end_time TEXT DEFAULT \'\',',
    '  category TEXT DEFAULT \'general\',',
    '  color TEXT DEFAULT \'\',',
    '  reminder_minutes INTEGER DEFAULT 0,',
    '  reminded INTEGER DEFAULT 0,',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_cal_events_user ON calendar_events(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cal_events_date ON calendar_events(event_date)');

  // ========== 倒数日事件表 ==========
  db.exec([
    'CREATE TABLE IF NOT EXISTS countdown_events (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id TEXT NOT NULL,',
    '  title TEXT NOT NULL,',
    '  target_date TEXT NOT NULL,',
    '  category TEXT DEFAULT \'anniversary\',',
    '  color TEXT DEFAULT \'\',',
    '  icon TEXT DEFAULT \'\',',
    '  pinned INTEGER DEFAULT 0,',
    '  repeat_type TEXT DEFAULT \'none\',',
    '  reminder_minutes INTEGER DEFAULT 0,',
    '  reminded INTEGER DEFAULT 0,',
    '  note TEXT DEFAULT \'\',',
    '  created_at TEXT DEFAULT (datetime(\'now\')),',
    '  updated_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_cd_events_user ON countdown_events(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cd_events_date ON countdown_events(target_date)');

  // ========== P3: 倒数日 ↔ 日历双向联动字段 ==========
  try {
    var cdCols = db.prepare("PRAGMA table_info(countdown_events)").all().map(function(c) { return c.name; });
    if (cdCols.indexOf('show_in_calendar') === -1) {
      db.exec("ALTER TABLE countdown_events ADD COLUMN show_in_calendar INTEGER DEFAULT 0");
    }
  } catch (e) { console.error('[migration:000] countdown_events.show_in_calendar 迁移失败:', e.message); }
  try {
    var calCols = db.prepare("PRAGMA table_info(calendar_events)").all().map(function(c) { return c.name; });
    if (calCols.indexOf('show_in_countdown') === -1) {
      db.exec("ALTER TABLE calendar_events ADD COLUMN show_in_countdown INTEGER DEFAULT 0");
    }
  } catch (e) { console.error('[migration:000] calendar_events.show_in_countdown 迁移失败:', e.message); }

  // ========== 上传码表 ==========
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
}

module.exports = {
  version: 0,
  name: 'baseline',
  up: up
};
