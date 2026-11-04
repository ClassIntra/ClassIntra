// 脚手架：生成可上架的最小包（app / site / service / plugin / theme）
// ============================================================
// 设计约束（与平台一致，生成物开箱即过体检）：
//   - 前端一律 ES5（var / function / 无模板字符串 / 无箭头函数）
//   - 颜色、圆角、动效只用 --ci-* 令牌，不写裸值
//   - 监听器 / 定时器 / 订阅登记到 context.app.onDestroy
//   - 建了表就配 backend/cleanup.js（卸载即无痕）
//   - 清单只声明真实用到的 capabilities

import fs from 'node:fs';
import path from 'node:path';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(file, content, force) {
  if (!force && fs.existsSync(file)) {
    throw new Error('文件已存在（加 --force 覆盖）: ' + file);
  }
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content.replace(/\r\n/g, '\n'), 'utf8');
}

function writeJson(file, obj, force) {
  write(file, JSON.stringify(obj, null, 2) + '\n', force);
}

function titleCase(name) {
  return name.split('-').map(function (s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }).join(' ');
}

// ---------- 微前端应用 ----------
function appFiles(name, opts) {
  const label = opts.label || titleCase(name);
  const withBackend = !!opts.withBackend;
  const manifest = {
    name: name,
    type: 'app',
    label: label,
    version: '0.1.0',
    sdk: '1',
    color: opts.color || '#5856D6',
    category: 'desktop',
    order: opts.order || 50,
    capabilities: withBackend
      ? ['data.storage', 'data.http', 'ui.toast']
      : ['data.storage', 'ui.toast'],
    layout: { mode: 'fullscreen' },
    frontend: {
      route: '/' + name,
      entry: './frontend/entry.js',
      style: './frontend/style.css',
      widgets: []
    }
  };
  if (withBackend) {
    manifest.backend = {
      mountPath: '/api/' + name,
      entry: './backend/routes.js',
      // 定时任务示例：宿主托管，重启不丢、错过补跑，结果可在 /api/market/app-jobs 查看
      jobs: [
        { name: 'heartbeat', every: '5m', handler: './backend/jobs/heartbeat.js' }
      ]
    };
    manifest.config = [
      { key: 'API_BASE', label: '上游地址', type: 'string', required: false, default: '' }
    ];
  }

  const files = {};
  files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';

  files['frontend/entry.js'] = [
    '// ' + label + ' — 微前端入口（纯 ES5，不参与构建）',
    '// 契约：window.ClassIntraMarket.define({ name, mount, unmount, widgets? })',
    '(function () {',
    "  'use strict';",
    '',
    '  var NAME = ' + JSON.stringify(name) + ';',
    '',
    '  function mount(container, context) {',
    "    var root = document.createElement('div');",
    "    root.className = 'app-root';",
    '',
    "    var title = document.createElement('h2');",
    "    title.className = 'app-title';",
    '    title.textContent = ' + JSON.stringify(label) + ';',
    '    root.appendChild(title);',
    '',
    "    var desc = document.createElement('p');",
    "    desc.className = 'app-desc';",
    "    desc.textContent = '在 src/frontend/entry.js 里开始写你的应用。';",
    '    root.appendChild(desc);',
    '',
    "    var button = document.createElement('button');",
    "    button.className = 'app-button';",
    "    button.textContent = '记一次';",
    '    root.appendChild(button);',
    '',
    '    // 命名空间存储：自动加 ci:app:<name>: 前缀，卸载时清得干净',
    "    var count = Number(context.data.storage.get('count', 0)) || 0;",
    '    var counter = document.createElement(\'p\');',
    "    counter.className = 'app-counter';",
    '    counter.textContent = String(count);',
    '    root.appendChild(counter);',
    '',
    '    function onClick() {',
    '      count += 1;',
    '      counter.textContent = String(count);',
    "      context.data.storage.set('count', count);",
    "      context.ui.toast('已保存：' + count);",
    '    }',
    "    button.addEventListener('click', onClick);",
    '',
    '    // 跟随主题的示例：读取令牌（不存在时用兜底色）',
    "    var accent = context.system.getToken('color-primary') || '#007AFF';",
    '    root.style.setProperty(\'--app-accent\', accent);',
    '',
    '    container.appendChild(root);',
    '',
    '    // 清理契约：一切监听器 / 定时器 / 订阅都要登记',
    '    context.app.onDestroy(function () {',
    "      button.removeEventListener('click', onClick);",
    '      if (root.parentNode) root.parentNode.removeChild(root);',
    '    });',
    '  }',
    '',
    '  function unmount(container) {',
    "    container.innerHTML = '';",
    '  }',
    '',
    '  window.ClassIntraMarket.define({',
    '    name: NAME,',
    '    mount: mount,',
    '    unmount: unmount',
    '  });',
    '})();',
    ''
  ].join('\n');

  files['frontend/style.css'] = [
    '/* 只用 --ci-* 令牌：切主题 / 深色模式自动跟随 */',
    '.app-root {',
    '  min-height: 100%;',
    '  padding: 24px;',
    '  box-sizing: border-box;',
    '  background: var(--ci-color-bg-primary, #F2F2F7);',
    '  color: var(--ci-color-text-primary, #000000);',
    '}',
    '',
    '.app-title {',
    '  margin: 0 0 8px;',
    '  font-size: 22px;',
    '  font-weight: 700;',
    '}',
    '',
    '.app-desc {',
    '  margin: 0 0 20px;',
    '  color: var(--ci-color-text-secondary, #8E8E93);',
    '  font-size: 14px;',
    '}',
    '',
    '.app-button {',
    '  padding: 12px 22px;',
    '  border: none;',
    '  border-radius: var(--ci-shape-pill, 9999px);',
    '  background: var(--app-accent, var(--ci-color-primary, #007AFF));',
    '  color: #FFFFFF;',
    '  font-size: 15px;',
    '  transition: transform var(--ci-motion-duration-fast, 0.15s) var(--ci-motion-spring-interactive, cubic-bezier(0.2, 0.9, 0.3, 1));',
    '}',
    '',
    '.app-button:active {',
    '  transform: scale(0.96);',
    '}',
    '',
    '.app-counter {',
    '  margin-top: 16px;',
    '  font-size: 40px;',
    '  font-weight: 700;',
    '  font-variant-numeric: tabular-nums;',
    '}',
    ''
  ].join('\n');

  files['README.md'] = [
    '# ' + label,
    '',
    '- 路由：`/' + name + '`',
    '- 入口：`frontend/entry.js`（ES5，直出，不走构建）',
    '- 体检：`npx classintra-devkit check .`',
    '- 打包：`npx classintra-devkit pack .`',
    '',
    '## 开发约定',
    '',
    '- 不要用 `const` / `let` / 箭头函数 / 模板字符串 / `?.` / `??` / `class`（Chrome 80 会白屏）',
    '- 样式只用 `--ci-*` 令牌；不要 `transition: all`',
    '- 所有监听器、定时器、订阅在 `context.app.onDestroy` 里回收',
    '- 本地存储只走 `context.data.storage`；要跟账号走用 `context.data.store`（需声明能力 `data.store`）',
    '- 周期性工作交给 `backend.jobs`，不要自己 setInterval（重启即丢、错过不补）',
    ''
  ].join('\n');

  if (withBackend) {
    files['backend/routes.js'] = [
      '// ' + label + ' — 后端路由（CommonJS，挂到 /api/' + name + '）',
      "var express = require('express');",
      'var router = express.Router();',
      '',
      '// 相对路径按运行时位置解析：market-apps/<name>/backend/ → 主服务 src/',
      "var CORE = '../../../../server/src';",
      'var auth = require(CORE + \'/middleware/auth\');',
      'var db = require(CORE + \'/utils/db\');',
      '',
      '// 自建表：加应用名前缀，避免与宿主或其他应用撞名',
      "db.prepare('CREATE TABLE IF NOT EXISTS " + name.replace(/-/g, '_') + "_items (' +",
      "  'id INTEGER PRIMARY KEY AUTOINCREMENT,' +",
      "  'user_id TEXT NOT NULL,' +",
      "  'title TEXT,' +",
      "  'created_at INTEGER' +",
      "')').run();",
      '',
      "router.get('/items', auth.requireAuth, function (req, res) {",
      '  var rows = db.prepare(',
      "    'SELECT * FROM " + name.replace(/-/g, '_') + "_items WHERE user_id = ? ORDER BY created_at DESC'",
      '  ).all(req.user.user_id);',
      '  res.json({ code: 200, data: { items: rows } });',
      '});',
      '',
      "router.post('/items', auth.requireAuth, function (req, res) {",
      '  var title = String((req.body && req.body.title) || \'\').slice(0, 200);',
      '  if (!title) return res.status(400).json({ code: 400, message: \'title 必填\' });',
      '  var info = db.prepare(',
      "    'INSERT INTO " + name.replace(/-/g, '_') + "_items (user_id, title, created_at) VALUES (?, ?, ?)'",
      '  ).run(req.user.user_id, title, Date.now());',
      '  res.json({ code: 200, data: { id: info.lastInsertRowid } });',
      '});',
      '',
      'module.exports = router;',
      ''
    ].join('\n');

    files['backend/jobs/heartbeat.js'] = [
      '// ' + label + ' — 定时任务示例（manifest.backend.jobs 声明，宿主每 5 分钟调用）',
      '// 约定：导出 function(ctx)，返回 Promise 即异步任务；ctx 有 appName / jobName / log()',
      "var path = require('path');",
      "var db = require(path.resolve(process.cwd(), 'src/utils/db'));",
      '',
      'module.exports = function (ctx) {',
      "  db.prepare('CREATE TABLE IF NOT EXISTS " + name.replace(/-/g, '_') + "_pulse (' +",
      "    'id INTEGER PRIMARY KEY AUTOINCREMENT,' +",
      "    'at INTEGER' +",
      "  ')').run();",
      "  db.prepare('INSERT INTO " + name.replace(/-/g, '_') + "_pulse (at) VALUES (?)').run(Date.now());",
      "  ctx.log('heartbeat 已记录');",
      '};',
      ''
    ].join('\n');

    files['backend/cleanup.js'] = [
      '// 卸载即无痕：与 routes.js 自建的表 / kv 一一对应',
      "var path = require('path');",
      "var db = require(path.resolve(process.cwd(), 'src/utils/db'));",
      '',
      'module.exports = function cleanup(ctx) {',
      "  db.prepare('DROP TABLE IF EXISTS " + name.replace(/-/g, '_') + "_items').run();",
      "  db.prepare(\"DELETE FROM user_kv_store WHERE key LIKE '" + name + ":%'\").run();",
      '};',
      ''
    ].join('\n');
  }

  return files;
}

