# 学元账本 v2 加固蓝图 · 从「能用」到「可证明」

> 状态：**施工总纲（2026-11-11）** · 适用 ClassIntra 主仓 9001 / 8i 100.115.93.90
> 与 `docs/economy-design.md` 的关系：V 章是**制度与模型**（已实施上线），本文是**工程加固层**（不改任何制度口径）。
> 判定标准：新增一个域零内核改动；每一分钱都能被独立证明；任何失败都有痕迹；重放与并发不可击穿。

---

## 0. 前置事实与红线

| 项 | 实测值（2026-11-11） |
|---|---|
| 生产库 | `server/database/classintra.db`，WAL 模式，105 MB |
| 备份快照 | `backup/classintra-pre-ledger-v2-20261111.db`（41.4 MB，`VACUUM INTO` 一致性副本） |
| 存量 | 1023 笔交易 / 2046 条分录 / 135 行余额 |
| 系统 Node | `C:\Program Files\nodejs\node.exe` v24.17.0（ABI 137，所有脚本与探针必须用它） |
| 迁移号段 | 已到 `045_market_goods_v2`，本次占用 **046** |
| 门禁 | `pnpm --filter classintra-server run test:ledger`（15 脚本）+ `economy-design.md` §15.6 七步 |
| 在途工作线 | `git status` 有 25+ 未提交改动（11-10/11-11 实修）→ **只叠加、不覆盖、不提交 git** |

**三条红线**
1. `post()` 是全系统唯一余额写入口，任何改动先在临时库跑全量回归，再谈生产。
2. **余额语义零变更**：本轮不改任何一条既有分录的金额、方向、账户、资产；不改变任何现有接口的成功/失败判定（只给失败加结构化 `error_code`）。
3. 验证与部署分离：临时库逐笔比对通过 ≠ 允许上线；双端部署单独确认。

---

## 1. 「世界一流」翻译成五条可验收公理

宏大目标必须落到能跑断言的东西上，否则只是形容词。

| 公理 | 可验收判据 | 现有基础 |
|---|---|---|
| **P1 幂等不可击穿** | 同 `ref` 同 payload → 返回原交易；同 `ref` 异 payload → **拒绝**并留痕；无键请求可识别、可强制拦截 | `ledger.js:181/226` 仅唯一性去重 |
| **P2 账本可证明** | 每笔分录接入哈希链；独立校验器可重算全链；篡改任意历史分录或余额行都能被检出 | 无；`schema.sql:49` status 只有 `posted` |
| **P3 日终可自证** | 三方对平（分录聚合 / 余额物化 / 真金台账负债）逐账户逐资产，差异**落库**、有运行记录、可追历史 | I1–I10 即时自检；`ledger-reconcile.cjs` 是切换期双账工具，非日终 |
| **P4 失败可追** | 每笔被拒的写入有结构化 `error_code` + 凭证行；错误分类不靠中文正则猜 | `routes/ledger.js:21` 正则匹配 60+ 中文词分 400/500 |
| **P5 供给有硬闸** | 发行量按资产累计、O(1) 硬上限；`external_cost` 真正接进支付路径而非只当常量；套取路径有量化指标 | `assets.js:53` 有函数无调用点；`orders.js:142` 硬编码 CASH |

**不做的事**（V.13 延续）：不引入汇率、不改锚定、不改发放额度、不改订单状态机、不做包月/过期没收、不合并 Cluss 库、不把练习金变成购买力。

---

## 2. 差距清单（巡城实证）

