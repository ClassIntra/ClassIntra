// 端到端：出站 Webhook（集成事件推送）
//
// 背景：outbound-dispatcher 写好很久但全仓没有调用点，属于「文档里有、实际不工作」的功能。
// 本脚本用本地 webhook 桩验证：事件真的发出、签名可验、scope 真的过滤。
//
// 目标实例：隔离实例 http://127.0.0.1:9099（生产库副本）
// 用法：node server/scripts-e2e-outbound-webhook.cjs
//
// 覆盖：
//   1. 应用禁用 / 启用 → app.disabled / app.enabled
//   2. 发布公告 → announcement.published
//   3. 签名校验：HMAC-SHA256(key = sha256(secret), msg = timestamp + '.' + body)
//   4. scope 过滤：只订阅 user:read 的集成收不到 app.* 事件
//   5. 清理：删除本次签发的集成，恢复应用启用状态

var http = require('http');
var crypto = require('crypto');
var path = require('path');

var BASE = 'http://127.0.0.1:9099';
var HOOK_PORT = 9124;
var ADMIN = '251800';

var jwtUtil = require(path.join(__dirname, 'src', 'utils', 'jwt'));
var pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }

var adminTok = jwtUtil.generateToken({ user_id: ADMIN, net_name: 'e2e' });

async function call(method, urlPath, token, body) {
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  var res = await fetch(BASE + urlPath, {
    method: method,
    headers: headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  var text = await res.text();
  var json = null;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json };
}

// ---------- webhook 桩 ----------
var received = [];
var server = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var raw = Buffer.concat(chunks).toString('utf8');
    received.push({ headers: req.headers, raw: raw });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});

function waitForEvent(name, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 5000);
  return new Promise(function (resolve) {
    (function tick() {
      var hit = received.filter(function (r) {
        try { return JSON.parse(r.raw).event === name; } catch (e) { return false; }
      })[0];
      if (hit) return resolve(hit);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 120);
    })();
  });
}

function verifySignature(hit, secret) {
  try {
    var secretHash = crypto.createHash('sha256').update(secret).digest('hex');
    var ts = hit.headers['x-classintra-timestamp'];
    var sig = hit.headers['x-classintra-signature'] || '';
    if (!ts || sig.indexOf('sha256=') !== 0) return false;
    var expected = crypto.createHmac('sha256', secretHash).update(ts + '.' + hit.raw).digest('hex');
    return expected === sig.slice(7);
  } catch (e) {
    return false;
  }
}

(async function main() {
  await new Promise(function (resolve) { server.listen(HOOK_PORT, '127.0.0.1', resolve); });
  console.log('\n出站 Webhook E2E → ' + BASE + '（桩 :' + HOOK_PORT + '）');

  var createdIds = [];
  var marketApp = 'gomoku';

  section('1. 签发两个集成（不同 scope）');
  var hook = await call('POST', '/api/integrations/tokens', adminTok, {
    name: 'e2e-app-events',
    scopes: ['app:read', 'notification:write'],
    webhookUrl: 'http://127.0.0.1:' + HOOK_PORT + '/hook',
    ttlDays: 1
  });
  ok(hook.status === 200 && hook.body.data && hook.body.data.secret, '签发 app:read 集成', hook.body);
  if (!hook.body.data) { server.close(); process.exit(1); }
  createdIds.push(hook.body.data.id);
  var tokenA = hook.body.data.token;
  var secretA = hook.body.data.secret;

  var hook2 = await call('POST', '/api/integrations/tokens', adminTok, {
    name: 'e2e-user-only',
    scopes: ['user:read'],
    webhookUrl: 'http://127.0.0.1:' + HOOK_PORT + '/hook',
    ttlDays: 1
  });
  ok(hook2.status === 200, '签发 user:read 集成');
  if (hook2.body.data) createdIds.push(hook2.body.data.id);

  section('2. 应用禁用 / 启用事件');
  var before = received.length;
  var off = await call('PUT', '/api/admin/app-control/' + marketApp, adminTok, { enabled: false });
  ok(off.status === 200, '禁用接口 200');
  var evOff = await waitForEvent('app.disabled');
  ok(!!evOff, '收到 app.disabled');
  if (evOff) {
    var bodyOff = JSON.parse(evOff.raw);
    ok(bodyOff.data && bodyOff.data.name === marketApp, '事件带应用名', bodyOff.data);
    ok(bodyOff.data && bodyOff.data.source === 'market', '事件标明 source=market');
    ok(evOff.headers['x-classintra-token'] === tokenA, 'X-ClassIntra-Token 匹配');
    ok(verifySignature(evOff, secretA), '签名可用 secret 验证通过');
    ok(bodyOff.source === 'classintra', 'body.source = classintra');
  }

  var on = await call('PUT', '/api/admin/app-control/' + marketApp, adminTok, { enabled: true });
  ok(on.status === 200, '启用接口 200');
  var evOn = await waitForEvent('app.enabled');
  ok(!!evOn, '收到 app.enabled');

  section('3. 公告事件');
  var title = '[e2e] 出站 webhook 验证 ' + Date.now();
  var ann = await call('POST', '/api/admin/announcements', adminTok, { title: title, content: '自动化验证用，可删除', type: 'notice' });
  ok(ann.status === 200, '发布公告成功', ann.body);
  var evAnn = await waitForEvent('announcement.published');
  ok(!!evAnn, '收到 announcement.published');
  if (evAnn) {
    var bodyAnn = JSON.parse(evAnn.raw);
    ok(bodyAnn.data && bodyAnn.data.title === title, '事件带公告标题');
    ok(verifySignature(evAnn, secretA), '公告事件签名校验通过');
  }

  section('4. scope 隔离');
  // 只订阅 user:read 的集成收到过 app.* 吗？用 token 反查它有没有收到任何 app 事件。
  // 桩只暴露 headers，无法区分 token 之外的集成，这里用「事件总数 = 订阅者数量」判断：
  // app.disabled / app.enabled 应各只到达 1 个集成（app:read 那个）。
  var appEvents = received.filter(function (r) {
    try {
      var e = JSON.parse(r.raw).event;
      return e === 'app.disabled' || e === 'app.enabled';
    } catch (err) { return false; }
  });
  ok(appEvents.length === 2, 'app.* 事件共 2 条（每个事件只投递给符合 scope 的 1 个集成）', appEvents.length);
  var annEvents = received.filter(function (r) {
    try { return JSON.parse(r.raw).event === 'announcement.published'; } catch (err) { return false; }
  });
  ok(annEvents.length === 1, 'announcement.published 只 1 条');

  section('5. 清理');
  for (var i = 0; i < createdIds.length; i++) {
    var del = await call('DELETE', '/api/integrations/tokens/' + createdIds[i], adminTok);
    ok(del.status === 200, '删除集成 #' + createdIds[i]);
  }
  var restore = await call('PUT', '/api/admin/app-control/' + marketApp, adminTok, { enabled: true });
  ok(restore.status === 200, '恢复 ' + marketApp + ' 为启用');

  console.log('\n' + '='.repeat(52));
  console.log('结果：通过 ' + pass + '，失败 ' + fail);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('探针异常:', e && e.stack || e);
  try { server.close(); } catch (x) {}
  process.exit(1);
});
