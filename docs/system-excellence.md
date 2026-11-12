# ClassIntra · 全维度卓越标准与体检报告

> 更新 2026-11-12 · 配套门禁 `scripts/system-audit.mjs`（纯 Node 内置模块，不装依赖、不连库、<10s）
> 用法：`node scripts/system-audit.mjs` / `--strict`（WARN 也算失败）/ `--json`（看板消费）

## 0. 「顶级」不是形容词

一个系统自称顶级没有意义，除非每个维度都有**能自动跑、能指向文件、能拦发版**的判据。本文定义六个维度，全部落进上面那个脚本；CI（`.github/workflows/kernel-ci.yml`）每次 push 都跑，退出码非 0 即拦。

| 维度 | 判据举例 | 为什么算「顶级」 |
|---|---|---|
| 资金完整性 | 22 个脚本在门禁内、迁移无撞号、schema 与迁移 046 七表一致、名单文件读失败不清库 | 钱不能被一次重启或一次部署抹掉 |
| 财政权限 | treasury 判定单一真相源、`/api/xy` 无裸 `requireAdmin`、`/issue` 挂 `requireTreasury`、混合动作拦管理员越权、桥额度原子化 | 从班班管不能从第二个 HTTP 门面绕开封锁印钱 |
| 凭据与日志 | 访问日志不裸记 `:url`（`?token=` 脱敏）、dotenv 不依赖 cwd、`.env` 已忽略 | 凭据不落明文文件 |
| 事件可靠性 | relay 去重标记在 handler **成功之后**、未登记事件拒绝外发、Statement 缓存可关闭 | 失败可重放，不丢数据、不越权外发 |
| Chrome80 与主题 | 真实 `inset` 声明为 0、flex gap 兜底不靠 `@supports` 误判、纯白背景受控 | 平板基线浏览器上不能静默错位 |
| 工程质量 | CI 纳入全维度门禁、日志体积、最大 chunk、SQL 编译复用 | 有可重复门槛，不靠人肉记得 |
| 错误态 | 空 catch、catch 后静默置空、账本失败留痕与结构化错误码 | 「拉不到 ≠ 没有」 |

**评分**：`PASS` 计 1 分、`WARN` 计 0.5、`FAIL` 计 0；`INFO` 只记录不计分。当前 **95/100，PASS 25 / WARN 3 / FAIL 0**（财政权限维度 6 项全绿）。

---

## 1. 本轮体检方式

四个只读子代理并行扫全仓（安全权限 / 可靠性数据 / 性能可观测 / 工程质量与体验），每个都必须给 `文件:行号` 实证。然后**逐条复核**，纠正了三条误报：

| 子代理结论 | 复核结果 |
|---|---|
| `pre-records.json` 不存在，每次重启清空名单 | ❌ 文件存在（4803 B）。但「文件损坏 → catch 吞 → DELETE + 导入空数组」的潜伏事故**属实**，已修 |
| `dotenv.config()` 从项目根起会读不到 `.env` | ❌ PM2 `cwd` 明确是 `server/`。仍改成显式 path，消除对 cwd 的依赖 |
| Chrome 80 不支持 `min()/max()`、`?.`、`??` | ❌ 80 已支持；`vite target=chrome80` + polyfill 已就绪。真正红线只有 CSS 的 `inset` 与 flex gap |

这个复核环节是刻意的：项目历史上四次事故都源于「拿字段/结论当它不是的东西用」。

---

## 2. 实修清单（本轮，全部零资金语义变更）

### 学元财政权收口（2026-11-12 第二轮，最高危）

深潜发现**确凿的越权发行旁路**：组网 `member` 角色下，`/api/xueyuan/admin/*` 全部挂 `requireTreasury` 封锁，但 `/api/xy/issue` 只挂 `auth.requireAdmin` —— 从班班管 `POST /api/xy/issue` 即可直接印 GRANT，绕过「学元管理整体移交给主班」。前端 `Admin.vue` **零调用**该端点，所以修它零风险。

