// 桌宠 UI 工作台：真实 entry.js + style.css + stub 后端 → 多页截图
// 用法：node scripts/pet-ui-workbench.mjs [--only=home,battle,dex,rank] [--tag=v019]
// 产出：logs/pet-ui/<tag>-<page>.png  +  控制台报告
//
// 为什么自带 stub：桌宠后端要登录态、要真 DB，UI 迭代时那些都是噪声。
// 这里把 ClassIntraMarket SDK 整个 stub 掉，只保留前端渲染需要的数据形状。
// ⚠️ 数据形状必须与真实后端一致（见 backend/routes.js），否则 UI 会按假数据设计。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { inflateSync } from 'node:zlib';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const APP = process.env.PET_APP || 'http://127.0.0.1:9001';
const ARGS = process.argv.slice(2);
const argOf = (k, d) => {
  const hit = ARGS.find((a) => a.indexOf(`--${k}=`) === 0);
  return hit ? hit.slice(k.length + 3) : d;
};
const TAG = argOf('tag', 'now');
const ONLY = argOf('only', 'home,battle,dex,rank').split(',').filter(Boolean);
const QUERY = argOf('query', '');
const OUT = join(process.cwd(), 'logs', 'pet-ui');
// --js=<表达式>：挂载后注入一段脚本（可以是 async IIFE），值打到控制台。
// --touch=1：开启触摸模拟（pointer:coarse / hover:none）—— 平板上的真实媒体查询状态。
//            没有它，「只有触屏才走得到的分支」永远验证不到：桌面 Chrome 的
//            hover:hover 会把 hover 相关的 bug 全部遮住。
const JS = argOf('js', '') || (argOf('jsfile', '') ? readFileSync(argOf('jsfile', ''), 'utf8') : '');
const TOUCH = argOf('touch', '') === '1';
mkdirSync(OUT, { recursive: true });


// ---------- 极简 PNG 解码（8-bit RGB/RGBA，filter 0-4）----------
// 用途：让「横贯画面的硬线」变成一组数字，而不是靠眼睛在截图里找。
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
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
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
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
      if (f === 1) v += a; else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p2 = a + b - c, pa = Math.abs(p2 - a), pb = Math.abs(p2 - b), pc = Math.abs(p2 - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
    prev = cur;
  }
  return { w, h, bpp, data: out };
}

// 逐行亮度差：找出「跨越画面大部分宽度」的突变行
function findLedges(img, threshold = 7) {
  const { w, h, bpp, data } = img;
  const luma = [];
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x += 4) {
      const i = y * w * bpp + x * bpp;
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    luma.push(sum / Math.ceil(w / 4));
  }
  const hits = [];
  for (let y = 1; y < h; y++) {
    const d = luma[y] - luma[y - 1];
    if (Math.abs(d) >= threshold) hits.push({ y, d: Math.round(d), luma: Math.round(luma[y]) });
  }
  return hits.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 8);
}

const W = Number(argOf('w', 1043));
const H = Number(argOf('h', 787));

