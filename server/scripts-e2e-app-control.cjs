// 端到端：管理端应用管控（重点：第三方市场应用的禁用/启用）
//
// 回归背景（2026-10-30）：
//   `PUT /api/admin/app-control/:name` 里有一行 `var marketService = require(...)`，
//   `var` 提升把顶层 marketService 遮蔽成 undefined → 禁用第三方应用必 500，
//   而内置应用走 DESKTOP_APPS 分支根本走不到那行，所以现象是「只有第三方禁用不了」。
//
// 目标实例：隔离实例 http://127.0.0.1:9099（生产库副本）
// 用法：node server/scripts-e2e-app-control.cjs
//
// 断言：
//   1. 第三方应用：禁用 → 管理端回读 false / 系统白名单剔除 / 学生清单剔除
//   2. 管理员仍能在 /market/installed 看到（管理端需要展示已停用项）
//   3. 重新启用 → 全部恢复
//   4. 内置受保护应用（settings / admin）禁用被拒（400）
//   5. 不存在应用名 → 400

var fs = require('fs');
var path = require('path');
var Database = require('better-sqlite3');

var BASE = 'http://127.0.0.1:9099';
var DB_PATH = process.env.E2E_DB || 'C:\\Users\\iflytek\\AppData\\Local\\Temp\\ci-e2e\\e2e.db';
var ADMIN = '251800';

var jwtUtil = require(path.join(__dirname, 'src', 'utils', 'jwt'));
var pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }

function tokenOf(uid) {
  return jwtUtil.generateToken({ user_id: uid, net_name: 'e2e' });
}

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

function pickStudentId(db) {
  // 必须是普通学生：officer / class_admin 在 /market/installed 里与管理員同权，
  // 会看到已停用应用，用他们验证「桌面图标消失」会假失败。
  var row = db.prepare(
    "SELECT user_id FROM users WHERE is_admin = 0 AND role = 'user' AND status = 'active' AND user_id LIKE '25%' LIMIT 1"
  ).get();
  return row ? row.user_id : '';
}

(async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('✗ 找不到隔离库：' + DB_PATH);
    process.exit(1);
  }
  var db = new Database(DB_PATH, { readonly: true });
  var studentId = pickStudentId(db);
  db.close();
  if (!studentId) {
    console.error('✗ 副本里找不到可用学生账号');
    process.exit(1);
  }

  var adminTok = tokenOf(ADMIN);
  var studentTok = tokenOf(studentId);
  console.log('\n管理端应用管控 E2E（第三方禁用回归） → ' + BASE);
  console.log('管理员 ' + ADMIN + ' / 学生 ' + studentId);

  // 选一个已安装的第三方应用
  var installed = await call('GET', '/api/market/installed', adminTok);
  var marketApps = (installed.body.data && installed.body.data.apps) || [];
  var target = marketApps.filter(function (a) { return a.name !== 'market'; })[0];
  if (!target) {
    console.error('✗ 副本里没有已安装的第三方应用，无法验证');
    process.exit(1);
  }
  var NAME = target.name;
  console.log('目标应用：' + NAME + ' v' + target.version);

  section('1. 前置：确保处于启用状态');
  var enable0 = await call('PUT', '/api/admin/app-control/' + NAME, adminTok, { enabled: true });
  ok(enable0.status === 200, '启用请求 200（实际 ' + enable0.status + '）', enable0.body);
  var list0 = await call('GET', '/api/admin/app-control', adminTok);
  var item0 = ((list0.body.data && list0.body.data.apps) || []).filter(function (a) { return a.name === NAME; })[0];
  ok(!!item0, '管理端列表包含该应用');
  ok(item0 && item0.enabled === true, '管理端回读 enabled = true');
  ok(item0 && item0.source === 'market', '来源标记为 market（不是内置）');

  section('2. 禁用（回归点：这里曾经 500）');
  var disable = await call('PUT', '/api/admin/app-control/' + NAME, adminTok, { enabled: false });
  ok(disable.status === 200, '禁用请求 200（实际 ' + disable.status + '）', disable.body);
  ok(disable.body && disable.body.data && disable.body.data.enabled === false, '响应 enabled = false');

  var list1 = await call('GET', '/api/admin/app-control', adminTok);
  var item1 = ((list1.body.data && list1.body.data.apps) || []).filter(function (a) { return a.name === NAME; })[0];
  ok(item1 && item1.enabled === false, '管理端回读 enabled = false（开关能停在关位）');

  var sysA = await call('GET', '/api/system/app-control', adminTok);
  ok((sysA.body.data.enabled_apps || []).indexOf(NAME) === -1, '系统白名单已剔除该应用');

  var instStudent = await call('GET', '/api/market/installed', studentTok);
  ok(((instStudent.body.data && instStudent.body.data.apps) || []).every(function (a) { return a.name !== NAME; }),
    '学生端 /market/installed 不再下发（桌面图标消失）');

  var instAdmin = await call('GET', '/api/market/installed', adminTok);
  ok(((instAdmin.body.data && instAdmin.body.data.apps) || []).some(function (a) { return a.name === NAME; }),
    '管理员仍能看到（管理端要展示已停用项）');

  section('3. 重新启用');
  var enable1 = await call('PUT', '/api/admin/app-control/' + NAME, adminTok, { enabled: true });
  ok(enable1.status === 200, '启用请求 200');
  var sysB = await call('GET', '/api/system/app-control', adminTok);
  ok((sysB.body.data.enabled_apps || []).indexOf(NAME) !== -1, '系统白名单恢复包含');
  var instStudent2 = await call('GET', '/api/market/installed', studentTok);
  ok(((instStudent2.body.data && instStudent2.body.data.apps) || []).some(function (a) { return a.name === NAME; }),
    '学生端清单恢复下发');

  section('4. 保护与非法输入');
  var protect = await call('PUT', '/api/admin/app-control/settings', adminTok, { enabled: false });
  ok(protect.status === 400, '内置受保护应用不可禁用（400）', protect.body);
  var badName = await call('PUT', '/api/admin/app-control/__nope__', adminTok, { enabled: false });
  ok(badName.status === 400, '不存在的应用名被拒（400）', badName.body);
  var noAuth = await call('PUT', '/api/admin/app-control/' + NAME, null, { enabled: false });
  ok(noAuth.status === 401 || noAuth.status === 403, '未登录不可操作（401/403，实际 ' + noAuth.status + '）');

  console.log('\n' + '='.repeat(52));
  console.log('结果：通过 ' + pass + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('探针异常:', e && e.stack || e);
  process.exit(1);
});
