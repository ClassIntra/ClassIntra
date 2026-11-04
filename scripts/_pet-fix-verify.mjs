// 桌宠三处修复验证探针（一次性）：宠物屋滚动 / 拼豆画布自适应 / 切动作防闪
// 做法：headless Chrome + CDP，在同源文档里用宿主等价 CSS 复刻 AppShell→MarketRuntime 链路，
//       stub 掉 ClassIntraMarket 与 api，走真实点击链与真实 webm 素材。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = 'http://127.0.0.1:9001';
const OUT = join(tmpdir(), 'ci-petfix');
mkdirSync(OUT, { recursive: true });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9388',
  `--user-data-dir=${join(tmpdir(), 'ci-petfix-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9388${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const pageT = (await g('/json/list')).find(t => t.type === 'page');
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
// 介绍 onmessage 拦截：把 /harness-*.html 的两个请求就地伪造为 harness 页面。
// 为什么不用 setDocumentContent：navigate 到 json/plain 后 Chrome 建的是查看器文档，
// setDocumentContent 静默失效；而 data:/file: URL 又会让相对路径的 webm 失去同源。
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Fetch.requestPaused') {
    const url = m.params.request.url;
    const html = /harness-home/.test(url) ? HOME_HTML : /harness-ovl/.test(url) ? OVL_HTML : null;
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
    console.error('[页面异常]', (x.exception && x.exception.description) || x.text);
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
// ⚠️ CDP 的 Runtime.evaluate 在浏览器端抛异常时不会 reject，只给 exceptionDetails ——
//    不显式检查就会静默返回 undefined，看起来像"功能没生效"。
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  }
  return r.result.value;
};

// 页面里通用的小工具：按文字点按钮
const CLICK_BY_TEXT = `function __clickBtn(text){
  var bs = Array.prototype.slice.call(document.querySelectorAll('button'));
  var b = bs.filter(function(x){ return (x.textContent||'').indexOf(text) >= 0; })[0];
  if (!b) return 'no-button:' + text;
  b.click();
  return 'ok';
}`;


// 真实手势：CDP 派发 touch 序列（overflow:hidden 的元素仍可编程设 scrollTop，
// 只有真实手势才区分得出"用户划得动 / 划不动"）
async function swipeUp() {
  const x = 180, y0 = 430, y1 = 190;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 10; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + Math.round((y1 - y0) * i / 10) }] });
    await sleep(18);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(700);
  return await ev(`(function(){ var r = document.querySelector('.ci-pethome'); return r ? Math.round(r.scrollTop) : -1; })()`);
}

const STUB = `
window.__ci = { puts: [], apiCalls: [], state: null, toasts: [] };
window.__ci.state = {
  adopted: true, name: '大肥鱼二号', bond: 88, enabled: true,
  design: { type: 'video', character: 'dsh-whale' }
};
window.ClassIntraMarket = {
  apps: {},
  define: function(d){ window.__ci.appDef = d; },
  defineOverlay: function(d){ window.__ci.ovlDef = d; },
  createContext: function(name, manifest){
    var S = window.ClassIntraMarket;
    return {
      data: {
        api: {
          get: function(u){ return S._api('get', u, null); },
          put: function(u, b){ return S._api('put', u, b); },
          post: function(u, b){ return S._api('post', u, b); }
        },
        storage: {
          get: function(k, d){ try { var v = JSON.parse(localStorage.getItem('ci:app:pet:' + k)); return v === null ? d : v; } catch(e){ return d; } },
          set: function(k, v){ try { localStorage.setItem('ci:app:pet:' + k, JSON.stringify(v)); } catch(e){} }
        },
        realtime: null
      },
      app: { onDestroy: function(fn){ window.__ci.onDestroy = fn; } },
      system: { toast: function(p){ window.__ci.toasts.push(p); } }
    };
  },
  _api: function(verb, url, body){
    window.__ci.apiCalls.push([verb, url, body]);
    var st = window.__ci.state;
    return new Promise(function(res){
      setTimeout(function(){
        if (/\\/pet\\/state$/.test(url)) {
          if (verb === 'put') {
            var b = body || {};
            if (b.design !== undefined) st.design = b.design;
            if (b.name !== undefined) st.name = b.name;
            if (b.enabled !== undefined) st.enabled = b.enabled;
            if (b.adopt === true) st.adopted = true;
          }
          res({ data: { code: 200, data: { state: st, palette: ['#1B1B1F','#8E8E93','#FFFFFF','#E5E5EA','#FF3B30','#FF9EBB','#FF9500','#FFD60A','#A0715F','#34C759','#248A3D','#64D2FF','#0A84FF','#BF5AF2','#FFD8B8','#FF7B92'], templates: [{ id: 't1', name: '测试模板', desc: 'd', art: ['................','................','.....722777.....','....77777777....','...7777777777...','..777777777777..','..777777777777..','.77770777707777.','.7ff7777777ff77.','.77777700777777.','.77777777777777.','..777777777777..','....77777777....','......7777......','................','................'] }] } } });
        } else if (/level\\/info$/.test(url)) {
          res({ data: { code: 200, data: { level: 3, exp: 120 } } });
        } else if (/\\/pet\\/interact$/.test(url)) {
          st.bond = (st.bond || 0) + 4;
          res({ data: { code: 200, data: { state: st, gained: 4, tierUp: false, capped: false } } });
        } else { res({ data: { code: 200, data: {} } }); }
      }, 5);
    });
  }
};
`;

// 宿主链路等价 CSS（逐条照抄 AppShell.vue + MarketRuntime.vue 的 scoped 规则）
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

// Page.setDocumentContent 要的是 frame id，不是 target id —— 给错就静默不生效
const { frameTree } = await send('Page.getFrameTree');
const FRAME = frameTree.frame.id;

const HOME_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/market-static/pet/frontend/style.css">
<style>${HOST_CSS}</style></head><body>
<div class="app-shell"><div id="__nav"></div><div class="app-shell-body"><div class="app-shell-host">
<div class="market-runtime-container" id="host"></div>
</div></div></div></body></html>`;

