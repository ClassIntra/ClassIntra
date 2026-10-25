// 设置页入口 + 封面裁剪器验证
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-profile-extra');
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

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9374',
  `--user-data-dir=${join(tmpdir(), 'ci-prof-extra')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9374${p}`)).json();
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
  await ev(`(function(){
    try { var app=document.querySelector('#app').__vue__; var ov=app&&app.$refs&&app.$refs.bigTextOverlay; if(ov&&ov.hide) ov.hide(); } catch(e){}
  })()`);
  await new Promise(function (r) { setTimeout(r, 300); });
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

// ---- 1. 设置页「我的主页」入口 ----
await send('Page.navigate', { url: APP + '/settings' });
await sleep(6000);
const s1 = await ev(`(function(){
  var labels = Array.prototype.slice.call(document.querySelectorAll('.form-label')).map(function(l){ return l.innerText.trim(); });
  var entry = Array.prototype.slice.call(document.querySelectorAll('.profile-entry button'))[0];
  return { hasEntry: !!entry, label: entry ? entry.innerText.trim() : null,
           allLabels: labels.slice(0, 12),
           avatarRow: labels.indexOf('头像图片') !== -1 };
})()`);
console.log('1 设置页入口:', JSON.stringify(s1));
await shot('1-settings-entry.png');

// ---- 2. 从设置页跳「我的主页」----
await ev(`(function(){
  var b = document.querySelector('.profile-entry button'); if (b) b.click();
})()`);
await sleep(3500);
console.log('2 跳转结果:', JSON.stringify(await ev(`location.pathname`)));

// ---- 3. 打开封面裁剪器（rect 舞台）----
await ev(`(function(){
  var b = document.querySelector('.profile-cover-edit'); if (b) b.click();
})()`);
await sleep(1200);
const s3 = await ev(`(function(){
  var sheet = document.querySelector('.ic-sheet');
  var stage = document.querySelector('.ic-stage');
  var ring = document.querySelector('.ic-ring');
  var guide = document.querySelector('.ic-grid-guide');
  var title = document.querySelector('.ic-title');
  return {
    open: !!sheet,
    title: title ? title.innerText.trim() : null,
    stageW: stage ? Math.round(stage.getBoundingClientRect().width) : 0,
    stageH: stage ? Math.round(stage.getBoundingClientRect().height) : 0,
    hasCircleRing: !!ring,
    hasGridGuide: !!guide
  };
})()`);
console.log('3 封面裁剪器:', JSON.stringify(s3));
await shot('2-cover-cropper-pick.png');

// 选第一张图进裁剪态
await ev(`(function(){
  var it = document.querySelector('.ic-item'); if (it) it.click();
})()`);
await sleep(1600);
console.log('4 裁剪态:', JSON.stringify(await ev(`(function(){
  var stage = document.querySelector('.ic-stage');
  var img = document.querySelector('.ic-img');
  var zoom = document.querySelector('.ic-zoom');
  return {
    stageW: stage ? Math.round(stage.getBoundingClientRect().width) : 0,
    stageH: stage ? Math.round(stage.getBoundingClientRect().height) : 0,
    imgLoaded: img ? (img.complete && img.naturalWidth > 0) : false,
    transform: img ? getComputedStyle(img).transform.slice(0, 46) : null,
    zoomValue: zoom ? zoom.value : null,
    ratio: stage ? (stage.getBoundingClientRect().width / stage.getBoundingClientRect().height).toFixed(2) : 0
  };
})()`)));
await shot('3-cover-cropper-crop.png');

// ---- 4. 头像裁剪器仍是圆形（回归）----
await send('Page.navigate', { url: APP + '/settings' });
await sleep(5000);
await ev(`(function(){
  var bs = Array.prototype.slice.call(document.querySelectorAll('.avatar-image-btn'));
  var b = bs.filter(function(x){ return /云盘|重新裁选/.test(x.innerText); })[0];
  if (b) b.click();
})()`);
await sleep(1200);
console.log('5 头像裁剪器（回归）:', JSON.stringify(await ev(`(function(){
  var stage = document.querySelector('.ic-stage');
  var ring = document.querySelector('.ic-ring');
  var guide = document.querySelector('.ic-grid-guide');
  return { open: !!document.querySelector('.ic-sheet'),
           stageW: stage ? Math.round(stage.getBoundingClientRect().width) : 0,
           stageH: stage ? Math.round(stage.getBoundingClientRect().height) : 0,
           hasCircleRing: !!ring, hasGridGuide: !!guide };
})()`)));
await shot('4-avatar-cropper.png');

ws.close(); chrome.kill();
console.log('DONE ->', OUT);
