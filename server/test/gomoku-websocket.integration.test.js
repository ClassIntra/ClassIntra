var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('node:child_process');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var WebSocket = require('ws');

var serverDir = path.resolve(__dirname, '..');
var projectDir = path.resolve(serverDir, '..');
var marketSourceDir = path.join(projectDir, '..', 'market', 'apps', 'gomoku');
var marketAppsDir = path.join(projectDir, 'market-apps');
var tempDir;
var child;
var childError = '';
var baseUrl = 'http://127.0.0.1:19101';
var wsUrl = 'ws://127.0.0.1:19102/ws';
var token = '';
var userId = '';
var roomCode = '';

function request(route, options) {
  return fetch(baseUrl + route, options || {}).then(async function(response) {
    var contentType = response.headers.get('content-type') || '';
    var body = contentType.indexOf('application/json') !== -1
      ? await response.json()
      : await response.text();
    return { response: response, body: body };
  });
}

function authHeaders() {
  return { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
}

function waitForHealth() {
  return new Promise(async function(resolve, reject) {
    var lastError;
    for (var i = 0; i < 80; i++) {
      try {
        var result = await request('/api/system/health');
        if (result.response.status === 200 && result.body.code === 200) return resolve();
      } catch (error) {
        lastError = error;
      }
      await new Promise(function(done) { setTimeout(done, 100); });
    }
    reject(lastError || new Error(childError || '服务未启动'));
  });
}

function openClient() {
  return new Promise(function(resolve, reject) {
    var socket = new WebSocket(wsUrl, { headers: { authorization: 'Bearer ' + token } });
    var messages = [];
    var timer = setTimeout(function() { socket.close(); reject(new Error('WebSocket 消息超时')); }, 3000);
    socket.on('open', function() {
      socket.send(JSON.stringify({ type: 'connect', user_id: userId, token: token }));
    });
    socket.on('message', function(raw) {
      var message = JSON.parse(raw.toString());
      messages.push(message);
      if (message.type === 'connected') {
        clearTimeout(timer);
        resolve({ socket: socket, messages: messages });
      }
    });
    socket.on('error', reject);
  });
}

function waitForMessage(socket, type) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() { reject(new Error('未收到 ' + type)); }, 3000);
    function onMessage(raw) {
      var message = JSON.parse(raw.toString());
      if (message.type === type) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(message);
      }
    }
    socket.on('message', onMessage);
  });
}

test.before(async function() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classintra-gomoku-ws-'));
  fs.cpSync(path.join(projectDir, '..', 'market'), path.join(tempDir, 'market'), { recursive: true });
  fs.rmSync(marketAppsDir, { recursive: true, force: true });
  fs.cpSync(marketSourceDir, path.join(marketAppsDir, 'gomoku'), { recursive: true });
  child = childProcess.spawn(process.execPath, ['src/app.js'], {
    cwd: serverDir,
    env: Object.assign({}, process.env, {
      JWT_SECRET: 'gomoku-ws-test-secret',
      DEV_PASSWORD: 'TestPass123',
      DB_PATH: path.join(tempDir, 'classintra.db'),
      MARKET_LOCAL_DIR: path.join(tempDir, 'market-app'),
      PORT: '19101',
      WS_PORT: '19102',
      RELAY_PORT: '19103',
      NODE_ENV: 'test'
    }),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', function(chunk) { childError += chunk.toString(); });
  await waitForHealth();
  var login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: '999999', password: 'TestPass123' })
  });
  assert.equal(login.response.status, 200);
  token = login.body.data.token;
  userId = login.body.data.user_info.user_id;
  var room = await request('/api/gomoku/rooms', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ size: 15 }) });
  assert.equal(room.response.status, 201);
  roomCode = room.body.data.roomCode;
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

test('Gomoku WebSocket 应支持订阅、状态广播、拒绝事件和取消订阅', async function() {
  var client = await openClient();
  var socket = client.socket;
  socket.send(JSON.stringify({ type: 'gomoku_subscribe', room_code: roomCode }));
  var state = await waitForMessage(socket, 'gomoku_room_state');
  assert.equal(state.room_code, roomCode);
  socket.send(JSON.stringify({ type: 'gomoku_move', room_code: roomCode, row: 0, col: 0 }));
  var changed = await waitForMessage(socket, 'gomoku_room_changed');
  assert.equal(changed.room_code, roomCode);
  socket.send(JSON.stringify({ type: 'gomoku_move', room_code: roomCode, row: 0, col: 0 }));
  var rejected = await waitForMessage(socket, 'gomoku_move_rejected');
  assert.equal(rejected.room_code, roomCode);
  socket.send(JSON.stringify({ type: 'gomoku_continue', room_code: roomCode }));
  var continued = await waitForMessage(socket, 'gomoku_game_continued');
  assert.equal(continued.room_code, roomCode);
  socket.send(JSON.stringify({ type: 'gomoku_unsubscribe', room_code: roomCode }));
  socket.close();
});
