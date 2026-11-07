// 学元账本 · 双账本对账（S5 切换前的验证工具，只读）
// ============================================================
// 逐人逐池比较旧 xy_account 与 账本 xy_ledger_balances，输出差异。
// 不写任何库；有差异时退出码 1，可直接当切换门禁。
//
// 用法：
//   node server/scripts/ledger-reconcile.cjs --old <旧库> --new <新库>
//   node server/scripts/ledger-reconcile.cjs --old ... --new ... --limit 50
//
// 刻度：1 元 = 1000 学元分，两边同单位，直接逐位比较。

var fs = require('fs');
var path = require('path');
var Database = require('better-sqlite3');

function arg(name, def) {
  var i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  var v = process.argv[i + 1];
  if (!v || v.slice(0, 2) === '--') return true;
  return v;
}

var oldPath = arg('old');
var newPath = arg('new');
var limit = parseInt(arg('limit', 20), 10);

if (!oldPath || !newPath) {
  console.log('用法: node server/scripts/ledger-reconcile.cjs --old <旧库> --new <新库> [--limit 20]');
  process.exit(1);
}

oldPath = path.resolve(oldPath);
newPath = path.resolve(newPath);
[oldPath, newPath].forEach(function (p) {
  if (!fs.existsSync(p)) { console.error('库不存在: ' + p); process.exit(1); }
});

var oldDb = new Database(oldPath, { readonly: true });
var newDb = new Database(newPath, { readonly: true });

var hasOld = oldDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_account'").get();
var hasNew = newDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_ledger_balances'").get();
if (!hasOld) { console.error('旧库缺少 xy_account'); process.exit(1); }
if (!hasNew) { console.error('新库缺少 xy_ledger_balances（先跑 ledger-init.cjs）'); process.exit(1); }

console.log('\n=== 学元账本 双账本对账 ===');
console.log('旧库:', oldPath);
console.log('新库:', newPath);

var oldRows = oldDb.prepare([
  'SELECT user_id, cash_balance, grant_balance, practice_balance',
  "FROM xy_account WHERE user_id NOT LIKE '@%'"
].join(' ')).all();

var newRows = newDb.prepare([
  'SELECT a.owner_id AS user_id, b.asset, b.balance',
  'FROM xy_ledger_balances b JOIN xy_ledger_accounts a ON a.id = b.account_id',
  "WHERE a.kind = 'user'"
].join('\n')).all();

var newMap = {};
newRows.forEach(function (r) {
  if (!newMap[r.user_id]) newMap[r.user_id] = { CASH: 0, GRANT: 0, PRACTICE: 0 };
  newMap[r.user_id][r.asset] = r.balance;
});

var diffs = [];
var onlyOld = [];
var totals = { old: { CASH: 0, GRANT: 0, PRACTICE: 0 }, neu: { CASH: 0, GRANT: 0, PRACTICE: 0 } };
var matched = 0;

oldRows.forEach(function (r) {
  var uid = String(r.user_id);
  var o = {
    CASH: Number(r.cash_balance || 0),
    GRANT: Number(r.grant_balance || 0),
    PRACTICE: Number(r.practice_balance || 0)
  };
  var n = newMap[uid] || { CASH: 0, GRANT: 0, PRACTICE: 0 };

  totals.old.CASH += o.CASH; totals.old.GRANT += o.GRANT; totals.old.PRACTICE += o.PRACTICE;
  totals.neu.CASH += n.CASH; totals.neu.GRANT += n.GRANT; totals.neu.PRACTICE += n.PRACTICE;

  if (!newMap[uid]) { onlyOld.push(uid); return; }

  if (o.CASH !== n.CASH || o.GRANT !== n.GRANT || o.PRACTICE !== n.PRACTICE) {
    diffs.push({ user_id: uid, old: o, neu: n });
  } else {
    matched++;
  }
});

var oldSet = {};
oldRows.forEach(function (r) { oldSet[String(r.user_id)] = true; });
var onlyNew = Object.keys(newMap).filter(function (u) { return !oldSet[u]; });

console.log('');
console.log('旧账号 :', oldRows.length);
console.log('新账号 :', Object.keys(newMap).length);
console.log('完全一致:', matched);
console.log('金额不一致:', diffs.length);
console.log('仅旧有新无:', onlyOld.length);
console.log('仅新有旧无:', onlyNew.length);

console.log('\n汇总（学元分）：');
console.log('  CASH     旧 ' + totals.old.CASH + ' / 新 ' + totals.neu.CASH + '（差 ' + (totals.neu.CASH - totals.old.CASH) + '）');
console.log('  GRANT    旧 ' + totals.old.GRANT + ' / 新 ' + totals.neu.GRANT + '（差 ' + (totals.neu.GRANT - totals.old.GRANT) + '）');
console.log('  PRACTICE 旧 ' + totals.old.PRACTICE + ' / 新 ' + totals.neu.PRACTICE + '（差 ' + (totals.neu.PRACTICE - totals.old.PRACTICE) + '）');

if (diffs.length) {
  console.log('\n差异明细（最多 ' + limit + ' 条）：');
  diffs.slice(0, limit).forEach(function (d) {
    console.log('  ' + d.user_id +
      '  CASH ' + d.old.CASH + '→' + d.neu.CASH +
      '  GRANT ' + d.old.GRANT + '→' + d.neu.GRANT +
      '  PRACTICE ' + d.old.PRACTICE + '→' + d.neu.PRACTICE);
  });
}

if (onlyOld.length) {
  console.log('\n仅旧有新无（未导入）：' + onlyOld.slice(0, limit).join(', ') + (onlyOld.length > limit ? ' …' : ''));
}
if (onlyNew.length) {
  console.log('仅新有旧无（多出来）：' + onlyNew.slice(0, limit).join(', ') + (onlyNew.length > limit ? ' …' : ''));
}

var clean = diffs.length === 0 && onlyOld.length === 0 && onlyNew.length === 0;
console.log('\n结论:', clean ? '✓ 两账一致，可以切换' : '✗ 存在差异，先修数据再切');
console.log('');

oldDb.close();
newDb.close();
process.exit(clean ? 0 : 1);
