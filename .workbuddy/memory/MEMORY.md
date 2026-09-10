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
设计文档：`docs/ecosystem-design.md`（886 行，含 §12 与 Ditto 的边界）。四仓库/目录：主仓库 `ClassIntra`、市场 `D:\NetWork\Integration\market`、文档站 `D:\NetWork\Integration\ClassIntra_docs`（VitePress）。

- **路线决策（2026-09-10 第七轮，用户确认，勿再反复询问）**：采纳**方案 B**。**ClassIntra = 专注班级内网系统**（自建轻内核，保持 Vue2.7 + `var`/`function` + Express + better-sqlite3 与「同页面自由」模型）；**Ditto = 通用 WebOS**（并行独立产品线，互不替代）；**captive = 无关附属项目**，不在范围内。顶层含义：CI **不需要自建通用操作系统内核**，模块化目标是支撑自身业务按需扩展 —— 这正是「同页面自由」轻量模型优于「沙盒+权限+多窗口」重模型的根本理由。

- **已定的四项决策**（用户确认，勿再反复询问）：①第三方接入 = **真·同页面运行时装载**（非 iframe 沙箱，开放完整 DOM/window/localStorage 权限）②一体化四项都重要（视觉令牌 / 导航状态栏 / 数据账号 / 桌面安装）③权限模型开放、不设沙箱、信任开发者 ④交付形态先文档后代码。
- **两套加载器是既存事实，不合并**：官方 `apps/*` 走 `import.meta.glob('../../../apps/*/manifest.json',{eager:true})` + `shared/src/manifest-schema.js` 的 `validateManifest`；第三方 `market-apps/*` 走 `server/src/core/market-service.js` 扫描 + `client/src/core/market-registry.js` 动态 `<script>` + 独立 `_validateMarketManifest()`。**`market-apps/` 不被前端 manifest-loader 扫描，也不经 manifest-schema 校验**——给市场 manifest 加新字段必须改 `_validateMarketManifest()`，否则静默丢弃。
- **设计原则**：一条令牌两套载体（第三方靠 AppShell 挂载时注入 `--ci-*` 到容器根节点获得主题跟随，零代码）；SDK 即设计系统（`context.ui.*` 返回原生 DOM 片段而非 Vue 组件，规避无构建步骤）；能力命名空间隔离（`ci:app:<name>:` 前缀）；契约优于约定（`context.app.onDestroy` + 劫持计时器/监听器自动回收）；兼容交给构建、自由交给运行时。
- **不加 Shadow DOM**（三条理由）：令牌继承需 `adoptedStyleSheets`（Chrome80 支持有限）、与"同页面自由"决策冲突、`backdrop-filter` 跨边界采样异常。
- **同页面自由的风险兜底三层**：契约层（文档+工具让正确做法更省事）、运行时层（ErrorBoundary + 卸载审计：快照 window 键/劫持计时器与监听器/清理 storage 命名空间）、审查层（安装前静态扫描，非运行时沙箱）。
- **兼容红线（第三方必读）**：第三方 `entry.js` **不过 Vite 构建**，拿不到 `@vitejs/plugin-legacy` 与 PostCSS 的 flex-gap polyfill / `-webkit-` 前缀。故第三方代码禁用 `const`/`let`/箭头函数/模板字符串/`?.`/`??`/`class`/`||=`，且不能依赖 flex-gap。官方应用有构建兜底，第三方没有。实时通道必须走 `context.data.realtime`（HTTP 长轮询），**禁止直接用 WebSocket**（腾讯 X5/TBS 不可靠）。
- **待修正的既存问题（第八轮已解决 `bot-admin` type）**：~~`apps/bot-admin/manifest.json` 的 `type` 应为 `app`~~ ✅ 已改；剩余：`shared/src/manifest-schema.js` 需新增 `sdk`/`capabilities`/`layout` 字段；`sdk` 版本校验缺失（当前不满足时静默）；`D:\NetWork\Integration\ClassIntra_docs\docs\development\third-party.md` 讲的是 `.vue` 应用开发，与市场应用实作不符，需重写；缺脚手架 `packages/create-classintra-app`。本地参考文档已产出 `docs/third-party-development.md`（可直接迁移到文档站）。
- **视觉割裂实证（第八轮已计量修复）**：`market-apps/gomoku` 改造前 `style.css` 仅 39 行、自建 `gomoku-*` 类名体系、零 `--ci-*` 引用；改造后 180 行、14 种令牌引用、消费 `context.ui.*` 5 种片段、深色模式可跟随。15 个官方应用本就使用 `AppNavBar`，第三方现由 AppShell 统一提供。

