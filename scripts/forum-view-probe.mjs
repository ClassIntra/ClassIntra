// 验证：论坛双视图——默认瀑布流，头部切换控件可切到旧版列表视图，选择写入 localStorage 且刷新保持
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-forum-view');
mkdirSync(OUT, { recursive: true });

const require = (await import('node:module')).createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const ME = '251801';
const token = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9387',
  `--user-data-dir=${join(tmpdir(), 'ci-forum-view-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9387${p}`)).json();
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

let fail = 0;
const check = (label, ok, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ' — ' + detail : '')); if (!ok) fail++; };
const waitFor = async (expr, timeout) => {
  for (let t = 0; t < timeout; t += 500) {
    if (await ev(`!!(${expr})`)) return true;
    await sleep(500);
  }
  return false;
};

await send('Page.navigate', { url: APP + '/community' });
check('0 页面就绪(切换控件出现)', await waitFor(`document.querySelector('.view-switch .view-switch-btn')`, 25000));
await sleep(1500);

// ---- 1. 切换控件存在，默认瀑布流 ----
check('1a 切换控件两个按钮', await ev(`(function(){ var b=document.querySelectorAll('.view-switch .view-switch-btn'); return b.length === 2; })()`));
check('1b 默认 view-waterfall 类', await ev(`(function(){ var grid=document.querySelector('.waterfall-grid'); return !!grid && grid.classList.contains('view-waterfall') && !grid.classList.contains('view-list'); })()`));
check('1c 默认瀑布流多列(≥3)', await ev(`(function(){ return document.querySelectorAll('.waterfall-grid .waterfall-col').length >= 3; })()`), String(await ev(`document.querySelectorAll('.waterfall-grid .waterfall-col').length`)));
check('1d 瀑布流列 flex 横排', await ev(`(function(){ var grid=document.querySelector('.waterfall-grid'); return getComputedStyle(grid).display === 'flex'; })()`));
await shot('1-waterfall.png');

// ---- 2. 点列表按钮 → 旧版行卡片 ----
await ev(`(function(){ var b=document.querySelectorAll('.view-switch .view-switch-btn')[1]; if(b) b.click(); return !!b; })()`);
await sleep(800);
check('2a 网格切到 view-list', await ev(`(function(){ var grid=document.querySelector('.waterfall-grid'); return !!grid && grid.classList.contains('view-list'); })()`));
check('2b 列表单列铺满', await ev(`(function(){ return document.querySelectorAll('.waterfall-grid .waterfall-col').length === 1; })()`));
check('2c 帖子行布局(row)', await ev(`(function(){ var it=document.querySelector('.waterfall-grid .list-item.post-item'); return !!it && getComputedStyle(it).flexDirection === 'row' && getComputedStyle(it).alignItems === 'flex-start'; })()`));
check('2d 头像恢复显示', await ev(`(function(){ var it=document.querySelector('.waterfall-grid .list-item.post-item'); if(!it) return false; var a=it.querySelector('.user-avatar'); return !!a && getComputedStyle(a).display !== 'none'; })()`));
check('2e 封面退回92px右置', await ev(`(function(){ var it=document.querySelector('.waterfall-grid .list-item.post-item'); if(!it) return false; var f=it.querySelector('.post-cover-frame') || it.querySelector('.post-cover-portrait'); if(!f) return true; var cs=getComputedStyle(f); return parseInt(cs.width) === 92 && parseInt(cs.height) === 92 && parseInt(cs.order) === 2; })()`), JSON.stringify(await ev(`(function(){ var it=document.querySelector('.waterfall-grid .list-item.post-item'); if(!it) return null; var f=it.querySelector('.post-cover-frame') || it.querySelector('.post-cover-portrait'); if(!f) return 'no-cover'; var cs=getComputedStyle(f); return { w: cs.width, h: cs.height, order: cs.order }; })()`)));
await shot('2-list.png');

// ---- 3. localStorage 记忆 + 刷新保持 ----
check('3a 已写入 localStorage', await ev(`(function(){ return localStorage.getItem('classintra_community_forum_view') === 'list'; })()`));
await send('Page.navigate', { url: APP + '/community' });
check('3b 刷新后仍是列表视图', await waitFor(`document.querySelector('.waterfall-grid') && document.querySelector('.waterfall-grid').classList.contains('view-list')`, 25000));

// ---- 4. 切回瀑布流并恢复默认记忆 ----
await ev(`(function(){ var b=document.querySelectorAll('.view-switch .view-switch-btn')[0]; if(b) b.click(); return !!b; })()`);
await sleep(600);
check('4a 切回瀑布流', await ev(`(function(){ var grid=document.querySelector('.waterfall-grid'); return !!grid && grid.classList.contains('view-waterfall') && document.querySelectorAll('.waterfall-col').length >= 3; })()`));

// ---- 5. 旋转/改视口：列数跟随重算（不触发数据变化） ----
await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 1000, deviceScaleFactor: 2, mobile: false });
await sleep(800);
check('5a 竖屏窄视图单列', await ev(`(function(){ return document.querySelectorAll('.waterfall-grid .waterfall-col').length === 1; })()`), String(await ev(`document.querySelectorAll('.waterfall-grid .waterfall-col').length`)));
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await sleep(800);
check('5b 转回横屏恢复4列', await ev(`(function(){ return document.querySelectorAll('.waterfall-grid .waterfall-col').length === 4; })()`), String(await ev(`document.querySelectorAll('.waterfall-grid .waterfall-col').length`)));
await shot('5-back-landscape.png');

await chrome.kill();
console.log(fail === 0 ? '\n=== ALL PASS ===' : '\n=== ' + fail + ' FAIL ===');
process.exit(fail === 0 ? 0 : 1);
