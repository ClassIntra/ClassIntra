// 集市（MarketStreet）UI / 滚动探针
// ------------------------------------------------------------
// 目标实例：隔离实例 http://127.0.0.1:9099（生产库副本），绝不碰 9001。
// 覆盖：牌楼渲染 / 摊位卡布局 / 卖家昵称 / 价格口径 / 面板可滚动 / 无横向溢出 / 三种视口截图
//
// 用法：node scripts/_probe-market-street.mjs [--shots]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const CWD = process.cwd();
const PORT = 9099;
const WS_PORT = 9098;
const CDP_PORT = 9351;
const PROD = process.argv.includes('--prod');
const APP = PROD ? 'http://127.0.0.1:9001' : `http://127.0.0.1:${PORT}`;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WORK = 'D:/tmp/ci-market-street';
const SHOTS = join(WORK, 'shots');
const DB = join(WORK, 'probe.db');
const ME = '251800';
const WANT_SHOTS = process.argv.includes('--shots');
const REAL_ONLY = process.argv.includes('--real');
const LIGHT = process.argv.includes('--light');

mkdirSync(SHOTS, { recursive: true });
try { rmSync(DB, { force: true }); } catch (e) {}

const require = createRequire(REPO + '/server/node_modules/');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');

// ---------- 1. 副本库 + 造真实形状的货 ----------
if (PROD) {
  console.log('✓ 生产只读巡检（不建副本、不 seed、不写库）');
} else {
  const src = new Database(REPO + '/server/database/classintra.db', { readonly: true });
  src.exec(`VACUUM INTO '${DB}'`);
  src.close();
}

const db = PROD ? null : new Database(DB);
if (PROD) {
  // 已在上面提示
} else if (REAL_ONLY) {
  db.close();
  console.log('✓ 副本库就绪（真实态：不 seed，看用户此刻真的会看到什么）');
} else {
  const platformAcct = db.prepare("SELECT id FROM xy_ledger_accounts WHERE kind='platform' LIMIT 1").get().id;
  const acctOf = (uid) => {
    const a = db.prepare("SELECT id FROM xy_ledger_accounts WHERE kind='user' AND owner_id=?").get(String(uid));
    if (a) return a.id;
    const info = db.prepare("INSERT INTO xy_ledger_accounts (kind,owner_id,allow_negative,status,created_at) VALUES ('user',?,0,'active',datetime('now'))").run(String(uid));
    return Number(info.lastInsertRowid);
  };
  const insGood = db.prepare('INSERT INTO xy_ledger_goods (seller_account_id,name,price_cent,cost_cent,kind,status) VALUES (?,?,?,?,?,?)');
  insGood.run(platformAcct, '定制班徽贴纸（10 张）', 1200, 800, 'physical', 'on_shelf');
  insGood.run(platformAcct, '自习室靠窗座位 · 一周', 5000, 0, 'service', 'on_shelf');
  insGood.run(acctOf('250806'), '手绘小头像（电子稿）', 350, 0, 'digital', 'on_shelf');
  insGood.run(acctOf('250806'), '绝版漫画 · 全 12 册', 8800, 6000, 'physical', 'on_shelf');
  insGood.run(acctOf('251819'), '帮你讲一道导数题', 800, 0, 'service', 'on_shelf');
  insGood.run(acctOf(ME), '闲置台灯（九成新）', 1500, 0, 'physical', 'on_shelf');
  insGood.run(acctOf(ME), '旧版错题本', 300, 0, 'physical', 'off_shelf');
  db.close();
  console.log('✓ 副本库就绪（seed 6 件在售 / 2 件我的货）');
}

// ---------- 2. 起隔离 server ----------
const env = { ...process.env, PORT: String(PORT), WS_PORT: String(WS_PORT), DB_PATH: DB, NODE_ENV: 'production' };
// 不把副本实例挂到生产中继上
delete env.RELAY_SERVERS;
const serverCwd = join(REPO, 'server');
const nodeExe = process.execPath;
let srv = null;
if (!PROD) {
  srv = spawn(nodeExe, ['src/app.js'], { cwd: serverCwd, env, stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill(); } catch (e) {} });
}
let up = false;
for (let i = 0; i < 120; i++) {
  try { const r = await fetch(APP + '/api/health'); if (r.ok) { up = true; break; } } catch (e) {}
  await sleep(500);
}
if (!up) { console.error('✗ 实例未起来:', APP); process.exit(1); }
console.log('✓ 实例就绪', APP);

