# ClassIntra 生态一体化设计

> 状态：**设计稿（待评审）** · 2026-09-10
> 目标：系统一体化、体验不割裂；第三方可自主开发；生态完整丰富；iOS 风格贯穿
> 目标设备：Android 9.0 横屏平板，兼容腾讯 X5 Chromium 89 与非 X5 Chromium 80
> 产品边界：ClassIntra = 专注班级内网系统（通用 WebOS 由并行项目 Ditto 承担，见 §0.1、§12）

---

## 0. 决策基线（已与项目负责人确认）

| 项 | 决策 |
|---|---|
| 第三方接入方式 | **真·同页面运行时装载**（第三方代码运行在主页面，拥有完整 DOM/window/localStorage 权限） |
| 一体化重点 | 视觉令牌、导航状态栏、数据账号、桌面安装 —— **四项均需统一** |
| 权限模型 | **开放**：不设沙箱，信任开发者 |
| 生态分发 | 独立市场仓库 `D:\NetWork\Integration\market`；文档仓库 `ClassIntra_docs` |
| 产品边界 | **ClassIntra = 专注班级内网系统**；通用 WebOS 内核另由并行项目承担（见 §12） |
| 本轮交付 | 架构设计文档（本文） |

### 0.1 产品定位声明

为避免生态设计在「通用平台」与「垂直业务系统」之间摇摆，明确以下边界：

| 项目 | 定位 | 与本文的关系 |
|---|---|---|
| **ClassIntra（CI）** | **专注班级内网系统**。校园内网场景下的班级管理、聊天、社区、资源、天气等业务集合 | 本文的唯一主体 |
| **Ditto** | **通用 WebOS 框架**（通用「浏览器里的操作系统」内核，无校园业务） | **并行独立产品线**，非本系统内核，不参与 ClassIntra 的运行时（见 §12） |
| **captive** | 附属项目，与 CI 生态无依赖关系 | 不在本文范围 |

**关键含义**：ClassIntra 不需要自建一个「通用操作系统内核」。它的模块化目标是**支撑自身业务的按需扩展**，而非承载任意形态的第三方系统。因此本文选择「同页面自由装载」这一轻量开放式模型，而非通用 WebOS 所需的沙盒 + 权限 + 多窗口重模型。

---

## 1. 现状诊断

### 1.1 已具备的基础（可复用，不重做）

| 能力 | 位置 | 成熟度 |
|---|---|---|
| 核心/模块分层 + 删除式自测门禁 | `docs/modular-architecture.md`、`scripts/modularity-verify.js` | 完善 |
| iOS 设计令牌体系 | `client/src/styles/global.scss`（`--ci-*` → 别名的双写机制） | 完善 |
| iOS 组件库 | `client/src/components/ios/`（12 个组件） | 完善 |
| 主题引擎 | `client/src/core/theme-engine.js` | 完善 |
| 八大核心服务 | `service-registry` / `event-bus` / `theme-engine` / `hotkey-manager` / `search-registry` / `persistence-store` | 完善 |
| 市场应用运行时装载 | `client/src/core/market-registry.js` + `MarketRuntime.vue` + `server/src/core/market-service.js` | 可用 |
| 市场 SDK 上下文 | `client/src/main.js` 的 `window.ClassIntraMarket.createContext` | 最小可用 |
| Azure 兼容基线 | `client/vite.config.mjs`：`target: 'chrome80'`、flex-gap polyfill、`-webkit-` 前缀、`@vitejs/plugin-legacy`（targets: Chrome ≥ 89 / Android ≥ 9） | 完善 |
| 实时通道（不依赖 WS） | `client/src/utils/realtime.js`（HTTP 长轮询，适配 X5/TBS） | 完善 |
| 集成系统 | PostMessage Bridge + Webhook（HMAC 签名） | 完善 |

### 1.2 五个结构性问题

**问题 1 — 市场应用完全没有继承 iOS 设计语言（最严重）**

`market-apps/gomoku/frontend/style.css` 仅 39 行，`entry.js` 用内联 HTML 自建 `gomoku-shell` / `gomoku-header` / `gomoku-kicker` 等独立类名体系。结果是：五子棋页面与桌面、聊天、设置看起来像两个产品。

这是「体验割裂」的实证，也是当前**唯一的生态样本**。若放任，第三方生态会自然长出一堆各自为政的视觉风格。

**问题 2 — 官方应用与第三方应用存在两套互不相通的开发模型**

| | 官方 `apps/*` | 第三方 `market-apps/*` |
|---|---|---|
| 前端载体 | `.vue` SFC（23 个） | `entry.js` 原生 DOM |
| 加载方式 | `import.meta.glob` 构建期打包 | `<script>` 运行时注入 |
| 组件复用 | 可用 `ios/` 组件库 + `@/` 别名 | **不可用**（无构建步骤，无别名解析） |
| 主题令牌 | 可用 `--ci-*` | 可用（CSS 变量全局生效）但**无人告知、无文档** |
| 导航栏 | `AppNavBar` 组件 | 需自己写 HTML/CSS |

第三方想「看起来像 ClassIntra」，目前没有工具支撑，只能手抄 CSS。

**问题 3 — manifest 的 `type` 语义混乱**

- `apps/bot-admin/manifest.json`：`"type": "plugin"`，但目录在 `apps/` 下，且带 `frontend.component` 前端页面。
- `docs/modular-architecture.md` 定义：plugin「无前端页面」。
- `docs/development/third-party.md` 定义：`type` 取值为 `app` / `system` / `widget`（**无 plugin**）。
- `shared/src/manifest-schema.js` 支持 `app` / `plugin` / `system` / `widget`。

三处文档 + 一处实作，四种说法。第三方照文档写 `bot-admin` 那样的 manifest 必然踩坑。

**问题 4 — SDK 上下文过于单薄且不稳定**

`createContext()` 当前返回 10 个字段，其中：
- `user: store.state.auth && store.state.auth.user` —— **快照，不响应式**。用户改昵称后第三方拿到的仍是旧值。
- `toast` 只有 `alert`，没有 `success` / `error` / `confirm`。
- `route: router.currentRoute` —— 同样是快照。
- 无 UI 组件（NavBar / List / Card / Switch）。
- 无存储命名空间隔离（第三方直接碰全局 localStorage）。
- 无 `manifest` 自身信息（版本、配置）。
- 无生命周期钩子（`onThemeChange` / `onResize` / `onDestroy`）。

