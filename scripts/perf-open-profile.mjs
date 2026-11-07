// 冷打开慢帧归因：定位「打开应用」窗口里 167ms 整块阻塞到底是谁。
//
// 配套 scripts/perf-interaction-probe.mjs（那台量帧指标，这台归因）。
// 原理：Long Animation Frames API（LoAF）拉出打开窗口内每个 >50ms 慢帧，
// 帧内 scripts[] 直接给出阻塞函数的 文件:行号 / 耗时 / 强制布局时长，
// 归因比 sampling profiler 直接。
//
// 注意：平板 Chrome 80 没有 LoAF —— 归因在桌面 Chrome 做，修复效果
// 用 perf-interaction-probe.mjs --attach 在平板上验收。
//
// 用法：node scripts/perf-open-profile.mjs [user_id]
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
const CDP_PORT = 9338;
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
  `--user-data-dir=${join(tmpdir(), 'ci-open-profile-profile')}`,
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
const evalJS = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}
    window.__lt = [];
    try {
      new PerformanceObserver(function(l){
        l.getEntries().forEach(function(e){ window.__lt.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); });
      }).observe({ entryTypes: ['longtask'] });
    } catch (e) {}
  `
});

console.log('加载', APP + '/ ...');
await send('Page.navigate', { url: APP + '/' });
for (let i = 0; i < 120; i++) {
  await sleep(250);
  const ok = await evalJS('!!(document.querySelector("[class*=\'desktop\'],[class*=\'dock\'],.app-grid") && document.querySelector(".app-icon"))');
  if (ok) break;
}
await sleep(2500);   // 静置结算，打开窗口从干净状态开始

const icon = await evalJS(`(function(){
  var els = document.querySelectorAll('.app-icon');
  for (var i = 0; i < els.length; i++) {
    var r = els[i].getBoundingClientRect();
    if (r.width > 8 && r.height > 8 && r.left >= 0 && r.top >= 0) {
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    }
  }
  return 'null';
})()`);
if (!icon) { console.error('✗ 桌面上没有可见图标'); process.exit(1); }
const pt = JSON.parse(icon);
console.log(`目标图标: (${pt.x}, ${pt.y})`);

// ===== 采样窗口：记录点击时刻 → 打开结算完 → 拉 LoAF 帧归因 =====
const t0 = await evalJS(`(function(){
  window.__loaf = [];
  try {
    new PerformanceObserver(function(l){
      l.getEntries().forEach(function(e){
        window.__loaf.push({
          at: Math.round(e.startTime), ms: Math.round(e.duration),
          styleLayoutMs: Math.round(e.forcedStyleAndLayoutDuration || 0),
          scripts: (e.scripts || []).map(function(s){
            return { fn: s.sourceFunctionName || '(anonymous)', url: (s.sourceURL || '').split('/').slice(-2).join('/'),
                     line: s.sourceLineNumber >= 0 ? s.sourceLineNumber + 1 : -1, ms: Math.round(s.duration),
                     styleLayoutMs: Math.round(s.forcedStyleAndLayoutDuration || 0) };
          })
        });
      });
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) {}
  window.__t0 = performance.now();
  return Math.round(window.__t0);
})()`);
console.log('点击时刻 t0 =', t0 + 'ms');

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
await sleep(3000);

const loaf = await evalJS(`(function(){
  var rows = (window.__loaf || []).filter(function(e){ return e.at >= window.__t0 - 50; });
  return JSON.stringify(rows);
})()`);
const longTasks = await evalJS('window.__lt');
const frames = loaf ? JSON.parse(loaf) : [];

console.log(`\n=== 打开窗口内慢帧（LoAF，共 ${frames.length} 个）===`);
for (const f of frames) {
  const rel = f.at - t0;
  console.log(`\n  ▸ 帧 @+${rel}ms 持续 ${f.ms}ms（强制布局 ${f.styleLayoutMs}ms）`);
  const scripts = f.scripts.slice().sort((a, b) => b.ms - a.ms).slice(0, 6);
  if (scripts.length === 0) console.log('      （无脚本归因 → 栅格化/解码/GPU 侧）');
  for (const s of scripts) {
    console.log(`      ${String(s.ms + 'ms').padEnd(8)} ${s.fn}  ${s.url}:${s.line}${s.styleLayoutMs ? '  [强制布局 ' + s.styleLayoutMs + 'ms]' : ''}`);
  }
}

console.log('\n=== 窗口内 longtask ===');
const ltWin = (longTasks || []).filter(t => t.at >= t0 - 50);
console.log(ltWin.length ? ltWin.map(t => `  @+${t.at - t0}ms  ${t.ms}ms`).join('\n') : '  无');

// 保存原始数据供深入分析
mkdirSync(join(REPO, 'logs', 'perf'), { recursive: true });
const outPath = join(REPO, 'logs', 'perf', 'open-profile-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.json');
writeFileSync(outPath, JSON.stringify({ t0, frames, longTasks: ltWin }, null, 1));
console.log('\n原始数据 → ' + outPath);

ws.close();
chrome.kill();
