// 开发预览集成测试：真实 HTTP 服务里走通「挂载 → 静态资源 → 后端热重载 → 冲突拒绝 → 注销」
// 与 market-lifecycle.integration.test.js 同一套隔离手段：临时 DB + 临时市场源 + 独立端口。
// 另含门禁静态断言：dev-preview 路由必须 admin + CLASSINTRA_DEV_PREVIEW=1 双闸门。

var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');

var serverDir = path.resolve(__dirname, '..');
var projectDir = path.resolve(serverDir, '..');
var tempDir;
var child;
var childError = '';
var baseUrl = 'http://127.0.0.1:19011';
var adminToken = '';
var memberToken = '';
var pkgDir = '';

function request(route, options) {
  return fetch(baseUrl + route, options || {}).then(async function(response) {
    var contentType = response.headers.get('content-type') || '';
    var body = contentType.indexOf('application/json') !== -1
      ? await response.json()
      : await response.text();
    return { response: response, body: body };
  });
}

function headersFor(token) {
  return { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
}

function adminHeaders() { return headersFor(adminToken); }

async function waitForHealth() {
  var lastError;
  for (var i = 0; i < 100; i++) {
    try {
      var result = await request('/api/system/health');
      if (result.response.status === 200 && result.body.code === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(function(resolve) { setTimeout(resolve, 100); });
  }
  throw lastError || new Error(childError || '服务未在预期时间内启动');
}

// 手写一个最小的可预览包（不依赖 devkit，测试自包含）：前端微前端入口 + 后端 express 路由
function writePreviewPackage(dir) {
  fs.mkdirSync(path.join(dir, 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    name: 'preview-app',
    type: 'app',
    label: '预览测试应用',
    version: '1.0.0',
    sdk: '1',
    color: '#4A90D9',
    category: 'desktop',
    capabilities: [],
    frontend: { route: '/preview-app', entry: './frontend/entry.js', style: './frontend/style.css' },
    backend: { mountPath: '/api/preview-app', entry: './backend/routes.js' }
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'frontend', 'entry.js'), [
    'window.ClassIntraMarket.define({',
    '  name: \'preview-app\',',
    '  mount: function (container, context) {',
    '    var el = document.createElement(\'div\');',
    '    el.textContent = \'preview v1\';',
    '    container.appendChild(el);',
    '  }',
    '});'
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'frontend', 'style.css'), '.preview-app-root { color: #333; }');
  fs.writeFileSync(path.join(dir, 'backend', 'routes.js'), [
    'var express = require(\'express\');',
    'var router = express.Router();',
    "router.get('/ping', function (req, res) { res.json({ code: 200, data: { pong: 'v1' } }); });",
    'module.exports = router;'
  ].join('\n'));
  return dir;
}

// 本地市场源夹具：同名的「已上架」包（验证「预览挂载期间拒绝安装同名应用」）
// + minHostVersion 过高的「未来」包（验证版本闸门）。
// 注意：getCatalog 有 60s 进程内缓存，夹具必须在 before 一次性备齐，测试中途改 index.json 不可见。
function writeMarketFixture(marketDir) {
  var appDir = path.join(marketDir, 'apps', 'preview-app');
  fs.mkdirSync(appDir, { recursive: true });
  fs.cpSync(pkgDir, appDir, { recursive: true });
  var futureDir = path.join(marketDir, 'apps', 'future-app');
  fs.mkdirSync(path.join(futureDir, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(futureDir, 'manifest.json'), JSON.stringify({
    name: 'future-app', type: 'app', label: '未来应用', version: '1.0.0', sdk: '1',
    minHostVersion: '99.0.0',
    frontend: { route: '/future-app', entry: './frontend/entry.js' }
  }));
  fs.writeFileSync(path.join(futureDir, 'frontend', 'entry.js'), 'window.ClassIntraMarket.define({name:\'future-app\',mount:function(){}});');
  fs.writeFileSync(path.join(marketDir, 'index.json'), JSON.stringify({
    version: 1,
    apps: [
      {
        name: 'preview-app',
        label: '预览测试应用',
        version: '1.0.0',
        description: 'fixture',
        files: ['apps/preview-app/manifest.json', 'apps/preview-app/frontend/entry.js', 'apps/preview-app/frontend/style.css', 'apps/preview-app/backend/routes.js']
      },
      {
        name: 'future-app',
        label: '未来应用',
        version: '1.0.0',
        description: 'fixture',
        files: ['apps/future-app/manifest.json', 'apps/future-app/frontend/entry.js']
      }
    ]
  }, null, 2));
}

test.before(async function() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classintra-devpreview-'));
  pkgDir = writePreviewPackage(path.join(tempDir, 'preview-app'));
  writeMarketFixture(path.join(tempDir, 'market'));

  child = childProcess.spawn(process.execPath, ['src/app.js'], {
    cwd: serverDir,
    env: Object.assign({}, process.env, {
      JWT_SECRET: 'devpreview-test-secret',
      DEV_PASSWORD: 'TestPass123',
      DB_PATH: path.join(tempDir, 'classintra.db'),
      MARKET_LOCAL_DIR: path.join(tempDir, 'market'),
      CLASSINTRA_DEV_PREVIEW: '1',
      PORT: '19011',
      WS_PORT: '19012',
      RELAY_PORT: '19013',
      NODE_ENV: 'test'
    }),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', function(chunk) {
    childError += chunk.toString();
  });
  await waitForHealth();

  var login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: '999999', password: 'TestPass123' })
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  adminToken = login.body.data.token;
  memberToken = adminToken; // 角色区分由服务端按 user 查询；管理接口在下方单独验证
});

test.after(async function() {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise(function(resolve) { setTimeout(resolve, 500); });
  }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (e) {}
  }
});

