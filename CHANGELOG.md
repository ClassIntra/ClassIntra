# Changelog

## [0.51.0] - 2026-11-01

桌宠 · 菜单细节收口

- **分组**：「陪玩」（魔方/拍球/吃豆子/看书）与「陪伴」（抱一抱/说晚安/小憩/散步）之间加分隔线
- **尺寸实测**：菜单宽高改为 `offsetWidth/offsetHeight`，不再按项数估算（带分隔线时估算会偏，可能压出屏幕）
- **气泡收起**：开菜单时把对话气泡隐掉，避免两块浮层叠加
- **双入口验证**：真实触摸长按（CDP touch）与鼠标右键（CDP mouse right）都能开菜单
- **验证**：`scripts/_overlay-gate-probe.mjs` **23 项**全绿，含截图证据 `logs/pet-ui/pet-menu.png`

## [0.50.0] - 2026-11-01

桌宠 · 长按/右键菜单补全（触屏可用）

- **菜单此前完全没样式**：`.ci-pet-menu` 没有任何 CSS（无 `position` → `left/top` 失效；又继承宿主容器的 `pointer-events:none` → 按钮点不动）。现补：暖纸底 + 墨线 + 12px 圆角 + 40px 触摸行高 + 入场动画
- **修长按幽灵点击**：触摸长按抬手时浏览器会合成 click，正好命中刚弹出的第一项 → 菜单一闪即逝还执行动作。现在菜单弹在**手指上方**，并带 `400ms` 点击守卫
- **长按不再摸摸**：长按开菜单后抬手不再触发 poke
- **首次提示**：第一次进桌面会提示「长按我可以打开菜单」（只一次，存本地）
- **验证**：`scripts/_overlay-gate-probe.mjs` 扩到 **20 项** —— 触摸长按出菜单 / 7 项齐全 / 150×292 / 弹在手指上方 / `pointer-events:auto` / 点击可关闭 / 门禁与拖拽回归

## [0.48.0] - 2026-11-01

桌宠 · 悬浮层门禁（登录页 / 封禁页不再出现桌宠）

- **宿主层门禁**：`market-overlay-host` 新增 `setOverlaysVisible()`；App.vue 监听路由与登录态（token / user.status），在 登录 / 注册 / 封禁 页、未登录、账号被封时隐藏全部悬浮层（所有悬浮层应用同享）
- **桌宠挂载修正**：桌宠（含分身、右键菜单）改为挂进宿主容器 —— 原先直接 `document.body`，完全绕过宿主的显隐；容器 `pointer-events:none`，桌宠自身 `auto`，点击与拖拽不受影响
- **层级**：回到契约（容器 9400 < Modal 10001 / Toast / 大字 / 锁屏）
- **验证**：新增 `scripts/_overlay-gate-probe.mjs`（CDP 真浏览器）10 项全绿：未登录 /login 无桌宠、登录后恢复、封禁态隐藏、恢复后再现、点击命中桌宠

## [Unreleased] · 学元账本 v2 加固（2026-11-11 实装，11-12 已上线）

只加工程保证，不改任何资金制度口径。详见 `docs/ledger-hardening-v2.md` 与 `economy-design.md` §V.25。

- **幂等不可击穿**：请求指纹落 `transactions.request_hash`；同 `ref` 异载荷抛 `IDEMPOTENCY_CONFLICT` 并留凭证，不再静默返回 duplicate；迁移前历史交易走 legacy 兼容
- **账本可证明**：分录哈希链 + genesis 历史 digest，改任意历史分录 / 余额都能被独立校验器检出；新增 `/api/xy/admin/proof`
- **日终可自证**：三方对平（分录 / 余额 / 真金台账）+ 托管三数 + 供给 + 链 + 版本断层，差异按行落库、按天去重；新增 CLI 与 5 个班管只读端点
- **失败可追**：`LedgerError.error_code` 取代中文正则猜状态码，被拒写入落 `xy_ledger_post_attempts`
- **并发不可击穿**：事务内二次守恒 + 余额 `version` 乐观锁 + `BEGIN IMMEDIATE`；8 进程真并发验证无超卖、无 `SQLITE_BUSY`
- **供给硬闸**：O(1) 累计发行计数器 + `assets.supply_cap_cent`（默认 0 不限，线上行为不变）
- **外部成本门禁数据驱动**：订单层强制 `external_cost=1`，有真实成本 / 实物商品自动打 `requires_external=1`
- **投资套取可观测**：`invest.metrics()` 给出累计转入 / 撤出 / 平台补发 / 提取比 / 风险等级；撤出信用上限做成默认关闭的可配置开关，不误挡成就奖励
- **Cluss 桥回执**：`/app-credit` 成功后留可查凭证，新增只读 `/app-credit/receipts` 供对端对账
- **迁移 046**：4 列 / 7 表全为无破坏性 DDL；`scripts/ledger-verify-migration-046.cjs` 可在副本上完整预演
- **门禁补齐**：`test:ledger` 从 15 个脚本补到 21 个（纳入 5 个漏网的贷款 / 巡检脚本 + 新增加固验收）
- **验证**：21 脚本 **1448 项断言 / 0 失败**；生产快照副本迁移验证 **29/29**，2046 条分录与 135 行余额逐字段等价、账面现金与真金负债一分未动；日终对账 CLI 退出码 0
- **口径修正**：`scripts-test-ledger-appapi.cjs` 的「成本口径恒为练习金」旧断言 29000 与 `app-api.js`「总成本 = 成交额 + 手续费」矛盾，校准为 30000

### 聊天体验专项（2026-11-12 下午，已 build 到 18i / 8i）

只改前端，零后端改动、零重启、零写库。详见 `docs/system-excellence.md §9`。

- **实测纠正**：聊天真实主场是 `private_messages` **99,911 条**（公共 47 / 群 70）；未读 **61,154（61.2%）**；最热 8 个会话里 6 个是 `linxi_ai`；`message_reactions` **0 条**
- **独立内核** `apps/chat/frontend/chat-experience.js` + `server/scripts-test-chat-experience.mjs`（**117 项**，纳入 `test:chat`）；6386 行的 `Chat.vue` 只加调用点
- **私聊历史分页**：补齐缺失分支（后端 `before_id` 早已支持），4,965 条会话不再只能看最近 50 条；顶部插入保持视口
- **发送不吞消息**：`sending` 时入 FIFO 队列、立刻上屏「排队中」、自动派发；发送按钮不再禁用
- **AI 会话**：本地等待气泡（收到回复即熄、20s 超时自灭）；带 Markdown 的回复安全渲染（先转义后插标签）
- **已读补报**：拉取失败 / 重连 / 回前台强制补报，`queued` / `dropped` 标待补报
- **可见错误态**：整屏错误 + 重新加载、联系人重试、断线降级常驻条（不再只有一次性 toast）
- **周边**：平板显式换行、全屏图片失败不白屏、置顶真正参与私聊排序、回到上次会话、长按菜单加 6 个表情回应入口（此前无法加第一个）
- **验证**：Vue 编译 3/3 · 22 脚本 **1472 项 / 0 失败** · `system-audit` **97/100 · PASS 41 · 0 FAIL**（新增「聊天体验」12 项）· `ci-check` 6 项全绿 · 预检 GO · dist 引用 8 + manifest 184 项 0 缺失 · 两端首页 200、8i 主 JS 与本地 md5 一致

### 易用性收口（2026-11-12，已上线）

