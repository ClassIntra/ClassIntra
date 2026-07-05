# ClassIntra 架构总览

> 本文档描述 ClassIntra 桌面系统的整体架构、模块分层、核心机制和启动流程。
> 如果你是新加入的开发者，请先阅读本文档，再阅读 [development-guide.md](./development-guide.md)。

---

## 1. 项目定位

ClassIntra 是面向教育场景的 Web 桌面系统，技术栈锁定 **Vue 2.7 + JavaScript**，必须兼容 **Chrome 80** 及更低版本浏览器（教育终端常见）。

架构参考了 [Ditto](https://github.com/) 项目（Vue 3 + TypeScript 的通用 WebOS），但做了如下取舍：

| 维度 | Ditto | ClassIntra |
|------|-------|------------|
| 技术栈 | Vue 3 + TypeScript | Vue 2.7 + JavaScript |
| 语法约束 | 现代 ES2022+ | 禁用 `?.` / `??` / `??=` / `||=` / `&&=` |
| 浏览器目标 | 现代浏览器（Chrome 100+） | Chrome 80+ |
| 应用市场 | 内置 | 不做 |
| 应用级权限声明 | 完整 | 不做 |
| 主题动画 | 四档 | 单档 + 关闭开关 |
| 集成方式 | postMessage 单向 | postMessage + webhook 双向 |
| 定位 | 通用 WebOS | 教育桌面（独立运行，对齐关键规范） |

> 生态定位：**独立运行**，但与 Ditto 对齐关键契约（manifest schema、错误码前缀、主题 token），未来可双向迁移。

---

## 2. 整体目录结构

```
ClassIntra/
├── client/                     # 前端（Vue 2.7）
│   ├── src/
│   │   ├── core/               # 核心层（ServiceRegistry / ThemeEngine / EventBus / ...）
│   │   ├── integrations/       # 集成层（PostMessageBridge / OutboundLauncher）
│   │   ├── components/          # 通用组件（GlobalSearch / ModalDialog / ErrorBoundary ...）
│   │   ├── views/              # 旧页面（保留过渡，新页面统一放 apps/）
│   │   ├── store/              # Vuex 根 + 模块
│   │   ├── router/             # 路由根（路由表由聚合器生成）
│   │   ├── utils/              # 工具（api / latex-renderer / websocket ...）
│   │   ├── styles/             # 全局样式（global.scss）
│   │   └── main.js             # 入口（含 Chrome 80 polyfills）
│   └── vite.config.js
├── server/                     # 后端（Node.js + Express）
│   ├── src/
│   │   ├── core/               # 核心层（ServiceRegistry / LifecycleOrchestrator / manifest-loader）
│   │   ├── integrations/       # 集成层（token-store / webhook-receiver / outbound-dispatcher）
│   │   ├── migrations/         # DB 迁移脚本（按版本号顺序执行）
│   │   ├── routes/             # 旧路由（保留过渡）
│   │   ├── middleware/         # 中间件（限流、认证）
│   │   ├── services/           # 业务服务（视频转码、中继总线）
│   │   ├── utils/              # 工具（db / init-db / migration-runner / jwt / cache ...）
│   │   ├── ws/                 # WebSocket 聊天 + 中继
│   │   └── config/             # 配置
│   └── database/               # SQLite 数据库文件
├── shared/                     # 前后端共享层（ES Module，仅前端引用）
│   └── src/
│       ├── constants.js        # 错误码 / 事件名 / 集成协议常量
│       ├── errors.js           # ClassIntraError + globalErrorHandler
│       ├── manifest-schema.js  # Manifest 字段定义 + 验证器
│       ├── integration-contract.js  # 集成协议契约（envelope / channels / scopes）
│       ├── theme-tokens.js     # LIGHT_TOKENS / DARK_TOKENS
│       └── theme-adapter.js    # flattenTokens / applyToElement
├── apps/                       # 应用市场（每个应用一个目录）
│   ├── countdown/
│   │   ├── manifest.json       # 应用清单（驱动聚合）
│   │   ├── frontend/           # Vue 组件 + widget + store
│   │   └── backend/            # Express 路由
│   ├── calendar/
│   ├── notes/
│   ├── resource/               # 资源仓库（已合并原 cloud）
│   ├── ai-chat/
│   ├── chat/
│   ├── community/
│   ├── timetable/
│   ├── weather/
│   ├── music/
│   ├── settings/
│   └── integration/            # 集成管理后台 UI
├── docs/                       # 文档（本目录）
├── Resources/                  # 静态资源（图标、壁纸）
└── .git/
```

---

## 3. 分层架构

ClassIntra 分为 5 层，每层职责单一、依赖方向清晰（上层依赖下层，下层不感知上层）。

```
┌─────────────────────────────────────────────────────────────┐
│  应用层 (apps/*)                                             │
│  每个应用自带 frontend/backend/manifest.json，独立可插拔       │
└─────────────────────────────────────────────────────────────┘
                          ▲
┌─────────────────────────────────────────────────────────────┐
│  聚合层 (core/*-aggregator)                                  │
│  从 apps/*/manifest.json 聚合 路由/store/widget/后端路由       │
└─────────────────────────────────────────────────────────────┘
                          ▲
┌─────────────────────────────────────────────────────────────┐
│  集成层 (integrations/)                                      │
│  PostMessage Bridge + Outbound Launcher + Webhook 双向通信   │
└─────────────────────────────────────────────────────────────┘
                          ▲
┌─────────────────────────────────────────────────────────────┐
│  核心层 (core/)                                              │
│  ServiceRegistry / ThemeEngine / EventBus / HotkeyManager /  │
│  SearchRegistry / PersistenceStore                           │
└─────────────────────────────────────────────────────────────┘
                          ▲
┌─────────────────────────────────────────────────────────────┐
│  共享层 (shared/)                                            │
│  ClassIntraError / constants / manifest-schema /             │
│  integration-contract / theme-tokens                         │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 共享层 `shared/`

**位置**：`shared/src/`

**职责**：定义跨端契约，前端通过 `@shared` 别名引用（ES Module）。后端在 `server/src/core/` 维护 CommonJS 等价版本（人工同步）。

**为什么不前后端共用一套？**
- 前端用 Vite 打包，必须 ES Module
- 后端用 Node.js CommonJS（`require`），且不希望通过构建步骤
- 强行共用会引入打包复杂度，违背"低复杂度"原则

**关键文件**：

| 文件 | 作用 |
|------|------|
| [shared/src/constants.js](../shared/src/constants.js) | 错误码（`CLASSINTRA_*` 前缀）/ 事件名 / 集成协议常量 |
| [shared/src/errors.js](../shared/src/errors.js) | `ClassIntraError` + `globalErrorHandler` |
| [shared/src/manifest-schema.js](../shared/src/manifest-schema.js) | `validateManifest(m)` → `{ valid, errors, warnings, manifest }` |
| [shared/src/integration-contract.js](../shared/src/integration-contract.js) | `createEnvelope` / `validateEnvelope` / `CHANNELS` / `SCOPES` |
| [shared/src/theme-tokens.js](../shared/src/theme-tokens.js) | `LIGHT_TOKENS` / `DARK_TOKENS`（与 `global.scss` 双写） |
| [shared/src/theme-adapter.js](../shared/src/theme-adapter.js) | `flattenTokens` / `applyToElement` |

### 3.2 核心层 `client/src/core/`

**位置**：`client/src/core/`

**职责**：提供前端基础设施，全部采用 **单例 + 懒创建** 模式。所有核心模块都通过 `getXxx()` 获取实例。

| 模块 | 文件 | 作用 |
|------|------|------|
| ServiceRegistry | [service-registry.js](../client/src/core/service-registry.js) | 服务注册中心，懒创建 + 单例缓存 + 逆序销毁 |
| ThemeEngine | [theme-engine.js](../client/src/core/theme-engine.js) | 主题引擎，setTheme + 动画开关 + 订阅通知 |
| EventBus | [event-bus.js](../client/src/core/event-bus.js) | 事件总线，handler 异常隔离 + 防递归 |
| HotkeyManager | [hotkey-manager.js](../client/src/core/hotkey-manager.js) | 快捷键管理器，capture 阶段 + 倒序匹配 |
| SearchRegistry | [search-registry.js](../client/src/core/search-registry.js) | 全局搜索（应用 + 命令 + Provider 三源） |
| PersistenceStore | [persistence-store.js](../client/src/core/persistence-store.js) | localStorage 持久化 + memory 降级 + 数据迁移 |

**后端对应**：`server/src/core/`（ServiceRegistry / LifecycleOrchestrator / manifest-loader / errors）

### 3.3 聚合层 `client/src/core/*-aggregator.js`

**职责**：从 `apps/*/manifest.json` 自动聚合路由表、Vuex 模块、桌面 widget，无需手动注册。

| 聚合器 | 输出 | 使用方 |
|--------|------|--------|
| [manifest-loader.js](../client/src/core/manifest-loader.js) | `loadManifests()` / `getComponent(appName, relPath)` | 其他聚合器共用 |
| [router-aggregator.js](../client/src/core/router-aggregator.js) | `appRoutes`（Vue Router 路由表）+ `ROUTE_APP_MAP` | `client/src/router/index.js` |
| [store-aggregator.js](../client/src/core/store-aggregator.js) | `APP_STORE_MODULES`（Vuex 模块映射） | `client/src/store/index.js` |
| [widget-aggregator.js](../client/src/core/widget-aggregator.js) | `WIDGET_REGISTRY` + `getWidget` / `listWidgets` / `registerWidget` | `components/Desktop.vue` |
| [app-registry.js](../client/src/core/app-registry.js) | `APP_REGISTRY`（桌面应用元数据） | `store/modules/desktop.js` |

**后端聚合器**：

| 聚合器 | 输出 | 使用方 |
|--------|------|--------|
| [server/src/core/manifest-loader.js](../server/src/core/manifest-loader.js) | `loadManifests()` / `getAppEntryPath()` | 其他后端聚合器 |
| [server/src/core/route-aggregator.js](../server/src/core/route-aggregator.js) | `mountAppRoutes(app)` / `getBackendApps()` | `server/src/app.js` |
| [server/src/core/default-apps-loader.js](../server/src/core/default-apps-loader.js) | `getDefaultApps()` / `getAllApps()` / `getDesktopApps()` | `init-db.js` / `admin` 路由 |

### 3.4 集成层 `client/src/integrations/` + `server/src/integrations/`

**职责**：ClassIntra 与外部系统的双向通信。详见 [integration-guide.md](./integration-guide.md)。

**前端**（`client/src/integrations/`）：
- [postmessage-bridge.js](../client/src/integrations/postmessage-bridge.js) — postMessage 双向桥接
- [outbound-launcher.js](../client/src/integrations/outbound-launcher.js) — 嵌入外部 iframe + 自动握手
- [index.js](../client/src/integrations/index.js) — `IntegrationManager` 统一管理

**后端**（`server/src/integrations/`）：
- [token-store.js](../server/src/integrations/token-store.js) — HMAC 签发的 token + secret 管理
- [webhook-receiver.js](../server/src/integrations/webhook-receiver.js) — 接收外部 webhook（验签 + 防重放）
- [outbound-dispatcher.js](../server/src/integrations/outbound-dispatcher.js) — 向订阅了事件的集成推送 webhook
- [origin-registry.js](../server/src/integrations/origin-registry.js) — origin 白名单匹配（精确 + 通配符）

### 3.5 应用层 `apps/*/`

**职责**：每个应用是一个独立模块，自带 `manifest.json` + `frontend/` + `backend/`。

**应用结构示例**（以 `countdown` 为例）：

```
apps/countdown/
├── manifest.json              # 清单（驱动聚合）
├── frontend/
│   ├── Countdown.vue          # 主页面
│   ├── widgets/
│   │   └── CountdownWidget.vue  # 桌面小组件
│   └── store.js               # Vuex 模块（可选）
└── backend/
    └── routes.js              # Express 路由
```

详见 [development-guide.md](./development-guide.md) 的"新增应用"章节。

---

## 4. 核心机制

### 4.1 ServiceRegistry 服务注册中心

**位置**：[client/src/core/service-registry.js](../client/src/core/service-registry.js) + [server/src/core/service-registry.js](../server/src/core/service-registry.js)

**设计要点**：
1. **懒创建**：`register(name, factory)` 仅注册工厂，`resolve(name)` 时才实例化
2. **单例缓存**：首次 resolve 创建并缓存，后续返回同一实例
3. **生命周期**：factory 可返回 `{ instance, destroy }`，shutdown 时**逆序**调用 destroy
4. **异常隔离**：单个服务 destroy 异常不中断其他服务
5. **异步支持**：`resolveAsync(name)` 支持 factory 返回 Promise

**使用方式**：

```javascript
// main.js 中注册
import { getServiceRegistry } from '@/core/service-registry';
var serviceRegistry = getServiceRegistry();
serviceRegistry.register('themeEngine', function() { return getThemeEngine(); });
serviceRegistry.register('store', function() { return store; });

// 组件中使用
this.$services.resolve('themeEngine').setTheme('dark');
```

**已注册服务**（见 [main.js](../client/src/main.js#L170-L177)）：

| 服务名 | 实例 | 说明 |
|--------|------|------|
| `eventBus` | `EventEmitter` | 全局事件总线 |
| `store` | Vuex Store | 状态管理 |
| `themeEngine` | `ThemeEngine` | 主题引擎 |
| `hotkey` | `HotkeyManager` | 快捷键 |
| `integration` | `IntegrationManager` | 集成系统 |
| `search` | `SearchRegistry` | 全局搜索 |

### 4.2 ThemeEngine 主题引擎

**位置**：[client/src/core/theme-engine.js](../client/src/core/theme-engine.js)

**设计要点**：
1. `setTheme(id)` 通过 `setAttribute('data-theme', id)` 触发 CSS 切换（旧机制，向后兼容）
2. 额外写入 `--ci-*` 新变量（inline style），供新代码使用
3. 旧变量（`--primary-color` 等）继续由 `:root` 和 `[data-theme="dark"]` CSS 提供
4. `subscribe(callback)` 订阅主题变化，`setMotionEnabled(false)` 关闭动画
5. **双写策略**：新代码用 `--ci-*`，旧代码继续用旧变量，后续清理

**主题切换流程**：

```
用户点击切换
    ↓
ThemeEngine.setTheme('dark')
    ↓
1. setAttribute('data-theme', 'dark')      → 触发 CSS 切换
2. flattenTokens(DARK_TOKENS) → applyToElement → 写入 --ci-* 变量
3. 通知所有 subscribers（payload: { id, previous, type, icons }）
4. EventBus.emit('theme:changed', payload) → 广播给非直接订阅者
```

**动画开关**：
- `initMotion()`：从 `localStorage.ci_motion_disabled` 读取，或检测 `prefers-reduced-motion`
- `setMotionEnabled(false)`：设置 `[data-no-motion="true"]`，由 `_motion.scss` 全局规则关闭动画
- **单档设计**：不区分 fast/normal/slow，只有"开/关"，与 Ditto 的四档不同

### 4.3 EventBus 事件总线

**位置**：[client/src/core/event-bus.js](../client/src/core/event-bus.js)

**设计要点**：
1. handler 异常隔离：单个 handler throw 不影响其他 handler
2. `emit` 时复制 handlers 数组，防止遍历中被修改
3. `'error:handler'` 事件用于报告 handler 异常（避免递归）
4. 单例 `getEventBus()`

**事件名规范**（见 [shared/src/constants.js](../shared/src/constants.js#L57-L67)）：

```javascript
EVENT_NAMES = {
  THEME_CHANGED: 'theme:changed',
  THEME_MOTION_TOGGLED: 'theme:motion-toggled',
  APP_LAUNCHED: 'app:launched',
  APP_CLOSED: 'app:closed',
  USER_SIGNED_IN: 'user:signed-in',
  USER_SIGNED_OUT: 'user:signed-out',
  INTEGRATION_HANDSHAKE: 'integration:handshake',
  INTEGRATION_EVENT: 'integration:event',
  INTEGRATION_DISCONNECTED: 'integration:disconnected'
}
```

> 局部事件可由各模块自定义，不强制全部声明在 constants 中。

### 4.4 HotkeyManager 快捷键管理器

**位置**：[client/src/core/hotkey-manager.js](../client/src/core/hotkey-manager.js)

**设计要点**：
1. **capture 阶段监听**：`addEventListener('keydown', handler, true)` 确保在 target 之前拦截
2. **combo normalize**：`'Ctrl+K'` / `'ctrl+k'` / `'Control+K'` 统一为 `'ctrl+k'`
3. **输入框过滤**：默认在 input/textarea/contenteditable 中不触发（除非声明 `global: true`）
4. **倒序匹配**：后注册的优先级高（允许覆盖）
5. `register(binding)` 返回**取消注册函数**

**使用方式**：

```javascript
import { getHotkeyManager } from '@/core/hotkey-manager';
var hotkey = getHotkeyManager();

// 注册 Ctrl+K（输入框中也触发）
var unregister = hotkey.register({
  id: 'global-search',
  combo: 'Ctrl+K',
  description: '打开全局搜索',
  global: true,                  // 输入框中也触发
  handler: function(e) {
    e.preventDefault();
    openSearch();
  }
});

// 取消注册
unregister();
```

### 4.5 SearchRegistry 全局搜索

**位置**：[client/src/core/search-registry.js](../client/src/core/search-registry.js) + [components/GlobalSearch.vue](../client/src/components/GlobalSearch.vue)

**三源搜索**：
1. **应用**（来自 `APP_REGISTRY`）：匹配 `name` / `label`，点击跳转路由
2. **命令**（`registerCommand`）：匹配 `title` / `keywords` / `description`
3. **Provider**（`registerProvider`）：自定义异步搜索

**使用方式**：

```javascript
import { getSearchRegistry } from '@/core/search-registry';
var search = getSearchRegistry();

// 注册命令
search.registerCommand({
  id: 'toggle-theme',
  title: '切换深色模式',
  description: '在浅色/深色主题间切换',
  keywords: ['theme', 'dark', '主题', '深色'],
  icon: 'fa-solid fa-moon',
  action: function() { /* ... */ }
});

