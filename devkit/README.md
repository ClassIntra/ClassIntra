# classintra-devkit

ClassIntra 第三方开发工具：**建 → 查 → 打包**，一条命令搞定，不需要克隆主仓库。需要 Node.js 18 或更高版本；devkit 没有运行时 npm 依赖。

```bash
classintra-devkit create app hello --label 示例应用 --dir ./work
classintra-devkit check ./work/hello --json
classintra-devkit pack ./work/hello --write ./market/index.json
```

从团队认可的分发源获取 `classintra-devkit` 命令。离线或开发 devkit 本身时，可在本地源码目录将命令替换为 `node ./bin/cli.mjs`。用临时工作目录完成创建、检查和打包，再把包目录交由市场维护者审核；不需要把应用写入主仓库或已安装的市场目录。

## 为什么有它

平台的工具过去都躺在主仓库 `scripts/` 里：想写一个市场应用，得先 clone 整个 ClassIntra（客户端 + 服务端 + 资源），
再跑 `node scripts/create.mjs`。对第三方来说这是不必要的门槛。

devkit 把这套能力抽成零依赖的独立包：从团队认可的分发源安装后可本地使用，也可挂在 CI 中。

## 命令

### `create`

| 形态 | 命令 | 产物 |
|---|---|---|
| 微前端应用 | `create app <name> [--with-backend]` | `manifest.json` + `frontend/entry.js` + 可选后端 |
| 静态站 | `create site <name>` | 同源 iframe 壳，把 `dist/` 拷进 `frontend/` 即跑 |
| 独立端口服务 | `create service <name> [--port 41234]` | 自带进程（Node/Python/Go 均可） |
| 插件 | `create plugin <name>` | 只有后端路由，无页面 |
| 主题 | `create theme <id> [--type light\|dark]` | 纯数据 `tokens.json` |

生成物已经预置了令牌消费、`onDestroy` 回收、`cleanup.js` 清理钩子；带 `--with-backend` 时还会生成
一个**定时任务样例**（`backend/jobs/heartbeat.js` + `manifest.backend.jobs`），开箱即过 `check`。

### `sdk types`

`classintra-devkit sdk types --write ./types/classintra-sdk.d.ts` 导出宿主 SDK v1 类型。默认保护已有文件，加 `--force` 才覆盖。安装 devkit 的项目也可直接使用 `import type { MarketContext } from 'classintra-devkit/sdk'`，JavaScript 使用同一路径的 JSDoc 注解。类型只供编辑器/编译器使用，浏览器运行时由宿主注入。

声明覆盖 UI fragment、宿主导航、HTTP/账号存储、实时房间、分享、媒体和生命周期。`context.ui.button()` 等返回 `{ root, update, destroy }`，须插入 `.root`。详细行为与错误约定见随包分发的 [SDK 指南](SDK.md)。

### `check`

```bash
npx classintra-devkit check .          # 人类可读
npx classintra-devkit check . --json   # 机器可读（CI 用）
```

检查项：

- **manifest**：类型、名称、版本、路由前缀、`frontend.entry|static`、`backend.mountPath`
- **入口文件**：声明的脚本、样式、静态页、任务 handler 必须存在，不能越出包目录
- **直出脚本约定**：使用保守 ES5 风格，检查模板字符串、`const`/`let`、箭头函数、`?.`、`??`、`class`、`async/await`；这是项目规则，不表示这些语法在 Chrome 80 中均不受支持
- **运行时兼容性**：检查 Chrome 80 不支持的 `replaceChildren`
- **危险 API**：`eval`、`new Function`、`document.write`
- **资源回收**：用了监听器/定时器/订阅却没有 `context.app.onDestroy`
- **CSS 软红线**（警告）：flex `gap`、`:is()`、`aspect-ratio`、`transition: all`
- **包体限制**：300 文件 / 单文件 60MB / 总量 80MB
- **能力披露**：未知能力名（拼写错误）会告警
- **定时任务**：`backend.jobs` 的名称/周期/handler 路径校验（与服务端安装校验一致）

退出码：`0` 通过，`1` 有错误。`--json` 输出诊断详情，可直接当 CI 门禁。

微前端包的浏览器基线是 Chrome 80，继续兼容腾讯 X5 / Android 9。静态站由开发者自行构建，需按自己的浏览器目标验证。

### `pack`

```bash
npx classintra-devkit pack .                          # 输出条目 JSON 到 stdout
npx classintra-devkit pack . --write ../market/index.json   # 合并进市场目录
```

生成 `files`（仓库相对路径）+ `hashes`（包内相对路径的 sha256），与安装期校验完全一致。
打包前自动检查，无效包不会写入目标索引。编辑器 `.d.ts` 不进入市场载荷，符号链接被拒绝。
`--write` 会在指定位置创建缺失的父目录，并保留原有的 `screenshots` / `changelog` / `tags` / `featured` / `homepage`；重新打包不会把手写的运营字段抹掉。输出是现有目录式市场索引，不会生成单文件归档。

## 与平台约定的对应关系

| 平台能力 | devkit 的处理 |
|---|---|
| Chrome 80 基线 | 生成 ES5；`check` 拦现代语法 |
| `--ci-*` 设计令牌 | 模板只用令牌，不写裸色值 |
| 卸载即无痕 | 带后端的模板自动生成 `backend/cleanup.js` |
| 能力披露 | 模板 `capabilities` 只列真实用到的项；披露是说明，不是沙箱或权限拦截 |
| 定时任务 | 模板给出 `every: '5m'` 的 heartbeat 示例，宿主托管、重启不丢 |
| 逐文件 sha256 | `pack` 自动计算，键格式与 `_verifyFileHashes` 一致 |

## 兼容性

- Node.js >= 18
- 无运行时依赖
- 生成物面向 Chrome 80 / 腾讯 X5（Android 9 平板）

## License

MIT
