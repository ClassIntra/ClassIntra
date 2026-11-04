// 自动找线探针：多视口高度矩阵 + 逐行亮度突变检测（数学定位，不靠眼睛）。
// 背景：六轮「黑线」修复都在 680 高视口验证全绿，但用户浏览器更高（~900），
// 线可能只在特定视口出现（百分比层的错位交界）。
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

// ---------- 极简 PNG 解码（8-bit RGB/RGBA，filter 0-4） ----------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let pos = 8, w = 0, h = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
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
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
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

// 逐行亮度，找突变行（相邻行平均亮度差 > 阈值）
function findLedges(img, x0, x1, threshold = 14) {
  const { w, h, bpp, data } = img;
  const luma = [];
  for (let y = 0; y < h; y++) {
    let sum = 0, n = 0;
    for (let x = x0; x < x1; x += 2) {
      const i = (y * w + x) * bpp;
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      n++;
    }
    luma.push(sum / n);
  }
  const ledges = [];
  for (let y = 1; y < h; y++) {
    const d = luma[y] - luma[y - 1];
    if (Math.abs(d) >= threshold) ledges.push({ y, delta: Math.round(d) });
  }
  // 合并相邻行
  const merged = [];
  for (const l of ledges) {
    const last = merged[merged.length - 1];
    if (last && l.y - last.y <= 3) { last.delta = Math.max(Math.abs(last.delta), Math.abs(l.delta)); }
    else merged.push({ ...l });
  }
  return merged;
}

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9521',
  `--user-data-dir=${join(tmpdir(), 'ci-matrix-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9521${p}`)).json();
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

const outDir = join(process.cwd(), 'logs', 'pet-ui', 'matrix');
mkdirSync(outDir, { recursive: true });

// 视口矩阵：用户浏览器可能高 900+；横竖都测
const matrix = [
  [1080, 680], [1080, 760], [1080, 860], [1080, 920],
  [960, 680], [1920, 1080], [1440, 900]
];

let loaded = false;
for (const [W, H] of matrix) {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  if (!loaded) {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*harness*', requestStage: 'Request' }] });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
    await send('Page.navigate', { url: APP + '/harness-pet.html' });
    await sleep(1200);
    await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/entry.js'; document.head.appendChild(s); return 1; })()`);
    await sleep(1400);
    await ev(`window.__ci.appDef.mount(document.getElementById('host'), window.ClassIntraMarket.createContext('pet', {}))`);
    loaded = true;
  }
  await sleep(1600);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(shot.data, 'base64');
  writeFileSync(join(outDir, `${W}x${H}.png`), png);
  const img = decodePNG(png);

  // 扫描左栏舞台（x 8%~45%，避开右栏与角色主体）
  const x0 = Math.round(img.w * 0.06), x1 = Math.round(img.w * 0.42);
  const ledges = findLedges(img, x0, x1, 12);
  console.log(`\n== ${W}x${H} == 突变行（x ${x0}~${x1}）：`);
  if (!ledges.length) console.log('  ✅ 无亮度突变（无线）');
  else ledges.forEach((l) => {
    const pct = Math.round(l.y / img.h * 100);
    console.log(`  ⚠️ y=${l.y} (${pct}%) Δ=${l.delta}`);
  });
}

try {} catch (e) { console.error('✗', e.message); process.exitCode = 1; }
finally {
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
}
