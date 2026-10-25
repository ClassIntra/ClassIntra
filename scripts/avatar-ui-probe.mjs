// 头像系统 UI 验证：设置页 → 云盘选图 → 缩放裁选 → 保存 → 社区生效
// 用真实持有云盘图片的用户 251801；结束前调 DELETE 还原，不污染生产数据。
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const USER = '251801';
const OUT = join(tmpdir(), 'ci-avatar-ui'); mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: USER }, SECRET, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9353', `--user-data-dir=${join(tmpdir(), 'ci-avatar-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });
const getJSON = async (p) => (await fetch(`http://127.0.0.1:9353${p}`)).json();
for (let i = 0; i < 60; i++) { try { await getJSON('/json/version'); break; } catch { await sleep(500); } }
let page = null;
for (let i = 0; i < 40; i++) { page = (await getJSON('/json/list')).find(t => t.type === 'page'); if (page) break; await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}` });

const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(s.data, 'base64'));
  return join(OUT, name);
};

// ---- 1. 设置页 ----
await send('Page.navigate', { url: APP + '/settings' });
await sleep(4500);
console.log('1 设置页头像行:', JSON.stringify(await evalJS(`(function(){
  var row = Array.prototype.slice.call(document.querySelectorAll('.form-row'))
    .filter(function(r){ return (r.textContent||'').indexOf('头像图片') !== -1; })[0];
  if (!row) return 'no-row';
  var btn = row.querySelector('.avatar-image-btn');
  var img = row.querySelector('.user-avatar-img');
  return { btn: btn ? btn.textContent.trim() : null, hasImg: !!img, imgSrc: img ? img.getAttribute('src') : null };
})()`)));

// ---- 2. 打开裁剪器 ----
await evalJS(`(function(){
  var row = Array.prototype.slice.call(document.querySelectorAll('.form-row'))
    .filter(function(r){ return (r.textContent||'').indexOf('头像图片') !== -1; })[0];
  row.querySelector('.avatar-image-btn').click();
})()`);
await sleep(1500);
console.log('2 裁剪器打开:', await evalJS(`!!document.querySelector('.ac-sheet')`), '| 云盘图片数:', await evalJS(`document.querySelectorAll('.ac-item').length`));
await shot('1-cropper-pick.png');

// ---- 3. 选第一张图 ----
await evalJS(`(function(){ var it = document.querySelector('.ac-item'); if (it) it.click(); })()`);
await sleep(1500);
const cropState = await evalJS(`(function(){
  var stage = document.querySelector('.ac-stage');
  var img = document.querySelector('.ac-img');
  return {
    step: !!document.querySelector('.ac-stage'),
    stageSize: stage ? Math.round(stage.getBoundingClientRect().width) : 0,
    imgLoaded: img ? (img.complete && img.naturalWidth > 0) : false,
    nat: img ? [img.naturalWidth, img.naturalHeight] : null,
    transform: img ? getComputedStyle(img).transform.slice(0, 60) : null,
    ringVisible: !!document.querySelector('.ac-ring')
  };
})()`);
console.log('3 进入裁剪态:', JSON.stringify(cropState));
await shot('2-cropper-crop.png');

// ---- 4. 拖动 + 缩放 ----
await evalJS(`(function(){
  var stage = document.querySelector('.ac-stage');
  var r = stage.getBoundingClientRect();
  var cx = r.left + r.width/2, cy = r.top + r.height/2;
  function pe(type, x, y, id) {
    stage.dispatchEvent(new PointerEvent(type, { pointerId: id||1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }
  pe('pointerdown', cx, cy);
  pe('pointermove', cx + 40, cy + 25);
  pe('pointerup', cx + 40, cy + 25);
  var zoom = document.querySelector('.ac-zoom');
  zoom.value = '2.4';
  zoom.dispatchEvent(new Event('input', { bubbles: true }));
  zoom.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(600);
console.log('4 拖动+缩放后 transform:', await evalJS(`(function(){ var i=document.querySelector('.ac-img'); return i ? getComputedStyle(i).transform.slice(0,70) : null; })()`));
await shot('3-cropper-zoomed.png');

// ---- 5. 保存 ----
await evalJS(`(function(){
  var btns = Array.prototype.slice.call(document.querySelectorAll('.ac-btn'));
  var ok = btns.filter(function(b){ return b.textContent.trim() === '确定'; })[0];
  if (ok) ok.click();
})()`);
await sleep(2000);
console.log('5 保存后设置页:', JSON.stringify(await evalJS(`(function(){
  var row = Array.prototype.slice.call(document.querySelectorAll('.form-row'))
    .filter(function(r){ return (r.textContent||'').indexOf('头像图片') !== -1; })[0];
  var btn = row.querySelector('.avatar-image-btn');
  var img = row.querySelector('.user-avatar-img');
  var ghost = row.querySelector('.avatar-image-btn--ghost');
  return {
    btn: btn ? btn.textContent.trim() : null,
    hasImg: !!img,
    imgLoaded: img ? (img.complete && img.naturalWidth > 0) : false,
    imgTransform: img ? getComputedStyle(img).transform.slice(0, 60) : null,
    hasRestoreBtn: !!ghost
  };
})()`)));
await shot('4-settings-saved.png');

// ---- 6. 社区里看别人视角 ----
await send('Network.enable');
const batchHits = [];
ws.addEventListener('message', (ev) => {
  try {
    const m = JSON.parse(ev.data);
    if (m.method === 'Network.responseReceived' && /\/api\/user\/avatar\/batch/.test(m.params.response.url)) {
      batchHits.push({ status: m.params.response.status, url: m.params.response.url.slice(-60) });
    }
  } catch (e) {}
});
await send('Page.navigate', { url: APP + '/community' });
await sleep(5000);
console.log('6 社区 batch 请求:', JSON.stringify(batchHits));
console.log('  社区头像统计:', JSON.stringify(await evalJS(`(function(){
  var avs = Array.prototype.slice.call(document.querySelectorAll('.user-avatar'));
  var imgs = avs.filter(function(a){ return a.querySelector('.user-avatar-img'); });
  return { total: avs.length, withImg: imgs.length };
})()`)));
await shot('5-community.png');

// ---- 7. 还原 ----
await send('Page.navigate', { url: APP + '/settings' });
await sleep(3500);
await evalJS(`(function(){
  var row = Array.prototype.slice.call(document.querySelectorAll('.form-row'))
    .filter(function(r){ return (r.textContent||'').indexOf('头像图片') !== -1; })[0];
  var ghost = row.querySelector('.avatar-image-btn--ghost');
  if (ghost) ghost.click();
})()`);
await sleep(800);
await evalJS(`(function(){
  var btns = Array.prototype.slice.call(document.querySelectorAll('.modal-btn-confirm'));
  if (btns[0]) btns[0].click();
})()`);
await sleep(1500);
console.log('7 还原后:', JSON.stringify(await evalJS(`(function(){
  var row = Array.prototype.slice.call(document.querySelectorAll('.form-row'))
    .filter(function(r){ return (r.textContent||'').indexOf('头像图片') !== -1; })[0];
  return { btn: (row.querySelector('.avatar-image-btn')||{}).textContent, hasImg: !!row.querySelector('.user-avatar-img') };
})()`)));

ws.close(); chrome.kill();
console.log('截图目录:', OUT);
