# Changelog

## [1.1.10] - 2026-07-05
版本更新

## [1.1.9] - 2026-07-05
版本更新

## [1.1.8] - 2026-07-05
【修复/优化】
修复 CI.bat 构建前端失败问题（清理全部构建警告）



## [1.1.7] - 2026-07-05
版本更新

## [1.1.6] - 2026-07-05
【新增】
阶段5 全局搜索 + DB migrations 拆分
阶段3 应用系统升级 - manifest schema + ServiceRegistry
阶段2 主题系统引擎化 - ThemeEngine + 单档动画开关
阶段1 基础设施层 - ClassIntraError/PersistenceStore/EventBus/HotkeyManager
完成阶段6 遗留问题处理（周视图调课 + widget配置弹窗完整化）
迁移 cloud 应用到 apps/ 模块化架构（category=utility，4 个前端页面）
迁移 settings 应用到 apps/ 模块化架构（无独立后端，复用 user/system 路由）
迁移 chat 应用到 apps/ 模块化架构（rateLimit 120/min，ws 保留原位）
迁移 timetable 应用到 apps/ 模块化架构（含 widget + helpers）
迁移 ai-chat 应用到 apps/ 模块化架构（rateLimit 30/min）
迁移 community 应用到 apps/ 模块化架构（rateLimit 120/min）
迁移 calendar 应用到 apps/ 模块化架构（含 for-countdown 联动路由）
迁移 music 应用到 apps/ 模块化架构
迁移 weather 应用到 apps/ 模块化架构（保留 checkWeatherAlert 导出）
迁移 resource 应用到 apps/ 模块化架构
迁移 notes 应用到 apps/ 模块化架构
试点迁移 countdown 应用到 apps/ 模块化架构
建立应用模块化架构骨架（apps/ + core/ + shared/）
小组件系统完善（持久化+resize+refresh+manifest 预留）
倒数日 ↔ 日历双向联动 + DB 迁移
倒数日应用 + 桌面倒数日小组件
跨班标识统一改为 CC
后端日历/倒数日路由 + 数据库表
主题架构收尾 - settings.setTheme action + AppIcon 接入 icon-resolver
新增课程表应用（基于 kb.yml 数据源）
云盘文件服务支持 Syncthing 跨班同步 — 磁盘扫描自动注册
浏览器支持设置首页 + 地址栏全屏按钮
重写浏览器页面
云盘分组可隐藏+文件选择器支持分组浏览
云盘上传页面支持选择文件分组
重写天气预警超能岛 — 单行滚动+匹配音乐岛样式
参考iPadOS完善桌面
生日每月限改一次 + 确认修改弹窗
生日庆祝系统 — 桌面全屏动画 + 首次检测
修复确认框取消bug/设置可拖动/Dock空时隐藏/跨页拖拽/设置页全屏
图标拖动让位动画+编辑态视觉增强+触觉反馈
编辑态点击空白区域退出编辑态
删除桌面设置里的壁纸设置
图标不可去除 - 移除编辑态×删除按钮
调大桌面图标尺寸 60px→72px，小屏52→60px
跨班云盘文件自动预取 + 图片实时缩放
图片实时缩放 — sharp 动态压缩，零额外磁盘文件
CloudDrive 重构 — 文件分组、多选批量、分享码导入
云盘手动迁移脚本 + 恢复自动迁移（已完成迁移则跳过）
云盘去重 — 前端适配（hash+mime_type+owner确认）
云盘去重 — 重写 cloud.js 核心路由（哈希去重+owner删除+占位图+旧URL兼容）
云盘去重 — 新增数据库表 + 自动迁移脚本