1. 新建 `server/src/middleware/treasury.js` 作为**单一真相源**；`routes/xueyuan.js` 改为引用它（删本地重复定义），两个门面不再可能漂移。
2. `routes/ledger.js` 的 20 处 `auth.requireAdmin` 全部换 `treasury.requireTreasury`（发行 / 商品 / 返现 / 贷款核销 / 信用操作 / 全部 admin 只读端点）。
3. 混合端点（学生与卖家本人也能用的订单动作、商品上下架）加 `treasury.treasuryForAdmins`：只拦「以管理员身份越权操作别人的单」，普通用户直接放行。用路径模式 `router.use` 覆盖，后续新增订单动作自动受保护。
4. `cluss-bridge.js /app-credit`：日流出额度检查与 `ledger.post` 合进同一 `BEGIN IMMEDIATE` 事务，堵住并发下两个不同 ref 同时过检的 TOCTOU；`pay-guard.dailyOutCent` 新增 `{strict:true}` fail-closed 模式（默认仍 fail-open，不影响学生转账）。
5. 新增 `scripts-test-treasury-guard.cjs`（24 项判定矩阵 + 静态断言），纳入 `test:ledger`；`system-audit.mjs` 新增「财政权限」维度 6 项判据。

**收紧说明**：`requireTreasury` 只认班管/系统管理员，普通班干（officer）不再能访问 `/api/xy` 的管理端点——这是与 `/api/xueyuan/admin/*` 对齐，前端管控中心本就只对班管开放，零影响。

### 事故级
1. **`server/src/utils/init-db.js`** — `DELETE FROM pre_records` 移入「名单文件读取成功」分支。旧实现只要 JSON 损坏/缺失就清空全表再导入空数组，一次重启抹掉全班预注册名单。
2. **`server/src/utils/relay-bus.js`** — 去重标记从 handler **之前**移到**成功之后**；handler 抛错、未知事件类型都不再标记。旧实现让一条失败消息的重传被永久吞掉（数据永久丢失），错误日志补 `ref` / `relay_msg_id`。

### 安全
3. **`server/src/app.js`** — 新增 `safe-url` morgan token，对 `token/access_token/secret/key/password` 等 query 值脱敏；`extractToken` 接受 `?token=`，裸链接的 7 天 JWT 原来会明文落 pm2 日志。
4. **`emit.js` / `outbound-dispatcher.js`** — 未登记事件不再把 scope 覆写成 `undefined`（那会让 `:46` 的过滤被跳过、把内部事件推给**所有**集成）；dispatcher 再加一道拒绝；`allSettled` 分支补 `.then/.catch`（原来结果从不落日志）、fetch 补 5s 超时。
5. **`app.js` / `app-https.js`** — dotenv 显式 `server/.env`。

### 可靠性与性能
6. **`server/src/utils/db.js`** — 加可关闭的 Statement 缓存（`CI_SQL_CACHE=0` 回退），全仓 1169 处 `db.prepare()` 零改动受益。**前置核实**：全仓 0 处 `.pluck/.raw/.expand/.safeIntegers()`，否则缓存会串味。
7. **`crash-logger.js` / `rate-limit.js`** — 模块级 global 防重（热重载不再层层包装 `process.exit`）、定时器 `unref()`。
8. **`relay-sync.js`** — 12 处 `catch (e) {}` 补上下文日志，不再静默吞。

### Chrome 80 / 主题
9. **`vite.config.mjs` + `main.js`** — flex gap 兜底改成**真实布局测量**：`CSS.supports('gap','1px')` 在 Chrome 80 恒为 true（grid gap 自 68 支持），所以 `@supports not (gap:1px)` 永远不命中，~90 个文件的间距一直静默失效。现在 PostCSS 额外生成 `.no-flex-gap` 选择器，由 `main.js` 测第二个 flex 子项偏移来启用；旧 `@supports` 兜底保留，双保险。
10. **9 处 `inset`** — `Banned.vue`(2)、`FollowListSheet.vue`、`ImageCropper.vue`、`ProfileEditor.vue`(2)、`market-sdk.js`(2)、`market-sdk-ui.js` 展开为 `top/right/bottom/left`。后三个是不过 Vite 的裸 JS 数组样式，必须真实改。
11. **7 处纯白背景** — `CloudLite.vue` 改 `var(--card-bg,#fff)`；另有 11 处刻意白色（二维码底、滑块、录制圆芯）与约 25 处范围外白色保留并登记。

### 门槛
12. **`scripts/system-audit.mjs`** — 六维度静态门禁；**CI 增加该步骤**；本文档定义验收口径。