第三方要做「像系统应用」，得自己实现导航栏、列表、开关、弹窗、主题监听。

**问题 5 — 「真·同页面自由」带来的卸载与冲突风险（已接受，但需工程手段兜底）**

第三方直接操作 `window` / `document` / 主 `localStorage`。已识别的具体风险：

| 风险 | 后果 | 兜底手段 |
|---|---|---|
| 全局事件监听器不清理 | 离开应用后仍响应，内存泄漏 | 契约要求 + 运行时审计（见 §5.1） |
| `setInterval` / `setTimeout` 不清理 | 后台持续运行，平板耗电发热 | 挂载时劫持计时器 API，卸载时统一回收 |
| CSS 类名冲突 | 污染其他应用样式 | 强制 `.ci-app-<name>` 前缀 + 构建期检查（见 §5.2） |
| 覆盖 `window` 全局变量 | 破坏核心功能 | 挂载时快照 + 卸载时 diff 还原 |
| 同名应用后端路由冲突 | 路由覆盖 | 已有 `_detectConflicts()`（`market-service.js`） |

::: warning 关于「同页面自由」的工程判断
同页面自由在**信任开发者**的前提下是合理的（本项目的班级场景中，第三方应用由班管审核安装）。但它有一个不可回避的代价：**任何第三方应用的 bug 都可能让整个桌面白屏**。

本设计的应对策略不是加沙箱，而是三件事：
1. **契约层**：把「能做什么」写清楚，提供 `destroy` 契约与工具函数，让正确做法比错误做法更省事；
2. **运行时层**：`ErrorBoundary` 包裹第三方容器，捕获渲染异常，把「整页白屏」降级为「该应用显示错误页 + 返回桌面」；
3. **审查层**：市场安装前做静态扫描（禁用 `document.write`、`window.onerror` 覆盖等），作为审核门槛而非运行时沙箱。

这三点均不限制开发者的自由，只是把自由的边界标出来。
:::

---

## 2. 设计原则

基于上述诊断，确立五条原则。这五条是后续所有技术决策的判据。

### 原则 1：一条令牌，两套载体

视觉统一不靠「要求开发者手抄 CSS」，而靠**令牌自动注入**。

- 构建期应用（官方 `.vue`）：编译进主包，`--ci-*` 天然可用。
- 运行时应用（第三方 `entry.js`）：`MarketRuntime` 挂载时**把当前主题令牌以 inline style 注入容器根节点**，第三方只需写 `var(--ci-color-primary)` 即自动继承主题。

主题切换时，`ThemeEngine.subscribe` 触发令牌重新注入。第三方**零代码**获得深色模式支持。

### 原则 2：SDK 即设计系统

第三方不写导航栏、不写列表、不写开关——SDK 提供**预制 DOM 片段**（非 Vue 组件，规避无构建步骤的限制）。

```javascript
// 第三方只需一行，得到与官方一致的 iOS 导航栏
var nav = context.ui.navbar({ title: '五子棋', back: true });
container.appendChild(nav.root);
```

`context.ui.*` 返回原生 DOM 节点 + `update()` / `destroy()` 方法。内部实现直接复用 `ios/` 组件的样式类，保证像素级一致。

### 原则 3：能力按需，命名空间隔离

开放自由 ≠ 无组织。所有 SDK 写入操作自动加应用名前缀，读取保持透明：

```javascript
context.storage.set('score', 100);   // 实际写入 ci:app:gomoku:score
```

开发者无感知，但卸载时可精确清理该应用全部数据（`context.storage.clearAll()`）。

### 原则 4：契约优于约定

现有文档靠「约定」约束（「模块之间尽量通过契约解耦」）。生态层改为**可执行的契约**：

- `context.destroy()` 注册清理函数，卸载时**必定**调用；
- 运行时劫持 `setInterval` / `setTimeout` / `addEventListener`，卸载时**自动**回收；
- 开发者忘记清理也不会泄漏。

### 原则 5：兼容交给构建，自由交给运行时

关键技术约束：**第三方 `entry.js` 不经过 Vite 构建**，因此不会获得 `@vitejs/plugin-legacy` 与 PostCSS 的 polyfill 处理。

结论：第三方代码必须**自己**满足 Chrome 80 语法约束，且**不能依赖** flex-gap 的 polyfill 自动注入。

因此 SDK 必须做两件事：
1. `docs/development/chrome-80-compat.md` 扩写为**第三方必读**，明确禁用语法清单；
2. SDK 提供的预制 UI 片段（原则 2）已在内部规避了 flex-gap 等坑，第三方不用自己处理。

---

## 3. 目标架构

### 3.1 生态分层

```
┌──────────────────────────────────────────────────────────────────┐
│  桌面壳（Desktop）· 超能岛（SuperIsland）· 锁屏 · 手势             │
│  —— 唯一入口，第三方无法替换                                       │
└──────────────────────────────────────────────────────────────────┘
                              ▲
┌──────────────────────────────────────────────────────────────────┐
│  统一容器层：AppShell                                              │
│  ├─ AppNavBar（导航栏，标题/返回/操作按钮）                        │
│  ├─ 令牌注入器（--ci-* → 容器根节点 inline style）                │
│  ├─ 生命周期管理（挂载/卸载/计时器回收/监听器回收）                 │
│  ├─ ErrorBoundary（异常降级为应用内错误页）                        │
│  └─ 转场动画（iOS 曲线，push/pop）                                 │
└──────────────────────────────────────────────────────────────────┘
                              ▲
┌──────────────────────────────────────────────────────────────────┐
│  SDK 层（window.ClassIntra）                                       │
│  ├─ ui/        预制 DOM：navbar list card switch button sheet …   │
│  ├─ data/      api（自动鉴权）+ realtime + storage（命名空间）      │
│  ├─ system/    user（响应式） theme（订阅） router toast modal      │
│  ├─ app/       manifest 自身信息 · config · log · destroy 契约      │
│  └─ compat/    能力探测（CloudIntra.compat.has('flex-gap')）       │
└──────────────────────────────────────────────────────────────────┘
                              ▲
┌────────────────────────────┬─────────────────────────────────────┐
│  官方应用 apps/*            │  第三方应用 market-apps/*            │
│  Vue 2 SFC · 构建期打包     │  原生 DOM/CSS · 运行时装载           │
│  可直接 import ios/ 组件    │  通过 context.ui.* 获得等价能力       │
└────────────────────────────┴─────────────────────────────────────┘
```

