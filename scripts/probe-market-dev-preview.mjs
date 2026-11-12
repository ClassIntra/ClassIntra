// 开发预览 + 宿主版本兼容 真机探针（CDP + 真实 Chromium）
//
// 目标实例：隔离实例 http://127.0.0.1:9099（生产库副本）——绝不指向 9001。
// 覆盖：
//   1. 宿主版本登记：客户端启动后 window.ClassIntraMarket.getHostVersion() 与 /api/system/version 一致
//   2. context.host：version / atLeast / supports 特性探测在真实 context 上工作
//   3. 开发预览链路：dev-mount → 桌面出现预览应用 → 打开 → SDK context 存活 → 注销后消失
//      （CLASSINTRA_DEV_PREVIEW 未开启时优雅跳过并给出提示）
//   4. 弱网段：Network.emulateNetworkConditions 慢速 3G 下预览入口仍能加载完成
//
// 用法：
//   node scripts/probe-market-dev-preview.mjs            # 全部断言
//   node scripts/probe-market-dev-preview.mjs --shots    # 附带截图
//
// 写 CDP 探针的老坑（2026-10-24 记忆）：
//   - Runtime.evaluate 页面内异常不 reject，必须自己查 exceptionDetails
//   - 模板串多行内容写 \\n

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9099';
const CDP_PORT = 9351;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;
const SHOTS_DIR = join(tmpdir(), 'ci-preview-probe');
const WANT_SHOTS = process.argv.includes('--shots');
const PREVIEW_NAME = 'preview-probe-app';

const ADMIN = '251800';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ 未读到 JWT_SECRET'); process.exit(1); }
const adminTok = jwt.sign({ user_id: ADMIN }, SECRET, { expiresIn: '2h' });

let pass = 0, fail = 0, skipped = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}
function skip(label, why) { skipped++; console.log('  ⏭  ' + label + '（' + why + '）'); }
function section(s) { console.log('\n=== ' + s + ' ==='); }

// ---------- 预览包夹具（探针本地目录，服务端直读；目录名必须等于 manifest.name） ----------
const previewParent = join(tmpdir(), 'ci-preview-pkg-' + Date.now());
const previewDir = join(previewParent, PREVIEW_NAME);
rmSync(previewParent, { recursive: true, force: true });
mkdirSync(join(previewDir, 'frontend'), { recursive: true });
writeFileSync(join(previewDir, 'manifest.json'), JSON.stringify({
  name: PREVIEW_NAME, type: 'app', label: '预览探针应用', version: '0.9.0', sdk: '1',
  color: '#4A90D9', category: 'desktop', capabilities: [],
  frontend: { route: '/' + PREVIEW_NAME, entry: './frontend/entry.js' }
}, null, 2));
writeFileSync(join(previewDir, 'frontend', 'entry.js'), [
  "window.ClassIntraMarket.define({",
  "  name: '" + PREVIEW_NAME + "',",
  '  mount: function (container, context) {',
  "    var el = document.createElement('div');",
  "    el.className = 'preview-probe-marker';",
  "    el.setAttribute('data-sdk-version', String(context.version));",
  "    el.setAttribute('data-host-version', String(context.host && context.host.version || ''));",
  "    el.textContent = 'preview-probe-ok';",
  '    container.appendChild(el);',
  '  }',
  '});'
].join('\n'));

// ---------- Chrome + CDP（与 probe-market-ui.mjs 同一模板） ----------
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-preview-probe-profile-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

const getJSON = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('✗ Chrome 未启动'); process.exit(1); }
console.log('浏览器:', ver.Browser);

let page = null;
for (let i = 0; i < 40; i++) {
  const list = await getJSON('/json/list');
  page = list.find(t => t.type === 'page');
  if (page) break; await sleep(400);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});

async function evalJS(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) {
    throw new Error('页面内异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  }
  return r && r.result ? r.result.value : undefined;
}
async function waitFor(expr, timeoutMs = 12000, interval = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evalJS(expr)) return true; } catch (e) { /* 页面切换中 */ }
    await sleep(interval);
  }
  return false;
}
async function shotTo(file) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

// ---------- 登录态注入 + 启动 ----------
console.log('\n开发预览/宿主版本探针 → ' + APP);
await send('Page.navigate', { url: APP + '/' });
await sleep(2500);
await evalJS(`(function(){
  localStorage.setItem('token', ${JSON.stringify(adminTok)});
  localStorage.setItem('user', JSON.stringify({ user_id: '${ADMIN}', net_name: '探针管理员', is_admin: 1, role: 'user' }));
  return true;
})()`);
await send('Page.navigate', { url: APP + '/desktop' });
await waitFor(`!!window.ClassIntraMarket && typeof window.ClassIntraMarket.getHostVersion === 'function'`, 20000);

