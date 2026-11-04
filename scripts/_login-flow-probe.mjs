// 登录流探针：清 token 的干净浏览器 → 走真实登录表单 → 进入桌面
// 断言「无需刷新」：第三方应用图标与自定义壁纸在首次进入桌面时就出现。
//
// 用法：node scripts/_login-flow-probe.mjs [http://127.0.0.1:9401]
// 前置：隔离实例已启动（DB_PATH 指向 ci-login-probe/probe.db，PORT=9401，WS_PORT=10021）
//       scripts/_login-probe-setup.cjs 已跑过（账号 251899 / ProbePass123，壁纸 ci-probe-wallpaper.jpg）
//
// 断言清单：
//   P. 登录前基线：无 token、壁纸 default、桌面无市场图标
//   1. 提交登录后 token 出现且路由进入 Desktop
//   2. 整个过程没有整页刷新（bootId 不变）——即修复的是 SPA 内登录路径
//   3. 壁纸水合为 ci-probe-wallpaper.jpg（store + DOM 背景）
//   4. 主题水合为 dark
//   5. 市场应用（chess/gomoku/pet）进入桌面布局 + Desktop 实例 dockApps
//   6. 市场图标真的渲染到网格 DOM 中（必要时切到图标所在页）
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = process.argv[2] || 'http://127.0.0.1:9401';
const CDP_PORT = 9343;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;
const WS_PORT = 10021;
const ACCOUNT = '251899';
const PASSWORD = 'ProbePass123';
const WALLPAPER = 'ci-probe-wallpaper.jpg';
const ACCOUNT_B = '251898';
const WALLPAPER_B = 'ci-probe-wallpaper-b.jpg';
const ADMIN = '251897';
const MARKET_APPS = ['chess', 'gomoku', 'pet'];
const PROFILE = join(tmpdir(), 'ci-login-probe', 'chrome-profile');

rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE}`,
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
// 只注入 WS 端口覆盖 + 每次文档加载生成新 bootId（用于证明「没有整页刷新」）
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    window.__WS_PORT__ = ${WS_PORT};
    window.__probeBootId = 'boot-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }catch(e){}`
});

const store = `document.querySelector('#app').__vue__.$store`;
const deskVm = `(function(){
  var root = document.querySelector('#app').__vue__; var d = null;
  (function walk(list){ (list || []).forEach(function(v){ if (!d && typeof v.launchApp === 'function') d = v; if (v.$children) walk(v.$children); }); })(root.$children);
  return d;
})()`;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? '✓ ' : '✗ ') + name + (detail !== undefined ? ` —— ${detail}` : ''));
  ok ? pass++ : fail++;
}
async function waitFor(name, expr, timeoutMs = 15000, interval = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await evalJS(expr);
    if (v && !v.__err) return { ok: true, value: v };
    await sleep(interval);
  }
  return { ok: false, value: null, name };
}

console.log('加载', APP + '/login ...');
await send('Page.navigate', { url: APP + '/login' });

const formReady = await waitFor('login form', `!!(document.querySelector('.login-form') && document.querySelector('#app').__vue__ && document.querySelector('#app').__vue__.$store)`, 30000);
if (!formReady.ok) { console.error('✗ 30s 内登录页未就绪'); process.exit(1); }
// 开屏动画盖在页面之上（#app-loading），未移除前鼠标事件会命中 .al-boot
const splashGone = await waitFor('splash', `!document.getElementById('app-loading')`, 15000, 200);
check('0.1 开屏动画已退场（可交互）', splashGone.ok);
await sleep(600);

// ===== P. 登录前基线 =====
const baseline = await evalJS(`(function(){
  var s = ${store};
  return {
    token: s.state.auth.token || '',
    wallpaper: s.state.settings.wallpaper,
    theme: s.state.settings.theme,
    appIcons: document.querySelectorAll('.desktop-grid .app-icon').length,
    bootId: window.__probeBootId || ''
  };
})()`);
check('P1 干净环境无 token', baseline.token === '', JSON.stringify(baseline.token));
check('P2 登录前壁纸为 default（未水合）', baseline.wallpaper === 'default', baseline.wallpaper);
check('P3 登录前桌面未挂载（无网格图标）', baseline.appIcons === 0, 'icons=' + baseline.appIcons);
// 主题不参与断言：App.vue mounted 恒以本地优先落地（无历史偏好时默认 dark），
// 服务端 theme 只在 localStorage 无值时才采纳 —— 常规流程下必被本地覆盖，无法用来证明水合。
const bootBefore = baseline.bootId;