// ⚠️ 必须每次全新 profile：持久 profile 会缓存旧 style.css/entry.js（304），
//    导致「改了样式但截图没变」的假象（2026-10-31 fin2-dex 两列假象就是这么来的）。
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9477',
  `--user-data-dir=${join(tmpdir(), 'ci-pet-wb-profile-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  `--window-size=${W},${H}`, 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9477${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const pageT = (await g('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
const ERRORS = [];
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

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
  if (m.method === 'Runtime.exceptionThrown') {
    const x = m.params.exceptionDetails;
    const desc = String((x.exception && x.exception.description) || x.text);
    const fr = ((x.stackTrace && x.stackTrace.callFrames) || [])[0];
    ERRORS.push(desc.split('\n')[0] + (fr ? ' @' + (fr.lineNumber + 1) + ':' + (fr.columnNumber + 1) : ''));
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
// ⚠️ CDP Runtime.evaluate 在浏览器端抛异常不会 reject，只给 exceptionDetails —— 必须显式检查
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]);
  }
  return r.result.value;
};

const HOST_CSS = `
html,body{width:100%;height:100%;overflow:hidden;margin:0;padding:0}
*{margin:0;padding:0;box-sizing:border-box;overscroll-behavior-y:contain}
.app-shell{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:#f2f2f7;}
.app-shell-body{flex:1;min-height:0;overflow:hidden;position:relative}
.app-shell-host{width:100%;height:100%;min-height:0;overflow:hidden}
.app-shell-host>*{height:100%;min-height:0}
.market-runtime-container{width:100%;height:100%;min-height:0;overflow:hidden}
.market-runtime-container>*{height:100%;min-height:0}
#__nav{height:44px;flex:0 0 auto;background:rgba(20,20,22,.7)}
`;
const HOME_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/market-static/pet/frontend/style.css">
<style>${HOST_CSS}</style></head><body>
<div class="app-shell"><div id="__nav"></div><div class="app-shell-body"><div class="app-shell-host">
<div class="market-runtime-container" id="host"></div>
</div></div></div></body></html>`;

const STUB = readFileSync(join(scriptDir, 'pet-ui-workbench.stub.js'), 'utf8');

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const p = join(OUT, `${TAG}-${name}.png`);
  const buf = Buffer.from(r.data, 'base64');
  writeFileSync(p, buf);
  console.log('  📸 ' + p);
  // 自动找横贯画面的硬线：肉眼在截图里找线不靠谱（v0.19 那条线找了 8 轮），
  // 这里把每行的平均亮度差列出来，一眼就能定位到 y。
  try {
    const hits = findLedges(decodePNG(buf));
    if (hits.length) {
      console.log('  横向突变行:', hits.map((h) => `y${h.y}(Δ${h.d})`).join(' '));
    }
  } catch (e) { console.log('  (扫描跳过: ' + e.message + ')'); }
  return p;
}

