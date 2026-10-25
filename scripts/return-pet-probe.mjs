// 复现探针：①应用返回卡死 ②桌宠不显示（真实 Chrome，本机 HTTP）
// 流程：登录 → 桌面（查 __ciPetDebug）→ 打开 /pet（AppShell）→ 点返回 → 断言是否回到桌面
//       全程收集控制台 error/warning —— 两只 bug 的真机证据一次拿全
// 用法：node scripts/return-pet-probe.mjs
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-return-probe');
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
// 251800 已领养"小小"——桌宠可见性用这个身份
const ME = '251800';
const token = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9373',
  `--user-data-dir=${join(tmpdir(), 'ci-ret-probe')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9373${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const page = (await g('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pend = new Map();
const consoleLog = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    const p = m.params || {};
    if (p.type === 'error' || p.type === 'warning') {
      const text = (p.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ').slice(0, 300);
      if (text) consoleLog.push('[' + p.type + '] ' + text);
    }
  }
  if (m.method === 'Log.entryAdded') {
    const en = m.params.entry;
    if (en && (en.level === 'error')) consoleLog.push('[log] ' + String(en.text).slice(0, 300));
  }
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const shot = async (n) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, n), Buffer.from(s.data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token',${JSON.stringify(token)});
    localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: ME, net_name: 'probe-admin', is_admin: 1, role: 'admin' }))});
  }catch(e){}`
});

let fail = 0;
const check = (label, ok, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ' — ' + detail : '')); if (!ok) fail++; };

// ---- 1. 桌面 + 桌宠可见性 ----
await send('Page.navigate', { url: APP + '/' });
await sleep(7000);
const dbg1 = await ev('window.__ciPetDebug ? window.__ciPetDebug() : "no-debug"');
check('1a 桌宠悬浮脚本已执行（__ciPetDebug 存在）', dbg1 !== 'no-debug', JSON.stringify(dbg1).slice(0, 200));
if (dbg1 && dbg1 !== 'no-debug') {
  check('1b 桌宠 DOM 在桌面上', dbg1.domMounted === true, JSON.stringify(dbg1));
  await shot('1-desktop-pet.png');
} else {
  await shot('1-desktop-nopet.png');
}

// ---- 2. 打开桌宠应用（AppShell） ----
await send('Page.navigate', { url: APP + '/pet' });
await sleep(6000);
const inApp = await ev(`(function(){
  return {
    path: location.pathname,
    hasShell: !!document.querySelector('.app-shell'),
    hasBack: !!document.querySelector('.nav-back'),
    runtime: !!document.querySelector('.market-runtime-container')
  };
})()`);
check('2 桌宠应用页打开（AppShell + 返回按钮）', inApp.hasShell && inApp.hasBack, JSON.stringify(inApp));
await shot('2-pet-app.png');

// ---- 3. 点返回 → 断言回到桌面 ----
await ev(`document.querySelector('.nav-back').click()`);
await sleep(1500); // 450ms 过渡 + 余量
const after = await ev(`(function(){
  return {
    path: location.pathname,
    desktopMounted: !!document.querySelector('.desktop, .desktop-page, #desktop'),
    appShellStill: !!document.querySelector('.app-shell'),
    bodySnippet: document.body.innerText.slice(0, 60)
  };
})()`);
check('3a 返回后 URL 回桌面', after.path === '/', 'path=' + after.path);
check('3b 返回后 AppShell 已卸载（不困在应用）', !after.appShellStill, 'app-shell 仍存在=' + after.appShellStill);
await shot('3-after-back.png');
if (after.appShellStill || after.path !== '/') {
  // 卡住复现！再等 2s 复查（排除慢机器）
  await sleep(2000);
  const after2 = await ev(`({path: location.pathname, appShellStill: !!document.querySelector('.app-shell')})`);
  check('3c 再等 2s 后仍卡（复现确认）', after2.appShellStill || after2.path !== '/', JSON.stringify(after2));
  await shot('3b-stuck.png');
}

// ---- 4. 汇总控制台错误 ----
const errs = consoleLog.filter(l => l.indexOf('[error]') !== -1 || l.indexOf('[log]') !== -1);
console.log('\n==== 控制台 error 汇总（前 12 条）====');
errs.slice(0, 12).forEach(l => console.log('  ' + l));
if (!errs.length) console.log('  （无 error）');

console.log(fail === 0 ? '\n全部通过 ✔' : `\n${fail} 项失败 ✘`);
chrome.kill();
process.exit(fail === 0 ? 0 : 1);
