// 验证：封面选图走统一底部弹层 + 有图时仍先进选图 + 选中后进裁剪不会被误关
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-cover-unify');
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const ME = '251801';
const token = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const HASH = '98d5d03a99505d12df72af5468ae2b78ce8e474b1c390bb1a74ea5c1563f24c3';

// 先清空封面，验证「首次设置」路径
await fetch(APP + '/api/user/cover', { method: 'DELETE', headers: H });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9385',
  `--user-data-dir=${join(tmpdir(), 'ci-cover-unify-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9385${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const page = (await g('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
const shot = async (n) => {
  await ev(`(function(){ try{ var a=document.querySelector('#app').__vue__; var o=a&&a.$refs&&a.$refs.bigTextOverlay; if(o&&o.hide)o.hide(); }catch(e){} })()`);
  await new Promise(r => setTimeout(r, 300));
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, n), Buffer.from(s.data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token',${JSON.stringify(token)});
    localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: ME, net_name: 'probe', is_admin: 0, role: 'officer' }))});
  }catch(e){}`
});

await send('Page.navigate', { url: APP + '/profile/' + ME });
await sleep(6000);

// ---- 1. 首次设置封面：应先进选图（底部滑出）----
await ev(`(function(){ var b=document.querySelector('.profile-cover-edit'); if(b) b.click(); return !!b; })()`);
await sleep(2200);
console.log('1 选图层:', JSON.stringify(await ev(`(function(){
  var picker=document.querySelector('.cloud-picker-sheet');
  var items=document.querySelectorAll('.picker-item');
  var tabs=document.querySelector('.picker-tabs');
  var fs=document.querySelector('.picker-fullscreen-btn');
  var r=picker?picker.getBoundingClientRect():null;
  return {
    pickerOpen: !!picker,
    items: items.length,
    firstImgLoaded: (function(){ var i=document.querySelector('.picker-item img'); return i?(i.complete&&i.naturalWidth>0):false; })(),
    title: document.querySelector('.picker-header span') ? document.querySelector('.picker-header span').innerText : null,
    hasTypeTabs: !!tabs,
    hasFullscreen: !!fs,
    anchoredBottom: r ? Math.abs(r.bottom - window.innerHeight) < 2 : false,
    sheetW: r ? Math.round(r.width) : 0,
    sheetH: r ? Math.round(r.height) : 0,
    roundedTop: picker ? getComputedStyle(picker).borderTopLeftRadius : null,
    cropStageVisible: !!document.querySelector('.ic-stage')
  };
})()`)));
await shot('1-picker-bottom-sheet.png');

// ---- 2. 选一张 → 应进入裁剪（且整个流程没被 close 掉）----
await ev(`(function(){ var it=document.querySelector('.picker-item'); if(it) it.click(); return !!it; })()`);
await sleep(2000);
console.log('2 裁剪层:', JSON.stringify(await ev(`(function(){
  var sheet=document.querySelector('.ic-sheet');
  var stage=document.querySelector('.ic-stage');
  var img=document.querySelector('.ic-img');
  var pickerStillOpen=!!document.querySelector('.cloud-picker-sheet');
  var r=sheet?sheet.getBoundingClientRect():null;
  return {
    cropOpen: !!sheet,
    pickerStillOpen: pickerStillOpen,
    stage: stage ? Math.round(stage.getBoundingClientRect().width)+'x'+Math.round(stage.getBoundingClientRect().height) : null,
    imgLoaded: img ? (img.complete && img.naturalWidth>0) : false,
    anchoredBottom: r ? Math.abs(r.bottom - window.innerHeight) < 2 : false,
    title: document.querySelector('.ic-title') ? document.querySelector('.ic-title').innerText : null,
    hasGridGuide: !!document.querySelector('.ic-grid-guide')
  };
})()`)));
await shot('2-crop-sheet.png');

