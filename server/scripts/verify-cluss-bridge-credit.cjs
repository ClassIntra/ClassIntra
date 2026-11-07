// 学元充值桥（/api/cluss-bridge/app-credit*）验收 · 独立临时库 + 真路由黑盒
// 用法：node server/scripts/verify-cluss-bridge-credit.cjs   （先 unset NODE_OPTIONS）
//
// 覆盖：桥密钥三态（503 未配 / 403 错钥 / 200）、学号校验（404 不存在 / 400 禁用 /
//       400 非六位）、余额查询、成功扣减（user CASH −X → platform +X）、同 ref 幂等重放、
//       余额不足、GRANT 不可转、未开户拒绝、单笔上限、日流出上限（与钱包转账同预算）、
//       最小额、缺参/坏参。
// 资金是账内资金（临时库），不发真请求、不碰生产库。

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-cluss-bridge-credit-'));
process.env.DB_PATH = path.join(tmpDir, 'ledger.db');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'probe-jwt-secret';
process.env.RELAY_SECRET = 'probe-bridge-secret';

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name, a === b, { got: a, want: b }); }

var db = require('../src/utils/db');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'ledger', 'schema.sql'), 'utf8'));
// 路由只查 users 的 user_id/status 两列，最小表即可（真表 DDL 由应用迁移负责）
db.exec('CREATE TABLE users (user_id TEXT PRIMARY KEY, status TEXT)');
// pay-guard 的日流出统计会查这两张旧账本表（生产库有）；补空表让统计走全路径
db.exec('CREATE TABLE xy_packet (id INTEGER PRIMARY KEY, sender TEXT, status TEXT, remaining_cent INTEGER, created_at TEXT)');
db.exec('CREATE TABLE xy_cross_tx (id INTEGER PRIMARY KEY, from_user TEXT, status TEXT, amount_cent INTEGER, created_at TEXT)');

var svc = require('../src/ledger/service');
var ledger = require('../src/ledger/ledger');
var xueyuan = require('../src/services/xueyuan');
var payGuard = require('../src/services/pay-guard');
var config = require('../src/config');

svc.ensureReady();

// ---- 造数 ----
db.prepare("INSERT INTO users (user_id, status) VALUES ('991801','active')").run();
db.prepare("INSERT INTO users (user_id, status) VALUES ('991802','disabled')").run();
db.prepare("INSERT INTO users (user_id, status) VALUES ('991803','active')").run();
db.prepare("INSERT INTO users (user_id, status) VALUES ('991804','active')").run();
db.prepare("INSERT INTO users (user_id, status) VALUES ('991805','active')").run();

ledger.openUser('991801');
// 直接 post 注资（recharge 模板单笔封顶 20 元，测试要 20 元以上余额）
function seedCash(uid, cent, seed) {
  // ledger 有单笔硬上限（MAX_TX_CENT = 1e8），大额注资拆笔
  var left = cent;
  var i = 0;
  while (left > 0) {
    var chunk = Math.min(left, 100000000);
    ledger.post({
      ref: 'seed:' + seed + ':' + i,
      kind: 'recharge',
      memo: '测试注资',
      entries: [
        { kind: 'clearing', owner: '', asset: 'CASH', direction: -1, amount_cent: chunk },
        { kind: 'user', owner: uid, asset: 'CASH', direction: 1, amount_cent: chunk }
      ]
    });
    left -= chunk;
    i++;
  }
}
ledger.openUser('991805');
seedCash('991801', 2000000, 'u1');   // 20 元
seedCash('991805', 250000000, 'u5'); // 2500 元（打日流出上限用，余额不能先于上限见底）
// 991803 只有 GRANT：验证桥只认 CASH
ledger.openUser('991803');
ledger.post({
  ref: 'seed:g3',
  kind: 'grant',
  memo: '测试赠金',
  entries: [
    { kind: 'clearing', owner: '', asset: 'GRANT', direction: -1, amount_cent: 500000 },
    { kind: 'user', owner: '991803', asset: 'GRANT', direction: 1, amount_cent: 500000 }
  ]
});

// ---- 挂真路由 ----
var express = require('express');
var app = express();
app.use(express.json());
app.use('/api/cluss-bridge', require('../src/routes/cluss-bridge'));
var server = app.listen(0, '127.0.0.1');
var PORT = 0;
var SECRET = 'probe-bridge-secret';

