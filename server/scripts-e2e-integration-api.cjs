// 端到端：对外查询 API（/api/integrations/v1）
//
// 目标实例：隔离实例 http://127.0.0.1:9099
// 用法：node server/scripts-e2e-integration-api.cjs
//
// 覆盖：
//   1. whoami 自检
//   2. users / users/:id（字段白名单，不含密码哈希与隐私字段）
//   3. announcements / apps / stats
//   4. scope 逐端点校验（缺 scope → 403）
//   5. 无效 / 缺失 token → 401
//   6. 分页上限钳制（limit=9999 → 200）

var path = require('path');
var jwtUtil = require(path.join(__dirname, 'src', 'utils', 'jwt'));

var BASE = 'http://127.0.0.1:9099';
var pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }

var adminTok = jwtUtil.generateToken({ user_id: '251800', net_name: 'e2e' });

async function admin(method, urlPath, body) {
  var headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminTok };
  var res = await fetch(BASE + urlPath, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  var text = await res.text();
  var json = null; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function asToken(token, urlPath) {
  var headers = {};
  if (token) headers['X-ClassIntra-Token'] = token;
  var res = await fetch(BASE + urlPath, { headers: headers });
  var text = await res.text();
  var json = null; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json };
}

(async function main() {
  console.log('\n对外查询 API E2E → ' + BASE);
  var created = [];

  section('0. 签发 token');
  var full = await admin('POST', '/api/integrations/tokens', {
    name: 'e2e-read-api',
    scopes: ['user:read', 'notification:read', 'market:read'],
    ttlDays: 1
  });
  ok(full.status === 200 && full.body.data && full.body.data.token, '签发全量读 token');
  if (!full.body.data) { process.exit(1); }
  created.push(full.body.data.id);
  var tok = full.body.data.token;

  var narrow = await admin('POST', '/api/integrations/tokens', {
    name: 'e2e-user-only',
    scopes: ['user:read'],
    ttlDays: 1
  });
  created.push(narrow.body.data.id);
  var tokNarrow = narrow.body.data.token;

  section('1. whoami');
  var me = await asToken(tok, '/api/integrations/v1/whoami');
  ok(me.status === 200 && me.body.data.scopes.indexOf('user:read') !== -1, 'whoami 返回 scope', me.body);

  section('2. 用户查询');
  var users = await asToken(tok, '/api/integrations/v1/users?limit=5');
  ok(users.status === 200 && Array.isArray(users.body.data.users), '用户列表 200');
  ok(users.body.data.users.length <= 5, 'limit 生效（实际 ' + users.body.data.users.length + '）');
  var sample = users.body.data.users[0] || {};
  ok(!!sample.user_id && !!sample.net_name, '返回 user_id / net_name');
  ok(!('password_hash' in sample) && !('privacy_settings' in sample) && !('phone' in sample),
    '不含密码哈希 / 隐私设置 / 手机号', Object.keys(sample));

  var one = await asToken(tok, '/api/integrations/v1/users/' + sample.user_id);
  ok(one.status === 200 && one.body.data.user.user_id === sample.user_id, '单用户查询');
  var missing = await asToken(tok, '/api/integrations/v1/users/__nope__');
  ok(missing.status === 404, '不存在用户 404');

  var capped = await asToken(tok, '/api/integrations/v1/users?limit=9999');
  ok(capped.status === 200 && capped.body.data.limit === 200, 'limit 上限钳制到 200', capped.body.data && capped.body.data.limit);

  var search = await asToken(tok, '/api/integrations/v1/users?q=' + encodeURIComponent(String(sample.net_name).slice(0, 2)));
  ok(search.status === 200, '搜索参数可用');

  section('3. 公告 / 应用 / 统计');
  var ann = await asToken(tok, '/api/integrations/v1/announcements?limit=3');
  ok(ann.status === 200 && Array.isArray(ann.body.data.announcements), '公告列表 200');
  var apps = await asToken(tok, '/api/integrations/v1/apps');
  ok(apps.status === 200 && apps.body.data.apps.length >= 1, '应用列表 200（' + (apps.body.data.apps || []).length + '）');
  ok(apps.body.data.apps.every(function (a) { return typeof a.enabled === 'boolean'; }), '应用条目带启用状态');
  var stats = await asToken(tok, '/api/integrations/v1/stats');
  ok(stats.status === 200 && stats.body.data.users.total > 0, '统计 200', stats.body.data);

  section('4. scope 校验');
  var denied = await asToken(tokNarrow, '/api/integrations/v1/apps');
  ok(denied.status === 403, '缺 market:read → 403（实际 ' + denied.status + '）');
  ok(String(denied.body.message).indexOf('market:read') !== -1, '错误信息点名缺哪个 scope');
  var deniedAnn = await asToken(tokNarrow, '/api/integrations/v1/announcements');
  ok(deniedAnn.status === 403, '缺 notification:read → 403');
  var allowedUsers = await asToken(tokNarrow, '/api/integrations/v1/users?limit=1');
  ok(allowedUsers.status === 200, '有 user:read 的用户查询仍可用');

  section('5. 鉴权失败');
  var noToken = await fetch(BASE + '/api/integrations/v1/whoami');
  ok(noToken.status === 401, '无 token → 401');
  var bad = await asToken('ci_deadbeef', '/api/integrations/v1/whoami');
  ok(bad.status === 401, '伪造 token → 401');

  section('6. 写接口：公告（幂等）');
  var writer = await admin('POST', '/api/integrations/tokens', {
    name: 'e2e-writer',
    scopes: ['notification:write', 'app:write'],
    ttlDays: 1
  });
  created.push(writer.body.data.id);
  var tokW = writer.body.data.token;
  var idem = 'e2e-' + Date.now();

  async function writeAnn(token, key) {
    var headers = { 'Content-Type': 'application/json', 'X-ClassIntra-Token': token };
    if (key) headers['Idempotency-Key'] = key;
    var r = await fetch(BASE + '/api/integrations/v1/announcements', {
      method: 'POST', headers: headers,
      body: JSON.stringify({ title: '[e2e] 集成发布 ' + idem, content: '由集成 token 发布，可删除' })
    });
    var t = await r.text();
    var j = null; try { j = JSON.parse(t); } catch (e) { j = { raw: t }; }
    return { status: r.status, body: j, replay: r.headers.get('x-idempotent-replay') };
  }

  var w1 = await writeAnn(tokW, idem);
  ok(w1.status === 200 && w1.body.data && w1.body.data.id, '发布公告 200', w1.body);
  var w2 = await writeAnn(tokW, idem);
  ok(w2.status === 200 && w2.body.data.id === w1.body.data.id, '同 Idempotency-Key 返回同一 id');
  ok(w2.replay === '1', '第二次命中幂等回放');
  var w3 = await writeAnn(tokW, '');
  ok(w3.status === 200 && w3.body.data.id !== w1.body.data.id, '不带幂等键则产生新公告');

  var noScope = await writeAnn(tokNarrow, 'e2e-ns-' + Date.now());
  ok(noScope.status === 403, '缺 notification:write → 403');

  section('7. 写接口：应用启停');
  async function setState(token, name2, enabled) {
    var r = await fetch(BASE + '/api/integrations/v1/apps/' + name2 + '/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ClassIntra-Token': token },
      body: JSON.stringify({ enabled: enabled })
    });
    var t = await r.text();
    var j = null; try { j = JSON.parse(t); } catch (e) { j = { raw: t }; }
    return { status: r.status, body: j };
  }

  var off = await setState(tokW, 'gomoku', false);
  ok(off.status === 200 && off.body.data.enabled === false, '停用第三方应用 200', off.body);
  var apps2 = await asToken(tok, '/api/integrations/v1/apps');
  var g = (apps2.body.data.apps || []).filter(function (a) { return a.name === 'gomoku'; })[0];
  ok(g && g.enabled === false, '查询接口能看到已停用');
  var back = await setState(tokW, 'gomoku', true);
  ok(back.status === 200 && back.body.data.enabled === true, '恢复启用');
  var protect = await setState(tokW, 'settings', false);
  ok(protect.status === 400, '受保护应用拒绝停用（400）', protect.body);
  var missing2 = await setState(tokW, 'no-such-app', false);
  ok(missing2.status === 404, '不存在应用 404');
  var badType = await fetch(BASE + '/api/integrations/v1/apps/gomoku/state', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ClassIntra-Token': tokW },
    body: JSON.stringify({ enabled: 'false' })
  });
  ok(badType.status === 400, 'enabled 非布尔 → 400');
  var noWrite = await setState(tokNarrow, 'gomoku', false);
  ok(noWrite.status === 403, '缺 app:write → 403');

  section('8. 清理');
  for (var i = 0; i < created.length; i++) {
    var del = await admin('DELETE', '/api/integrations/tokens/' + created[i]);
    ok(del.status === 200, '删除集成 #' + created[i]);
  }

  console.log('\n' + '='.repeat(52));
  console.log('结果：通过 ' + pass + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('探针异常:', e && e.stack || e); process.exit(1); });
