// 学元钱包 · 接口契约回归（独立临时库，绝不碰生产数据）
// 用法：node server/scripts-test-wallet-contract.cjs
//
// ---- 为什么需要这份测试 ----
// 之前所有测试都是「服务函数自己调自己」：传的入参恰好是函数声明里那几个字段。
// 于是「路由传 body.amount、服务只读 o.yuan」「前端只发红包码、路由却要求口令」
// 这类**跨边界的形状错配**一路全绿地进了生产。
//
// 本测试只做一件事：按 HTTP 路由 / 前端真实发送的字段形状调用服务，
// 并把跨班两阶段（发送方响应 → 领取方入账 → 后台补账）在同一进程里跑通。
// 覆盖：提现金额 / 本班红包 / 跨班红包预览与领取 / 资产拆分 / 真金台账 I2 /
//       补账幂等 / 跨班转账 / AA / 单位口径绊线。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-wallet-contract-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';
process.env.RELAY_SECRET = 'ci-contract-secret';
process.env.RELAY_SERVER_ID = 'ci-a';

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

// 迁移日志很吵，只在建库期间静音
var realLog = console.log;
console.log = function () {};
var runner = require('./src/utils/migration-runner');
runner.runAll();
console.log = realLog;

var db = require('./src/utils/db');
var units = require('./src/ledger/units');
var svc = require('./src/ledger/service');
var inv = require('./src/ledger/invariants');
var cashbook = require('./src/ledger/cashbook');
var xy = require('./src/services/xueyuan');
var yuanbao = require('./src/services/yuanbao');
var packetCross = require('./src/services/packet-cross');
var crossPay = require('./src/services/cross-pay');
var peers = require('./src/services/peers');
var collect = require('./src/services/collect');

svc.ensureReady();

var A = '991801';   // 提现 / 收红包
var B = '991802';   // 本班发红包 / 跨班领取人
var S = '991803';   // 跨班发红包
var PEER_BASE = 'http://127.0.0.1:19999';

var ins = db.prepare("INSERT INTO users (net_name, real_name, user_id, password_hash, status) VALUES (?, ?, ?, 'x', 'active')");
[A, B, S].forEach(function (u, i) { ins.run('同学' + i, '测试' + i, u); });
[A, B, S].forEach(function (u) { xy.ensureAccount(u); });

function cash(u) { return svc.balanceOf(u).CASH; }
function grant(u) { return svc.balanceOf(u).GRANT; }
function healthy(label) {
  var r = inv.check();
  ok(label, r.ok, r.issues);
  return r;
}

// 记录跨班请求，供断言「领取方到底发了什么」
var requests = [];
var probeResponse = null;
var claimResponse = null;
function stubPostJson(base, urlPath, body) {
  requests.push({ base: base, path: urlPath, body: body });
  var isProbe = /\/probe$/.test(String(urlPath));
  return Promise.resolve({ status: 200, body: isProbe ? probeResponse : claimResponse });
}