## 四类模块定位判据（2026-09-10 第八轮确立，最高优先级，勿再摇摆）
文档：`docs/ecosystem-design.md` §1.5「四类模块的定位（术语基准）」+ `docs/third-party-development.md` §0。

**一句话判据（按序判定，命中即止）**：
1. 有没有「自己的一屏」（用户可进入的独立界面 + 独立路由）？ → 有 → **应用 App**
2. 是不是只改「系统外观」？ → 是 → **主题 Theme**
3. 它替换的组件是不是「系统级共享」？ → 是 → **组件 Component**（第一方内置能力）
4. 以上都不是 → **插件 Plugin**

**判据强化**：**一段前端 JS ≠ 应用**。桥接脚本、事件监听器、拦截器都属插件的实现手段；只有渲染出用户可进入的独立界面才算应用。

**四类能力位（`KIND_CAPABILITIES`，见 `client/src/core/runtime-kernel.js`）**：
- app：`hasUI:true, hasRoute:true, hasDesktopEntry:true, hasBackend:'optional', affectsVisualOnly:false`
- plugin：`hasUI:false, hasRoute:false, hasDesktopEntry:false, hasBackend:true, affectsVisualOnly:false`
- theme：`hasUI:false, hasRoute:false, hasDesktopEntry:false, hasBackend:false, affectsVisualOnly:true`
- component：`hasUI:true, hasRoute:false, hasDesktopEntry:false, hasBackend:false, affectsVisualOnly:false`

**第三方可开发范围 = 三类**（应用 / 插件 / 主题）。**组件刻意封闭**：第三方无构建步骤、无法 import Vue SFC，其对外形态是 `context.ui.*` 返回的原生 DOM 片段。

**三套异构 manifest schema（勿混用）**：`apps/*` 与 `market-apps/*` → `classintra-app` 风格；`themes/*` → `classintra-theme/v1`（`type: light|dark`）；`theme-extensions/*` → `classintra-theme-extension/v1`（`type: dynamic`，含 `apply.js`/`dynamic-color.js`/`tokens.js`）。

**已按判据修正**：`apps/bot-admin/manifest.json` 的 `type` 已由 `plugin` 改回 `app`（它有 `frontend.route:/bot-admin` 与 `frontend.component:./frontend/BotAdmin.vue`，有独立界面）。

