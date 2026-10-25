// 「我的」/个人主页：封面压头像（z-index 泄漏回归）+ 封面高度 + 头像加载状态采集
// 背景（2026-10-24）：
//   bug1 封面压头像：.mine-cover 曾为 relative+z-index:auto（不形成堆叠上下文），
//        内部 img(z1)/glow(z2)/edit(z3) 漏进祖先堆叠上下文，压住 z-index:auto 的
//        .mine-avatar → 头像骑跨封面的上半截被盖住。修复：cover 加 z-index:0 收口，
//        avatar 显式 z-index:4 置顶。
//   bug2 封面太小：「我的」页封面曾固定 118px（个人主页同内容 240-280px，两页失衡）。
//   bug3 头像偶发不显示：avatar-store 批量请求失败不重试（api 层也无重试），
//        组件侧无兜底 → 文字头像挂到下次重载。
// 断言：
//   Z1  cover 计算 z-index = 0（内部层级收口）
//   Z2  avatar 计算 z-index = 4（压过 edit z3）
//   Z3  elementFromPoint 头像中心命中头像子树
//   Z4  骑跨取样点（封面下沿-20px）命中头像 subtree —— bug 发作点
//   Z5  栈序：封面子树叶元素全部排在头像侧元素之后
//   Z6  个人主页同款命中测试（已知良好，防回归）
//   C1  「我的」封面高度 ≥ 150px（修复后 clamp(148px,17vw,200px)，1043 视口 ≈177px）
//   C2  个人主页封面高度 ≥ 200px（width/3.2 钳制，1043 视口 ≈280px）
//   A1  「我的」页头像图片加载完成（naturalWidth>0 且不透明）
//   A2  个人主页（自己）头像图片加载完成
//   A3  他人主页头像图片加载完成（走 avatar-store 批量路径）
//   A4  批量接口失败一次后重进页面，头像仍能恢复（重试链路）
//   N1  三轮访问无云盘图片请求失败（排除同步延迟的固有窗口）
// 用法：C:/Program Files/nodejs/node.exe scripts/probe-mine-avatar-zindex.mjs
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const ME = process.env.PROBE_USER || '251800'; // 有头像也有封面
const RUN = Date.now().toString(36);
const OUT = join(tmpdir(), 'ci-mine-zindex-out-' + RUN);          // 截图输出
const PROFILE_DIR = join(tmpdir(), 'ci-mine-zindex-chrome-' + RUN); // Chrome profile（必须与 OUT 分开！）
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let S = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { S = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: ME }, S, { expiresIn: '1h' });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9433',
  `--user-data-dir=${PROFILE_DIR}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });
const get = async (p) => (await fetch(`http://127.0.0.1:9433${p}`)).json();
for (let i = 0; i < 60; i++) { try { await get('/json/version'); break; } catch { await sleep(500); } }
const page = (await get('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pend = new Map();
const failedReqs = [];   // { url, errorText, status }
const cloudStatus = [];  // { url, status }
let batchResponses = 0;  // avatar/batch 响应计数（等批量回落用）
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id);
    pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Network.loadingFailed') {
    const u = (m.params && m.params.requestId) ? '' : '';
    failedReqs.push({ url: m.params.request ? m.params.request.url : u, errorText: m.params.errorText || '' });
  }
  if (m.method === 'Network.responseReceived') {
    const u = (m.params.response && m.params.response.url) || '';
    if (/cloud\/files/.test(u)) cloudStatus.push({ url: u, status: m.params.response.status });
    if (/avatar\/batch/.test(u)) batchResponses++;
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(s.data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Emulation.setEmulatedMedia', { media: 'no-preference' });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('token',${JSON.stringify(token)});localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: ME, net_name: 'probe' }))});}catch(e){}`
});