- **一屏总览**：新增 `GET /api/xy/admin/overview`，把账本不变量 / 哈希链 / 日终对账 / 发行计数 / 被拒写入五套自检收成**一个状态 + 一句人话 + 一组统一单位数字**；管理端新建 `XueyuanOverview.vue`（独立文件，不撑大 4600 行的 Admin.vue），带 404 优雅降级与「重新对账」。此前 v2 的 5 个端点前端零消费
- **修真 bug（第四次单位口径事故）**：`Admin.vue` 把「1 元 = 1000」当成单位换算，`ledgerYuan` 用 /1000（金额显示放大 100 倍）、`yuanToLedger` 用 ×1000（上架标价缩小 100 倍）。两者现由 `unitsPerYuan()` 统一推导且互逆；CLI 同时给出元 / 学元 / 账本单位三档
- **文案统一**：管理端三处自相矛盾的赠金说明（「仅投资」「一分都抵不了」「也可支付」）对齐 `/xueyuan/config` 的 `pools` 唯一文案源
- **一页速查**：新增 `docs/economy-current.md`（单位链、三种资产、学生 / 班管入口、改钱规矩、发版门禁、常见错误码、已撤销清单与术语对照）；2000+ 行总纲头部加导航，明确「日常别在史料里搜口径」
- **单一真相**：钱包与管理端不再硬编码 12 个限额，未加载时显示「—」而非假数字；管理端市集列表失败保留上次结果并报错（红线「拉不到 ≠ 没有」）
- **验证**：21 脚本 **1448 项 / 0 失败**；vite 全量构建到临时目录 **退出码 0**（三个 Vue 组件真实编译通过，`client/dist` 未被写入）；生产 dist 引用完整性 248 项 0 缺失
- ⚠️ 教训：`prune-dist.js` 硬编码扫 `client/dist`，**不跟随 `--outDir`**；用临时目录做验证构建时它仍会回收生产 dist 的旧 chunk（本次 188 个 24h 以上残留，经四道保护验证无活跃引用缺失）

### 全维度卓越门禁（2026-11-12，未发版）

- **新增 `scripts/system-audit.mjs`**：纯 Node 内置模块、不装依赖/不连库/<10s，六维度静态体检（资金完整性 / 凭据与日志 / 事件可靠性 / Chrome80 与主题 / 工程质量 / 错误态），输出健康分与逐条明细，`--strict` / `--json`；**已接入 `kernel-ci.yml`**
- **标准文档** `docs/system-excellence.md`：定义各维度验收口径、体检结果、实修清单、未决技术债与上线就绪清单
- **修两起事故级缺陷**：`init-db.js` 把 `DELETE FROM pre_records` 移入「名单文件读取成功」分支（旧实现 JSON 一损坏就清空全表再导入空数组）；`relay-bus.js` 把去重标记从 handler **之前**移到**成功之后**（旧实现让失败消息的重传被永久吞掉）
- **安全**：morgan 新增 `safe-url` 脱敏 `?token=` 等 query（JWT 不再明文落日志）；`emit.js` / `outbound-dispatcher.js` 拒绝未登记事件越权外发、补 `allSettled` 结果链与 5s fetch 超时；dotenv 显式钉 `server/.env`
- **性能**：`utils/db.js` 加可关闭的 Statement 缓存（`CI_SQL_CACHE=0` 回退），全仓 1169 处 `db.prepare()` 零改动受益（前置核实 0 处 `.pluck/.raw/.expand`）；`crash-logger` / `rate-limit` 防重复挂载 + `unref()`；`relay-sync` 12 处空 catch 补日志
- **Chrome 80**：flex gap 兜底改真实布局测量（`@supports not (gap:1px)` 在 80 恒不命中，~90 文件间距一直静默失效）；9 处 `inset` 展开四属性；7 处纯白背景换主题变量
- **验证**：21 脚本 **1448 项 / 0 失败**；`ci-check.mjs` 6 项全绿；`system-audit.mjs` **93/100、0 FAIL**（3 项 WARN 为已登记技术债：空 catch 977 处、日志 476 MB、Community chunk 1085 KB）；关键文件语法全过
- **体检复核纠正三条误报**：`pre-records.json` 实际存在、`dotenv` 因 PM2 `cwd=server/` 并未失效、Chrome 80 已支持 `min()/?.`；详见 `system-excellence.md §1`

### 学元财政权收口（2026-11-12 第三轮，最高危）

- **修确凿的越权发行旁路**：组网 `member` 角色下，`/api/xueyuan/admin/*` 全挂 `requireTreasury` 封锁，但 `POST /api/xy/issue` 只挂 `auth.requireAdmin` —— 从班班管可直接印 GRANT。前端零调用该端点，修复零风险
- **单一真相源**：新建 `server/src/middleware/treasury.js`；`routes/xueyuan.js` 改为引用共享中间件（删本地重复定义）；`routes/ledger.js` 的 20 处 `auth.requireAdmin` 全换 `treasury.requireTreasury`
- **混合端点**：新增 `treasuryForAdmins`，用路径模式 `router.use` 覆盖订单动作与商品上下架——只拦管理员越权，学生/卖家本人直接放行；后续新增动作自动受保护
- **Cluss 桥 TOCTOU**：`/app-credit` 的日流出额度检查与 `ledger.post` 合进同一 `BEGIN IMMEDIATE` 事务（旧实现并发下两个不同 ref 可同时过检）；`pay-guard.dailyOutCent` 加 `{strict:true}` fail-closed 模式，默认仍 fail-open 不影响学生转账
- **门禁**：`system-audit.mjs` 新增「财政权限」维度 6 项；新增 `scripts-test-treasury-guard.cjs`（24 项判定矩阵 + 静态断言）并纳入 `test:ledger`
- **上线预检**：新增 `scripts/preflight-go-live.mjs`（只读，用 `VACUUM INTO` 取最新生产一致快照后跑迁移 046），一次输出 GO / NO-GO 与正确上线顺序
- **验证**：22 脚本 **1472 项 / 0 失败**；`system-audit` **95/100、PASS 25 / FAIL 0**；`ci-check` 6 项全绿；预检 **GO**（迁移在最新生产快照上 29/29、首页 200）
- ⚠️ 收紧说明：`requireTreasury` 只认班管/系统管理员，普通班干不再能访问 `/api/xy` 管理端点（与 `/api/xueyuan/admin/*` 对齐；管控中心本就只对班管开放）

### 用户触达（2026-11-12 上午，已 build 到双端）

起因：用户反馈「还是不好用，用户不爱用」。这一轮不修引擎，改为**读真实行为数据**（生产库只读）。

- **实测**：104 账号里 **50 从未登录**；聊天 **26,418** 条 / 社区 290 帖是绝对主场；学元侧每日津贴累计仅 **68 笔 / 25 人领过**、真实充值 2 笔、商品 2 件、订单 0 笔、AA 0 个；CASH 仅 1 人持有，GRANT **49 人**有余额、人均 **9,823 学元**却无处可花。结论：不是 UI 问题，是**价值闭环断了**——赠金按制度只能「送人」，而系统没把「送人」接进聊天/社区动线；桌面首屏零钩子、钱包默认落在空「明细」、7 个 tab 里 5 个打开是空的
- **新增 `client/src/components/TodayXueyuanBar.vue`**：桌面首屏「今天有 +X 学元可以领 · 点一下领」，领完引导去聊天发红包；拉不到显示错误态 + 重试，未领时不可收起。Desktop.vue 只加 3 行（import / 注册 / 挂载）
- **聊天「+」加「领津贴」**（`Chat.vue`）：贴住 2.6 万条主动线，复用 `PayPage` 结果页反馈，后端 daily 按天幂等
- **钱包空态行动化**（`Wallet.vue`）：空流水改为三个可点动作（领津贴 / 发红包 / 看学元榜），不再只是「还没有流水」
- 三处**只调现有** `/api/wallet`、`/wallet/daily`，无需重启后端
- **已真正落地**：Vue 语法 5/5、`build-app.js wallet` 退出 0、dist 引用 8 项 + manifest 183 项 **0 缺失**、18i 与 8i 首页均 200 且入口同为 `index-C8l_Nz_W.js`
- `system-audit.mjs` 新增**「用户触达」维度 4 项**（含「构建产物包含首屏钩子」，防「改源码不 build」回潮），健康分 95/100、PASS 29 / FAIL 0
- **状态更正**：实测 `schema_version=46`（迁移 046 于 11-12 02:14 随服务重启执行）、v2 七表齐全、genesis #1023、新端点 401 而非 404 —— 前几轮「服务未重启、线上仍是旧代码」的结论**已过时**，后端加固与财政权修复均在线上
- **未做（需产品拍板）**：帖子打赏需新的可见性存储；装扮兑换撞 V.21「赠金不能买东西」红线，`profile-skin.js` 5 套预设至今零入口。下一轮只回看四个数：津贴领取人数 / 每日领取笔数 / 聊天红包笔数 / 次日回访

