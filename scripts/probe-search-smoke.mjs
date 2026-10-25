#!/usr/bin/env node
/*
 * 搜索源装配冒烟（真实 Chrome + 原生 CDP）
 * ============================================================
 * 这个探针只回答一个问题：**Ctrl+K 的全局搜索，数据源到底装上没有？**
 *
 * 为什么要单独一个探针：
 *   这一整套东西（SearchRegistry / GlobalSearch 面板 / 快捷键）曾经全部建好、
 *   但 registerCommand 与 registerProvider 零调用 —— 页面能打开、快捷键能弹窗、
 *   搜出来却只有应用。这类「建好了没接线」的缺陷，单元测试和构建都不会报，
 *   只有真的跑起来看 console / DOM 才能发现。
 *
 * 判定项：
 *   1. 控制台出现 [Search] 已注册 N 条命令 / M 个数据源  → 装配执行了
 *   2. 没有 [main] 搜索源装配失败                        → 装配没抛错
 *   3. 页面能挂载搜索输入框（或至少没崩）                 → 宿主没被这次改动带崩
 *
 * 用法：
 *   node scripts/probe-search-smoke.mjs
 *   CI_BASE=http://127.0.0.1:9443 node scripts/probe-search-smoke.mjs   # 打 https 入口
 *
 * 退出码：0 = 通过；1 = 失败
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.CI_BASE || 'http://127.0.0.1:9001';
const WAIT_MS = Number(process.env.PROBE_WAIT_MS || 7000);
// 自签登录态用的账号（真实 6 位学号；未配置 secret 时自动退回未登录模式）
const USER_ID = process.env.PROBE_USER_ID || '251800';

// 自签 token：RS256 私钥只在本机，但 utils/jwt 的 verifyToken 仍兼容 HS256，
// 所以用 server/.env 的 JWT_SECRET 签发的 token 照样能过验签。
function makeToken() {
  try {
    const requireCJS = createRequire(join(REPO, 'server/node_modules/') + '/');
    const jwt = requireCJS('jsonwebtoken');
    const env = readFileSync(join(REPO, 'server/.env'), 'utf8').split(/\r?\n/);
    let secret = null;
    for (const line of env) {
      const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
      if (m) { secret = m[1].trim().replace(/^["']|["']$/g, ''); break; }
    }
    if (!secret) return null;
    return jwt.sign(
      { user_id: USER_ID, is_admin: 0, is_class_admin: 0, role: 'user' },
      secret,
      { expiresIn: '1h' }
    );
  } catch (e) {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, method) {
  const res = await fetch(url, method ? { method } : undefined);
  return res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const logs = [];
    const errors = [];
    let seq = 0;

    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res) => {
          const id = ++seq;
          pending.set(id, res);
          ws.send(JSON.stringify({ id, method, params: params || {} }));
        });
      },
      logs,
      errors,
      close() { try { ws.close(); } catch (e) {} }
    });

    ws.onerror = (e) => reject(new Error('WebSocket 连接失败: ' + (e && e.message)));

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg.result || msg.error || {});
        pending.delete(msg.id);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || [])
          .map((a) => (a.value !== undefined ? a.value : (a.description || '')))
          .join(' ');
        logs.push({ type: msg.params.type, text });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        errors.push(d.exception ? (d.exception.description || d.text) : d.text);
      }
    };
  });
}

async function main() {
  if (!existsSync(CHROME)) {
    console.error('找不到 Chrome: ' + CHROME);
    process.exit(1);
  }

  const profile = mkdtempSync(join(tmpdir(), 'ci-search-probe-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: 'ignore' });

  let client = null;
  try {
    let ver = null;
    for (let i = 0; i < 60; i++) {
      try { ver = await fetchJson('http://127.0.0.1:' + PORT + '/json/version'); break; }
      catch (e) { await sleep(250); }
    }
    if (!ver) throw new Error('Chrome DevTools 在 15s 内没有就绪');
    console.log('浏览器: ' + ver['Browser']);

    const page = await fetchJson(
      'http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('about:blank'),
      'PUT'
    );
    const wsUrl = page.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('拿不到页面调试地址');

    client = await connect(wsUrl);
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    // 登录态注入分两步：先落到目标 origin，再写 localStorage，然后重新加载。
    // 不直接用 addScriptToEvaluateOnNewDocument：从 about:blank → http 的跨 origin 场景里
    // 它不一定写到目标域，实测会出现「token 已设、页面仍跳 /login」的假象。
    const token = makeToken();
    if (token) console.log('登录态: 自签 token（user_id=' + USER_ID + '）');
    else console.log('登录态: 无（读不到 JWT_SECRET，按未登录模式验证装配链路）');

    await client.send('Page.navigate', { url: BASE });
    await sleep(2500);

    if (token) {
      const wrote = await client.send('Runtime.evaluate', {
        expression: 'try{localStorage.setItem("token",' + JSON.stringify(token) + ');localStorage.getItem("token")?"ok":"empty"}catch(e){String(e)}',
        returnByValue: true
      });
      console.log('token 落盘: ' + (wrote.result && wrote.result.value));
    }

    await client.send('Page.navigate', { url: BASE });
    await sleep(WAIT_MS);

    // 页面结构探测：搜索组件是否存在（未登录时可能不挂载，属正常）
    const probe = await client.send('Runtime.evaluate', {
      expression: [
        'JSON.stringify({',
        '  hasSearchInput: !!document.querySelector(".search-input"),',
        '  hasApp: !!document.querySelector("#app"),',
        '  hasToken: !!localStorage.getItem("token"),',
        '  hasUser: !!localStorage.getItem("user"),',
        '  path: location.pathname + location.hash,',
        '  title: document.title',
        '})'
      ].join('\n'),
      returnByValue: true
    });
    let state = {};
    try { state = JSON.parse(probe.result.value); } catch (e) {}

    const all = client.logs.map((l) => l.text).join('\n');
    const registered = /\[Search\] 已注册 (\d+) 条命令 \/ (\d+) 个数据源/.exec(all);
    const installFailed = all.indexOf('搜索源装配失败') !== -1;
    const fatal = client.errors.filter((e) => e && !/favicon/i.test(e));

    let fail = 0;
    const ok = (label, cond, detail) => {
      console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
      if (!cond) fail++;
    };

    ok('页面已挂载 #app', !!state.hasApp, state.title || '');
    console.log('     当前路径: ' + (state.path || '?') + ' · token: ' +
      (state.hasToken ? '在' : '空') + ' · user: ' + (state.hasUser ? '在' : '空'));
    ok('搜索源装配已执行', !!registered,
      registered ? (registered[1] + ' 条命令 / ' + registered[2] + ' 个数据源') : '未捕获到 [Search] 日志');
    ok('装配未抛错', !installFailed);

    // 搜索面板只在登录后的桌面壳里挂载；未登录会被路由到 /login。
    // 所以「输入框不存在」不是失败，只作提示 —— 关键是上面的装配日志。
    // ⚠️ 面板是 <div v-if="visible">，默认关闭时 .search-input 根本不在 DOM 里。
    //    所以「输入框不存在」绝不能当成「没挂载」——必须真正走一次 open()。
    if (token && state.hasApp) {
      const fired = await client.send('Runtime.evaluate', {
        expression: [
          '(function(){',
          '  try {',
          '    var root = document.querySelector("#app");',
          '    var vm = root && root.__vue__;',
          '    if (!vm) return JSON.stringify({ ok: false, why: "拿不到 Vue 根实例" });',
          '    var gs = vm.$refs && vm.$refs.globalSearch;',
          '    if (!gs) return JSON.stringify({ ok: false, why: "拿不到 globalSearch ref" });',
          '    gs.open();',
          '    gs.query = "云盘";',
          '    gs.onInput();',
          '    return JSON.stringify({ ok: true });',
          '  } catch (e) { return JSON.stringify({ ok: false, why: String(e) }); }',
          '})()'
        ].join('\n'),
        returnByValue: true
      });

      let fireState = {};
      try { fireState = JSON.parse(fired.result.value); } catch (e) {}
      ok('搜索面板可唤起', !!fireState.ok, fireState.why || '');

      // 等防抖 + 异步 Provider 归位
      await sleep(1500);

      const read = await client.send('Runtime.evaluate', {
        expression: [
          '(function(){',
          '  var pick = function (sel) {',
          '    return [].map.call(document.querySelectorAll(sel), function (el) { return el.textContent.trim(); });',
          '  };',
          '  return JSON.stringify({ titles: pick(".result-title"), groups: pick(".group-header") });',
          '})()'
        ].join('\n'),
        returnByValue: true
      });

      let got = { titles: [], groups: [] };
      try { got = JSON.parse(read.result.value); } catch (e) {}

      const hasCloud = got.titles.some((t) => t.indexOf('云盘') !== -1 || t.indexOf('打开云盘') !== -1);
      ok('搜索结果非空', got.titles.length > 0, got.titles.length + ' 条：' + got.titles.slice(0, 4).join(' / '));
      ok('命中「打开云盘」命令', hasCloud, hasCloud ? '' : '结果里没有云盘相关命令');
      console.log('     分组: ' + (got.groups.join(' / ') || '(空)'));
    } else if (!token) {
      console.log('NOTE 跳过真实搜索：无登录态');
    }

    if (fatal.length) {
      console.log('WARN 页面级异常 ' + fatal.length + ' 条（前 2 条）:');
      fatal.slice(0, 2).forEach((e) => console.log('  ' + String(e).split('\n')[0]));
    }

    console.log('');
    if (fail) {
      console.log('冒烟未通过：' + fail + ' 项失败');
      process.exit(1);
    }
    console.log('冒烟通过 ✔');
    process.exit(0);
  } catch (e) {
    console.error('探针异常: ' + (e && e.message));
    process.exit(1);
  } finally {
    try { if (client) client.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}

main();
