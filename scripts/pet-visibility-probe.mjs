// 桌宠视觉诊断探针：抓 .ci-pet 的几何与计算样式，定位"DOM 在但看不见"的原因
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-petvis');
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
  '--headless=new', '--remote-debugging-port=9374',
  `--user-data-dir=${join(tmpdir(), 'ci-petvis')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9374${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const page = (await g('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{
    localStorage.setItem('token',${JSON.stringify(TOKEN)});
    localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: '251800', net_name: 'probe', is_admin: 1, role: 'admin' }))});
  }catch(e){}`
});
await send('Page.navigate', { url: APP + '/' });
await sleep(8000);

const diag = await ev(`(function(){
  var pet = document.querySelector('.ci-pet');
  var out = { petExists: !!pet, viewport: { w: window.innerWidth, h: window.innerHeight }, inner: {} };
  if (pet) {
    var r = pet.getBoundingClientRect();
    var cs = getComputedStyle(pet);
    out.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    out.inner = {
      position: cs.position, zIndex: cs.zIndex, display: cs.display,
      visibility: cs.visibility, opacity: cs.opacity, overflow: cs.overflow,
      transform: cs.transform === 'none' ? 'none' : cs.transform.slice(0, 70),
      width: cs.width, height: cs.height, pointerEvents: cs.pointerEvents
    };
    var canvas = pet.querySelector('canvas');
    if (canvas) {
      var cr = canvas.getBoundingClientRect();
      var ccs = getComputedStyle(canvas);
      out.canvas = {
        attrW: canvas.width, attrH: canvas.height,
        rectW: Math.round(cr.width), rectH: Math.round(cr.height),
        styleW: ccs.width, display: ccs.display, visibility: ccs.visibility
      };
      // 画布中心取一个像素看是否真的画了东西
      try {
        var g = canvas.getContext('2d');
        var px = g.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
        out.canvasCenterPixel = Array.prototype.slice.call(px);
      } catch (e) { out.canvasCenterPixel = 'err:' + e.message; }
    }
    // 层叠上下文：向上找所有祖先的 overflow/z-index/transform
    var ancestors = [];
    var node = pet.parentElement;
    while (node && node !== document.documentElement) {
      var acs = getComputedStyle(node);
      ancestors.push({
        tag: node.tagName + (node.className && typeof node.className === 'string' ? '.' + node.className.split(' ')[0] : ''),
        overflow: acs.overflow, zIndex: acs.zIndex, transform: acs.transform !== 'none' ? 'yes' : 'no',
        display: acs.display, opacity: acs.opacity
      });
      node = node.parentElement;
    }
    out.ancestors = ancestors;
    var link = document.querySelector('link[data-market-overlay]');
    out.styleLink = link ? link.href : '未加载';
  }
  // 命中测试：宠物身体中心点最顶层是谁（真实点击的 target）
  if (pet) {
    var r2 = pet.getBoundingClientRect();
    var cx = r2.x + r2.width / 2, cy = r2.y + r2.height * 0.65;
    var top = document.elementFromPoint(cx, cy);
    out.hitTest = {
      point: { x: Math.round(cx), y: Math.round(cy) },
      topTag: top ? (top.tagName + (top.className && typeof top.className === 'string' ? '.' + top.className.split(' ')[0] : '')) : 'null',
      isPetOrChild: !!(top && (top === pet || pet.contains(top)))
    };
  }
  // 视频与容器几何对齐检查
  if (pet) {
    var vid = pet.querySelector('video');
    if (vid) {
      var vr = vid.getBoundingClientRect();
      var pr = pet.getBoundingClientRect();
      out.videoAlign = {
        container: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
        video: { x: Math.round(vr.x), y: Math.round(vr.y), w: Math.round(vr.width), h: Math.round(vr.height) },
        // 视频身体有多少落在容器（命中区）内
        overlapY: Math.max(0, Math.min(pr.bottom, vr.bottom) - Math.max(pr.top, vr.top)),
        videoVisibleAboveContainer: Math.max(0, pr.top - vr.top)
      };
    }
  }
  out.debug = window.__ciPetDebug ? window.__ciPetDebug() : null;
  return out;
})()`);
console.log(JSON.stringify(diag, null, 2));

const s = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(OUT, 'petvis.png'), Buffer.from(s.data, 'base64'));
console.log('截图: ' + join(OUT, 'petvis.png'));
chrome.kill();
process.exit(0);
