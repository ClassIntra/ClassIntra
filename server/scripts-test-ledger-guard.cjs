// 学元账本 · 护栏回归（独立临时库）
// 用法：node server/scripts-test-ledger-guard.cjs
//
// 覆盖本轮修的 4 个问题：
//   ① amount_yuan 换算按 100 而不是 1000
//   ② 小额上限 2000 实际只放开 ¥2，与注释「20 元」矛盾
//   ③ 订单接口没有归属校验，任何人能替别人支付/关单/发起争议
//   ④ 红包面收敛绊线（唯一实现 = yuanbao，/api/ledger 不再注册红包路由）

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ledger-guard-'));
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
var units = require('./src/ledger/units');
var rechargeTpl = require('./src/ledger/templates/recharge');
var orders = require('./src/ledger/orders');
var inv = require('./src/ledger/invariants');
var ledger = require('./src/ledger/ledger');

svc.ensureReady();

var A = '991801';
var B = '991802';
var STRANGER = '999999';
ledger.openUser(A);
ledger.openUser(B);
ledger.openUser(STRANGER);

// 2026-11-07 归位：1 元 = 1000 学元 × 100 账本单位/学元 = 100000 单位。
// 旧值 1000 是把「汇率」当成「单位换算」，导致 /api/xy 充值少 100 倍、
// 订单 ¥ 展示大 100 倍、单笔上限被悄悄收紧 100 倍。详见 ledger/units.js。
console.log('\n=== ① 计量单位（统一口径）===');
eq('口径已统一', units.scaleAudit().unified, true);
eq('1 元 = 100000 账本单位', units.yuanToUnits(1), 100000);
eq('0.5 元 = 50000 账本单位', units.yuanToUnits(0.5), 50000);
eq('20 元 = 2000000 账本单位', units.yuanToUnits(20), 2000000);
eq('反向换算', units.unitsToYuan(2000000), 20);

console.log('\n=== ② 小额预存上限 ===');
eq('上限常量 = 20 元', rechargeTpl.MAX_RECHARGE_CENT, units.yuanToUnits(20));
eq('提现上限 = 20 元', rechargeTpl.MAX_WITHDRAW_CENT, units.yuanToUnits(20));
var r1 = svc.recharge({ to: A, amount_cent: units.yuanToUnits(20), ref: 'g:recharge' });
eq('刚好 20 元可充值', ledger.userBalance(A, 'CASH'), units.yuanToUnits(20));
throws('超过 20 元拒绝', function () {
  svc.recharge({ to: A, amount_cent: units.yuanToUnits(20) + 1, ref: 'g:over' });
}, /不能超过/);
eq('失败充值不落账', ledger.userBalance(A, 'CASH'), units.yuanToUnits(20));

console.log('\n=== ③ 订单归属 ===');
var o = svc.orders.create({
  ref: 'g:order', buyer: A, seller: B, face_cent: 1000,
  fee_cent: 100, kind: 'goods'
});
var d = orders.detail(o.id);
eq('detail 带出买方账号', d.buyer_owner, A);
eq('detail 带出卖方账号', d.seller_owner, B);
ok('买方可读可付', orders.assertAccess(d, A, 'buyer'));
ok('买卖双方都可读', orders.assertAccess(d, A, 'party'));
ok('卖方可履约', orders.assertAccess(d, B, 'seller'));
throws('买方不能替卖家履约', function () { orders.assertAccess(d, A, 'seller'); }, /无权操作/);
throws('路人不能碰订单', function () { orders.assertAccess(d, STRANGER, 'party'); }, /无权操作/);
throws('路人不能替人支付', function () { orders.assertAccess(d, STRANGER, 'buyer'); }, /无权操作/);
ok('班管放行', orders.assertAccess(d, STRANGER, 'buyer', { isAdmin: true }));
throws('空身份拒绝', function () { orders.assertAccess(d, '', 'buyer'); }, /无权操作/);

console.log('\n=== ④ 红包面已收敛（唯一实现 = services/yuanbao.js）===');
// 原第 ④ 节用 ledger 红包模板测「详情隐私」；该实现随 v1.7.0 发布收敛整体移除
// （前端零调用、不走统一支付风控），改为三道绊线，防止第二套红包绕过风控回归：
ok('账本门面不再导出 redpacket', svc.redpacket === undefined);
ok('ledger 红包模板文件已移除', !fs.existsSync(path.join(__dirname, 'src', 'ledger', 'templates', 'redpacket.js')));
ok('删除后资金面自洽（I1–I8 预检无红包遗留分录）', inv.check({ reserveCent: inv.cashbookNetCent() }).ok);

console.log('\n=== ⑤ 健康度：真金作为备付 ===');
var h = inv.health({ reserveCent: inv.cashbookNetCent() });
ok('I1–I8 全绿', h.ok, h.issues);
eq('兑付覆盖率 100%', h.metrics.reserve_coverage, 1);
eq('账面现金 = 真金台账', h.metrics.cash_on_book_cent, h.metrics.cashbook_net_cent);

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
console.log('========================================\n');
process.exit(fail === 0 ? 0 : 1);
