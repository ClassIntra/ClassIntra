// 策略（presets）功能诊断：只打隔离实例 9099，绝不碰生产库
var path = require('path');
var Database = require(path.join(__dirname, 'node_modules', 'better-sqlite3'));
var jwtUtil = require(path.join(__dirname, 'src', 'utils', 'jwt'));

var BASE = 'http://127.0.0.1:9099';
var DB = 'C:\\Users\\iflytek\\AppData\\Local\\Temp\\ci-e2e\\e2e.db';

var pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('  OK  ' + label); }
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

(async function main() {
  var db = new Database(DB, { readonly: true });
  var cols = db.prepare('PRAGMA table_info(big_text_broadcasts)').all().map(function (c) { return c.name; });
  var tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'big_text%'").all().map(function (t) { return t.name; });
  db.close();

  console.log('=== 1. 迁移状态（隔离库） ===');
  ok(cols.indexOf('scroll_direction') >= 0, '迁移 v21 已加 scroll_direction 列', cols.indexOf('scroll_direction'));
  ok(tables.indexOf('big_text_presets') >= 0, 'big_text_presets 表存在');

  var admins = (function () {
    var d = new Database(DB, { readonly: true });
    // 与 scripts-e2e-bigtext.cjs 同口径：优先 xx00 结尾的班管（班管天然有全部权限）
    var r = d.prepare("SELECT user_id, net_name, is_admin, role FROM users WHERE user_id LIKE '2518%' AND (is_admin=1 OR role='officer') AND (status IS NULL OR status='active') ORDER BY (user_id LIKE '%00') DESC, user_id LIMIT 3").all();
    d.close();
    return r;
  })();
  if (!admins.length) { console.error('无管理员账号'); process.exit(2); }
  // 逐个试：班干需要被显式授予 manage_big_text 才过得了闸门，别拿没授权的号当结论
  var tok = null, admin = null;
  for (var a = 0; a < admins.length; a++) {
    var t = jwtUtil.generateToken({ user_id: admins[a].user_id, net_name: admins[a].net_name });
    var probe = await call('GET', '/api/admin/big-text/presets', t);
    if (probe.status === 200 && probe.body && probe.body.code === 200) { tok = t; admin = admins[a]; break; }
    console.log('  跳过 ' + admins[a].user_id + '（' + admins[a].net_name + '）: ' + (probe.body && probe.body.code));
  }
  if (!tok) { console.error('候选账号都无 manage_big_text 权限: ' + JSON.stringify(admins)); process.exit(2); }
  console.log('  管理员:', admin.user_id, admin.net_name);

  console.log('\n=== 2. 策略列表（初始） ===');
  var g0 = await call('GET', '/api/admin/big-text/presets', tok);
  ok(g0.status === 200, 'GET presets 返回 200', { status: g0.status, body: g0.body });
  ok(g0.body && g0.body.code === 200, '业务码 200（不是 403 权限 / 500 异常）', g0.body && g0.body.code);

  console.log('\n=== 3. 保存策略 ===');
  var payload = {
    duration: 30,
    display_mode: 'scroll',
    switch_interval: 5,
    scroll_speed: 120,
    scroll_direction: 'right',
    effect: 'neon',
    bg_color: '#B42318',
    font_color: '#ffffff',
    font_family: 'hei',
    font_size: 140,
    font_weight: '900',
    text_align: 'center',
    sub_content: '测试副内容',
    show_sender: true,
    text_gradient: { from: '#ffffff', to: '#ffd166', angle: 90 },
    bg_gradient: { from: '#B42318', to: '#1D2939', angle: 135 }
  };
  var s = await call('POST', '/api/admin/big-text/presets', tok, { name: '探针测试策略', payload: payload });
  ok(s.status === 200 && s.body && s.body.code === 200, 'POST presets 保存成功', s.body);

  console.log('\n=== 4. 回读：字段是否原样往返 ===');
  var g1 = await call('GET', '/api/admin/big-text/presets', tok);
  var list = (g1.body && g1.body.data && g1.body.data.list) || [];
  var mine = null;
  for (var i = 0; i < list.length; i++) if (list[i].name === '探针测试策略') mine = list[i];
  ok(!!mine, '新策略出现在列表里（保存真的落库了）', { count: list.length });
  if (mine) {
    var p = mine.payload || {};
    ok(p.scroll_direction === 'right', 'scroll_direction 往返正确（right）', p.scroll_direction);
    ok(p.scroll_speed === 120, 'scroll_speed 往返正确（120）', p.scroll_speed);
    ok(p.display_mode === 'scroll', 'display_mode 往返正确（scroll）', p.display_mode);
    ok(p.effect === 'neon', 'effect 往返正确（neon）', p.effect);
    ok(p.font_family === 'hei', 'font_family 往返正确（hei）', p.font_family);
    ok(p.font_size === 140, 'font_size 往返正确（140）', p.font_size);
    ok(p.sub_content === '测试副内容', 'sub_content 往返正确', p.sub_content);
    ok(p.show_sender === true, 'show_sender 往返正确', p.show_sender);
    ok(!!p.text_gradient && p.text_gradient.from === '#ffffff', 'text_gradient 往返正确', p.text_gradient);
  }

  console.log('\n=== 5. 清理 ===');
  if (mine) {
    var d = await call('DELETE', '/api/admin/big-text/presets/' + mine.id, tok);
    ok(d.status === 200, 'DELETE 清理成功', d.body);
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  // 不用 process.exit()：强制退出会撞上 better-sqlite3 未关闭句柄的 UV 断言，
  // 刷一行 "Assertion failed" 吓人但无害。交给事件循环自然收尾。
  process.exitCode = fail ? 1 : 0;
})();
