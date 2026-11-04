// 桌面性能改动验证探针（2026-11-02）
//  T1 图标走 120px 变体（DPR2）
//  T2 滑页期间 data-dragging=1 且玻璃实际平化；松手后恢复
//  T3 滑页仍然正常翻页（手势功能没被破坏）
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const CDP_PORT = 9359;
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
  `--user-data-dir=${join(tmpdir(), 'ci-desktop-perf-' + Date.now())}`,
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

const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
// headless 默认 prefers-reduced-motion: reduce → 会把毛玻璃钉成 flat（老坑），显式放开
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('token',${JSON.stringify(token)});localStorage.removeItem('motion_enabled');}catch(e){}` });
await send('Page.navigate', { url: 'http://127.0.0.1:9001/' });
for (let i = 0; i < 120; i++) { await sleep(250); if (await evalJS(`!!document.querySelector('.desktop-pages .app-icon') && !document.getElementById('app-loading')`)) break; }
// 兜底解除 reduce 残留标记，强制重算一次玻璃
await evalJS(`(function(){ var r=document.documentElement; r.removeAttribute('data-no-motion'); r.removeAttribute('data-glass'); return true; })()`);
await sleep(1200);

// T1 图标：桌面 + Dock 全走 120 变体
const iconAudit = await evalJS(`(function(){
  var imgs = Array.prototype.slice.call(document.querySelectorAll('.desktop-pages .app-icon img, .dock-bar img'));
  var png = imgs.filter(function(i){ return /\\.png(\\?|$)/i.test(i.src); });
  var thumbs = png.filter(function(i){ return i.src.indexOf('/icons/120/') !== -1; });
  return { total: png.length, thumbs: thumbs.length, sample: (png[0]||{}).src || '' };
})()`);
rec('T1 官方 PNG 图标走 120px 变体', iconAudit.total > 0 && iconAudit.thumbs === iconAudit.total, `${iconAudit.thumbs}/${iconAudit.total} 个，例：${String(iconAudit.sample).split('/').slice(-2).join('/')}`);

// 玻璃采样点：dock-bar / 公告浮窗 上是否有 backdrop-filter
const glassBefore = await evalJS(`(function(){
  function bf(el){ if(!el) return 'no-el'; var cs=getComputedStyle(el); return (cs.webkitBackdropFilter||cs.backdropFilter||'none'); }
  return { dock: bf(document.querySelector('.dock-bar')), island: bf(document.querySelector('.island')) };
})()`);

// T2 滑页拖拽：手指压下，横向拖 260px（不松手）——期间应 data-dragging=1 且玻璃 none
// 同时给 Desktop 组件的 _render 打点：直写 DOM 方案下拖拽期间不应产生逐帧重渲染
await evalJS(`(function(){
  var el = document.querySelector('.desktop');
  var vm = el && el.__vue__;
  if (!vm || !vm._render) return false;
  window.__renderCount = 0;
  if (!vm.__renderPatched) {
    var orig = vm._render;
    window.__renderStacks = [];
    vm._render = function(){ window.__renderCount++; window.__renderStacks.push(new Error().stack.split('
').slice(2,5).join(' <- ')); return orig.apply(this, arguments); };
    vm.__renderPatched = true;
  }
  window.__renderCount = 0;
  return true;
})()`);
// 先量 2s 空闲基线：桌面本底就有定时器（公告轮播/角标等）会触发重渲染，
// 拖拽的增量必须接近 0，否则说明还是响应式路径在起作用
await evalJS('window.__renderCount = 0; true');
await sleep(2000);
const idleRenders = await evalJS('window.__renderCount');
await evalJS('window.__renderCount = 0; true');
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 700, y: 360 }] });
for (const dx of [-40, -90, -140, -190, -240, -260]) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 700 + dx, y: 360 }] });
  await sleep(30);
}
await sleep(200);
const mid = await evalJS(`(function(){
  function bf(el){ if(!el) return 'no-el'; var cs=getComputedStyle(el); return (cs.webkitBackdropFilter||cs.backdropFilter||'none'); }
  var pages = document.querySelector('.desktop-pages');
  var dot = document.querySelector('.page-indicator .page-dot--active');
  return {
    attr: document.documentElement.getAttribute('data-dragging'),
    paging: document.documentElement.getAttribute('data-paging'),
    dock: bf(document.querySelector('.dock-bar')),
    island: bf(document.querySelector('.island')),
    transform: pages ? pages.style.transform : '',
    transition: pages ? getComputedStyle(pages).transition : '',
    dotTransform: dot ? dot.style.transform : '',
    // Vue 的 style 绑定在拖拽期间应保持「稳定页位置」，不应出现 calc 外的重渲染痕迹
    draggingClassGone: pages ? !pages.classList.contains('desktop-pages--dragging') : false
  };
})()`);
rec('T2a 拖拽中挂 data-dragging', mid.attr === '1', `attr=${mid.attr}, paging=${mid.paging}`);
rec('T2b 拖拽中玻璃已平化', mid.dock === 'none' && mid.island === 'none', `dock=${mid.dock}, island=${mid.island}（拖拽前 dock=${glassBefore.dock}）`);
rec('T2c 拖拽中 transform 由手势直写（含像素位移）', /calc\(/i.test(mid.transform), String(mid.transform).slice(0, 72));
rec('T2f 拖拽中容器过渡已关闭', /none|0s/.test(mid.transition || ''), `transition=${String(mid.transition).slice(0, 60)}`);
rec('T2d 页码指示器跟手（直写 DOM）', /translateX|scaleX/.test(mid.dotTransform), String(mid.dotTransform).slice(0, 48));
const rendersDuringDrag = await evalJS('window.__renderCount');
const stacks = await evalJS('window.__renderStacks || []');
if (stacks && stacks.length) { console.log('  [traces]'); stacks.forEach((x,i)=>console.log('   '+i+': '+x)); }
rec('T2e 拖拽不引入额外重渲染（对照空闲基线）', typeof rendersDuringDrag === 'number' && rendersDuringDrag <= idleRenders,
  `拖拽 ${rendersDuringDrag} 次 vs 空闲 2s 基线 ${idleRenders} 次`);

// 松手（位移已超 1/3 页宽 → 应翻页）
const pageBefore = await evalJS(`window.__ciPage === undefined ? (window.__ciPage = document.querySelector('.desktop-page-indicator .active, .desktop-page-indicator .dot.active') ? 1 : 0) : 0`);
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(900);
const after = await evalJS(`(function(){
  function bf(el){ if(!el) return 'no-el'; var cs=getComputedStyle(el); return (cs.webkitBackdropFilter||cs.backdropFilter||'none'); }
  var pages = document.querySelector('.desktop-pages');
  var dot = document.querySelector('.page-indicator .page-dot--active');
  return {
    attr: document.documentElement.getAttribute('data-dragging'),
    paging: document.documentElement.getAttribute('data-paging'),
    dock: bf(document.querySelector('.dock-bar')),
    island: bf(document.querySelector('.island')),
    offset: pages ? pages.style.transform : '',
    dotTransform: dot ? dot.style.transform : ''
  };
})()`);
rec('T3a 松手后 data-dragging 清除', after.attr === null, `attr=${after.attr}`);
rec('T3b 松手后玻璃恢复', after.dock !== 'none' || glassBefore.dock === 'none', `dock=${after.dock}（拖拽前 ${glassBefore.dock}）`);
rec('T3c 翻页生效', /-100%/.test(after.offset || ''), 'desktop-pages transform=' + String(after.offset).slice(0, 60));
rec('T3d 松手后内联位移收敛为整页', /translateX\(-100%\)/.test((after.offset || '').replace(/\s/g, '')), String(after.offset).slice(0, 48));
rec('T3e 指示器跟手样式已清除', !after.dotTransform, `dot="${after.dotTransform}"`);

console.log('\n=== 结果 ===');
const pass = results.filter(r => r.ok).length;
console.log(`${pass}/${results.length} 通过`);
chrome.kill();
process.exit(pass === results.length ? 0 : 1);
