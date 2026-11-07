// 学元账本 · 证券资金验收（独立临时库）
// 用法：node server/scripts-test-ledger-trading.cjs
//
// 覆盖：练习金发行 / 冻结 / 买入结算（成本+手续费+差额退回）/ 解冻 /
//   卖出回款 / 账户视图旧口径 / 全局守恒 / 托管槽对账 / 每日津贴幂等 / 大额发放。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ledger-trade-'));
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
var svc = require('./src/ledger/service');
var grantTpl = require('./src/ledger/templates/grant');
var rechargeTpl = require('./src/ledger/templates/recharge');
var transferTpl = require('./src/ledger/templates/transfer');
var trading = require('./src/ledger/trading');
var inv = require('./src/ledger/invariants');
var ledger = require('./src/ledger/ledger');

// ⚠️ 原为 c = require('./src/ledger/compat')：S4 过渡兼容层已随 v1.7.0 发布收敛删除。
// 这里保留只覆盖本文件所需子集的本地桩，逐函数对应原 compat 的实现
// （语义对应发布前工作区的 compat 过渡层，见 docs/economy-design.md V.24），断言语义与数值全部保持不变。
var ASSET_OF_POOL = { cash: 'CASH', grant: 'GRANT', practice: 'PRACTICE' };
var DAILY_CENT = 200; // 助学津贴 200 账本单位（= 2 学元），与删除前 compat 同值

function compatShape(u) {
  var acc = ledger.findAccount('user', u);
  if (!acc) {
    return { exists: false, user_id: u, balance: 0, cash: 0, grant: 0, practice: 0,
      cash_balance: 0, grant_balance: 0, practice_balance: 0,
      frozen: 0, frozen_cash: 0, frozen_grant: 0, frozen_practice: 0, status: 'none' };
  }
  var b = ledger.userBalances(u);
  return { exists: true, user_id: u,
    balance: b.CASH + b.GRANT, cash: b.CASH, grant: b.GRANT, practice: b.PRACTICE,
    cash_balance: b.CASH, grant_balance: b.GRANT, practice_balance: b.PRACTICE,
    frozen: 0, frozen_cash: 0, frozen_grant: 0, frozen_practice: 0, status: acc.status };
}

function compatLedgerOf(u, limit) {
  var acc = ledger.findAccount('user', u);
  if (!acc) return [];
  var n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  return db.prepare([
    'SELECT e.id, e.tx_id, e.asset, e.direction, e.amount_cent, e.created_at, t.kind, t.memo',
    'FROM xy_ledger_entries e JOIN xy_ledger_transactions t ON t.id = e.tx_id',
    'WHERE e.account_id = ? ORDER BY e.id DESC LIMIT ?'
  ].join(' ')).all(acc.id, n).map(function (r) {
    return { id: r.id, tx_id: r.tx_id, kind: r.kind, memo: r.memo,
      pool: String(r.asset).toLowerCase(), asset: r.asset,
      delta: r.direction * r.amount_cent, created_at: r.created_at };
  });
}

