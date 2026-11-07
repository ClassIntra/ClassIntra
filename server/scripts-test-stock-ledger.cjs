// 学元 v2 · 证券接入冒烟（独立临时库）
// 用法：node server/scripts-test-stock-ledger.cjs
//
// 模拟 market-apps/stock 在 STOCK_LEDGER=ledger 下的真实调用序列：
//   ensureAccount → viewAccount → mint(月补发) → hold(挂单) → settleHold(成交)
//   → creditTrade(卖出回款) → release(撤单) → claimDaily(钱包页) → history
//
// 重点验证「练习金封闭」：不可转账、不可提现、不进订单。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-stock-ledger-'));
process.env.DB_PATH = path.join(tmpDir, 'ledger.db');
process.env.NODE_ENV = 'test';
process.env.STOCK_LEDGER = 'ledger';

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

// ⚠️ 原为 c = require('./src/ledger/compat')（STOCK_LEDGER=ledger 的调用面模拟）：
// S4 过渡兼容层已随 v1.7.0 发布收敛删除；market-apps/stock 实际走 src/ledger/app-api。
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
  ensureAccount: function (u) {
    var existed = !!ledger.findAccount('user', u);
    ledger.openUser(u);
    return { created: !existed, account: compatShape(u) };
  },
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

var U1 = '991801';
var U2 = '991802';

function avail(u) { return c.viewAccount(u).available_practice_cent; }
function frozen(u) { return c.viewAccount(u).frozen_practice_cent; }

console.log('\n=== 开户与钱包页 ===');
var opened = c.ensureAccount(U1);
eq('ensureAccount 返回 created', opened.created, true);
c.ensureAccount(U2);
eq('初始可用练习金', avail(U1), 0);
ok('todayKey 形如 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(c.todayKey()), c.todayKey());

console.log('\n=== 月度补发（stock 的 mint）===');
var m1 = c.mint({ to: U1, amountCent: 1000000, pool: 'practice', ref: 'stock:month:991801:2026-11' });
eq('补发 1000 元等值', avail(U1), 1000000);
eq('补发幂等', c.mint({ to: U1, amountCent: 1000000, pool: 'practice', ref: 'stock:month:991801:2026-11' }).duplicate, true);
eq('余额未翻倍', avail(U1), 1000000);

console.log('\n=== 买入：挂单冻结 → 成交结算 ===');
var HOLD = 123500;   // 10 股 × 12.30 元 + 手续费 5 元（1 元 = 1000 分）
c.hold(U1, HOLD);    // stock 的 hold 不传 ref，由账本生成
eq('冻结后可用', avail(U1), 876500);
eq('冻结额', frozen(U1), HOLD);

var settled = c.settleHold({
  user_id: U1, holdCent: HOLD, costCent: 123000, feeCent: 500,
  ref: 'stock:order:1', memo: '买入 测试股 10 股'
});
eq('成本+手续费吃满冻结', settled.back_cent, 0);
eq('成交后可用不变', avail(U1), 876500);
eq('成交后冻结清零', frozen(U1), 0);

console.log('\n=== 卖出：回款 ===');
c.creditTrade(U1, 124500, { ref: 'stock:order:2', memo: '卖出 测试股 10 股' });
eq('卖出回款到账', avail(U1), 1001000);

console.log('\n=== 撤单解冻 ===');
c.hold(U1, 50000, { ref: 'stock:order:3' });
eq('挂单冻结', avail(U1), 951000);
throws('冻结 ref 复用时抛错（防超卖）', function () {
  c.hold(U1, 50000, { ref: 'stock:order:3' });
}, /已被使用/);
c.release(U1, 50000, 'release:3');
eq('撤单恢复', avail(U1), 1001000);
eq('无残留冻结', frozen(U1), 0);

console.log('\n=== 练习金封闭边界 ===');
throws('练习金不可转账给同学', function () {
  c.transfer({ from: U1, to: U2, amountCent: 1000, pool: 'practice', ref: 'bad:pt' });
}, /不可转账/);
throws('练习金不可提现', function () {
  c.withdraw({ user: U1, amountCent: 1000, ref: 'bad:pw' });
}, /余额不足/);
throws('练习金不能下订单', function () {
  svc.orders.create({ ref: 'bad:po', buyer: U1, asset: 'PRACTICE', face_cent: 100, kind: 'goods' });
}, /练习金不能用于订单/);
c.mint({ to: U1, amountCent: 500, pool: 'grant', ref: 'ok:gm' });
ok('赠金可以转账（对照）', c.transfer({ from: U1, to: U2, amountCent: 100, pool: 'grant', ref: 'ok:gt' }).tx_id > 0);

console.log('\n=== 钱包页：每日津贴 ===');
var gBefore = c.getAccount(U1).grant;
var d = c.claimDaily(U1);
eq('首次领取 200', d.amount, 200);
eq('津贴进 GRANT 而非练习金', c.getAccount(U1).grant, gBefore + 200);
eq('练习金不受影响', avail(U1), 1001000);
eq('重复领取标记', c.claimDaily(U1).duplicate, true);

console.log('\n=== 持仓页需要的账户字段 ===');
var v = c.viewAccount(U1);
eq('available_practice_cent', v.available_practice_cent, 1001000);
eq('frozen_practice_cent', v.frozen_practice_cent, 0);
eq('practice_cent 含冻结', v.practice_cent, 1001000);
ok('字段齐全', ['balance_cent', 'cash_cent', 'grant_cent', 'practice_cent',
  'available_practice_cent', 'frozen_practice_cent'].every(function (k) {
  return typeof v[k] === 'number';
}), Object.keys(v));

console.log('\n=== 流水（stock history）===');
var h = c.history(U1, { limit: 20 });
ok('返回 list', Array.isArray(h.list) && h.list.length > 0, h.list && h.list.length);
ok('含 practice 分录', h.list.some(function (x) { return x.pool === 'practice'; }));
ok('含 grant 分录', h.list.some(function (x) { return x.pool === 'grant'; }));

console.log('\n=== 守恒 ===');
eq('PRACTICE 全局净额', db.prepare("SELECT COALESCE(SUM(direction*amount_cent),0) s FROM xy_ledger_entries WHERE asset='PRACTICE'").get().s, 0);
eq('U2 只有赠金', c.getAccount(U2).grant, 100);
eq('U2 练习金为 0', avail(U2), 0);
var report = inv.check({ reserveCent: inv.cashOnBookCent() });
ok('I1–I8 全绿', report.ok, report.issues);

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
console.log('========================================\n');
process.exit(fail === 0 ? 0 : 1);
