// 个人主页：关注名单弹层 + 被禁用用户不再显示成"没发过帖子"
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-profile-polish');
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
const Database = require(REPO + '/server/node_modules/better-sqlite3');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const ME = '251801';
const VIEW = '251800';
const token = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

// 造一条关注关系，让"关注"列表非空
await fetch(APP + '/api/user/follow/' + VIEW, { method: 'POST', headers: H });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9391',
  `--user-data-dir=${join(tmpdir(), 'ci-profile-polish-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9391${p}`)).json();
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

// ---- 1. 正常主页：统计项可点 ----
await send('Page.navigate', { url: APP + '/profile/' + VIEW });
await sleep(6500);
console.log('1 统计区:', JSON.stringify(await ev(`(function(){
  var stats = Array.prototype.slice.call(document.querySelectorAll('.profile-stat'));
  return {
    count: stats.length,
    items: stats.map(function(s){
      return (s.querySelector('.profile-stat-label')||{}).innerText + '=' + (s.querySelector('.profile-stat-value')||{}).innerText + (s.classList.contains('profile-stat--action')?'(可点)':'');
    }),
    posts: document.querySelectorAll('.profile-post').length,
    sentinel: !!document.querySelector('.profile-sentinel'),
    sentinelText: document.querySelector('.profile-sentinel') ? document.querySelector('.profile-sentinel').innerText.trim() : null
  };
})()`)));
await shot('1-profile-stats.png');

// ---- 2. 点粉丝 → 名单弹层 ----
await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('.profile-stat--action'))
    .filter(function(x){ return /粉丝/.test(x.innerText); })[0];
  if (b) b.click(); return !!b;
})()`);
await sleep(2200);
console.log('2 粉丝名单:', JSON.stringify(await ev(`(function(){
  var sheet = document.querySelector('.fl-sheet');
  if (!sheet) return { open: false };
  var rows = Array.prototype.slice.call(document.querySelectorAll('.fl-row'));
  var r = sheet.getBoundingClientRect();
  return {
    open: true,
    title: document.querySelector('.fl-title').innerText,
    count: document.querySelector('.fl-count') ? document.querySelector('.fl-count').innerText : null,
    rows: rows.length,
    anchoredBottom: Math.abs(r.bottom - window.innerHeight) < 2,
    firstRow: rows[0] ? {
      name: rows[0].querySelector('.fl-name').innerText.trim(),
      sign: rows[0].querySelector('.fl-sign').innerText.trim().slice(0, 20),
      btn: rows[0].querySelector('.fl-btn') ? rows[0].querySelector('.fl-btn').innerText.trim() : null
    } : null
  };
})()`)));
await shot('2-followers-sheet.png');

// ---- 3. 在名单里点关注 ----
const before3 = await ev(`(function(){
  var b = document.querySelector('.fl-row .fl-btn'); return b ? b.innerText.trim() : null;
})()`);
await ev(`(function(){ var b=document.querySelector('.fl-row .fl-btn'); if(b) b.click(); })()`);
await sleep(1200);
console.log('3 名单内关注:', JSON.stringify({ before: before3, after: await ev(`(function(){
  var b = document.querySelector('.fl-row .fl-btn'); return b ? b.innerText.trim() : null;
})()`) }));

await ev(`(function(){ var b=document.querySelector('.fl-close'); if(b) b.click(); })()`);
await sleep(900);

// ---- 4. 关注 tab ----
await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('.profile-stat--action'))
    .filter(function(x){ return /关注/.test(x.innerText); })[0];
  if (b) b.click(); return !!b;
})()`);
await sleep(2000);
console.log('4 关注名单:', JSON.stringify(await ev(`(function(){
  return { title: document.querySelector('.fl-title') ? document.querySelector('.fl-title').innerText : null,
           rows: document.querySelectorAll('.fl-row').length };
})()`)));
await shot('3-following-sheet.png');
await ev(`(function(){ var b=document.querySelector('.fl-close'); if(b) b.click(); })()`);
await sleep(600);

// ---- 5. 关键：把当前账号临时禁用，看主页是否还会谎报"没发过帖子" ----
const db = new Database(REPO + '/server/database/classintra.db');
const orig = db.prepare('SELECT status, ban_reason, ban_expires_at FROM users WHERE user_id=?').get(ME);
db.prepare("UPDATE users SET status='disabled', ban_reason='社区违规（探针）', ban_expires_at=NULL WHERE user_id=?").run(ME);

await send('Page.navigate', { url: APP + '/profile/' + VIEW });
await sleep(6500);

const banned = await ev(`(function(){
  var body = document.body.innerText;
  return {
    onBannedRoute: location.pathname,
    hasEmptyPostsText: /还没有发过公开的帖子|还没有发过帖子/.test(body),
    hasErrorState: !!document.querySelector('.profile-state--error'),
    errorTitle: document.querySelector('.profile-state--error > span') ? document.querySelector('.profile-state--error > span').innerText : null,
    errorHint: document.querySelector('.profile-state-hint') ? document.querySelector('.profile-state-hint').innerText : null,
    postsErrorCard: !!document.querySelector('.profile-empty--error')
  };
})()`);
console.log('5 被禁用后进入主页:', JSON.stringify(banned));
await shot('4-banned-view.png');

// 复原
db.prepare('UPDATE users SET status=?, ban_reason=?, ban_expires_at=? WHERE user_id=?').run(orig.status, orig.ban_reason, orig.ban_expires_at, ME);
db.close();
await fetch(APP + '/api/user/follow/' + VIEW, { method: 'DELETE', headers: H });
console.log('已复原');

ws.close(); chrome.kill();
console.log('DONE ->', OUT);
