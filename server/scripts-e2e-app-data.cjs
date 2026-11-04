// 端到端：应用级存储（KV + 对象存储）
//
// 目标实例：隔离实例 http://127.0.0.1:9099
// 用法：node server/scripts-e2e-app-data.cjs
//
// 覆盖：
//   1. KV 增删改查 / 列表 / 一次取全
//   2. 用户隔离（A 写的键 B 读不到）
//   3. 配额（单值 > 64KB 拒绝）
//   4. 对象存储（上传/下载/列表/删除，字节一致）
//   5. 应用停用 → 403；未安装应用 → 404

var fs = require('fs');
var path = require('path');
var Database = require('better-sqlite3');

var BASE = 'http://127.0.0.1:9099';
var DB_PATH = process.env.E2E_DB || 'C:\\Users\\iflytek\\AppData\\Local\\Temp\\ci-e2e\\e2e.db';

var jwtUtil = require(path.join(__dirname, 'src', 'utils', 'jwt'));
var pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }

function tokenOf(uid) { return jwtUtil.generateToken({ user_id: uid, net_name: 'e2e' }); }

async function call(method, urlPath, token, body, rawBuffer, contentType) {
  var headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  var payload;
  if (rawBuffer) {
    headers['Content-Type'] = contentType || 'application/octet-stream';
    payload = rawBuffer;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  var res = await fetch(BASE + urlPath, { method: method, headers: headers, body: payload });
  var ct = res.headers.get('content-type') || '';
  if (ct.indexOf('application/json') === -1) {
    var buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buffer: buf, contentType: ct };
  }
  var text = await res.text();
  var json = null;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json };
}

