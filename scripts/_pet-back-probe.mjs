// 桌宠现场复现探针：① 宠物屋返回按钮是否点得到 ② 气泡/UI 文本是否被 scaleX 镜像
// 走真实客户端 SPA（/pet 路由），stub 只补 API，UI 与路由全是真的。
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-petlive');
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const TOKEN = jwt.sign({ user_id: '251800' }, SECRET, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9391',
  `--user-data-dir=${join(tmpdir(), 'ci-petlive-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9391${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const pageT = (await g('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const x = m.params.exceptionDetails;
    console.error('[页面异常]', String((x.exception && x.exception.description) || x.text).split('\n')[0]);
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
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]);
  }
  return r.result.value;
};
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const f = join(OUT, name);
  writeFileSync(f, Buffer.from(s.data, 'base64'));
  return f;
};
async function tap(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(40);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify({ user_id: '251800', net_name: '探针', real_name: '探针', role: 'admin', is_admin: 1, is_class_admin: 1 }))});
  }catch(e){}`
});

try {
  console.log('-- 打开客户端 --');
  await send('Page.navigate', { url: APP + '/' });
  await sleep(11000);

  await ev(`(function(){
    var app = document.querySelector('#app');
    var vm = app && app.__vue__;
    if (!vm || !vm.$router) return 'no vue';
    vm.$router.push('/pet');
    return 'pushed';
  })()`);
  await sleep(6000);

  const state = await ev(`(function(){
    var nav = document.querySelector('.app-nav-bar');
    var back = document.querySelector('.nav-back');
    var petRoot = document.querySelector('.ci-pethome');
    var r = back ? back.getBoundingClientRect() : null;
    return {
      url: location.pathname,
      hasNav: !!nav, hasBack: !!back,
      petRoot: !!petRoot,
      backRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      navZ: nav ? getComputedStyle(nav).zIndex : null,
      routeName: (function(){ var a=document.querySelector('#app').__vue__; return a&&a.$route?a.$route.name:null; })()
    };
  })()`);
  console.log('进入 /pet:', JSON.stringify(state));

  await (async () => { const f = await shot('pet-home-v2.png'); console.log('宠物屋截图:', f); })();

  // ① 桌宠停在默认右下角时，返回按钮能不能点到
  const hit1 = await ev(`(function(){
    var back = document.querySelector('.nav-back');
    if (!back) return 'no-back';
    var r = back.getBoundingClientRect();
    var el = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
    return {
      topEl: el ? el.tagName + '.' + String(el.className).split(' ')[0] : 'null',
      isBack: !!(el && (el === back || back.contains(el)))
    };
  })()`);
  console.log('① 桌宠在右下角时返回按钮命中:', JSON.stringify(hit1));

  // ② 把桌宠拖到左上角（模拟用户拖拽 / 攀爬到顶），再看返回按钮是否被吃掉
  await ev(`(function(){
    var pet = document.querySelector('.ci-pet');
    if (!pet) return 'no-pet';
    pet.style.transform = 'translate3d(10px, 4px, 0) scaleX(1)';
    return 'moved';
  })()`);
  await sleep(500);
  const hit2 = await ev(`(function(){
    var back = document.querySelector('.nav-back');
    var pet = document.querySelector('.ci-pet');
    if (!back) return 'no-back';
    var r = back.getBoundingClientRect();
    var el = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
    return {
      topEl: el ? el.tagName + '.' + String(el.className).split(' ')[0] : 'null',
      isBack: !!(el && (el === back || back.contains(el))),
      isPet: !!(el && pet && pet.contains(el)),
      petZ: pet ? getComputedStyle(pet).zIndex : null
    };
  })()`);
  console.log('② 桌宠移到左上后返回按钮命中:', JSON.stringify(hit2));
  await shot('pet-nav-blocked.png');

  // ②.5 互动按钮：呼唤 → 桌宠应出气泡（悬浮层在应用之上，当场可见）
  const call = await ev(`(async function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('.ci-pet-bigbtn'));
    var b = btns.filter(function(x){ return (x.textContent || '').indexOf('呼唤') >= 0; })[0];
    if (!b) return 'no-call-btn';
    b.click();
    await new Promise(function(r){ setTimeout(r, 800); });
    var pet = document.querySelector('.ci-pet');
    var bub = pet && pet.querySelector('.ci-pet-bubble');
    return { bubble: bub ? bub.textContent : 'no-bubble' };
  })()`);
  console.log('②.5 呼唤按钮 →', JSON.stringify(call));

  await tap(Math.round(state.backRect.x + state.backRect.w/2), Math.round(state.backRect.y + state.backRect.h/2));
  await sleep(800);
  const after = await ev(`(function(){ var a=document.querySelector('#app').__vue__; return { path: location.pathname, name: a&&a.$route?a.$route.name:null }; })()`);
  console.log('③ 实际点击返回后:', JSON.stringify(after));

  // ④ 文本镜像检查：让桌宠朝左（facing=-1）说话，量气泡的累计缩放
  const mirror = await ev(`(async function(){
    var pet = document.querySelector('.ci-pet');
    if (!pet) return 'no-pet';
    function cumScaleX(node){
      var sx = 1;
      while (node && node !== document.documentElement) {
        var t = getComputedStyle(node).transform;
        if (t && t !== 'none') {
          var m = /matrix\(([^)]+)\)/.exec(t);
          if (m) { sx = sx * parseFloat(m[1].split(',')[0]); }
        }
        node = node.parentElement;
      }
      return sx;
    }
    if (window.__ciPetPoke) window.__ciPetPoke();
    await new Promise(function(r){ setTimeout(r, 600); });
    pet.style.transform = 'translate3d(300px, 400px, 0)';
    var flip = pet.querySelector('.ci-pet-flip');
    if (flip) flip.style.transform = 'scaleX(-1)';
    await new Promise(function(r){ setTimeout(r, 300); });
    var b = pet.querySelector('.ci-pet-bubble');
    return {
      petMovedToLeft: !!flip,
      bubbleText: b ? b.textContent : 'no-bubble',
      bubbleCumScaleX: b ? cumScaleX(b) : null,
      videoCumScaleX: (function(){ var v = pet.querySelector('.ci-pet-video'); return v ? cumScaleX(v) : null; })(),
      flipCumScaleX: flip ? cumScaleX(flip) : null
    };
  })()`);
  console.log('④ 镜像检查（朝左说话时）:', JSON.stringify(mirror));
  await shot('pet-mirror.png');

} catch (e) {
  console.error('探针异常:', e.stack || e.message);
}
ws.close();
chrome.kill();
process.exit(0);
