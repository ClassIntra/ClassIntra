// 滚动体检：在指定页面做 3 秒匀速滚动，统计主线程长任务 / 帧数 / DOM 规模。
// 用法：node scripts/probe-scroll-jank.mjs /community
//        node scripts/probe-scroll-jank.mjs /resource
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const PATH = process.argv[2] || '/community';
const CDP_PORT = Number(process.argv[3] || 9381);
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
  `--user-data-dir=${join(tmpdir(), 'ci-scroll-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'], { stdio: 'ignore' });
async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
let page = null;
for (let i = 0; i < 60; i++) { try { const l = await getJSON('/json/list'); page = l.find(t => t.type === 'page'); if (page) break; } catch {} await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map(); const errors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception || {}).description || 'exc');
};
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
const evalJS = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('token',${JSON.stringify(token)});localStorage.setItem('ci_prefetch','off');}catch(e){}
    window.__lt = [];
    try { new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ window.__lt.push(Math.round(e.duration)); }); }).observe({ entryTypes: ['longtask'] }); } catch(e) {}`
});
await send('Page.navigate', { url: 'http://127.0.0.1:9001' + PATH });
await sleep(4500);
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
await sleep(800);

if (process.env.NOCOVER === '1') {
  await evalJS(`(function(){
    var vm = document.querySelector('.community-page') && document.querySelector('.community-page').__vue__;
    if (vm && vm.textCoverUrl) vm.textCoverUrl = function(){ return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; };
    return !!vm;
  })()`);
  await sleep(400);
}
const setup = await evalJS(`(function(){
  var best = null;
  var all = document.querySelectorAll('div, section, main');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.scrollHeight - el.clientHeight > 300 && el.clientHeight > 300) {
      if (!best || el.scrollHeight > best.scrollHeight) best = el;
    }
  }
  window.__scroller = best;
  window.__lt = [];
  return {
    domNodes: document.querySelectorAll('*').length,
    scrollHeight: best ? best.scrollHeight : 0,
    clientHeight: best ? best.clientHeight : 0,
    cls: best ? String(best.className).slice(0, 60) : '(无滚动容器)'
  };
})()`);
console.log(`页面 ${PATH}：DOM ${setup.domNodes} 节点 | 滚动容器 .${setup.cls} ${setup.scrollHeight}/${setup.clientHeight}`);

const run = await evalJS(`new Promise(function(resolve){
  var el = window.__scroller;
  if (!el) return resolve({ error: 'no-scroller' });
  var frames = 0, start = performance.now(), last = start, maxGap = 0, gaps = [];
  window.__lt = [];
  function tick(){
    var now = performance.now();
    var gap = now - last; last = now;
    if (frames > 2) { gaps.push(gap); if (gap > maxGap) maxGap = gap; }
    el.scrollTop += 36;
    frames++;
    if (now - start < 3000) requestAnimationFrame(tick); else resolve({
      frames: frames, ms: Math.round(now - start), maxGap: Math.round(maxGap),
      p95Gap: Math.round(gaps.sort(function(a,b){return a-b;})[Math.floor(gaps.length * 0.95)] || 0),
      scrolled: Math.round(el.scrollTop),
      longTasks: window.__lt.slice()
    });
  }
  requestAnimationFrame(tick);
})`);
const vmInfo = await evalJS(`(function(){
  var el = document.querySelector('.community-page');
  var vm = el && el.__vue__;
  if (!vm) return null;
  return { coverTick: vm.coverTick, deferred: Object.keys(vm._deferCovers || {}).length, posts: (vm.$store.state.community.posts || []).length };
})()`);
const lt = run.longTasks || [];
console.log(`  滚动 3s：${run.frames} 帧 / ${run.ms}ms（≈${Math.round(run.frames / (run.ms / 1000))}fps）| 帧间隔 p95 ${run.p95Gap}ms / max ${run.maxGap}ms`);
console.log(`  长任务 ${lt.length} 个，合计 ${lt.reduce((a, b) => a + b, 0)}ms${lt.length ? '，最大 ' + Math.max.apply(null, lt) + 'ms' : ''}`);
if (vmInfo) console.log('  组件状态: coverTick=' + vmInfo.coverTick + ' 待生成=' + vmInfo.deferred + ' store 帖子=' + vmInfo.posts);
if (errors.length) console.log('  页面异常:', errors.slice(0, 2).join(' | ').slice(0, 200));
chrome.kill(); process.exit(0);
