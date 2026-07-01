<p align="center">
  <img src="https://img.shields.io/badge/deploy-Windows%20%7C%20Linux-blue" alt="Deploy: Windows/Linux">
  <img src="https://img.shields.io/badge/node-18%2B-brightgreen?logo=nodedotjs" alt="Node 18+">
  <img src="https://img.shields.io/badge/database-SQLite-003b57?logo=sqlite" alt="SQLite">
  <img src="https://img.shields.io/badge/Vibe_Coding-AI_%2B_%E4%BA%BA%E5%B7%A5-ff6b6b" alt="Vibe Coding">
</p>

# 📡 ClassIntra 部署文档

> 从零搭建到多机中继的完整指南

## 1. 系统要求

### 硬件要求

- CPU: 2核心及以上
- 内存: 2GB 及以上
- 硬盘: 1GB 可用空间
- 网络: 局域网环境，支持 TCP 9001/10001/10011 端口

### 软件要求

| 组件 | 最低版本 | 推荐版本 |
|------|---------|---------|
| Node.js | 18.0+ | 20.x LTS |
| pnpm | 8.0+ | 10.x |
| 操作系统 | Windows 10 / Linux | Windows 11 / Ubuntu 22.04 |

***

## 2. 安装步骤

### 2.1 获取项目

```bash
git clone <repository-url> ClassIntra
cd ClassIntra
```

项目目录结构：

```
ClassIntra/
├── server/                # 后端服务（Express + SQLite + WebSocket）
│   ├── src/
│   │   ├── app.js         # Express 入口
│   │   ├── ws/            # WebSocket 服务
│   │   ├── routes/        # REST API 路由
│   │   ├── utils/         # 工具函数（数据库初始化、经验系统等）
│   │   ├── services/      # 业务服务（天气、AI等）
│   │   ├── config/        # 配置模块
│   │   └── middleware/    # 中间件（认证等）
│   ├── config/
│   │   └── pre-records.example.json  # 预注册名单模板
│   ├── database/          # SQLite 数据库（自动创建，已 gitignore）
│   └── .env.example       # 环境变量模板
├── client/                # 前端项目（Vue 2 + Vite）
│   ├── src/
│   │   ├── views/         # 页面组件
│   │   ├── components/    # 通用组件
│   │   ├── store/         # Vuex 状态管理
│   │   ├── router/        # 路由配置
│   │   ├── utils/         # 工具函数
│   │   └── styles/        # 全局样式
│   └── vite.config.js
├── Resources/             # 资源文件（已 gitignore，需自行准备）
│   └── public/
│       ├── level/         # 等级图标
│       ├── wallpaper/     # 壁纸
│       ├── weather-icons/ # 天气图标
│       ├── pdfjs/         # PDF 预览
│       └── music/         # 音乐文件
├── start.bat              # Windows 启动脚本
├── start.sh               # Linux 启动脚本
├── build.bat              # 生产构建脚本
├── pnpm-workspace.yaml    # pnpm monorepo 配置
└── package.json           # monorepo 根配置
```

### 2.2 安装依赖

```bash
# 安装 pnpm（如未安装）
npm install -g pnpm

# 安装所有依赖（monorepo）
cd ClassIntra
pnpm install
```

### 2.3 配置环境变量

复制 `server/.env.example` 为 `server/.env` 并修改：

```env
PORT=9001
WS_PORT=10001
JWT_SECRET=<替换为32位以上随机字符串>
JWT_EXPIRES_IN=7d
ADMIN_USER_IDS=250100,250800
# 班管不预创建账号 — 学生用预注册名单中的真实姓名注册后自动获得管理员权限
# DEV_PASSWORD 用于创建开发测试账号 (ID: 999999)，可选
# DEV_PASSWORD=dev123456
QWEATHER_KEY=<和风天气API密钥>
QWEATHER_LOCATION=<经度,纬度，如 116.41,39.92>
AI_API_KEY=<AI服务API密钥>
AI_API_URL=https://api.openai.com/v1/chat/completions
AI_MODEL=gpt-3.5-turbo
```

