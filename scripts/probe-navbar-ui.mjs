// 导航栏真机探针：验证 chess/gomoku 接入宿主 AppNavBar 后
// 左侧返回区 / 标题区 / 右侧注入区的实际渲染（布局 + 截图）
//
// 目标实例：隔离实例 http://127.0.0.1:9099（生产库副本）
// 用法：node scripts/probe-navbar-ui.mjs
//
// 产出：
//   - 断言结果（布局几何 + 标题文本）
//   - 截图 /tmp/ci-nav-probe/chess-nav.png / gomoku-nav.png（人工目检）

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9099';
const CDP_PORT = 9346;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;
const SHOTS = '/tmp/ci-nav-probe';
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

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-nav-probe-profile-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

const getJSON = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('✗ Chrome 未启动'); process.exit(1); }

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
async function waitFor(expr, timeoutMs = 15000, interval = 250) {
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
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });

console.log('\n导航栏真机探针 → ' + APP);
await send('Page.navigate', { url: APP + '/' });
await sleep(2500);
await evalJS(`(function(){
  localStorage.setItem('token', ${JSON.stringify(adminTok)});
  localStorage.setItem('user', JSON.stringify({ user_id: '${ADMIN}', net_name: '探针管理员', is_admin: 1, role: 'user' }));
  localStorage.setItem('ci:market-source', 'local');
  return true;
})()`);

// 几何采集：导航栏三区的盒模型 + 标题文本 + 是否溢出/重叠
const NAV_SNIPPET = `(function(){
  var bar = document.querySelector('.app-nav-bar');
  if (!bar) return null;
  function rect(el){ if(!el) return null; var r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) }; }
  var left = bar.querySelector('.nav-left');
  var center = bar.querySelector('.nav-center');
  var title = bar.querySelector('.nav-title');
  var right = bar.querySelector('.nav-right');
  var back = bar.querySelector('.nav-back');
  var tr = title ? title.getBoundingClientRect() : null;
  var br = back ? back.getBoundingClientRect() : null;
  return {
    titleText: title ? title.textContent : '',
    backText: back ? back.textContent.trim() : '',
    left: rect(left), center: rect(center), right: rect(right), back: rect(back),
    titleRect: tr ? { x: Math.round(tr.x), w: Math.round(tr.width), right: Math.round(tr.right) } : null,
    // 重叠检测：标题左缘是否侵入返回按钮右缘
    overlap: (tr && br) ? (tr.x < br.right - 2) : null,
    titleOverflow: title ? (title.scrollWidth > title.clientWidth + 2) : null,
    titleVisible: title ? (title.offsetWidth > 0 && title.offsetHeight > 0) : false,
    hostSlotChildren: (bar.querySelector('[data-role="host-navbar-slot"]') || { childElementCount: 0 }).childElementCount,
    rightWidth: right ? Math.round(right.getBoundingClientRect().width) : 0
  };
})()`;

async function probeApp(route, name, expectSlot) {
  section(name + '（' + route + '）');
  await send('Page.navigate', { url: APP + '/market' });
  await waitFor(`!!document.querySelector('.market-page')`, 20000);
  await sleep(1200); // 等市场目录加载、路由注册
  await send('Page.navigate', { url: APP + route });
  const ready = await waitFor(`!!document.querySelector('.app-nav-bar')`, 20000);
  if (!ready) { ok(false, name + ' 导航栏出现'); return; }
  await sleep(1500); // 等应用 mount、hostNavbar 注入完成

  const nav = await evalJS(NAV_SNIPPET);
  if (!nav) { ok(false, name + ' 导航栏几何采集'); return; }
  console.log('  几何:', JSON.stringify(nav));
  ok(nav.titleVisible, '标题可见');
  ok(nav.titleText.length > 0, '标题非空（' + nav.titleText + '）');
  ok(nav.overlap === false, '标题不与返回按钮重叠', nav.overlap);
  ok(nav.titleOverflow === false, '标题未截断溢出', nav.titleOverflow);
  ok(nav.hostSlotChildren > 0, 'hostNavbar 注入节点数 = ' + nav.hostSlotChildren);
  ok(nav.backText === '返回', '返回按钮文案 = ' + nav.backText);
  await shotTo(join(SHOTS, name + '-nav.png'));
  console.log('  截图 → ' + join(SHOTS, name + '-nav.png'));

  // 进入房间后再看一次动态标题（gomoku/chess 建房走真实 API）
  const created = await evalJS(`(function(){
    var btn = document.querySelector('[data-action="create"]');
    if (!btn) return false;
    btn.click(); return true;
  })()`);
  if (created) {
    await sleep(1800);
    const nav2 = await evalJS(NAV_SNIPPET);
    console.log('  建房后:', JSON.stringify({ titleText: nav2 && nav2.titleText, titleOverflow: nav2 && nav2.titleOverflow, overlap: nav2 && nav2.overlap, hostSlotChildren: nav2 && nav2.hostSlotChildren }));
    ok(nav2 && /房 \d+/.test(nav2.titleText), '建房后标题带房号（' + (nav2 ? nav2.titleText : '采集失败') + '）');
    ok(nav2 && nav2.overlap === false, '建房后标题不与返回按钮重叠');
    ok(nav2 && nav2.titleOverflow === false, '建房后标题未截断溢出');
    await shotTo(join(SHOTS, name + '-room-nav.png'));
    console.log('  截图 → ' + join(SHOTS, name + '-room-nav.png'));
  } else {
    console.log('  （未找到创建按钮，跳过建房段）');
  }
}

await probeApp('/chess', 'chess', true);
await probeApp('/gomoku', 'gomoku', true);

console.log('\n' + '='.repeat(52));
console.log('结果：通过 ' + pass + '，失败 ' + fail);
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
process.exit(fail ? 1 : 0);
