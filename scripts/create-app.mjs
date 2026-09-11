#!/usr/bin/env node
// ClassIntra 应用脚手架
//
// 用途：生成符合规范的应用骨架，避免从零手写时踩 Chrome 80 兼容、
//       令牌使用、生命周期回收三类最常见的坑。
//   node scripts/create-app.mjs <app-name> [options]
//
// 选项：
//   --label <名称>      显示名称（默认由 app-name 推导）
//   --dir <路径>        输出目录（默认 market-apps/）
//   --kind <类型>       market（默认，纯 JS 第三方）| official（.vue 官方内置）
//   --with-backend      生成后端路由与建表 SQL
//   --color <hex>       主题色（默认 #007AFF）
//   --force             目标目录已存在时覆盖
//
// 设计原则：生成的模板本身就是「正确示例」——
//   1. 全 ES5（market 类型），可直接在 Chrome 80 / X5 上跑
//   2. 消费 --ci-* 令牌，零自建配色
//   3. onDestroy 回收监听器/定时器/实时订阅/DOM 四类资源
//   4. manifest 含 sdk / capabilities / layout，可通过 market-review 审查

import { mkdirSync, writeFileSync, existsSync, readdirSync, rmdirSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ========== 参数解析 ==========
const argv = process.argv.slice(2);

function flag(name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
}

const appName = argv.find((a) => !a.startsWith('--') && argv.indexOf(a) !== argv.indexOf(flag('--label')) - 1
  && argv.indexOf(a) !== argv.indexOf(flag('--dir')) - 1
  && argv.indexOf(a) !== argv.indexOf(flag('--kind')) - 1
  && argv.indexOf(a) !== argv.indexOf(flag('--color')) - 1);

const options = {
  label: typeof flag('--label') === 'string' ? flag('--label') : null,
  dir: typeof flag('--dir') === 'string' ? flag('--dir') : null,
  kind: typeof flag('--kind') === 'string' ? flag('--kind') : 'market',
  withBackend: argv.includes('--with-backend'),
  color: typeof flag('--color') === 'string' ? flag('--color') : '#007AFF',
  force: argv.includes('--force')
};

if (!appName || appName.startsWith('--')) {
  console.error('用法: node scripts/create-app.mjs <app-name> [options]');
  console.error('');
  console.error('选项:');
  console.error('  --label <名称>    显示名称（默认由 app-name 推导）');
  console.error('  --dir <路径>      输出目录（默认 market-apps/）');
  console.error('  --kind <类型>     market（默认）| official');
  console.error('  --with-backend    生成后端路由与建表 SQL');
  console.error('  --color <hex>     主题色（默认 #007AFF）');
  console.error('  --force           目标目录已存在时覆盖');
  console.error('');
  console.error('示例:');
  console.error('  node scripts/create-app.mjs my-tool --label 我的工具 --with-backend');
  process.exit(2);
}

if (!/^[a-z][a-z0-9-]*$/.test(appName)) {
  console.error('应用名必须为 kebab-case（小写字母开头，仅含小写字母、数字、连字符）: ' + appName);
  process.exit(2);
}

if (options.kind !== 'market' && options.kind !== 'official') {
  console.error('--kind 只能是 market 或 official');
  process.exit(2);
}

if (!/^#[0-9a-fA-F]{6}$/.test(options.color)) {
  console.error('--color 必须是 6 位 hex（如 #007AFF）');
  process.exit(2);
}

const outBase = options.dir
  ? resolve(ROOT, options.dir)
  : resolve(ROOT, options.kind === 'market' ? 'market-apps' : 'apps');
const appDir = join(outBase, appName);

// 由 app-name 推导 PascalCase 组件名
const pascal = appName.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
const label = options.label || appName;
const camel = appName.split('-').map((s, i) => i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)).join('');

// ========== 目标目录检查 ==========
if (existsSync(appDir)) {
  if (!options.force) {
    console.error('目录已存在: ' + appDir);
    console.error('如需覆盖，加 --force（会清理该目录下的文件）');
    process.exit(1);
  }
  cleanupDir(appDir);
}