(async function main() {
  if (!fs.existsSync(DB_PATH)) { console.error('✗ 找不到隔离库'); process.exit(1); }
  var db = new Database(DB_PATH, { readonly: true });
  var students = db.prepare("SELECT user_id FROM users WHERE is_admin = 0 AND role = 'user' AND status = 'active' AND user_id LIKE '25%' LIMIT 2").all();
  db.close();
  if (students.length < 2) { console.error('✗ 需要两个普通学生账号'); process.exit(1); }

  var A = tokenOf(students[0].user_id);
  var B = tokenOf(students[1].user_id);
  var ADMIN = tokenOf('251800');

  var installed = await call('GET', '/api/market/installed', ADMIN);
  var apps = (installed.body.data && installed.body.data.apps) || [];
  var app = apps.filter(function (a) { return a.name === 'gomoku' || a.name === 'pet'; })[0] || apps[0];
  if (!app) { console.error('✗ 没有已安装市场应用'); process.exit(1); }
  var APP = app.name;
  console.log('\n应用级存储 E2E → ' + BASE + '（应用 ' + APP + '）');

  section('1. KV 基础');
  var put = await call('PUT', '/api/app-data/' + APP + '/kv/e2e-key', A, { value: { hello: 'world', n: 42 } });
  ok(put.status === 200, '写入 200');
  var get = await call('GET', '/api/app-data/' + APP + '/kv/e2e-key', A);
  ok(get.status === 200 && get.body.data.value && get.body.data.value.hello === 'world',
    '读回 JSON 值', get.body);
  var keys = await call('GET', '/api/app-data/' + APP + '/kv', A);
  ok(keys.status === 200 && keys.body.data.keys.some(function (k) { return k.key === 'e2e-key'; }), '键列表包含新键');
  var all = await call('GET', '/api/app-data/' + APP + '/kv/all', A);
  ok(all.status === 200 && all.body.data.values['e2e-key'], '一次取回全部包含该键');

  section('2. 用户隔离');
  var getB = await call('GET', '/api/app-data/' + APP + '/kv/e2e-key', B);
  ok(getB.status === 404, '另一个用户读不到（404，实际 ' + getB.status + '）');

  section('3. 配额');
  var big = 'x'.repeat(70 * 1024);
  var tooBig = await call('PUT', '/api/app-data/' + APP + '/kv/too-big', A, { value: big });
  ok(tooBig.status === 400, '单值 > 64KB 被拒（400，实际 ' + tooBig.status + '）');
  var badKey = await call('PUT', '/api/app-data/' + APP + '/kv/' + encodeURIComponent('../etc/passwd'), A, { value: 1 });
  ok(badKey.status === 400 || badKey.status === 404, '非法键名被拒（' + badKey.status + '）');

  section('4. 对象存储');
  var bytes = Buffer.from('ClassIntra app-data e2e ' + Date.now(), 'utf8');
  var up = await call('PUT', '/api/app-data/' + APP + '/blobs/hello.txt', A, undefined, bytes, 'text/plain');
  ok(up.status === 200 && up.body.data && up.body.data.size === bytes.length, '上传成功', up.body);
  var down = await call('GET', '/api/app-data/' + APP + '/blobs/hello.txt', A);
  ok(down.status === 200 && down.buffer && down.buffer.equals(bytes), '下载字节一致');
  var list = await call('GET', '/api/app-data/' + APP + '/blobs', A);
  ok(list.status === 200 && list.body.data.blobs.some(function (b) { return b.name === 'hello.txt'; }), '文件列表包含');
  var delBlob = await call('DELETE', '/api/app-data/' + APP + '/blobs/hello.txt', A);
  ok(delBlob.status === 200 && delBlob.body.data.removed === true, '删除文件');
  var afterDel = await call('GET', '/api/app-data/' + APP + '/blobs/hello.txt', A);
  ok(afterDel.status === 404, '删除后 404');

  section('5. 应用状态边界');
  var off = await call('PUT', '/api/admin/app-control/' + APP, ADMIN, { enabled: false });
  ok(off.status === 200, '停用应用');
  var blocked = await call('GET', '/api/app-data/' + APP + '/kv/e2e-key', A);
  ok(blocked.status === 403, '停用后数据接口 403（实际 ' + blocked.status + '）');
  await call('PUT', '/api/admin/app-control/' + APP, ADMIN, { enabled: true });
  var back = await call('GET', '/api/app-data/' + APP + '/kv/e2e-key', A);
  ok(back.status === 200, '恢复启用后可读');

  var notInstalled = await call('GET', '/api/app-data/no-such-app/kv/x', A);
  ok(notInstalled.status === 404, '未安装应用 404（实际 ' + notInstalled.status + '）');

  section('6. 用量与彻底清理');
  await call('PUT', '/api/app-data/' + APP + '/kv/keep-me', A, { value: 'x' });
  await call('PUT', '/api/app-data/' + APP + '/blobs/keep.txt', A, undefined, Buffer.from('keep'), 'text/plain');
  var usage = await call('GET', '/api/market/app-data-usage?name=' + APP, ADMIN);
  ok(usage.status === 200 && usage.body.data.keys >= 1 && usage.body.data.blobs >= 1, '用量统计可见', usage.body.data);
  var purge = await call('POST', '/api/market/app-data-purge', ADMIN, { name: APP });
  ok(purge.status === 200 && purge.body.data.keys >= 1, '彻底清理返回删除条数', purge.body.data);
  var gone = await call('GET', '/api/app-data/' + APP + '/kv/keep-me', A);
  ok(gone.status === 404, '清理后 KV 已不存在');
  var blobGone = await call('GET', '/api/app-data/' + APP + '/blobs/keep.txt', A);
  ok(blobGone.status === 404, '清理后文件已不存在');
  var usage2 = await call('GET', '/api/market/app-data-usage?name=' + APP, ADMIN);
  ok(usage2.body.data.keys === 0 && usage2.body.data.blobs === 0, '清理后用量归零');
  var purgeDenied = await call('POST', '/api/market/app-data-purge', A, { name: APP });
  ok(purgeDenied.status === 403, '普通用户不能清理（403，实际 ' + purgeDenied.status + '）');

  console.log('\n' + '='.repeat(52));
  console.log('结果：通过 ' + pass + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('探针异常:', e && e.stack || e); process.exit(1); });