| # | 差距 | 位置 |
|---|---|---|
| 1 | 无 `Idempotency-Key` 时自动 `genRef()`；同 ref 异 payload 不比对 | `routes/ledger.js:35`、`services/xueyuan.js:554`、`ledger.js:181` |
| 2 | 守恒在事务外算；事务内不重算余额；读改写靠 SQLite 串行，无 version 证据 | `ledger.js:184-220 / :224 / :264` |
| 3 | 无分录哈希链 / actor / 失败流水，篡改后仅靠 I1c 金额比对 | `schema.sql:47-68` |
| 4 | `reconcile.js` 缺席，`invariants.js:6` 仍写「S2 后启用」 | — |
| 5 | `canBuyExternal()` 定义了但 `orders.js:188` 硬编码全额 CASH 绕过；无 `supply_cap_cent` | `assets.js:53` |
| 6 | 已披露未决：套取循环仅留观测、Cluss 桥无回执对账、C2C `fee` 默认 0 且 pnl 未收口 | `economy-design.md:1059-1064` |
| 7 | 5 个测试脚本未入门禁；无故障注入、无跨进程并发压测、无 I1–I10 全异常注入 | `package.json:10` |
| 8 | 键复用：`cluss-bridge.js` 用 RELAY_SECRET 且 `/verify` 返回 `password_hash` | `cluss-bridge.js:46/87` |

---

## 3. 数据契约（新增表 / 列）

`schema.sql`（greenfield，测试用）与 `migrations/046_ledger_hardening_v2.js`（生产用）**必须逐字一致**。

### 新表

| 表 | 作用 |
|---|---|
| `xy_ledger_tx_seals` | 每笔上链交易一行：`tx_id / prev_hash / entry_hash / chain_hash / actor / created_at` |
| `xy_ledger_chain_state` | 单行链状态：`genesis_tx_id / head_tx_id / head_hash / updated_at` |
| `xy_ledger_post_attempts` | 被拒写入凭证：`ref / request_hash / error_code / message / actor / created_at` |
| `xy_ledger_reconcile_runs` | 日终对账运行记录：`run_key UNIQUE / ok / issue_count / summary` |
| `xy_ledger_reconcile_diffs` | 差异明细：`code / scope / key / expected / actual / delta / detail` |
| `xy_ledger_supply_state` | 每资产累计发行净额：`asset / issued_cent / version / updated_at`（O(1) 硬闸） |
| `xy_ledger_bridge_receipts` | Cluss 桥回执：`ref / tx_id / amount_cent / actor / created_at`（供对端对账） |

### 新列

| 表.列 | 说明 |
|---|---|
| `xy_ledger_transactions.request_hash` | 请求指纹；历史行为 NULL（legacy，不参与指纹比对） |
| `xy_ledger_balances.version` | 每次经 `post()` 更新 +1；绕过 post 改余额会留下版本断层 |
| `xy_ledger_assets.supply_cap_cent` | 0 = 不限（默认，保持线上行为）；>0 为累计发行净额硬顶 |
| `xy_ledger_goods.requires_external` | 有真实成本 / 实物商品置 1，订单创建时强制 `external_cost=1` 资产 |

### 历史段处理（关键）

生产库已有 1023 笔交易没有 seal。**不能要求历史凭空长出链**。迁移 046 打一条 **genesis**：
- `genesis_tx_id = MAX(xy_ledger_transactions.id)`，链头 = `sha256(genesis marker + 该时刻全库分录摘要)`；
- 历史段（≤ genesis）由既有 I1a/I1b/I1c + 期初备份快照背书，校验结果明确标注 `legacy_segment`；
- 此后每笔新交易接在链尾，`verify()` 对 `tx_id > genesis` 的段做严格逐笔重算。

---

## 4. 施工序

### R0 · 蓝图（本文档）
零代码改动。验收：五条公理都有可跑断言的落点。

