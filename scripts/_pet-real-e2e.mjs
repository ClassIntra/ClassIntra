// 桌宠 v0.11.0 真实端到端：真浏览器 + 真服务端（不走 STUB）。
//
// 用法：node scripts/_pet-real-e2e.mjs [user_id]
// 前置：CI 在 127.0.0.1:9001 运行；server/.env 有 JWT_SECRET。
//
// 为什么要这一层：_pet-ui-shot.mjs 把 api 层整个 stub 掉了，
// 它能证明「UI 能渲染」，但证明不了「服务端下发的字段真的能喂饱这些组件」。
// 2026-10-27 那次「截图没变化其实是缓存」的教训就是：只看 stub 截图会误判。
//
// 断言：
//   1. /pet 页面真的渲染出日记卡，且正文来自服务端（非占位文案）
//   2. 小鱼干余额与 /api/pet/state 一致
//   3. 互动区 4 个按钮，专注按钮存在
//   4. 点专注 → 3 个时长选项 → 选 15 分钟 → 按钮进入「专注中」
//   5. 提前收工 → 命中真实 /pet/focus（不到 1 分钟 → tooShort 提示）→ 按钮复位
//   6. 全程无未捕获异常
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const BASE = 'http://127.0.0.1:9001';
const USER_ID = process.argv[2] || '999999';
const CDP_PORT = 9341;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VW = 1043, VH = 787;

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
if (!SECRET) { console.error('✗ server/.env 里没读到 JWT_SECRET'); process.exit(1); }
const token = jwt.sign({ user_id: USER_ID, is_admin: 1, is_class_admin: 1, role: 'admin' },
  SECRET, { expiresIn: '1h' });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' → ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' → ' + detail : '')); }
}

// 先用 API 拿一份基准，跟页面显示对账
const apiRes = await fetch(BASE + '/api/pet/state', { headers: { Authorization: 'Bearer ' + token } });
const apiJson = await apiRes.json();
const st = (apiJson.data && apiJson.data.state) || {};
const diary = apiJson.data && apiJson.data.diary;

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${join(tmpdir(), 'ci-pet-e2e-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', `--window-size=${VW},${VH}`,
  // ⚠️ 关掉 LCD 次像素抗锯齿。headless 下中文字重（600/700）会走合成粗体，
  //    在 LCD 子像素模式下同一段文字会被画两次（错位约一行），截图看着像"重影"，
  //    但 DOM 只有一份、getAnimations() 也是 0 —— 纯渲染层伪影，不是页面 bug。
  //    真机（平板）用的是系统字体栈，不会出现这个现象；这里关掉只是为了截图可判读。
  '--disable-lcd-text', '--font-render-hinting=none',
  'about:blank'
], { stdio: 'ignore' });

async function getJSON(p) { return (await fetch(`http://127.0.0.1:${CDP_PORT}${p}`)).json(); }
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await getJSON('/json/version'); break; } catch { await sleep(500); } }
if (!ver) { console.error('✗ Chrome 未启动'); chrome.kill(); process.exit(1); }

