// 数据库迁移执行引擎
// 负责按版本顺序执行 migrations/ 目录下的迁移文件，并记录到 schema_version 表
//
// 设计要点：
// 1. ensureSchemaVersionTable 确保 schema_version 表存在（bootstrap）
// 2. getCurrentVersion 读取已执行的最大版本号
// 3. runAll 扫描 migrations/ 目录，按文件名排序，执行 version > current 的迁移
// 4. 每个迁移在事务中执行，失败则回滚并中止后续迁移
// 5. 迁移文件必须导出 { version, name, up(db) } 结构
// 6. 所有迁移必须幂等（CREATE TABLE IF NOT EXISTS / ALTER TABLE 前检查列存在）

var db = require('./db');
var fs = require('fs');
var path = require('path');

var MIGRATIONS_DIR = path.join(__dirname, '../migrations');

// 确保 schema_version 表存在（bootstrap）
function ensureSchemaVersionTable() {
  db.exec([
    'CREATE TABLE IF NOT EXISTS schema_version (',
    '  version INTEGER PRIMARY KEY,',
    '  name TEXT NOT NULL,',
    '  applied_at TEXT DEFAULT (datetime(\'now\'))',
    ')'
  ].join('\n'));
}

// 获取当前已执行的最新版本号
// 返回 -1 表示无任何迁移记录（全新库或首次启用迁移系统）
function getCurrentVersion() {
  ensureSchemaVersionTable();
  var row = db.prepare('SELECT MAX(version) as max_version FROM schema_version').get();
  if (!row || row.max_version === null) {
    return -1;
  }
  return row.max_version;
}

// 加载 migrations/ 目录下所有迁移文件
// 按文件名排序（即版本号顺序）
function loadMigrations() {
  var migrations = [];
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return migrations;
  }
  var files = fs.readdirSync(MIGRATIONS_DIR).filter(function(f) {
    return f.endsWith('.js');
  });
  files.sort();
  for (var i = 0; i < files.length; i++) {
    var filePath = path.join(MIGRATIONS_DIR, files[i]);
    var mod = require(filePath);
    if (!mod || typeof mod.up !== 'function' || typeof mod.version !== 'number') {
      console.warn('[migration-runner] 跳过无效迁移文件:', files[i], '(缺少 version 或 up)');
      continue;
    }
    migrations.push({
      version: mod.version,
      name: mod.name || files[i],
      up: mod.up,
      file: files[i]
    });
  }
  return migrations;
}

// 执行所有待执行的迁移
// 返回 { applied: number, currentVersion: number, migrations: string[] }
function runAll() {
  ensureSchemaVersionTable();
  var currentVersion = getCurrentVersion();
  var migrations = loadMigrations();
  var applied = [];
  var insertRecord = db.prepare('INSERT OR IGNORE INTO schema_version (version, name) VALUES (?, ?)');

  for (var i = 0; i < migrations.length; i++) {
    var m = migrations[i];
    if (m.version <= currentVersion) {
      continue;
    }
    console.log('[migration] 执行迁移 v' + m.version + ' ' + m.name + ' (' + m.file + ')');
    var tx = db.transaction(function() {
      m.up(db);
      insertRecord.run(m.version, m.name);
    });
    try {
      tx();
      applied.push('v' + m.version + ' ' + m.name);
      console.log('[migration] ✓ v' + m.version + ' ' + m.name + ' 完成');
    } catch (e) {
      console.error('[migration] ✗ v' + m.version + ' ' + m.name + ' 失败:', e.message);
      console.error('[migration] 中止后续迁移，请检查并修复后重试');
      throw e;
    }
  }

  var newVersion = getCurrentVersion();
  return {
    applied: applied.length,
    currentVersion: newVersion,
    migrations: applied
  };
}

// 查询迁移历史（管理员/调试用）
function getMigrationHistory() {
  ensureSchemaVersionTable();
  return db.prepare('SELECT version, name, applied_at FROM schema_version ORDER BY version ASC').all();
}

module.exports = {
  ensureSchemaVersionTable: ensureSchemaVersionTable,
  getCurrentVersion: getCurrentVersion,
  loadMigrations: loadMigrations,
  runAll: runAll,
  getMigrationHistory: getMigrationHistory,
  MIGRATIONS_DIR: MIGRATIONS_DIR
};
