# ClassIntra Application Package Specification — v1.0

> **这是一份开放规范**：描述 ClassIntra 生态的应用/插件/主题包格式与运行时契约。
> 任何系统（其他班级/学校的自建 WebOS、教育平台）都可以按本规范实现宿主或产出包，
> 实现 ClassIntra 市场生态的互通。规范遵循语义化版本；宿主以 manifest 的 `sdk` 字段
> 协商主版本。实现参考：本仓库 `server/src/core/market-service.js`（服务端）与
> `client/src/core/market-registry.js` / `market-sdk.js`（客户端）。

## 1. 包类型与分发单元

| type | 形态 | 必需内容 | 运行方式 |
|---|---|---|---|
| `app` | 应用 | manifest + 前端（entry.js 微前端 / static 静态站）+ 可选后端 | 路由容器/iframe/进程托管 |
| `plugin` | 插件 | manifest + backend（express router） | 纯后端热挂载 |
| `theme` | 主题 | manifest + tokens.json（纯数据） | 令牌注入，零脚本执行 |

市场源 = Git 仓库，根目录 `index.json` 列出全部包（apps/plugins/themes 三段），
每段条目含 `name/label/version/files[]/hashes{}`（逐文件 sha256）。

## 2. manifest（app）

```json
{
  "name": "kebab-case", "type": "app", "version": "semver", "label": "显示名",
  "sdk": "1",
  "capabilities": ["data.storage", "data.http", "ui.overlay"],
  "category": "desktop | system | hidden",
  "visibleRoles": ["classAdmin", "admin", "officer", "student"],
  "frontend": {
    "route": "/app-route",
    "entry": "./frontend/entry.js",        // 微前端形态
    "static": "./frontend/index.html",     // 静态站形态（与 entry 二选一）
    "style": "./frontend/style.css",
    "overlay": "./frontend/overlay.js",    // 全局悬浮层
    "widgets": [ { "id": "kebab", "name": "名", "defaultSize": { "w": 2, "h": 2 } } ]
  },
  "backend": {
    "mountPath": "/api/app-name",
    "entry": "./backend/routes.js",
    "process": { "entry": "./backend/server.js", "port": 41234 },  // 独立端口形态
    "rateLimit": { "max": 120, "windowMs": 60000 }
  },
  "config": [ { "key": "API_KEY", "label": "密钥", "type": "secret", "required": true } ]
}
```

硬约束：`name` 与目录一致且 kebab-case；`route` 唯一且 `/` 开头；`mountPath` 唯一且 `/api/` 开头；
`sdk` 主版本 ≤ 宿主；`capabilities` 为披露式声明（宿主可配置受限清单拒装）。

## 3. 前端契约

### 3.1 微前端（entry.js）

IIFE + 全局注册，宿主在路由容器内加载：

```js
window.ClassIntraMarket.define({
  name: NAME,
  mount: function(container, context) {},   // 必需
  unmount: function(container) {},
  widgets: { id: { mount(el, config, ctx), unmount(el) } },  // 小组件渲染入口
  onBack: function() { return false; }      // 可选：拦截返回
});
```

`context` 五命名空间：`ui`（预制 DOM 片段）、`data`（api/realtime/storage——存储强制
`ci:app:<name>:` 前缀）、`system`（user/theme/router/toast/modal/eventBus）、`app`
（name/version/manifest/config/log/onDestroy）、`compat`（chromeVersion/isX5/has）。

### 3.2 悬浮层（overlay.js）

同 define 结构（`defineOverlay`），宿主挂载于全屏 `pointer-events:none` 容器（z-index 9400），
应用根元素需自带 `pointer-events:auto`。随安装/启停/更新自动挂摘。

### 3.3 静态站（frontend.static）

宿主以同源 iframe 加载 `/market-static/<name>/<static>`。无脚本契约。

## 4. 后端契约

- **express 形态**：导出 Router，挂载于 `mountPath`，请求期启停闸门即时生效。
- **进程形态**（`backend.process`）：宿主 spawn 子进程，注入 `PORT/CI_APP_NAME/CI_APP_DIR`；
  崩溃指数退避重启（≤5 次）；`mountPath` 反代到 `127.0.0.1:port`（仅 HTTP）；
  停用/卸载终止进程树；安装期端口冲突检测。
- **清理钩子**（`backend/cleanup.js`）：`module.exports = function(ctx){}`，卸载时先于删目录执行，
  失败中止卸载。应用应在此 DROP 自建表/清理数据。

## 5. 生命周期保证（宿主义务）

1. **卸载即无痕**：cleanup 钩子 → app_control/app_config 清除 → 目录删除 → 客户端
   `ci:app:<name>:` 存储/脚本/登记表清除。
2. **资源治理**：审计器记录应用创建的计时器/监听器；挂起/卸载自动回收；超阈（默认
   timers>120 / listeners>80）自动挂起。
3. **错误归因**：挂载异常隔离；运行期定时器/事件订阅错误按应用归因输出。
4. **订阅治理**：context.eventBus 订阅强制归属 `market:<name>`，context 销毁整批退订。

## 6. 完整性与信任

- **逐文件哈希**：index.json 条目 `hashes`（sha256），安装期逐文件比对，不匹配拒装。
- **目录签名**（可选启用）：ed25519 对 index.json 原始字节签名（index.json.sig），
  宿主配置公钥后 http 源验签失败拒绝拉取；本地源按文件系统信任。
- **能力拦截**（可选启用）：宿主配置受限能力清单，声明受限能力的包拒装。

## 7. 主题包（theme）

纯数据 JSON，零脚本：`{ id, name, type: "light"|"dark", tokens: "./tokens.json" }`；
`id` 不得为 light/dark；宿主合成 pack.json 一次取全注册进主题引擎，卸载时使用中用户回退默认。

---

**变更记录**：v1.0（2026-10）首次发布。包含：三形态应用、四类模块、生命周期保证四条、
完整性双层、进程托管契约。