---

## 3. 验证

| 项 | 结果 |
|---|---|
| 学元全量回归 | **22 脚本 1472 项 / 0 失败**（含财政权专项 24 项） |
| 既有 `ci-check.mjs` | 6 项全绿（158 文件语法、47 迁移、20 manifest、共享契约、前端冒烟、版本一致性） |
| `system-audit.mjs` | **95/100，PASS 25 / WARN 3 / FAIL 0，退出码 0** |
| `preflight-go-live.mjs` | **GO**：在最新生产快照上 `VACUUM INTO` 后跑迁移 046 → 29/29；首页 9001 200 |
| 关键文件 `node --check` | 全过 |
| 生产库 | `schema_version` max=45，迁移 046 未上线（只在副本验证过）；本轮无任何写操作 |
| 前端 | 只改源码**未 build**，避免新前端调用尚未重启的旧后端；`client/dist` 未被写入 |

---

## 4. 未决技术债（3 项 WARN，按 ROI 排序）

| 项 | 现状 | 收敛路径 | 为什么本轮没做 |
|---|---|---|---|
| 空 catch **977 处** | 分布在前端 `.catch(function(){})` 与后端多处 | 按文件分类：刻意的（JSON.parse 探测等）保留并注明，其余补 `loadError` 状态位；门禁阈值随批次下调 | 需人工逐类判断，批量加日志会制造噪音 |
| 日志 **476.7 MB** | 229 个 log + 207M 截图，轮转有切分但无 retain | `pm2 set pm2-logrotate:retain 7`；`logs/pet-ui` 截图按 30 天归档 | 删用户日志需确认留档策略；PM2 配置变更需重启 |
| 最大 chunk **1085 KB**（Community） | `Community.vue:1209` 静态 import marked/dompurify/hljs/katex，含 195 次 `registerLanguage` | 改 `import()` 懒加载 + vite 拆 highlight.js，阈值从 1500 降到 500 | 需 build 且改同步调用点，属独立发版窗口 |

**另有四项高危但需灰度/对端配合**（体检发现，未动）：

1. `RELAY_SECRET` 一把密钥通杀桥 / `/verify` / `/relay-verify` / 跨班入账 / 组网充值；建议拆 4 把独立密钥，`/verify` 改返不可逆 verifier。**需 8i 与 Cluss 同步升级**。
2. `auth.js:441` 登录时把明文 `{account,password}` 转发给每个 `RELAY_SERVERS`；改挑战-HMAC。**需对端配合**。
3. `jwt.js:229` HS256 兜底无 `algorithms` 限制，`JWT_SECRET` 曾共享给 Cluss；持钥可伪造班管 token。清空前需确认 `jwt.js:231` 连续 7×24h 无命中。
4. `cross-pay.js:266` / `xueyuan.js:524` 的「先查额度后写账」仍不在同一 immediate 事务，并发下可双花；`039` 迁移缺 `foreignKeysOff`、`migration-runner` 的 `foreign_key_check` 在提交之后。这些触碰资金路径，必须先在副本逐笔比对再灰度。**`cluss-bridge.js` 的同型问题已于本轮修复**（额度检查与 post 合进 `BEGIN IMMEDIATE` 事务）。

**另有两处门面口径差异（未动，需前端配合）**：`/api/xueyuan/transfer` 缺 `pool` 透传、`request_id` 幂等与学号正则（`/api/wallet/transfer` 都有）；`collect.js:222` 的 AA 付款在服务层内部直调 `xy.transfer`（已过 `guardPay`，非裸奔）。收敛到单一入口前需先加流量探针。

`admin.js` 部分敏感端点对任意 officer 直接 `next()`（应挂 `requirePermission`），也列入下一批。

---

## 5. 上线状态（2026-11-12 11:20 复核：已落地）

**更正前几轮的结论**：实测生产库 `schema_version` 已有 v46 记录（`applied_at = 2026-11-11 18:14:21 UTC` = 北京 11-12 02:14），PM2 五个应用 uptime 9h，`xy_ledger_tx_seals` / `chain_state` / `reconcile_runs` / `supply_state` / `post_attempts` 全部落地、genesis 已打在 tx #1023，`/api/xy/admin/overview|proof|supply` 返回 401（端点存在）而非 404。**服务在 11-12 凌晨 02:14 左右被重启过，后端加固早已生效**，财政权修复同样在线上。

