// SDK 系统能力真机探针（CDP + 真实 Chromium）
//
// 目标：隔离实例 http://127.0.0.1:9099
// 用法：node scripts/probe-sdk-system.mjs
//
// 验证对象（对标 iOS / Android 的系统级能力）：
//   1. context.device.screen() / network() / vibrate()
//   2. context.system.setBadge() → localStorage 持久化与清除
//   3. context.app.onPause / onResume 注册与退订
//   4. context.system.registerSearchProvider() → 全局搜索可检索、可退订
//   5. 市场应用无需接代码即被全局搜索收录
//   6. context.system.openApp() → 路由跳转 + query 参数传递
//
// 依赖：localStorage['ci:devtools']='1' 暴露 __ciLastContext / __ciSearch（仅调试模式）

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9099';
const CDP_PORT = 9347;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;
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

// 前置：确保目标应用处于启用状态（其它 e2e 可能把它停用过，探针不能依赖库的当前状态）
async function ensureEnabled(name) {
  try {
    const r = await fetch(APP + '/api/admin/app-control/' + name, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminTok },
      body: JSON.stringify({ enabled: true })
    });
    return r.status === 200;
  } catch (e) {
    return false;
  }
}
if (!(await ensureEnabled('pet')) || !(await ensureEnabled('gomoku'))) {
  console.error('✗ 无法确保 pet / gomoku 处于启用状态');
  process.exit(1);
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-sdk-probe-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio',
  // 假麦克风：headless 下没有真实设备，MediaRecorder 需要一路假音频才能跑通
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--window-size=' + VW + ',' + VH, 'about:blank'
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
async function waitFor(expr, timeoutMs = 20000, interval = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await evalJS(expr)) return true; } catch (e) {}
    await sleep(interval);
  }
  return false;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

console.log('\nSDK 系统能力探针 → ' + APP);
await send('Page.navigate', { url: APP + '/' });
await sleep(2500);
await evalJS(`(function(){
  localStorage.setItem('token', ${JSON.stringify(adminTok)});
  localStorage.setItem('user', JSON.stringify({ user_id: '${ADMIN}', net_name: '探针管理员', is_admin: 1, role: 'user' }));
  localStorage.setItem('ci:market-source', 'local');
  localStorage.setItem('ci:devtools', '1');
  return true;
})()`);
await send('Page.navigate', { url: APP + '/pet' });

const ready = await waitFor(`!!window.__ciLastContext && window.__ciLastContext.appName === 'pet'`, 30000);
ok(ready, '进入 pet 且拿到调试上下文');
if (!ready) {
  const dbg = await evalJS(`(function(){
    return {
      path: location.pathname,
      devtools: localStorage.getItem('ci:devtools'),
      ciKeys: Object.keys(window).filter(function (k) { return k.indexOf('__ci') === 0; }),
      hasMarket: !!window.ClassIntraMarket,
      bodyText: (document.body.innerText || '').slice(0, 120)
    };
  })()`);
  console.error('调试状态: ' + JSON.stringify(dbg, null, 2));
  console.error('✗ 未能进入应用，后续断言跳过');
  try { ws.close(); chrome.kill(); } catch (e) {}
  process.exit(1);
}
await sleep(600);

section('1. 设备能力');
const screenInfo = await evalJS(`__ciLastContext.device.screen()`);
ok(screenInfo && screenInfo.width >= 1000 && screenInfo.orientation === 'landscape', 'screen() 返回横屏尺寸', screenInfo);
const netInfo = await evalJS(`__ciLastContext.device.network()`);
ok(netInfo && typeof netInfo.online === 'boolean' && typeof netInfo.type === 'string', 'network() 返回在线状态与类型', netInfo);
const vib = await evalJS(`(function(){ try { return { has: typeof navigator.vibrate === 'function', r: __ciLastContext.device.vibrate(10) }; } catch (e) { return { has: false, err: e.message }; } })()`);
ok(vib && vib.has === true && typeof vib.r === 'boolean', 'vibrate() 可用（返回布尔）', vib);