### R1 · 幂等与错误语义（阶段 A）
**新增** `src/ledger/errors.js`（`LedgerError{code,httpStatus,message}`）、`src/ledger/idempotency.js`（canonical JSON + sha256 指纹）。
**改** `ledger.js`：
- 请求指纹落 `transactions.request_hash`；重放分支比对指纹，不一致抛 `LEDGER_IDEMPOTENCY_CONFLICT`；历史 NULL 行走 legacy 兼容（只去重不比对）。
- 所有 `throw new Error(...)` 换成 `LedgerError`，**message 原文一字不改**（15 个测试脚本用中文正则断言）。
- 校验阶段失败写 `post_attempts`（事务外）；事务内失败由 `routes/ledger.js` 的 `wrap()` 兜底写一份（外层事务回滚时仍能留痕）。
**改** `routes/ledger.js`：`fail()` 按 `error.code` 定状态码，删掉中文正则；`refOf` 保留生成但响应头带 `X-Ledger-Idempotency: generated`，配 `LEDGER_REQUIRE_IDEMPOTENCY_KEY=1` 可严格拒绝无键写请求（默认关，待前端全量补齐后开）。

**验收**：同 ref 异 payload 拒绝并落凭证；重放返回原 `tx_id`；所有旧错误信息逐字不变；`wallet-contract` 63/63 全绿。

### R2 · 可证明性与日终对账（阶段 B）
**新增** `src/ledger/proof.js`（`sealTx / verify / head`）、`src/ledger/reconcile.js`（`run / latest / history`）、`server/scripts/ledger-daily-reconcile.cjs`（CLI，差异退出码 1）。
**改** `ledger.js`：事务内追加 seal 与 supply_state 增量、`balances.version` 乐观锁更新。
**改** `invariants.js`：**实施时调整** —— 不把 O(n) 的链校验塞进每笔都跑的 `check()`（V.14 修正 2），而是新增独立的 `checkDeep()` 深度层（I11 链 / I12 供给账实 / I13 版本断层）；`health()` 以 `deep` 字段暴露且不拖累 `health.ok`，`last_reconcile` 一并可读。这样 20 个既有回归脚本零行为变化。
**改** `routes/ledger.js`：新增两个班管只读端点 `/admin/proof`、`/admin/reconcile`。
**改** `app.js`：60s sweeper 里按「日期 run_key」去重复跑一次日终对账（不新增定时器）。

**三方对平口径**：分录聚合 ≡ balances 物化 ≡ cashbook 负债侧（CASH，排除 clearing）；另查托管三数、supply 账实、seal 链、订单面值 vs hold。差异按 `code/scope/key` 落 `diffs`，运行记录落 `runs`。`PNL_DRIFT` 为 warn 级报表项，不进 `issues`（历史数据不全，不拦门禁）。

**验收**：故意篡改一条历史分录 / 一行余额 → `verify()` 报 `SEAL_BROKEN` 或 `VERSION_DRIFT`；人为制造余额漂移 → `run()` 落差异行且退出码 1；全绿库 `run()` 零差异。

### R3 · 事务边界与并发（阶段 C）
**改** `ledger.js`：
- 守恒与金额校验移入事务内重算一遍（防「校验与写入之间被别的进程插队」）；
- 余额更新改 `UPDATE ... WHERE version = ?` 并检查 `changes`，不匹配抛 `LEDGER_VERSION_CONFLICT`；
- 写事务改 `.immediate`（`BEGIN IMMEDIATE`，多进程下提前拿写锁，避免 `SQLITE_BUSY` 半途失败）。
**新增** `server/scripts-test-ledger-hardening.cjs`：跨进程并发（多个 Node 进程同库扣同一账户）、post 失败故障注入、I1–I13 全异常注入、哈希链篡改、对账差异注入、幂等冲突。

**验收**：改前 / 改后在同一份种子库上跑同一组业务，逐笔比对 `entries` 表完全一致（金额/方向/账户/资产/顺序）；并发扣款不超卖、无 `SQLITE_BUSY` 泄漏。

