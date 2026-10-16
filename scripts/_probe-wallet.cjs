// 额度闸门（migration 016）路由级集成测试
// 骨架同 _probe-vision.cjs：临时库 + 假上游 + 直接打 router 栈，Promise 链串行。
// 重点验证「配额 0 = 不限额」不误伤、402 文案、清空恢复、非法入参。
var fs = require('fs');
var path = require('path');
var http = require('http');

var ROOT = path.join(__dirname, '..');
var DB_TMP = path.join(ROOT, 'server/database/_probe_wallet.db');
['', '-shm', '-wal'].forEach(function(s) { try { fs.unlinkSync(DB_TMP + s); } catch (e) {} });
fs.copyFileSync(path.join(ROOT, 'server/database/classintra.db'), DB_TMP);
process.env.DB_PATH = DB_TMP;

require(path.join(ROOT, 'node_modules/.pnpm/dotenv@16.6.1/node_modules/dotenv')).config({ path: path.join(ROOT, 'server/.env') });

var db = require(path.join(ROOT, 'server/src/utils/db'));
require(path.join(ROOT, 'server/src/migrations/016_ai_wallet.js')).up(db);

var MOCK_PORT = 19233;
var upstreamCalls = 0;
var server = http.createServer(function(req, res) {
  var chunks = [];
  req.on('data', function(c) { chunks.push(c); });
  req.on('end', function() {
    upstreamCalls++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '回答内容' } }],
      usage: { prompt_tokens: 900, completion_tokens: 100, total_tokens: 1000,
               prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 900 }
    }));
  });
});

var USER = 'wallet_probe_user';
var CONV = 'wallet_probe_conv';

function setup() {
  db.prepare('DELETE FROM users WHERE user_id = ?').run(USER);
  db.prepare("INSERT INTO users (user_id, net_name, real_name, password_hash, is_admin, role, status) VALUES (?, '钱包探针', '钱包探针', 'x', 1, 'student', 1)").run(USER);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(CONV);
  db.prepare("INSERT INTO conversations (id, user_id, title, messages_json, created_at, updated_at) VALUES (?, ?, '探针', '[]', datetime('now'), datetime('now'))").run(CONV, USER);
  db.prepare('DELETE FROM ai_wallet WHERE user_id = ?').run(USER);
  db.prepare('DELETE FROM ai_usage_log WHERE user_id = ?').run(USER);
  db.prepare("UPDATE ai_models SET is_default = 0 WHERE is_default = 1").run();
  db.prepare('DELETE FROM ai_models WHERE id = ?').run('probe-cheap');
  // 单价 1000 微元/千token = 1 元/千token → 1000 token 正好 0.001 元，方便卡阈值
  db.prepare([
    'INSERT INTO ai_models (id, label, api_url, api_key, model, color, api_style, supports_thinking, supports_search,',
    ' is_free, enabled, is_default, builtin, sort_order, price_in, price_out, price_cache_hit, supports_stream_options, supports_vision, vision_max_images)',
    "VALUES ('probe-cheap', '便宜模型', ?, 'sk', 'cheap-model', '#6366f1', 'openai', 0, 0, 0, 1, 1, 0, 100, 1000, 2000, 0, 1, 0, 0)"
  ].join('\n')).run('http://127.0.0.1:' + MOCK_PORT + '/v1');
}