## [0.47.0] - 2026-11-01

桌宠 · 像素渲染与动画细节

- **渲染清晰度**：像素形象改为按显示尺寸 1:1 绘制，并且每格边界取整 —— 修掉「64×64 作品先画到 576px 再压到 176px、每 4 像素丢 3 个」的毛刺；桌面悬浮层 48/64 格在 64/80px 尺寸下同理
- **修朝向**：走路/跳跃的 CSS 动画会覆盖 `scaleX(-1)`，导致「向左走却朝右」；补齐翻转态的成套关键帧
- **待机呼吸**：2px 整像素位移（不做缩放，避免像素边缘抖动）
- **影子**：随呼吸微缩、起跳时收放
- **走路扬尘**：三粒像素尘，停下即清（无常驻定时器）
- **验证**：真机账号实测画布 352/2 = 176 CSS（1:1）、朝向动画名正确、待机动画名正确；工作台 66 项 + 会话恢复 5 项 + 后端 114/39 全绿

## [0.46.0] - 2026-11-01

桌宠 · 拼豆完整形态：会话恢复 + 笔尖粗细 + 网格开关

- **编辑会话可恢复**：进入编辑器落会话标记，只有「先不换了 / 就它了」清除；宿主重挂 / 刷新 / 切后台被回收后，回来直接续上草稿并提示「已回到上次没拼完的草稿」
- **笔尖 1×1 / 2×2 / 3×3**：64 格单格仅 9px，粗笔尖是刚需；与「画笔工具」同排，不再挤掉撤销行
- **网格开关**：随时隐藏底板网格，导出图纸不受影响
- **修复**：工具列重排后撤销/重做始终在首屏内；导入跨尺寸时头部档位高亮同步
- **验证**：工作台 66 项、会话恢复 5 项（卸载→重挂后草稿原样回来 / 明确离开后回宠物屋）、真机触摸横竖各 8~9 项、后端 114/39 全绿

## [0.45.0] - 2026-11-01

桌宠 · 拼豆：修「拼一半自动跳出去」+ 显示优化

- **修复（严重）**：编辑器打开期间，任何后台重绘首页都被拦截（许愿气泡 15s 轮询、剧情/战斗回包、昼夜换景都调 `renderHome()`，而编辑器挂在 home tab 上 → 被弹回宠物屋）。要回家统一走 `exitEditorToHome()`
- **显示**：48/64 档或 100% 缩放下改用扁平豆精灵（无中心孔/压暗），隐藏插钉与中线、网格减淡 —— 之前每颗豆的中心孔只有 1~2px，整块板像蒙了噪点
- **画板**：加 1px 内描边
- **修复**：导入到不同尺寸后，头部档位高亮不同步（板 64、高亮 16）
- **验证**：工作台 62 项（新增「后台切页不踢出编辑器」「先不换了正常回宠物屋」）、真机触摸横竖各 8~9 项、后端 114/39 全绿

## [0.44.0] - 2026-11-01

桌宠 · 拼豆手感与视觉收尾

- **双指手势**：捏合缩放（与按钮联动）+ 双指平移；单指仍绘制。双指第一根手指的误落豆会在起笔 500ms 内自动撤销
- **空板引导**：`点一下开始拼 · 也可以从云盘导入图片`，落第一颗豆即消失
- **预览放大**：点预览图放大到 360px，看清豆子排布
- **当前色块**：调色盘标签前加真实色块
- **修**：夜间主题下导入弹窗白字压米色纸（对比度≈0）；昼夜自动切换（6:30/18:30）把正在拼豆的人弹回宠物屋；`updateEditorStats` 覆盖色块节点
- **性能口径**：只统计落豆级增量重绘，实测 **0.07~0.09ms/次**、输入到可见 ~16ms（一帧）；整板重绘（首绘/撤销/切尺寸）单独排除
- **测试基建**：工作台与真机探针禁用 HTTP 缓存（此前会测到旧版资源）；真机探针按画板真实格数换算（用户已存 64×64）

## [0.43.0] - 2026-11-01

桌宠 · 拼豆导入：预览调参 + 云盘全量 + 还原度

- **云盘列表**：去掉 30 张截断，全量加载；缩略图 IntersectionObserver 懒加载 + 并发 4（首屏之后才请求）
- **预览调参**：选中图片 → 左原图 / 右拼豆效果对比，可直接调 尺寸(16/24/32/48/64)、色号上限、增强、抖动(关/轻/强)、背景留空；每项改动 120ms 防抖重算，满意再应用
- **抖动**：4×4 有序抖动 → Floyd–Steinberg 误差扩散（默认关：拼豆逐颗摆放，噪点反而失真）
- **增强**：补 3×3 USM 锐化（35%），48~64 格下五官更清楚
- **切档**：换画板尺寸自动回到适配大小，不再继承放大倍数
- **修复**：转换完成前「用它」禁用；应用后按所选尺寸落图并可整体撤销
- **验证**：工作台探针 58 项、真机触摸 6 项（64×64 画板实测：单击/拖拽/滚动落点全过）、后端 114/39 全绿

## [0.42.0] - 2026-11-01

桌宠 · 图片转拼豆算法重做（用户反馈「算法不行」）

- **采样**：线性光盒式平均（先缩到 ≤768 中间图，再按格在**线性 RGB** 里求均值），修掉 `drawImage` 在 sRGB 空间取平均导致的发灰、偏暗
- **对比**：自动对比从「2% 分位裁剪」改为「均值 + 受限增益（≤1.22×）」—— 暗部只占 2% 的图（头发/深衣）会被分位裁剪压成纯黑，实测蓝衣服变黑
- **配色**：CIEDE2000（CIE76 取前 4 候选后精算）替代 CIE76，深蓝/肤色/绿色更接近人眼
- **抖动**：新增可选 4×4 有序抖动，渐变不断成死色
- **取景**：主体自动扩裁 —— 检出纯色背景且主体占比 <55% 时按包围盒重新取景
- **选择器**：新增「增强 / 抖动」开关
- **修复**：单色图去背景护栏（85% 阈值）；纯色图不再转出空板
- **验证**：合成「照片」（渐变天空 + 太阳 + 远山 + 人物 + 草地 + 噪点）转 48×48 后逐点核对：天空 b/c、太阳 7、山 a、草 9、衣服 c、脸 e 全部命中；探针 53 项 + 真机触摸 6 项 + 后端 114/39 全绿

## [0.41.0] - 2026-11-01

桌宠 · 拼豆：云盘导入 + 转换算法重写 + 画布扩到 64 + 布局重构