// 等启动屏移除：__onVueReady 后还有 1.5s 最短展示 + 420ms 冲线 + 750ms 淡出，
// 期间 #app-loading 虽在淡出但仍占满屏且可命中 —— 命中测试必须等它彻底离开 DOM
async function waitSplashGone(maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (maxMs || 15000)) {
    const gone = await ev(`!document.getElementById('app-loading')`);
    if (gone) return true;
    await sleep(100);
  }
  return false;
}
// 等封面图淡入完成 + 头像图片加载完成（稳定态再测）
async function waitMediaReady(coverSel, coverLoadedCls, avatarSel) {
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const s = await ev(`(function(){
      var img=document.querySelector(${JSON.stringify(coverSel)});
      var av=document.querySelector(${JSON.stringify(avatarSel)});
      if(!img||!av) return {ok:false};
      var coverOk = ${coverLoadedCls ? "img.classList.contains('is-loaded') && Number(getComputedStyle(img).opacity)>0.9 && img.naturalWidth>0" : "Number(getComputedStyle(img).opacity)>0.9 && img.naturalWidth>0"};
      var avImg=av.querySelector('img.user-avatar-img');
      var avOk = avImg ? (avImg.complete && avImg.naturalWidth>0 && Number(getComputedStyle(avImg).opacity)>0.9) : false;
      return {ok:true, coverOk:coverOk, avOk:avOk, avImg:!!avImg};
    })()`);
    if (s.ok && s.coverOk && s.avOk) return true;
    await sleep(60);
  }
  return false;
}
// 头像状态采集
function measureAvatar(avatarSel) {
  return `(function(){
    var av=document.querySelector(${JSON.stringify(avatarSel)});
    if(!av) return {avatar:false};
    var img=av.querySelector('img.user-avatar-img');
    var txt=av.querySelector('.user-avatar-text');
    var r=av.getBoundingClientRect();
    return {
      rect:{top:Math.round(r.top),left:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)},
      hasImg: !!img,
      imgSrc: img? (img.getAttribute('src')||'') : null,
      natural: img? [img.naturalWidth, img.naturalHeight] : null,
      opacity: img? getComputedStyle(img).opacity : null,
      complete: img? img.complete : null,
      textShown: txt? getComputedStyle(txt).display!=='none' : null
    };
  })()`;
}
// 堆叠命中测试
function hitTest(heroSel, avatarSel, coverSel, imgSel) {
  return `(function(){
    var hero = document.querySelector(${JSON.stringify(heroSel)});
    if (!hero) return { hero: false };
    hero.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    var av = document.querySelector(${JSON.stringify(avatarSel)});
    var cover = document.querySelector(${JSON.stringify(coverSel)});
    var img = document.querySelector(${JSON.stringify(imgSel)});
    if (!av) return { avatar: false };
    var r = av.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cr = cover ? cover.getBoundingClientRect() : null;
    var oy = cr ? cr.bottom - 20 : r.top + 10;   // 骑跨取样点：封面下沿上方 20px
    var hitCenter = document.elementFromPoint(cx, r.top + r.height / 2);
    var hitOverlap = document.elementFromPoint(cx, oy);
    function own(el) { return !!(el && el.closest && el.closest(${JSON.stringify(avatarSel)})); }
    var stack = document.elementsFromPoint(cx, oy).slice(0, 8).map(function (e) {
      var c = (typeof e.className === 'string' && e.className.trim()) ? '.' + e.className.trim().split(/\\s+/).join('.') : '';
      return e.tagName.toLowerCase() + c;
    });
    return {
      coverH: cover ? Math.round(cover.getBoundingClientRect().height) : null,
      coverZ: cover ? getComputedStyle(cover).zIndex : null,
      avatarZ: getComputedStyle(av).zIndex,
      imgZ: img ? getComputedStyle(img).zIndex : null,
      overlapY: Math.round(oy),
      centerOwn: own(hitCenter), overlapOwn: own(hitOverlap),
      overlapHit: hitOverlap ? hitOverlap.tagName.toLowerCase() + (typeof hitOverlap.className === 'string' && hitOverlap.className.trim() ? '.' + hitOverlap.className.trim().split(/\\s+/)[0] : '') : null,
      stack: stack
    };
  })()`;
}

// ══════════ 1. 社区「我的」页 ══════════
console.log('\n=== 1. 社区「我的」页 ===');
await send('Page.navigate', { url: APP + '/community' });
let clickedMine = false;
for (let i = 0; i < 150; i++) {
  clickedMine = await ev(`(function(){var t=Array.prototype.slice.call(document.querySelectorAll('.sidebar-menu-item')).filter(function(x){return x.innerText.trim()==='我的'})[0];if(!t)return false;t.click();return true;})()`);
  if (clickedMine) break;
  await sleep(100);
}
check('Z0 侧栏「我的」可点开', clickedMine);
check('Z0s 启动屏已移除（命中测试前提）', await waitSplashGone());
check('Z0b 封面淡入完成且头像加载完成', await waitMediaReady('.mine-cover-img', true, '.mine-avatar'));