// ===== 真实填写表单并提交 =====
const filled = await evalJS(`(function(){
  var inputs = document.querySelectorAll('.login-form .form-input');
  if (inputs.length < 2) return 'no-inputs';
  var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(inputs[0], ${JSON.stringify(ACCOUNT)});
  inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  setter.call(inputs[1], ${JSON.stringify(PASSWORD)});
  inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  return inputs[0].value + '|' + inputs[1].value;
})()`);
check('1.0 表单已填入账号密码', filled === ACCOUNT + '|' + PASSWORD, String(filled));

const btnPos = await evalJS(`(function(){
  var b = document.querySelector('.login-form button.btn-primary');
  if (!b) return null;
  var r = b.getBoundingClientRect();
  var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  var hit = document.elementFromPoint(x, y);
  return { x: x, y: y, disabled: b.disabled, hit: hit ? (hit.className || hit.tagName) : null };
})()`);
check('1.1 找到登录按钮且可点击', !!btnPos && btnPos.disabled === false, JSON.stringify(btnPos));
if (btnPos) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btnPos.x, y: btnPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btnPos.x, y: btnPos.y, button: 'left', clickCount: 1 });
}

// ===== 1. 登录成功 + 进入桌面（注意：全程不再 Page.navigate）=====
const tokenGot = await waitFor('token', `(${store}.state.auth.token || '') || ''`, 20000);
check('1.2 登录成功（token 写入 store）', tokenGot.ok, tokenGot.ok ? 'token 已就绪' : '20s 无 token');
if (!tokenGot.ok) {
  // 失败诊断：登录组件内部字段 / 本地存储 / 真实发生过的 auth 请求 / 当前路由
  const dbg = await evalJS(`(function(){
    var root = document.querySelector('#app').__vue__; var login = null;
    (function walk(list){ (list || []).forEach(function(v){ if (!login && typeof v.handleLogin === 'function') login = v; if (v.$children) walk(v.$children); }); })(root.$children);
    var res = performance.getEntriesByType('resource').filter(function(e){ return e.name.indexOf('/api/auth') !== -1; })
      .map(function(e){ return { url: e.name.replace(location.origin, ''), status: e.responseStatus, ms: Math.round(e.duration) }; });
    return {
      vm: login ? { account: login.account, password: login.password, loading: login.loading, errorMsg: login.errorMsg } : null,
      token: localStorage.getItem('token'),
      requests: res,
      path: root.$route && root.$route.path
    };
  })()`);
  console.log('  诊断：', JSON.stringify(dbg));
}
const errorMsg = await evalJS(`(function(){ var el = document.querySelector('.error-text'); return el ? el.textContent.trim() : ''; })()`);
if (errorMsg) console.log('  登录页错误提示：', errorMsg);

const desktopReady = await waitFor('desktop', `!!(${store}.state.desktop.layout)`, 30000, 400);
check('1.3 进入桌面（layout 就绪，未刷新页面）', desktopReady.ok);
const routeNow = await evalJS(`(function(){
  var root = document.querySelector('#app').__vue__;
  return (root.$route && root.$route.name) || '';
})()`);
check('1.4 路由为 Desktop', routeNow === 'Desktop' || routeNow === 'desktop', String(routeNow));

// ===== 2. 没有整页刷新：bootId 不变 =====
const bootAfter = await evalJS(`window.__probeBootId || ''`);
check('2.1 全程无整页刷新（bootId 不变）', !!bootAfter && bootAfter === bootBefore, `${bootBefore} → ${bootAfter}`);

