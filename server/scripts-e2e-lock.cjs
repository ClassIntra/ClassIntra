// 禁止关闭时长（lock_seconds）验证：只打隔离实例 9099
var path = require('path');
var Database = require(path.join(__dirname, 'node_modules', 'better-sqlite3'));
var jwtUtil = require(path.join(__dirname, 'src', 'utils', 'jwt'));

var BASE = 'http://127.0.0.1:9099';
var DB = 'C:\\Users\\iflytek\\AppData\\Local\\Temp\\ci-e2e\\e2e.db';
var STUDENT = '251898';

var pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  OK   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

async function call(method, p, token, body) {
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  var res = await fetch(BASE + p, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
  var txt = await res.text();
  var j = null;
  try { j = JSON.parse(txt); } catch (e) { j = { raw: txt.substring(0, 200) }; }
  return { status: res.status, body: j };
}

function cols() {
  var d = new Database(DB, { readonly: true });
  var c = d.prepare('PRAGMA table_info(big_text_broadcasts)').all().map(function (x) { return x.name; });
  d.close();
  return c;
}
function lastRow() {
  var d = new Database(DB, { readonly: true });
  var r = d.prepare('SELECT * FROM big_text_broadcasts ORDER BY id DESC LIMIT 1').get();
  d.close();
  return r;
}

(async function main() {
  var c = cols();
  console.log('=== 1. 迁移 ===');
  ok(c.indexOf('lock_seconds') >= 0, 'lock_seconds 列已建立');
  ok(c.indexOf('scroll_direction') >= 0, 'scroll_direction 列已建立');

  var d0 = new Database(DB, { readonly: true });
  var adm = d0.prepare("SELECT user_id, net_name FROM users WHERE user_id LIKE '2518%' AND (is_admin=1 OR role='officer') AND (status IS NULL OR status='active') ORDER BY (user_id LIKE '%00') DESC, user_id LIMIT 3").all();
  d0.close();
  var tok = null;
  for (var i = 0; i < adm.length; i++) {
    var t = jwtUtil.generateToken({ user_id: adm[i].user_id, net_name: adm[i].net_name });
    var pr = await call('GET', '/api/admin/big-text/presets', t);
    if (pr.status === 200 && pr.body.code === 200) { tok = t; break; }
  }
  if (!tok) { console.error('无可用管理员'); process.exit(2); }

  async function send(label, extra) {
    var body = Object.assign({
      content: '禁止关闭时长测试',
      target_type: 'users', target_ids: [STUDENT], duration: 30
    }, extra);
    var r = await call('POST', '/api/admin/big-text', tok, body);
    ok(r.status === 200 && r.body && r.body.code === 200, label + ' 下发成功', r.body && r.body.message);
    return r;
  }

  console.log('\n=== 2. 正常值往返 ===');
  var r1 = await send('lock=20/duration=30', { lock_seconds: 20 });
  var row1 = lastRow();
  ok(row1 && row1.lock_seconds === 20, '落库 lock_seconds=20', row1 && row1.lock_seconds);

  console.log('\n=== 3. 钳制：超过显示时长时被压回 duration ===');
  var r2 = await send('lock=999/duration=10', { lock_seconds: 999, duration: 10 });
  var row2 = lastRow();
  ok(row2 && row2.lock_seconds === 10, 'lock 被钳到 duration=10（不会锁过头）', row2 && row2.lock_seconds);

  console.log('\n=== 4. 默认值：不传时取 min(5, duration) ===');
  var r3 = await send('不传 lock/duration=30', { duration: 30 });
  var row3 = lastRow();
  ok(row3 && row3.lock_seconds === 5, '默认 5s（与迁移前端上硬编码一致）', row3 && row3.lock_seconds);

  var r4 = await send('不传 lock/duration=3（极短）', { duration: 3 });
  var row4 = lastRow();
  ok(row4 && row4.lock_seconds === 3, 'duration=3 时默认降到 3（不越界）', row4 && row4.lock_seconds);

  console.log('\n=== 5. 负值归零 ===');
  var r5 = await send('lock=-5/duration=30', { lock_seconds: -5 });
  var row5 = lastRow();
  ok(row5 && row5.lock_seconds === 0, '负数归 0（允许立刻关闭）', row5 && row5.lock_seconds);

  console.log('\n=== 6. 下发 payload 含该字段（端上要读得到） ===');
  var dc = await call('GET', '/api/device/commands?device_id=' + STUDENT, null);
  console.log('  （指令信箱拉取状态码 ' + dc.status + '，payload 校验见端上探针）');

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  // 不用 process.exit()：强制退出会撞上 better-sqlite3 未关闭句柄的 UV 断言。
  process.exitCode = fail ? 1 : 0;
})();
