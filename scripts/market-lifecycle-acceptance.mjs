// 市场应用完整生命周期贯通验收（密封环境）
// ============================================================
// 目的：把「装 → 授权 → 用 → 升级 → 失败回滚 → 降级拒绝 → 卸载 → 数据保留/清除」
// 一整条链在一次性环境里走通——所有状态都在临时目录，绝不碰真实 DB 与 market-apps/。
//
// 用法：
//   node scripts/market-lifecycle-acceptance.mjs           # 全量验收
//   node scripts/market-lifecycle-acceptance.mjs --keep    # 保留临时现场排查
//
// 约定：PASS/FAIL 门禁输出（与 ci-check.mjs 一致），任何 FAIL 退出码 1。
// 不进 CI（spawn 真实服务器 + 原生依赖），本地/验收机执行。

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const PORT = 19101, WS_PORT = 19102, RELAY_PORT = 19103;
const BASE = 'http://127.0.0.1:' + PORT;
const APP = 'lifecycle-probe-app';
const PLUGIN = 'lifecycle-probe-plugin';

const KEEP = process.argv.includes('--keep');
let tempDir = '';
let failures = 0;
let passes = 0;

function report(ok, label, detail) {
  if (ok) { passes++; console.log('PASS ' + label + (detail ? ' — ' + detail : '')); }
  else { failures++; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
}

function jsonHeaders(token) {
  return { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
}

async function request(route, options = {}) {
  const response = await fetch(BASE + route, options);
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, body };
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForHealth() {
  let last = '';
  for (let i = 0; i < 120; i++) {
    try {
      const r = await request('/api/system/health');
      if (r.status === 200 && r.body.code === 200) return true;
    } catch (e) { last = e.message; }
    await wait(100);
  }
  console.error('服务未启动：' + last);
  return false;
}

// ---------- 夹具：本地市场源里的应用/插件（三个版本） ----------
function writeAppFixture(marketDir, version, opts = {}) {
  const appDir = path.join(marketDir, 'apps', APP);
  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(path.join(appDir, 'frontend'), { recursive: true });
  mkdirSync(path.join(appDir, 'backend'), { recursive: true });
  writeFileSync(path.join(appDir, 'manifest.json'), JSON.stringify({
    name: APP, type: 'app', label: '生命周期验收应用', version, sdk: '1',
    color: '#4A90D9', category: 'desktop', capabilities: ['data.storage', 'device.camera'],
    frontend: { route: '/' + APP, entry: './frontend/entry.js', style: './frontend/style.css' },
    backend: { mountPath: '/api/' + APP, entry: './backend/routes.js', jobs: [{ name: 'heartbeat', every: '5m', handler: './backend/jobs/heartbeat.js' }] }
  }, null, 2));
  writeFileSync(path.join(appDir, 'frontend', 'entry.js'), "window.ClassIntraMarket.define({name:'" + APP + "',mount:function(){}});");
  writeFileSync(path.join(appDir, 'frontend', 'style.css'), '.' + APP + '{}');
  if (opts.brokenBackend) {
    // 故意写坏 routes.js（语法错误 → require 抛错 → 挂载失败 → fs-swap 回滚）。
    // 其余文件（jobs/cleanup）保持可下载：下载失败测的是完整性，挂载失败才测回滚。
    writeFileSync(path.join(appDir, 'backend', 'routes.js'), 'var express = require(\'express\');\nthis is not javascript(');
    mkdirSync(path.join(appDir, 'backend', 'jobs'), { recursive: true });
    writeFileSync(path.join(appDir, 'backend', 'jobs', 'heartbeat.js'), "module.exports = function (ctx) { ctx.log('x'); };\n");
    writeFileSync(path.join(appDir, 'backend', 'cleanup.js'), 'module.exports = function cleanup() {};\n');
  } else {
    writeFileSync(path.join(appDir, 'backend', 'routes.js'), [
      "var express = require('express');",
      'var router = express.Router();',
      "var host = require('_sdk/backend/host');",
      "router.get('/ping', function (req, res) { res.json({ code: 200, data: { pong: '" + version + "' } }); });",
      "router.get('/who', host.auth.requireAuth, function (req, res) { res.json({ code: 200, data: { user: req.user.user_id } }); });",
      'module.exports = router;'
    ].join('\n'));
    mkdirSync(path.join(appDir, 'backend', 'jobs'), { recursive: true });
    writeFileSync(path.join(appDir, 'backend', 'jobs', 'heartbeat.js'), [
      "var host = require('_sdk/backend/host');",
      'module.exports = function (ctx) {',
      "  host.db.prepare('CREATE TABLE IF NOT EXISTS " + APP.replace(/-/g, '_') + "_pulse (id INTEGER PRIMARY KEY, at INTEGER)').run();",
      "  ctx.log('heartbeat');",
      '};'
    ].join('\n'));
    writeFileSync(path.join(appDir, 'backend', 'cleanup.js'), [
      "var host = require('_sdk/backend/host');",
      'module.exports = function cleanup() {',
      "  host.db.prepare('DROP TABLE IF EXISTS " + APP.replace(/-/g, '_') + "_pulse').run();",
      "  host.db.prepare('DROP TABLE IF EXISTS " + APP.replace(/-/g, '_') + "_items').run();",
      '};'
    ].join('\n'));
  }
  return appDir;
}

function writePluginFixture(marketDir) {
  const dir = path.join(marketDir, 'plugins', PLUGIN);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'backend'), { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    name: PLUGIN, type: 'plugin', label: '生命周期验收插件', version: '1.0.0', sdk: '1',
    canDisable: true, description: 'fixture',
    backend: { mountPath: '/api/' + PLUGIN, entry: './backend/routes.js', jobs: [{ name: 'tick', every: '5m', handler: './backend/jobs/tick.js' }] }
  }, null, 2));
  writeFileSync(path.join(dir, 'backend', 'routes.js'), [
    "var express = require('express');",
    'var router = express.Router();',
    "router.get('/ping', function (req, res) { res.json({ code: 200, data: { pong: true } }); });",
    'module.exports = router;'
  ].join('\n'));
  mkdirSync(path.join(dir, 'backend', 'jobs'), { recursive: true });
  writeFileSync(path.join(dir, 'backend', 'jobs', 'tick.js'), 'module.exports = function (ctx) { ctx.log(\'tick\'); };\n');
  return dir;
}

