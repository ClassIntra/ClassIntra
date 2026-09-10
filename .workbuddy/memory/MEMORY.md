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
