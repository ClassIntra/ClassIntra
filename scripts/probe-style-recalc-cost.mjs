// 量化 data-scrolling 通配符降级的样式重算成本（6x CPU）
// 对比：A 现有实现（[data-scrolling] * 通配 backdrop-filter:none）
//       B 令牌重定义（只改 :root 的 --glass-blur-*）
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const CDP_PORT = 9379;
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
  `--user-data-dir=${join(tmpdir(), 'ci-recalc-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'], { stdio: 'ignore' });
async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
let page = null;
for (let i = 0; i < 60; i++) { try { const l = await getJSON('/json/list'); page = l.find(t => t.type === 'page'); if (page) break; } catch {} await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
const evalJS = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('token',${JSON.stringify(token)});localStorage.setItem('ci_prefetch','off');}catch(e){}` });
await send('Page.navigate', { url: 'http://127.0.0.1:9001/' });
for (let i = 0; i < 160; i++) { await sleep(300); if (await evalJS(`!!document.querySelector('.desktop-pages .app-icon') && !document.getElementById('app-loading')`)) break; }
await sleep(2000);
await send('Emulation.setCPUThrottlingRate', { rate: 6 });

const m0 = await send('Performance.getMetrics');
const metric = (arr, name) => { const f = arr.metrics.find(x => x.name === name); return f ? f.value : 0; };

// A：现有实现 —— 反复挂/摘 data-scrolling（每次都会触发全量匹配）
const a = await evalJS(`(function(){
  var root = document.documentElement, t0 = performance.now();
  for (var i = 0; i < 20; i++) {
    root.setAttribute('data-scrolling', '1');
    void document.body.offsetHeight;      // 强制样式重算
    root.removeAttribute('data-scrolling');
    void document.body.offsetHeight;
  }
  return Math.round(performance.now() - t0);
})()`);
const m1 = await send('Performance.getMetrics');

// B：令牌重定义 —— 只改 :root 上的自定义属性
const b = await evalJS(`(function(){
  var root = document.documentElement, t0 = performance.now();
  var props = ['--glass-blur-ultra-thin','--glass-blur-thin','--glass-blur-regular','--glass-blur-thick','--glass-blur-container','--glass-blur-overlay','--glass-blur-active'];
  var saved = {};
  for (var i = 0; i < 20; i++) {
    props.forEach(function(p){ root.style.setProperty(p, 'none'); });
    void document.body.offsetHeight;
    props.forEach(function(p){ root.style.removeProperty(p); });
    void document.body.offsetHeight;
  }
  return Math.round(performance.now() - t0);
})()`);
const m2 = await send('Performance.getMetrics');

const nodes = await evalJS('document.querySelectorAll("*").length');
console.log(`元素总数: ${nodes}`);
console.log(`A 通配符降级：20 轮挂/摘 = ${a}ms（每轮 ${(a / 20).toFixed(1)}ms，单次切换 ${(a / 40).toFixed(1)}ms）`);
console.log(`B 令牌重定义：20 轮挂/摘 = ${b}ms（每轮 ${(b / 20).toFixed(1)}ms，单次切换 ${(b / 40).toFixed(1)}ms）`);
console.log(`RecalcStyle 增量：A ${((metric(m1, 'RecalcStyleDuration') - metric(m0, 'RecalcStyleDuration')) * 1000).toFixed(0)}ms / B ${((metric(m2, 'RecalcStyleDuration') - metric(m1, 'RecalcStyleDuration')) * 1000).toFixed(0)}ms`);
chrome.kill(); process.exit(0);