function writeIndex(marketDir) {
  const files = (kind, name, extra) =>
    ['manifest.json']
      .concat(kind === 'apps'
        ? ['frontend/entry.js', 'frontend/style.css', 'backend/routes.js']
        : ['backend/routes.js'])
      .concat(extra || [])
      .map(f => kind + '/' + name + '/' + f);
  const version = readFileSync(path.join(marketDir, 'apps', APP, 'manifest.json'), 'utf8');
  writeFileSync(path.join(marketDir, 'index.json'), JSON.stringify({
    version: 1,
    apps: [{ name: APP, label: '生命周期验收应用', version: JSON.parse(version).version, description: 'fixture', files: files('apps', APP, ['backend/jobs/heartbeat.js', 'backend/cleanup.js']) }],
    plugins: [{ name: PLUGIN, label: '生命周期验收插件', version: '1.0.0', description: 'fixture', files: files('plugins', PLUGIN, ['backend/jobs/tick.js']) }]
  }, null, 2));
}

// ---------- 主流程 ----------
tempDir = mkdtempSync(path.join(os.tmpdir(), 'classintra-lifecycle-'));
const marketDir = path.join(tempDir, 'market');
mkdirSync(path.join(marketDir, 'apps'), { recursive: true });
mkdirSync(path.join(marketDir, 'plugins'), { recursive: true });
writeAppFixture(marketDir, '1.0.0');
writePluginFixture(marketDir);
writeIndex(marketDir);

const server = spawn(process.execPath, ['src/app.js'], {
  cwd: SERVER_DIR,
  env: Object.assign({}, process.env, {
    JWT_SECRET: 'lifecycle-acceptance-secret',
    DEV_PASSWORD: 'TestPass123',
    DB_PATH: path.join(tempDir, 'classintra.db'),
    MARKET_LOCAL_DIR: marketDir,
    PORT: String(PORT), WS_PORT: String(WS_PORT), RELAY_PORT: String(RELAY_PORT),
    NODE_ENV: 'test'
  }),
  stdio: ['ignore', 'ignore', 'pipe']
});
let serverErr = '';
server.stderr.on('data', c => { serverErr += c.toString(); });

