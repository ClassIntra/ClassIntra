# Market 应用开发指南（生态契约）

面向想在 ClassIntra 市场发布应用的开发者。读完这页你就能写出一个**装得上、跑得动、卸得干净**的市场应用。

> 官方应用（`apps/`）与市场应用（`market-apps/`）的差异：市场应用不参与 Vite 构建，前端是运行时注入的原生 ES5 脚本；生命周期完全由市场管理（安装/更新/卸载/启停均不重启服务器）。

---

## 1. 包结构

第三方应用有**三种运行形态**。外部作者使用 `classintra-devkit create app|site|service <name>`；主仓贡献者也可用 `node scripts/create.mjs`。SDK 类型与行为见 [第三方 SDK 使用与调试](../devkit/SDK.md)。

| 形态 | 适用 | 前端 | 后端 |
|---|---|---|---|
| **微前端**（默认） | 深度集成：要小组件/悬浮层/跟随主题/SDK | `frontend/entry.js`（define 契约） | 可选 express router 挂 `/api/<name>` |
| **静态站** `frontend.static` | 存量项目零适配迁入（vite/webpack 的 dist 拷入即跑） | `frontend/index.html`（iframe 同源加载） | 无 |
| **独立端口服务** `backend.process` | 自带进程的服务（游戏联机服务器、算法服务等） | 任意（常配 static 做壳） | 独立进程，主服务托管 + 反代 |

```
apps/<name>/                 # 市场源仓库中的应用目录（发布到 Gitee/GitHub/本地源）
  manifest.json              # 必需
  icon.svg
  frontend/
    entry.js                 # 微前端形态必需（entry 契约）
    index.html               # 静态站形态入口（frontend.static 指向它）
    style.css                # 可选
    overlay.js               # 可选（全局悬浮层，见 §5）
  backend/
    routes.js                # express 形态（挂 /api/<name>）
    server.js                # 进程形态（独立进程，监听 127.0.0.1:$PORT）
    cleanup.js               # 可选（卸载清理钩子，见 §6）
```

### 静态站形态（存量项目迁入，最快路径）

manifest：`"frontend": { "route": "/my-app", "static": "./frontend/index.html" }`（声明 static 时 entry 可省）。
把已有项目的构建产物整个拷进 `frontend/`，宿主以**同源 iframe** 加载：

- 直接 `fetch('/api/...')` 调主服务 API；登录 token 在 `localStorage.getItem('token')`（同源共享）
- 无需任何代码适配；主题令牌在 iframe 内不可见（要跟随主题请升级到微前端形态）

### 独立端口服务形态

manifest：`"backend": { "mountPath": "/api/<name>", "entry": "./backend/server.js",
"process": { "entry": "./backend/server.js", "port": 41234 } }`。主服务负责：

- **spawn 托管**：注入 `PORT` / `CI_APP_NAME` / `CI_APP_DIR` 环境变量；崩溃指数退避自动重启（上限 5 次）
- **反代**：`/api/<name>/*` → `127.0.0.1:<port>`（仅 HTTP；WebSocket 暂不支持——联机类走 HTTP 轮询）
- **启停联动**：应用停用/卸载自动终止进程树（Windows taskkill /T）；重启服务器自动拉起
- **端口治理**：安装期探测端口冲突（已装应用声明冲突 / 系统占用都拒装）；只应绑定 127.0.0.1

市场源是一个 Git 仓库（或本地目录），根目录 `index.json` 列出全部应用：

```json
{ "version": 1, "apps": [ { "name": "my-app", "label": "示例", "version": "1.0.0",
  "files": ["apps/my-app/manifest.json", "apps/my-app/frontend/entry.js"] } ] }
```

默认安装限制：单应用 ≤300 文件、单文件 ≤60MB、总量 ≤80MB；部署者可调整。白名单不含 `.vue`/`.ts`，devkit 打包排除编辑器 `.d.ts`。

## 2. manifest（市场专属约束）

