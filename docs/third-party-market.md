# 第三方应用市场与五子棋

## 概述

ClassIntra 的第三方应用市场用于分发独立应用包。应用不需要合并到 ClassIntra 官方内置应用目录，班管可以从市场源安装、更新、启用、禁用和卸载应用，普通成员通过实时同步获得统一的应用状态。

当前首个示例应用是五子棋，市场源代码位于：

- [ClassIntra/market](https://github.com/ClassIntra/market)
- [五子棋目录](https://github.com/ClassIntra/market/tree/main/apps/gomoku)

ClassIntra 主仓库：

- [ClassIntra/ClassIntra](https://github.com/ClassIntra/ClassIntra)

## 用户如何获取应用

用户不需要把整个 `market` 仓库下载到本地，也不需要拥有 ClassIntra 官方服务器。ClassIntra 运行所在的班级服务器会作为安装客户端，直接从 GitHub 获取单个应用需要的文件：

1. 请求 GitHub Raw 上的 `index.json`，获得应用目录和文件清单。
2. 管理员选择应用，例如 `gomoku`。
3. ClassIntra 只下载该应用 manifest、图标、前端入口、样式和后端入口。
4. 文件写入 ClassIntra 本地的 `market-apps/<app-name>/` 目录。
5. 下载完成后在本地运行，用户不需要访问 GitHub 仓库页面。

当前官方市场源使用：

```text
https://raw.githubusercontent.com/ClassIntra/market/main/
```

因此实际下载的是类似下面的单文件地址，而不是整个仓库：

```text
https://raw.githubusercontent.com/ClassIntra/market/main/apps/gomoku/frontend/entry.js
```

`market` 仓库只负责托管应用包和目录索引；班级服务器负责缓存、安装、运行、更新和卸载。后续如果应用包增长较大，可以将 catalog 的 `source` 扩展为 GitHub Release 压缩包或对象存储，但用户体验仍保持为“在应用市场点击安装”。

## 设计目标

第三方应用生命周期遵循桌面操作系统式体验：

1. 班管从应用市场选择应用并安装。
2. 服务端将应用包原子写入运行时目录，并热挂载后端路由。
3. 前端刷新市场注册表、动态路由和桌面布局。
4. 应用资源按需加载，不要求重启服务。
5. 更新和卸载时清理旧资源、运行实例和入口。
6. 生命周期事件通过实时通道同步给全班成员。

应用启用/禁用是班级统一状态，不是每个成员独立设置。班管负责安装、更新和卸载，普通成员不需要重复安装。

## 应用包结构

```text
market/
├── index.json
└── apps/
    └── gomoku/
        ├── manifest.json
        ├── icon.svg
        ├── frontend/
        │   ├── entry.js
        │   └── style.css
        └── backend/
            └── routes.js
```

`index.json` 是市场目录，应用清单描述应用名称、版本、图标、文件列表以及前后端入口。

## Gomoku manifest

```json
{
  "name": "gomoku",
  "type": "app",
  "version": "1.0.0",
  "label": "五子棋",
  "icon": "./icon.svg",
  "category": "desktop",
  "frontend": {
    "route": "/gomoku",
    "entry": "./frontend/entry.js",
    "style": "./frontend/style.css"
  },
  "backend": {
    "mountPath": "/api/gomoku",
    "entry": "./backend/routes.js"
  }
}
```

市场运行时与内置 Vue 应用不同：前端入口通过 `window.ClassIntraMarket.define()` 注册运行时定义，使用 `mount(container, context)` 和 `unmount(container)` 实现插拔。

## 前端 SDK 上下文

市场应用通过 `window.ClassIntraMarket.createContext(appName)` 获得上下文：

- `context.api`：带有 `/api` 基础路径和认证能力的 Axios 实例。
- `context.router`：ClassIntra Vue Router 实例。
- `context.store`：ClassIntra Vuex store。
- `context.user`：当前登录用户。
- `context.theme`：主题引擎。
- `context.eventBus`：全局事件总线。
- `context.toast` 与 `context.modal`：统一提示和弹窗能力。

应用不应直接修改 ClassIntra 核心路由表或桌面状态，应通过市场运行时上下文和生命周期接口完成集成。

## 五子棋 API

所有接口都挂载在 `/api/gomoku` 下：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/state` | 获取当前棋局状态 |
| POST | `/move` | 落子，参数为 `{ "row": 0, "col": 0 }` |
| POST | `/reset` | 重置当前棋局 |

棋盘为 15×15。当前棋局按用户标识隔离；如果没有用户标识，则使用请求中的 `x-gomoku-room`，最后回退到默认房间。

错误状态：

- `400`：坐标不合法。
- `409`：位置已有棋子或棋局已经结束。
- `404`：应用被禁用或已经卸载。

## 生命周期

### 安装

安装操作会：

1. 读取 Local 或 GitHub 市场源的 catalog。
2. 校验应用名、manifest、文件路径、扩展名和文件大小。
3. 将应用写入临时目录。
4. 原子替换 `market-apps/<app-name>`。
5. 写入默认启用状态。
6. 热挂载后端路由。
7. 广播 `market_app_changed` 的 `installed` 事件。

### 更新

更新复用安装的校验与原子替换机制，成功后重新加载版本对应的前端资源并广播 `updated` 事件。更新不要求重启服务。

### 启用与禁用

班管调用应用管控接口后，服务端更新统一的 `app_control` 状态并广播：

```json
{
  "type": "market_app_control_changed",
  "appName": "gomoku",
  "enabled": false,
  "updatedBy": "999999"
}
```

客户端收到事件后刷新市场注册表、动态路由、桌面、Dock、文件夹和小组件入口。当前正在运行的应用被禁用时自动返回桌面。

### 卸载

卸载会卸载运行实例、移除动态后端挂载、清理已加载的脚本和样式、删除桌面相关入口，并广播 `uninstalled` 事件。已移除的 API 路径返回 JSON 404，不会错误地进入 SPA fallback。

## 验证清单

```bash
cd server
pnpm test

cd ../client
pnpm run build
```

浏览器端至少验证：

- 直接访问 `/gomoku` 能恢复异步注册前的初始路径。
- 页面显示 225 个棋位。
- 黑棋可以落子，状态切换为白棋。
- 禁用后当前页面返回桌面。
- 重新启用后可以再次打开应用。
- 卸载后静态资源和 API 都返回 404。

## 致谢与来源

五子棋市场应用的交互方向、游戏能力迁移和部分实现思路参考了 [MoyuZJ912/iFlyCompass](https://github.com/MoyuZJ912/iFlyCompass) 提供的开源代码与产品探索。感谢 iFlyCompass 项目为 ClassIntra 第三方应用生态提供可借鉴的游戏、工具和交互设计来源。

ClassIntra 的市场运行时、安装更新卸载机制、班级统一管控、动态资源加载和 ClassIntra SDK 适配由 ClassIntra 项目独立实现。请在二次开发或再次分发时同时遵守相关项目的许可证和署名要求。

相关仓库：

- [iFlyCompass](https://github.com/MoyuZJ912/iFlyCompass)
- [ClassIntra 主仓库](https://github.com/ClassIntra/ClassIntra)
- [ClassIntra 文档仓库](https://github.com/ClassIntra/classintra.github.io)
- [ClassIntra 市场仓库](https://github.com/ClassIntra/market)
