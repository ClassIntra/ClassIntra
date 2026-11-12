# 第三方 SDK 使用与调试

SDK v1 由宿主向 `mount(container, context)` 注入。入口仍为 `window.ClassIntraMarket.define()`；编辑器类型随独立 devkit 分发。

## 获取类型

安装团队分发的 devkit 后，JavaScript 使用 JSDoc，TypeScript 使用 `import type { MarketContext } from 'classintra-devkit/sdk'`。类型入口不提供浏览器运行时代码，TypeScript 项目仍须自行输出符合宿主要求的 JavaScript。

```bash
classintra-devkit create app notes-demo --label 便笺 --dir ./work
classintra-devkit sdk types --write ./work/notes-demo/sdk.d.ts
classintra-devkit sdk docs --write ./author-guide.md
classintra-devkit check ./work/notes-demo --json
classintra-devkit pack ./work/notes-demo --write ./market/index.json --json
```

全局安装 devkit 并不保证编辑器能解析模块路径。只用全局 CLI 时，推荐上面的声明导出方式：`frontend/entry.js` 里使用 `import('../sdk').MarketContext`。在开发项目中安装 devkit 为开发依赖时，才直接引用 `classintra-devkit/sdk`。

离线可执行 `classintra-devkit sdk types --write ./types/classintra-sdk.d.ts`，然后引用 `import('../types/classintra-sdk').MarketContext`。导出默认保护已有文件，明确更新时加 `--force`。权威声明是 `devkit/types/sdk.d.ts`，旧的 `plugins/_sdk/sdk.d.ts` 仅保留兼容转出。

指南本身也随包分发：`classintra-devkit sdk docs` 输出到终端，`sdk docs --write ./author-guide.md` 导出离线副本。误删后可再次导出；覆盖已有笔记须显式加 `--force`。

## 一个完整的入口

下面可整体替换 `notes-demo/frontend/entry.js`。示例只保存不含账号隐私的本机计数，不依赖应用后端；安装到测试宿主即可运行。使用本地导出的类型时，把 JSDoc 中的 `classintra-devkit/sdk` 换为 `../sdk`。

```js
(function() {
  /** @param {HTMLElement} container @param {import('classintra-devkit/sdk').MarketContext} context */
  function mount(container, context) {
    var card = context.ui.card({ title: '我的第一个应用', padded: true });
    var status = context.ui.el('p', 'notes-status', { role: 'status', 'aria-live': 'polite' });
    var count = Number(context.data.storage.get('count', 0)) || 0;
    status.textContent = '已记 ' + count + ' 次';
    var button = context.ui.button({
      label: '记一次',
      onClick: function() {
        var next = count + 1;
        if (!context.data.storage.set('count', next)) {
          status.textContent = '保存失败，请检查浏览器存储空间';
          return;
        }
        count = next;
        status.textContent = '已保存：' + count;
      }
    });
    card.root.appendChild(status);
    card.root.appendChild(button.root);
    container.appendChild(card.root);
    context.app.onDestroy(function() {
      button.destroy();
      card.destroy();
    });
  }
  window.ClassIntraMarket.define({
    name: 'notes-demo',
    mount: mount,
    unmount: function(container) { container.innerHTML = ''; }
  });
})();
```

manifest 的 `name`、目录名和 `define().name` 必须一致。页面、桌面小组件和悬浮层使用各自的 context；不要在模块顶层保存一个全局 context 供所有挂载共用。普通页面使用 `define`，全局悬浮层另在 manifest 声明 `frontend.overlay` 并调用 `defineOverlay`。

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

新代码可选择 `data.request<T>({ url, method, data, params, timeout, signal })`：成功解包 `{ code: 200, data }`，失败返回统一的 `SdkRequestError`。`T` 是 TypeScript/JSDoc 类型提示，不会替应用验证自定义数据 schema。默认超时 10 秒，`timeout: 0` 关闭超时。

| 字段 | 意义 |
| --- | --- |
| `code` | 优先保留服务端 `error_code`，否则为 SDK 稳定错误码 |
| `status` | HTTP/业务状态码，无响应时为 0 |
| `message` | 可展示给用户的错误说明 |
| `details` | 服务端业务错误数据，缺省为 null |
| `retryable` | 临时故障提示；不会自动重试，也不代表写操作可安全重发 |
| `retryAfterMs` | 服务端 `Retry-After` 对应的等待毫秒数，未知为 null |

常见错误码：`SDK_NETWORK_ERROR`、`SDK_TIMEOUT`、`SDK_HTTP_ERROR`、`SDK_INVALID_RESPONSE`、`SDK_CANCELLED`、`SDK_DISPOSED`、`SDK_ACCOUNT_CHANGED`、`SDK_UNAVAILABLE`。URL 或参数错误为 `SDK_INVALID_URL`、`SDK_INVALID_METHOD`、`SDK_INVALID_OPTIONS`。

请求在应用销毁或调用方 signal 取消时立即 reject。若底层支持 AbortController，会同步中止传输；不支持时仍会丢弃迟到响应。切换账号后收到的旧请求结果不会交给新账号。取消请求不能撤销服务端已经完成的写入，重复提交需要后端幂等设计。