关键设计：**官方与第三方在 AppShell 之下是平等的**。两侧都能拿到导航栏、令牌、数据能力。差异仅在于「官方用 Vue 组件，第三方用 DOM 片段」，而这两者由同一套 CSS 类驱动，视觉结果一致。

### 3.2 数据流：从主题到第三方

这是「体验不割裂」的核心机制，值得逐步说明：

```
用户在设置里切换深色模式
        ↓
ThemeEngine.setTheme('dark')
        ↓
① setAttribute('data-theme', 'dark')     → CSS 选择器层生效
② 写入 --ci-* 到 documentElement          → 全局变量层生效
        ↓
ThemeEngine.subscribe 触发所有订阅者
        ↓
AppShell 的令牌注入器收到通知
        ↓
重新读取 --ci-* 计算值，写入容器根节点
        ↓
第三方应用内的 var(--ci-color-bg-base) 自动更新
        ↓
【第三方零代码，视觉自动跟随】
```

这个机制已具备全部零件（`ThemeEngine.subscribe` + CSS 变量），只需在 `MarketRuntime` 里补上注入动作。

### 3.3 双轨加载器的统一

两种载体的差异是**已核实**的事实（非设计选择）：

| | 官方 `apps/*` | 第三方 `market-apps/*` |
|---|---|---|
| 扫描器 | `import.meta.glob('../../../apps/*/manifest.json', { eager: true })` | `server/src/core/market-service.js` 扫描 + `market-registry.js` 动态 `<script>` |
| manifest 校验 | `shared/src/manifest-schema.js`（`validateManifest`） | `_validateMarketManifest()`（独立校验） |
| 前端载体 | `.vue` SFC，构建期打包（23 个） | `entry.js` 原生 DOM + `style.css` |
| 导航栏 | 15 个应用使用 `AppNavBar` 组件 | **0 个使用**（gomoku 自绘 header） |
| 组件复用 | 可用 `ios/` 组件库 + `@/` 别名 | **不可用**（无构建步骤，无别名解析） |

两套加载器不合并（合并会破坏官方应用的构建期优化），但在**输出层统一**：

| | 官方应用 | 第三方应用 |
|---|---|---|
| 加载器 | `manifest-loader.js`（构建期 eager） | `market-registry.js`（运行时 `<script>`） |
| 渲染 | Vue Router 组件 | `MarketRuntime` → `definition.mount(container, context)` |
| **统一输出** | `AppShell` 包裹 | `AppShell` 包裹 |

`AppShell` 是关键的新增层。官方应用通过路由 meta 声明 `shell: true` 即被包裹；第三方应用由 `MarketRuntime` 无条件包裹。

::: warning 视觉割裂的量化证据
`market-apps/gomoku/frontend/style.css` 仅 **39 行**，而官方应用的样式（含 `<style scoped>`）普遍在数百行量级。gomoku 用内联 HTML 自建 `gomoku-shell` / `gomoku-header` / `gomoku-kicker` / `gomoku-roombar` / `gomoku-layout` 一整套独立类名体系，未引用任何 `--ci-*` 令牌。

这意味着当前唯一的第三方样本**从第一行代码起就脱离了设计系统**。若不提供 SDK 层面的设计系统支持（原则 2），生态扩张会线性放大这种割裂。
:::

---

## 4. SDK 规范

### 4.1 全局入口

```javascript
// 第三方 entry.js 的标准结构
(function() {
  var NAME = 'my-app';

  function mount(container, context) {
    // context 由 ClassIntra 提供
  }

  function unmount(container) {
    // 可选，context.destroy() 覆盖此职责
  }

  window.ClassIntraMarket.define({ name: NAME, mount: mount, unmount: unmount });
})();
```

`define()` 与 `createContext()` 保持现有签名（向后兼容），但在 `context` 上扩展字段。

### 4.2 `context.ui` — 预制 iOS DOM 片段

全部返回 `{ root, update(options), destroy() }`。样式直接引用 `ios/` 组件的类名。

| 工厂 | 对应 iOS 组件 | 说明 |
|---|---|---|
| `ui.navbar({ title, back, actions })` | `IOSNavBar` | 应用导航栏，`back: true` 自动接管返回 |
| `ui.list({ sections })` | `IOSList` / `IOSListItem` | 分组列表，支持右侧详情/箭头/开关 |
| `ui.card({ title, content })` | `IOSCard` | 卡片容器 |
| `ui.button({ label, variant })` | `IOSButton` | `variant`: `primary` / `tinted` / `plain` / `danger` |
| `ui.switch({ checked, onChange })` | `IOSSwitch` | 开关 |
| `ui.segmented({ items, value })` | `IOSSegmented` | 分段控件 |
| `ui.searchbar({ placeholder, onInput })` | `IOSSearchBar` | 搜索框 |
| `ui.sheet({ title, content, actions })` | `IOSSheet` | 底部动作面板 |
| `ui.badge({ text, color })` | `IOSBadge` | 徽标 |
| `ui.chip({ text, removable })` | `IOSChip` | 标签 |
| `ui.spinner()` | — | iOS 风加载指示器 |
| `ui.empty({ icon, title, description })` | — | 空状态（含桌面返回入口） |

**约束**：这些片段内部已处理 Chrome 80 兼容（flex-gap 回退、`-webkit-` 前缀、无箭头函数），第三方只管用。

### 4.3 `context.data` — 数据能力

```javascript
// API 请求：自动带 JWT、自动重试、自动缓存
context.data.api.get('/my-app/items')
context.data.api.post('/my-app/items', { title: 'x' })

// 实时事件：自动选择 WS 或 HTTP 长轮询（适配 X5）
var stop = context.data.realtime.subscribe('my-app.updated', function(payload) {});
context.data.realtime.publish('my-app.updated', { id: 1 });

// 存储：自动加 ci:app:<name>: 前缀
context.data.storage.set('score', 100);
context.data.storage.get('score', 0);
context.data.storage.onChange('score', handler);
context.data.storage.clearAll();   // 卸载时由框架调用
```

**兼容注意**：`context.data.realtime` 是**必须使用**的实时通道。直接使用 `WebSocket` 在腾讯 X5 / TBS / 旧 Android WebView 上不可靠，这是已由 `docs/development/sdk.md` 记录的项目约束。

### 4.4 `context.system` — 系统能力

