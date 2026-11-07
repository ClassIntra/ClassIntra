// 学元账本 · 商店支付验收（独立临时库）
// 用法：node server/scripts-test-ledger-shop.cjs
//
// 覆盖 2026-11-07 定的商品支付制度：
//   1) 商品**只收自己充值的学元** —— 赠金抵扣恒为 0，一分都抵不了
//   2) 只有赠金（含证券投资收益）的账户，买不了任何东西，哪怕成本为 0 的数字品
//   3) 只有真金的账户正常购买；钱不够时报错要说清「还差多少」
//   4) 有成本的商品不能用赠金计价（结构性禁令）
//   5) 第三方卖家：全额真金，平台只赚抽成
//   6) 结算按**实际托管**出账；平台收到的现金 ≥ 真实成本
//   7) 退款按实际托管原路退回
//   8) I4：托管 ≡ 未结 hold ≡ 未结订单面值；I9：商品订单不得出现赠金托管
//   9) 超时未支付自动关单

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ledger-shop-'));
process.env.DB_PATH = path.join(tmpDir, 'ledger.db');
process.env.NODE_ENV = 'test';

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
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
var inv = require('./src/ledger/invariants');
var ledger = require('./src/ledger/ledger');

svc.ensureReady();

var A = '991901';   // 买家（有真金 + 赠金）
var B = '991902';   // 第三方卖家
var C = '991903';   // 只有真金的买家
var S = '991904';   // 只有赠金的买家（模拟「炒股赚的钱撤出来」）
[A, B, C, S].forEach(function (u) { ledger.openUser(u); });

function cash(u) { return svc.balanceOf(u).CASH; }
function grantBal(u) { return svc.balanceOf(u).GRANT; }
function escrowOf(asset) {
  var acc = ledger.systemAccount('escrow', 'orders');
  return ledger.balanceOf(acc.id, asset);
}
function heldHolds(orderId) {
  return svc.orders.detail(orderId).holds.filter(function (h) { return h.state === 'held'; });
}

console.log('\n=== 0. 准备金 ===');
// 单笔充值上限 20 元（小额预存），要备 100 元就分 5 笔
for (var ri = 1; ri <= 5; ri++) {
  svc.recharge({ to: A, amount_cent: 20000, ref: 'r:A:' + ri });
}
svc.issue({ to: A, asset: 'GRANT', amount_cent: 50000, ref: 'g:A', skipQuota: true });
svc.recharge({ to: C, amount_cent: 20000, ref: 'r:C' });
svc.issue({ to: S, asset: 'GRANT', amount_cent: 30000, ref: 'g:S', skipQuota: true });
eq('A 真金 100 元', cash(A), 100000);
eq('A 赠金 50 元', grantBal(A), 50000);
eq('C 只有 20 元真金', cash(C), 20000);
eq('S 只有 30 元赠金', grantBal(S), 30000);

console.log('\n=== 1. 商品规则 ===');
var digital = svc.goods.create({ name: '限定头像框', price_cent: 5000, cost_cent: 0, kind: 'digital' });
eq('数字品成本 0', digital.cost_cent, 0);
var physical = svc.goods.create({ name: '定制笔记本', price_cent: 20000, cost_cent: 8000, kind: 'physical' });
eq('实物成本 8 元 / 售价 20 元', physical.cost_cent, 8000);
throws('成本高于售价需显式确认', function () {
  svc.goods.create({ name: '亏本货', price_cent: 1000, cost_cent: 2000 });
}, /亏本/);

console.log('\n=== 2. 定价资产的结构性禁令 ===');
throws('有成本的商品不能用赠金计价', function () {
  svc.orders.create({ ref: 'bad:1', buyer: A, goods_id: physical.id, asset: 'GRANT' });
}, /只能用充值学元购买/);

var bGoods = svc.goods.create({ name: '同学手作书签', price_cent: 10000, cost_cent: 0, kind: 'digital', seller: B });
eq('第三方卖家上架成功', bGoods.seller_owner, B);
throws('零成本数字品也不能用赠金计价（同学卖的也不行）', function () {
  svc.orders.create({ ref: 'bad:2', buyer: A, goods_id: bGoods.id, asset: 'GRANT' });
}, /只能用充值学元购买/);

console.log('\n=== 3. 商品只收充值学元：赠金一分都不抵 ===');
// A 有 50 元赠金、100 元真金；买 20 元实物
var o1 = svc.orders.create({ ref: 'o1', buyer: A, goods_id: physical.id, kind: 'goods' });
var split = svc.orders.paySplitCent(o1);
eq('有 50 元赠金也抵扣 0', split.grant, 0);
eq('全额走充值学元', split.cash, 20000);

