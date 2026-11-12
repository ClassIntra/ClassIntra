# classintra-devkit

ClassIntra 第三方开发工具：**建 → 查 → 预览调试 → 测试安装 → 打包**，不需要克隆主仓库。需要 Node.js 18 或更高版本；devkit 没有运行时 npm 依赖。

```bash
classintra-devkit create app hello --label 示例应用 --dir ./work
classintra-devkit check ./work/hello --json
classintra-devkit preview ./work/hello --secret <JWT_SECRET> --user admin --watch
classintra-devkit pack ./work/hello --write ./market/index.json
classintra-devkit install hello --source local
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

### `preview`（真实宿主免安装预览）

```bash
classintra-devkit preview ./work/hello --host http://127.0.0.1:9001 --watch
# 凭据二选一：
#   --token <JWT>      从已登录班管的浏览器复制（localStorage.token）
#   --secret <KEY> --user <班管账号>   用本地 server/.env 的 JWT_SECRET 现场签发
# 也可用环境变量 CI_DEV_HOST / CI_DEV_TOKEN / CI_DEV_SECRET / CI_DEV_USER 免传参
```

把本地包**免安装**挂进真实宿主：宿主用与安装同一套校验器和热挂载管线加载这个目录，
预览与真实安装不会有两套行为。要点：

- **不下载、不落盘、不写数据库**——预览登记只在内存，服务重启即清空
- 静态资源走宿主 `/market-static-dev/` 前缀（同源），**改前端文件刷新页面即生效**；
  局域网平板直接打开同一地址即可预览
- `--watch`：`backend/` 与 `manifest.json` 变更后自动重挂（后端改码热重载）；Ctrl+C 自动注销
- 与安装同样的冲突检测：同名/同路由/同挂载路径都会被拒（预览已装应用的更新版，先卸载旧版）
- 前置条件：宿主开启 `CLASSINTRA_DEV_PREVIEW=1`（仅限开发实例，生产不要开）
- 进程型后端（`backend.process`）暂不支持预览，请走测试安装流程验证

### `install`（测试安装）

```bash
classintra-devkit pack ./work/hello --write ../market/index.json   # 先进本地市场源
classintra-devkit install hello --source local                     # 走完整安装链路
classintra-devkit install hello --source local --update            # 更新
classintra-devkit install hello --uninstall                        # 卸载（数据默认保留）
```

`preview` 调通后，用 `install` 走一遍真实安装链路（下载校验 → 原子落盘 → 热挂载 → 失败回滚），
验证的是预览覆盖不到的部分：包从市场源下载、哈希校验、磁盘替换与卸载。内置 `local` 源默认指向
`<项目根>/../market`（可用服务端 `MARKET_LOCAL_DIR` 调整）。

### `sdk types`

`classintra-devkit sdk types --write ./types/classintra-sdk.d.ts` 导出宿主 SDK v1 类型。默认保护已有文件，加 `--force` 才覆盖。安装 devkit 的项目也可直接使用 `import type { MarketContext } from 'classintra-devkit/sdk'`，JavaScript 使用同一路径的 JSDoc 注解。类型只供编辑器/编译器使用，浏览器运行时由宿主注入。

声明覆盖 UI fragment、宿主导航、HTTP/账号存储、实时房间、分享、媒体和生命周期。`context.ui.button()` 等返回 `{ root, update, destroy }`，须插入 `.root`。详细行为与错误约定见随包分发的 [SDK 指南](SDK.md)。

插件后端另有 `classintra-devkit/backend` 类型入口，描述宿主插件 SDK 的错误、短时票据、媒体中转与出站请求接口，以及宿主能力门面 `require('_sdk/backend/host')` 的形状（db/auth/appConfig/appData/ledger/errors/relay）。它仅提供开发期类型；运行时由宿主注入。后端引用宿主能力一律走 `_sdk/backend/host` 稳定门面——直连 `../../../server/src/...` 或 `process.cwd()` 解析会在宿主重构/部署变化时集体失效，`check` 会直接拦截。

### `sdk docs`

`classintra-devkit sdk docs --write ./author-guide.md` 导出随包分发的 SDK 指南；不带 `--write` 时直接阅读标准输出。默认不覆盖已有内容，误删后可以重新导出，明确覆盖时使用 `--force`。

新代码可用 `context.data.request<T>()` 获得解包数据和统一错误；请求随应用关闭取消，支持超时和调用方 AbortSignal。旧 `get/post` 的原始响应保持兼容。完整示例、错误码和旧宿主迁移步骤见 SDK 指南。

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
`pack --write ... --json` 只输出一个 JSON 对象（包含索引路径、条目和 replaced 状态），适合 CI。现有索引格式损坏时保留原文件并失败；写入先在同目录完成临时文件，再替换索引。
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
