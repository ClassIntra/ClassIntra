// 学元账本 · 迁移 046 副本验证（发版前必跑）
// ============================================================
// 用法（系统 Node / ABI 137）：
//   cp <生产库快照> <副本>
//   node server/scripts/ledger-verify-migration-046.cjs --db <副本路径>
//
// 在**副本**上执行迁移 046，然后逐项验收：
//   1. 4 个新列 / 7 张新表齐全
//   2. 迁移前后每一条分录、每一行余额、账面现金、真金负债**逐字节等价**
//   3. genesis digest 覆盖全部历史分录，proof.verify() 通过
//   4. I1–I10 轻量层、I11–I13 深度层、日终三方对账全绿
//
// ⚠️ 本脚本会**修改传入的库**（跑一次迁移），因此 --db 必须是副本，
//    绝不能指向生产库。退出码 0 = 可以上线；1 = 有差异，禁止上线。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var fs = require('fs');
var path = require('path');

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  var v = process.argv[i + 1];
  if (!v || v.slice(0, 2) === '--') return true;
  return v;
}

var dbArg = arg('db');
if (!dbArg || dbArg === true) {
  console.error('用法: node server/scripts/ledger-verify-migration-046.cjs --db <库副本路径>');
  console.error('⚠️ --db 必须是副本，本脚本会执行迁移 DDL。');
  process.exit(1);
}
var target = path.resolve(String(dbArg));
if (!fs.existsSync(target)) { console.error('库不存在: ' + target); process.exit(1); }
process.env.DB_PATH = target;
process.env.NODE_ENV = 'test';

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + JSON.stringify(a) + '）', a === b, { got: a, want: b }); }

var db = require('../src/utils/db');

function snapshot() {
  return {
    entries: db.prepare('SELECT tx_id, line_no, account_id, asset, direction, amount_cent, created_at FROM xy_ledger_entries ORDER BY tx_id, line_no').all(),
    balances: db.prepare('SELECT account_id, asset, balance FROM xy_ledger_balances ORDER BY account_id, asset').all(),
    txCount: db.prepare('SELECT COUNT(*) AS n FROM xy_ledger_transactions').get().n,
    txMax: db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM xy_ledger_transactions').get().n,
    cashOnBook: db.prepare([
      'SELECT COALESCE(SUM(b.balance), 0) AS s FROM xy_ledger_balances b',
      "JOIN xy_ledger_accounts a ON a.id = b.account_id WHERE b.asset = 'CASH' AND a.kind <> 'clearing'"
    ].join('\n')).get().s,
    liability: db.prepare("SELECT COALESCE(SUM(amount_cent), 0) AS s FROM xy_ledger_cashbook WHERE scope = 'liability'").get().s
  };
}

console.log('\n=== 迁移 046 · 副本验证 ===');
console.log('副本: ' + target);
var before = snapshot();
console.log('迁移前: ' + before.txCount + ' 笔交易 / ' + before.entries.length +
  ' 条分录 / ' + before.balances.length + ' 行余额');

var migration = require('../src/migrations/046_ledger_hardening_v2');
try {
  db.transaction(function () { migration.up(db); })();
  ok('迁移 up() 执行成功（含内部事务）', true);
} catch (e) {
  ok('迁移 up() 执行成功（含内部事务）', false, { error: e.message, stack: String(e.stack).slice(0, 500) });
}

console.log('\n--- 1. 结构 ---');
function hasTable(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function hasColumn(table, col) {
  return db.prepare('PRAGMA table_info(' + table + ')').all().some(function (r) { return r.name === col; });
}
var tables = [
  'xy_ledger_tx_seals', 'xy_ledger_chain_state', 'xy_ledger_post_attempts',
  'xy_ledger_reconcile_runs', 'xy_ledger_reconcile_diffs',
  'xy_ledger_supply_state', 'xy_ledger_bridge_receipts'
];
tables.forEach(function (t) { ok('新表 ' + t, hasTable(t)); });
[
  ['xy_ledger_assets', 'supply_cap_cent'],
  ['xy_ledger_balances', 'version'],
  ['xy_ledger_transactions', 'request_hash'],
  ['xy_ledger_goods', 'requires_external']
].forEach(function (p) { ok('新列 ' + p[0] + '.' + p[1], hasColumn(p[0], p[1])); });
eq('历史余额行全部回填 version=1',
  db.prepare('SELECT COUNT(*) AS n FROM xy_ledger_balances WHERE version <> 1').get().n, 0);

console.log('\n--- 2. 资金逐行等价（迁移不得动一分钱） ---');
var after = snapshot();
eq('分录条数不变', after.entries.length, before.entries.length);
ok('分录内容逐字段一致',
  JSON.stringify(before.entries) === JSON.stringify(after.entries));
ok('余额逐行一致', JSON.stringify(before.balances) === JSON.stringify(after.balances));
eq('交易笔数不变', after.txCount, before.txCount);
eq('账面现金不变', after.cashOnBook, before.cashOnBook);
eq('真金负债不变', after.liability, before.liability);

console.log('\n--- 3. 链与计数器 ---');
var proof = require('../src/ledger/proof');
var supply = require('../src/ledger/supply');
var head = proof.head(db);
ok('genesis 已打', !!head);
if (head) {
  eq('genesis_tx_id = 迁移前 MAX(tx.id)', head.genesis_tx_id, before.txMax);
  var pv = proof.verify(db);
  eq('proof.verify 通过', pv.ok, true);
  ok('历史段 digest 覆盖全部存量', pv.legacy_checked === before.txMax,
    { legacy_checked: pv.legacy_checked, want: before.txMax });
  eq('新段为空（尚未有新交易）', pv.checked, 0);
}
eq('供给计数器 3 行', supply.all(db).length, 3);
var realIssued = {};
db.prepare([
  'SELECT e.asset, COALESCE(SUM(e.amount_cent), 0) AS s FROM xy_ledger_entries e',
  "JOIN xy_ledger_accounts a ON a.id = e.account_id WHERE a.kind = 'clearing' AND e.direction = -1",
  'GROUP BY e.asset'
].join('\n')).all().forEach(function (r) { realIssued[r.asset] = Number(r.s); });
var counters = {};
supply.all(db).forEach(function (r) { counters[r.asset] = Number(r.issued_cent); });
ok('计数器与历史分录一致', JSON.stringify(counters) === JSON.stringify(realIssued),
  { counters: counters, real: realIssued });

console.log('\n--- 4. 自检与日终对账 ---');
var inv = require('../src/ledger/invariants');
eq('I1–I10 轻量层全绿', inv.check().ok, true);
var deep = inv.checkDeep();
eq('I11–I13 深度层全绿', deep.ok, true);
if (!deep.ok) console.log('  深度问题: ' + JSON.stringify(deep.issues.slice(0, 5)));
var reconcile = require('../src/ledger/reconcile');
var rr = reconcile.run(db, { runKey: 'migration-046-verify', force: true });
eq('日终三方对账零差异', rr.ok, true);
if (!rr.ok) console.log('  差异: ' + JSON.stringify(rr.diffs.slice(0, 8)));

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
console.log(fail ? '结论: ✗ 禁止上线，先修差异' : '结论: ✓ 副本验证通过，可以上线');
console.log('========================================\n');
try { db.close(); } catch (e) { /* ignore */ }
process.exit(fail ? 1 : 0);
