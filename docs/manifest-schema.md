# ClassIntra Manifest 规范

> 应用清单（manifest.json）是 ClassIntra 应用模块化架构的核心契约。
> 前后端聚合器通过扫描 `apps/*/manifest.json` 自动挂载路由、注册桌面图标、加载小组件。

## 版本

- 规范版本：1.0
- 引入版本：ClassIntra 阶段 3（2026-07）
- 兼容策略：新增字段向后兼容，缺省值见下表

---

## 1. 字段定义

### 1.1 顶层字段

| 字段 | 类型 | 必填 | 缺省值 | 说明 |
|------|------|------|--------|------|
| `name` | string | ✅ | — | 应用唯一标识（kebab-case） |
| `label` | string | ✅ | — | 显示名称 |
| `icon` | string | ❌ | — | 图标路径（如 `/resources/public/icons/X.png`） |
| `color` | string | ❌ | — | 主题色（hex 格式） |
| `category` | string | ❌ | `desktop` | 应用分类：`desktop`/`system`/`hidden` |
| `order` | number | ❌ | `99` | 排序权重（越小越靠前） |
| `defaultEnabled` | boolean | ❌ | `true` | 默认是否启用 |
| `canDisable` | boolean | ❌ | `true` | 是否允许用户禁用 |
| `type` | string | ❌ | `app` | 应用类型：`app`/`system`/`widget` |
| `version` | string | ❌ | `0.0.0` | 语义化版本号（semver） |
| `frontend` | object | ❌ | — | 前端配置（见 1.2） |
| `backend` | object | ❌ | — | 后端配置（见 1.3） |
| `extraBackends` | array | ❌ | — | 额外后端路由（见 1.4） |

### 1.2 `frontend` 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `route` | string | ✅ | 主路由路径（如 `/countdown`） |
| `routeName` | string | ❌ | 路由名称（如 `Countdown`） |
| `component` | string | ✅ | 组件路径（相对 manifest，如 `./frontend/Countdown.vue`） |
| `extraRoutes` | array | ❌ | 额外路由（见 1.2.1） |
| `widgets` | array | ❌ | 桌面小组件定义（见 1.2.2） |

#### 1.2.1 `extraRoutes` 数组项

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | ✅ | 路由路径 |
| `routeName` | string | ❌ | 路由名称 |
| `component` | string | ✅ | 组件路径 |
| `requiresAuth` | boolean | ❌ | 是否需要登录（缺省 `true`） |
| `appControl` | boolean | ❌ | 是否受应用管控（缺省 `true`） |

#### 1.2.2 `widgets` 数组项

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 小组件 id（应用内唯一） |
| `name` | string | ✅ | 显示名称 |
| `component` | string | ✅ | 组件路径 |
| `defaultSize` | object | ❌ | 默认尺寸 `{ w, h }` |
| `minSize` | object | ❌ | 最小尺寸 `{ w, h }` |
| `maxSize` | object | ❌ | 最大尺寸 `{ w, h }` |
| `description` | string | ❌ | 描述 |
| `configSchema` | object | ❌ | 配置 schema（见 1.2.2.1） |

##### 1.2.2.1 `configSchema.fields` 数组项

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | string | ✅ | 配置键 |
| `label` | string | ✅ | 显示标签 |
| `type` | string | ✅ | 字段类型：`select`/`text`/`bool`/`number` |
| `options` | array | ❌ | select 类型的选项列表 `[{ value, label }]` |
| `default` | any | ❌ | 默认值 |

### 1.3 `backend` 字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mountPath` | string | ✅ | 挂载路径（如 `/api/countdown`） |
| `entry` | string | ✅ | 入口文件路径（相对 manifest，如 `./backend/routes.js`） |

### 1.4 `extraBackends` 数组项

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mountPath` | string | ✅ | 挂载路径 |
| `entry` | string | ✅ | 入口文件路径 |

---

## 2. 示例

### 2.1 最小应用

```json
{
  "name": "notes",
  "label": "笔记",
  "frontend": {
    "route": "/notes",
    "component": "./frontend/Notes.vue"
  },
  "backend": {
    "mountPath": "/api/notes",
    "entry": "./backend/routes.js"
  }
}
```

### 2.2 完整应用（含 widgets + extraRoutes + extraBackends）

```json
{
  "name": "resource",
  "label": "资源",
  "icon": "/resources/public/icons/Files.png",
  "color": "#5856D6",
  "category": "desktop",
  "order": 5,
  "defaultEnabled": true,
  "canDisable": true,
  "type": "app",
  "version": "1.0.0",
  "frontend": {
    "route": "/resource",
    "routeName": "Resource",
    "component": "./frontend/Resource.vue",
    "extraRoutes": [
      { "path": "/cloud", "routeName": "CloudDrive", "component": "./frontend/CloudDrive.vue" }
    ]
  },
  "backend": {
    "mountPath": "/api/resources",
    "entry": "./backend/routes.js"
  },
  "extraBackends": [
    { "mountPath": "/api/cloud", "entry": "./backend/cloud-routes.js" }
  ]
}
```

---

## 3. 验证规则

`validateManifest(m)` 返回 `{ valid, errors, warnings, manifest }`：

- **errors**（阻断性）：`name`/`label` 缺失或非字符串
- **warnings**（非阻断）：
  - `name` 不符合 kebab-case
  - `type`/`category` 不在枚举中（降级为默认值）
  - `version` 不符合 semver
  - `frontend.route`/`frontend.component` 缺失
  - `backend.mountPath`/`backend.entry` 缺失
  - `extraBackends` 项缺少 `mountPath`/`entry`

**策略**：聚合器加载 manifest 后调用 `validateManifest`，`errors` 阻断挂载，`warnings` 仅 `console.warn` 不阻断。

---

## 4. 聚合流程

```
apps/*/manifest.json
        │
        ├─→ server/src/core/manifest-loader.js（fs 扫描）
        │       └─→ server/src/core/route-aggregator.js（挂载 Express 路由）
        │
        └─→ client/src/core/manifest-loader.js（import.meta.glob）
                ├─→ client/src/core/router-aggregator.js（注册 vue-router）
                ├─→ client/src/core/store-aggregator.js（注册 Vuex 模块）
                ├─→ client/src/core/widget-aggregator.js（注册桌面小组件）
                └─→ client/src/core/app-registry.js（注册桌面图标）
```

---

## 5. 版本演进

| 版本 | 变更 |
|------|------|
| 1.0 | 初始规范：name/label/icon/color/category/order/defaultEnabled/canDisable/frontend/backend |
| 1.1 | 新增 `extraBackends`（阶段 0：云盘合并到资源仓库） |
| 1.2 | 新增 `type`/`version` 字段（阶段 3：对齐 Ditto 规范） |