// ===== 3. 壁纸水合 =====
const wpStore = await waitFor('wallpaper', `(${store}.state.settings.wallpaper) === ${JSON.stringify(WALLPAPER)} ? ${JSON.stringify(WALLPAPER)} : ''`, 15000);
check('3.1 壁纸水合为服务端值（store）', wpStore.ok, String(await evalJS(`${store}.state.settings.wallpaper`)));
const wpDom = await evalJS(`(function(){
  var el = document.querySelector('.desktop-static-wallpaper');
  if (!el) return '';
  return el.style.backgroundImage || getComputedStyle(el).backgroundImage || '';
})()`);
check('3.2 桌面壁纸 DOM 指向探针壁纸', typeof wpDom === 'string' && wpDom.indexOf(WALLPAPER) !== -1, String(wpDom).slice(0, 120));

// ===== 4. （主题不参与断言，见 P 段说明） =====

// ===== 5. 市场应用进入布局 + dockApps =====
const layoutNames = await evalJS(`(function(){
  var layout = ${store}.state.desktop.layout || {};
  var names = [];
  (layout.pages || []).forEach(function(p){ (p.slots || []).forEach(function(x){ if (x && x.type === 'app') names.push(x.name); }); });
  (layout.dock || []).forEach(function(n){ if (n) names.push(n); });
  var folders = layout.folders || {};
  Object.keys(folders).forEach(function(k){ ((folders[k] || {}).apps || []).forEach(function(n){ names.push(n); }); });
  return names;
})()`);
const layoutHas = Array.isArray(layoutNames) ? MARKET_APPS.filter(n => layoutNames.indexOf(n) !== -1) : [];
check('5.1 市场应用进入桌面布局', layoutHas.length === MARKET_APPS.length, `${JSON.stringify(layoutHas)} ⊂ ${JSON.stringify(layoutNames)}`);

const dockMarket = await waitFor('dockApps', `(function(){
  var d = ${deskVm};
  if (!d || !d.dockApps) return '';
  var hit = d.dockApps.filter(function(a){ return a && a.market === true; }).map(function(a){ return a.name; });
  return hit.length ? hit.join(',') : '';
})()`, 15000);
check('5.2 Desktop 实例 dockApps 含市场条目（market:true）', dockMarket.ok, String(dockMarket.value));

// ===== 6. 市场图标真的渲染到网格 DOM =====
const pageOfApp = await evalJS(`(function(){
  var layout = ${store}.state.desktop.layout || {};
  var mine = ${JSON.stringify(MARKET_APPS)};
  var pages = layout.pages || [];
  for (var pi = 0; pi < pages.length; pi++) {
    var slots = pages[pi].slots || [];
    for (var si = 0; si < slots.length; si++) {
      var s = slots[si];
      if (s && s.type === 'app' && mine.indexOf(s.name) !== -1) return { page: pi, name: s.name };
    }
  }
  return null;
})()`);
check('6.0 布局中找到市场图标所在页', !!pageOfApp, JSON.stringify(pageOfApp));
if (pageOfApp) {
  await evalJS(`${store}.commit('desktop/SET_CURRENT_PAGE', ${pageOfApp.page})`);
  const iconsDom = await waitFor('dom icon', `(function(){
    var el = document.querySelector('.desktop-grid .app-icon[data-src-app="' + ${JSON.stringify(pageOfApp.name)} + '"]');
    if (!el) return '';
    var img = el.querySelector('img');
    return (el.getAttribute('data-src-app') || '') + '|' + (img ? img.getAttribute('src') : '');
  })()`, 10000);
  check('6.1 市场图标渲染在网格 DOM 中', iconsDom.ok && String(iconsDom.value).indexOf(pageOfApp.name) !== -1, String(iconsDom.value));
} else {
  check('6.1 市场图标渲染在网格 DOM 中', false, '无所在页');
}

