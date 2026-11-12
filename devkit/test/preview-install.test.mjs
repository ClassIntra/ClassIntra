// preview / install 命令测试：对真实 CLI 进程 + 桩宿主（node:http）做端到端验证
// 覆盖：挂载往返、体检前置拦截、凭据三种来源、install 三动作路由、watch 重挂载。
//
// 实现 note：这里全部用异步 spawn 而不是 spawnSync——部分受限环境（沙箱/安全软件）
// 下 spawnSync 子进程的出站连接会永久挂起（child 网络请求永远到不了对端），
// 异步 spawn 无此问题；对无网络约束的 create/check 沿用 author-workflow 的 spawnSync。

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const DEVKIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(DEVKIT_ROOT, 'bin', 'cli.mjs');

// 无凭据环境（resolveAuth 必须显式拿到 --token / --secret）
const NO_AUTH_ENV = Object.assign({}, process.env, { CI_DEV_TOKEN: '', CI_DEV_SECRET: '', CI_DEV_USER: '' });

function runSync(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 20000, env: NO_AUTH_ENV });
}

// 异步运行 CLI 并收集 { status, stdout, stderr }；超时强杀
function runAsync(args, cwd, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: NO_AUTH_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill(); resolve({ status: null, stdout, stderr, timedOut: true }); }
    }, timeoutMs);
    child.on('exit', (code) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ status: code, stdout, stderr, timedOut: false }); }
    });
    child.on('error', (e) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ status: null, stdout, stderr: stderr + String(e), timedOut: false }); }
    });
  });
}

async function assertSuccessAsync(result, operation) {
  assert.equal(result.timedOut, false, operation + ' timed out:\n' + result.stderr + result.stdout);
  assert.equal(result.status, 0, operation + ' failed:\n' + result.stderr + result.stdout);
}

// 桩宿主：记录每个请求（method/url/auth/body），按 handler 的返回响应
function startStubHost(t, handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const recorded = {
        method: req.method,
        url: req.url,
        auth: req.headers.authorization || '',
        body: body ? JSON.parse(body) : null
      };
      requests.push(recorded);
      const respond = handler(recorded) || { code: 200, data: {} };
      res.writeHead(respond.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(respond));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
      resolve({ server, requests, port: server.address().port });
    });
  });
}

async function createApp(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'classintra-preview-'));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const parent = path.join(root, 'packages');
  await mkdir(parent, { recursive: true });
  const created = runSync(['create', 'app', 'preview-demo', '--label', 'Preview Demo', '--dir', parent], root);
  assert.equal(created.status, 0, 'create failed:\n' + created.stderr);
  return { root, app: path.join(parent, 'preview-demo') };
}

function previewArgs(app, extra, port) {
  return ['preview', app, '--host', 'http://127.0.0.1:' + port, ...(extra || [])];
}

const STUB_APP_DESCRIPTOR = {
  name: 'preview-demo', label: 'Preview Demo', version: '0.0.0',
  route: '/preview-demo', hasBackend: false, enabled: true,
  _preview: true, _previewAt: 1234567890
};

test('preview mounts the checked package on the real host endpoint and prints the entry URL', async (t) => {
  const { root, app } = await createApp(t);
  const { requests, port } = await startStubHost(t, (req) => {
    if (req.method === 'POST' && req.url === '/api/market/dev-preview') {
      return { code: 200, data: { app: STUB_APP_DESCRIPTOR } };
    }
    return { status: 404, code: 404, message: 'unexpected ' + req.url };
  });

  const result = await runAsync(previewArgs(app, ['--token', 'tok-1'], port), root);
  await assertSuccessAsync(result, 'preview');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].auth, 'Bearer tok-1');
  assert.equal(requests[0].body.dir, app); // 传给宿主的是绝对包目录
  assert.match(result.stdout, /预览已挂载：preview-demo v0\.0\.0/);
  assert.match(result.stdout, new RegExp('前端：http://127\\.0\\.0\\.1:' + port + '/preview-demo'));
});

test('preview refuses to mount a package that fails check (host is never called)', async (t) => {
  const { root, app } = await createApp(t);
  await writeFile(path.join(app, 'manifest.json'), JSON.stringify({ name: 'other-name', type: 'app' }));
  let called = 0;
  const { port } = await startStubHost(t, () => { called++; return {}; });

  const result = await runAsync(previewArgs(app, ['--token', 'tok'], port), root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /包体检未通过/);
  assert.equal(called, 0, 'stub host must not receive any request');
});

