# 第三方 SDK 使用与调试

SDK v1 由宿主向 `mount(container, context)` 注入。入口仍为 `window.ClassIntraMarket.define()`；编辑器类型随独立 devkit 分发。

## 获取类型

安装团队分发的 devkit 后，JavaScript 使用 JSDoc，TypeScript 使用 `import type { MarketContext } from 'classintra-devkit/sdk'`。类型入口不提供浏览器运行时代码，TypeScript 项目仍须自行输出符合宿主要求的 JavaScript。

```js
/** @param {HTMLElement} container @param {import('classintra-devkit/sdk').MarketContext} context */
function mount(container, context) {
  var button = context.ui.button({ label: '保存', onClick: save });
  container.appendChild(button.root);
  context.app.onDestroy(button.destroy);
}
```

离线可执行 `classintra-devkit sdk types --write ./types/classintra-sdk.d.ts`，然后引用 `import('../types/classintra-sdk').MarketContext`。导出默认保护已有文件，明确更新时加 `--force`。权威声明是 `devkit/types/sdk.d.ts`，旧的 `plugins/_sdk/sdk.d.ts` 仅保留兼容转出。

## 命名空间

| 入口 | 用途 | 约定 |
| --- | --- | --- |
| `ui` | 按钮、列表、搜索、空态、抽屉、导航栏 | 通过片段 `.root` 挂载、`.destroy()` 释放；抽屉另有 `open/close` |
| `data` | HTTP、存储、实时事件、房间 | HTTP 返回 axios 响应，`store` 返回业务值 |
| `system` | 用户、角色、跳转、分享、通知、剪贴板、搜索 | 前端角色控制展示，后端负责鉴权 |
| `device` | 文件、拍照、录音录像、网络、屏幕 | 依赖浏览器与用户授权；关闭应用释放采集 |
| `theme` | 当前主题、令牌、主题订阅 | 支持 `getToken('--ci-color-primary')` 和短名 `getToken('color-primary')` |
| `app` | manifest、配置、资源、日志、生命周期 | `onDestroy/onPause/onResume/onShare` 返回注销函数 |
| `compat` | 浏览器与特性探测 | 用 `has()` 做降级，真实平板仍需验收 |

## 数据与错误

`data.get/post/put/patch/delete` 沿用宿主客户端契约。URL 相对 `/api`，例如 `data.get('/my-app/items')`；不要重复加 `/api`。业务数据一般位于 `response.data.data`。错误通过 Promise rejection 返回，应用应保留用户输入并给出重试入口。

`data.storage` 是本机应用缓存，键带 `ci:app:<name>:` 前缀；同设备换账号不会自动变成用户私有区。敏感数据请使用 `data.store`，或在缓存键中包含账号 ID。字符串和 JSON 值均可存取；`set()` 返回 `false` 时应提示保存失败。

`data.store` 按应用和当前用户保存服务端数据，要求已安装、启用、已登录。`get()` 仅在键不存在时返回 `null`；应用未安装、停用、配额和网络错误会 reject，不能当成空态。

```js
context.data.store.set('draft', { title: '草稿' }).then(function() {
  return context.data.store.get('draft');
}).then(renderDraft).catch(showRetry);
```

`keys()` 返回 `{ key, updatedAt }[]`，`all()` 返回键值对象。默认每应用每人限 500 个键、单值 64KB、50 个文件、单文件 5MB。`getBlobUrl()` 返回当前 context 拥有的 object URL；用完可 `releaseBlobUrl(url)`，销毁时宿主兜底释放，迟到响应会被拒绝。

## 实时与清理

`data.realtime.subscribe(event, handler)` 接收全局事件，`data.channels` 管理房间事件。房间自动补为 `app:<name>:<room>`；加入后才能发布，连接恢复或服务重启后应重新加入。

```js
var stop = context.data.channels.subscribe('lobby', 'updated', render);
context.data.channels.join('lobby').catch(showRetry);
// 面板关闭时可 stop()；应用销毁另有兜底。
context.app.onDestroy(stop);
```

总线、实时、搜索 provider、主题订阅随各自 context 回收。页面、小组件、悬浮层各有 context，关闭页面应保留另一个 context 的订阅。手动 DOM 监听和定时器仍需登记 `onDestroy`。回调按逆序执行；注销函数只撤销登记，不主动执行清理。

`onShare()` 收到 `{ title, text, url, from }`，仅补发给目标应用，退订/销毁后不再回调。`system.share()` 返回实际 channel：`share/app/clipboard/none/cancelled`，取消不能显示成分享成功。

## 资源、导航和授权

`app.assetUrl('frontend/images/my icon.png')` 生成包内资源地址并编码文件名，拒绝外部 URL 和目录穿越。资源必须进入最终包；该方法不会启动本地预览。

`ui.hostNavbar` 设置宿主标题、状态 DOM 和动作；`layout.navbar: 'custom'` 会隐藏宿主导航。`system.openApp(name, params)` 打开另一应用，`system.navigate()` 跳转路由。

相机、麦克风、通知和剪贴板读取经 SDK 调用时，会经过宿主授权，再受浏览器权限限制。缓存按账号与登录会话区分；授权期间切换账号会中止操作。`capabilities` 仍是披露清单，同页面代码可以直接访问浏览器接口，这套流程不构成沙箱。请使用专用测试账号和测试宿主开发。

## 验证与发布

1. `classintra-devkit check <dir> --json` 检查 manifest、声明文件存在性、包内路径、前端规则和资源规模。
2. `classintra-devkit pack <dir> --write <market>/index.json` 先校验，再生成文件清单与哈希。无效包不会改写索引；`.d.ts` 不进入载荷，符号链接被拒绝。
3. 目录包与索引交由市场维护者，在获准的测试实例验证安装、启停、更新和卸载。

devkit 无运行时 npm 依赖。本地宿主预览仍在设计阶段；未安装包不能使用 datastore、后端和市场生命周期。Chrome 80/X5、真机媒体授权、HTTPS 和触屏体验需要独立验收。

维护者运行 `pnpm test:sdk`，覆盖 SDK 行为、devkit 离仓工作流和 TypeScript 消费。`client/test/browser-sdk-check.mjs` 生成 UI/脚手架浏览器冒烟测试，不依赖生产账号。