```json
{
  "name": "my-app",
  "type": "app",
  "version": "1.0.0",
  "label": "示例应用",
  "icon": "./icon.svg",
  "category": "desktop",
  "frontend": {
    "route": "/my-app",
    "entry": "./frontend/entry.js",
    "style": "./frontend/style.css",
    "overlay": "./frontend/overlay.js",
    "widgets": [
      { "id": "clock", "name": "时钟", "defaultSize": { "w": 2, "h": 1 } }
    ]
  },
  "backend": { "mountPath": "/api/my-app", "entry": "./backend/routes.js" },
  "sdk": "1",
  "capabilities": ["data.storage", "data.realtime", "ui.overlay"],
  "visibleRoles": ["classAdmin", "student"],
  "config": [{ "key": "API_KEY", "label": "上游密钥", "type": "secret", "required": true }]
}
```

硬校验（不满足直接拒装）：`frontend.route` 以 `/` 开头；`frontend.entry` 必填；`backend.mountPath` 以 `/api/` 开头；`sdk` 主版本 ≤ 当前系统版本；`visibleRoles` 只能是 `classAdmin / admin / officer / student`。

## 3. entry.js 契约（页面应用）

IIFE + `window.ClassIntraMarket.define`，宿主在用户进入应用路由时加载：

```js
(function() {
  var NAME = 'my-app';
  var timers = [];

  function mount(container, context) {
    // context 七个命名空间：ui / data / system / device / theme / app / compat
    // context.data.storage 已强制 ci:app:my-app: 前缀 —— 只用它存本地数据
    container.innerHTML = '<div class="my-root">你好</div>';
    timers.push(setInterval(tick, 1000));
    // 卸载契约：一切订阅/计时器在此登记，卸载时自动执行
    context.app.onDestroy(function() { timers.forEach(clearInterval); });
  }
  function unmount(container) { container.innerHTML = ''; }

  window.ClassIntraMarket.define({ name: NAME, mount: mount, unmount: unmount });
})();
```

**Chrome 80 基线（校园平板）**：全文件 `var` / `function` / 单引号；禁用 `Element.replaceChildren()`（Chrome 86+）、可选链、空值合并；CSS 不用 `gap`（flex gap 84+）与 `backdrop-filter`（可用 `context.compat.has()` 探测后降级）。可用 `node scripts/diag.js compat <name>` 体检。

## 4. 小组件契约（可选）

在 manifest 的 `frontend.widgets[]` 声明（`id`/`name`/`description`/`defaultSize`/`minSize`/`maxSize`/`configSchema`/`permission`），并在 entry.js 的定义对象上提供渲染入口：

```js
window.ClassIntraMarket.define({
  name: NAME,
  mount: mount,          // 页面入口（§3）
  unmount: unmount,
  widgets: {             // 每个声明的小组件一个渲染器
    clock: {
      mount: function(el, config, context) { /* 往 el 里渲染，config 来自桌面配置 */ },
      unmount: function(el) { /* 清理计时器与 DOM */ }
    }
  }
});
```

- 用户在「桌面设置 → 小组件」里看到的名字是 `应用名 · 组件名`，添加后走桌面网格布局
- `configSchema` 与官方小组件同一套（select/text/bool/number 四类字段，桌面自动生成配置弹窗）
- 应用停用/卸载后，桌面布局里的该组件引用会被自动清理
- 注意：manifest 里 widgets 的 `component` 字段对市场应用**无效**（不参与构建），渲染入口只认 entry.js 的 `widgets`

## 5. overlay.js 契约（全局悬浮层，可选能力）

声明 `"frontend": { "overlay": "./frontend/overlay.js" }` + 能力披露 `ui.overlay` 后：

- 应用处于**已安装且启用**状态时，宿主在**任意页面**加载 overlay.js 并挂载到 `document.body` 下的全屏容器（`position:fixed; inset:0; pointer-events:none; z-index:9400`——低于超能岛 10000 / 模态 10001 / Toast 99997，不遮挡页面其余交互）
- 应用根元素**必须自带 `pointer-events:auto`** 才能接收点击
- 注册方式与 entry.js 同构：`window.ClassIntraMarket.defineOverlay({ name, mount, unmount })`；`mount(container, context)` 同样拿到七个命名空间 context
- 挂载/摘除/更新由宿主随市场清单自动同步（安装、卸载、启停、版本更新），**应用不要自己操纵 container 的存在性**
- 悬浮层应尊重性能与场景：`document.hidden` 时停帧；锁屏（z-index 99999）会自然盖住它
- 用户没"激活"你的悬浮功能时，`mount` 里可以什么都不渲染——零足迹是美德