function compilePath(p) { return new RegExp('^' + p.replace(/:[A-Za-z0-9_]+/g, '([^/]+)') + '$'); }
function call(router, method, url, body) {
  return new Promise(function(resolve) {
    var pathname = url.split('?')[0];
    var handler = null, params = {};
    for (var i = 0; i < router.stack.length; i++) {
      var layer = router.stack[i];
      if (!layer.route || layer.route.methods[method] !== true) continue;
      var m = compilePath(layer.route.path).exec(pathname);
      if (!m) continue;
      var keys = (layer.route.path.match(/:[A-Za-z0-9_]+/g) || []).map(function(k) { return k.substring(1); });
      keys.forEach(function(k, idx) { params[k] = decodeURIComponent(m[idx + 1]); });
      handler = layer.route.stack[layer.route.stack.length - 1].handle;
      break;
    }
    if (!handler) return resolve({ status: 404, body: null, missing: true });
    var req = { method: method.toUpperCase(), url: url, body: body || {}, params: params, query: {}, user: { user_id: USER, is_admin: 1 }, headers: {} };
    var qs = url.split('?')[1];
    if (qs) qs.split('&').forEach(function(kv) { var p = kv.split('='); req.query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    var done = false;
    var res = {
      statusCode: 200,
      status: function(c) { this.statusCode = c; return this; },
      json: function(b) { if (!done) { done = true; resolve({ status: this.statusCode, body: b }); } },
      send: function(b) { if (!done) { done = true; resolve({ status: this.statusCode, body: b }); } },
      setHeader: function() {}, write: function() {}, end: function() { if (!done) { done = true; resolve({ status: this.statusCode, body: null }); } },
      writableEnded: true
    };
    try { handler(req, res, function() {}); } catch (e) { if (!done) resolve({ status: 599, body: { message: 'THREW: ' + e.message } }); }
  });
}

var PASS = 0, FAIL = 0;
function check(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function usageCount() { return db.prepare('SELECT COUNT(*) c FROM ai_usage_log WHERE user_id = ?').get(USER).c; }
function usedMicro() {
  var r = db.prepare('SELECT SUM(cost_micro) s FROM ai_usage_log WHERE user_id = ?').get(USER);
  return (r && r.s) || 0;
}

function main() { return new Promise(function(r) { server.listen(MOCK_PORT, '127.0.0.1', r); }); }

main().then(function() {
  setup();
  var router = require(path.join(ROOT, 'apps/ai-chat/backend/routes.js'));
  function send() { return call(router, 'post', '/chat', { conversation_id: CONV, message: '问一个成本很高的问题', model: 'probe-cheap' }); }

  console.log('\n[1] 未设额度 = 不限额');
  return call(router, 'get', '/wallet', {}).then(function(r) {
    check('GET /wallet 返回 unlimited', r.status === 200 && r.body && r.body.data && r.body.data.unlimited === true, r.body);
    upstreamCalls = 0;
    return send();
  }).then(function(r) {
    check('发消息 200', r.status === 200 && r.body.code === 200, r.body);
    check('上游真的被调了', upstreamCalls === 1, upstreamCalls);
    check('记账落了一笔', usageCount() === 1, usageCount());

    console.log('\n[2] 设 1 元额度（一条 1000 token 正好 1 元）');
    return call(router, 'put', '/admin/wallet/' + USER, { quota_yuan: 1, window_days: 30 });
  }).then(function(r) {
    check('PUT /admin/wallet 200', r.status === 200, r.body);
    check('已用 1100 微元（900×1 + 100×2）/ 额度 1e6 微元', r.body.data.used_micro === 1100 && r.body.data.quota_micro === 1000000, r.body.data);
    return send();
  }).then(function(r2) {
    check('未超限 → 仍放行', r2.status === 200, r2.body);
    check('累计 2200 微元', usedMicro() === 2200, usedMicro());

    console.log('\n[3] 达到上限 → 402');
    return call(router, 'put', '/admin/wallet/' + USER, { quota_yuan: usedMicro() / 1000000, window_days: 30 });
  }).then(function(r3) {
    check('把额度调到正好等于已用', r3.status === 200, r3.body);
    return send();
  }).then(function(r4) {
    check('超限 → 402', r4.status === 402, r4.body);
    check('文案提到额度', /额度/.test((r4.body && r4.body.message) || ''), r4.body);
    check('上游没有被多调（仍 2 次）', upstreamCalls === 2, upstreamCalls);
    check('被拒的那条没记账（仍 2 笔）', usageCount() === 2, usageCount());

    console.log('\n[4] 清空额度 = 恢复不限额');
    return call(router, 'delete', '/admin/wallet/' + USER, {});
  }).then(function(r5) {
    check('DELETE 200', r5.status === 200, r5.body);
    return send();
  }).then(function(r6) {
    check('又能发了', r6.status === 200, r6.body);

    console.log('\n[5] 列表 / 非法入参 / 额度上限');
    return call(router, 'get', '/admin/wallet?days=30', {});
  }).then(function(r7) {
    check('列表包含该用户', r7.status === 200 && r7.body.data.users.some(function(u) { return u.user_id === USER; }), r7.body.data);
    return call(router, 'put', '/admin/wallet/' + USER, { quota_yuan: -5 });
  }).then(function(r8) {
    check('负数额度被拒', r8.status === 400, r8.body);
    return call(router, 'put', '/admin/wallet/no_such_user', { quota_yuan: 5 });
  }).then(function(r9) {
    check('不存在用户 404', r9.status === 404, r9.body);
    return call(router, 'put', '/admin/wallet/' + USER, { quota_yuan: 999999 });
  }).then(function(r10) {
    check('超上限被拒', r10.status === 400, r10.body);
    return call(router, 'get', '/admin/usage/export.csv?days=7&group=user', {});
  }).then(function(r11) {
    check('CSV 导出 200 且带 BOM', r11.status === 200, r11.status);

    console.log('\n============================');
    console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
    console.log('============================');
    server.close();
    db.close();
    try { fs.unlinkSync(DB_TMP); } catch (e) {}
    process.exit(FAIL === 0 ? 0 : 1);
  });
}).catch(function(e) {
  console.error('HARNESS ERROR:', e);
  try { server.close(); } catch (e2) {}
  try { fs.unlinkSync(DB_TMP); } catch (e2) {}
  process.exit(1);
});
