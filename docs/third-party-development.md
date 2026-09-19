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
node scripts/diag.js compat [name]  # Chrome 80 兼容性 lint（apps + market-apps）
node scripts/diag.js all            # 全部

# 构建与运行
node scripts/build-app.js <name>     # 前端开发循环工具（lint + apps/ vite 构建 / market-apps/ 直出检查）
node scripts/build-app.js <name> --watch   # market-apps/ 专用：文件变化自动 lint + 提示刷新
cd client && npx vite dev            # 开发期 HMR 热更新（免构建，推荐）
cd server && node src/app.js         # 启动服务器

# 图标去留白（满铺规范体检）
.\scripts\icon-trim.ps1              # 处理 Resources/public/icons（PNG + 内嵌 SVG 位图）

# 后端热重载（可选，开发机用）：改 apps/*/backend 或 plugins/*/backend 代码免重启
cd server && $env:CLASSINTRA_HOT_RELOAD='1'; node src/app.js
# 注意：只热重载各模块 backend/ 目录内的文件；改宿主层（server/src/*）或
# 前端仍需重启/构建；模块内存状态（缓存等）随重载重置
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

1. `node scripts/scaffold.js app my-app --label "我的应用"`（自动附满铺图标模板 icon.svg）
2. 写业务 → `node scripts/diag.js app my-app` 校验（`compat my-app` 查 Chrome 80 兼容性）
3. `node scripts/build-app.js my-app`（lint + vite 全量构建；开发期用 `cd client && npx vite dev` HMR 免构建）
4. 有后端改动需重启服务器（9001）
5. git 提交进主仓

---

## 一.5、前端开发循环与构建机制

两类应用的「改动生效」路径完全不同，选错工具会白白等待：

| 来源 | 生效机制 | 改一行的正确姿势 |
|------|---------|----------------|
| `apps/<name>/frontend/` | vite 全量打包进 `client/dist`（manifest 构建时扫描） | 开发期 `cd client && npx vite dev`（HMR 秒级热更新）；发版前 `node scripts/build-app.js <name>` 走完整构建 |
| `market-apps/<name>/frontend/` | 服务器 `/market-static/<name>/` 直出（no-cache 响应头） | **无需任何构建**，保存后刷新浏览器即生效；`node scripts/build-app.js <name> --watch` 可自动 lint 并提示 |

`build-app.js` 统一封装了两类流程（自动识别应用类型）：

- 先跑 `diag.js compat <name>` 兼容性 lint，FAIL 即终止（避免把带伤产物构建出去）
- `apps/` 模式：执行 vite 全量构建（vite 单页架构决定无法单应用构建，vendor chunk 共享）
- `market-apps/` 模式：检查 entry/style/icon 文件存在性 + 输出直出说明；`--watch` 监听文件变化（防抖 300ms）自动重跑 lint，backend 变更单独提示需重启服务器

market-app 前端的 SDK context 完整类型见 `plugins/_sdk/sdk.d.ts`（五大命名空间 `ui/data/system/app/compat`，TS 项目可直接引用获得补全）。

---

## 一.6、Chrome 80 兼容性 lint

第三方前端代码是兼容基线的第一现场：`apps/` 经 vite 构建（esbuild target chrome80 + flex-gap polyfill）可救语法，`market-apps/` 原生直出浏览器什么都没有。`node scripts/diag.js compat [name]` 按此分级扫描 `apps/*/frontend` 与 `market-apps/*/frontend` 的 `.js/.vue/.css`（块注释与 `//` 行自动跳过，防文档误报）：

| 级别 | 规则 | 说明 |
|------|------|------|
| FAIL（直出型专属） | `?.` `??` `&&=` `\|\|=` `??=` | 语法类，esbuild 能转译但 market-apps 无转译，Chrome 80 必挂 |
| FAIL（一律） | `replaceChildren` `.at()` `.findLast` `structuredClone` | 运行时 API，构建也不可转译 |
| FAIL（一律） | CSS `aspect-ratio` `inset` `dvh/svh/lvh` `:is()` `:where()` | 无 polyfill 的 CSS 新特性 |
| FAIL（直出型）/ WARN（构建型） | CSS `gap` | 直出无 polyfill；构建型 flex gap 有 polyfill（grid 需 `grid-gap`） |
| WARN | `backdrop-filter` 缺 `-webkit-` 前缀 | Safari 不渲染 |

`diag.js all` 会自动附带 compat 扫描；`build-app.js` 构建前也会先跑。输出为 `文件:行号 + 违规内容`，FAIL 影响退出码（pre-commit 钩子同标准）。

---

## 一.7、图标规范（满铺）

**硬性规范：图标资产不留白**——内容顶格铺满 100% 画布，圆角由 AppIcon 容器 CSS 统一裁切（72px + radius 20px + object-fit cover），**绝不在资产里烘焙圆角或透明边距**。

- 脚手架生成的 `icon.svg` 已是满铺模板（512 viewBox **直角满铺底** + 渐变 + 首字母，根 rect 无 rx/ry，圆角全部交给容器 CSS），替换图形时保持顶格、根 rect 保持直角
- manifest 的 `icon: './icon.svg'` 相对路径由 app-registry 自动重写为 `/apps-static/<name>/...`（market-apps 为 `/market-static/<name>/...`）
- 存量位图去留白：`.\scripts\icon-trim.ps1`（检测 alpha 包围盒 → 裁剪 → 高质量重采样回满画布；支持 PNG 与内嵌 base64 位图的 SVG；`-Dir` 可指定其他目录）
- 提交前注意 pre-commit 的 500KB 单文件上限：大位图内嵌前先降采样（如 768/512px HighQualityBicubic 重编码）

---

## 二、桌面小组件开发

小组件归属应用（`apps/<app>/frontend/widgets/`），随应用启停，渲染在桌面网格上。

### 生成

```bash
node scripts/scaffold.js widget my-app my-clock --name "时钟"
```

生成组件文件后，脚手架会**自动把小组件声明合并进应用 manifest 的 `frontend.widgets[]`**（小组件由 manifest 声明驱动，纯组件文件不生效）——无需手动编辑 manifest。

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
