// 自动行为路径闪烁探针 v2 —— 修正 v1 的致命判据缺陷
//
// v1 的 bug：只在开头取一次宠物矩形，之后 150 帧全用这个固定 clip。
//            静置 30s 期间宠物会自动 walk/dash/climb 走开，
//            矩形里自然变空 → 被误判为「内容缺失」，report 出 66 帧假阳性。
// v2 的修法：每一帧都先问页面「宠物你现在在哪」，按实时矩形截图；
//            同时把 mode（sleep/walk/dash/climb）记录下来，
//            这样能把「宠物真的没了」和「宠物散步去了」彻底分开。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-pet-idle-v2');
mkdirSync(OUT, { recursive: true });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9399',
  `--user-data-dir=${join(tmpdir(), 'ci-pet-idle-v2-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9399${p}`)).json();
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

// 每帧同时取「实时矩形」+「行为模式」+「video/canvas 可见性三件套」
const PROBE = `(function(){
  var pet = document.querySelector('.ci-pet');
  if (!pet) return null;
  var r = pet.getBoundingClientRect();
  var c = pet.classList;
  var mode = c.contains('ci-pet-sleeping') ? 'sleep'
           : c.contains('ci-pet-walking')  ? 'walk'
           : c.contains('ci-pet-dashing')  ? 'dash'
           : c.contains('ci-pet-climbing') ? 'climb' : 'idle';
  var host = pet.querySelector('.ci-pet-body') || pet;
  var v = document.querySelector('.ci-pet video');
  var cn = document.querySelector('.ci-pet canvas');
  var hostCs = getComputedStyle(host);
  return {
    x: Math.round(r.x), y: Math.round(r.y),
    w: Math.round(Math.max(r.width, 8)), h: Math.round(Math.max(r.height, 8)),
    mode: mode,
    rs: v ? v.readyState : -1,
    vo: v ? getComputedStyle(v).opacity : '-',
    co: cn ? getComputedStyle(cn).opacity : '-',
    cz: cn ? getComputedStyle(cn).zIndex : '-',
    hostOp: hostCs.opacity,
    hostVis: hostCs.visibility
  };
})()`;

try {
  await send('Page.navigate', { url: APP + '/harness-idle.html' });
  await sleep(1200);
  await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/overlay.js'; document.head.appendChild(s); return 1; })()`);
  // 轮询等待 overlay 就绪 —— 固定 sleep 在低端/繁忙 CI 上会偶发抢跑
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { ready = await ev(`!!(window.__ovl && window.__ovl.mount)`); } catch { ready = false; }
    if (ready) break;
  }
  if (!ready) { console.error('✗ overlay.js 未挂载入口 __ovl'); process.exit(1); }
  console.log('overlay 就绪，耗时轮询 OK');
  await ev(`window.__ovl.mount(document.body, window.ClassIntraMarket.createContext('pet', {}))`);
  await sleep(3000);

  const p0 = await ev(PROBE);
  if (!p0) { console.error('✗ 桌宠未挂载'); process.exit(1); }
  console.log('初始位置:', JSON.stringify({ x: p0.x, y: p0.y, w: p0.w, h: p0.h, mode: p0.mode }));

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
          res({ total: total, nonBg: nonBg, ratio: +(nonBg / total).toFixed(4) });
        };
        img.onerror = function(){ res(null); };
        img.src = ${JSON.stringify(dataUrl)};
      });
    })()`);
  };
  const shotClip = async (p) => {
    const clip = { x: Math.max(0, p.x), y: Math.max(0, p.y), width: p.w, height: p.h, scale: 1 };
    const s = await send('Page.captureScreenshot', { format: 'png', clip });
    return Buffer.from(s.data, 'base64');
  };

  // 基准帧
  const baseBuf = await shotClip(p0);
  const baseStat = await statOne(baseBuf);
  console.log('基准非背景占比:', JSON.stringify(baseStat));

  console.log('\n静置采样（每帧动态追踪位置）...');
  const N = 120;
  const bad = [];
  let minRel = 1;
  const xs = [], ys = [];
  const modeSeen = {};
  for (let i = 0; i < N; i++) {
    const p = await ev(PROBE);
    if (!p) { bad.push({ i, why: 'pet 消失' }); continue; }
    xs.push(p.x); ys.push(p.y);
    modeSeen[p.mode] = (modeSeen[p.mode] || 0) + 1;
    const buf = await shotClip(p);
    const st = await statOne(buf);
    if (!st) continue;
    const rel = baseStat.ratio > 0 ? st.ratio / baseStat.ratio : 1;
    minRel = Math.min(minRel, rel);
    if (rel < 0.35) bad.push({ i, ratio: st.ratio, rel: +rel.toFixed(3), x: p.x, y: p.y, mode: p.mode, rs: p.rs, vo: p.vo, co: p.co, cz: p.cz, hostOp: p.hostOp, hostVis: p.hostVis });
    await sleep(140);
  }

  const dx = Math.max(...xs) - Math.min(...xs);
  const dy = Math.max(...ys) - Math.min(...ys);
  console.log('\n===== v2 结果 =====');
  console.log(`采样 ${N} 帧 · 内容缺失(<基准35%)=${bad.length} · 最低相对占比=${minRel.toFixed(3)}`);
  console.log(`宠物位移范围: dx=${dx}px dy=${dy}px  ← v1 若用固定矩形，这段位移就是它的假阳性来源`);
  console.log('行为模式分布:', JSON.stringify(modeSeen));
  if (bad.length) console.log('缺失样例:', JSON.stringify(bad.slice(0, 6), null, 1));
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ minRel, bad, modeSeen, dx, dy }, null, 2));
  console.log('结果目录:', OUT);
} catch (e) {
  console.error('✗ 探针异常:', e.message);
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
}
