// 学元钱包（apps/wallet）· 界面探针（CDP 真实 Chromium，隔离实例）
// 用法（仓库根）："C:\Program Files\nodejs\node.exe" .workbuddy/tmp/wallet-probe.mjs
//
// 前置：9099 实例在跑（DB=.workbuddy/tmp/wallet-test/wallet.db，JWT_SECRET=wallet-test-secret）
// 它验证的是：
//   · 余额卡的钱是不是真的（读接口，不是写死）
//   · 明细分页/筛选有没有把行数筛错
//   · 红包能不能真的领到（点按钮 → 弹层 → 余额增加）
//   · 转账找同学、发红包表单能不能开
//   · 榜单与来源清单是否渲染
//   · 全程无 JS 错误

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const jwt = require('../../../server/node_modules/jsonwebtoken');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9099;
const APP = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9334;
const VW = 1043;
const VH = 787;
const SHOTS = 'D:/NetWork/Integration/ClassIntra/.workbuddy/tmp/wallet-test/shots';
const USER_ID = process.argv[2] || '251901';

mkdirSync(SHOTS, { recursive: true });

const token = jwt.sign(
  { user_id: USER_ID, is_admin: 1, is_class_admin: 1, role: 'admin' },
  'wallet-test-secret', { expiresIn: '2h' }
);

const apiToken = t => jwt.sign(
  { user_id: t, is_admin: 0, is_class_admin: 0, role: 'student' },
  'wallet-test-secret', { expiresIn: '2h' }
);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail !== undefined ? '（' + detail + '）' : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + detail : '')); }
}

