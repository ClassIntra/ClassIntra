# ClassIntra 模块化架构

> 核心理念：**一切皆可扩展；无插件、无可选模块，核心也能正常构建与运行。**

ClassIntra 由「核心（Core）+ 三类模块源」构成。核心是源码级、不可移除的
基础设施；模块（apps/ 应用、plugins/ 插件、market-apps/ 市场应用）以
「目录 + `manifest.json`」的形式存在，可整体增删、热插拔（市场应用），
或由管理员在运行时启停（`app_control`）。

## 1. 分层

| 层 | 位置 | 内容 | 可否移除 |
|----|------|------|----------|
| **核心** | `client/src`、`server/src`、`shared/src`、`themes/` | 登录/账户、桌面壳（Desktop）、超能岛浏览器（Browser）、公告/封禁、manifest 聚合（loader/aggregator/registry）、主题；服务端认证、`/api/system/*`、WS 基础服务、relay-bus | 否 |
| **应用** | `apps/<name>/` | 前端页面 + 可选后端 + 小组件；`type: app/system` | 是（settings/admin 属必需系统模块） |
| **插件** | `plugins/<name>/` | 独立后端扩展（必带 backend），可携带前端桥接与 shared 契约；`type: plugin` | 是 |
| **市场应用** | `market-apps/<name>/` | 运行时安装/卸载的第三方模块 | 是 |

## 2. 边界规则（硬约束）

1. **核心必须无模块可用**：核心不得依赖任何模块目录存在。
   - 服务端：只允许经 `manifest-loader` 注册表 + `server/src/core/optional-module.js`
     （存在性加载，缺失返回 `null`，调用方降级）访问模块后端。其缓存语义：
     仅缓存**成功**的加载结果（周期任务不会反复执行模块顶层代码）；
     require 失败不缓存，瞬时故障（热更新替换、文件临时损坏）下次调用自动自愈，
     无需重启核心；模块升级后可用 `forceReload` 或 `clearCache()` 显式失效；
   - 客户端：只允许经 `import.meta.glob`（构建期存在性探测，缺失为空映射 +
     noop 降级）访问模块前端/契约。
2. **禁止静态跨模块引用**：核心代码不得出现 `require/import`
   `apps/<x>/...`、`plugins/<x>/...` 的具体路径（历史遗留已清零，破坏该约束
   会导致删除式自测失败）。
3. **依赖方向单向**：模块 → 核心（`shared/src`、核心导出）合法；
   核心 → 模块仅限上面的存在性访问。模块之间尽量通过契约/事件解耦。
4. **兜底名单跟随 manifest**：任何「全部启用」类的 fallback 必须由
   `loadManifests()` / `manifest-loader` 现场推导，禁止硬编码模块名列表
   （`client/src/router/index.js`、`server/src/routes/system.js` 均已收敛）。

## 3. 模块状态可观测

`GET /api/system/modules`（需登录）聚合三类模块源，返回每个模块：

```jsonc
{ "code": 200, "data": { "count": 12, "modules": [ {
  "name": "weather", "label": "天气", "type": "app", "source": "app",
  "category": "desktop", "order": 5,
  "defaultEnabled": true, "canDisable": true,
  "hasFrontend": true,
  "backend": { "mountPath": "/api/weather", "entryAvailable": true }
} ] } }
```

- 管理页据此展示「已安装 / 可启停 / 后端入口缺失」状态；
- 客户端据此做存在性降级判断。

## 4. 模块被移除后发生什么（已由删除式自测覆盖）

| 场景 | 行为 |
|------|------|
| 服务端启动 | `manifest-loader` 对不存在目录静默跳过；`route-aggregator` 不挂载缺失路由 |
| 天气提醒调度 | `app.js`/`app-https.js` 探测到 weather 模块缺失 → 调度停用并告警一次，核心正常启动 |
| admin 手动天气检查 | `routes/admin.js` 返回 404「天气模块未安装」而非抛错 |
| Browser 内嵌联动 | `campusbili-bridge-client.js` 落到 noop 桥接，仅停用 campusbili 联动，浏览其它站点不受影响 |
| 桌面图标 / 路由 | 由 manifest 聚合自动消失；保存过的布局（dock/文件夹/widgets）由 desktop store 孤儿清理 |
| 应用管控 | `/system/app-control` 与前端 fallback 从实际 manifest 推导启用名单 |

## 5. 删除式自测（质量门）

```bash
pnpm verify:modules           # L1（删 plugins+market-apps）+ L2（再删可选业务应用）全量
pnpm verify:modules:plugins   # 仅 L1
pnpm verify:modules:apps      # 仅 L2
```

`scripts/modularity-verify.js` 行为（**零删除**，对生产目录零影响）：

1. 在系统临时目录建快照：
   - `client`、`server` **真实拷贝**（robocopy /MT，排除 node_modules/dist）——
     二者若为 junction，会分别触发 rollup 绝对路径 emit 报错、以及 manifest-loader
     经 realpath 反推出生产根导致验证失真；node_modules 单独 junction；
   - `shared`、`themes` 整体 junction；
   - **模块源不挂载即视为删除**：L1 不挂载 `plugins/`、`market-apps/`（apps/ 整体
     junction 保留全部应用）；L2 仅真实拷贝必需系统模块 `settings`/`admin`。
     注意：不能对模块子项建 junction —— Windows 下 junction 子项的
     `Dirent.isDirectory()` 为 false，server 的 manifest-loader 按 isDirectory
     扫描会全部跳过；
2. `vite build`（快照内临时 outDir，不污染真实 `dist`）；
3. 隔离端口/DB 冷启动快照 `server`（`NODE_PATH` 指向快照 server/node_modules，
   与生产一致，供 apps 后端 bare import 解析），冒烟 `/api/system/health` 与
   `/api/system/version`；
4. 判定：L1 应挂载全部应用且天气调度正常；L2 应 0 路由挂载、天气调度优雅停用，
   两轮均构建/启动/冒烟通过 → 退出码 0。

> 说明：better-sqlite3 为 native 模块，自测会用与生产一致的 Node（默认取
> `Program Files\nodejs\node.exe`）；可用环境变量 `NODE_EXE` 覆盖。

## 6. 新增模块 Checklist

1. `mkdir {apps,plugins,market-apps}/<kebab-name>`，编写 `manifest.json`
   （`type`、`label`、`icon`、`category`、`order`、`defaultEnabled`/`canDisable`，
   应用可声明 `frontend.route/component/widgets`，应用/插件可声明 `backend`）；
2. 需要后端 → `backend/routes.js` 导出 Express router，聚合器自动挂载 +
   可按 manifest 声明的 `rateLimit` 限流；
3. 需要前端 → 组件/小组件放入 `frontend/`，由 glob 自动进入路由与桌面；
4. **核心想要使用模块能力** → 不得直接 import：服务端走
   `optional-module`，客户端走存在性探测层（示例：`integrations/campusbili-bridge-client.js`）；
5. 跑一遍 `pnpm verify:modules` 确认未破坏「无模块可用」。
