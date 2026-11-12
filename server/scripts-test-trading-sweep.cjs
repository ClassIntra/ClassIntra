// scripts-test-trading-sweep.cjs - 交易体系自愈与选池回归（独立临时库）
// 用法（系统 Node）：node server/scripts-test-trading-sweep.cjs
// 覆盖 2026-11-10 四项完善：
//   1) 红包过期退还幂等（确定性 ref，重复 sweep 不重复退钱）
//   2) 部分领取后只退剩余冻结
//   3) AA 付款 pool 参数（只动赠送池）
//   4) 市集已支付/已履约滞留单 14 天后自动退款/结算
var fs = require('fs');
var os = require('os');
var path = require('path');
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-trading-sweep-'));
process.env.DB_PATH = path.join(tmp, 'sweep.db');
process.env.NODE_ENV = 'test';

var db = require('./src/utils/db');
require('./src/utils/migration-runner').runAll();
var svc = require('./src/ledger/service');
svc.ensureReady();
var xy = require('./src/services/xueyuan');
var yuanbao = require('./src/services/yuanbao');
var collect = require('./src/services/collect');
var orders = require('./src/ledger/orders');
var goods = require('./src/ledger/goods');
var inv = require('./src/ledger/invariants');

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + a + '）', a === b, { got: a, want: b }); }
function healthy(label) { var r = inv.check(); ok(label, r.ok, r.issues); }
function throws(name, fn, re) {
  try { fn(); fail++; console.log('  ✗ ' + name + ' → 未抛错'); }
  catch (e) {
    var hit = !re || re.test(e.message);
    if (hit) { pass++; console.log('  ✓ ' + name + '（' + e.message + '）'); }
    else { fail++; console.log('  ✗ ' + name + ' → 错误信息不符: ' + e.message); }
  }
}
function bal(u) {
  var v = xy.viewAccount(u);
  return { cash: v.available_cash, grant: v.available_grant, frozen: v.frozen };
}

var A = '991901', B = '991902';
var insUser = db.prepare("INSERT INTO users (net_name, real_name, user_id, password_hash, status) VALUES (?, ?, ?, 'x', 'active')");
[A, B].forEach(function (u, i) { insUser.run('同学' + i, '测试' + i, u); xy.ensureAccount(u); });
svc.recharge({ to: A, amount_cent: 100000, ref: 'sweep:rc:a' });
svc.issue({ to: A, asset: 'GRANT', amount_cent: 50000, ref: 'sweep:is:a', skipQuota: true });
svc.issue({ to: B, asset: 'GRANT', amount_cent: 10000, ref: 'sweep:is:b', skipQuota: true });

console.log('\n=== 1. 红包过期退还：幂等，不重复退钱 ===');
var before = bal(A);
var p1 = yuanbao.create(A, 10000, 1, '过期测试', 'wallet', { pool: 'grant' });
ok('发红包后钱被冻结', bal(A).frozen > before.frozen, { before: before, after: bal(A) });
db.prepare("UPDATE xy_packet SET expire_at = ? WHERE id = ?").run(Date.now() - 1000, p1.id);
var n1 = yuanbao.sweepExpired();
eq('第一次清理退 1 笔', n1, 1);
eq('红包状态 expired', db.prepare('SELECT status FROM xy_packet WHERE id = ?').get(p1.id).status, 'expired');
eq('钱完整回到可用', bal(A).grant, before.grant);
var n2 = yuanbao.sweepExpired();
eq('重复清理不再动钱', n2, 0);
eq('重复清理后余额不变', bal(A).grant, before.grant);
healthy('红包过期退还后 I1–I9 全绿');

console.log('\n=== 2. 部分领取后只退剩余 ===');
var before2 = bal(A);
var p2 = yuanbao.create(A, 10000, 2, '部分领取', 'wallet', { pool: 'grant' });
var got = yuanbao.claim(p2.id, B, 'wallet', {});
ok('领取成功', got.amount_cent > 0, got);
var frozenLeft = xy.viewAccount(A).frozen;
ok('领取后仍留着剩余冻结', frozenLeft > before2.frozen, { frozen: frozenLeft, before: before2.frozen });
db.prepare("UPDATE xy_packet SET expire_at = ? WHERE id = ?").run(Date.now() - 1000, p2.id);
var n3 = yuanbao.sweepExpired();
eq('过期清理退 1 笔', n3, 1);
eq('只退剩余，不多退', bal(A).frozen, before2.frozen);
healthy('部分领取过期后 I1–I9 全绿');