// ---------- 静态站（存量项目迁入） ----------
function siteFiles(name, opts) {
  const label = opts.label || titleCase(name);
  const manifest = {
    name: name,
    type: 'app',
    label: label,
    version: '0.1.0',
    sdk: '1',
    color: opts.color || '#34C759',
    category: 'desktop',
    order: opts.order || 50,
    capabilities: ['ui.toast'],
    layout: { mode: 'fullscreen' },
    frontend: {
      route: '/' + name,
      static: './frontend/index.html'
    }
  };

  const files = {};
  files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
  files['frontend/index.html'] = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '  <title>' + label + '</title>',
    '  <!-- CI 适配器：拿到主题 / 用户 / 返回桌面 / toast（同源，免登录处理） -->',
    '  <script src="/ci-adapter.js"></script>',
    '  <style>',
    '    body { margin: 0; font-family: -apple-system, "PingFang SC", sans-serif; padding: 24px; }',
    '    h1 { font-size: 22px; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <h1>' + label + '</h1>',
    '  <p>把已有项目的构建产物拷进 frontend/ 即可；这个文件只是占位。</p>',
    '  <button id="back">返回桌面</button>',
    '  <script>',
    '    // 适配器能力：CI.theme() / CI.onTheme(fn) / CI.user() / CI.back() / CI.toast(text)',
    "    document.getElementById('back').addEventListener('click', function () {",
    '      if (window.CI && CI.back) CI.back();',
    '    });',
    '  </script>',
    '</body>',
    '</html>',
    ''
  ].join('\n');
  files['README.md'] = [
    '# ' + label,
    '',
    '静态站形态：整个 `frontend/` 以同源 iframe 加载，**不适用** Chrome 80 语法红线',
    '（那是你自己构建产物的目标浏览器决定）。',
    '',
    '- 把 `dist/` 里的文件拷进 `frontend/`',
    '- 需要跟随主题时保留 `<script src="/ci-adapter.js"></script>`',
    '- 体检：`npx classintra-devkit check .`',
    ''
  ].join('\n');

  return files;
}

