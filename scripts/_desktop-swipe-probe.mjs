// 桌面交互探针：跟手翻页 / 回弹 / 边缘阻尼 / 返回收缩动画 —— CDP 派发真实触摸手势验证
//
// 用法：node scripts/_desktop-swipe-probe.mjs
// 前置：classintra-server 已在 127.0.0.1:9001 运行；client/dist 为本次构建产物。
// 复用 perf-desktop-probe.mjs 的自签 token + 独立 headless Chrome 方案。
//
// 断言清单：
//   A. 横滑跟手：拖动中 .desktop-pages transform 出现像素偏移 + dragging 类生效，松手翻页
//   B. 短慢滑回弹：40px 慢滑（低于 1/3 页宽、低于 fling 速度）→ 停留原页
//   C. 右滑翻回上一页
//   D. 首页右滑边缘阻尼：400px 原始位移被阻尼后不越界、不翻页
//   E. 返回收缩动画：图标打开应用 → 返回桌面 → .desktop 根元素出现 WAAPI 动画
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = process.argv[2] || 'http://127.0.0.1:9001';
const CDP_PORT = 9337;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;   // 校园平板横屏
const SWIPE_Y = 380;         // 网格区中部（top 60 ~ bottom 170 之间）
const SWIPE_X = 520;

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }
const token = jwt.sign(
  { user_id: '999999', is_admin: 1, is_class_admin: 1, role: 'admin' },
  SECRET, { expiresIn: '1h' }
);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-swipe-probe-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  // 关闭 Windows 触摸历史导航（真机安卓无此手势，桌面 Chrome 会把右滑当历史返回）
  '--disable-features=HistoricalSwipeNav,OverscrollHistoryNavigation',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
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
const evalJS = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    return { __err: (d.exception && d.exception.description) || d.text || 'evaluate 异常' };
  }
  return r.result.value;
};
// 页面侧 JS 异常收集（诊断用，退出时汇总）
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__errs = [];
    window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
    window.addEventListener('unhandledrejection', function(e){ window.__errs.push('rejection: ' + String(e.reason)); });`
});

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
// headless Chrome 强制上报 prefers-reduced-motion: reduce（已知怪癖），覆写为允许动画
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}`
});

console.log('加载', APP + '/ ...');
await send('Page.navigate', { url: APP + '/' });

// 等桌面 store 可用
let storeOk = false;
for (let i = 0; i < 120; i++) {
  await sleep(250);
  storeOk = await evalJS(`!!(document.querySelector('#app') && document.querySelector('#app').__vue__ && document.querySelector('#app').__vue__.$store.state.desktop.layout)`);
  if (storeOk) break;
}
if (!storeOk) { console.error('✗ 30s 内桌面未就绪（可能停在登录页）'); process.exit(1); }
console.log('✓ 桌面就绪');
await sleep(1500);  // 等首屏懒加载结算

const store = `document.querySelector('#app').__vue__.$store`;
const getState = async () => {
  const expr = `(function(){
    try {
      var s = ${store};
      return { page: s.state.desktop.currentPage, total: s.getters['desktop/totalPages'],
               editing: s.state.desktop.isEditMode, folder: s.state.desktop.openFolderId,
               panel: s.state.desktop.settingsPanelOpen };
    } catch (e) { return { __err: String(e && e.message || e) }; }
  })()`;
  let v = await evalJS(expr);
  if (v && v.__err) {
    console.log('  [诊断] store 读取异常:', v.__err, '| location:', await evalJS('location.href'));
    await sleep(600);
    v = await evalJS(expr);
  }
  return v;
};
const getTransform = () => evalJS(`(function(){
  var el = document.querySelector('.desktop-pages');
  return el ? { style: el.style.transform, dragging: el.className.indexOf('desktop-pages--dragging') !== -1 } : null;
})()`);

// CDP 触摸滑动：steps 个触点逐步位移，每步间隔 stepSleep ms
async function swipe(fromX, fromY, dx, steps, stepSleep) {
  const step = dx / steps;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: fromY }] });
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(fromX + step * i), y: fromY }]
    });
    if (stepSleep) await sleep(stepSleep);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ` —— ${detail}` : ''));
  ok ? pass++ : fail++;
}

// 保证有两页（单页无法翻页）
let st = await getState();
if (st.total < 2) {
  await evalJS(`${store}.commit('desktop/ADD_PAGE')`);
  await sleep(300);
  st = await getState();
}
console.log(`页面数=${st.total}，起始页=${st.page}`);

// ===== A. 横滑跟手 + 翻页 =====
await evalJS(`${store}.commit('desktop/SET_CURRENT_PAGE', 0)`);
await sleep(400);
const t0 = await getTransform();
if (t0.dragging) check('A0 起始无 dragging 类', false, JSON.stringify(t0));

