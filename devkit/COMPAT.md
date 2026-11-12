# ClassIntra SDK 兼容矩阵（权威表）

`manifest.sdk: "1"` 只承诺**主契约版本**兼容，不保证每个历史宿主都具备后续追加的方法。
本表逐方法登记每个公开成员的引入宿主版本，是 `context.host.supports()` 特性探测的依据。

约定：

- **新增 SDK 方法时，必须随宿主发布在同一个版本里在此登记**；`client/test/compat-matrix.test.mjs`
  会逐行验证成员在真实 context 上可解析（删改成员或漏登记都会在测试里暴露）。
- 历史成员（SDK v1 契约建立时即存在）统一记 `v1`。
- `minHostVersion`（manifest 字段）适合整包声明最低宿主；单个方法的可用性探测用
  `context.host.supports('命名空间.方法')`。

## context 成员（客户端测试 compat-matrix 逐行验证可解析性；值成员直接读值并做空值兜底，不适用 supports()）

| 路径 | 引入宿主版本 | 说明 |
| --- | --- | --- |
| `ui.button` | v1 | |
| `ui.card` | v1 | |
| `ui.list` | v1 | |
| `ui.badge` | v1 | |
| `ui.segmented` | v1 | |
| `ui.toggle` | v1 | |
| `ui.searchBar` | v1 | |
| `ui.emptyState` | v1 | |
| `ui.spinner` | v1 | |
| `ui.toast` | v1 | |
| `ui.sectionTitle` | v1 | |
| `ui.toolbar` | v1 | |
| `ui.navbar` | v1 | |
| `ui.sheet` | v1 | |
| `ui.el` | v1 | |
| `ui.ensureStyles` | v1 | |
| `ui.hostNavbar.setTitle` | v1 | |
| `ui.hostNavbar.setStatus` | v1 | |
| `ui.hostNavbar.setActions` | v1 | |
| `ui.hostNavbar.clear` | v1 | |
| `data.request` | v1 | 解包业务值 + 统一错误；旧宿主先 `supports('data.request')` |
| `data.channels.join` | v1 | |
| `data.channels.leave` | v1 | |
| `data.channels.publish` | v1 | |
| `data.channels.subscribe` | v1 | |
| `data.channels.members` | v1 | |
| `data.channels.nameOf` | v1 | |
| `data.storage.get` | v1 | |
| `data.storage.set` | v1 | |
| `data.storage.remove` | v1 | |
| `data.storage.keys` | v1 | |
| `data.storage.clear` | v1 | |
| `data.store.get` | v1 | |
| `data.store.set` | v1 | |
| `data.store.remove` | v1 | |
| `data.store.keys` | v1 | |
| `data.store.all` | v1 | |
| `data.store.listBlobs` | v1 | |
| `data.store.uploadBlob` | v1 | |
| `data.store.getBlobUrl` | v1 | |
| `data.store.releaseBlobUrl` | v1 | |
| `data.store.deleteBlob` | v1 | |
| `data.get` | v1 | 旧式便捷封装（axios 响应） |
| `data.post` | v1 | |
| `data.put` | v1 | |
| `data.patch` | v1 | |
| `data.delete` | v1 | |
| `system.can` | v1 | |
| `system.getToken` | v1 | |
| `system.notify` | v1 | |
| `system.share` | v1 | |
| `system.setBadge` | v1 | |
| `system.openApp` | v1 | |
| `system.registerSearchProvider` | v1 | |
| `system.goDesktop` | v1 | |
| `system.navigate` | v1 | |
| `system.clipboard.write` | v1 | |
| `system.clipboard.read` | v1 | |
| `system.toast.alert` | v1 | |
| `system.toast.confirm` | v1 | |
| `system.toast.prompt` | v1 | |
| `system.modal.alert` | v1 | |
| `system.modal.confirm` | v1 | |
| `system.modal.prompt` | v1 | |
| `system.eventBus.emit` | v1 | |
| `system.eventBus.on` | v1 | |
| `system.eventBus.once` | v1 | |
| `system.eventBus.off` | v1 | |
| `system.router.push` | v1 | |
| `device.info` | v1 | |
| `device.filePicker` | v1 | |
| `device.camera` | v1 | 浏览器/用户授权另行判定（`capabilities` 披露 + 运行时授权） |
| `device.recordAudio` | v1 | |
| `device.recordVideo` | v1 | |
| `device.vibrate` | v1 | |
| `device.network` | v1 | |
| `device.screen` | v1 | |
| `theme.getToken` | v1 | |
| `theme.subscribe` | v1 | |
| `app.onDestroy` | v1 | |
| `app.assetUrl` | v1 | |
| `app.log` | v1 | |
| `app.warn` | v1 | |
| `app.error` | v1 | |
| `app.onPause` | v1 | |
| `app.onResume` | v1 | |
| `app.onShare` | v1 | |
| `compat.has` | v1 | 浏览器特性探测 |
| `host.atLeast` | 1.7.0 | 宿主版本未知时恒 false |
| `host.supports` | 1.7.0 | 方法存在性探测 |
| `route` | v1 | @deprecated 用 `system.route` |
| `router` | v1 | @deprecated 用 `system.router` |
| `user` | v1 | @deprecated 用 `system.user` |
| `eventBus` | v1 | @deprecated 用 `system.eventBus` |
| `toast` | v1 | @deprecated 用 `system.toast` |
| `modal` | v1 | @deprecated 用 `system.modal` |
| `system.user` | v1 | 当前用户（可能为 null） |
| `system.role` | v1 | |
| `system.isLoggedIn` | v1 | |
| `system.route` | v1 | |
| `system.theme` | v1 | |
| `theme.current` | v1 | |
| `app.name` | v1 | |
| `app.version` | v1 | |
| `app.manifest` | v1 | |
| `app.config` | v1 | |
| `compat.chromeVersion` | v1 | |
| `compat.isX5` | v1 | |
| `compat.isBelowBaseline` | v1 | |
| `version` | v1 | SDK 主契约版本（恒为 `'1'`） |
| `data.api` | v1 | 宿主 axios 实例 |
| `data.realtime` | v1 | |
| `data.websocket` | v1 | |
| `data.storage.prefix` | v1 | 值成员（命名空间前缀字符串） |
| `host.version` | 1.7.0 | 值成员（宿主版本；取不到为空串） |
| `api` | v1 | @deprecated 用 `data.api` |
| `websocket` | v1 | @deprecated 用 `data.websocket` |
| `realtime` | v1 | @deprecated 用 `data.realtime` |
| `realtimeEvents` | v1 | @deprecated 用 `data.realtime` |
| `store` | v1 | @deprecated 用 `data.store` |