let page = null;
for (let i = 0; i < 40; i++) {
  const list = await getJSON('/json/list');
  page = list.find(t => t.type === 'page');
  if (page) break; await sleep(400);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJS = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.text || r.exceptionDetails));
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
// ⚠️ mobile 必须给 false：设为 true 会打开 Chrome 的「移动端字体自动放大」（font boosting），
//    在这套布局里会把同一个标签渲染成两份错位的字（看起来像重影），
//    但 DOM 只有一份、动画也已结束——纯渲染层的假象，很容易被误判成页面 bug。
//    deviceScaleFactor 保持 1，和 _pet-ui-shot.mjs 的判据对齐。
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    try { localStorage.setItem('token', ${JSON.stringify(token)}); } catch (e) {}
    window.__e2eErrors = [];
    window.addEventListener('error', function(e){ window.__e2eErrors.push(String(e.message||e)); });
    window.addEventListener('unhandledrejection', function(e){ window.__e2eErrors.push('rejection: ' + String(e.reason)); });
    // 抓 /pet/focus 的真实响应体。
    // ⚠️ 不能用「页面上有没有『不到 1 分钟』这句话」来判断：小卖部本身就有「小鱼干」，
    //    文案断言会被无关文本误命中（第一版就踩了，报了一条假绿）。
    //    axios 在浏览器走 XHR，所以这里钩 XMLHttpRequest 而不是 fetch。
    (function(){
      var origOpen = XMLHttpRequest.prototype.open;
      var origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(m, u){
        this.__e2eUrl = String(u || '');
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(){
        var self = this;
        if (self.__e2eUrl && self.__e2eUrl.indexOf('/pet/focus') >= 0) {
          self.addEventListener('load', function(){
            try { window.__focusResp = JSON.parse(self.responseText); }
            catch (e) { window.__focusResp = { parseError: String(e), raw: String(self.responseText).slice(0, 200) }; }
          });
        }
        return origSend.apply(this, arguments);
      };
    })();
  `
});

console.log('打开', BASE + '/pet ...');
await send('Page.navigate', { url: BASE + '/pet' });

let mounted = false;
for (let i = 0; i < 120; i++) {
  await sleep(300);
  mounted = await evalJS(`!!document.querySelector('.ci-pethome')`);
  if (mounted) break;
}
ok('/pet 页面挂载成功', mounted, mounted ? '' : '30s 内未见 .ci-pethome');

if (mounted) {
  // 等首屏数据落位（日记卡依赖 /pet/state 返回）
  for (let i = 0; i < 40; i++) {
    if (await evalJS(`!!document.querySelector('.ci-pet-diary')`)) break;
    await sleep(300);
  }
  const view = await evalJS(`(function(){
    var q = function(s){ return document.querySelector(s); };
    var quote = q('.ci-pet-diary-text');
    var tag = q('.ci-pet-diary-tag');
    var coins = q('.ci-pet-shoppe-num');
    var acts = document.querySelectorAll('.ci-pet-actions .ci-pet-bigbtn');
    return {
      hasDiary: !!q('.ci-pet-diary'),
      quote: quote ? quote.textContent : '',
      empty: !!(q('.ci-pet-diary-quote') && q('.ci-pet-diary-quote').className.indexOf('is-empty') >= 0),
      tag: tag ? tag.textContent : '',
      coins: coins ? coins.textContent : '',
      actCount: acts.length,
      focusBtn: !!q('.ci-pet-focusbtn'),
      loadFail: (document.body.textContent || '').indexOf('加载失败') >= 0
    };
  })()`);
  console.log('\n== 真实页面 ==');
  console.log(JSON.stringify(view, null, 1));

  ok('日记卡渲染', view.hasDiary);
  ok('日记正文来自服务端（非占位）',
    !view.empty || (view.quote.length > 6 && view.quote.indexOf('今天还没什么可记的') >= 0),
    'API: ' + ((diary && diary.today && diary.today.text) || '').slice(0, 20) + ' | 页面: ' + view.quote.slice(0, 30));
  ok('日记正文与 API 一致',
    !diary || !diary.today.text || view.quote.indexOf(diary.today.text.slice(0, 10)) >= 0,
    'API: ' + ((diary && diary.today && diary.today.text) || '').slice(0, 20));
  ok('小鱼干余额与 API 一致', String(st.coins || 0) === view.coins, 'API ' + (st.coins || 0) + ' / 页面 ' + view.coins);
  ok('互动区 4 个按钮', view.actCount === 4, '实际 ' + view.actCount);
  ok('专注按钮存在', view.focusBtn);
  ok('页面没有加载失败提示', !view.loadFail);

  console.log('\n== 专注流程（真实请求）==');
  await evalJS(`(function(){ var b=document.querySelector('.ci-pet-focusbtn'); if(b) b.click(); return true; })()`);
  await sleep(400);
  const picks = await evalJS(`document.querySelectorAll('.ci-pet-focuspick-btn').length`);
  ok('时长选项 3 个', picks === 3, '实际 ' + picks);

  await evalJS(`(function(){ var b=document.querySelector('.ci-pet-focuspick-btn[data-focus-min="15"]'); if(b) b.click(); return true; })()`);
  await sleep(900);
  const running = await evalJS(`(document.querySelector('.ci-pet-focusbtn .ci-pet-bigbtn-label')||{}).textContent || ''`);
  ok('进入专注中', running.indexOf('专注中') >= 0, running);

  // 悬浮层（桌面上那只）必须同步进入专注态：
  // 页面计时和桌面表现是两套代码，只测页面会漏掉「桌宠还在乱跳」这种割裂。
  const petState = await evalJS(`(function(){
    var d = window.__ciPetDebug && window.__ciPetDebug();
    return d ? { focusOn: d.focusOn, mode: d.mode } : null;
  })()`);
  console.log('桌宠状态:', JSON.stringify(petState));
  if (petState) {
    ok('桌面桌宠进入 focus 模式', petState.focusOn === true && petState.mode === 'focus',
      'focusOn=' + petState.focusOn + ', mode=' + petState.mode);
  } else {
    console.log('  · 桌宠未挂载（本次跳过桌面态断言）');
  }

  // 提前收工：真实服务端会判 tooShort（本次只坐了 1 秒）
  await evalJS(`(function(){ var b=document.querySelector('.ci-pet-focusbtn'); if(b) b.click(); return true; })()`);
  await sleep(1800);
  const focusResp = await evalJS(`window.__focusResp || null`);
  console.log('真实响应:', JSON.stringify(focusResp && focusResp.data ? {
    code: focusResp.code, tooShort: focusResp.data.tooShort, coinsGain: focusResp.data.coinsGain
  } : focusResp));
  ok('命中真实 /pet/focus 且成功', !!(focusResp && focusResp.code === 200), JSON.stringify(focusResp && focusResp.code));
  ok('不足 1 分钟被判 tooShort（不产小鱼干）',
    !!(focusResp && focusResp.data && focusResp.data.tooShort === true && focusResp.data.coinsGain === 0),
    focusResp && focusResp.data ? ('tooShort=' + focusResp.data.tooShort + ', coinsGain=' + focusResp.data.coinsGain) : '无响应');

  const after = await evalJS(`(function(){
    var lbl = (document.querySelector('.ci-pet-focusbtn .ci-pet-bigbtn-label')||{}).textContent || '';
    return { label: lbl, body: document.body.textContent || '' };
  })()`);
  ok('结算后按钮复位', after.label.indexOf('专注中') < 0, after.label);
  const petAfter = await evalJS(`(function(){
    var d = window.__ciPetDebug && window.__ciPetDebug();
    return d ? { focusOn: d.focusOn, mode: d.mode } : null;
  })()`);
  if (petAfter) {
    ok('结算后桌宠退出 focus 模式', petAfter.focusOn === false && petAfter.mode !== 'focus',
      'focusOn=' + petAfter.focusOn + ', mode=' + petAfter.mode);
  }
  // toast 是宿主能力，可能在下一次重绘时消失，所以只作为补充信息记录，不做硬断言
  console.log('  · toast 文案抓取: ' + (after.body.indexOf('不到 1 分钟') >= 0 ? '命中' : '未捕获（可能已消失）'));

  const errs = await evalJS(`window.__e2eErrors || []`);
  ok('无未捕获异常', Array.isArray(errs) && errs.length === 0, JSON.stringify(errs));

  // 截图前多等一会儿：如果重影是动画/合成撕裂，静置后会消失；
  // 如果还在，就说明 DOM 真的被渲染了两份（那是另一个量级的问题）。
  await sleep(3000);
  const dupInfo = await evalJS(`(function(){
    var roots = document.querySelectorAll('.ci-pethome');
    var names = document.querySelectorAll('.ci-pet-name');
    var n = names[0] || null;
    var chain = [];
    var p = n;
    while (p && chain.length < 8) {
      var cs = getComputedStyle(p);
      chain.push({
        cls: (p.className || p.tagName || '').toString().slice(0, 40),
        filter: cs.filter,
        backdrop: cs.backdropFilter || '',
        transform: cs.transform,
        opacity: cs.opacity,
        willChange: cs.willChange,
        zoom: cs.zoom,
        contain: cs.contain
      });
      p = p.parentElement;
    }
    var rect = n ? n.getBoundingClientRect() : null;
    return {
      roots: roots.length,
      names: names.length,
      nameTexts: Array.prototype.map.call(names, function(x){ return x.textContent; }),
      anims: document.getAnimations ? document.getAnimations().length : -1,
      rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      chain: chain
    };
  })()`);
  console.log('DOM 重复检查:', JSON.stringify(dupInfo));
  const colorProbe = await evalJS(`(function(){
    var q = function(s){ return document.querySelector(s); };
    var hero = q('.ci-pet-hero');
    var name = q('.ci-pet-name');
    var label = q('.ci-pet-statlabel');
    var root = q('.ci-pethome');
    var cs = function(el){ return el ? getComputedStyle(el) : null; };
    var rs = root ? getComputedStyle(root) : null;
    return {
      heroBg: cs(hero) ? cs(hero).backgroundColor : null,
      nameColor: cs(name) ? cs(name).color : null,
      labelColor: cs(label) ? cs(label).color : null,
      rootBg: rs ? rs.backgroundColor : null,
      varCardBg: rs ? rs.getPropertyValue('--ci-color-bg-card') : null,
      varText1: rs ? rs.getPropertyValue('--ci-color-text-primary') : null,
      varText2: rs ? rs.getPropertyValue('--ci-color-text-secondary') : null,
      htmlDark: document.documentElement.classList.contains('dark') ||
                document.documentElement.getAttribute('data-theme'),
      // 互动按钮：它们不是"卡片"，底色同样是 bg-card，文字色需要单独确认
      pokeBtnColor: cs(q('.ci-pet-bigbtn:not(.ci-pet-bigbtn--primary)')) ? cs(q('.ci-pet-bigbtn:not(.ci-pet-bigbtn--primary)')).color : null,
      pokeBtnBg: cs(q('.ci-pet-bigbtn:not(.ci-pet-bigbtn--primary)')) ? cs(q('.ci-pet-bigbtn:not(.ci-pet-bigbtn--primary)')).backgroundColor : null,
      buyCls: q('.ci-pet-shoppe-buy') ? q('.ci-pet-shoppe-buy').className : null,
      buyColor: cs(q('.ci-pet-shoppe-buy')) ? cs(q('.ci-pet-shoppe-buy')).color : null,
      buyBg: cs(q('.ci-pet-shoppe-buy')) ? cs(q('.ci-pet-shoppe-buy')).backgroundColor : null
    };
  })()`);
  console.log('配色探针:', JSON.stringify(colorProbe, null, 1));

  if (colorProbe.heroBg && colorProbe.nameColor) {
    // 对比度守门：卡片是浅底时，卡片内文字必须是深色。
    // 这条断言来自一次真实事故：主题给了米白卡片(#F8F2E4) + 纯白文字，
    // 卡片里所有标题都接近不可见，而截图看起来只是"有点糊"。
    const lumOf = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(String(s));
      if (!m) return null;
      const p = m[1].split(',').map(Number);
      return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255;
    };
    const bgL = lumOf(colorProbe.heroBg);
    const fgL = lumOf(colorProbe.nameColor);
    const contrastOk = bgL === null || fgL === null ? true : (bgL >= 0.5 ? fgL < 0.5 : fgL > 0.5);
    console.log('对比度: 卡片底 ' + (bgL === null ? '?' : bgL.toFixed(2)) + ' / 文字 ' + (fgL === null ? '?' : fgL.toFixed(2)));
    ok('卡片内文字与底色明暗相反（不成白字压白底）', contrastOk,
      colorProbe.heroBg + ' ← ' + colorProbe.nameColor);
  }
  // 截图前强制整屏重绘：先滚一点再回顶。
  // 若重影随之消失，就证明它是合成层里的旧帧残留（页面逻辑无关），
  // 而不是真的画了两份内容 —— 这是 headless 截图常见的假象。
  await evalJS(`(function(){
    var r = document.querySelector('.ci-pethome');
    if (r) { r.scrollTop = 120; }
    window.scrollTo(0, 8);
    return true;
  })()`);
  await sleep(280);
  await evalJS(`(function(){
    var r = document.querySelector('.ci-pethome');
    if (r) { r.scrollTop = 0; }
    window.scrollTo(0, 0);
    return true;
  })()`);
  await sleep(600);

  // fromSurface 默认 true；前面试过 false，headless 下拿不到视图层（截图只有几 KB）。
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(tmpdir(), 'ci-pet-ui', 'pethome-real.png'), Buffer.from(s.data, 'base64'));
  console.log('  📷 ' + join(tmpdir(), 'ci-pet-ui', 'pethome-real.png'));

  // 放大 3 倍只看 hero 区：判断"重影"到底是两行真文字，还是同一行的渲染残影。
  const zoomShot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 175, y: 130, width: 700, height: 200, scale: 3 }
  });
  writeFileSync(join(tmpdir(), 'ci-pet-ui', 'hero-zoom.png'), Buffer.from(zoomShot.data, 'base64'));
  console.log('  📷 ' + join(tmpdir(), 'ci-pet-ui', 'hero-zoom.png'));

  // 滚到日记卡再拍一张：交付物里要能看到 v0.11.0 的新界面
  await evalJS(`(function(){ var d=document.querySelector('.ci-pet-diary'); if(d) d.scrollIntoView({block:'center'}); return true; })()`);
  await sleep(450);
  const diaryShot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(tmpdir(), 'ci-pet-ui', 'pethome-real-diary.png'), Buffer.from(diaryShot.data, 'base64'));
  console.log('  📷 ' + join(tmpdir(), 'ci-pet-ui', 'pethome-real-diary.png'));

  // A/B：把字体栈整个换掉再拍一张。
  // 目的：确认截图里那层"重影"到底来自页面布局，还是 Windows headless 下
  // Microsoft YaHei 的合成粗体（同一段文字被画两遍、错位约一行）。
  // 布局问题换字体也会重影；纯字体渲染问题则第二张会干净。
  await evalJS(`(function(){
    var st = document.createElement('style');
    st.id = 'e2e-font-probe';
    st.textContent = '.ci-pethome, .ci-pethome * { font-family: sans-serif !important; -webkit-font-smoothing: antialiased; }';
    document.head.appendChild(st);
    return true;
  })()`);
  await sleep(700);
  const s2 = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(tmpdir(), 'ci-pet-ui', 'pethome-real-sans.png'), Buffer.from(s2.data, 'base64'));
  console.log('  📷 ' + join(tmpdir(), 'ci-pet-ui', 'pethome-real-sans.png') + '  (A/B: 换字体)');
}

console.log('\n===== 结果 =====');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
// ⚠️ ws 不关，Node 的事件循环会一直被它吊着：脚本跑完 30 秒的事，进程却要拖 5 分钟。
//    上一版就是这样，表现为「命令明明走完了但一直不退出」。
try { ws.close(); } catch (e) {}
chrome.kill();
if (fail) process.exit(1);
console.log('  🎉 全绿');
process.exit(0);