### R4 · 经济护栏与口径（阶段 D）
- `assets.js` 增加 `supplyCapCent()`，`post()` 事务内累计发行并检查硬顶（默认 0 不限）。
- `orders.js:142` 保留「商品只能 CASH」制度，另加数据驱动断言 `canBuyExternal(asset)`；`goods.create` 按 `cost_cent>0 || kind==='physical'` 回填 `requires_external`，订单创建时校验。
- `invest.js` 新增 `metrics(userId)`（累计转入 / 撤出 / 补发 / 净发行 / 套取风险分），`health()` 暴露；撤出信用上限做成**可配置且默认关闭**的开关，不擅自挡成就奖励提取。
- Cluss 桥：`/app-credit` 成功落 `bridge_receipts`，新增只读 `/app-credit/receipts` 供对端对账（**对端同步列为未完成依赖**）。
- C2C：`fee` 与 pnl 做成 `PNL_DRIFT` 报表项（warn，不改语义）。
- V.24 四项未决逐条给处置并写进 `economy-design.md`。

**验收**：`scripts-test-ledger-shop` / `invest` / `loan-v22` 全绿；制造超供给发行被拒；实物商品用 GRANT 下单被拒且错误码为 `LEDGER_EXTERNAL_COST_FORBIDDEN`。

---

## 5. 回归与门禁矩阵

| 门禁 | 命令 | 期望 |
|---|---|---|
| 新增加固测试 | `node server/scripts-test-ledger-hardening.cjs` | 全绿（系统 Node） |
| 账本聚合门禁 | `pnpm --filter classintra-server run test:ledger` | 15 脚本全绿 |
| 补齐 5 个漏网脚本 | `ledger-loan` / `loan-integrity` / `loan-v2` / `loan-v22` / `trading-sweep` | 纳入 `test:ledger` 后全绿 |
| 单位口径 | `node server/scripts/ledger-unit-audit.cjs` | 退出码 0 |
| 旧账本无回潮 | `node server/scripts/ledger-retire-check.cjs` | 退出码 0 |
| 钱包契约 | `node server/scripts-test-wallet-contract.cjs` | 63/63 |
| 不变量 | `invariants.check().ok === true` | I1–I13 全绿 |
| 日终对账 | `node server/scripts/ledger-daily-reconcile.cjs` | 退出码 0、零差异 |
| 加固验收 | `node server/scripts-test-ledger-hardening.cjs` | 99/99（系统 Node） |
| 迁移副本验证 | `node server/scripts/ledger-verify-migration-046.cjs --db <副本>` | 29/29、退出码 0 |
| 日终对账 CLI | `node server/scripts/ledger-daily-reconcile.cjs --db <副本>` | 退出码 0、零差异 |
| 逐笔等价 | 改动前后同种子库 `entries` 比对 | 100% 一致（副本上 2046 条逐字段比对） |

## 6. 部署矩阵（验证通过后单独确认）

| 步骤 | 18i（本机，生产） | 8i（100.115.93.90） |
|---|---|---|
| 1 | 备份已就位 | 先取对端快照 |
| 2 | 迁移 046 自动执行（PM2 重启触发） | 同步迁移文件后重启触发 |
| 3 | `server/src/ledger/*` + `routes/*` + `app.js` 落盘 | Syncthing / `sync-market.ps1` 等价通道逐文件 md5 核对 |
| 4 | 前端仅在新增管理端视图时 `scripts/build-app.js` + `sync-dist-8i.mjs` | 两端 `index.html` md5 对齐 |
| 5 | 定点重建 `classintra-server` / `classintra-https`（见 `ops.md`，勿用裸 `pm2 restart`） | 同左 |
| 6 | 双入口首页 200 + `/api/xy/admin/health` I1–I13 全绿 + `proof.verify().ok` | 同左 |

**回滚**：代码层按文件恢复（未提交 git，靠本次备份 + 逐文件记录）；数据层 046 只做 `ADD COLUMN` 与 `CREATE TABLE IF NOT EXISTS`，**无破坏性 DDL**，回滚只需停用新模块；资金层若发现任何分录差异，直接用 `backup/classintra-pre-ledger-v2-20261111.db` 恢复并逐人核对 CASH。

## 7. 诚实标注的边界

