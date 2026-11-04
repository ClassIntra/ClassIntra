// 市场页真机探针（CDP + 真实 Chromium）
//
// 目标实例：隔离实例 http://127.0.0.1:9099（生产库副本；探针账号只存在于副本里）
// 绝不指向 9001 —— 市场操作会改 app_control / 市场源，碰真库等于在教室大屏上做实验。
//
// 覆盖：
//   1. 市场页加载：分区标签 / 目录卡片
//   2. 市场源面板：内置源只读、添加自定义源、删除自定义源（走真实 API）
//   3. 分类筛选：分组按钮出现，点「游戏」后只剩棋类
//   4. 详情弹窗：截图、更新日志、能力清单
//   5. 健康度：已安装列表出现使用/错误行
//   6. 截图采集：chess / gomoku / pet 真机画面 → market/apps/<name>/screenshots/
//
// 用法：
//   node scripts/probe-market-ui.mjs            # 只跑断言
//   node scripts/probe-market-ui.mjs --shots    # 跑断言并采集截图
//
// ⚠️ 写 CDP 探针的老坑（见 2026-10-24 记忆）：
//   - Runtime.evaluate 的页面内异常不 reject，必须自己查 exceptionDetails
//   - 探针模板串里多行内容要写 \\n，否则浏览器端字符串裸换行直接 SyntaxError

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const MARKET = 'D:/NetWork/Integration/market';
const APP = 'http://127.0.0.1:9099';
const CDP_PORT = 9345;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;
const SHOTS_DIR = join(tmpdir(), 'ci-market-probe');
const WANT_SHOTS = process.argv.includes('--shots');

const ADMIN = '251800';

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ 未读到 JWT_SECRET'); process.exit(1); }
const adminTok = jwt.sign({ user_id: ADMIN }, SECRET, { expiresIn: '2h' });

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }

