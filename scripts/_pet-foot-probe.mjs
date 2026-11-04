// 一次性探针：量出 webm 人物在视频框里的实际位置（脚在第几行）。
// 为什么要测：webm 视频框比人物画幅大（人物只占 ~65%），
// 视频框底边 ≠ 脚。靠 CSS 百分比猜只会来回试错。
// 做法：把 video 画到 canvas，扫像素找人物的实际包围盒。
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const APP = process.env.PET_APP || 'http://127.0.0.1:9001';
const STUB = readFileSync(join(scriptDir, 'pet-ui-workbench.stub.js'), 'utf8');

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9491',
  `--user-data-dir=${join(tmpdir(), 'ci-pet-footprobe')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9491${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const pageT = (await g('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const HOST_CSS = `
html,body{width:100%;height:100%;overflow:hidden;margin:0;padding:0}
*{margin:0;padding:0;box-sizing:border-box}
.app-shell{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:#f2f2f7;}
.app-shell-body{flex:1;min-height:0;overflow:hidden;position:relative}
.app-shell-host{width:100%;height:100%;min-height:0;overflow:hidden}
.app-shell-host>*{height:100%;min-height:0}
.market-runtime-container{width:100%;height:100%;min-height:0;overflow:hidden}
.market-runtime-container>*{height:100%;min-height:0}
#__nav{height:44px;flex:0 0 auto;background:rgba(20,20,22,.7)}
`;
const HOME_HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/market-static/pet/frontend/style.css">
<style>${HOST_CSS}</style></head><body>
<div class="app-shell"><div id="__nav"></div><div class="app-shell-body"><div class="app-shell-host">
<div class="market-runtime-container" id="host"></div></div></div></div></body></html>`;

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Fetch.requestPaused') {
    const html = /harness-pet/.test(m.params.request.url) ? HOME_HTML : null;
    if (html) {
      send('Fetch.fulfillRequest', {
        requestId: m.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: b64(html)
      }).catch(() => {});
    } else {
      send('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {});
    }
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
  if (r.exceptionDetails) throw new Error(String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]);
  return r.result.value;
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*harness*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await send('Page.navigate', { url: APP + '/harness-pet.html' });
  await sleep(1200);
  await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/entry.js'; document.head.appendChild(s); return 1; })()`);
  await sleep(1500);
  await ev(`window.__ci.appDef.mount(document.getElementById('host'), window.ClassIntraMarket.createContext('pet', {}))`);
  await sleep(2500);

  // 像素扫描：把 video 画到 canvas，找人物（不透明且有颜色）的包围盒
  const box = await ev(`(function(){
    var v = document.querySelector('.ci-pet-hero-video');
    if (!v) return { err: 'no-video' };
    var w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return { err: 'video-not-ready', w: w, h: h };
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    ctx.drawImage(v, 0, 0);
    var d;
    try { d = ctx.getImageData(0, 0, w, h).data; } catch(e){ return { err: 'tainted:' + e.message }; }
    var minX = w, minY = h, maxX = -1, maxY = -1, cnt = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var a = d[i+3];
        if (a < 24) continue;
        // 排除近乎纯黑/纯白的像素（背景与特效）
        var r=d[i], g=d[i+1], b=d[i+2];
        var mx = Math.max(r,g,b), mn = Math.min(r,g,b);
        if (mx - mn < 12 && mx < 40) continue;
        cnt++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return {
      vw: w, vh: h,
      minX: minX, minY: minY, maxX: maxX, maxY: maxY,
      pixels: cnt,
      // 关键：脚（人物底边）距离视频框底边的百分比
      feetFromBottomPct: h > 0 ? Math.round((h - 1 - maxY) / h * 100) : null,
      // 头（人物顶边）距离视频框顶边的百分比
      headFromTopPct: h > 0 ? Math.round(minY / h * 100) : null,
      contentHeightPct: h > 0 ? Math.round((maxY - minY) / h * 100) : null,
      contentWidthPct: w > 0 ? Math.round((maxX - minX) / w * 100) : null
    };
  })()`);
  console.log('人物在视频框里的位置:', JSON.stringify(box, null, 2));

  // 顺带量一下台座光环与名牌的相对位置
  const geo = await ev(`(function(){
    var q=function(s){return document.querySelector(s);};
    var hero=q('.ci-pet-hero'), shadow=q('.ci-pet-scene-shadow'), name=q('.ci-pet-name'), info=q('.ci-pet-hero-info');
    var v=q('.ci-pet-hero-video');
    if(!hero) return {err:'no-hero'};
    var hr=hero.getBoundingClientRect();
    var sr=shadow?shadow.getBoundingClientRect():null;
    var nr=name?name.getBoundingClientRect():null;
    var ir=info?info.getBoundingClientRect():null;
    var vr=v?v.getBoundingClientRect():null;
    return {
      heroH: Math.round(hr.height),
      heroTop: Math.round(hr.top),
      videoBoxTopRelHero: vr?Math.round(vr.top-hr.top):null,
      videoBoxBottomRelHero: vr?Math.round(vr.bottom-hr.top):null,
      videoBoxH: vr?Math.round(vr.height):null,
      shadowBottomRelHero: sr?Math.round(sr.bottom-hr.top):null,
      nameTopRelHero: nr?Math.round(nr.top-hr.top):null,
      infoTopRelHero: ir?Math.round(ir.top-hr.top):null,
      infoH: ir?Math.round(ir.height):null
    };
  })()`);
  console.log('hero 几何:', JSON.stringify(geo, null, 2));
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
}
