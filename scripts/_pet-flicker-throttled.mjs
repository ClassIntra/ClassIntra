// 慢速网络下的闪烁探针（2026-10-27）
// 为什么要它：此前所有探针都跑在「本地服务 + 桌面 Chrome」上，素材秒开、解码飞快，
//   于是永远抓不到真机那条路径。真机是校园 WiFi + 平板慢解码，单个 webm 700~1300KB，
//   换源空窗可达 1~2 秒 —— 这才是「探针全绿但真机还闪」的原因。
// 本探针用 CDP 限速 + 禁缓存复现真机，并做两件事：
//   A. 像素真值：宠物区域出现「几乎全是背景色」的帧 = 内容消失 = 闪
//   B. 因果断言：任何一次采样，前台元素都必须 readyState >= 2（有当前帧可绘）
// 还要跑一次「阴性对照」：人为清空前台 src，确认探针真的能抓到空白 —— 抓不到就说明尺子坏了。
//
// 用法：node scripts/_pet-flicker-throttled.mjs [KBps]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = 'http://127.0.0.1:9001';
const KBPS = Number(process.argv[2]) || 800;     // 下载带宽 KB/s
const OUT = join(tmpdir(), 'ci-pet-throttled');
mkdirSync(OUT, { recursive: true });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9398',
  `--user-data-dir=${join(tmpdir(), 'ci-pet-throttled-profile')}`,
  '--no-first-run', '--disable-extensions', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1043,787', 'about:blank'
], { stdio: 'ignore' });