【修复/优化】
revokeToken 返回布尔值，修复验证脚本误报
云盘合并到资源仓库（apps/cloud/ → apps/resource/）
修复 Vite 构建错误 + 后端 require 路径 + shared/ 转换为 ES Module
核心层切换到聚合器 + 删除 30 个原应用文件（router/store/app.js/init-db.js 改用聚合器）
P5 系统检查修复 - CloudDrive 原生 prompt 替换 + 联动事件编辑保护
修复课程表换课索引错乱 + 小组件不显示调课 + 原生弹窗
修复倒数日置顶无法取消的 bug
Calendar.vue 代码诊断 - 用 \/toast 替换原生 alert/confirm
修复桌面小组件布局问题 + Countdown 代码诊断
修复私聊备注输入时因Vue重渲染导致丢字的问题
修复音乐超能岛胶囊态大小不一致 + 展开时点击外部空白区域可缩回
课程表深色模式修复 - CSS变量替换
修复桌面图标加载失败 — APP_REGISTRY 图标路径 .png → .svg
修复浏览器返回按钮问题 — 移除 location.replace 保护历史记录
适配 kb.yml 新位置 Resources/public/kb.yml
浏览器全屏改为CSS样式全屏 - 隐藏工具栏iframe撑满
修复文件夹拖入拖出bug+移除完成按钮+设置页优化
文件选择器切换到隐藏分组时加载对应文件
修复分组标签显示不全 + 已删除云盘图片缓存残留问题
彻底修复天气图标 — 后端 QWeather 字段映射 + 前端关键词扩展（强对流等）
天气图标切回 WeatherIcon SVG（与天气应用一致），无边框
恢复天气图标 — 下雨显示雨图标，预警显示感叹号
删除超能岛底部背景遮罩（island-backdrop）
通知可显示不打断天气预警 — 用 startTime 追踪剩余时长避免重置
天气预警三个修复 — 统一感叹号/去关闭按钮/通知不打断预警
统一广播/音乐/天气超能岛尺寸（border-radius:40px, height:40px），天气文字居中
天气预警传递真实 headline/description — 显示气象台完整预警内容
天气预警图标改用 WeatherIcon 组件（与天气应用一致，无边框）
天气预警颜色 — 蓝色/黄色/橙色/红色对应 minor/moderate/severe/extreme
圆框感叹号改用 FontAwesome fa-circle-exclamation 图标
天气预警岛增大宽度 + 关闭按钮更明显
移除生日限制底部警告文字
生日警告移到底部固定栏 + 保存后刷新限制状态
修复画板退出后内容丢失 + 增大画板默认尺寸
全屏选择文件返回后发帖弹窗消失
桌面系统深度完善（文件夹拖拽/应用管控/Dock重叠/小组件预留）
班管创建群聊后不可见
CloudImagePicker 类型筛选传入完整 file 对象
转存支持 hash.ext 格式 URL
云盘媒体标签式渲染 — 不再显示裸 URL
云盘文件 URL 附加扩展名，修复聊天/论坛图片不渲染
统一笔记存储到DB + 清理文件命名规范
统一重命名 ClassNet → ClassIntra

【其他】
perf: icon optimization - 3061KB to 94KB
perf: 图标加载优化 - 假SVG转真PNG（3.81MB→67.2KB，减小98.3%）
fix(desktop): Dock 自动扩展 + 仅 Dock 模式 + dockAppMeta 补全
fix(desktop): 修复拖入文件夹产生重复图标 — MOVE_APP 加 indexOf 去重
fix(desktop): 删除文件夹文字标签 — tile 名称与展开态图标文字
fix(desktop): 移除 AppIcon 彩色边框 — 去除 app.color 背景
fix(desktop): 修复拖拽图标放大 — ghost 样式迁移到 global.scss
fix(desktop): 修复桌面系统 7 项问题 + 项目改名 ClassIntra



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
修正 GitHub 仓库链接为 Nevino2333/ClassIntra




【新增】
完整的版本号管理制度（SemVer + 自动递增 + changelog）
设置页面更新介绍显示 + 新版本桌面角标 + 检查更新按钮
个性化隐私控制：在社区显示/隐藏真实姓名

【修复/优化】
头像支持 emoji / 数学粗体等特殊 Unicode 字符（不再显示 ?）
更新介绍自动过滤无意义提交（savepoint/chore）
开发者信息变更为 Nevino
