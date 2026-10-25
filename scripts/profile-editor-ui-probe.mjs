// 设置页精简 + 个人主页编辑面板 UI 验证
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-profile-editor');
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
  '--headless=new', '--remote-debugging-port=9377',
  `--user-data-dir=${join(tmpdir(), 'ci-prof-editor')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9377${p}`)).json();
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

// ---- 1. 设置页只剩基础信息 ----
await send('Page.navigate', { url: APP + '/settings' });
await sleep(6000);
console.log('1 设置页:', JSON.stringify(await ev(`(function(){
  var labels = Array.prototype.slice.call(document.querySelectorAll('.form-label')).map(function(l){ return l.innerText.trim(); });
  var navs = Array.prototype.slice.call(document.querySelectorAll('.nav-label')).map(function(n){ return n.innerText.trim(); });
  var moved = document.querySelector('.moved-card');
  return {
    title: document.querySelector('.section-title') ? document.querySelector('.section-title').innerText.trim() : null,
    labels: labels.slice(0, 8),
    navs: navs,
    hasMovedCard: !!moved,
    movedBtn: moved && moved.querySelector('.moved-card-btn') ? moved.querySelector('.moved-card-btn').innerText.trim() : null,
    hasAvatarPicker: !!document.querySelector('.avatar-color-picker'),
    hasSignatureField: labels.indexOf('个人签名') !== -1
  };
})()`)));
await shot('1-settings-basic.png');

// ---- 2. 跳个人主页 → 编辑资料 ----
await ev(`document.querySelector('.moved-card-btn').click()`);
await sleep(3000);
console.log('2 跳转:', JSON.stringify(await ev(`location.pathname`)));

await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('.profile-actions button'))
    .filter(function(x){ return /编辑资料/.test(x.innerText); })[0];
  if (b) b.click();
})()`);
await sleep(2200);

console.log('3 编辑面板:', JSON.stringify(await ev(`(function(){
  var sheet = document.querySelector('.pe-sheet');
  if (!sheet) return { open: false };
  var titles = Array.prototype.slice.call(sheet.querySelectorAll('.pe-section-title')).map(function(t){ return t.innerText.trim().split('\\n')[0]; });
  var labels = Array.prototype.slice.call(sheet.querySelectorAll('.pe-label')).map(function(l){ return l.innerText.trim(); });
  var locks = sheet.querySelectorAll('.pe-lock').length;
  var lockedOn = sheet.querySelectorAll('.pe-lock.private').length;
  var sw = sheet.querySelector('.pe-switch');
  return {
    open: true,
    title: sheet.querySelector('.pe-title').innerText.trim(),
    sections: titles,
    labels: labels,
    lockCount: locks,
    lockOn: lockedOn,
    hideRealNameOn: sw ? sw.classList.contains('on') : null,
    hasColorPicker: !!sheet.querySelector('.pe-color-row'),
    hasCoverRow: !!sheet.querySelector('.pe-cover-row'),
    signatureValue: sheet.querySelector('.pe-input[placeholder*="介绍"]') ? sheet.querySelector('.pe-input[placeholder*="介绍"]').value : null
  };
})()`)));
await shot('2-editor.png');

// ---- 4. 改签名并保存 ----
const newSig = '探针写入 · ' + new Date().toISOString().slice(11, 19);
await ev(`(function(){
  var inp = document.querySelector('.pe-input[placeholder*="介绍"]');
  if (!inp) return false;
  inp.value = ${JSON.stringify(newSig)};
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(500);
await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('.pe-footer .pe-btn'))
    .filter(function(x){ return /保存/.test(x.innerText); })[0];
  if (b) b.click();
})()`);
await sleep(2500);
console.log('4 保存后:', JSON.stringify(await ev(`(function(){
  return { editorClosed: !document.querySelector('.pe-sheet'),
           signatureOnPage: document.querySelector('.profile-signature') ? document.querySelector('.profile-signature').innerText.trim() : null };
})()`)));
await shot('3-after-save.png');

// ---- 5. 复原签名 ----
await fetch(APP + '/api/community/profile', {
  method: 'PUT',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    signature: '春赏百花冬观雪，醒亦念卿，梦亦念卿',
    privacy_settings: { wechat: false, qq: false, phone: false, address: false, birthday: false, hide_real_name: true }
  })
});

ws.close(); chrome.kill();
console.log('DONE ->', OUT);
