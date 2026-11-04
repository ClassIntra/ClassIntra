// 聊天内支付探针（CDP）
// 验证：＋菜单 → 全屏转账页 → 密码键盘 → 结果 → 聊天里出现转账卡片；
//       红包同样；点收到的红包卡片 → 全屏开红包 → 领取。
// 前置：9099（DB=.workbuddy/tmp/wallet-test/wallet.db，JWT/RELAY_SECRET=wallet-test-secret）

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const jwt = require('../../../server/node_modules/jsonwebtoken');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9099;
const APP = 'http://127.0.0.1:' + PORT;
const CDP = 9338;
const VW = 1043, VH = 787;
const SHOTS = 'D:/NetWork/Integration/ClassIntra/.workbuddy/tmp/wallet-test/shots';
mkdirSync(SHOTS, { recursive: true });

const token = jwt.sign({ user_id: '251901', is_admin: 0, is_class_admin: 0, role: 'student' },
  'wallet-test-secret', { expiresIn: '2h' });
const PIN = '246810';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d) => {
  c ? (pass++, console.log('  ✓ ' + n + (d !== undefined ? '（' + d + '）' : '')))
    : (fail++, console.log('  ✗ ' + n + (d !== undefined ? ' → ' + d : '')));
};

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + CDP,
  '--user-data-dir=' + join(tmpdir(), 'ci-chat-pay-' + Date.now()),
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

