# 已有独立项目迁入 ClassIntra 指南

> 面向场景：你手上有一个**已经在跑的独立 Node / 前端项目**，想把它变成 ClassIntra 的
> 第三方应用或插件——改造要尽量少、之后还能按原来的习惯继续开发。本指南给出决策树
> 与每条路径的具体步骤。从零开始的新项目直接用 `node scripts/create.mjs <类型> <名字>`。

## 决策树：三十秒选对你的路径

```
你的项目是什么形态？
│
├─ 只有前端（SPA / 静态页，vite/webpack/原生均可）
│   └─ 产物完整、不需要系统级深度联动 ──────────→ 路径 A：静态站（5 分钟）
│   └─ 需要用户信息 / 主题跟随 / 返回桌面 / 系统 toast
│       └───────────────────────────────────────→ 路径 A + CI 适配器（10 分钟）
│
├─ Node 后端（express/koa/fastify/原生 http）
│   ├─ 愿意把路由改成 express Router 复用系统认证/数据库 ──→ 路径 B：插件（后端半改动）
│   ├─ 想零改动原代码、独立进程跑 ──────────────────────→ 路径 C：独立端口服务（近乎零改动）
│   └─ 前后端一体（Node + 前端页面） ───────────────────→ 路径 C + 前端壳（或 B + A 组合）
│
└─ 想要原生级集成（桌面小组件 / 全局悬浮层 / 主题令牌 / SDK）
    └────────────────────────────────────────────→ 路径 D：微前端（按 SDK 重写前端交互层）
```

---

## 路径 A：静态站迁入（前端项目，最快）

1. `node scripts/create.mjs site my-app`（生成 manifest + 示例页）
2. 把你项目的构建产物（`dist/` 里全部文件）拷进 `frontend/`，覆盖示例 index.html
3. 本地源安装（默认 `<项目根>/../market/apps/my-app`），管理端市场安装

**你获得**：同源 iframe 运行（直接 `fetch('/api/...')`，token 在 `localStorage.getItem('token')`）、
系统导航栏与返回、AppShell 容器、卸载无痕。

**CI 适配器（推荐加上）**：index.html 里加一行 `<script src="/ci-adapter.js"></script>`，即可：

```js
CI.user().then(function(u) { console.log(u.user_id, u.net_name, u.role); });
CI.theme().then(function(t) { applyMyColors(t.tokens); });   // 跟随系统主题
CI.onTheme(function(t) { applyMyColors(t.tokens); });        // 主题切换实时推送
CI.back();                                                   // 返回桌面
CI.toast({ message: '保存成功', type: 'success' });           // 系统 toast
```

**继续开发**：保持你原来的项目与构建流程不变；每次 `npm run build` 后把 dist 拷到
`frontend/`（或直接把构建输出目录指到那里），管理端「更新」即可，前端免重启秒生效。

---

## 路径 B：后端改造成插件（复用系统能力，半改动）

适合愿意做**适度改造**换深度集成的 Node 项目。改动三步：

1. `node scripts/create.mjs plugin my-plugin`
2. 把你已有的路由逻辑搬进 `backend/routes.js`。原 express app 的写法直接兼容：

```js
var express = require('express');
var router = express.Router();
// 原项目里 app.get('/list', handler) → router.get('/list', handler)，其余照抄
var requireAuth = require(path.resolve(process.cwd(), 'src/middleware/auth')).requireAuth;
router.get('/list', requireAuth, function(req, res) {
  var userId = req.user.user_id;      // 系统认证：当前登录用户（6 位学号）
  // 数据库直接用主库（better-sqlite3 同步 API）
  var db = require(path.resolve(process.cwd(), 'src/utils/db'));
  res.json({ code: 200, data: db.prepare('SELECT ...').all(userId) });
});
module.exports = router;
```

3. koa/fastify 项目：把 handler 函数逐个翻译成 express 写法（业务逻辑不动，只换壳）；
   实在不想换壳 → 走路径 C。

**你获得**：系统认证/用户体系、主数据库、WS 推送（`relayBus`/`chatServer.broadcast`）、
rateLimit、热挂载、启停闸门、cleanup 钩子。你原来的登录/用户表可以整个删掉。

**继续开发**：改 `backend/routes.js` → 管理端「更新」（重装）生效；或开发期设
`CLASSINTRA_HOT_RELOAD=1`。数据库建表写在 routes.js 顶部（`CREATE TABLE IF NOT EXISTS`），
**并配套 `backend/cleanup.js`**（卸载即无痕是硬承诺）。

---

## 路径 C：独立端口服务（零改动原代码）

适合**不想动原代码**的 Node 服务（尤其非 express、或带常驻状态/定时任务/联机逻辑的项目）。