```js
/** @param {import('classintra-devkit/sdk').MarketContext} context */
function loadItems(context) {
  /** @type {Promise<{ items: Array<{ id: string, title: string }> }>} */
  var request = context.data.request({ url: '/notes-demo/items', timeout: 8000 });
  return request.then(function(data) {
    context.app.log('已读取条目', data.items);
    return data.items;
  }).catch(function(error) {
    if (error.code === 'SDK_CANCELLED' || error.code === 'SDK_DISPOSED') return [];
    context.app.warn('读取失败，请保留当前内容并提供重试入口', error.message);
    throw error;
  });
}
```

`data.get/post/put/patch/delete` 沿用宿主客户端契约。URL 相对 `/api`，例如 `data.get('/my-app/items')`；不要重复加 `/api`。业务数据一般位于 `response.data.data`。错误通过 Promise rejection 返回，应用应保留用户输入并给出重试入口。

`data.storage` 是本机应用缓存，键带 `ci:app:<name>:` 前缀；同设备换账号不会自动变成用户私有区。敏感数据请使用 `data.store`，或在缓存键中包含账号 ID。字符串和 JSON 值均可存取；`set()` 返回 `false` 时应提示保存失败。

`data.store` 按应用和当前用户保存服务端数据，要求已安装、启用、已登录。`get()` 仅在键不存在时返回 `null`；应用未安装、停用、配额和网络错误会 reject，不能当成空态。

应用销毁后不再发起新存储请求；切换账号后迟到的私有数据不会交给新账号。响应字段缺失或类型损坏时会 reject，保留当前草稿并提示重试，不能拿空列表覆盖本地内容。

先 `store.set('draft', value)`，再 `store.get('draft')` 读取；两者均返回 Promise。UI 应先等待保存成功，再显示“已保存”；reject 时保留输入和上次成功状态。账户存储在卸载时是否保留，取决于宿主清理策略与应用自己的 cleanup，不能用重装代替数据备份。

`keys()` 返回 `{ key, updatedAt }[]`，`all()` 返回键值对象。默认每应用每人限 500 个键、单值 64KB、50 个文件、单文件 5MB。`getBlobUrl()` 返回当前 context 拥有的 object URL；用完可 `releaseBlobUrl(url)`，销毁时宿主兜底释放，迟到响应会被拒绝。

## 实时与清理

`data.realtime.subscribe(event, handler)` 接收全局事件，`data.channels` 管理房间事件。房间自动补为 `app:<name>:<room>`；加入后才能发布，连接恢复或服务重启后应重新加入。

房间名限 1–40 位字母、数字、`_ . : -`；非法名称会被拒绝，避免删除字符后意外进入另一个同名房间。

`channels.subscribe('lobby', 'updated', handler)` 返回退订函数；`join('lobby')` 加入房间；`publish('lobby', 'updated', payload)` 发布。`members()` 返回 `{ channel, count }`，不返回成员列表。它们的返回值已经解包，无需再访问 `.data.data`。

总线、实时、搜索 provider、主题订阅随各自 context 回收。页面、小组件、悬浮层各有 context，关闭页面应保留另一个 context 的订阅。手动 DOM 监听和定时器仍需登记 `onDestroy`。回调按逆序执行；注销函数只撤销登记，不主动执行清理。

主题订阅退订与销毁均幂等，已销毁的 context 不再接收新订阅。应用内定时任务用 `onPause/onResume` 暂停与恢复；`onPause` 对应浏览器页面进入后台，不保证在同页路由切换时触发。离开应用的最终释放依靠 `onDestroy`。

`onShare()` 收到 `{ title, text, url, from }`，仅补发给目标应用，退订/销毁后不再回调。`system.share()` 返回实际 channel：`share/app/clipboard/none/cancelled`，取消不能显示成分享成功。

## 资源、导航和授权

`app.assetUrl('frontend/images/my icon.png')` 生成包内资源地址并编码文件名，拒绝外部 URL 和目录穿越。资源必须进入最终包；该方法不会启动本地预览。

`ui.hostNavbar` 设置宿主标题、状态 DOM 和动作；`layout.navbar: 'custom'` 会隐藏宿主导航。`system.openApp(name, params)` 打开另一应用，`system.navigate()` 跳转路由。

相机、麦克风、通知和剪贴板读取经 SDK 调用时，会经过宿主授权，再受浏览器权限限制。缓存按账号与登录会话区分；授权期间切换账号会中止操作。`capabilities` 仍是披露清单，同页面代码可以直接访问浏览器接口，这套流程不构成沙箱。请使用专用测试账号和测试宿主开发。

文件选择取消或应用销毁时 resolve 空数组；拍照返回 Blob，录音录像返回 `{ blob, duration, mimeType }`（`duration` 为毫秒，录像另有 `hasAudio`）。浏览器不支持、用户拒绝或应用销毁时，媒体 Promise 会 reject，界面应保留可恢复状态。

## 验证与发布

