// 一次性探针：定位「舞台中间黑线」的来源层。
// 方法：渲染首页 → canvas 逐行扫描舞台区平均亮度找突变行（亮度骤降的 y）；
//       然后逐个隐藏候选层，看哪层隐藏后突变消失 —— 一锤定音，不猜。
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const APP = 'http://127.0.0.1:9001';
const STUB = readFileSync(join(scriptDir, 'pet-ui-workbench.stub.js'), 'utf8');

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9511',
  `--user-data-dir=${join(tmpdir(), 'ci-lineprobe-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=960,680', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9511${p}`)).json();
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

// 扫描舞台左栏中部竖条（避开角色：取舞台左侧 15%~30% 宽的竖条），
// 逐行算平均亮度，找相邻行亮度差 > 12 的「突变行」
const SCAN = `(function(hideSel){
  // 按需隐藏候选层
  if (hideSel) {
    document.querySelectorAll(hideSel).forEach(function(el){ el.style.display='none'; });
  }
  var stage = document.querySelector('.ci-pet-hero-stage');
  var r = stage.getBoundingClientRect();
  var cv = document.createElement('canvas');
  var W = Math.round(r.width), H = Math.round(r.height);
  cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');
  // drawWindow 需要调试权限，改用 html2canvas 不现实 —— 直接读舞台像素：
  // 用 element 截屏不可行，改为扫 CSS 层几何 + 背景色推导（见 plan B）
  return null;
})`;

// Plan B（不依赖像素读取）：直接枚举舞台区域内、横贯全宽的层，
// 输出每层的 top/bottom/height/背景 —— 突变线必然是某两层背景的交界的。
const LAYERS = `(function(){
  var stage = document.querySelector('.ci-pet-hero-stage');
  var sr = stage.getBoundingClientRect();
  var out = [];
  // 舞台所有层：本体 + 伪元素几何查不了，但可以查 computed background
  var els = [
    ['.ci-pet-hero', 'hero 本体'],
    ['.ci-pet-hero-stage', 'stage 容器'],
    ['.ci-pet-scene-sky', 'sky 天光'],
    ['.ci-pet-scene-stars', 'stars 星点'],
    ['.ci-pet-scene-hills', 'hills 远山'],
    ['.ci-pet-scene-ground', 'ground 地面'],
    ['.ci-pet-scene-shadow', 'shadow 台座'],
    ['.ci-pet-hero-info', 'info 信息区'],
    ['.ci-pet-hero-info::before', null]  // 伪元素单独处理
  ];
  els.forEach(function(pair){
    var sel = pair[0];
    var isPseudo = sel.indexOf('::') > 0;
    var base = isPseudo ? sel.split('::')[0] : sel;
    var el = document.querySelector(base);
    if (!el) return;
    var cs = getComputedStyle(el, isPseudo ? '::before' : null);
    if (isPseudo && cs.content === 'none') return;
    var rect = isPseudo ? null : el.getBoundingClientRect();
    // 伪元素盒：从其定位属性推
    var box;
    if (isPseudo) {
      var infoRect = document.querySelector('.ci-pet-hero-info').getBoundingClientRect();
      var h = cs.height === 'auto' ? infoRect.height : parseFloat(cs.height) || infoRect.height * (parseFloat(cs.height) / 100 || 1);
      // height 可能是 115% —— 相对 info 高
      var pctMatch = /^([\\d.]+)%$/.exec(cs.height);
      var hPx = pctMatch ? infoRect.height * parseFloat(pctMatch[1]) / 100 : (parseFloat(cs.height) || 0);
      box = { top: Math.round(infoRect.bottom - hPx), bottom: Math.round(infoRect.bottom), h: Math.round(hPx) };
    } else {
      box = { top: Math.round(rect.top), bottom: Math.round(rect.bottom), h: Math.round(rect.height) };
    }
    out.push({
      name: pair[1] || sel,
      top: box.top, bottom: box.bottom, h: box.h,
      pos: cs.position,
      bg: (cs.backgroundImage || 'none').slice(0, 120),
      bgColor: cs.backgroundColor,
      clip: (cs.clipPath || cs.webkitClipPath || 'none').slice(0, 60)
    });
  });
  return { stageTop: Math.round(sr.top), stageH: Math.round(sr.height), layers: out };
})()`;

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*harness*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 680, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await send('Page.navigate', { url: APP + '/harness-pet.html' });
  await sleep(1200);
  await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/entry.js'; document.head.appendChild(s); return 1; })()`);
  await sleep(1500);
  await ev(`window.__ci.appDef.mount(document.getElementById('host'), window.ClassIntraMarket.createContext('pet', {}))`);
  await sleep(2200);

  const data = await ev(LAYERS);
  console.log('stage top=' + data.stageTop + ' h=' + data.stageH);
  console.log('\n舞台内横贯层（按 top 排序，交界处 = 疑似线）：');
  data.layers
    .sort((a, b) => a.top - b.top)
    .forEach((l) => {
      console.log(
        `  [${l.name}] pos=${l.pos} top=${l.top} bottom=${l.bottom} h=${l.h}` +
        (l.clip !== 'none' ? ' clip=有' : '') +
        `\n      bg: ${l.bg.slice(0, 100)}` +
        (l.bgColor !== 'rgba(0, 0, 0, 0)' ? `\n      bg-color: ${l.bgColor}` : '')
      );
    });

  // 逐层隐藏实验：每藏一层截一张图，肉眼看哪层藏着黑线
  console.log('--- 逐层隐藏截图实验 ---');
  const mkdirSync = (await import('node:fs')).mkdirSync;
  const writeFileSync = (await import('node:fs')).writeFileSync;
  const outDir = join(process.cwd(), 'logs', 'pet-ui', 'lineprobe');
  mkdirSync(outDir, { recursive: true });

  const candidates = [
    ['0-baseline', null],
    ['1-hide-hills', '.ci-pet-scene-hills'],
    ['2-hide-ground', '.ci-pet-scene-ground'],
    ['3-hide-vignette', '.ci-pet-hero::after']
  ];
  for (const [name, sel] of candidates) {
    if (sel) {
      await ev(`(function(){
        var s = document.getElementById('__hide_line');
        if (!s) { s = document.createElement('style'); s.id='__hide_line'; document.head.appendChild(s); }
        s.textContent = '${sel} { display: none !important; content: none !important; }';
        return 1;
      })()`);
    } else {
      await ev(`(function(){ var s=document.getElementById('__hide_line'); if(s) s.textContent=''; return 1; })()`);
    }
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const fp = join(outDir, name + '.png');
    writeFileSync(fp, Buffer.from(shot.data, 'base64'));
    console.log('  📸 ' + fp);
  }
  // 恢复
  await ev(`(function(){ var s=document.getElementById('__hide_line'); if(s) s.textContent=''; return 1; })()`);
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
}