try {
  if (!(await waitForHealth())) {
    report(false, '服务器启动', serverErr.slice(-400));
    process.exit(1);
  }
  report(true, '服务器启动（密封环境：临时 DB + 临时市场源）');

  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: '999999', password: 'TestPass123' })
  });
  report(login.status === 200 && login.body.code === 200, '班管登录');
  const token = login.body.data.token;
  const auth = () => jsonHeaders(token);

  // 1. 安装
  const install = await request('/api/market/install', { method: 'POST', headers: auth(), body: JSON.stringify({ name: APP, source: 'local' }) });
  report(install.status === 200 && install.body.data.version === '1.0.0', '安装 v1.0.0', JSON.stringify(install.body).slice(0, 160));
  const appInstalled = existsSync(path.join(ROOT, 'market-apps', APP, 'backend', 'routes.js'));
  report(appInstalled, '应用文件落盘 market-apps/' + APP);

  // 2. 挂载可用 + 门面后端 + 静态资源
  const ping = await request('/api/' + APP + '/ping', { headers: auth() });
  report(ping.status === 200 && ping.body.data.pong === '1.0.0', '后端热挂载可用（_sdk/backend/host 门面）', JSON.stringify(ping.body));
  const who = await request('/api/' + APP + '/who', { headers: auth() });
  report(who.status === 200 && who.body.data.user === '999999', 'requireAuth 中间件经门面生效');
  const entry = await request('/market-static/' + APP + '/frontend/entry.js');
  report(entry.status === 200 && String(entry.body).includes('ClassIntraMarket'), '静态资源直出');

  // 3. 运行时授权（device.camera 需用户同意）
  const grant = await request('/api/app-permissions/' + APP, { method: 'POST', headers: auth(), body: JSON.stringify({ capability: 'device.camera', granted: true }) });
  report(grant.status === 200, '运行时授权写入');
  const perm = await request('/api/app-permissions/' + APP, { headers: auth() });
  const granted = perm.body && perm.body.data && (perm.body.data.permissions || perm.body.data.grants || perm.body.data);
  report(JSON.stringify(granted).includes('device.camera'), '授权可查', JSON.stringify(granted).slice(0, 120));

  // 4. KV 数据写入（跟账号走）
  const kvPut = await request('/api/app-data/' + APP + '/kv/keepme', { method: 'PUT', headers: auth(), body: JSON.stringify({ value: { note: 'survives' } }) });
  report(kvPut.status === 200, 'KV 写入');
  const kvGet = await request('/api/app-data/' + APP + '/kv/keepme', { headers: auth() });
  report(kvGet.status === 200 && JSON.stringify(kvGet.body).includes('survives'), 'KV 读取');

  // 5. 定时任务登记
  const jobs = await request('/api/market/app-jobs', { headers: auth() });
  report(JSON.stringify(jobs.body).includes('heartbeat'), '定时任务已登记（app-jobs）');

  // 6. 升级 1.1.0：数据保留 + 版本更新
  writeAppFixture(marketDir, '1.1.0');
  writeIndex(marketDir);
  const update = await request('/api/market/update', { method: 'POST', headers: auth(), body: JSON.stringify({ name: APP, source: 'local' }) });
  report(update.status === 200 && update.body.data.version === '1.1.0', '升级 v1.1.0', JSON.stringify(update.body).slice(0, 160));
  const pingAfterUpdate = await request('/api/' + APP + '/ping', { headers: auth() });
  report(pingAfterUpdate.body.data.pong === '1.1.0', '升级后新代码生效');
  const kvAfterUpdate = await request('/api/app-data/' + APP + '/kv/keepme', { headers: auth() });
  report(kvAfterUpdate.status === 200 && JSON.stringify(kvAfterUpdate.body).includes('survives'), '升级后数据保留');

  // 7. 损坏包升级 → 回滚
  writeAppFixture(marketDir, '1.2.0', { brokenBackend: true });
  writeIndex(marketDir);
  const broken = await request('/api/market/update', { method: 'POST', headers: auth(), body: JSON.stringify({ name: APP, source: 'local' }) });
  report(broken.status === 400, '损坏包升级被拒', JSON.stringify(broken.body).slice(0, 120));
  const pingAfterRollback = await request('/api/' + APP + '/ping', { headers: auth() });
  report(pingAfterRollback.status === 200 && pingAfterRollback.body.data.pong === '1.1.0', '失败回滚：旧版本继续服务');

  // 8. 降级拒绝（local 源先报，远程源 404 兜底 → 汇总信息含「拒绝降级」）
  writeAppFixture(marketDir, '0.9.0');
  writeIndex(marketDir);
  const downgrade = await request('/api/market/install', { method: 'POST', headers: auth(), body: JSON.stringify({ name: APP, source: 'local' }) });
  report(downgrade.status === 400 && /拒绝降级/.test(JSON.stringify(downgrade.body)), '降级拒绝', JSON.stringify(downgrade.body).slice(0, 160));

  // 9. 卸载：默认数据保留，重装可见
  const uninstall = await request('/api/market/uninstall', { method: 'POST', headers: auth(), body: JSON.stringify({ name: APP }) });
  report(uninstall.status === 200 && uninstall.body.data.dataRetained === true, '卸载（数据默认保留）');
  report(!existsSync(path.join(ROOT, 'market-apps', APP)), '应用目录已删除');
  writeAppFixture(marketDir, '1.1.0');
  writeIndex(marketDir);
  const reinstall = await request('/api/market/install', { method: 'POST', headers: auth(), body: JSON.stringify({ name: APP, source: 'local' }) });
  report(reinstall.status === 200, '重装 v1.1.0');
  const kvAfterReinstall = await request('/api/app-data/' + APP + '/kv/keepme', { headers: auth() });
  report(kvAfterReinstall.status === 200 && JSON.stringify(kvAfterReinstall.body).includes('survives'), '重装后数据仍在（卸载不清数据）');

  // 10. 彻底清除
  const purge = await request('/api/market/app-data-purge', { method: 'POST', headers: auth(), body: JSON.stringify({ name: APP }) });
  report(purge.status === 200, '主动清除应用数据');
  const kvAfterPurge = await request('/api/app-data/' + APP + '/kv/keepme', { headers: auth() });
  report(!(kvAfterPurge.status === 200 && JSON.stringify(kvAfterPurge.body).includes('survives')), '清除后数据不存在');

  // 11. 卸载清理（cleanup 钩子），为插件验收让路
  await request('/api/market/uninstall', { method: 'POST', headers: auth(), body: JSON.stringify({ name: APP }) });

  // 12. 插件变体：安装 → 任务登记 → 暂停（404）→ 恢复 → 卸载
  const installPlugin = await request('/api/market/install-plugin', { method: 'POST', headers: auth(), body: JSON.stringify({ name: PLUGIN, source: 'local' }) });
  report(installPlugin.status === 200, '插件安装', JSON.stringify(installPlugin.body).slice(0, 160));
  const pluginPing = await request('/api/' + PLUGIN + '/ping', { headers: auth() });
  report(pluginPing.status === 200, '插件路由可用');
  const pluginJobs = await request('/api/market/app-jobs', { headers: auth() });
  report(JSON.stringify(pluginJobs.body).includes('tick'), '插件定时任务登记');
  const pause = await request('/api/market/plugin-toggle', { method: 'POST', headers: auth(), body: JSON.stringify({ name: PLUGIN, enabled: false }) });
  report(pause.status === 200, '插件暂停');
  const pausedPing = await request('/api/' + PLUGIN + '/ping', { headers: auth() });
  report(pausedPing.status === 404, '暂停后请求期闸门 404');
  await request('/api/market/plugin-toggle', { method: 'POST', headers: auth(), body: JSON.stringify({ name: PLUGIN, enabled: true }) });
  const resumedPing = await request('/api/' + PLUGIN + '/ping', { headers: auth() });
  report(resumedPing.status === 200, '恢复后立即可用');
  const uninstallPlugin = await request('/api/market/uninstall-plugin', { method: 'POST', headers: auth(), body: JSON.stringify({ name: PLUGIN }) });
  report(uninstallPlugin.status === 200, '插件卸载');
  const gonePlugin = await request('/api/' + PLUGIN + '/ping', { headers: auth() });
  report(gonePlugin.status === 404, '插件卸载后路由下线');

} catch (e) {
  report(false, '验收流程异常', e.message + '\n' + (serverErr.slice(-600)));
} finally {
  console.log('');
  console.log('结果：PASS ' + passes + ' / FAIL ' + failures);
  if (server && !server.killed) { try { server.kill('SIGTERM'); } catch (e) {} }
  if (!KEEP && tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {}
  } else if (KEEP) {
    console.log('现场保留：' + tempDir);
  }
}
process.exit(failures ? 1 : 0);
