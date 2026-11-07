// 冷打开渲染侧追踪：把打开窗口的整块阻塞拆成 解码/栅格/样式/布局/绘制 各占多少。
//
// 配套 perf-open-profile.mjs：那台已证实 169ms 慢帧里 JS 只占 ~21ms，
// 剩下 ~148ms 是渲染侧 —— 本探针用 CDP Tracing（devtools.timeline）按事件名聚合。
//
// 用法：node scripts/perf-open-trace.mjs [user_id]
// 前置：CI 已在 127.0.0.1:9001 运行；server/.env 内有 JWT_SECRET。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const USER_ID = process.argv[2] || '999999';
const TARGET_APP = process.argv[3] || '';   // 指定应用名对比：node perf-open-trace.mjs 999999 calendar
const CDP_PORT = 9339;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }
const isAdmin = USER_ID === '999999' ? 1 : 0;
const token = jwt.sign(
  { user_id: USER_ID, is_admin: isAdmin, is_class_admin: isAdmin, role: isAdmin ? 'admin' : 'user' },
  SECRET, { expiresIn: '1h' }
);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-open-trace-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
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
const traceEvents = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Tracing.dataCollected') {
    for (const e of (m.params.value || [])) traceEvents.push(e);
    return;
  }
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}`
});

console.log('加载', APP + '/ ...');
await send('Page.navigate', { url: APP + '/' });
for (let i = 0; i < 120; i++) {
  await sleep(250);
  const ok = await evalJS('!!(document.querySelector("[class*=\'desktop\'],[class*=\'dock\'],.app-grid") && document.querySelector(".app-icon"))');
  if (ok) break;
}
await sleep(2500);

const iconInfo = await evalJS(`(function(){
  var app = ${JSON.stringify(TARGET_APP)};
  var els = app ? document.querySelectorAll('.app-icon[data-src-app="' + app + '"]')
                : document.querySelectorAll('.app-icon');
  for (var i = 0; i < els.length; i++) {
    var r = els[i].getBoundingClientRect();
    if (r.width > 8 && r.height > 8 && r.left >= 0 && r.top >= 0) {
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
        app: els[i].getAttribute('data-src-app') || '' });
    }
  }
  return 'null';
})()`);
if (!iconInfo) { console.error('✗ 桌面上没有可见图标' + (TARGET_APP ? '（找不到 ' + TARGET_APP + '）' : '')); process.exit(1); }
const pt = JSON.parse(iconInfo);
console.log(`目标图标: (${pt.x}, ${pt.y})  app=${pt.app}`);

// ===== 追踪窗口 =====
await send('Tracing.start', { categories: 'devtools.timeline,v8.execute,disabled_by_default-devtools.timeline.gpu', options: 'sampling-frequency=1000' });
const t0ms = await evalJS('Math.round(performance.now())');

await evalJS('console.timeStamp("CI_OPEN")');
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
await sleep(3000);

const opened = await evalJS('location.pathname + location.hash');
await send('Tracing.end');
await sleep(800);   // 等 Tracing.dataCollected 流式事件到齐（tracingComplete 是事件不是命令）

// ===== 分析：点击后 800ms 窗口内按事件名聚合 =====
// renderer trace ts 是 µs，与 performance.now()*1000 同源（有微小偏移可接受）
const t0us = 0;   // 用相对法：先找窗口内所有事件的时间范围
const events = traceEvents.filter(e => e.pid && e.ph === 'X' && e.dur);
console.log('\n打开后路由:', opened);

// 双口径聚合：打开窗口（点击后 900ms）+ 整场导航，对比看打开窗口独占的量
function aggregate(list) {
  const m = new Map();
  for (const e of list) {
    const dur = e.dur;  // µs
    if (dur < 3000) continue;   // 只看 ≥3ms 的事件
    if (!m.has(e.name)) m.set(e.name, { total: 0, n: 0, top: [] });
    const v = m.get(e.name);
    v.total += dur; v.n++;
    v.top.push({ at: Math.round(e.ts / 1000), ms: Math.round(dur / 100) / 10,
      detail: e.args && (e.args.data || e.args.beginData) ? JSON.stringify(e.args.data || e.args.beginData).slice(0, 110) : '' });
  }
  return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
}
// 点击锚点：console.timeStamp('CI_OPEN') 会写进 devtools.timeline 的
// TimeStamp 事件 —— 与 trace 时钟同源，是对齐点击时刻的唯一可靠办法
const stamps = traceEvents.filter(e => e.name === 'TimeStamp' &&
  e.args && e.args.data && e.args.data.message === 'CI_OPEN');
const clickTsMs = stamps.length ? Math.round(stamps[stamps.length - 1].ts / 1000) : null;
const winEvents = clickTsMs !== null
  ? events.filter(e => e.ts / 1000 >= clickTsMs - 30 && e.ts / 1000 <= clickTsMs + 900)
  : [];
console.log(`[对齐诊断] performance.now t0=${t0ms}ms  trace锚点=${clickTsMs}ms  窗口内≥3ms事件=${winEvents.length}`);
const rankedWin = aggregate(winEvents);
const rankedAll = aggregate(events);

console.log(`\n=== 打开窗口（点击后 900ms）≥3ms 事件聚合 · app=${pt.app} ===`);
for (const [name, v] of rankedWin.slice(0, 14)) {
  console.log(`  ${name.padEnd(26)} ${String((v.total / 1000).toFixed(0) + 'ms').padEnd(8)} ×${v.n}`);
}
console.log('\n=== 整场导航聚合（对照，含 boot）===');
for (const [name, v] of rankedAll.slice(0, 10)) {
  console.log(`  ${name.padEnd(26)} ${String((v.total / 1000).toFixed(0) + 'ms').padEnd(8)} ×${v.n}`);
}
console.log('\n=== 重点事件明细（打开窗口，解码/布局/样式/绘制/栅格）===');
const FOCUS = ['DecodeImage', 'ImageDecodeTask', 'DecodeImageOnMainThread', 'PaintImage', 'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'RasterTask', 'CompositeLayers'];
for (const [name, v] of rankedWin) {
  if (FOCUS.indexOf(name) === -1) continue;
  console.log(`\n  ▸ ${name}（总 ${(v.total / 1000).toFixed(0)}ms ×${v.n}）`);
  v.top.sort((a, b) => b.ms - a.ms).slice(0, 5).forEach(t => console.log(`      @${t.at}ms ${t.ms}ms  ${t.detail}`));
}

mkdirSync(join(REPO, 'logs', 'perf'), { recursive: true });
const outPath = join(REPO, 'logs', 'perf', 'open-trace-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.json');
writeFileSync(outPath, JSON.stringify({ opened, events: events.filter(e => e.dur >= 1000) }, null, 1));
console.log('\n原始 trace → ' + outPath);

ws.close();
chrome.kill();
