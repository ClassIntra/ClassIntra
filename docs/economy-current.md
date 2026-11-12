# 学元系统 · 一页速查（现行制度）

> **这一页是日常唯一入口。** `economy-design.md`（2000+ 行）是决策史料与完整论证，只有改内核时才需要翻。
> 更新 2026-11-12 · 若本页与代码冲突，**以代码为准，并回来修本页**。
> 内核加固细节见 `ledger-hardening-v2.md`；应用接入见 `ecosystem-design.md`。

---

## 1. 单位链 · 只有这一条

| 量 | 值 | 说明 |
|---|---|---|
| 1 学元 | **100 账本单位**（`*_cent`） | 前端显示保留两位小数 |
| 1 人民币元 | **1000 学元** | 汇率冻结，产生过充值后永不可改 |
| ⇒ 1 人民币元 | **100000 账本单位** | `units.js` 是唯一真相源 |

- 代码里所有 `amount_cent` / `balance` / `face_cent` / `cash_on_book_cent` 都是**账本单位**，不是人民币分。
- 前端展示：账本单位 ÷ 100 = 学元；÷ 100000 = 元。**前端不允许再写魔法换算**，统一走 `units.js` 导出的函数或由后端下发。
- ⚠️ **第四次同类事故的教训**（2026-11-12 修）：管理端把「1 元 = 1000」当单位换算，`ledgerYuan` 用 /1000（金额显示放大 100 倍）、`yuanToLedger` 用 ×1000（上架标价缩小 100 倍）。两者现在都从 `unitsPerYuan()` 推导且互逆。
- 绊线：`node server/scripts/ledger-unit-audit.cjs`，退出码非 0 即拦发版。

## 2. 三种资产 · 能做什么 / 不能做什么

以 `GET /api/xueyuan/config` 的 `pools` 为**唯一文案源**，任何界面不得另写一套说法。

| 资产 | 显示名 | 能 | 不能 |
|---|---|---|---|
| `CASH` | 充值学元 | 买东西、转账、红包、跨班、投资、申请提现 | — |
| `GRANT` | 赠送学元 | 转账、红包、跨班、投资 | **买不了东西**、**不可提现** |
| `PRACTICE` | 练习金 | 证券沙盘里买卖 | 出域、转账、提现、买东西 |

一句话：**赠金是乐趣，不是购买力**。商品订单只收 CASH（`settlement.maxGrantOffsetCent()` 恒 0，I9 绊线）。
「池 / pool」是旧说法，V 章已用「账户 × 资产 × 分录」取代；接口参数仍保留 `pool` 只为兼容，**新代码不要再引入这个概念**。

## 3. 学生 · 在哪操作

| 想做 | 去哪 |
|---|---|
| 看余额 / 转账 / 红包 / AA / 投资 / 提现申请 | 钱包 `/wallet` |
| 买卖同学或官铺的商品 | 社区 → 集市 `/community?tab=market` |
| 炒股 | 学元证券（沙盘，只用练习金） |

学生端只有一条红线：**拉不到数据必须显示错误态，不能渲染成「没有」**（`Wallet.vue` / `MarketStreet.vue` / 证券均已修；管理端市集列表 2026-11-12 补齐）。

## 4. 班管 · 只看一个入口

**`管理端 → 学元` 顶部的「状态总览」卡片**（`GET /api/xy/admin/overview`）：一个状态徽标、一句人话、四个统一单位的数字、一条建议。它背后聚合了账本不变量、哈希链、日终对账、发行计数、被拒写入五套自检——班管不需要知道这些名字。

要点：**总览里的金额一律是「学元」**，不要拿它和「元」混着读。
「重新对账」按钮触发 `POST /api/xy/admin/reconcile`，差异按行落库，`/api/xy/admin/reconcile/latest` 可追历史。

排障才用的详情端点：`/api/xy/admin/proof`（链）、`/admin/reconcile/latest`（差异）、`/admin/attempts`（被拒写入）、`/admin/supply`（发行计数）、`/admin/health`（原始指标）。

## 5. 开发者 · 改钱的规矩