- **画布**：档位 16/24/32/**48/64**（后端 `MAX_DIM` 同步 64，65 仍拒）；新增 100%/150%/200%/300% 缩放与「抓手」平移，放大后靠视口原生滚动查看，落点仍按缩放后的实际矩形换算
- **导入**：改为「从云盘导入」——图片网格（`?w=160` 缩略图）、背景自动留空、色号上限 6/10/16；保留「从本机选择图片」
- **转换算法**：逐次减半的高质量降采样（避免一次缩小糊成噪点）、CIELAB 感知配色（肤色/绿/蓝更准）、纯色背景识别（85% 护栏，整图同色不判背景）、超限色号并入最近保留色
- **布局**：工具列拆成「内容滚动区 + 操作条常驻」，横屏整页不滚、「就它了」常驻；工具按钮 3 列等宽 46px；修复 Chrome 80 平板 flex-gap 静默失效、吸底条遮住撤销行
- **验证**：工作台探针 53 项、真机触摸探针 6+2 项（真实 `Input.dispatchTouchEvent`、dpr2、含滚动后落点）、后端自测 114+39 全绿；单帧绘制 0.08~0.5ms、输入到可见 ~16ms

## [0.39.0] - 2026-11-01

桌宠 · 拼豆「点了画不显示」修复 + 导入图片

- **修复（严重）**：v0.38.0 重写增量渲染时，`applyAt` 只写数据、没有标脏格 → 画笔/橡皮落豆后画布永不重绘（点、拖都没反应）；铺满/填充/翻转走整块重画所以看着正常，把问题掩盖了。现在每个落点（含左右/上下镜像四点）都标脏
- **新增自测（像素级）**：不再只看 DOM/统计数字，直接 `getImageData` 断言「点一下真的有豆、没点的格不被误画、橡皮能复原、拖拽中间格连续」——上一轮正是只断言统计数字才让这个 bug 蒙混过关
- **新功能 · 导入图片**：选图 → 居中裁成方形 → 缩到当前画板（16/24/32）→ 按人眼加权的最近邻配色映射到 16 色拼豆盘；透明像素留空；整步可撤销

## [0.38.0] - 2026-11-01

桌宠 · 拼豆工作台大改（平板优先）

- **画板放大**：格宽按画板卡真实宽高测量、上限 30→56px。1024×768 横屏 16×16 由 480→608（+27%），32×32 由 512→576；768×1024 竖屏 672 / 640。宽屏两列（画板 + 320px 工具列），页头压成一行，尺寸档位并进标题行，触屏隐藏快捷键提示
- **手感**：画板拆两层画布（底层只重画脏格 / 上层预览+落点+落豆涟漪）；pointermove 用 getCoalescedEvents + rAF 合帧；坐标 rect 只在按下时量一次；统计与预览节流；切工具/切色/撤销不再整页重建
- **云盘导出**：图纸 PNG（含备料清单）改为存进云盘，成功后可一键去云盘；云盘不可用自动回退下载；保留「下载到本机」
- **新功能**：一键铺满、整图左右/上下翻转、四向平移（绕回）、换色（源色→目标色全局替换）、最近使用色
- **修复**：撤销/重做按钮可用态不跟随历史栈；自测假 Router 缺 `router.delete` 导致整套跑不起来

## [1.7.0] - 2026-11-07

学元账本（ledger）正式替代旧积分三表：复式记账内核（post() 唯一写入口、ref 幂等、按资产分组守恒、I1–I9 不变量对账）、CASH/GRANT/PRACTICE 三资产注册表、单位口径归位（1 学元 = 100 账本单位、1 元 = 1000 学元 = 10 万单位）。

- **钱包切换新账本**：余额/转账/红包/提现全走 ledger；旧 xy_account/xy_tx/xy_entry 退役归档（migrations 032–039，启动时自动执行）
- **红包收敛**：领取收敛到聊天内气泡（可看谁领了/领了多少），钱包移除领红包入口；修复本班红包误判为跨班导致看不到他人金额
- **AA 群收款**（collect）：发起/支付密码确认/状态跟踪
- **跨班加固**：两阶段支付与红包补账修复（HMAC + ±5min 防重放 + 幂等键），堵住赠送学元洗成充值学元的证券漏洞
- **xy-mesh 组网学元**：主班班管在自家管控中心跨班管理各班的线下充值、发放/扣减、提现审批与班级小铺；账本始终留在各班本地，HMAC 验签复用 RELAY_SECRET，管理端可视化配置（见 docs/xy-mesh.md）
- **Cluss 充值桥**：Cluss 联邦侧可将学生 CASH 转入其 AI 额度（密钥三态/幂等重放/上限/日累计，verify 脚本 24 项黑盒回归）
- **C2C 学生市集**：学生可开店上架商品，同学间买卖走账本订单按卖家分账，平台不记毛利；管理端可下架违规商品
- **红包资产池选择**：发红包可选资金来源（auto 充值优先 / 只充值 / 只赠送），领取侧与跨班回传均按拆分入账
- **统一风控 pay-guard**：转出统一支付密码 + 日额度（红包/跨班 pending 都计入），封堵换接口绕过支付密码的旁路（/api/xy transfer/withdraw/recharge 三端点 410）
- **发布收敛**：移除 compat 过渡层、ledger 红包双实现、xueyuan2 死代码；测试假学号改 99 段；新增 test:ledger 聚合回归门禁（15 脚本）

### 功能（计算器重构为四页签工具箱：计算 / 绘图 / 换算 / 工具）

按键区重排 + 功能大扩充，零新增依赖（绘图/解方程/统计/进制/日期均为手写实现，
绘图复用 `calc-parser.js` 以 `variables:{x}` 求值），代码兼容 Chrome 80 基线。

- **按键布局**：基础盘 4 列 iOS 风格（运算符右列、数字大键），科学盘 4 列独立分区
  （2nd 括号 Ans / 幂根 / 三角 / 对数 / 倒数取整排列），仅科学模式显示；记忆键
  （MC/MR/M+/M−）移出键盘改为显示卡内记忆条；DEG/RAD/科学徽章常驻显示卡。
  竖屏科学盘在基础上方，横屏（≥768px）左右两栏。
- **历史记录**改带遮罩浮层（不再挤压按键区）：单条删除、时间显示、点表达式回填
  算式 / 点结果回填数值（负数自动加括号）、结果千分位分组显示。
- **绘图**（新增）：Canvas 手绘 y=f(x)，最多 5 条曲线（iOS 色板 + 显隐开关），
  自动刻度网格、单指平移、双指捏合/滚轮缩放、描点模式十字读数、渐近线断线处理，
  DEG/RAD 与计算页共享。
- **换算**由弹窗升级为整页：输入支持表达式（如 1/3）；新增角度/压力/能量/功率
  4 类单位；结果一键复制。
- **工具**（新增，`calc-tools.js` 纯函数库 + `scripts/_calc-tools-test.mjs` 97 项断言）：
  解方程（一元二次判别式/双根/重根/共轭虚根/韦达定理/顶点 + 任意方程多尺度扫描
  变号区间二分求全部实根，按离原点远近截取）；统计（n/Σ/均值/中位数/众数/极差/
  总体与样本双口径方差标准差）；日期（两日期差/±N 天周月推算含月末钳制/农历节气）；
  进制（2/8/10/16 互转，支持小数与负数，二进制 4 位分组）。

### 功能（日历重复事件 / 课程表周次切换与快速加课 / 倒数日搜索）

- **日历·重复事件**：新迁移 `027_add_calendar_repeat`（repeat_type/repeat_end/
  repeat_last_reminded 三列，幂等）；新增 `apps/calendar/backend/repeat-utils.js`
  纯函数（daily/weekly/monthly/yearly 月窗口展开、月末钳制 31 日→2 月末、2 月 29
  平年顺延 3 月 1 日、repeat_end 截止、实例 id `rep_<id>_<日期>` 带 `_series_start`）。
  `GET /events`、`/events/today` 按实例展开（SQL 改取 `event_date <= 月末`，历史起始的
  重复可跨月命中）；`/events/for-countdown` 重复事件返回下一次发生（对齐倒数日
  next_date 语义，已结束跳过）；`/reminders/due` 重构为重复感知（非重复沿用 reminded，
  重复事件用 repeat_last_reminded 记录实例日期，同实例只提醒一次）。前端：编辑器加
  重复 select + 「重复至」日期（选每周/每月等时出现），编辑重复实例提示「修改将作用于
  整个系列」并回填系列起始日期，删除确认注明删整个系列；月视图事件由圆点升级为
  分类色标题条（时间 + 标题 + 重复角标，最多 2 条 + "+N"）；点击非当月日期自动跳月。
- **倒数日**：重复新增「每周」（`apps/countdown/backend/repeat-utils.js`，周相位
  对齐自首次日期每 7 天，monthly 同步改为相位钳制口径）；顶部搜索框实时过滤标题/备注
  （置顶卡与分组联动）；「已过」分组可折叠（状态存 localStorage）。
- **课程表**：周视图支持 ‹ 上一周 / 本周 / 下一周 › 切换（`getWeekMonday/getWeekDates/
  getWeekDateStrs/calcWeekNumber` 加 offset 参数，非本周隐藏今日高亮并显示 ±N 周角标，
  周次/单双周按偏移周推算）；周视图调课重构为构建前应用（`buildTimetable` 内先
  `applyOverrides` 再分时段，replace/delete/**insert** 三种调课在周视图一致生效，
  修复原 insert 不显示、事后补丁不渲染的问题，并新增 overrideStamp 强制重算）；
  空白格点击「+」快速添加课程（insert 模式，锚定上方最近一节、开始时间自动预填其
  下课时间）；今日视图进行中的课显示「剩 X 分钟」+ 进度条。

- **细节打磨**：计算器结果按位数自适应字号（长结果不再溢出）、换算输入去掉
  decimal 输入法限制（平板可输 `/` 与函数）、绘图无可见函数时显示空态引导、
  记忆芯片空记忆置灰；日历月格事件条点击直接编辑、保存校验结束时间晚于开始时间、
  详情按钮触达区加大，并修复**编辑器分类选择器一直为空的存量 bug**（模板引用
  `categories` 未定义，分类恒为默认值）；倒数日编辑器加今天/明天/一周后/下月
  快捷日期（下月同日月末自动钳制）、行内显示每周/每月/每年文案、搜索空结果
  独立文案；课程表添加课程弹窗自动聚焦科目、格子悬浮提示完整科目名与时间段、
  今日视图调课弹窗标题带「今天」。

- **天气·背景系统重做**：全场景调色板重设计（更多色阶、去灰调、对齐 iOS 饱和度
  节奏）；新增四层静态氛围叠加（右上日光/月光光晕、底部地平线雾带、暗角、
  SVG 噪点抖动消除渐变色带），零动画开销；新增**晨昏感知**——日出/日落前后
  60 分钟自动换暖色渐变（晴天/多云/阴天三类专属晨昏底色，雨雪雷雾沿用常规），
  晴↔晨昏切换走既有 2s 背景过渡。
- **天气·滑动与精致化**：修 `height: 100vh` 在 AppShell 宿主内超高导致的底部裁切
  （课程表同款一并修）；`.scroll-all`/`.hourly-scroll` 加 `overscroll-behavior`
  收敛滚动链（滚到顶/底不再带动宿主、横滑逐时条不再突跳竖向）；滚动期间**装饰动画
  全量暂停**（粒子引擎新增软暂停 `setPaused`——保留最后一帧、恢复无 dt 突跳；
  WeatherAnimation 新增 `paused` prop——canvas 冻结 + DOM 动画 play-state 暂停，
  停止滚动 160ms 恢复）；天气页卡片 blur 30px→14px 降合成开销。视觉对齐 iOS 天气：
  hero 加天气图标与「体感/湿度/风」三联指标胶囊（含分隔线、tabular 数字）、全局
  文本柔影；7 日列表行距/图标/日字列/温度条放大细化；逐时条加宽至 54px、「现在」
  改高亮胶囊；air/life 卡去除重复样式统一走 `.card`；滚动条细化。

### 安全（依赖漏洞：51 条 → 11 条，critical 归零）

GitHub Dependabot 报默认分支 43 项（`pnpm audit` 口径 51 项：critical 2 / high 23 /
moderate 20 / low 6）。逐项核过可达性后修复，**critical 2 → 0，high 23 → 5**，
服务端依赖链只剩 `basic-ftp`（经 `pm2 → proxy-agent`，本系统不走 FTP 代理）。

**两个 critical 的实际结论（都不修代码、只封堵）**

- `proxy-addr` IP 伪造（`GHSA-jqcg-44mw-7w3h`）—— 前提是开启 `trust proxy`，
  而全仓**从未设置**，`req.ip` 取 socket 地址，不可伪造。已通过 overrides 强制
  `>=2.0.8`，为将来做反代提前封堵（`rate-limit.js` 正是拿 `req.ip` 当限流 key）。
- `dompurify` SAFE_FOR_TEMPLATES 绕过（`GHSA-cg2g-xh64-v4q7`）—— 前提是传
  `SAFE_FOR_TEMPLATES` 选项 + shadow root，三处 `sanitize(html)` 均未传，当前不可利用。
  按 patch 升到 3.4.17。

**直接依赖**

| 包 | 旧 → 新 | 修复 |
| --- | --- | --- |
| `dompurify` | 3.4.14 → 3.4.17 | XSS 净化绕过 |
| `axios`（端+服） | 1.19.0 → 1.20.0 | fromDataURI ReDoS |
| `multer` | 2.2.0 → 2.5.0 | multipart DoS（`/guest-upload` 免登录可达） |
| `compression` | 1.8.1 → 1.8.2 | 内存泄漏 DoS |
| `sharp` | 0.35.3 → 0.35.5 | libheif |
| `morgan` | 1.11.0 → 1.12.1 | 日志注入 |

**传递依赖（`pnpm-workspace.yaml` 的 overrides 追平新 CVE）**

`qs >=6.16.0`、`js-yaml >=5.4.1`、`follow-redirects >=1.16.1`、`ip-address >=10.7.1`、
`body-parser >=1.20.9`、`proxy-addr >=2.0.8`（新增）。

**刻意未处理**

- `basic-ftp`：经 `pm2 → proxy-agent → pac-proxy-agent`，只有走 FTP 代理才触发，不可达。
- `vite` / `browserslist` / `source-map-js` / `baseline-browser-mapping`：仅本机构建期执行，不进产物。
- `katex`（low）：需跨 minor 到 0.18，收益低于回归风险。

**验证**：`better-sqlite3` ABI 正常；`sharp` libvips 8.18.7 产出缩略图 96×128（真实云盘图
7.6MB → 21KB）；`express` 4.22.1 + `proxy-addr` 2.x 在 `trust proxy=false/true` 两种模式下
`req.ip`/`req.ips` 行为均正确（伪造头被忽略 / 正常采信）；`scripts/ci-check.mjs` 5 项全绿。

### 变更（HTTPS 服务默认端口 443 → 9443，不再抢占 443）

本机 443 归用户自己的其他服务使用，ecosystem 里 `classintra-https` 的默认端口
改为 **9443**。过去的写法是 `HTTPS_PORT: envVars.HTTPS_PORT || '443'`，只要执行一次
`pm2 start ecosystem.config.js`（不带 `--only`）就会把 443 抢走，而 PM2 还会
`resurrect` —— **开机就抢**，用户的服务永远起不来。

- 现在要占用 443 必须在 `server/.env` 里显式写 `HTTPS_PORT=443`，属自愿行为。
- `/cluss-app` 反代与端口无关（按 `req.url` 匹配前缀），换端口不需改代码。
- 已在 9443 实测：首页 200、`/cluss-app/` 200、`/cluss-app/api/health` 200；
  443 无 LISTENING。

### 修复（应用管控漏掉桌面上的应用）

- **管控面板的应用名单改为从 `apps/*/manifest.json` 动态读取**，不再手抄一份常量数组。
  过去「桌面显示什么」由前端 `core/app-registry.js` 扫 manifest 决定，
  「管控能管什么」由 `routes/admin.js` 里手写的 `DESKTOP_APPS` 决定 —— 两份名单。
  只要新增应用忘了同步抄一份，就会出现「桌面有图标、管控里查不到也管不了」。
  实测差集为 **Cluss** 与 **应用市场**：两者 manifest 里都有（`category: desktop`），
  却从未进过手抄名单；顺带 `PUT /admin/app-control/cluss` 之前会直接 400「无效的应用名称」。
- 「是否允许禁用」的语义也一并回到 manifest 的 `canDisable`，不再在手抄数组里另写一个
  `protected`。settings / admin / 应用市场 原本在 manifest 里就是 `canDisable: false`，
  行为与改前完全一致。
- 管控面板的图标/配色仍保留手写覆盖：manifest 的 `icon` 是**图片路径**（给桌面用真图标），
  而管控渲染的是 Font Awesome 类名，两套图标体系并存是有意的。新增应用不登记也不会报错，
  只给一个通用灰方块。

### 新增（Cluss 可在 HTTPS 版 CI 中内嵌访问）

HTTPS 站点（https://\<局域网IP\>）此前无法内嵌 Cluss：浏览器把 HTTPS 页面里的
HTTP 子资源一律按混合内容拦截，iframe 属 active mixed content，没有开关可放行，
Cluss 应用只能降级成「新窗口打开一个没有导航的裸页面」。

- 新增同源反代 `/cluss-app/*` → `http://127.0.0.1:9003`（`server/src/routes/cluss-proxy.js`）：
  HTTPS 页面 iframe 指向 `/cluss-app/`，浏览器看到的是同一个 https origin，混合内容问题从根上消失。
  - 前缀刻意**不叫 `/cluss`** —— 那是本系统自己的应用壳路由（`apps/cluss` 的 `route`，
    history 模式由 `app.get('*')` 兜底），占了它学生点桌面图标就会直接被反代截走；
  - 反代挂在 **server 层**而非 express 中间件链：Cluss 的对话/批改/写作全是 SSE 长连接，
    必须绕过 compression 才不会被攒帧（学生看到「转圈半天不出字」）；
  - `/cluss-app`（无斜杠）302 到 `/cluss-app/`：地址稳定，且相对资源解析只有带斜杠一种标准形态；
  - `Set-Cookie` 的 `Path=/` 收窄为 `Path=/cluss-app`：Cluss 的 `cluss_token` 与本系统的
    `token` 虽不同名，但没理由让一个 httpOnly 学习令牌在全站范围内裸奔；
  - 上游不可达时回一个说人话的 502 页面（不是 JSON），并提示 Cluss 未启动。
- Cluss 应用壳（`apps/cluss`）HTTPS 分支改为：先 `fetch('/cluss-app/api/health')` 探活，
  通了才挂 iframe；不通则显示「Cluss 没有启动 + 重试」，不再把 502 兜底页嵌进 iframe
  （iframe 的 load 事件分不清「Cluss 首页」和「错误页」）。HTTP 版仍走原来的 9003 直连，行为不变。
- HTTPS 服务纳入 PM2（`classintra-https`，443）：此前是手动 `node src/app-https.js` 起在某个
  cmd 窗口里，机器重启不回来、崩了没人拉、改了代码不生效（旧进程攥着旧代码）——
  而本次反代恰恰需要它重启才能加载。开机 `pm2 resurrect` 一并恢复。

### 修复（HTTPS 镜像实例不再与主实例争抢全局唯一资源）

新增的镜像进程复用同一份 express 与同一个 SQLite 库，但 WS(10001)/Relay(10011)/
mesh 席位/机器人 relay/网页代理(9101) 全都「全局只能有一个所有者」：

- `ws/chat-server.js` 顶部按 `WS_MIRROR_MODE` 早退为空壳：不再监听端口、不连 8i 节点。
  此前两个实例同时当中枢，8i 侧反复 `removing existing peers with same ID`，
  两边互相把对方踢出 mesh，跨班同步的数据在两边来回倒。
- `plugins/astrbot-relay` 镜像实例跳过启动：机器人账号在 CI WS 上只能有一个连接，
  双登的后果是每 3 秒一轮的互踢循环（服务端回 code=1005 → 这边立刻重连），
  机器人在学生端表现为间歇性掉线。
- 镜像实例 `WEB_PROXY_AUTOSTART=0`：网页代理端口归主实例，否则被镜像抢走、
  真正要用的主实例反而 EADDRINUSE 起不来。
- 天气提醒调度同样只由主实例跑，否则同一个提醒发两遍。

### 修复（SPA 内登录后第三方应用与壁纸不显示）

已认证引导链只挂在「页面加载」上：`main.js` boot 的 market 阶段与 `App.vue` mounted
的已登录分支（`/user/settings` 壁纸水合）。在登录页完成登录（token 无→有）时两者都不
重跑，桌面于是停留在默认壁纸、且缺 chess/gomoku/pet 等第三方图标；刷新（重跑 boot）
后才出现。现在 App 层 token watcher 在拿到 token 时重放已认证引导：
`syncMarketAppControl(null, true, 'control')`（清 app-control 缓存 → `/system/app-control`
→ 市场清单刷新 → 注册路由/悬浮层/小组件 → 重载桌面布局）+ `syncMarketThemes()` +
`/user/settings` 水合（抽为 `hydrateServerSettings()`）。`main.js` boot 的 market 阶段
无 token 时直接跳过 `/market/installed`，不再发必 401 的请求。登录与深链回跳两条路径
都覆盖；登出清理语义不变。


## [未发布]

## [1.6.1] - 2026-10-31
第三方应用接入宿主统一导航栏（ui.hostNavbar 通道）：象棋/五子棋下线自绘标题栏，省出对局空间；跨班图片/文件预取链路修复；象棋支持跨班对局


## [1.6.0] - 2026-10-25
【新增】
- 桌宠系统
- 市场生态大版本：应用 / 主题 / 小组件 / 插件四类模块统一注册与热挂载，安装卸载更新不需要重启服务
- 前端内核 v2：分阶段启动编排（BootOrchestrator，任一阶段抛错只记录并派发事件、不阻断后续阶段）、统一模块注册表（ModuleRegistry，四类模块用能力位表达差异而非四套代码路径）、生命周期状态机（LifecycleMachine，`idle → loading → active → suspended → idle`，非法跃迁主动抛错）、资源审计（ResourceAuditor，挂载期快照 window 键并劫持计时器/监听器，卸载或挂起时自动回收）
- 浏览器兼容模式：移动端触摸与文字输入、页内导航/刷新/视口自适应、网页声音开关与流式播放

【优化】
- 兼容模式改用二进制帧与触摸惯性，音频提升至 24kHz
- 兼容模式异步解码、触摸合并、自适应画质与断线重连
- 兼容模式帧流背压、后台暂停与输入按帧合并
- 兼容模式支持双指缩放

【修复】
- 应用管控名单改从 `apps/*/manifest.json` 动态读取：Cluss 与应用市场此前在管控里查不到、也管不了

【部署】
- HTTPS 服务默认端口 443 → 9443，把 443 还给机器上的其他服务（在 ecosystem 里显式指定，避免 `pm2 start ecosystem.config.js` 抢端口后被 resurrect 长期占用）
- Cluss 可经 `/cluss-app` 同源反代内嵌访问，不再依赖跨端口
- HTTPS 服务纳入 PM2 管理，随开机 resurrect 一并恢复

## [1.5.0] - 2026-10-18
【优化】
- 云盘转存改走 bot 硬链接转运：从 AstrBot 下载的视频转存云盘时，不再复制一份字节进 `cloud/shared/`，改由 bot 侧校验后建立硬链接（同盘零额外占用）；存量 413 个重复副本可回收约 7.58 GB（治理脚本 `scripts/cloud-bot-relink.mjs`，三重校验 + 原子替换）
- bot 转运端点不可达时自动回退本地复制；视频已被 bot 清理时提示「请重新下载」而非报错

【新增】
- 失效资源提醒：云盘条目对应的物理文件缺失时（bot 清理/同步失败/数据损坏），打开云盘弹窗提示，支持「一键清除失效资源」；同一批失效只提醒一次（签名机制，不每次打开都弹），另有常驻入口条可随时重开
- ZW 设备启动器（/zxw）：把启动页从服务器下发到设备端宿主本地并打开，同名文件已存在时设备端原生短路、不重复传输；启动页带按版本记账的就绪标记（首装后每次访问秒开、无感），服务端提供事件取证（/zxw/log）与渲染信标确认（lock_beacon）。启动页源码不入库，入库产物为「密文 + 无密钥」的反阅读构建；旧路径 /zx 308 重定向。详见 docs/zxw-launcher.md
- Cluss 联动应用：桌面新增「Cluss」应用（apps/cluss），全屏内嵌同机 9003 端口的 Cluss（引导式 AI 解题）。已登录时把本系统 JWT 经 ?token= 传给 Cluss，凭共享的 CI_JWT_SECRET 验签免登；嵌入态顶栏的「返回 ClassIntra」按钮 postMessage 回应用壳退出应用
- 联动桥 /api/cluss-bridge/verify 响应新增 is_class_admin / is_admin 字段：Cluss 侧据此授管理权（联动部署下班管才是实际管理者）

【修复】
- 联动桥 `/api/cluss-bridge/verify`：禁用账号不再返回 403，改回 200 + `data.disabled` 标记——原 403 与密钥校验失败的 403 撞码且都不带 data，Cluss 侧无法区分，只能一律拒绝

【其他】
- 构建优化：`legacyChunks` 默认关闭（本产物在 Chrome 80+ 平板上从不执行）+ `build.target` 89→80，构建耗时 269s 降至 49s，产物 21MB 降至 11MB

## [1.4.1] - 2026-10-17
应用竖屏适配：Chat/AIChat 会话列表在竖屏/窄屏改用覆盖式抽屉（遮罩+开关按钮，选中会话自动收起）；社区侧栏由固定竖排改为顶部横向标签栏；全局新增竖屏安全区基线（保留原有留白，仅按 env(safe-area-inset-*) 扩展）

## [1.4.0] - 2026-10-17
【新增】
- 新增 Cluss 联动桥（只读），供跨系统账号校验

【其他】
- fix(ws): 登录/登出按 token 重连与断连——修跨班登录后 WS 仍绑定旧用户
- feat(realtime): 第三方实时事件通道改走 WebSocket（WS 优先，长轮询兜底）
- fix(test): 市场目录用例补上鉴权头——修既有失败用例（catalog 自 v1.3.0 起已需登录）
- fix(auth): 补上 RS256 改造遗漏的验签入口——修「登录后立刻被登出」
- feat(auth): JWT 改用 RS256，私钥不出本机，联登不再依赖共享密钥
- sync-market.ps1: -Commit 模式补 add index.json（三处版本一致红线，1.10.1 实测漏提交）
- sync-market.ps1: UTF-8 BOM 修复 PS5.1 GBK 误读 + robocopy /XF 排除引擎二进制
- fix(ops): 自启轮询窗口加宽 + pm2 stop/restart 审计前置
- feat(chess): 新增 Pikafish 引擎安装脚本（各机装一次，二进制不入仓）
- fix(autostart): 修复开机 PM2 双 daemon 竞速导致全站不启动

## [1.2.5] - 2026-09-29

【修复】

- 社区帖子详情页：发评论时若改走云盘全屏选择器选完媒体，会丢失详情页上下文（CloudImagePicker 原先只快照 2 个字段，路由销毁后不回填）。改为全量快照 + 逐一恢复（重开详情、评论草稿、回复对象、新帖草稿、当前页签）
- 倒数日与日历不联动：前端 linkedCalendarEvents 恒为空——/calendar/events/for-countdown 接口早已就绪却从未被调用（半成品）。倒数日页与桌面小组件改为「原生 + 联动」并行取数合并
- 跨班生图看不见：A 班机器人发的图在 B 班打不开。新增跨机媒体回源中间件（本机无此文件时按 peer 静态基址回源，并发合并去重）；补齐中继补推链路——relay-sync 的 chat_messages 分支原先声明了 newly_applied 却从不填充、chat-server 补推也缺该分支（静默丢失），Chat.vue 对齐 historical 约定不再为补推弹通知
- 设置页「动态壁纸」进入卡住：一次性创建 14 个视频缩略图（单文件最大 180MB）。改为 IntersectionObserver 懒加载，卸载时断开
- 社区「我的」页面在平板划不动：.mine-body 显式 overscroll-behavior-y: auto 修复嵌套滚动链（同 1.2.3 管理端同类问题），并补窄屏单列堆叠

【优化】

- 社区加载态统一为骨架屏（帖子流 / 美食榜 / 热搜榜），榜单序号与头像尺寸对齐，消除「加载态与视觉割裂」
- 桌面渲染性能：pagesView 预计算每页「可见 widget + 可用 slot」（原先模板在 v-for 里直接调方法、每次渲染每页重跑 filter / 查表 / 权限 getter）；应用可见性收敛为 visibleAppMap 查找表（原先逐 slot 线性扫描注册表 + indexOf，现 O(1) 命中）
- 冷启动网络：/system/app-control 原先被路由守卫 / App.vue / 桌面三方各拉一次，收敛到 router 侧统一缓存（含并发去重），三方共享同一请求；桌面回到前台/聚焦仍强制重取
- 移除超能岛「通知历史」模式（模板分支、长按/右键手势入口、状态与面板组件一并清理），相关动效 easing 改用 var(--ease-standard) 令牌

【文档】

- 第三方开发指南与文档站新增「内置数据源」章节：课程表数据源 Resources/public/kb.yml 的位置与命名约定（name / simplified_name / teacher / room）
- 新增「AstrBot 接入是双边插件」章节：CI 侧 astrbot-relay + AstrBot 侧 astrbot_plugin_classintra 缺一不可，含就绪判据与两侧共享配置

## [1.2.4] - 2026-09-28

【新增】

- AstrBot 机器人接入插件升级至 1.1.0：新增站内信息共享（公告/快讯/资源/天气/社区只读，读的是 CI 自身库/配置/服务）与机器人管理代理（24 个 op 白名单、破坏性操作两段式确认闸门、all 全体令牌批量封禁）

【其他】

- server/.env.example 补齐至 65 键：新增「AstrBot 接入 / HTTPS·隧道网关 / 开发·运维开关 / 媒体落盘与跨机回源」四节，覆盖全部代码在用但模板缺失的配置项；真实密钥一律占位
- scripts/sync-market.ps1 增加同步排除规则：顶层下划线前缀的临时探针文件不再镜像进 market 仓（目录放行，plugins/\_sdk 不受影响）
- 同步侧：market 仓索引 index.json 对齐真实清单（补上缺失的 chess 应用、修正 gomoku 与三个插件的版本号与文件清单）；文档站新增《AstrBot 机器人接入》页并补充插件市场安装说明

## [1.2.3] - 2026-09-28

【修复】

- 管控中心「用户管理」列表在平板上划不动：client/src/styles/global.scss 的全局规则（星号选择器上的 overscroll-behavior-y: contain）会掐断「嵌套滚动容器 → 父级」的链式滚动；叠加 .data-table-wrapper 的 overflow-x: auto（使其成为滚动容器）后，落在表格上的纵向手势完全失效，而落在内容区留白（命中 .admin-content）上仍可滚 —— 即用户反馈的「列表划不动、滑边缘却可以」。修复：给 .data-table-wrapper 显式 overscroll-behavior-y: auto
- 修正上一轮误判：touch-action 不是根因（补丁已上线仍无效，且会禁用表格区缩放）；验收改为派发真实手势量 scrollTop  
  【其他】
- 新增手势级验收探针 scripts/touch-scroll-probe/：CDP 派发真实触摸 + 自签 token 加载真实管理页 + 反向对照；内置「开屏动画遮挡」「注入 token 的 activeTab 竞态」两个假阴性陷阱的处理

## [1.2.2] - 2026-09-12

【新增】

- 插件市场：catalog 支持 plugins 段，市场页可拉取、安装、卸载服务端插件并热挂载（安装位置为运行时 plugins/ 目录）
- 发帖带图修复：publish_classintra_post 工具新增 image_urls 参数，AI 可从对话上下文提取图片链接附加到帖子

【其他】

- 仓库规范化：插件迁出至 market，工作数据清理，功能优化与质量门延续

## [1.2.1] - 2026-08-26

【安全】

- 修复 33 个 Dependabot 依赖漏洞（11 high）：升级 client 端 postcss/dompurify/sass/mermaid/highlight.js/video.js/axios/vite（5→6）+ 插件链（plugin-legacy 5→6、plugin-vue2→2.3.4），升级 server 端 pm2/morgan/ws/jose/uuid/sharp
- 通过 pnpm overrides 强制升级传递依赖到安全版本（immutable/js-yaml/ip-address/@babel/core/@babel/preset-env/qs/body-parser/form-data/follow-redirects）
- 剩余 1 个 low 漏洞（vue@2 EOL parseHTML ReDoS）显式忽略，待跨大版本升级 Vue 3 时解决
- 测试脚本改为串行执行（--test-concurrency=1），避免集成测试并行竞争 market-apps 目录导致的偶发失败

## [1.2.0] - 2026-08-25

【新增】

- 联机 Gomoku：支持在线对局与市场应用接入
- 账号 API：完善账号认证与相关接口能力

【发布】

- 准备 1.2.0 版本发布

## [1.1.92] - 2026-08-26

【其他】  
fix(market): use dedicated application market icon

## [1.1.91] - 2026-08-25

版本更新

## [1.1.90] - 2026-08-25

【其他】  
fix(gomoku): fix room sharing and viewport layout

## [1.1.89] - 2026-08-25

版本更新

## [1.1.88] - 2026-08-25

版本更新

## [1.1.87] - 2026-08-25

版本更新

## [1.1.86] - 2026-08-25

版本更新

## [1.1.85] - 2026-08-25

【其他】  
chore(release): prepare 1.2.0 release  
feat(gomoku): add online room and websocket sync

## [1.1.84] - 2026-08-25

版本更新

## [1.1.83] - 2026-08-25

版本更新

## [1.1.82] - 2026-08-25

版本更新

## [1.1.81] - 2026-08-25

版本更新

## [1.1.80] - 2026-08-25

版本更新

## [1.1.79] - 2026-08-25

版本更新

## [1.1.78] - 2026-08-25

版本更新

## [1.1.77] - 2026-08-25

【其他】  
feat(market): add download source fallback and feedback

## [1.1.76] - 2026-08-24

【新增】  
add third-party market app lifecycle

【新增】

- 建立第三方市场应用生命周期：安装、动态加载、更新、启用/禁用和卸载
- 增加五子棋市场应用示例与完整 HTTP 生命周期测试
- 增加市场应用文档，并记录 iFlyCompass 开源项目致谢与参考来源

## [1.1.75] - 2026-08-24

版本更新

## [1.1.74] - 2026-08-24

版本更新

## [1.1.73] - 2026-08-24

版本更新

## [1.1.72] - 2026-08-24

版本更新

## [1.1.71] - 2026-08-24

版本更新

## [1.1.70] - 2026-08-24

版本更新

## [1.1.69] - 2026-08-24

版本更新

## [1.1.68] - 2026-08-24

版本更新

## [1.1.66] - 2026-08-23

版本更新

## [1.1.65] - 2026-08-23

【其他】  
assets: switch to horizontal logo-d and new Banner.png  
assets: add new logo, white-bg logo and banner  
feat(lock-screen): add admin toggle for lock screen feature  
fix(docs): add sealed_token to star-history chart for public display  
revert(ci): remove star-history action, switching to sealed_token approach  
feat(ci): add self-hosted star-history action to replace broken star-history.com embed  
Update README title by removing emoji  
fix(docs): use jsDelivr CDN for logo image to resolve raw.githubusercontent DNS issue  
feat(docs): add project logo banner to README top  
fix(docs): correct repo URL from Nevino2333/ClassIntra to ClassIntra/ClassIntra  
chore(ci): optimize GitHub workflows and prefer prebuilt native binaries  
release: v1.1.64 production hardening

## [1.1.64] - 2026-08-19

【安全】

- 分级限流：登录/注册/刷新 token 60/min，状态查询 300/min，解决前端 2 秒轮询触发 429

【修复】

- 重新配置时 user_id 与 users 表同步：已注册学生保留原 ID（防止账号失效与 ID 冲突），新学生自动跳过已占用 ID
- 班级群成员更新改为 UPSERT，避免删除行破坏群消息外键
- 配置页对已注册场景增加警告横幅与确认提示

【优化】

- 移除 build.bat 冗余 xcopy 步骤（app.js 直接从 client/dist/ 提供前端产物）
- 删除陈旧构建产物 server/public/index.html
- .gitignore 收敛 server/public 仅保留 setup.html/icons/xgplayer

【文档】

- README/CLAUDE/DEPLOY 统一反映 apps/+plugins/+themes 结构
- 修正班管账号创建流程说明（预注册 + ADMIN_USER_IDS，非 ADMIN_PASSWORD）

## [1.1.63] - 2026-08-04

版本更新

## [1.1.28] - 2026-07-21

版本更新

## [1.1.27] - 2026-07-18

版本更新

## [1.1.26] - 2026-07-17

版本更新

## [1.1.25] - 2026-07-17

版本更新

## [1.1.24] - 2026-07-17

版本更新

## [1.1.23] - 2026-07-14

【新增】  
超能岛视频岛模式 + Browser iframe 指令下发 + polling 指数退避  
WebSocket HTTP long-polling fallback + Super Island share capsule

【其他】  
snapshot before websocket fallback + share capsule

## [1.1.22] - 2026-07-09

【新增】  
小组件固定到格子 + campusbili 静音/性能/手势/分享胶囊 + 日历多视图 + 计算器修复

## [1.1.21] - 2026-07-09

【新增】  
添加一键封禁/启用用户桌面小组件  
管理页面用户列表添加复制用户信息至剪贴板功能  
头像颜色服务端持久化，支持跨设备同步  
新增插件开发文档 + CampusBili 桥接插件  
优化管理员工具栏按钮布局，使用分组按钮+自动换行防止溢出  
管理员用户列表添加批量开启/关闭超能岛浏览器权限按钮  
完善超链接权限/搜索框/桌面布局  
第四轮5需求全部完成

【修复/优化】  
修复跨班中继帖子时间戳格式不一致导致排序错乱  
超能岛浏览器权限管理限制仅班管可操作  
campusbili 桥接修复返回按钮消失和访问密码问题  
修复计算器逻辑并完善功能  
管理员编辑用户 browser_enabled 后，前端通过 WebSocket 实时同步更新 auth store

## [1.1.20] - 2026-07-08

版本更新

## [1.1.19] - 2026-07-08

【新增】  
iPadOS 风格强化 - 毛玻璃材质分级系统 + 圆角梯度修正

【修复/优化】  
第三轮5需求  
社区帖子排序改用 id DESC + CC 徽章覆盖帖子详情和评论  
系统头像完全支持 emoji/Unicode 字符（字体 + grapheme 处理）  
修复计算器按钮显示 + 隐藏 integration + 移除设置管理入口 + 管控中心命名

## [1.1.18] - 2026-07-07

版本更新

## [1.1.17] - 2026-07-06

版本更新

## [1.1.16] - 2026-07-06

版本更新

## [1.1.15] - 2026-07-06

版本更新

## [1.1.14] - 2026-07-05

版本更新

## [1.1.13] - 2026-07-05

版本更新

## [1.1.12] - 2026-07-05

版本更新

## [1.1.11] - 2026-07-05

版本更新

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
Calendar.vue 代码诊断 - 用 /toast 替换原生 alert/confirm  
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
