# AstrBot Relay — 将 AstrBot 机器人接入 ClassIntra 私聊

机器人（如"林晞"）以**独立真实账号**登录 ClassIntra 的 WebSocket 聊天服务，
用户私聊机器人后，插件作为 **OneBot v11 客户端**连入本机 AstrBot 的
aiocqhttp 反向 WS（6199），走完整管线（人设 / 插件 / 记忆 / 指令系统），
回复的消息段（文本/图片/语音/视频/文件/音乐）落地为站内资源后发回 ClassIntra。

当前部署为**本机同机运行**，无 SSH / Tunnels / 外网依赖：

```
用户私聊"林晞"
  → ClassIntra WS (10001) → 本插件（机器人账号在线）
  → OneBot v11 反向 WS（ws://127.0.0.1:6199/ws，X-Client-Role: universal）
  → AstrBot 管线：parser(B站解析) / music(点歌) / meme_manager(表情包) / LLM…
  ← AstrBot 下发 send_private_msg（消息段数组）
  ← base64:// 与 file:// 媒体段 → 复制到 Resources/astrbot/remote/ → 站内 URL
  ← 按句末标点分段，以林晞身份发出
```

## 安装

1. 本目录位于 ClassIntra 仓库 `plugins/astrbot-relay`（聚合器自动扫描挂载）。
2. 在 `server/.env` 中追加：

```dotenv
# ===== AstrBot 接入（OneBot v11）=====
BOT_USER_ID=linxi_ai          # 机器人账号（自动创建）
BOT_NET_NAME=林晞
BOT_REAL_NAME=林晞
BOT_PASSWORD=改成强密码        # 必填（同时用于自动建号与 WS 登录）
BOT_GENDER=女

ASTRBOT_WS_URL=ws://127.0.0.1:6199/ws   # AstrBot aiocqhttp 反向 WS
ASTRBOT_WS_TOKEN=                        # 反向 WS 令牌（与适配器配置一致）
AB_MAX_SEGMENTS=3             # 单次回复最多分段数（避免触发发送限流）
ASTRBOT_PUBLISH_KEY=改成长随机串 # 论坛发帖接口共享密钥（与 AstrBot 端 astrbot_plugin_classintra 的 publish_key 一致）
# AB_ALLOWED_USERS=250800     # 留空=所有人可用
```

3. AstrBot 侧：WebUI → 机器人 → 新增 `aiocqhttp` 适配器
   （ws_reverse_host=127.0.0.1，ws_reverse_port=6199）。
4. 重启 ClassIntra 后端。启动时插件自动：
   - 在 users 表创建机器人账号（幂等）；
   - 登录 CI WS 并保持长连接（断线指数退避重连）；
   - 连入 OneBot 反向 WS（需要 `X-Client-Role: universal` + `X-Self-ID` 头）。

## HTTP 接口

| 端点 | 鉴权 | 说明 |
| --- | --- | --- |
| `GET /api/astrbot/status` | 管理员会话 | 机器人连接状态 |
| `POST /api/astrbot/publish` | 请求头 `x-publish-key` = `ASTRBOT_PUBLISH_KEY` | 以机器人账号在社区论坛发帖（AstrBot 端 LLM 工具 `publish_classintra_post` 回调）。body（text/plain JSON，附图较大不受 1MB 限制）：`{title?, content, anonymous?, images?: [{base64}\|{url}], visible_groups?, hidden_groups?, tags?}`；`images` 最多 9 张，持久化到 botmedia 后以 Markdown `![](url)` 追加进正文 |

## 消息段映射

**AstrBot → CI（出站）**

| OneBot 段 | ClassIntra 呈现 |
| --- | --- |
| text | 文本（按句末标点分段，300-800ms 间隔模拟真人连发，默认上限 3 段） |
| image / record / video（base64:// 或 file://） | 落盘 `Resources/astrbot/remote/`，以 `/resources/...__image/__audio/__video` 站内 URL 发送 |
| file（file:// URI） | 同上落盘发送 |
| music(custom) | `🎵 标题 链接` 文本 |
| at | `@昵称` 文本 |
| reply | `（回复：原文摘要…）` 前缀 |
| location / share / poke / contact | 对应中文提示文本 |
| nodes(合并转发) | 展平为多条文本/媒体 |
| json/xml 卡片 | 提取标题与跳转链接 |

**CI → AstrBot（入站）**

| CI 消息 | OneBot 段 |
| --- | --- |
| text / ai_forward | text（ai_forward 提取正文） |
| `[cloud-img:hash.ext]` | image（base64，多模态模型可直接看图，实测经 zhipu 视觉描述成功） |
| `[cloud-audio:hash.ext]` | record（base64，可走 ASR） |
| `[cloud-video:hash.ext]` | video（file:// 本机路径） |
| 消息撤回 `message_recalled` | notice: friend_recall / group_recall |
| 连接/心跳 | meta_event: lifecycle(connect) / heartbeat(30s) |

## 支持的 OneBot action（QQ 协议面）

- 消息：send_private_msg / send_msg / send_group_msg / send_private_forward_msg / send_group_forward_msg / delete_msg
- 信息：get_msg / get_login_info / get_stranger_info / get_friend_list / get_version_info / get_status
- 群：get_group_list / get_group_info / get_group_member_list / get_group_member_info（查询 CI 数据库实时返回，群成员/群名真实）
- 媒体：get_image / get_record / can_send_image / can_send_record
- 群管/文件类（CI 无对应能力）：set_group_* / upload_*_file / get_*_file_url 等——受理返回 ok，不中断管线
- 未识别 action 一律返回 ok 空数据

## 验证

- `curl http://localhost:9001/api/astrbot/status` → `"onebot": {"connected": true}`
- 用另一个账号私聊"林晞"：发 B站链接 → parser 自动回视频；`点歌 歌名` → music 回歌曲。

## 故障排查

- `onebot.connected: false`：AstrBot 未启动（`start-astrbot.cmd`）或 6199 未监听；
  握手需带 `X-Client-Role` 与 `X-Self-ID` 头，缺一即 400。
- 媒体显示"资源加载失败"：file:// 指向的文件不存在或已清理。
- LLM 相关回复报 402：聊天模型 Key 余额不足（parser/music 等插件不依赖 LLM，不受影响）。

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
