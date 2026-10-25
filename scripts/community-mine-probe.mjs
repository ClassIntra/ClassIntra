// 社区「我的」页验证（真实 Chrome + 冷缓存）
// ============================================================
// 覆盖：名片（封面/头像/身份/统计）、四个统计、分类筛选与分页、收藏空态、
//       「我的主页」与「编辑资料」两处跳转、粉丝名单弹层。
// 用法：node scripts/community-mine-probe.mjs
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const ME = process.env.PROBE_USER || '251801';
const OUT = join(tmpdir(), 'ci-community-mine');
mkdirSync(OUT, { recursive: true });

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const HASH = '98d5d03a99505d12df72af5468ae2b78ce8e474b1c390bb1a74ea5c1563f24c3';

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9411',
  // 每次跑用全新 profile：复用旧目录会命中上一版 index.html 的缓存，
  // 路由 chunk 的 hash 对不上 → 跳到 /profile 后白屏（踩过，别误判成功能坏了）
  `--user-data-dir=${join(tmpdir(), 'ci-community-mine-' + Date.now())}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });
const get = async (p) => (await fetch(`http://127.0.0.1:9411${p}`)).json();
for (let i = 0; i < 60; i++) { try { await get('/json/version'); break; } catch { await sleep(500); } }
const page = (await get('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => (await send('Runtime.evaluate', {
  expression: expr, returnByValue: true, awaitPromise: true
})).result.value;
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(s.data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{localStorage.setItem('token',${JSON.stringify(token)});
  localStorage.setItem('user',${JSON.stringify(JSON.stringify({ user_id: ME, net_name: 'probe' }))});
  localStorage.removeItem('ci:profile-skin');}catch(e){}`
});

const READ = `(function(){
  var hero = document.querySelector('.mine-hero');
  var coverImg = document.querySelector('.mine-cover-img');
  var stats = Array.prototype.slice.call(document.querySelectorAll('.mine-stat')).map(function(el){
    var v = el.querySelector('.mine-stat-v'); var l = el.querySelector('.mine-stat-l');
    return (l ? l.innerText.trim().replace(/\\s+/g,'') : '?') + '=' + (v ? v.innerText.trim() : '?');
  });
  var filters = Array.prototype.slice.call(document.querySelectorAll('.mine-filter')).map(function(b){
    return b.innerText.trim() + (b.classList.contains('active') ? '*' : '');
  });
  var posts = Array.prototype.slice.call(document.querySelectorAll('.my-posts-section .my-post-item'));
  var avatarImg = document.querySelector('.mine-avatar .user-avatar-img');
  return {
    hero: !!hero,
    coverImgLoaded: coverImg ? (coverImg.complete && coverImg.naturalWidth > 0) : false,
    coverFallback: !!document.querySelector('.mine-cover-glow'),
    avatarImgLoaded: avatarImg ? (avatarImg.complete && avatarImg.naturalWidth > 0) : false,
    name: (document.querySelector('.mine-name') || {}).innerText || null,
    stats: stats,
    filters: filters,
    posts: posts.length,
    emptyText: (document.querySelector('.my-posts-section .empty-state-sm') || {}).innerText || null,
    bookmarkEmpty: (document.querySelector('.bookmarks-section .empty-state-sm') || {}).innerText || null,
    buttons: Array.prototype.slice.call(document.querySelectorAll('.mine-actions .mine-btn')).map(function(b){return b.innerText.trim();})
  };
})()`;

async function openMine() {
  await send('Page.navigate', { url: APP + '/community' });
  await sleep(6000);
  await ev(`(function(){
    var items = Array.prototype.slice.call(document.querySelectorAll('.sidebar-menu-item'));
    var t = items.filter(function(x){ return x.innerText.trim() === '我的'; })[0];
    if (t) t.click();
  })()`);
  await sleep(2200);
}

// 0 先确认论坛瀑布流没被「我的」页的样式收窄影响（我把列布局 scope 到了 .content-list）
await send('Page.navigate', { url: APP + '/community' });
await sleep(6500);
console.log('0 论坛瀑布流:', JSON.stringify(await ev(`(function(){
  var it = document.querySelector('.content-list .list-item.post-item');
  if (!it) return { none: true };
  var cs = getComputedStyle(it);
  return { flexDirection: cs.flexDirection,
           cols: document.querySelectorAll('.content-list .waterfall-col').length,
           items: document.querySelectorAll('.content-list .list-item.post-item').length };
})()`)));
await shot('0-forum.png');

await openMine();
console.log('1 名片（无封面）:', JSON.stringify(await ev(READ)));
await shot('1-mine-nocover.png');

// 浅色主题 + 装扮令牌（我的页带 ci-skin-scope，应能吃到 --pf-*）
await ev('window.__getThemeEngine && window.__getThemeEngine().setTheme("light")');
await sleep(800);
console.log('1b 浅色:', JSON.stringify(await ev(`(function(){
  var panel = document.querySelector('.mine-panel');
  var hero = document.querySelector('.mine-hero');
  return { theme: document.documentElement.getAttribute('data-theme') || 'light',
           heroBg: hero ? getComputedStyle(hero).backgroundColor : null,
           panelClass: panel ? panel.className : null };
})()`)));
await shot('1b-mine-light.png');

await ev('window.__profileSkin && window.__profileSkin.apply("sakura")');
await sleep(500);
console.log('1c 装扮生效:', JSON.stringify(await ev(`(function(){
  var btn = document.querySelector('.mine-btn--primary');
  var chip = document.querySelector('.mine-filter.active');
  var hero = document.querySelector('.mine-hero');
  return { btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
           chipBg: chip ? getComputedStyle(chip).backgroundColor : null,
           heroBorder: hero ? getComputedStyle(hero).borderTopColor : null };
})()`)));
await shot('1c-mine-skin.png');
await ev('window.__profileSkin && window.__profileSkin.clear(); window.__getThemeEngine && window.__getThemeEngine().setTheme("dark")');
await sleep(600);

// 给测试号临时设一个封面，验证真实图片分支
// ⚠️ 先记下原有状态：如果这个账号本来就有封面，跑完不能删（这是别人的真实数据）
const coverBefore = await (await fetch(APP + '/api/user/cover/' + ME, { headers: H })).json();
const hadCover = !!(coverBefore && coverBefore.data && coverBefore.data.has_cover);
await fetch(APP + '/api/user/cover', {
  method: 'PUT', headers: H,
  body: JSON.stringify({ hash: HASH, crop: { zoom: 1.6, ox: 0.1, oy: -0.2 } })
});
await openMine();
console.log('2 名片（有封面）:', JSON.stringify(await ev(READ)));
await shot('2-mine-cover.png');

// 分类筛选
for (const label of ['论坛', '投票', '美食']) {
  await ev(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('.mine-filter'));
    var t = bs.filter(function(b){ return b.innerText.trim() === '${label}'; })[0];
    if (t) t.click();
  })()`);
  await sleep(1400);
  console.log('3 筛选「' + label + '」:', JSON.stringify(await ev(`(function(){
    var posts = document.querySelectorAll('.my-posts-section .my-post-item');
    var empty = document.querySelector('.my-posts-section .empty-state-sm');
    var active = document.querySelector('.mine-filter.active');
    return { active: active ? active.innerText.trim() : null, posts: posts.length,
             empty: empty ? empty.innerText.trim() : null };
  })()`)));
  if (label === '投票') await shot('3-mine-filter-poll.png');
}