// ---------- 3. Chrome + CDP ----------
let SECRET = null;
for (const line of readFileSync(join(serverCwd, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ 未读到 JWT_SECRET'); process.exit(1); }
const token = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '2h' });

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
};

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-ms-probe-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--disable-features=OverscrollHistoryNavigation',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

const getJSON = async (p) => (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json();
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch (e) { await sleep(400); } }
if (!ver) { console.error('✗ Chrome 未启动'); process.exit(1); }
let page = null;
for (let i = 0; i < 40; i++) { page = (await getJSON('/json/list')).find(t => t.type === 'page'); if (page) break; await sleep(300); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => {
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
  if (r && r.exceptionDetails) throw new Error('页面内异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r && r.result ? r.result.value : undefined;
}
async function waitFor(expr, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await evalJS(expr)) return true; } catch (e) {}
    await sleep(250);
  }
  return false;
}
async function shot(name, vw, vh) {
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 2, mobile: true });
  await sleep(700);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log('  📷', name);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token', ${JSON.stringify(token)});
    localStorage.setItem('user', JSON.stringify({user_id:'${ME}', net_name:'探针同学', is_admin:0}));
    ${LIGHT ? "localStorage.setItem('theme','light'); document.documentElement.setAttribute('data-theme','light');" : ''}
  }catch(e){}`
});
await send('Page.navigate', { url: APP + '/community?tab=market' });

const booted = await waitFor("!!document.querySelector('.market-street .ms-gate')", 20000);
console.log('\n=== 渲染 ===');
ok(booted, '集市面板已挂载（牌楼出现）');
if (!booted) {
  const html = await evalJS('document.body.innerHTML.slice(0,400)');
  console.log('  页面片段:', html);
}

await waitFor("document.querySelectorAll('.ms-stall').length > 0", 10000);
const stats = await evalJS(`(function(){
  var panel=document.querySelector('.market-panel');
  var stalls=document.querySelectorAll('.ms-stall');
  return {
    stalls: stalls.length,
    official: document.querySelectorAll('.ms-stall.official').length,
    peer: document.querySelectorAll('.ms-stall.peer').length,
    awning: document.querySelectorAll('.ms-awning').length,
    priceTags: document.querySelectorAll('.ms-price-tag').length,
    firstName: (document.querySelector('.ms-stall-name')||{}).textContent,
    firstPrice: (document.querySelector('.ms-price-tag b')||{}).textContent,
    firstSeller: (document.querySelector('.ms-seller')||{}).textContent,
    panelScrollH: panel ? panel.scrollHeight : 0,
    panelClientH: panel ? panel.clientHeight : 0,
    panelScrollW: panel ? panel.scrollWidth : 0,
    panelClientW: panel ? panel.clientWidth : 0,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
    box: (function(){
      function m(sel){ var e=document.querySelector(sel); if(!e) return null;
        var r=e.getBoundingClientRect(), cs=getComputedStyle(e);
        return {w: Math.round(r.width), cssW: cs.width, pad: cs.paddingLeft+'/'+cs.paddingRight,
                display: cs.display, flexDir: cs.flexDirection, maxW: cs.maxWidth}; }
      return { panel: m('.market-panel'), street: m('.market-street'), grid: m('.ms-grid'), block: m('.ms-block') };
    })()
  };
})()`);
console.log('  统计:', JSON.stringify(stats));

console.log('\n=== 布局 ===');
// 不写死条数：生产库随时可能有真货上架，只校验「渲染 == 计算属性」的结构自洽
const vmCounts = await evalJS(`(function(){
  var vm=document.querySelector('.market-street').__vue__;
  return { official: vm.official.length, peer: vm.peerStalls.length,
           myGoods: (vm.myGoods||[]).length, goods: vm.goods.length };
})()`);
console.log('  计算属性:', JSON.stringify(vmCounts));
ok(stats.stalls === vmCounts.official + vmCounts.peer, '摊位卡数 == 官铺 + 同学摊', 
  { rendered: stats.stalls, sum: vmCounts.official + vmCounts.peer });
ok(stats.official === vmCounts.official, '官铺渲染数一致', { rendered: stats.official, vm: vmCounts.official });
ok(stats.peer === vmCounts.peer, '同学摊渲染数一致', { rendered: stats.peer, vm: vmCounts.peer });
if (!REAL_ONLY && !PROD) {
  ok(stats.official >= 2, '官铺至少渲染出 seed 的 2 件', stats.official);
  ok(stats.peer >= 4, '同学摊至少渲染出 seed 的 4 件', stats.peer);
}
ok(stats.priceTags === stats.stalls, '每摊都有价签', { tags: stats.priceTags, stalls: stats.stalls });

// 价格口径：拿页面上的显示值和接口数据逐条对，避免「学元当分传」缩小 100 倍
const priceCheck = await evalJS(`(function(){
  var vm = document.querySelector('.market-street').__vue__;
  if (!vm) return {err:'no vm'};
  var bad = [];
  var cards = document.querySelectorAll('.ms-stall');
  for (var i=0;i<cards.length;i++){
    var nameEl = cards[i].querySelector('.ms-stall-name');
    var priceEl = cards[i].querySelector('.ms-price-tag b');
    if (!nameEl || !priceEl) { bad.push('缺元素'); continue; }
    var nm = nameEl.textContent.trim();
    var g = vm.goods.filter(function(x){return x.name===nm;})[0];
    if (!g) { bad.push('未匹配:'+nm); continue; }
    var want = (Number(g.price_cent)/100);
    want = (want % 1 === 0) ? String(want) : want.toFixed(2);
    if (priceEl.textContent.trim() !== want) bad.push(nm+': 显示'+priceEl.textContent.trim()+' 应为'+want);
  }
  return {checked: cards.length, bad: bad};
})()`);
ok(priceCheck && priceCheck.bad && priceCheck.bad.length === 0,
  '价格口径逐条正确（分 → 学元）', priceCheck && priceCheck.bad);

// 卖家昵称：必须来自 users 表，而不是只显示学号
const sellerCheck = await evalJS(`(function(){
  var vm = document.querySelector('.market-street').__vue__;
  var names = (vm.peerStalls||[]).map(function(g){return g.seller_name||'';}).filter(Boolean);
  var shown = [].map.call(document.querySelectorAll('.ms-seller'), function(el){return el.textContent.trim();});
  return {withName: names.length, peer: (vm.peerStalls||[]).length, shown: shown, myGoods: (vm.myGoods||[]).length};
})()`);
console.log('  卖家:', JSON.stringify(sellerCheck));
ok(sellerCheck && sellerCheck.withName === sellerCheck.peer, '同学摊卖家昵称全部来自 users 表', sellerCheck);
if (!REAL_ONLY && !PROD) {
  ok(sellerCheck && sellerCheck.myGoods >= 1, '「我的货」能拉到自己那份（不因 store 缺失而误报 0）', sellerCheck && sellerCheck.myGoods);
}

console.log('\n=== 滚动（用户报的「滑不动」）===');
ok(stats.panelScrollH > stats.panelClientH, '面板内容高于视口（本该可滚）',
  { scrollH: stats.panelScrollH, clientH: stats.panelClientH });
const scrolled = await evalJS(`(function(){
  var p=document.querySelector('.market-panel');
  if(!p) return {err:'no panel'};
  p.scrollTop = 320;
  var after = p.scrollTop;
  return { before: 0, after: after, overflowY: getComputedStyle(p).overflowY };
})()`);
ok(scrolled && scrolled.after > 200, 'scrollTop 能真的滚起来', scrolled);
ok(scrolled && scrolled.overflowY === 'auto', '面板 overflow-y:auto', scrolled && scrolled.overflowY);

console.log('\n=== 交互 ===');
// 点摊位 → 柜台结账弹层
const counter = await evalJS(`(function(){
  var card = document.querySelector('.ms-stall');
  if (!card) return {err:'no card'};
  card.click();
  return {clicked: true};
})()`);
const counterShown = await waitFor("!!document.querySelector('.ms-counter')", 8000);
ok(counterShown, '点摊位能打开柜台结账', counter);
if (counterShown) {
  const cInfo = await evalJS(`(function(){
    var c=document.querySelector('.ms-counter');
    var rows=c.querySelectorAll('.ms-counter-row');
    var btn=c.querySelector('.ms-btn.primary');
    return { rows: rows.length, name: (c.querySelector('.ms-counter-name')||{}).textContent,
             btnText: btn ? btn.textContent.trim() : '', btnDisabled: btn ? btn.disabled : null };
  })()`);
  console.log('  柜台:', JSON.stringify(cInfo));
  ok(cInfo && cInfo.rows >= 2, '柜台显示价格与余额两行', cInfo);
  ok(cInfo && /付钱拿下|余额不足/.test(cInfo.btnText), '主按钮文案正确', cInfo && cInfo.btnText);
  await evalJS("var x=document.querySelector('.ms-counter .ms-x'); if(x) x.click();");
  const closed = await waitFor("!document.querySelector('.ms-counter')", 4000);
  ok(closed, '柜台能关掉');
}

// 摆摊表单：填齐后按钮解除禁用
const formOk = await evalJS(`(function(){
  var vm=document.querySelector('.market-street').__vue__;
  var btn=[].filter.call(document.querySelectorAll('.ms-btn.primary'), function(b){return /开张摆上|摆摊中/.test(b.textContent);})[0];
  if(!btn) return {err:'no btn'};
  var before = btn.disabled;
  vm.form.name='探针测试货'; vm.form.price='2.5';
  return new Promise(function(res){
    setTimeout(function(){
      var b2=[].filter.call(document.querySelectorAll('.ms-btn.primary'), function(b){return /开张摆上|摆摊中/.test(b.textContent);})[0];
      res({ before: before, after: b2 ? b2.disabled : null });
    }, 300);
  });
})()`);
ok(formOk && formOk.before === true && formOk.after === false, '填齐商品名与售价后按钮可用（不误禁用）', formOk);

console.log('\n=== 横向溢出 ===');
ok(stats.panelScrollW <= stats.panelClientW + 1, '面板无横向溢出',
  { scrollW: stats.panelScrollW, clientW: stats.panelClientW });
ok(stats.docScrollW <= stats.docClientW + 1, '页面无横向滚动条',
  { docScrollW: stats.docScrollW, docClientW: stats.docClientW });

// 列数：宽度被挤缩时每行只会排 2 列，这一条专门守住 width:100%
const cols = await evalJS(`(function(){
  var grids = document.querySelectorAll('.ms-grid');
  var rows = [], widths = {};
  for (var g=0; g<grids.length; g++){
    var cards = grids[g].querySelectorAll('.ms-stall');
    if (!cards.length) continue;
    var top0 = cards[0].offsetTop, n = 0;
    for (var i=0;i<cards.length;i++){
      if (Math.abs(cards[i].offsetTop - top0) < 2) n++;
      widths[Math.round(cards[i].getBoundingClientRect().width)] = 1;
    }
    rows.push({ inGrid: cards.length, firstRow: n });
  }
  return { rows: rows, widths: Object.keys(widths).map(Number), gridW: Math.round(grids[0].getBoundingClientRect().width) };
})()`);
const maxFirstRow = cols && cols.rows ? Math.max.apply(null, cols.rows.map(r => r.firstRow)) : 0;
// 只有一两条货时本来就不该成行，仅对「≥3 件」的网格校验列数
const dense = cols && cols.rows ? cols.rows.filter(r => r.inGrid >= 3) : [];
if (dense.length) ok(maxFirstRow >= 3, '每行至少排 3 列（宽度没被挤缩）', cols);
else console.log('  · 商品不足 3 件，跳过列数断言');
ok(cols && cols.widths.length === 1, '所有摊位卡等宽', cols && cols.widths);

if (WANT_SHOTS) {
  console.log('\n=== 截图 ===');
  const tag = PROD ? 'prod-' : (REAL_ONLY ? 'real-' : '');
  const themeTag = LIGHT ? 'light-' : '';
  // 等启动屏彻底淡出，否则第一张会拍到 splash
  await waitFor("!document.querySelector('.app-splash, .splash, #splash')", 6000);
  await sleep(1600);
  await evalJS("var p=document.querySelector('.market-panel'); if(p) p.scrollTop=0;");
  await shot(tag + themeTag + '1-desktop-top', 1043, 787);
  await evalJS("var p=document.querySelector('.market-panel'); if(p) p.scrollTop=440;");
  await shot(tag + themeTag + '2-desktop-peer', 1043, 787);
  await evalJS("var p=document.querySelector('.market-panel'); if(p) p.scrollTop=1000;");
  await shot(tag + themeTag + '3-desktop-mine', 1043, 787);
  await evalJS("var p=document.querySelector('.market-panel'); if(p) p.scrollTop=0;");
  await shot(tag + '4-narrow-top', 720, 900);
  await evalJS("var p=document.querySelector('.market-panel'); if(p) p.scrollTop=880;");
  await shot(tag + '5-narrow-mine', 720, 900);
}

console.log('\n────────────────────────────');
console.log(`通过 ${pass} / 失败 ${fail}`);
try { ws.close(); } catch (e) {}
process.exit(fail ? 1 : 0);