// 注册自定义 Provider（异步）
search.registerProvider({
  id: 'notes',
  category: '笔记',
  search: function(query) {
    return fetch('/api/notes/search?q=' + encodeURIComponent(query))
      .then(function(r) { return r.json(); })
      .then(function(data) { return data.items; });
  }
});
```

**UI 触发**：`Ctrl+K` 唤起 `GlobalSearch.vue`（在 [App.vue](../client/src/App.vue#L341-L348) 中注册 hotkey）。

### 4.6 PersistenceStore 持久化存储

**位置**：[client/src/core/persistence-store.js](../client/src/core/persistence-store.js)

**设计要点**：
1. localStorage 优先，memory 降级（隐私模式或 storage 被禁用时）
2. `prefix` 隔离命名空间（默认 `classintra:`），避免与其他应用冲突
3. `MigrationStep` 支持数据迁移（按 version 升序执行）
4. `onChange(key, handler)` 订阅 key 变化

**使用方式**：

```javascript
import { getDefaultStore } from '@/core/persistence-store';
var store = getDefaultStore();

store.set('user preference', { theme: 'dark', lang: 'zh-CN' });
var pref = store.get('user preference', { theme: 'light' });  // 第二参数为默认值

// 订阅变化
var unsubscribe = store.onChange('user preference', function(newValue, fullKey) {
  console.log('偏好已更新:', newValue);
});
unsubscribe();
```

---

## 5. Manifest 驱动的应用聚合

### 5.1 Manifest Schema

详见 [manifest-schema.md](./manifest-schema.md)。这里只列字段概览：

```json
{
  "name": "countdown",              // 必填，kebab-case
  "label": "倒数日",                 // 必填，显示名
  "type": "app",                    // 可选：app | system | widget（默认 app）
  "version": "1.0.0",               // 可选，semver（默认 0.0.0）
  "icon": "/resources/.../Countdown.png",  // 可选
  "color": "#FF9500",               // 可选，主题色
  "category": "desktop",            // 可选：desktop | system | hidden（默认 desktop）
  "order": 11,                      // 可选，排序权重（默认 99，越小越靠前）
  "defaultEnabled": true,           // 可选，默认启用（默认 true）
  "canDisable": true,               // 可选，允许用户禁用（默认 true）
  "frontend": {                     // 可选
    "route": "/countdown",          // 主路由
    "routeName": "Countdown",       // 路由 name
    "component": "./frontend/Countdown.vue",  // 主组件
    "extraRoutes": [...],           // 附加路由（如 cloud-picker）
    "store": "./frontend/store.js", // Vuex 模块（简写或对象）
    "widgets": [...]                // 桌面小组件
  },
  "backend": {                      // 可选
    "mountPath": "/api/countdown",  // 挂载路径
    "entry": "./backend/routes.js", // 路由文件
    "rateLimit": { "max": 100, "windowMs": 60000 }  // 可选限流
  },
  "extraBackends": [                // 可选，附加后端路由（阶段 0 引入）
    { "mountPath": "/api/...", "entry": "./backend/xxx.js" }
  ]
}
```

### 5.2 自动聚合流程

**前端**（启动时一次性聚合）：

```
import.meta.glob('../../../apps/*/manifest.json', { eager: true })
    ↓
