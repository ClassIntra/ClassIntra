// 学元账本 · 建表脚本（独立执行，不进 server/src/migrations/）
// 用法：
//   node server/scripts/ledger-init.cjs                 # 用 config 默认库（⚠️ 会动生产库）
//   node server/scripts/ledger-init.cjs ../tmp/x.db     # 指定库文件（推荐先跑副本）
//   DB_PATH=... node server/scripts/ledger-init.cjs
//
// 幂等：所有表 IF NOT EXISTS，资产 INSERT OR IGNORE，系统账户按 (kind, owner) 去重。

var fs = require('fs');
var path = require('path');

var arg = process.argv[2];
if (arg) process.env.DB_PATH = path.resolve(arg);

var db = require('../src/utils/db');
var assets = require('../src/ledger/assets');
var ledger = require('../src/ledger/ledger');
var invariants = require('../src/ledger/invariants');

var dbFile = process.env.DB_PATH || require('../src/config').dbPath;

console.log('\n=== 学元账本 建表 ===');
console.log('目标库:', dbFile);

var schemaPath = path.join(__dirname, '..', 'src', 'ledger', 'schema.sql');
var schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

var tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'xy_ledger_%' ORDER BY name").all();
console.log('✓ 表:', tables.map(function (t) { return t.name; }).join(', '));

var seeded = assets.seed(db);
console.log('✓ 资产: 共 ' + seeded.total + ' 种，本次新增 ' + seeded.created);

[['platform', ''], ['escrow', 'orders'], ['escrow', 'packets'], ['clearing', '']].forEach(function (pair) {
  var acc = ledger.systemAccount(pair[0], pair[1]);
  console.log('✓ 系统账户: ' + pair[0] + (pair[1] ? ':' + pair[1] : '') +
    ' #' + acc.id + (acc.allow_negative ? '（允许负余额）' : ''));
});

var report = invariants.check({});
console.log('✓ 自检: ' + (report.ok ? '全部通过' : report.issues.length + ' 项异常'));
report.issues.forEach(function (i) { console.log('  ✗ [' + i.code + '] ' + i.detail); });

process.exit(report.ok ? 0 : 1);