// ---- 3. 保存 ----
await ev(`(function(){
  var b=Array.prototype.slice.call(document.querySelectorAll('.ic-actions .ic-btn')).filter(function(x){return /确定/.test(x.innerText)})[0];
  if(b) b.click(); return !!b;
})()`);
await sleep(2500);
console.log('3 保存后:', JSON.stringify(await ev(`(function(){
  var img=document.querySelector('.profile-cover-img');
  return { coverVisible: !!img, coverLoaded: img?(img.complete&&img.naturalWidth>0):false,
           allClosed: !document.querySelector('.ic-sheet') && !document.querySelector('.cloud-picker-sheet'),
           btnText: document.querySelector('.profile-cover-edit') ? document.querySelector('.profile-cover-edit').innerText.trim() : null };
})()`)));
await shot('3-cover-saved.png');

// ---- 4. 再次点「更换封面」：仍应先进选图，且当前图带「当前」角标并置顶 ----
await ev(`(function(){ var b=document.querySelector('.profile-cover-edit'); if(b) b.click(); return !!b; })()`);
await sleep(2200);
console.log('4 二次进入:', JSON.stringify(await ev(`(function(){
  var items=Array.prototype.slice.call(document.querySelectorAll('.picker-item'));
  var badge=document.querySelector('.picker-current');
  var first=items[0];
  return {
    pickerOpen: !!document.querySelector('.cloud-picker-sheet'),
    cropStageVisible: !!document.querySelector('.ic-stage'),
    badgeText: badge ? badge.innerText : null,
    firstHasBadge: !!(first && first.querySelector('.picker-current')),
    firstImgSrc: first && first.querySelector('img') ? first.querySelector('img').getAttribute('src').slice(0, 60) : null,
    isCurrentFirst: !!(first && first.querySelector('.picker-current'))
  };
})()`)));
await shot('4-picker-current-badge.png');

// ---- 5. 头像「重新裁选」应直接进裁剪 ----
await ev(`(function(){
  var x=document.querySelector('.picker-close'); if(x) x.click();
})()`);
await sleep(800);
await ev(`(function(){
  var b=Array.prototype.slice.call(document.querySelectorAll('.profile-actions button')).filter(function(x){return /编辑资料/.test(x.innerText)})[0];
  if(b) b.click(); return !!b;
})()`);
await sleep(2200);
// 先设一个头像，才能出现「重新裁选」
await ev(`(async function(){
  await fetch('/api/user/avatar',{method:'PUT',headers:{'Authorization':'Bearer '+localStorage.getItem('token'),'Content-Type':'application/json'},body:JSON.stringify({hash:${JSON.stringify(HASH)},crop:{zoom:1.5,ox:0,oy:0}})});
  return 'ok';
})()`);
await sleep(1200);
await ev(`(function(){ var b=document.querySelector('.pe-close'); if(b) b.click(); })()`);
await sleep(600);
await ev(`(function(){
  var b=Array.prototype.slice.call(document.querySelectorAll('.profile-actions button')).filter(function(x){return /编辑资料/.test(x.innerText)})[0];
  if(b) b.click(); return !!b;
})()`);
await sleep(2200);
await ev(`(function(){
  var b=Array.prototype.slice.call(document.querySelectorAll('.pe-avatar-side .pe-btn')).filter(function(x){return /重新裁选/.test(x.innerText)})[0];
  if(b) b.click(); return !!b;
})()`);
await sleep(1800);
console.log('5 头像重新裁选:', JSON.stringify(await ev(`(function(){
  return { cropDirect: !!document.querySelector('.ic-stage'),
           pickerOpen: !!document.querySelector('.cloud-picker-sheet'),
           hasCircleRing: !!document.querySelector('.ic-ring') };
})()`)));
await shot('5-avatar-recrop-direct.png');

// 清理
await fetch(APP + '/api/user/cover', { method: 'DELETE', headers: H });
await fetch(APP + '/api/user/avatar', { method: 'DELETE', headers: H });
ws.close(); chrome.kill();
console.log('DONE ->', OUT);
