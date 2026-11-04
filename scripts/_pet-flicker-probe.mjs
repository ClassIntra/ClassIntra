// 连点闪烁定位探针：高频点击桌宠，逐帧记录「可见像素来自哪里」
// 判定空窗 = 视频不透明但 readyState<2（无数据） 或 视频/幕布都不透明 = 两个图层都没像素
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-petflicker');
mkdirSync(OUT, { recursive: true });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9394',
  `--user-data-dir=${join(tmpdir(), 'ci-petflicker-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9394${p}`)).json();
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
  if (r.exceptionDetails) throw new Error('页面异常: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]);
  return r.result.value;
};

const STUB = `
window.ClassIntraMarket = {
  apps: {},
  _api: function(verb, url){
    var st = { adopted: true, name: '大肥鱼', bond: 40, enabled: true, design: { type: 'video', character: 'dsh-whale' } };
    return new Promise(function(res){
      setTimeout(function(){
        if (/level\\/info/.test(url)) return res({ data: { code: 200, data: { level: 3 } } });
        if (/\\/pet\\/interact/.test(url)) return res({ data: { code: 200, data: { state: st, gained: 1 } } });
        res({ data: { code: 200, data: { state: st, palette: [], templates: [] } } });
      }, 5);
    });
  },
  createContext: function(){
    var S = window.ClassIntraMarket;
    return {
      data: {
        api: {
          get: function(u){ return S._api('get', u); },
          put: function(u, b){ return S._api('put', u, b); },
          post: function(u, b){ return S._api('post', u, b); }
        },
        storage: {
          get: function(k, d){ try { var v = JSON.parse(localStorage.getItem('ci:app:pet:' + k)); return v === null ? d : v; } catch(e){ return d; } },
          set: function(k, v){ try { localStorage.setItem('ci:app:pet:' + k, JSON.stringify(v)); } catch(e){} }
        },
        realtime: null
      },
      app: { onDestroy: function(){} },
      system: { toast: function(){} }
    };
  },
  defineOverlay: function(d){ window.__ovl = d; }
};
`;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/market-static/pet/frontend/style.css">
<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:radial-gradient(circle at 50% 40%,#2b4a5e,#101820)}</style>
</head><body></body></html>`;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
ws.onmessage = (function(orig) {
  return function(e) {
    const m = JSON.parse(e.data);
    if (m.method === 'Fetch.requestPaused') {
      const url = m.params.request.paused ? '' : m.params.request.url;
      if (/harness-ovl/.test(url)) {
        send('Fetch.fulfillRequest', {
          requestId: m.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: b64(HTML)
        }).catch(() => {});
      } else {
        send('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {});
      }
    }
    orig(e);
  };
})(ws.onmessage);

await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*harness*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

try {
  await send('Page.navigate', { url: APP + '/harness-ovl.html' });
  await sleep(1200);
  await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/overlay.js'; document.head.appendChild(s); return 1; })()`);
  await sleep(1000);
  await ev(`window.__ovl.mount(document.body, window.ClassIntraMarket.createContext('pet', {}))`);
  await sleep(2600);

  const ready = await ev(`(function(){
    var v = document.querySelector('.ci-pet-video');
    return v ? { rs: v.readyState, w: v.videoWidth, paused: v.paused, src: (v.getAttribute('src')||'').split('/').pop() } : 'no-video';
  })()`);
  console.log('初始状态:', JSON.stringify(ready));

  // 采样器：每帧记录图层可见性 + 视频数据可用性
  await ev(`(function(){
    var pet = document.querySelector('.ci-pet');
    var v = pet.querySelector('.ci-pet-video');
    window.__log = [];
    window.__run = true;
    var lastSrc = v.getAttribute('src');
    function tick(){
      if (!window.__run) return;
      var f = pet.querySelector('.ci-pet-freeze');
      var vo = v.style.opacity === '' ? '1' : v.style.opacity;
      var fo = f ? (f.style.opacity === '' ? '0' : f.style.opacity) : 'none';
      // 幕布靠 z-index 压在 video 上方才是"遮挡中"（z=3），z=1 = 已降到视频之下
      var fz = f ? (f.style.zIndex || 'auto') : 'none';
      var src = v.getAttribute('src') || '';
      var fpix = -1;
      if (f && f.width && fo === '1' && fpix === -1) {
        try {
          var d = f.getContext('2d').getImageData(0, 0, f.width, f.height).data;
          var n = 0;
          for (var i = 3; i < d.length; i += 4 * 97) { if (d[i] > 8) n++; }
          fpix = n;
        } catch (e) { fpix = -2; }
      }
      window.__log.push({
        t: Math.round(performance.now()),
        vo: vo, fo: fo, fz: fz, rs: v.readyState, paused: v.paused,
        src: src.split('/').pop().slice(0, 12),
        changed: src !== lastSrc,
        fpix: fpix
      });
      lastSrc = src;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return 'sampling';
  })()`);

  // 连点 12 次，间隔 260ms（模拟学生手指快速戳）
  for (let i = 0; i < 20; i++) {
    await ev(`(function(){ if (window.__ciPetPoke) window.__ciPetPoke(); return 1; })()`);
    await sleep(60);
  }
  await sleep(400);
  const log = await ev(`(function(){ window.__run = false; return window.__log; })()`);

  // ⚠️ 判据按当前 z-index 模型（2026-10-26）：
  //    幕布「遮挡中」= opacity=1 且 zIndex=3（压在 video 上方）。
  //    所以 vo=1/fo=1 不是空窗 —— 屏幕上是幕布那张有像素的留存帧。
  //    真正的裸露只有一个形态：视频可见(vo=1) 且 幕布没在遮挡(fo≠1 或 fz≠3) 且 rs<2。
  const covered = (f) => f.fo === '1' && f.fz === '3';
  const gaps = log.filter(f => f.vo !== '0' && !covered(f) && f.rs < 2);
  // 双图层都没像素（纯透明窗口）
  const bothHidden = log.filter(f => f.vo === '0' && !covered(f));
  const srcChanges = log.filter(f => f.changed).length;

  console.log(`\n总帧数=${log.length} · 换源次数=${srcChanges}`);
  console.log(`空窗帧(裸露无数据)=${gaps.length} · 双图层全隐帧=${bothHidden.length}`);
  const withPix = log.filter(f => f.fo === '1' && typeof f.fpix === 'number' && f.fpix > 0);
  const blankCurtain = log.filter(f => f.fo === '1' && f.fpix === 0);
  console.log(`幕布有像素帧=${withPix.length} · 幕布空白帧=${blankCurtain.length}`);
  if (blankCurtain.length) console.log('幕布空白样例:', JSON.stringify(blankCurtain.slice(0, 4)));
  if (gaps.length) {
    console.log('空窗样例:', JSON.stringify(gaps.slice(0, 8)));
  }
  if (bothHidden.length) {
    console.log('双层全隐样例:', JSON.stringify(bothHidden.slice(0, 8)));
  }

  // 每个动作的切换事件序列（看是否存在 freeze 没生效的切换）
  const seq = [];
  for (let i = 0; i < log.length; i++) {
    if (log[i].changed) {
      const around = log.slice(Math.max(0, i - 2), i + 6).map(f => `${f.vo}/${f.fo}@${f.fz}/rs${f.rs}`);
      seq.push({ at: log[i].t, src: log[i].src, around: around.join(' ') });
    }
  }
  console.log('\n换源序列:');
  seq.forEach(s => console.log(`  ${s.at}ms ${s.src.padEnd(14)} ${s.around}`));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, 'after-clicks.png'), Buffer.from(shot.data, 'base64'));
  console.log('\n截图:', join(OUT, 'after-clicks.png'));
} catch (e) {
  console.error('探针异常:', e.stack || e.message);
}
ws.close();
chrome.kill();
process.exit(0);
