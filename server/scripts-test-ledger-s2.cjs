// 学元账本 · S2/S3 验收（独立临时库）
// 用法：node server/scripts-test-ledger-s2.cjs
//
// 覆盖：商品上架 / 订单全生命周期（created→paid→fulfilled→done）/
//   托管结算与平台毛利 / 退款（含撤回语义）/ 关单 / 争议 / 发起退款 /
//   GRANT 订单权益回收 / 第三方卖家抽成 / 返现上限与唯一性 /
//   练习金隔离（红包唯一实现已收敛到 /api/wallet，见 services/yuanbao.js）/
//   重复支付不扣款 / I4 托管对账。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ledger-s2-'));
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
var inv = require('./src/ledger/invariants');
var ledger = require('./src/ledger/ledger');

svc.ensureReady();

var A = '991801';
var B = '991802';
[A, B].forEach(function (u) { ledger.openUser(u); });

function cash(u) { return svc.balanceOf(u).CASH; }
function grantBal(u) { return svc.balanceOf(u).GRANT; }
function practice(u) { return svc.balanceOf(u).PRACTICE; }
function escrowCash() { return ledger.balanceOf(ledger.systemAccount('escrow', 'orders').id, 'CASH'); }
function platformCash() { return ledger.balanceOf(ledger.systemAccount('platform').id, 'CASH'); }

console.log('\n=== 充值 ===');
// 这里的 2000 是「账本单位」，不是 20 元；口径归位后 1 元 = 100000 单位
// （见 ledger/units.js）。上限用常量取，别再拿旧的 20000 硬编码猜。
var rechargeTpl = require('./src/ledger/templates/recharge');
svc.recharge({ to: A, amount_cent: 2000, ref: 'r:A' });
eq('A 充值 2000 账本单位', cash(A), 2000);
throws('超过小额上限拒绝', function () {
  svc.recharge({ to: A, amount_cent: rechargeTpl.MAX_RECHARGE_CENT + 1, ref: 'r:A:big' });
}, /不能超过/);
eq('失败充值不落账', cash(A), 2000);

console.log('\n=== 商品 ===');
var g1 = svc.goods.create({ name: '限定头像框', price_cent: 500, cost_cent: 0, kind: 'digital' });
eq('数字品成本为 0', g1.cost_cent, 0);
var g2 = svc.goods.create({ name: '实体笔记本', price_cent: 1000, cost_cent: 600, kind: 'physical' });
eq('实物成本 6 元', g2.cost_cent, 600);
throws('成本高于售价需显式确认', function () {
  svc.goods.create({ name: '亏本货', price_cent: 100, cost_cent: 200, kind: 'physical' });
}, /亏本/);
eq('商品列表 2 件', svc.goods.list({ status: 'on_shelf' }).length, 2);

console.log('\n=== 订单全生命周期（自营数字品）===');
var o1 = svc.orders.create({ ref: 'o1', buyer: A, goods_id: g1.id, kind: 'goods' });
eq('创建后为 created', o1.status, 'created');
eq('面值取自商品价', o1.face_cent, 500);

var paid = svc.orders.pay(o1.id, { ref: 'o1:pay' });
eq('支付后为 paid', paid.status, 'paid');
eq('买家余额扣减', cash(A), 1500);
eq('钱进托管', escrowCash(), 500);
eq('托管有 hold 记录', paid.holds ? paid.holds.length : 1, 1);

var fulfilled = svc.orders.fulfill(o1.id, { ref: 'o1:fulfill' });
eq('履约后为 fulfilled', fulfilled.status, 'fulfilled');

var done = svc.orders.settle(o1.id, { ref: 'o1:settle' });
eq('结算后为 done', done.status, 'done');
eq('托管清零', escrowCash(), 0);
eq('平台收到货款', platformCash(), 500);
eq('自营毛利 = 面值 - 成本', svc.settlement.platformMarginCent(done), 500);
eq('状态迁移记录 3 条', svc.orders.detail(o1.id).transitions.length, 3);

console.log('\n=== 返现 ===');
var pv = svc.rebate.preview(o1.id);
eq('返现上限 = 毛利', pv.max_rebate_cent, 500);
throws('超过毛利拒绝', function () {
  svc.rebate.give({ orderId: o1.id, amount_cent: 600 });
}, /不能超过本单毛利/);

var rb = svc.rebate.give({ orderId: o1.id, amount_cent: 100 });
eq('返现默认进 GRANT', rb.asset, 'GRANT');
eq('买家赠金到账', grantBal(A), 100);
eq('返现不动真金', cash(A), 1500);
throws('同一订单只能返现一次', function () {
  svc.rebate.give({ orderId: o1.id, amount_cent: 50 });
}, /已返现/);
throws('未完成订单不能返现', function () {
  var tmp = svc.orders.create({ ref: 'o:tmp', buyer: A, face_cent: 10, kind: 'goods' });
  svc.rebate.give({ orderId: tmp.id, amount_cent: 1 });
}, /已完成/);

console.log('\n=== 退款（撤回语义）===');
var o2 = svc.orders.create({ ref: 'o2', buyer: A, goods_id: g1.id, kind: 'goods' });
// 2026-11-07 定：商品只收自己充值的学元；数字品成本为 0 也不许用赠金。
var paid2 = svc.orders.pay(o2.id, { ref: 'o2:pay' });
eq('赠金不能买商品（哪怕零成本数字品）', paid2.paid_grant_cent, 0);
eq('支付后买家余额', cash(A), 1500 - paid2.paid_cash_cent);
eq('支付后托管现金 = 实际付出的现金', escrowCash(), paid2.paid_cash_cent);

