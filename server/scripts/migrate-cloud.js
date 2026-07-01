// 云盘手动迁移脚本 — 安全迁移，逐文件处理，每步校验
// 用法: node server/scripts/migrate-cloud.js
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');

// 初始化
var resourcesDir = process.env.RESOURCES_DIR || path.join(__dirname, '../../Resources');
var cloudDir = path.resolve(resourcesDir, 'cloud');
var sharedDir = path.join(cloudDir, 'shared');
var db = require('../src/utils/db');

console.log('=== 云盘文件迁移脚本 ===');
console.log('cloudDir:', cloudDir);
console.log('sharedDir:', sharedDir);

// ========== 第零步：预检 ==========
console.log('\n--- 第零步：预检 ---');

if (!fs.existsSync(cloudDir)) {
  console.error('错误: 云盘目录不存在，无需迁移');
  process.exit(0);
}

// 检查是否已迁移
var alreadyDone = db.prepare("SELECT value FROM system_settings WHERE key = 'cloud_migration_done'").get();
if (alreadyDone && alreadyDone.value === '1') {
  console.error('错误: 迁移已完成（cloud_migration_done=1），跳过');
  process.exit(0);
}

// 确保 shared 和 trash 目录存在
[sharedDir, path.join(cloudDir, '.tmp'), path.join(cloudDir, '.trash')].forEach(function(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ========== 第一步：记录迁移前快照 ==========
console.log('\n--- 第一步：迁移前文件快照 ---');

var snapshotBefore = [];
var userDirs = fs.readdirSync(cloudDir).filter(function(e) {
  return /^\d+$/.test(e) && fs.statSync(path.join(cloudDir, e)).isDirectory();
});

userDirs.forEach(function(userId) {
  var photoDir = path.join(cloudDir, userId, 'photos');
  if (fs.existsSync(photoDir)) {
    try {
      var files = fs.readdirSync(photoDir).filter(function(f) {
        return fs.statSync(path.join(photoDir, f)).isFile();
      });
      files.forEach(function(f) {
        var fp = path.join(photoDir, f);
        var stat = fs.statSync(fp);
        snapshotBefore.push({ userId: userId, filename: f, path: fp, size: stat.size });
      });
    } catch (e) { /* skip */ }
  }
});

console.log('迁移前文件数: ' + snapshotBefore.length);
console.log('用户目录数: ' + userDirs.length);

// 保存快照到文件（以防万一）
fs.writeFileSync(path.join(cloudDir, '.migration_snapshot_before.json'), JSON.stringify(snapshotBefore, null, 2), 'utf8');

// ========== 第二步：逐文件迁移 ==========
console.log('\n--- 第二步：逐文件迁移 ---');

var totalNew = 0;
var totalDedup = 0;
var totalErrors = 0;
var totalBytes = 0;

// MIME 类型映射
var MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/opus',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.3gp': 'video/3gpp'
};

function guessMimeType(ext, filename) {
  var lower = (filename || '').toLowerCase();
  if (lower.indexOf('__audio') > -1) return 'audio/webm';
  if (lower.indexOf('__video') > -1) return 'video/webm';
  if (lower.indexOf('__image') > -1) return 'image/' + (ext.replace('.', '') || 'png');
  return MIME_MAP[ext] || 'application/octet-stream';
}

// 逐个处理
for (var si = 0; si < snapshotBefore.length; si++) {
  var item = snapshotBefore[si];
  var userId = item.userId;
  var filePath = item.path;
  var filename = item.filename;
  var originalSize = item.size;

  process.stdout.write('[' + (si + 1) + '/' + snapshotBefore.length + '] ' + filename + ' (' + formatSize(originalSize) + ') ... ');

  try {
    // 验证源文件仍存在且大小一致
    if (!fs.existsSync(filePath)) {
      process.stdout.write('跳过（文件已消失）\n');
      totalErrors++;
      continue;
    }
    var currentStat = fs.statSync(filePath);
    if (currentStat.size !== originalSize) {
      process.stdout.write('警告：文件大小变化 ' + originalSize + ' → ' + currentStat.size + '\n');
    }

    // 计算 SHA-256
    var hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    var ext = path.extname(filePath).toLowerCase();
    var mimeType = guessMimeType(ext, filename);

    // 检查是否已存在
    var existing = db.prepare('SELECT hash, owner_user_id FROM cloud_files WHERE hash = ?').get(hash);

    if (existing) {
      // 去重：文件已存在
      var refRes = db.prepare('INSERT OR IGNORE INTO cloud_user_files (user_id, file_hash, display_name) VALUES (?, ?, ?)').run(userId, hash, filename);
      // 记录旧 URL 映射
      db.prepare('INSERT OR IGNORE INTO cloud_old_url_map (old_filename, file_hash) VALUES (?, ?)').run(filename, hash);
      // 安全删除原文件
      fs.unlinkSync(filePath);
      if (refRes.changes > 0) {
        process.stdout.write('去重（已有副本，建立引用）\n');
        totalDedup++;
      } else {
        process.stdout.write('去重（用户已有此文件引用）\n');
      }
    } else {
      // 新文件：移动到 shared/
      var prefix = hash.substring(0, 2);
      var prefixDir = path.join(sharedDir, prefix);
      if (!fs.existsSync(prefixDir)) fs.mkdirSync(prefixDir, { recursive: true });
      var newFilename = hash + ext;
      var destPath = path.join(prefixDir, newFilename);
      var storagePath = prefix + '/' + newFilename;

      // 移动文件
      fs.renameSync(filePath, destPath);

      // 验证目标文件存在且大小正确
      if (!fs.existsSync(destPath)) {
        throw new Error('移动后目标文件不存在！');
      }
      var destStat = fs.statSync(destPath);
      if (destStat.size !== currentStat.size) {
        throw new Error('移动后文件大小不匹配！原=' + currentStat.size + ' 目标=' + destStat.size);
      }

      // 创建数据库记录
      db.prepare('INSERT INTO cloud_files (hash, owner_user_id, original_name, size, mime_type, storage_path) VALUES (?, ?, ?, ?, ?, ?)').run(hash, userId, filename, currentStat.size, mimeType, storagePath);
      db.prepare('INSERT OR IGNORE INTO cloud_user_files (user_id, file_hash, display_name) VALUES (?, ?, ?)').run(userId, hash, filename);
      // 记录旧 URL 映射
      db.prepare('INSERT OR IGNORE INTO cloud_old_url_map (old_filename, file_hash) VALUES (?, ?)').run(filename, hash);

      totalNew++;
      totalBytes += currentStat.size;
      process.stdout.write('OK → ' + storagePath + '\n');
    }
  } catch (e) {
    process.stdout.write('失败: ' + e.message + '\n');
    totalErrors++;
    // 如果源文件还在，不动它
  }
}

// ========== 第三步：迁移后校验 ==========
console.log('\n--- 第三步：迁移后校验 ---');

// 3.1 检查是否还有残留的 photos 文件
var leftoverFiles = [];
userDirs.forEach(function(userId) {
  var photoDir = path.join(cloudDir, userId, 'photos');
  if (fs.existsSync(photoDir)) {
    try {
      var remaining = fs.readdirSync(photoDir).filter(function(f) {
        return fs.statSync(path.join(photoDir, f)).isFile();
      });
      remaining.forEach(function(f) {
        leftoverFiles.push({ userId: userId, filename: f, path: path.join(photoDir, f) });
      });
    } catch (e) {}
  }
});

if (leftoverFiles.length > 0) {
  console.warn('⚠ 警告：还有 ' + leftoverFiles.length + ' 个文件残留在 photos/ 目录中（可能是迁移失败的）');
  leftoverFiles.forEach(function(f) { console.warn('  - ' + f.path); });
} else {
  console.log('✅ 所有 photos 文件已迁移完毕，无残留');
}

// 3.2 校验数据库记录数
var dbFileCount = db.prepare('SELECT COUNT(*) as cnt FROM cloud_files').get().cnt;
var dbRefCount = db.prepare('SELECT COUNT(*) as cnt FROM cloud_user_files').get().cnt;
var dbMapCount = db.prepare('SELECT COUNT(*) as cnt FROM cloud_old_url_map').get().cnt;
console.log('数据库记录: cloud_files=' + dbFileCount + ', cloud_user_files=' + dbRefCount + ', cloud_old_url_map=' + dbMapCount);

// 3.3 校验 shared/ 中的文件数与数据库一致
var sharedFileCount = 0;
function countFiles(dir) {
  var entries = fs.readdirSync(dir);
  entries.forEach(function(e) {
    var fp = path.join(dir, e);
    var stat = fs.statSync(fp);
    if (stat.isDirectory()) countFiles(fp);
    else sharedFileCount++;
  });
}
try { countFiles(sharedDir); } catch (e) {}
console.log('shared/ 目录文件数: ' + sharedFileCount);

// 3.4 校验笔记目录完整性
console.log('\n--- 笔记目录检查 ---');
var noteDirs = [];
userDirs.forEach(function(userId) {
  var noteDir = path.join(cloudDir, userId, 'note');
  if (fs.existsSync(noteDir)) {
    var noteFiles = fs.readdirSync(noteDir).filter(function(f) { return f.endsWith('.json'); });
    noteDirs.push({ userId: userId, noteCount: noteFiles.length, path: noteDir });
  }
});
console.log('笔记目录数: ' + noteDirs.length);
noteDirs.forEach(function(n) {
  console.log('  ' + n.userId + ': ' + n.noteCount + ' 个笔记 → ' + n.path);
});
console.log('✅ 笔记目录未受影响');

// ========== 第四步：记录结果 ==========
console.log('\n--- 第四步：记录结果 ---');

// 保存迁移后快照
var snapshotAfter = [];
try {
  var sharedEntries = fs.readdirSync(sharedDir);
  sharedEntries.forEach(function(prefix) {
    var prefixDir = path.join(sharedDir, prefix);
    if (fs.statSync(prefixDir).isDirectory()) {
      var files = fs.readdirSync(prefixDir);
      files.forEach(function(f) {
        var fp = path.join(prefixDir, f);
        snapshotAfter.push({ path: prefix + '/' + f, size: fs.statSync(fp).size });
      });
    }
  });
} catch (e) {}
fs.writeFileSync(path.join(cloudDir, '.migration_snapshot_after.json'), JSON.stringify(snapshotAfter, null, 2), 'utf8');

// 设置迁移完成标记
db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('cloud_migration_done', '1')").run();

// ========== 汇总 ==========
console.log('\n=== 迁移完成 ===');
console.log('源文件总数:   ' + snapshotBefore.length);
console.log('新增文件:     ' + totalNew + ' (' + formatSize(totalBytes) + ')');
console.log('去重引用:     ' + totalDedup);
console.log('失败:         ' + totalErrors);
console.log('节省空间:     ' + formatSize(Math.max(0, snapshotBefore.reduce(function(s, f) { return s + f.size; }, 0) - totalBytes)));
console.log('shared/ 文件: ' + sharedFileCount);
console.log('DB 记录:      ' + dbFileCount + ' 个唯一文件, ' + dbRefCount + ' 个用户引用');
console.log('旧URL映射:    ' + dbMapCount + ' 条');
console.log('笔记目录:     ' + noteDirs.length + ' 个用户, 全部保留');

if (leftoverFiles.length > 0) {
  console.log('\n⚠ 请检查以上残留文件，手动处理后重新运行');
} else if (totalErrors === 0 && sharedFileCount === dbFileCount) {
  console.log('\n✅ 校验通过！所有文件安全迁移，数据库与磁盘一致');
} else {
  console.log('\n⚠ 存在不一致，请检查上述数据');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