前端则在 11-12 11:15 完成全量 build 并同步 8i（两端入口同为 `index-C8l_Nz_W.js`，首页均 200）。**前后端现已对齐**，`client/dist` 引用 8 项、manifest 183 项，缺失 0。

下面保留预检命令与顺序，供后续发版复用：

**先跑只读预检**（把上面所有检查打包成一条命令，输出 GO / NO-GO，不重启、不 build、不改生产库）：

```
node scripts/preflight-go-live.mjs          # 全量 22 脚本
node scripts/preflight-go-live.mjs --quick  # 只跑 3 个关键脚本
```

预检当前结果：**GO**（ci-check 六项 / system-audit 95 分 / 1472 项回归 / 最新生产快照迁移 29/29 / 首页 200 / 关键文件齐备）。之后按顺序执行：

```
# 1. 先后端：双端按 ops.md 定点重建 PM2（勿用裸 pm2 restart / pm2 kill）
#    18i: classintra-server + classintra-https；8i 同理，逐文件 md5 核对
#    → 迁移 046 随启动执行，新端点与 requireTreasury 生效

# 2. 确认后端已升级，再动前端（顺序反了新前端会撞旧后端 404）
#    只读查 schema_version = 46，且 GET /api/xy/admin/overview 返回 status=ok

# 3. 前端（会写 client/dist，18i 直接 serve）
node scripts/build-app.js wallet
node scripts/sync-dist-8i.mjs

# 4. 验证
curl 9001/ 200 ; GET /api/xy/admin/health → I1–I13 全绿
8i 首页 200 且 index.html md5 与 18i 对齐
```

⚠️ `client/scripts/prune-dist.js` 硬编码扫 `client/dist`、**不跟随 `--outDir`**；做隔离构建验证时它仍会回收生产 dist 的旧 chunk。

---

**结论**：「全方面全维度」落成一条每次 push 都会跑的门槛（CI → `system-audit.mjs`）；「学元顶级」则补上了最要命的一块板——**从班班管绕过组网封锁印钱的旁路**。两起真事故级缺陷、一处越权外发、一处凭据泄漏、Chrome 80 上影响 ~90 个文件的间距失效，以及桥的并发额度 TOCTOU，全部修完并有回归与门禁锁住。剩下三项 WARN 与四项高危清清楚楚列在表里，不是被藏起来的空白。

**状态更正（11-12 11:20）**：后端于凌晨 02:14 随服务重启上线（迁移 046 已执行），前端于 11:15 build 并同步双端。前几轮「线上仍是旧行为、仍有 `/api/xy/issue` 旁路」的说法**已过时**——那个旁路现在被 `requireTreasury` 挡住了。

**但「用户不爱用」是另一回事**：工程顶级不等于有人用。实测与产品改动见 §8，效果需要下一轮用数据回看。

---

## 8. 用户触达：为什么「还是不好用」（11-12 实测）

### 只读实测（生产库）

| 指标 | 数值 |
|---|---|
| 账号 / 从未登录 | 104 / **50** |
| 近 30 天有登录 | 53 |
| 聊天消息 / 社区帖 | **26,418** 条 / 290 帖（60 人） |
| 每日津贴 | 累计 **68 笔 / 25 人领过**（人均 2.7 次） |
| 真实充值 / 商品 / 订单 / AA | **2 笔 / 2 件 / 0 笔 / 0 个** |
| 学生资产 | CASH 仅 **1 人**持有；GRANT **49 人**有余额、人均 **9,823 学元** |
| 证券 | 51 账户、1,064 委托（唯一高频学元场景，但不带动钱包） |

**诊断**：不是 UI 丑，是**价值闭环断了**。学生手里有钱（赠金），但赠金按制度只能「送人」不能「买东西」，而系统没把「送人」接进学生每天待的聊天 / 社区动线；桌面首屏零学元露出、钱包默认落在空的「明细」、7 个 tab 里 5 个打开是空的、领完津贴只有自己看得见。钱躺着 → 没理由回来。

### 本轮实修（学生可感知，且**已 build 到双端**）