```javascript
// 用户：响应式（修复现有快照问题）
context.system.user.id
context.system.user.name
context.system.user.role
var stop = context.system.user.onChange(function(user) {});

// 主题
context.system.theme.current          // 'light' | 'dark'
var stop = context.system.theme.subscribe(function(themeId) {});

// 路由
context.system.router.push('/my-app/detail/1');
context.system.router.currentRoute   // 响应式

// 反馈：补齐现有缺失
context.system.toast.success('保存成功');
context.system.toast.error('保存失败');
context.system.modal.confirm({ title, message }).then(function(ok) {});
context.system.modal.alert({ title, message });

// 导航栏控制（当应用未使用 ui.navbar 时）
context.system.navbar.setTitle('新标题');
context.system.navbar.setActions([{ label: '保存', onClick: fn }]);
```

### 4.5 `context.app` — 应用自身

```javascript
context.app.name          // 'my-app'
context.app.version       // '1.2.0'
context.app.manifest      // 完整 manifest 对象
context.app.config        // 用户在桌面小组件里配置的值
context.app.log(msg)      // 带应用名前缀的日志
context.app.onDestroy(fn) // 注册清理函数（核心契约）
```

### 4.6 `context.compat` — 兼容探测

```javascript
context.compat.chrome          // 89（X5）或 80
context.compat.isX5            // 是否腾讯 X5
context.compat.has('flex-gap') // false
context.compat.has('clipboard')// 是否可用 navigator.clipboard
```

用途：第三方在 X5 与非 X5 设备上行为不一致时，可据此降级。`flex-gap` 的探测结果尤其重要——**第三方 CSS 若使用 flex gap，在 Chrome 80 设备上会静默失效**（官方应用有 PostCSS 兜底，第三方没有）。

### 4.7 生命周期契约（强制）

```javascript
function mount(container, context) {
  // 1. 注册清理（框架保证必定调用，即使抛异常）
  context.app.onDestroy(function() {
    clearInterval(myTimer);        // 显式清理
    context.data.realtime.unsubscribe(stop);
  });

  // 2. 使用框架提供的计时器（更省事，无需手动清理）
  var t = context.util.setInterval(fn, 1000);   // 卸载时自动 clear

  // 3. 使用框架提供的事件绑定（同样自动回收）
  context.util.on(window, 'resize', handler);   // 卸载时自动 removeEventListener
}
```

**为什么提供 `context.util.setInterval` 而不只依赖开发者自觉**：`MarketRegistry.unmount()` 当前只调用 `definition.unmount(container)`，无法清理应用内创建的计时器。若应用漏清理，平板会持续耗电。`context.util.*` 让正确做法比错误做法更省事——这是原则 4 的落地。

---

## 5. 工程保障

### 5.1 运行时生命周期审计

在 `market-registry.js` 的 `mount()` / `unmount()` 中增加审计层：

```
mount 时：
  1. 快照 window 自有键（Object.keys(window)）
  2. 劫持 setInterval / setTimeout / requestAnimationFrame，记录返回的 id
  3. 劫持 addEventListener（window / document），记录 (target, type, handler)

unmount 时：
  1. 按记录 clear 所有计时器与 rAF
  2. 按记录 removeEventListener
  3. 调用 context 内注册的全部 onDestroy 回调（try/catch 隔离）
  4. 对 window 键做 diff，还原被覆盖的全局变量（记录警告）
  5. 移除注入的 <script> / <link>
  6. 清理 context.data.storage 的命名空间（可选，默认保留数据）
```

这套审计**不限制开发者自由**，只是在卸载时替开发者兜底，并把「未清理的全局污染」以警告形式暴露出来，便于审核时发现问题应用。

### 5.2 样式隔离策略

因同页面自由，第三方 CSS 会进入全局作用域。采取**约定 + 检查**而非强制隔离：

- **约定**：第三方所有 CSS 类名必须以 `.ci-app-<name>-` 开头；
- **提供**：`MarketRuntime` 在容器上设置 `data-market-app="<name>"`（已存在），第三方可用 `.ci-app-my-app` 或 `[data-market-app="my-app"]` 作为前缀；
- **检查**：市场安装前扫描 CSS，发现无前缀的通用类名（如 `.button`、`.header`、`.card`）给出警告；
- **兜底**：官方组件的类名统一带 `ios-` 前缀，降低碰撞概率。

::: tip 为什么不强制 Shadow DOM
Shadow DOM 会造成三处破坏：① 令牌继承需显式 `adoptedStyleSheets`（Chrome 80 支持有限）；② 第三方拿不到主页面 `window`，与「真·同页面自由」的决策冲突；③ iOS 毛玻璃效果需要穿透背景，Shadow DOM 边界会导致 `backdrop-filter` 采样异常。故不采用。
:::

### 5.3 异常隔离

```
第三方应用 mount 抛异常
        ↓
MarketRuntime 捕获（现有 mounted() 的 try/catch）
        ↓
渲染应用内错误页：[图标] 应用暂时无法打开 / 重试 / 返回桌面
        ↓
桌面与其他应用不受影响
```

`MarketRuntime.vue` 已实现此逻辑。需补充的是：**运行时**（非挂载期）抛出的异常。通过 `context.util.on(window, 'error', ...)` 与 `unhandledrejection` 监听，把第三方异步异常也归因到该应用，避免污染全局错误处理。

---

## 6. Manifest 规范修订

### 6.1 修正 `type` 语义（问题 3）

统一为**按分发来源**而非按能力划分：

| `type` | 位置 | 前端 | 后端 | 说明 |
|---|---|---|---|---|
| `app` | `apps/` | 有 | 可选 | 官方内置应用 |
| `system` | `apps/` | 有 | 可选 | 官方系统应用（不可禁用：settings / admin / market） |
| `plugin` | `plugins/` | **无** | 必有 | 纯后端扩展 |
| `market` | `market-apps/` | 有（entry.js） | 可选 | 第三方运行时应用 |

**待修正项**：`apps/bot-admin/manifest.json` 的 `type` 由 `"plugin"` 改为 `"app"`（它有前端页面且在 `apps/` 下）。`plugins/astrbot-relay` 的 `"plugin"` 正确，保持不变。

**实现注意**：`market-apps/` 不被前端 `manifest-loader` 扫描（其 `import.meta.glob` 只匹配 `../../../apps/*/manifest.json`），也不经过 `shared/src/manifest-schema.js` 校验（该校验器的 `type` 枚举为 `app` / `system` / `widget` / `plugin`，未知值会**降级为 `app` 并产生 warning**）。