section('2. 桌面角标');
const badgeSet = await evalJS(`(function(){
  var okSet = __ciLastContext.system.setBadge(7);
  return { ok: okSet, ls: localStorage.getItem('ci:app-badge:pet'), state: window.__ciLastContext.system ? null : null };
})()`);
ok(badgeSet && badgeSet.ok === true && badgeSet.ls === '7', 'setBadge(7) 写入 localStorage', badgeSet);
const badgeState = await evalJS(`(function(){
  var el = document.querySelector('#app');
  var vm = el && el.__vue__ ? el.__vue__ : null;
  var store = vm && vm.$store ? vm.$store : null;
  return store ? (store.state.desktop.appBadges || {}) : {};
})()`);
ok(badgeState && badgeState.pet === '7', 'store 中角标生效', badgeState);
const badgeClear = await evalJS(`(function(){
  __ciLastContext.system.setBadge('');
  return { ls: localStorage.getItem('ci:app-badge:pet') };
})()`);
ok(badgeClear && badgeClear.ls === null, 'setBadge("") 清除持久化', badgeClear);

section('3. 生命周期');
const lifecycle = await evalJS(`(function(){
  var calls = [];
  var offP = __ciLastContext.app.onPause(function(){ calls.push('pause'); });
  var offR = __ciLastContext.app.onResume(function(){ calls.push('resume'); });
  var a = typeof offP === 'function' && typeof offR === 'function';
  offP(); offR();
  return { registered: a };
})()`);
ok(lifecycle && lifecycle.registered === true, 'onPause / onResume 注册与退订可用', lifecycle);

section('4. 搜索 Provider');
const provider = await evalJS(`(function(){
  var off = __ciLastContext.system.registerSearchProvider({
    id: 'probe',
    category: '探针',
    search: function (q) {
      return [{ id: 'p1', title: '探针结果-' + q, description: '来自 e2e provider' }];
    }
  });
  return { type: typeof off };
})()`);
ok(provider && provider.type === 'function', 'registerSearchProvider 返回退订函数', provider);
const found = await evalJS(`window.__ciSearch.search('叮咚').then(function (res) {
  var groups = (res && res.groups) || [];
  var hit = null;
  groups.forEach(function (g) { (g.items || []).forEach(function (it) { if (String(it.title).indexOf('探针结果-叮咚') !== -1) hit = it; }); });
  return { total: res && res.total, hit: !!hit, category: hit ? hit.description : '' };
})`);
ok(found && found.hit === true, '搜索能命中应用注册的结果', found);

const marketSearch = await evalJS(`window.__ciSearch.search('象棋').then(function (res) {
  var groups = (res && res.groups) || [];
  var ids = [];
  groups.forEach(function (g) { (g.items || []).forEach(function (it) { ids.push(it.id); }); });
  return { total: res && res.total, ids: ids.slice(0, 8) };
})`);
ok(marketSearch && marketSearch.ids.indexOf('app:chess') !== -1, '市场应用（chess）被全局搜索收录', marketSearch);

section('5. 运行时权限 + 录音');

// 5.1 录音：应先弹自定义授权层 → 自动点「允许」→ 出现录音条 → 1.2s 后点「停止」→ 拿到 Blob
const rec = await evalJS(`(function () {
  return new Promise(function (resolve) {
    var settled = false;
    function finish(v) { if (settled) return; settled = true; resolve(v); }

    var sawPermission = false;
    var sawBar = false;

    var p = __ciLastContext.device.recordAudio({ maxDuration: 8 });

    // 自动点「允许」（自定义授权层，不是浏览器原生权限）
    var t1 = setInterval(function () {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent === '允许') { sawPermission = true; btns[i].click(); break; }
      }
    }, 80);

    // 录音条出现后停 1.2 秒再点「停止」
    var t2 = setInterval(function () {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent === '停止') {
          sawBar = true;
          clearInterval(t2);
          setTimeout(function () { try { btns[i].click(); } catch (e) {} }, 1200);
          break;
        }
      }
    }, 120);

    p.then(function (r) {
      clearInterval(t1); clearInterval(t2);
      finish({ ok: true, size: r && r.blob ? r.blob.size : 0, duration: r && r.duration, mime: r && r.mimeType, sawPermission: sawPermission, sawBar: sawBar });
    }).catch(function (e) {
      clearInterval(t1); clearInterval(t2);
      finish({ ok: false, error: e && e.message, sawPermission: sawPermission, sawBar: sawBar });
    });

    setTimeout(function () { finish({ ok: false, error: 'timeout', sawPermission: sawPermission, sawBar: sawBar }); }, 25000);
  });
})()`);
ok(rec && rec.ok === true, 'device.recordAudio 成功返回', rec);
ok(rec && rec.size > 0, '录音产出非空 Blob', rec && { size: rec.size, mime: rec.mime });
ok(rec && rec.sawPermission === true, '首次调用弹出授权层（不是静默放行）', rec);
ok(rec && rec.sawBar === true, '录音条真实渲染并可停止', rec);