1. **`client/src/components/TodayXueyuanBar.vue`**（新）：桌面首屏底部一条「今天有 +X 学元可以领 · 点一下领」，领完变「已领 · 连签 N 天 · 去发红包」并引导跳聊天。只读失败显示错误态 + 重试（不伪装成没有）；未领时不可收起，已领可当天收起。Desktop.vue 只加 import / 注册 / 一行挂载。
2. **聊天「+」加「领津贴」**（`apps/chat/frontend/Chat.vue`）：贴住 2.6 万条主动线，复用 `PayPage` 结果页给足反馈，后端 daily 按天幂等不怕双击。
3. **钱包空态行动化**（`apps/wallet/frontend/Wallet.vue`）：空流水不再是「还没有流水」，改成三个能立刻点的按钮（领津贴 / 发红包 / 看学元榜）。

三处都只调**已有**的 `/api/wallet` 与 `/wallet/daily`，不依赖新增后端端点，所以不需要重启服务。

### 验证

Vue 组件语法 5/5 · 官方 build `BUILD_EXIT=0` · `client/dist` 引用 8 项 + manifest 183 项 **0 缺失** · 18i 与 8i 首页均 **200**、入口同为 `index-C8l_Nz_W.js` · `system-audit` 新增「用户触达」维度 4 项全绿（含「构建产物包含首屏钩子」，防「改源码不 build」回潮）。

### 没做 / 下一轮用数据回验

- **没做帖子打赏、装扮兑换**：前者需要新的可见性存储或跨应用支付通路，后者撞制度红线（V.21 赠金不能买东西，改需产品拍板）。`profile-skin.js` 的 5 套预设至今**零入口**，是最明显的「有处花」候选。
- **设备不是天天发**（结构性约束，产品改不动）：近 60 天只有 8 个不同登录日，任何「日活」指标都会系统性高估。
- 下一轮只回看四个数：**津贴领取人数（25 → ?）、每日领取笔数、聊天里红包/转账笔数、次日回访人数**。如果钩子有效，前两个应先动；如果不动，说明问题在更前面（设备/登录/认知），别再加功能。

---

## 9. 聊天体验专项（11-12 下午，已 build 到双端）

### 实测基线（只读生产库，纠正上一轮口径）

上一轮报的「聊天 26,418 条」不是准确口径。真实表是三套：`chat_messages`（公共频道 47）、`private_messages`（**99,911**）、`group_messages`（70）——**聊天几乎全是一对一私聊**。

| 指标 | 数值 | 含义 |
|---|---|---|
| 未读 | **61,154 / 99,911（61.2%）** | 已读回执链路有明显漏报 |
| 最热会话 TOP8 | **6 个是 `linxi_ai`**，单会话最多 4,965 条 | 学生主要在跟 AI 聊，不是跟同学 |
| 会话对 | 934 | 找人成本高 |
| 消息类型 | text 99,676 / 社区转发 118 / 棋类邀请 117 | 纯文本为主 |
| 附加能力 | 图片 5,174、引用 2,485、撤回 298、跨班中继 24,106（24%）、单字消息 3,994 | 富媒体与短消息都重 |
| `message_reactions` | **0 条** | 表情回应功能零使用 |
| `read=0` 且从未点开的机器人会话 | 大量 | 61% 里有一部分是真实未读，不能全当 bug |

### 诊断（每条都复核过源码，纠正了子代理的部分表述）

- **私聊历史根本没有分页**：`loadOlderMessages()` 只实现 public / group 两个分支，`privateHasMore` / `privateLoadingMore` 声明后从未使用；后端 `GET /chat/private/:userId?before_id=` 早就支持。4,965 条的会话只能看最近 50 条，往上翻毫无反应。
- **连打第二句被静默吞掉**：`if (!content || self.sending) return` + 发送按钮 `:disabled="sending"`。
- **AI 会话发完是死寂**：标题栏「正在输入」只由 `user_typing` 驱动，而机器人不发这个事件；长回复是纯文本，`**` 与代码块原样糊成一片。
- **已读漏报**：`sendMarkRead` 只在 `loadPrivateMessages().then()` 里跑一次，拉取失败就永不报、但 `CLEAR_UNREAD` 已先执行；`wsManager.send` 发即忘，无 ack、无回前台/重连补报。
- **零入口**：表情徽章只在已有反应时渲染，`toggleReaction` 唯一触发是点已有徽章，所以表里永远不可能有第一行。后端 `VALID_REACTIONS` 与 `message_type=private` 其实完全支持。
- **错误态红线**：五个 load action 全无 `.catch`，失败落进「暂无消息」。