- **本仓可闭环**：P1–P5 的全部内核、测试、门禁、管理端只读视图。
- **需对端配合**：Cluss 侧回执拉取（本仓只提供端点）、xy-mesh 两阶段确认与补偿事务（需 8i 同步升级，本轮只做观测与补偿建议，不擅自改协议）。
- **不改的**：发放额度、订单状态机、补发目标、汇率锚定、`password_hash` 返回约定（改它要同时改 Cluss 的 `ci-bridge.js`，属另一个发版窗口）。

---

## 8. 实施结果（2026-11-11 收口）

**代码全部落地，生产库未动分毫。** 备份快照 `backup/classintra-pre-ledger-v2-20261111.db`（41.4 MB，1023 笔交易 / 2046 条分录 / 135 行余额）；所有迁移验证都在其副本 `backup/migration-046-verify.db` 上完成。

| 验收 | 结果 |
|---|---|
| 21 个脚本全量回归 | **1448 项断言 / 0 失败**（原 20 脚本 1349 项 + 新增加固 99 项） |
| 迁移 046 副本验证 | **29/29**：4 列 / 7 表齐全，分录与余额逐字段等价，账面现金 100000 分、真金负债 100000 分均未变 |
| genesis | `genesis_tx_id = 1023`，digest 覆盖全部历史分录；`proof.verify().ok = true` |
| 深度自检 | I1–I10 轻量层 + I11–I13 深度层全绿 |
| 日终对账 CLI | 退出码 0、零差异、`genesis #1023 → head #1023` |
| 并发 | 8 进程并发不同 ref 各扣 100 全部成功、无 `SQLITE_BUSY`；8 进程同 ref 仅 1 笔记账 |

**新增文件**：`errors.js` / `idempotency.js` / `proof.js` / `supply.js` / `reconcile.js`（`src/ledger/`）、`migrations/046_ledger_hardening_v2.js`、`scripts/ledger-daily-reconcile.cjs`、`scripts/ledger-verify-migration-046.cjs`、`scripts-test-ledger-hardening.cjs`、本文档。
**修改文件**：`ledger.js`（post 换心）、`schema.sql`、`invariants.js`、`service.js`、`routes/ledger.js`、`app.js`、`assets.js`、`orders.js`、`goods.js`、`invest.js`、`routes/cluss-bridge.js`、`package.json`、`scripts-test-ledger-appapi.cjs`、`economy-design.md`、`CHANGELOG.md`。

**两处口径修正（如实记录）**
1. `scripts-test-ledger-appapi.cjs` 的「成本口径恒为练习金」旧断言 29000 与 `app-api.js:102`「总成本 = 成交额 + 手续费」矛盾，已校准为 30000。这是 11-10/11-11 在途工作线的测试不同步，与本轮无关。
2. 蓝图原写「`check()` 加入 I11–I13」，实施改为「新增 `checkDeep()` 独立深度层」，理由见 R2 段。

**顺手补齐**：`test:ledger` 门禁从 15 个脚本补到 **21 个**（纳入 `ledger-loan` / `loan-integrity` / `loan-v2` / `loan-v22` / `trading-sweep` / `ledger-hardening`）。

**待办（不阻塞交付）**：① ~~双端部署需单独确认~~ → **已于 11-12 02:14 随服务重启上线**（`schema_version=46`、v2 七表齐全、genesis #1023、新端点 401 而非 404），前端 11:15 build 并同步 8i，前后端已对齐；② `LEDGER_REQUIRE_IDEMPOTENCY_KEY=1` 严格模式需先用 `X-Ledger-Idempotency` 响应头巡检一轮再开；③ Cluss 侧回执拉取、xy-mesh 两阶段确认需对端同步升级。

> 本节 §8 的「生产库未动分毫」描述的是 **2026-11-11 当晚**的施工状态（当时确实如此）；11-12 凌晨服务重启后迁移 046 已在生产执行，不要按「尚未上线」处理。