// ---------- 独立端口服务 ----------
function serviceFiles(name, opts) {
  const label = opts.label || titleCase(name);
  const port = opts.port || 41234;
  const manifest = {
    name: name,
    type: 'app',
    label: label,
    version: '0.1.0',
    sdk: '1',
    color: opts.color || '#FF9500',
    category: 'hidden',
    order: opts.order || 80,
    capabilities: ['data.http'],
    frontend: {
      route: '/' + name,
      entry: './frontend/entry.js'
    },
    backend: {
      mountPath: '/api/' + name,
      entry: './backend/server.js',
      process: { entry: './backend/server.js', port: port }
    }
  };

  const files = {};
  files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
  files['backend/server.js'] = [
    '// ' + label + ' — 独立端口服务（任意语言均可；这里用 Node 做示例）',
    '// 宿主要求：只绑 127.0.0.1，端口读环境变量 PORT。',
    "var http = require('http');",
    '',
    'var PORT = Number(process.env.PORT || ' + port + ');',
    '',
    'var server = http.createServer(function (req, res) {',
    '  res.setHeader(\'Content-Type\', \'application/json; charset=utf-8\');',
    "  if (req.url === '/health') {",
    '    res.end(JSON.stringify({ ok: true }));',
    '    return;',
    '  }',
    '  res.end(JSON.stringify({ code: 200, data: { hello: process.env.CI_APP_NAME || ' + JSON.stringify(name) + ' } }));',
    '});',
    '',
    "server.listen(PORT, '127.0.0.1', function () {",
    "  console.log('[' + (process.env.CI_APP_NAME || 'service') + '] listening on ' + PORT);",
    '});',
    ''
  ].join('\n');
  files['frontend/entry.js'] = [
    '// 进程型应用的壳：通过 /api/' + name + '/* 反代访问自己的服务',
    '(function () {',
    "  'use strict';",
    '  function mount(container, context) {',
    "    var box = document.createElement('div');",
    "    box.style.padding = '24px';",
    "    box.textContent = '正在连接服务…';",
    '    container.appendChild(box);',
    '',
    "    context.data.get('/" + 'api/' + name + "/health').then(function (res) {",
    '      var data = res && res.data ? res.data : null;',
    "      box.textContent = data && data.ok ? '服务运行中 ✓' : '服务已响应';",
    '    }).catch(function () {',
    "      box.textContent = '服务未就绪（看服务器日志 [proc:" + name + "]）';",
    '    });',
    '',
    '    context.app.onDestroy(function () {',
    '      if (box.parentNode) box.parentNode.removeChild(box);',
    '    });',
    '  }',
    '  window.ClassIntraMarket.define({ name: ' + JSON.stringify(name) + ', mount: mount, unmount: function (c) { c.innerHTML = \'\'; } });',
    '})();',
    ''
  ].join('\n');
  files['README.md'] = [
    '# ' + label,
    '',
    '独立端口服务形态：宿主 spawn 你的进程并反代 `/api/' + name + '/*`。',
    '',
    '- 端口：' + port + '（安装期会探测冲突，换端口要同步改 manifest）',
    '- 必须 `server.listen(PORT, \'127.0.0.1\')`',
    '- 反代**仅 HTTP**，不支持 WebSocket；联机请用 `context.data.realtime`',
    '- 日志在服务器上带 `[proc:' + name + ']` 前缀',
    '- Python / Go / Java 也可：改 `backend.process.command` 即可',
    ''
  ].join('\n');

  return files;
}