### 实修（全部纯前端，零后端改动、零重启）

1. **独立内核** `apps/chat/frontend/chat-experience.js`：会话识别、发送决策/队列、机器人等待状态机（超时自熄）、已读补报 tracker、三种会话的历史分页请求构造、滚动锚定、错误态判定、置顶排序、机器人 Markdown（先 `escapeHtml` 再插自生成标签）。配套 `server/scripts-test-chat-experience.mjs` **117 项断言**，纳入 `test:chat`。**6386 行的 `Chat.vue` 只加调用点，不继续膨胀。**
2. **私聊历史分页**：补上缺失分支，顶部插入用 `scrollAnchor` 保持视口，翻到底显示「没有更早的消息了」。
3. **发送不再吞消息**：`sending` 时入 FIFO 队列、立刻上屏「排队中」、清空输入，上一条完成后自动派发；发送按钮不再被禁用。
4. **AI 会话**：本地等待气泡（收到对方消息即熄、20s 超时自灭）；带 `**` / 反引号 / 列表的回复走安全 Markdown 渲染，普通文本与图片/支付卡片仍走原渲染。
5. **已读补报**：拉取失败、重连、锁屏回前台都会强制补报；`queued` / `dropped` 标记待补报。
6. **可见错误态**：整屏错误 + 「重新加载」，联系人失败 + 「重试」，断线/降级常驻条（不只 toast）。
7. **周边体感**：平板显式换行按钮（不改 Enter 习惯）、全屏图片失败不白屏、置顶真正参与私聊排序、回到上次会话（`ci:chat:last`）。
8. **表情回应入口**：长按菜单直接给 6 个白名单表情，能加第一个了；本地临时消息先提示稍等。
9. **触摸阈值**：所有新增控件 ≥44px、CSS 不用 `flex gap`（Chrome 80）、`v-html` 内容先整体转义。

### 验证

Vue 编译校验 3/3 · `test:chat` **117/117** · 22 脚本 **1472 项 / 0 失败** · `system-audit` **97/100 · PASS 41 · 0 FAIL**（新增「聊天体验」12 项，含「构建产物包含聊天逻辑」反查）· `ci-check` 6 项全绿 · `preflight-go-live --quick` **GO** · 官方 build 退出 0 · dist html 8 项 + manifest 184 项 **0 缺失** · `sync-dist-8i.mjs` 两端入口一致 · 18i / 8i 首页 200、新 Chat chunk 8i 200 / 157,468 bytes · 8i 主 JS 与本地 **md5 完全一致**（15s 超时会误报「不可达」，量体积要放宽超时）。生产库 `schema_version=46`、私聊 99,911、未读 61,154，本轮**零写库**。

### 回看口径（别再拿数字当它不是的东西）

- **未读率不会归零**：61,154 里有相当一部分是「从未点开的机器人会话」和 AI 主动回复，那是真实未读。补报只修「看过但回执丢了」的部分，应看**同一批活跃会话的 `read=0` 占比**是否下降，而不是看总量。
- 表情回应看 `message_reactions` **是否出现第一行**、以及出现在几个不同 `user_id` 上。
- 私聊历史看「上滑加载」触发次数与 `before_id` 请求量；AI 等待看发消息→首条回复期间的可见反馈（需埋点，当前无）。

### 明确未做（按 ROI 排序，都需后端或产品配合）

1. AI 回复流式输出 / 服务端 typing：要 AstrBot 侧配合，前端只能本地占位。
2. 引用回复跳回到「未加载的历史消息」：分页已就绪，但要做「按 id 贪心加载直到命中」。
3. `currentMessages` 在 `perfLevel=low/medium` 时会截 100 / 300 条，与历史分页并存时在低端平板上会截断新翻出来的历史。
4. 搜索框只在私聊 tab；934 个会话仍靠名字搜索，没有按最近联系人/字母索引。
5. `+` 面板没有「相册/拍照」，发图要走两步云盘。
