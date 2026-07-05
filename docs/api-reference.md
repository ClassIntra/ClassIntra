# ClassIntra API 参考

> 本文档列出所有核心模块的公开 API 签名、参数、返回值和使用示例。
> 代码示例可直接复制粘贴运行。所有 API 均兼容 Chrome 80+。

---

## 目录

- [ServiceRegistry 服务注册中心](#1-serviceregistry-服务注册中心)
- [ThemeEngine 主题引擎](#2-themeengine-主题引擎)
- [EventBus 事件总线](#3-eventbus-事件总线)
- [HotkeyManager 快捷键管理器](#4-hotkeymanager-快捷键管理器)
- [SearchRegistry 全局搜索](#5-searchregistry-全局搜索)
- [PersistenceStore 持久化存储](#6-persistencestore-持久化存储)
- [ClassIntraError 错误类型](#7-classintraerror-错误类型)
- [globalErrorHandler 全局错误处理器](#8-globalerrorhandler-全局错误处理器)
- [Manifest Schema 验证](#9-manifest-schema-验证)
- [集成协议契约](#10-集成协议契约)
- [PostMessageBridge 消息桥接](#11-postmessagebridge-消息桥接)
- [OutboundLauncher 外部站点嵌入](#12-outboundlauncher-外部站点嵌入)
- [IntegrationManager 集成管理器](#13-integrationmanager-集成管理器)
- [Token Store 集成令牌管理](#14-token-store-集成令牌管理)
- [Migration Runner DB 迁移执行器](#15-migration-runner-db-迁移执行器)
- [聚合器 API](#16-聚合器-api)

---

## 1. ServiceRegistry 服务注册中心

**位置**：[client/src/core/service-registry.js](../client/src/core/service-registry.js) / [server/src/core/service-registry.js](../server/src/core/service-registry.js)

**单例获取**：

```javascript
// 前端
import { getServiceRegistry } from '@/core/service-registry';
var registry = getServiceRegistry();

// 后端
var registry = require('../core/service-registry').getServiceRegistry();
```

### register(name, factory, options)

注册服务工厂。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 服务名（如 `'themeEngine'`） |
| factory | function(registry) => instance \| { instance, destroy } | 是 | 工厂函数，懒创建 |
| options | { singleton: boolean } | 否 | 默认 `{ singleton: true }` |

**返回**：无

**示例**：

```javascript
// 简单注册（返回实例）
registry.register('eventBus', function() {
  return getEventBus();
});

// 带销毁函数（返回 { instance, destroy }）
registry.register('db', function() {
  var conn = createDbConnection();
  return {
    instance: conn,
    destroy: function() { conn.close(); }
  };
});

// 非单例（每次 resolve 创建新实例）
registry.register('requestContext', function() {
  return { id: Date.now() };
}, { singleton: false });
```

### resolve(name)

同步解析服务（懒创建 + 缓存）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 服务名 |

**返回**：`instance` 或 `undefined`（未注册时）

**示例**：

```javascript
var themeEngine = registry.resolve('themeEngine');
if (themeEngine) {
  themeEngine.setTheme('dark');
}
```

### resolveAsync(name)

异步解析服务（factory 返回 Promise）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 服务名 |

**返回**：`Promise<instance>`（未注册时 resolve 为 `undefined`）

**示例**：

```javascript
registry.resolveAsync('lazyModule').then(function(mod) {
  if (mod) mod.init();
});
```

### has(name)

检查服务是否已注册。

**返回**：`boolean`

### list()

列出所有已注册服务名。

**返回**：`string[]`

### shutdown()

逆序销毁所有服务（单个异常不中断）。

**返回**：`Array<{ name: string, error: Error }>`（销毁过程中产生的异常列表）

**示例**：

```javascript
window.addEventListener('beforeunload', function() {
  var errors = registry.shutdown();
  if (errors.length > 0) {
    console.warn('[shutdown] 销毁异常:', errors);
  }
});
```

---

## 2. ThemeEngine 主题引擎

**位置**：[client/src/core/theme-engine.js](../client/src/core/theme-engine.js)

**单例获取**：

```javascript
import { getThemeEngine } from '@/core/theme-engine';
var themeEngine = getThemeEngine();
```

### registerTheme(id, options)

注册主题。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | 是 | 主题 id（如 `'light'`、`'dark'`） |
| options.name | string | 否 | 显示名（默认 id） |
| options.type | `'light'` \| `'dark'` | 否 | 主题类型（默认 `'light'`） |
| options.tokens | object | 否 | 主题 token（结构见 `theme-tokens.js`） |
| options.icons | object | 否 | 主题图标映射 |

**内置主题**：`'light'`（默认浅色）和 `'dark'`（默认深色）已在 `getThemeEngine()` 中注册。

### setTheme(id)

设置当前主题。会触发 CSS 切换 + 写入 `--ci-*` 变量 + 通知订阅者 + EventBus 广播。

**示例**：

```javascript
themeEngine.setTheme('dark');
```

### toggleColorScheme()

在 light/dark 之间切换。

**返回**：切换后的主题 id

### subscribe(callback)

订阅主题变化。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| callback | function(payload) | 是 | 主题变化回调 |

**payload 结构**：

```javascript
{
  id: 'dark',           // 新主题 id
  previous: 'light',    // 旧主题 id（首次为 null）
  type: 'dark',         // 主题类型
  icons: null           // 主题图标
}
```

**返回**：取消订阅函数

**示例**：

```javascript
var unsubscribe = themeEngine.subscribe(function(payload) {
  console.log('主题切换:', payload.previous, '→', payload.id);
});
// 取消订阅
unsubscribe();
```

### setMotionEnabled(enabled)

启用/禁用动画。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| enabled | boolean | 是 | true 启用 / false 禁用 |

**禁用动画原理**：设置 `documentElement[data-no-motion="true"]`，由 `_motion.scss` 全局规则将所有 `transition` / `animation` 设为 `0s`。同时持久化到 `localStorage.ci_motion_disabled`。

### isMotionEnabled()

查询动画是否启用。

**返回**：`boolean`

### initMotion()

初始化动画开关（应在 App.vue mounted 中调用一次）。

**优先级**：`localStorage.ci_motion_disabled` > `prefers-reduced-motion: reduce` > 默认启用

### getCurrentTheme() / getCurrentThemeType()

获取当前主题 id 或类型。

**返回**：`string`（如 `'light'` / `'dark'`）

### listThemes()

列出所有已注册主题。

**返回**：`Array<{ id, name, type, icons }>`

### getTheme(id)

获取主题定义。

**返回**：`{ id, name, type, tokens, icons }` 或 `null`

---

## 3. EventBus 事件总线

**位置**：[client/src/core/event-bus.js](../client/src/core/event-bus.js)

**单例获取**：

```javascript
import { getEventBus } from '@/core/event-bus';
var bus = getEventBus();
```

### on(eventName, handler)

注册事件监听器。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| eventName | string | 是 | 事件名（建议使用 `EVENT_NAMES` 常量） |
| handler | function(...args) | 是 | 事件处理函数 |

**返回**：取消订阅函数

**示例**：

```javascript
import { EVENT_NAMES } from '@shared/constants';

var unsubscribe = bus.on(EVENT_NAMES.THEME_CHANGED, function(payload) {
  console.log('主题已切换:', payload.id);
});
// 取消订阅
unsubscribe();
```

### once(eventName, handler)

注册一次性事件监听器（触发后自动移除）。

**返回**：取消订阅函数

### off(eventName, handler)

移除事件监听器。

### emit(eventName, ...args)

触发事件。所有参数（除 eventName 外）透传给 handler。

**handler 异常隔离**：单个 handler throw 不影响其他 handler。异常通过 `'error:handler'` 事件报告。

**示例**：

```javascript
bus.emit('user:signed-in', { userId: '123', name: '张三' });
```

### removeAllListeners(eventName)

移除某事件的所有监听器。不传参数则移除所有事件的所有监听器。

### listenerCount(eventName)

获取某事件的监听器数量。

**返回**：`number`

---

## 4. HotkeyManager 快捷键管理器

**位置**：[client/src/core/hotkey-manager.js](../client/src/core/hotkey-manager.js)

**单例获取**：

```javascript
import { getHotkeyManager } from '@/core/hotkey-manager';
var hotkey = getHotkeyManager();  // 自动 install
```

### register(binding)

注册快捷键。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| binding.id | string | 否 | 唯一标识（用于去重，缺省自动生成） |
| binding.combo | string | 是 | 组合键，如 `'Ctrl+K'`、`'alt+s'`、`'ctrl+shift+p'` |
| binding.description | string | 否 | 描述（供 UI 展示） |
| binding.handler | function(e) | 是 | 处理函数 |
| binding.global | boolean | 否 | 是否在输入框中也触发（默认 false） |

**combo 规范化**：自动转为小写 + 排序修饰键。`'Ctrl+K'` / `'ctrl+k'` / `'Control+K'` 统一为 `'ctrl+k'`。

**支持的特殊键**：`esc` / `del` / `space` / `up` / `down` / `left` / `right`

**返回**：取消注册函数

**示例**：

```javascript
// 注册 Ctrl+K（输入框中也触发）
var unregister = hotkey.register({
  id: 'global-search',
  combo: 'Ctrl+K',
  description: '打开全局搜索',
  global: true,
  handler: function(e) {
    e.preventDefault();
    openSearch();
  }
});

// 取消注册
unregister();
```

### list()

获取所有已注册的快捷键（供 UI 展示）。

**返回**：`Array<{ id, combo, description, global }>`

### clear()

取消所有注册（保留 install 状态）。

### uninstall()

卸载全局 keydown 监听器。

---

## 5. SearchRegistry 全局搜索

**位置**：[client/src/core/search-registry.js](../client/src/core/search-registry.js)

**单例获取**：

```javascript
import { getSearchRegistry } from '@/core/search-registry';
var search = getSearchRegistry();
```

### registerProvider(provider)

注册自定义搜索源（异步）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| provider.id | string | 是 | 唯一标识 |
| provider.category | string | 否 | 分组名（如 `'笔记'`、`'社区'`，默认为 id） |
| provider.search | function(query) => Promise<result[]> \| result[] | 是 | 搜索函数 |

**result 结构**：

```javascript
{
  id: 'note:123',          // 唯一标识
  title: '笔记标题',         // 显示标题
  description: '...',      // 可选，描述
  icon: 'fa-solid fa-note',  // 可选，图标 class
  iconColor: '#FFCC00',    // 可选，图标颜色
  action: function() {}    // 可选，点击回调
}
```

**返回**：取消注册函数

### registerCommand(command)

注册可搜索的命令。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| command.id | string | 是 | 唯一标识 |
| command.title | string | 是 | 命令标题 |
| command.description | string | 否 | 描述 |
| command.icon | string | 否 | 图标 class |
| command.keywords | string[] | 否 | 关键词（用于匹配） |
| command.action | function() | 否 | 执行回调 |

**返回**：取消注册函数

**示例**：

```javascript
search.registerCommand({
  id: 'toggle-theme',
  title: '切换深色模式',
  description: '在浅色/深色主题间切换',
  keywords: ['theme', 'dark', '主题', '深色'],
  icon: 'fa-solid fa-moon',
  action: function() {
    getThemeEngine().toggleColorScheme();
  }
});
```

### search(query)

执行搜索（应用 + 命令 + Provider 三源异步聚合）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 搜索关键词 |

**返回**：`Promise<{ groups: Array<{ category, items }>, total }>`

**示例**：

```javascript
search.search('笔记').then(function(result) {
  console.log('共找到', result.total, '条结果');
  result.groups.forEach(function(group) {
    console.log('分组:', group.category, '条数:', group.items.length);
  });
});
```

### addRecentSearch(query) / getRecentSearches() / clearRecentSearches()

最近搜索历史管理（持久化到 localStorage，最多 10 条）。

---

## 6. PersistenceStore 持久化存储

**位置**：[client/src/core/persistence-store.js](../client/src/core/persistence-store.js)

**单例获取**：

```javascript
import { getDefaultStore } from '@/core/persistence-store';
var store = getDefaultStore();  // prefix 默认 'classintra:'
```

### get(key, defaultValue)

读取并反序列化 JSON。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | key（不含 prefix） |
| defaultValue | any | 否 | 不存在时返回的默认值 |

**返回**：反序列化后的值，或 `defaultValue`

### set(key, value)

序列化并写入。

### remove(key)

删除 key。

### has(key)

检查 key 是否存在。

**返回**：`boolean`

### clear()

清空所有以当前 prefix 开头的 key。

### onChange(key, handler)

订阅 key 变化。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| key | string | 是 | 监听的 key |
| handler | function(newValue, fullKey) | 是 | 变化回调 |

**返回**：取消订阅函数

### getVersion()

获取当前数据版本（用于迁移后检查）。

**返回**：`number`

### isUsingLocalStorage()

是否在使用 localStorage（供调试用）。

**返回**：`boolean`

---

## 7. ClassIntraError 错误类型

**位置**：[shared/src/errors.js](../shared/src/errors.js) / [server/src/core/errors.js](../server/src/core/errors.js)

### 构造函数

```javascript
import { ClassIntraError } from '@shared/errors';
import { ERROR_CODES } from '@shared/constants';

var err = new ClassIntraError(
  ERROR_CODES.VALIDATION_ERROR,    // code: 错误码
  '邮箱格式不正确',                  // message: 人类可读
  {
    details: { field: 'email' },  // 可选，附加信息
    recoverable: true,            // 可选，是否可恢复（默认 false）
    cause: originalError          // 可选，原始错误
  }
);

throw err;
```

### 实例属性

| 属性 | 类型 | 说明 |
|------|------|------|
| name | string | `'ClassIntraError'` |
| code | string | 错误码（如 `'CLASSINTRA_VALIDATION_ERROR'`） |
| message | string | 错误描述 |
| details | any | 附加信息 |
| recoverable | boolean | 是否可恢复 |
| cause | Error | 原始错误 |

### ClassIntraError.fromUnknown(error, fallbackCode)

把任意值转为 ClassIntraError。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| error | any | 是 | 任意值（Error / ClassIntraError / 字符串 / 其他） |
| fallbackCode | string | 否 | 兜底错误码（默认 `UNKNOWN`） |

**返回**：`ClassIntraError` 实例

**示例**：

```javascript
try {
  JSON.parse(invalidJson);
} catch (e) {
  var ciError = ClassIntraError.fromUnknown(e, ERROR_CODES.STORAGE_CORRUPTED);
  // ciError.code === 'CLASSINTRA_STORAGE_CORRUPTED'
  // ciError.cause === e
}
```

### 便捷工厂方法

```javascript
ClassIntraError.appNotFound(appName)              // 应用不存在
ClassIntraError.appDisabled(appName)              // 应用已禁用（recoverable: true）
ClassIntraError.themeNotFound(themeId)            // 主题不存在
ClassIntraError.storageUnavailable(reason)        // 存储不可用（recoverable: true）
ClassIntraError.serviceNotFound(name)             // 服务未注册
ClassIntraError.validationError(field, reason)    // 参数校验失败（recoverable: true）
ClassIntraError.networkError(message, cause)      // 网络错误（recoverable: true）
```

---

## 8. globalErrorHandler 全局错误处理器

**位置**：[shared/src/errors.js](../shared/src/errors.js#L88-L134)

### addHandler(handler)

注册错误处理订阅者。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| handler | function(ciError, originalError) | 是 | 错误处理回调 |

**返回**：取消订阅函数

**异常隔离**：单个 handler 失败不影响其他 handler。

**示例**：

```javascript
import { globalErrorHandler } from '@shared/errors';

var unsubscribe = globalErrorHandler.addHandler(function(ciError, originalError) {
  // 上报到监控平台
  monitor.report(ciError.code, ciError.message);
  // 显示 toast
  showToast(ciError.message);
});

// 取消订阅
unsubscribe();
```

### handle(error)

处理错误（自动转换为 ClassIntraError）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| error | any | 是 | 任意值 |

**防递归**：`_handling` 标志位防止 handler 内部 throw 导致递归。

### handlerCount()

获取当前注册的 handler 数量。

**返回**：`number`

### _reset()

清空所有 handler（仅供测试用）。

> **注意**：后端版本（`server/src/core/errors.js`）的 `globalErrorHandler` 默认订阅了 `crashLogger`，调用 `handle()` 时会自动写入 `crash.log`。

---

## 9. Manifest Schema 验证

**位置**：[shared/src/manifest-schema.js](../shared/src/manifest-schema.js)

### validateManifest(m)

验证 manifest 对象。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| m | object | 是 | manifest 对象 |

**返回**：`{ valid: boolean, errors: string[], warnings: string[], manifest: normalizedManifest }`

- `valid`：是否通过（errors 为空）
- `errors`：阻断性错误（如缺 `name` / `label`）
- `warnings`：非阻断警告（如 `icon` 缺失、`version` 不符合 semver）
- `manifest`：归一化后的 manifest（补充缺省值，不修改原对象）

**示例**：

```javascript
import { validateManifest } from '@shared/manifest-schema';

var result = validateManifest({
  name: 'countdown',
  label: '倒数日',
  version: '1.0.0'
});

if (!result.valid) {
  console.error('manifest 验证失败:', result.errors);
} else {
  console.log('manifest 有效:', result.manifest);
  // result.manifest = { name: 'countdown', label: '倒数日', version: '1.0.0',
  //                     type: 'app', category: 'desktop', order: 99,
  //                     defaultEnabled: true, canDisable: true }
}

if (result.warnings.length > 0) {
  console.warn('manifest 警告:', result.warnings);
}
```

### FIELD_DEFS

字段定义表（供 UI 动态生成表单用）。

### SEMVER_RE

semver 正则：`/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/`

---

## 10. 集成协议契约

**位置**：[shared/src/integration-contract.js](../shared/src/integration-contract.js)

### 常量

| 常量 | 值 | 说明 |
|------|----|------|
| `MSG_TYPE` | `'classintra-integration'` | envelope.type 的值 |
| `PROTOCOL_VERSION` | `'1.0'` | 协议版本 |
| `DEFAULT_TIMEOUT_MS` | `5000` | 默认请求超时 |
| `DEFAULT_TOKEN_TTL_DAYS` | `30` | 默认 token 有效期 |

### CHANNELS

预定义通道映射：

```javascript
{
  'handshake:request':     { direction: 'bidirectional', scope: null },
  'handshake:response':    { direction: 'bidirectional', scope: null },
  'ping':                  { direction: 'bidirectional', scope: null },
  'app:open':              { direction: 'inbound', scope: 'app:write' },
  'user:info':             { direction: 'inbound', scope: 'user:read' },
  'user:signed-out':       { direction: 'outbound', scope: 'user:read' },
  'notification:send':     { direction: 'inbound', scope: 'notification:write' },
  'data:query':            { direction: 'inbound', scope: 'data:read' },
  'data:update':           { direction: 'inbound', scope: 'data:write' },
  'event:subscribe':       { direction: 'inbound', scope: 'data:read' },
  'event:push':            { direction: 'outbound', scope: 'data:read' },
  'calendar:event_created':{ direction: 'outbound', scope: 'calendar:read' },
  'countdown:reached':     { direction: 'outbound', scope: 'countdown:read' }
}
```

- `direction`：`'inbound'`（外部→ClassIntra）/ `'outbound'`（ClassIntra→外部）/ `'bidirectional'`
- `scope`：所需权限范围（`null` 表示无 scope 要求，如握手和心跳）

### SCOPES

权限范围列表：`'app:read'` / `'app:write'` / `'user:read'` / `'user:write'` / `'notification:write'` / `'data:read'` / `'data:write'` / `'calendar:read'` / `'calendar:write'` / `'countdown:read'` / `'message:read'` / `'message:write'` / `'community:read'` / `'community:write'`

### createEnvelope(options)

创建 envelope 信封。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| options.channel | string | 是 | 通道名（必须存在于 CHANNELS） |
| options.kind | `'request'` \| `'response'` \| `'event'` \| `'error'` | 是 | 消息类型 |
| options.payload | any | 否 | 消息体 |
| options.id | string | 否 | 消息 id（缺省自动生成） |
| options.requestId | string | 否 | 关联的请求 id（response/error 必填） |
| options.source | string | 否 | 来源标识 |
| options.target | string | 否 | 目标标识 |
| options.error | { message: string } | 否 | 错误信息（kind=error 时） |

**返回**：envelope 对象

```javascript
{
  v: '1.0',
  type: 'classintra-integration',
  id: 'ci_xxx',
  kind: 'request',
  channel: 'user:info',
  source: null,
  target: null,
  payload: null,
  requestId: null,
  error: null,
  timestamp: 1234567890
}
```

### validateEnvelope(env, expectedOrigin)

验证 envelope 格式。

**返回**：`{ valid: boolean, errors: string[] }`

### WEBHOOK_HEADERS

webhook 请求头名：

```javascript
{
  SIGNATURE: 'x-classintra-signature',   // sha256=<hex>
  TOKEN: 'x-classintra-token',           // 集成 token
  TIMESTAMP: 'x-classintra-timestamp',   // unix ms
  EVENT: 'x-classintra-event'            // 事件类型
}
```

### WEBHOOK_EVENTS

webhook 事件类型：

```javascript
{
  USER_SIGNED_IN: 'user.signed_in',
  USER_SIGNED_OUT: 'user.signed_out',
  MESSAGE_RECEIVED: 'message.received',
  ANNOUNCEMENT_PUBLISHED: 'announcement.published',
  COUNTDOWN_REACHED: 'countdown.reached',
  CALENDAR_EVENT_CREATED: 'calendar.event_created',
  CUSTOM_EVENT: 'custom.event'
}
```

---

## 11. PostMessageBridge 消息桥接

**位置**：[client/src/integrations/postmessage-bridge.js](../client/src/integrations/postmessage-bridge.js)

**单例获取**：

```javascript
import { getPostMessageBridge } from '@/integrations/postmessage-bridge';
var bridge = getPostMessageBridge();
```

### start()

启动桥接（拉取 origin 白名单 + 添加 message 监听）。

**返回**：`Promise<void>`

### setTarget(targetWindow, targetOrigin)

设置目标 window（用于主动发消息）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| targetWindow | Window | 是 | iframe.contentWindow 或 window.parent |
| targetOrigin | string | 是 | 目标 origin（绝不 `'*'`） |

### on(channel, handler)

注册 channel 处理器。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| channel | string | 是 | 通道名（必须存在于 CHANNELS） |
| handler | function(envelope) => any \| Promise<any> | 是 | 处理函数，返回值作为 response payload |

### request(channel, payload, timeoutMs)

发送请求（等待响应）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| channel | string | 是 | 通道名 |
| payload | any | 否 | 请求体 |
| timeoutMs | number | 否 | 超时毫秒（默认 5000） |

**返回**：`Promise<payload>`（超时或错误时 reject ClassIntraError）

**示例**：

```javascript
bridge.setTarget(iframe.contentWindow, 'https://example.com');

bridge.request('user:info', { fields: ['name'] })
  .then(function(userInfo) {
    console.log('收到用户信息:', userInfo);
  })
  .catch(function(err) {
    // err 是 ClassIntraError，code 可能是 INTEGRATION_TIMEOUT / INTEGRATION_ERROR / INTEGRATION_NO_TARGET
    console.error('请求失败:', err.code, err.message);
  });
```

### send(channel, payload)

发送事件（单向，不等待响应）。

### broadcast(channel, payload)

广播事件到所有子 iframe（origin 在白名单中的）。

**返回**：`envelope[]`（实际发送的 envelope 列表）

### respond(requestId, channel, payload, targetWindow, targetOrigin)

发送响应（一般在 handler 内部不需要手动调用，bridge 会自动处理）。

### stop()

停止桥接（移除监听 + 取消所有 pending requests）。

---

## 12. OutboundLauncher 外部站点嵌入

**位置**：[client/src/integrations/outbound-launcher.js](../client/src/integrations/outbound-launcher.js)

**单例获取**：

```javascript
import { getOutboundLauncher } from '@/integrations/outbound-launcher';
var launcher = getOutboundLauncher();
```

### launch(options)

启动外部站点嵌入。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| options.url | string | 是 | 外部站点 URL |
| options.container | HTMLElement | 是 | 容器元素 |
| options.frameId | string | 否 | iframe id（缺省自动生成） |
| options.userInfo | object | 否 | 用户信息（通过 handshake 传递） |
| options.allowChannels | string[] | 否 | 允许的 channels（默认全部） |
| options.iframeAttrs | object | 否 | iframe 属性（如 style、class） |

**返回**：`{ frameId, iframe, readyPromise }`

- `readyPromise`：握手完成的 Promise（10 秒超时）

**示例**：

```javascript
launcher.launch({
  url: 'https://external-app.example.com',
  container: document.getElementById('iframe-container'),
  userInfo: { user_id: '123', real_name: '张三' },
  allowChannels: ['user:info', 'event:push']
}).readyPromise.then(function(result) {
  console.log('外部站点已就绪:', result.frameId);
}).catch(function(err) {
  console.error('嵌入失败:', err.message);
});
```

### close(frameId)

关闭指定嵌入。

### closeAll()

关闭所有嵌入。

---

## 13. IntegrationManager 集成管理器

**位置**：[client/src/integrations/index.js](../client/src/integrations/index.js)

**单例获取**：

```javascript
import { getIntegrationManager } from '@/integrations';
var manager = getIntegrationManager();
```

### start()

启动集成系统（启动 bridge + 注册默认 handlers + 订阅 EventBus）。

**默认 handlers**：
- `handshake:request` — 返回当前用户信息 + 允许的 channels + 协议版本
- `ping` — 返回 `{ pong: true, timestamp: Date.now() }`

**EventBus 订阅**：
- `user:signed-in` → 广播 `user:signed-in` 到所有 iframe
- `user:signed-out` → 广播 `user:signed-out` 到所有 iframe

**返回**：`Promise<void>`

### getBridge() / getLauncher()

获取内部 bridge 或 launcher 实例。

### stop()

停止集成系统（关闭所有 iframe + 停止 bridge）。

---

## 14. Token Store 集成令牌管理

**位置**：[server/src/integrations/token-store.js](../server/src/integrations/token-store.js)

**仅后端可用**：

```javascript
var tokenStore = require('../integrations/token-store');
```

### issueToken(name, options)

签发新集成 token。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 集成名称 |
| options.scopes | string[] | 否 | 权限范围（默认 `[]`） |
| options.webhookUrl | string | 否 | webhook 推送 URL |
| options.origins | string[] | 否 | 允许的 origin 白名单 |
| options.ttlDays | number | 否 | 有效期天数（默认 30） |

**返回**：

```javascript
{
  id: 1,
  name: '外部系统 A',
  token: '<32字节 hex>',         // 公开标识
  secret: '<64字节 hex>',         // 私钥（仅签发时返回一次！）
  scopes: ['user:read', 'data:read'],
  webhookUrl: 'https://a.example.com/webhook',
  origins: ['https://a.example.com'],
  expiresAt: '2026-08-04T00:00:00.000Z'
}
```

> **重要**：`secret` 仅在签发时返回一次，后续无法找回。如遗失，用 `regenerateSecret(id)` 重新生成。

### verifyToken(token)

验证 token（用于 webhook 接收）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| token | string | 是 | 待验证的 token |

**返回**：集成信息（不含 secret）或 `null`（无效/过期/已撤销）

```javascript
{
  id: 1,
  name: '外部系统 A',
  secret_hash: '<sha256 hex>',  // 用于验签
  scopes: ['user:read'],
  webhookUrl: 'https://a.example.com/webhook',
  origins: ['https://a.example.com'],
  expiresAt: '2026-08-04T00:00:00.000Z'
}
```

### revokeToken(id)

撤销 token。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | number | 是 | 集成 id |

**返回**：`boolean`（是否成功）

### listIntegrations()

列出所有集成（管理员用，不含 secret）。

**返回**：`Array<IntegrationInfo>`

### getIntegration(id)

获取单个集成（不含 secret）。

### updateIntegration(id, fields)

更新集成。

| fields 可选字段 | 类型 | 说明 |
|-----------------|------|------|
| name | string | 集成名称 |
| scopes | string[] | 权限范围 |
| webhookUrl | string | webhook URL |
| origins | string[] | origin 白名单 |
| active | boolean | 是否启用 |

### regenerateSecret(id)

重新生成 secret（忘记旧 secret 时用）。

**返回**：`string`（新 secret，仅返回一次）

### verifyWebhookSignature(secretHash, timestamp, rawBody, signature)

验证 webhook 签名。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| secretHash | string | 是 | 存储的 secret hash |
| timestamp | string | 是 | 请求时间戳 |
| rawBody | string | 是 | 原始请求体 |
| signature | string | 是 | 待验证的签名（格式 `sha256=<hex>`） |

**返回**：`boolean`

**签名计算**：`HMAC-SHA256(secretHash, timestamp + '.' + rawBody)`

---

## 15. Migration Runner DB 迁移执行器

**位置**：[server/src/utils/migration-runner.js](../server/src/utils/migration-runner.js)

**仅后端可用**：

```javascript
var migrationRunner = require('../utils/migration-runner');
```

### runAll()

执行所有待执行的迁移。

**返回**：

```javascript
{
  applied: 2,                    // 本次执行的迁移数
  currentVersion: 2,             // 当前 schema 版本
  migrations: ['v1 initial_schema_version', 'v2 add_integrations_tables']
}
```

**异常处理**：迁移失败会抛出异常并中止后续迁移（事务已回滚）。

### getCurrentVersion()

获取当前已执行的最大版本号。

**返回**：`number`（无记录时返回 `-1`）

### loadMigrations()

加载 `migrations/` 目录下所有迁移文件（按文件名排序）。

**返回**：`Array<{ version, name, up, file }>`

### getMigrationHistory()

查询迁移历史（管理员/调试用）。

**返回**：`Array<{ version, name, applied_at }>`

### ensureSchemaVersionTable()

确保 `schema_version` 表存在（bootstrap）。

### MIGRATIONS_DIR

迁移文件目录的绝对路径。

---

## 16. 聚合器 API

### 前端聚合器

#### manifest-loader

**位置**：[client/src/core/manifest-loader.js](../client/src/core/manifest-loader.js)

```javascript
import { loadManifests, getComponent } from '@/core/manifest-loader';

var manifests = loadManifests();  // 返回 manifest[]，已校验 + 排序
// [{ name, label, icon, frontend: { route, component, ... }, backend: { ... }, ... }]

var loader = getComponent('countdown', './frontend/Countdown.vue');
// 返回 Vue 异步组件加载函数，未找到时 null
```

#### router-aggregator

**位置**：[client/src/core/router-aggregator.js](../client/src/core/router-aggregator.js)

```javascript
import { appRoutes, ROUTE_APP_MAP } from '@/core/router-aggregator';

// appRoutes: Vue Router 路由表
// [{ path: '/countdown', name: 'Countdown', component: loader, meta: { requiresAuth: true, appName: 'countdown' } }, ...]

// ROUTE_APP_MAP: 路由 path → 应用名映射（用于应用管控）
// { '/countdown': 'countdown', '/notes': 'notes', ... }
```

#### store-aggregator

**位置**：[client/src/core/store-aggregator.js](../client/src/core/store-aggregator.js)

```javascript
import { APP_STORE_MODULES } from '@/core/store-aggregator';
// { countdown: vuexModule, notes: vuexModule, ... }
```

#### widget-aggregator

**位置**：[client/src/core/widget-aggregator.js](../client/src/core/widget-aggregator.js)

```javascript
import { WIDGET_REGISTRY, getWidget, listWidgets, registerWidget } from '@/core/widget-aggregator';

var widget = getWidget('countdown');
// { id, name, component, defaultSize, minSize, maxSize, description, configSchema, _app }

var all = listWidgets();
// [widget1, widget2, ...]

// 动态注册 widget（插件系统入口）
registerWidget({
  id: 'my-plugin-widget',
  name: '我的插件组件',
  component: MyComponent,
  defaultSize: { w: 2, h: 2 },
  configSchema: { fields: [...] }
});
```

#### app-registry

**位置**：[client/src/core/app-registry.js](../client/src/core/app-registry.js)

```javascript
import { APP_REGISTRY } from '@/core/app-registry';
// [{ name, label, icon, color, route }, ...]  仅 category === 'desktop' 的应用
```

### 后端聚合器

#### route-aggregator

**位置**：[server/src/core/route-aggregator.js](../server/src/core/route-aggregator.js)

```javascript
var routeAggregator = require('../core/route-aggregator');

// 挂载所有应用的后端路由到 express app
routeAggregator.mountAppRoutes(app);
// 输出日志：[route-aggregator] 挂载应用路由: countdown -> /api/countdown
//          [route-aggregator] 共挂载 11 个应用路由

// 获取所有已声明 backend 的应用列表（供管理后台展示）
var apps = routeAggregator.getBackendApps();
// [{ name, label, mountPath, hasRateLimit }, ...]
```

#### default-apps-loader

**位置**：[server/src/core/default-apps-loader.js](../server/src/core/default-apps-loader.js)

```javascript
var loader = require('../core/default-apps-loader');

var defaultApps = loader.getDefaultApps();   // ['countdown', 'notes', ...]（defaultEnabled !== false）
var allApps = loader.getAllApps();           // [{ name, label, icon, color, category, canDisable, defaultEnabled, order }, ...]
var desktopApps = loader.getDesktopApps();   // [{ name, label, icon, color, route }, ...]（category === 'desktop'）
```

---

## 附录：常用导入速查

```javascript
// 核心服务（前端）
import { getServiceRegistry } from '@/core/service-registry';
import { getEventBus } from '@/core/event-bus';
import { getThemeEngine } from '@/core/theme-engine';
import { getHotkeyManager } from '@/core/hotkey-manager';
import { getSearchRegistry } from '@/core/search-registry';
import { getDefaultStore } from '@/core/persistence-store';

// 集成系统（前端）
import { getIntegrationManager, getPostMessageBridge, getOutboundLauncher } from '@/integrations';

// 共享层
import { ClassIntraError, globalErrorHandler } from '@shared/errors';
import { ERROR_CODES, EVENT_NAMES, STORAGE_PREFIX } from '@shared/constants';
import { validateManifest } from '@shared/manifest-schema';
import { createEnvelope, validateEnvelope, CHANNELS, SCOPES, WEBHOOK_HEADERS, WEBHOOK_EVENTS } from '@shared/integration-contract';
import { LIGHT_TOKENS, DARK_TOKENS } from '@shared/theme-tokens';
import { flattenTokens, applyToElement, removeFromElement } from '@shared/theme-adapter';

// 聚合器（前端）
import { loadManifests, getComponent } from '@/core/manifest-loader';
import { appRoutes, ROUTE_APP_MAP } from '@/core/router-aggregator';
import { APP_STORE_MODULES } from '@/core/store-aggregator';
import { WIDGET_REGISTRY, getWidget, listWidgets, registerWidget } from '@/core/widget-aggregator';
import { APP_REGISTRY } from '@/core/app-registry';

// 后端
var serviceRegistry = require('../core/service-registry').getServiceRegistry();
var lifecycleOrchestrator = require('../core/lifecycle-orchestrator').getLifecycleOrchestrator();
var manifestLoader = require('../core/manifest-loader');
var routeAggregator = require('../core/route-aggregator');
var defaultAppsLoader = require('../core/default-apps-loader');
var tokenStore = require('../integrations/token-store');
var webhookReceiver = require('../integrations/webhook-receiver');
var outboundDispatcher = require('../integrations/outbound-dispatcher');
var originRegistry = require('../integrations/origin-registry');
var migrationRunner = require('../utils/migration-runner');
```
