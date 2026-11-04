// 桌面主线程归因分析：6x CPU 下录一段 Profile（空闲 / 滑页拖拽 / 打开应用），
// 输出 self-time Top 函数与样式/布局耗时。用于决定下一批优化点。
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const CDP_PORT = 9361;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: '999999', is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-profile-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'], { stdio: 'ignore' });
async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
let page = null;
for (let i = 0; i < 60; i++) { try { const l = await getJSON('/json/list'); page = l.find(t => t.type === 'page'); if (page) break; } catch {} await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const events = [];
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method) events.push(m); };
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
const evalJS = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable'); await send('Runtime.enable'); await send('Profiler.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('token',${JSON.stringify(token)});localStorage.setItem('ci_prefetch','off');}catch(e){}` });
await send('Page.navigate', { url: 'http://127.0.0.1:9001/' });
for (let i = 0; i < 120; i++) { await sleep(250); if (await evalJS(`!!document.querySelector('.desktop-pages .app-icon') && !document.getElementById('app-loading')`)) break; }
await sleep(1500);
await send('Emulation.setCPUThrottlingRate', { rate: 6 });

const m0 = await send('Performance.getMetrics');
await send('Profiler.start');

// 场景 1：空闲 2s
await sleep(2000);
// 场景 2：滑页拖拽（手指按住左右拖 1.5s）
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 700, y: 360 }] });
for (let i = 0; i < 15; i++) {
  const x = 700 + Math.round(Math.sin(i / 2) * 120);
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 360 }] });
  await sleep(100);
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(600);
// 场景 3：点开音乐 → 返回桌面
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 637, y: 180, button: 'left', buttons: 1, clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 637, y: 180, button: 'left', buttons: 0, clickCount: 1 });
await sleep(2500);
await evalJS(`history.back(); true`);
await sleep(1500);

const { profile } = await send('Profiler.stop');
const m1 = await send('Performance.getMetrics');
const metric = (arr, name) => { const f = arr.metrics.find(x => x.name === name); return f ? f.value : 0; };
const delta = {};
for (const k of ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration', 'JSHeapUsedSize']) {
  delta[k] = +(metric(m1, k) - metric(m0, k)).toFixed(3);
}
console.log('\n=== 主线程耗时（6x CPU，约 8s 采样）===');
console.log(`  Script ${delta.ScriptDuration}s | Layout ${delta.LayoutDuration}s | RecalcStyle ${delta.RecalcStyleDuration}s | Task ${delta.TaskDuration}s`);

// 聚合 self time
const byId = new Map();
for (const n of profile.nodes) byId.set(n.id, n);
const selfTime = new Map(); // id -> us
const interval = profile.endTime - profile.startTime;
const samples = profile.samples || [];
const deltas = profile.timeDeltas || [];
for (let i = 0; i < samples.length; i++) {
  const dt = deltas[i] || 0;
  selfTime.set(samples[i], (selfTime.get(samples[i]) || 0) + dt);
}
const rows = [];
for (const [id, us] of selfTime) {
  const n = byId.get(id);
  if (!n) continue;
  const cf = n.callFrame || {};
  rows.push({ us, fn: cf.functionName || '(anon)', url: (cf.url || '').split('/').pop().split('?')[0], line: cf.lineNumber });
}
rows.sort((a, b) => b.us - a.us);
console.log('\n=== Self time Top 18 ===');
const total = rows.reduce((a, b) => a + b.us, 0);
rows.slice(0, 18).forEach(r => {
  const pct = total ? (r.us / total * 100).toFixed(1) : '0';
  console.log(`  ${String(Math.round(r.us / 1000)).padStart(5)}ms ${String(pct).padStart(5)}%  ${r.fn || '(anon)'}  @ ${r.url || 'native'}:${r.line || ''}`);
});
// 按 URL 聚合
const byUrl = new Map();
rows.forEach(r => byUrl.set(r.url || 'native', (byUrl.get(r.url || 'native') || 0) + r.us));
console.log('\n=== 按脚本聚合 ===');
[...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([u, us]) => {
  console.log(`  ${String(Math.round(us / 1000)).padStart(5)}ms  ${u}`);
});
chrome.kill(); process.exit(0);