因此：
- 若给市场应用引入 `type: "market"`，**无需**修改 `manifest-schema.js` 的枚举（市场 manifest 走 `server/src/core/market-service.js` 的 `_validateMarketManifest()` 单独校验）；
- 但需在 `_validateMarketManifest()` 中显式接受并记录 `sdk` / `capabilities` / `layout` 三个新字段，否则会被静默丢弃。

### 6.2 新增字段

```jsonc
{
  "name": "my-app",
  "type": "market",
  "version": "1.0.0",
  "label": "我的应用",
  "icon": "./icon.svg",
  "color": "#5856D6",
  "category": "desktop",
  "order": 20,

  // 新增：SDK 版本约束（生态演进时用于兼容判断）
  "sdk": ">=1.0.0",

  // 新增：声明的能力（用于安装时审核展示，非运行时限制）
  "capabilities": ["storage", "realtime", "notifications"],

  // 新增：布局声明（AppShell 据此决定是否提供导航栏）
  "layout": {
    "navbar": "provided",     // "provided" | "custom" | "none"
    "title": "我的应用"
  },

  "frontend": {
    "route": "/my-app",
    "entry": "./frontend/entry.js",
    "style": "./frontend/style.css"
  },
  "backend": {
    "mountPath": "/api/my-app",
    "entry": "./backend/routes.js"
  }
}
```

`layout.navbar` 的取值决定 AppShell 行为：
- `"provided"`（推荐）：AppShell 提供标准导航栏，第三方只需填内容区；
- `"custom"`：第三方自绘导航栏（如需沉浸式体验，如画板、视频）；
- `"none"`：无导航栏（如全屏游戏）。

---

## 7. 兼容性设计

### 7.1 双浏览器引擎约束

| 引擎 | 版本 | 处理方式 |
|---|---|---|
| 腾讯 X5 / TBS | Chromium 89 | 主要目标。X5 内核在 WebView 层被替换，`WebSocket` 稳定性差 |
| 非 X5 系统 WebView | Chromium 80 | 兼容下限。CSS 与 JS 均需降级 |

**关键差异与对策**：

| 特性 | Chromium 80 | Chromium 89 (X5) | 对策 |
|---|---|---|---|
| flex `gap` | ❌（84+） | ✅ | SDK 预制片段内部规避；第三方自查（`context.compat.has('flex-gap')`） |
| `backdrop-filter` | 需 `-webkit-` | 需 `-webkit-` | SDK 片段已含前缀 |
| `aspect-ratio` | ❌（88+） | ❌（88+） | 用 padding-top 技巧 |
| `inset` 简写 | ❌（87+） | ✅ | 用 `top/right/bottom/left` |
| `:is()` / `:where()` | ❌（88+） | ✅ | 不用 |
| `?.` / `??` | ❌ | ✅ | 不用（项目约定已禁用） |
| `WebSocket` | 可用但不稳定 | **不可靠** | 统一走 `context.data.realtime`（HTTP 长轮询） |
| `navigator.clipboard` | ❌ | 部分 | 用 `context.util.copy()`（内部回退 `execCommand`） |
| `import` 动态导入 | ✅ | ✅ | 不使用（第三方是 `<script>` 注入，非 ESM） |

### 7.2 第三方代码的兼容红线

因为第三方 `entry.js` **不经过构建工具**，以下语法会直接导致 Chrome 80 设备白屏：

```javascript
// ❌ 全部禁用
const x = 1;                    // 用 var
let y = 2;                      // 用 var
const fn = () => {};            // 用 function
var s = `template ${x}`;        // 用 'a' + x + 'b'
var v = obj?.prop;              // 用 obj && obj.prop
var w = a ?? b;                 // 用 a !== null && a !== undefined ? a : b
class Foo {}                    // 用构造函数 + prototype
obj ||= {};                     // 显式赋值
```

**这是第三方开发最容易踩的坑，必须在文档最显眼位置说明，并提供脚手架自动检查。**

### 7.3 设备适配

目标设备 960×600 横屏 / 2x 像素比。SDK 的预制片段按此优化：
- 最小触摸目标 44×44px（iOS HIG）；
- `@media (max-height: 640px)` 断点已内置于官方样式；
- 字体栈 `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', ...` 已定义，第三方继承即可。

---

## 8. 生态工作流

### 8.1 三仓库职责

```
ClassIntra（主仓库）
  ├─ client/ · server/ · shared/       核心
  ├─ apps/                             官方应用（.vue，构建期）
  ├─ plugins/                          官方插件（纯后端）
  └─ docs/ecosystem-design.md          ← 本文
        ↓ 定义 SDK 契约与 manifest 规范
market（市场仓库）
  ├─ index.json                        应用目录
  └─ apps/<name>/                      第三方应用包
      ├─ manifest.json
      ├─ icon.svg
      ├─ frontend/entry.js             ← 运行时装载
      ├─ frontend/style.css
      └─ backend/routes.js
        ↓ 提供开发文档
ClassIntra_docs（文档仓库）
  ├─ docs/development/third-party.md   第三方开发指南（需重写）
  ├─ docs/development/sdk.md           SDK 参考（需扩写）
  ├─ docs/development/market-apps.md   市场生命周期（已有，较完整）
  └─ docs/development/chrome-80-compat.md  兼容红线（需强化为必读）
```

### 8.2 第三方应用开发流程（目标形态）

```
1. 从 market 仓库 fork 或使用脚手架
   npx create-classintra-app my-app        ← 待实现

2. 编写 manifest.json + entry.js + style.css
   （脚手架生成的模板已符合 Chrome 80 约束与 SDK 契约）

3. 本地接入测试
   班级服务器 → 应用市场 → 添加本地源 → 安装

4. 提交 PR 到 market 仓库
   index.json 登记 + 更新 CHANGELOG

5. 审核（静态扫描 + 人工检查视觉一致性）

6. 发布，全校班级服务器可安装
```

### 8.3 与现有集成系统的关系

已有两套外部接入机制，职责需明确区分，避免重复建设：

| 机制 | 适用场景 | 是否运行在 ClassIntra 页面内 | 权限 |
|---|---|---|---|
| **市场应用**（本文重点） | 想成为桌面上的应用，共享会话与主题 | 是（同页面） | 完整 |
| **PostMessage Bridge** | 已有独立网页，想嵌入或被嵌入 | 是（iframe） | 受限 |
| **Webhook + Integration Token** | 外部系统（如学校官网）单向推送事件 | 否（服务端） | scope 白名单 |

市场应用是「深度集成」，后两者是「浅度集成」。文档需明确三者的选择依据。

---

## 9. 实施路线