function call(method, url, body, secretOverride) {
  return new Promise(function(resolve, reject) {
    var payload = (body === undefined || body === null) ? null : JSON.stringify(body);
    var req = http.request({
      host: '127.0.0.1', port: PORT, method: method, path: url,
      headers: Object.assign(
        { 'X-Bridge-Secret': secretOverride || SECRET },
        payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
      )
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var text = Buffer.concat(chunks).toString('utf8');
        var data = null;
        try { data = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, body: data || text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('\n[1] 桥密钥三态');
  var saved = config.relay.secret;
  config.relay.secret = '';
  var r = await call('GET', '/api/cluss-bridge/app-credit/balance?userId=991801');
  eq('未配置 RELAY_SECRET → 503 拒绝', r.status, 503);
  config.relay.secret = saved;
  r = await call('GET', '/api/cluss-bridge/app-credit/balance?userId=991801', null, 'wrong-secret');
  ok('密钥不对 → 403', r.status === 403, r.body);

  console.log('\n[2] 学号校验与余额查询');
  r = await call('GET', '/api/cluss-bridge/app-credit/balance?userId=991801');
  eq('余额查询 200', r.status, 200);
  eq('余额 = 注资额（分）', r.body.data && r.body.data.balance_cent, 2000000);
  r = await call('GET', '/api/cluss-bridge/app-credit/balance?userId=999999');
  eq('学号不存在 → 404', r.status, 404);
  r = await call('GET', '/api/cluss-bridge/app-credit/balance?userId=991802');
  eq('禁用账号 → 400', r.status, 400);
  r = await call('GET', '/api/cluss-bridge/app-credit/balance?userId=abc');
  eq('非六位学号 → 400', r.status, 400);

  console.log('\n[3] 成功扣减与幂等');
  var platformAcct = ledger.findAccount('platform', '');
  var platformBefore = ledger.balanceOf(platformAcct.id, 'CASH');
  r = await call('POST', '/api/cluss-bridge/app-credit', { userId: '991801', amount_cent: 500000, ref: 'probe-ref-0001' });
  eq('转入 5 元 → 200', r.status, 200);
  eq('余额扣减', r.body.data && r.body.data.balance_cent, 1500000);
  eq('duplicate=false', r.body.data && r.body.data.duplicate, false);
  var platformAfter = ledger.balanceOf(platformAcct.id, 'CASH');
  eq('platform 账户等额入账', platformAfter - platformBefore, 500000);
  r = await call('POST', '/api/cluss-bridge/app-credit', { userId: '991801', amount_cent: 500000, ref: 'probe-ref-0001' });
  eq('同 ref 重放 → 200 且 duplicate=true', r.status === 200 && r.body.data.duplicate === true, true);
  eq('重放不双扣', r.body.data.balance_cent, 1500000);
  eq('重放后 platform 不变', ledger.balanceOf(platformAcct.id, 'CASH'), platformAfter);

  console.log('\n[4] 业务拒绝');
  r = await call('POST', '/api/cluss-bridge/app-credit', { userId: '991801', amount_cent: 1600000, ref: 'probe-ref-0002' });
  eq('余额不足 → 400', r.status, 400);
  r = await call('POST', '/api/cluss-bridge/app-credit', { userId: '991803', amount_cent: 100, ref: 'probe-ref-0003' });
  ok('GRANT-only 账户 → 400（桥只认 CASH）', r.status === 400, r.body);
  r = await call('POST', '/api/cluss-bridge/app-credit', { userId: '991804', amount_cent: 100, ref: 'probe-ref-0004' });
  ok('未开户 → 400（人话提示）', r.status === 400 && String(r.body.message).indexOf('学元钱包') !== -1, r.body);
  r = await call('POST', '/api/cluss-bridge/app-credit', { userId: '991801', amount_cent: xueyuan.LIMITS.MAX_TRANSFER_CENT + 1, ref: 'probe-ref-0005' });
  eq('超过单笔上限 → 400', r.status, 400);
  r = await call('POST', '/api/cluss-bridge/app-credit', { userId: '991801', amount_cent: 99, ref: 'probe-ref-0006' });
  ok('低于 1 学元 → 400', r.status === 400, r.body);
  r = await call('POST', '/api/cluss-bridge/app-credit', { userId: '991801', amount_cent: 100 });
  eq('缺 ref → 400', r.status, 400);
  r = await call('POST', '/api/cluss-bridge/app-credit', { userId: '991801', amount_cent: 100.5, ref: 'probe-ref-0007' });
  eq('非整数金额 → 400', r.status, 400);

  console.log('\n[5] 日流出上限（与钱包转账同预算，2000 元/日）');
  var spent = 0;
  var hit = false;
  for (var i = 0; i < 5; i++) {
    r = await call('POST', '/api/cluss-bridge/app-credit', { userId: '991805', amount_cent: xueyuan.LIMITS.MAX_TRANSFER_CENT, ref: 'probe-daily-' + i });
    if (r.status === 200) { spent += xueyuan.LIMITS.MAX_TRANSFER_CENT; }
    else {
      hit = true;
      ok('第 ' + (i + 1) + ' 笔触发日上限 → 400', spent + xueyuan.LIMITS.MAX_TRANSFER_CENT > payGuard.MAX_DAILY_OUT_CENT, r.body);
      // 必须是日上限文案而不是余额不足 —— 余额不足说明测试注资不够，测的根本不是上限
      ok('拒绝原因是日流出上限（非余额不足）', String(r.body.message).indexOf('今日转出') !== -1, r.body.message);
      break;
    }
  }
  ok('日累计上限最终被拦（已转出 ' + spent + ' 分）', hit && spent <= payGuard.MAX_DAILY_OUT_CENT);

  server.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  console.log('\nRESULT: PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
}

server.listen(0, '127.0.0.1', function() {
  PORT = server.address().port;
  run().catch(function(err) {
  console.error('[脚本异常]', err);
    try { server.close(); } catch (e) {}
    process.exit(1);
  });
});