// ===== 7. 回归：管理端启停应用的 WS 实时同步（eventKey 去重不吞事件）=====
// 复用同一份桌面会话：管理端通过 HTTP 改 app_control，客户端应经 WS 收到并重放同步链。
const appInLayoutExpr = name => `(function(){
  var layout = ${store}.state.desktop.layout || {};
  var names = [];
  (layout.pages || []).forEach(function(p){ (p.slots || []).forEach(function(x){ if (x && x.type === 'app') names.push(x.name); }); });
  (layout.dock || []).forEach(function(n){ if (n) names.push(n); });
  var folders = layout.folders || {};
  Object.keys(folders).forEach(function(k){ ((folders[k] || {}).apps || []).forEach(function(n){ names.push(n); }); });
  return names.indexOf(${JSON.stringify(name)}) !== -1 ? 'yes' : '';
})()`;

let adminToken = '';
try {
  const r = await fetch(APP + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: ADMIN, password: PASSWORD })
  });
  const j = await r.json();
  adminToken = (j.data && j.data.token) || '';
} catch (e) { adminToken = ''; }
check('7.0 管理员探针账号可登录', !!adminToken);

async function setAppEnabled(name, enabled) {
  const r = await fetch(APP + '/api/admin/app-control/' + name, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
    body: JSON.stringify({ enabled: enabled })
  });
  return r.status;
}

const bootIdBeforeToggle = await evalJS(`window.__probeBootId`);
const preOn = await setAppEnabled('pet', true);
const preOnOk = await waitFor('pet on', appInLayoutExpr('pet'), 20000);
check('7.1 前置：pet 在布局中', preOn === 200 && preOnOk.ok, 'status=' + preOn);
const offStatus = await setAppEnabled('pet', false);
const petGone = await waitFor('pet off', `(function(){
  var layout = ${store}.state.desktop.layout || {};
  var names = [];
  (layout.pages || []).forEach(function(p){ (p.slots || []).forEach(function(x){ if (x && x.type === 'app') names.push(x.name); }); });
  (layout.dock || []).forEach(function(n){ if (n) names.push(n); });
  var folders = layout.folders || {};
  Object.keys(folders).forEach(function(k){ ((folders[k] || {}).apps || []).forEach(function(n){ names.push(n); }); });
  return names.indexOf('pet') === -1 ? 'gone' : '';
})()`, 20000);
check('7.2 管理端停用后 pet 从布局消失（WS 实时）', offStatus === 200 && petGone.ok, 'status=' + offStatus);
const bootIdAfterToggle = await evalJS(`window.__probeBootId`);
check('7.3 实时同步过程无整页刷新', bootIdAfterToggle === bootIdBeforeToggle, `${bootIdBeforeToggle} → ${bootIdAfterToggle}`);
const onStatus = await setAppEnabled('pet', true);
const petBack = await waitFor('pet re-on', appInLayoutExpr('pet'), 20000);
check('7.4 重新启用后 pet 回到布局（同数据事件不被去重吞掉）', onStatus === 200 && petBack.ok, 'status=' + onStatus);

// ===== 8. 回归：已登录刷新进入桌面（boot 原路径不受影响）=====
const bootIdPreReload = await evalJS(`window.__probeBootId`);
await sleep(1200); // 让 7.x 的启停同步落定，避免与重载抢同一条 XHR/WS
await send('Page.reload');
const refreshReady = await waitFor('refresh', `!!(${store}.state.desktop.layout) && !!(${store}.state.auth.token)`, 40000, 400);
check('8.1 已登录刷新后进入桌面（token 从 localStorage 恢复）', refreshReady.ok);
const bootIdPostReload = await evalJS(`window.__probeBootId`);
check('8.2 确认发生了整页重载（bootId 变化）', !!bootIdPostReload && bootIdPostReload !== bootIdPreReload);
const refreshWp = await waitFor('refresh wallpaper', `(${store}.state.settings.wallpaper) === ${JSON.stringify(WALLPAPER)} ? 'ok' : ''`, 20000);
check('8.3 刷新后壁纸仍为服务端值', refreshWp.ok);
const refreshApps = await waitFor('refresh apps', appInLayoutExpr('gomoku'), 20000);
check('8.4 刷新后市场应用仍在布局', refreshApps.ok);
// 刷新会重新走开屏动画：必须等它退场，否则后续鼠标事件会被 #app-loading 吃掉
const splashGone2 = await waitFor('splash 2', `!document.getElementById('app-loading')`, 15000, 200);
check('8.5 刷新后开屏动画已退场（可交互）', splashGone2.ok);