function cleanupDir(dir) {
  const entries = readdirSync(dir);
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      cleanupDir(full);
      rmdirSync(full);
    } else {
      unlinkSync(full);
    }
  }
}

// ========== 写入工具 ==========
const created = [];

function write(relPath, content) {
  const full = join(appDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  created.push(relPath);
}

// ========== manifest.json ==========
const manifest = {
  name: appName,
  type: 'app',
  version: '1.0.0',
  sdk: '1',
  label: label,
  description: '',
  author: '',
  icon: options.kind === 'market' ? './icon.svg' : '/resources/public/icons/' + pascal + '.png',
  color: options.color,
  category: 'desktop',
  order: 50,
  defaultEnabled: true,
  canDisable: true,
  capabilities: options.withBackend
    ? ['data.http', 'data.realtime', 'data.storage', 'ui.toast', 'ui.modal', 'app.storage']
    : ['data.storage', 'ui.toast', 'app.storage'],
  layout: { mode: 'fullscreen' },
  frontend: options.kind === 'market'
    ? {
        route: '/' + appName,
        routeName: pascal,
        entry: './frontend/entry.js',
        style: './frontend/style.css'
      }
    : {
        route: '/' + appName,
        routeName: pascal,
        component: './frontend/' + pascal + '.vue'
      }
};

if (options.withBackend) {
  manifest.backend = {
    mountPath: '/api/' + appName,
    entry: './backend/routes.js'
  };
}

write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

// ========== icon.svg ==========
write('icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="${label}">
  <title>${label}</title>
  <rect x="4" y="4" width="88" height="88" rx="20" fill="${options.color}"/>
  <path d="M30 48h36M48 30v36" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" fill="none"/>
</svg>
`);

// ========== 前端入口 ==========
if (options.kind === 'market') {
  write('frontend/entry.js', marketEntry());
  write('frontend/style.css', marketStyle());
} else {
  write('frontend/' + pascal + '.vue', officialVue());
}

if (options.withBackend) {
  write('backend/routes.js', backendRoutes());
  write('backend/schema.sql', backendSql());
  write('backend/README.md', backendReadme());
}

// ========== README ==========
write('README.md', appReadme());

// ========== 完成输出 ==========
const rel = appDir.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '');

console.log('');
console.log('已生成应用骨架: ' + rel + '/');
console.log('='.repeat(60));
for (const f of created) {
  console.log('  + ' + f);
}
console.log('');
console.log('下一步:');
if (options.kind === 'market') {
  console.log('  1. 静态审查:  node scripts/market-review.mjs ' + rel);
  console.log('  2. 本地调试:  把目录复制到目标机的 market-apps/ 下');
} else {
  console.log('  1. 构建验证:  cd client && ./node_modules/.bin/vite build');
  console.log('  2. 动效审计:  node scripts/motion-verify.js');
}
console.log('  3. 填充业务逻辑，注意保持 ES5 语法与 --ci-* 令牌');
console.log('');

// ==================== 模板 ====================

function marketEntry() {
  return `/* ${label} —— 市场应用入口
 *
 * ⚠️ 本文件不过 Vite 构建，直接下发到浏览器执行。
 *    必须全 ES5：禁 const/let、箭头函数、模板字符串、?.、??、class、async。
 *    禁止直接用 WebSocket（X5 会静默断连），走 context.data.realtime。
 *    所有资源必须在 context.app.onDestroy 中回收。
 */
window.ClassIntraMarket.define({
  name: '${appName}',

  mount: function (container, context) {
    /* ---------- 结构 ---------- */
    var root = document.createElement('div');
    root.className = '${appName}-root';

    var header = document.createElement('header');
    header.className = '${appName}-header';

    var title = document.createElement('h1');
    title.className = '${appName}-title';
    title.textContent = '${label}';
    header.appendChild(title);
    root.appendChild(header);

    var main = document.createElement('main');
    main.className = '${appName}-main';

    var counter = document.createElement('p');
    counter.className = '${appName}-counter';
    counter.textContent = '0';
    main.appendChild(counter);

    var btn = document.createElement('button');
    btn.className = '${appName}-btn';
    btn.type = 'button';
    btn.textContent = '加一';
    main.appendChild(btn);

    root.appendChild(main);
    container.appendChild(root);

    /* ---------- 状态 ---------- */
    var store = context.data.storage;
    var count = store.get('count', 0);
    counter.textContent = String(count);

    /* ---------- 交互 ---------- */
    function onClick() {
      count += 1;
      counter.textContent = String(count);
      store.set('count', count);

      // 有后端时同步；失败降级为本地保存，不打断交互
      ${
        options.withBackend
          ? `context.data.post('/api/${appName}/incr', { delta: 1 })
        .then(function (res) {
          if (res && res.code === 200 && typeof res.data.count === 'number') {
            count = res.data.count;
            counter.textContent = String(count);
            store.set('count', count);
          }
        })
        .catch(function () {
          context.ui.toast('已离线保存');
        });`
          : `context.ui.toast('已保存');`
      }
    }

    btn.addEventListener('click', onClick);

    ${
      options.withBackend
        ? `/* ---------- 实时 ---------- */
    var stopRealtime = context.data.realtime.subscribe('${appName}.updated', function (payload) {
      if (payload && typeof payload.count === 'number') {
        count = payload.count;
        counter.textContent = String(count);
        store.set('count', count);
      }
    });`
        : `var stopRealtime = null;`
    }

    /* ---------- 回收契约（逆序执行，四类资源全部覆盖）---------- */
    context.app.onDestroy(function () {
      btn.removeEventListener('click', onClick);
    });
    if (stopRealtime) {
      context.app.onDestroy(function () { stopRealtime(); });
    }
    context.app.onDestroy(function () {
      if (root.parentNode) root.parentNode.removeChild(root);
    });
  },

  unmount: function (container) {
    container.replaceChildren();
  }
});
`;
}

function marketStyle() {
  return `/* ${label} —— 样式
 *
 * 规则：
 *   1. 只消费 --ci-* 令牌，禁止自建配色与裸 px 圆角
 *   2. 禁止 flex gap（Chrome 84+），用相邻兄弟选择器 + margin
 *   3. 禁止 :is()/:where()/aspect-ratio/@container
 *   4. 只过渡 transform / opacity / 绘制类属性，禁止过渡 width/height/top/left
 *   5. 禁止 transition: all
 */

.${appName}-root {
  padding: 24px;
  box-sizing: border-box;
  color: var(--ci-color-text-primary, #000000);
  background: var(--ci-color-bg-primary, #FFFFFF);
  border-radius: var(--ci-shape-lg, 16px);
}

.${appName}-header {
  margin-bottom: 20px;
}

.${appName}-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.3;
}

.${appName}-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.${appName}-counter {
  margin: 0 0 16px;
  font-size: 48px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

/* 按钮：胶囊 + 跟手反馈 */
.${appName}-btn {
  padding: 12px 28px;
  border: none;
  border-radius: var(--ci-shape-pill, 9999px);
  background: var(--ci-color-primary, #007AFF);
  color: #FFFFFF;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  -webkit-appearance: none;
  transition: transform var(--ci-motion-duration-fast) var(--ci-motion-spring-interactive),
              box-shadow var(--ci-motion-duration-fast) var(--ci-motion-spring-interactive);
}

.${appName}-btn:active {
  /* 不使用 scale(0) —— 缩到零会有「凭空崩坏」观感 */
  transform: scale(0.96);
}

/* 毛玻璃降级：低端设备 / 滚动中 / 用户手动关闭毛玻璃 */
.${appName}-root[data-glass] {
  background: var(--ci-color-bg-primary, #FFFFFF);
}
`;
}

function officialVue() {
  return `<template>
  <div class="${appName}-root">
    <header class="${appName}-header">
      <h1 class="${appName}-title">${label}</h1>
    </header>

    <main class="${appName}-main">
      <p class="${appName}-counter">{{ count }}</p>
      <button class="${appName}-btn" type="button" @click="incr">加一</button>
    </main>
  </div>
</template>

<script>
/* ${label} —— 官方内置应用
 * 经 Vite 构建，享 @vitejs/plugin-legacy 与 PostCSS 兜底，
 * 但仍需遵守动效规范（node scripts/motion-verify.js 会审查本目录）。
 */
import api from '@/utils/api';

export default {
  name: '${pascal}',

  data: function () {
    return {
      count: 0
    };
  },

  mounted: function () {
    this.load();
  },

  methods: {
    load: function () {
      var self = this;
      return api.get('/api/${appName}/state').then(function (res) {
        if (res.data && res.data.code === 200 && res.data.data) {
          self.count = res.data.data.count || 0;
        }
      }).catch(function () {
        /* 静默失败：保持本地值 */
      });
    },

    incr: function () {
      var self = this;
      this.count += 1;
      return api.post('/api/${appName}/incr', { delta: 1 }).then(function (res) {
        if (res.data && res.data.code === 200 && res.data.data) {
          self.count = res.data.data.count;
        }
      }).catch(function () {
        /* 本地已自增，不回滚 */
      });
    }
  }
};
</script>

<style scoped>
.${appName}-root {
  padding: 24px;
  box-sizing: border-box;
  color: var(--ci-color-text-primary, #000000);
}

.${appName}-header {
  margin-bottom: 20px;
}

.${appName}-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.3;
}

.${appName}-counter {
  margin: 0 0 16px;
  font-size: 48px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.${appName}-btn {
  padding: 12px 28px;
  border: none;
  border-radius: var(--ci-shape-pill, 9999px);
  background: var(--ci-color-primary, #007AFF);
  color: #FFFFFF;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: transform var(--ci-motion-duration-fast) var(--ci-motion-spring-interactive),
              box-shadow var(--ci-motion-duration-fast) var(--ci-motion-spring-interactive);
}

.${appName}-btn:active {
  transform: scale(0.96);
}
</style>
`;
}

function backendRoutes() {
  return `/* ${label} —— 后端路由
 *
 * 注意：
 *   1. CommonJS（require / module.exports）
 *   2. better-sqlite3 的 statement 方法必须以 statement 自身为 this：
 *        stmt.all.apply(stmt, values)   ← 正确
 *        stmt.all.apply(null, values)   ← TypeError: Illegal invocation
 *   3. 表结构在 schema.sql 中；应用安装后需手动执行（或走迁移流程）
 */
var express = require('express');
var router = express.Router();

var auth = require('../../../server/src/middleware/auth');
var db = require('../../../server/src/utils/db');

var TABLE = '${appName.replace(/-/g, '_')}_state';

/* 读取状态 */
router.get('/state', auth.requireAuth, function (req, res) {
  var userId = req.user.user_id;

  var row = db.prepare(
    'SELECT count, updated_at FROM ' + TABLE + ' WHERE user_id = ?'
  ).get(userId);

  res.json({
    code: 200,
    data: {
      count: row ? row.count : 0,
      updatedAt: row ? row.updated_at : null
    }
  });
});

/* 自增 */
router.post('/incr', auth.requireAuth, function (req, res) {
  var userId = req.user.user_id;
  var delta = req.body && req.body.delta;

  if (delta !== undefined) {
    if (typeof delta !== 'number' || !isFinite(delta) || Math.abs(delta) > 1000) {
      return res.status(400).json({ code: 400, message: 'delta 不合法' });
    }
  } else {
    delta = 1;
  }

  var now = Date.now();
  var row = db.prepare('SELECT count FROM ' + TABLE + ' WHERE user_id = ?').get(userId);
  var next = (row ? row.count : 0) + delta;

  if (row) {
    db.prepare('UPDATE ' + TABLE + ' SET count = ?, updated_at = ? WHERE user_id = ?')
      .run(next, now, userId);
  } else {
    db.prepare('INSERT INTO ' + TABLE + ' (user_id, count, updated_at) VALUES (?, ?, ?)')
      .run(userId, next, now);
  }

  res.json({ code: 200, data: { count: next } });
});

module.exports = router;
`;
}

function backendSql() {
  return `-- ${label} —— 表结构
-- 应用安装后执行：sqlite3 或服务端迁移流程

CREATE TABLE IF NOT EXISTS ${appName.replace(/-/g, '_')}_state (
  user_id     TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_${appName.replace(/-/g, '_')}_updated
  ON ${appName.replace(/-/g, '_')}_state (updated_at DESC);
`;
}

function backendReadme() {
  return `# ${label} 后端

## 表结构

应用首次安装到班级服务器后，需要执行 \`schema.sql\` 建表：

\`\`\`bash
sqlite3 server/database/classintra.db < market-apps/${appName}/backend/schema.sql
\`\`\`

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | \`/api/${appName}/state\` | 查询当前用户状态 |
| POST | \`/api/${appName}/incr\`  | 自增（body: \`{ delta?: number }\`） |

两个接口都需要登录态（\`auth.requireAuth\`）。

## 卸载行为

应用卸载后，其 API 返回 JSON 404 而非前端 \`index.html\`。表数据不会被自动清理——
如需保留用户数据请勿在卸载时 DROP，如需清理请提供显式的清理入口。
`;
}

function appReadme() {
  const isMarket = options.kind === 'market';
  return `# ${label}

${isMarket ? 'ClassIntra 市场应用' : 'ClassIntra 官方内置应用'}。

## 开发要点

${isMarket
  ? `本应用**不过 Vite 构建**，源码直接下发到浏览器。必须遵守：

1. **全 ES5** —— 禁 \`const\`/\`let\`、箭头函数、模板字符串、\`?.\`、\`??\`、\`class\`、\`async\`
2. **实时用长轮询** —— \`context.data.realtime\`，禁止直接用 \`new WebSocket()\`
3. **存储加命名空间** —— 用 \`context.data.storage\`，或 \`localStorage\` 键名加 \`ci:app:${appName}:\` 前缀
4. **CSS 避开 Chrome 84+ 特性** —— 不用 flex \`gap\`、\`:is()\`、\`aspect-ratio\`、\`@container\`
5. **回收四类资源** —— 监听器 / 定时器 / 实时订阅 / DOM，全部经 \`context.app.onDestroy\``
  : `本应用经 Vite 构建，享 \`@vitejs/plugin-legacy\` 与 PostCSS 兜底。
但仍需遵守动效规范：只过渡 \`transform\`/\`opacity\`、不用 \`transition: all\`、不用裸 px 圆角。`}

## 视觉一致性

颜色、圆角、动效**一律使用 \`--ci-*\` 令牌**，不要自建一套：

\`\`\`css
.my-app {
  color: var(--ci-color-text-primary, #000000);
  border-radius: var(--ci-shape-lg, 16px);
  transition: transform var(--ci-motion-duration-normal) var(--ci-motion-spring-snappy);
}
\`\`\`

八档圆角：\`xs(4) sm(8) md(12) lg(16) xl(20) 2xl(24) 3xl(28) pill(9999)\`。
四档 spring：\`snappy\`（入场）\`bouncy\`（仅庆祝）\`smooth\`（文字淡入）\`interactive\`（跟手）。

## 自查

\`\`\`bash
${isMarket
  ? `node scripts/market-review.mjs ${options.kind === 'market' ? 'market-apps/' : 'apps/'}${appName}`
  : `node scripts/motion-verify.js`}
\`\`\`

${isMarket ? '审查脚本按五组检查：manifest / Chrome 80 语法 / CSS 兼容 / 危险 API / 资源回收。\n提交市场前请确保「错误 0 项」。\n\n' : ''}## 完整规范

- [第三方应用开发](https://classintra.github.io/development/third-party)
- [SDK 参考](https://classintra.github.io/development/sdk)
`;
}
