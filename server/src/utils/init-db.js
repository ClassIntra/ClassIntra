// 数据库初始化入口
// 阶段 5 改造：schema 操作已抽取到 migrations/ 目录，由 migration-runner 统一管理
// 本文件保留数据初始化逻辑（预注册、默认应用、watermark、云盘迁移）
//
// 调用顺序：
// 1. migrationRunner.runAll() — 执行所有待执行的 schema 迁移（幂等）
// 2. _initData() — 数据初始化（预注册名单、班管账号、班级群、默认分组、默认应用、watermark）
// 3. runCloudMigration() — 云盘旧文件自动迁移（文件系统操作，幂等）

var db = require('./db');
var bcrypt = require('bcryptjs');
var migrationRunner = require('./migration-runner');

function initDatabase() {
  // ========== 阶段 5：schema 迁移（幂等） ==========
  var result = migrationRunner.runAll();
  if (result.applied > 0) {
    console.log('[init-db] 迁移完成: 应用 ' + result.applied + ' 个，当前版本 v' + result.currentVersion);
  } else {
    console.log('[init-db] schema 已是最新（v' + result.currentVersion + '）');
  }

  // ========== 数据初始化 ==========
  _initData();

  // ========== 云盘旧文件自动迁移 ==========
  runCloudMigration();
}