console.log('\n=== 3. AA 付款支持资产池 ===');
var b3 = bal(A);
var cc = collect.create({ creator: B, title: 'AA 选池测试', members: [A], perCent: 5000, expiresHours: 24 });
var payRes = collect.pay(cc.collect.id, A, { pool: 'grant' });
ok('AA 付款成功', !!payRes && !payRes.duplicate, payRes);
eq('只扣赠送学元', bal(A).grant, b3.grant - xy.fromCent(5000));
eq('充值学元一分未动', bal(A).cash, b3.cash);
healthy('AA 选池付款后 I1–I9 全绿');

console.log('\n=== 4. 市集滞留订单自动收尾 ===');
var g = goods.create({ name: '滞留测试品', price_cent: 3000, cost_cent: 0, kind: 'digital' });
var o1 = orders.create({ ref: 'sweep:o1', buyer: A, goods_id: g.id, face_cent: 3000, cost_cent: 0 });
orders.pay(o1.id, { ref: 'sweep:o1:pay' });
db.prepare("UPDATE xy_ledger_orders SET created_at = ? WHERE id = ?")
  .run(new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(), o1.id);
var n4 = orders.sweepStale();
ok('超时未履约单被收尾', n4 >= 1, n4);
eq('状态变为 refunded', orders.get(o1.id).status, 'refunded');
healthy('自动退款后 I1–I9 全绿');

var g2 = goods.create({ name: '已交付测试品', price_cent: 2000, cost_cent: 0, kind: 'digital' });
var o2 = orders.create({ ref: 'sweep:o2', buyer: A, goods_id: g2.id, face_cent: 2000, cost_cent: 0 });
orders.pay(o2.id, { ref: 'sweep:o2:pay' });
orders.fulfill(o2.id, { ref: 'sweep:o2:ful' });
db.prepare("UPDATE xy_ledger_orders SET created_at = ? WHERE id = ?")
  .run(new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(), o2.id);
var n5 = orders.sweepStale();
ok('超时未结算单被收尾', n5 >= 1, n5);
eq('状态变为 done', orders.get(o2.id).status, 'done');
healthy('自动结算后 I1–I9 全绿');

console.log('\n=== 5. 声明冻结 > 槽里实额：按实额退、尾差只关状态（账本切换遗留） ===');
var before5 = bal(A);
var p5 = yuanbao.create(A, 10000, 1, '尾差模拟', 'wallet', { pool: 'grant' });
// 模拟历史脏数据：记录声明 50000 分 cash 冻结，槽里实际只有创建时的 10000 分 grant
db.prepare("UPDATE xy_packet SET pool = ?, remaining_cent = ?, expire_at = ? WHERE id = ?")
  .run(JSON.stringify({ cash: 50000, grant: 0 }), 50000, Date.now() - 1000, p5.id);
var n5b = yuanbao.sweepExpired();
eq('脏数据红包被收尾', n5b, 1);
eq('状态已关', db.prepare('SELECT status FROM xy_packet WHERE id = ?').get(p5.id).status, 'expired');
ok('没有凭空多退钱', bal(A).grant <= before5.grant, { before: before5, after: bal(A) });
healthy('尾差容错后 I1–I9 全绿');

console.log('\n=== 6. AA 过期单自动关（只改状态，不碰钱） ===');
var cc2 = collect.create({ creator: B, title: '过期关单测试', members: [A], perCent: 1000, expiresHours: 24 });
db.prepare("UPDATE xy_collect SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, cc2.collect.id);
var n6 = collect.sweepExpired();
ok('过期单被关掉', n6 >= 1, n6);
eq('状态 closed', db.prepare('SELECT status FROM xy_collect WHERE id = ?').get(cc2.collect.id).status, 'closed');
throws('过期单不能再付款', function () { collect.pay(cc2.collect.id, A, {}); }, /过期|结束/);
healthy('AA 关单后 I1–I9 全绿');

console.log('\n=== 7. 市集禁止自买自卖 ===');
var g3 = goods.create({ seller: A, name: '自卖品', price_cent: 1000, cost_cent: 0, kind: 'digital' });
throws('不能买自己上架的商品', function () {
  orders.create({ ref: 'sweep:self', buyer: A, goods_id: g3.id, face_cent: 1000, cost_cent: 0 });
}, /不能买自己/);
healthy('自买自卖护栏后 I1–I9 全绿');

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
process.exit(fail ? 1 : 0);
