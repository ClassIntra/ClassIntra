# Changelog

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