// ===== 9. 回归：登出后登录另一账号（重放按新账号的服务端设置生效）=====
await evalJS(`(function(){ ${store}.dispatch('auth/logout'); return 'ok'; })()`);
const loggedOut = await waitFor('logout', `(${store}.state.auth.token || '') === '' ? 'out' : ''`, 10000);
check('9.1 登出后 token 清空', loggedOut.ok);
await evalJS(`(function(){ document.querySelector('#app').__vue__.$router.push('/login').catch(function(){}); return 'ok'; })()`);
const loginBack = await waitFor('login page', `!!document.querySelector('.login-form')`, 15000);
check('9.2 回到登录页', loginBack.ok);
await sleep(900); // 等路由过渡/入场动画结束，避免点击落在动画层上
const filledB = await evalJS(`(function(){
  var inputs = document.querySelectorAll('.login-form .form-input');
  if (inputs.length < 2) return '';
  var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(inputs[0], ${JSON.stringify(ACCOUNT_B)});
  inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  setter.call(inputs[1], ${JSON.stringify(PASSWORD)});
  inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  return inputs[0].value + '|' + inputs[1].value;
})()`);
check('9.3 账号 B 表单已填入', filledB === ACCOUNT_B + '|' + PASSWORD, String(filledB));
const btnB = await evalJS(`(function(){
  var b = document.querySelector('.login-form button.btn-primary');
  if (!b) return null;
  var r = b.getBoundingClientRect();
  var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  var hit = document.elementFromPoint(x, y);
  return {
    x: x, y: y, disabled: b.disabled,
    formW: Math.round(document.querySelector('.login-form').getBoundingClientRect().width),
    hit: hit ? (hit.className || hit.tagName) : null
  };
})()`);
check('9.3b 账号 B 登录按钮命中可点击元素', !!btnB && btnB.disabled === false && btnB.formW > 0, JSON.stringify(btnB));
if (btnB) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btnB.x, y: btnB.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btnB.x, y: btnB.y, button: 'left', clickCount: 1 });
}
const tokenB = await waitFor('token B', `(${store}.state.auth.token || '') || ''`, 20000);
check('9.4 账号 B 登录成功', tokenB.ok);
if (!tokenB.ok) {
  const dbgB = await evalJS(`(function(){
    var root = document.querySelector('#app').__vue__; var login = null;
    (function walk(list){ (list || []).forEach(function(v){ if (!login && typeof v.handleLogin === 'function') login = v; if (v.$children) walk(v.$children); }); })(root.$children);
    var res = performance.getEntriesByType('resource').filter(function(e){ return e.name.indexOf('/api/auth') !== -1; })
      .map(function(e){ return { url: e.name.replace(location.origin, ''), status: e.responseStatus, ms: Math.round(e.duration) }; });
    var err = document.querySelector('.error-text');
    return {
      vm: login ? { account: login.account, password: login.password, loading: login.loading, errorMsg: login.errorMsg } : null,
      token: localStorage.getItem('token'),
      requests: res,
      path: root.$route && root.$route.path,
      errText: err ? err.textContent.trim() : ''
    };
  })()`);
  console.log('  诊断B：', JSON.stringify(dbgB));
}
const desktopB = await waitFor('desktop B', `!!(${store}.state.desktop.layout)`, 30000, 400);
const wpB = await waitFor('wallpaper B', `(${store}.state.settings.wallpaper) === ${JSON.stringify(WALLPAPER_B)} ? 'ok' : ''`, 20000);
check('9.5 换账号登录后壁纸切换为 B 的服务端值（重放按新账号生效）', desktopB.ok && wpB.ok, String(await evalJS(`${store}.state.settings.wallpaper`)));
const appsB = await waitFor('apps B', appInLayoutExpr('gomoku'), 20000);
check('9.6 换账号登录后市场应用仍在布局', appsB.ok);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
ws.close();
process.exit(fail > 0 ? 1 : 0);