// 5.2 拒绝通知权限：应降级为前台 Toast，而不是抛错
const denied = await evalJS(`(function () {
  return new Promise(function (resolve) {
    var p = __ciLastContext.system.notify('探针通知', '这条应被降级为 Toast');
    var t = setInterval(function () {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent === '不允许') { btns[i].click(); clearInterval(t); break; }
      }
    }, 80);
    p.then(function (r) { clearInterval(t); resolve({ ok: true, res: r }); })
     .catch(function (e) { clearInterval(t); resolve({ ok: false, error: e && e.message }); });
    setTimeout(function () { clearInterval(t); resolve({ ok: false, error: 'timeout' }); }, 12000);
  });
})()`);
ok(denied && denied.ok === true, '拒绝通知权限后不抛错（降级）', denied);
ok(denied && denied.res && denied.res.denied === true, '结果标记 denied=true 并走 toast 通道', denied && denied.res);

section('6. 录像（device.recordVideo）');

const vid = await evalJS(`(function () {
  return new Promise(function (resolve) {
    var settled = false;
    function finish(v) { if (settled) return; settled = true; resolve(v); }

    var sawPermission = false, sawStop = false;

    // audio:false —— 只验证相机权限；麦克风权限已在录音一节验证过
    var p = __ciLastContext.device.recordVideo({ audio: false, maxDuration: 8 });

    var t1 = setInterval(function () {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent === '允许') { sawPermission = true; btns[i].click(); break; }
      }
    }, 80);

    var t2 = setInterval(function () {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent === '完成') {
          sawStop = true;
          clearInterval(t2);
          setTimeout(function () { try { btns[i].click(); } catch (e) {} }, 1500);
          break;
        }
      }
    }, 120);

    p.then(function (r) {
      clearInterval(t1); clearInterval(t2);
      finish({ ok: true, size: r && r.blob ? r.blob.size : 0, mime: r && r.mimeType, sawPermission: sawPermission, sawStop: sawStop });
    }).catch(function (e) {
      clearInterval(t1); clearInterval(t2);
      finish({ ok: false, error: e && e.message, sawPermission: sawPermission, sawStop: sawStop });
    });

    setTimeout(function () { finish({ ok: false, error: 'timeout', sawPermission: sawPermission, sawStop: sawStop }); }, 25000);
  });
})()`);
ok(vid && vid.ok === true, 'device.recordVideo 成功返回', vid);
ok(vid && vid.size > 0, '录像产出非空 Blob', vid && { size: vid.size, mime: vid.mime });
ok(vid && vid.sawPermission === true, '录像前弹出相机授权', vid);
ok(vid && vid.sawStop === true, '预览窗口渲染且可点「完成」', vid);

section('7. UI 组件：navbar / sheet');
const uiProbe = await evalJS(`(function () {
  try {
    var nav = __ciLastContext.ui.navbar({
      title: '探针导航', subtitle: '副标题',
      back: { label: '返回', onClick: function () {} },
      actions: [{ label: '完成', onClick: function () {} }]
    });
    document.body.appendChild(nav.root);

    var s = __ciLastContext.ui.sheet({
      title: '抽屉标题', message: '说明文字',
      actions: [{ label: '确定' }, { label: '取消', variant: 'plain' }]
    });
    s.open();

    var out = {
      navButtons: nav.root.querySelectorAll('button').length,
      navTitleOk: nav.root.innerText.indexOf('探针导航') !== -1,
      sheetMounted: !!document.querySelector('[role="dialog"]'),
      sheetActions: document.querySelectorAll('[role="dialog"] button').length,
      hasClose: typeof s.close === 'function'
    };
    // 立即收掉，别挡住后面的断言
    setTimeout(function () {
      try { s.close(); s.destroy(); nav.destroy(); } catch (e) {}
    }, 400);
    return out;
  } catch (e) {
    return { error: e && e.message };
  }
})()`);
ok(uiProbe && !uiProbe.error, 'navbar / sheet 可用', uiProbe);
ok(uiProbe && uiProbe.navButtons >= 2 && uiProbe.navTitleOk, 'navbar 渲染返回/操作按钮与标题', uiProbe);
ok(uiProbe && uiProbe.sheetMounted && uiProbe.sheetActions === 2, 'sheet 挂载到底部并渲染 2 个动作', uiProbe);
ok(uiProbe && uiProbe.hasClose === true, 'sheet 提供 close()', uiProbe);