> 完整环境变量说明见下方 [3.1 环境变量详解](#31-环境变量详解)

### 2.4 配置预注册名单（可选）

如需限制注册用户，创建 `server/config/pre-records.json`：

```bash
cp server/config/pre-records.example.json server/config/pre-records.json
```

编辑 `pre-records.json`，填入允许注册的用户信息：

```json
{
  "class08": [
    { "real_name": "张三", "user_id": "0801", "gender": "男" }
  ],
  "class18": [
    { "real_name": "李四", "user_id": "1801", "gender": "女" }
  ]
}
```

> 此文件包含个人信息，已被 `.gitignore` 排除，不会提交到仓库。

### 2.5 初始化数据库

```bash
cd server
node src/utils/init-db.js
```

数据库将自动创建 `database/classintra.db`，包含：

- 数据表结构
- 预注册记录（如已配置 pre-records.json）
- 班管权限（用户注册后，若其 ID 匹配 `ADMIN_USER_IDS`，自动获得管理员权限）
- 默认广播消息

### 2.6 开发模式启动

```bash
# 方式一：使用根目录脚本（同时启动前后端）
pnpm dev

# 方式二：分别启动
pnpm dev:server   # 后端 :9001
pnpm dev:client   # 前端 :5001（Vite 开发服务器，自动代理 API）

# 方式三：使用启动脚本
# Windows
start.bat
# Linux/Mac
chmod +x start.sh && ./start.sh
```

### 2.7 生产构建与部署

```bash
# 方式一：使用构建脚本
build.bat

# 方式二：手动构建
pnpm build                    # 构建前端
mkdir -p server/public
cp -r client/dist/* server/public/

# 启动生产服务
cd server
NODE_ENV=production node src/app.js
```

生产环境下，Express 同时提供 API 和前端静态文件，只需暴露一个端口。

***

## 3. 配置说明

### 3.1 环境变量详解

| 变量 | 说明 | 默认值 | 必填 |
|------|------|--------|------|
| PORT | HTTP 服务端口 | 9001 | 否 |
| WS_PORT | WebSocket 端口 | 10001 | 否 |
| JWT_SECRET | JWT 签名密钥 | 无（必须设置，否则无法启动） | **是** |
| JWT_EXPIRES_IN | Token 有效期 | 7d | 否 |
| ADMIN_USER_IDS | 班管ID（逗号分隔，格式YYCC00） | 无 | 否 |
| DEV_PASSWORD | 开发者账号密码（ID: 999999） | 空 | 否 |
| COHORT | 届数（毕业年份后两位） | 自动推断 | 否 |
| RELAY_PORT | 中继服务端口 | 10011 | 否 |
| HTTPS | 启用 secure cookie（生产环境建议 true） | false | 否 |
| VERBOSE_LOG | 详细活动日志（1=启用） | 0 | 否 |
| TAILSCALE_STATUS_CMD | Tailscale 状态命令路径 | tailscale status --json | 否 |
| QWEATHER_KEY | 和风天气 API Key | 空 | 否* |
| QWEATHER_LOCATION | 天气位置（经度,纬度） | 空 | 否* |
| QWEATHER_API_HOST | 和风天气 API 地址 | devapi.qweather.com | 否 |
| QWEATHER_KID | 和风天气 JWT KID | 空 | 否 |
| QWEATHER_SUB | 和风天气 JWT SUB | 空 | 否 |
| QWEATHER_PRIVATE_KEY | 和风天气 JWT 私钥 | 空 | 否 |
| AI_API_KEY | AI 服务 API Key | 空 | 否* |
| AI_API_URL | AI 服务地址 | 空 | 否 |
| AI_MODEL | AI 模型名称 | gpt-3.5-turbo | 否 |
| DEEPSEEK_API_KEY | DeepSeek API Key | 空 | 否* |
| DEEPSEEK_API_URL | DeepSeek API 地址 | https://api.deepseek.com/chat/completions | 否 |
| DEEPSEEK_MODEL | DeepSeek 模型名称 | deepseek-chat | 否 |
| TAVILY_API_KEY | Tavily 搜索 API Key | 空 | 否 |
| TAVILY_API_URL | Tavily 搜索 API 地址 | https://api.tavily.com/search | 否 |
| RESOURCES_DIR | 资源目录路径 | ../Resources | 否 |
| DB_PATH | 数据库文件路径 | ./database/classintra.db | 否 |
| RELAY_SERVERS | 中继服务器地址（逗号分隔） | 空 | 否 |
| RELAY_SECRET | 中继认证密钥 | 空 | 否 |
| RELAY_SERVER_ID | 本服务器标识 | 空 | 否 |
| CORS_ORIGINS | CORS 允许的源 | 空 | 否 |
| SYNCTHING_HOST | Syncthing 主机 | localhost | 否 |
| SYNCTHING_PORT | Syncthing 端口 | 8384 | 否 |
| SYNCTHING_API_KEY | Syncthing API Key | 空 | 否 |
| TAILSCALE_ENABLED | 是否启用 Tailscale | false | 否 |
| TAILSCALE_RELAY_IP | Tailscale 中继 IP | 空 | 否 |

\*天气和AI功能需要配置对应API Key才能使用

### 3.2 管理员与班干配置

**班管（班级管理员）**：通过 `ADMIN_USER_IDS` 配置（逗号分隔），ID 格式为 YYCC00（如 250100）。
班管拥有班级全部管理权限，包括：用户管理、广播管理、班干设置、系统设置等。

**班干（班级干部）**：由班管在"系统管理"面板中从注册用户中指定，可分配具体权限（如管理用户、管理广播等），并设置头衔（如"班长""学习委员"）。班干的权限由班管灵活配置。

首次启动时，系统自动创建班管账号，初始密码由 `ADMIN_PASSWORD` 环境变量指定。

***

## 4. 数据库说明

### 4.1 数据表结构

| 表名 | 说明 | 关键字段 |
|------|------|---------|
| users | 注册用户 | user_id, net_name, real_name, is_admin |
| pre_records | 预注册名单 | real_name, user_id, gender |
| broadcasts | 系统广播 | content, priority |
| chat_messages | 公共聊天消息 | room_id, sender_id, content |
| private_messages | 私信 | sender_id, receiver_id, content |
| groups | 群组 | id, name, creator_id, is_class_group |
| group_messages | 群消息 | group_id, sender_id, content |
| conversations | AI对话 | user_id, title, messages_json |
| user_settings | 用户设置 | user_id, theme, wallpaper |
| admin_logs | 管理日志 | admin_id, action, target |
| user_experience | 用户经验 | user_id, level, exp, login_streak |
| community_posts | 社区帖子 | author_id, title, content |
| community_comments | 社区评论 | post_id, author_id, content |
| user_kv_store | 用户键值存储 | user_id, key, value |
| weather_alert_settings | 天气预警设置 | schedule_time, enabled |

### 4.2 数据库备份

```bash
# SQLite 数据库文件位于
server/database/classintra.db
# 直接复制该文件即可完成备份
cp server/database/classintra.db backup/classintra_$(date +%Y%m%d).db
```

***

## 5. 测试验证

### 5.1 服务启动验证

```bash
# 检查后端服务
curl http://localhost:9001/api/assets/wallpapers

# 检查前端页面
curl http://localhost:9001
```

### 5.2 功能验证清单

- [ ] 用户注册：使用预注册名单中的姓名注册
- [ ] 用户登录：使用姓名/学号/网名登录
- [ ] 聊天系统：公共聊天室、群聊、私聊
- [ ] 天气系统：查看天气信息（需配置API Key）
- [ ] AI聊天：发起对话（需配置API Key）
- [ ] 社区系统：发帖、评论、点赞
- [ ] 资源仓库：浏览文件、搜索、预览、下载
- [ ] 音乐播放：播放音乐、歌词显示
- [ ] 笔记系统：创建和管理笔记
- [ ] 设置页面：修改主题、壁纸、个人信息
- [ ] 管理后台：用户管理、广播管理（仅管理员）

### 5.3 管理员验证

1. 使用预注册名单中的真实姓名注册（ID 匹配 `ADMIN_USER_IDS` 即自动获得管理员权限）
2. 登录后访问 `/admin` 路径
3. 验证用户管理、广播管理功能

***

## 6. 故障排除

### 6.1 常见问题

**Q: 启动报错 "FATAL: JWT_SECRET environment variable must be set"**
A: 必须在 `server/.env` 中设置 `JWT_SECRET`，值为32位以上的随机字符串。

**Q: 启动报错 "Cannot find module 'better-sqlite3'"**
A: 运行 `pnpm install` 重新安装依赖。better-sqlite3 需要原生编译，确保已安装 Node.js 构建工具。

**Q: 前端页面空白**
A: 检查是否已执行 `pnpm build` 并将 `dist` 目录复制到 `server/public`。

**Q: WebSocket 连接失败**
A: 检查 `WS_PORT`（默认10001）是否被占用，确认防火墙允许该端口。

**Q: 天气/AI功能不工作**
A: 需要在 `.env` 中配置 `QWEATHER_KEY` 和 `AI_API_KEY`。

**Q: 登录后提示"登录已过期"**
A: 检查 `JWT_SECRET` 配置，确保服务器重启后 SECRET 未变化。

**Q: 资源仓库无法加载文件**
A: 确认 `Resources` 目录存在且路径正确。默认路径为项目根目录下的 `Resources`。

### 6.2 端口冲突

```bash
# Windows 查看端口占用
netstat -ano | findstr :9001
netstat -ano | findstr :10001

# Linux 查看端口占用
lsof -i :9001
lsof -i :10001
```

***

## 7. 系统架构

```
浏览器 → :9001 (Express)
           ├── /api/*        → REST API
           ├── /resources/*  → 静态资源
           └── /*            → Vue SPA
         :10001 (WebSocket)
           ├── /ws           → 聊天实时通信（客户端）
           └── :10011 (Relay) → 服务器间中继（跨班级联动）
```

***

## 8. 跨班级聊天联动部署

### 8.1 功能说明

通过 WebSocket 中继（Relay）机制，可以让部署在不同网络的多个 ClassIntra 实例的公共聊天室消息实时同步。

### 8.2 中继环境变量

| 变量 | 说明 | 默认值 | 必填 |
|------|------|--------|------|
| RELAY_SERVERS | 对端服务器中继地址（逗号分隔） | 空 | 是* |
| RELAY_SECRET | 中继认证密钥（两台服务器必须相同） | 空 | 是* |
| RELAY_SERVER_ID | 本服务器标识（用于区分消息来源） | 空 | 否 |

\*仅需要跨班级联动时配置

### 8.3 同一局域网部署

**A 班服务器** (`server/.env`)：

```env
RELAY_SERVERS=ws://192.168.1.100:10011/relay
RELAY_SECRET=your-relay-secret-here
RELAY_SERVER_ID=class-a
```

**B 班服务器** (`server/.env`)：

```env
RELAY_SERVERS=ws://192.168.2.100:10011/relay
RELAY_SECRET=your-relay-secret-here
RELAY_SERVER_ID=class-b
```

> **注意**：`RELAY_SECRET` 在两台服务器上必须完全相同，否则认证会失败。

### 8.4 跨网络部署（推荐 Tailscale）

如果两个班级在不同网络，使用 **Tailscale** 创建虚拟组网：

1. 在两台服务器上安装 Tailscale：`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`
2. 获取 Tailscale IP：`tailscale ip -4`（类似 `100.64.0.1`）
3. 验证连通性：`ping <对端Tailscale IP>`
4. 配置中继：

**A 班服务器**：
```env
RELAY_SERVERS=ws://100.64.0.2:10011/relay
RELAY_SECRET=your-relay-secret-here
RELAY_SERVER_ID=class-a
```

**B 班服务器**：
```env
RELAY_SERVERS=ws://100.64.0.1:10011/relay
RELAY_SECRET=your-relay-secret-here
RELAY_SERVER_ID=class-b
```

5. 重启服务器，观察控制台输出 `[Relay] Authenticated with` 即表示成功

### 8.5 中继工作原理

```
A班服务器                          B班服务器
┌─────────────┐    WebSocket     ┌─────────────┐
│  Express     │    Relay连接     │  Express     │
│  WS :10001   │◄──────────────►│  WS :10001   │
│  SQLite DB   │  /relay 路径    │  SQLite DB   │
│  clients{}   │                  │  clients{}   │
└──────┬───────┘                  └──────┬───────┘
       │                                 │
  A班平板们                           B班平板们
  连接 /ws                            连接 /ws
```

### 8.6 跨班级功能支持

| 功能 | 跨班级支持 | 说明 |
|------|-----------|------|
| 公共聊天室消息 | 支持 | 实时同步 |
| 消息历史记录 | 支持 | 中继消息存入双方数据库 |
| 表情消息 | 支持 | 实时同步 |
| 私聊 | 不支持 | 暂不支持跨服务器私聊 |
| 群聊 | 不支持 | 暂不支持跨服务器群聊 |