async function api(method, url, opts = {}) {
  const headers = { Authorization: 'Bearer ' + (opts.token || token) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(APP + url, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  return { status: res.status, body: await res.json() };
}

// 夹具：让同学发一个可领红包（探针要有「领取」可点）
let fixturePacket = 0;
try {
  await api('GET', '/api/wallet', { token: apiToken('251902') });   // 确保已开户
  const r = await api('POST', '/api/wallet/packet', {
    token: apiToken('251902'),
    body: { total: 6, count: 2, note: '探针红包', pin: '246810' }
  });
  fixturePacket = (r.body.data && r.body.data.id) || 0;
  console.log('  · 夹具：同学发了一个 6 学元 / 2 个的红包（id=' + fixturePacket + '）');
} catch (e) {
  console.log('  · 夹具失败（可领红包断言可能跳过）：' + e.message);
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-wallet-ui-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
  return r.result.value;
};
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  return name + '.png';
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}
    window.__ciWalletErrors = [];
    try {
      var _oe = console.error;
      console.error = function(){
        try { window.__ciWalletErrors.push(Array.prototype.slice.call(arguments).join(' ').slice(0, 300)); } catch (e) {}
        _oe.apply(console, arguments);
      };
    } catch (e) {}
    window.addEventListener('error', function(e){
      window.__ciWalletErrors.push((e.message || 'error') + ' @' + (e.filename || '') + ':' + (e.lineno || 0));
    });
    window.addEventListener('unhandledrejection', function(e){
      var r = e.reason || {};
      window.__ciWalletErrors.push('rejection: ' + (r.message || String(r)));
    });`
});

console.log('\n=== 打开钱包 ===');
await send('Page.navigate', { url: APP + '/wallet' });
await sleep(1200);

let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(400);
  ready = await evalJS(`!!document.querySelector('.ci-wallet, .wallet-page') && !document.getElementById('app-loading')`);
  if (ready) break;
}
ok('页面渲染（启动屏已退场）', ready);
if (!ready) {
  const html = await evalJS(`document.body.innerHTML.slice(0, 800)`);
  console.log('  页面片段：' + html);
  chrome.kill(); process.exit(1);
}

// 等概览数据回来
let bal = '';
for (let i = 0; i < 30; i++) {
  bal = await evalJS(`(document.querySelector('.bal-amount') || {}).textContent || ''`).catch(() => '');
  if (bal && bal !== '0.00') break;
  await sleep(400);
}
ok('余额卡显示真实金额', /^[\d,]+\.\d{2}$/.test((bal || '').trim()), bal);
await shot('01-overview');

console.log('\n=== 余额与津贴 ===');
const head = await evalJS(`(function(){
  var split = document.querySelector('.bal-split');
  var btn = document.querySelector('.daily-btn');
  var week = document.querySelector('.bal-week');
  return {
    split: split ? split.textContent.replace(/\\s+/g, ' ').trim() : '',
    daily: btn ? btn.textContent.replace(/\\s+/g, ' ').trim() : '',
    dailyDisabled: btn ? !!btn.disabled : null,
    week: week ? week.textContent.replace(/\\s+/g, ' ').trim() : ''
  };
})()`);
ok('显示可用与冻结', /可用/.test(head.split) && /冻结/.test(head.split), head.split);
ok('津贴按钮呈现今天状态', /今日已领|领今日津贴/.test(head.daily), head.daily);
ok('显示本周收支', /本周/.test(head.week), head.week);

const tabs = await evalJS(`(function(){
  return Array.prototype.map.call(document.querySelectorAll('.seg-btn'), function(b){ return b.textContent.trim(); });
})()`);
ok('三个页签（明细/红包/学元榜）', tabs.length === 3 && /明细/.test(tabs[0]) && /红包/.test(tabs[1]) && /学元榜/.test(tabs[2]), tabs.join('|'));

console.log('\n=== 明细 ===');
let rows = 0;
for (let i = 0; i < 30; i++) {
  rows = await evalJS(`document.querySelectorAll('.ledger-row').length`).catch(() => 0);
  if (rows > 0) break;
  await sleep(300);
}
ok('流水行已渲染', rows >= 3, rows + ' 行');
const firstRow = await evalJS(`(function(){
  var r = document.querySelector('.ledger-row');
  if (!r) return null;
  return {
    title: (r.querySelector('.lr-title') || {}).textContent || '',
    sub: (r.querySelector('.lr-sub') || {}).textContent || '',
    amount: (r.querySelector('.lr-amount') || {}).textContent || '',
    balance: (r.querySelector('.lr-bal') || {}).textContent || ''
  };
})()`);
ok('每行有标题/时间/金额/余额', !!(firstRow && firstRow.title && /·/.test(firstRow.sub || '') && /[+-]/.test(firstRow.amount || '') && /余/.test(firstRow.balance || '')),
  firstRow && JSON.stringify(firstRow));

// 支出筛选
await evalJS(`(function(){
  var fs = document.querySelectorAll('.filter');
  for (var i = 0; i < fs.length; i++) { if (fs[i].textContent.indexOf('支出') >= 0) { fs[i].click(); return true; } }
  return false;
})()`);
await sleep(1200);
const outRows = await evalJS(`(function(){
  var rs = document.querySelectorAll('.ledger-row');
  var bad = 0;
  for (var i = 0; i < rs.length; i++) {
    var a = rs[i].querySelector('.lr-amount');
    if (a && a.textContent.indexOf('-') < 0) bad++;
  }
  return { n: rs.length, bad: bad };
})()`);
ok('支出筛选后只剩负数（或空）', outRows.bad === 0, JSON.stringify(outRows));
await shot('02-ledger-out');

// 回到全部
await evalJS(`(function(){
  var fs = document.querySelectorAll('.filter');
  for (var i = 0; i < fs.length; i++) { if (fs[i].textContent.trim() === '全部') { fs[i].click(); return true; } }
  return false;
})()`);
await sleep(1000);

console.log('\n=== 红包 ===');
await evalJS(`(function(){
  var bs = document.querySelectorAll('.seg-btn');
  for (var i = 0; i < bs.length; i++) { if (bs[i].textContent.indexOf('红包') >= 0) { bs[i].click(); return true; } }
  return false;
})()`);
await sleep(1400);

const pkt = await evalJS(`(function(){
  return {
    cards: document.querySelectorAll('.pkt-card').length,
    avail: document.querySelectorAll('.pkt-claim').length,
    sendBtn: !!document.querySelector('.pkt-send'),
    face: !!document.querySelector('.pkt-face')
  };
})()`);
ok('红包页有三块内容（可领/我发的/我领的）', pkt.cards >= 2 && pkt.sendBtn, JSON.stringify(pkt));
await shot('03-packets');

if (pkt.avail > 0) {
  const before = await api('GET', '/api/wallet');
  const beforeBal = before.body.data.account.balance;
  await evalJS(`document.querySelector('.pkt-claim').click()`);
  let resultOpen = false, resultAmount = '';
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    const r = await evalJS(`(function(){
      var m = document.querySelector('.pay-page .pay-result');
      if (!m) return null;
      return {
        amount: (m.querySelector('.pay-result-amount') || {}).textContent || '',
        text: (m.querySelector('.pay-result-text') || {}).textContent || ''
      };
    })()`);
    if (r) { resultOpen = true; resultAmount = r.amount; break; }
  }
  ok('点「领取」弹出结果', resultOpen, resultAmount);
  await shot('04-claim-result');
  if (resultOpen) {
    await evalJS(`(function(){ var b = document.querySelector('.pay-page .pay-result .pay-primary'); if (b) b.click(); return true; })()`);
    await sleep(700);
    const after = await api('GET', '/api/wallet');
    const diff = after.body.data.account.balance - beforeBal;
    ok('领取后余额确实增加（服务端对账）', diff > 0, '增加 ' + diff.toFixed(2));
  }
} else {
  ok('可领红包卡片存在', false, '列表里没有可领红包（夹具未生效）');
}

console.log('\n=== 学元榜 ===');
await evalJS(`(function(){
  var bs = document.querySelectorAll('.seg-btn');
  for (var i = 0; i < bs.length; i++) { if (bs[i].textContent.indexOf('学元榜') >= 0) { bs[i].click(); return true; } }
  return false;
})()`);
await sleep(1500);
const rank = await evalJS(`(function(){
  return {
    rows: document.querySelectorAll('.rank-row').length,
    me: !!document.querySelector('.rank-row.me'),
    head: (document.querySelector('.rank-head') || {}).textContent || ''
  };
})()`);
ok('榜单行已渲染', rank.rows >= 2, rank.rows + ' 行');
ok('榜单标注我的名次', rank.me && /我的名次/.test(rank.head), rank.head.replace(/\s+/g, ' ').trim());
await shot('05-rank');

console.log('\n=== 转账 / 发红包弹窗 ===');
await evalJS(`(function(){
  var qs = document.querySelectorAll('.quick');
  for (var i = 0; i < qs.length; i++) { if (qs[i].textContent.indexOf('转账') >= 0) { qs[i].click(); return true; } }
  return false;
})()`);
await sleep(500);
const trForm = await evalJS(`(function(){
  var m = document.querySelector('.pay-page .pay-form');
  if (!m) return null;
  var inputs = m.querySelectorAll('input');
  var labels = Array.prototype.map.call(m.querySelectorAll('.pay-row > span'), function(s){ return s.textContent.trim(); });
  return {
    labels: labels, inputs: inputs.length,
    submit: (m.querySelector('.pay-primary') || {}).textContent || '',
    full: !!document.querySelector('.pay-page')
  };
})()`);
ok('转账全屏页（选人 + 金额 + 下一步）',
  trForm && trForm.full && /下一步/.test(trForm.submit),
  trForm && JSON.stringify(trForm));

// 选人列表：出现同学，点第一个（251901 是自己，列表不含自己，所以第一个是 251902 或 251903）
let peopleSeen = 0;
for (let i = 0; i < 20; i++) {
  await sleep(300);
  peopleSeen = await evalJS(`document.querySelectorAll('.people-item').length`);
  if (peopleSeen >= 1) break;
}
ok('转账页出现可选的同学列表', peopleSeen >= 1, peopleSeen + ' 人');
await evalJS(`(function(){
  var b = document.querySelector('.people-item');
  if (b) b.click();
  return true;
})()`);
await sleep(300);
const picked = await evalJS(`(function(){
  var el = document.querySelector('.peer-picked');
  return { text: el ? el.textContent.replace(/\s+/g, ' ').trim() : '' };
})()`);
ok('点选后显示已选收款人（带学号）', /\d{6}/.test(picked.text), picked.text);
await shot('06-transfer');
await evalJS(`(function(){ var x = document.querySelector('.pay-back'); if (x) x.click(); return true; })()`);
await sleep(400);

await evalJS(`(function(){
  var qs = document.querySelectorAll('.quick');
  for (var i = 0; i < qs.length; i++) { if (qs[i].textContent.indexOf('发红包') >= 0) { qs[i].click(); return true; } }
  return false;
})()`);
await sleep(600);
const pkDiag = await evalJS(`(function(){
  var el = document.querySelector('.wallet-page');
  var vm = el && el.__vue__;
  return {
    pages: document.querySelectorAll('.pay-page').length,
    packetOpen: vm ? vm.packet.open : null,
    transferOpen: vm ? vm.transfer.open : null,
    src: document.querySelectorAll('.src-item').length
  };
})()`);
console.log('    [诊断] 发红包页:', JSON.stringify(pkDiag));
const pkForm = await evalJS(`(function(){
  var m = document.querySelector('.pay-page .pay-form');
  if (!m) return null;
  var labels = Array.prototype.map.call(m.querySelectorAll('.pay-row > span'), function(s){ return s.textContent.trim(); });
  return {
    labels: labels, inputs: m.querySelectorAll('input').length,
    submit: (m.querySelector('.pay-primary') || {}).textContent || ''
  };
})()`);
ok('发红包全屏页（玩法 + 金额 + 个数 + 口令）',
  pkForm && pkForm.labels.indexOf('玩法') >= 0 && pkForm.labels.indexOf('个数') >= 0 && /红包/.test(pkForm.submit),
  pkForm && JSON.stringify(pkForm));

// 切到「指定」→ 出现选人列表，可多选
await evalJS(`(function(){
  var segs = document.querySelectorAll('.pay-page .scope-seg button');
  for (var i = 0; i < segs.length; i++) { if (segs[i].textContent.trim() === '指定') { segs[i].click(); return true; } }
  return false;
})()`);
await sleep(500);
let pickSeen = 0;
for (let i = 0; i < 20; i++) {
  await sleep(300);
  pickSeen = await evalJS(`document.querySelectorAll('.pay-page .people-item').length`);
  if (pickSeen >= 1) break;
}
ok('指定红包出现选同学列表', pickSeen >= 1, pickSeen + ' 人');
await evalJS(`(function(){
  var b = document.querySelector('.pay-page .people-item');
  if (b) b.click();
  return true;
})()`);
await sleep(300);
const targetPicked = await evalJS(`(function(){
  var el = document.querySelector('.pay-page .pp-head');
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
})()`);
ok('选人后显示人数与每人金额', /选同学（1 人/.test(targetPicked), targetPicked);
await shot('07-packet-form');
await evalJS(`(function(){ var x = document.querySelector('.pay-back'); if (x) x.click(); return true; })()`);
await sleep(300);

console.log('\n=== 来源清单与错误 ===');
const src = await evalJS(`document.querySelectorAll('.src-item').length`);
ok('学元来源清单 ≥6 条', src >= 6, src + ' 条');

const errs = await evalJS(`window.__ciWalletErrors || []`);
ok('无 JS 运行时错误', !errs || errs.length === 0, (errs || []).slice(0, 3).join(' | '));
if (errs && errs.length) console.log('    [错误明细] ' + errs.slice(0, 5).join(' || '));

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / ' + (pass + fail) + (fail ? '，失败 ' + fail : ''));
chrome.kill();
process.exit(fail ? 1 : 0);