var p1 = svc.orders.pay(o1.id, { ref: 'o1:pay' });
eq('支付后状态 paid', p1.status, 'paid');
eq('实际赠金支付 0', p1.paid_grant_cent, 0);
eq('实际充值学元支付 20 元', p1.paid_cash_cent, 20000);
eq('A 充值余额 −20 元', cash(A), 80000);
eq('A 赠金一分未动', grantBal(A), 50000);
eq('托管 CASH 20 元', escrowOf('CASH'), 20000);
eq('托管里没有赠金', escrowOf('GRANT'), 0);
eq('只有一条 hold（不再拆池）', heldHolds(o1.id).length, 1);
eq('hold 资产是 CASH', heldHolds(o1.id)[0].asset, 'CASH');

// 零成本数字品同样不能用赠金 —— 「赚来的钱」不因为商品成本为 0 就变成购买力
var o2 = svc.orders.create({ ref: 'o2', buyer: A, goods_id: digital.id, kind: 'goods' });
var sp2 = svc.orders.paySplitCent(o2);
eq('零成本数字品也不能用赠金', sp2.grant, 0);
eq('零成本数字品也要付充值学元', sp2.cash, 5000);

console.log('\n=== 4. 只有赠金 → 什么都买不到 ===');
var o4 = svc.orders.create({ ref: 'o4', buyer: S, goods_id: physical.id, kind: 'goods' });
throws('赠金买不了实物', function () { svc.orders.pay(o4.id, { ref: 'o4:pay' }); },
  /只能用自己充值的学元/);
eq('失败不落账（仍 created）', svc.orders.get(o4.id).status, 'created');
eq('失败不托管', escrowOf('CASH'), 20000);
eq('失败不动赠金', grantBal(S), 30000);

var o4b = svc.orders.create({ ref: 'o4b', buyer: S, goods_id: digital.id, kind: 'goods' });
throws('赠金也买不了数字品', function () { svc.orders.pay(o4b.id, { ref: 'o4b:pay' }); },
  /只能用自己充值的学元/);

// C 只有 20 元真金 → 20 元实物刚好够
var o3 = svc.orders.create({ ref: 'o3', buyer: C, goods_id: physical.id, kind: 'goods' });
var sp3 = svc.orders.paySplitCent(o3);
eq('没赠金时全额真金', sp3.cash, 20000);
eq('没赠金时抵扣 0', sp3.grant, 0);
svc.orders.pay(o3.id, { ref: 'o3:pay' });
eq('C 真金清零', cash(C), 0);
// 这一单留着会一直占着托管，后面「托管清零」的断言就说不清了 —— 退掉
svc.orders.refund(o3.id, { ref: 'o3:refund', reason: '用例清理' });
eq('退款后 C 的钱回来', cash(C), 20000);

console.log('\n=== 5. 结算：平台收到的现金 ≥ 真实成本 ===');
var beforePlatform = ledger.balanceOf(ledger.systemAccount('platform').id, 'CASH');
var beforeClearGrant = ledger.balanceOf(ledger.systemAccount('clearing').id, 'GRANT');
svc.orders.fulfill(o1.id, { ref: 'o1:fulfill' });
var done = svc.orders.settle(o1.id, { ref: 'o1:settle' });
eq('结算后 done', done.status, 'done');
eq('托管清零', escrowOf('CASH') + escrowOf('GRANT'), 0);
eq('平台收到 20 元真金', ledger.balanceOf(ledger.systemAccount('platform').id, 'CASH') - beforePlatform, 20000);
ok('平台真金 ≥ 真实成本 8 元',
  ledger.balanceOf(ledger.systemAccount('platform').id, 'CASH') - beforePlatform >= done.cost_cent,
  { got: ledger.balanceOf(ledger.systemAccount('platform').id, 'CASH') - beforePlatform, cost: done.cost_cent });
eq('没有任何赠金被回收进发行账户',
  ledger.balanceOf(ledger.systemAccount('clearing').id, 'GRANT') - beforeClearGrant, 0);
eq('hold 状态 settled',
  svc.orders.detail(o1.id).holds.every(function (h) { return h.state === 'settled'; }), true);

var costBook = db.prepare("SELECT COALESCE(SUM(amount_cent),0) s FROM xy_ledger_cashbook WHERE type='goods_cost'").get().s;
eq('真金台账记了成本 −8 元', costBook, -8000);

