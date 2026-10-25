// 视觉升级 + 帖子分类筛选：截图对比（浅色/深色、有无封面）
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-profile-visual');
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

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9397',
  `--user-data-dir=${join(tmpdir(), 'ci-profile-visual-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9397${p}`)).json();
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
    localStorage.setItem('theme', 'light');
  }catch(e){}`
});

// ---- 1. 浅色 · 无封面（默认渐变）----
await send('Page.navigate', { url: APP + '/profile/' + VIEW });
await sleep(6500);
console.log('1 结构:', JSON.stringify(await ev(`(function(){
  var fallback = document.querySelector('.profile-cover-fallback');
  var filters = Array.prototype.slice.call(document.querySelectorAll('.profile-filter'));
  return {
    hasDefaultGradient: !!(fallback && fallback.style.backgroundImage),
    gradientHead: fallback ? fallback.style.backgroundImage.slice(0, 46) : null,
    hasGlow: !!document.querySelector('.profile-cover-glow'),
    hasMesh: !!document.querySelector('.profile-cover-mesh'),
    filters: filters.map(function(f){ return f.innerText.trim() + (f.classList.contains('active') ? '*' : ''); }),
    posts: document.querySelectorAll('.profile-post').length,
    statsBorderTop: getComputedStyle(document.querySelector('.profile-stats')).borderTopWidth
  };
})()`)));
await shot('1-light-no-cover.png');

// ---- 2. 切到「美食」分类 ----
await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('.profile-filter'))
    .filter(function(x){ return x.innerText.trim() === '美食'; })[0];
  if (b) b.click(); return !!b;
})()`);
await sleep(2200);
console.log('2 美食分类:', JSON.stringify(await ev(`(function(){
  var active = document.querySelector('.profile-filter.active');
  var tags = Array.prototype.slice.call(document.querySelectorAll('.profile-post-tag')).map(function(t){return t.innerText.trim()});
  return { active: active ? active.innerText.trim() : null,
           posts: document.querySelectorAll('.profile-post').length,
           tags: tags };
})()`)));
await shot('2-tab-food.png');

// ---- 3. 回到全部 + 深色主题 ----
await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('.profile-filter'))
    .filter(function(x){ return x.innerText.trim() === '全部'; })[0];
  if (b) b.click();
  var app = document.querySelector('#app').__vue__;
  if (app && app.$store) app.$store.commit('settings/SET_THEME', 'dark');
})()`);
await sleep(2500);
console.log('3 深色:', JSON.stringify(await ev(`(function(){
  return { theme: document.documentElement.getAttribute('data-theme'),
           posts: document.querySelectorAll('.profile-post').length };
})()`)));
await shot('3-dark-all.png');

// ---- 4. 深色 + 有封面（设一张再进）----
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
await fetch(APP + '/api/user/cover', {
  method: 'PUT', headers: H,
  body: JSON.stringify({ hash: '98d5d03a99505d12df72af5468ae2b78ce8e474b1c390bb1a74ea5c1563f24c3', crop: { zoom: 1.6, ox: 0.1, oy: -0.2 } })
});
await send('Page.navigate', { url: APP + '/profile/' + ME });
await sleep(6000);
console.log('4 自己主页(有封面):', JSON.stringify(await ev(`(function(){
  var img = document.querySelector('.profile-cover-img');
  return { coverLoaded: img ? (img.complete && img.naturalWidth > 0) : false,
           hasFallback: !!document.querySelector('.profile-cover-fallback'),
           filters: document.querySelectorAll('.profile-filter').length,
           actions: Array.prototype.slice.call(document.querySelectorAll('.profile-actions button')).map(function(b){return b.innerText.trim()}) };
})()`)));
await shot('4-dark-with-cover.png');

await fetch(APP + '/api/user/cover', { method: 'DELETE', headers: H });
ws.close(); chrome.kill();
console.log('DONE ->', OUT);
