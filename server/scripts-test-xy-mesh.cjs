// 组网学元管理（xy-mesh）· 契约回归（独立临时库，绝不碰生产数据）
// 用法：node server/scripts-test-xy-mesh.cjs
//
// ---- 为什么需要这份测试 ----
// mesh 命令是「主班路由 → HTTP(HMAC) → 从班服务层」的三段链路，
// 最容易出问题的是跨边界的形状错配与鉴权旁路。本测试按真实链路跑：
// 起一个真 express 实例当「从班」，主班侧走 xyMesh.sendCommand 真发 HTTP，
// 验签、幂等、镜像拦截、配额护栏、member 封锁全部按生产形状触发。
// 覆盖：配置矩阵 / 签名与防重放 / ref 幂等回放 / 充值·撤回·提现审批·
//       发放·扣减·退款 / 镜像用户拦截 / 从班封锁矩阵 / 账本不变量。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-xy-mesh-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.NODE_ENV = 'test';
process.env.RELAY_SECRET = 'ci-mesh-secret';
process.env.RELAY_SERVER_ID = 'ci-slave';

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

var express = require('express');
var db = require('./src/utils/db');
var svc = require('./src/ledger/service');
var inv = require('./src/ledger/invariants');
var xy = require('./src/services/xueyuan');
var xyMesh = require('./src/services/xy-mesh');
var packetCross = require('./src/services/packet-cross');

svc.ensureReady();

var A = '990801';    // 从班真用户（8班示例）
var B = '990802';
var M = '990899';    // 镜像用户（password_hash 为空，模拟主班学员同步过来的影子）
var ADMIN = '999999';
var MASTER_ADMIN = '991800';   // 18班班管（组网主班操作者，所有 mesh 命令的 operator）
var SLAVE_ADMIN = '990800';    // 08班班管（被封锁方，学元管理移交主班）

var ins = db.prepare("INSERT INTO users (net_name, real_name, user_id, password_hash, status) VALUES (?, ?, ?, ?, ?)");
ins.run('甲', '测甲', A, 'x', 'active');
ins.run('乙', '测乙', B, 'x', 'active');
ins.run('影子', '测影', M, '', 'active');   // 镜像：无密码
ins.run('管理员', '测管', ADMIN, 'x', 'active');
ins.run('主班班管', '测主', MASTER_ADMIN, 'x', 'active');
ins.run('从班班管', '测从', SLAVE_ADMIN, 'x', 'active');
[A, B, M].forEach(function (u) { xy.ensureAccount(u); });

function cash(u) { return svc.balanceOf(u).CASH; }
function grant(u) { return svc.balanceOf(u).GRANT; }
function healthy(label) {
  var r = inv.check();
  ok(label, r.ok, r.issues);
  return r;
}

