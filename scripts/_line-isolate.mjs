// 终极闭环：逐层隐藏 × 自动线检测（数字说话，不靠眼睛）。
// 背景：视口矩阵发现 y≈413（860+ 高视口恒定）的突变线，
// 改 hills/ground 渐变后 Δ 纹丝不动 —— 数学证明与它们无关。
// 方法：920×1080 视口下逐个隐藏候选层，跑逐行亮度突变检测，
//       哪个层隐藏后 413 处 Δ 消失，就是它。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { inflateSync } from 'node:zlib';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const APP = 'http://127.0.0.1:9001';
const STUB = readFileSync(join(scriptDir, 'pet-ui-workbench.stub.js'), 'utf8');

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
    prev = cur;
  }
  return { w, h, bpp, data: out };
}

function lumaAt(img, y, x0, x1) {
  const { w, bpp, data } = img;
  let sum = 0, n = 0;
  for (let x = x0; x < x1; x += 2) {
    const i = (y * w + x) * bpp;
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    n++;
  }
  return sum / n;
}

// 检测 y 380~450 区间内最大的行间突变（目标：413 线）
function ledgeScore(img, x0, x1, y0 = 380, y1 = 450) {
  let best = { y: 0, delta: 0 };
  for (let y = y0 + 1; y < y1; y++) {
    const d = lumaAt(img, y, x0, x1) - lumaAt(img, y - 1, x0, x1);
    if (Math.abs(d) > Math.abs(best.delta)) best = { y, delta: Math.round(d) };
  }
  return best;
}

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9531',
  `--user-data-dir=${join(tmpdir(), 'ci-isolate-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9531${p}`)).json();
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
    if (/harness-pet/.test(m.params.request.url)) {
      send('Fetch.fulfillRequest', {
        requestId: m.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: b64(HOME_HTML)
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

const W = 1080, H = 920;
await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*harness*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
await send('Page.navigate', { url: APP + '/harness-pet.html' });
await sleep(1200);
await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/entry.js'; document.head.appendChild(s); return 1; })()`);
await sleep(1400);
await ev(`window.__ci.appDef.mount(document.getElementById('host'), window.ClassIntraMarket.createContext('pet', {}))`);
await sleep(1800);

const x0 = Math.round(W * 0.06), x1 = Math.round(W * 0.42);
const outDir = join(process.cwd(), 'logs', 'pet-ui', 'isolate');
mkdirSync(outDir, { recursive: true });

const layers = [
  ['baseline', null],
  ['no-hills', '.ci-pet-scene-hills'],
  ['no-ground', '.ci-pet-scene-ground'],
  ['no-stars', '.ci-pet-scene-stars'],
  ['no-stagebefore', '.ci-pet-hero-stage::before'],
  ['no-stageafter', '.ci-pet-hero-stage::after'],
  ['no-vignette', '.ci-pet-hero::after'],
  ['no-shadow', '.ci-pet-scene-shadow'],
  ['no-video', '.ci-pet-hero-video'],
  ['no-sky', '.ci-pet-scene-sky']
];

console.log(`== ${W}x${H} 逐层隐藏 × y380~450 线检测（x ${x0}~${x1}）==`);
for (const [name, sel] of layers) {
  if (sel) {
    await ev(`(function(){
      var s = document.getElementById('__iso');
      if (!s) { s = document.createElement('style'); s.id='__iso'; document.head.appendChild(s); }
      s.textContent = '${sel} { display: none !important; content: none !important; }';
      return 1;
    })()`);
  } else {
    await ev(`(function(){ var s=document.getElementById('__iso'); if(s) s.textContent=''; return 1; })()`);
  }
  await sleep(350);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const img = decodePNG(Buffer.from(shot.data, 'base64'));
  writeFileSync(join(outDir, name.replace(/[^a-z0-9-]/gi, '_') + '.png'), Buffer.from(shot.data, 'base64'));
  const best = ledgeScore(img, x0, x1);
  console.log(`  [${name}] y380~450 最大突变: y=${best.y} Δ=${best.delta} ${Math.abs(best.delta) < 8 ? '✅ 线消失' : '⚠️ 线仍在'}`);
}
try {} catch (e) { console.error('✗', e.message); process.exitCode = 1; }
finally {
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
}
