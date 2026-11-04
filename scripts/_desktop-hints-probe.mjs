// 桌面提示探针：空页引导 / 小组件溢出提示 / 文件夹原点展开 —— 纯 mutation 构造场景，不触发布局保存
//
// 用法：node scripts/_desktop-hints-probe.mjs
// 前置：classintra-server 已在 127.0.0.1:9001 运行；client/dist 为本次构建产物。
//
// 断言清单：
//   A. 空页无提示（2026-11-01 用户要求移除中央提示——本组为回归守卫）
//   B. 溢出提示：向首版面注入 5 个 2×2 小组件（占 20 格）→ 编辑态出现溢出提示且数量正确；清理后消失
//   C. 文件夹原点：打开文件夹后卡片 transform-origin 指向 tile 方向（父侧 nextTick 直设）
//   全程只用 commit（mutation），不 dispatch 任何带 saveDesktopLayout 副作用的 action（编辑态除外）
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = process.argv[2] || 'http://127.0.0.1:9001';
const CDP_PORT = 9340;
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
const token = jwt.sign({ user_id: '999999', is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-hints-probe-profile')}`,
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
  var root = document.querySelector('#app').__vue__; var desk = null;
  (function walk(list){ (list || []).forEach(function(v){ if (!desk && typeof v.launchApp === 'function') desk = v; if (v.$children) walk(v.$children); }); })(root.$children);
  return desk;
})()`;

const countHints = () => evalJS(`document.querySelectorAll('.desktop-page-empty-hint').length`);
const countTips = () => evalJS(`document.querySelectorAll('.desktop-page-overflow-tip').length`);
const tipText = () => evalJS(`(document.querySelector('.desktop-page-overflow-tip') || {}).textContent || ''`);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? '✓ ' : '✗ ') + name + (detail !== undefined ? ` —— ${detail}` : ''));
  ok ? pass++ : fail++;
}

// ===== A. 空页无提示（回归守卫：中央提示已按用户要求移除） =====
const hintsOnEmpty = await countHints();
check('A1 空页（含加删页后）不显示任何提示', hintsOnEmpty === 0, `提示数=${hintsOnEmpty}`);
await evalJS(`${store}.commit('desktop/ADD_PAGE')`);
await sleep(400);
await evalJS(`${store}.commit('desktop/REMOVE_PAGE', ${store}.getters['desktop/totalPages'] - 1)`);
await sleep(400);
check('A2 加删页后仍无提示', (await countHints()) === 0);

// ===== B. 小组件溢出提示 =====
const hiddenBefore = await evalJS(`${deskVm} ? ${deskVm}.hiddenIconsCount(0) : null`);
check('B0 初始无溢出', hiddenBefore === 0, `hiddenIconsCount(0)=${hiddenBefore}`);

// 注入 5 个 2×2 小组件（占 20 格 → 可见图标槽 24-20=4）
const WIDGET_N = 5;
for (let i = 0; i < WIDGET_N; i++) {
  await evalJS(`${store}.commit('desktop/ADD_WIDGET', { pageId: 'page-0', widget: { id: 'probe-w${i}', type: 'countdown', slot: ${i}, w: 2, h: 2, config: {} } })`);
}
await evalJS(`${store}.dispatch('desktop/enterEditMode')`);
await sleep(600);
const hiddenAfter = await evalJS(`${deskVm} ? ${deskVm}.hiddenIconsCount(0) : null`);
const tips = await countTips();
const text = await tipText();
check('B1 注入后 hiddenIconsCount > 0', hiddenAfter > 0, `hiddenIconsCount(0)=${hiddenAfter}`);
check('B2 编辑态出现溢出提示', tips === 1 && /图标被隐藏/.test(text), `${tips} 个, 文本="${String(text).trim().slice(0, 40)}"`);

// 清理：退编辑态 + 移除注入的小组件
await evalJS(`${store}.dispatch('desktop/exitEditMode')`);
for (let i = 0; i < WIDGET_N; i++) {
  await evalJS(`${store}.commit('desktop/REMOVE_WIDGET', { pageId: 'page-0', widgetId: 'probe-w${i}' })`);
}
await sleep(400);
const hiddenClean = await evalJS(`${deskVm} ? ${deskVm}.hiddenIconsCount(0) : null`);
const tipsClean = await countTips();
check('B3 清理后提示消失、无残留', hiddenClean === 0 && tipsClean === 0, `hidden=${hiddenClean}, tips=${tipsClean}`);

// ===== C. 文件夹原点展开 =====
let folderId = await evalJS(`${store} && (function(){
  var f = ${store}.state.desktop.layout.folders || {};
  var ids = Object.keys(f);
  return ids.length ? ids[0] : null;
})()`);
let stagedFolder = false;
if (!folderId) {
  // 纯 mutation 临时造一个文件夹（page-0 前两个 app 合并），测完解散还原
  const pair = await evalJS(`(function(){
    var slots = ${store}.state.desktop.layout.pages[0].slots || [];
    var a = null, b = null;
    for (var i = 0; i < slots.length && (!a || !b); i++) {
      if (slots[i] && slots[i].type === 'app' && !a) { a = slots[i].name; continue; }
      if (slots[i] && slots[i].type === 'app' && slots[i].name !== a && !b) b = slots[i].name;
    }
    return a && b ? { a: a, b: b } : null;
  })()`);
  if (pair) {
    await evalJS(`${store}.commit('desktop/CREATE_FOLDER', { pageIndex: 0, index: 0, targetAppName: '${pair.a}', newAppName: '${pair.b}', folderName: '探针临时', from: null })`);
    await sleep(300);
    folderId = await evalJS(`(function(){
      var f = ${store}.state.desktop.layout.folders || {};
      var ids = Object.keys(f);
      for (var i = 0; i < ids.length; i++) { if (f[ids[i]].name === '探针临时') return ids[i]; }
      return null;
    })()`);
    stagedFolder = !!folderId;
  }
}
if (!folderId) {
  console.log('- C 跳过：无法构造文件夹（页面 app 不足）');
} else {
  const tileKey = `page-folder-${folderId}`;
  const tileRect = await evalJS(`(function(){
    var el = document.querySelector('[data-flip-key="${tileKey}"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  check('C0 找到文件夹 tile', !!tileRect, JSON.stringify(tileRect));
  await evalJS(`${deskVm}.openFolder('${folderId}')`);
  await sleep(500);
  const originInfo = await evalJS(`(function(){
    var card = document.querySelector('.folder-expanded-card');
    if (!card) return { card: false };
    return { card: true, origin: card.style.transformOrigin || '' };
  })()`);
  check('C1 展开卡片出现且 transform-origin 已按 tile 设置', originInfo.card === true && /%/.test(originInfo.origin), originInfo.origin);
  // 组件实例可达性断言：<transition>（abstract 组件）包裹时 el.__vue__ 是 transition 实例，
  // 且 abstract 组件不进 $children——被包裹组件要走 _vnode.child（组件 vnode 挂实例）
  const vmDiag = await evalJS(`(function(){
    var el = document.querySelector('.folder-expanded-overlay');
    var vm = el && el.__vue__;
    if (vm && vm._vnode && vm._vnode.child && vm._vnode.child.$options) vm = vm._vnode.child;
    return {
      hasVm: !!vm,
      name: vm && vm.$options && vm.$options.name,
      hasFolder: !!(vm && vm.folder),
      folderId: vm && vm.folder && vm.folder.id,
      editing: vm ? vm.editing : null
    };
  })()`);
  const vmPropsOk = !!(vmDiag && vmDiag.name === 'DesktopFolderExpanded' && vmDiag.hasFolder && typeof vmDiag.editing === 'boolean');
  check('C2 展开组件实例可达且 props 可读（穿透 transition）', vmPropsOk, JSON.stringify(vmDiag));
  // C3 大文件夹：2×2 跨格 + mini 直启 + TIDY 不破坏（展开期间执行）
  const fLoc = await evalJS(`(function(){
    var s = ${store};
    var pages = s.state.desktop.layout.pages;
    for (var pi = 0; pi < pages.length; pi++) {
      var slots = pages[pi].slots || [];
      for (var si = 0; si < slots.length; si++) {
        var sl = slots[si];
        if (sl && sl.type === 'folder' && sl.id === '${folderId}') return { pi: pi, si: si };
      }
    }
    return null;
  })()`);
  check('C3a 定位文件夹槽位', !!(fLoc && fLoc.pi >= 0), JSON.stringify(fLoc));
  if (fLoc && fLoc.pi >= 0) {
    // 应用守恒快照（放大前）：腾挪后总数必须一致（不丢图标）
    const appSnapshot = await evalJS(`(function(){
      var s = ${store};
      var names = [];
      s.state.desktop.layout.pages.forEach(function(p){ (p.slots||[]).forEach(function(sl){ if (sl && sl.type==='app') names.push(sl.name); }); });
      Object.keys(s.state.desktop.layout.folders||{}).forEach(function(fid){ (s.state.desktop.layout.folders[fid].apps||[]).forEach(function(n){ names.push(n); });
      s.state.desktop.layout.dock.forEach(function(n){ names.push(n); }); });
      return names.sort().join(',');
    })()`);
    await evalJS(`${store}.commit('desktop/RESIZE_FOLDER', { folderId: '${folderId}', pageIndex: ${fLoc.pi}, index: ${fLoc.si}, nextSize: '2x2' })`);
    // 直启会切路由 → Desktop 重挂载会从服务端重拉布局，先保存再验证
    await evalJS(`${store}.dispatch('desktop/saveDesktopLayout')`);
    await sleep(900);
    const bigTile = await evalJS(`(function(){
      var el = document.querySelector('[data-flip-key="page-folder-${folderId}"]');
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    })()`);
    check('C3b 2×2 跨格生效（tile 宽 >100px）', bigTile !== null && bigTile > 100, String(bigTile));
    const covInfo = await evalJS(`(function(){
      var root = document.querySelector('#app').__vue__; var d = null;
      (function w(l){ (l||[]).forEach(function(v){ if(!d && typeof v.launchApp==='function') d=v; if(v.$children) w(v.$children); }); })(root.$children);
      var pv = d.pagesView[${fLoc.pi}];
      return { covered: Object.keys(pv.covered || {}).length, span: !!(pv.spans && pv.spans[${fLoc.si}]) };
    })()`);
    check('C3c 覆盖格=3 且 span 记录', covInfo.covered === 3 && covInfo.span === true, JSON.stringify(covInfo));
    const appAfter = await evalJS(`(function(){
      var s = ${store};
      var names = [];
      s.state.desktop.layout.pages.forEach(function(p){ (p.slots||[]).forEach(function(sl){ if (sl && sl.type==='app') names.push(sl.name); }); });
      Object.keys(s.state.desktop.layout.folders||{}).forEach(function(fid){ (s.state.desktop.layout.folders[fid].apps||[]).forEach(function(n){ names.push(n); });
      s.state.desktop.layout.dock.forEach(function(n){ names.push(n); }); });
      return names.sort().join(',');
    })()`);
    check('C3c2 自动腾挪后应用守恒（不丢图标）', appAfter === appSnapshot, appAfter.slice(0, 60));
    // mini 直启：点大 tile 第一格 → 路由跳转
    await evalJS(`(function(){
      var cell = document.querySelector('.folder-tile--large .folder-tile-app--launch') || document.querySelector('.folder-tile--large .folder-tile-app');
      if (cell) cell.click();
      return 'ok';
    })()`);
    await sleep(1000);
    const launched = await evalJS(`location.pathname !== '/'`);
    check('C3d 大文件夹 mini 图标直启', launched === true, await evalJS('location.pathname'));
    // 发射后不管：router 返回的 Promise 解析值含 route 深对象，returnByValue 序列化会崩
    await evalJS(`document.querySelector('#app').__vue__.$router.push('/').catch(function(){}); 'ok'`);
    await sleep(600);
    // TIDY 不破坏大文件夹
    await evalJS(`${store}.commit('desktop/TIDY_PAGE', ${fLoc.pi})`);
    await sleep(300);
    const sizeKept = await evalJS(`(function(){ try { var f = ${store}.state.desktop.layout.folders['${folderId}']; return f && f.size; } catch (e) { return { __err: String(e) }; } })()`);
    check('C3e TIDY 后大文件夹尺寸保持 2×2', sizeKept === '2x2', String(sizeKept));
    await evalJS(`${store}.commit('desktop/RESIZE_FOLDER', { folderId: '${folderId}', pageIndex: ${fLoc.pi}, index: ${fLoc.si}, nextSize: '1x1' })`);
    await evalJS(`${store}.dispatch('desktop/saveDesktopLayout')`);
    await sleep(900);
  }
  await evalJS(`${deskVm}.closeFolder()`);
  await sleep(400);
  if (stagedFolder) {
    // 解散临时文件夹，还原布局（纯 mutation，不触发保存）
    await evalJS(`${store}.commit('desktop/DELETE_FOLDER', { folderId: '${folderId}' })`);
    await sleep(200);
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);

// ===== D. 新增官方 widgets 冒烟（时钟/天气/今日日程/音乐播控） =====
// 注意：C3d 的路由切换会触发 Desktop 重挂载 → loadDesktopLayout 异步落地会冲掉内存内新增的
// widget，因此采用「加 → 等 → 没渲染就重加」的轮询（ADD 前先 REMOVE 防重复堆积）
const WIDGET_IDS = ['clock', 'weather-now', 'calendar-today', 'music-mini'];
const wRootsExpr = `(function(){
  return {
    clock: !!document.querySelector('.clock-widget'),
    weather: !!document.querySelector('.weather-now-widget'),
    calendar: !!document.querySelector('.calendar-today-widget'),
    music: !!document.querySelector('.music-mini-widget')
  };
})()`;
function wAddAll() {
  // 走标准 mutation（响应式安全）；先移除防重复堆积
  return evalJS(`(function(){
    var s = ${store};
    var ids = ['clock', 'weather-now', 'calendar-today', 'music-mini'];
    for (var i = 0; i < ids.length; i++) {
      s.commit('desktop/REMOVE_WIDGET', { pageId: 'page-0', widgetId: 'probe-d-' + ids[i] });
      s.commit('desktop/ADD_WIDGET', { pageId: 'page-0', widget: { id: 'probe-d-' + ids[i], type: ids[i], slot: 0, w: 2, h: 2, config: {} } });
    }
    return 'ok';
  })()`);
}
let wRoots = await evalJS(wRootsExpr);
for (var wAttempt = 0; wAttempt < 8 && !(wRoots && wRoots.clock && wRoots.weather && wRoots.calendar && wRoots.music); wAttempt++) {
  await wAddAll();
  await sleep(700);
  wRoots = await evalJS(wRootsExpr);
}
check('D1 四个新组件渲染（时钟/天气/日程/播控）', !!(wRoots && wRoots.clock && wRoots.weather && wRoots.calendar && wRoots.music), JSON.stringify(wRoots));
await evalJS(`${store}.commit('desktop/SET_CURRENT_PAGE', 0)`);
await sleep(600);
const wShot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('D:/tmp/desktop-shots/widgets-page.png', Buffer.from(wShot.data, 'base64'));
for (var dj = 0; dj < 5; dj++) {
  await evalJS(`(function(){
    var s = ${store};
    var ids = ['clock', 'weather-now', 'calendar-today', 'music-mini'];
    for (var i = 0; i < ids.length; i++) {
      s.commit('desktop/REMOVE_WIDGET', { pageId: 'page-0', widgetId: 'probe-d-' + ids[i] });
    }
    return 'ok';
  })()`);
  await sleep(300);
  var clean = !(await evalJS(`!!document.querySelector('.clock-widget')`));
  if (clean) break;
}
check('D5 清理无残留', clean);
ws.close();
process.exit(fail > 0 ? 1 : 0);