const mine = await ev(hitTest('.mine-hero', '.mine-avatar', '.mine-cover', '.mine-cover-img'));
const mineAv = await ev(measureAvatar('.mine-avatar'));
console.log('    堆叠: ' + JSON.stringify(mine));
console.log('    头像: ' + JSON.stringify(mineAv));
check('Z1 .mine-cover 计算 z-index = 0（内部层级收口）', mine && mine.coverZ === '0', 'coverZ=' + (mine && mine.coverZ));
check('Z2 .mine-avatar 计算 z-index = 4（压过 edit z3）', mine && mine.avatarZ === '4', 'avatarZ=' + (mine && mine.avatarZ));
check('Z3 elementFromPoint 头像中心命中头像子树', mine && mine.centerOwn, 'hit=' + (mine && mine.overlapHit));
check('Z4 骑跨取样点命中头像 subtree（bug 发作点）', mine && mine.overlapOwn, 'hit=' + (mine && mine.overlapHit));
// Z5：栈中头像侧元素（user-avatar/mine-avatar）必须全部排在封面侧元素（mine-cover*）之前
const stackOk = mine && mine.stack && (function () {
  var firstCover = -1, lastAvatar = -1;
  mine.stack.forEach(function (x, i) {
    if (firstCover === -1 && /mine-cover/.test(x)) firstCover = i;
    if (/user-avatar|mine-avatar/.test(x)) lastAvatar = i;
  });
  return firstCover === -1 || (lastAvatar !== -1 && lastAvatar < firstCover);
})();
check('Z5 栈序：头像侧元素全部先于封面侧', !!stackOk, (mine && mine.stack || []).join(' < '));
check('C1 「我的」封面高度 ≥ 150px（原 118px 已拔高）', mine && mine.coverH >= 150, 'coverH=' + (mine && mine.coverH));
check('A1 「我的」页头像图片加载完成', mineAv && mineAv.hasImg && mineAv.natural && mineAv.natural[0] > 0 && Number(mineAv.opacity) > 0.9,
  mineAv ? 'natural=' + JSON.stringify(mineAv.natural) + ' opacity=' + mineAv.opacity + ' text=' + mineAv.textShown : 'no avatar');
await shot('mine-hero.png');

// ══════════ 2. 个人主页（自己）══════════
console.log('\n=== 2. 个人主页 /profile/' + ME + '（自己）===');
await send('Page.navigate', { url: APP + '/profile/' + ME });
check('Z6s 启动屏已移除', await waitSplashGone());
check('Z6b 封面与头像就绪', await waitMediaReady('.profile-cover-img', false, '.profile-avatar-slot'));
const prof = await ev(hitTest('.profile-hero-shell', '.profile-avatar-slot', '.profile-cover', '.profile-cover-img'));
const profAv = await ev(measureAvatar('.profile-avatar-slot'));
console.log('    堆叠: ' + JSON.stringify(prof));
console.log('    头像: ' + JSON.stringify(profAv));
check('Z6 主页头像骑跨点命中头像 subtree（防回归）', prof && prof.overlapOwn, 'hit=' + (prof && prof.overlapHit));
check('C2 个人主页封面高度 ≥ 200px', prof && prof.coverH >= 200, 'coverH=' + (prof && prof.coverH));
check('A2 自己主页头像加载完成', profAv && profAv.hasImg && profAv.natural && profAv.natural[0] > 0 && Number(profAv.opacity) > 0.9,
  profAv ? 'natural=' + JSON.stringify(profAv.natural) + ' opacity=' + profAv.opacity : 'no avatar');
await shot('profile-self.png');