按依赖顺序分四期。每期均可独立验证，不阻塞下一期启动。

### 第一期：统一容器（解决「体验割裂」的根因）

| 任务 | 文件 | 验收标准 |
|---|---|---|
| 令牌注入器 | `client/src/components/MarketRuntime.vue` | 切换深色模式，第三方应用视觉跟随 |
| `AppShell` 基础层 | 新增 `client/src/components/AppShell.vue` | 第三方应用获得标准导航栏 |
| 市场应用模板改造 | `market-apps/gomoku/frontend/*` | 五子棋改用令牌 + SDK 导航栏，视觉与官方一致 |
| 生命周期审计 | `client/src/core/market-registry.js` | 卸载后无残留计时器/监听器 |

这一期做完，「体验不割裂」就有可验证的实证（gomoku 对比图）。

### 第二期：SDK 完备

| 任务 | 文件 | 验收标准 |
|---|---|---|
| `context.ui.*` 预制片段 | 新增 `client/src/core/market-sdk-ui.js` | 12 个片段可用，视觉与 `ios/` 组件一致 |
| `context.data.*` 数据能力 | 新增 `client/src/core/market-sdk-data.js` | API 自动鉴权、storage 命名空间隔离 |
| `context.system.*` 系统能力 | 新增 `client/src/core/market-sdk-system.js` | user 改为响应式，补齐 toast/modal |
| `context.app.*` / `context.util.*` | 同上 | `onDestroy` 契约、计时器回收 |
| `context.compat.*` | 同上 | 探测 Chrome 版本、X5、flex-gap |

### 第三期：规范收敛

| 任务 | 文件 | 验收标准 |
|---|---|---|
| 修订 `type` 语义 | `apps/bot-admin/manifest.json` | `plugin` → `app` |
| manifest 新增字段 | `shared/src/manifest-schema.js` | 支持 `sdk` / `capabilities` / `layout` |
| 重写第三方开发文档 | `ClassIntra_docs/docs/development/third-party.md` | 与实作一致，含 Chrome 80 红线 |
| SDK 参考扩写 | `ClassIntra_docs/docs/development/sdk.md` | 覆盖全部新 API |
| 脚手架 | 新增 `packages/create-classintra-app` | 生成合规模板 |
| **启动流程分阶段编排** | 新增 `client/src/core/boot-orchestrator.js`，重构 `client/src/main.js` | 单阶段失败不阻断挂载（见 §12.2 借鉴 1） |
| **应用生命周期状态机** | `client/src/core/market-registry.js` | 显式 `idle → loading → active → suspended`，支持 `suspend`/`resume`（见 §12.2 借鉴 2） |
| **`sdk` 版本校验** | `client/src/core/market-registry.js` + `MarketRuntime.vue` | 版本不满足时进入错误态而非静默失败（见 §12.2 借鉴 6） |

### 第四期：生态工具

| 任务 | 说明 |
|---|---|
| 市场审核脚本 | 静态扫描 CSS 前缀、禁用语法、危险 API |
| 开发者预览模式 | 本地加载未发布应用，免安装调试 |
| 应用性能预算 | 首屏体积、DOM 节点数、内存占用上限 |
| **能力披露展示** | 市场安装页展示 manifest 的 `capabilities` 清单（披露不拦截，见 §12.2 借鉴 3） |
| **单文件导入格式**（低优先级） | 设计 `.cia` 包（ZIP + manifest + 资源，可选 Ed25519 签名），仅用于外部导入场景（见 §12.2 借鉴 4） |

---

## 10. 风险登记

| 编号 | 风险 | 影响 | 缓解措施 | 状态 |
|---|---|---|---|---|
| R1 | 同页面自由导致第三方 bug 拖垮桌面 | 高 | ErrorBoundary + 卸载审计 + 安装审核 | 设计已覆盖 |
| R2 | 第三方不清理计时器，平板耗电 | 中 | `context.util.setInterval` + 卸载自动回收 | 设计已覆盖 |
| R3 | CSS 类名冲突污染官方应用 | 中 | 前缀约定 + 安装前扫描 + `ios-` 前缀隔离 | 设计已覆盖 |
| R4 | 第三方代码未过构建，Chrome 80 语法踩坑 | 高 | 文档红线 + 脚手架模板 + 审核扫描 | 设计已覆盖 |
| R5 | SDK 演进破坏已发布应用 | 中 | `sdk` 版本约束字段 + `context.compat` 探测 | 需在第二期落地 |
| R6 | 官方/第三方两套加载器长期分叉 | 中 | `AppShell` 统一输出层 + 共享 CSS 令牌 | 需在第一期落地 |
| R7 | 腾讯 X5 与 Chrome 80 行为差异未穷尽 | 中 | 已有 `app-architecture-integration-feasibility.md` 与设备报告基础上继续实测 | 进行中 |
| R8 | 应用管控（`app_control`）对第三方应用的覆盖不完整 | 低 | `market_app_control_changed` 事件已实现 | 已有 |

---

## 11. 待决问题

以下事项需要项目负责人明确后才能进入实施：

1. **脚手架的发布形式**：独立 npm 包（需 npm 账号与发布流程），还是 market 仓库内的 `template/` 目录（零依赖，复制即用）？后者更契合项目的离线优先定位。

2. **`layout.navbar: "custom"` 的适用范围**：是否允许第三方隐藏系统导航栏？完全隐藏会让用户「出不去」（需依赖手势返回），建议强制保留返回能力。

3. **数据保留策略**：卸载第三方应用时，其 `ci:app:<name>:*` 存储数据是清除还是保留（便于重装恢复）？

4. **官方应用是否也统一到 `AppShell`**：官方应用目前各自实现导航栏（`AppNavBar`）。统一到 `AppShell` 可获得一致的转场与生命周期管理，但需要改动 23 个应用，风险与收益需权衡。

5. **已有的 `apps/integration`（集成管理页）与本文 SDK 的关系**：该页面管理的是 Webhook Token（§8.3 的浅度集成），与市场应用 SDK 是两条线。是否需要在 UI 上明确区分「应用市场 / 集成管理」的定位，避免用户混淆？

---

## 12. 与 Ditto 的边界与可借鉴设计

### 12.1 结论：并行，不合并

**Ditto 不是 ClassIntra 的内核，ClassIntra 也不应基于 Ditto 重构。** 依据如下：

