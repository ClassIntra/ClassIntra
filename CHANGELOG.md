# Changelog

## [1.1.5] - 2026-06-30
【新增】
修复视频播放/天气预警超能岛/iPad桌面图标模式
支持论坛/聊天 mov 视频播放 + 私聊/群聊消息撤回 UI 修复
云盘上传按钮跳转快捷上传页 + 优化录音录像质量

【修复/优化】
聊天 MP4 视频无法播放——cloud.js 添加 Range 请求支持 + 媒体 Cache-Control 头 + 流式传输
画板笔记上传云端后转载丢失数据——importCloudNote 保留 type/canvasData + 详情页显示画板标识
画板上传云端按钮从浮动层移入顶部工具栏——与其他操作按钮统一风格
formatPreviewContent 从 computed 移入 methods——computed 不支持带参数调用
修复聊天页 e.toLowerCase is not a function 错误——detectMediaType/getVideoMime 添加字符串类型校验
八项问题修复

【其他】
feat(desktop): Settings.vue 新增重置桌面布局入口（ 确认 + API 获取启用应用 + 降级 APP_REGISTRY）
feat(desktop): 文件夹组件 + 设置面板 + 分页指示器
feat(desktop): 拖拽引擎 + 手势 mixin（ghost/落点检测/FLIP/文件夹创建 + 长按/捏合/横滑）
feat(desktop): AppIcon 扩展（editing/pinned/showLabel props + wiggle 动画 + 删除按钮 + 锁图标）
feat(desktop): 前端 desktop store 模块（state/getters/mutations/actions + 默认布局 + 后端同步 + localStorage 缓存）
feat(desktop): 后端持久化基础设施（user_settings.desktop_layout_json 列 + GET/POST /settings 读写 + 校验）
perf: 修复聊天滑动时图片加载卡顿
perf: 提升视频帧率至60fps + 音频比特率256kbps
fix(security): 修复2个CRITICAL+2个HIGH安全漏洞
Revert "chore(deps): bump the npm_and_yarn group across 1 directory with 2 updates"
fix(security): pnpm.overrides 强制升级5个传递依赖到安全版本
chore(deps): bump the npm_and_yarn group across 1 directory with 2 updates



## [1.1.4] - 2026-06-27
【新增】
笔记图片从云盘调用——集成 CloudImagePicker 选择器
论坛长按菜单支持视频/音频转存——图片视频音频统一入口
聊天/论坛音视频完整支持 + 录制质量提升
画板模式+批注系统——DrawCanvas组件+第四模式+批注卡片+增强画板功能
聊天/论坛支持发送视频和音频——内联播放器+Video.js全屏预览+云盘选择器

【修复/优化】
修复云盘页面无法滑动——改用flex+overflow-y:auto布局
视频播放默认静音——ImagePreview+Resource双重静音设置
DOMPurify允许style属性——支持彩色HTML+LaTeX混合内容渲染
修复画板橡皮擦失效并删除图层功能简化为单图层
聊天视频点击全屏/不自动播放/长按转存——与论坛体验一致
论坛视频点击全屏/尺寸适配/图片平衡——960px平板优化
修复预览区滚动和批注涂鸦层随滚动
修复笔记创建按钮无反应（z-index 层级冲突）
移除论坛直接录音/录像入口，改为从云盘调用
修复聊天页视频/音频/语音条CSS——v-html元素缺少深度选择器导致样式不生效
删除旧版画板/去除原生prompt/修复批注穿透滚动/创建按钮+批注输入框
创建按钮/批注穿透/透明背景——三个核心可用性问题
修复画板+批注三大问题——架构重构/批注覆盖文字/画板竖排UI

【其他】
fix(security): 移除未使用的 xgplayer 依赖——消除35个传递依赖漏洞
fix(security): 修复4个安全漏洞——路径遍历/CORS/认证跳过/不安全随机数
Create jscrambler-code-integrity.yml
Add APIsec scan workflow for API security testing
Add Fortify AST Scan workflow
Create SECURITY.md for security policy
chore(deps): bump the npm_and_yarn group across 2 directories with 6 updates



## [1.1.3] - 2026-06-25
【修复/优化】
修复云盘音频识别/录像滚动/视频画质/图片长图放大



## [1.1.2] - 2026-06-25
【修复/优化】
修复图片转存失败——云盘文件查找从仅查当前用户改为遍历所有用户目录



## [1.1.1] - 2026-06-25
【修复/优化】
修复聊天页classList.contains对SVG元素报undefined——添加classList存在性检查



## [1.1.0] - 2026-06-25
【修复/优化】
修正 GitHub 仓库链接为 Nevino2333/ClassNet




【新增】
完整的版本号管理制度（SemVer + 自动递增 + changelog）
设置页面更新介绍显示 + 新版本桌面角标 + 检查更新按钮
个性化隐私控制：在社区显示/隐藏真实姓名

【修复/优化】
头像支持 emoji / 数学粗体等特殊 Unicode 字符（不再显示 ?）
更新介绍自动过滤无意义提交（savepoint/chore）
开发者信息变更为 Nevino
