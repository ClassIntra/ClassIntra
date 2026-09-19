# ClassIntra 第三方开发指南

面向第三方开发者：如何在 ClassIntra 上开发**应用**、**桌面小组件**与**主题**。
三类模块共用一套脚手架（`scripts/scaffold.js`）与校验器（`scripts/diag.js`），开发体验完全一致。

## 工具速查

```bash
# 脚手架（30 秒生成骨架）
node scripts/scaffold.js app <name> --label "显示名" [--route /路径]
node scripts/scaffold.js theme <id> --name "主题名" [--type light|dark]
node scripts/scaffold.js widget <app-name> <widget-id> --name "小组件名"

# 校验（与运行时同一套 schema 校验器）
node scripts/diag.js app [name]     # manifest 规范 + 文件完整性 + 路由冲突
node scripts/diag.js plugin [name]  # 插件校验（backend 必有 + 挂载点跨类冲突）
node scripts/diag.js theme [id]     # 主题契约 + tokens 冒烟
node scripts/diag.js all            # 全部

# 构建与运行
cd client && node node_modules/vite/bin/vite.js build   # 前端构建（新模块构建后生效）
cd server && node src/app.js                            # 启动服务器
```

插件（backend-only 扩展）的开发见 `plugins/README.md`；应用/主题/小组件均属**主仓**，直接提交。

---

## 一、应用开发

应用 = 前端页面（+ 可选后端 + 可选桌面小组件），位于 `apps/<app-name>/`。

### 目录结构

```
apps/my-app/
├── manifest.json         # 应用声明（schema 见下）
├── frontend/
│   ├── MyApp.vue         # 主页面（Vue 2 组件）
│   └── widgets/          # 桌面小组件（可选，见下节）
├── backend/routes.js     # 后端路由（可选，Express）
└── README.md
```

### manifest.json 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | kebab-case 唯一标识，须与目录名一致 |
| `label` | 是 | 显示名称（桌面上展示） |
| `type` | 否 | 固定 `app`（缺省即可） |
| `version` | 否 | 语义化版本 x.y.z |
| `icon` / `color` | 建议 | 桌面图标路径 / 主题色（hex），缺失有 warning |
| `category` | 否 | `desktop`（桌面）/ `system` / `hidden` |
| `order` | 否 | 桌面排序权重，越小越靠前（默认 99） |
| `frontend.route` | 是 | 页面路由，如 `/my-app` |
| `frontend.component` | 是 | 主页面组件路径 `./frontend/MyApp.vue` |
| `frontend.widgets[]` | 否 | 桌面小组件声明（见下节） |
| `backend.mountPath` / `backend.entry` | 否 | 后端挂载 `/api/my-app` + `./backend/routes.js`（支持 `rateLimit`） |
| `visibleRoles` | 否 | 可见角色白名单：`admin` / `officer` / `student`（空 = 全员可见） |
| `layout` | 否 | 挂载形态：`mode: fullscreen/sheet/window` + `resizable/minWidth/minHeight` |
| `capabilities` | 否 | 能力披露清单（安装前告知用户，非拦截），如 `data.storage` / `system.clipboard` |

完整 schema 见 `shared/src/manifest-schema.js`（前端）与 `server/src/core/manifest-schema.js`（后端，两者同步维护）。

### 前端约定

- **Vue 2 Options API**；`var` 声明、单引号、2 空格缩进
- 视觉走全局 CSS 变量（`var(--primary)` 等，定义于 `client/src/styles/global.scss`），自带 fallback 值可保证主题兼容
- 兼容基线 **Chrome 80**：不用 optional chaining / gap / aspect-ratio 等新特性
- 触屏设备（`hover: none`）用按压态反馈代替 hover

### 后端约定（可选）

- `backend/routes.js` 导出 Express Router，挂载到 `backend.mountPath`
- 鉴权：`server/src/middleware/auth` 的 `requireAuth`（登录）与 `requireAdmin`（管理员）
- manifest 声明 `rateLimit: { max, windowMs, message? }` 可自动挂限流
- 需要媒体中转/出站代理等能力时复用插件 SDK（`plugins/_sdk/`）

### 生命周期

