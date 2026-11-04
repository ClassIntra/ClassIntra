// 端到端：第三方应用的运行时权限（声明 + 用时授权 + 班管撤销）
//
// 目标实例：隔离实例 http://127.0.0.1:9099（生产库副本）
// 用法：node server/scripts-e2e-app-permissions.cjs
//
// 断言覆盖：
//   1. 用户侧：初始无授权 → 授予 → 回读 → 撤销
//   2. 未在 manifest 声明的能力 → 400（不能「没声明却来要」）
//   3. 父能力覆盖：声明 system.clipboard 可申请 system.clipboard.read
//   4. 班管侧：汇总可见 / 代撤销 / 全部撤销
//   5. 越权：普通用户访问 admin 接口 403；未登录 401
//   6. 停用的应用不接受授权（403）；不存在应用 404；非敏感能力 400

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
  var row = db.prepare(
    "SELECT user_id FROM users WHERE is_admin = 0 AND status = 'active' AND role = 'user' AND user_id LIKE '25%' LIMIT 1"
  ).get();
  return row ? row.user_id : '';
}

async function main() {
  var db = new Database(DB_PATH);
  var STUDENT = pickStudentId(db);
  if (!STUDENT) {
    console.error('找不到普通学生账号，无法测试');
    process.exit(1);
  }
  console.log('学生账号:', STUDENT, '| 管理员:', ADMIN);

  // 前置：确保 chess 启用（前面的测试可能停过）
  await call('PUT', '/api/admin/app-control/chess', tokenOf(ADMIN), { enabled: true });

  var S = tokenOf(STUDENT);
  var A = tokenOf(ADMIN);
  var APP = 'chess';          // 声明了 system.clipboard（父能力）
  var CAP_PARENT = 'system.clipboard.read';

  section('1. 用户侧：初始状态');
  // 清一次底，避免上一轮残留
  await call('POST', '/api/app-permissions/admin/revoke', A, { name: APP, userId: STUDENT });

  var before = await call('GET', '/api/app-permissions/' + APP, S);
  ok(before.status === 200, '查询自己的授权 200', before.body);
  ok(Array.isArray(before.body.data.granted) && before.body.data.granted.length === 0, '初始没有任何授权');
  ok(before.body.data.sensitive.indexOf(CAP_PARENT) !== -1, '返回该应用声明的敏感能力全集（含剪贴板读取）');
  ok(before.body.data.sensitive.indexOf('device.camera') === -1, '未声明的能力不出现在敏感清单里');

  section('2. 声明校验');
  var undeclared = await call('POST', '/api/app-permissions/' + APP, S, { capability: 'device.camera', granted: true });
  ok(undeclared.status === 400, '未声明的能力被拒（400）', undeclared.body);
  ok(/未在 manifest 中声明/.test(undeclared.body.message || ''), '错误信息说清原因');

  var notSensitive = await call('POST', '/api/app-permissions/' + APP, S, { capability: 'system.share', granted: true });
  ok(notSensitive.status === 400, '非敏感能力不需要授权（400）', notSensitive.body);

  var missingApp = await call('GET', '/api/app-permissions/no-such-app', S);
  ok(missingApp.status === 404, '不存在的应用 404');

  section('3. 授予（父能力覆盖）');
  var grant = await call('POST', '/api/app-permissions/' + APP, S, { capability: CAP_PARENT, granted: true });
  ok(grant.status === 200 && grant.body.data.granted === true, '声明 system.clipboard 可申请 .read', grant.body);

  var after = await call('GET', '/api/app-permissions/' + APP, S);
  ok(after.body.data.granted.indexOf(CAP_PARENT) !== -1, '回读已含该权限');

  var again = await call('POST', '/api/app-permissions/' + APP, S, { capability: CAP_PARENT, granted: true });
  ok(again.status === 200, '重复授予幂等（200）');

  section('4. 班管侧：汇总与撤销');
  var summary = await call('GET', '/api/app-permissions/admin/' + APP, A);
  ok(summary.status === 200, '班管可读汇总 200', summary.body);
  var row = (summary.body.data.users || []).filter(function (u) { return u.userId === STUDENT; })[0];
  ok(!!row, '汇总里能看到该学生');
  ok(!!row && row.capabilities.some(function (c) { return c.capability === CAP_PARENT; }), '该学生名下含该项能力');
  ok(summary.body.data.totalGrants >= 1, '总授权数 ≥ 1');

  var denied = await call('GET', '/api/app-permissions/admin/' + APP, S);
  ok(denied.status === 403, '普通用户访问汇总 403', denied.body);

  var revokeOne = await call('POST', '/api/app-permissions/admin/revoke', A, { name: APP, userId: STUDENT, capability: CAP_PARENT });
  ok(revokeOne.status === 200 && revokeOne.body.data.removed >= 1, '班管逐条撤销成功', revokeOne.body);

  var cleared = await call('GET', '/api/app-permissions/' + APP, S);
  ok(cleared.body.data.granted.length === 0, '撤销后用户侧已清空');

  section('5. 全部撤销');
  await call('POST', '/api/app-permissions/' + APP, S, { capability: CAP_PARENT, granted: true });
  await call('POST', '/api/app-permissions/' + APP, A, { capability: CAP_PARENT, granted: true });
  var bulk = await call('POST', '/api/app-permissions/admin/revoke', A, { name: APP });
  ok(bulk.status === 200 && bulk.body.data.removed >= 2, '整应用全部撤销（≥2 条）', bulk.body);

  var afterBulk = await call('GET', '/api/app-permissions/' + APP, S);
  ok(afterBulk.body.data.granted.length === 0, '全部撤销后学生侧为空');
  var afterBulkA = await call('GET', '/api/app-permissions/' + APP, A);
  ok(afterBulkA.body.data.granted.length === 0, '全部撤销后管理员侧也为空');

  section('6. 停用的应用');
  await call('PUT', '/api/admin/app-control/chess', A, { enabled: false });
  var disabled = await call('POST', '/api/app-permissions/' + APP, S, { capability: CAP_PARENT, granted: true });
  ok(disabled.status === 403, '停用应用拒绝授权（403）', disabled.body);
  var disabledRead = await call('GET', '/api/app-permissions/' + APP, S);
  ok(disabledRead.status === 403, '停用应用拒绝查询（403）');
  await call('PUT', '/api/admin/app-control/chess', A, { enabled: true });

  section('7. 鉴权');
  var anon = await call('GET', '/api/app-permissions/' + APP, null);
  ok(anon.status === 401, '未登录 401（实际 ' + anon.status + '）');
  var anonRevoke = await call('POST', '/api/app-permissions/admin/revoke', null, { name: APP });
  ok(anonRevoke.status === 401, '未登录不能撤销（401）');

  section('8. OpenAPI 自描述');
  var spec = await call('GET', '/api/integrations/v1/openapi.json', null);
  ok(spec.status === 200 && spec.body.openapi === '3.0.3', 'OpenAPI 免鉴权可读', spec.status);
  var paths = spec.body.paths || {};
  ok(Object.keys(paths).length >= 7, '描述至少 7 个端点（实际 ' + Object.keys(paths).length + '）');
  ok(!!(paths['/announcements'] && paths['/announcements'].post), '包含写接口 POST /announcements');
  ok(!!(spec.body.components && spec.body.components.securitySchemes && spec.body.components.securitySchemes.IntegrationToken), '包含鉴权方案定义');

  section('9. 市场边界：仅班管可见');
  // 「应用市场只对班管可见」不只是桌面图标和路由，接口层也必须收口：
  // 学生不该拿到商品目录、自建源地址、插件/主题清单。
  var stuCatalog = await call('GET', '/api/market/catalog?source=local', S);
  ok(stuCatalog.status === 403, '学生拉商品目录 → 403（实际 ' + stuCatalog.status + '）');
  var stuSources = await call('GET', '/api/market/sources', S);
  ok(stuSources.status === 403, '学生拉市场源 → 403（实际 ' + stuSources.status + '）');
  var stuPlugins = await call('GET', '/api/market/plugins-installed', S);
  ok(stuPlugins.status === 403, '学生拉插件清单 → 403（实际 ' + stuPlugins.status + '）');
  var stuThemes = await call('GET', '/api/market/themes-installed', S);
  ok(stuThemes.status === 403, '学生拉主题清单 → 403（实际 ' + stuThemes.status + '）');

  // 但 /installed 必须保持可用：客户端靠它注册路由、渲染桌面图标
  var stuInstalled = await call('GET', '/api/market/installed', S);
  ok(stuInstalled.status === 200, '学生仍可取已安装列表（客户端路由依赖）', stuInstalled.status);

  // 班管侧全通
  var admCatalog = await call('GET', '/api/market/catalog?source=local', A);
  ok(admCatalog.status === 200, '班管可拉商品目录');
  var admSources = await call('GET', '/api/market/sources', A);
  ok(admSources.status === 200, '班管可拉市场源');

  section('10. 市场页路由守卫（meta 契约）');
  // 守卫依赖 manifest.frontend.meta 合并进路由 meta，这里核对契约本身没被改坏
  var marketManifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'apps', 'market', 'manifest.json'), 'utf8'
  ));
  ok(marketManifest.visibleRoles && marketManifest.visibleRoles.indexOf('classAdmin') !== -1, '市场应用声明 visibleRoles=[classAdmin]');
  ok(marketManifest.frontend && marketManifest.frontend.meta && marketManifest.frontend.meta.requiresClassAdmin === true, '路由声明 requiresClassAdmin');

  // 收尾：清掉测试残留
  await call('POST', '/api/app-permissions/admin/revoke', A, { name: APP });
  db.close();

  console.log('\n' + '='.repeat(56));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  if (fail) { console.log('失败 ' + fail + ' 项'); process.exit(1); }
}

main().catch(function (e) {
  console.error('测试异常:', e && e.stack || e);
  process.exit(1);
});