section('8. 打开其他应用');
const opened = await evalJS(`__ciLastContext.system.openApp('gomoku', { from: 'pet', room: 'A12' }).then(function (okFlag) {
  return { ok: okFlag, path: location.pathname, search: location.search };
})`);
ok(opened && opened.ok === true, 'openApp 返回成功', opened);
ok(opened && opened.path === '/gomoku', '路由已跳到目标应用', opened && opened.path);
ok(opened && String(opened.search).indexOf('from=pet') !== -1 && String(opened.search).indexOf('room=A12') !== -1,
  '参数通过 query 传递', opened && opened.search);

section('9. 深度链接（未登录直达应用带参数）');
// 清掉登录态后访问 /gomoku?room=A12：应被弹到登录页，并记住原目标
await evalJS(`(function(){
  localStorage.removeItem('token');
  localStorage.removeItem('ci:redirect-after-login');
  return true;
})()`);
await send('Page.navigate', { url: APP + '/gomoku?room=A12' });
await sleep(2000);
const deepLink = await evalJS(`({
  saved: localStorage.getItem('ci:redirect-after-login'),
  path: location.pathname
})`);
ok(deepLink.saved === '/gomoku?room=A12', '未登录访问 deep link 会记住回跳目标', deepLink);
ok(deepLink.path === '/login', '被重定向到登录页', deepLink);

// 开放重定向防护：不接受 //host 这类外站地址
await evalJS(`(function(){
  localStorage.setItem('ci:redirect-after-login', '//evil.example.com/x');
  return true;
})()`);
await send('Page.navigate', { url: APP + '/login' });
await sleep(1200);
const guard = await evalJS(`({ host: location.host, path: location.pathname })`);
ok(String(guard.host).indexOf('evil.example.com') === -1, '外站回跳目标不会被采纳（留在同域）', guard);

section('10. 分享接收（shareTarget）');
// 10.1 被分享唤起：/pet?ci_share=1&... 进入后，应用注册 onShare 应立刻收到数据。
// ⚠️ 上一节删过 token 做未登录测试，这里必须补回来，否则会被弹到登录页。
await evalJS(`(function(){ localStorage.setItem('token', ${JSON.stringify(adminTok)}); return true; })()`);
await send('Page.navigate', { url: APP + '/pet?ci_share=1&ci_share_text=hello-share&ci_share_title=标题T&ci_share_from=gomoku' });
// 必须同时校验真的在 /pet 上：旧 context 会挂在 window 上，只看 appName 会误判
const sharedReady = await waitFor(`location.pathname === '/pet' && !!window.__ciLastContext && window.__ciLastContext.appName === 'pet'`, 30000);
ok(sharedReady, '带分享参数进入应用成功');
const got = await evalJS(`(function () {
  return new Promise(function (resolve) {
    var off = __ciLastContext.app.onShare(function (data) {
      resolve({ ok: true, data: data, offType: typeof off });
    });
    setTimeout(function () { resolve({ ok: false, offType: typeof off }); }, 2500);
  });
})()`);
ok(got && got.ok === true, 'onShare 在注册时立即补发待处理分享', got);
ok(got && got.data && got.data.text === 'hello-share' && got.data.title === '标题T' && got.data.from === 'gomoku',
  '分享内容（text/title/from）完整送达', got && got.data);
ok(got && got.offType === 'function', 'onShare 返回退订函数', got);

// 参数应被清掉，刷新时不会重复派发
const cleanedQuery = await evalJS(`location.search.indexOf('ci_share') === -1 ? 'clean' : location.search.slice(0, 60)`);
ok(cleanedQuery === 'clean', '分享参数用后即从地址栏清除', cleanedQuery);

// 10.2 发送侧：没有声明 shareTarget 的应用时，退回复制到剪贴板并给出明确通道
const shareRes = await evalJS(`__ciLastContext.system.share({ title: '探针', text: '分享内容' }).then(function (r) {
  return { channel: r && r.channel };
}).catch(function (e) { return { error: e && e.message }; })`);
ok(shareRes && !shareRes.error, 'system.share 不抛错', shareRes);
ok(shareRes && ['clipboard', 'app', 'cancelled', 'share'].indexOf(shareRes.channel) !== -1,
  'system.share 返回明确通道（' + (shareRes && shareRes.channel) + '）', shareRes);
// 没有声明 shareTarget 的应用时，面板不会列出任何目标；cancelled 说明面板确实弹出了（无人选择）
ok(shareRes && (shareRes.channel === 'clipboard' || shareRes.channel === 'cancelled'),
  '无接收方时退回复制/取消，不会误报成功');

console.log('\n' + '='.repeat(52));
console.log('结果：通过 ' + pass + '，失败 ' + fail);
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
process.exit(fail ? 1 : 0);
