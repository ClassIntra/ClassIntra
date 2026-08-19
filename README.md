<p align="center">
  <img width="12%" align="center" src="https://img.icons8.com/fluency/240/classroom.png" alt="logo">
</p>

<h1 align="center">📱 ClassIntra</h1>
<p align="center"><strong>校园内网 WebOS 平台</strong> · 类 iOS 设计 · 横屏平板优化</p>

<div align="center">

[![星标](https://img.shields.io/github/stars/Nevino2333/ClassIntra?style=for-the-badge&color=orange&label=%E6%98%9F%E6%A0%87)](https://github.com/Nevino2333/ClassIntra)
[![开源许可](https://img.shields.io/badge/license-MIT-blue.svg?label=%E5%BC%80%E6%BA%90%E8%AE%B8%E5%8F%AF%E8%AF%81&style=for-the-badge)](LICENSE)
[![Vibe Coding](https://img.shields.io/badge/Vibe_Coding-AI_%2B_%E4%BA%BA%E5%B7%A5-ff6b6b?style=for-the-badge)](https://github.com/Nevino2333/ClassIntra)
[![平台](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue?style=for-the-badge)](https://github.com/Nevino2333/ClassIntra)
[![Node](https://img.shields.io/badge/node-18%2B-brightgreen?style=for-the-badge&logo=nodedotjs)](https://nodejs.org/)

</div>

<p align="center">
  <sub>💡 本项目采用 <strong>Vibe Coding</strong> 开发模式 — 人类构思与指导 + AI 辅助编码实现<br>作者：<strong>Nevino</strong></sub>
</p>

---

## ✨ 为什么选择 ClassIntra？

ClassIntra 为班级教室场景而生 —— 一台服务器 + 一台平板 = 完整的班级数字平台。无需外网，局域网即可运行。

|   | 功能 | 说明 |
|---|------|------|
| 🖥️ | **桌面系统** | 类 iOS 启动台，应用图标排列、壁纸切换、锁屏密码、通知中心（超能岛） |
| 💬 | **即时通讯** | 公共聊天、班级群聊（自动建群）、私聊、表情、消息撤回、群公告 |
| 🌤️ | **天气系统** | 实时天气、7 日预报、空气质量、生活指数、降雨预警动画 |
| 🤖 | **AI 对话** | OpenAI 兼容 / DeepSeek 双引擎，Tavily 联网搜索，LaTeX 数学渲染 |
| 📝 | **社区论坛** | 发帖、评论、点赞、收藏、Markdown + LaTeX 渲染 |
| 📁 | **资源仓库** | 文件浏览与搜索、PDF 在线预览、MKV/MP4 视频流播放 |
| 🎵 | **音乐播放** | 在线播放列表、LRC 歌词同步、背景播放 |
| 📒 | **笔记系统** | Markdown 编辑器、代码高亮、Mermaid 流程图、KaTeX 数学公式 |
| ⚙️ | **管理后台** | 用户管理、广播通知、班干委任、应用管控、操作日志 |

### 🔗 高级特性

- **跨班级联动** — WebSocket 中继实现多班级公共聊天室消息实时同步（支持 Tailscale 组网）
- **等级经验** — 签到、发帖、点赞获取经验，连续登录加成，排行榜
- **应用管控** — 管理员/班干可远程启用或禁用桌面上的每个应用
- **深色/浅色主题** — 跟随系统自动切换或手动选择
- **自适应布局** — 专为横屏平板（960×600）优化，同时适配桌面浏览器

---

## 🚀 快速开始

### 前置要求

- **Node.js** ≥ 18
- **pnpm** ≥ 8
- **ffmpeg**（可选，视频转码需要）

### 一分钟启动

```bash
git clone <repo-url> && cd ClassIntra
pnpm install
cp server/.env.example server/.env
# 编辑 server/.env → 设置 JWT_SECRET（必填，否则拒绝启动）
mkdir -p Resources/public/wallpapers Resources/public/music Resources/videos
pnpm dev
```

打开 `http://localhost:5001`，首次使用访问 `/setup` 完成班级初始化。

### 生产部署

```bash
pnpm build
cd server && NODE_ENV=production node src/app.js
# → http://localhost:9001
```

Windows 用户也可用 `start.bat`（开发）或 `start-prod.bat`（生产）一键启动。`cn.bat` 提供 PM2 进程管理。

> 📖 完整部署指南（多机中继、Tailscale 组网、HTTPS 配置）→ [DEPLOY.md](./DEPLOY.md)

---

## 🧭 首次配置向导

启动后访问 `/setup`，五步完成初始化：

```
① 届数        → 设置毕业年份后两位（如 25 = 2025 届）
② 班级        → 班级编号 + 名称（如 08 → 8 班）
③ 预注册名单  → 批量导入学生姓名，自动分配 YYCCNN 格式学号
④ 班管指定    → 每班选一人担任班级管理员（ID 末两位 00）
⑤ 确认保存    → 写入 .env + pre-records.json + 初始化数据库
```

学生注册时使用预注册名单中的真实姓名，系统自动匹配学号。ID 匹配 `ADMIN_USER_IDS` 即自动获得管理员权限。

---

## 🏗️ 架构

```
┌────────────── client (Vue 2 + Vite) ──────────────┐
│  :5001  Vite Dev Server (HMR + API 代理 → :9001)  │
│  桌面 · 聊天 · 天气 · AI · 社区 · 资源 · 音乐 · 笔记 │
└──────────────────────┬─────────────────────────────┘
                       │ HTTP / WebSocket
┌──────────────────────┴─────────────────────────────┐
│  :9001  server (Express + ws)                       │
│  JWT 认证 · SQLite · 15 个 API 路由 · WebSocket 聊天│
│  :10001 WebSocket · :10011 中继端口                  │
└─────────────────────────────────────────────────────┘
```

| 端口 | 服务 | 说明 |
|------|------|------|
| `5001` | Vite Dev Server | 开发热重载，自动代理 `/api` → `:9001` |
| `9001` | Express HTTP | REST API + 静态文件服务 |
| `10001` | WebSocket | 本地聊天实时通信 |
| `10011` | Relay WS | 跨班级消息中继 |

---

## 📦 技术栈

| 层 | 技术 |
|---|------|
| 前端框架 | Vue 2.7 + Vue Router 3 + Vuex 3 |
| 构建工具 | Vite 5 |
| UI 风格 | 类 iOS 设计系统（自研 ios/ 组件库） |
| 后端 | Express 4 |
| 数据库 | better-sqlite3（嵌入式，零配置） |
| 实时通信 | ws (WebSocket) |
| 认证 | JWT (jsonwebtoken + bcryptjs) |
| Markdown | marked + highlight.js + KaTeX + Mermaid |
| LaTeX | 自研渲染引擎（KaTeX 数学 + 自定义文档转换器） |
| 视频 | 自研流式转码（ffmpeg + fragmented MP4） |
| 包管理 | pnpm workspace (monorepo) |

---

## 📂 项目结构

```
ClassIntra/
├── apps/                    # 应用（前端页面 + 可选后端 + 小组件）
│   ├── ai-chat/frontend/    # AI 对话
│   ├── calendar/frontend/   # 日历 + 小组件
│   ├── calculator/frontend/ # 计算器
│   ├── chat/frontend/       # 即时通讯
│   ├── community/frontend/  # 社区论坛
│   ├── countdown/frontend/  # 倒数日 + 小组件
│   ├── music/frontend/      # 音乐播放
│   ├── notes/frontend/      # Markdown 笔记
│   ├── resource/frontend/  # 资源仓库 + 云盘
│   ├── settings/frontend/   # 个人设置
│   ├── timetable/frontend/  # 课程表 + 小组件
│   ├── weather/frontend/    # 天气系统
│   ├── admin/frontend/      # 管理后台
│   └── integration/frontend/ # 第三方应用集成入口
├── client/src/
│   ├── views/                # 核心页面
│   │   ├── Desktop.vue       # 桌面主页（应用启动台）
│   │   ├── Login.vue         # 登录
│   │   ├── Register.vue      # 注册
│   │   ├── Announcements.vue # 公告列表
│   │   ├── Browser.vue       # 内置浏览器
│   │   └── Banned.vue        # 封禁提示
│   ├── components/           # 通用组件
│   │   ├── ios/              # iOS 风格组件库（NavBar, List, Card, Switch…）
│   │   ├── island/           # 超能岛面板（通知/操作/历史/音乐/浏览器）
│   │   ├── SuperIsland.vue   # 超能岛主组件
│   │   ├── AppNavBar.vue     # 应用导航栏
│   │   ├── LockScreen.vue    # 锁屏页面
│   │   ├── ChatBubble.vue    # 聊天气泡
│   │   ├── WeatherAnimation.vue  # 天气动画
│   │   ├── ConfirmDialog.vue # 确认对话框
│   │   └── …
│   ├── store/modules/        # Vuex（auth, chat, community, music, island…）
│   ├── router/index.js       # 路由配置
│   ├── utils/                # latex-renderer, api, websocket, helpers…
│   └── styles/global.scss    # 全局样式 + CSS 变量
├── server/src/
│   ├── app.js                # Express 入口
│   ├── config/index.js       # 配置模块（从 .env 读取）
│   ├── routes/               # 15 个 API 路由
│   │   ├── auth.js           # 注册/登录
│   │   ├── user.js           # 用户信息
│   │   ├── chat.js           # 聊天消息
│   │   ├── weather.js        # 天气查询
│   │   ├── ai-chat.js        # AI 对话
│   │   ├── resource.js       # 资源文件 + 流媒体
│   │   ├── community.js      # 社区帖子
│   │   ├── notes.js          # 笔记同步
│   │   ├── admin.js          # 管理后台
│   │   ├── setup.js          # 初始化向导 API
│   │   ├── level.js          # 等级经验
│   │   ├── music.js          # 音乐服务
│   │   ├── system.js         # 系统设置
│   │   ├── assets.js         # 静态资源
│   │   └── cdn-proxy.js      # CDN 代理
│   ├── ws/chat-server.js     # WebSocket 聊天 + 中继
│   ├── middleware/            # 中间件（认证、限流）
│   ├── services/             # 业务服务（转码、中继总线）
│   └── utils/                # 工具（init-db, db, jwt, cache, crash-logger…）
├── server/public/            # 静态资源（setup.html + icons/，前端产物在 client/dist/）
├── server/database/          # SQLite 数据库（自动创建）
├── Resources/                # 🔒 用户自行管理的静态资源
│   └── public/               # 壁纸、音乐、视频、字体、PDF 预览器…
├── .claude/                  # Claude Code 配置
├── start.bat                 # 开发启动脚本 (Windows)
├── start-prod.bat            # 生产启动脚本 (Windows)
├── cn.bat                    # PM2 进程管理 (Windows)
├── start.sh                  # 启动脚本 (Linux)
├── DEPLOY.md                 # 详细部署文档
└── CLAUDE.md                 # AI 协作规则
```

---

## 🔧 环境变量

> 完整列表 + 默认值 → [DEPLOY.md § 3.1](./DEPLOY.md#31-环境变量详解)

| 变量 | 说明 | 必填 |
|------|------|:----:|
| `JWT_SECRET` | JWT 签名密钥（≥32 字符随机串） | ✅ |
| `ADMIN_USER_IDS` | 班管 ID（逗号分隔，格式 YYCC00） | — |
| `DEV_PASSWORD` | 开发者测试账号密码（ID: 999999） | — |
| `QWEATHER_KEY` | 和风天气 API Key | — |
| `AI_API_KEY` | AI 服务 API Key（OpenAI 兼容） | — |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | — |
| `TAVILY_API_KEY` | Tavily 联网搜索 API Key | — |
| `COHORT` | 届数（跨班级中继过滤） | — |
| `TAILSCALE_ENABLED` | 启用 Tailscale 组网中继 | — |

---

## 🔌 可选集成

| 服务 | 用途 | 配置变量 |
|------|------|----------|
| [和风天气](https://dev.qweather.com/) | 天气数据 + 预警 | `QWEATHER_*` |
| OpenAI 兼容 API | AI 对话（支持任意兼容提供商） | `AI_*` |
| [DeepSeek](https://platform.deepseek.com/) | 国产 AI 对话 | `DEEPSEEK_*` |
| [Tavily](https://tavily.com/) | AI 联网实时搜索 | `TAVILY_*` |
| [Tailscale](https://tailscale.com/) | 跨教室 VPN 组网中继 | `TAILSCALE_*` |
| [Syncthing](https://syncthing.net/) | Resources 文件跨机同步 | `SYNCTHING_*` |

---

## 🛠️ 开发

```bash
pnpm dev           # 前后端同时启动
pnpm dev:server    # 仅后端 :9001
pnpm dev:client    # 仅前端 :5001
pnpm build         # 生产构建
```

### 代码约定

- ES2017 JavaScript（`var` 声明风格）
- Vue 2 Options API（非 Composition API）
- 单引号、2 空格缩进、kebab-case 文件名
- 所有静态资源本地化，不使用外部 CDN
- 目标设备为横屏平板，触控优先，最小触摸区域 44px

---

## 👤 作者与致谢

**Nevino** — 项目构思、需求定义与设计方向指导

本项目采用 **Vibe Coding** 模式开发：人类负责构思产品形态、交互体验与功能规划，AI 辅助完成编码实现、测试与文档。这是一种「人机协作」的软件开发新范式——将创造力留给人类，将重复劳动交给机器。

<p align="center">
  <sub>✨ Crafted with ❤️ by <strong>Nevino</strong> · Powered by <strong>Claude Code</strong></sub>
</p>

---

## 📈 星标历史

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Nevino2333/ClassIntra&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Nevino2333/ClassIntra&type=Date" />
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Nevino2333/ClassIntra&type=Date" />
</picture>

---

## 📄 License

MIT © Nevino
