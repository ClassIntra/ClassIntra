// 个人主页全链路 UI 验证（真实 Chrome）
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-profile-ui');
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}

const ME = '251801';
const VIEW = '251800';
const token = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const HASH = '98d5d03a99505d12df72af5468ae2b78ce8e474b1c390bb1a74ea5c1563f24c3';

// 给「被看的人」设头像 + 封面（先确认登录态属于 ME，这里给 ME 自己设）
await fetch(APP + '/api/user/avatar', { method: 'PUT', headers: H, body: JSON.stringify({ hash: HASH, crop: { zoom: 1.5, ox: 0.1, oy: -0.2 } }) });
await fetch(APP + '/api/user/cover', { method: 'PUT', headers: H, body: JSON.stringify({ hash: HASH, crop: { zoom: 1.8, ox: 0.3, oy: -0.4 } }) });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9371',
  `--user-data-dir=${join(tmpdir(), 'ci-prof-ui')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9371${p}`)).json();
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
  // 并行的「雷霆大字」广播层会盖住整屏，截图前先收掉（不影响被测元素本身）
  await ev(`(function(){
    try {
      var app = document.querySelector('#app').__vue__;
      var ov = app && app.$refs && app.$refs.bigTextOverlay;
      if (ov && ov.hide) ov.hide();
    } catch (e) {}
  })()`);
  await new Promise(function(r){ setTimeout(r, 300); });
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

// ---- 1. 看别人（自己以外的视角先跳过，用自己主页测全部功能，再切一个他人页）----
await send('Page.navigate', { url: APP + '/profile/' + ME });
await sleep(6500);

const s1 = await ev(`(function(){
  var cover = document.querySelector('.profile-cover');
  var img = document.querySelector('.profile-cover-img');
  var avatar = document.querySelector('.profile-avatar-slot');
  var posts = document.querySelectorAll('.profile-post');
  var btns = Array.prototype.slice.call(document.querySelectorAll('.profile-actions button'));
  var navTitle = document.querySelector('.navbar-title');
  return {
    navTitle: navTitle ? navTitle.innerText.trim() : null,
    bodyHasHomepageTitle: /的主页/.test(document.body.innerText),
    coverH: cover ? Math.round(cover.getBoundingClientRect().height) : 0,
    coverW: cover ? Math.round(cover.getBoundingClientRect().width) : 0,
    coverImgLoaded: img ? (img.complete && img.naturalWidth > 0) : false,
    coverTransform: img ? getComputedStyle(img).transform.slice(0, 50) : null,
    avatarBox: avatar ? Math.round(avatar.getBoundingClientRect().width) : 0,
    posts: posts.length,
    buttons: btns.map(function(b){ return b.innerText.trim(); })
  };
})()`);
console.log('1 自己主页:', JSON.stringify(s1));
await shot('1-self-profile.png');

// ---- 2. 点头像放大 ----
await ev(`document.querySelector('.profile-avatar-slot').click()`);
await sleep(700);
console.log('2 头像放大:', JSON.stringify(await ev(`(function(){
  var lb = document.querySelector('.profile-lightbox');
  var av = lb && lb.querySelector('.user-avatar');
  var img = av && av.querySelector('.user-avatar-img');
  return { visible: !!lb, size: av ? Math.round(av.getBoundingClientRect().width) : 0,
           imgLoaded: img ? (img.complete && img.naturalWidth > 0) : false };
})()`)));
await shot('2-avatar-zoom.png');
await ev(`document.querySelector('.profile-lightbox').click()`);
await sleep(500);

// ---- 3. 点封面放大 ----
await ev(`document.querySelector('.profile-cover').click()`);
await sleep(700);
console.log('3 封面放大:', JSON.stringify(await ev(`(function(){
  var lb = document.querySelector('.profile-lightbox');
  var inner = lb && lb.querySelector('.profile-lightbox-cover-inner');
  var img = inner && inner.querySelector('img');
  return { visible: !!lb,
           boxW: inner ? Math.round(inner.getBoundingClientRect().width) : 0,
           boxH: inner ? Math.round(inner.getBoundingClientRect().height) : 0,
           loaded: img ? (img.complete && img.naturalWidth > 0) : false };
})()`)));
await shot('3-cover-zoom.png');
await ev(`document.querySelector('.profile-lightbox').click()`);
await sleep(500);

// ---- 4. 帖子列表内容 ----
console.log('4 帖子卡片:', JSON.stringify(await ev(`(function(){
  var ps = Array.prototype.slice.call(document.querySelectorAll('.profile-post'));
  return { count: ps.length,
           first: ps[0] ? { tag: ps[0].querySelector('.profile-post-tag').innerText.trim(),
                            text: ps[0].querySelector('.profile-post-content').innerText.slice(0, 60),
                            meta: ps[0].querySelector('.profile-post-meta').innerText.replace(/\\s+/g,' ').trim() } : null };
})()`)));

// ---- 5. 资料 tab ----
await ev(`(function(){
  var t = Array.prototype.slice.call(document.querySelectorAll('.profile-tab'))
    .filter(function(x){ return x.innerText.trim() === '资料'; })[0];
  if (t) t.click();
})()`);
await sleep(700);
console.log('5 资料 tab:', JSON.stringify(await ev(`(function(){
  var rows = Array.prototype.slice.call(document.querySelectorAll('.profile-info-row'));
  return { keys: rows.map(function(r){ var k=r.querySelector('.k'); return k?k.innerText:'?'; }),
           copyButtons: document.querySelectorAll('.profile-copy-btn').length };
})()`)));
await shot('5-info-tab.png');

// ---- 6. 点帖子跳转 ----
await ev(`(function(){
  var t = Array.prototype.slice.call(document.querySelectorAll('.profile-tab'))
    .filter(function(x){ return /帖子/.test(x.innerText); })[0];
  if (t) t.click();
})()`);
await sleep(700);
const clicked = await ev(`(function(){ var p=document.querySelector('.profile-post'); if(!p) return false; p.click(); return true; })()`);
await sleep(2800);
console.log('6 点帖子:', JSON.stringify(await ev(`location.pathname + location.search`)), '| clicked:', clicked);
await shot('6-post-detail.png');

// ---- 7. 他人主页（关注按钮存在，点赞可点）----
await send('Page.navigate', { url: APP + '/profile/' + VIEW });
await sleep(6000);
const before = await ev(`(function(){
  return Array.prototype.slice.call(document.querySelectorAll('.profile-actions button')).map(function(b){ return b.innerText.trim(); });
})()`);
await ev(`(function(){
  var bs = Array.prototype.slice.call(document.querySelectorAll('.profile-actions button'));
  var f = bs.filter(function(b){ return /关注/.test(b.innerText); })[0];
  if (f) f.click();
})()`);
await sleep(1000);
const after = await ev(`(function(){
  var bs = Array.prototype.slice.call(document.querySelectorAll('.profile-actions button'));
  var stats = Array.prototype.slice.call(document.querySelectorAll('.profile-stat')).map(function(s){
    return s.querySelector('.profile-stat-label').innerText + '=' + s.querySelector('.profile-stat-value').innerText;
  });
  return { buttons: bs.map(function(b){ return b.innerText.trim(); }), stats: stats };
})()`);
console.log('7 他人主页:', JSON.stringify({ before: before, after: after }));
await shot('7-other-profile.png');

// 清理
await fetch(APP + '/api/user/follow/' + VIEW, { method: 'DELETE', headers: H });
await fetch(APP + '/api/user/cover', { method: 'DELETE', headers: H });
ws.close(); chrome.kill();
console.log('DONE ->', OUT);