## 生态一体化运行时内核资产（2026-09-10 第八轮落地，第一期+第二期 ✅）
- **`client/src/core/runtime-kernel.js`**（约 600 行）：`BootOrchestrator`（9 阶段 `BOOT_STAGES = ['polyfills','errors','components','services','sdk','realtime','market','mount','ready']`，**单阶段 handler 抛错只记录 + 派发 `stage-error`，不 rethrow、不阻断后续**）+ `LifecycleMachine`（`idle→loading→active⇄suspended→idle`，另有 `error` 可重试；`LIFECYCLE_TRANSITIONS` 显式表，**非法跃迁主动抛错不静默**）+ `ResourceAuditor`（`begin()` 快照 window 键 + 劫持 `setTimeout`/`setInterval`/`addEventListener`；`suspend()` 调 `recycleTimers()`；`end()` 全量回收 + diff window 键报告全局污染）+ `ModuleRegistry`（四类统一注册，差异用能力位表达）+ `RuntimeKernel`/`getRuntimeKernel()`。
- **`client/src/core/token-injector.js`**（约 260 行）：`collectTokens()` 用 `getComputedStyle(documentElement)` **双路采集**（`--ci-`/`--ios-` 前缀 + `TOKEN_EXACT` 白名单），缓存键 `data-theme + '|' + data-no-motion`；`inject(el)` 写内联 `style.setProperty` 到容器根节点；`clean(el)` 精确移除。这是「零代码主题跟随」的实现点。
- **`client/src/core/market-sdk.js`**（约 400 行）：`createContext`/`createNamespacedStorage`/`detectChromeVersion`/`detectIsX5`/`detectCapability`。storage 前缀强制 `ci:app:<name>:`；`context.app.onDestroy` **幂等**（已卸载则立即执行）；`context.__internal.dispose` 逆序执行清理；v1 兼容层用 getter 保留旧字段（`api`/`websocket`/`route`/`user`/`toast`…）。
- **`client/src/core/market-sdk-ui.js`**（约 480 行）：12 个 DOM 片段 `button/card/list/badge/segmented/toggle/searchBar/emptyState/spinner/toast/sectionTitle/toolbar` + `el` 逃生舱，均返回 `{root, update(fn), destroy()}`；CSS 注入到 `#ci-sdk-ui-styles`，类名 `ios-*`。
- **`client/src/components/AppShell.vue`**（约 330 行）：应用统一容器，props `appName`(必填)/`title`/`showNavbar`/`shellMode`/`state`/`errorMessage`；`mounted` 时同步注入令牌（避免闪烁）+ 订阅 `themeEngine.subscribe` 重注入。
- **三段式卸载契约（顺序不可换）**：`disposeContext(name)`（执行应用 `onDestroy`）→ `definition.unmount(container)` → `machine.unmount()`（资源审计回收）。落点在 `client/src/core/market-registry.js` 的 `unmount()`。
- **平板省电**：`MarketRuntime.vue` 监听 `document.visibilitychange`，`document.hidden` → `kernel.suspend(name)` 回收计时器；恢复 → `kernel.resume(name)`。
- **SDK 全局入口**：`window.ClassIntraMarket`（别名 `window.ClassIntra`），含 `version/apps/define/createContext/disposeContext/diagnostics/moduleSummary`。
- **验证基线（回归必跑）**：内核行为 23 项、令牌注入 16 项、SDK 五命名空间 28 项、gomoku 装载 19 项（含深色模式令牌跟随）、`npx vite build`、`pnpm verify:modules` 删除式自测、第三方兼容红线扫描 0 违规。
- **视觉割裂量化基线（改造前 → 后）**：gomoku `style.css` 令牌引用种类 0 → 14；SDK UI 片段使用 0 → 5 种；深色模式跟随 ❌ → ✅。

## 体验品质基线（2026-09-10 第九轮确立，改动须遵守）
规范：`docs/ecosystem-design.md` §5.5（体验品质规范）+ `docs/third-party-development.md` §5.5。质量门：**`pnpm verify:motion`**（`scripts/motion-verify.js`）。