| 维度 | ClassIntra | Ditto | 是否可融合 |
|---|---|---|---|
| 定位 | 班级内网业务系统 | 通用 WebOS 框架 | ✗ 目标不同 |
| UI 技术栈 | Vue 2.7 Options API，`var` / `function`，禁 `const` / 箭头函数 / 模板字符串 | Vue 3.5 `<script setup>` + Composition API + TypeScript strict | ✗ 不可共享代码 |
| 后端 | Express + better-sqlite3 | Bun + Hono | ✗ 运行时不同 |
| 构建 | Vite 5/6 + `target: 'chrome80'` + legacy plugin | Vite 6 + turbo + 原生 ESM | ✗ 兼容基线不同 |
| 隔离模型 | **同页面自由**（无沙箱） | **三档沙盒**（`iframe-strict` / `shadow-trusted` / `worker`） | ✗ 互斥路线 |
| 交互范式 | 全屏应用 + 桌面网格 | 多窗口（`DWindow` / `DTaskbar`） | ✗ 产品形态不同 |
| 权限模型 | 开放，信任开发者 | capability 细粒度 + dev 自动授权 / prod 默认拒绝 | ✗ 设计哲学相反 |

**特别说明隔离模型的互斥性**：Ditto 的 `iframe-strict` 默认不下发 `allow-same-origin`，第三方应用**必然拿不到主页面 DOM**；ClassIntra 的「真·同页面自由」要求第三方**直接持有主页面 DOM**。这两条路线在架构上不可调和，任何「融合」尝试都会退回其中一侧。因此维持两条独立产品线是唯一自洽的选择。

**可直接对齐的部分**：两者的 manifest 字段命名（如 `type` 枚举、`permissions` 声明）、SDK 命名分层、生命周期阶段命名，可保持**语义趋同**——便于未来若有开发者同时接触两个项目时认知负担更低。这属于约定层面的对齐，不涉及代码复用。

### 12.2 值得借鉴的设计智慧（仅吸收模式，不复用代码）

Ditto 的工程成熟度显著高于 ClassIntra 当前水平（26,612 行 TS/Vue / 181 个文件 / 9 个 package / 10 个 vitest 测试文件）。以下六项设计模式在 ClassIntra 的技术栈下**可以按同样思路重新实现**：

#### 借鉴 1：分阶段生命周期编排 + 单阶段失败不中断

Ditto 的实现（`packages/core/src/lifecycle-orchestrator.ts`）把启动切为 7 个有序阶段：

```
storage → events → ipc → permissions → services → cells → ready
```

关键在于**错误隔离**：某个 stage 的 handler 抛错时，只 `emit('stage-error', { stage, error })` 然后**继续执行下一个 stage**，不中断整体启动。

```typescript
for (const stage of STAGE_ORDER) {
  const handlers = this.handlers.get(stage) ?? [];
  for (const h of handlers) {
    if (h.onInit) {
      try { await h.onInit(); }
      catch (e) {
        console.error(`[Lifecycle] stage "${stage}" init failed:`, e);
        this.emitter.emit('stage-error', { stage, error: e });
        // 不中断，继续下一 stage
      }
    }
  }
}
```

**对 ClassIntra 的价值**：`client/src/main.js` 当前的启动流程是一串顺序副作用（polyfills → 全局组件 → `$modal` → router 包装 → ServiceRegistry 注册 6 个服务 → `window.ClassIntraMarket` → `realtime.connect()` → `marketRegistry.refresh()` → `new Vue().$mount()`）。任一环节抛错会导致后续全部不执行，白屏且无诊断信息。

**落地建议（第三期候选）**：把这段启动流程重构为分阶段编排器（`client/src/core/boot-orchestrator.js`），阶段可定义为：

```
polyfills → errors → components → services → sdk → realtime → market → mount → ready
```

每个阶段可注册多个 handler，handler 抛错只记录并派发事件，不阻断后续阶段。收益是**故障降级**：即使 `realtime.connect()` 失败，应用仍能挂载并给出可用的降级界面。

#### 借鉴 2：应用生命周期状态机

Ditto 的客户端 Cell 用显式状态机约束生命周期（`activate` 先请求权限，再按 `native` / 其他选择沙盒模式，然后 `mount`）：

```
loading → active → paused → stopped
```

服务端另有更复杂的状态机：

```
creating → running ⇄ hibernated → stopped
```

并且用 `assertTransition()` **主动校验非法跃迁**（例如未 `activate` 直接 `pause` 会抛错），而不是静默容错。

**对 ClassIntra 的价值**：`market-registry.js` 当前的状态管理只有「已加载 / 未加载」二元，`mount()` 与 `unmount()` 可被任意顺序调用，无状态校验、无 `pause` / `resume` 概念。平板上用户切换应用（去聊天、回桌面）时，第三方应用仍在后台全速运行。

**落地建议**：为 `MarketRegistry` 引入显式状态机 `idle → loading → active → suspended → idle`，并实现 `suspend(name)` / `resume(name)`——与 §5.1 的生命周期审计共用同一套受管资源回收机制（`pause` 时暂停计时器，`resume` 时恢复）。这直接对应平板续航问题（R3）。

#### 借鉴 3：能力声明的显式化与持久化

Ditto 的权限管理用两层 Map 建模（`packages/core/src/permission/manager.ts`）：

```typescript
granted: Map<string, Set<Capability>>   // appId → 已授权能力集合
```

`request(appId, capability)` 走三分支：已授权直接放行 → `dev` 模式自动授权并 `console.warn` → 否则走交互式询问，**无 prompt 时默认拒绝**。授权结果可 `persist()` 到存储、`loadFromStore()` 恢复。

**对 ClassIntra 的价值**：ClassIntra 已确定**开放权限模型**（不设沙箱、不拦截），因此**不引入拒绝逻辑**。但仍应引入 **capability 声明 + 可观测**机制：

- manifest 中要求声明 `capabilities`（如 `net:fetch` / `clipboard:read` / `storage:persist` / `realtime:subscribe`）；
- 安装时在市场上**展示能力清单**给用户看（知情，而非拦截）；
- 运行时若第三方调用了未声明的能力，SDK 输出 `console.warn` 并计入应用诊断信息。

这样保留「开放」的产品决策，同时让能力边界从隐性变为显性——**披露而非限制**。

#### 借鉴 4：打包格式的加密与签名思路

Ditto 的 `.dit` 包（另有 `.ditx` widget / `.ditc` plugin / `.ditz` theme）采用 **ZIP + AES-256-GCM 加密（PBKDF2 10 万次迭代）+ Ed25519 签名**，配合 CLI 的 `ditto pack / install / verify / publish`。

