// 迁移 036：把学元账本的物理表纳入迁移体系
//
// ---- 为什么现在才放进 migrations/ ----
// 建表语句原来是独立脚本 scripts/ledger-init.cjs，理由是「不要在 schema 没定稿时
// 让 PM2 自动重启把半成品表落进主库」（034 的前车之鉴）。
// 现在账本已经切完（钱包、证券、红包全走它），表结构稳定，问题反过来变成：
// 新库（测试临时库、8i、别人的机器）如果没有这 12 张表，服务会直接不可用。
//
// ---- 幂等性 ----
// schema.sql 里全部是 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS，
// 主库已经有表时本迁移是纯 no-op。资产与系统账户用 INSERT OR IGNORE 补种。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var fs = require('fs');
var path = require('path');

var SQL_PATH = path.join(__dirname, '../ledger/schema.sql');

function up(db, ctx) {
  var sql = fs.readFileSync(SQL_PATH, 'utf8');

  // schema.sql 自带 PRAGMA foreign_keys=ON，exec 在事务内执行 DDL 是 SQLite 允许的
  db.exec(sql);

  // ---- 资产定义 ----
  var assets = [
    ['CASH', '充值学元', 1, 1, 1, 'cash', 'withdraw,goods'],
    ['GRANT', '赠送学元', 0, 1, 0, 'quota', 'goods_offset'],
    ['PRACTICE', '练习金', 0, 0, 0, 'closed', 'games']
  ];
  var insAsset = db.prepare([
    'INSERT OR IGNORE INTO xy_ledger_assets',
    '(asset, label, redeemable, transferable, external_cost, supply, sink, unit, created_at)',
    "VALUES (?, ?, ?, ?, ?, ?, ?, 'cent', ?)"
  ].join(' '));
  var now = new Date().toISOString();
  assets.forEach(function (a) {
    insAsset.run(a[0], a[1], a[2], a[3], a[4], a[5], a[6], now);
  });

  // ---- 系统账户 ----
  // clearing 允许负余额：它的负值就是「已发行净额」，这是账本能算平的前提。
  var insAcc = db.prepare([
    'INSERT OR IGNORE INTO xy_ledger_accounts',
    '(kind, owner_id, allow_negative, status, created_at)',
    "VALUES (?, '', ?, 'active', ?)"
  ].join(' '));
  insAcc.run('platform', 0, now);
  insAcc.run('escrow', 0, now);
  insAcc.run('clearing', 1, now);

  if (ctx && ctx.log) {
    var n = db.prepare('SELECT COUNT(*) AS c FROM xy_ledger_accounts').get().c;
    ctx.log('账本表就绪，账户 ' + n + ' 个');
  }
}

module.exports = { version: 36, name: 'ledger_tables', up: up };
