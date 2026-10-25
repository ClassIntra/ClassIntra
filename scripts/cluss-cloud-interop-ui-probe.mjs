// 验证：云盘页互通 UI——「从 Cluss 导入」弹窗列文件并可导入、批量「导出到 Cluss」弹窗预检并执行
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const CLUSS = 'http://127.0.0.1:9003';
const OUT = join(tmpdir(), 'ci-cluss-interop-ui');
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const ME = '251801';
const TOKEN = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '1h' });

// ---- 造数据：本盘一个 txt（导出用）+ Cluss 一个 txt（导入用）----
const stamp = Date.now();
const CI_NAME = 'UI探针-' + stamp + '.txt';
const CLUSS_NAME = 'Cluss侧-' + stamp + '.txt';

async function uploadTxt(base, name, content) {
  const boundary = 'probe' + stamp + (base === CLUSS ? 'b' : 'a');
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  const res = await fetch(base + '/api/cloud/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'multipart/form-data; boundary=' + boundary },
    body
  });
  return ((await res.json()).data) || null;
}
const ciFile = await uploadTxt(APP, CI_NAME, 'ui probe export ' + stamp);
const clussFile = await uploadTxt(CLUSS, CLUSS_NAME, 'ui probe import ' + stamp);
if (!ciFile || !ciFile.hash || !clussFile || !clussFile.hash) {
  console.log('FAIL 前置上传失败', JSON.stringify({ ciFile, clussFile }));
  process.exit(1);
}

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9389',
  `--user-data-dir=${join(tmpdir(), 'ci-cluss-interop-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9389${p}`)).json();
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
const waitFor = async (expr, timeout) => {
  for (let t = 0; t < timeout; t += 500) {
    if (await ev(`!!(${expr})`)) return true;
    await sleep(500);
  }
  return false;
};
const clickNav = async (title) => ev(`(function(){ var b=document.querySelectorAll('.nav-action-btn'); for(var i=0;i<b.length;i++){ if(b[i].getAttribute('title')==='${title}'){ b[i].click(); return true; } } return false; })()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token',${JSON.stringify(TOKEN)});
    localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: ME, net_name: 'probe', is_admin: 0, role: 'officer' }))});
  }catch(e){}`
});

let fail = 0;
const check = (label, ok, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ' — ' + detail : '')); if (!ok) fail++; };

await send('Page.navigate', { url: APP + '/cloud' });
check('0 云盘页就绪', await waitFor(`document.querySelector('.file-card, .empty-state, .review-list')`, 25000));
await sleep(1500);

// ---- 1. 「从 Cluss 导入」入口 + 弹窗列文件 + 执行导入 ----
check('1a 顶部有「从 Cluss 导入」按钮', await ev(`(function(){ var b=document.querySelectorAll('.nav-action-btn'); for(var i=0;i<b.length;i++){ if(b[i].getAttribute('title')==='从 Cluss 导入') return true; } return false; })()`));
await clickNav('从 Cluss 导入');
check('1b 导入弹窗出现并列出 Cluss 文件', await waitFor(`document.querySelector('.cluss-file-list--scroll .cluss-file-row')`, 15000));
check('1c 列表含刚传的 Cluss 文件', await ev(`(function(){ var rows=document.querySelectorAll('.cluss-file-list--scroll .cluss-file-name'); for(var i=0;i<rows.length;i++){ if(rows[i].textContent.indexOf('${CLUSS_NAME}')>-1) return true; } return false; })()`));
check('1d 配额提示可见', await ev(`(function(){ var h=document.querySelector('.cluss-hint'); return !!h && h.textContent.indexOf('Cluss 已用') > -1; })()`));
await shot('1-import-modal.png');
await ev(`(function(){ var cb=document.querySelector('.cluss-file-list--scroll input[type="checkbox"]'); if(cb) cb.click(); return !!cb; })()`);
await ev(`(function(){ var b=document.querySelector('.cluss-sheet .btn-confirm'); if(b) b.click(); return !!b; })()`);
check('1e 导入执行成功(结果打勾)', await waitFor(`document.querySelector('.cluss-results .cluss-ok')`, 15000));
await ev(`(function(){ var b=document.querySelector('.cluss-sheet .btn-cancel'); if(b) b.click(); return !!b; })()`);
await sleep(1000);

// ---- 2. 批量「导出到 Cluss」入口 + 预检 + 执行 ----
await clickNav('批量管理');
await sleep(500);
check('2a 多选模式下点中文件', await ev(`(function(){ var c=document.querySelector('.file-card'); if(!c) return false; c.click(); return true; })()`));
check('2b 批量栏出现「导出到 Cluss」', await waitFor(`(function(){ var bs=document.querySelectorAll('.batch-actions button'); for(var i=0;i<bs.length;i++){ if(bs[i].textContent.indexOf('导出到 Cluss')>-1) return true; } return false; })()`, 8000));
await ev(`(function(){ var bs=document.querySelectorAll('.batch-actions button'); for(var i=0;i<bs.length;i++){ if(bs[i].textContent.indexOf('导出到 Cluss')>-1){ bs[i].click(); return true; } } return false; })()`);
check('2c 导出预检弹窗出现', await waitFor(`document.querySelector('.cluss-file-list .cluss-file-row')`, 8000));
check('2d 预检通过(打勾)', await ev(`(function(){ return !!document.querySelector('.cluss-file-list .cluss-ok'); })()`));
await shot('2-export-modal.png');
await ev(`(function(){ var b=document.querySelector('.cluss-sheet .btn-confirm'); if(b) b.click(); return !!b; })()`);
check('2e 导出成功(弹窗自动关闭)', await waitFor(`!document.querySelector('.cluss-sheet')`, 15000));
await shot('3-after-export.png');

// ---- 善后：清测试文件 ----
async function cleanup() {
  const del = async (url) => { try { await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + TOKEN } }); } catch (e) {} };
  if (ciFile && ciFile.hash) await del(APP + '/api/cloud/files/' + ciFile.hash);
  if (clussFile && clussFile.hash) await del(CLUSS + '/api/cloud/files/' + clussFile.hash);
  try {
    const r = await fetch(APP + '/api/cloud/files', { headers: { Authorization: 'Bearer ' + TOKEN } });
    const files = ((await r.json()).data || {}).files || [];
    for (const f of files) {
      if (f.name === CLUSS_NAME || f.name === CI_NAME) await del(APP + '/api/cloud/files/' + f.hash);
    }
  } catch (e) {}
  console.log('cleanup: 测试文件已清除');
}
await cleanup();
await chrome.kill();
console.log(fail === 0 ? '\n=== ALL PASS ===' : '\n=== ' + fail + ' FAIL ===');
process.exit(fail === 0 ? 0 : 1);