// ---------- 插件（纯后端） ----------
function pluginFiles(name, opts) {
  const label = opts.label || titleCase(name);
  const manifest = {
    name: name,
    type: 'plugin',
    label: label,
    version: '0.1.0',
    sdk: '1',
    category: 'hidden',
    order: 99,
    defaultEnabled: true,
    canDisable: true,
    description: label,
    capabilities: ['data.http'],
    backend: { mountPath: '/api/' + name, entry: './backend/routes.js' }
  };

  const files = {};
  files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
  files['backend/routes.js'] = [
    '// ' + label + ' — 插件后端（无桌面图标、无独立页面）',
    "var express = require('express');",
    'var router = express.Router();',
    '',
    "var CORE = '../../../../server/src';",
    'var auth = require(CORE + \'/middleware/auth\');',
    '',
    "router.get('/ping', auth.requireAuth, function (req, res) {",
    '  res.json({ code: 200, data: { pong: true, at: Date.now() } });',
    '});',
    '',
    'module.exports = router;',
    ''
  ].join('\n');
  files['README.md'] = [
    '# ' + label,
    '',
    '插件形态：只有后端路由，没有页面。需要界面时请做成应用。',
    '',
    '- 挂载点：`/api/' + name + '`',
    '- 支持暂停/恢复（管理端），请求期闸门即时生效',
    '- 体检：`npx classintra-devkit check .`',
    ''
  ].join('\n');

  return files;
}