// 数据初始化：预注册、账号、群组、默认应用、watermark
function _initData() {
  // ========== 预注册名单导入 ==========
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

  // ========== 班管账号 ==========
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

  // ========== 默认广播 ==========
  var insertBroadcast = db.prepare(
    'INSERT OR IGNORE INTO broadcasts (content, priority) VALUES (?, ?)'
  );
  insertBroadcast.run('欢迎使用 ClassIntra 系统！', 'normal');

  // ========== 班级群创建 ==========
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
    var aid2 = adminIds[ai];
    var acc = '';
    if (aid2.length === 6 && /^\d{6}$/.test(aid2)) {
      acc = aid2.substring(2, 4);
    }
    // 班管加入对应班级群
    if (acc && classKeys.indexOf(acc) !== -1 && classMembers[acc].indexOf(aid2) === -1) {
      classMembers[acc].push(aid2);
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

  // 清理旧的 cross_class 跨班群
  try {
    db.prepare("DELETE FROM group_messages WHERE group_id = 'cross_class'").run();
    db.prepare("DELETE FROM groups WHERE id = 'cross_class'").run();
  } catch (e) {}

  // ========== 默认社区分组 ==========
  var insertDefaultGroup = db.prepare('INSERT OR IGNORE INTO community_groups (name) VALUES (?)');
  insertDefaultGroup.run('男');
  insertDefaultGroup.run('女');

  // ========== 系统设置默认值 ==========
  db.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)').run('server_mode', 'single');

  // ========== 默认应用启用 ==========
  // 默认启用应用列表现由 @/core/default-apps-loader 从 apps/*/manifest.json 聚合产生
  var defaultAppsLoader = require('../core/default-apps-loader');
  var defaultApps = defaultAppsLoader.getDefaultApps();
  var initAppStmt = db.prepare("INSERT OR IGNORE INTO app_control (app_name, enabled) VALUES (?, 1)");
  for (var di = 0; di < defaultApps.length; di++) {
    initAppStmt.run(defaultApps[di]);
  }

  // 云盘已合并到资源仓库（apps/cloud/ → apps/resource/），清理孤儿管控记录
  // 幂等：无 cloud 行时 DELETE 不报错
  try {
    db.prepare("DELETE FROM app_control WHERE app_name = 'cloud'").run();
  } catch (e) { /* app_control 表可能尚未创建，忽略 */ }

  // ========== watermark 初始化 ==========
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

// ========== 云盘旧文件自动迁移 ==========
function runCloudMigration() {
  var fs = require('fs');
  var path = require('path');
  var crypto = require('crypto');

  // 检查是否已迁移
  var migrated = db.prepare("SELECT value FROM system_settings WHERE key = 'cloud_migration_done'").get();
  if (migrated && migrated.value === '1') {
    return;
  }

  var resourcesDir = process.env.RESOURCES_DIR || path.join(__dirname, '../../../Resources');
  var cloudDir = path.resolve(resourcesDir, 'cloud');
  var sharedDir = path.join(cloudDir, 'shared');

  if (!fs.existsSync(cloudDir)) {
    // 没有云盘目录，标记完成
    db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('cloud_migration_done', '1')").run();
    return;
  }

  console.log('[CloudMigration] 开始云盘文件迁移...');

  // 确保共享目录存在
  if (!fs.existsSync(sharedDir)) {
    fs.mkdirSync(sharedDir, { recursive: true });
  }

  var totalMigrated = 0;
  var totalDuplicates = 0;
  var totalErrors = 0;

  try {
    var entries = fs.readdirSync(cloudDir);
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      // 跳过非用户目录（shared, .tmp, .trash, .gitkeep 等）
      if (entry === 'shared' || entry === '.tmp' || entry === '.trash' || entry.startsWith('.')) continue;
      // 只处理纯数字命名的用户目录
      if (!/^\d+$/.test(entry)) continue;

      var userDir = path.join(cloudDir, entry);
      var photoDir = path.join(userDir, 'photos');
      if (!fs.existsSync(photoDir)) continue;

      var userId = entry;
      var photoFiles;
      try {
        photoFiles = fs.readdirSync(photoDir);
      } catch (e) {
        continue;
      }

      for (var j = 0; j < photoFiles.length; j++) {
        var filename = photoFiles[j];
        var filePath = path.join(photoDir, filename);
        var stat;
        try { stat = fs.statSync(filePath); } catch (e) { continue; }
        if (!stat.isFile()) continue;

        try {
          // 计算 SHA-256
          var hash = computeFileHashSync(filePath);
          var ext = path.extname(filename).toLowerCase();
          var mimeType = guessMimeType(ext, filename);

          // 检查是否已存在
          var existing = db.prepare('SELECT hash, owner_user_id FROM cloud_files WHERE hash = ?').get(hash);

          if (existing) {
            // 重复文件：只建引用
            db.prepare('INSERT OR IGNORE INTO cloud_user_files (user_id, file_hash, display_name) VALUES (?, ?, ?)').run(userId, hash, filename);
            // 记录旧 URL 映射
            db.prepare('INSERT OR IGNORE INTO cloud_old_url_map (old_filename, file_hash) VALUES (?, ?)').run(filename, hash);
            // 删除原文件
            try { fs.unlinkSync(filePath); } catch (e) {}
            totalDuplicates++;
          } else {
            // 新文件：移动到 shared/
            var prefix = hash.substring(0, 2);
            var prefixDir = path.join(sharedDir, prefix);
            if (!fs.existsSync(prefixDir)) fs.mkdirSync(prefixDir, { recursive: true });
            var newFilename = hash + ext;
            var destPath = path.join(prefixDir, newFilename);
            var storagePath = prefix + '/' + newFilename;

            fs.renameSync(filePath, destPath);

            // 创建数据库记录
            db.prepare('INSERT INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path) VALUES (?, ?, ?, ?, ?, ?)').run(hash, userId, filename, stat.size, mimeType, storagePath);
            db.prepare('INSERT OR IGNORE INTO cloud_user_files (user_id, file_hash, display_name) VALUES (?, ?, ?)').run(userId, hash, filename);
            // 记录旧 URL 映射
            db.prepare('INSERT OR IGNORE INTO cloud_old_url_map (old_filename, file_hash) VALUES (?, ?)').run(filename, hash);

            totalMigrated++;
          }
        } catch (e) {
          console.error('[CloudMigration] 迁移文件失败:', filePath, e.message);
          totalErrors++;
        }
      }
    }
  } catch (e) {
    console.error('[CloudMigration] 遍历云盘目录失败:', e.message);
  }

  console.log('[CloudMigration] 迁移完成: 新文件=' + totalMigrated + ', 去重=' + totalDuplicates + ', 失败=' + totalErrors);

  // 标记迁移完成
  db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('cloud_migration_done', '1')").run();
}

// 同步计算文件 SHA-256（迁移时使用，比流式简单）
function computeFileHashSync(filePath) {
  var crypto = require('crypto');
  var fs = require('fs');
  var hash = crypto.createHash('sha256');
  var buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

// 根据扩展名和文件名猜测 MIME 类型
function guessMimeType(ext, filename) {
  var lower = (filename || '').toLowerCase();
  // 优先文件名中的类型标记
  if (lower.indexOf('__audio') > -1) return 'audio/webm';
  if (lower.indexOf('__video') > -1) return 'video/webm';
  if (lower.indexOf('__image') > -1) return 'image/' + (ext.replace('.', '') || 'png');
  // 回退到扩展名
  var MIME_MAP = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/opus',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
    '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.3gp': 'video/3gpp'
  };
  return MIME_MAP[ext] || 'application/octet-stream';
}

module.exports = { initDatabase: initDatabase };

if (require.main === module) {
  initDatabase();
  console.log('Database initialized successfully');
}