## 6. cleanup.js 契约（卸载清理钩子，可选）

卸载时、删除应用目录之前，宿主执行 `backend/cleanup.js`（若存在）：

```js
// backend/cleanup.js —— 卸载即无痕的样板
var path = require('path');
var db = require(path.resolve(process.cwd(), 'src/utils/db'));
module.exports = function cleanup(ctx) {
  // ctx = { name, manifest }
  db.prepare('DROP TABLE IF EXISTS my_app_items').run();
  db.prepare("DELETE FROM user_kv_store WHERE key LIKE 'my-app:%'").run();
};
```

- 钩子**失败会中止卸载**（文件与记录都在，修复后可重试）——所以钩子里只做清理，别做有风险的写操作
- 你的后端（routes.js）自建了哪些表、写了哪些 kv，cleanup.js 就要清哪些——**这是市场应用的信誉分**

## 7. 生命周期：谁负责清什么

| 阶段 | 平台自动完成 | 应用义务 |
|---|---|---|
| 安装 | 文件落盘 `market-apps/<name>/`、app_control 登记、后端热挂载、广播 | — |
| 启用/停用 | app_control 即时生效、前端路由与悬浮层同步摘挂 | — |
| 更新 | 重装最新版（保留启用状态与本地数据） | — |
| 卸载 | 执行 cleanup.js → 删 app_control/app_config → 删目录 → 前端卸载 script/style/DOM | cleanup.js 清干净自建表与 kv；onDestroy 退订全部 realtime/eventBus |
| 卸载（客户端） | 清 `ci:app:<name>:*` localStorage、SDK 登记表、模块注册表、路由墓碑 | 存储只经 `context.data.storage`（前缀强制，才能被清到） |

**验收标准**：`node scripts/diag.js market [name]`（装前预检：与安装时同一校验器 + 文件完整性 + 路由冲突）和 `node scripts/market-lifecycle-probe.mjs`（需本地服务器运行中）。后者用一次性探针应用完整走一遍「安装→使用→卸载→重装→再卸载」，逐项断言数据库表、app_control、目录、API 全部无残留。发布前请对照自查。

## 8. 调试与发布

```bash
# 本地源（默认 <项目根>/../market，可用 MARKET_LOCAL_DIR 覆盖）开发循环：
#   改代码 → 管理端市场 → 更新（重装）→ 前端硬刷新（market-static 为 no-cache）
node scripts/build-app.js <name> --watch   # lint + 直出检查
node scripts/diag.js market [name]         # 装前预检（与安装时同一校验器）
node scripts/market-index-gen.mjs          # 重新生成 index.json（files 清单 + 逐文件 sha256）
node scripts/market-sign.mjs --genkey      # 首次：生成 ed25519 发布密钥对
node scripts/market-sign.mjs               # 每次发布：对 index.json 签名 → index.json.sig

# 发布：把 apps/<name>/（或 themes/<id>/）+ index.json + index.json.sig 推到市场仓库
```

### 完整性链路（防篡改）

两层保护，发布者按需启用：

1. **逐文件哈希**：`market-index-gen.mjs` 自动在 index.json 每个条目写入 `hashes`（sha256），
   安装时服务端逐文件比对，不匹配即中止——防镜像损坏与半更新，零配置默认生效。
2. **目录签名**：`market-sign.mjs` 用 ed25519 私钥对 index.json 原始字节签名；部署端配置
   `MARKET_SIGNING_PUBLIC_KEY`（PEM 文本或文件路径）后，http 源（gitee/github）的目录必须验签
   通过才可用（篡改/缺签 → 拉取失败并在市场页显示明确错误），本地源按文件系统信任跳过。
   市场页目录区显示「已验签 / 未验签 / 本地源」徽章。

   密钥纪律：私钥（`server/.market-signing-key.pem`）绝不入仓不入市场仓库；轮换密钥时
   先发新公钥到部署端、再用新私钥重签目录。