console.log('\n=== 6. 退款：按实际托管原路退回 ===');
var o5 = svc.orders.create({ ref: 'o5', buyer: A, goods_id: physical.id, kind: 'goods' });
var p5 = svc.orders.pay(o5.id, { ref: 'o5:pay' });
var cashBefore = cash(A);
var grantBefore = grantBal(A);
var r5 = svc.orders.refund(o5.id, { ref: 'o5:refund', reason: '拍错了' });
eq('退款状态 refunded', r5.status, 'refunded');
eq('真金原路退回', cash(A), cashBefore + p5.paid_cash_cent);
eq('赠金没有变化（本来就没动）', grantBal(A), grantBefore);
eq('托管清零', escrowOf('CASH') + escrowOf('GRANT'), 0);
eq('hold 全部 released',
  svc.orders.detail(o5.id).holds.every(function (h) { return h.state === 'released'; }), true);

console.log('\n=== 7. 第三方卖家：全额真金，平台抽成 ===');
var o6 = svc.orders.create({ ref: 'o6', buyer: A, goods_id: bGoods.id, kind: 'goods', fee_cent: 2000 });
var p6 = svc.orders.pay(o6.id, { ref: 'o6:pay' });
eq('第三方订单赠金支付 0', p6.paid_grant_cent, 0);
eq('第三方订单真金 = 面值', p6.paid_cash_cent, 10000);
var bBefore = cash(B);
var platBefore = ledger.balanceOf(ledger.systemAccount('platform').id, 'CASH');
svc.orders.fulfill(o6.id, { ref: 'o6:fulfill' });
svc.orders.settle(o6.id, { ref: 'o6:settle' });
eq('卖家收到 面值 − 抽成', cash(B) - bBefore, 8000);
eq('平台抽成 2 元', ledger.balanceOf(ledger.systemAccount('platform').id, 'CASH') - platBefore, 2000);

console.log('\n=== 8. 自检：I4 托管对平 + I9 商品订单无赠金 ===');
var chk = inv.check({});
eq('自检全绿', chk.ok, true);
ok('自检无异常明细', chk.issues.length === 0, chk.issues);
var esc = chk.summary.escrow || {};
var eEsc = esc.escrow || {};
var eHold = esc.holds || {};
var assetsUnion = Object.keys(eEsc).concat(Object.keys(eHold)).filter(function (v, i, a) { return a.indexOf(v) === i; });
ok('托管与 hold 逐资产一致',
  assetsUnion.every(function (a) { return (eEsc[a] || 0) === (eHold[a] || 0); }),
  { escrow: eEsc, holds: eHold });

var grantHolds = db.prepare([
  'SELECT COUNT(*) AS n FROM xy_ledger_holds h',
  'JOIN xy_ledger_orders o ON o.id = h.order_id',
  "WHERE h.asset = 'GRANT' AND o.kind = 'goods'"
].join('\n')).get().n;
eq('全部商品订单里没有一条赠金托管', grantHolds, 0);

// 反向验证 I9 真的会抓：人为插一条赠金托管，自检必须报出来
var grantAcc = ledger.accountOf('user', A).id;
db.prepare([
  'INSERT INTO xy_ledger_holds (order_id, buyer_account_id, seller_account_id, asset, amount_cent, state)',
  "VALUES (?, ?, ?, 'GRANT', 100, 'held')"
].join(' ')).run(o1.id, grantAcc, ledger.systemAccount('platform').id);
var chkBad = inv.check({});
ok('I9 能抓到商品订单的赠金托管',
  chkBad.issues.some(function (i) { return i.code === 'I9'; }),
  chkBad.issues.map(function (i) { return i.code; }));
db.prepare('DELETE FROM xy_ledger_holds WHERE asset = ? AND order_id = ?').run('GRANT', o1.id);
eq('清理后人造数据不再影响自检', inv.check({}).ok, true);

console.log('\n=== 9. 超时关单 ===');
var o7 = svc.orders.create({ ref: 'o7', buyer: A, goods_id: digital.id, kind: 'goods' });
db.prepare("UPDATE xy_ledger_orders SET created_at = ? WHERE id = ?")
  .run(new Date(Date.now() - 3 * 3600 * 1000).toISOString(), o7.id);
var swept = svc.orders.sweepUnpaid();
ok('超时单被关掉', swept >= 1, swept);
eq('订单状态 closed', svc.orders.get(o7.id).status, 'closed');
eq('未支付订单不产生托管', escrowOf('CASH') + escrowOf('GRANT'), 0);

console.log('\n=== 10. 支付幂等 ===');
var o8 = svc.orders.create({ ref: 'o8', buyer: A, goods_id: digital.id, kind: 'goods' });
svc.orders.pay(o8.id, { ref: 'o8:pay' });
var cashAfterPay = cash(A);
throws('已支付订单不能重复支付', function () {
  svc.orders.pay(o8.id, { ref: 'o8:pay' });
}, /状态/);
eq('重复支付不扣钱', cash(A), cashAfterPay);
eq('重复支付不重复托管', escrowOf('CASH'), 5000);

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
process.exit(fail ? 1 : 0);
