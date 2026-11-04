// 交互延迟体检（6x CPU）：按下 → 首次视觉变化（DOM 变更 + 下一帧）耗时，以及长任务。
// 覆盖：点图标开应用 / 返回桌面 / 长按进编辑态 / 点 Dock / 点超能岛 / 右键菜单
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const CDP_PORT = Number(process.argv[2] || 9427);
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
  `--user-data-dir=${join(tmpdir(), 'ci-ilat-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'], { stdio: 'ignore' });
const getJSON = async p => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
let page = null;
for (let i = 0; i < 60; i++) { try { const l = await getJSON('/json/list'); page = l.find(t => t.type === 'page'); if (page) break; } catch {} await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
const evalJS = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('token',${JSON.stringify(token)});}catch(e){}
    window.__lt=[]; window.__muts=[];
    try { new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ window.__lt.push(Math.round(e.duration)); }); }).observe({ entryTypes: ['longtask'] }); } catch(e) {}
    (function(){
      var mo = new MutationObserver(function(list){
        window.__muts.push({ t: Math.round(performance.now()), n: list.length });
      });
      document.addEventListener('DOMContentLoaded', function(){ mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true }); });
    })();`
});
await send('Page.navigate', { url: 'http://127.0.0.1:9001/' });
for (let i = 0; i < 160; i++) { await sleep(300); if (await evalJS(`!!document.querySelector('.desktop-pages .app-icon') && !document.getElementById('app-loading')`)) break; }
await sleep(2500);
await send('Emulation.setCPUThrottlingRate', { rate: 6 });

// 量一次交互：返回 {反馈ms, 首帧ms, 长任务}
async function measure(label, action) {
  await evalJS(`(function(){ window.__muts = []; window.__lt = []; window.__t0 = performance.now(); return true; })()`);
  await action();
  await sleep(900);
  const r = await evalJS(`(function(){
    var t0 = window.__t0;
    var first = window.__muts.length ? window.__muts[0].t : null;
    var lt = window.__lt.slice();
    return {
      feedback: first == null ? null : Math.round(first - t0),
      ltTotal: lt.reduce(function(a,b){ return a+b; }, 0),
      ltMax: lt.length ? Math.max.apply(null, lt) : 0
    };
  })()`);
  console.log(`  ${label}: 首帧反馈 ${r.feedback == null ? '无 DOM 变更' : r.feedback + 'ms'} | 长任务 ${r.ltTotal}ms（max ${r.ltMax}ms）`);
  return r;
}

async function tapAt(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function longPressAt(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(700);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function centerOf(expr) {
  return await evalJS(`(function(){
    var el = ${expr};
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
}

console.log('\n=== 交互延迟（6x CPU）===');
const island0 = await centerOf(`document.querySelector('.island')`);
if (island0) {
  await measure('点超能岛展开', () => tapAt(island0.x, island0.y));
  await sleep(600);
  await measure('再点超能岛收起', () => tapAt(island0.x, island0.y));
  await sleep(600);
}
const icon = await centerOf(`document.querySelector('.desktop-pages .app-icon img[src*="Weather" i]') && document.querySelector('.desktop-pages .app-icon img[src*="Weather" i]').closest('.app-icon')`);
if (icon) await measure('点图标开应用（预取开启）', () => tapAt(icon.x, icon.y));
await sleep(1500);
// 返回桌面：点左上返回（应用导航栏）
const back = await centerOf(`document.querySelector('.nav-left, .app-nav-bar .nav-back, .ios-nav-bar button')`);
if (back) await measure('返回桌面', () => tapAt(back.x, back.y));
await sleep(1200);
if (icon) await measure('长按图标进编辑态', () => longPressAt(icon.x, icon.y));
await measure('点空白退出编辑态', () => tapAt(300, 470));
await sleep(600);
if (!(await evalJS(`!!document.querySelector('.desktop-pages')`))) { await send('Page.navigate', { url: 'http://127.0.0.1:9001/' }); await sleep(3000); }
const dock = await centerOf(`document.querySelector('.dock-bar img') && document.querySelector('.dock-bar img').closest('div')`);
if (dock) await measure('点 Dock 图标', () => tapAt(dock.x, dock.y));
await sleep(1500);
const island = await centerOf(`document.querySelector('.island')`);
if (island) {
  await measure('点超能岛展开', () => tapAt(island.x, island.y));
  await sleep(500);
  await measure('再点超能岛收起', () => tapAt(island.x, island.y));
  await sleep(800);
} else {
  console.log('  超能岛: 当前路由无 .island，跳过');
}
await measure('右键空白弹菜单', async () => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 470, button: 'right', buttons: 2, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 300, y: 470, button: 'right', buttons: 0, clickCount: 1 });
});
chrome.kill(); process.exit(0);