**对 ClassIntra 的价值**：ClassIntra 当前的分发是「市场仓库 + 服务端扫描」，离线优先、内网部署，**不需要加密**。但**签名校验值得考虑**：内网环境下第三方包由学生/教师编写，若未来出现「从外部导入 `.ci-app` 包」的需求（不走市场仓库），则**完整性校验**可防止包在中转中被篡改。

**落地建议（第四期候选，低优先级）**：为学生作品导入场景设计轻量 `.cia` 单文件格式（ZIP 结构 + manifest + 前端资源），可选配 Ed25519 签名。**不建议**引入加密——内网场景下加密只会增加调试成本，且解密密钥仍需内置于客户端，安全性增益有限。

#### 借鉴 5：SDK 按能力域命名分层

Ditto 的 SDK 暴露 10 个 Vue `InjectionKey`，按能力域切分而非按函数堆叠：

```
UseIPC / UseWindow / UseFS / UseNet / UseAuth / UseUI / UseWidget / UseApp / UseCell / UseTheme
```

**对 ClassIntra 的价值**：本文 §4 的 `context.ui` / `context.data` / `context.system` / `context.app` / `context.compat` **五大命名空间划分与 Ditto 的分层思路一致**——按能力域组织，而非平铺一堆方法。这印证了当前 SDK 设计方向正确，可作为**设计不是臆造的旁证**。

**命名趋同建议**：Ditto 用 `UseXxx`（Vue composable 风格），ClassIntra 用 `context.xxx`（对象风格）。因第三方不过构建、无法使用 composable，维持 `context.xxx` 是正确选择。但**内部子项命名可对齐**，例如 `theme` / `storage` / `ipc`（对应 ClassIntra 的 `eventBus`）等关键字，降低跨项目认知成本。

#### 借鉴 6：最低版本约束

Ditto 的 `AppManifest` 含 `minDittoVersion` 字段，用于表达「本应用要求的内核最低版本」，避免应用依赖了尚未发布的 API 却在旧内核上静默失败。

**对 ClassIntra 的价值**：本文 §6.2 已引入 `sdk` 字段（如 `"sdk": "1"`），其语义与 `minDittoVersion` 完全对应。建议在文档中**明确该字段的校验时机与失败行为**：

| 时机 | 行为 |
|---|---|
| 市场安装时 | 拒绝安装，提示「此应用需要 ClassIntra SDK v2 或更高版本」 |
| 运行时装载时 | 不装载，进入 `MarketRuntime` 的错误态（复用现有重试/返回桌面 UI） |
| 服务端扫描时 | 记录 warning，标记为「不兼容」但不隐藏 |

### 12.3 明确不复用的部分

| Ditto 组件 | 不复用原因 |
|---|---|
| `DittoKernel` / `ServiceRegistry` / `LifecycleOrchestrator` 代码 | TypeScript + DI 容器，与 ClassIntra 的 `var`/`function` 风格和既有 `service-registry.js` 不兼容；仅借鉴**思路**（借鉴 1） |
| 三档沙盒（`IFrameSandbox` / `ShadowSandbox`） | 与「真·同页面自由」决策直接冲突 |
| `CellBridge`（WS + HTTP 双向通信） | ClassIntra 已选定 `realtime.js` HTTP 长轮询（X5/TBS 下 WS 不可靠），传输层不同 |
| `ElasticScaler` / `ResourceQuotaManager` / `TrafficShaper` / `FairScheduler` | 面向多用户 SaaS 的服务端资源治理，ClassIntra 是内网单实例部署，场景不匹配 |
| `.dit` 加密体系 | 内网离线场景无此需求（见借鉴 4） |
| 多窗口（`DWindow` / `DTaskbar`） | ClassIntra 是横屏平板全屏应用范式 |

### 12.4 一句话总结

> ClassIntra 从 Ditto 学「**怎么把内核写工程化**」（阶段编排、状态机、能力声明、版本约束），但**不学「怎么做通用操作系统」**。前者是内部质量，后者是产品定位——后者已由 Ditto 自己承担，ClassIntra 专注班级内网业务即可。

---

## 附录 A：现有资产复用清单

| 资产 | 位置 | 在生态设计中的角色 |
|---|---|---|
| `--ci-*` 令牌 | `client/src/styles/global.scss` | 视觉统一的唯一真相源 |
| `ios/` 组件样式 | `client/src/components/ios/*.vue` 的 `<style>` | SDK `ui.*` 片段的样式基础 |
| `ThemeEngine` | `client/src/core/theme-engine.js` | 订阅机制驱动令牌重新注入 |
| `EventBus` | `client/src/core/event-bus.js` | SDK 系统事件的传输层 |
| `PersistenceStore` | `client/src/core/persistence-store.js` | `context.data.storage` 的实现基础（其 prefix 机制正是命名空间隔离所需） |
| `realtime.js` | `client/src/utils/realtime.js` | `context.data.realtime` 的实现 |
| `market-registry.js` | `client/src/core/market-registry.js` | 生命周期审计的插入点 |
| `market-service.js` | `server/src/core/market-service.js` | 市场安装/卸载/冲突检测 |
| `modularity-verify.js` | `scripts/modularity-verify.js` | 删除式自测，生态改动后必须跑通 |

## 附录 B：术语表

| 术语 | 定义 |
|---|---|
| **核心（Core）** | 不可移除的基础设施：`client/src`、`server/src`、`shared/src`、`themes/` |
| **官方应用** | `apps/<name>/`，Vue SFC，构建期打包 |
| **第三方应用 / 市场应用** | `market-apps/<name>/`，原生 DOM，运行时装载 |
| **插件** | `plugins/<name>/`，纯后端扩展，无前端 |
| **AppShell** | 本文新增的统一容器层，为所有应用提供导航栏、令牌、生命周期 |
| **SDK** | `window.ClassIntra.market` 暴露的能力集合，第三方应用的唯一编程接口 |
| **令牌（Token）** | CSS 自定义属性 `--ci-*`，主题的原子单位 |
| **双轨加载器** | 官方应用的构建期加载 与 第三方应用的运行时加载 并存 |
| **Ditto** | 并行独立项目，通用 WebOS 框架。**不是** ClassIntra 的内核，仅作为设计模式参照（见 §12） |
| **capabilities** | manifest 中声明应用所需能力的字段。ClassIntra 下为**披露用途**，不做拦截（见 §12.2 借鉴 3） |