1. `classintra-devkit check <dir> --json` 检查 manifest、声明文件存在性、包内路径、前端规则和资源规模。
2. `classintra-devkit preview <dir>` 把本地包**免安装**挂进真实宿主预览调试（需宿主开启 `CLASSINTRA_DEV_PREVIEW=1`）：预览与安装共用同一套校验器和热挂载管线，但不下载、不落盘、不写数据库，服务重启即清空。改前端文件刷新即生效；`--watch` 时后端变更自动重挂。凭据用 `--token`（班管浏览器的 JWT）或 `--secret` + `--user`（本地签发）。
3. `classintra-devkit pack <dir> --write <market>/index.json` 先校验，再生成文件清单与哈希。无效包不会改写索引；`.d.ts` 不进入载荷，符号链接被拒绝。
4. `classintra-devkit install <name> --source local` 从本地市场源走一遍真实安装链路（下载校验、原子落盘、热挂载、失败回滚），覆盖预览覆盖不到的部分；`--update` / `--uninstall` 验证更新与卸载。
5. 目录包与索引交由市场维护者，在获准的测试实例验证安装、启停、更新和卸载。

devkit 无运行时 npm 依赖。未安装包不能使用 datastore、后端和市场生命周期。Chrome 80/X5、真机媒体授权、HTTPS 和触屏体验需要独立验收。

## 常见故障

| 现象 | 核对与恢复动作 |
| --- | --- |
| 页面空白、入口未注册 | 核对目录/manifest/define 的 name 和 entry 路径，先运行 check，查看宿主应用错误记录 |
| 编辑器找不到 SDK 类型 | 用 sdk types 导出到项目，并把 JSDoc 改为相对路径；全局 CLI 安装不会自动成为项目依赖 |
| UI 没有显示 | 检查插入的是 fragment.root，toast 片段也需要挂进 DOM |
| 请求 404 | 路径相对 /api，避免 /api/api；检查后端是否已安装启用 |
| 请求成功但未读到业务数据 | 区分 request/store/channels 的解包结果与 get/post 的 axios 响应 |
| preview 报 403 | 宿主未开启 CLASSINTRA_DEV_PREVIEW=1，或当前账号不是班管 |
| preview 报同名冲突 | 已存在同名已安装应用——预览其更新版请先卸载旧版，或临时改名 |
| preview 后端 404 | 重挂一次（`--watch` 会自动）；后端 require 失败时看宿主控制台错误 |
| 手机/平板无法拍照 | 使用可用的 HTTPS 测试宿主，检查浏览器和账号授权；桌面模拟通过不代表硬件验收通过 |
| 关闭应用后仍收到事件 | 使用返回的退订函数，手工监听登记 onDestroy，避免缓存旧 context |
| pack 拒绝索引 | 先修复现有 index.json 结构；原文件会被保留，禁止用空索引掩盖错误 |

## 兼容与迁移

插件作者可通过 `import type { BackendErrors, BackendRelay, TicketStore } from 'classintra-devkit/backend'` 获取服务端错误、短时票据、媒体中转和出站请求的类型。JavaScript 可用相同路径的 JSDoc 类型注解。

这个子路径只分发声明，不能作为运行时模块导入。运行时代码仍来自测试宿主的 `plugins/_sdk/backend/errors.js` 与 `stream-relay.js`；插件应按安装后的目录结构引用它们。类型参数不会替代输入校验。票据 `verify()` 不消费票据，有效期内可重复校验，不能把它当作单次使用令牌。

`get/post/put/patch/delete` 仍保留原始 HTTP 返回值，`request` 是新增的可选接口。`sdk: '1'` 只表示主契约版本，不保证每个历史宿主都具备后续追加的方法。需要兼容旧宿主时先判断 `typeof context.data.request === 'function'`，或把最低宿主版本写入发布说明；不要无检查调用后白屏。

宿主版本与逐方法探测：`context.host.version`（宿主 semver，取不到为空串）、`context.host.atLeast('1.7.0')`（未知宿主恒 false）、`context.host.supports('data.request')`（方法存在性）。整包声明最低宿主用 manifest 的可选字段 `minHostVersion`（semver）：宿主低于该版本时安装/预览直接拒绝、客户端挂载时明确报错。逐方法引入版本登记在随包分发的 `COMPAT.md`（npm 安装后位于 `node_modules/classintra-devkit/COMPAT.md`）；新增宿主能力必须随发布登记。

项目对直出脚本采用保守 ES5 风格；这与“某语法是否由 Chrome 80 原生支持”是两回事。TS/Vue/React 作者应在自己的构建中输出宿主可加载的 JS、CSS 和资源。应用自己的 package.json、源码与开发依赖建议放在市场包目录外。

该工具只生成目录包清单与哈希，不会把分散文件复制成完整市场源。发布时须按 `apps/<name>`、`plugins/<name>`、`themes/<id>` 的最终结构摆放文件，索引的 files 路径才可解析；签名、审核、分发由市场维护流程完成。

维护者运行 `pnpm test:sdk`，覆盖 SDK 行为、devkit 离仓工作流和 TypeScript 消费。`client/test/browser-sdk-check.mjs` 生成 UI/脚手架浏览器冒烟测试，不依赖生产账号。
