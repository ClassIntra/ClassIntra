// 闪烁地面真值探针：不看 readyState，直接连拍宠物区域截图，比对像素
// 判据：宠物所在区域若出现「几乎全是背景色」的帧 = 内容消失 = 闪
// 用法：node scripts/_pet-flicker-pixel.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-pet-pixel');
mkdirSync(OUT, { recursive: true });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9396',
  `--user-data-dir=${join(tmpdir(), 'ci-pet-pixel-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9396${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const pageT = (await g('/json/list')).find((t) => t.type === 'page');
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
  if (r.exceptionDetails) throw new Error('页面异常: ' + String((r.exceptionDetails.exception && r.exceptionDetails.description) || r.exceptionDetails.text).split('\n')[0]);
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

// 纯色背景：任何"内容消失"都会裸露成大红，便于像素判定
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/market-static/pet/frontend/style.css">
<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#FF0000}</style>
</head><body></body></html>`;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
ws.onmessage = (function (orig) {
  return function (e) {
    const m = JSON.parse(e.data);
    if (m.method === 'Fetch.requestPaused') {
      const url = m.params.request.paused ? '' : m.params.request.url;
      if (/harness-pxl/.test(url)) {
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
  await send('Page.navigate', { url: APP + '/harness-pxl.html' });
  await sleep(1200);
  await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/overlay.js'; document.head.appendChild(s); return 1; })()`);
  await sleep(1000);
  await ev(`window.__ovl.mount(document.body, window.ClassIntraMarket.createContext('pet', {}))`);
  await sleep(2800);

  // 定位宠物精确矩形（含所有子图层）
  const rect = await ev(`(function(){
    var pet = document.querySelector('.ci-pet');
    if (!pet) return null;
    var r = pet.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  console.log('宠物矩形:', JSON.stringify(rect));
  if (!rect) { console.error('✗ 桌宠未挂载'); process.exit(1); }

  const clip = { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 };
  const shot = async (tag) => {
    const s = await send('Page.captureScreenshot', { format: 'png', clip });
    const buf = Buffer.from(s.data, 'base64');
    writeFileSync(join(OUT, tag + '.png'), buf);
    return buf;
  };

  // 基准：静置时的画面（宠物正常显示）
  await sleep(600);
  const base = await shot('00-base');
  console.log('基准帧已存:', base.length, 'bytes');

  // 连拍：一边高频戳，一边抓帧
  const frames = [];
  const N = 40;
  for (let i = 0; i < N; i++) {
    await ev(`(function(){ if (window.__ciPetPoke) window.__ciPetPoke(); return 1; })()`);
    const f = await shot('f' + String(i).padStart(2, '0'));
    frames.push(f);
  }
  console.log('连拍帧数:', frames.length);

  // 像素判定：统计每帧非背景（非纯红）像素占比
  // PNG 需解码 —— 用 canvas 在页面内解，避免引入图像库
  const ratios = await ev(`(function(){
    var urls = ${JSON.stringify(frames.map((_, i) => '/_probe/f' + String(i).padStart(2, '0') + '.png'))};
    return null;
  })()`).catch(() => null);

  // 页面内解码方案：把 PNG 以 data URL 送进页面用 canvas 统计
  const statOne = async (buf) => {
    const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
    return await ev(`(function(){
      return new Promise(function(res){
        var img = new Image();
        img.onload = function(){
          var c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          var g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          var d = g.getImageData(0, 0, c.width, c.height).data;
          var total = 0, nonBg = 0;
          for (var i = 0; i < d.length; i += 4) {
            total++;
            // 背景 = 纯红(255,0,0)；允许极小容差
            if (!(d[i] > 240 && d[i+1] < 20 && d[i+2] < 20)) nonBg++;
          }
          res({ total: total, nonBg: nonBg, ratio: +(nonBg / total).toFixed(4) });
        };
        img.onerror = function(){ res(null); };
        img.src = ${JSON.stringify(dataUrl)};
      });
    })()`);
  };

  const baseStat = await statOne(base);
  console.log('基准帧非背景占比:', JSON.stringify(baseStat));

  let blank = 0;
  const bad = [];
  for (let i = 0; i < frames.length; i++) {
    const st = await statOne(frames[i]);
    if (!st) { console.error('  帧', i, '解码失败'); continue; }
    const rel = baseStat && baseStat.ratio > 0 ? st.ratio / baseStat.ratio : 1;
    if (rel < 0.35) { blank++; bad.push({ i: i, ratio: st.ratio, rel: +rel.toFixed(3) }); }
  }

  console.log('\n===== 结果 =====');
  console.log(`连拍 ${frames.length} 帧 · 内容缺失(<基准35%)帧=${blank}`);
  if (bad.length) console.log('缺失样例:', JSON.stringify(bad.slice(0, 10)));
  console.log('截图目录:', OUT);
  process.exit(blank === 0 ? 0 : 2);
} catch (e) {
  console.error('✗ 探针异常:', e.message);
  process.exit(1);
} finally {
  try { ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
