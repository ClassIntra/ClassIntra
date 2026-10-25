// 聊天气泡头像 + 个人主页 验证（251801，含图片头像闭环）
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const USER = '251801';
const HASH = '98d5d03a99505d12df72af5468ae2b78ce8e474b1c390bb1a74ea5c1563f24c3';
const OUT = join(tmpdir(), 'ci-chat-avatar'); mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: USER }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

const setRes = await fetch(APP + '/api/user/avatar', {
  method: 'PUT', headers: H,
  body: JSON.stringify({ hash: HASH, crop: { zoom: 1.6, ox: 0.2, oy: -0.3 } })
});
console.log('0 给自己设头像:', setRes.status);

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9355', `--user-data-dir=${join(tmpdir(), 'ci-chat-avatar-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });
const getJSON = async (p) => (await fetch(`http://127.0.0.1:9355${p}`)).json();
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
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, n), Buffer.from(s.data, 'base64')); return join(OUT, n); };

// ---- 1. 打开聊天 ----
await send('Page.navigate', { url: APP + '/chat' });
await sleep(6000);
console.log('1 聊天页:', JSON.stringify(await evalJS(`(function(){
  var bubbles = Array.prototype.slice.call(document.querySelectorAll('.chat-bubble'));
  var withAvatar = bubbles.filter(function(b){ return b.querySelector('.bubble-avatar'); });
  var withImg = bubbles.filter(function(b){ var i=b.querySelector('.bubble-avatar .user-avatar-img'); return i && i.complete && i.naturalWidth>0; });
  var own = bubbles.filter(function(b){ var a=b.querySelector('.bubble-avatar'); return a && b.classList.contains('own-bubble'); });
  var ownRight = null;
  if (own[0]) {
    var av = own[0].querySelector('.bubble-avatar').getBoundingClientRect();
    var bb = own[0].getBoundingClientRect();
    ownRight = av.left > bb.left + bb.width/2;
  }
  return {
    bubbles: bubbles.length,
    withAvatar: withAvatar.length,
    withImgAvatar: withImg.length,
    ownAvatarOnRight: ownRight,
    sampleSrc: withImg[0] ? withImg[0].querySelector('.bubble-avatar .user-avatar-img').getAttribute('src').slice(0,50) : null
  };
})()`)));
await shot('1-chat.png');

// ---- 2. 点气泡头像 → 个人主页 ----
const before = await evalJS('location.pathname + location.search');
await evalJS(`(function(){
  var el = document.querySelector('.bubble-avatar .user-avatar') || document.querySelector('.bubble-avatar');
  if (el) el.click();
})()`);
await sleep(2500);
const after = await evalJS('location.pathname + location.search');
console.log('2 点头像跳转:', before, '→', after);

// ---- 3. 个人主页渲染 ----
console.log('3 个人主页:', JSON.stringify(await evalJS(`(function(){
  var page = document.querySelector('.profile-page');
  if (!page) return 'no-page';
  var av = page.querySelector('.profile-hero-avatar .user-avatar-img');
  return {
    name: (page.querySelector('.profile-name')||{}).textContent,
    hasAvatarImg: !!av,
    avatarLoaded: av ? (av.complete && av.naturalWidth>0) : false,
    avatarTransform: av ? getComputedStyle(av).transform.slice(0,50) : null,
    stats: Array.prototype.slice.call(page.querySelectorAll('.profile-stat-value')).map(function(e){return e.textContent;}),
    infoRows: page.querySelectorAll('.profile-info-row').length,
    actions: Array.prototype.slice.call(page.querySelectorAll('.profile-btn')).map(function(b){return b.textContent.trim();})
  };
})()`)));
await shot('2-profile.png');

// ---- 4. 社区点头像也应进同一页 ----
await send('Page.navigate', { url: APP + '/community' });
await sleep(5500);
await evalJS(`(function(){
  var av = document.querySelector('.user-avatar');
  if (av) av.click();
})()`);
await sleep(2200);
console.log('4 社区点头像 →', await evalJS('location.pathname'));

// ---- 5. 还原头像 ----
const del = await fetch(APP + '/api/user/avatar', { method: 'DELETE', headers: H });
console.log('5 还原:', del.status);

ws.close(); chrome.kill();
console.log('截图:', OUT);