// ---------- 主题包（纯数据） ----------
function themeFiles(id, opts) {
  const label = opts.label || titleCase(id);
  const type = opts.type === 'dark' ? 'dark' : 'light';
  const manifest = {
    id: id,
    name: label,
    type: type,
    version: '0.1.0',
    description: label + ' 主题',
    author: 'Your Name',
    tokens: './tokens.json'
  };

  const accent = type === 'dark' ? '#0A84FF' : '#007AFF';
  const tokens = {
    color: {
      primary: accent,
      primaryLight: type === 'dark' ? 'rgba(10, 132, 255, 0.22)' : 'rgba(0, 122, 255, 0.12)',
      primaryLighter: type === 'dark' ? 'rgba(10, 132, 255, 0.12)' : 'rgba(0, 122, 255, 0.06)',
      bgPrimary: type === 'dark' ? '#000000' : '#F2F2F7',
      bgSecondary: type === 'dark' ? '#1C1C1E' : '#FFFFFF',
      bgElevated: type === 'dark' ? '#2C2C2E' : '#FFFFFF',
      textPrimary: type === 'dark' ? '#FFFFFF' : '#000000',
      textSecondary: type === 'dark' ? 'rgba(235, 235, 245, 0.6)' : 'rgba(60, 60, 67, 0.6)',
      border: type === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
      semantic: {
        success: '#34C759',
        warning: '#FF9500',
        danger: '#FF3B30'
      }
    },
    shape: {
      sm: '8px',
      md: '12px',
      lg: '16px',
      xl: '20px',
      pill: '9999px'
    },
    motion: {
      springSnappy: 'cubic-bezier(0.32, 1.28, 0.5, 1)',
      springSmooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      durationFast: '0.15s',
      durationNormal: '0.25s'
    }
  };

  const files = {};
  files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
  files['tokens.json'] = JSON.stringify(tokens, null, 2) + '\n';
  files['README.md'] = [
    '# ' + label,
    '',
    '主题包：**纯数据 JSON**，没有脚本执行（CSP 友好）。',
    '',
    '- `id` 必须等于目录名，且不能是 `light` / `dark`',
    '- 改 `tokens.json` 里的值即可生效；令牌全部可选，缺省回落内置主题',
    '- 体检：`npx classintra-devkit check .`',
    ''
  ].join('\n');

  return files;
}

const BUILDERS = {
  app: appFiles,
  site: siteFiles,
  service: serviceFiles,
  plugin: pluginFiles,
  theme: themeFiles
};

export function create(kind, name, options) {
  const opts = options || {};
  if (!BUILDERS[kind]) {
    throw new Error('未知类型: ' + kind + '（可选 app / site / service / plugin / theme）');
  }
  const safeName = String(name || '').trim();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(safeName)) {
    throw new Error('名称需为 kebab-case（小写字母开头，2-64 位）: ' + safeName);
  }
  if (kind === 'theme' && (safeName === 'light' || safeName === 'dark')) {
    throw new Error('主题 id 不能是 light / dark（内置主题不可覆盖）');
  }

  const targetDir = path.resolve(opts.dir || '.', safeName);
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length && !opts.force) {
    throw new Error('目标目录非空（加 --force 覆盖）: ' + targetDir);
  }

  const files = BUILDERS[kind](safeName, opts);
  for (const [rel, content] of Object.entries(files)) {
    write(path.join(targetDir, rel), content, true);
  }
  return { dir: targetDir, files: Object.keys(files) };
}