manifest-loader.loadManifests()
    ↓ 校验 + 排序
    ↓
┌──────────────────┬──────────────────┬──────────────────┐
│ router-aggregator│ store-aggregator │ widget-aggregator│
│ → appRoutes      │ → APP_STORE_     │ → WIDGET_REGISTRY│
│ → ROUTE_APP_MAP  │   MODULES        │                  │
└──────────────────┴──────────────────┴──────────────────┘
    ↓                   ↓                   ↓
router/index.js     store/index.js     Desktop.vue
```

**后端**（启动时挂载）：

```
manifest-loader.loadManifests()
    ↓
route-aggregator.mountAppRoutes(app)
    ↓ 遍历 manifest
    ↓ 主 backend + extraBackends（数组）
    ↓ 应用 manifest.backend.rateLimit 限流中间件
express app.use(mountPath, router)
```

### 5.3 应用管控

每个应用通过 `app_control` 表（`app_name` + `enabled`）控制启用/禁用。前端路由守卫通过 `ROUTE_APP_MAP` 检查当前路由对应的应用是否启用，未启用则跳转到禁用页面。

详见 [default-apps-loader.js](../server/src/core/default-apps-loader.js) 和 [store/modules/desktop.js](../client/src/store/modules/desktop.js)。

---

## 6. 集成系统

ClassIntra 支持与外部系统的**双向**集成：

```
┌─────────────────────────────────────────────────────────────┐
│  外部系统 A（嵌入 ClassIntra iframe）                        │
│  ↔ postMessage Bridge                                        │
└─────────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────────┐
│  ClassIntra                                                  │
│  - PostMessageBridge（前端，与 iframe 双向通信）              │
│  - OutboundLauncher（前端，主动嵌入外部站点）                 │
│  - WebhookReceiver（后端，接收外部 POST）                    │
│  - OutboundDispatcher（后端，向订阅者推送 webhook）           │
└─────────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────────┐
│  外部系统 B（订阅 ClassIntra webhook）                       │
│  ↔ webhook + HMAC 签名                                       │
└─────────────────────────────────────────────────────────────┘
```

**核心契约**（见 [shared/src/integration-contract.js](../shared/src/integration-contract.js)）：

- **Envelope 信封格式**：所有 postMessage 消息必须符合 `{ v, type, id, kind, channel, payload, requestId, error, timestamp }`
- **Channels**：预定义通道（如 `handshake:request` / `user:info` / `calendar:event_created`），每个通道声明 direction 和 scope
- **Scopes**：权限范围（如 `user:read` / `data:write`），每个集成绑定 scopes 数组
- **Origin 白名单**：强制校验（绝不 `'*'`），支持精确 + 通配符匹配
- **HMAC-SHA256 签名**：webhook 推送时附 `X-ClassIntra-Signature` header，防篡改 + 防重放（5 分钟容差）

详见 [integration-guide.md](./integration-guide.md)。

---

## 7. DB Migration 系统

**位置**：[server/src/utils/migration-runner.js](../server/src/utils/migration-runner.js) + [server/src/migrations/](../server/src/migrations/)

**设计要点**：
1. `schema_version` 表记录已执行的迁移版本
2. 迁移文件按文件名排序执行（`000_baseline.js` → `001_xxx.js` → `002_xxx.js`）
3. 每个迁移在**事务**中执行，失败则回滚并中止后续迁移
4. 所有迁移必须**幂等**（`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` 前检查列存在）
5. `initDatabase()` 调用 `migrationRunner.runAll()` → `_initData()` → `runCloudMigration()`

**迁移文件结构**：

```javascript
// server/src/migrations/003_add_xxx.js
module.exports = {
  version: 3,
  name: 'add_xxx_table',
  up: function(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS xxx (
        id INTEGER PRIMARY KEY,
        ...
      );
    `);
  }
};
```

详见 [migration-guide.md](./migration-guide.md)。

---

## 8. 错误处理体系

### 8.1 ClassIntraError

**位置**：[shared/src/errors.js](../shared/src/errors.js) + [server/src/core/errors.js](../server/src/core/errors.js)

**设计要点**：
- 携带 `code`（机器可读，前缀 `CLASSINTRA_*`）+ `message`（人类可读）+ `details` + `recoverable` + `cause`
- `ClassIntraError.fromUnknown(error, fallbackCode)` 工厂方法把任意值转为 ClassIntraError
- 不依赖运行时环境（浏览器/Node 通用）

**便捷工厂**：

```javascript
ClassIntraError.appNotFound('countdown')         // 应用不存在
ClassIntraError.appDisabled('countdown')          // 应用已禁用（recoverable: true）
ClassIntraError.themeNotFound('dark')             // 主题不存在
ClassIntraError.serviceNotFound('eventBus')       // 服务未注册
ClassIntraError.validationError('email', '格式错误')  // 参数校验失败
ClassIntraError.networkError('请求超时', err)     // 网络错误（recoverable: true）
```

### 8.2 globalErrorHandler

**位置**：[shared/src/errors.js](../shared/src/errors.js#L88-L134)

**设计要点**：
1. **多订阅者**：各模块（如 crashLogger、UI toast、监控上报）可注册 handler
2. **异常隔离**：`handle()` 调用时单个 handler 失败不影响其他 handler
3. **防递归**：`_handling` 标志位防止 handler 内部 throw 导致递归

**使用方式**：

```javascript
import { globalErrorHandler } from '@shared/errors';

// 注册订阅者
var unsubscribe = globalErrorHandler.addHandler(function(ciError, originalError) {
  // 上报到监控平台 / 显示 toast / 写入日志
  console.error('[我的错误处理]', ciError.code, ciError.message);
});

// 处理错误
try {
  doSomethingRisky();
} catch (e) {
  globalErrorHandler.handle(e);  // 自动转换为 ClassIntraError
}

// 取消订阅
unsubscribe();
```

**全局捕获**（见 [main.js](../client/src/main.js#L102-L115)）：

```javascript
Vue.config.errorHandler = function(err, vm, info) {
  globalErrorHandler.handle(err);
};
window.onerror = function(msg, url, line, col, error) {
  globalErrorHandler.handle(error || msg);
};
window.addEventListener('unhandledrejection', function(event) {
  globalErrorHandler.handle(event.reason);
});
```

### 8.3 错误码列表

详见 [shared/src/constants.js](../shared/src/constants.js#L10-L52)。错误码统一前缀 `CLASSINTRA_*`，按域分组：

- **存储**：`STORAGE_UNAVAILABLE` / `STORAGE_QUOTA_EXCEEDED` / `STORAGE_CORRUPTED`
- **应用**：`APP_NOT_FOUND` / `APP_DISABLED` / `APP_LOAD_FAILED`
- **主题**：`THEME_NOT_FOUND` / `THEME_INVALID`
- **集成**：`INTEGRATION_UNAUTHORIZED` / `INTEGRATION_FORBIDDEN` / `INTEGRATION_TIMEOUT` / `INTEGRATION_INVALID_ENVELOPE` / `INTEGRATION_UNKNOWN_CHANNEL` / `INTEGRATION_NO_TARGET` / `INTEGRATION_ERROR` / `INTEGRATION_CLOSED` / `INTEGRATION_SIGNATURE_INVALID` / `INTEGRATION_TOKEN_EXPIRED`
- **服务**：`SERVICE_NOT_FOUND` / `SERVICE_UNAVAILABLE` / `SERVICE_ALREADY_REGISTERED`
- **通用**：`PERMISSION_DENIED` / `NETWORK_ERROR` / `DB_ERROR` / `VALIDATION_ERROR` / `NOT_FOUND` / `CONFLICT` / `RATE_LIMITED` / `INTERNAL_ERROR` / `UNKNOWN`

---

## 9. 启动流程

### 9.1 前端启动

**入口**：[client/src/main.js](../client/src/main.js)

```
1. Polyfills（Object.hasOwn / replaceAll / Promise.any / Array.at）
    ↓
2. import Vue + App + router + store + 全局组件
    ↓
3. 注册全局错误处理（Vue.config.errorHandler / window.onerror / unhandledrejection）
    ↓
4. 注册全局组件（ModalDialog / LoadingSkeleton / ErrorBoundary）
    ↓
5. Vue.use(ModalPlugin) — 暴露 this.$modal
    ↓
6. router.onError + 包装 router.push/replace（捕获 NavigationDuplicated）
    ↓
7. ServiceRegistry 注册核心服务（eventBus / store / themeEngine / hotkey / integration / search）
    ↓
8. Vue.prototype.$services = serviceRegistry  — 组件内 this.$services.resolve('xxx')
    ↓
9. window.__router = router  — 供 SearchRegistry 应用搜索跳转
    ↓
10. new Vue({ router, store, render }).$mount('#app')
    ↓
11. window.__onVueReady()  — 供测试脚本感知就绪
```

**App.vue mounted**：
- 初始化 `$modal` 实例
- 检测性能等级（low/medium/high）→ `data-perf` 属性
- 应用主题 + 初始化动画开关
- 拉取用户状态 + 用户设置（壁纸/主题同步）
- 注册 WebSocket 消息处理（封禁 / 应用更新 / 权限变更 / 天气预警）
- 启动心跳检测（2秒间隔，5次失败才锁屏）
- 注册 `Ctrl+K` 全局搜索快捷键
- 启动更新检查器

### 9.2 后端启动

**入口**：`server/src/app.js`

```
1. 加载 .env + config
    ↓
2. 初始化数据库（init-db.js）
   ├─ migrationRunner.runAll()  — 执行 schema 迁移
   ├─ _initData()               — 数据初始化（预注册 / 默认应用 / watermark）
   └─ runCloudMigration()       — 云盘旧文件迁移（幂等）
    ↓
3. 创建 Express app + 中间件（json / urlencoded / cookie-parser / 静态资源）
    ↓
4. 挂载旧路由（auth / chat / community / admin / setup ...）
    ↓
5. route-aggregator.mountAppRoutes(app)  — 挂载 apps/*/backend/ 路由
    ↓
6. 启动 HTTP server + WebSocket server
    ↓
7. （可选）LifecycleOrchestrator.startup()  — 分阶段启动（本期预留）
```

---

## 10. Chrome 80 兼容约束

详见 [chrome-80-compat.md](./chrome-80-compat.md)。这里列出核心约束：

| 禁用语法 | 原因 | 替代方案 |
|----------|------|----------|
| `?.`（可选链） | Chrome 80 不支持 | 显式 `&&` 判断 |
| `??`（空值合并） | Chrome 80 不支持 | `\|\|` 配合显式 null 检查 |
| `??=` / `\|\|=` / `&&=` | Chrome 80 不支持 | 显式赋值 |
| `class` 语法 | 与现有代码风格不一致 | 构造函数 + prototype |
| `let` / `const` | 与现有代码风格不一致（项目约定 `var`） | `var` |
| 模板字符串 | 与现有代码风格不一致 | 字符串拼接 |
| 箭头函数 | 与现有代码风格不一致 | `function` |
| `Object.hasOwn` | Chrome 93+ | main.js 已 polyfill |
| `String.prototype.replaceAll` | Chrome 85+ | main.js 已 polyfill |
| `Promise.any` | Chrome 85+ | main.js 已 polyfill |
| `Array.prototype.at` | Chrome 92+ | main.js 已 polyfill |

---

## 11. 与 Ditto 的关系

ClassIntra **参考** Ditto 的架构设计，但**不是** Ditto 的衍生版（derivative）。两者的关系：

| 维度 | 对齐策略 |
|------|----------|
| Manifest Schema | 字段名 + 结构对齐，ClassIntra 增加 `extraBackends` 等教育场景字段 |
| 错误码 | 前缀 `CLASSINTRA_*`（与 Ditto 的 `DITTO_*` 共存，不混用） |
| 主题 Token | `--ci-*` 前缀（与 Ditto 的 `--ditto-*` 区分） |
| 集成协议 | envelope 格式兼容，但 `type: 'classintra-integration'`（不混用） |
| 服务名 | 部分对齐（`eventBus` / `themeEngine`），部分独有（`integration` / `search`） |

**未来迁移路径**：如需将 ClassIntra 应用迁移到 Ditto，只需调整 manifest 字段名 + 错误码前缀 + 主题 token 前缀，业务代码无需大改。

---

## 12. 相关文档

| 文档 | 说明 |
|------|------|
| [api-reference.md](./api-reference.md) | 核心 API 参考（ServiceRegistry / ThemeEngine / EventBus / HotkeyManager / SearchRegistry / PersistenceStore / 集成协议） |
| [component-guide.md](./component-guide.md) | 通用组件文档（GlobalSearch / ModalDialog / ErrorBoundary / LoadingSkeleton） |
| [development-guide.md](./development-guide.md) | 开发指南（新增应用 / 注册服务 / 写 migration / 注册快捷键 / 注册搜索 Provider） |
| [theme-system.md](./theme-system.md) | 主题系统文档（token 体系 / 双写策略 / 动画开关） |
| [migration-guide.md](./migration-guide.md) | DB 迁移指南（如何写新 migration / 幂等性要求 / 调试方法） |
| [chrome-80-compat.md](./chrome-80-compat.md) | Chrome 80 兼容性约束（禁用语法 / polyfills / 替代方案） |
| [manifest-schema.md](./manifest-schema.md) | Manifest Schema 完整字段定义 + 验证规则 |
| [integration-guide.md](./integration-guide.md) | 集成系统使用指南（postMessage / webhook / 握手流程 / 签名验证） |
| [version-management.md](./version-management.md) | 版本号管理（SemVer + 自动 PATCH 递增） |
