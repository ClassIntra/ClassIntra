var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var jwt = require('jsonwebtoken');

var serverDir = path.resolve(__dirname, '..');
var projectDir = path.resolve(serverDir, '..');
var marketSourceDir = path.join(projectDir, '..', 'market');
var marketAppsDir = path.join(projectDir, 'market-apps');
var tempDir;
var child;
var childError = '';
var baseUrl = 'http://127.0.0.1:19001';
var adminToken = '';
var memberToken = '';

function request(route, options) {
  return fetch(baseUrl + route, options || {}).then(async function(response) {
    var contentType = response.headers.get('content-type') || '';
    var body = contentType.indexOf('application/json') !== -1
      ? await response.json()
      : await response.text();
    return { response: response, body: body };
  });
}

async function waitForHealth() {
  var lastError;
  for (var i = 0; i < 80; i++) {
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

function headersFor(token) {
  return {
    authorization: 'Bearer ' + token,
    'content-type': 'application/json'
  };
}

function adminHeaders() {
  return headersFor(adminToken);
}

function memberHeaders() {
  return headersFor(memberToken);
}

test.before(async function() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classintra-market-'));
  fs.cpSync(marketSourceDir, path.join(tempDir, 'market'), { recursive: true });
  fs.rmSync(marketAppsDir, { recursive: true, force: true });

  child = childProcess.spawn(process.execPath, ['src/app.js'], {
    cwd: serverDir,
    env: Object.assign({}, process.env, {
      JWT_SECRET: 'integration-test-secret',
      DEV_PASSWORD: 'TestPass123',
      DB_PATH: path.join(tempDir, 'classintra.db'),
      MARKET_LOCAL_DIR: path.join(tempDir, 'market'),
      PORT: '19001',
      WS_PORT: '19002',
      RELAY_PORT: '19003',
      NODE_ENV: 'test'
    }),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', function(chunk) {
    childError += chunk.toString();
  });

  await waitForHealth();
});

test.after(async function() {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise(function(resolve) { setTimeout(resolve, 500); });
  }
  fs.rmSync(marketAppsDir, { recursive: true, force: true });
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (e) {}
  }
});

test('市场应用生命周期应在真实 HTTP 服务中完成', async function() {
  var login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: '999999', password: 'TestPass123' })
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.code, 200);
  adminToken = login.body.data.token;
  memberToken = jwt.sign(
    {
      user_id: '123456',
      net_name: '普通成员',
      real_name: '普通成员',
      is_admin: 0,
      role: 'user'
    },
    'integration-test-secret'
  );

  var catalog = await request('/api/market/catalog?source=local');
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.body.data.catalog.apps[0].name, 'gomoku');

  var install = await request('/api/market/install', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: 'gomoku', source: 'local' })
  });
  assert.equal(install.response.status, 200, JSON.stringify(install.body));
  assert.equal(install.body.data.version, '1.0.0');

  var installed = await request('/api/market/installed', { headers: adminHeaders() });
  assert.equal(installed.body.data.apps.length, 1);
  assert.equal(installed.body.data.apps[0].enabled, true);

  var staticEntry = await request('/market-static/gomoku/frontend/entry.js');
  assert.equal(staticEntry.response.status, 200);
  assert.match(staticEntry.body, /function/);

  var state = await request('/api/gomoku/state', { headers: adminHeaders() });
  assert.equal(state.response.status, 200);
  assert.equal(state.body.data.turn, 'black');

  var move = await request('/api/gomoku/move', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ row: 7, col: 7 })
  });
  assert.equal(move.response.status, 200, JSON.stringify(move.body));
  assert.equal(move.body.data.board[7][7], 'black');
  assert.equal(move.body.data.turn, 'white');

  var duplicateMove = await request('/api/gomoku/move', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ row: 7, col: 7 })
  });
  assert.equal(duplicateMove.response.status, 409);

  var invalidMove = await request('/api/gomoku/move', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ row: 15, col: 0 })
  });
  assert.equal(invalidMove.response.status, 400);

  var disable = await request('/api/admin/app-control/gomoku', {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify({ enabled: false })
  });
  assert.equal(disable.response.status, 200);

  var disabledState = await request('/api/gomoku/state', { headers: adminHeaders() });
  assert.equal(disabledState.response.status, 404);

  var adminApps = await request('/api/market/installed', { headers: adminHeaders() });
  assert.equal(adminApps.body.data.apps.length, 1);
  assert.equal(adminApps.body.data.apps[0].enabled, false);

  var memberApps = await request('/api/market/installed', { headers: memberHeaders() });
  assert.equal(memberApps.response.status, 200);
  assert.equal(memberApps.body.data.apps.length, 0);

  var enable = await request('/api/admin/app-control/gomoku', {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify({ enabled: true })
  });
  assert.equal(enable.response.status, 200);

  var enabledState = await request('/api/gomoku/state', { headers: adminHeaders() });
  assert.equal(enabledState.response.status, 200);

  var update = await request('/api/market/update', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: 'gomoku', source: 'local' })
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.data.version, '1.0.0');

  var uninstall = await request('/api/market/uninstall', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name: 'gomoku' })
  });
  assert.equal(uninstall.response.status, 200);

  var removedState = await request('/api/gomoku/state', { headers: adminHeaders() });
  assert.equal(removedState.response.status, 404);
});