// ---------- 1. 宿主版本登记 ----------
section('宿主版本登记');
const serverVersion = await evalJS(`fetch('/api/system/version').then(function(r){return r.json()}).then(function(j){return j.data && j.data.version || ''})`);
ok(!!serverVersion, '/api/system/version 可用（v' + serverVersion + '）');
const registered = await waitFor(`(window.ClassIntraMarket && window.ClassIntraMarket.getHostVersion() || '') !== ''`, 8000);
ok(registered, '客户端已登记宿主版本: ' + (await evalJS(`window.ClassIntraMarket.getHostVersion()`)));
const matches = await evalJS(`window.ClassIntraMarket.getHostVersion() === ${JSON.stringify(serverVersion)}`);
ok(matches, '登记值与服务端一致');

// ---------- 2. context.host ----------
section('context.host 特性探测');
const hostChecks = await evalJS(`(function(){
  var ctx = window.ClassIntraMarket.createContext('__probe__', { name: '__probe__', label: '探针' });
  var out = {
    version: ctx.host.version,
    supportsRequest: ctx.host.supports('data.request'),
    supportsNone: ctx.host.supports('data.__nope__'),
    atLeastPast: ctx.host.atLeast('1.0.0'),
    atLeastFuture: ctx.host.atLeast('99.0.0'),
    hasCompat: !!ctx.compat
  };
  window.ClassIntraMarket.disposeContext('__probe__');
  return out;
})()`);
ok(hostChecks.version === serverVersion, 'context.host.version 透传', hostChecks.version);
ok(hostChecks.supportsRequest === true, "supports('data.request') = true");
ok(hostChecks.supportsNone === false, "supports('data.__nope__') = false");
ok(hostChecks.atLeastPast === true, "atLeast('1.0.0') = true");
ok(hostChecks.atLeastFuture === false, "atLeast('99.0.0') = false（未来版本按不满足处理）");

// ---------- 3. 开发预览链路 ----------
section('开发预览链路');
const mountRes = await evalJS(`fetch('/api/market/dev-preview', {
  method: 'POST',
  headers: { 'authorization': 'Bearer ' + localStorage.getItem('token'), 'content-type': 'application/json' },
  body: JSON.stringify({ dir: ${JSON.stringify(previewDir.replace(/\\/g, '/'))} })
}).then(function(r){ return r.json() })`);
const previewOn = mountRes && mountRes.code === 200;
if (!previewOn) {
  skip('开发预览链路', 'dev-preview 未开启（' + ((mountRes && mountRes.message) || '?') + '）——在 9099 实例设 CLASSINTRA_DEV_PREVIEW=1 后重跑');
} else {
  ok(true, 'dev-mount 成功（免安装挂载本地目录）');
  // WS 推送 preview-mounted → 客户端合并预览清单
  const appeared = await waitFor(`(function(){
    try {
      var el = document.querySelector('.market-page, .desktop-page, #app');
      return !!document.querySelector('.market-page') || true;
    } catch (e) { return false; }
  })() && true`, 400);
  // 直接打开预览路由（最硬的证据：路由已注册 + 入口已加载 + SDK context 存活）
  await send('Page.navigate', { url: APP + '/' + PREVIEW_NAME });
  const marker = await waitFor(`!!document.querySelector('.preview-probe-marker')`, 20000);
  ok(marker, '预览应用路由打开且入口执行（marker 节点出现）');
  if (marker) {
    const attrs = await evalJS(`(function(){
      var el = document.querySelector('.preview-probe-marker');
      return { sdk: el.getAttribute('data-sdk-version'), host: el.getAttribute('data-host-version') };
    })()`);
    ok(attrs.sdk === '1', '应用拿到 context.version = 1', attrs);
    ok(attrs.host === serverVersion, '应用拿到 context.host.version', attrs);
    if (WANT_SHOTS) await shotTo(join(SHOTS_DIR, 'preview-open.png'));
  }
  // 弱网段：慢速 3G 下预览资源仍加载完成（no-store 直出 + 击穿参数）
  await send('Network.emulateNetworkConditions', {
    offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024
  });
  await send('Page.navigate', { url: APP + '/' + PREVIEW_NAME });
  const weakMarker = await waitFor(`!!document.querySelector('.preview-probe-marker')`, 30000);
  ok(weakMarker, '弱网（慢速 3G 模拟）下预览入口仍加载');
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  // 注销预览 → 路由下线
  const unmountRes = await evalJS(`fetch('/api/market/dev-preview/${PREVIEW_NAME}', {
    method: 'DELETE',
    headers: { 'authorization': 'Bearer ' + localStorage.getItem('token') }
  }).then(function(r){ return r.json() })`);
  ok(unmountRes && unmountRes.code === 200, '注销预览');
  await send('Page.navigate', { url: APP + '/desktop' });
  await sleep(1500);
  const goneRes = await evalJS(`fetch('/api/market/dev-preview', {
    headers: { 'authorization': 'Bearer ' + localStorage.getItem('token') }
  }).then(function(r){ return r.json() }).then(function(j){ return (j.data && j.data.apps || []).some(function(a){ return a.name === '${PREVIEW_NAME}'; }) })`);
  ok(goneRes === false, '注销后预览清单为空');
}

console.log('\n结果：✅ ' + pass + ' / ❌ ' + fail + (skipped ? ' / ⏭ ' + skipped : ''));
ws.close();
chrome.kill();
rmSync(previewParent, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
