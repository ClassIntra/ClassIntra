var Database = require('better-sqlite3');
var path = require('path');
var fs = require('fs');
var config = require('../config');

var dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

var db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');
db.pragma('temp_store = MEMORY');

// ---- Statement 缓存 ----
// 全仓 1169 处 db.prepare()，better-sqlite3 每次都重新编译 SQL。按 SQL 字符串复用
// Statement 即可让所有调用点零改动受益（run/get/all 每次重新绑定参数，无共享状态）。
// ⚠️ 已核实全仓 0 处 .pluck()/.raw()/.expand()/.safeIntegers() —— 这些会改
//    Statement 自身模式，一旦引入就不能全局缓存，必须先撤掉这一层。
// CI_SQL_CACHE=0 可一键关闭（排障 / 兼容性回退）。
var STMT_CACHE_MAX = 2000;
var stmtCache = new Map();
var stmtCacheEnabled = process.env.CI_SQL_CACHE !== '0';
var rawPrepare = db.prepare.bind(db);

db.prepare = function (sql) {
  if (!stmtCacheEnabled || typeof sql !== 'string') return rawPrepare(sql);
  var hit = stmtCache.get(sql);
  if (hit) return hit;
  var stmt = rawPrepare(sql);
  if (stmtCache.size >= STMT_CACHE_MAX) {
    var oldest = stmtCache.keys().next().value;
    stmtCache.delete(oldest);
  }
  stmtCache.set(sql, stmt);
  return stmt;
};

module.exports = db;
