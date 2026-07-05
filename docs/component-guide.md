# ClassIntra 组件文档

> 本文档列出 ClassIntra 通用组件的使用方式、Props、事件和示例。
> 所有组件兼容 Vue 2.7 + Chrome 80+。

---

## 目录

- [GlobalSearch 全局搜索](#1-globalsearch-全局搜索)
- [ModalDialog 模态对话框](#2-modaldialog-模态对话框)
- [ErrorBoundary 错误边界](#3-errorboundary-错误边界)
- [LoadingSkeleton 骨架屏](#4-loadingskeleton-骨架屏)
- [SuperIsland 超能岛](#5-superisland-超能岛)
- [LockScreen 锁屏](#6-lockscreen-锁屏)

---

## 1. GlobalSearch 全局搜索

**位置**：[client/src/components/GlobalSearch.vue](../client/src/components/GlobalSearch.vue)

**已全局注册**：在 [App.vue](../client/src/App.vue#L14) 中作为子组件使用，通过 `ref="globalSearch"` 暴露方法。

### 触发方式

- **快捷键 `Ctrl+K`**（输入框中也触发，已注册为 global hotkey）
- **代码调用**：`this.$refs.globalSearch.open()`

### 公开方法

#### open()

打开搜索框并自动聚焦输入框。

#### close()

关闭搜索框并清空状态。

### Props

无 Props。组件内部通过 `SearchRegistry` 单例获取搜索源。

### 行为说明

- **三源搜索**：应用（来自 `APP_REGISTRY`） + 命令（`registerCommand`） + Provider（`registerProvider`）
- **300ms 防抖**：输入后延迟 300ms 才触发搜索，避免频繁请求
- **键盘导航**：
  - `↑` / `↓`：在结果间移动选中
  - `Enter`：执行选中项
  - `Esc`：关闭
- **最近搜索**：无输入时显示最近 10 条搜索历史（持久化到 localStorage）
- **分组展示**：结果按 category 分组（应用 / 命令 / 自定义分组）
- **毛玻璃 UI**：使用 backdrop-filter 实现毛玻璃效果
- **暗色模式**：自动跟随 ThemeEngine 切换

### 主题适配

组件 mounted 时通过 `$services.resolve('themeEngine')` 订阅主题变化，自动切换浅色/深色样式。

### 自定义搜索源

详见 [api-reference.md#5-searchregistry-全局搜索](./api-reference.md#5-searchregistry-全局搜索)。

### 示例：注册命令让 GlobalSearch 可搜索

```javascript
// 在任意组件 mounted 中
import { getSearchRegistry } from '@/core/search-registry';

getSearchRegistry().registerCommand({
  id: 'go-countdown',
  title: '打开倒数日',
  description: '快速跳转到倒数日应用',
  keywords: ['countdown', '倒数', '倒计时'],
  icon: 'fa-solid fa-hourglass-half',
  action: function() {
    window.__router.push('/countdown');
  }
});
```

---

## 2. ModalDialog 模态对话框

**位置**：[client/src/components/ModalDialog.vue](../client/src/components/ModalDialog.vue)

**已全局注册**：在 [main.js](../client/src/main.js#L117) 中 `Vue.component('ModalDialog', ModalDialog)`，并通过 `ModalPlugin` 暴露 `this.$modal` API。

### this.$modal API

#### alert(options)

显示警告框（单按钮，点击确定后 resolve `true`）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| options | string \| object | 是 | 字符串作为 message，或对象配置 |
| options.title | string | 否 | 标题 |
| options.message | string | 否 | 内容 |
| options.confirmText | string | 否 | 确定按钮文字（默认 `'确定'`） |

**返回**：`Promise<true>`

**示例**：

```javascript
this.$modal.alert('保存成功');

// 或
this.$modal.alert({
  title: '提示',
  message: '保存成功',
  confirmText: '知道了'
}).then(function() {
  console.log('用户已确认');
});
```

#### confirm(options)

显示确认框（双按钮，点击确定 resolve `true`，取消 resolve `false`）。

**返回**：`Promise<boolean>`（true 表示确认，false 表示取消）

**示例**：

```javascript
this.$modal.confirm({
  title: '删除确认',
  message: '确定要删除这条记录吗？此操作不可撤销。',
  confirmText: '删除',
  cancelText: '取消'
}).then(function(result) {
  if (result) {
    // 用户点击了"删除"
    deleteRecord();
  }
  // result === false 时表示点击了"取消"，不做任何事
});
```

> **重要**：`handleCancel` 使用 `resolve(false)`，调用方必须检查 result 才能继续执行删除等危险操作。

#### prompt(options)

显示输入框（点击确定 resolve 输入值，取消 resolve `null`）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| options.title | string | 否 | 标题 |
| options.message | string | 否 | 提示文字 |
| options.placeholder | string | 否 | 输入框 placeholder |
| options.confirmText | string | 否 | 确定按钮文字 |
| options.cancelText | string | 否 | 取消按钮文字 |

**返回**：`Promise<string | null>`（输入值或 null）

**示例**：

```javascript
this.$modal.prompt({
  title: '重命名',
  message: '请输入新名称：',
  placeholder: '输入名称'
}).then(function(name) {
  if (name !== null) {
    // 用户输入了内容并点击确定
    renameRecord(name);
  }
});
```

### 在组件中使用（推荐）

由于 `ModalDialog` 已在 App.vue 中作为子组件挂载（`<ModalDialog ref="modalDialog" />`），并通过 `ModalPlugin` 暴露 `this.$modal`，**业务组件无需再次引入，直接用 `this.$modal.xxx()` 即可**。

### 自定义样式

通过 CSS 变量定制：

```scss
.modal-container {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
}
.modal-btn-confirm {
  background: var(--primary-color);
  color: #fff;
}
```

---

## 3. ErrorBoundary 错误边界

**位置**：[client/src/components/ErrorBoundary.vue](../client/src/components/ErrorBoundary.vue)

**已全局注册**：在 [main.js](../client/src/main.js#L119) 中 `Vue.component('ErrorBoundary', ErrorBoundary)`。

### 用途

包裹路由组件，捕获子组件渲染错误，显示友好的错误提示而非白屏。

### 使用方式

```vue
<template>
  <ErrorBoundary>
    <MyPage />
  </ErrorBoundary>
</template>
```

App.vue 中已包裹 `<router-view>`：

```vue
<transition name="page-fade" mode="out-in">
  <ErrorBoundary>
    <router-view></router-view>
  </ErrorBoundary>
</transition>
```

### 错误捕获机制

通过 Vue 2 的 `errorCaptured` 钩子捕获子组件错误：

```javascript
errorCaptured: function(err, vm, info) {
  this.error = err;
  console.error('ErrorBoundary caught:', err, info);
  return false;  // 阻止错误继续向上传播
}
```

### 错误提示

- **资源加载失败**：检测 `Loading chunk` / `Failed to fetch dynamically imported module` 关键字，提示"网络连接异常"
- **其他错误**：显示错误消息（截断到 100 字符）
- **操作按钮**：
  - "重新加载"：`window.location.reload()`
  - "返回"：`$router.go(-1)` 或跳转首页

### Props

无。

### Slots

| 名称 | 说明 |
|------|------|
| default | 默认插槽，被包裹的内容 |

---

## 4. LoadingSkeleton 骨架屏

**位置**：[client/src/components/LoadingSkeleton.vue](../client/src/components/LoadingSkeleton.vue)

**已全局注册**：在 [main.js](../client/src/main.js#L118) 中 `Vue.component('LoadingSkeleton', LoadingSkeleton)`。

### 用途

页面或组件加载时显示骨架屏，提升感知性能。

### 使用示例

```vue
<template>
  <div>
    <LoadingSkeleton v-if="loading" />
    <div v-else>{{ content }}</div>
  </div>
</template>
```

---

## 5. SuperIsland 超能岛

**位置**：[client/src/components/SuperIsland.vue](../client/src/components/SuperIsland.vue)

### 用途

仿 iOS 灵动岛的顶部通知条，显示：
- WebSocket 推送的实时消息（聊天、社区、点赞等）
- 天气预警（滚动文字，两遍后自动关闭）
- 音乐播放状态

### 使用方式

已在 [App.vue](../client/src/App.vue#L3) 中全局挂载：

```vue
<SuperIsland ref="superIsland" v-show="!isLocked && !desktopSettingsPanelOpen" />
```

### 通过 ref 调用方法

```javascript
// 显示天气预警
this.$refs.superIsland.showWeatherAlert({
  eventType: { name: '降雨提醒' },
  severity: 'minor',
  headline: '降雨提醒',
  description: '预计将有降雨，请注意出行安全'
});

// 显示普通通知
this.$refs.superIsland.show({
  type: 'message',
  title: '新消息',
  content: '张三：你好'
});
```

### 隐藏逻辑

- 锁屏时隐藏（`v-show="!isLocked"`）
- 桌面设置面板打开时隐藏（避免叠层冲突）

---

## 6. LockScreen 锁屏

**位置**：[client/src/components/LockScreen.vue](../client/src/components/LockScreen.vue)

### 用途

屏幕锁定页面，需要密码解锁。

### 触发方式

- **5 次快速点击**：在桌面任意位置 1 秒内连点 5 次，触发锁屏
- **断网时**：心跳检测连续 5 次失败（约 10 秒容错），自动锁屏并隐藏敏感信息
- **手动调用**：`this.lockScreen()`

### 解锁

输入正确密码后，触发 `@unlock` 事件，App.vue 监听并恢复界面。

### 隐藏敏感信息（断网时）

`lockForOffline()` 方法同步执行：

1. `document.documentElement.classList.add('offline-secure')` — CSS 隐藏敏感元素
2. `document.title = ''` — 清空标题
3. `lockScreen()` — 立即触发锁屏
4. `requestAnimationFrame` 后清空敏感 DOM 内容（`.chat-page`、`.community-page` 等）

### 状态持久化

- `localStorage.app_locked = 'true'` — 锁屏状态
- 锁屏前自动暂停音乐 + 静音
- 解锁后恢复原播放状态

---

## 附录：组件注册速查

| 组件 | 注册位置 | 使用方式 |
|------|----------|----------|
| `ModalDialog` | [main.js](../client/src/main.js#L117) 全局注册 | `this.$modal.alert/confirm/prompt(...)` |
| `LoadingSkeleton` | [main.js](../client/src/main.js#L118) 全局注册 | `<LoadingSkeleton />` |
| `ErrorBoundary` | [main.js](../client/src/main.js#L119) 全局注册 | `<ErrorBoundary><xxx /></ErrorBoundary>` |
| `GlobalSearch` | [App.vue](../client/src/App.vue#L14) 局部引用 | 快捷键 `Ctrl+K` 或 `this.$refs.globalSearch.open()` |
| `SuperIsland` | [App.vue](../client/src/App.vue#L3) 局部引用 | `this.$refs.superIsland.show(...)` |
| `LockScreen` | [App.vue](../client/src/App.vue#L16) 局部引用 | `this.lockScreen()` 触发 |
