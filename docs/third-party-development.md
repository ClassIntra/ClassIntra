# 第三方应用开发指南（SDK v1）

> 面向：想在 ClassIntra 上开发应用的开发者
> 目标设备：Android 9.0 横屏平板，腾讯 X5 Chromium 89 / 非 X5 Chromium 80
> 完整设计说明见 `docs/ecosystem-design.md`

---

## 0. 先搞清楚你要做哪一类

ClassIntra 生态里有**四类模块**，定位完全不同。开发前先确认你做的是哪一类：

| 类型 | 一句话 | 有界面？ | 有路由？ | 放哪里 |
|---|---|---|---|---|
| **应用** | 有自己的一屏 | ✅ | ✅ | `market-apps/<name>/` |
| **插件** | 只扩展后端能力 | ❌ | ❌ | `plugins/<name>/`（需管理员安装） |
| **主题** | 只换视觉 | ❌ | ❌ | `theme-extensions/<name>/` |
| **组件** | 系统内部 UI 资产 | — | — | **不对第三方开放** |

本指南讲的是**应用**，这也是生态的主战场。

> 判据强化：一段前端 JS ≠ 应用。只有当它渲染出**用户可进入的独立界面**时才算应用。桥接脚本、事件监听器属于插件的实现手段。

---

## 1. 目录结构

```
market-apps/
└── my-app/
    ├── manifest.json          # 应用元信息（服务端扫描）
    └── frontend/
        ├── entry.js           # 入口：注册 mount / unmount
        └── style.css          # 样式（应只消费 --ci-* 令牌）
```

最小 `manifest.json`：

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "label": "我的应用",
  "description": "一句话说明这个应用做什么",
  "icon": "/resources/public/icons/my-app.png",
  "frontendEntry": "frontend/entry.js",
  "frontendStyle": "frontend/style.css"
}
```

---

## 2. 入口文件的最小骨架

```javascript
(function() {
  var NAME = 'my-app';

  function mount(container, context) {
    // 1. 构建界面（用 context.ui.* 片段，不要自建类名体系）
    var root = document.createElement('div');
    root.className = 'my-app';

    var card = context.ui.card({ title: '欢迎', content: '这是你的第一个应用' });
    root.appendChild(card.root);

    container.replaceChildren(root);

    // 2. 注册清理（核心契约，务必写）
    context.app.onDestroy(function() {
      card.destroy();
      container.replaceChildren();
    });
  }

  function unmount(container) {
    // 通常不需要手动实现：context.app.onDestroy 已覆盖
    // 保留此函数是为了兼容旧版卸载路径
  }

  var definition = { name: NAME, mount: mount, unmount: unmount };
  window.ClassIntraMarket.define(definition);
})();
```

---

## 3. 兼容红线（最重要的一节）

**你的 `entry.js` 不会经过 Vite 构建**，因此拿不到 `@vitejs/plugin-legacy` 的语法降级，也拿不到 PostCSS 的 flex-gap polyfill 与 `-webkit-` 前缀补全。

### 3.1 禁用语法（会导致 Chrome 80 直接报错）

| 禁用 | 改用 |
|---|---|
| `const` / `let` | `var` |
| 箭头函数 `() => {}` | `function() {}` |
| 模板字符串 `` `x${y}` `` | `'x' + y` |
| 可选链 `a?.b` | `a && a.b` |
| 空值合并 `a ?? b` | `a !== null && a !== undefined ? a : b` |
| `class` 语法 | 构造函数 + `prototype` |
| `||=` / `&&=` | 显式赋值 |

### 3.2 禁用 CSS 特性

| 禁用 | 原因 | 改用 |
|---|---|---|
| flex `gap` | Chrome 84+ 才支持 | `margin`（见下方示例） |
| `:is()` / `:where()` | Chrome 88+ | 展开写完整选择器 |
| `aspect-ratio` | Chrome 88+ | padding-bottom 技巧（棋盘等场景可用 `@supports` 兜底） |
| 容器查询 | Chrome 105+ | 媒体查询 |

**用 margin 代替 flex gap**：

```css
.my-app-row { display: flex; flex-wrap: wrap; align-items: center; }
.my-app-row > * { margin-right: 8px; margin-bottom: 4px; }
.my-app-row > *:last-child { margin-right: 0; }
```

### 3.3 实时通道

**必须**用 `context.data.realtime`（HTTP 长轮询）。

**禁止**直接用 `WebSocket` —— 腾讯 X5 / TBS 与旧 Android WebView 上不可靠。

---

## 4. SDK 速查

`context` 有五个命名空间。

### 4.1 `context.ui` —— 预制 DOM 片段

所有片段返回 `{ root, update(fn), destroy() }`。样式由 SDK 自动注入，已消费令牌，**天然跟随主题**。

```javascript
var btn  = context.ui.button({ label: '保存', variant: 'filled', onClick: fn });
var card = context.ui.card({ title: '标题', content: '正文' });
var list = context.ui.list({ items: [
  { title: '第一项', subtitle: '说明', value: '3', onClick: fn }
]});
var seg  = context.ui.segmented({ segments: [{label:'A',value:'a'}], value: 'a', onChange: fn });
var sw   = context.ui.toggle({ checked: true, label: '开启', onChange: fn });
var sb   = context.ui.searchBar({ placeholder: '搜索', onInput: fn, onSearch: fn });
var bd   = context.ui.badge({ text: 'NEW', variant: 'success' });
var tst  = context.ui.toast({ text: '提示', variant: 'danger' });
var emp  = context.ui.emptyState({ icon: 'fa-solid fa-inbox', title: '暂无内容' });
var spn  = context.ui.spinner({ text: '加载中' });
var sec  = context.ui.sectionTitle({ text: '分组标题' });
var tb   = context.ui.toolbar({ items: [{ icon: 'fa-solid fa-copy', label: '复制', onClick: fn }] });
```

`variant` 可选值：
- `button`：`filled` / `tinted` / `plain` / `destructive`
- `badge` / `toast`：`default` / `success` / `warning` / `danger`

**记得销毁**：片段内部绑定了事件，`destroy()` 会解绑。放在 `onDestroy` 里。

### 4.2 `context.data`

```javascript
// API（自动带 JWT）
context.data.api.get('/my-app/items')
context.data.api.post('/my-app/items', { title: 'x' })