test('preview without credentials fails before contacting the host', async (t) => {
  const { root, app } = await createApp(t);
  let called = 0;
  const { port } = await startStubHost(t, () => { called++; return {}; });

  const result = await runAsync(previewArgs(app, [], port), root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少宿主凭据/);
  assert.equal(called, 0);
});

test('--secret signs an HS256 JWT with the expected user claim', async (t) => {
  const { root, app } = await createApp(t);
  const SECRET = 'unit-test-secret';
  const { requests, port } = await startStubHost(t, () => ({ code: 200, data: { app: STUB_APP_DESCRIPTOR } }));

  const result = await runAsync(previewArgs(app, ['--secret', SECRET, '--user', 'teacher01'], port), root);
  await assertSuccessAsync(result, 'preview with --secret');

  const token = String(requests[0].auth || '').replace(/^Bearer /, '');
  const parts = token.split('.');
  assert.equal(parts.length, 3, 'token must be a compact JWS');
  const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.equal(payload.user_id, 'teacher01');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));
  const expected = createHmac('sha256', SECRET).update(parts[0] + '.' + parts[1]).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(parts[2], expected, 'signature must be a valid HS256 over header.payload');
});

test('install posts to install/update/uninstall endpoints with the chosen source', async (t) => {
  const { root } = await createApp(t); // 复用临时目录即可，install 只关心名字
  const seen = [];
  const { port } = await startStubHost(t, (req) => {
    seen.push({ url: req.url, body: req.body });
    if (req.url === '/api/market/uninstall') return { code: 200, data: { name: req.body.name, dataRetained: true } };
    return { code: 200, data: { name: req.body.name, version: '1.2.3', source: req.body.source, dataRetained: true, configRequired: [] } };
  });

  const base = ['--host', 'http://127.0.0.1:' + port, '--token', 'tok'];
  await assertSuccessAsync(await runAsync(['install', 'preview-demo', ...base, '--source', 'local'], root), 'install');
  await assertSuccessAsync(await runAsync(['install', 'preview-demo', ...base, '--update', '--source', 'local'], root), 'update');
  await assertSuccessAsync(await runAsync(['install', 'preview-demo', ...base, '--uninstall'], root), 'uninstall');

  assert.deepEqual(seen.map((s) => s.url), ['/api/market/install', '/api/market/update', '/api/market/uninstall']);
  assert.deepEqual(seen[0].body, { name: 'preview-demo', source: 'local' });
  assert.deepEqual(seen[2].body, { name: 'preview-demo' });
  const again = await runAsync(['install', 'preview-demo', ...base], root);
  await assertSuccessAsync(again, 'install again');
  assert.match(again.stdout, /已安装：preview-demo v1\.2\.3/);
});

test('install surfaces host error messages with a non-zero exit code', async (t) => {
  const { root } = await createApp(t);
  const { port } = await startStubHost(t, () => ({ status: 400, code: 400, message: '应用名非法' }));
  const result = await runAsync(['install', 'BAD NAME', '--host', 'http://127.0.0.1:' + port, '--token', 'tok'], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /宿主返回 400：应用名非法/);
});

test('watch mode re-mounts when backend files change', async (t) => {
  const { root } = await createApp(t);
  // 带 backend 的包：create --with-backend 重新生成到另一个目录
  const parent = path.join(root, 'packages');
  const created = runSync(['create', 'app', 'watch-demo', '--label', 'Watch Demo', '--with-backend', '--dir', parent], root);
  assert.equal(created.status, 0, 'create with backend failed:\n' + created.stderr);
  const watchApp = path.join(parent, 'watch-demo');

  let mounts = 0;
  const { port } = await startStubHost(t, () => {
    mounts++;
    return { code: 200, data: { app: Object.assign({}, STUB_APP_DESCRIPTOR, { name: 'watch-demo' }) } };
  });

  const child = spawn(process.execPath, [CLI, 'preview', watchApp, '--host', 'http://127.0.0.1:' + port, '--token', 'tok', '--watch'], {
    cwd: root, env: NO_AUTH_ENV, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => { try { child.kill(); } catch (e) {} });

  const waitFor = async (predicate, what, timeoutMs = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('timeout waiting for ' + what);
  };
  await waitFor(() => mounts >= 1, 'first mount');

  // 触发 backend/ 变更（改写一个已存在的文件；fs.watch 事件防抖 300ms 后重挂）
  const routesPath = path.join(watchApp, 'backend', 'routes.js');
  const original = await readFile(routesPath, 'utf8');
  await writeFile(routesPath, original + '\n// touched');
  await utimes(routesPath, new Date(), new Date());
  await waitFor(() => mounts >= 2, 're-mount after backend change');

  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(mounts >= 2, 'expected at least one re-mount, got ' + mounts);
});
