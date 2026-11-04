// 桌面 → 钱包 冒烟（CDP）：验证系统应用真的被注册到桌面、点得开
// 用法（仓库根）：node scripts/probe-wallet-desktop.mjs
// 目标：18i 生产 :9001（只读页面，不领钱不转账）

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const jwt = require('../server/node_modules/jsonwebtoken');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = 'http://127.0.0.1:9001';
const CDP_PORT = 9335;
const VW = 1043, VH = 787;
const SHOTS = 'D:/NetWork/Integration/ClassIntra/.workbuddy/tmp/wallet-test/shots';
mkdirSync(SHOTS, { recursive: true });

const env = readFileSync('D:/NetWork/Integration/ClassIntra/server/.env', 'utf8');
const secret = (env.match(/^JWT_SECRET=(.*)$/m) || [])[1].trim();
const token = jwt.sign({ user_id: '251800', is_admin: 1, is_class_admin: 1, role: 'admin' }, secret, { expiresIn: '2h' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n + (d ? '（' + d + '）' : ''))) : (fail++, console.log('  ✗ ' + n + (d ? ' → ' + d : ''))); };

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-wallet-desktop-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', '--window-size=' + VW + ',' + VH, 'about:blank'
], { stdio: 'ignore' });

async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('Chrome 未启动'); process.exit(1); }
let page = null;
for (let i = 0; i < 40; i++) { const l = await getJSON('/json/list'); page = l.find(t => t.type === 'page'); if (page) break; await sleep(400); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
async function shot(n) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, n + '.png'), Buffer.from(r.data, 'base64')); }

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{ localStorage.setItem('token', ${JSON.stringify(token)}); }catch(e){}
  window.__errs=[];window.addEventListener('error',e=>window.__errs.push(e.message));`
});

console.log('\n=== 桌面 ===');
await send('Page.navigate', { url: APP + '/desktop' });
await sleep(1500);
let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(400);
  ready = await evalJS(`document.querySelectorAll('.app-icon').length > 0 && !document.getElementById('app-loading')`);
  if (ready) break;
}
ok('桌面图标渲染', ready);

const icons = await evalJS(`(function(){
  return Array.prototype.map.call(document.querySelectorAll('.app-icon'), function(el){
    var img = el.querySelector('img');
    return {
      text: img ? (img.getAttribute('alt') || '') : el.textContent.replace(/\s+/g, ' ').trim(),
      src: img ? img.getAttribute('src') : ''
    };
  });
})()`);
const walletIcon = (icons || []).find(x => /学元钱包/.test(x.text) || /学元钱包/.test(x.alt || ''));
ok('桌面出现「学元钱包」', !!walletIcon, (icons || []).length + ' 个图标');
ok('钱包图标指向 Wallet.svg', !!walletIcon && /Wallet\.svg/.test(walletIcon.src), walletIcon && walletIcon.src);
await shot('08-desktop');

if (walletIcon) {
  await evalJS(`(function(){
    var els = document.querySelectorAll('.app-icon');
    for (var i = 0; i < els.length; i++) {
      var img = els[i].querySelector('img');
      var alt = img ? (img.getAttribute('alt') || '') : '';
      if (els[i].textContent.indexOf('学元钱包') >= 0 || alt.indexOf('学元钱包') >= 0) { els[i].click(); return true; }
    }
    return false;
  })()`);
  let opened = false;
  for (let i = 0; i < 50; i++) {
    await sleep(400);
    opened = await evalJS(`!!document.querySelector('.wallet-page')`);
    if (opened) break;
  }
  ok('点击图标打开钱包', opened, await evalJS(`location.pathname`));
  const bal = await evalJS(`(document.querySelector('.bal-amount') || {}).textContent || ''`);
  ok('钱包余额有值', /[\d,]+\.\d{2}/.test(bal), bal);
  await shot('09-desktop-opened');
}

const errs = await evalJS(`window.__errs || []`);
ok('无 JS 错误', !errs || errs.length === 0, (errs || []).slice(0, 3).join(' | '));

console.log('\n通过 ' + pass + ' / ' + (pass + fail) + (fail ? '，失败 ' + fail : ''));
chrome.kill();
process.exit(fail ? 1 : 0);