const g = async (p) => (await fetch(`http://127.0.0.1:9398${p}`)).json();
for (let i = 0; i < 60; i++) { try { await g('/json/version'); break; } catch { await sleep(500); } }
const pageT = (await g('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pend = new Map();
const exceptions = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const x = m.params.exceptionDetails;
    exceptions.push(String((x.exception && x.exception.description) || x.text).split('\n')[0]);
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
  if (r.exceptionDetails) throw new Error('页面异常: ' + String((r.exceptionDetails.exception && r.exceptionDetails.description) || r.exceptionDetails.text).split('\n')[0]);
  return r.result.value;
};

const STUB = `
window.ClassIntraMarket = {
  apps: {},
  _api: function(verb, url){
    var st = { adopted: true, name: '大肥鱼', bond: 40, enabled: true, design: { type: 'video', character: 'dsh-whale' } };
    return new Promise(function(res){
      setTimeout(function(){
        if (/level\\/info/.test(url)) return res({ data: { code: 200, data: { level: 3 } } });
        if (/\\/pet\\/interact/.test(url)) return res({ data: { code: 200, data: { state: st, gained: 1 } } });
        res({ data: { code: 200, data: { state: st, palette: [], templates: [] } } });
      }, 5);
    });
  },
  createContext: function(){
    var S = window.ClassIntraMarket;
    return {
      data: {
        api: {
          get: function(u){ return S._api('get', u); },
          put: function(u, b){ return S._api('put', u, b); },
          post: function(u, b){ return S._api('post', u, b); }
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
  defineOverlay: function(d){ window.__ovl = d; }
};
`;

// 纯红背景：任何"内容消失"都会裸露成大红
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/market-static/pet/frontend/style.css">
<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#FF0000}</style>
</head><body></body></html>`;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
ws.onmessage = (function (orig) {
  return function (e) {
    const m = JSON.parse(e.data);
    if (m.method === 'Fetch.requestPaused') {
      if (/harness-thr/.test(m.params.request.url)) {
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
await send('Network.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*harness-thr*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1043, height: 787, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

const statOne = async (buf) => {
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
  return await ev(`(function(){
    return new Promise(function(res){
      var img = new Image();
      img.onload = function(){
        var c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        var g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        var d = g.getImageData(0, 0, c.width, c.height).data;
        var total = 0, nonBg = 0;
        for (var i = 0; i < d.length; i += 4) {
          total++;
          if (!(d[i] > 240 && d[i+1] < 20 && d[i+2] < 20)) nonBg++;
        }
        res({ total: total, nonBg: nonBg, ratio: +(nonBg / total).toFixed(4) });
      };
      img.onerror = function(){ res(null); };
      img.src = ${JSON.stringify(dataUrl)};
    });
  })()`);
};

try {
  await send('Page.navigate', { url: APP + '/harness-thr.html' });
  await sleep(1200);

  // 素材缓存一律禁用：保证每次换源都是真实下载（真机首次切换的处境）
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  await ev(`(function(){ var s=document.createElement('script'); s.src='/market-static/pet/frontend/overlay.js?t=${Date.now()}'; document.head.appendChild(s); return 1; })()`);
  await sleep(1200);
  await ev(`window.__ovl.mount(document.body, window.ClassIntraMarket.createContext('pet', {}))`);

  // 首帧给足时间（此时还没限速，走本地快通道）
  await sleep(3500);

  const dbg0 = await ev('window.__ciPetDebug()');
  console.log('挂载后状态:', JSON.stringify({ anim: dbg0.anim, frontReady: dbg0.frontReady, frontSrc: dbg0.frontSrc }));
  if (!dbg0.domMounted) { console.error('✗ 桌宠未挂载'); process.exit(1); }

  const rect = await ev(`(function(){
    var pet = document.querySelector('.ci-pet');
    if (!pet) return null;
    var r = pet.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  if (!rect) { console.error('✗ 取不到宠物矩形'); process.exit(1); }
  console.log('宠物矩形:', JSON.stringify(rect));
  const clip = { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 };
  const shot = async (tag) => {
    const s = await send('Page.captureScreenshot', { format: 'png', clip });
    const buf = Buffer.from(s.data, 'base64');
    if (tag) writeFileSync(join(OUT, tag + '.png'), buf);
    return buf;
  };

  await sleep(500);
  const base = await shot('00-base');
  const baseStat = await statOne(base);
  console.log('基准帧非背景占比:', JSON.stringify(baseStat));
  if (!baseStat || baseStat.ratio < 0.02) { console.error('✗ 基准帧本身就几乎没有内容，判据无法成立'); process.exit(1); }

  // ===== 阴性对照：确认这把尺子抓得到空白 =====
  // 人为把前台 video 的 src 清掉（模拟旧方案换源瞬间的裸奔态）
  const ctrlBuf = await (async () => {
    await ev(`(function(){
      var vs = document.querySelectorAll('.ci-pet-video');
      for (var i = 0; i < vs.length; i++) {
        if (vs[i].style.zIndex === '2') { vs[i].removeAttribute('src'); try { vs[i].load(); } catch(e){} }
      }
      return 1;
    })()`);
    await sleep(700);
    return await shot('99-negative-control');
  })();
  const ctrlStat = await statOne(ctrlBuf);
  const ctrlRel = baseStat.ratio > 0 ? ctrlStat.ratio / baseStat.ratio : 1;
  console.log('阴性对照（人为清空 src）非背景占比:', JSON.stringify(ctrlStat), '相对基准:', ctrlRel.toFixed(3));

  if (ctrlRel >= 0.35) {
    console.error('✗ 尺子失效：人为制造的空白都判不出来，本探针结论不可信');
    process.exit(3);
  }
  console.log('✅ 尺子有效：人为空白被判出（相对占比 ' + ctrlRel.toFixed(3) + ' < 0.35）');

  // 让桌宠重新拿到画面（重新挂载最干净）
  await ev('window.__ovl.unmount()');
  await sleep(400);
  await ev(`window.__ovl.mount(document.body, window.ClassIntraMarket.createContext('pet', {}))`);
  await sleep(3500);

  // ===== 正式开测：限速 + 禁缓存，模拟真机 =====
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 200,
    downloadThroughput: KBPS * 1024,
    uploadThroughput: Math.round(KBPS * 512)
  });
  console.log(`\n已开启限速：延迟 200ms / 下行 ${KBPS}KB/s / 缓存禁用`);

  const N = 10;
  const samples = [];
  const frames = [];
  const animsBefore = [];

  for (let i = 0; i < N; i++) {
    animsBefore.push((await ev('window.__ciPetDebug()')).anim);
    await ev('(function(){ if (window.__ciPetPoke) window.__ciPetPoke(); return 1; })()');

    // 切换刚触发 → 密集采样因果状态（前台是否始终有帧）
    for (let k = 0; k < 6; k++) {
      const d = await ev('window.__ciPetDebug()');
      samples.push({ i, k, anim: d.anim, swapping: d.swapping, fr: d.frontReady, br: d.backReady, fz: d.frontZ, bz: d.backZ });
      await sleep(60);
    }
    // 再抓两帧做像素真值
    frames.push(await shot('t' + String(i).padStart(2, '0') + '-a'));
    await sleep(160);
    frames.push(await shot('t' + String(i).padStart(2, '0') + '-b'));
  }

  // 等所有后台装料落地
  const settle = Date.now();
  while (Date.now() - settle < 12000) {
    const d = await ev('window.__ciPetDebug()');
    if (!d.swapping && d.backReady >= 2) break;
    await sleep(400);
  }

  // ---- 断言 A：像素 ----
  let blank = 0;
  const bad = [];
  for (let i = 0; i < frames.length; i++) {
    const st = await statOne(frames[i]);
    if (!st) continue;
    const rel = baseStat.ratio > 0 ? st.ratio / baseStat.ratio : 1;
    if (rel < 0.35) { blank++; bad.push({ f: i, ratio: st.ratio, rel: +rel.toFixed(3) }); }
  }

  // ---- 断言 B：因果 ----
  // 只要有一次采样出现「前台没有可用帧」，屏幕上就必然少了一张画
  const noFrame = samples.filter((s) => s.fr < 2);
  // 交换瞬间 frontZ 必须是 2（前台永远是抬起来的那一台）
  const badZ = samples.filter((s) => s.fz !== '2');

  const dbgEnd = await ev('window.__ciPetDebug()');

  console.log('\n===== 结果 =====');
  console.log(`限速 ${KBPS}KB/s · 触发 ${N} 次切换 · 像素帧 ${frames.length}`);
  console.log(`A. 像素缺失(<基准35%)帧: ${blank}${bad.length ? ' → ' + JSON.stringify(bad.slice(0, 6)) : ' ✅'}`);
  console.log(`B1. 前台 readyState<2 的采样: ${noFrame.length}${noFrame.length ? ' → ' + JSON.stringify(noFrame.slice(0, 6)) : ' ✅'}`);
  console.log(`B2. 前台 zIndex!==2 的采样: ${badZ.length}${badZ.length ? ' → ' + JSON.stringify(badZ.slice(0, 6)) : ' ✅'}`);
  console.log(`C. 动作是否真的换过: 触发前 ${JSON.stringify(animsBefore.slice(0, 5))} → 结束时 anim=${dbgEnd.anim}`);
  console.log(`D. 结束时 swapping=${dbgEnd.swapping} frontReady=${dbgEnd.frontReady} backReady=${dbgEnd.backReady}`);
  console.log(`E. 页面异常: ${exceptions.length ? exceptions.slice(0, 3).join(' | ') : '无 ✅'}`);
  console.log('截图目录:', OUT);

  const changed = animsBefore.filter((a, i) => i > 0 && a !== animsBefore[i - 1]).length;
  console.log(`F. 切换确实发生（连续两次触发间 anim 变化）: ${changed} 次`);

  const pass = blank === 0 && noFrame.length === 0 && badZ.length === 0 && exceptions.length === 0;
  console.log(pass ? '\n=== 通过 ===' : '\n=== 未通过 ===');
  process.exit(pass ? 0 : 2);
} catch (e) {
  console.error('✗ 探针异常:', e.message);
  process.exit(1);
} finally {
  try { ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
}
