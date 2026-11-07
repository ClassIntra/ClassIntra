// 学元账本 · S1 验收（独立临时库，绝不碰生产数据）
// 用法：node server/scripts-test-ledger-s1.cjs
//
// 覆盖 S1 验收项：I1 按资产分组守恒 / I2 真金对账 / I8 负余额 /
//   ref 幂等重放 / 并发重复调用 / 未知资产拒绝 / 跨资产混记拒绝 /
//   余额不足回滚 / 发行账户允许负余额 / 同账户多条分录累加 / 对账能抓出人为破坏。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ledger-s1-'));
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

console.log('\n=== 建库 ===');
var db = require('./src/utils/db');
db.exec(fs.readFileSync(path.join(__dirname, 'src', 'ledger', 'schema.sql'), 'utf8'));
var assets = require('./src/ledger/assets');
var ledger = require('./src/ledger/ledger');
var cashbook = require('./src/ledger/cashbook');
var inv = require('./src/ledger/invariants');

var seeded = assets.seed(db);
eq('写入 3 种资产', seeded.total, 3);
eq('首次全部新增', seeded.created, 3);

var A = '991801';
var B = '991802';

console.log('\n=== 资产定义 ===');
var cash = assets.get('CASH');
var grant = assets.get('grant');
var practice = assets.get('PRACTICE');
eq('CASH 可兑付', cash.redeemable, 1);
eq('CASH 可买外部成本商品', cash.external_cost, 1);
eq('GRANT 不可兑付', grant.redeemable, 0);
eq('GRANT 不可买外部成本商品', grant.external_cost, 0);
eq('PRACTICE 封闭（不可转账）', practice.transferable, 0);
eq('PRACTICE 不可出域消费', practice.external_cost, 0);
ok('资产表没有汇率为可变入口', !('rate_to_cent' in cash));

console.log('\n=== 开户 ===');
var ua = ledger.openUser(A);
var ub = ledger.openUser(B);
ok('用户 A 开户成功', ua.id > 0 && ua.kind === 'user');
eq('开户幂等', ledger.openUser(A).id, ua.id);
ok('A/B 账户不同', ua.id !== ub.id);
throws('空标识拒绝开户', function () { ledger.openUser(''); }, /用户标识/);

console.log('\n=== 发行：分组守恒 + 发行账户允许负余额 ===');
var t1 = ledger.post({
  ref: 'seed:' + A,
  kind: 'grant',
  entries: [
    { kind: 'clearing', owner: '', asset: 'GRANT', direction: -1, amount_cent: 10000 },
    { kind: 'user', owner: A, asset: 'GRANT', direction: 1, amount_cent: 10000 }
  ]
});
ok('发赠金成功', t1.tx_id > 0 && t1.duplicate === false);
eq('A 赠金余额', ledger.userBalance(A, 'GRANT'), 10000);
eq('clearing 为负（已发行净额）', ledger.balanceOf(ledger.systemAccount('clearing').id, 'GRANT'), -10000);
eq('A 现金余额仍为 0', ledger.userBalance(A, 'CASH'), 0);

throws('跨资产混记拒绝（CASH -100 / GRANT +100）', function () {
  ledger.post({
    ref: 'bad:cross-asset',
    kind: 'grant',
    entries: [
      { kind: 'user', owner: A, asset: 'CASH', direction: -1, amount_cent: 100 },
      { kind: 'user', owner: A, asset: 'GRANT', direction: 1, amount_cent: 100 }
    ]
  });
}, /不守恒/);

throws('未知资产拒绝', function () {
  ledger.post({
    ref: 'bad:asset',
    kind: 'grant',
    entries: [
      { kind: 'clearing', owner: '', asset: 'GOLD', direction: -1, amount_cent: 100 },
      { kind: 'user', owner: A, asset: 'GOLD', direction: 1, amount_cent: 100 }
    ]
  });
}, /未知资产/);

throws('direction=0 拒绝', function () {
  ledger.post({
    ref: 'bad:dir',
    kind: 'grant',
    entries: [
      { kind: 'user', owner: A, asset: 'GRANT', direction: 0, amount_cent: 100 },
      { kind: 'user', owner: B, asset: 'GRANT', direction: 1, amount_cent: 100 }
    ]
  });
}, /direction/);

throws('金额为 0 拒绝', function () {
  ledger.post({
    ref: 'bad:zero',
    kind: 'grant',
    entries: [
      { kind: 'user', owner: A, asset: 'GRANT', direction: -1, amount_cent: 0 },
      { kind: 'user', owner: B, asset: 'GRANT', direction: 1, amount_cent: 0 }
    ]
  });
}, /正整数分/);

throws('金额为小数拒绝', function () {
  ledger.post({
    ref: 'bad:frac',
    kind: 'grant',
    entries: [
      { kind: 'user', owner: A, asset: 'GRANT', direction: -1, amount_cent: 10.5 },
      { kind: 'user', owner: B, asset: 'GRANT', direction: 1, amount_cent: 10.5 }
    ]
  });
}, /正整数分/);

throws('少于两条分录拒绝', function () {
  ledger.post({ ref: 'bad:one', kind: 'grant', entries: [{ kind: 'user', owner: A, asset: 'GRANT', direction: 1, amount_cent: 1 }] });
}, /至少需要两条分录/);