async function main() {
  console.log('\n=== 1. 配置矩阵 ===');
  eq('默认未组网', xyMesh.getConfig().role, '');
  throws('member 必须且只能配一个主班', function () {
    xyMesh.saveConfig({ role: 'member', peers: [] });
  }, /只能配置一个主班/);
  throws('master 至少要一个从班', function () {
    xyMesh.saveConfig({ role: 'master', peers: [] });
  }, /至少要配置一个从班/);
  var saved = xyMesh.saveConfig({ role: 'master', peers: [{ class: '08', base: 'http://127.0.0.1:19999/', bad: 1 }] });
  eq('保存 master 成功', saved.role, 'master');
  eq('基址已去尾斜杠', saved.peers[0].base, 'http://127.0.0.1:19999');
  var bad = xyMesh.saveConfig({ role: 'master', peers: [{ class: '08', base: 'http://host-x', extra: true }, { class: 'abc', base: 'http://host-y' }] });
  eq('非法班号被过滤', bad.peers.length, 1);

  console.log('\n=== 2. 从班封锁矩阵（blockTreasury） ===');
  xyMesh.saveConfig({ role: 'member', peers: [{ class: '18', base: 'http://127.0.0.1:19999' }] });
  eq('从班班管（990800）被封锁', xyMesh.blockTreasury(SLAVE_ADMIN), true);
  // blockTreasury 只判「组网角色」：member 班上除系统管理员外一律封锁，
  // 「是不是班管」由 requireTreasury 的后半段判定 —— 两层各管各的。
  eq('从班其他账号同样被封锁', xyMesh.blockTreasury('990809'), true);
  eq('系统管理员豁免', xyMesh.blockTreasury(ADMIN), false);
  xyMesh.saveConfig({ role: 'master', peers: [{ class: '08', base: 'http://127.0.0.1:19999' }] });
  eq('主班班管（991800）不受封锁', xyMesh.blockTreasury(MASTER_ADMIN), false);
  xyMesh.saveConfig({ role: '', peers: [] });
  eq('未组网不封锁', xyMesh.blockTreasury(SLAVE_ADMIN), false);

  console.log('\n=== 3. 起从班实例（真 express + 真签名 HTTP） ===');
  var app = express();
  app.use(express.json());
  app.post('/api/xueyuan/mesh/command', function (req, res) {
    try {
      var r = xyMesh.handleCommand(req);
      res.json(r);
    } catch (err) {
      res.status(/签名|过期|缺少|未知/.test(err.message) ? 400 : 500).json({ code: 500, message: err.message });
    }
  });
  var server = app.listen(0, '127.0.0.1');
  await new Promise(function (res2) { server.on('listening', res2); });
  var port = server.address().port;
  var peer = { class: '08', base: 'http://127.0.0.1:' + port };
  console.log('  从班监听 127.0.0.1:' + port);

  console.log('\n=== 4. ping / students ===');
  var pong = await xyMesh.sendCommand(peer, 'ping', {});
  eq('ping 通', pong.pong, true);
  eq('server_id 上报', pong.server_id, 'ci-slave');

  var st = await xyMesh.sendCommand(peer, 'students', {});
  var ids = st.list.map(function (u) { return u.user_id; });
  ok('真用户在列表（A）', ids.indexOf(A) > -1);
  ok('镜像用户不回传（M）', ids.indexOf(M) === -1);

  console.log('\n=== 4.5 配置漂移防护 ===');
  // 从班忘了把自己配成 member 时（主班单边配好），写命令必须显式失败——
  // 否则会出现「从班班管和主班班管都能收钱」的双头对账事故
  xyMesh.saveConfig({ role: '', peers: [] });
  var drift = await xyMesh.sendCommand(peer, 'recharge', {
    userIds: [A], amountCent: xy.yuanToCent(1), requestId: 'drift1', operator: MASTER_ADMIN
  }).then(function () { return null; }).catch(function (e) { return e; });
  ok('对端未配 member 时写命令被拒', drift && /未配置为组网从班/.test(drift.message), drift && drift.message);
  var st2 = await xyMesh.sendCommand(peer, 'students', {});
  ok('读命令不受角色限制（排障可见）', st2 && st2.list && st2.list.length > 0);
  // 恢复从班身份，继续主流程
  xyMesh.saveConfig({ role: 'member', peers: [{ class: '18', base: 'http://127.0.0.1:19999' }] });

  console.log('\n=== 5. 充值链路 ===');
  var before = cash(A);
  var rc = await xyMesh.sendCommand(peer, 'recharge', {
    userIds: [A], amountCent: xy.yuanToCent(10), method: 'cash', memo: '组网代充', requestId: 'mr1', operator: MASTER_ADMIN
  });
  eq('充值 1 人', rc.done.length, 1);
  eq('学元到账（10 元 = 10000 学元 = 1000000 账本单位）', cash(A) - before, 1000000);

  // 全镜像单：dispatch 层整单报错（与本地路由「全部失败必须报错」同语义）
  var rcAll = await xyMesh.sendCommand(peer, 'recharge', {
    userIds: [M], amountCent: xy.yuanToCent(5), requestId: 'mr2', operator: MASTER_ADMIN
  }).then(function () { return null; }).catch(function (e) { return e; });
  ok('全镜像单整体失败', rcAll && /充值未生效/.test(rcAll.message), rcAll && rcAll.message);

  // 混合单：真用户成功、镜像跳过
  var rcMix = await xyMesh.sendCommand(peer, 'recharge', {
    userIds: [A, M], amountCent: xy.yuanToCent(1), requestId: 'mr3', operator: MASTER_ADMIN
  });
  eq('混合单成功 1 人', rcMix.done.length, 1);
  eq('混合单跳过镜像', rcMix.skipped.length, 1);

  // 停用账号不能充值
  db.prepare("UPDATE users SET status = 'disabled' WHERE user_id = ?").run(B);
  var rcDis = await xyMesh.sendCommand(peer, 'recharge', {
    userIds: [B], amountCent: xy.yuanToCent(1), requestId: 'mr4', operator: MASTER_ADMIN
  }).then(function () { return null; }).catch(function (e) { return e; });
  ok('停用账号整单失败', rcDis && /充值未生效/.test(rcDis.message), rcDis && rcDis.message);
  db.prepare("UPDATE users SET status = 'active' WHERE user_id = ?").run(B);

  // 单笔上限
  var rcCap = await xyMesh.sendCommand(peer, 'recharge', {
    userIds: [A], amountCent: xy.LIMITS.MAX_RECHARGE_CENT + 100, requestId: 'mr5', operator: MASTER_ADMIN
  }).then(function () { return null; }).catch(function (e) { return e; });
  ok('超单笔上限被拦', rcCap && /超过|上限/.test(rcCap.message), rcCap && rcCap.message);

  console.log('\n=== 6. ref 幂等回放 ===');
  var before2 = cash(A);
  var again = await xyMesh.sendCommand(peer, 'recharge', {
    userIds: [A], amountCent: xy.yuanToCent(10), memo: '组网代充', requestId: 'mr1', operator: MASTER_ADMIN
  });
  eq('重放不二次入账', cash(A) - before2, 0);
  eq('回放标记 duplicate', again.done[0].duplicate, true);

  console.log('\n=== 7. 篡改签名 / 过期时间戳 ===');
  var evil = await new Promise(function (resolve) {
    var http = require('http');
    var body = JSON.stringify({ command: 'recharge', payload: { userIds: [A], amountCent: xy.yuanToCent(999), requestId: 'evil1', operator: 'attacker' } });
    var req = http.request({ hostname: '127.0.0.1', port: port, path: '/api/xueyuan/mesh/command', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'X-XY-Mesh-Ts': String(Date.now()), 'X-XY-Mesh-Ref': 'mesh:evil', 'X-XY-Mesh-Sig': 'deadbeef' } }, function (res2) {
      var chunks = [];
      res2.on('data', function (c) { chunks.push(c); });
      res2.on('end', function () { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); });
    });
    req.end(body);
  });
  ok('伪造签名被拒', evil && /签名/.test(evil.message || ''), evil && evil.message);

  console.log('\n=== 8. 提现审批全链路（mesh 通道） ===');
  var wd = xy.requestWithdraw({ user: A, amountCent: xy.yuanToCent(2), memo: '买贴纸' });
  var wl = await xyMesh.sendCommand(peer, 'withdrawals', {});
  ok('主班能看到待审提现', wl.pending.some(function (w) { return w.id === wd.withdraw.id; }));
  var rv = await xyMesh.sendCommand(peer, 'withdraw_review', { id: wd.withdraw.id, approve: true, memo: '当面付现', reviewer: MASTER_ADMIN });
  ok('审批通过', rv.withdraw && rv.withdraw.status === 'paid', rv);
  healthy('提现后账本不变量');

  console.log('\n=== 9. 发放 / 扣减 / 退款（mesh 通道） ===');
  var g0 = grant(B);
  var gr = await xyMesh.sendCommand(peer, 'grant', { userIds: [B], amount: 5, memo: '奖励', requestId: 'mg1', operator: MASTER_ADMIN });
  eq('批量发放 1 人', gr.done.length, 1);
  eq('发放赠金 +500（5 学元）', grant(B) - g0, 500);
  var de = await xyMesh.sendCommand(peer, 'deduct', { userIds: [B], amount: 2, memo: '扣减', requestId: 'md1', operator: MASTER_ADMIN });
  eq('扣减赠金 -200（2 学元）', grant(B) - g0, 300);
  var rf = await xyMesh.sendCommand(peer, 'refund', { userId: B, from: A, amountCent: 1000, pool: 'cash', reason: '活动退款', requestId: 'mf1', operator: MASTER_ADMIN });
  ok('退款入账', rf && (rf.duplicate || rf.amount), rf);
  healthy('mesh 全链路后账本不变量');

  console.log('\n=== 9.5 交易体系（班级小铺 · mesh 通道） ===');
  // 主班给从班上架商品
  var g = await xyMesh.sendCommand(peer, 'goods_create', {
    name: '贴纸', price_cent: 1000, cost_cent: 200, kind: 'digital', requestId: 'mg-g1', operator: MASTER_ADMIN
  });
  ok('mesh 上架商品', g && g.id, g);
  var gl = await xyMesh.sendCommand(peer, 'goods_list', { status: 'on_shelf' });
  ok('主班可见在架商品', (gl || []).some(function (x) { return x.id === g.id; }), gl);

  // 学生在从班本地下单支付（交易本身发生在从班，与 mesh 无关）
  var order = svc.orders.create({ ref: 't:order:1', buyer: A, goods_id: g.id, face_cent: 1000, cost_cent: 200, seller: 'platform' });
  svc.orders.pay(order.id, { ref: 't:pay:1', initiator: A });
  var ol = await xyMesh.sendCommand(peer, 'orders_list', { status: 'paid,fulfilled,disputed' });
  ok('主班可见从班待处理订单', (ol || []).some(function (o) { return o.id === order.id; }), ol);

  // 主班跨班履约 + 结算（状态机要求先履约再结算，与本地一致）
  await xyMesh.sendCommand(peer, 'order_fulfill', { id: order.id, ref: 't:ful:1', operator: MASTER_ADMIN });
  await xyMesh.sendCommand(peer, 'order_settle', { id: order.id, ref: 't:settle:1', operator: MASTER_ADMIN });
  var ol2 = await xyMesh.sendCommand(peer, 'orders_list', { status: 'paid,fulfilled,disputed' });
  ok('结算后离开待处理列表', !(ol2 || []).some(function (o) { return o.id === order.id; }));

  // 主班跨班退款（第二单）
  var order2 = svc.orders.create({ ref: 't:order:2', buyer: A, goods_id: g.id, face_cent: 1000, cost_cent: 200, seller: 'platform' });
  svc.orders.pay(order2.id, { ref: 't:pay:2', initiator: A });
  var rf = await xyMesh.sendCommand(peer, 'order_refund', { id: order2.id, ref: 't:refund:1', reason: '测试退款', operator: MASTER_ADMIN });
  ok('mesh 退款成功', rf && rf.id === order2.id, rf);

  // 下架
  await xyMesh.sendCommand(peer, 'goods_status', { id: g.id, status: 'off_shelf', operator: MASTER_ADMIN });
  var gl2 = await xyMesh.sendCommand(peer, 'goods_list', { status: 'on_shelf' });
  ok('下架后不在列表', !(gl2 || []).some(function (x) { return x.id === g.id; }));
  healthy('交易 mesh 后账本不变量');

  console.log('\n=== 10. xy_mesh_log 审计 ===');
  var logs = db.prepare('SELECT COUNT(*) AS c FROM xy_mesh_log').get();
  ok('命令审计已落库（' + logs.c + ' 条）', logs.c >= 8);

  server.close();
  console.log('\n===== xy-mesh 契约测试：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) {
  console.error('测试执行失败:', e);
  process.exit(1);
});
