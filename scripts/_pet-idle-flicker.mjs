// 自动行为路径闪烁探针：不点击，纯静置观察，抓「待机循环/随机动作/走路/睡觉」路径的空窗
// 判据同样是像素级：宠物区域若出现内容消失帧 = 闪
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-pet-idle');
mkdirSync(OUT, { recursive: true });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9397',
  `--user-data-dir=${join(tmpdir(), 'ci-pet-idle-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9397${p}`)).json();
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
  if (r.exceptionDetails) throw new Error('页面异常: ' + String((r.exceptionDetails && r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]);
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
<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#FF0000}</style>
</head><body></body></html>`;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
ws.onmessage = (function (orig) {
  return function (e) {
    const m = JSON.parse(e.data);
    if (m.method === 'Fetch.requestPaused') {
      const url = m.params.request.paused ? '' : m.params.request.url;
    if (/harness-idle/.test(url)) {
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
  await send('Page.navigate', { url: APP + '/harness-idle.html' });
  await sleep(1200);
  await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/overlay.js'; document.head.appendChild(s); return 1; })()`);
  await sleep(1000);
  await ev(`window.__ovl.mount(document.body, window.ClassIntraMarket.createContext('pet', {}))`);
  await sleep(3000);

  // ⚠️ 判据修正（2026-10-27）：原先只在开头取一次矩形，150 帧全用固定 clip。
  //    静置期间宠物会被随机 roll 派去 walk/dash/climb，一旦走开，矩形里自然变空，
  //    ratio 平滑下降 → 被误判成「内容缺失」。实测 v1 报的 66 帧全是这种假阳性
  //    （缺失从第 84 帧开始 ≈ 17s，正中首次 idle tick 的 14-26s 窗口）。
  //    正解：每帧重新问「宠物你现在在哪」。动态版见 _pet-idle-flicker-v2.mjs。
  const rectNow = () => ev(`(function(){
    var pet = document.querySelector('.ci-pet');
    if (!pet) return null;
    var r = pet.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(Math.max(r.width,8)), h: Math.round(Math.max(r.height,8)) };
  })()`);
  const rect0 = await rectNow();
  console.log('宠物矩形(基准):', JSON.stringify(rect0));
  if (!rect0) { console.error('✗ 桌宠未挂载'); process.exit(1); }

  const shot = async (tag) => {
    const r = (await rectNow()) || rect0;   // 每帧动态追踪，别再用写死的矩形
    const clip = { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.w, height: r.h, scale: 1 };
    const s = await send('Page.captureScreenshot', { format: 'png', clip });
    return Buffer.from(s.data, 'base64');
  };
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
            if (!(d[i] > 240 && d[i+1] < 20 && d[i+2] < 20)) nonBg++;
          }
          res({ ratio: +(nonBg / total).toFixed(4) });
        };
        img.onerror = function(){ res(null); };
        img.src = ${JSON.stringify(dataUrl)};
      });
    })()`);
  };

  const base = await shot('base');
  const baseStat = await statOne(base);
  console.log('基准非背景占比:', JSON.stringify(baseStat));

  // 静置 30 秒高频采样：覆盖待机循环/随机动作/走路/睡眠唤醒
  console.log('\n静置采样 30s（覆盖自动行为路径）...');
  const N = 150;
  const bad = [];
  let minRel = 1;
  for (let i = 0; i < N; i++) {
    const f = await shot('i' + i);
    const st = await statOne(f);
    if (!st) continue;
    const rel = baseStat.ratio > 0 ? st.ratio / baseStat.ratio : 1;
    if (rel < minRel) minRel = rel;
    if (rel < 0.35) {
      const d = await ev(`(function(){
        var v = document.querySelector('.ci-pet-video');
        var fz = document.querySelector('.ci-pet-freeze');
        return { rs: v && v.readyState, vo: v && v.style.opacity, fo: fz && fz.style.opacity, fzz: fz && fz.style.zIndex };
      })()`);
      bad.push({ i: i, ratio: st.ratio, rel: +rel.toFixed(3), st: d });
      if (st.ratio < baseStat.ratio * 0.6) {
        writeFileSync(join(OUT, 'blank-' + i + '.png'), f);
      }
    }
    await sleep(180);
  }

  console.log('\n===== 结果 =====');
  console.log(`静置 ${N} 帧 · 内容缺失(<基准35%)帧=${bad.length} · 最低相对占比=${minRel.toFixed(3)}`);
  if (bad.length) console.log('缺失样例:', JSON.stringify(bad.slice(0, 6)));
  console.log('截图目录:', OUT);
  process.exit(bad.length === 0 ? 0 : 2);
} catch (e) {
  console.error('✗ 探针异常:', e.message);
  process.exit(1);
} finally {
  try { ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