## 9. 主题包（themes/）契约

市场主题是**纯数据 JSON 包**——没有任何脚本执行（CSP 友好），安装后出现在全班成员的主题选择里。

包结构（市场源仓库的 `themes/<id>/` 目录，注意与 `apps/` 平级）：

```
themes/<id>/
  manifest.json   # { id, name, type: 'light'|'dark', version, description, author, tokens: './tokens.json' }
  tokens.json     # TOKENS 数据对象（与内置 themes/light/tokens.js 导出的结构同构）
  icon.svg        # 可选
```

硬性约束：

- `id` 必须与目录名一致，且不能是 `light`/`dark`（内置主题不可覆盖）
- `tokens` 必须指向 `./tokens.json`（纯 JSON；市场主题不支持 .js）
- `tokens.json` 必须是数据对象，结构与官方主题一致（color/shape/shadow/motion 等 token 组，参考 `themes/light/tokens.js`）
- 命名 kebab-case；建议带 `author` 署名

安装机制：安装时服务端原子写入 `market-themes/<id>/` 并**合成 `pack.json`**（manifest + tokens 内联），客户端 `ThemeEngine.loadExternalTheme('/market-theme-static/<id>/pack.json')` 一次取全注册；卸载时正在使用的主题自动回退浅色。市场源 `index.json` 的 `themes` 段格式与 apps 一致（`market-index-gen.mjs` 会一并生成）。

---

## 10. 联机与多人大世界（第三方视角）

房间、对局、共享世界这类应用，绕不开三个问题：**谁能收到我的消息**、
**谁是状态的真相**、**高频操作会不会把宿主拖垮**。这一节把 2026-11 起的
平台能力与踩过的坑一次说清。

### 10.1 三条实时路线，按规模选

| 路线 | 通道 | 适用 | 代价 |
|---|---|---|---|
| **A. 全局广播** | `context.data.realtime.publish(event, payload)` | 通知、开播提醒、世界事件等**低频**广播 | 全校在线用户都会收到，只靠 `event` 名过滤 |
| **B. 频道（推荐）** | `context.data.channels.*` | 房间、对局、多人世界等同好者分组 | 需要 join/leave，成员只在内存里 |
| **C. 后端定向推送** | 应用后端 `realtimeBus.publishToUsers(ids, event)` | 已有权威服务端、需要按自定义规则选人 | 只能在后端调用，前端拿不到 userId 列表 |

**别用 A 做逐帧同步。** 二十人同时移动、每人 3 步/秒，就是 1200 条/秒广播给全校每个人的
WebSocket —— 校园平板上这不是「卡」，是直接收不到。

### 10.2 频道：把消息关进房间

频道名由 SDK 统一加前缀 `app:<本应用>:<房间>`，应用只传房间名：

```js
// 进入房间（幂等：重连、刷新、从后台切回来都可以无脑再调）
await context.data.channels.join('world');
await context.data.channels.join('room-2048');

// 广播给同房间的人（服务端校验你确实是成员）
await context.data.channels.publish('world', 'move', { x: 12, y: 9 });

// 订阅房间事件：返回退订函数，并自动挂到 onDestroy
var off = context.data.channels.subscribe('world', 'move', function (payload, message) {
  // payload = { x: 12, y: 9 }；message 里另有 sender_id / channel / created_at
});

// 在线人数
var info = await context.data.channels.members('world');   // { channel, count }
```

服务端接口（不用 SDK 也可直连）：

```
POST /api/realtime/channels/join     { channel }
POST /api/realtime/channels/leave    { channel }
POST /api/realtime/channels/publish  { channel, event, payload }   // 必须是成员
GET  /api/realtime/channels/members?channel=...
```

硬约束：

- 频道名必须匹配 `app:<kebab-case 应用名>:<房间>`，房间段 1~40 字符，
  只允许字母数字与 `._:-`。应用名会对照 `app_control` 校验，**停用的应用加入会被 403**。
- 单进程 64 个频道、单频道 300 人上限；超限返回 429。
- 频道**没有持久化**：服务重启即清空，客户端重新 `join` 即可。成员断开（长轮询
  TTL 到期）会自动从所有频道摘除。

