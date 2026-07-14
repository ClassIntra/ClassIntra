# ClassIntra 插件目录

插件是 ClassIntra 的**后端扩展模块**，与应用（apps/）相互独立。

## 与应用的区别

| 维度 | 应用（apps/） | 插件（plugins/） |
|------|---------------|------------------|
| 前端页面 | 有（`frontend/`） | 无 |
| 后端路由 | 可选（`backend/`） | 必有（`backend/`） |
| 桌面图标 | 显示在桌面 | 不显示（category: hidden） |
| 小组件 | 可携带 widgets | 不携带 |
| manifest.type | `app` / `system` | `plugin` |

## 目录结构

```
plugins/
├── campusbili-bridge/
│   ├── backend/routes.js
│   ├── manifest.json     # type: "plugin"
│   └── README.md
└── package.json          # 插件后端依赖
```

## 加载机制

- **后端**：`server/src/core/manifest-loader.js` 扫描 `plugins/*/manifest.json`，挂载 `backend.mountPath` 到 Express
- **前端**：插件不参与前端聚合（无 frontend 字段）

## 新增插件

1. 在 `plugins/` 下新建目录（kebab-case）
2. 创建 `manifest.json`，`type` 字段为 `"plugin"`
3. 创建 `backend/routes.js` 导出 Express router
4. 如需新依赖，在 `plugins/package.json` 中声明并运行 `npm install`
