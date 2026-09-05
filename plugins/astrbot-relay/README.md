# AstrBot Relay — 将 AstrBot 机器人接入 ClassIntra 私聊

机器人（如"林晞"）以**独立真实账号**登录 ClassIntra 的 WebSocket 聊天服务，
用户私聊机器人后，插件调用 **AstrBot v4.27+ 内置 OpenAPI**（与 WebUI 同端口），
走完整管线（人设 / 工具调用 / 会话记忆 / 指令系统），再把回复以机器人身份
按句子分段发回 ClassIntra。

当前部署为**本机同机运行**，无 SSH / Tunnels / 外网依赖：

```
用户私聊"林晞"
  → ClassIntra WS (10001) → 本插件（机器人账号在线）
  → POST http://127.0.0.1:6185/api/v1/chat（AstrBot 内置 OpenAPI，SSE）
  ← SSE 事件：session_id → run_started → plain(正文) → complete → end
  ← 本插件按句末标点分段，以林晞身份发出
```

## 安装

1. 本目录位于 ClassIntra 仓库 `plugins/astrbot-relay`（聚合器自动扫描挂载）。
2. 在 `server/.env` 中追加：

```dotenv
# ===== AstrBot 接入 =====
BOT_USER_ID=linxi_ai          # 机器人账号（自动创建）
BOT_NET_NAME=林晞
BOT_REAL_NAME=林晞
BOT_PASSWORD=改成强密码        # 必填（同时用于自动建号与 WS 登录）
BOT_GENDER=女

# AstrBot 内置 OpenAPI（v4.27+，与 WebUI 同端口；本机部署直接回环地址）
ASTRBOT_API=http://127.0.0.1:6185
ASTRBOT_API_KEY=abk_xxx       # AstrBot WebUI → 设置 → OpenAPI 创建（仅需 chat 权限）
ASTRBOT_TOKEN=                # 旧版自定义 API 的共享令牌，用内置 API 时留空
AB_API_TIMEOUT=65000
AB_MAX_SEGMENTS=3             # 单次回复最多分段数（避免触发发送限流）
AB_ASYNC_ENABLED=false
# AB_ALLOWED_USERS=250800     # 留空=所有人可用
# ASTRBOT_DATA_DIR=D:/NetWork/Integration/AstrBot/data  # 媒体直读目录
```

3. 重启 ClassIntra 后端。启动时插件自动：
   - 在 users 表创建机器人账号（幂等）；
   - 登录并保持 WS 长连接（断线 3s 起指数退避重连，JWT 过期自动重登）。

## SSE 解析与分段规则

- 只消费 `type:"plain"` 事件的 `data` 作为正文（自动去重相邻重复段）；
- `complete` / `end` 结束；`error` 事件转为错误处理；
- 回复按 `。！？!?；;` 与换行拆分为多条消息，模拟真人连发；
- 超过 `AB_MAX_SEGMENTS` 的段自动合并。

## 媒体与表情包（内网零外网加载）

- **AI 生成的图片/语音/视频/文件**：SSE 的 image/record/video/file 事件 →
  从 AstrBot 数据目录（`attachments`，缺省回退 `webchat/imgs`）**同机复制**到
  `ClassIntra/Resources/astrbot/remote/`，以 `/resources/...__image/__audio/__video`
  站内 URL 发送，前端原生渲染。CI 使用设备无需访问外网。
- **表情包 `&&标签&&`**：独占一行的表情标记映射为
  `Resources/astrbot/emoji/<标签>.png|gif...` 的站内图片 URL；
  没有对应图片文件时保留原文本。把真实表情图放入 emoji 目录即可生效。

## 验证

- `curl http://localhost:9001/api/astrbot/status` → `"connected": true`
- 用另一个账号在 ClassIntra 网页端私聊"林晞"发消息，观察回复。

## 故障排查

- 林晞回复"林晞好像生病了"：AstrBot 未启动（`start-astrbot.cmd`）或 6185 未监听；
- 回复"（xx 资源缺失）"：AstrBot 数据目录路径不对，检查 `ASTRBOT_DATA_DIR`；
- 表情显示为 `&&xxx&&` 文本：`Resources/astrbot/emoji/` 下没有对应图片文件。

## 消息段映射

| AstrBot SSE 事件 | ClassIntra 呈现 |
| --- | --- |
| plain | 文本消息（按句末标点分段，300-800ms 间隔模拟真人连发，默认上限 3 段） |
| image / record / video / file | 同机复制到 `Resources/astrbot/remote/`，以 `/resources/...` 站内 URL 发送，前端原生渲染 |
| &&表情标签&&（独占一行） | 映射到 `Resources/astrbot/emoji/` 本地图，无图时保留原文本 |

## 已知边界

- 群聊 @触发、语音输入暂未实现（私聊优先）。
- ClassIntra 私聊 WS 限流 30 条/分钟（服务端约束），机器人回复计入同一额度。
- `AB_ASYNC_ENABLED` 异步模式当前未启用（本机部署无隧道需求，同步即可）。
