// 学元账本 · 路由层护栏（独立临时库，不起 HTTP 服务）
// 用法：node server/scripts-test-ledger-routes.cjs
//
// 为什么单独一个脚本：
//   scripts-test-ledger-*.cjs 测的是服务层（svc.*），它们都绕过了路由。
//   而「两个接口面、其中一个没上锁」这种问题只存在于路由层 ——
//   /api/xy/transfer 曾经不验支付密码、/api/xy/withdraw 曾经跳过班管审批。
//   这里直接取 router.stack 里的处理函数执行，断言它们已经变成 410。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-ledger-routes-'));
process.env.DB_PATH = path.join(tmpDir, 'ledger.db');
process.env.NODE_ENV = 'test';

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + JSON.stringify(a) + '）', a === b, { got: a, want: b }); }

var db = require('./src/utils/db');
db.exec(fs.readFileSync(path.join(__dirname, 'src', 'ledger', 'schema.sql'), 'utf8'));
require('./src/ledger/service').ensureReady();

var router = require('./src/routes/ledger');

// 取某个 method+path 的**最后一个**处理函数（wrap 包过的那一层）
function handlerFor(method, routePath) {
  for (var i = 0; i < router.stack.length; i++) {
    var layer = router.stack[i];
    if (!layer.route) continue;
    if (layer.route.path !== routePath) continue;
    if (!layer.route.methods[method]) continue;
    var stack = layer.route.stack;
    return stack[stack.length - 1].handle;
  }
  return null;
}

function countRoutes(method, routePath) {
  var n = 0;
  for (var i = 0; i < router.stack.length; i++) {
    var layer = router.stack[i];
    if (layer.route && layer.route.path === routePath && layer.route.methods[method]) n++;
  }
  return n;
}

// 假 res：记录状态码与响应体
function callHandler(handler, req) {
  var out = { status: 200, body: null };
  var res = {
    status: function (code) { out.status = code; return res; },
    json: function (body) { out.body = body; return res; },
    send: function (body) { out.body = body; return res; }
  };
  handler(Object.assign({ body: {}, query: {}, params: {}, get: function () { return null; } }, req), res);
  return out;
}

console.log('\n=== 1. 学生资金动作只能有一个入口 ===');
['/transfer', '/withdraw'].forEach(function (p) {
  var h = handlerFor('post', p);
  ok(p + ' 有处理器', !!h);
  var r = callHandler(h, { user: { user_id: '991901', is_admin: 0 } });
  eq(p + ' 返回 410', r.status, 410);
  ok(p + ' 指向正式入口',
    /xueyuan|wallet/.test(String(r.body && r.body.message)),
    r.body && r.body.message);
});

console.log('\n=== 2. 管理员充值也只能走带凭证的那个入口 ===');
var hr = handlerFor('post', '/recharge');
ok('/recharge 有处理器', !!hr);
var rr = callHandler(hr, { user: { user_id: '991900', is_admin: 1 } });
eq('/recharge 返回 410', rr.status, 410);
ok('/recharge 指向 /api/xueyuan/admin/recharge',
  /xueyuan\/admin\/recharge/.test(String(rr.body && rr.body.message)),
  rr.body && rr.body.message);

console.log('\n=== 3. 不允许重复注册同一个写端 ===');
['/transfer', '/withdraw', '/recharge'].forEach(function (p) {
  eq(p + ' 只注册一次', countRoutes('post', p), 1);
});

console.log('\n=== 4. 路由表里不该再出现「直接扣款」的调用 ===');
var src = fs.readFileSync(path.join(__dirname, 'src', 'routes', 'ledger.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
ok('没有 svc.withdraw 直调', src.indexOf('svc.withdraw') === -1);
ok('没有 svc.transfer 直调', src.indexOf('svc.transfer') === -1);
ok('没有 svc.recharge 直调', src.indexOf('svc.recharge') === -1);

console.log('\n=== 5. 订单/商品/健康度仍然可用 ===');
['/orders', '/goods', '/admin/health', '/orders/quote'].forEach(function (p) {
  ok('GET ' + p + ' 存在', !!handlerFor('get', p));
});

console.log('\n=== 6. 红包只保留 /api/wallet（yuanbao）一个实现 ===');
// ledger 红包路由随 v1.7.0 发布收敛移除（前端零调用、不走统一支付风控）。
// 这里的绊线防止任何人把第二套红包路由加回来。
[['get', '/redpackets'], ['post', '/redpackets'],
 ['get', '/redpackets/:id'], ['post', '/redpackets/:id/claim']].forEach(function (pair) {
  eq(pair[0] + ' ' + pair[1] + ' 不再注册', countRoutes(pair[0], pair[1]), 0);
});

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
process.exit(fail ? 1 : 0);