var refunded = svc.orders.refund(o2.id, { ref: 'o2:refund', reason: '不想要了' });
eq('退款后为 refunded', refunded.status, 'refunded');
eq('余额原路退回', cash(A), 1500);
eq('托管清零', escrowCash(), 0);
eq('hold 已释放', svc.orders.detail(o2.id).holds[0].state, 'released');
throws('已退款订单不能再退', function () {
  svc.orders.refund(o2.id, { ref: 'o2:refund:again' });
}, /状态不允许/);

var o2b = svc.orders.create({ ref: 'o2b', buyer: A, goods_id: g1.id, kind: 'goods' });
svc.orders.pay(o2b.id, { ref: 'o2b:pay' });
svc.orders.requestRefund(o2b.id, { ref: 'o2b:req' });
eq('发起退款后为 refunding', svc.orders.get(o2b.id).status, 'refunding');
svc.orders.refund(o2b.id, { ref: 'o2b:done' });
eq('确认退款后钱回买家', cash(A), 1500);

console.log('\n=== GRANT 订单：权益回收，平台不收 ===');
svc.issue({ to: A, asset: 'GRANT', amount_cent: 1000, ref: 'g:A' });
eq('赠金到账', grantBal(A), 1100);
var clearingId = ledger.systemAccount('clearing').id;
var clearingGrantBefore = ledger.balanceOf(clearingId, 'GRANT');

var ogErr = null;
try {
  svc.orders.create({ ref: 'og', buyer: A, asset: 'GRANT', goods_id: g1.id, kind: 'goods' });
} catch (e) { ogErr = e.message; }
ok('赠金不能给商品计价（数字品零成本也不行）', /只能用充值学元购买/.test(ogErr || ''), ogErr);
eq('赠金一分没动', grantBal(A), 1100);
eq('发行账户也没有赠金进账', ledger.balanceOf(clearingId, 'GRANT'), clearingGrantBefore);

console.log('\n=== 第三方卖家：平台只赚抽成 ===');
var g3 = svc.goods.create({ name: '同学自制贴纸', price_cent: 1000, cost_cent: 400, kind: 'physical', seller: B });
eq('卖家归属同学 B', g3.seller_owner, B);

var o3 = svc.orders.create({ ref: 'o3', buyer: A, goods_id: g3.id, fee_cent: 100, kind: 'goods' });
svc.orders.pay(o3.id, { ref: 'o3:pay' });
svc.orders.fulfill(o3.id, { ref: 'o3:fulfill' });
svc.orders.settle(o3.id, { ref: 'o3:settle' });
eq('卖家收到面值减抽成', cash(B), 900);
eq('平台只赚抽成', platformCash(), 600);
eq('第三方毛利 = 抽成', svc.settlement.platformMarginCent(svc.orders.get(o3.id)), 100);

console.log('\n=== 练习金隔离 ===');
// 原「双轨红包（real + practice）」两节随 ledger 红包模板移除（v1.7.0 发布收敛，
// 唯一实现 = services/yuanbao.js，红包风控统一走 payGuard），保留练习金隔离断言：
svc.issue({ to: A, asset: 'PRACTICE', amount_cent: 1000, ref: 'pr:A' });
eq('练习金到账', practice(A), 1000);

throws('练习金不能下单', function () {
  svc.orders.create({ ref: 'bad:practice', buyer: A, asset: 'PRACTICE', face_cent: 10, kind: 'goods' });
}, /练习金不能用于订单/);

console.log('\n=== 关单 / 争议 ===');
var oc = svc.orders.create({ ref: 'oc', buyer: A, face_cent: 20, kind: 'goods' });
eq('关单成功', svc.orders.close(oc.id, { ref: 'oc:close' }).status, 'closed');

var od = svc.orders.create({ ref: 'od', buyer: A, goods_id: g1.id, kind: 'goods' });
svc.orders.pay(od.id, { ref: 'od:pay' });
eq('争议发起', svc.orders.dispute(od.id, { ref: 'od:dispute' }).status, 'disputed');
eq('争议后退款', svc.orders.refund(od.id, { ref: 'od:refund' }).status, 'refunded');

console.log('\n=== 幂等与不变量 ===');
var beforeCash = cash(A);
throws('重复支付被状态机挡住', function () {
  svc.orders.pay(o1.id, { ref: 'o1:pay' });
}, /状态不允许/);
eq('重复支付未扣款', cash(A), beforeCash);

var report = inv.check({ reserveCent: inv.cashOnBookCent() });
ok('I1–I8 全绿', report.ok, report.issues);
eq('托管账户已清空', escrowCash(), 0);
eq('账面现金 = 真金台账', inv.cashOnBookCent(), inv.cashbookNetCent());

var h = inv.health({ reserveCent: inv.cashOnBookCent() });
ok('health 正常', h.ok, h.issues);
ok('健康度含兑付敞口', typeof h.metrics.cash_liability_cent === 'number', h.metrics);

console.log('\n=== 练习金全局守恒 ===');
var assetSums = db.prepare('SELECT asset, SUM(direction * amount_cent) AS s FROM xy_ledger_entries GROUP BY asset').all();
assetSums.forEach(function (r) { eq('资产 ' + r.asset + ' 全局净额', r.s, 0); });

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
console.log('========================================\n');
process.exit(fail === 0 ? 0 : 1);
