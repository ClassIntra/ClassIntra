[center]
[size=24][b][color=#007AFF]ClassNet[/color][/b][/size]
[size=14]—— 一款班级局域网Web交互系统 ——[/size]
[/center]

[center][quote]一个班级里能用到的一切——聊天、AI 助手、社区论坛、云盘、笔记、天气、音乐——全在一个网页里。[/quote][/center]

[size=18][b]为什么做这个？[/b][/size]

学校给我们提供了学生平板。但说实话，这些设备除了看看课件、刷刷题，几乎没有 [b]"班级自己的东西"[/b]——聊天用 QQ、交作业用微信、文件传来传去靠 U 盘。功能割裂、数据散落、体验割裂。

我就想：能不能把这些平板真正利用起来？搭一个 [b][color=#007AFF]班级专属的一体化平台[/color][/b]，聊天、AI、论坛、云盘、笔记、天气、音乐全在同一个网页里，平板打开浏览器就能用。

于是从零开始写了 [b]ClassNet[/b]。前后两个多月，AI 辅助 coding，一个人全栈。

[size=18][b]能干什么？[/b][/size]

[BSUCCESS]以下所有功能均已在最新版本中可用，浏览器打开即用，无需安装任何 App。[/BSUCCESS]

[size=16][b]💬 即时通讯[/b][/size]

- WebSocket 实时聊天，支持私聊 + 群聊 + 广播
- @提及、消息引用回复、表情反应、转发消息
- 群聊成员管理（踢人 / 禁言 / 转让群主）

[size=16][b]🤖 AI 对话助手[/b][/size]

- 接入云端大模型，支持 Markdown 格式回复
- LaTeX 数学公式渲染（完整文档 + KaTeX 行内公式）
- Mermaid 流程图 / 时序图 / 甘特图
- 对话记录可一键转发到论坛或聊天

[size=16][b]📝 社区论坛[/b][/size]

- 发帖 / 评论 / 点赞 / 转发
- Markdown + LaTeX + Mermaid 编辑器
- 匿名发帖模式
- 等级系统（每日签到、经验值、连续签到奖励）

[size=16][b]☁️ 云盘[/b][/size]

- 文件上传 / 下载 / 预览（图片 / 视频 / 音频）
- 笔记编辑器（Markdown + LaTeX + Mermaid）
- 免登录上传码（访客通过上传码提交文件，防爆破保护）

[size=16][b]📋 笔记系统[/b][/size]

- 专业 Markdown 编辑器（粗体 / 斜体 / 删除线 / 代码 / 表格 / 任务列表）
- LaTeX 完整文档渲染 + KaTeX 数学公式
- Mermaid 图表（流程图 / 时序图 / 甘特图 / 类图 / ER 图 / 饼图……共 [b]20+[/b] 种）
- 文件附件管理、全屏专注模式、导入 / 导出 .md 文件
- 笔记可设为仅自己可见，云端实时保存

[size=16][b]🎵 音乐盒子[/b][/size]

- 内置播放器（播放 / 暂停 / 上一曲 / 下一曲）
- 歌单管理（创建 / 编辑 / 删除），支持本地音乐上传
- 歌单可转发到论坛

[size=16][b]🌤️ 天气[/b][/size]

- 实时天气卡片（温度 / 湿度 / 风力 / 能见度）
- 7 日天气预报 + 生活指数（紫外线 / 穿衣 / 运动等）

[size=16][b]⚙️ 系统功能[/b][/size]

- 深色 / 浅色主题 + [b]动态壁纸[/b]（内置渐变 + 自定义图片 / 视频）
- 等级系统（签到 / 发帖 / 评论 / 获赞均可获得经验）
- 管理面板（用户管理 / 广播通知 / 应用管控 / 资源管理）
- 版本号自动管理（SemVer，构建时 PATCH 自动 +1）
- 新版本桌面角标提示 + 更新介绍

[size=18][b]技术栈[/b][/size]

[b]前端[/b]  Vue 2.7 + Vue Router + Vuex
[b]构建[/b]  Vite 5
[b]样式[/b]  SCSS + CSS 变量 + iOS 风格设计系统
[b]后端[/b]  Node.js + Express
[b]数据库[/b]  SQLite（better-sqlite3，WAL 模式）
[b]实时通信[/b]  WebSocket（ws）
[b]图表[/b]  Mermaid 11
[b]数学[/b]  KaTeX 0.16
[b]Markdown[/b]  marked 4
[b]视频[/b]  Video.js 8 + HLS
[b]认证[/b]  bcryptjs + JWT（jose）

[size=18][b][color=#FF9500]征集 Logo！[/color][/b][/size]

[AINFO]项目到现在还没有正式 Logo，一直用默认图标凑合。特此向社区征集！[/AINFO]

[b]设计要求：[/b]

① 纯几何抽象，[b][color=#FF3B30]不要字母[/color][/b]（像 Apple 的苹果、Twitter 的鸟那样，符号本身就是品牌）
② 意象上能体现 [b]"教室 + 同学 + 网络连接"[/b]
③ 极简、标志性强，缩小到 [b]16px[/b] 也能清晰辨认

有想法的朋友可以直接在评论区发图，或者到 GitHub 提 Issue / PR。

[ASUCCESS]选中了署上你的名字，写在项目 About 里！[/ASUCCESS]

[size=18][b]开发心得[/b][/size]

[b]1. AI 写代码不等于不管代码[/b]

项目 80% 的代码是 Claude 写的。但 AI 写的代码需要你来——审查逻辑、统一风格、修边界 bug。AI 是"写得快"，你是"写得对"。

[b]2. 版本号省心方案[/b]

SemVer 的 PATCH 号构建时自动 +1，日常完全不碰版本号。新功能完成时手动改一下 MINOR。changelog 从 git log 自动生成。

[b]3. 单文件 SQLite 真香[/b]

班级场景 50 人以内，SQLite 完全够用。零配置，备份就是一个文件复制。

[size=18][b]仓库地址[/b][/size]

[cloud type=github title=ClassNet url=https://github.com/Nevino2333/ClassNet]GitHub 仓库[/cloud]

[size=18][b]后续计划[/b][/size]

- PWA 支持（离线可用）
- 移动端适配优化
- Docker 一键部署

[center]
[BSUCCESS][size=16]欢迎 Star / Fork / 提 Issue！[/size][/BSUCCESS]

[i]如果你们班也需要一个这样的平台，直接 clone 下来改改配置就能跑。[/i]
[/center]