1. **唯一写入口**：`server/src/ledger/ledger.js` 的 `post()`。任何绕过它写 `xy_ledger_balances` 的代码都会被 I1c / I13 抓到。
2. **写操作必带幂等键**：`Idempotency-Key` 头或 `body.ref`。同 `ref` 换载荷会被拒（`IDEMPOTENCY_CONFLICT`）；无键请求会带 `X-Ledger-Idempotency: generated` 响应头，严格模式 `LEDGER_REQUIRE_IDEMPOTENCY_KEY=1` 会拒绝。
3. **失败有码**：抛 `LedgerError` 时带 `error_code`，**中文 message 不要改**（回归脚本按文案断言）。
4. **新增资产 = 加一行数据**，不是加列、不是加 `if`。
5. **迁移**：先 `grep version` 查撞号（已到 **046**），迁移只做 `ADD COLUMN` / `CREATE TABLE IF NOT EXISTS`；上线前必须跑 `node scripts/preflight-go-live.mjs`（内含副本迁移预演，会输出 GO / NO-GO）。
6. **财政权**：凡涉及发行 / 充值 / 扣减 / 退款 / 返现 / 核销的 HTTP 端点，一律挂 `require('../middleware/treasury').requireTreasury`；学生与卖家本人也能用的混合端点挂 `treasuryForAdmins`。**不许再用裸 `auth.requireAdmin`** —— 组网 `member` 角色下从班班管会借此绕过封锁直接印赠金（2026-11-12 修的旁路）。`system-audit.mjs` 的「财政权限」维度会拦回潮。

### 发版门禁（每次改学元）

```
pnpm --filter classintra-server run test:ledger      # 21 脚本 / 1448 项断言
node server/scripts-test-wallet-contract.cjs         # 契约
node server/scripts/ledger-unit-audit.cjs            # 单位口径
node server/scripts/ledger-retire-check.cjs          # 旧账本无回潮
node server/scripts/ledger-daily-reconcile.cjs       # 对账退出码 0
node scripts/build-app.js wallet && node scripts/sync-dist-8i.mjs   # 前端改动必做
```

### 常见错误码

| code | 含义 |
|---|---|
| `IDEMPOTENCY_CONFLICT` | 同一个 ref 用了不同载荷，换一个 ref |
| `UNBALANCED` | 分录按资产分组不守恒 |
| `INSUFFICIENT_BALANCE` | 余额不足 |
| `SUPPLY_CAP_EXCEEDED` | 累计发行超过 `supply_cap_cent` |
| `EXTERNAL_COST_FORBIDDEN` | 商品订单用了非 CASH 资产 / 实物商品用了不可兑付资产 |
| `VERSION_CONFLICT` | 余额版本冲突，重试即可 |

## 6. 不存在的东西（别再找了）

- **`xy_domain` 注册表 / R1–R4 双写灰度 / P5 统一积分**：v0.6 史料，V 章已用「归一化」取代，**全部撤销**。
- **`STOCK_LEDGER` 开关**：文档曾大篇幅讨论，实际无运行时消费方，**已撤销**；证券走 `src/ledger/app-api.js` 分层接口。
- **`compat.js` / `templates/redpacket.js` / `src/xueyuan2/`**：v1.7.0 收敛时已删除，不要复活。
- **旧账本三表 `xy_account` / `xy_tx` / `xy_entry`**：2026-11-11 已物理删除；`xy_recharge` 等业务凭证表保留，它们是档案不是账本。
- **包月 / 余额过期 / 沉淀确收**：设备不是天天发，V.25 明确不做。

## 7. 术语对照（防漂移）

| 用一个 | 别再用 |
|---|---|
| 资产 `CASH`/`GRANT`/`PRACTICE` | 池 `pool`、资金池（旧兼容参数除外） |
| 账本单位（`*_cent`） | 「分」「人民币分」混着叫 |
| 学元（展示） | 「元」当学元说 |
| `ledger.post()` | 直接 `UPDATE xy_ledger_balances` |
| `/api/xy/admin/overview` | 班管逐个翻五个自检端点 |

---

**改完这一页记得同步**：`CHANGELOG.md` 的 `[Unreleased]`、`.workbuddy/memory/YYYY-MM-DD.md`。
