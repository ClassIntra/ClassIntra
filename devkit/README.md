# classintra-devkit

ClassIntra 第三方开发工具：**建 → 查 → 打包**，一条命令搞定，不需要克隆主仓库。

```bash
npx classintra-devkit create app hello --label "你好"
cd hello
npx classintra-devkit check .
npx classintra-devkit pack . --write ../market/index.json
```

## 为什么有它

平台的工具过去都躺在主仓库 `scripts/` 里：想写一个市场应用，得先 clone 整个 ClassIntra（客户端 + 服务端 + 资源），
再跑 `node scripts/create.mjs`。对第三方来说这是不必要的门槛。

devkit 把这套能力抽成零依赖的独立包：装在本地、挂在 CI、或者直接 `npx` 都行。

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

### `check`

```bash
npx classintra-devkit check .          # 人类可读
npx classintra-devkit check . --json   # 机器可读（CI 用）
```

检查项：

- **manifest**：类型、名称、版本、路由前缀、`frontend.entry|static`、`backend.mountPath`
- **Chrome 80 语法红线**（会白屏）：模板字符串、`const`/`let`、箭头函数、`?.`、`??`、`class`、`async/await`、`replaceChildren`
- **危险 API**：`eval`、`new Function`、`document.write`
- **资源回收**：用了监听器/定时器/订阅却没有 `context.app.onDestroy`
- **CSS 软红线**（警告）：flex `gap`、`:is()`、`aspect-ratio`、`transition: all`
- **包体限制**：300 文件 / 单文件 60MB / 总量 80MB
- **能力披露**：未知能力名（拼写错误）会告警
- **定时任务**：`backend.jobs` 的名称/周期/handler 路径校验（与服务端安装校验一致）

退出码：0 通过，1 有错误。可直接当 CI 门禁。

### `pack`

```bash
npx classintra-devkit pack .                          # 输出条目 JSON 到 stdout
npx classintra-devkit pack . --write ../market/index.json   # 合并进市场目录
```

生成 `files`（仓库相对路径）+ `hashes`（包内相对路径的 sha256），与安装期校验完全一致。
`--write` 会保留原有的 `screenshots` / `changelog` / `tags`，重新打包不会把手写的运营字段抹掉。

## 与平台约定的对应关系

| 平台能力 | devkit 的处理 |
|---|---|
| Chrome 80 基线 | 生成 ES5；`check` 拦现代语法 |
| `--ci-*` 设计令牌 | 模板只用令牌，不写裸色值 |
| 卸载即无痕 | 带后端的模板自动生成 `backend/cleanup.js` |
| 能力披露 | 模板 `capabilities` 只列真实用到的项 |
| 定时任务 | 模板给出 `every: '5m'` 的 heartbeat 示例，宿主托管、重启不丢 |
| 逐文件 sha256 | `pack` 自动计算，键格式与 `_verifyFileHashes` 一致 |

## 兼容性

- Node.js >= 18
- 无运行时依赖
- 生成物面向 Chrome 80 / 腾讯 X5（Android 9 平板）

## License

MIT
