# apps/ — 内置应用

每个子目录是一个可独立启停的内置应用，由桌面启动台加载。应用 = `manifest.json`（声明）+ `frontend/`（Vue 2 页面）+ 可选 `backend/`（Express 子路由）+ 可选 `widgets/`（桌面小组件）。

## 目录

| 应用 | 说明 |
|------|------|
| `admin` | 管理后台（用户/广播/管控/日志） |
| `calculator` | 计算器（计算 / 绘图 / 换算 / 工具 四页签） |
| `calendar` | 日历（重复事件、提醒）+ 小组件 |
| `chat` | 即时通讯（公共/班级群/私聊） |
| `cluss` | Cluss 联邦应用（AI 额度代收代付，经 cluss-bridge 桥接） |
| `community` | 社区论坛（帖子/评论/点赞） |
| `countdown` | 倒数日 + 小组件 |
| `integration` | 第三方应用集成入口 |
| `market` | 应用市场（安装/更新/卸载） |
| `music` | 音乐播放（列表/LRC 歌词） |
| `profile` | 个人主页 |
| `resource` | 资源仓库 + 云盘（PDF 预览/视频流） |
| `settings` | 个人设置（关于系统/外观/安全） |
| `timetable` | 课程表 + 小组件 |
| `wallet` | 学元钱包（余额/转账/红包/证券/AA 收款） |
| `weather` | 天气系统（实况/预报/预警动画） |

## manifest.json 要点

- `name`：应用唯一标识（kebab-case，即目录名）
- `label` / `description` / `icon` / `color`：启动台展示信息
- `category` / `order`：启动台分组与排序；`defaultEnabled` / `canDisable`：管控默认态
- `frontend`：`route`（挂载路径）+ `component`（Vue 单文件组件路径）+ `meta`（如 `requiresAuth`）
- `backend`：可选后端声明 `{ mountPath, entry, rateLimit? }`，由宿主 `src/core/route-aggregator.js` 按 manifest 扫描挂载（支持热重载与自动限流）；访问宿主能力走 `src/ledger/app-api` 分层（第三方拿不到真金口径）

完整字段说明与开发教程见文档站：

- [应用 Manifest 规范](https://classintra.github.io/concepts/manifest)
- [开发第一个应用](https://classintra.github.io/development/first-app)
- [应用市场与生命周期](https://classintra.github.io/development/market-apps)

脚手架：`pnpm create:app`（交互式生成新应用骨架）；独立工具 `npx classintra-devkit`（create/check/pack）。