// 实时（HTTP 长轮询）
var stop = context.data.realtime.subscribe('my-app.updated', function(payload) {});
// ...
stop();   // 记得取消订阅

// 存储（自动加 ci:app:my-app: 前缀，无需自己处理冲突）
context.data.storage.set('score', 100);      // 支持对象/数组
context.data.storage.get('score', 0);
context.data.storage.keys();
context.data.storage.remove('score');
```

### 4.3 `context.system`

```javascript
context.system.user.user_id              // 响应式（每次访问读当前值）
context.system.isLoggedIn
context.system.route                     // 当前路由
context.system.navigate({ name: 'Desktop' });
context.system.goDesktop();
context.system.toast.alert({ title, message });
context.system.toast.confirm({ title, message }).then(function(ok) {});
context.system.modal                     // 原始 modal
context.system.eventBus.emit('chat:compose', { content: 'x' });
context.system.getToken('--primary-color');
```

### 4.4 `context.app`

```javascript
context.app.name
context.app.version
context.app.manifest
context.app.config
context.app.log('调试信息');
context.app.onDestroy(fn);   // 核心契约
```

`onDestroy` 的保证：
- 卸载时被调用（即使应用内部抛过异常）；
- **幂等**——重复调用安全；
- 若在已卸载后再注册，回调**立即执行**（不会泄漏）。

### 4.5 `context.compat`

```javascript
context.compat.chromeVersion      // 89 / 80
context.compat.isX5
context.compat.has('flex-gap')    // Chrome >= 84 才 true
context.compat.has('clipboard')
context.compat.has('backdrop-filter')
```

> `has('flex-gap')` 返回的是**原生支持**判断。若你需要 gap 的间距效果，请直接用 `margin`，而不是写分支——因为分支两边都要维护。

---

## 5. 视觉一致：只消费令牌

**不要写死颜色。** 用 CSS 变量，应用就会自动跟随主题（含深色模式）。

```css
/* ❌ 错误：写死颜色，切深色模式时不变 */
.my-app { background: #f8fafc; color: #172033; }

/* ✅ 正确：消费令牌，自动跟随主题 */
.my-app { background: var(--background-color); color: var(--text-primary); }
```

常用令牌：

| 用途 | 令牌 |
|---|---|
| 主色 | `--primary-color` |
| 背景 | `--background-color`、`--secondary-bg`、`--card-bg` |
| 文本 | `--text-primary`、`--text-secondary`、`--text-tertiary` |
| 分隔线 | `--separator-color`、`--border-color` |
| 圆角 | `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-full` |
| 字号 | `--font-size-body`、`--font-size-footnote`、`--font-size-title3` |
| 字重 | `--font-weight-medium` / `--font-weight-semibold` |
| 间距 | `--spacing-xs` / `--spacing-sm` / `--spacing-md` / `--spacing-lg` |
| 动效 | `--duration-fast` / `--duration-normal`、`--ease-standard` |

**查全部令牌**：见 `client/src/styles/global.scss`（共 147 个）。

类名前缀：用自己的应用名（如 `.my-app-header`），避免与官方 `ios-*` 或别人冲突。

---

## 5.5 动效规范：让应用「德芙般流畅」

这是决定应用「像不像系统自带」的关键一节。**曲线和时长不是随手填的数字。**

### 5.5.1 照抄这张表，别自己定

| 你要做的效果 | 曲线 | 时长 |
|---|---|---|
| 按钮/列表项按下反馈 | `var(--ease-standard)` | `var(--duration-fast)` |
| Tab 选中、开关切换 | `var(--ease-standard)` | `var(--duration-fast)` |
| 面板展开/收拢 | `var(--ease-emphasized)` | `var(--duration-normal)` |
| 内容淡入淡出 | `var(--ease-standard)` | `var(--duration-normal)` |
| 弹窗进入 | `var(--ease-decelerate)` | `var(--duration-normal)` |
| 弹窗退出 | `var(--ease-accelerate)` | `var(--duration-fast)` |
| 回弹效果 | `var(--ease-spring)` | `var(--duration-normal)` |
| 跟随手指（拖拽/捏合） | 无过渡 | `0s` |

```css
/* ✅ 正确 */
.my-app-btn { transition: transform var(--duration-fast) var(--ease-standard); }
.my-app-dialog-enter { transition: opacity var(--duration-normal) var(--ease-decelerate); }
.my-app-dialog-leave { transition: opacity var(--duration-fast) var(--ease-accelerate); }

/* ❌ 错误：写死秒数 + CSS 关键字曲线 */
.my-app-btn { transition: transform 0.2s ease; }
```

### 5.5.2 三条铁律

1. **禁止写秒数**（`0.2s`），用 `var(--duration-fast/normal/slow)`；
2. **禁止用 `ease` / `ease-in` / `ease-out` 关键字**，用 `var(--ease-*)`（循环动画的 `linear` 除外）；
3. **退出必须比进入快**。这条最容易被忽略，也最影响手感：用户点开时愿意等 0.25s 看内容，但关闭时已经知道结果了——进出等长会让人感觉「点完还得盯着它收完」。

### 5.5.3 只动 `transform` 和 `opacity`

浏览器只有这两个属性可以跳过「布局」和「绘制」，直接在合成器上完成。

```css
/* ❌ 触发重排，会卡 */
.my-app-panel { transition: width 0.25s var(--ease-standard); }
/* ✅ 用 transform 位移替代 */
.my-app-panel { transition: transform var(--duration-normal) var(--ease-standard); }
```

**禁止过渡**：`width` / `height` / `top` / `left` / `margin` / `padding` / `background-position`。

### 5.5.4 毛玻璃：少用，且别放在列表里

`backdrop-filter` 会触发全屏重采样，**是帧率杀手**。SDK 会自动在滚动期间降级它，但你自己的用法也要克制：

| 位置 | 能用吗 |
|---|---|
| 顶部导航栏、侧边栏、弹窗背景 | ✅ 可以 |
| 卡片 | ⚠️ 单屏最多 3 个 |
| 列表项 | ❌ 不要用，滚动必卡 |

---

## 6. 生命周期

你的应用会经历这些状态，框架自动管理：

```
idle → loading → active ⇄ suspended → idle
```

| 状态 | 触发 | 你需要注意 |
|---|---|---|
| `loading` | 用户从桌面打开 | — |
| `active` | `mount()` 完成 | 正常渲染 |
| `suspended` | 用户切到别的应用 / 平板锁屏 | 框架会**回收你的计时器**（省电）；重新 `active` 后需重建 |
| `idle` | 用户离开应用 | `onDestroy` 回调被调用 |

**关于 `suspended`**：如果你的应用依赖 `setInterval` 做动画或轮询，被挂起后计时器会停。恢复后不会自动重启 —— 请在 `context.data.realtime` 的事件回调里驱动状态更新，而不是靠定时器轮询。

---

## 7. 完整示例：五子棋

`market-apps/gomoku/` 是本指南的参考实现，建议直接对照阅读：

| 文件 | 看点 |
|---|---|
| `frontend/entry.js` | 如何用 `context.ui.*` 搭界面、如何用 `onDestroy` 收尾、如何用 `storage` 存偏好 |
| `frontend/style.css` | 如何只消费令牌、如何用 margin 代替 flex gap |
| `manifest.json` | manifest 字段示例 |

---

## 8. 调试

1. **本地开发**：把应用目录放进 `market-apps/`，在 ClassIntra 里安装启用；
2. **看日志**：`context.app.log()` 的输出带 `[app:my-app]` 前缀，便于过滤；
3. **看残留**：卸载应用后，若控制台出现 `[ResourceAuditor] "my-app" 卸载后残留全局变量: xxx`，说明你污染了全局，需要修；
4. **查内核状态**：在控制台执行 `window.ClassIntraMarket.diagnostics()`，可看到启动阶段耗时、各应用生命周期状态、待回收资源数。

---

## 9. 常见错误

| 现象 | 原因 | 修法 |
|---|---|---|
| 白屏，控制台报 `Unexpected token` | 用了 `const` / 箭头函数 / 模板字符串 | 见 §3.1 |
| 深色模式下颜色不对 | 样式里写死了颜色 | 改用令牌，见 §5 |
| 间距在某些设备上消失 | 用了 flex `gap` | 改用 `margin` |
| 切出去再回来，界面不动了 | 定时器被回收 | 改用 `realtime` 事件驱动，见 §6 |
| 卸载后平板发热/耗电 | 有未清理的 `setInterval` 或全局监听 | 全部放进 `context.app.onDestroy` |
| 实时消息收不到 | 用了原生 `WebSocket` | 改用 `context.data.realtime` |

---

## 10. 提交前自查清单

**兼容性**
- [ ] `entry.js` 无 `const` / `let` / 箭头函数 / 模板字符串 / 可选链 / `class`
- [ ] CSS 无 flex `gap`、无 `:is()`/`:where()`
- [ ] 没有直接使用原生 `WebSocket`

**视觉一致**
- [ ] CSS 未写死颜色，全部用 `--*` 令牌
- [ ] 圆角/间距/字号均取自令牌，无硬编码 px 值
- [ ] CSS 类名有自己的前缀
- [ ] 切深色模式后界面正常

**动效与流畅**
- [ ] 所有 `transition` 用 `var(--duration-*)`，无写死秒数
- [ ] 所有曲线用 `var(--ease-*)`，无 `ease` / `ease-out` 关键字
- [ ] 退出时长 ≤ 进入时长
- [ ] 无 `transition: all`
- [ ] 未过渡布局属性（`width`/`height`/`top`/`left`/`margin`/`padding`）
- [ ] 毛玻璃未用在列表项上

**生命周期**
- [ ] 所有计时器 / 全局监听 / SDK 片段都在 `context.app.onDestroy` 里清理
