// 桌面 PC 适配探针：右键菜单 / 滚轮翻页 / 方向键 / Esc 层级 —— CDP 派发真实鼠标键盘事件
//
// 用法：node scripts/_desktop-pc-probe.mjs
// 前置：classintra-server 已在 127.0.0.1:9001 运行；client/dist 为本次构建产物。
//
// 断言清单：
//   A. 右键空白 → 菜单出现（含"桌面设置"项）→ 点击后 settingsPanelOpen=true → Esc 关面板
//   B. 右键图标 → 菜单含"打开"项 → Esc 关菜单
//   C. 滚轮下翻/上翻一页（含 350ms 冷却）
//   D. ArrowRight 翻页；编辑态 Esc 退出
//   E. widget 上滚轮不翻页（排除区生效；mutation 临时造 widget，测完清理）
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = process.argv[2] || 'http://127.0.0.1:9001';
const CDP_PORT = 9342;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;
const BLANK_X = 500, BLANK_Y = 650;  // pages 容器与页码指示器之间的空带
const WHEEL_X = 520, WHEEL_Y = 380;  // 网格区中部

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }
const token = jwt.sign({ user_id: '999999', is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-pc-probe-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
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
  if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
// headless 强制 reduced-motion（已知怪癖），覆写为允许动画
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}`
});

console.log('加载', APP + '/ ...');
await send('Page.navigate', { url: APP + '/' });
let storeOk = false;
for (let i = 0; i < 120; i++) {
  await sleep(250);
  storeOk = await evalJS(`!!(document.querySelector('#app') && document.querySelector('#app').__vue__ && document.querySelector('#app').__vue__.$store.state.desktop.layout)`);
  if (storeOk) break;
}
if (!storeOk) { console.error('✗ 30s 内桌面未就绪'); process.exit(1); }
console.log('✓ 桌面就绪');
await sleep(1500);

const store = `document.querySelector('#app').__vue__.$store`;
const deskVm = `(function(){
  var root = document.querySelector('#app').__vue__; var d = null;
  (function walk(list){ (list || []).forEach(function(v){ if (!d && typeof v.launchApp === 'function') d = v; if (v.$children) walk(v.$children); }); })(root.$children);
  return d;
})()`;
const getState = async () => evalJS(`(function(){
  var s = ${store};
  return { page: s.state.desktop.currentPage, total: s.getters['desktop/totalPages'],
           editing: s.state.desktop.isEditMode, panel: s.state.desktop.settingsPanelOpen };
})()`);

// CDP 右键
async function rightClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
}
async function wheel(x, y, deltaY) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
}
async function pressKey(key, code, vk) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? '✓ ' : '✗ ') + name + (detail !== undefined ? ` —— ${detail}` : ''));
  ok ? pass++ : fail++;
}
const menuVisible = () => evalJS(`!!document.querySelector('.desktop-ctx-menu')`);
const menuLabels = () => evalJS(`(function(){
  var list = document.querySelectorAll('.desktop-ctx-menu .ctx-item .ctx-label');
  var out = []; for (var i = 0; i < list.length; i++) out.push(list[i].textContent.trim());
  return out;
})()`);
// 真实鼠标左键点击菜单项（程序化 el.click() 不会产生前置 mousedown，测不出"mousedown 先关菜单"竞态）
async function clickMenuItem(label) {
  const pos = await evalJS(`(function(){
    var list = document.querySelectorAll('.desktop-ctx-menu .ctx-item');
    for (var i = 0; i < list.length; i++) {
      var t = list[i].querySelector('.ctx-label');
      if (t && t.textContent.trim() === ${JSON.stringify(label)}) {
        var r = list[i].getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }
    }
    return null;
  })()`);
  if (!pos) return false;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  return true;
}

await evalJS(`${store}.commit('desktop/SET_CURRENT_PAGE', 0)`);
await sleep(300);

// ===== A. 右键空白菜单 =====
await rightClick(BLANK_X, BLANK_Y);
await sleep(300);
let labels = await menuLabels();
check('A1 右键空白出现菜单（编辑/整理/设置）', await menuVisible() && labels.length === 3, JSON.stringify(labels));
const opened = await clickMenuItem('桌面设置');
await sleep(400);
let st = await getState();
check('A2 点击"桌面设置"打开设置面板（PC 唯一入口）', opened === true && st.panel === true);
// A4 桌宠退场（面板打开期间检查：uiOverlayBusy → ci-pet-suppressed → overlay display:none）
const petState = await evalJS(`(function(){
  var el = document.querySelector('.ci-pet');
  if (!el) return 'no-pet';
  return getComputedStyle(el).display === 'none';
})()`);
check('A4 设置面板打开时桌宠隐藏', petState === true, String(petState));
await pressKey('Escape', 'Escape', 27);
await sleep(300);
st = await getState();
check('A3 Esc 关闭设置面板', st.panel === false);


// ===== B. 右键图标 =====
const iconPos = await evalJS(`(function(){
  var el = document.querySelector('.desktop-grid .app-icon');
  if (!el) return null;
  var r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
check('B0 找到网格图标', !!iconPos, JSON.stringify(iconPos));
if (iconPos) {
  await rightClick(iconPos.x, iconPos.y);
  await sleep(300);
  labels = await menuLabels();
  check('B1 右键图标出现菜单（打开/移除）', await menuVisible() && labels.length === 2 && labels.indexOf('打开') !== -1, JSON.stringify(labels));
  await pressKey('Escape', 'Escape', 27);
  await sleep(200);
  check('B2 Esc 关闭右键菜单', !(await menuVisible()));
}

// ===== B2. 图标标签开关 =====
await evalJS(`${store}.commit('settings/SET_SHOW_ICON_LABELS', true)`);
await sleep(300);
const hasLabel = await evalJS(`!!document.querySelector('.desktop-grid .app-icon-label')`);
check('B3 开关开启后网格出现图标标签', hasLabel);
await evalJS(`${store}.commit('settings/SET_SHOW_ICON_LABELS', false)`);
await sleep(300);
const noLabel = await evalJS(`!document.querySelector('.desktop-grid .app-icon-label')`);
check('B4 开关关闭后标签消失', noLabel);
await evalJS(`${store}.commit('settings/SET_SHOW_ICON_LABELS', true)`);
await sleep(200);

// ===== B5. 图标尺寸三档 =====
// 先把鼠标移离图标：hover 轻抬 scale(1.06) 会污染 getBoundingClientRect
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
await sleep(200);
await evalJS(`${store}.commit('settings/SET_ICON_SIZE', 'large')`);
await sleep(300);
const wLarge = await evalJS(`(function(){
  var el = document.querySelector('.desktop-grid .app-icon-img-wrap');
  return el ? Math.round(el.getBoundingClientRect().width) : null;
})()`);
check('B5 图标大小 large 生效（68px）', wLarge === 68, String(wLarge));
await evalJS(`${store}.commit('settings/SET_ICON_SIZE', 'standard')`);
await sleep(300);
const wStd = await evalJS(`(function(){
  var el = document.querySelector('.desktop-grid .app-icon-img-wrap');
  return el ? Math.round(el.getBoundingClientRect().width) : null;
})()`);
check('B6 恢复标准档（60px）', wStd === 60, String(wStd));

// ===== C. 滚轮翻页 =====
st = await getState();
await evalJS(`${store}.commit('desktop/SET_CURRENT_PAGE', 0)`);
await sleep(400);
await wheel(WHEEL_X, WHEEL_Y, 240);
await wheel(WHEEL_X, WHEEL_Y, 240);
await sleep(500);
st = await getState();
check('C1 滚轮下翻一页', st.page === 1, `page=${st.page}`);
await wheel(WHEEL_X, WHEEL_Y, -240);
await sleep(500);
st = await getState();
check('C2 滚轮上翻回第 0 页', st.page === 0, `page=${st.page}`);

// ===== D. 键盘 =====
await pressKey('ArrowRight', 'ArrowRight', 39);
await sleep(400);
st = await getState();
check('D1 ArrowRight 翻到下一页', st.page === 1, `page=${st.page}`);
await pressKey('ArrowLeft', 'ArrowLeft', 37);
await sleep(400);
st = await getState();
check('D2 ArrowLeft 翻回上一页', st.page === 0, `page=${st.page}`);
await evalJS(`${store}.dispatch('desktop/enterEditMode')`);
await sleep(200);
await pressKey('Escape', 'Escape', 27);
await sleep(300);
st = await getState();
check('D3 编辑态 Esc 退出', st.editing === false, `editing=${st.editing}`);

// ===== E. widget 滚轮排除 =====
await evalJS(`${store}.commit('desktop/ADD_WIDGET', { pageId: 'page-0', widget: { id: 'pc-probe-w', type: 'countdown', slot: 0, w: 2, h: 2, config: {} } })`);
await sleep(400);
const wPos = await evalJS(`(function(){
  var el = document.querySelector('.desktop-widget');
  if (!el) return null;
  var r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
if (wPos) {
  await wheel(wPos.x, wPos.y, 240);
  await sleep(400);
  st = await getState();
  check('E1 widget 上滚轮不翻页', st.page === 0, `page=${st.page}`);
} else {
  check('E1 widget 上滚轮不翻页', false, 'widget 未渲染');
}
await evalJS(`${store}.commit('desktop/REMOVE_WIDGET', { pageId: 'page-0', widgetId: 'pc-probe-w' })`);
await sleep(200);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
ws.close();
process.exit(fail > 0 ? 1 : 0);