let sawFollow = false, sawClass = false, sawIndicatorLive = false;
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: SWIPE_X, y: SWIPE_Y }] });
for (let i = 1; i <= 14; i++) {
  await send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: SWIPE_X - 30 * i, y: SWIPE_Y }]
  });
  if (i === 5 || i === 10) {
    await sleep(60);  // 等 rAF 合帧写入
    const mid = await getTransform();
    if (mid && /calc\(/.test(mid.style) && /px/.test(mid.style)) sawFollow = true;
    if (mid && mid.dragging) sawClass = true;
    // 指示器联动：拖动中 active 点应有 inline transform（朝目标点位移+拉伸）
    if (!sawIndicatorLive) {
      sawIndicatorLive = await evalJS(`(function(){
        var d = document.querySelector('.page-dot--active');
        return !!(d && d.style && d.style.transform && d.style.transform.indexOf('translateX') !== -1);
      })()`);
    }
  }
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(700);
st = await getState();
const tEnd = await getTransform();
const indicatorReset = await evalJS(`(function(){
  var d = document.querySelector('.page-dot--active');
  return !(d && d.style && d.style.transform);
})()`);
check('A1 拖动中跟手偏移（calc px）', sawFollow, JSON.stringify(t0));
check('A2 拖动中 dragging 类生效', sawClass);
check('A5 拖动中指示器联动（inline transform）', sawIndicatorLive);
check('A6 松手后指示器复位', indicatorReset);
check('A3 松手翻到下一页', st.page === 1, `page=${st.page}`);
check('A4 松手后偏移复位（无 calc）', tEnd && !/calc\(/.test(tEnd.style), tEnd && tEnd.style);

// ===== B. 短慢滑回弹（不达 1/3 页宽、不达 fling 速度）=====
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: SWIPE_X, y: SWIPE_Y }] });
for (let i = 1; i <= 8; i++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: SWIPE_X - 5 * i, y: SWIPE_Y }] });
  await sleep(30);
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(700);
st = await getState();
check('B1 短慢滑停留原页', st.page === 1, `page=${st.page}`);

// ===== C. 右滑翻回上一页（420px，超过 1/3 页宽）=====
await swipe(SWIPE_X, SWIPE_Y, 420, 12, 0);
await sleep(700);
st = await getState();
check('C1 右滑翻回上一页', st.page === 0, `page=${st.page}`);

// ===== D. 首页右滑边缘阻尼（400px 原始位移被 ×0.35 阻尼后不翻页）=====
await swipe(SWIPE_X, SWIPE_Y, 400, 12, 0);
await sleep(700);
st = await getState();
check('D1 首页右滑不越界', st.page === 0, `page=${st.page}`);
const dMid = await getTransform();
check('D2 松手后无残留偏移', dMid && !/calc\(/.test(dMid.style), dMid && dMid.style);

// ===== E. 返回收缩动画 =====
// 打开设置应用：走 Desktop vm 的 launchApp（与真实点击同链路 → captureOrigin 捕获图标 rect）
const clicked = await evalJS(`(function(){
  var root = document.querySelector('#app').__vue__;
  var desk = null;
  (function walk(list){ (list || []).forEach(function(v){ if (!desk && typeof v.launchApp === 'function') desk = v; if (v.$children) walk(v.$children); }); })(root.$children);
  if (!desk) return 'no-vm';
  var meta = ${store}.getters['desktop/appByName']('settings');
  if (!meta) return 'no-meta';
  var el = document.querySelector('.desktop-grid .app-icon') || document.querySelector('.dock-slot .app-icon');
  if (!el) return 'no-icon';
  desk.launchApp(meta, el);
  return 'ok';
})()`);
check('E0 通过 launchApp 打开设置', clicked === 'ok', String(clicked));
let inApp = false;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  inApp = await evalJS(`location.pathname !== '/' && !!document.querySelector('.nav-back')`);
  if (inApp) break;
}
check('E1 应用已打开（出现返回按钮）', inApp, await evalJS('location.pathname'));
if (inApp) {
  await sleep(600);  // 等打开动画结束，避免 getAnimations 混入打开动画
  await evalJS(`document.querySelector('.nav-back').click()`);
  let sawCollapse = false;
  for (let i = 0; i < 30; i++) {
    await sleep(50);
    // 动画目标是 ErrorBoundary 根（.error-boundary-wrap，与打开动画同一目标），
    // 排除 CSSTransition（路由 page-fade）只认 JS 创建的 WAAPI Animation
    sawCollapse = await evalJS(`(function(){
      var el = document.querySelector('.error-boundary-wrap') || document.querySelector('.desktop');
      if (!el || !el.getAnimations) return false;
      return el.getAnimations().some(function(a){ return a instanceof CSSTransition === false && a.playState === 'running'; });
    })()`);
    if (sawCollapse) break;
  }
  check('E2 返回桌面播放收缩 WAAPI 动画', sawCollapse);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
const errs = await evalJS('(window.__errs || []).slice(0, 5)');
if (errs && errs.length) console.log('页面侧错误（前 5 条）:', JSON.stringify(errs));
ws.close();
process.exit(fail > 0 ? 1 : 0);
