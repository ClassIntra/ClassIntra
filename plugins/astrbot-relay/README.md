# AstrBot Relay — 将 AstrBot 机器人接入 ClassIntra 私聊

机器人（如"林晞"）以**独立真实账号**登录 ClassIntra 的 WebSocket 聊天服务，
用户私聊机器人后，插件把消息通过 SSH 隧道转发给 AstrBot 的 HTTP API
（完整管线：人设 / 工具调用 / 会话记忆 / 指令系统），再把回复以机器人身份
分段发回 ClassIntra。

```
用户私聊"林晞"
  → ClassIntra WS (10001) → 本插件（机器人账号在线）
  → POST http://localhost:9999/api/chat （SSH 正向隧道 -L 9999）
  → AstrBot 插件 astrbot_plugin_classintra → 完整管线 → message_chain
  ← 本插件解析消息链，以林晞身份分段发出（图片落盘 Resources/astrbot/ 原生渲染）
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

ASTRBOT_API=http://localhost:9999   # AstrBot API（SSH 正向隧道目标）
ASTRBOT_TOKEN=                      # 与 AstrBot 插件 api_token 一致，可留空
AB_API_TIMEOUT=65000
AB_MAX_SEGMENTS=3
AB_ASYNC_ENABLED=false              # 反向隧道就绪后改 true
AB_CALLBACK_BASE=http://localhost:7000
# AB_ALLOWED_USERS=250800,250802    # 留空=所有人可用
# AB_HEAVY_KEYWORDS=画图,生成图,海报,写作文,分析文件
```

3. 在 Bot 服务器（AstrBot）侧打通正向隧道（Windows 本机执行，见下）。
4. 重启 ClassIntra 后端。启动时插件自动：
   - 在 users 表创建机器人账号（幂等）；
   - 登录并保持 WS 长连接（断线 3s 起指数退避重连，JWT 7 天过期自动重登）。

## SSH 隧道（Windows 本机 → Bot 服务器）

```powershell
# 正向隧道：本插件访问 AstrBot HTTP API（端口按 AstrBot 插件 api_port 配置）
ssh -fN -L 9999:localhost:6200 -o ServerAliveInterval=60 user@bot-server

# 反向隧道（可选，异步任务回调）：AstrBot 回调本插件
ssh -fN -R 7000:localhost:9001 -o ServerAliveInterval=60 user@bot-server
```

## 验证

- `curl http://localhost:9001/api/astrbot/status` → `"connected": true`
- 用另一个账号在 ClassIntra 网页端私聊"林晞"发消息，观察回复。

## 消息段映射

| AstrBot message_chain | ClassIntra 呈现 |
| --- | --- |
| plain | 文本消息（多段按 300-800ms 间隔模拟真人分段，默认上限 3 段） |
| image / record / video / file | 资源下载到 `Resources/astrbot/remote/`，以 `/resources/...` 站内 URL 发送，前端原生渲染 |
| at | `@昵称` 文本 |

## 已知边界

- 群聊 @触发、语音输入暂未实现（私聊优先）。
- ClassIntra 私聊 WS 限流 30 条/分钟（服务端约束），机器人回复计入同一额度。
- 反向隧道未就绪时请保持 `AB_ASYNC_ENABLED=false`，重任务自动走同步。