async function getJSON(p) { return (await fetch('http://127.0.0.1:' + CDP + p)).json(); }
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('Chrome 未启动'); process.exit(1); }
let page = null;
for (let i = 0; i < 40; i++) { const l = await getJSON('/json/list'); page = l.find(t => t.type === 'page'); if (page) break; await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJS = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
  return r.result.value;
};
async function shot(n) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, n + '.png'), Buffer.from(r.data, 'base64')); }

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token',${JSON.stringify(token)});
    localStorage.setItem('user', JSON.stringify({user_id:'251901',net_name:'测试1',real_name:'测试同学1',role:'student'}));
  }catch(e){}
  window.__payErrs=[];
  window.addEventListener('error',function(e){window.__payErrs.push(e.message);});`
});

console.log('\n=== 打开聊天 ===');
await send('Page.navigate', { url: APP + '/chat' });
await sleep(1500);
let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(400);
  ready = await evalJS(`!!document.querySelector('.chat-page') && !document.getElementById('app-loading')`);
  if (ready) break;
}
ok('聊天页渲染', ready);
if (!ready) {
  const errs = await evalJS(`window.__payErrs || []`);
  console.log('    [JS错误]', (errs || []).slice(0, 5).join(' || '));
  console.log((await evalJS(`document.body.innerHTML.slice(0,300)`)));
  chrome.kill(); process.exit(1);
}

// 进私聊（直接调组件方法，避免依赖联系人列表是否渲染）
const entered = await evalJS(`(function(){
  var vm = document.querySelector('.chat-page').__vue__;
  if (!vm || !vm.selectChat) return false;
  vm.selectChat('251902');
  return true;
})()`);
ok('进入与 251902 的私聊', entered);
await sleep(1200);

console.log('\n=== ＋ 菜单 → 转账 ===');
await evalJS(`document.querySelector('.plus-toggle').click()`);
await sleep(300);
const plusItems = await evalJS(`(function(){
  return Array.prototype.map.call(document.querySelectorAll('.plus-item'), function(b){ return b.textContent.trim(); });
})()`);
ok('加号菜单有 转账/红包/云盘', plusItems.length === 3 && /转账/.test(plusItems[0]) && /红包/.test(plusItems[1]) && /云盘/.test(plusItems[2]), plusItems.join('|'));

await evalJS(`(function(){
  var bs = document.querySelectorAll('.plus-item');
  for (var i = 0; i < bs.length; i++) { if (bs[i].textContent.indexOf('转账') >= 0) { bs[i].click(); return true; } }
  return false;
})()`);
let formUp = false;
for (let i = 0; i < 30; i++) {
  await sleep(300);
  formUp = await evalJS(`!!document.querySelector('.pay-page .pay-form')`);
  if (formUp) break;
}
ok('打开全屏转账页（不是浮窗）', formUp);
const isFullPage = await evalJS(`(function(){
  var el = document.querySelector('.pay-page');
  if (!el) return false;
  var r = el.getBoundingClientRect();
  return r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2;
})()`);
ok('支付页占满整个屏幕', isFullPage);
await shot('10-chat-transfer');

// 选人：列表里点 251902（不再手输学号）
let peopleN = 0;
for (let i = 0; i < 20; i++) {
  await sleep(300);
  peopleN = await evalJS(`document.querySelectorAll('.pay-page .people-item').length`);
  if (peopleN >= 1) break;
}
ok('转账页出现可选同学列表', peopleN >= 1, peopleN + ' 人');
await evalJS(`(function(){
  var items = document.querySelectorAll('.pay-page .people-item');
  for (var i = 0; i < items.length; i++) {
    if (items[i].textContent.indexOf('251902') >= 0) { items[i].click(); return true; }
  }
  return false;
})()`);
await sleep(300);
const pickedTxt = await evalJS(`(function(){
  var el = document.querySelector('.pay-page .peer-picked');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
})()`);
ok('点选后显示收款人 251902', /251902/.test(pickedTxt), pickedTxt);

// 填金额
await evalJS(`(function(){
  var i = document.querySelectorAll('.pay-page .pay-form input')[0];
  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, '1');
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(400);

await evalJS(`document.querySelector('.pay-page .pay-primary').click()`);
let pinUp = false;
for (let i = 0; i < 30; i++) {
  await sleep(300);
  pinUp = await evalJS(`!!document.querySelector('.pin-pad')`);
  if (pinUp) break;
}
ok('进入支付密码键盘', pinUp);
await shot('11-chat-pin');

// 输密码（点按 6 位）
for (const d of PIN.split('')) {
  await evalJS(`(function(){
    var ks = document.querySelectorAll('.pin-key');
    for (var i = 0; i < ks.length; i++) { if (ks[i].textContent.trim() === '${d}') { ks[i].click(); return true; } }
    return false;
  })()`);
  await sleep(160);
}

let resultUp = false;
for (let i = 0; i < 40; i++) {
  await sleep(400);
  resultUp = await evalJS(`!!document.querySelector('.pay-page .pay-result')`);
  if (resultUp) break;
}
ok('支付后出现结果页', resultUp, resultUp ? '' : await evalJS(`(document.querySelector('.pin-msg')||{}).textContent`));
await shot('12-chat-result');

await evalJS(`(function(){ var b = document.querySelector('.pay-page .pay-result .pay-primary'); if (b) b.click(); return true; })()`);
await sleep(800);

const card = await evalJS(`(function(){
  var c = document.querySelector('.pay-card--transfer');
  var vm = document.querySelector('.chat-page').__vue__;
  var last = vm && vm.currentMessages ? vm.currentMessages[vm.currentMessages.length - 1] : null;
  return {
    dom: !!c,
    text: c ? c.textContent.replace(/\\s+/g, ' ').trim() : '',
    content: last ? String(last.content || '').slice(0, 40) : '',
    hasTransfer: !!(vm && vm.currentMessages && vm.currentMessages.some(function(m){ return /^\[\[pay:transfer\]\]/.test(String(m.content||'')); }))
  };
})()`);
ok('聊天里出现转账卡片', card.dom, card.text);
ok('转账卡片显示金额与收款人', /1\.00/.test(card.text) && /测试2/.test(card.text), card.text);
await shot('13-chat-card');

console.log('\n=== 发红包（同样全屏）===');
await evalJS(`document.querySelector('.plus-toggle').click()`);
await sleep(300);
await evalJS(`(function(){
  var bs = document.querySelectorAll('.plus-item');
  for (var i = 0; i < bs.length; i++) { if (bs[i].textContent.indexOf('红包') >= 0) { bs[i].click(); return true; } }
  return false;
})()`);
let pkUp = false;
for (let i = 0; i < 30; i++) { await sleep(300); pkUp = await evalJS(`!!document.querySelector('.pay-page .pay-form')`); if (pkUp) break; }
ok('打开全屏红包页', pkUp);
await evalJS(`(function(){
  var ins = document.querySelectorAll('.pay-page .pay-form input');
  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(ins[0], '2'); ins[0].dispatchEvent(new Event('input', { bubbles: true }));
  setter.call(ins[1], '2'); ins[1].dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(300);
await shot('14-chat-packet');
await evalJS(`document.querySelector('.pay-page .pay-primary').click()`);
for (let i = 0; i < 30; i++) { await sleep(250); if (await evalJS(`!!document.querySelector('.pin-pad')`)) break; }
for (const d of PIN.split('')) {
  await evalJS(`(function(){
    var ks = document.querySelectorAll('.pin-key');
    for (var i = 0; i < ks.length; i++) { if (ks[i].textContent.trim() === '${d}') { ks[i].click(); return true; } }
    return false;
  })()`);
  await sleep(150);
}
let pkDone = false;
for (let i = 0; i < 40; i++) { await sleep(400); pkDone = await evalJS(`!!document.querySelector('.pay-page .pay-result')`); if (pkDone) break; }
ok('红包发出（结果页）', pkDone);
await evalJS(`(function(){ var b = document.querySelector('.pay-page .pay-result .pay-primary'); if (b) b.click(); return true; })()`);
await sleep(800);
const pkCard = await evalJS(`(function(){
  var c = document.querySelector('.pay-card--packet');
  var vm = document.querySelector('.chat-page').__vue__;
  var last = vm && vm.currentMessages ? vm.currentMessages[vm.currentMessages.length - 1] : null;
  return { dom: !!c, content: last ? String(last.content || '').slice(0, 30) : '', own: c ? /已发出/.test(c.textContent) : false };
})()`);
ok('聊天里出现红包卡片', pkCard.dom && /^\[\[pay:packet\]\]/.test(pkCard.content), JSON.stringify(pkCard));
ok('自己发的红包显示「已发出」', pkCard.own, pkCard.own);

// 点自己发的红包：只提示，不打开
await evalJS(`document.querySelector('.pay-card--packet').click()`);
await sleep(500);
const selfOpen = await evalJS(`!!document.querySelector('.open-pk')`);
ok('点自己发的红包不会打开领取页', !selfOpen);

console.log('\n=== 开红包页（接收方视角）===');
// 不依赖聊天历史加载：让 251902 用 API 发一个红包，再以 251901 的身份调用
// 组件的 onPayCard（与点击卡片同一条代码路径），验证全屏开红包与真实领取。
const t2 = jwt.sign({ user_id: '251902', is_admin: 0, is_class_admin: 0, role: 'student' },
  'wallet-test-secret', { expiresIn: '2h' });
await fetch(APP + '/api/wallet', { headers: { Authorization: 'Bearer ' + t2 } });
const pkRes = await (await fetch(APP + '/api/wallet/packet', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t2 },
  body: JSON.stringify({ total: 2, count: 1, note: '探针红包', pin: PIN })
})).json();
const pid = pkRes && pkRes.data && pkRes.data.id;
ok('夹具：251902 发出一个红包', !!pid, pid);

await evalJS(`(function(){
  var vm = document.querySelector('.chat-page').__vue__;
  vm.onPayCard({ kind: 'packet', data: { id: ${pid}, note: '探针红包' }, own: false, senderName: '测试2' });
  return true;
})()`);
let openUp = false;
for (let i = 0; i < 30; i++) { await sleep(300); openUp = await evalJS(`!!document.querySelector('.open-pk')`); if (openUp) break; }
ok('聊天页内打开全屏红包', openUp);
await shot('15-chat-open-packet');

if (openUp) {
  const before = await (await fetch(APP + '/api/wallet', { headers: { Authorization: 'Bearer ' + token } })).json();
  await evalJS(`document.querySelector('.open-pk-btn').click()`);
  let got = false;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    got = await evalJS(`!!document.querySelector('.pay-result-amount')`);
    if (got) break;
  }
  ok('拆开后显示金额', got);
  const after = await (await fetch(APP + '/api/wallet', { headers: { Authorization: 'Bearer ' + token } })).json();
  ok('领取后余额增加', after.data.account.balance > before.data.account.balance,
    (after.data.account.balance - before.data.account.balance).toFixed(2));
  await shot('16-chat-open-result');
}

console.log('\n=== 口令红包（聊天页内输口令拆开）===');
const phRes = await (await fetch(APP + '/api/wallet/packet', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t2 },
  body: JSON.stringify({ total: 3, count: 1, note: '口令探针', pin: PIN, kind: 'phrase', scope: 'local' })
})).json();
const phId = phRes && phRes.data && phRes.data.id;
ok('夹具：口令红包已发出', !!phId, phId);

await evalJS(`(function(){
  var vm = document.querySelector('.chat-page').__vue__;
  vm.onPayCard({ kind: 'packet', data: { id: ${phId}, note: '口令探针', kind: 'phrase' }, own: false, senderName: '测试2' });
  return true;
})()`);
let phUp = false;
for (let i = 0; i < 30; i++) { await sleep(300); phUp = await evalJS(`!!document.querySelector('.open-pk-phrase input')`); if (phUp) break; }
ok('口令红包出现口令输入框', phUp);
await shot('17-chat-phrase-input');

if (phUp) {
  const phBefore = await (await fetch(APP + '/api/wallet', { headers: { Authorization: 'Bearer ' + token } })).json();
  // 先输错口令 → 应停在红包页并 toast
  await evalJS(`(function(){
    var i = document.querySelector('.open-pk-phrase input');
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, '错误口令');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evalJS(`document.querySelector('.open-pk-btn').click()`);
  await sleep(1200);
  const stillOpen = await evalJS(`!!document.querySelector('.open-pk')`);
  ok('口令错拆不开（仍在红包页）', stillOpen);
  // 输对 → 到账
  await evalJS(`(function(){
    var i = document.querySelector('.open-pk-phrase input');
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, '口令探针');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await evalJS(`document.querySelector('.open-pk-btn').click()`);
  let phGot = false;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    phGot = await evalJS(`!!document.querySelector('.pay-result-amount')`);
    if (phGot) break;
  }
  ok('口令对拆开显示金额', phGot);
  const phAfter = await (await fetch(APP + '/api/wallet', { headers: { Authorization: 'Bearer ' + token } })).json();
  ok('口令红包到账', phAfter.data.account.balance > phBefore.data.account.balance,
    (phAfter.data.account.balance - phBefore.data.account.balance).toFixed(2));
  await shot('18-chat-phrase-result');
}

const errs = await evalJS(`window.__payErrs || []`);
ok('无 JS 错误', !errs || errs.length === 0, (errs || []).slice(0, 3).join(' | '));

console.log('\n通过 ' + pass + ' / ' + (pass + fail) + (fail ? '，失败 ' + fail : ''));
chrome.kill();
process.exit(fail ? 1 : 0);
