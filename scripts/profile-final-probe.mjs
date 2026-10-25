// 骨架屏布局 + 封禁原因兜底
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-profile-final');
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
const token = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9393',
  `--user-data-dir=${join(tmpdir(), 'ci-profile-final-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9393${p}`)).json();
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
  await new Promise(r => setTimeout(r, 250));
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

// ---- A. 骨架屏：把 loading 强置为 true 截一张 ----
await send('Page.navigate', { url: APP + '/profile/251800' });
await sleep(6000);
await ev(`(function(){
  var el = document.querySelector('.profile-page');
  var vm = el && el.__vue__;
  if (!vm) return 'no-vm';
  vm.loading = true;
  return 'ok';
})()`);
await sleep(700);
console.log('A 骨架屏:', JSON.stringify(await ev(`(function(){
  var sk = document.querySelector('.profile-skeleton');
  if (!sk) return { exists: false };
  var cover = sk.querySelector('.sk-cover');
  var av = sk.querySelector('.sk-avatar');
  var posts = sk.querySelectorAll('.sk-post');
  return {
    exists: true,
    coverH: cover ? Math.round(cover.getBoundingClientRect().height) : 0,
    avatarSize: av ? Math.round(av.getBoundingClientRect().width) : 0,
    postRows: posts.length,
    animated: !!(cover && getComputedStyle(cover).animationName === 'none' && cover.querySelector)
  };
})()`)));
await shot('1-skeleton.png');

// ---- B. 封禁原因兜底 ----
const db = new Database(REPO + '/server/database/classintra.db');
const orig = db.prepare('SELECT status, ban_reason, ban_expires_at FROM users WHERE user_id=?').get(ME);
db.prepare("UPDATE users SET status='disabled', ban_reason='社区刷屏三次（自动封禁）', ban_expires_at=NULL WHERE user_id=?").run(ME);

await send('Page.navigate', { url: APP + '/profile/251800' });
await sleep(6500);
console.log('B 封禁页:', JSON.stringify(await ev(`(function(){
  var body = document.body.innerText;
  return {
    path: location.pathname,
    reasonShown: /社区刷屏三次/.test(body),
    hasFallback: /无法获取封禁详情/.test(body),
    headline: (document.querySelector('.ban-title') || {}).innerText || null
  };
})()`)));
await shot('2-banned-reason.png');

db.prepare('UPDATE users SET status=?, ban_reason=?, ban_expires_at=? WHERE user_id=?').run(orig.status, orig.ban_reason, orig.ban_expires_at, ME);
db.close();
console.log('已复原');

ws.close(); chrome.kill();
console.log('DONE ->', OUT);