var c = {
  ensureReady: function () { return svc.ensureReady(); },
  getAccount: compatShape,
  viewAccount: function (u) {
    var base = compatShape(u);
    var t = trading.view(u);
    return Object.assign({}, base, {
      balance_cent: base.balance, cash_cent: base.cash, grant_cent: base.grant,
      practice_cent: t.practice_cent,
      available_practice_cent: t.available_practice_cent,
      frozen_practice_cent: t.frozen_practice_cent,
      available_cash_cent: base.cash, available_grant_cent: base.grant, frozen_cent: 0
    });
  },
  mint: function (o) {
    return grantTpl.issue({ to: o.to, asset: ASSET_OF_POOL[o.pool] || 'GRANT',
      amount_cent: o.amountCent, ref: o.ref, operator: o.operator || 'system',
      memo: o.memo, skipQuota: true });
  },
  hold: function (u, n, o) { o = o || {}; return trading.reserve(u, n, o.ref, o.memo); },
  release: function (u, n, ref) { return trading.release(u, n, ref); },
  settleHold: function (o) {
    return trading.settleBuy({ userId: o.user_id, holdCent: o.holdCent, costCent: o.costCent,
      feeCent: o.feeCent, ref: o.ref, memo: o.memo, meta: o.meta });
  },
  creditTrade: function (u, n, o) {
    o = o || {};
    return trading.settleSell(u, n, { ref: o.ref, memo: o.memo, meta: o.meta });
  },
  recharge: function (o) {
    return rechargeTpl.recharge({ to: o.user || o.to, amount_cent: o.amountCent,
      ref: o.ref, operator: o.operator, memo: o.memo, maxCent: o.maxCent });
  },
  withdraw: function (o) {
    return rechargeTpl.withdraw({ from: o.user || o.from, amount_cent: o.amountCent,
      ref: o.ref, memo: o.memo, maxCent: o.maxCent });
  },
  transfer: function (o) {
    return transferTpl.transfer({ from: o.from, to: o.to, asset: ASSET_OF_POOL[o.pool] || 'CASH',
      amount_cent: o.amountCent, ref: o.ref, memo: o.memo });
  },
  todayKey: function (ts) {
    var d = new Date((ts || Date.now()) + 8 * 3600 * 1000);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  },
  claimDaily: function (u) {
    var ref = 'daily:' + u + ':' + c.todayKey();
    if (ledger.findTxByRef(ref)) return { duplicate: true, amount: 0, streak: 0, account: compatShape(u) };
    var streak = 1;
    var last = db.prepare('SELECT created_at, payload FROM xy_ledger_transactions WHERE ref LIKE ? ORDER BY id DESC LIMIT 1')
      .get('daily:' + u + ':%');
    if (last && c.todayKey(Date.parse(last.created_at)) === c.todayKey(Date.now() - 86400000)) {
      var ps = 0;
      try { ps = JSON.parse(last.payload || '{}').streak || 0; } catch (e) { ps = 0; }
      streak = (ps || 0) + 1;
    }
    var tx = ledger.post({
      ref: ref, kind: 'grant', initiator: 'system', memo: '助学津贴', payload: { streak: streak },
      entries: [
        { account: { kind: 'clearing', owner: '' }, asset: 'GRANT', direction: -1, amount_cent: DAILY_CENT },
        { account: { kind: 'user', owner: u }, asset: 'GRANT', direction: 1, amount_cent: DAILY_CENT }
      ]
    });
    return { duplicate: tx.duplicate, amount: tx.duplicate ? 0 : DAILY_CENT, streak: streak, account: compatShape(u) };
  },
  history: function (u, o) {
    o = o || {};
    return { list: compatLedgerOf(u, o.limit), has_more: false };
  }
};

svc.ensureReady();

var A = '991801';
var B = '991802';
ledger.openUser(A);
ledger.openUser(B);

function avail(u) { return c.viewAccount(u).available_practice_cent; }
function frozen(u) { return c.viewAccount(u).frozen_practice_cent; }
function clearingPractice() { return ledger.balanceOf(ledger.systemAccount('clearing').id, 'PRACTICE'); }

console.log('\n=== 发行练习金 ===');
var r1 = c.mint({ to: A, amountCent: 10000, pool: 'practice', ref: 'stock:month:A', memo: '月度补发' });
eq('大额发放跳过通用配额', avail(A), 10000);
eq('发行对手方为负', clearingPractice(), -10000);
eq('view 总额 = 可用 + 冻结', c.viewAccount(A).practice_cent, 10000);

console.log('\n=== 冻结与买入结算 ===');
c.hold(A, 3000, { ref: 'hold:1' });
eq('冻结后可用减少', avail(A), 7000);
eq('冻结额可读', frozen(A), 3000);

