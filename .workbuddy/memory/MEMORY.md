# ClassIntra 项目长期记忆

## 模块化架构约束（2026-09-09 确立，改动需遵守）
- 分层：核心（client/src + server/src + shared/src + themes/，不可移除）与模块（apps/ 应用、plugins/ 插件、market-apps/ 市场应用，均为可选、按 manifest.json 注册）。
- 硬约束：核心禁止静态 require/import 具体模块路径；服务端访问模块后端只能经 `server/src/core/optional-module.js`（存在性加载，缺失返回 null 并降级）；客户端经 `import.meta.glob` 存在性探测 + noop 降级。兜底名单一律由 loadManifests() 推导，禁硬编码。
- 质量门：`pnpm verify:modules`（删除式自测，临时快照零删除，L1 无插件/L2 仅 settings+admin，均须 build+boot+核心冒烟通过）。详见 `docs/modular-architecture.md`。
- 迁移提示：新增模块请勿在核心代码里直接 import 它，否则删除式自测失败。

## 聊天系统关键约束（2026-09-10 确立）
- **新增消息表字段时，必须同步更新所有读取该字段的 SELECT**。历史教训：`private_messages.recalled` 已入库且撤回写入正确，但 REST（`apps/chat/backend/routes.js`）与 WS（`server/src/ws/chat-server.js` 的 `stmtGetPrivateHistory`）两处私聊历史查询漏选该字段，导致撤回状态在重新加载历史时被丢弃、消息"复活"。公共聊天室与群聊的历史查询当时是完整的，只有私聊漏——所以出现"特别是私聊"的现象。改字段时请对照三个表（chat_messages / private_messages / group_messages）× 三处读取（REST 聊天模块 / WS chat-server / relay-sync）。
- **better-sqlite3 的 statement 方法（`run`/`get`/`all`）必须以 statement 本身为 `this` 调用**。禁止 `stmt.all.apply(null, values)` —— 会抛 `TypeError: Illegal invocation`。正确写法：`var stmt = db.prepare(sql); stmt.all.apply(stmt, values);`。此类错误在 `server/src/utils/relay-handlers.js` 曾导致中继（跨服务器/AstrBot 侧）消息入库与推送整条链路静默失败，表观症状是"对方发消息不实时到、要刷新页面"。
- **中继链路排查入口**：`server/src/utils/relay-bus.js`（registry + processRelayed）+ `server/src/utils/relay-handlers.js`（各事件 handler）。服务端错误日志里搜 `[RelayBus]` 前缀可快速定位中继异常。
- **poll 长轮询游标必须用单调递增序号（seq），不能用响应时刻的时间戳**。`client/src/utils/websocket.js` 与服务端 `/api/chat/poll` 现约定 `since_seq` / `last_seq`（`chat-server.js` 的 `pollSeqCounter`）。时间戳游标会在"事件入队早于响应返回"时永久跳过事件。注意首次 poll 的 `since_seq=0` 必须走序号分支（判定用 `Number.isFinite` 而非 `> 0`）。
- **离线验证原生模块**：本机 managed Node 22 与 `better-sqlite3` 的 ABI 不匹配（`ERR_DLOPEN_FAILED`），诊断脚本须用系统 Node `C:\Program Files\nodejs\node.exe`（NODE_MODULE_VERSION 137），并在 `server/` 目录下加载 `.env`（`DB_PATH=./database/classintra.db` 是相对路径）。

## 生态一体化设计基线（2026-09-10 确立，实施须遵守）
设计文档：`docs/ecosystem-design.md`。四仓库/目录：主仓库 `ClassIntra`、市场 `D:\NetWork\Integration\market`、文档站 `D:\NetWork\Integration\ClassIntra_docs`（VitePress）。

- **已定的四项决策**（用户确认，勿再反复询问）：①第三方接入 = **真·同页面运行时装载**（非 iframe 沙箱，开放完整 DOM/window/localStorage 权限）②一体化四项都重要（视觉令牌 / 导航状态栏 / 数据账号 / 桌面安装）③权限模型开放、不设沙箱、信任开发者 ④交付形态先文档后代码。
- **两套加载器是既存事实，不合并**：官方 `apps/*` 走 `import.meta.glob('../../../apps/*/manifest.json',{eager:true})` + `shared/src/manifest-schema.js` 的 `validateManifest`；第三方 `market-apps/*` 走 `server/src/core/market-service.js` 扫描 + `client/src/core/market-registry.js` 动态 `<script>` + 独立 `_validateMarketManifest()`。**`market-apps/` 不被前端 manifest-loader 扫描，也不经 manifest-schema 校验**——给市场 manifest 加新字段必须改 `_validateMarketManifest()`，否则静默丢弃。
- **设计原则**：一条令牌两套载体（第三方靠 AppShell 挂载时注入 `--ci-*` 到容器根节点获得主题跟随，零代码）；SDK 即设计系统（`context.ui.*` 返回原生 DOM 片段而非 Vue 组件，规避无构建步骤）；能力命名空间隔离（`ci:app:<name>:` 前缀）；契约优于约定（`context.app.onDestroy` + 劫持计时器/监听器自动回收）；兼容交给构建、自由交给运行时。
- **不加 Shadow DOM**（三条理由）：令牌继承需 `adoptedStyleSheets`（Chrome80 支持有限）、与"同页面自由"决策冲突、`backdrop-filter` 跨边界采样异常。
- **同页面自由的风险兜底三层**：契约层（文档+工具让正确做法更省事）、运行时层（ErrorBoundary + 卸载审计：快照 window 键/劫持计时器与监听器/清理 storage 命名空间）、审查层（安装前静态扫描，非运行时沙箱）。
- **兼容红线（第三方必读）**：第三方 `entry.js` **不过 Vite 构建**，拿不到 `@vitejs/plugin-legacy` 与 PostCSS 的 flex-gap polyfill / `-webkit-` 前缀。故第三方代码禁用 `const`/`let`/箭头函数/模板字符串/`?.`/`??`/`class`/`||=`，且不能依赖 flex-gap。官方应用有构建兜底，第三方没有。实时通道必须走 `context.data.realtime`（HTTP 长轮询），**禁止直接用 WebSocket**（腾讯 X5/TBS 不可靠）。
- **待修正的既存问题**：`apps/bot-admin/manifest.json` 的 `type` 应为 `app`（当前误写 `plugin`，但它有前端且在 `apps/` 下）；`docs/development/third-party.md` 讲的是 `.vue` 应用开发，与市场应用实作不符，需重写。
- **视觉割裂实证**：`market-apps/gomoku` 是当前唯一生态样本，`style.css` 仅 39 行、自建 `gomoku-*` 类名体系、零 `--ci-*` 引用；15 个官方应用用 `AppNavBar`，第三方 0 个。