1. `node scripts/scaffold.js app my-app --label "我的应用"`
2. 写业务 → `node scripts/diag.js app my-app` 校验
3. `cd client && node node_modules/vite/bin/vite.js build`（前端产物构建后生效）
4. 有后端改动需重启服务器（9001）
5. git 提交进主仓

---

## 二、桌面小组件开发

小组件归属应用（`apps/<app>/frontend/widgets/`），随应用启停，渲染在桌面网格上。

### 生成

```bash
node scripts/scaffold.js widget my-app my-clock --name "时钟"
```

生成组件文件后，**必须把命令行打印的 JSON 片段合并进应用 manifest 的 `frontend.widgets[]`**（小组件由 manifest 声明驱动，纯组件文件不生效）。

### manifest 声明结构

```json
{
  "id": "my-clock",
  "name": "时钟",
  "component": "./frontend/widgets/MyClockWidget.vue",
  "defaultSize": { "w": 2, "h": 1 },
  "minSize": { "w": 1, "h": 1 },
  "maxSize": { "w": 4, "h": 2 },
  "description": "显示当前时间",
  "configSchema": {
    "fields": [
      { "key": "format", "label": "格式", "type": "select",
        "options": [ { "value": "24h", "label": "24 小时" }, { "value": "12h", "label": "12 小时" } ],
        "default": "24h" }
    ]
  }
}
```

- 网格以 `w/h` 为单位，桌面按 `defaultSize` 放置，用户可在 `minSize`–`maxSize` 间调整
- `configSchema.fields` 支持的 `type` 参考 `apps/countdown/manifest.json`（select 等）；桌面据此渲染配置表单，配置值以 `config` prop 传入组件
- 组件约定：高度自适应容器（`height: 100%`）、点击 `$emit('open-app', '<app-name>')` 可跳转应用

### 校验

小组件随应用校验：`node scripts/diag.js app my-app` 会检查 widgets[].component 文件存在性。

---

## 三、主题开发

主题是独立视觉层，位于 `themes/<theme-id>/`，与系统主题机制深度集成（token 级切换）。

### 目录结构

```
themes/my-theme/
├── manifest.json   # { id, name, type, version, description, tokens, icons }
└── tokens.js       # 导出 TOKENS 对象
```

### 硬性契约（theme-loader 强约束）

- `type` 必须为 `light` 或 `dark`（二选一，决定亮/暗基线）
- `tokens.js` 必须导出 `TOKENS` 对象（`module.exports = { TOKENS }`）
- `manifest.id` 与目录名一致

### tokens 结构

```js
var TOKENS = {
  color: {
    primary: '#0A84FF',        // 品牌色（含 primaryHover/Pressed/Rgb）
    primaryRgb: '10, 132, 255', // rgba 场景用
    accent: { music: '#FF2D55', ... },  // 应用强调色
    semantic: { success: '#34C759', ... } // 语义色
  },
  shape: { radius: { sm, md, lg } },
  shadow: { card: '...' },
  motion: { duration: { fast, normal } }
};
```

完整 token 集对照 `themes/dark/tokens.js`（值与 `global.scss` 的 `[data-theme=dark]` 保持同步）。**只覆盖想定制的项**，未覆盖项回退全局默认。

### 开发流程

1. `node scripts/scaffold.js theme my-theme --name "我的主题" --type dark`
2. 对照 `themes/dark/tokens.js` 补全 token
3. `node scripts/diag.js theme my-theme` 校验
4. 前端构建后主题列表自动出现（theme-loader eager 扫描 `themes/*/manifest.json`）

---

## 附：常见问题

| 现象 | 原因与解决 |
|------|-----------|
| 应用不出现在桌面 | manifest 校验未过（跑 diag.js）；或前端未重新构建 |
| 小组件不显示 | 只创建了组件文件、未把 JSON 片段合并进 `frontend.widgets[]` |
| 主题不在列表 | `type` 不是 light/dark；tokens.js 未导出 TOKENS；未构建前端 |
| route 冲突 | 两个应用声明了同一 `frontend.route`（diag.js 会标红） |
| 字段被静默丢弃 | 若走 market-apps/ 分发，需同步改 `_validateMarketManifest()`（见 schema 头部警示） |