const OVL_HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/market-static/pet/frontend/style.css">
<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:linear-gradient(160deg,#123,#345)}</style>
</head><body></body></html>`;

await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*harness*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}` + (detail ? `  ${detail}` : ''));
}

try {
  // ===================== A. 宠物屋页面 =====================
  await send('Page.navigate', { url: APP + '/harness-home.html' });
  await sleep(1500);
  await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/entry.js'; document.head.appendChild(s); return 1; })()`);
  await sleep(1500);
  const loaded = await ev(`({ def: typeof window.__ci.appDef, stub: typeof window.ClassIntraMarket, scriptTag: !!document.querySelector('script[src*="entry.js"]') })`);
  console.log('entry 载入:', JSON.stringify(loaded));
  if (loaded.def !== 'object') throw new Error('entry.js 未注册定义（脚本未执行到 define？）');
  await ev(`window.__ci.appDef.mount(document.getElementById('host'), window.ClassIntraMarket.createContext('pet', {}))`);
  await sleep(900);

  const home = await ev(`(function(){
    var root = document.querySelector('.ci-pethome');
    if (!root) return { err: '未挂载 .ci-pethome' };
    var cs = getComputedStyle(root);
    root.scrollTop = 99999;
    var canScroll = root.scrollTop;
    root.scrollTop = 0;
    return {
      overflowY: cs.overflowY, height: cs.height,
      clientH: root.clientHeight, scrollH: root.scrollHeight, scrolledTo: canScroll,
      hostH: document.getElementById('host').clientHeight,
      btns: Array.prototype.slice.call(root.querySelectorAll('button')).map(function(b){ return b.textContent; })
    };
  })()`);
  console.log('宠物屋:', JSON.stringify(home));
  check('A1 宠物屋 root 自滚动生效', home.overflowY === 'auto', `overflow-y=${home.overflowY}`);
  check('A3 形象卡入口存在（去画一只/换回来）',
    (home.btns || []).some(function(t){ return t.includes('去画一只') || t.includes('换回来'); }), '');

  // ---- 进编辑器：测画布是否溢出容器 ----
  const enterEdit = await ev(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('.ci-pet-stylecard-btn'));
    var b = bs[0];
    if (!b) return 'no-stylecard-btn';
    var label = b.textContent;
    b.click();
    return 'ok:' + label;
  })()`);
  await sleep(600);
  const ed = await ev(`(function(){
    var cv = document.querySelector('.ci-pet-editcanvas');
    if (!cv) return { err: '编辑器未出现' };
    var wrap = document.querySelector('.ci-pet-canvaswrap');
    var host = document.getElementById('host');
    var root = document.querySelector('.ci-pethome');
    return {
      canvasW: Math.round(cv.getBoundingClientRect().width),
      wrapW: Math.round(wrap.getBoundingClientRect().width),
      rootClientW: root.clientWidth, hostW: host.clientWidth,
      rootScrollW: root.scrollWidth,
      title: (document.querySelector('.ci-pethome h2')||{}).textContent
    };
  })()`);
  console.log('编辑器@1043:', JSON.stringify(ed));
  check('B1 进入拼豆编辑器', !ed.err, '(' + enterEdit + ') ' + (ed.title || ''));
  check('B2 画布未超出容器宽度', !ed.err && ed.rootScrollW <= ed.rootClientW + 1 && ed.wrapW <= ed.rootClientW,
    `画布=${ed.canvasW} 容器dpW=${ed.rootClientW} scrollW=${ed.rootScrollW}`);

  // ---- 窄屏 resize：验证 CELL 按容器重算 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 520, deviceScaleFactor: 1, mobile: true });
  await sleep(900);
  const ed2 = await ev(`(function(){
    var cv = document.querySelector('.ci-pet-editcanvas');
    var root = document.querySelector('.ci-pethome');
    if (!cv || !root) return { err: '编辑器丢失' };
    return {
      canvasW: Math.round(cv.getBoundingClientRect().width),
      rootClientW: root.clientWidth, rootScrollW: root.scrollWidth
    };
  })()`);
  // A2 用真实手势验证：手指往上划，宠物屋页面必须跟着滚
  await ev(`${CLICK_BY_TEXT}; __clickBtn('先不换了')`);
  await sleep(600);
  await ev(`(function(){ var r=document.querySelector('.ci-pethome'); if(r) r.scrollTop=0; return 1; })()`);
  const gesture = await swipeUp();
  const metrics = await ev(`(function(){ var r=document.querySelector('.ci-pethome');
    return { clientH: r.clientHeight, scrollH: r.scrollHeight, overflowY: getComputedStyle(r).overflowY }; })()`);
  console.log('宠物屋@375x520:', JSON.stringify(metrics), '手势后 scrollTop=' + gesture);
  check('A2 手指上划时宠物屋能滚动（超屏内容触得到）',
    metrics.scrollH > metrics.clientH + 4 && gesture > 0,
    `scrollH=${metrics.scrollH} clientH=${metrics.clientH} 手势scrollTop=${gesture}`);

  // 对照：把新增的自滚动摘掉，同样手势必须纹丝不动
  await ev(`(function(){ var r=document.querySelector('.ci-pethome'); r.style.overflowY='hidden'; r.scrollTop=0; return 1; })()`);
  const ctrlGesture = await swipeUp();
  await ev(`(function(){ var r=document.querySelector('.ci-pethome'); r.style.overflowY=''; r.scrollTop=0; return 1; })()`);
  check('A2-对照 摘掉自滚动后同一手势滚不动', ctrlGesture === 0, `关掉后手势scrollTop=${ctrlGesture}`);

  // 对照：旧算法（按 window.innerWidth 算）在窄屏会顶出多少
  const oldAlg = await ev(`(function(){
    var innerW = Math.min(window.innerWidth || 360, 760);
    var oldCell = Math.max(22, Math.min(34, Math.floor((innerW - 56) / 16 / 2) * 2));
    var root = document.querySelector('.ci-pethome');
    var contentW = root.clientWidth - 32; // root 左右 padding
    return { oldCell: oldCell, oldCanvas: oldCell * 16, avail: contentW - 16 - 16 };
  })()`);
  console.log('旧算法对照@375:', JSON.stringify(oldAlg));
  check('B3-对照 旧算法在窄屏确实溢出', oldAlg.oldCanvas > oldAlg.avail,
    `旧画布=${oldAlg.oldCanvas} 可用=${oldAlg.avail} 溢出=${oldAlg.oldCanvas - oldAlg.avail}px`);
  await ev(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('.ci-pet-stylecard-btn'));
    if (!bs[0]) return 'no-btn';
    bs[0].click();
    return 'ok';
  })()`);
  await sleep(500);
  console.log('编辑器@375:', JSON.stringify(ed2));
  check('B3 窄屏 resize 后画布重算且不溢出',
    !ed2.err && ed2.canvasW <= ed2.rootClientW && ed2.rootScrollW <= ed2.rootClientW + 1,
    `画布=${ed2.canvasW} 容器=${ed2.rootClientW} scrollW=${ed2.rootScrollW}`);

  await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: false });
  await sleep(600);

  // ---- 走完手工链路：就它了 → 命名 → 变手作 → 再换回大肥鱼 ----
  await ev(`${CLICK_BY_TEXT}; __clickBtn('就它了')`);
  await sleep(500);
  const naming = await ev(`(function(){
    var inp = document.querySelector('.ci-pet-input');
    return { inputExists: !!inp, value: inp ? inp.value : null,
      h2: (document.querySelector('.ci-pethome h2')||{}).textContent || '',
      btns: (Array.prototype.slice.call(document.querySelectorAll('button'))).map(function(b){return b.textContent;}).join('|') };
  })()`);
  check('B4 命名页预填当前名字', naming.inputExists && naming.value === '大肥鱼二号', `value=${naming.value}`);

  await ev(`${CLICK_BY_TEXT}; __clickBtn('保存造型与名字')`);
  await sleep(800);
  const designAfter = await ev(`JSON.stringify(window.__ci.state.design).slice(0, 60)`);
  check('B5 保存后 design 变为手作拼豆', designAfter.indexOf('"v":1') > 0 || designAfter.indexOf('pal') > 0, designAfter);

  const hasWhale = await ev(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('.ci-pet-stylecard-btn'));
    var b = bs.filter(function(x){ return (x.textContent || '') === '使用'; })[0];
    if (!b) return 'no-use-btn';
    b.click();
    return 'ok';
  })()`);
  await sleep(900);
  const back = await ev(`JSON.stringify({design: window.__ci.state.design, name: window.__ci.state.name,
     btns: Array.prototype.slice.call(document.querySelectorAll('.ci-pet-btn')).map(function(b){return b.textContent;})})`);
  const backObj = JSON.parse(back);
  check('B6 可换回大肥鱼（双向切换成立）',
    backObj.design && backObj.design.type === 'video' && backObj.name === '大肥鱼二号',
    `(${hasWhale}) design=${JSON.stringify(backObj.design)}`);
  console.log('B7 现场 btns:', JSON.stringify(backObj.btns));
  const b7btns = await ev(`Array.prototype.slice.call(document.querySelectorAll('.ci-pet-stylecard-btn')).map(function(b){ return b.textContent; })`);
  check('B7 切回 video 后形象卡入口仍在（去画一只/换回来）',
    (b7btns || []).some(function(t){ return t.includes('去画一只') || t.includes('换回来'); }),
    JSON.stringify(b7btns));

  // ===================== B. 悬浮层：切动作防闪 =====================
  await send('Page.navigate', { url: APP + '/harness-ovl.html' });
  await sleep(1200);
  await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/overlay.js'; document.head.appendChild(s); return 1; })()`);
  await sleep(1000);
  await ev(`window.__ci.ovlDef.mount(document.body, window.ClassIntraMarket.createContext('pet', {}))`);
  await sleep(2500);

  const built = await ev(`(function(){
    var pet = document.querySelector('.ci-pet');
    var v = document.querySelector('.ci-pet-video');
    return { mounted: !!pet, hasVideo: !!v, readyState: v ? v.readyState : -1,
      paused: v ? v.paused : null, w: v ? v.videoWidth : 0, h: v ? v.videoHeight : 0,
      src: v ? (v.getAttribute('src')||'').split('/').pop() : '' };
  })()`);
  console.log('悬浮层:', JSON.stringify(built));
  check('C1 悬浮桌宠已上屏且首个素材在播',
    built.mounted && built.hasVideo && built.readyState >= 2 && built.paused === false,
    `rs=${built.readyState} ${built.w}x${built.h} ${built.src}`);

  // 采样：每帧记录 video/freeze 的可见性；期间高频触发动作切换
  const sample = await ev(`(async function(){
    var v = document.querySelector('.ci-pet-video');
    var pet = document.querySelector('.ci-pet');
    var frames = [];
    var freezeSeen = 0, freezePixels = -1, lastSrc = v ? v.getAttribute('src') : '';
    var running = true;
    function loop(){
      if (!running) return;
      var f = pet.querySelector('.ci-pet-freeze');
      var vo = v ? (v.style.opacity || '1') : 'x';
      var fo = f ? (f.style.opacity || '0') : 'absent';
      var src = v ? (v.getAttribute('src')||'') : '';
      if (src !== lastSrc) { lastSrc = src; }
      if (fo === '1') {
        freezeSeen++;
        if (freezePixels < 0 && f && f.width) {
          try {
            var d = f.getContext('2d').getImageData(0, 0, f.width, f.height).data;
            var n = 0;
            for (var i = 3; i < d.length; i += 4 * 37) { if (d[i] > 8) n++; }
            freezePixels = n;
          } catch (e) { freezePixels = 'err:' + e.message; }
        }
      }
      frames.push([vo, fo, v ? v.readyState : -1]);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    for (var k = 0; k < 14; k++) {
      await new Promise(function(r){ setTimeout(r, 220); });
      if (window.__ciPetPoke) window.__ciPetPoke();
    }
    await new Promise(function(r){ setTimeout(r, 900); });
    running = false;
    var blankFrames = frames.filter(function(f){ return f[0] === '0' && f[1] !== '1'; }).length;
    var total = frames.length;
    return { total: total, freezeFrames: freezeSeen, freezePixels: freezePixels,
      blankFrames: blankFrames, last: frames[frames.length-1],
      voHist: frames.reduce(function(a,f){ a[f[0]] = (a[f[0]]||0)+1; return a; }, {}),
      foHist: frames.reduce(function(a,f){ a[f[1]] = (a[f[1]]||0)+1; return a; }, {}) };
  })()`);
  console.log('切换采样:', JSON.stringify(sample));
  check('C2 幕布机制生效（换源期确实被遮住）', sample.freezeFrames > 0, `freeze 帧数=${sample.freezeFrames}`);
  check('C3 幕布画的是真像素而非空画布', typeof sample.freezePixels === 'number' && sample.freezePixels > 0,
    `非透明采样点=${sample.freezePixels}`);
  check('C4 全程无空白帧（不会"一闪"）', sample.blankFrames === 0, `空白帧=${sample.blankFrames}/${sample.total}`);
  check('C5 采样结束回到正常视频显示', sample.last && sample.last[0] === '1', `末帧=${JSON.stringify(sample.last)}`);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, 'pet-overlay.png'), Buffer.from(shot.data, 'base64'));
  console.log('截图:', join(OUT, 'pet-overlay.png'));
} catch (e) {
  console.error('探针异常:', e.stack || e.message);
}
const failed = results.filter(r => !r.pass);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) console.log('失败项:', failed.map(f => f.name).join(', '));
ws.close();
chrome.kill();
process.exit(0);