test('dev-preview 路由必须有管理员与环境变量双重闸门', function() {
  var source = fs.readFileSync(path.join(serverDir, 'src', 'routes', 'market.js'), 'utf8');
  assert.match(source, /_devPreviewGate/);
  // 三条 dev-preview 路由全部要求 requireAdmin + 走闸门
  var gateCalls = source.match(/_devPreviewGate\(res\)/g) || [];
  assert.ok(gateCalls.length >= 3, '每条 dev-preview 路由都应调用闸门');
  var adminGuards = source.match(/router\.(?:post|get|delete)\('\/dev-preview[^']*'[^]*?auth\.requireAdmin/g) || [];
  assert.ok(adminGuards.length >= 3, 'dev-preview 路由应全部挂 requireAdmin');
  var service = fs.readFileSync(path.join(serverDir, 'src', 'core', 'market-service.js'), 'utf8');
  assert.match(service, /CLASSINTRA_DEV_PREVIEW/);
});

test('开发预览应完成挂载、静态资源代发、后端热重载与注销的完整闭环', async function() {
  // 1. 挂载
  var mount = await request('/api/market/dev-preview', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ dir: pkgDir })
  });
  assert.equal(mount.response.status, 200, JSON.stringify(mount.body));
  assert.equal(mount.body.data.app.name, 'preview-app');
  assert.equal(mount.body.data.app._preview, true);
  assert.equal(mount.body.data.app._staticBase, '/market-static-dev/preview-app/');
  assert.equal(mount.body.data.app.route, '/preview-app');

  // 2. 预览清单可见
  var list = await request('/api/market/dev-preview', { headers: adminHeaders() });
  assert.equal(list.response.status, 200);
  assert.equal(list.body.data.apps.length, 1);

  // 3. 静态资源实时代发
  var entry = await request('/market-static-dev/preview-app/frontend/entry.js');
  assert.equal(entry.response.status, 200);
  assert.match(String(entry.body), /preview v1/);
  var style = await request('/market-static-dev/preview-app/frontend/style.css');
  assert.equal(style.response.status, 200);
  // 路径穿越与白名单外扩展名拒绝
  var escape = await request('/market-static-dev/preview-app/..%2f..%2fescape.js');
  assert.ok(escape.response.status === 403 || escape.response.status === 404, '穿越路径必须被拒');
  var badExt = await request('/market-static-dev/preview-app/backend/routes.js.bak');
  assert.equal(badExt.response.status, 404);
  var absent = await request('/market-static-dev/preview-app/frontend/missing.js');
  assert.equal(absent.response.status, 404);

  // 4. 后端挂载可用
  var ping = await request('/api/preview-app/ping', { headers: adminHeaders() });
  assert.equal(ping.response.status, 200, JSON.stringify(ping.body));
  assert.equal(ping.body.data.pong, 'v1');

  // 5. 改后端代码 → 重挂 = 热重载
  var routesPath = path.join(pkgDir, 'backend', 'routes.js');
  fs.writeFileSync(routesPath, [
    'var express = require(\'express\');',
    'var router = express.Router();',
    "router.get('/ping', function (req, res) { res.json({ code: 200, data: { pong: 'v2' } }); });",
    'module.exports = router;'
  ].join('\n'));
  var remount = await request('/api/market/dev-preview', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ dir: pkgDir })
  });
  assert.equal(remount.response.status, 200, JSON.stringify(remount.body));
  var ping2 = await request('/api/preview-app/ping', { headers: adminHeaders() });
  assert.equal(ping2.response.status, 200);
  assert.equal(ping2.body.data.pong, 'v2', '重挂后必须加载新代码');

  // 6. 冲突拒绝：第二个预览占用同一路由
  var pkg2 = path.join(tempDir, 'preview-two');
  fs.mkdirSync(path.join(pkg2, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(pkg2, 'manifest.json'), JSON.stringify({
    name: 'preview-two', type: 'app', label: '第二个预览', version: '1.0.0', sdk: '1',
    frontend: { route: '/preview-app', entry: './frontend/entry.js' }
  }));
  fs.writeFileSync(path.join(pkg2, 'frontend', 'entry.js'), 'window.ClassIntraMarket.define({name:\'preview-two\',mount:function(){}});');
  var conflict = await request('/api/market/dev-preview', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ dir: pkg2 })
  });
  assert.equal(conflict.response.status, 400);
  assert.match(conflict.body.message, /已被.*占用|冲突/);

  // 7. 预览挂载期间，安装同名应用必须被拒绝
  var install = await request('/api/market/install', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: 'preview-app', source: 'local' })
  });
  assert.equal(install.response.status, 400, JSON.stringify(install.body));
  assert.match(install.body.message, /开发预览中/);

  // 8. 注销后资源与后端一并不再可用
  var unmount = await request('/api/market/dev-preview/preview-app', {
    method: 'DELETE',
    headers: adminHeaders()
  });
  assert.equal(unmount.response.status, 200, JSON.stringify(unmount.body));
  var gone = await request('/market-static-dev/preview-app/frontend/entry.js');
  assert.equal(gone.response.status, 404);
  var backendGone = await request('/api/preview-app/ping', { headers: adminHeaders() });
  assert.equal(backendGone.response.status, 404);
  var listAfter = await request('/api/market/dev-preview', { headers: adminHeaders() });
  assert.equal(listAfter.body.data.apps.length, 0);

  // 9. 注销后同名应用可以正常安装（预览不再阻挡）
  var installAfter = await request('/api/market/install', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: 'preview-app', source: 'local' })
  });
  assert.equal(installAfter.response.status, 200, JSON.stringify(installAfter.body));
  var uninstall = await request('/api/market/uninstall', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: 'preview-app' })
  });
  assert.equal(uninstall.response.status, 200);
});