// 粉丝名单
await ev(`(function(){
  var bs = Array.prototype.slice.call(document.querySelectorAll('.mine-stat--link'));
  var f = bs.filter(function(b){ return /粉丝/.test(b.innerText); })[0];
  if (f) f.click();
})()`);
await sleep(1600);
console.log('4 粉丝弹层:', JSON.stringify(await ev(`(function(){
  var sheet = document.querySelector('.fl-sheet');
  return { visible: !!sheet,
           title: sheet ? (sheet.querySelector('.fl-header') || {}).innerText : null,
           rows: document.querySelectorAll('.fl-row, .fl-item').length };
})()`)));
await shot('4-follow-sheet.png');
await ev(`(function(){
  var s = document.querySelector('.fl-overlay');
  if (s) s.click();
  var c = document.querySelector('.fl-close');
  if (c) c.click();
})()`);
await sleep(600);

// 我的主页
await openMine();
await ev(`(function(){
  var bs = Array.prototype.slice.call(document.querySelectorAll('.mine-actions .mine-btn'));
  var t = bs.filter(function(b){ return /我的主页/.test(b.innerText); })[0];
  if (t) t.click();
})()`);
await sleep(3500);
console.log('5 我的主页跳转:', JSON.stringify(await ev(`(function(){
  return { path: location.pathname,
           hasProfilePage: !!document.querySelector('.profile-page'),
           title: (document.querySelector('.app-navbar') || {}).innerText || null };
})()`)));
await shot('5-jump-profile.png');

// 编辑资料（带 ?edit=1 直接进编辑态）
await openMine();
await ev(`(function(){
  var bs = Array.prototype.slice.call(document.querySelectorAll('.mine-actions .mine-btn'));
  var t = bs.filter(function(b){ return /编辑资料/.test(b.innerText); })[0];
  if (t) t.click();
})()`);
await sleep(4000);
console.log('6 编辑资料跳转:', JSON.stringify(await ev(`(function(){
  return { path: location.pathname + location.search,
           editor: !!document.querySelector('.pe-sheet'),
           sections: Array.prototype.slice.call(document.querySelectorAll('.pe-section-title, .pe-block-title')).map(function(x){return x.innerText.trim();}) };
})()`)));
await shot('6-jump-editor.png');

// 7 分页：帖子超过一页时才出现「加载更多」
await openMine();
const pageState = await ev(`(function(){
  var btn = document.querySelector('.mine-load-more');
  return { hasMore: !!btn,
           posts: document.querySelectorAll('.my-posts-section .my-post-item').length,
           total: (document.querySelector('.mine-count') || {}).innerText || null };
})()`);
console.log('7 分页初始:', JSON.stringify(pageState));
if (pageState.hasMore) {
  await ev(`(function(){ var b = document.querySelector('.mine-load-more'); if (b) b.click(); })()`);
  await sleep(1800);
  console.log('8 加载更多后:', JSON.stringify(await ev(`(function(){
    return { posts: document.querySelectorAll('.my-posts-section .my-post-item').length,
             total: (document.querySelector('.mine-count') || {}).innerText || null,
             hasMore: !!document.querySelector('.mine-load-more') };
  })()`)));
  await shot('7-mine-loadmore.png');
}

// 清理：只在「本来没有封面」时才删，避免毁掉真实用户的封面
if (!hadCover) {
  await fetch(APP + '/api/user/cover', { method: 'DELETE', headers: H });
} else {
  console.log('（该账号原本已有封面，保持不动）');
}
ws.close();
chrome.kill();
console.log('DONE ->', OUT);