1. `node scripts/create.mjs service my-svc`（自动分配建议端口）
2. 把你的服务代码放进包内，入口改成**读环境变量 `PORT` 并只绑 `127.0.0.1`**：

```js
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', ...);
```

这是唯一需要动的一行（原来写死的端口改成 env）。登录体系：拿到用户的正确姿势是
前端壳里 `CI.user()` 或把主站 JWT 从 `Authorization: Bearer <localStorage token>` 传给你的
服务自行验签（RS256 公钥 / HS256 共享密钥，见 `server/src/utils/jwt.js` 的签发规则）。

**你获得**：进程托管（崩溃指数退避重启 ×5）、`/api/my-svc` 自动反代、停用/卸载自动杀进程树、
端口冲突安装期检测、服务器重启自动拉起。**注意**：反代仅 HTTP（WebSocket 暂不支持，联机类走 HTTP 轮询）。

**继续开发**：改代码 → 管理端「更新」（重装会杀旧进程拉新进程）。开发高频迭代时可直接
`node backend/server.js` 本地起服务调试（PORT 手动传），调试好了再更新安装。

---

## 路径 D：微前端深度集成

要桌面小组件、全局悬浮层（桌宠类）、跟随主题令牌、SDK context 的完整能力时走这条路
（新项目推荐直接从此开始）。见 **docs/market-dev-guide.md**（entry/overlay/widgets 契约）
与 `node scripts/create.mjs app <name>` 的模板（模板本身就是正确示例）。
已有前端项目走 D 通常意味着重写交互层——除非你确实需要这些能力，否则 A + CI 适配器
的性价比更高。

---

## 通用发布与调试

```bash
node scripts/diag.js market <name>        # 装前预检（与安装时同一校验器）
node scripts/build-app.js <name> --watch  # 改动监听 + lint
# 发布（市场源仓库根目录）：
node scripts/market-index-gen.mjs         # 生成 files + 逐文件 sha256
node scripts/market-sign.mjs              # ed25519 签名（部署端验签时必需）
```

调试三板斧：浏览器控制台 `window.__ciDiagnostics()`（内核/市场状态）、管理员开
`/dev/runtime`（运行时检查器）、服务端日志 `[proc:<name>]` 前缀（独立进程输出）。

---

## 框架 / 语言 / 规模矩阵

### 前端：任意框架（框架无关是结构性的，不是适配出来的）

| 你的前端 | 迁入路径 | 说明 |
|---|---|---|
| React / Vue / Svelte / Solid（vite/webpack 构建） | A：静态站 + CI 适配器 | 构建产物原样运行；SPA 路由建议用 **hash 模式**（iframe 内 history 路由需把 base 设为 `/market-static/<name>/`） |
| 原生 HTML/JS/jQuery | A | 直接放 |
| 需要桌面小组件 / 悬浮层 / 深度主题令牌 | D：微前端 | entry.js 手写或由构建产出；CI 适配器覆盖不了的深度能力才走这条 |

### 后端：任意语言（进程形态 `backend.process` 的 `command` 是任意的）

| 你的后端 | 迁入路径 | 说明 |
|---|---|---|
| Node（express） | B 插件（复用系统认证/DB） | `app.get` → `router.get`，业务零动 |
| Node（koa/fastify/原生/常驻任务） | C 进程形态 | 只改 `listen(process.env.PORT, '127.0.0.1')` 一行 |
| Python / Go / Java / Rust / PHP / C# | C 进程形态 | `command` 写实际启动命令（如 `python server.py`、`go run .`；**建议预编译为静态产物再分发**）；模板：`create.mjs service <名> --lang python` |
| 多语言注意事项 | — | 宿主运行时（python/jvm/…）由**部署者预装**，市场不执行包管理器安装；优先标准库实现，或把依赖随包分发（Python vendar / Go 静态二进制） |

### 大型项目

- **文件数/体积上限可调**：默认 300 文件 / 单文件 15MB / 总 80MB，部署端环境变量
  `MARKET_MAX_FILES` / `MARKET_MAX_FILE_MB` / `MARKET_MAX_TOTAL_MB` 按需放宽
- **monorepo / 前后端拆包**：一个项目可拆成多个市场包（前端站一个、后端插件一个、
  主题一个），各自独立版本与启停——比塞一个巨包更好管理
- **前端 chunk/图片多**：构建时合并小资源（vite 的 assetsInlineLimit 调大）可显著压文件数
- **带大数据/模型文件**：放包内静态资源（受单文件上限约束）；超大文件建议部署者手动
  放目标机 + 应用启动时从 `CI_APP_DIR` 相对路径读取，不进市场分发
- **node_modules 不进包**：进程形态的 Node 依赖让部署者预装于宿主（与运行时预装同一约定），
  或用打包器（esbuild/vercel/pkg）打成单文件入口