## Ditto WebOS 项目（2026-09-10 发现，重要参照对象）
位置：`D:\NetWork\Ditto`（主仓库）+ `D:\NetWork\Ditto_docs`（VitePress 文档站，含 `docs/concepts/{kernel,cell,ipc,lifecycle,permission}.md`）。**未推送到 GitHub org（org 下只有 5 个仓库，无 Ditto）**。最后提交 2026-06-29，有大量未提交改动。

- **定位**：通用 WebOS 框架（**非校园专用**，无聊天/社区/天气业务），对标「浏览器里的操作系统」。26,612 行 TS/Vue、181 个文件、9 个 package（core/ui/services/sdk/theme/adapter/packager/cli/shared）。
- **技术栈与 ClassIntra 完全不同**：Vue 3.5 `<script setup>` + Composition API + Pinia + **TypeScript strict** + Vite 6 + **Bun + Hono 后端** + pnpm workspace + turbo + vitest。ClassIntra 是 Vue 2.7 Options API + `var`/`function` 风格 + Express + better-sqlite3。
- **核心架构（比 ClassIntra 成熟一个量级）**：
  - `DittoKernel`（`createKernel()`，已删全局单例 `getKernel()`）+ `ServiceRegistry`（工厂懒创建 + 逆序销毁）+ `LifecycleOrchestrator`（**7 阶段**：storage→events→ipc→permissions→services→cells→ready，单阶段失败不中断）
  - **Cell 对称架构**：前端 `ClientCell` ↔ 后端 `CellInstance`，经 `CellBridge`（WS + HTTP）双向通信；客户端状态机 `loading→active→paused→stopped`，服务端多冬眠态 `creating→running⇄hibernated→stopped`（`ElasticScaler` 15 分钟空闲自动冬眠）
  - **四类运行时**：`native`（Vue 组件，shadow-trusted 沙盒）/ `web`（远程 URL）/ `pwa` / `dit`（前后端对称 Cell）
  - **三档沙盒**：`iframe-strict`（第三方，强制 origin 白名单、默认 `allow-scripts` 不含 `allow-same-origin`、message 三重校验）/ `shadow-trusted`（native）/ `worker`
  - **capability 权限**：11+ 细粒度（`fs:read`/`net:fetch`/`clipboard:write`/`cell:backend`/`cell:peer`…），dev 自动授权、prod 默认拒绝、可持久化
  - **IPCBus v2**：origin 强制白名单（拒绝 `*`）、onion 中间件链、handler 异常隔离、pending request 超时清理
  - **.dit 打包**：ZIP + AES-256-GCM 加密（PBKDF2 10 万次迭代）+ Ed25519 签名；CLI `ditto pack/install/verify/publish`
  - **SDK**：10 个 Vue composable（IPC/Window/FS/Net/Auth/UI/Widget/App/Cell/Theme），`DittoSDK` plugin 注入
  - **资源治理四件套**（server）：`ResourceQuotaManager` / `TrafficShaper` / `FairScheduler` / `ElasticScaler`
  - 测试：core 下 10 个 vitest 文件覆盖 kernel/lifecycle/ipc/sandbox/permission/cell 全模块
- **与 ClassIntra 的关键取舍差异**：Ditto 用 **iframe 沙盒 + capability 权限**（保守）；ClassIntra 生态设计选了 **同页面自由 + 不加沙箱**（开放）。Ditto 的「真·操作系统」路线靠窗口管理（`DWindow`/`DTaskbar`/多窗口），ClassIntra 是「全屏应用 + 桌面网格」路线。
- **对 ClassIntra 生态设计的价值**：`docs/ecosystem-design.md` 中提出的 AppShell / 令牌注入 / SDK / 生命周期审计 / ErrorBoundary，Ditto 均已用更工程化的方式实现（沙盒层 + 权限层 + IPC 中间件）。**可直接借鉴**：7 阶段 LifecycleOrchestrator、Cell 生命周期状态机、.dit 打包加密签名、capability 权限声明、SDK composable 命名分层、`sandbox` manifest 字段、`minDittoVersion` 版本约束思路。
- **不可直接复用**：技术栈（Vue3+TS+Bun vs Vue2+var+Express）、隔离模型（沙盒 vs 同页面）、交互范式（多窗口 vs 全屏）。