### 10.3 状态权威：服务端说了算

多人世界里最贵的 bug 是「客户端和服务端各有一套位置」。规则只有一条：

> **客户端发意图，服务端发结论。**

```js
// 客户端：乐观移动 + 用服务端回传的坐标校正
state.me.x = nx; state.me.y = ny;                 // 先走，手感才跟手
var res = await post('/api/<app>/move', { x: nx, y: ny, dir: dir });
if (res.rejected) {
  state.me.x = res.me.x;                          // 服务端必须回传真实位置
  state.me.y = res.me.y;
}
```

**服务端在拒绝时也要回传当前位置**。只回 `{ rejected: 'cloud' }` 的话，客户端只能
「回滚到出发前」，而连续按键时本地早已领先两格 —— 表现就是人物在云海上反复弹跳。
这是本项目的实测教训。

同理，**高频校验失败不要用 4xx**。撞到墙不是异常，是玩法的一部分；用 4xx 会让
浏览器控制台刷满红色错误，排查真实问题时全被噪音淹没。用 `200 + { rejected: reason }`。

### 10.4 广播要合并，不要逐动作直发

一个 200ms 的合并窗口，能把「每人每步一条」压成「每 200ms 一条、内含多人位移」：

```js
// 后端：累积脏数据，定时打包
var dirty = new Set();
setInterval(function () {
  if (!dirty.size) return;
  var moves = [];
  dirty.forEach(function (uid) { var p = online.get(uid); if (p) moves.push([uid, p.x, p.y, p.dir]); });
  dirty.clear();
  realtimeBus.publishToUsers(onlineIds(), {
    type: 'extension_event', app_name: NAME, event: NAME + '.world.delta', payload: { moves: moves }
  });
}, 200).unref();
```

三个细节：

- `setInterval(...).unref()` —— 否则定时器会把 Node 进程钉住，服务器重启时退不干净。
- 定时器要在回调里 `try/catch`，并在捕获 `no such table` 时自我停用 —— 应用被卸载后
  `cleanup.js` 会 DROP 表，而模块级定时器不会自动消失，否则日志会被刷爆。
- 一次揭开上百格这类「大包」不要塞进 delta，单独发一个事件，避免每帧都背着它。

### 10.5 高频接口不要配 `backend.rateLimit`

平台限流键是 `req.ip + ':' + req.path`。学校里**全班在同一个 NAT 出口**，
二十个人各有各的操作，落到同一个 key 上 —— 配 600/min 的结果是整个班一起被锁在门外。

需要限流就在应用内部按 `user_id` 做（例如「同一用户两次移动至少间隔 80ms」），
并让服务端成为唯一的判定者。

### 10.6 画布尺寸：必须 ResizeObserver

市场应用是宿主**异步挂载**的。`mount()` 被调用的那一刻，路由容器经常还是 0×0：

```js
// ❌ 只测一次：画布被锁死在最小值，世界只剩左上角一小块
var rect = stage.getBoundingClientRect();

// ✅ 跟随容器真实尺寸
var ro = new ResizeObserver(function () { resize(); });
ro.observe(stage);
context.app.onDestroy(function () { ro.disconnect(); });
// 兜底：极老内核没有 ResizeObserver，低频轮询一次
var guard = setInterval(resize, 900);
context.app.onDestroy(function () { clearInterval(guard); });
```

顺带一个坑：`canvas.width = ...` 会**清空画布并重置变换矩阵**。尺寸没变时不要重复赋值，
否则每帧都被清一次；DPR 缩放要用 `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` 而不是 `ctx.scale`。

### 10.7 角色判定

```js
context.system.role          // 'classAdmin' | 'officer' | 'student' | 'guest'
context.system.can('officer') // 层级：classAdmin > admin > officer > student
```

不要自己去读 `context.system.user.role` —— 宿主内部有 `is_class_admin` / `is_admin` /
`role` 三种表达，SDK 已经把归一化做完了。第三方只需面对 `visibleRoles` 里的四个词。