test('非法预览请求应被明确拒绝', async function() {
  // manifest.name 与目录名不一致
  var badDir = path.join(tempDir, 'bad-pkg');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'manifest.json'), JSON.stringify({
    name: 'other-name', type: 'app', label: 'bad', version: '1.0.0', sdk: '1',
    frontend: { route: '/bad', entry: './frontend/entry.js' }
  }));
  var mismatch = await request('/api/market/dev-preview', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ dir: badDir })
  });
  assert.equal(mismatch.response.status, 400);
  assert.match(mismatch.body.message, /不一致/);

  // 目录不存在 / 缺少 dir
  var missing = await request('/api/market/dev-preview', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ dir: path.join(tempDir, 'no-such-dir') })
  });
  assert.equal(missing.response.status, 400);
  var noDir = await request('/api/market/dev-preview', {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify({})
  });
  assert.equal(noDir.response.status, 400);

  // 未挂载时注销
  var unmountUnknown = await request('/api/market/dev-preview/no-such-app', {
    method: 'DELETE', headers: adminHeaders()
  });
  assert.equal(unmountUnknown.response.status, 400);
});

test('minHostVersion 闸门：宿主过旧时预览与安装都明确拒绝', async function() {
  // 夹具里的 future-app（minHostVersion 99.0.0）在 before 已备齐（目录缓存见 writeMarketFixture 注释）
  var futurePkg = path.join(tempDir, 'market', 'apps', 'future-app');

  var preview = await request('/api/market/dev-preview', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ dir: futurePkg })
  });
  assert.equal(preview.response.status, 400, JSON.stringify(preview.body));
  assert.match(preview.body.message, /要求 ClassIntra ≥ v99\.0\.0/);

  // 安装链路同一闸门（同一校验函数）
  var install = await request('/api/market/install', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: 'future-app', source: 'local' })
  });
  assert.equal(install.response.status, 400, JSON.stringify(install.body));
  assert.match(install.body.message, /要求 ClassIntra ≥ v99\.0\.0/);

  // 合法的 minHostVersion（≤ 当前宿主）正常预览
  fs.writeFileSync(path.join(futurePkg, 'manifest.json'), JSON.stringify({
    name: 'future-app', type: 'app', label: '未来应用', version: '1.0.0', sdk: '1',
    minHostVersion: '1.0.0',
    frontend: { route: '/future-app', entry: './frontend/entry.js' }
  }));
  var okPreview = await request('/api/market/dev-preview', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ dir: futurePkg })
  });
  assert.equal(okPreview.response.status, 200, JSON.stringify(okPreview.body));
  assert.equal(okPreview.body.data.app.minHostVersion, '1.0.0');
  await request('/api/market/dev-preview/future-app', { method: 'DELETE', headers: adminHeaders() });
});
