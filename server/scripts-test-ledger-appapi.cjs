// 学元账本 · 第三方应用能力面验收（独立临时库）
// 用法：node server/scripts-test-ledger-appapi.cjs
//
// 验证分层：第三方应用（证券）只能碰练习金，碰不到真钱与赠金；
// 未登记应用被拒；跨账本 ref 幂等（切账当月不重复发钱）。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ledger-appapi-'));
process.env.DB_PATH = path.join(tmpDir, 'ledger.db');
process.env.NODE_ENV = 'test';

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + JSON.stringify(a) + '）', a === b, { got: a, want: b }); }
function throws(name, fn, re) {
  try { fn(); fail++; console.log('  ✗ ' + name + ' → 未抛错'); }
  catch (e) {
    var hit = !re || re.test(e.message);
    if (hit) { pass++; console.log('  ✓ ' + name + '（' + e.message + '）'); }
    else { fail++; console.log('  ✗ ' + name + ' → 错误信息不符: ' + e.message); }
  }
}

var db = require('./src/utils/db');
db.exec(fs.readFileSync(path.join(__dirname, 'src', 'ledger', 'schema.sql'), 'utf8'));
// 模拟旧账本的存在（只有 ref 判重会用到）
db.exec('CREATE TABLE IF NOT EXISTS xy_tx (id INTEGER PRIMARY KEY, ref TEXT UNIQUE)');

var svc = require('./src/ledger/service');
var app = require('./src/ledger/app-api');
var ledger = require('./src/ledger/ledger');
var inv = require('./src/ledger/invariants');

svc.ensureReady();

var U = '991801';
var V = '991802';
app.ensureTrader('stock', U);
app.ensureTrader('stock', V);

console.log('\n=== 应用登记 ===');
throws('未登记应用被拒', function () { app.practiceAccount('evil', U); }, /未登记的第三方应用/);
throws('空应用名被拒', function () { app.issue('', U, 100, 'x'); }, /未登记的第三方应用/);
ok('已登记应用可读账户', app.practiceAccount('stock', U).exists === true);

console.log('\n=== 只暴露练习金 ===');
// 先给这个用户真钱与赠金，确认第三方读不到
svc.recharge({ to: U, amount_cent: 10000, ref: 'a:recharge' });
svc.issue({ to: U, asset: 'GRANT', amount_cent: 5000, ref: 'a:grant' });
var acc = app.practiceAccount('stock', U);
eq('第三方看不到 CASH', acc.cash_cent, 0);
eq('第三方看不到 GRANT', acc.grant_cent, 0);
eq('balance 只等于练习金', acc.balance, 0);
eq('主账本里 CASH 确实有', ledger.userBalance(U, 'CASH'), 10000);

console.log('\n=== 发行与冻结 ===');
var r1 = app.issue('stock', U, 100000, 'stock:practice:2026-11', '投资练习金');
eq('练习金到账', app.practiceAccount('stock', U).available_practice_cent, 100000);
ok('发行返回交易号', r1.tx_id > 0);

app.reserve('stock', U, 30000);
eq('冻结后可用', app.practiceAccount('stock', U).available_practice_cent, 70000);
eq('冻结额', app.practiceAccount('stock', U).frozen_practice_cent, 30000);
app.release('stock', U, 30000, 'release:1');
eq('解冻恢复', app.practiceAccount('stock', U).available_practice_cent, 100000);

// ref 复用：先成功一次建立 ref，再用同一 ref 触发防护
app.reserve('stock', U, 1000, 'dup:ref');
throws('冻结 ref 复用抛错', function () { app.reserve('stock', U, 1000, 'dup:ref'); }, /已被使用/);
app.release('stock', U, 1000, 'release:dup');
eq('清理后回到 100000', app.practiceAccount('stock', U).available_practice_cent, 100000);

console.log('\n=== 成交结算 ===');
app.reserve('stock', U, 30000);
var s1 = app.settleBuy('stock', { userId: U, holdCent: 30000, costCent: 29000, feeCent: 1000, ref: 'stock:order:1' });
eq('差额退回 0', s1.back_cent, 0);
eq('结算后可用', app.practiceAccount('stock', U).available_practice_cent, 70000);
eq('成本口径恒为练习金', s1.spent.practice_cent, 29000);
eq('spent 不含真钱', s1.spent.cash_cent, 0);

app.settleSell('stock', U, 31000, { ref: 'stock:order:2' });
eq('卖出回款', app.practiceAccount('stock', U).available_practice_cent, 101000);

console.log('\n=== ref 幂等（同一账本内）===');
// 旧表的跨账本判重在旧账本归档时已移除：现在只有一本账，
// 「这个 ref 发过没有」只可能问账本自己要答案。
var beforeDup = app.practiceAccount('stock', U).available_practice_cent;
var r2 = app.issue('stock', U, 50000, 'stock:practice:2026-12');
eq('首次发行成功', r2.duplicate, false);
var r3 = app.issue('stock', U, 50000, 'stock:practice:2026-12');
eq('同 ref 重放视为重复', r3.duplicate, true);
eq('重放不再加钱', app.practiceAccount('stock', U).available_practice_cent, beforeDup + 50000);

console.log('\n=== 流水 ===');
var h = app.history('stock', U, 10);
ok('有流水', h.list.length > 0, h.list.length);
ok('带旧 UI 需要的 delta', typeof h.list[0].delta === 'number', h.list[0]);
ok('带 kind_label', typeof h.list[0].kind_label === 'string', h.list[0]);
ok('带余额快照（可逐笔对账）', typeof h.list[0].balance_after === 'number', h.list[0]);
ok('返回分页游标', typeof h.next_before_id === 'number', h.next_before_id);

console.log('\n=== 守恒 ===');
eq('练习金全局净额', db.prepare("SELECT COALESCE(SUM(direction*amount_cent),0) s FROM xy_ledger_entries WHERE asset='PRACTICE'").get().s, 0);
var report = inv.check({ reserveCent: inv.cashbookNetCent() });
ok('I1–I8 全绿', report.ok, report.issues);

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
console.log('========================================\n');
process.exit(fail === 0 ? 0 : 1);