// ══════════ 3. 他人主页（avatar-store 批量路径）══════════
// ⚠️ 断言必须按 ground truth 分支：DB 里大多数用户本就没设头像（文字兜底是正确
//    行为，不是 bug）。所以先从帖子作者里挑一个 has_avatar=true 的用户来验加载
//    路径；挑不到就验「兜底与 ground truth 一致」。
console.log('\n=== 3. 他人主页（批量头像路径）===');
const pickOther = await ev(`(async function(){
  try{
    var r=await fetch('/api/community/posts?page=1&limit=20&sort=latest',{headers:{Authorization:'Bearer '+${JSON.stringify(token)}}});
    var j=await r.json();
    var ps=(j.data&&j.data.posts)||[];
    var ids=[], seen={};
    for(var i=0;i<ps.length;i++){ var u=String(ps[i].user_id||''); if(u && u!==${JSON.stringify(ME)} && !seen[u]){ seen[u]=1; ids.push(u); } }
    if(!ids.length) return {none:true};
    var r2=await fetch('/api/user/avatar/batch?ids='+ids.join(','),{headers:{Authorization:'Bearer '+${JSON.stringify(token)}}});
    var j2=await r2.json();
    var av=(j2.data&&j2.data.avatars)||{};
    for(var k=0;k<ids.length;k++){ if(av[ids[k]] && av[ids[k]].has_avatar) return {id:ids[k], hasAvatar:true}; }
    return {id:ids[0], hasAvatar:false};
  }catch(e){ return {error:String(e)}; }
})()`);
if (pickOther && pickOther.id) {
  const expectImg = !!pickOther.hasAvatar;
  await send('Page.navigate', { url: APP + '/profile/' + pickOther.id });
  check('Z7s 启动屏已移除', await waitSplashGone());
  // 等批量请求真正回落（responseReceived 计数），再留 600ms 给组件渲染
  const batchT0 = batchResponses;
  const t3 = Date.now();
  while (Date.now() - t3 < 10000 && batchResponses === batchT0) { await sleep(100); }
  await sleep(600);
  const othAv = await ev(measureAvatar('.profile-avatar-slot'));
  console.log('    头像: ' + JSON.stringify(othAv) + '  groundTruth.hasAvatar=' + expectImg);
  const imgOk = othAv && othAv.hasImg && othAv.natural && othAv.natural[0] > 0 && Number(othAv.opacity) > 0.9;
  check(expectImg
    ? 'A3 他人主页头像加载完成（user ' + pickOther.id + '，有头像）'
    : 'A3 他人主页文字兜底正确（user ' + pickOther.id + '，ground truth 无头像）',
    expectImg ? !!imgOk : !!(othAv && !othAv.hasImg && othAv.textShown),
    expectImg ? 'natural=' + JSON.stringify(othAv && othAv.natural) : 'textShown=' + (othAv && othAv.textShown));
  await shot('profile-other.png');
} else {
  console.log('    （未找到他人 userId：' + JSON.stringify(pickOther) + '，跳过 A3）');
}

// ══════════ 4. 批量接口失败一次 → 重进恢复（重试链路）══════════
console.log('\n=== 4. 批量头像接口失败一次后重进 ===');
await send('Fetch.enable', { patterns: [{ urlPattern: '*avatar/batch*', requestStage: 'Request' }] });
let batchFailed = false;
const onPaused = (m) => {
  if (m.method === 'Fetch.requestPaused' && /avatar\/batch/.test(m.params.request.url)) {
    if (!batchFailed) {
      batchFailed = true;
      send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'ConnectionReset' }).catch(() => {});
    } else {
      send('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {});
    }
  }
};
ws.addEventListener('message', onPaused);
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: APP + '/profile/' + ME });
await sleep(6000); // 给组件挂载 + 批量请求 + （修复后的）重试链路留时间
const av4 = await ev(measureAvatar('.profile-avatar-slot'));
console.log('    头像: ' + JSON.stringify(av4));
check('A4 批量接口失败一次后头像仍恢复（不永久文字兜底）', av4 && av4.hasImg && av4.natural && av4.natural[0] > 0 && Number(av4.opacity) > 0.9,
  'natural=' + JSON.stringify(av4 && av4.natural) + ' text=' + (av4 && av4.textShown));
ws.removeEventListener('message', onPaused);
try { await send('Fetch.disable'); } catch {}
await send('Network.setCacheDisabled', { cacheDisabled: false });

// ══════════ 5. 云盘图片请求失败清单 ══════════
console.log('\n=== 5. 网络失败清单 ===');
const cloudFailed = failedReqs.filter((r) => /cloud\/files/.test(r.url || ''));
console.log('    失败请求: ' + JSON.stringify(failedReqs));
console.log('    云盘响应: ' + JSON.stringify(cloudStatus.slice(-6)));
check('N1 无云盘图片请求失败（排除同步延迟固有窗口）', cloudFailed.length === 0, cloudFailed.map((r) => r.url + ' ' + r.errorText).join('; '));

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
console.log('截图目录: ' + OUT);
try { ws.close(); } catch {}
chrome.kill();
process.exitCode = fail ? 1 : 0;