var s1 = c.settleHold({ user_id: A, holdCent: 3000, costCent: 2900, feeCent: 100, ref: 'stock:order:1' });
eq('成本+手续费吃满冻结，无退回', s1.back_cent, 0);
eq('结算后可用不变', avail(A), 7000);
eq('结算后冻结清零', frozen(A), 0);
eq('发行方回收成本+手续费', clearingPractice(), -7000);

c.hold(A, 2000, { ref: 'hold:2' });
eq('再次冻结', avail(A), 5000);
var s2 = c.settleHold({ user_id: A, holdCent: 2000, costCent: 1500, feeCent: 50, ref: 'stock:order:2' });
eq('差额退回 450', s2.back_cent, 450);
eq('可用回到 5450', avail(A), 5450);

throws('成本超过冻结额拒绝', function () {
  c.settleHold({ user_id: A, holdCent: 100, costCent: 200, feeCent: 0, ref: 'bad:over' });
}, /超过冻结额/);

console.log('\n=== 解冻（撤单）===');
c.hold(A, 1000, { ref: 'hold:3' });
eq('冻结后', avail(A), 4450);
c.release(A, 1000, 'release:3');
eq('解冻后恢复', avail(A), 5450);
eq('冻结清零', frozen(A), 0);
throws('超额解冻拒绝', function () {
  c.release(A, 99999, 'release:bad');
}, /余额不足/);

console.log('\n=== 卖出回款 ===');
c.creditTrade(A, 5000, { ref: 'stock:sell:1', memo: '卖出回款' });
eq('回款到账', avail(A), 10450);
eq('发行方净额', clearingPractice(), -10450);

console.log('\n=== 账户视图（旧字段口径）===');
c.recharge({ user: A, amountCent: 1000, ref: 'compat:r1' });
var v = c.viewAccount(A);
eq('available_cash_cent', v.available_cash_cent, 1000);
eq('available_practice_cent', v.available_practice_cent, 10450);
eq('practice_cent 含冻结', v.practice_cent, 10450);
eq('balance 不含练习金', v.balance, 1000);
ok('字段可供 stock 直接读取', v.available_practice_cent > 0 && typeof v.frozen_practice_cent === 'number');

console.log('\n=== 每日津贴（发 GRANT，幂等）===');
var d1 = c.claimDaily(A);
eq('首次领取 200', d1.amount, 200);
eq('津贴进 GRANT', c.getAccount(A).grant, 200);
eq('练习金不受影响', avail(A), 10450);

var d2 = c.claimDaily(A);
eq('当日重复领取标记 duplicate', d2.duplicate, true);
eq('重复领取不再发放', c.getAccount(A).grant, 200);

console.log('\n=== 守恒与对账 ===');
eq('全局 PRACTICE 净额', db.prepare("SELECT COALESCE(SUM(direction*amount_cent),0) s FROM xy_ledger_entries WHERE asset='PRACTICE'").get().s, 0);
eq('托管槽无残留', trading.escrowTotalCent(), 0);
var report = inv.check({ reserveCent: inv.cashOnBookCent() });
ok('I1–I8 全绿', report.ok, report.issues);

console.log('\n=== 流水形状（stock history 用）===');
var h = c.history(A, { limit: 20 });
ok('返回 list', Array.isArray(h.list) && h.list.length > 0, h.list && h.list.length);
ok('含 practice 流水', h.list.some(function (x) { return x.pool === 'practice'; }), h.list[0]);
ok('delta 有正负', h.list.some(function (x) { return x.delta > 0; }) && h.list.some(function (x) { return x.delta < 0; }));

console.log('\n=== B 独立账户 ===');
c.mint({ to: B, amountCent: 3000, pool: 'practice', ref: 'stock:month:B' });
eq('B 可用练习金', avail(B), 3000);
eq('A 不受影响', avail(A), 10450);
eq('全局净额仍为 0', db.prepare("SELECT COALESCE(SUM(direction*amount_cent),0) s FROM xy_ledger_entries WHERE asset='PRACTICE'").get().s, 0);

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
console.log('========================================\n');
process.exit(fail === 0 ? 0 : 1);
