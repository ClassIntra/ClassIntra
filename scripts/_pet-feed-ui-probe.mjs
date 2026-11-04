// 喂饭 UI 级探针 —— 验证「一次点击只发一次请求」+「数值真的涨」+「capped 有反馈」
// 背景：用户实测「明明显示饿，喂饭数值却不涨」。根因两条：
//   (a) 一次点击发两次 POST（entry 自己 post + 派发事件让 overlay 再 post），
//       第二发撞 20 分钟冷却被静默吞掉
//   (b) 前端按 4 小时时间衰减算饱食度，后端按每日 3 次判 —— 模型脱节，UI 谎报「饿」
// 本探针用一个「会记账的假后端」把这两条都钉死。
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = 'http://127.0.0.1:9001';

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9401',
  `--user-data-dir=${join(tmpdir(), 'ci-pet-feed-ui-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9401${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const pageT = (await g('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let LAST_EXC = null;
let id = 0;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const x = m.params.exceptionDetails;
    const desc = String((x.exception && x.exception.description) || x.text);
    console.error('[页面异常]', desc.split('\n')[0]);
    // 关键取证：把调用栈打出来，才能定位 ReferenceError 到底出自哪一行
    const frames = (x.stackTrace && x.stackTrace.callFrames) || [];
    frames.slice(0, 12).forEach((f) => {
      console.error('    at ' + (f.functionName || '(anonymous)') +
        ' (' + (f.url || '?').replace(/^https?:\/\/[^/]+/, '') +
        ':' + (f.lineNumber + 1) + ':' + (f.columnNumber + 1) + ')');
    });
    LAST_EXC = desc;
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
  if (r.exceptionDetails) throw new Error('页面异常: ' + String((r.exceptionDetails && r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]);
  return r.result.value;
};

// 假后端：严格复刻后端 INTERACT_RULES.feed = { gain:4, dailyCap:3, cooldownMs:20min }
const STUB = `
window.__feedLog = [];      // 每一次真正打到 /pet/interact 的记录
window.ClassIntraMarket = {
  apps: {},
  _st: { adopted: true, name: '大肥鱼', bond: 40, exp: 0, affection: 60,
         fed_today: 0, last_fed_at: 0, enabled: true,
         design: { type: 'video', character: 'dsh-whale' } },
  _api: function(verb, url){
    var S = window.ClassIntraMarket;
    return new Promise(function(res, rej){
      setTimeout(function(){
        if (/\\/pet\\/interact$/.test(url)) {
          S._n = (S._n || 0) + 1;
          var now = Date.now();
          var body = S._lastBody || {};
          window.__feedLog.push({ n: S._n, t: now, type: body.type });
          var CD = 20 * 60 * 1000, CAP = 3, GAIN = 4;
          if (S._st.fed_today >= CAP) {
            return res({ data: { code: 200, data: { state: S._st, gained: 0, capped: true } } });
          }
          if (S._st.last_fed_at && (now - S._st.last_fed_at) < CD) {
            return rej({ response: { data: { message:
              '还在消化呢，' + Math.ceil((CD - (now - S._st.last_fed_at)) / 60000) + ' 分钟后再喂吧' } } });
          }
          S._st.fed_today += 1;
          S._st.last_fed_at = now;
          S._st.affection += GAIN;
          return res({ data: { code: 200, data: { state: S._st, gained: GAIN, capped: false } } });
        }
        if (/level\\/info/.test(url)) return res({ data: { code: 200, data: { level: 3 } } });
        res({ data: { code: 200, data: { state: S._st, palette: [], templates: [] } } });
      }, 8);
    });
  },
  createContext: function(){
    var S = window.ClassIntraMarket;
    return {
      data: {
        api: {
          get: function(u){ return S._api('get', u); },
          put: function(u, b){ return S._api('put', u, b); },
          post: function(u, b){ S._lastBody = b; return S._api('post', u, b); }
        },
        storage: {
          get: function(k, d){ try { var v = JSON.parse(localStorage.getItem('ci:app:pet:' + k)); return v === null ? d : v; } catch(e){ return d; } },
          set: function(k, v){ try { localStorage.setItem('ci:app:pet:' + k, JSON.stringify(v)); } catch(e){} }
        },
        realtime: null
      },
      app: { onDestroy: function(){} },
      system: { toast: function(){} }
    };
  },
  define: function(d){ window.__entryDef = d; }
};
`;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/market-static/pet/frontend/style.css">
<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#12141c;color:#fff}</style>
</head><body><div id="root" style="width:100%;height:100%"></div></body></html>`;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
ws.onmessage = (function (orig) {
  return function (e) {
    const m = JSON.parse(e.data);
    if (m.method === 'Fetch.requestPaused') {
      const url = m.params.request.paused ? '' : m.params.request.url;
      if (/harness-feed/.test(url)) {
        send('Fetch.fulfillRequest', {
          requestId: m.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: b64(HTML)
        }).catch(() => {});
      } else {
        send('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {});
      }
    }
    orig(e);
  };
})(ws.onmessage);

await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*harness*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

const fail = [];
const ok = [];
const check = (cond, label, extra) => {
  (cond ? ok : fail).push(label + (extra ? ' → ' + extra : ''));
  console.log((cond ? '  ✅ ' : '  ❌ ') + label + (extra ? ' → ' + extra : ''));
};

try {
  await send('Page.navigate', { url: APP + '/harness-feed.html' });
  await sleep(1200);
  // ⚠️ 关键：不能用 <script src> 加载。那样「实际执行的脚本」和「取证检查的源码」
  //    可能是两个不同的 URL/两份不同的缓存（实测浏览器拿到的 len=30169 ≠ 磁盘 34044）。
  //    现在把源码拉下来直接 eval —— 执行的就是被检查的那一份，杜绝两边对不上。
  const srcInfo = await ev(`(function(){
    return fetch('/market-static/pet/frontend/entry.js', { cache: 'no-store' })
      .then(function(r){ return r.text(); })
      .then(function(t){
        return { len: t.length, text: t };
      });
  })()`);
  const SRC = srcInfo.text;
  console.log('源码字节数:', srcInfo.len, '(磁盘 34044 —— 必须相等才算同一份)');
  console.log('  含 feedCooldownMin 定义:', /function\s+feedCooldownMin/.test(SRC));
  console.log('  含 later( 调用(应只在注释里):', (SRC.match(/^\s*later\s*\(/gm) || []).length);
  await ev(SRC);
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { ready = await ev(`!!(window.__entryDef && window.__entryDef.mount)`); } catch { ready = false; }
    if (ready) break;
  }
  if (!ready) { console.error('✗ entry.js 未注册'); process.exit(1); }
  await ev(`window.__entryDef.mount(document.getElementById('root'), window.ClassIntraMarket.createContext())`);
  await sleep(2500);

  // 找喂食按钮：优先 aria/data 标记，退化到文本匹配
  const findBtn = () => ev(`(function(){
    var all = Array.prototype.slice.call(document.querySelectorAll('button, [role=button], .ci-pet-bigbtn, div'));
    var hit = null;
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].textContent || '').replace(/\\s+/g, '');
      if (t.indexOf('喂食') >= 0 && (all[i].tagName === 'BUTTON' || all[i].getAttribute('role') === 'button' || /btn|按钮/i.test(all[i].className))) {
        hit = all[i]; break;
      }
    }
    if (!hit) {
      for (var j = 0; j < all.length; j++) {
        var t2 = (all[j].textContent || '').replace(/\\s+/g, '');
        if (t2.indexOf('喂食') >= 0 && all[j].children.length <= 3) { hit = all[j]; break; }
      }
    }
    if (!hit) return null;
    hit.setAttribute('data-probe-feed', '1');
    return { tag: hit.tagName, cls: hit.className, text: (hit.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60) };
  })()`);

  const btn = await findBtn();
  if (!btn) { console.error('✗ 找不到喂食按钮'); process.exit(1); }
  console.log('喂食按钮:', JSON.stringify(btn));

  // ⚠️ renderHome() 会整体重建 DOM，写死的 data-probe-feed 标记每轮都会丢 —— 每次都重新找
  const LOCATE = `(function(){
    var all = Array.prototype.slice.call(document.querySelectorAll('button'));
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].textContent || '').replace(/\\s+/g, '');
      if (t.indexOf('喂食') >= 0) return all[i];
    }
    return null;
  })()`;
  const btnState = () => ev(`(function(){
    var b = ${LOCATE};
    if (!b) return { missing: true, text: '' };
    return { disabled: !!b.disabled, text: (b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60) };
  })()`);
  const clickBtn = () => ev(`(function(){
    var b = ${LOCATE};
    if (!b) return false;
    b.click(); return true;
  })()`);
  const feedCount = () => ev(`window.__feedLog.length`);
  const affection = () => ev(`window.ClassIntraMarket._st.affection`);
  const fedToday = () => ev(`window.ClassIntraMarket._st.fed_today`);
  // 页面上「饱食」那条显示的百分比（.ci-pet-stats 里第一行）
  const fedShown = () => ev(`(function(){
    var v = document.querySelectorAll('.ci-pet-statvalue');
    return v.length ? Number(String(v[0].textContent || '').replace('%', '')) : null;
  })()`);

  console.log('\n== 第 1 次喂食（应当 1 次请求，羁绊 +4，fed_today 0→1，饱食度上升）==');
  const pctBefore = await fedShown();
  console.log('  点击前:', JSON.stringify(await btnState()), 'affection=' + await affection(), '饱食度=' + pctBefore + '%');
  await clickBtn();
  await sleep(1800);
  const c1 = await feedCount();
  const a1 = await affection();
  const f1 = await fedToday();
  const pctAfter = await fedShown();
  console.log('  点击后: 请求数=' + c1 + ' affection=' + a1 + ' fed_today=' + f1 + ' 饱食度=' + pctAfter + '%');
  console.log('  按钮态:', JSON.stringify(await btnState()));
  check(c1 === 1, '单次点击只发 1 个请求（消除双发）', '实际 ' + c1);
  check(a1 === 64, '羁绊真的涨了 60→64', '实际 ' + a1);
  check(f1 === 1, 'fed_today 记为 1', '实际 ' + f1);
  // 回归护栏：饱食度必须随进食单调递增（曾把"剩余次数"当饱食度画，越喂越少）
  check(pctAfter !== null && pctBefore !== null && pctAfter > pctBefore,
    '饱食度随进食递增（不能越喂越少）', pctBefore + '% → ' + pctAfter + '%');

  console.log('\n== 第 2 次喂食（冷却中：应当要么 0 新请求、要么被冷却文案拦下）==');
  const before2 = await feedCount();
  const st2 = await btnState();
  console.log('  冷却态按钮:', JSON.stringify(st2));
  await clickBtn();
  await sleep(1800);
  const c2 = await feedCount();
  const a2 = await affection();
  console.log('  点击后: 请求数=' + c2 + '（之前 ' + before2 + '）affection=' + a2);
  const told = /歇|分钟|吃饱|消化/.test(st2.text) || !!st2.disabled;
  check(told || (c2 - before2) === 0, '冷却期不做无谓请求 / 或先给明确文案', '按钮文案「' + st2.text + '」');
  check(a2 === 64, '冷却期羁绊不重复累加', '实际 ' + a2);

  console.log('\n== 第 3、4 次：清掉冷却后喂到满（cap=3）==');
  await ev(`window.ClassIntraMarket._st.last_fed_at = 0;`);
  await sleep(200);
  await clickBtn();
  await sleep(1500);
  await ev(`window.ClassIntraMarket._st.last_fed_at = 0;`);
  await sleep(200);
  await clickBtn();
  await sleep(1800);
  const f3 = await fedToday();
  const st3 = await btnState();
  console.log('  当前: fed_today=' + f3 + ' 按钮=' + JSON.stringify(st3));
  check(/吃饱/.test(st3.text) || st3.disabled, '喂满 3 次后按钮明确告知「今天吃饱啦」', '文案「' + st3.text + '」');

  console.log('\n===== 喂饭 UI 探针结果 =====');
  console.log('通过 ' + ok.length + ' 项，失败 ' + fail.length + ' 项');
  if (fail.length) { fail.forEach((f) => console.log('  ❌ ' + f)); process.exitCode = 1; }
  else console.log('  🎉 全绿');
} catch (e) {
  console.error('✗ 探针异常:', e.message);
  process.exitCode = 1;
} finally {
  try { ws.close(); } catch {}
  try { chrome.kill(); } catch {}
}