> 服务端仍然要自己校验：`context.system.role` 是前端视角，能被篡改。
> 用 `requireAuth` / `requireAdmin` / `requirePermission` 中间件做真正的门。

### 10.8 少踩坑的五个口子

**① 应用内静态资源：用 `assetUrl()`，别硬编路径**

```js
// ❌ 目录名是平台分配的，改名或被别人 fork 后整片 404
var bg = '/market-static/shiguang/frontend/bg.png';

// ✅
var bg = context.app.assetUrl('frontend/bg.png');
```

**② `ui.*` 返回的是 UiFragment，不是 DOM 节点**

```js
var btn = context.ui.button({ label: '点亮', onClick: onLight });
// ❌ btn.addEventListener / container.appendChild(btn) —— 静默失败
container.appendChild(btn.root);   // ✅
btn.destroy();                     // ✅ 解绑内部监听并从 DOM 移除
```

**③ `onDestroy(fn)` 返回退订函数**

面板关掉时临时挂的监听应当自己撤掉，否则会攒一堆空回调、卸载时挨个空跑：

```js
var off = context.app.onDestroy(function () { /* ... */ });
off();  // 这个清理不再需要了
```

**④ `data.put / patch / delete` 与 `get / post` 对称**

第三方后端的「更新 / 局部更新 / 删除」直接调，不必为了记住 axios 细节去碰 `context.data.api`。

**⑤ `storage` 与 `store` 的分工**

| | `context.data.storage` | `context.data.store` |
|---|---|---|
| 位置 | 本机 localStorage | 服务端，按（应用, 用户）隔离 |
| 换设备 / 重装 | 丢 | 还在 |
| 适合 | 音量、折叠状态、上次选中的 tab | 存档、进度、用户内容 |

**⑥ 接口路径不要再带 `/api`**

宿主注入的 `context.data.api` 是 `baseURL: '/api'` 的 axios 实例。写成
`context.data.get('/api/xxx/terrain')` 会请求到 **`/api/api/xxx/terrain`**：

```js
context.data.get('/shiguang/terrain');    // ✅ → /api/shiguang/terrain
context.data.get('/api/shiguang/terrain'); // ❌ → /api/api/shiguang/terrain（404）
```

这个错**不会报异常**，只会让页面停在「数据为空 / 再试一次」，而离线沙盘（直接打后端）
永远测不出来 —— 拾光群岛第一版就是这样上线到真实宿主才发现的。打完包一定要在**真的
宿主里**看一眼首屏。

### 10.9 桌宠会让位，不用自己躲

`pet` 是宿主级常驻悬浮层（manifest 里声明 `frontend.overlay`，没有 `route`），它会满屏游走。
**进入任何一个 `layout.mode: "fullscreen"` 的应用路由时，宿主会把所有常驻悬浮层的容器设成
`display:none`；离开该路由再恢复。** 规则在 `client/src/core/market-overlay-host.js` 的
`setActiveRoute()` 里，由 `App.vue` 每次路由变化时调用。

所以：

- 你的全屏应用**不需要**为桌宠留底部安全区，也不该用 `bottom: 104px` 这种魔法值硬躲。
- 反过来也别指望靠「桌宠始终可见」来做效果——它在你的页面里就是不存在。
- 想让自己的应用在桌面上常驻（像桌宠那样），就别声明 `layout.mode`，改为提供 `frontend.overlay`。

这条规则是拾光群岛踩出来的：第一版把动作栏放在 `bottom: 18px`，桌宠游走到右下角后
「漂流瓶」按钮被整块盖住，文字都看不清。当时在应用里把动作栏抬到 104px 躲开了，
但桌宠还会游到左下角压住方向键——**躲不完**，最后还是得在宿主层解决。

### 10.10 交付前自查

```bash
node scripts/diag.js market <name>                 # 装前预检（与安装同一校验器）
node scripts/market-review.mjs market-apps/<name>  # ES5 / CSS 令牌 / 资源回收
node scripts/market-lifecycle-probe.mjs            # 安装→使用→卸载→重装 全链路
```

参考实现：`market-apps/shiguang`（共享大世界，含地形下发、频道外的事件定向、
广播合并、迷雾位图与卸载清理）。