console.log('\n=== 幂等：重放不重复入账 ===');
var before = ledger.userBalance(A, 'GRANT');
var t1again = ledger.post({
  ref: 'seed:' + A,
  kind: 'grant',
  entries: [
    { kind: 'clearing', owner: '', asset: 'GRANT', direction: -1, amount_cent: 10000 },
    { kind: 'user', owner: A, asset: 'GRANT', direction: 1, amount_cent: 10000 }
  ]
});
eq('重放标记 duplicate', t1again.duplicate, true);
eq('重放返回原交易 id', t1again.tx_id, t1.tx_id);
eq('余额未变', ledger.userBalance(A, 'GRANT'), before);

for (var i = 0; i < 5; i++) {
  ledger.post({
    ref: 'loop:' + A,
    kind: 'grant',
    entries: [
      { kind: 'clearing', owner: '', asset: 'GRANT', direction: -1, amount_cent: 500 },
      { kind: 'user', owner: A, asset: 'GRANT', direction: 1, amount_cent: 500 }
    ]
  });
}
eq('连续调用同 ref 只入账一次', ledger.userBalance(A, 'GRANT'), before + 500);

console.log('\n=== 余额不足：拒绝且整笔回滚 ===');
throws('支出超过余额拒绝', function () {
  ledger.post({
    ref: 'bad:overdraft',
    kind: 'transfer',
    entries: [
      { kind: 'user', owner: A, asset: 'GRANT', direction: -1, amount_cent: 999999 },
      { kind: 'user', owner: B, asset: 'GRANT', direction: 1, amount_cent: 999999 }
    ]
  });
}, /余额不足/);
eq('失败交易未落 transactions', ledger.findTxByRef('bad:overdraft'), null);
eq('A 余额未被破坏', ledger.userBalance(A, 'GRANT'), before + 500);
eq('B 余额仍为 0', ledger.userBalance(B, 'GRANT'), 0);

console.log('\n=== I2：真金台账与可兑付敞口 ===');
ledger.post({
  ref: 'recharge:' + A,
  kind: 'recharge',
  entries: [
    { kind: 'clearing', owner: '', asset: 'CASH', direction: -1, amount_cent: 5000 },
    { kind: 'user', owner: A, asset: 'CASH', direction: 1, amount_cent: 5000 }
  ]
});
cashbook.record({ type: 'recharge', amount_cent: 5000, ref: 'cash:recharge:' + A, note: '线下充值' });
eq('A 现金余额 50 元', ledger.userBalance(A, 'CASH'), 5000);
eq('可兑付敞口 = 5000', inv.cashLiabilityCent(), 5000);
eq('真金台账 liability = 5000', cashbook.totals().liability_cent, 5000);

var report = inv.check({ reserveCent: 5000 });
ok('I1/I2/I4/I8 全绿', report.ok, report.issues);
eq('I3 备付覆盖率 100%', report.summary.reserve.coverage, 1);

var tight = inv.check({ reserveCent: 100 });
ok('备付不足时 I3 报警', !tight.ok && tight.issues.some(function (x) { return x.code === 'I3'; }), tight.issues);

console.log('\n=== 多条分录累加与同笔对冲 ===');
ledger.post({
  ref: 'multi:' + B,
  kind: 'grant',
  entries: [
    { kind: 'clearing', owner: '', asset: 'GRANT', direction: -1, amount_cent: 3000 },
    { kind: 'user', owner: B, asset: 'GRANT', direction: 1, amount_cent: 1000 },
    { kind: 'user', owner: B, asset: 'GRANT', direction: 1, amount_cent: 2000 }
  ]
});
eq('同账户同资产两条分录累加', ledger.userBalance(B, 'GRANT'), 3000);

var balB = ledger.userBalance(B, 'GRANT');
ledger.post({
  ref: 'offset:' + B,
  kind: 'adjust',
  entries: [
    { kind: 'user', owner: B, asset: 'GRANT', direction: 1, amount_cent: 700 },
    { kind: 'user', owner: B, asset: 'GRANT', direction: -1, amount_cent: 700 }
  ]
});
eq('同笔对冲后余额不变', ledger.userBalance(B, 'GRANT'), balB);

console.log('\n=== 交易可追溯 ===');
var detail = ledger.getTx(t1.tx_id);
ok('可按 tx 取回分录', detail && detail.entries.length === 2, detail && detail.entries);
ok('分录带账户语义', detail.entries.some(function (e) { return e.account_kind === 'clearing'; }));

console.log('\n=== 对账能抓出人为破坏 ===');
var uidA = ledger.findAccount('user', A).id;
db.prepare('UPDATE xy_ledger_balances SET balance = balance + 1 WHERE account_id = ? AND asset = ?').run(uidA, 'GRANT');
var broken = inv.check({});
ok('人为改余额被 I1c 抓到', broken.issues.some(function (x) { return x.code === 'I1c'; }), broken.issues);
db.prepare('UPDATE xy_ledger_balances SET balance = balance - 1 WHERE account_id = ? AND asset = ?').run(uidA, 'GRANT');
ok('恢复后重新全绿', inv.check({}).ok);

db.prepare('UPDATE xy_ledger_balances SET balance = -1 WHERE account_id = ? AND asset = ?').run(uidA, 'CASH');
var negative = inv.check({});
ok('负余额被 I8 抓到', negative.issues.some(function (x) { return x.code === 'I8'; }), negative.issues);
db.prepare('UPDATE xy_ledger_balances SET balance = ? WHERE account_id = ? AND asset = ?').run(5000, uidA, 'CASH');
ok('干净库最终全绿', inv.check({ reserveCent: 5000 }).ok);

console.log('\n=== health() ===');
var h = inv.health({ reserveCent: 5000 });
ok('health 正常', h.ok, h.issues);
eq('健康度可兑付敞口', h.metrics.cash_liability_cent, 5000);

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
console.log('========================================\n');
process.exit(fail === 0 ? 0 : 1);