// ⚠️ v0.20 之后 dock 已删除（家具即导航），不能再靠点 tab 切页。
// 改成点场景里的物件：门→对战、书架→图鉴、奖杯→排行。
// 这比点 tab 更接近用户真实路径（角色会先走过去，再进页面）。
const PAGES = {
  home: { obj: null },
  battle: { obj: 'door' },
  dex: { obj: 'shelf' },
  rank: { obj: 'trophy' }
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*harness*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // --motion=full|reduce：强制 prefers-reduced-motion 的取值。
  // 为什么需要它：headless Chrome 会跟随宿主机设置，而开发机常常开着「减少动效」——
  // 于是所有位移类动画在截图里都是静止的，看起来像「动画没写」，
  // 排查时极易误判（v0.33 摸头心形就差点被当成没生效）。
  // 默认 system：保持旧行为，不影响既有探针的时间假设。
  const MOTION = argOf('motion', 'system');
  if (MOTION === 'full' || MOTION === 'reduce') {
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: MOTION === 'full' ? 'no-preference' : 'reduce' }]
    });
  }
  if (TOUCH) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

  // --query=xxx：透传给 harness 页面（stub 用它切换场景，如 ?towerlock=1）
  await send('Page.navigate', { url: APP + '/harness-pet.html' + (QUERY ? '?' + QUERY : '') });
  await sleep(1200);
  await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/entry.js'; document.head.appendChild(s); return 1; })()`);
  await sleep(1400);
  const loaded = await ev(`({ def: typeof window.__ci.appDef })`);
  if (loaded.def !== 'object') throw new Error('entry.js 未注册定义');
  await ev(`window.__ci.appDef.mount(document.getElementById('host'), window.ClassIntraMarket.createContext('pet', {}))`);
  await sleep(1000);

  if (JS) {
    console.log('\n== 注入脚本 ==');
    try {
      const out = await ev(JS);
      console.log('  返回:', typeof out === 'string' ? out : JSON.stringify(out, null, 2));
    } catch (e) {
      console.log('  ✗ ' + e.message);
    }
  }

  for (const name of ONLY) {
    const cfg = PAGES[name];
    if (!cfg) { console.log('跳过未知页面 ' + name); continue; }
    console.log('\n== ' + name + ' ==');
    if (cfg.obj) {   // 场景入口物件（dock 已删，见 PAGES 注释）
      var ok = await ev(`(function(){
        var b = document.querySelector('.world-obj[data-obj="${cfg.obj}"]');
        if (!b) return false;
        b.click();
        return true;
      })()`);
      if (!ok) console.log('  ⚠️ 找不到场景入口物件: ' + cfg.obj);
      // 角色要先走过去（~0.5s）再切页，等够时间
      await sleep(1600);
      var where = await ev(`(function(){
        var r = document.querySelector('.ci-pethome');
        var has = function(sel){ return !!document.querySelector(sel); };
        return JSON.stringify({ world: has('.ci-pet-world'), battle: has('.ci-pet-battle'),
          dex: has('.ci-pet-dex'), rank: has('.ci-pet-rank') });
      })()`);
      console.log('  当前页面内容:', where);
      await sleep(1100);
    }
    await shot(name);
    // ⚠️ 整页长图必须在这一页还活着的时候拍。
    //    这段原来在循环末尾、且在「回首页」之后，于是 battle/dex/rank 的 -full
    //    全是小家的截图（看着像切页失败，实际是拍错了对象，白查了一轮）。
    {
      const pageH0 = await ev(`(function(){
        var r = document.querySelector('.ci-pethome');
        return r ? Math.max(r.scrollHeight + 8, document.body.scrollHeight) : 0;
      })()`);
      if (pageH0 > 0 && pageH0 < 6000) {
        await send('Emulation.setDeviceMetricsOverride', { width: W, height: Math.ceil(pageH0), deviceScaleFactor: 1, mobile: false });
        await sleep(650);
        await shot(name + '-full');
        await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
        await sleep(350);
      }
    }
    // 回首页，给下一页一个干净的起点（dock 已删，用测试钩子）
    await ev(`(function(){ if (window.__ciPetGo) window.__ciPetGo('home'); return 1; })()`);
    await sleep(700);
    // 结构体检：这一页有多少卡片、多少数字、多少按钮 —— 用来量化「仪表盘感」
    const audit = await ev(`(function(){
      var root = document.querySelector('.ci-pethome');
      if (!root) return { err: 'no-root' };
      var cards = root.querySelectorAll('.ci-pet-card, .ci-pet-panel, .ci-pet-section, .ci-pet-quest, .ci-pet-weather, .ci-pet-diary, .ci-pet-advlink, .ci-pet-stylecard');
      var nums = 0;
      root.querySelectorAll('*').forEach(function(el){
        if (el.children.length === 0 && /\\d/.test(el.textContent||'')) nums++;
      });
      return {
        scrollH: root.scrollHeight, clientH: root.clientHeight,
        cardCount: cards.length, leafNumNodes: nums,
        buttons: root.querySelectorAll('button').length,
        sections: root.querySelectorAll('.ci-pet-section-title, .ci-pet-sec-title, .ci-pethome h2').length,
        topLevel: Array.prototype.slice.call(root.children).map(function(c){ return c.className; }).slice(0, 40)
      };
    })()`);
    console.log('  结构:', JSON.stringify(audit));

    // 字体体检：位图字体是否真的加载并生效
    {
      const ft = await ev(`(function(){
        var ok = (document.fonts && document.fonts.check) ? document.fonts.check('16px Unifont16') : 'no-api';
        var el = document.querySelector('.world-hud-name') || document.querySelector('.ci-pethome');
        var cs = el ? getComputedStyle(el) : null;
        return JSON.stringify({ loaded: ok, family: cs ? cs.fontFamily : null, size: cs ? cs.fontSize : null,
          faces: (document.fonts ? document.fonts.size : -1) });
      })()`);
      console.log('  字体体检:', ft);
    }

    // 贴图体检：确认 is-sprite 的 background-* 真的生效（不是回退到 intrinsic）
    {
      const sp = await ev(`(function(){
        var a = document.querySelector('.world-obj-art.is-sprite');
        if (!a) return 'no-sprite';
        var cs = getComputedStyle(a);
        return JSON.stringify({
          cls: a.className,
          inline: a.getAttribute('style'),
          img: (cs.backgroundImage || '').slice(0, 60),
          size: cs.backgroundSize,
          pos: cs.backgroundPosition,
          rep: cs.backgroundRepeat,
          rect: Math.round(a.getBoundingClientRect().width) + 'x' + Math.round(a.getBoundingClientRect().height)
        });
      })()`);
      console.log('  贴图体检:', sp);
    }

    // 生命感体检：角色到底会不会自己动（采样 transform 是否变化）
    {
      const samples = [];
      for (let k = 0; k < 8; k++) {
        const t = await ev(`(function(){
          var p = document.querySelector('.world-pet');
          if (!p) return null;
          return { tf: p.style.transform, cls: p.className };
        })()`);
        if (t) samples.push(t.tf + (t.cls.indexOf('is-walk') >= 0 ? ' [walk]' : ''));
        await sleep(1500);
      }
      const uniq = Array.from(new Set(samples));
      console.log('  走动采样:', uniq.length > 1 ? ('✅ ' + uniq.join(' → ')) : ('❌ 一直没动: ' + uniq[0]));
      const vid = await ev(`(function(){
        var v = document.querySelector('.world-pet video');
        if (!v) return 'no-video';
        return JSON.stringify({ paused: v.paused, t: +v.currentTime.toFixed(2), ready: v.readyState,
          muted: v.muted, autoplay: v.autoplay, loop: v.loop, w: v.videoWidth,
          src: decodeURIComponent(v.currentSrc || '').split('/').pop() });
      })()`);
      console.log('  角色视频:', vid);
      const px = await ev(`(function(){
        var c = document.querySelector('.world-pet-vid');
        if (!c || !c.getContext) return 'no-canvas';
        var g = c.getContext('2d');
        var d = g.getImageData(0, 0, c.width, c.height).data;
        var samples = [];
        [[2,2],[c.width-3,2],[2,c.height-3],[c.width-3,c.height-3],[Math.floor(c.width/2),2]].forEach(function(pt){
          var i = (pt[1]*c.width + pt[0]) * 4;
          samples.push('(' + pt.join(',') + ')=' + [d[i],d[i+1],d[i+2],d[i+3]].join('/'));
        });
        var opaque=0, semi=0, clear=0;
        for (var i=3;i<d.length;i+=4){ if(d[i]>240) opaque++; else if(d[i]>10) semi++; else clear++; }
        return JSON.stringify({ size: c.width+'x'+c.height, corners: samples.join(' '),
          opaque: opaque, semi: semi, clear: clear });
      })()`);
      console.log('  画布像素:', px);
      const box = await ev(`(function(){
        var w = document.querySelector('.ci-pet-world');
        var r = document.querySelector('.ci-pethome');
        if (!w || !r) return 'missing';
        var wr = w.getBoundingClientRect(), rr = r.getBoundingClientRect();
        return JSON.stringify({
          world: { cw: w.clientWidth, ow: w.offsetWidth, rectW: Math.round(wr.width), rectH: Math.round(wr.height) },
          root: { cw: r.clientWidth, rectW: Math.round(rr.width), display: getComputedStyle(r).display,
                  flexDir: getComputedStyle(r).flexDirection, cls: r.className },
          worldCS: { width: getComputedStyle(w).width, minWidth: getComputedStyle(w).minWidth,
                     flex: getComputedStyle(w).flex, position: getComputedStyle(w).position }
        });
      })()`);
      console.log('  容器尺寸:', box);
      const idle = await ev(`JSON.stringify(window.__ciWorldIdle || null)`);
      console.log('  闲逛计数:', idle);
      if (uniq.length === 1) process.exitCode = 1;
    }

    // 默契指令探针（--jsfile 注入的脚本把结果挂到 window.__cmdProbe）。
    // 最多等 10s：战斗播放 + 重播 + settle 的完整链路都在这条时间轴上。
    // 小卖部/助战探针（window.__shopProbe）同样在这里读取。
    {
      for (let k = 0; k < 20; k++) {
        const done = await ev(`!!((window.__cmdProbe && window.__cmdProbe.done) || (window.__shopProbe && window.__shopProbe.done) || (window.__expProbe && window.__expProbe.done))`);
        if (done) break;
        await sleep(500);
      }
      for (const key of ['__cmdProbe', '__shopProbe', '__abyssProbe', '__expProbe']) {
        const pr = await ev(`JSON.stringify(window.${key} || null)`);
        if (pr && pr !== 'null') {
          const p = JSON.parse(pr);
          console.log('\n== ' + key + ' ==');
          (p.steps || []).forEach((l) => console.log('  ' + l));
          if (p.err) console.log('  ✗ 探针异常: ' + p.err);
          if (p.fail) process.exitCode = 1;
        }
      }
    }

    // 场景几何：物件实际占位 vs 应该占的位置（浮空/错位全靠这个量出来）
    const geom = await ev(`(function(){
      var w = document.querySelector('.ci-pet-world');
      if (!w) return null;
      var wr = w.getBoundingClientRect();
      var floor = document.querySelector('.world-floor');
      var fr = floor ? floor.getBoundingClientRect() : null;
      var objs = Array.prototype.slice.call(w.querySelectorAll('.world-obj'));
      var rows = objs.map(function(o){
        var r = o.getBoundingClientRect();
        var a = o.querySelector('.world-obj-art');
        var ar = a ? a.getBoundingClientRect() : null;
        return {
          id: o.getAttribute('data-obj'),
          top: Math.round(r.top - wr.top),
          bottom: Math.round(r.bottom - wr.top),
          h: Math.round(r.height),
          css: (o.style.bottom || '-') + '/' + (o.style.top || '-') + '/' + (o.style.left || '-'),
          artH: ar ? Math.round(ar.height) : null,
          artBottom: ar ? Math.round(ar.bottom - wr.top) : null
        };
      });
      return {
        worldH: Math.round(wr.height),
        floorTop: fr ? Math.round(fr.top - wr.top) : null,
        objs: rows
      };
    })()`);
    const probe = await ev(`(function(){
      var out = [];
      [430, 446, 452, 458, 470].forEach(function(y){
        var els = document.elementsFromPoint(540, y).slice(0, 4).map(function(e){
          var cs = getComputedStyle(e);
          return e.className + '|bg=' + cs.backgroundColor + '|h=' + Math.round(e.getBoundingClientRect().height);
        });
        out.push('y' + y + ': ' + els.join('  <  '));
      });
      return out;
    })()`);
    if (probe) probe.forEach(function(l){ console.log('  图层 ' + l); });
    if (geom) {
      console.log('  世界高 ' + geom.worldH + ' | 地板顶 ' + geom.floorTop);
      geom.objs.forEach(function(o) {
        var gap = (o.artBottom !== null) ? (o.bottom - o.artBottom) : 0;
        console.log('    ' + (o.id + '            ').slice(0, 12) +
          ' box ' + o.top + '~' + o.bottom + ' 画 ' + o.artH + 'px' +
          ' [' + (o.css || '') + ']' +
          (gap ? '  ⚠️ 框底比画底低 ' + gap + 'px' : ''));
      });
    }

    // 遮挡体检：dock 是 sticky bottom:0，最后一块内容有没有被它压住。
    // 这是实证过的真 bug（v018 战斗页技能按钮被盖掉一半），必须每次量。
    const overlap = await ev(`(function(){
      var root = document.querySelector('.ci-pethome');
      var dock = document.querySelector('.ci-pet-tabs');
      if (!root || !dock) return { err: 'no-dock' };
      var dr = dock.getBoundingClientRect();
      var rr = root.getBoundingClientRect();
      // 滚动容器：横屏首页双栏时是 .ci-pet-side 自己，其余是 root
      var scroller = root.classList.contains('is-hometab') && document.querySelector('.ci-pet-side');
      if (scroller) { scroller.scrollTop = scroller.scrollHeight; }
      else { root.scrollTop = root.scrollHeight; }
      var kids = Array.prototype.slice.call((scroller || root).children);
      var last = null;
      for (var i = kids.length - 1; i >= 0; i--) {
        var c = kids[i];
        if (c.className.indexOf('ci-pet-dockpad') >= 0) continue;
        if (c.className.indexOf('ci-pet-tabs') >= 0) continue;
        last = c; break;
      }
      var cr = last ? last.getBoundingClientRect() : null;
      return {
        dockTop: Math.round(dr.top),
        rootBottom: Math.round(rr.bottom),
        lastCls: last ? last.className : null,
        lastBottom: cr ? Math.round(cr.bottom) : null,
        overlapPx: cr ? Math.round(cr.bottom - dr.top) : null,
        covered: cr ? (cr.bottom > dr.top + 1) : false
      };
    })()`);
    console.log('  遮挡:', JSON.stringify(overlap));
    if (overlap.covered) {
      console.log('  ⚠️ 末块内容被 dock 压住 ' + overlap.overlapPx + 'px');
      process.exitCode = 1;
    }
    // 关键控件是否被 dock 盖住（战斗页的四个指令键最容易中招）
    const ctl = await ev(`(function(){
      var root = document.querySelector('.ci-pethome');
      var dock = document.querySelector('.ci-pet-tabs');
      if (!root || !dock) return null;
      var scroller = root.classList.contains('is-hometab') && document.querySelector('.ci-pet-side');
      if (scroller) { scroller.scrollTop = scroller.scrollHeight; } else { root.scrollTop = root.scrollHeight; }
      var dr = dock.getBoundingClientRect();
      var sels = ['.ci-pet-cmdbar', '.ci-pet-cmdbtn', '.ci-pet-advstage', '.ci-pet-advcard', '.ci-pet-bstage-fight', '.ci-pet-ops-row2', '.ci-pet-quest-claim', '.ci-pet-tcard-go'];
      var out = [];
      sels.forEach(function(s){
        var el = document.querySelector(s);
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (!r.height) return;
        var covered = r.bottom > dr.top + 1;
        out.push({ sel: s, bottom: Math.round(r.bottom), covered: covered, over: covered ? Math.round(r.bottom - dr.top) : 0 });
      });
      if (scroller) { scroller.scrollTop = 0; } else { root.scrollTop = 0; }
      return out;
    })()`);
    if (ctl && ctl.length) {
      console.log('  关键控件:', JSON.stringify(ctl));
      ctl.forEach(function(c){ if (c.covered) { console.log('  ⚠️ ' + c.sel + ' 被 dock 盖住 ' + c.over + 'px'); process.exitCode = 1; } });
    }
    await ev(`(function(){ var r=document.querySelector('.ci-pethome'); if(r) r.scrollTop=0; return 1; })()`);

    // 舞台几何体检：角色有没有被切、名牌离角色多远、舞台下面空多少。
    // 这些只能靠实测 —— 截图上「看着有点空」说不清是哪一层的问题。
    const stage = await ev(`(function(){
      var root = document.querySelector('.ci-pethome');
      if (!root) return { err: 'no-root' };
      var q = function(s){ return document.querySelector(s); };
      var hero = q('.ci-pet-hero');
      var stageEl = q('.ci-pet-hero-stage');
      var info = q('.ci-pet-hero-info');
      var vid = q('.ci-pet-hero-video');
      var cv = q('.ci-pet-hero-stage canvas');
      var name = q('.ci-pet-name');
      var bubble = q('.ci-pet-thought');
      if (!hero) return { err: 'no-hero' };
      var hr = hero.getBoundingClientRect();
      var sr = stageEl ? stageEl.getBoundingClientRect() : null;
      var ir = info ? info.getBoundingClientRect() : null;
      var vr = vid ? vid.getBoundingClientRect() : null;
      var cr = cv ? cv.getBoundingClientRect() : null;
      var nr = name ? name.getBoundingClientRect() : null;
      var br = bubble ? bubble.getBoundingClientRect() : null;
      return {
        heroTop: Math.round(hr.top), heroH: Math.round(hr.height),
        stageH: sr ? Math.round(sr.height) : null,
        infoTop: ir ? Math.round(ir.top) : null, infoH: ir ? Math.round(ir.height) : null,
        // 角色实际可见区域（video/canvas 元素盒）
        vidTop: vr ? Math.round(vr.top) : null, vidBottom: vr ? Math.round(vr.bottom) : null,
        vidH: vr ? Math.round(vr.height) : null,
        cvTop: cr ? Math.round(cr.top) : null, cvBottom: cr ? Math.round(cr.bottom) : null,
        // 角色元素盒超出舞台的部分 = 被切掉的高度
        vidClippedTop: (vr && sr) ? Math.max(0, Math.round(sr.top - vr.top)) : null,
        cvClippedTop: (cr && sr) ? Math.max(0, Math.round(sr.top - cr.top)) : null,
        nameTop: nr ? Math.round(nr.top) : null,
        bubbleTop: br ? Math.round(br.top) : null,
        bubbleBottom: br ? Math.round(br.bottom) : null,
        // 名牌上方有多少空白（舞台底到名牌顶）
        gapAboveName: (ir && nr) ? Math.round(nr.top - ir.top) : null,
        // 角色站位：台座（光环）的位置就是角色的脚
        shadowTop: (function(){ var s = q('.ci-pet-scene-shadow'); return s ? Math.round(s.getBoundingClientRect().top) : null; })(),
        shadowBottom: (function(){ var s = q('.ci-pet-scene-shadow'); return s ? Math.round(s.getBoundingClientRect().bottom) : null; })(),
        // 角色脚（台座底）到名牌顶的距离：负数 = 角色站在名牌后面
        feetToName: (function(){
          var s = q('.ci-pet-scene-shadow'), n = q('.ci-pet-name');
          if (!s || !n) return null;
          return Math.round(n.getBoundingClientRect().top - s.getBoundingClientRect().bottom);
        })(),
        // 真正的「脚」：webm 人物脚在视频框底边往上 8% 处
        // （scripts/_pet-foot-probe.mjs 像素扫描实测：640×360，人物 minY=65/maxY=329）
        realFeet: (function(){
          var v = q('.ci-pet-hero-video'), n = q('.ci-pet-name');
          if (!v || !n) return null;
          var vr = v.getBoundingClientRect();
          var feet = vr.bottom - vr.height * 0.08;
          return Math.round(n.getBoundingClientRect().top - feet);
        })()
      };
    })()`);
    console.log('  舞台几何:', JSON.stringify(stage));
    if (stage.vidClippedTop > 4) {
      console.log('  ⚠️ 角色(video)头顶被切 ' + stage.vidClippedTop + 'px');
      process.exitCode = 1;
    }
    if (stage.cvClippedTop > 4) {
      console.log('  ⚠️ 角色(canvas)头顶被切 ' + stage.cvClippedTop + 'px');
      process.exitCode = 1;
    }
    // 角色脚（按像素实测换算）必须落在名牌上方，且不能离得太远
    if (stage.realFeet !== null && stage.realFeet < -4) {
      console.log('  ⚠️ 角色沉到名牌后面 ' + Math.abs(stage.realFeet) + 'px');
      process.exitCode = 1;
    }
    if (stage.realFeet !== null && stage.realFeet > 120) {
      console.log('  ⚠️ 角色离名牌太远 ' + stage.realFeet + 'px（中间空草地）');
      process.exitCode = 1;
    }

    // hero 子节点逐个量：绝对定位的不撑高，in-flow 的才决定 hero 高度。
    // 「hero 高 647 但舞台只有 214」这种怪事只能靠这个查出来。
    const heroKids = await ev(`(function(){
      var hero = document.querySelector('.ci-pet-hero');
      if (!hero) return [];
      var hr = hero.getBoundingClientRect();
      return Array.prototype.slice.call(hero.children).map(function(c){
        var r = c.getBoundingClientRect();
        var cs = getComputedStyle(c);
        return {
          cls: c.className,
          pos: cs.position,
          top: Math.round(r.top - hr.top),
          h: Math.round(r.height)
        };
      });
    })()`);
    console.log('  hero 子节点:', JSON.stringify(heroKids));

    // 右栏（side）顶部结构 dump：真机截图出现过「两个空紫块」，查它是什么
    const sideTop = await ev(`(function(){
      var side = document.querySelector('.ci-pet-side');
      if (!side) return { err: 'no-side' };
      return Array.prototype.slice.call(side.children).slice(0, 3).map(function(c){
        var r = c.getBoundingClientRect();
        var cs = getComputedStyle(c);
        return {
          cls: c.className,
          w: Math.round(r.width), h: Math.round(r.height),
          top: Math.round(r.top),
          display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
          text: (c.textContent || '').slice(0, 60),
          childCount: c.children.length
        };
      });
    })()`);
    console.log('  side 顶部:', JSON.stringify(sideTop, null, 1));

    // 整页长图已上移到「切页之前」（见循环开头），这里不再重复拍。
  }

  console.log('\n== 页面异常 ==');
  if (!ERRORS.length) console.log('  ✅ 无任何 JS 异常');
  else ERRORS.slice(0, 12).forEach((e) => console.log('  ❌ ' + e));
} catch (e) {
  console.error('✗ 工作台异常:', e.message);
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
}