- **产品价值（用户明确要求）**：「注重用户使用体验，以及德芙般的流畅和视觉体验」。规范已把口号翻译成可验证硬指标。
- **视觉基线**：**iOS 为主基线，鸿蒙为可接受对标**。策略 = 以 iOS 令牌为准绳，**鸿蒙差异作「可选适配层」而非第二套体系**；**不引入鸿蒙专用令牌**，未来确需适配走主题包（`themes/*`）覆盖令牌值。
- **动效铁律三条**：①禁 CSS 关键字曲线（`ease`/`ease-in`/`ease-out`；**循环动画的 `linear` 豁免**）②禁写秒数，必须用 `--duration-*` ③**退出时长 ≤ 进入时长**（iOS HIG 核心节奏，最易忽略；一般取进入的 0.6 倍）。
- **动效映射（10 项要点）**：按压反馈/状态切换/悬停 → `fast + standard`；容器展开 → `normal + emphasized`；内容淡入淡出 → `normal + standard`；模态进入 → `normal + decelerate`；**模态退出 → `fast + accelerate`**；回弹 → `normal + spring`；循环动画 → 固定 0.8s/1.2s（节奏参数，可硬编码）；跟随手指 → **0s（禁过渡）**。
- **只动合成属性**：`transform`/`opacity` 可跳过布局与绘制。禁 `width`/`height`/`top`/`left`/`margin`/`padding`/`background-position`。**豁免规则（须同时满足）**：`scale` 无法还原该效果（圆→方的 `border-radius`、pill 圆角被拉伸）+ 面积 < 200px²。已登记 2 处（`RecordModal.vue` 录音按钮圆形 56px↔方形 24px、`DesktopPageIndicator.vue` 6px↔18px 长条），代码内均标 `规范例外` 注释。
- **毛玻璃三层降级**（`client/src/core/perf-policy.js` + `client/src/styles/_motion.scss`）：`[data-perf="low"]` 设备能力 / `[data-scrolling="1"]` 滚动感知（停止 120ms 恢复）/ `[data-glass="flat"]` 用户开关（与 `data-no-motion` 联动）；另有 `[data-engine="x5"]` 内核标记。**关键：降级只改质感不改布局（无重排）**。层级规范：导航栏/侧边栏/模态 ✅、卡片 ⚠️单屏 ≤3、列表项 ❌、大面区 ❌。CSS 用**后代通配**覆盖（全仓 90 处多引用 `var(--glass-blur-*)`，通配一次覆盖，且仅降级条件命中时参与匹配）。
- **性能预算**：TTI ≤2.0s / 路由切换 ≤300ms / 应用挂载 ≤500ms / 交互响应 ≤100ms / 滚动 ≥50fps / 动画 ≥55fps / 令牌注入 ≤5ms / 主题切换 ≤100ms。诊断页 `/dev/perf` 待第四期交付。
- **已修复的既存缺陷（勿回退）**：①`global.scss` 的 `--duration-*` 原**无兜底值**（`var(--ci-motion-duration-fast)`），解析失败会导致 transition 丢失时长、动效消失——已补 `.15s/.25s/.35s`，与 `--ease-*` 模式对齐；②`--transition-slow` 误引用 `--duration-normal`，已改 `--duration-slow`；③`SuperIsland.vue` 两处 CSS 语法错误（多余右括号 + 属性段缺逗号，导致 CSS 丢弃后续声明）；④`market-sdk-ui.js` **6 处 flex `gap`** 在 Chrome 80 间距全塌陷（`gap` 需 Chrome 84+），已改相邻兄弟选择器 `> * + *` + `margin`——**SDK 是公共依赖，第三方无构建兜底，此处最易埋坑**。
- **批量改 CSS 的方法论教训**：①脚本文件清单必须用 `grep -rl` **动态生成**，不可手工列举（曾漏 11 个文件致三轮返工）；②替换 `transition` 声明必须做**括号深度感知的逗号拆分**，否则 `cubic-bezier(a, b, c, d)` 的内部逗号会被当属性分隔符，破坏语法；③审计器需识别 `var(--transition-*)` 是**组合令牌**（已含时长+曲线）、`transition` 简写中**第二个时间值是 delay**（可硬编码），否则误报。

## Ditto WebOS 项目（2026-09-10 发现，参照对象；**结论：并行不合并**）
> **最终定位（同日第七轮定案）**：Ditto 是**并行独立产品线**（通用 WebOS），**不是** ClassIntra 的内核，CI 也**不**基于 Ditto 重构。只吸收**设计模式思路**，**不复用任何代码**。文档见 `docs/ecosystem-design.md` §12（含 7 维度不可融合对照表 + 六项可借鉴模式 + 六项明确不复用清单）。
> **隔离模型互斥是根本原因**：Ditto `iframe-strict` 默认不下发 `allow-same-origin`（第三方必然拿不到主页面 DOM）⟺ CI「同页面自由」要求直接持有主页面 DOM。两条路线架构上不可调和。
> **六项可借鉴（仅思路）**：①分阶段生命周期编排 + 单阶段失败不中断 ②应用生命周期状态机（CI 建议 `idle→loading→active→suspended` + suspend/resume）③能力声明显式化（CI 因开放模型改为**披露而非拦截**）④打包签名思路（CI **不建议加密**）⑤SDK 按能力域命名分层（印证 CI 五命名空间方向正确）⑥最低版本约束（`minDittoVersion` ⟺ CI 的 `sdk` 字段）。

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