async function main() {
  console.log('\n=== 0. 单位口径绊线 ===');
  var scale = units.scaleAudit();
  eq('1 元 = 1000 学元', scale.xueyuanPerYuan, 1000);
  eq('1 学元 = 100 账本单位', scale.unitsPerXueyuan, 100);
  eq('账本口径 1 元 = 100000 单位', scale.ledgerUnitsPerYuan, 100000);
  eq('钱包口径 1 元 = 100000 单位', scale.walletUnitsPerYuan, 100000);
  eq('口径已统一（倍差 1）', scale.unified, true);
  eq('toCent / fromCent 往返', xy.fromCent(xy.toCent(12.34)), 12.34);
  eq('yuanToCent 走同一份单位定义', xy.yuanToCent(1), units.yuanToUnits(1));
  eq('unitsToYuan 与钱包口径一致', units.unitsToYuan(100000), 1);

  console.log('\n=== 1. 提现：按前端真实字段形状 ===');
  xy.recharge({ user: A, operator: A, yuan: 1, requestId: 'rc:contract:1' });
  var w1 = xy.requestWithdraw({ user: A, amount: 1000, memo: '契约测试' });
  eq('提现成功（前端传学元 amount）', w1.withdraw.status, 'pending');
  eq('金额换算 = 100000 账本单位', w1.withdraw.amount_cent, xy.toCent(1000));
  throws('非法金额给出可读提示', function () {
    xy.requestWithdraw({ user: A, amount: 'abc' });
  }, /请填写大于 0 的学元数额/);
  throws('缺金额不给「整数分」黑话', function () {
    xy.requestWithdraw({ user: A });
  }, /请填写大于 0 的学元数额/);
  xy.cancelWithdraw(w1.withdraw.id, { user: A });
  var w2 = xy.requestWithdraw({ user: A, amountCent: xy.toCent(1000) });
  eq('内部 amountCent 通道仍可用', w2.withdraw.amount_cent, xy.toCent(1000));
  xy.cancelWithdraw(w2.withdraw.id, { user: A });
  healthy('提现后 I1–I9 全绿');

  console.log('\n=== 2. 本班红包：按路由形状 ===');
  xy.mint({ to: B, amountCent: xy.toCent(2000), pool: 'grant', kind: 'grant', ref: 'g:contract:B', operator: A });
  var beforeA = grant(A);
  var pkt = yuanbao.create(B, xy.toCent(500), 1, '本班测试', 'wallet', {});
  var got = yuanbao.claim(pkt.id, A, 'wallet', {});
  eq('领取金额正确', got.amount_cent, xy.toCent(500));
  eq('领取人赠送池增加', grant(A) - beforeA, xy.toCent(500));
  eq('本班红包不写真金台账',
    db.prepare("SELECT COUNT(*) c FROM xy_ledger_cashbook WHERE type LIKE 'cross_%'").get().c, 0);
  healthy('本班红包后 I1–I9 全绿');

  console.log('\n=== 3. 跨班红包：预览 / 领取 / 补账 ===');
  // 发送方准备：CASH 与 GRANT 各一部分，才能验证按池拆分
  svc.recharge({ to: S, amount_cent: xy.toCent(100), ref: 'rc:contract:S' });
  xy.mint({ to: S, amountCent: xy.toCent(2000), pool: 'grant', kind: 'grant', ref: 'g:contract:S', operator: A });
  var xPkt = yuanbao.create(S, xy.toCent(1000), 1, '跨班测试', 'wallet', { scope: 'cross' });
  ok('跨班红包生成 6 位码', /^[A-Z0-9]{6}$/.test(xPkt.code || ''), xPkt.code);

  // 3.1 发送方一侧：模拟对端带签名请求
  var claimPayload = {
    ts: Date.now(), kind: 'claim', ref: 'ci:claim:1',
    code: String(xPkt.code).toUpperCase(), claimer: B,
    from_server: 'ci-b', from_base: PEER_BASE, phrase: ''
  };
  claimPayload.sig = packetCross.sign(claimPayload);
  var senderResp = packetCross.receiveClaim(claimPayload);
  eq('发送方领取成功', senderResp.code, 200);
  var sd = senderResp.data || {};
  eq('回传总额', sd.amount_cent, xy.toCent(1000));
  ok('回传按资产拆分（旧版这里两个字段全丢）',
    typeof sd.cash_cent === 'number' && typeof sd.grant_cent === 'number', sd);
  eq('拆分之和 = 总额', sd.cash_cent + sd.grant_cent, sd.amount_cent);
  ok('两种资产都出现', sd.cash_cent > 0 && sd.grant_cent > 0, sd);

  // 3.2 领取方一侧：预览（只给 code，不给 phrase —— 就是学生输入红包码的场景）
  var previewPacket = yuanbao.preview(
    db.prepare('SELECT * FROM xy_packet WHERE id = ?').get(xPkt.id), B);
  crossPay.postJson = stubPostJson;
  probeResponse = { code: 200, message: 'ok', data: { server_id: 'ci-b', packet: previewPacket } };
  peers.upsert('ci-b', PEER_BASE, '外班', 'contract');

  var codeOnly = await packetCross.lookup('ZZZZ99', B, '');
  eq('只有红包码也能查到外班红包', codeOnly.cross, true);
  eq('预览带回对端地址', codeOnly.base_url, PEER_BASE);
  eq('预览不泄漏口令', codeOnly.passphrase, '');
  var localInfo = await packetCross.lookup(String(xPkt.code).toUpperCase(), B, '');
  eq('本班仍优先走本地预览', localInfo.cross, false);

  // 3.3 领取方：完整走 claimRemote → attempt
  var cashBefore = cash(B);
  var grantBefore = grant(B);
  claimResponse = { code: 200, message: '领取成功', data: sd };
  var out = await packetCross.claimRemote({ userId: B, code: xPkt.code, baseHint: PEER_BASE });
  eq('跨班领取成功', out.amount_cent, sd.amount_cent);
  eq('CASH 按拆分入账', cash(B) - cashBefore, sd.cash_cent);
  eq('GRANT 按拆分入账', grant(B) - grantBefore, sd.grant_cent);
  eq('真金台账记入 cross_in',
    db.prepare("SELECT COALESCE(SUM(amount_cent),0) s FROM xy_ledger_cashbook WHERE type='cross_in'").get().s,
    sd.cash_cent);
  eq('真金台账记入 cross_out',
    db.prepare("SELECT COALESCE(SUM(amount_cent),0) s FROM xy_ledger_cashbook WHERE type='cross_out'").get().s,
    -sd.cash_cent);
  healthy('跨班领取后 I2 仍平（真金跨班不穿账）');

  // 3.4 后台补账必须幂等（旧版参数错位会再发一次钱）
  var row = db.prepare('SELECT * FROM xy_cross_packet ORDER BY id DESC LIMIT 1').get();
  ok('落库保存按池拆分', row && (row.cash_cent + row.grant_cent) === row.amount_cent, row);
  db.prepare("UPDATE xy_cross_packet SET status='assigned', updated_at = ? WHERE ref = ?")
    .run(Date.now() - 20000, row.ref);
  var cashAfter = cash(B);
  var grantAfter = grant(B);
  await packetCross.retryOnce();
  eq('补账不重复增加 CASH', cash(B), cashAfter);
  eq('补账不重复增加 GRANT', grant(B), grantAfter);
  eq('补账不重复写真金台账',
    db.prepare("SELECT COUNT(*) c FROM xy_ledger_cashbook WHERE type='cross_in'").get().c, 1);
  healthy('补账后 I1–I9 全绿');

  console.log('\n=== 4. 跨班转账：CASH 入账同步负债 ===');
  var payPayload = {
    ts: Date.now(), ref: 'ci:crosspay:1', from: S, from_name: '外班',
    from_server: 'ci-b', from_base: PEER_BASE,
    token: 'user:' + A, amount_cent: xy.toCent(200), memo: '跨班转入',
    cash_cent: xy.toCent(200), grant_cent: 0
  };
  payPayload.sig = crossPay.sign(payPayload);
  var ca0 = cash(A);
  var pr = crossPay.receive(payPayload);
  eq('跨班转账入账成功', pr.code, 200);
  eq('CASH 到账', cash(A) - ca0, xy.toCent(200));
  healthy('跨班转账后 I2 仍平');

  console.log('\n=== 5. AA 收款：前端按学元传 per ===');
  var aa = collect.create({
    creator: A, title: '契约测试', members: [B],
    perCent: xy.toCent(100), expiresHours: 24
  });
  eq('AA 创建成功', aa.collect.status, 'open');
  eq('每人金额按学元换算', aa.collect.per_cent, xy.toCent(100));
  var bGrant0 = grant(B);
  var aGrant0 = grant(A);
  collect.pay(aa.collect.id, B);
  ok('付款后发起人收到学元', grant(A) >= aGrant0);
  ok('付款后付款人减少学元', grant(B) <= bGrant0);
  healthy('AA 后 I1–I9 全绿');

  console.log('\n=== 结果 ===');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  if (fail) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('\n契约测试异常:', e && e.stack || e);
  process.exitCode = 1;
});