// ---------- Chrome + CDP ----------
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  // 每次跑用全新 profile：持久 profile 会把旧 index.html 留在磁盘缓存里，
  // 结果就是「明明重建了前端，探针还在测上一版」。
  `--user-data-dir=${join(tmpdir(), 'ci-market-probe-profile-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

const getJSON = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
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

async function evalJS(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) {
    throw new Error('页面内异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  }
  return r && r.result ? r.result.value : undefined;
}
async function waitFor(expr, timeoutMs = 12000, interval = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evalJS(expr)) return true; } catch (e) { /* 页面切换中 */ }
    await sleep(interval);
  }
  return false;
}
async function shotTo(file) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

// ---------- 登录态注入 ----------
console.log('\n市场页真机探针 → ' + APP);
await send('Page.navigate', { url: APP + '/' });
await sleep(2500);
await evalJS(`(function(){
  localStorage.setItem('token', ${JSON.stringify(adminTok)});
  localStorage.setItem('user', JSON.stringify({ user_id: '${ADMIN}', net_name: '探针管理员', is_admin: 1, role: 'user' }));
  // 锁定本地源：线上源发布滞后，探针要测的是当前工作区的目录内容
  localStorage.setItem('ci:market-source', 'local');
  return true;
})()`);
await send('Page.navigate', { url: APP + '/market' });

const loaded = await waitFor(`!!document.querySelector('.market-page') && document.querySelectorAll('.market-tab').length >= 3`, 25000);
ok(loaded, '市场页加载（三分区标签）');
if (!loaded) {
  console.error('页面未能加载，后续断言跳过');
  ws.close(); chrome.kill(); process.exit(1);
}
await sleep(1200); // 等目录与已安装列表渲染稳定

// 调试出口：直接把 Vue 实例里的真实状态打出来（排查「DOM 里为什么没有」）
if (process.argv.includes('--debug')) {
  const dbg = await evalJS(`(function(){
    var el = document.querySelector('.market-page');
    var vm = el && el.__vue__ ? el.__vue__ : null;
    if (!vm) return { error: 'no vue instance' };
    var apps = vm.catalogApps || [];
    return {
      activeTab: vm.activeTab,
      activeGroup: vm.activeGroup,
      catalogCount: apps.length,
      groups: apps.map(function (a) { return String(a.name) + ':' + String(a.group || '-'); }),
      computedGroups: (vm.appGroups || []).map(function (g) { return g.key + '/' + g.count; }),
      chipsInDom: document.querySelectorAll('.group-chip').length,
      chipsWrap: document.querySelectorAll('.group-chips').length,
      toolbarHtml: (document.querySelector('.market-toolbar') || {}).innerHTML ? 'yes' : 'no',
      firstKeys: apps[0] ? Object.keys(apps[0]) : [],
      firstRaw: apps[0] ? JSON.stringify(apps[0]).slice(0, 260) : ''
    };
  })()`);
  console.log('DEBUG', JSON.stringify(dbg, null, 2));
}

// ---------- 1. 目录 ----------
section('目录与分区');
const tabCount = await evalJS(`document.querySelectorAll('.market-tab').length`);
ok(tabCount >= 3, '分区标签数量 = ' + tabCount);
const cardCount = await evalJS(`document.querySelectorAll('.market-section[data-section="apps"] .app-card').length`);
ok(cardCount >= 3, '目录卡片 ≥ 3（实际 ' + cardCount + '）');
const sourceChips = await evalJS(`document.querySelectorAll('.source-chip').length`);
ok(sourceChips >= 3, '市场源按钮 ≥ 3（实际 ' + sourceChips + '）');

// ---------- 2. 分类筛选 ----------
section('分类筛选');
const groupCount = await evalJS(`document.querySelectorAll('.group-chip').length`);
ok(groupCount >= 2, '分类按钮出现（实际 ' + groupCount + '）');
if (groupCount >= 2) {
  const gameClicked = await evalJS(`(function(){
    var btns = document.querySelectorAll('.group-chip');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.indexOf('游戏') !== -1) { btns[i].click(); return true; }
    }
    return false;
  })()`);
  await sleep(500);
  const gameCards = await evalJS(`document.querySelectorAll('.market-section[data-section="apps"] .app-card').length`);
  ok(gameClicked && gameCards === 2, '点「游戏」只剩 2 个棋类（实际 ' + gameCards + '）');
  await evalJS(`(function(){
    var btns = document.querySelectorAll('.group-chip');
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent.indexOf('全部') !== -1) { btns[i].click(); return true; } }
    return false;
  })()`);
  await sleep(400);
}

// ---------- 3. 市场源面板 ----------
section('市场源面板');
const opened = await evalJS(`(function(){
  var btns = document.querySelectorAll('button.refresh-btn');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.replace(/\\s/g, '').indexOf('源') !== -1) { btns[i].click(); return true; }
  }
  return false;
})()`);
await sleep(800);
const panelOpen = await evalJS(`!!document.querySelector('.source-panel')`);
ok(opened && panelOpen, '「源」按钮可打开面板');

const builtinRows = await evalJS(`document.querySelectorAll('.source-list li .source-tag--builtin').length`);
ok(builtinRows >= 3, '内置源标记为只读（' + builtinRows + ' 个）');

// 添加自定义源（走真实 POST /api/market/sources）
const filled = await evalJS(`(function(){
  var ins = document.querySelectorAll('.source-form input');
  if (ins.length < 3) return false;
  function set(el, v) {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  set(ins[0], 'probe-market');
  set(ins[1], '探针市场');
  set(ins[2], 'https://probe.example.com/market/');
  var btns = document.querySelectorAll('.source-actions button');
  if (!btns.length) return false;
  btns[0].click();
  return true;
})()`);
const addedVisible = await waitFor(`(function(){
  var t = document.querySelector('.source-list');
  return !!t && t.textContent.indexOf('探针市场') !== -1;
})()`, 10000);
ok(filled && addedVisible, '添加自定义源后面板出现该源');

// 删除自定义源（确认框直接放行）
const removed = await evalJS(`(function(){
  window.confirm = function () { return true; };
  var rows = document.querySelectorAll('.source-list li');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].textContent.indexOf('探针市场') !== -1) {
      var btn = rows[i].querySelector('.source-del');
      if (btn) { btn.click(); return true; }
    }
  }
  return false;
})()`);
const gone = await waitFor(`(function(){
  var t = document.querySelector('.source-list');
  return !!t && t.textContent.indexOf('探针市场') === -1;
})()`, 10000);
ok(removed && gone, '删除自定义源后从列表消失');

await evalJS(`(function(){ var b = document.querySelector('.source-panel .proxy-close'); if (b) b.click(); return true; })()`);
await sleep(400);

// ---------- 4. 健康度 ----------
section('应用健康度');
const healthLines = await evalJS(`document.querySelectorAll('.health-line').length`);
ok(healthLines >= 1, '已安装列表显示使用/错误行（' + healthLines + ' 行）');

// ---------- 5. 详情弹窗 ----------
section('应用详情');
const detailOpened = await evalJS(`(function(){
  var cards = document.querySelectorAll('.market-section[data-section="apps"] .app-card');
  for (var i = 0; i < cards.length; i++) {
    var btns = cards[i].querySelectorAll('button');
    for (var j = 0; j < btns.length; j++) {
      if (btns[j].textContent.indexOf('详情') !== -1) { btns[j].click(); return true; }
    }
  }
  return false;
})()`);
const detailReady = await waitFor(`!!document.querySelector('.app-detail-panel')`, 6000);
ok(detailOpened && detailReady, '详情弹窗可打开');
const shotCount = await evalJS(`document.querySelectorAll('.detail-screens img').length`);
ok(shotCount >= 1, '详情页展示应用截图（' + shotCount + ' 张）');
const changeCount = await evalJS(`document.querySelectorAll('.detail-changelog .changelog-entry').length`);
ok(changeCount >= 1, '详情页展示更新日志（' + changeCount + ' 条）');
const capCount = await evalJS(`document.querySelectorAll('.detail-caps .cap-chip').length`);
ok(capCount >= 1, '详情页展示能力清单（' + capCount + ' 项）');
await evalJS(`(function(){ var b = document.querySelector('.app-detail-panel .proxy-close'); if (b) b.click(); return true; })()`);
await sleep(300);

// ---------- 5.5 运行时权限面板 ----------
section('应用权限面板');
const permBtnFound = await evalJS(`(function(){
  var cards = document.querySelectorAll('.installed-card');
  for (var i = 0; i < cards.length; i++) {
    var btns = cards[i].querySelectorAll('button');
    for (var j = 0; j < btns.length; j++) {
      if (btns[j].textContent.indexOf('权限') !== -1) { btns[j].click(); return true; }
    }
  }
  return false;
})()`);
const permOpened = await waitFor(`!!document.querySelector('.perm-panel')`, 6000);
ok(permBtnFound, '已装卡片出现「权限」入口');
ok(permOpened, '权限面板可打开');
const permReady = await waitFor(
  `!!(document.querySelector('.perm-summary') || document.querySelector('.perm-empty') || document.querySelector('.perm-panel .source-error'))`,
  6000
);
ok(permReady, '权限面板渲染出汇总或空态（不是一直转圈）');
const permText = await evalJS(`(function(){
  var el = document.querySelector('.perm-panel');
  return el ? el.innerText.replace(/\\s+/g, ' ').slice(0, 160) : '';
})()`);
ok(/权限/.test(permText), '面板标题含「权限」', permText);
await evalJS(`(function(){ var b = document.querySelector('.perm-panel .proxy-close'); if (b) b.click(); return true; })()`);
await sleep(300);

// ---------- 6. 截图采集 ----------
if (WANT_SHOTS) {
  section('应用截图采集');
  mkdirSync(SHOTS_DIR, { recursive: true });
  const targets = [
    { name: 'chess', route: '/chess', marker: '棋盘|chess|国际象棋' },
    { name: 'gomoku', route: '/gomoku', marker: '五子棋|gomoku|棋盘' },
    { name: 'pet', route: '/pet', marker: '桌宠|领养|pet' }
  ];
  for (const t of targets) {
    await send('Page.navigate', { url: APP + t.route });
    await sleep(1200);
    // 等应用容器真正出现（市场应用是动态注册路由，首次可能先命中通配）
    const ready = await waitFor(`(function(){
      var el = document.querySelector('.market-app-container, .app-shell-content, #app');
      if (!el) return false;
      return (document.body.innerText || '').length > 30;
    })()`, 20000);
    await sleep(2200); // 等首屏渲染/动画稳定
    // 截图前清场：只留主应用容器，其余挂在 body 上的悬浮层 / 桌宠 / Toast 全部隐藏。
    // （按 class 找不可靠：不同应用的悬浮层挂载方式不一样，第一版就漏掉了桌宠。）
    const hidden = await evalJS(`(function(){
      var n = 0;
      var kids = document.body.children;
      for (var i = 0; i < kids.length; i++) {
        var el = kids[i];
        var tag = el.tagName;
        if (el.id === 'app' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK') continue;
        el.style.display = 'none';
        n++;
      }
      return n;
    })()`);
    await sleep(250);
    const name = t.name;
    const outDir = join(MARKET, 'apps', name, 'screenshots');
    const file = join(outDir, '01-overview.png');
    await shotTo(file);
    const size = (readFileSync(file).length / 1024).toFixed(0);
    ok(ready && existsSync(file) && Number(size) > 20, '截图 ' + name + '（' + size + 'KB）');

    // 第二张：切浅色主题再拍一张。深浅成对的详情页比单张更像成品。
    const themed = await evalJS(`(function(){
      var el = document.querySelector('#app');
      var vm = el && el.__vue__ ? el.__vue__ : null;
      if (!vm || !vm.$store) return false;
      vm.$store.commit('settings/SET_THEME', 'light');
      return true;
    })()`);
    if (themed) {
      await sleep(1100);
      const lightFile = join(outDir, '02-light.png');
      await shotTo(lightFile);
      const lightSize = (readFileSync(lightFile).length / 1024).toFixed(0);
      ok(existsSync(lightFile) && Number(lightSize) > 20, '浅色截图 ' + name + '（' + lightSize + 'KB）');
    } else {
      ok(false, '浅色截图 ' + name + '（拿不到 Vue 实例）');
    }

    await shotTo(join(SHOTS_DIR, name + '.png')); // 探针侧留档，便于人工看
  }
}

// ---------- 收尾 ----------
console.log('\n' + '='.repeat(52));
console.log('结果：通过 ' + pass + '，失败 ' + fail);
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
process.exit(fail ? 1 : 0);
