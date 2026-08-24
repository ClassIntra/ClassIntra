# ClassIntra 插件开发指南

> 本文档面向第三方/扩展开发者，说明如何在 ClassIntra 中开发**应用插件**与**桌面小组件（Widget）插件**。
> ClassIntra 采用「约定优于配置」的模块化架构，插件以独立目录形式存在，由聚合器自动扫描挂载。

## 目录

1. [概述](#1-概述)
2. [插件类型](#2-插件类型)
3. [快速开始](#3-快速开始)
4. [目录结构](#4-目录结构)
5. [Manifest 清单](#5-manifest-清单)
6. [前端应用开发](#6-前端应用开发)
7. [后端路由开发](#7-后端路由开发)
8. [Widget 小组件开发](#8-widget-小组件开发)
9. [动态注册 Widget](#9-动态注册-widget)
10. [可用的全局能力](#10-可用的全局能力)
11. [代码风格约定](#11-代码风格约定)
12. [构建与调试](#12-构建与调试)
13. [完整示例](#13-完整示例)
14. [常见问题](#14-常见问题)

---

## 1. 概述

ClassIntra 是基于 Vue 2.7（前端）+ Node.js/Express（后端）的教育桌面系统。插件系统允许开发者以最小代价扩展功能：

- **应用插件**：在桌面添加一个图标，点击进入一个完整页面（如「笔记」「倒数日」）
- **Widget 插件**：在桌面网格中添加一个即时信息卡片（如「今日课表」「最近倒数日」）
- **后端服务**：插件可自带 Express 路由，自动挂载到 `/api/<插件名>`

聚合器在应用启动时扫描 `apps/*/manifest.json`，自动完成：路由注册、桌面图标注册、Widget 注册、Vuex 模块注册（如声明）。**无需修改核心代码**即可新增插件。

---

## 2. 插件类型

| 类型 | 说明 | 入口 | 示例 |
|------|------|------|------|
| 应用（app） | 完整页面，桌面有图标，点击进入 | `frontend.component` | notes、countdown、community |
| Widget | 桌面卡片，无需独立页面 | `frontend.widgets[].component` | CountdownWidget、TimetableTodayWidget |
| 纯后端 | 仅提供 API，无前端界面 | `backend.entry` | （无 UI 的服务型插件） |
| 系统（system） | 不在桌面显示，通过其它入口访问 | `category: "system"` | admin、settings |

一个插件可**同时**是应用 + Widget（如 countdown 既有页面又有桌面卡片）。

---

## 3. 快速开始

以创建一个最小应用 `hello` 为例：

```
apps/hello/
├── manifest.json
├── frontend/
│   └── Hello.vue
└── backend/
    └── routes.js
```

**manifest.json**：
```json
{
  "name": "hello",
  "label": "你好",
  "icon": "/resources/public/icons/Hello.png",
  "color": "#34C759",
  "category": "desktop",
  "order": 50,
  "frontend": {
    "route": "/hello",
    "routeName": "Hello",
    "component": "./frontend/Hello.vue"
  },
  "backend": {
    "mountPath": "/api/hello",
    "entry": "./backend/routes.js"
  }
}
```

**frontend/Hello.vue**：
```vue
<template>
  <div class="hello-page">
    <h1>{{ message }}</h1>
    <button @click="callApi">调用后端</button>
  </div>
</template>

<script>
import api from '@/utils/api';

export default {
  name: 'Hello',
  data: function() {
    return { message: '你好，ClassIntra！' };
  },
  methods: {
    callApi: function() {
      var self = this;
      api.get('/hello/data').then(function(res) {
        self.message = res.data.message;
      });
    }
  }
};
</script>

<style scoped>
.hello-page { padding: 20px; }
</style>
```

**backend/routes.js**：
```js
var express = require('express');
var router = express.Router();

router.get('/data', function(req, res) {
  res.json({ message: '来自后端的问候' });
});

module.exports = router;
```

构建后，桌面会自动出现「你好」图标，点击进入页面，按钮调用 `/api/hello/data`。

---

## 4. 目录结构

### 4.1 推荐目录结构

```
apps/<plugin-name>/
├── manifest.json              # 清单（必需）
├── frontend/                  # 前端源码
│   ├── <Page>.vue             # 主页面组件
│   ├── widgets/               # Widget 组件（可选）
│   │   └── <Widget>.vue
│   └── components/            # 页面内子组件（可选）
├── backend/                   # 后端源码（可选）
│   ├── routes.js              # 主路由
│   └── <service>.js           # 业务模块
└── README.md                  # 插件说明（可选）
```

### 4.2 命名规范

| 对象 | 规范 | 示例 |
|------|------|------|
| 插件目录名 | kebab-case | `cloud-drive`、`ai-chat` |
| `manifest.name` | kebab-case，全局唯一 | `cloud-drive` |
| Vue 组件文件 | PascalCase.vue | `CloudDrive.vue` |
| Vue 组件 `name` | PascalCase | `CloudDrive` |
| JS 文件 | kebab-case.js | `timetable-helpers.js` |
| 路由路径 | `/kebab-case` | `/cloud-drive` |
| API 挂载路径 | `/api/kebab-case` | `/api/cloud-drive` |

---

## 5. Manifest 清单

`manifest.json` 是插件的唯一契约。完整字段定义见 [manifest-schema.md](./manifest-schema.md)，这里列出常用字段：

```json
{
  "name": "myplugin",           // 必填，全局唯一标识
  "label": "我的插件",           // 必填，显示名称
  "icon": "/resources/.../X.png",// 桌面图标路径
  "color": "#007AFF",           // 主题色（图标背景/强调色）
  "category": "desktop",        // desktop|system|hidden
  "order": 50,                  // 排序权重（越小越靠前，默认 99）
  "defaultEnabled": true,       // 默认是否启用
  "canDisable": true,           // 是否允许用户禁用
  "type": "app",                // app|system|widget
  "version": "1.0.0",           // 语义化版本
  "frontend": {
    "route": "/myplugin",
    "routeName": "MyPlugin",
    "component": "./frontend/MyPlugin.vue",
    "extraRoutes": [            // 额外路由（可选）
      { "path": "/myplugin/sub", "component": "./frontend/Sub.vue" }
    ],
    "widgets": [                // 桌面小组件（可选，见第 8 节）
      {
        "id": "myplugin-summary",
        "name": "摘要",
        "component": "./frontend/widgets/SummaryWidget.vue",
        "defaultSize": { "w": 2, "h": 1 },
        "minSize": { "w": 1, "h": 1 },
        "maxSize": { "w": 4, "h": 2 },
        "configSchema": { "fields": [] }
      }
    ]
  },
  "backend": {                  // 可选
    "mountPath": "/api/myplugin",
    "entry": "./backend/routes.js"
  },
  "extraBackends": [            // 额外后端路由（可选）
    { "mountPath": "/api/myplugin-extra", "entry": "./backend/extra.js" }
  ]
}
```

### 验证规则

聚合器加载时会调用 `validateManifest`：
- **errors（阻断）**：`name`/`label` 缺失或非字符串
- **warnings（不阻断）**：`name` 不符合 kebab-case、`version` 不符合 semver 等

验证失败的插件不会挂载，会在控制台输出错误。

---

## 6. 前端应用开发

### 6.1 组件基本结构

ClassIntra 使用 **Vue 2.7 + Options API**，代码风格遵循 [CLAUDE.md](../CLAUDE.md)：

```vue
<template>
  <div class="my-plugin">
    <!-- 模板内容 -->
  </div>
</template>

<script>
import api from '@/utils/api';

// 模块级常量/工具函数放在 export default 之前
var DEFAULT_PAGE_SIZE = 20;

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('zh-CN');
}

export default {
  name: 'MyPlugin',
  data: function() {
    return {
      list: [],
      loading: false
    };
  },
  computed: {
    isEmpty: function() { return this.list.length === 0; }
  },
  mounted: function() {
    this.loadData();
  },
  methods: {
    loadData: function() {
      var self = this;
      self.loading = true;
      api.get('/myplugin/list').then(function(res) {
        self.list = res.data || [];
      }).finally(function() {
        self.loading = false;
      });
    }
  }
};
</script>

<style scoped>
.my-plugin { padding: 16px; }
</style>
```

### 6.2 可用的全局导入

插件前端可使用 `@/` 别名访问 client 核心能力：

```js
import api from '@/utils/api';              // HTTP 请求封装（自动带 JWT）
import LatexRenderer from '@/utils/latex-renderer'; // LaTeX 渲染
import { getWidget, listWidgets, registerWidget } from '@/core/widget-aggregator'; // Widget 注册表
```

### 6.3 访问 Vuex Store

插件可读取全局 store（如当前用户、主题）：

```js
computed: {
  currentUser: function() {
    return this.$store.state.auth.user;
  },
  isDark: function() {
    return this.$store.state.settings.currentTheme === 'dark';
  }
}
```

### 6.4 路由

聚合器会自动把 `frontend.route` 注册到 vue-router。`extraRoutes` 用于注册子页面。所有路由默认需要登录且受应用管控，可通过 `requiresAuth: false` / `appControl: false` 覆盖。

---

## 7. 后端路由开发

### 7.1 基本结构

`backend/routes.js` 导出一个 Express Router：

```js
var express = require('express');
var router = express.Router();

// 中间件：所有路由默认已通过 JWT 认证（由全局中间件处理）
// req.user 包含 { user_id, is_admin, role, ... }

router.get('/list', function(req, res) {
  res.json({ data: [], user: req.user.user_id });
});

router.post('/create', function(req, res) {
  var name = req.body.name;
  // 业务逻辑...
  res.json({ success: true });
});

module.exports = router;
```

挂载后，前端通过 `api.get('/myplugin/list')` 访问（`api` 工具会自动加 `/api` 前缀）。

### 7.2 数据库访问

使用全局 db 工具（WAL 模式 SQLite，连接池）：

```js
var db = require('../../server/src/utils/db');

router.get('/items', function(req, res) {
  db.all('SELECT * FROM myplugin_items WHERE user_id = ?', [req.user.user_id], function(err, rows) {
    if (err) return res.status(500).json({ error: '数据库错误' });
    res.json({ data: rows });
  });
});
```

> ⚠️ **数据库结构变更需用户确认**。新增表请通过 `server/src/utils/init-db.js` 的迁移机制，不要直接在插件里 `CREATE TABLE`。

### 7.3 认证与权限

- 所有 `/api/*` 路由默认要求 JWT 认证（全局中间件）
- `req.user` 包含 `user_id`、`is_admin`、`role`（'officer' 为班干）、`officer_permissions`
- 需要管理员权限的接口自行校验：
```js
function requireAdmin(req, res, next) {
  if (req.user.is_admin !== 1) return res.status(403).json({ error: '需要管理员权限' });
  next();
}
router.post('/admin-action', requireAdmin, function(req, res) { ... });
```

---

## 8. Widget 小组件开发

Widget 是桌面网格中的卡片，展示即时信息（如「今日课表」「最近倒数日」）。

### 8.1 静态注册（推荐）

在 `manifest.json` 的 `frontend.widgets` 数组中声明：

```json
"widgets": [
  {
    "id": "myplugin-summary",
    "name": "摘要",
    "component": "./frontend/widgets/SummaryWidget.vue",
    "defaultSize": { "w": 2, "h": 1 },
    "minSize": { "w": 1, "h": 1 },
    "maxSize": { "w": 4, "h": 2 },
    "description": "显示我的摘要",
    "configSchema": {
      "fields": [
        {
          "key": "count",
          "label": "显示数量",
          "type": "number",
          "default": 5
        },
        {
          "key": "style",
          "label": "样式",
          "type": "select",
          "options": [
            { "value": "compact", "label": "紧凑" },
            { "value": "full", "label": "完整" }
          ],
          "default": "compact"
        },
        {
          "key": "showIcon",
          "label": "显示图标",
          "type": "bool",
          "default": true
        }
      ]
    }
  }
]
```

### 8.2 Widget 组件约定

Widget 组件**必须**接收以下 props：

| Prop | 类型 | 说明 |
|------|------|------|
| `config` | Object | 用户配置（来自 configSchema 的字段值） |
| `refreshKey` | Number | 刷新键，变化时触发数据重新加载 |

示例：

```vue
<template>
  <div class="summary-widget" @click="goToApp">
    <div v-if="loading" class="sw-loading">加载中...</div>
    <div v-else class="sw-content">
      <span class="sw-icon">{{ icon }}</span>
      <span class="sw-text">{{ text }}</span>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

export default {
  name: 'SummaryWidget',
  props: {
    config: {
      type: Object,
      default: function() { return {}; }
    },
    refreshKey: {
      type: Number,
      default: 0
    }
  },
  data: function() {
    return { loading: true, text: '', icon: '📊' };
  },
  computed: {
    // 读取用户配置，提供默认值
    count: function() {
      return this.config.count || 5;
    }
  },
  watch: {
    // 监听 refreshKey，桌面"刷新"按钮触发时重新加载
    refreshKey: function() {
      this.loadData();
    }
  },
  mounted: function() {
    this.loadData();
  },
  methods: {
    loadData: function() {
      var self = this;
      self.loading = true;
      api.get('/myplugin/summary', { params: { count: self.count } })
        .then(function(res) {
          self.text = res.data.text;
        })
        .finally(function() {
          self.loading = false;
        });
    },
    goToApp: function() {
      // 点击 widget 跳转到主应用页面
      this.$router.push('/myplugin');
    }
  }
};
</script>

<style scoped>
.summary-widget {
  height: 100%;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
}
</style>
```

### 8.3 尺寸约定

桌面网格为 6 列 × 4 行，`defaultSize`/`minSize`/`maxSize` 以网格单元为单位：

| 字段 | 范围 | 建议 |
|------|------|------|
| `w`（宽） | 1–4 | 信息卡 2，宽卡 3–4 |
| `h`（高） | 1–2 | 单行 1，双行 2 |

用户可在桌面编辑态通过 ± 按钮调整尺寸（受 minSize/maxSize 约束）。

### 8.4 configSchema 字段类型

| type | 渲染为 | 适用 |
|------|--------|------|
| `select` | 下拉选择 | 枚举值 |
| `text` | 文本输入 | 字符串 |
| `number` | 数字输入 | 数值 |
| `bool` | iOS 风格开关 | 布尔 |

用户在桌面编辑态点击 widget 的⚙️按钮弹出配置弹窗，保存后通过 `updateWidgetConfig` action 持久化，并触发组件 `config` 更新。

### 8.5 Widget 行为约定

- **点击行为**：建议点击 widget 跳转到主应用页面（`this.$router.push('/myplugin')`）
- **刷新响应**：必须 `watch` `refreshKey` 并重新加载数据
- **加载状态**：显示 loading/empty/error 三态
- **无后端依赖**：纯前端 widget（如时钟）可不调用 API
- **不可缓存**：遵循项目约束，不使用任何缓存机制

---

## 9. 动态注册 Widget

对于运行时才决定是否注册的 widget（如根据权限/配置），可使用 `registerWidget` API：

```js
import { registerWidget } from '@/core/widget-aggregator';
import MyDynamicWidget from './widgets/MyDynamicWidget.vue';

// manifest: { id, name, component, defaultSize?, minSize?, maxSize?, description?, configSchema? }
registerWidget({
  id: 'myplugin-dynamic',
  name: '动态摘要',
  component: MyDynamicWidget,   // 直接传组件对象（异步组件也可）
  defaultSize: { w: 2, h: 1 },
  minSize: { w: 1, h: 1 },
  maxSize: { w: 4, h: 2 },
  description: '运行时注册的 widget',
  configSchema: null
});
```

**注意事项**：
- `id` 必须全局唯一，重复注册会覆盖并 `console.warn`
- `component` 必须提供，否则注册失败
- 动态注册的 widget 立即可在桌面"添加小组件"列表中出现
- 缺省值：`defaultSize {w:2,h:2}`、`minSize {w:1,h:1}`、`maxSize {w:4,h:4}`、`configSchema null`

---

## 10. 可用的全局能力

### 10.1 工具函数

| 模块 | 路径 | 用途 |
|------|------|------|
| `api` | `@/utils/api` | HTTP 请求封装（自动带 JWT、错误处理） |
| `LatexRenderer` | `@/utils/latex-renderer` | LaTeX/Markdown 渲染 |
| `helpers` | `@/utils/helpers` | 通用工具函数 |

### 10.2 Vuex Store 模块

| 模块 | 用途 |
|------|------|
| `auth` | 当前用户、登录态（`this.$store.state.auth.user`） |
| `settings` | 主题、字体等设置 |
| `desktop` | 桌面布局、widget 数据 |
| `toast` | 全局提示（`this.$store.commit('toast/SHOW_TOAST', { message, type })`） |

### 10.3 全局提示

```js
this.$store.commit('toast/SHOW_TOAST', { message: '保存成功', type: 'success' });
// type: success | error | warn | info
```

### 10.4 路由跳转

```js
this.$router.push('/myplugin');
this.$router.push('/browser?url=' + encodeURIComponent(url) + '&fullscreen=1&noaddr=1'); // 超能岛浏览器
```

---

## 11. 代码风格约定

遵循 [CLAUDE.md](../CLAUDE.md) 的项目规范：

```js
// ✅ 正确
var list = [];
var name = 'classintra';
function loadData() { ... }

// ❌ 错误（项目禁用 let/const）
const list = [];
let name = 'classintra';

// ✅ 字符串用单引号
var msg = '你好';

// ✅ 缩进 2 空格
if (true) {
  doSomething();
}

// ✅ Vue Options API
export default {
  data: function() { return {}; },
  methods: { ... }
};
```

**b→o 字符损坏防护**：项目历史上有脚本误将 `b` 替换为 `o`（如 `behavior`→`oehavior`）。提交前运行 `git health` 检查，发现损坏用 `git fix-b2o` 修复。

---

## 12. 构建与调试

### 12.1 构建

```bash
# 前端构建（会自动扫描 apps/*/manifest.json）
cd client && npx vite build

# 启动后端（会自动挂载 apps/*/backend/routes.js）
cd server && node src/app.js
```

### 12.2 开发调试

```bash
# 前端开发服务器（热更新）
cd client && npx vite dev
```

### 12.3 验证清单

插件开发完成后，检查：

- [ ] `manifest.json` 通过验证（控制台无 `[manifest-loader]` 错误）
- [ ] 桌面出现图标，点击进入页面正常
- [ ] 后端 API 可访问（`/api/<plugin-name>/...`）
- [ ] Widget（如有）在桌面"添加小组件"列表中出现
- [ ] Widget 配置弹窗能保存配置并生效
- [ ] Widget 刷新按钮触发数据重载
- [ ] `git health` 无 b→o 损坏
- [ ] 构建成功（`npx vite build`）

---

## 13. 完整示例

参考现有插件源码：

| 插件 | 路径 | 特性 |
|------|------|------|
| 倒数日 | `apps/countdown/` | 应用 + Widget，含 configSchema |
| 课程表 | `apps/timetable/` | 应用 + Widget，含周视图调课 |
| 笔记 | `apps/notes/` | 应用，含 LaTeX/Markdown/Mermaid |
| 社区 | `apps/community/` | 应用，含富文本、权限控制 |
| 聊天 | `apps/chat/` | 应用，含 WebSocket |

### 13.1 最小 Widget 示例（无后端）

```
apps/clock/
├── manifest.json
└── frontend/
    └── widgets/
        └── ClockWidget.vue
```

**manifest.json**（纯 widget，无 route）：
```json
{
  "name": "clock",
  "label": "时钟",
  "category": "hidden",
  "type": "widget",
  "frontend": {
    "widgets": [
      {
        "id": "clock",
        "name": "时钟",
        "component": "./frontend/widgets/ClockWidget.vue",
        "defaultSize": { "w": 2, "h": 1 },
        "minSize": { "w": 1, "h": 1 },
        "maxSize": { "w": 4, "h": 2 }
      }
    ]
  }
}
```

**ClockWidget.vue**：
```vue
<template>
  <div class="clock-widget">
    <div class="cw-time">{{ time }}</div>
    <div class="cw-date">{{ date }}</div>
  </div>
</template>

<script>
export default {
  name: 'ClockWidget',
  props: {
    config: { type: Object, default: function() { return {}; } },
    refreshKey: { type: Number, default: 0 }
  },
  data: function() {
    return { time: '', date: '', timer: null };
  },
  mounted: function() {
    this.update();
    this.timer = setInterval(this.update, 1000);
  },
  beforeDestroy: function() {
    if (this.timer) clearInterval(this.timer);
  },
  methods: {
    update: function() {
      var now = new Date();
      this.time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      this.date = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
    }
  }
};
</script>

<style scoped>
.clock-widget { height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 8px 12px; }
.cw-time { font-size: 24px; font-weight: 600; }
.cw-date { font-size: 12px; opacity: 0.7; }
</style>
```

---

## 14. 第三方市场应用

需要独立分发、动态安装和运行时插拔的应用，应使用第三方市场应用协议，而不是直接写入内置 `apps/` 目录。市场应用支持班管统一安装、更新、启用、禁用和卸载。

首个完整示例是市场仓库中的五子棋：

- [ClassIntra/market](https://github.com/ClassIntra/market)
- [市场应用生命周期](./third-party-market.md)
- [五子棋应用目录](https://github.com/ClassIntra/market/tree/main/apps/gomoku)

市场应用前端通过 `window.ClassIntraMarket.define()` 注册 `mount` / `unmount` 生命周期，后端通过 manifest 的 `backend.mountPath` 动态挂载。完整流程、API、实时同步和验收清单见市场应用文档。

## 15. 常见问题

### Q: 插件图标不显示？

检查 `manifest.icon` 路径是否正确，建议放在 `/resources/public/icons/` 下。图标加载不使用缓存，修改后立即生效。

### Q: Widget 添加后不显示数据？

1. 检查组件 `mounted` 是否调用了数据加载
2. 检查 `watch.refreshKey` 是否正确
3. 检查 API 路径（`api.get('/myplugin/...')` 会自动加 `/api` 前缀）
4. 查看浏览器控制台错误

### Q: 后端路由 404？

1. 确认 `manifest.backend.mountPath` 和 `entry` 正确
2. 确认 `backend/routes.js` 导出的是 `express.Router()`
3. 重启后端服务（后端无热更新）

### Q: 如何让插件受应用管控（可禁用）？

默认所有 `category: "desktop"` 的插件都受管控。设置 `"canDisable": false` 可保护关键插件不被禁用（如管控中心）。在 Admin 应用中可控制每个用户的启用状态。

### Q: 如何与其他插件联动？

1. **读取其它插件数据**：通过后端 API（需对方插件提供）
2. **前端跳转**：`this.$router.push('/other-plugin')`
3. **事件通信**：使用 Vuex 或全局事件总线
4. **联动事件保护**：联动事件不可在本应用编辑，需提示去源应用编辑

### Q: 插件可以修改数据库结构吗？

**不可以**。数据库结构变更需用户明确确认，通过 `server/src/utils/init-db.js` 的迁移机制统一管理。插件应使用自己的表，通过迁移文件创建。

### Q: 如何发布插件？

插件以目录形式存在于 `apps/` 下，随项目一起构建发布。目前不支持运行时动态加载第三方插件包，所有插件需在构建前放入 `apps/` 目录。

---

## 相关文档

- [Manifest 规范](./manifest-schema.md) — 完整字段定义与验证规则
- [应用架构](./architecture.md) — 系统整体架构
- [API 参考](./api-reference.md) — 核心 API 文档
- [集成开发指南](./integration-guide.md) — 与外部系统双向集成
- [CLAUDE.md](../CLAUDE.md) — 项目协作规则与代码风格
