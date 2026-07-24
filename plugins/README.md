# ClassIntra 插件目录

插件是 ClassIntra 的**独立扩展模块**，与应用（apps/）和主题（themes/）相互独立。

## 与应用的区别

| 维度 | 应用（apps/） | 插件（plugins/） |
|------|---------------|------------------|
| 前端页面 | 有（`frontend/`） | 无 |
| 后端路由 | 可选（`backend/`） | 必有（`backend/`） |
| 桌面图标 | 显示在桌面 | 不显示（category: hidden） |
| 小组件 | 可携带 widgets | 不携带 |
| manifest.type | `app` / `system` | `plugin` |
| 联动契约 | 无 | 可选（`integration` 字段） |

## 目录结构

```
plugins/
├── campusbili-bridge/
│   ├── backend/routes.js     # 后端身份验证 API
│   ├── shared/contract.js    # 联动契约（消息格式、动作枚举、校验）
│   ├── frontend/bridge.js    # 前端桥接模块（ClassIntra 侧 postMessage 封装）
│   ├── manifest.json         # type: "plugin" + integration 声明
│   └── README.md
└── package.json              # 插件后端依赖
```

## 加载机制

- **后端**：`server/src/core/manifest-loader.js` 扫描 `plugins/*/manifest.json`，挂载 `backend.mountPath` 到 Express
- **前端桥接**：客户端通过 `client/src/integrations/campusbili-bridge-client.js` re-export 插件桥接模块
- **前端聚合**：插件不参与前端 manifest 聚合（无路由页面）

## 联动架构（campusbili-bridge 示例）

campusbili-bridge 插件是 ClassIntra 与 CampusBili 之间联动的**单一职责入口**：

```
[ClassIntra Browser.vue]
        │
        ▼
[client/src/integrations/campusbili-bridge-client.js]  ← 客户端集成入口（re-export）
        │
        ▼
[plugins/campusbili-bridge/frontend/bridge.js]           ← 前端桥接模块（postMessage 封装）
        │
        ▼ postMessage（契约驱动）
        │
[CampusBili client/src/utils/classintra-bridge.js]      ← CampusBili 侧桥接工具
        │
        ▼
[CampusBili VideoView.vue]                              ← 业务页面
```

### 联动契约（shared/contract.js）

- **消息格式**：`{ type, v, source, action, payload, timestamp }`
- **来源标识**：`SOURCE_CLASSINTRA = 'classintra-browser'`、`SOURCE_CAMPUSBILI = 'campusbili'`
- **父→子动作**：request-mute / video-control / request-playback-status / request-page-info
- **子→父动作**：classintra-back / classintra-ping / campusbili-playback-status / campusbili-share-request / campusbili-page-info
- **安全**：父→子必须用具体 origin（禁止 '*'）；子→父用 '*'（父端按 source + iframe.source 过滤）

### CampusBili 侧契约同步

CampusBili 是独立项目，无法直接引用 ClassIntra 插件，需 vendored 一份契约副本：
- **来源**：`ClassIntra/plugins/campusbili-bridge/shared/contract.js`
- **副本**：`CampusBili/client/src/utils/classintra-bridge-contract.js`
- **同步规则**：ClassIntra 侧契约更新时，副本必须同步更新

## 新增插件

1. 在 `plugins/` 下新建目录（kebab-case）
2. 创建 `manifest.json`，`type` 字段为 `"plugin"`
3. 创建 `backend/routes.js` 导出 Express router
4. 如需前端联动，创建 `shared/contract.js` + `frontend/bridge.js`，在 manifest.json 声明 `integration` 字段
5. 如需新依赖，在 `plugins/package.json` 中声明并运行 `npm install`
