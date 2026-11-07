# ClassIntra 价值体系设计总纲

> **状态：V 章（学元账本）已实施并上线生产（2026-11-07，见 V.15–V.24）；v0.1–v0.6 为前置讨论史料，其中与现行制度矛盾的结论以 V 章为准** · v0.6 · 2026-11-06
> **v0.2 变更（运营方方向，同日两条）**：①「后续把积分体系统一为学元体系」；②「引入可持续运营目标（自负盈亏）」。
> 因此：Cluss 从「永久只读」改为「分阶段接入统一账本」，新增统一三层模型与 P5；**同时把「可盈利」提为一等目标**——新增盈利模型（7.3.1）、外部成本护栏（2.1 / 6.3 / 9.3）、按盈利重排的执行顺序（第 11 章）与 ADR 016–017。统一是**放大器**，不是收入来源。
> **v0.3 变更**：负责人补充「后面不一定有商户进来」「目前就两个班，用的人可能没人」。实测后把 **P2 从「商店 / 商户」改为「自营零库存数字商品优先」**，实物商店降级可选；新增冷启动与规模账（7.3.2）、真实基线数据、口径纠错与 ADR 018–019。
> **v0.4 变更**：负责人补充「Cluss 是充多少用多少」。核查 Cluss 源码后确认其为**平价代收代付**：`allocated_micro`（线下收款后手工录入）− `cost_micro`（按上游真实 usage 计费）= 可用额度，售价即成本、无加价、无过期沉淀、系统内无实收现金流水 → **当前毛利恒为 0**。据此纠正 7.3.2 中「家长买 AI 额度 ~¥380/月」的口径（那是流水不是利润），新增 10.4「从流水到毛利」、ADR 020、风险项与两条未决。同时把 Cluss 定性为**全场唯一无通胀风险的域**（每分积分都有真金 + 真实成本背书），`cluss_points → cash/grant` 禁令的理由从「防凭空印钱」修正为「防双重兑付」。
> **v0.5 变更**：负责人补充「学生用的平板不是天天发，包月不划算」。这是**设备供给约束**，不是活跃度问题，因此**撤回 v0.4 推荐的「包月套餐」**（毛利来自过期没收，而学生没用完是因为没拿到设备）。新增 **G7** 与 **7.3.3**：计费 / 留存 / 限流的锚点一律用「次数 / 用量」不用「天数」，并列出受影响的六类现有机制与改法；10.4 路径表换成「不过期次数包（B′）」，毛利来源从「过期没收」改为「定价加成 + 零边际成本增值品」；ADR 021、风险项、未决 16–18 同步。同时**第三次口径纠错**：`users.last_login` 是 TEXT，v0.3 的「7 天内登录 54」是把 TEXT 与毫秒时间戳比较（SQLite 中 TEXT > INTEGER 恒真）得到的假数，真实为近 7 天 50 人、且 60 天只有 **8 个不同登录日**。
> **v0.6 主线归位（重要）**：负责人指出「不是怎么又扯到 Cluss 上了，不是在讲重建学元体系吗」。v0.3–v0.5 把「赚钱 / 冷启动 / Cluss 定价 / 设备节奏」这些**约束**当成了**主题**，甚至把 P3 内核重建排到盈利序列倒数第二，结果文档涨到 843 行而账本内核一行未动。现纠正：**本文唯一主线是重建学元体系**（把池从代码枚举变成注册表里的一行数据），判定标准只有一条 —— 新增一个域零内核改动、零迁移列。盈利、冷启动、Cluss、设备节奏全部降为**并列外围序列**，不定义模型、不阻塞重建、不得再改主线优先级。§11.0 给出两条序列与重建 R1–R4。
> **适用范围**：ClassIntra 主仓（9001）、市场应用（`market-apps/`）、联邦应用（Cluss 9003）、以及后续任意新增应用。
> **与既有文档的分工**：`docs/ecosystem-design.md` 管「应用如何接入」（SDK / UI / 生命周期 / 能力授权）；本文管「价值如何记账与结算」。两者互补，不重叠。
> **阅读约定**：**【现状】** = 代码里已经是这样；**【设计】** = 建议改成这样；**【决策】** = 已拍板，不再重复讨论。
> **本文只描述设计，不代表已实现。** 所有 `【设计】` 段落落地前必须先写迁移并在库副本上验证。
> **主线章节**：§2 第一性原理 → §3 价值域 → §4 账本原语 → §5 发行回收 → §6 跨域桥 → §8 护栏 → §9 接入契约 → §11.0 重建序列。**外围章节**：§7 人民币损益、§7.3.2 冷启动与规模、§7.3.3 设备节奏、§10 Cluss 专项（含 10.4 定价）——它们依赖重建后的模型，但不定义模型。

---

# V. 学元账本 · 从零完整设计（2026-11-06）

> **【决策 · 实施以此章为准】** 本章是 greenfield 全新设计，**取代 v0.x 的实施方案**：`xy_domain` 注册表、跨域桥、R1–R4 双写灰度、P5 统一积分序列全部撤销。头部状态行的「v0.6」是历史状态；v0.1–v0.6 全文保留为**决策史料与口径纠错记录**（尤其 7.3.2 规模基线、7.3.3 按次不按天、10.4 Cluss 平价代收），但其模型章节不再是实施依据。
> 前提：按新建系统设计，不承担旧库迁移兼容；旧 `xy_*` 表归档。
> 已确认事实：系统内**没有老师、没有家长、没有外部商户**；104 账号、真实付费 0、订单 0 张、商品 0 张；平板间歇发放；只有学生与学元。

## V.1 三条公理

| 公理 | 内容 |
|---|---|
| **A1 钱只有一种** | `CASH` = 真金，**1 元 = 1000 学元分**（沿用现网刻度，切换不需要重估任何余额），锚定**永不改变**。其余一切积分 / 赠金 / 练习金都是**权益额度**，不是钱，永不兑付。 |
| **A2 一切余额变动皆分录** | 每笔交易借贷相等、**按资产分组各自守恒**；余额是分录的物化视图，除 `ledger.post()` 外任何代码不得写余额。 |
| **A3 交付前的钱不属于平台** | 付款 = 进托管账户冻结；履约后才结算给卖家。平台只赚 `face − cost − rebate` 中的差价与 `fee`。 |

**推论**：收入不可能来自用户余额（沉淀、过期、贬值、汇兑），只能来自真实交付的毛利。「不能空手套白狼」不是口号，是 A3 + I3 的机械结果。

## V.2 三个正交维度（取代「池」）

旧系统把 `cash/grant/practice/system` 既当「钱的种类」又当「钱在谁手里」，结果 73 处 `if (pool === 'practice')` 散落在 `post/getAccount/hold/release/settleHold/creditTrade/audit/health` 九个函数里。账本彻底拆开：

| 维度 | 含义 | 取值 | 扩展方式 |
|---|---|---|---|
| **Account 账户** | 钱在谁手里 | `user / seller / platform / escrow / clearing` | `accounts` 加一行 |
| **Asset 资产** | 这是什么钱 | `CASH / GRANT / PRACTICE` | `assets` 加一行 |
| **Entry 分录** | 钱怎么动 | 借贷 ≥2 行，只增不改 | `templates/` 加一个文件 |

**余额 = `(account_id, asset)` 复合主键**。加一种资产是加一行数据而非加一列，加一个卖方是加一个账户；`ledger.js` 中**资产名判断为 0 处**。这才是 v0.6 想用 `xy_domain` 注册表解决的问题的正确解法 —— 不是注册表，是**归一化**。

```
                 CASH(可兑付)    GRANT(权益)     PRACTICE(封闭)
学生账户          可提现          可抵扣          发红包 / 证券
托管 escrow       hold            hold            禁止
平台              fee / 备付      禁止            禁止
clearing          发行对手方      发行对手方      发行对手方
```

> **设计决定**：取消 `balances.frozen` 列。冻结一律用独立的 `escrow` 账户表达（`user → escrow` 是一次真实分录），于是「冻结额」和「可用额」不再需要两套字段同步，034/035 那类冻结额漏迁移的问题从模型上消失。

## V.3 资产定义

```sql
CREATE TABLE assets (
  asset         TEXT PRIMARY KEY,
  redeemable    INTEGER NOT NULL,   -- 能否兑付真金
  transferable  INTEGER NOT NULL,   -- 能否转给他人
  external_cost INTEGER NOT NULL,   -- 能否购买有真实成本的商品
  supply        TEXT NOT NULL,      -- cash | quota | closed
  sink          TEXT NOT NULL,      -- withdraw/goods | goods_offset | games
  rate_to_cent  INTEGER NOT NULL DEFAULT 1
);
-- CASH      1 1 1 'cash'   'withdraw/goods'  1
-- GRANT     0 1 0 'quota'  'goods_offset'    1
-- PRACTICE  0 0 0 'closed' 'games'           1
```

三条硬边界：
1. `external_cost = 1` 才能买 AI 算力 / 实物 → 封死「用印出来的额度支付真实账单」。
2. `PRACTICE` 永不出现在 `orders`、`withdraw`、结算分录中（双轨红包的底层保证）。
3. `GRANT` 抵扣额 ≤ 该订单毛利（I6）；`supply = quota` 走双配额发放。

## V.4 完整 DDL

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,             -- user | seller | platform | escrow | clearing
  owner_id   INTEGER,                  -- user_id / shop_id；平台类为 NULL
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE balances (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  asset      TEXT    NOT NULL REFERENCES assets(asset),
  balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  PRIMARY KEY (account_id, asset)
);

CREATE TABLE transactions (
  id         INTEGER PRIMARY KEY,
  ref        TEXT NOT NULL UNIQUE,     -- 幂等键 = 客户端 Idempotency-Key
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL,
  initiator  INTEGER,
  payload    TEXT,                     -- JSON
  created_at TEXT NOT NULL
);

CREATE TABLE entries (
  id         INTEGER PRIMARY KEY,
  tx_id      INTEGER NOT NULL REFERENCES transactions(id),
  line_no    INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  asset      TEXT    NOT NULL REFERENCES assets(asset),
  direction  INTEGER NOT NULL,         -- +1 入 | -1 出
  amount_cent INTEGER NOT NULL CHECK (amount_cent > 0),
  created_at TEXT NOT NULL,
  UNIQUE (tx_id, line_no)
);
CREATE INDEX idx_entries_account_asset ON entries(account_id, asset);

CREATE TABLE cashbook (
  id          INTEGER PRIMARY KEY,
  tx_id       INTEGER REFERENCES transactions(id),
  type        TEXT NOT NULL,           -- recharge|refund|goods_cost|ai_cost|margin|fee
  amount_cent INTEGER NOT NULL,        -- 只记真金；正=入 负=出
  ref         TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE goods (
  id                INTEGER PRIMARY KEY,
  seller_account_id INTEGER NOT NULL REFERENCES accounts(id),
  name              TEXT NOT NULL,
  price_cent        INTEGER NOT NULL,
  cost_cent         INTEGER NOT NULL DEFAULT 0,   -- 数字品 = 0
  kind              TEXT NOT NULL,               -- digital | physical | service
  status            TEXT NOT NULL DEFAULT 'on_shelf'
);

CREATE TABLE orders (
  id                INTEGER PRIMARY KEY,
  ref               TEXT NOT NULL UNIQUE,
  buyer_account_id  INTEGER NOT NULL REFERENCES accounts(id),
  seller_account_id INTEGER NOT NULL REFERENCES accounts(id), -- 平台自营填 platform
  goods_id          INTEGER REFERENCES goods(id),
  kind              TEXT NOT NULL,               -- goods | transfer | fee
  status            TEXT NOT NULL,               -- 见 V.7
  asset             TEXT NOT NULL REFERENCES assets(asset),
  face_cent         INTEGER NOT NULL,
  cost_cent         INTEGER NOT NULL DEFAULT 0,
  rebate_cent       INTEGER NOT NULL DEFAULT 0,
  fee_cent          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  paid_at TEXT, fulfilled_at TEXT, closed_at TEXT,
  CHECK (asset <> 'PRACTICE'),
  CHECK (rebate_cent <= face_cent - cost_cent - fee_cent)
);

CREATE TABLE holds (
  id                INTEGER PRIMARY KEY,
  order_id          INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  buyer_account_id  INTEGER NOT NULL,
  seller_account_id INTEGER NOT NULL,
  asset             TEXT NOT NULL,
  amount_cent       INTEGER NOT NULL,
  state             TEXT NOT NULL      -- held | settled | released
);

CREATE TABLE order_transitions (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL,
  from_status TEXT NOT NULL,
  to_status   TEXT NOT NULL,
  tx_id       INTEGER NOT NULL REFERENCES transactions(id),
  ref         TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  UNIQUE (order_id, from_status, to_status)
);

CREATE TABLE redpackets (
  id                 INTEGER PRIMARY KEY,
  ref                TEXT NOT NULL UNIQUE,
  sender_account_id  INTEGER NOT NULL,
  asset              TEXT NOT NULL REFERENCES assets(asset),
  total_cent         INTEGER NOT NULL,
  count              INTEGER NOT NULL,
  mode               TEXT NOT NULL,   -- real | practice，UI 显式二选一
  status             TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  CHECK ((mode = 'real'     AND asset = 'CASH') OR
         (mode = 'practice' AND asset = 'PRACTICE'))
);

CREATE TABLE redpacket_claims (
  id                 INTEGER PRIMARY KEY,
  redpacket_id       INTEGER NOT NULL REFERENCES redpackets(id),
  claimer_account_id INTEGER NOT NULL,
  amount_cent        INTEGER NOT NULL,
  ref                TEXT NOT NULL UNIQUE,
  created_at         TEXT NOT NULL
);
```

`seller_account_id` 现在建好但默认指向 `platform`。等真要做同学间买卖 / 社团摊位 / 外部商户时，**只是放行一个账户类型 + 加一个上架界面，零 DDL 变更**。

## V.5 账本内核：唯一写入口

```js
// ledger.js —— 全系统唯一允许写 balances 的地方
function post(db, spec) {
  // spec = { ref, kind, initiator, payload,
  //          entries: [{ account, asset, direction, amount }] }
  return db.transaction(() => {
    const prior = findTxByRef(spec.ref);
    if (prior) return prior;                          // I5 幂等重放
    assert(spec.entries.length >= 2);

    const groups = groupBy(spec.entries, 'asset');
    for (const [asset, lines] of Object.entries(groups)) {
      assert(ASSET[asset], 'unknown asset');         // I8
      const sum = lines.reduce((s, l) => s + l.direction * l.amount, 0);
      assert(sum === 0, `asset ${asset} 不守恒`);    // I1 按资产分组
    }
    for (const l of spec.entries) {
      const next = balanceOf(l.account, l.asset) + l.direction * l.amount;
      assert(next >= 0, '余额不足');                 // I8 不允许负余额
      setBalance(l.account, l.asset, next);
    }
    const tx = insertTransaction(spec);
    insertEntries(tx.id, spec.entries);              // 只增不改
    assertInvariants(db);                            // I1–I8 交易内自检
    return tx;
  })();
}
```

**关键点**：按资产分组守恒，意味着 `GRANT` 增发再多也**不会**稀释 `CASH` 的兑付能力 —— 用户最早那句「印的钱越多，钱越不值钱」在模型层被隔离掉，而不是靠运营纪律。

## V.6 业务 = 分录模板，不改内核

| 业务 | 分录（同一资产内借贷平衡） | 附带 |
|---|---|---|
| 充值 | `CASH: clearing −x → user +x` | `cashbook +recharge` |
| 提现 / 退款 | `CASH: user −x → clearing +x` | `cashbook −refund`，T+0 |
| 发放 GRANT | `GRANT: clearing −x → user +x` | 双配额校验 |
| 发放 PRACTICE | `PRACTICE: clearing −x → user +x` | 封闭 |
| 下单支付 | `CASH: user −face → escrow +face` | 写 `holds(held)` |
| 履约结算 | `CASH: escrow −face → seller +(face−fee) + platform +fee` | `cashbook +margin/+fee` |
| 关单 / 争议退款 | `CASH: escrow −face → user +face` | `holds(released)` |
| 返现 | `CASH\|GRANT: platform −rebate → buyer +rebate` | `rebate ≤ 毛利`，默认发 GRANT |
| 真钱红包 | `CASH: sender → escrow → claimers` | `fee = 0` |
| 练习金红包 | `PRACTICE: sender → escrow → claimers` | `fee = 0`，完全隔离 |
| 购买有成本商品 | 先校验 `asset.external_cost` | `cashbook −goods_cost/ai_cost` |

新增业务 = 新增一个模板文件，`ledger.js` 一行不动。这是「完整交易体系」与「73 处 if」的分水岭。

## V.7 订单状态机

```
created ──pay──→ paid ──fulfill──→ fulfilled ──settle──→ done
   │                │                   │
 close          refund / dispute      dispute
   ↓                ↓                   ↓
closed          refunding          disputed ──裁决──→ refunded | done
                    ↓
                refunded
```

- **每次状态迁移 = 一次 `post()` + 一条 `order_transitions`，同一事务**。`UNIQUE(order_id, from_status, to_status)` 保证幂等。
- **撤回 = `paid → refunding` 的合法状态迁移**，不是「反做一笔流水」。现有撤回 bug 从模型上根治。
- 状态与资金永不脱节：处于 `paid` 而资金不在 `escrow`，会被 I4 当场拦下。
- 红包 / 纯转账订单 `fee_cent = 0`；只有商品订单可抽成。

## V.8 不变量 I1–I8

```
I1 按 asset：Σ balances == Σ entries(direction × amount)；每 tx 分组和 = 0
I2 CASH：Σ balances(CASH) == Σ cashbook(净额)        ← 可兑付敞口 = 真金
I3 备付：Σ CASH balances ≤ 现金储备                   ← health() 越线即拒绝发放
I4 托管：Σ escrow.balance == Σ holds(held) == Σ orders(paid 未 done 面值)
I5 entries 只增不改；transactions.ref 唯一；重放返回原 tx
I6 orders.asset ≠ PRACTICE；GRANT 抵扣 ≤ face − cost
I7 rebate ≤ face − cost − fee
I8 所有 balance ≥ 0；未知 asset 直接拒绝
```

三个执行点：`post()` 内断言（I1/I5/I8）、启动全量自检、日终 `orders ↔ entries ↔ cashbook` 三方对账。v0.x 的 `¥141.44` 差额在 I2 下不可能产生。

## V.9 对外接口

```
POST /api/xy/recharge                  { amount_cent }
POST /api/xy/withdraw                  { amount_cent }        T+0 无审批
GET  /api/xy/balance
POST /api/xy/orders                    { goods_id, asset, qty }
POST /api/xy/orders/:id/{pay|fulfill|settle|refund|dispute|close}
POST /api/xy/redpackets                { mode: real|practice, total_cent, count }
POST /api/xy/redpackets/:id/claim
GET  /api/xy/admin/{health|ledger|reconcile}
```

所有写接口强制 `Idempotency-Key`，直接映射 `transactions.ref`。管理端健康度同时给出 I1–I8 八项状态与现金储备覆盖率。

## V.10 模块划分

```
server/src/ledger/
  schema.sql            V.4 全部 DDL + 三行 assets 初始化
  assets.js             资产属性读取与校验（无分支硬编码）
  ledger.js             post() / balances / entries —— 唯一写入口
  invariants.js         I1–I8 断言与 health()
  cashbook.js           真金台账
  templates/
    recharge.js  grant.js  order.js  settlement.js
    refund.js    redpacket.js  rebate.js
  orders.js             状态机 + order_transitions
  settlement.js         托管 / 结算 / 争议裁决
  reconcile.js          日终三方对账
  service.js            对外门面（routes 只调它）
```

## V.11 落地顺序

| 阶段 | 内容 | 验收 |
|---|---|---|
| **S1** | `schema.sql` + `assets` + `ledger.post()` + `invariants` | I1/I2/I8 全绿；重放幂等；并发不超卖；未知资产拒绝 |
| **S2** | 订单状态机 + 托管结算 + 全部分录模板 | 全生命周期跑通；撤回 = 状态迁移；部分退 / 争议 / 重复回调不重复扣款 |
| **S3** | 商品 / 装扮兑换 / 双轨红包 / 小额入口 / 返现 | 练习金买不到任何商品；`rebate` 超限被拒；充值→买→退款余额归零 |
| **S4** | 下游对齐 `wallet` / `yuanbao` / `stock` / `admin` | 原有 wallet 178、limits 76、xueyuan 126、stock e2e 176 等全量回归 |
| **S5** | 期初导入（**只导 CASH 真金余额**，逐人核对）→ 一次切换 → 旧 `xy_*` 归档 | 新旧审计对比一致；I1–I8 在生产库全绿 |

期初规则：旧库 `¥141.44` 差额、2 笔测试充值（`¥1001` / `rate=100`）、`last_login` 之类脏数据**一律不搬**；`PRACTICE` 不可兑付，按快照重发即可；`GRANT` 按审计后的合法发放额重建。

## V.12 验收清单

- **账本**：按资产守恒、未知资产拒绝、负余额拒绝、`ref` 重放、并发扣款不超卖、分录不可变
- **订单**：created→done 全路径、关单、退款、争议裁决、撤回、重复回调、部分退
- **红包**：real / practice 双轨隔离、不可互转、不可混发、超领拒绝、练习金零外溢
- **护栏**：`external_cost` 门禁、GRANT 抵扣 ≤ 毛利、rebate ≤ 毛利、备付越线拒绝发放
- **对账**：I1–I8 全绿；日终三方对平；管理端健康度八项可读
- **回归**：`scripts-test-xueyuan` 126、limits 76、collect 34、wallet 178、practice-wall 49、stock e2e 176、ci-check 6 项

## V.13 明确不在本设计内

`xy_domain` 注册表、跨域桥、双写灰度、P5 统一积分、Cluss 收编、包月 / 余额过期 / 沉淀确收、真钱返现打款、老师 / 家长侧任何功能、二级市场与做市。这些是**另一个项目**，不得在 S1–S5 期间顺手塞进 schema。

## V.14 实现期修正（2026-11-07 00:15，写代码时发现）

设计稿进入实现后暴露 6 处问题，其中 3 处会让 S1 直接跑不通。**以下修正优先于 V.4 / V.5 / V.8 原文。**

| # | 原设计 | 问题 | 修正 |
|---|---|---|---|
| 1 | `balances.balance >= 0` 的 CHECK | **发行对手方 `clearing` 必须为负**（负值 = 已发行净额），CHECK 会让开户与发币直接失败 | 去掉 CHECK；改 `accounts.allow_negative`，在 `post()` 内按账户属性校验 |
| 2 | `post()` 内跑全量 `assertInvariants` | entries 线性增长 → 每笔交易全表扫描，写入会被拖死 | `post()` 只做 O(1) 局部断言（I1 分组守恒 / I8 负余额）；全量 `check()` 用于启动、管理端、日终 |
| 3 | `CHECK (rebate <= face − cost − fee)` | **第三方卖家时平台只赚 `fee`，`cost` 是卖家的成本**；该上限在自营/第三方两种模式下算出的数都不对 | schema 只保留 `rebate <= face` 粗校验；真实上限在 `templates/rebate` 按 `platformMargin = 自营 ? face − cost : fee` 计算 |
| 4 | `assets.rate_to_cent` | 给「改汇率」留了字段入口，正是 1:1000 冻结教训要防的东西 | **删除**。CASH 恒 1:1 由公理 A1 保证，不提供任何汇率字段 |
| 5 | `cashbook` 单列记所有真金 | `goods_cost` / `ai_cost` 是**损益侧**支出，不改变「欠用户多少」；混在一起 I2 永远对不平（卖一件成本 50 元的货，余额没变但台账少了 50） | 加 `scope('liability'\|'pnl')`；I2 只对比 `liability` 侧 |
| 6 | `holds` 上 `UNIQUE(order_id)` | 部分退款需要一单多次 hold | 改部分唯一索引 `UNIQUE(order_id) WHERE state='held'` |

补充两条实现约定：
- 表名统一 `xy_ledger_` 前缀（与旧 `xy_*` 物理隔离，便于归档与并行）。
- `accounts.owner_id` 用 **NOT NULL DEFAULT ''** 而非 NULL —— 否则 `UNIQUE(kind, owner_id)` 在系统单例上失效（SQLite 认为多个 NULL 互不相等）。

### V.14.1 S2/S3 阶段补充修正（2026-11-07 00:40）

| # | 原设计 | 问题 | 修正 |
|---|---|---|---|
| 7 | 单一 `escrow` 账户 | 订单托管与**红包托管**混在一个账户，I4（托管 vs 未结 hold）永远对不平 | `escrow` 分槽：`escrow:orders` / `escrow:packets`；`systemAccount(kind, slot)` |
| 8 | 第三方卖家记 `seller` 账户 | 学生卖家收的钱落在钱包页**看不见**的账户里（`userBalances` 只读 user 账户） | 同学卖家一律用 **user 账户**收款；`kind='seller'` 留给未来机构 / 社团店铺 |
| 9 | I2 只比 `cashbook` 的 liability 侧 | 平台付真实成本（进货 / AI）时两边金额必然不同，会误报 | I2 改为 `Σ CASH(kind≠clearing) ≡ Σ cashbook 全部`；「兑付敞口 ≤ 现金储备」独立为 I3，用 `kind IN (user,seller,escrow)` |
| 10 | `cashbook` 记 `fee` / `margin` | 抽成与毛利是**账本内转移**，没有真金进出的那一步；记进来等于重复计算 | 只保留 `recharge / refund / goods_cost / ai_cost / adjust`；毛利从 `orders` 聚合算 |
| 11 | 订单面值由调用方传 | 路由与测试各算一遍，容易算错（首版测试即因此失败） | `goods_id` 存在时，面值 / 成本 / 卖家**一律以商品为准**，服务层解析 |
| 12 | — | `better-sqlite3` 的 `stmt.run.apply()` / `stmt.all.apply()` 报 `Illegal invocation` | 一律用展开参数 `stmt.run(...args)`（与既有 `stmt.all.apply` 坑同源） |

另外两处 schema 调整：
- `order_transitions.tx_id` 允许 NULL —— `paid→fulfilled` 这类纯状态迁移没有资金动作，硬塞一笔零额交易反而污染账本。
- `redpacket_claims` 加 `UNIQUE(redpacket_id, claimer_account_id)` —— 一人一份必须在数据库层挡住，不能只靠应用判断。

### V.14.2 计量刻度对齐（2026-11-07 00:35，切 S4 前必须解决）

| # | 问题 | 说明 | 决定 |
|---|---|---|---|
| 13 | 初版设计按「1 元 = 100 分」，现网是「1 元 = 1000 学元」 | 直接切等于把每个余额除以 10 —— 属于单方面改锚定，学生视角就是违约；且 `stock` 的价格、成就门槛、手续费全按 1000 刻度建立 | **账本的整数单位 = 学元分（1 元 = 1000）**，与现网完全一致。`amount_cent` 的「cent」指最小整数单位，不指人民币分 |

推论：
- 切换**不需要任何余额重估**，`xy_account.cash_balance` 可直接作为 `xy_ledger_balances.CASH`。
- `cashbook` 与账本同单位（学元分），人民币报表统一 `/1000`；不要在两个单位之间来回换算，那是取整误差的来源。
- 前端「¥」展示、`yuanRate()` 折算逻辑全部沿用，不需要改。
- 唯一需要换的是 `scripts/ledger-opening.cjs` 的 `--rate`：同刻度下传 `1`，而不是 `10`。

### V.14.3 证券接入（2026-11-07 00:50）

证券只用练习金（`PRACTICE`），撮合与持仓仍在 `market-apps/stock`，账本只负责资金搬运。

| # | 设计点 | 决定与理由 |
|---|---|---|
| 14 | 中央对手方 | 买入结算：冻结额里「成本 + 手续费」回收进 `clearing`，差额退回买家；卖出：`clearing` 发行净额给卖家。撮合在 stock 内部完成、买卖双方不一定同时在线，用 `clearing` 做对手方是唯一不需要跨用户锁的方案 |
| 15 | 冻结按人分槽 | `escrow:trading:<学号>`，而不是共用一个 `escrow:trading`。否则 `release(uid, x)` 无法知道该退给谁，只能靠外部表记账 |
| 16 | **冻结 ref 复用必须抛错** | `post()` 的幂等短路会让「这笔冻结根本没发生」，但调用方以为成功 → 成交时托管里没钱 → 超卖。`reserve` / `release` 遇到 `duplicate` 直接抛错，不静默返回 |
| 17 | 每日津贴发 `GRANT` | 与旧 `claimDaily` 同语义（全平台可用的助学津贴），不是练习金。连续天数记在账本 `transactions.payload.streak`，与旧 `meta_json` 对齐 |
| 18 | 切换用开关 | `STOCK_LEDGER=ledger` 才把 stock 的 4 个后端文件切到 `compat.js`；默认仍走旧 `xueyuan`。原因：stock 的 176 项 e2e 直接断言 `xy_tx` / `xy_account`，默认切会让整条验收失效，且生产库尚未建 `xy_ledger_*` 表 |

`routes.js` 里另有两处直接读旧表（每日津贴的 `claimed` 与 `streak`），已按开关分支到 `xy_ledger_transactions`。

## V.15 落地记录（S1–S3 已完成）

| 文件 | 作用 |
|---|---|
| `server/src/ledger/schema.sql` | 12 张表 + 索引，全部 `IF NOT EXISTS` |
| `server/src/ledger/assets.js` | 三资产定义、`seed()`、属性查询（无分支硬编码） |
| `server/src/ledger/ledger.js` | `post()` 唯一写入口、开户、账户解析、余额读取 |
| `server/src/ledger/cashbook.js` | 真金台账，`scope` 分 liability / pnl |
| `server/src/ledger/invariants.js` | I1a/I1b/I1c/I2/I3/I4/I6/I7/I8 + `health()` |
| `server/scripts/ledger-init.cjs` | 独立建表脚本（**不进 `migrations/`**），幂等 |
| `server/scripts-test-ledger-s1.cjs` | S1 验收，47 项断言 |
| `server/src/ledger/settlement.js` | 平台毛利、托管结算、退款分录 |
| `server/src/ledger/orders.js` | 订单状态机、托管、状态迁移 |
| `server/src/ledger/goods.js` | 商品上架 / 列表 / 下架 |
| `server/src/ledger/templates/recharge.js` | 充值 / 提现（小额上限 + 真金台账） |
| `server/src/ledger/templates/grant.js` | GRANT / PRACTICE 发放（单次 + 每日双配额） |
| `server/src/ledger/templates/transfer.js` | 同学转账（同资产、不抽成） |
| `server/src/ledger/templates/redpacket.js` | 双轨红包（real / practice，等分+余数，一人一份） |
| `server/src/ledger/templates/rebate.js` | 返现（≤ 本单毛利、一单一次、默认发 GRANT） |
| `server/src/ledger/service.js` | 门面；`ensureReady()` **不自动建表** |
| `server/src/routes/ledger.js` | `/api/xy` HTTP 面（26 个端点，写接口强制幂等键） |
| `server/scripts/ledger-opening.cjs` | S5 期初导入（默认 dry-run，只导分池余额，不搬流水） |
| `server/scripts-test-ledger-s2.cjs` | S2/S3 验收，74 项断言 |
| `server/src/ledger/compat.js` | S4 过渡层：把 账本 翻译成旧 `xueyuan.js` 的 API 形状 |
| `server/scripts/ledger-reconcile.cjs` | 双账本对账（只读），差异时退出码 1，可当切换门禁 |
| `server/scripts-test-ledger-s4.cjs` | S4 兼容层验收，35 项断言 |
| `server/src/ledger/trading.js` | 证券资金原语：发行 / 冻结 / 解冻 / 买入结算 / 卖出回款 |
| `server/scripts-test-ledger-trading.cjs` | 证券资金验收，38 项断言 |
| `server/scripts-test-stock-ledger.cjs` | 证券在 `STOCK_LEDGER=ledger` 下的接入冒烟，35 项断言 |

验收结果（系统 Node 账本4 / ABI 137，全部临时库）：
- `scripts-test-ledger-s1.cjs` **47 / 47 通过**：分组守恒、跨资产混记拒绝、未知资产拒绝、`direction`/金额非法拒绝、`ref` 重放幂等（含连续 5 次）、余额不足整笔回滚（`transactions` 不落行）、发行账户可负、多分录累加、同笔对冲、I1c 抓人为改余额、I8 抓负余额、I3 备付告警、`health()` 指标。
- `scripts-test-ledger-s2.cjs` **74 / 74 通过**：商品上架、订单全生命周期（created→paid→fulfilled→done）、托管结算与毛利、退款（含撤回语义）、发起退款→确认、关单、争议→退款、GRANT 订单权益回收、第三方卖家抽成、返现上限与唯一性、双轨红包与练习金隔离、重复支付不扣款、I1–I8 全绿、三种资产全局净额为 0。
- `ledger-init.cjs` 连跑两次幂等：第二次「新增 0」，12 表 + 4 个系统账户（platform / escrow:orders / escrow:packets / clearing）不变。
- `ledger-opening.cjs`：dry-run 正确统计并报出 `balance ≠ cash+grant` 脏数据；`--apply` 写入 7 笔、重跑 0 笔（跳过重复 7），期初自检全绿。
- `src/routes/ledger.js` 可被 `app.js` 正常挂载（27 层：1 鉴权 + 26 端点），`--check` 语法通过。
- `scripts-test-ledger-s4.cjs` **35 / 35 通过**：旧字段形状（`cash_balance` / `balance = cash + grant`）、旧签名 `post({entries:[{user_id, delta, pool}]})`、`pool:'system'` 落 clearing、`transfer/recharge/withdraw`、赠金不计入可提现、`audit()` / `health()` / 流水形状、同 ref 幂等、刻度不变式（充 1000 记 1000，不是 100）。
- `ledger-reconcile.cjs`：两账一致时输出「✓ 两账一致，可以切换」并以 0 退出；人为把新库 CASH 改 +1 后，精确报出 `251801 CASH 600→601` 并以 1 退出。
- `scripts-test-ledger-trading.cjs` **38 / 38 通过**：练习金发行、冻结、买入结算（成本 + 手续费 + 差额退回）、解冻、卖出回款、账户视图旧口径、托管槽无残留、全局净额为 0、每日津贴幂等、大额发放跳过通用配额。
- `scripts-test-stock-ledger.cjs` **35 / 35 通过**：模拟 stock 在 `STOCK_LEDGER=ledger` 下的完整调用序列；练习金不可转账 / 不可提现 / 不能下订单三条边界全部拦住；冻结 `ref` 复用抛错（防超卖）。
- **旧 `market-apps/stock/test/e2e.cjs` 176 / 176 全绿**：默认账本未受影响，开关关闭时行为与改动前完全一致。

**尚未做**：S4 的最后一公里 —— 把 `wallet` / `yuanbao` / `stock` / `admin` 的路由指向 `compat.js`（需要前端 rebuild + `sync-dist-8i.mjs` + market 后端重启 + 现有 178/176 项回归）。S5 的**数据迁移已完成**，见 §V.16；路由切换未执行。

## V.16 生产库迁移与评估（2026-11-07 00:42）

### 执行记录

| 步骤 | 结果 |
|---|---|
| 迁移前快照 | `server/database/backup/classintra-20261107-004223.db`（100.8 MB，在线 backup API） |
| **命名归一** | 目录 `src/xy2` → `src/ledger`；路由 `/api/xy/v2` → `/api/xy`；表前缀 `xy2_` → `xy_ledger_`；脚本 `xy2-*.cjs` → `ledger-*.cjs`。全仓已无 `v2` / `xy2` 字样，唯一保留的是 stock 既有业务幂等键 `stock:practice:v2:<月>` —— 改它会让同月重复发练习金 |
| 建表 | 12 张 `xy_ledger_*` + 4 个系统账户，自检通过 |
| **期初导入（归位）** | 50 人 / 97 笔：CASH **¥1,001.00**、GRANT **¥49,280.63**、PRACTICE ¥63,694.44；CASH→GRANT 归位 **¥23,110.78** |
| 总额校验 | `CASH + GRANT` = **¥50,281.63**，与迁移前逐人一致（50 / 50），只有可兑付部分下降 |
| I2 | 账本现金 ¥1,001.00 ≡ 真金台账 ¥1,001.00，**平**；兑付覆盖率 100% |
| 旧表校验 | `users` 104、`xy_account` 50、三池总额与迁移前逐位相同 —— **旧表未被写入** |
| 服务存活 | `http://127.0.0.1:9001/` → HTTP 200 |
| 测试 | 47 + 74 + 35 + 38 + 35 = **229 项全绿**；`/api/xy` 27 层可挂载 |

### 关键发现：可兑付敞口只有 4.2% 有真金支撑

| 项 | 金额 |
|---|---|
| 账上可兑付敞口（`Σ cash_balance`） | **¥24,111.78** |
| 有效充值（`xy_recharge`，1 个账号 2 笔） | **¥1,001.00** |
| 覆盖率 | **4.2%** |
| 无真金支撑的缺口 | **¥23,110.78** |

缺口的来源（`xy_entry` 按 `pool='cash'` 汇总）：

| 来源 | 笔数 | 净额 | 说明 |
|---|---|---|---|
| `trade` | 174 | +¥14,143.68 | **证券交易写进充值池**，凭空造出可兑付余额 |
| `recharge` | 2 | +¥10,010.00 | 记账按 1:1000，实收按 `rate=100`（¥1,001）→ **多记 10 倍** |
| `refund` / `adjust` | 1 / 1 | +¥11,000 / −¥11,000 | 对冲，净 0，但巨款穿过 CASH 池 |
| `fee` | 84 | −¥41.90 | 手续费 |

这与 v0.2 的「累计充值 ¥100.10」、v0.4 的「Cluss ¥380 流水」是同一类错误：**账内自洽 ≠ 有真金**。`ledger-assess.cjs` 已加入该校验，不再只看 balance 一致性。

### 已执行的处置：方案 A 归位

| 方案 | 做法 | 结论 |
|---|---|---|
| **A 归位（已执行）** | 按「真实充值 × 10」截断 CASH，超出部分转 GRANT | CASH ¥1,001.00、GRANT ¥49,280.63；**每人总资产不变**，只有「可提现」下降 |
| B 补真金 | 实际收足 ¥23,110.78 | 不现实，未采用 |
| C 保持现状切 | 账上承认 ¥24,111.78 负债，学生提现时兑不出 | 不可接受，未采用 |

执行命令（已对主库运行，可重复执行且幂等）：

```bash
# 先删旧命名表，再用同一份快照重建并归位
node server/scripts/ledger-init.cjs
node server/scripts/ledger-opening.cjs --src <快照> --dst server/database/classintra.db \
  --rate 1 --apply --funded-only
```

另有 17 个账户超过 1000 元等值，其中 `251800`（CASH ¥8,706.83）来自那 2 笔测试充值，建议人工确认后单独处理。

### 待确认

1. 归位是否在管理端公示「可提现额度已按真实充值校准」—— 不公示会有学生发现余额性质变了。
2. `STOCK_LEDGER=ledger` 什么时候开 —— 一旦打开，证券只写新账本，旧表不再更新，**不存在双写**。
3. `251800` 的 CASH 归位到 ¥1,001（来自那 2 笔测试充值）。若背后有真实收款没录进 `xy_recharge`，需先补录，否则会误伤。

## V.17 体系完善：护栏修复与前端接入（2026-11-07 09:55）

### 修掉的 4 个真 bug

| # | 问题 | 影响 | 修法 |
|---|---|---|---|
| 1 | `/api/xy` 的 `amount_yuan` 按 `×100` 换算 | 前端传「元」时金额少 10 倍（学元分应是 1 元 = 1000） | 新建 `src/ledger/units.js` 作唯一真相源，`yuanToUnits()` 用 `UNITS_PER_YUAN = 1000` |
| 2 | 小额预存上限写成 `2000`，注释却说 20 元 | 实际只放开 **¥2**，学生充 ¥20 会被拒 | 改为 `20 * UNITS_PER_YUAN = 20000`；同步更新 S2 测试断言 |
| 3 | 订单接口**没有归属校验** | 任何登录用户传别人的订单 id 就能替人支付、关单、发起争议、标记履约 | `orders.detail()` 带出 `buyer_owner` / `seller_owner`；新增纯函数 `orders.assertAccess(d, actor, mode, {isAdmin})`；`GET /orders/:id`、`pay`、`close`、`dispute`、`refund-request` 限买卖双方，`fulfill` 限卖家/班管，`settle`/`refund` 仍限班管 |
| 4 | 红包详情把领取记录给所有人 | 路人拉一次 id 就能看到全班谁领了多少 | `redpacket.detail()` 只给发送者与已领取者返回 `claims`，其余返回空数组 + `claims_visible=false`，剩余金额/份数仍可见 |

另外把 `/api/xy/admin/health` 的默认备付从 `null` 改为**真金台账净额**：这样「兑付覆盖率」是真实数字，而不是永远显示「—」。

### 前端接入

- `apps/admin/frontend/Admin.vue` 学元管理 tab 新增**「新账本健康度」**只读卡片：账面现金、可兑付敞口、真金台账、兑付覆盖率、平台损益、I1–I8 异常清单；标注「学生端当前仍读旧账本」。
- 新增 `ledgerYuan()`（÷1000）与 `ledgerPct()`，与旧 `xyMoney()`（学元展示）严格分开，避免两套单位混用。
- `loadXueyuan()` 的 `Promise.all` 增加 `/xy/admin/health`，失败静默缺席，不拖垮整页。
- 已 `pnpm run build`：`client/dist/assets/Admin-DrokgB4d.js` 含新面板。

### 生效与验收

- `pm2 restart classintra-server` → pid 18060、端口 9001、`HTTP 200`；`/api/xy/balance` 与 `/api/xy/admin/health` 未登录均 `401`（鉴权生效）。
- 主库健康度：`ok=true, issues=0`，账面现金 / 可兑付敞口 / 真金台账均 ¥1,001.00，覆盖率 100%。
- 回归 **258 项全绿**：47 + 74 + 35 + 38 + 35 + 29（新增 `scripts-test-ledger-guard.cjs` 专测这 4 个 bug）。

### 本轮已推进

- `node scripts/sync-dist-8i.mjs` 已执行，8i 入口与本机一致（`assets/index-BNeUO5Cf.js`）。
- 归位公示：管理端「新账本健康度」加醒目提示，`apps/wallet/frontend/Wallet.vue` 加「新账本」只读对照卡片（可兑付 / 权益 / 练习金），并明示「余额、转账、红包、提现仍以旧账本为准」。
- 新增 `server/scripts/ledger-retire-check.cjs`：把「能不能删旧表」变成可执行门禁。

### 仍未做（有硬性前置）

`STOCK_LEDGER=ledger` 开关、钱包前端整体切 `/api/xy`、DROP 旧表。见 §V.18。

## V.18 旧账本能不能删（2026-11-07 10:10）

**结论：现在不能。** 旧账本不是 3 张表，是 **17 张**；新账本只覆盖了其中 4 类语义。

`ledger-retire-check.cjs` 实测：

| 分类 | 数量 | 说明 |
|---|---|---|
| **运行时依赖** | 12 | `wallet.js`、`xueyuan.js`、`yuanbao.js`、`pay-guard.js`、`peers.js`、stock 后端 4 个、`services/xueyuan.js` 等。删表即崩 |
| 历史迁移 | 7 | `028`–`035`，删表后保留但不得再执行 |
| 归档工具 / 测试 | 6 | `ledger-{opening,assess,reconcile}`、stock `e2e` / `practice-wall`，删表后需改造 |
| `require('services/xueyuan')` | 7 | 钱包路由、学元路由、stock 4 个 + 测试 |

17 张旧表里，新账本**没有替代**的：

`xy_collect` / `xy_collect_member`（AA 群收款）、`xy_packet*` / `xy_cross_packet`（口令红包、定向红包、跨班红包）、`xy_pay_pin` / `xy_pay_code`（支付密码、收款码）、`xy_cross_tx` / `xy_peer`（跨班支付）、`xy_withdraw`（提现审批）、`xy_user_home`（主页配置）。

对应 `/api/xy` 还缺：`collect`、`pay-pin`、`pay-code`、`cross-pay`、`leaderboard`、`withdrawals`、定向红包。所以「钱包前端直接切到 `/api/xy`」会砍掉大半功能，不能蛮干。

### 为什么 `STOCK_LEDGER=ledger` 也不能单独开

证券后端里寄生了一组「钱包镜像接口」（`/wallet`、`/wallet/daily`、`/wallet/transfer`、`/wallet/ledger`）。只切证券会造成：

1. **同一天能领两次津贴** —— 证券走 `compat.claimDaily`（写新账本），钱包 app 走旧 `claimDaily`（写旧表），两边幂等键都是 `daily:<uid>:<date>` 却在不同表里。
2. **转账分裂** —— 证券里转的钱进新账本，钱包页面读旧表，学生看不到。
3. **余额两套数** —— 证券显示的 CASH 是归位后的 ¥1,001，钱包显示的是 ¥8,706。

要开开关，必须先把证券里的钱包镜像接口下线（让证券只管练习金），或整体切钱包。**这是一件事，不是两步。**

### 退役顺序（门禁变绿才允许删）

1. 在 `/api/xy` 补齐 collect / pay-pin / pay-code / cross-pay / leaderboard / withdrawals / 定向红包。
2. 钱包前端整体从 `/wallet` + `/xueyuan/*` 切到 `/api/xy`（含证券里的镜像入口）。
3. `STOCK_LEDGER=ledger` + 重启。
4. 跑 `node server/scripts/ledger-retire-check.cjs`，**运行时依赖 = 0** 且开关已切才返回 0。
5. 备份 → `DROP TABLE` 17 张旧表 → 保留快照至少 90 天。

## V.19 分层落地与证券切换（2026-11-07 10:55）

### 分层规则

| 层 | 目录 | 账本访问方式 | 能碰的资产 |
|---|---|---|---|
| **系统应用** | `apps/*`（钱包、管理端） | 直接调 `src/ledger/*` | `CASH` / `GRANT` / `PRACTICE` 全部 |
| **第三方应用** | `market-apps/*`（证券…） | 只能调 `src/ledger/app-api.js` | **只有 `PRACTICE`** |

新增 `server/src/ledger/app-api.js`：资产名写死，不暴露 `asset` 参数；`practiceAccount()` 返回的 `cash_cent` / `grant_cent` 恒为 0，第三方即使拿到账户对象也看不到真钱。应用需在 `APPS` 白名单显式登记，未登记直接拒绝。

**为什么必须这样**：第三方应用与主进程同进程，直接 `require('services/xueyuan')` 就能拿到全套能力 —— 等于把「印钱」和「提现」的钥匙交给插件。分层不是洁癖，是把能力面收窄成它真正需要的那一小块。

### 证券改造（真正切换，不再有开关）

| 文件 | 改动 |
|---|---|
| `backend/trading.js` | 移除 `STOCK_LEDGER` 开关；`viewAccount/getAccount` → `app.practiceAccount`；`hold/release` → `app.reserve/app.release`；`settleHold` → `app.settleBuy`；`creditTrade` → `app.settleSell` |
| `backend/routes.js` | `mint` → `app.issue`；`history` → `app.history`；**钱包镜像接口全部下线**（`/wallet/daily`、`/wallet/transfer`、`/wallet/packets`、`/wallet/packet*` 一律 `410 Gone`，指向 `/wallet`）；`/wallet` 改为只读练习金视图 |
| `backend/achievements.js` `peer.js` | 成就 / 周冠军奖励改发**练习金**（第三方无权印赠金） |
| `frontend/entry.js` | 钱包弹层收窄为「练习金账户」：只显示练习金余额与流水，删除转账 / 红包 / 津贴入口，文案改为「资金管理请去学元钱包」 |

**跨账本幂等**：`app-api.issue` 与 `routes.refExistsAnywhere` 会同时看 `xy_ledger_transactions` 与旧 `xy_tx`，避免切换当月把月度补发再发一次。这是过渡补丁，旧表归档后删掉。

下线镜像接口顺带解决了 §V.18 里的「同一天领两次津贴」隐患 —— 证券不再有领津贴入口。

### 验收

`scripts-test-ledger-appapi.cjs` **26 / 26**：未登记应用拒绝、第三方看不到 CASH/GRANT、冻结/解冻/买入结算/卖出回款、`spent` 口径恒为练习金、旧账本 ref 幂等、流水字段兼容。

全量回归 **284 项全绿**：47 + 74 + 35 + 38 + 29 + 26 + 35。
服务已重启（pid 18348 / HTTP 200），`/api/stock/wallet` 与 `/api/stock/wallet/daily` 未登录均 401。

### 还未切的一侧

钱包（系统应用）仍走 `routes/wallet.js` + `services/xueyuan.js` 操作旧账本。要切它，需要把 `xueyuan.js` 的资金内核委托给 `src/ledger/*`，并改掉 `wallet.js`、`yuanbao.js`、`collect.js` 等直查旧表的部位。

退役门禁当前读数：**运行时依赖 15**（含过渡补丁 `app-api.js` 的旧表判重），`require('services/xueyuan')` 从 7 降到 **3**。门禁变绿之前不删旧表。

---

## V.20 钱包切换与旧账本退役（2026-11-07 12:45）

### 20.1 切换方式：把旧服务改成门面，而不是改调用方

`services/xueyuan.js` 原本自带一套账本（直接读写 `xy_account` / `xy_tx` / `xy_entry`）。这次**整体重写为学元账本的门面**：

```
学元钱包 / 红包 / 收款 / 支付密码 / 证券
        ↓  （调用不变的 40 个函数）
services/xueyuan.js   ← 只做语义翻译 + 业务校验
        ↓
src/ledger/ledger.js  post() 唯一写入口，按资产分组守恒
```

**为什么保留这个文件、不让调用方直接 require `ledger/*`**：

1. 对外语义是「学元」，入参出参是 `(user_id, delta, pool)` 这套旧形状，前端与第三方已按它写好。换掉等于全站改接口。
2. **配额是业务规则，不是账本规则**。单笔上限、每日发放上限、学期充值配额、账户冻结状态、提示文案，都属于「谁可以花多少」，账本只管「钱不能凭空多、不能透支」。两者职责不同。
3. `xy_recharge` / `xy_withdraw` 是**业务凭证**（谁交的现金、哪张单被谁批的），不是账本，继续留在原处。

### 20.2 切换中真正需要判断的四件事

| # | 现象 | 判断 |
|---|---|---|
| 1 | 冻结在旧模型里是 `balance` 上的一个数，新模型是「用户 → escrow」的真实分录 | 对外必须还原旧口径：`*_balance` 报**总额（含冻结）**，`available_*` 报能动的部分。否则「发红包后余额变少」会被当成扣钱 |
| 2 | `@system:mint / settle / fee` 在旧模型是「不分池的系统户」 | 按语义拆开：`mint → clearing`（允许负值=已发行净额），`settle / fee → escrow:system:*`。塞进 clearing 就只剩一个净额，面板看不出「手续费沉淀多少」「投资盘有没有超支」 |
| 3 | `creditTrade` 从发行账户退本金 | **这是错的**，等于凭空印一次钱，I2 立刻报差额。本金必须由「结算账户」支付 —— 那笔钱本来就是买入时付出去、由结算账户保管的 |
| 4 | 买入结算原为一步净额（托管 −冻结、账户 +差额、发行方 +成本） | 算术等价，但学生流水里「买入」那行会变成**正数**，看起来像赚了钱。改成两步：先整笔解冻、再真正扣款。**流水的可读性是账本的一部分** |

另外三处必须同时补齐，否则 I2 永远对不平：
- 充值 / 提现 / 撤回充值都要写 `xy_ledger_cashbook`（真金台账），只记 `liability` 侧。
- `rechargedInSemesterCent` 改从账本按 `recharge` / `recharge_revoke` 分录聚合，**不再读 `xy_recharge`**（那张表留着归位前按错 rate 记的 10 倍脏数据），并必须冲减撤回。
- `xy_ledger_*` 建表纳入 `migrations/036`（全 `IF NOT EXISTS`，主库为 no-op）。之前放独立脚本是怕半成品落主库；现在表结构稳定，缺表会让新环境直接不可用。

### 20.3 验收

```
scripts-test-xueyuan.cjs          127 / 127
scripts-test-xueyuan-limits.cjs    76 / 76
scripts-test-wallet.cjs           178 / 178
scripts-test-collect.cjs           34 / 34
scripts-test-ledger-s1/s2/s4       47 / 74 / 35
scripts-test-ledger-trading        38 / 38
scripts-test-ledger-appapi         28 / 28
scripts-test-ledger-guard          29 / 29
scripts-test-stock-ledger          35 / 35
market-apps/stock/test/e2e.cjs    169 / 169
────────────────────────────────────────────
合计                              870 项全绿
```

测试侧同步修正的三处「旧架构断言」：
- `铸币账户 = 已发行 − 已提现` → `发行账户 = −(学生余额 + 托管余额)`（旧式依赖「系统户不分池」）
- `SUM(balance) FROM xy_account` → `xy_ledger_balances`（否则删表后恒等于 0，是**假绿**）
- 证券 e2e 的「学元钱包 / 转账 / 红包」段 → 改为「练习金账户只读 + 四个镜像入口 410」（分层后的正确契约）

### 20.4 旧账本退役

判据从「17 张表全部无依赖」收窄为「**A 类三表无运行时依赖**」，因为旧表里混着两类完全不同的东西：

| 类别 | 表 | 处置 |
|---|---|---|
| **A 账本** | `xy_account` / `xy_tx` / `xy_entry` | 已停止写入 → 归档后删除 |
| **B 业务凭证** | `xy_recharge` / `xy_withdraw` / `xy_packet*` / `xy_collect*` / `xy_pay_*` / `xy_cross_*` / `xy_peer` / `xy_user_home` | **保留**。删了「谁交过钱、哪张单被谁批的」就查不到了 |

执行记录：

```
门禁    A 类运行时依赖 0，退出码 0
归档    5,474 行（xy_account 54 / xy_entry 3,620 / xy_tx 1,800）
        → backup/legacy-20261107-124110.json.gz  901.6 KB → 91.4 KB，读回校验 ✓
删表    DROP TABLE xy_account / xy_tx / xy_entry
保留    25 张表（13 张 xy_ledger_* + 4 张系统表 + 8 张业务凭证）
验收    服务 HTTP 200；audit ok=true issues=0；旧表 0 张；B 类一张未动
```

`ledger-retire-check.cjs` 现在按 A/B 两类分别报告，并且**剔除注释与历史迁移**——否则「以前这里读写 xy_account」这种说明性文字会永远把门禁卡住，最后大家只好去改注释而不是改代码。

### 20.5 切换后的口径

| 项 | 值 |
|---|---|
| 学生可花余额（CASH + GRANT） | ¥502.82 |
| 其中可兑付（CASH） | ¥10.01 |
| 练习金（封闭） | ¥636.94 |
| 真金台账 ≡ 账面现金（I2） | 一致，覆盖率 100% |
| `audit` | ok，0 issue |

---

## V.21 交易系统补全：拆池支付与真实小铺（2026-11-07 13:20）

账本切完之后，订单引擎虽然齐了，但**一条订单都没有**。原因不是缺代码，是缺三样东西：支付制度、执行入口、能看见的界面。

### 21.1 支付不能由调用方挑资产（本轮最重要的修正）

旧实现里 `orders.pay()` 直接按 `order.asset` 从单一资产扣款。这留了一个洞：只要创建订单时传 `asset='GRANT'`，零成本发行的赠金就能买走有真实成本的实物 —— 平台收不到一分真钱，却要为成本掏现金。这正是 I4 要防的「空手套白狼」。

改成**按制度算出来的拆池支付**：

| 订单 | 赠金能抵多少 | 其余 |
|---|---|---|
| 权益订单（`asset=GRANT`，仅内部补偿单） | 全额（本来就是赠金计价） | — |
| 商品订单（一律 `asset=CASH`） | **0** | 全部真金 |

> **2026-11-07 制度收紧（本节以此为准，上表的「按毛利抵扣」是初版设计）**
>
> `settlement.maxGrantOffsetCent()` 现**恒返回 0**，即商品只能用自己充值的学元买；
> 函数保留而不删，是为了让「重新打开抵扣」只能改一处、且会被不变量抓到。
> `orders.paySplitCent()` 仍按 `cap` 算明细，因为支付试算接口要展示拆池结果。
>
> 收紧的原因不是营销，是投资进出通道开通后的必然结果：练习金由平台按月补发，
> 又能 1:1 撤出成赠金。若赠金还能在小铺换到有成本的东西，就形成
> 「补发 → 撤出 → 买实物」的套取路径。所以赠金的用途被限定为
> **转账 / 红包 / AA / 跨班 / 转入证券当本金**——是社交与投资额度，不是购买力。
>
> 推论全部是机械的：
> - 平台收到的现金恒等于订单面值，**永远 ≥ 真实成本**，不会为赠金垫钱；
> - 商品订单只能 CASH，托管里不会出现 GRANT，`I2` 不会因卖货失衡；
> - 「赠金不能买东西」是结构约束，前端换接口也绕不过去。
>
> ⚠️ 代价：全班真金只有 ¥1,001，小铺的可消费购买力就只有这些。
> 若要让小铺有生意，得先决定「是否允许某个有上限、且不可来自补发的赠金子集付款」，
> 那是一次独立的制度变更，不能顺手放开。

配套的结构性禁令（`orders.create` 直接拒）：
- 有成本的商品**不能**用赠金计价；
- 赠金计价的订单**只能是平台自营**。

### 21.2 托管模型：一单两条 hold

拆池之后，一个订单可能同时压着 CASH 和 GRANT。旧唯一索引 `UNIQUE(order_id) WHERE state='held'` 让这种订单**根本插不进去** —— 制度写了，代码挡住了。

迁移 `037` 改成 `UNIQUE(order_id, asset) WHERE state='held'`：同一资产不能重复托管，不同资产可以并存。

结算/退款也相应改为**按实际托管出账**，不再按面值拍脑袋：

```
settle：逐资产 escrow → （CASH 给卖家/平台，非 CASH 回收进发行账户）
refund：逐资产 escrow → 买家（CASH 和 GRANT 各退各的）
```

### 21.3 I2 的分层对平（一个会被误判的坑）

商品一上架，I2 立刻开始误报。原因：结算把 8000 真金从托管转给平台，同时记一笔 `goods_cost −8000`（损益侧）。原来的做法是拿「台账净额」比「账面现金」，于是每卖一件有成本的货就差一笔。

正确的口径是分两层：

| 关系 | 含义 |
|---|---|
| `Σ 账面现金 ≡ Σ cashbook(liability)` | 欠用户的钱与收到的真金对平（**约束**，进 issues） |
| `平台现金 − 真实成本 = 已实现毛利` | 平台自己赚了多少（**报表**，不进 issues） |

`cashbook` 的类型约束里没有 `margin` 也是对的：平台收到货款是**账本内转移**，没有真金进出，不该写进真金台账。平台毛利由「平台账户现金 − 成本备忘」算出来即可。

### 21.4 执行入口：小铺

| 端 | 能力 |
|---|---|
| 学生（钱包 · 小铺 tab） | 看商品 → 试算（赠金抵多少/真金付多少）→ 兑换 → 我的订单 → 申请退款；无商品时显示「还没上架」，拉取失败显示错误态而不是空态 |
| 班管（管理端 · 班级小铺） | 上架商品（名称/售价/成本/类型）、下架、待处理订单（待发货/待结算/争议）一键结算或退款 |
| 对账 | 结算写 `goods_cost`；退款按实际托管原路退；`/xy/admin/health` 显示账面现金、可兑付敞口、真金台账负债、覆盖率、已实现毛利 |

订单超时自动关单：未支付的 `created` 单超过 30 分钟，拉列表时顺手关掉（无资金动作），避免列表里堆满「我好像买了」的幽灵单。

### 21.5 验收

```
新增 scripts-test-ledger-shop.cjs   54 / 54
```
覆盖：定价资产禁令（2 条）、抵扣上限 = 毛利、赠金不足自动转真金、真金不足明确拒绝且不落账、
结算后平台现金 ≥ 成本、赠金回收进发行账户、退款双资产原路退回、第三方抽成、
I4 三方对平、超时关单、重复支付幂等。

全量回归 **926 项全绿**：

```
xueyuan 127 · limits 76 · wallet 178 · collect 34
ledger s1/s2/s4 47/75/35 · trading 38 · appapi 29 · guard 29 · shop 54 · stock-ledger 35
stock e2e 169
```

### 21.6 现在的形态

交易系统已经不是「引擎空转」，而是**一条能走完的路**：

```
班管上架 → 学生看到价格与「赠金能抵多少」→ 兑换（钱进托管）
   → 班管结算（钱给卖家/平台，成本入账）或退款（原路退回）
   → 账本自检 I1–I8 全绿，管理端能看到毛利
```

仍然不做（与 V.13 一致）：库存与物流、sku/规格、优惠券、C2C 议价、真钱退款到银行卡。

---

## V.23 赠金可投资：练习金不再是只进不出的存钱罐（2026-11-07 14:40）

### 23.1 上一版的问题

V.19–V.22 把证券的钱锁在 `PRACTICE` 里：**不能转账、不能消费、不能提现**。理由是「印多少钱和消费市场购买力解耦」。

但负责人指出：**赠金本来就是给学生当零花钱的**。不许它进股市、赚了又不许拿出来，等于证券是个只进不出的存钱罐 —— 学生没有参与动机，练习金余额（全班 63.8 万）也就成了一串看得见摸不着的数字。

### 23.2 怎么改才不重演 11-05 的洗钱漏洞

不能简单「让赠金炒股」。当年出事的是**卖出回款进了 CASH 池**，于是「零成本赠金 → 买股 → 卖出 → 可提现余额」。真正的防线不是「不让赠金进股市」，而是**真钱和沙盘永远不通**。

所以开一条**投资进出通道**，只在两种不可兑付资产之间：

```
赠金 GRANT  ──investIn──▶  练习金 PRACTICE
            ◀─investOut──
```

账本的硬规则是「资产之间不能直接兑换」（每笔交易按资产分组各自守恒）。因此这里**不是转一笔，而是两笔独立交易**：

1. 作废原资产（用户 → 发行账户）
2. 等额发行目标资产（发行账户 → 用户）

两笔各自单资产守恒，账本不会出现无锚净额。`CASH` 全程不参与 —— 这一条守住，学生的真钱就永远进不了股市，股市赚的钱也永远变不出现金。

### 23.3 边界（都在代码里挡，不靠自觉）

| 边界 | 实现 |
|---|---|
| 只能动自己的钱 | 入参只有 `userId` 自身，没有收款方 |
| 挂单冻结不能撤 | `investOut` 只认 `available_practice`，冻结部分不动 |
| 单笔防手滑 | 上限 5,000,000 单位（按学元展示口径 5 万） |
| 幂等 | `ref + ':burn'` / `ref + ':issue'`，重放不重复 |
| 真钱不参与 | 只允许 `GRANT` 与 `PRACTICE`；`CASH` 分支不存在 |
| 双方余额校验 | 赠金不足 / 练习金不足分别报错，不静默部分执行 |

### 23.4 入口

证券应用 · 练习金弹层里新增「投资进出」：显示**钱包赠金**余额 + 一个金额输入框 + 「转入投资 / 撤出到钱包」。

同时把三处旧文案改掉（原来说「练习金出不去」）：
- 新手引导：「练习金不能直接转账或发红包；想花先在练习金账户里『撤出到钱包』」
- 来源说明：「每月补足到 3 万；想花先撤出到钱包」
- 规则页：「只能用来买卖股票；想发红包或买东西，先撤出到钱包」

### 23.5 代价：可花货币会变多

练习金存量（全班 63.8 万）现在**随时可撤出**变成赠金。也就是说可花货币的上限从「赠金 49.3 万」变成「赠金 + 练习金 ≈ 113 万」，约 2.3 倍。

这不是 bug，是这个功能的直接后果：学生赚到的钱能花，就必须承接它带来的购买力。小铺**目前还没有商品**，是重新定价的最好时机；一旦上架再改，就要面对「昨天 5 元今天 8 元」的解释成本。

### 23.6 验收

```
新增 scripts-test-ledger-invest.cjs   26 / 26
```

覆盖：金额守恒、两资产各自净额为 0、赠金/练习金不足分别拒绝、冻结不可撤、
同 ref 幂等、`CASH` 流水只来自充值、I1–I8 自检全绿、真金台账仍等于账面现金。

---

## V.23.1 投资进出的分层收口与补发防刷（2026-11-07 15:10）

V.23 把「赠金 ⇄ 练习金」打通了，但留了三个必须当场收口的问题。本节的修订**优先于 V.23 的实现描述**。

### 23.1.1 分层被自己破坏：第三方直连了系统钱包

V.19 定的规则是「第三方应用只能调 `src/ledger/app-api.js`」。但 V.23 的证券前端直接
`api.post('/xueyuan/invest')`，后端还 `api.get('/xueyuan/me')` 取赠金 —— 等于把系统钱包
接口当成第三方 API 用。虽然走的是 HTTP 而不是同进程 require，平台却因此**无法审计、
无法限流、无法单独收回这条通道**。

修法：能力面新增三个受限方法，证券后端加一层 `/stock/invest` 代理。

| 能力面方法 | 用途 | 边界 |
|---|---|---|
| `invest(app, uid, dir, cent, ref)` | 赠金 ⇄ 练习金 | 方向写死，不接受 `asset` / `to`，白名单校验 |
| `grantAvailable(app, uid)` | 显示「有多少可投」 | 只读一个数，不给完整钱包视图 |
| `topUpBase(app, uid, holdingCent)` | 月度补足的资产基数 | 规则由平台定，应用只提供持仓市值 |

前端不再出现任何 `/api/xueyuan/*` 调用；`/stock/wallet` 一次返回练习金三元组 +
`grant_available`。这是 `app-api.js` 里**唯一允许触碰 GRANT 的例外**，注释里写明了理由：
学生要把零花钱投进沙盘、把赚的拿回来花，但真钱 CASH 仍然完全不可见。

### 23.1.2 内核下沉，避免两套规则漂移

新增 `server/src/ledger/invest.js` 作为唯一实现，`services/xueyuan.js` 的
`investIn/investOut` 改为委托（对外 40 个导出的签名与返回结构不变）。
两笔独立交易仍是「作废原资产 + 等额发行目标资产」，但 `kind` 改为
`invest_in` / `invest_out`（已注册进 `ledger.KINDS`），这样「累计撤出额」可以直接
从分录聚合，不必另建流水表。

### 23.1.3 真正的漏洞：撤资被当成亏损，下个月又补发

证券按月「补足到 3 万练习金」，原实现只看 `可用练习金 + 持仓市值`。V.23 开通撤出后：

```
月初 3 万 → 撤出 2 万到钱包（变成可花的赠金）→ 沙盘剩 1 万
下月新 ref → 判定「亏了 2 万」→ 补发 2 万 → 再撤出 → 循环
```

平台每轮都在凭空发行赠金，且学生手里的可花货币同步增加。

修法：`topUpBase = 可用练习金 + 持仓市值 + 累计撤出`。主动拿走的钱不是亏损，
平台不补。新增 `invest.withdrawnOutCent()` 按 `kind='invest_out'` 的 GRANT 入账分录聚合，
`ref` 重放不会重复累计（幂等由 `post()` 保证）。

> ⚠️ **仍未决（需产品拍板）**：「故意亏光 → 平台补发 → 撤出」的组合仍可每轮套取，
> 因为「亏了才补」本身就是持续发行，而补发的钱现在能撤出。封死它需要给撤出加
> 「累计撤出 ≤ 初始额度 + 自有投入」的信用上限，但那会让成就奖励、周冠军奖励
> 这类平台发放也变得不可提取，影响体验。当前选择是**先封住最直白的一条路 + 留观测**，
> 不擅自改变补发目标。管理端应增加「累计撤出 / 累计补发」指标以便发现异常。

### 23.1.4 口径纠正：赠金不能买东西

V.21 表格里「零成本数字品可全额赠金兑换」是初版设计，与实现
（`settlement.maxGrantOffsetCent()` 恒 0）矛盾，V.21 已按现行制度改写。原因是
投资进出开通后练习金可 1:1 撤出成赠金，若赠金还能换实物，就形成
「补发 → 撤出 → 买实物」的套取路径。

因此赠金用途 = **转账 / 红包 / AA / 跨班 / 转入证券当本金**，不是购买力。
同步修正了钱包投资面板、证券引导、来源说明、规则页共 5 处仍写着「可以买东西」的旧文案。
代价写进 V.21：全班真金只有 ¥1,001，小铺的可消费购买力就只有这些。

**风控判断**：`/api/xueyuan/invest` 不校验支付密码与每日转出额度，这是刻意的 ——
钱始终在本人名下，没有第三方收款方，`pay-guard` 统计的是「钱离开本人」的场景。
它不是 V.22 封掉的那种旁路。

### 23.1.5 钱包（系统应用）补上同一个入口

`apps/wallet/frontend/Wallet.vue` 新增「投资」tab：显示可转出赠金 / 练习金（含冻结）、
金额输入、转入与撤出两个按钮，直接调 `/api/xueyuan/invest`（系统应用可直连）。
学生不必进证券才能搬钱。

### 23.1.6 验收与部署

```
scripts-test-ledger-invest.cjs   50 / 50（新增 17 项能力面与防刷断言）
全量后端 651 项 · wallet 178 · stock e2e 169 全绿
服务 HTTP 200；/api/stock/invest 与 /api/xueyuan/invest 未登录均 401
```

`sync-market.ps1 -App stock` 已把证券同步到 market 仓（**未提交**）。
8i 的 `market-apps/stock` 与 `server/src/ledger/*` 经自动文件同步已与本机逐字一致，
但 **8i 的服务进程仍是旧模块**：`_clearRequireCache` 只清应用目录，不清平台账本模块，
新前端调 `/stock/invest` 会拿到 404。需要在 8i 上以 `iflytek` 身份重启
`classintra-server` + `classintra-https` 双入口（部署用户的 PM2 daemon 不是同一个，别用 SSH 代劳；
见 `ops.md` §二）。本机按同一约定也应避免 `pm2 restart`，本次已核对端口 PID 与 PM2 一致、无僵尸。

---

## V.22 体系收敛：封掉旁路入口与单位口径审计（2026-11-07 14:20）

### 22.1 两套接口面 = 两套风控，其中一套一定是漏的

学元同时挂着两个 HTTP 面：

| 接口面 | 定位 | 端点 |
|---|---|---|
| `/api/xueyuan` | 学生 / 管理端业务 | 20 个 |
| `/api/xy` | 账本能力面 | 27 个 |

重叠的部分不只是「多写了几行」，而是**风控强度不同**：

| 端点 | 原来的行为 | 后果 |
|---|---|---|
| `POST /api/xy/transfer` | 直接 `svc.transfer` | 不验支付密码、不卡当日转出额度 —— `pay-guard` 形同虚设 |
| `POST /api/xy/withdraw` | 直接扣 CASH | 跳过班管审批，也跳过「只能提自己的净充值」 |
| `POST /api/xy/recharge` | 直接铸币 | 不写充值凭证、不占学期配额、绕开管理端口径 |

这三条规则在 `/api/xueyuan` 与 `/api/wallet` 里都实现得很完整，但**换一个 URL 就全部绕过**。风控的强度等于最弱那个入口。

**处置**：`/api/xy` 不再提供这三个写端，一律 `410 Gone` 并给出替代入口。它保留自己真正该干的事 —— 订单、商品、账本健康度、交易查询。学生资金动作从此只有一条路。

判据写进了测试：`scripts-test-ledger-routes.cjs` 直接取 `router.stack` 里的处理函数执行，断言三件事 —— 返回 410、消息里指向正式入口、路由表里不存在 `svc.transfer/withdraw/recharge` 直调。

### 22.2 单位口径：一个被数据证实的 100 倍分歧

审计脚本 `server/scripts/ledger-unit-audit.cjs`（只读）把两套口径并列算出来：

| 口径 | 出处 | 1 元 = |
|---|---|---|
| A | `src/ledger/units.js`、账本、订单、`/api/xy` | **1,000** 单位 |
| B | `services/xueyuan.js` 的 `yuanToCent/fromCent` 与全部限额常量 | **100,000** 单位 |

**余额站在 A，限额站在 B**，两者差 100 倍：

```
CASH 合计 1,001,000 单位
  A 口径 → ¥1,001.00   ← 与线下实收 ¥1,001 完全吻合
  B 口径 → ¥10.01      ← 与实收差 100 倍

单笔充值上限 20,000,000 单位
  A 口径 → ¥20,000（设计值 ¥200 的 100 倍）
  B 口径 → ¥200（与设计值一致）
```

这不是笔误，是**两套历史口径在同一个量上打架**：归位按 A 重算了余额，限额常量仍按 B 写。结果是「钱是真的、闸门松了 100 倍」。

**本轮不改**，因为无论改哪一边都会同时改变两个东西：学生看到的数字、以及限额的实际强度。这是产品决定，不是重构。脚本只负责把差异变成可核对的一行数字。

要收敛，必须一次改四处并重估历史余额：
1. `src/ledger/units.js`
2. `services/xueyuan` 的 `yuanToCent / fromCent / centToYuan`
3. 前端所有 `÷100` 的展示
4. 历史余额是否按倍率重估（若采用 B，CASH 需要 ×100）

### 22.3 顺带修掉的过期指标

管理端「投资盘赤字」自账本切换后恒为 0（新账本里收益只进练习金，不存在把消费池洗出赤字的路径）。换成**练习金总量**——那才是「沙盘里印了多少」的真实数字，且明确标注「封闭，不可花/不可提」。

### 22.4 验收

```
新增 scripts-test-ledger-routes.cjs   19 / 19
全量 945 项全绿
xueyuan127 · limits76 · wallet178 · collect34
ledger s1/s2/s4 47/75/35 · trading38 · appapi29 · guard29 · shop54 · routes19 · stock-ledger35
stock e2e 169
```

---

## V.24 v1.7.0 发布收敛（2026-11-07，开源稳定版准备）

本节记录对外发布（v1.7.0）前的代码收敛与文档收口。除红包面收敛外全部为**无行为变化**（注释修正 / 死代码移除），全量回归（node --test + `pnpm --filter classintra-server run test:ledger` 共 15 个脚本）全绿。

| 项 | 处置 | 说明 |
|---|---|---|
| `src/ledger/compat.js`（S4 过渡兼容层） | **删除** | 自述「切换完成后应删掉」；运行时零引用（market-apps/stock 实际走 `src/ledger/app-api`）。trading / stock-ledger 两个回归脚本改为文件内本地桩（逐函数对应原 compat 实现，断言语义与数值不变） |
| `templates/redpacket.js` + `/api/ledger` 红包 4 端点 | **删除** | 与 `services/yuanbao.js`（/api/wallet）构成红包双实现，且不走统一支付风控（payGuard）、前端零调用。红包唯一实现收敛到 yuanbao。绊线：`scripts-test-ledger-routes.cjs` 第 6 节断言路由数为 0；`scripts-test-ledger-guard.cjs` 第 ④ 节断言门面不再导出 |
| `src/xueyuan2/`（v2 规则声明稿） | **删除** | 孤立死代码，科目表与现行 `assets.js` 冲突，易误导贡献者 |
| `scripts-test-ledger-s4.cjs` | **删除** | compat 专属测试，随之退役 |
| 限额常量注释 | **修正** | `invest.js` MAX_MOVE_CENT（5,000,000 单位 = 5 万学元 = ¥50，归位前注释误写「5000 元」）、`ledger.js` MAX_TX_CENT（= 100 万学元 = ¥1000）、`templates/grant.js` 默认配额注释（= 50 学元/笔、200 学元/日）、`templates/recharge.js` 换算注释。**数值全部维持不变**，生产一直按原值运行 |
| 测试门禁 | **固化** | `pnpm --filter classintra-server run test:ledger` 聚合 15 个 scripts-test 脚本，作为发版门禁 |
| 测试假学号 | **改号** | 测试脚本内 25xxxx → 99xxxx，与真实学号段（2518xx）区分，避免开源读者误认 |

### 已知未决事项（发布时如实披露）

1. **「故意亏光 → 平台补发 → 撤出」的组合套取路径仍未封死**（V.23.1.3）：封死需给撤出加信用上限，会连带限制成就类奖励的提取；当前选择「先封最直白一条路 + 留观测」，建议管理端增加「累计撤出 / 累计补发」指标。
2. **V.16 待确认三项**：① 归位是否在管理端公示「可提现额度已按真实充值校准」；② `STOCK_LEDGER=ledger` 何时开 —— **已澄清撤销**：stock 实际走 `app-api` 分层接口，该开关无运行时消费方（仅测试脚本模拟历史调用面用）；③ 账户 251800 的 CASH 归位到 ¥1,001，若背后有真实收款未录入 `xy_recharge` 需先补录。
3. **`xy_recharge` 两条 `rate=100` 历史记录**（合计 ¥1,001）：净充值口径已改为从账本分录聚合（见 services/xueyuan.js `netRechargeCent()`），`xy_recharge` 仅作业务凭证保留，无资金影响。
4. **ledger 发放模板默认配额（50 学元/笔、200 学元/日）比班管默认（maxGrantYuan 0.5 元 / grantDailyCapYuan 2 元）更紧**：刻意从严（/api/ledger/issue 需管理员态，默认小步），是否与班管配额对齐待产品定。

---



## 0. 一句话结论

> **【主线】重建学元体系 = 把「池」从代码里的枚举，变成注册表里的一行数据。** 现有复式账本内核（整数分、ref 幂等、守恒对账、汇率冻结、四池隔离）是对的、必须保留；要换掉的是 `POOL` 硬编码与「每加一个应用改十处」的扩展方式。Cluss、赚钱、返现、双轨红包、设备节奏都只是这个模型建好之后的应用题，不是模型本身。

> **【v0.2 并列约束】运营方补充：「引入可持续运营目标（自负盈亏）」。** 这是与重建**并列**的约束，不是主线优先级：盈利依赖重建后的可计价、可结算模型，但**不定义模型**。收入口径见 7.3.1。v0.3–v0.5 曾据此把 P3 排到盈利之后，**v0.6 已纠正**。

> **【v0.3 现实约束】负责人补充：「后面不一定有商户进来」「目前就两个班，用的人可能没人」。** 主库实测：104 个账号、近 7 天登录 50 人（**60 天仅 8 个登录日**，平板不是天天发）、50 人从未登录、**真实付费用户 0**、商品 / 商店 / VIP 表 0 张。因此 **当前瓶颈不是架构不完整，而是没人用、没人付钱**。7.3.2 给出冷启动与规模天花板；P2 不再依赖商户。

现有账本内核（复式记账、整数分、ref 幂等、守恒对账、汇率冻结、四池隔离）是对的，**必须保留**。

问题不在记账，而在于**「池」被写成了代码里的枚举**。于是每来一个新应用（Cluss，以及后面的每一个）都要改内核、加迁移、补测试、再向用户解释一遍「这个钱能不能花、能不能转、能不能提」。

本设计把「池」升级为**价值域（Value Domain）**：域是注册表里的一行数据，不是 `switch` 里的一个分支。应用接入时声明自己的域，平台统一提供账本原语、守恒校验、报表口径和兑换闸门。

**负责人已定方向：后续把全平台积分体系统一为学元体系。** 「统一」的准确含义是 **一本账、一套科目、一个身份**，而**不是合并成一个可自由兑换的池子**——否则前几轮刚解决的「印钱让钱变毛」，和 Cluss 背后真实 LLM API 成本，会同时穿帮。Cluss 因此从「永久只读」改为「分阶段接入统一账本」（第 10 章、P5）。

**统一必须排在 P3（域注册表）之后**：先把「池」变成注册表里的一行数据，并应用时才不用改内核。这才是「后面还有 cluss 呢」的正解——**统一的目标不是把 Cluss 并进来，而是让并第十个应用时依然零内核改动**。

---

## 1. 现状审计

### 1.1 已经做对、必须保留的

| 机制 | 位置 | 为什么不能丢 |
|---|---|---|
| 复式记账，每笔 `SUM(delta)=0` | `server/src/services/xueyuan.js` `post()` | 任何「只加不减」都是发币，必须显式走 `mint()` 且对手方是 `@system:mint` |
| 金额一律整数分 | 同上，`toCent/yuanToCent` | 浮点会让账目漂移 |
| `ref` 幂等 | `post()` | 防重复点击 / 跨班重试重复入账 |
| 汇率冻结 | `config.xueyuan.yuanRate = 1000` | 一旦产生充值，改比率等于单方面重估负债（升则违约、降则凭空多欠） |
| 四池隔离 | 迁移 030 / 034 / 035 | 把「印的钱」和「真钱」从记账层分开，是过去一周最重要的修复 |
| 按池守恒的 `audit()` | `xueyuan.js` `audit()` | 能抓出 `pool_drift` / `circulation_leak` |
| 单笔 + 累计双配额 | `MAX_GRANT_CENT` / `GRANT_DAILY_CAP_CENT` / `RECHARGE_QUOTA_CENT` | 只挡单笔会被「拆成二十笔」绕过 |
| 撤回 / 退款禁止系统垫付 | `revokeRecharge()` / `refund()` | 从源头堵死「凭空印钱做退款」 |

### 1.2 五个结构性问题

**P1 · 池是硬编码枚举。** `POOL`、`normalizePool()`、`post()` 的 `isPractice` 特判、`hold(mode)`、`release(o.pool)`、`settleHold()`、`creditTrade()`、`poolLabel()`、`audit()` 三池校验、`health()` 聚合……粗算十处以上分支。加第五个域要同步改十处、加一列、写迁移、补测试，且每处漏改都是一个静默的账目错误。**这是「后面还有 cluss」真正的阻塞点。**

**P2 · 只有发行，没有回收。** `apps/` 18 个应用、`market-apps/` 4 个应用，**没有任何商店 / 订单应用**。防「用印的钱买实物亏本」的 `splitPayOrder()`（赠送抵扣上限 = 毛利率）已实现、76 项护栏测试通过，但**全仓零调用**，只在 `scripts-test-xueyuan-limits.cjs` 里被测试。链路断在「学元 → 消费」：既没有回笼（钱变毛），老师也没有毛利（赚不到钱）。

**P3 · 学元账不等于人民币账。** 系统里**没有任何一张人民币现金台账**：`xy_recharge.method` 只是自由文本，`memo` 手填，实收、进货成本、返现支出从未被结构化记录。后果见 1.3 的数字。

**P4 · 社交被误隔离。** 四池隔离时把 `practice` 连「转账 / 红包」一起关死了。**【决策】要隔离的是购买力，不是社交**——允许「发红包时选池」与「打通池子」是两回事，只要池标签跟着红包走，域内零和流转不泄露任何购买力。

**P5 · 跨系统价值域没有统一描述。** `xueyuan.js:3-4` 用一句注释划界：「与 Cluss 的积分体系完全独立：不共享表、不共享接口、不互相兑换」。这句话本身是对的，但它是**一句注释**，不是模型。Cluss 的积分/额度既不进管理端报表，也不进健康度，将来第三个系统出现时还得再写一句注释。

> **【v0.2】** 负责人已定「积分体系统一为学元体系」。方向不是抹掉这句注释，而是把它升级成 `xy_domain` 里的一行数据 + 兑换矩阵里一条明确的禁令——**注释会过期，注册表和矩阵不会**。

### 1.3 真实数据快照（2026-11-06 主库，1 元 = 1000 学元 = 100000 分）

| 项目 | 金额 | 说明 |
|---|---:|---|
| 学生可花余额 | ¥502.62 | `cash ¥241.12` + `grant ¥261.50` |
| 练习金（封闭） | ¥606.94 | 独立池，不进 `balance` |
| 线下真实累计充值 | **¥100.10** | 仅 2 笔 |
| 累计提现 / 撤回充值 | ¥0.00 / ¥0.00 | 待审批提现 0 笔 |
| 累计发行 | welcome ¥184.00 · daily ¥11.77 · admin_grant ¥0 · reward ¥1368.04 | reward 含历史练习金 |
| 手续费沉淀 | ¥1.89 | `@system:fee` |
| 系统账户 | `@system:mint −¥1663.91` · `@system:settle +¥552.45` | 负债镜像 / 投资盘托管 |

**最值得记住的一个对不上**：面板把 `cash` 池标为「充值学元（可提现）」显示 ¥241.12，但线下真钱只收过 ¥100.10。差额 **¥141.44 来自 `trade` 的 174 腿**（按月统计 100% 落在 2026-11 分池改造之前）：旧 `creditTrade()` 卖出时本金一律回 cash 池，形成「印的钱买股 → 卖出 → 变充值学元 → 可提现」的洗白链。学生实际一分提不走（`withdrawableCent` 被累计净充值卡死），**界面在撒谎**。

这不是某处代码写错，而是**池子连通时账本无法回答「这笔钱本来是什么」**。它同时是 P1、P3 和「必须池级隔离」的实证。

### 1.4 设计目标与非目标

**目标**
- G1 新应用接入价值体系时，**不改账本内核、不加迁移列**（只增数据行）。
- G2 老师能在一张表里看清人民币口径的收入、成本、返现、净利与兑付敞口。
- G3 每个域的发行、流通、回收闭环可审计，通胀风险可量化。
- G4 「印的钱」永不变成「能提现的钱」，除非走显式、封顶、有预算的兑换闸门。
- G5 学生之间的赠送/红包等社交行为不被误伤。
- **G6（v0.2）体系必须能产生可计量、可持续的人民币毛利**，且不以增发点数、也不以占用学生预收款为代价；每一笔返现都能追到已实现毛利。
- **G7（v0.5）计费、留存、限流的锚点用「次数 / 用量」，不用「天数 / 日历周期」**。学生平板不是天天发（实测近 60 天仅 8 个登录日），按时间收费等于让学生为拿不到设备的日子付钱。见 7.3.3。

**非目标**（明确不做，避免范围膨胀）
- 不接真实在线支付（充值继续走线下录入 `method`）。
- 不合并 Cluss 的进程与 `cluss.db`，不把 Cluss 用户表物理搬进本仓（**但统一账本与身份映射**，见 10.3）。
- 不做跨校、跨班结算（现有 `cross-pay` 保持原样）。
- 不上区块链、不引入多币种自由兑换市场。

---

## 2. 第一性原理：一切点数都是负债

### 2.1 三元定义

发给学生任何一个数字，都等价于平台承诺「未来可以拿它换某样东西」。因此每个点数系统由三个属性唯一确定：

| 属性 | 记号 | 含义 |
|---|---|---|
| 计量单位 | `U` | 学元分 / 积分 / 次数 / 字节 |
| 兑付物 | `R` | 现金、班内实物与服务、虚拟股票、AI 算力、纯荣誉 |
| 供给来源 | `B` | 真钱充值、教师铸币、算法补足、外部采购额度 |

**关键：`R` 和 `B` 一旦确定，这个域的经济性质就是推出来的，不需要每个应用拍脑袋。**

> **【v0.2】盈利视角的推论**：矩阵里「外部采购额度 × 真实外部服务」是**唯一每交付一次就产生真实现金流出**的格子。它同时意味着两件事：① 这是最天然的毛利来源——可定价、有成本差；② 也是最危险的亏损敞口——用可增发域去购买，等于平台替学生付账单。见 6.3 与 7.3.1。

| B \ R | 现金 | 实物 / 服务 | 虚拟标的 | 真实外部服务 |
|---|---|---|---|---|
| **真钱充值** | 刚性负债，1:1 兑付，**绝不可增发** | 预收款，交付后转收入 | 不推荐（真钱不该进沙盘） | 预付，按成本扣减 |
| **教师铸币** | ❌ 禁止（等于凭空欠现金） | 软负债，受物资约束，**增发即通胀** | ❌ 禁止（会洗身份） | ❌ 禁止 |
| **算法补足** | ❌ 禁止 | ❌ 禁止 | 零兑付成本，**可无限供给但必须封闭** | ❌ 禁止 |
| **外部采购额度** | ❌ 禁止 | 按成本折算 | ❌ 禁止 | **有真实边际成本，多发 = 真亏钱** |

由表直接得到三条判据：

1. **隔离的判据是供给约束不同，不是「买的东西不同」。** 练习金买虚拟股票、实际学元买实物，这是**结果**；根因是前者可无限印、后者不能。一个无限供给池与一个有限供给池连通，永远是无限那边稀释有限那边。
2. **要挡的是购买力外泄，不是社交流转。** 域内 A→B 的零和转移不改变任何总量，也不改变兑付义务。
3. **池级隔离 > 商品级限制。** 只规定「练习金不能买实物」挡不住转账 / 红包 / AA 换手——零和转移不产生新钱，却能把钱的身份洗掉。`splitPayOrder()` 是商品级思路（防实物亏本），防不住换手。

### 2.2 四条不变式（后续所有设计的公理）

- **I1 单域闭合**：每笔交易只在**一个**域内借贷平衡，不跨域混记。
- **I2 分域守恒**：每个域独立满足 `SUM(该域所有账户余额) = 0`（含系统负债方）。
- **I3 显式桥**：任何跨域价值移动必须走登记的桥，双边记账，且 `mint` 侧必须有 `B` 背书。
- **I4 两账分离**：人民币现金账与点数额度账永不混记；前者是损益，后者是负债。

> 【现状】`audit()` 用 `SUM(balance + practice_balance) = 0` 把两域合并成一个等式，是四池改造时的权宜写法。【设计】改为按域循环分别校验，才能满足 I2。

---

## 3. 核心模型：价值域（Value Domain）

### 3.1 字段规范【设计】

```
xy_domain
  id                  TEXT PK      -- 'cash' | 'grant' | 'practice' | 'cluss_points' | ...
  label               TEXT         -- 展示名
  unit                TEXT         -- 'xueyuan_cent' | 'point' | 'byte'
  unit_rate           INTEGER      -- 每人民币元对应多少最小单位；仅展示换算用
  backing             TEXT         -- 'cash' | 'mint' | 'topup' | 'procured'
  redemption          TEXT         -- 'cash' | 'goods' | 'virtual' | 'service' | 'honor'
  owner_app           TEXT         -- 发起应用；平台内置域为 '@platform'
  balance_field       TEXT         -- 落到 xy_account 的哪一组列（或独立表）
  affects_balance     INTEGER      -- 是否计入钱包首页「可花余额」
  frozen_field        TEXT         -- 冻结额列名
  transferable        INTEGER      -- 域内可否转给同学 / 发红包
  spendable           INTEGER      -- 可否用于消费（走 splitPayOrder）
  withdrawable        INTEGER      -- 可否提现（只能 backing=cash 且受净充值约束）
  supply_mode         TEXT         -- 'fixed' | 'mint' | 'topup'
  supply_cap_cent     INTEGER      -- 周期发放上限
  supply_period       TEXT         -- 'day' | 'month' | 'semester' | null
  sink                TEXT         -- JSON 数组，至少一个；见 5.1
  visible_in_wallet   INTEGER
  status              TEXT         -- 'active' | 'readonly' | 'retired'
  created_at          INTEGER
```

**`sink` 非空是注册门槛**：任何域在 `status='active'` 前必须声明至少一个回收出口，否则只发不收，必然沉淀成「钱多货少」。这是 P2 的制度化修复。

### 3.2 现有与已知域的登记

| id | backing | redemption | 可转 | 可花 | 可提现 | 供给 | sink |
|---|---|---|---|---|---|---|---|
| `cash` | cash | cash + goods | ✅ | ✅ | ✅（≤ 累计净充值） | fixed（线下录入） | 消费、提现、撤回充值 |
| `grant` | mint | goods | ✅ | ✅ | ❌ | mint（双配额） | 消费（抵扣 ≤ 毛利率）、手续费、教师扣减 |
| `practice` | topup | virtual | ✅【设计，见 5.2】 | ❌ | ❌ | topup（每月补足 3 万学元） | 证券手续费、域内红包、沙盘清算 |
| `@system:*` | — | — | ❌ | ❌ | ❌ | 对手方 | 负债镜像，不单独守恒 |
| `cluss_points` | procured | service（AI 算力） | ❌ | ❌ | ❌ | fixed（班管 `quota_yuan` / `weekly_yuan`） | AI 调用 `cost_points`、复习不扣、熔断不扣 |

> `cluss_points` **当前**只读登记、**目标**接入统一账本（负责人方向）。接入后它仍是学元体系里的一个**独立域**：单位换算成学元分、走同一套 `xy_balance` / `xy_entry`，但 `redemption` 恒为 `service(AI 算力)`，**不得流入 goods / cash**。详见第 10 章。

### 3.3 域是数据，不是代码分支（P1 的解法）

| 现在【现状】 | 改造后【设计】 |
|---|---|
| `var POOL = {CASH,GRANT,PRACTICE,SYSTEM}` 硬编码 | `xy_domain` 表 + 进程内只读缓存（启动时加载，变更走管理端并写审计） |
| `normalizePool()` 里逐个 `if` | `registry.validate(id)`：查表 + 校验 `status` |
| `post()` 里 `isPractice` 特判决定动不动 `balance` | 读 `domain.affects_balance` / `domain.balance_field`，代码不再认识具体域名 |
| `hold(mode)` / `release(o.pool)` 三分支 | 按 `domain.frozen_field` 泛型加减 |
| `creditTrade()` 写死「收益进 practice」 | 读 `owner_app` 声明的收益域 |
| `audit()` 拼 `cash + grant` 两列 | 遍历 `xy_domain WHERE status='active'`，逐域守恒 |
| `health()` 手写 `SUM(practice_balance)` | 按域聚合，自动带出新域 |

**验收标准**：新增一个域 = `INSERT INTO xy_domain ...` 一行数据 + 应用侧声明，**零内核改动、零迁移列、零 `if`**。

### 3.4 可兑换性矩阵【决策】

| 从 \ 到 | cash | grant | practice | cluss_points |
|---|---|---|---|---|
| **cash** | ✅ 域内 | ⚠️ 仅消费时按比例混合，不主动转换 | ❌ 真钱不进沙盘 | ✅ **主推**：买 AI 额度，按成本价 + 桥（见 6.3） |
| **grant** | ❌ 禁止（洗成可提现） | ✅ 域内 | ❌ 禁止 | ⚠️ 原则禁止：AI 有真实边际成本，例外须绑定已实现毛利 |
| **practice** | ❌ 默认禁止 | ⚠️ 单向封顶桥（见 6.3） | ✅ 域内（含红包） | ❌ 禁止 |
| **cluss_points** | ❌ 禁止 | ❌ 禁止 | ❌ 禁止 | ✅ 域内消耗（统一后仍是独立域，不得流向 goods / cash） |

> 「消费时按比例混合」不是跨域转换：一笔订单拆成 `cash` 腿和 `grant` 腿，各自在自己域内闭合，符合 I1。这正是现有 `splitPayOrder()` 的做法。

> **【v0.2】统一后矩阵不新增勾**：Cluss 积分并入学元体系 = `xy_balance` 里多一行 `(user, cluss_points)`，**不是多一条可兑换路径**。若将来要开 `cluss_points → grant`，那是 P4 的桥决策，与统一本身无关，且默认仍关闭。

---

## 4. 账本内核（统一原语）

### 4.1 复式记账与按域守恒

每笔业务写一条 `xy_tx` + ≥2 条 `xy_entry`，**所有分录必须同属一个 `domain_id`**，且 `SUM(delta)=0`。系统负债方（`@system:mint` / `@system:settle` / `@system:fee`）按域分别设置，不复用同一个账户。

`kind` 是**业务语义**（recharge / transfer / refund / trade / profit / fee / …），`domain` 是**资金归属**，两者正交。`KINDS` 白名单继续保留，防止第三方随手发明类型把统计口径搞乱。

### 4.2 冻结与解冻

冻结额是「已占用但未结算」的余额，必须与域一一对应：

```
frozen_total = Σ frozen[domain]      （仅对 affects_balance=1 的域）
available[domain] = balance[domain] - frozen[domain]
```

> 【现状教训】练习金冻结单列 `frozen_practice`，**不并入 `frozen`**，否则 `available = balance - frozen` 会算出负数。迁移 035 踩过这个坑。

### 4.3 表结构草案【设计】

```sql
-- 域注册表：新增应用只写这里
CREATE TABLE xy_domain (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, unit TEXT NOT NULL,
  unit_rate INTEGER NOT NULL DEFAULT 100000,
  backing TEXT NOT NULL, redemption TEXT NOT NULL,
  owner_app TEXT NOT NULL DEFAULT '@platform',
  balance_field TEXT, frozen_field TEXT, affects_balance INTEGER NOT NULL DEFAULT 0,
  transferable INTEGER NOT NULL DEFAULT 0, spendable INTEGER NOT NULL DEFAULT 0,
  withdrawable INTEGER NOT NULL DEFAULT 0,
  supply_mode TEXT NOT NULL, supply_cap_cent INTEGER, supply_period TEXT,
  sink TEXT NOT NULL, visible_in_wallet INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL
);

-- 余额按 (用户, 域) 存，取代不断加列
CREATE TABLE xy_balance (
  user_id TEXT NOT NULL, domain_id TEXT NOT NULL,
  balance_cent INTEGER NOT NULL DEFAULT 0,
  frozen_cent INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, domain_id)
);

-- 交易与分录（沿用现有 xy_tx / xy_entry，仅加 domain_id）
ALTER TABLE xy_entry ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'grant';

-- 跨域桥：默认不存在任何行 = 默认全关闭
CREATE TABLE xy_bridge (
  id TEXT PRIMARY KEY, from_domain TEXT NOT NULL, to_domain TEXT NOT NULL,
  rate_num INTEGER NOT NULL, rate_den INTEGER NOT NULL,
  cap_cent INTEGER NOT NULL, period TEXT NOT NULL,
  budget_source TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);

-- 人民币现金台账：唯一以元计价的账（见第 7 章）
CREATE TABLE xy_cashbook (
  id INTEGER PRIMARY KEY, direction TEXT NOT NULL,   -- 'in' | 'out'
  category TEXT NOT NULL,                           -- recharge / goods_cost / cashback / withdraw / ai_cost
  amount_yuan_cent INTEGER NOT NULL,                -- 人民币分
  ref TEXT UNIQUE, related_tx_id INTEGER,
  counterparty TEXT, memo TEXT, operator TEXT NOT NULL, created_at INTEGER NOT NULL
);
```

### 4.4 与现有实现的映射（渐进，不推倒重来）

`xy_account` 的 `cash_balance / grant_balance / practice_balance` 三列**不删除**：作为 `xy_balance` 的物化视图保留，双写一段时间，由 `audit()` 交叉校验；等所有调用点迁移完再退役。这样 P2 阶段可以在不停机的情况下灰度。

---

## 5. 发行、流通与回收

### 5.1 注册门槛：每个域必须有 sink

| 域 | 当前 sink | 是否够 |
|---|---|---|
| cash | 提现、撤回充值、消费 | 够，但消费出口**尚未建成** |
| grant | 教师扣减、手续费、消费 | **不够**：实际几乎只发不收 |
| practice | 证券手续费、域内红包 | 够（封闭域，沉淀无外部性） |
| cluss_points | AI 调用消耗 | **最健康**：天然按真实成本回收 |

**【决策】任何 `sink` 为空或长期回笼率 < 20% 的域，健康度面板标 `risk`，并禁止调高 `supply_cap_cent`。** 现有 `health()` 已有 `weak_sink` 警告，把它从提示升级为硬约束。

### 5.2 双轨红包（P4 的制度化修复）

【决策】同一个红包界面，发出时**二选一选域**，池标签一路跟到底：

| | 练习金红包 · 发着玩 | 学元红包 · 真要用钱 |
|---|---|---|
| 资金来源 | `practice` | `cash` 优先、`grant` 补足（现有 `splitPayable`） |
| 领取方得到 | 仍是 `practice` | 同池 `cash` / `grant` |
| 能做什么 | 炒股、再发红包 | 消费、转账；`cash` 部分可提现 |
| 通胀 / 兑付影响 | 0（域内零和） | 0（本来就在消费域） |

**两条硬规矩**
- **一个红包只属于一个域**，不许「用练习金凑真钱红包」——混池等于变相打通。
- **练习金红包锁本班**（`scope='local'`）。`claimRemote()` 的机制是「本班 `burn` + 对端 `mint` 等额补发」，而 `mint` 默认进 `grant` 域，跨班领一次就把练习金洗成赠送学元，正好从墙里钻出去。

落地要点（已核查）：`services/yuanbao.js` 的 `poolSplit` / `takeSplit` / `burnSplitOf` 加第三域并兼容历史单池名 `'cash'`/`'grant'`；`create` 接 `opts.domain` → `hold(..., {pool:'practice'})`；`claim` 按域 `release` + `post`；`routes/wallet.js` 的 `/packet` 白名单只给 `spend` / `practice`（不暴露 `cash`/`grant`，防绕过 `splitPayable`）；前端在「玩法」上方加「用哪种钱」，默认学元，练习金模式禁用「跨班」。

护栏不变：支付密码 `guardPay` 照验、领取页标明是哪种钱、`practice-wall` 断言从「不能发红包」改为「发完仍在 practice 域、双方可花余额不变、`audit()` 平账、跨班被拒」——**改的是口径，不是放宽护栏**。

### 5.3 回收机制清单

按优先级：① 商店消费（唯一既有毛利又有回笼的出口）→ ② 手续费 → ③ 教师扣减 → ④ 提现 → ⑤ 到期回收（`grant` 可设学期末归零，需产品确认）。

### 5.4 为什么消费出口是第一优先

充值 = 收 100 元同时欠 100 元提货权，**净利润 0**；只有学生花掉学元、老师以更低成本交付商品，差额才成为毛利。因此：

```
毛利 = 学元面值 − 交付成本
收入 ≠ 充值        充值 = 预收款（负债）
利润 ≠ 印钱        印钱 = 增发负债
```

`splitPayOrder(userId, amountCent, maxGrantRatio)` 已经把「赠送学元最多抵扣毛利率」写好了——**接上它，P2 和「老师赚不到钱」同时解决一半**。

> **【v0.2】统一在这里的作用**：把更多应用纳入同一本账，等于**扩大「能花钱的地方」**。学生手里的学元可兑付物越多，回笼率越高、毛利机会越多。但统一**不创造兑付物**——若一个能定价、有真实成本的商品都没有，统一只是把 0 记进了一本更漂亮的账。**先有 P2 / P4-B，统一才是放大器。**

---

## 6. 跨域桥（唯一的兑换点）

### 6.1 三条原则

1. **默认关闭**：`xy_bridge` 没有行 = 全域不可兑换。
2. **显式声明**：每条桥写明 `from / to / rate / cap / period / budget_source / enabled / created_by`。
3. **双边记账**：出域 `burn`、入域 `mint`；`mint` 侧必须有 `B` 背书，且两笔在同一事务内，用同一个 `ref` 关联。

### 6.2 四道护栏（缺一不可）

| 护栏 | 说明 |
|---|---|
| 汇率 | 固定分数 `rate_num/rate_den`，一经产生兑换记录不可改（同 `yuanRate` 冻结逻辑） |
| 上限 | 单笔 `cap_cent` + 周期累计上限，防拆单绕过 |
| 周期 | `day / month / semester / once`，到期自动归零额度 |
| 预算 | `budget_source` 必须指向**已实现毛利**或**已实收现金**，禁止指向 `mint` |

### 6.3 具体桥清单（默认全关，逐条拍板）

| 桥 | 建议 | 理由 |
|---|---|---|
| `practice → grant` | ⚠️ 可选，每学期一次、100:1、上限 ¥2/人 | 给「炒股赚了能换支笔」的快感；总量封顶、可算进毛利预算。不开也行，用非货币奖励（成就 / 榜单 / 复盘报告）替代 |
| `cash → cluss_points` | ✅ **主推，但有前置** | 真钱买 AI 额度：学元定价 − API 实际成本 = 毛利。**⚠️ v0.4 前置：Cluss 目前售价 = 上游成本（平价代收），毛利恒为 0**，必须先按 10.4 劈开 `charge_micro` / `cost_micro` 并设定售价，桥才有毛利可收；否则只是把流水搬进桥。不必等 P5 统一 |
| `grant → cluss_points` | ⚠️ 原则禁止，例外须预算 | AI 调用有**真实边际成本**，用铸币去买等于平台真金白银付账单；仅在 `budget_source` 指向已实现毛利、且抵扣 ≤ 毛利率时开放 |
| `practice → cluss_points` | ❌ **永久禁止** | 练习金可无限补足，拿去买真实算力 = 无上限亏损敞口 |
| `cluss_points → cash / grant` | ❌ **禁止**（统一后仍禁止） | Cluss 积分锚定真实 LLM API 成本，兑换成可消费 / 可提现学元等于把「已采购的算力负债」二次变成购买力。**【v0.4 理由修正】准确说法是「双重兑付」**：同一笔已收真金既欠学生一次 AI 调用、又欠一次商品 / 提现，是**一笔钱两处花**，不是凭空印钱。**统一记账不改这条禁令** |
| `cluss_points → cluss_points`（同域单位平移） | ✅ 单位统一，**不是兑换** | 只把 `quota_yuan` / `available_points` 按冻结汇率 1:1000 记成学元分，兑付物、sink、可提现性一律不变；见 10.3 |

任何「返现」本质上都是一条从**平台毛利**出发的桥，因此：**返现率 ≤ 毛利率**，超过就是每卖一单亏一单；订单现金先归集到商户账户，再从它 `refund` 出去（`refund()` 要求 `from` 是真实账户、禁止 `@system:` 垫付，天然满足）。

### 6.4 隐藏的桥：跨班红包

`claimRemote()` 的 `burn + 对端 mint` 在不声明的情况下完成了一次跨域移动，且 `mint` 默认进 `grant`。**【决策】跨班路径在账本内核里视同桥，必须走 `xy_bridge` 校验**；未登记的域（尤其 `practice`）禁止跨班。现有 `cross-pay` 保持独立，不在本次改造范围。

---

## 7. 人民币现金台账与损益

### 7.1 唯一以人民币计价的账

学元账记的是「欠了多少点数」，现金账记的是「实际收付了多少人民币」。**两者永不混记**（I4）。前面那个 ¥241.12 vs ¥100.10 的错配，就是因为拿点数账冒充现金账展示。

### 7.2 `xy_cashbook` 分类

| direction | category | 触发点 |
|---|---|---|
| in | `recharge` | 班管录入线下充值成功 |
| in | `other` | 班费 / 赞助（人工录入） |
| out | `withdraw` | 提现审批通过、线下付现 |
| out | `revoke` | 撤回充值，退现金 |
| out | `goods_cost` | 进货 / 备货 |
| out | `cashback` | 返现支出 |
| out | `ai_cost` | Cluss 等外部服务真实账单 |

`ref` 唯一保证幂等；`related_tx_id` 关联学元流水，便于追溯。

### 7.3 损益表口径（`/admin/pnl`【设计】）

```
营业收入   = Σ 已交付订单的面值（不是充值额）
营业成本   = Σ goods_cost + ai_cost
毛利       = 营业收入 − 营业成本
返现支出   = Σ cashback
净利       = 毛利 − 返现支出 − 其他费用

兑付敞口   = Σ min(可用 cash, 累计净充值)      -- 学生随时能提走的钱
现金储备   = Σ in − Σ out
储备充足率 = 现金储备 / 兑付敞口                -- 必须 ≥ 1
```

**三个必须天天对上的数**
1. `Σ cashbook.recharge − Σ cashbook.revoke − Σ cashbook.withdraw` ≡ 现金储备变动
2. `Σ cash 域余额` ≡ `Σ cashbook 净入金` + 历史调账差额（差额必须能被 `adjust` 流水逐笔解释）
3. `可提现敞口` ≤ `现金储备`，否则 `health()` 报 `reserve_short`

> 【现状】第 2 条当前不成立，差额 ¥141.44 就是历史 `trade` 洗入。迁移到新模型时必须先补一笔 `adjust` 把它归位，并在 `xy_cashbook` 里登记为非现金来源，否则报表永远差一块。

### 7.3.1 盈利模型：钱到底从哪来【v0.2 新增】

运营方明确了**可持续运营（自负盈亏）目标**，因此必须把**收入口径**钉死，否则极易把「预收款」和「印出来的点数」误当成利润。

| 来源 | 能否确认为收入 | 机制 | 现状 |
|---|---|---|---|
| 线下充值 | ❌ **不能** | 预收款 = 负债，收 100 欠 100；学生还能提现，净利 0 | 2 笔测试录入，**真实付费 0**（见 7.3.2） |
| 未花完的沉淀（breakage） | ❌ 不建议 | 现行 `withdrawable` 规则下随时可提走，确认为收入既不成立也不合规 | 0 |
| **自营数字商品 / 服务**（装扮、AI 额度、报告导出） | ✅ **优先，毛利最高** | 零库存、零物流、零商户，边际成本 ≈ 0；交付即确认收入 | **0（装扮运行时已实现，只差兑换入口）** |
| **AI 额度差价** | ✅ **最快落地** | 学元定价 − `ai_cost`；Cluss 已有真实消耗与 402 熔断，是现成商品 | **0（两本账，未定价）** |
| 实物进销差 | ✅ 但**依赖商户**，降级可选 | 订单面值 − `goods_cost`，还要进货 / 库存 / 配送 / 损耗 | **0（全仓无商店）** |
| 域内手续费 | ⚠️ 暂不计现金收入 | 收的是学元；只有学元最终兑付成有成本差的商品时才转现金。证券手续费还在封闭 `practice` 域 | 有，但不出域 |
| 提现 / 汇兑手续费 | ⚠️ 可设计 | 校园场景慎做，需先公示 | 无 |

**盈利三段式（顺序不可颠倒）**

```
① 有可定价、有真实成本的兑付物（商店 / AI 额度）      → P2、P4-B
              ↓
② 有 cashbook 把面值 / 成本 / 返现分开记，毛利才算得清   → P0、7.3
              ↓
③ 统一积分扩大「能花钱的地方」，提高回笼率与复购       → P5（放大器，不是起点）
```

> **三条硬话**：**充值不是收入，印钱不是利润，返现是成本**。当前系统毛利为 0，瓶颈不在「积分没统一」，而在「没有能花学元的地方」——`splitPayOrder()` 写好了、测试过了、**零调用**。所以按赚钱目标排，先做 **冷启动 + P0 + P2a + P4-B**，不用等 P5 就能开张；统一放到 P3 之后，让 Cluss 的高频消耗进入同一本账，把可消费面与回笼率一起放大。**但 v0.3 实测发现真实付费用户为 0 —— 先得有人来，见 7.3.2。**

> **⚠️ 外部成本护栏（v0.2 新增，最硬的一条）**：AI 算力、实物进货这类兑付物**每交付一次就产生真实账单**。因此 `cluss_points` 域的 `supply_mode` 必须是 `fixed` / `procured`，**绝不能是 `mint` / `topup`**；任何可增发域（尤其 `practice`）购买外部服务一律拒绝。否则老师「发点积分鼓励一下」，发出去的是平台要付的 API 账单。

### 7.3.2 冷启动与规模账【v0.3 新增】

负责人指出两个现实约束：**后面不一定有商户进来**、**目前只有两个班、可能没人用**。因此 P2 不能押在第三方商户上。

#### 真实基线（2026-11-06 主库实测）

| 指标 | 值 |
|---|---|
| `users` 账号 | 104（11 个 officer / 93 个 user） |
| 近 7 天登录（正确口径） | **50**；近 30 天 52、近 60 天 54 |
| **近 60 天不同登录日** | **仅 8 天**（9/15、9/22、10/23、10/25、11/02、11/04、11/05、11/06），最大单日 24 人 |
| 从未登录 | **50**（全部为批量创建的普通账号，最早 2026-06） |
| 近 30 天学元活跃 | 49 人；`stock` 52 人 / 2866 笔，是**唯一跑起来的高频应用** |
| 充值记录 | 2 笔，均为同一账号 `251800`、间隔 22 秒的测试录入（¥1 + ¥1000） |
| **真实付费用户** | **0** |
| 商品 / 商店 / VIP 表 | **0 张**（仅 `gomoku_members` / `chess_members` / `stock_orders` 等应用内表） |
| 等级体系 | 最高 6 级、平均 1.7，几乎未运营 |

> ⚠️ **口径纠错**：v0.2 报的「累计充值 ¥100.10」是按 `amount_cent / 100000` 反推的，**不是真金**。`xy_recharge.yuan_cents` 记的是 ¥1001.00，且 `rate=100` 与现行 `yuanRate=1000` 不一致、单笔 ¥1000 还超过 `maxRechargeYuan=200`。这是 P0 必须一并归位的历史脏数据，**不得作为收入依据**。

#### 规模天花板（估算，参数均可替换）

假设有登录行为 50 人、按自然月 30 天估（**⚠️ 高估**：平板间歇发放，实际月可用场次仅 4~8 天，见 7.3.3）：

| 模式 | 算法 | 月毛利量级 | 依赖商户 |
|---|---|---|---|
| 卖实物 / 零食 | 54 × ¥5 × 20% 毛利 | **~¥54** | ✅ 需要，最重 |
| 学生买虚拟装扮 | 54 × 20% 付费 × ¥10，边际成本 ≈ 0 | **~¥108** | ❌ 不需要 |
| 家长买 AI 学习额度 | 54 × 25% 渗透 × ¥30 | **~¥405 流水，毛利 ¥0**【v0.4 纠错】 | ❌ 不需要 |
| 同上，扩到 10 个班 | 500 人同口径 | **~¥3,800 流水**；毛利取决于定价加成 | ❌ 不需要 |

> ⚠️ **【v0.4 口径纠错 · 第二次】**：v0.3 把「家长买 AI 额度 ~¥380/月」写进了**月毛利**列，是错的。负责人补充「Cluss 是充多少用多少」，核查源码确认：**Cluss 售价 = 上游成本，是平价代收代付，毛利恒为 0**（见 10.4）。¥380 是**流水**，不是利润；而且充值走线下转账、系统内只有额度分配流水，**连实收都没入账**。同理 v0.2 报的「累计充值 ¥100.10」已在上文纠正过一次。两次都是同一个毛病：**把点数账 / 流水当成了人民币损益**。

**结论**：两个班 × 学生零花钱 ≈ **百元 / 月**，无论账本设计多精妙都不可能「赚不少钱」。要上量级只有两条路，**且都不需要商户**：

1. **换付费方**：学生零花钱 → 家长为「AI 学习 / 错题报告」付费，客单价 ×3–6，理由也更正当；**但这只放大流水，毛利仍取决于是否让售价 ≠ 成本（见 10.4）**；
2. **换规模**：把这套系统推广到其他班，人数 ×5–10。

商户反而是最慢、最不可控、毛利最低的一条，**从关键路径降级为可选**。

#### 吸引人的顺序（先用现成资产，不新建应用）

1. **先激活那 50 个从未登录的账号**——人已在名单里，是最便宜的增长池，不必拉新。
2. **刚需入口 = 作业**：Cluss 拍题 / 错题本每次发平板都用（作业刚需，但**不是每天**，见 7.3.3）；给「前 N 次免费」的基础额度养习惯，用完才提示加额度（家长付费点）。
3. **高频引擎已存在 = 证券**：`stock` 近 30 天 52 人 / 2866 笔，用榜单 + 15 成就 + 复盘做**按次回访**钩子（平板不是天天发，按日钩子会落空，见 7.3.3），不用新做。
4. **零成本裂变 = 双轨练习金红包**（5.2）：同学互拉进来抢，练习金封闭、不灌水。
5. **炫耀载体已做完 = 装扮**：`client/src/core/profile-skin.js` 已实现 `apply / preview / clear / TOKEN_SPEC`，甚至支持「看谁主页显示谁装扮」的社交语义，**只差一个兑换入口**。这是最快能上架的零库存商品。
6. **等级几乎没用**（平均 1.7 级）：接上**累计登录次数** / 成就 → 等级解锁装扮（不用连续天数，断签往往只是没发设备）。

> **人少反而是优势**：50 人的榜单人人有机会上榜，老师能点名表扬，大班做不到。

**不要做**：发钱拉新（灌水，见 ADR 002）、把核心功能锁进付费墙（校园场景易生争议）、等商户。付费点只卖「锦上添花」——装扮、额外 AI 额度、复盘报告导出、称号、桌宠皮肤；家长自愿、明码标价、可提现、不强制、不公示付费排名。

### 7.3.3 设备发放节奏：所有「按天」设计改成「按次」【v0.5 新增】

负责人 2026-11-06 补充：**「学生用的平板不是天天发」**。这是**设备供给约束**，不是活跃度问题，影响面远大于计费本身。

#### 实测（主库 `users.last_login`，按日期正确比较）

| 指标 | 值 |
|---|---|
| 近 7 / 30 / 60 天登录人数 | **50 / 52 / 54** |
| 近 60 天**不同登录日** | **仅 8 天**：9/15、9/22、10/23、10/25、11/02、11/04、11/05、11/06 |
| 最大单日 | 11/06 的 24 人、11/05 的 17 人 |
| 密度 | 53 天跨度里 8 个登录日 → 平均 **每 6.6 天才有一天有人登录** |

> ⚠️ **【v0.5 口径纠错 · 第三次】**：v0.3 报的「7 天内登录 54」是错的。`users.last_login` 是 **TEXT**（`2026-11-06 14:21:47`），我却拿它和毫秒时间戳 `Date.now() - 7d` 比较；SQLite 中 **TEXT > INTEGER 恒真**，于是所有非空的 54 行都被判成「7 天内」。真实值是 50，且集中在 4 个登录日。加上 v0.2 的 ¥100.10、v0.4 的 ¥380，三次都是同一类错误：**拿字段当它不是的东西用**。7.3.2 的规模账须按「有登录行为 50 人 / 月可用 4~8 场」打折，不能当成 30 天日活。

#### 统一原则（G7）

**计费、留存、限流的锚点一律用「次数 / 用量」，不用「天数 / 日历周期」。** 时间不可控（设备没发下来），用量可控；按天收费等于让学生为拿不到设备的日子付钱。

| 现有机制 | 位置 | 间歇发放下的问题 | 改法 |
|---|---|---|---|
| **包月套餐**（v0.4 推荐 B） | 10.4 | 30 天里实际能用 4~8 天，「没用完」不是不需要而是没设备 | **撤回**，改「不过期次数包」B′ |
| 每日津贴 / 连续签到 7 天 | `xueyuan.js` `kind=daily` | 断签是设备没发，不是学生偷懒 → 惩罚无辜 | 「连续 7 天」→「累计 7 次」；津贴按领取次数而非自然日 |
| Cluss `weekly_quota_micro` | `credit.js:168` 的 7 天窗口 | 发放日集中在一天，一天用掉一周额度就撞限；注释原话是「防止单个账号把额度占满」 | 改滚动 N 次 / 按发放场次计，或去掉 |
| 峰谷折扣 / `free_until` 限免 | `pricing.js` | 按时钟算，学生不在那些时段；「本周限免」可能一次都没赶上 | 限免改「前 N 次免费」；峰谷折扣在校园场景意义有限 |
| 证券日榜 / 每日复盘 / 15 成就回访 | `market-apps/stock` | 每日回访钩子落空 | 改「每次登录可见的阶段性复盘」，按场次而非按日 |
| `streak` 连续天数 | Cluss `/student-profile` | 断签不可归责于学生 | 改累计场次 |

#### 对收入模型的修正

7.3.2 的月毛利按自然月 30 天估，在间歇发放下**系统性高估**。用「月可用场次 4~8」替代后：按时间收费的模型整体不成立，**只有按次 / 按量、且不过期的收费才成立**。毛利来源因此从「过期没收」彻底改为「**定价加成 + 零边际成本增值品**」——后者与设备发不发无关，更稳，也更不容易引发家长争议。

---

### 7.4 管理端面板

保留现有「币值健康度 / 对账」两块，新增：
- **损益卡片**：本期收入 / 成本 / 毛利 / 返现 / 净利（人民币）
- **储备卡片**：现金储备 / 兑付敞口 / 充足率
- **按域存量**：每个域一行，标注「封闭 / 可花 / 可提现」，替代现在容易误读的「充值学元（可提现）」标签
- **练习金**等封闭域单独灰显，明确「不计入可花余额、不影响物价」

---

## 8. 治理护栏

### 8.1 常规

- **配额**：单笔 + 日累计 + 学期累计三层；`config.xueyuan` 集中配置，禁止散落常量。
- **幂等**：所有写账接口必须传 `ref`；跨班 / 重试复用同一 `ref`。
- **对账**：`audit()` 按域循环，检查 ① 逐笔借贷平 ② 账户余额 = 分录汇总 ③ 域总量守恒 ④ 冻结额 ≤ 余额 ⑤ `frozen_total` = 各域冻结之和。
- **权限**：`requireTreasury` 守住所有发行 / 撤回 / 退款 / 桥开关；桥的每次 `enabled` 变更写审计日志。

### 8.2 汇率冻结

`yuanRate` 一旦产生充值不可改；每条桥的 `rate_num/rate_den` 一旦产生兑换记录同样冻结。改比率必须走「新域 + 新汇率 + 老域只读」，不做存量重估。

### 8.3 迁移铁律（血泪，必须写进迁移模板注释）

1. **余额、分录、冻结，三样必须一起搬**，少一样 `audit()` 必报错。迁移 034 只搬余额没补分录、改了 `grant_balance` 没同步改 `balance`，导致账本不平衡、个别账户余额变负，由 035 补救。
2. **PM2 会检测文件变化自动重启并执行迁移**。新迁移文件一旦落进 `server/src/migrations/`，就等于在真实库上执行了。
   → 正确顺序：先写到临时路径 → 在**库副本**上跑通 + `audit()` 通过 → 再放进迁移目录；或先 `pm2 stop classintra-server`，验证完再 `start`。
3. 迁移必须自带副本验证脚本，验收项：域总量守恒、`audit().ok === true`、冻结额自洽、报表三数对齐。

### 8.4 测试矩阵

| 套件 | 现状基线 | 改造后新增 |
|---|---:|---|
| `scripts-test-xueyuan.cjs` | 126 | 按域守恒、域注册表校验 |
| `scripts-test-xueyuan-limits.cjs` | 76 | 桥上限 / 周期 / 预算 |
| `scripts-test-collect.cjs` | 34 | 混域订单拒绝 |
| `scripts-test-wallet.cjs` | 178 | 现金台账对账 |
| `market-apps/stock/test/practice-wall.cjs` | 49 | 双轨红包域内闭环、跨班拒绝 |
| `market-apps/stock/test/e2e.cjs` | 176 | 收益域由声明驱动 |
| `scripts/ci-check.mjs` | 6 项 | 门禁：`sink` 非空、域声明合法、无硬编码域名 |

**合计 645 项全绿是改造起点，不是终点。**

---

## 9. 应用接入契约

### 9.1 `capabilities` 扩展【设计】

现有 `market-apps/stock/manifest.json:31-36` 只声明了 `economy.wallet`。扩展为三级：

| capability | 允许做什么 |
|---|---|
| `economy.read` | 只读自己域的余额与流水 |
| `economy.ledger` | 在自己域内 `post` 转账 / 冻结 / 结算（**不得指定别的域**） |
| `economy.domain` | 注册并持有一个自有域（必须提供 `sink`，走人工审核） |
| `economy.bridge` | 申请跨域桥（**默认拒绝**，需班管在管理端显式开启） |

平台在加载应用时比对 `capabilities` 与 `xy_domain.owner_app`，越权调用在 `post()` 入口就拒绝，不依赖应用自觉。

### 9.2 三种接入姿态

| 类型 | 例子 | 接入方式 |
|---|---|---|
| 内置应用 | `apps/wallet`、`apps/admin` | 直接使用平台域，无声明 |
| 市场应用 | `market-apps/stock`、`pet`、`chess` | `manifest.capabilities` 声明 + 域注册表 |
| **联邦应用** | **Cluss（9003）** | **当前**只登记域描述 + 上报汇总；**目标**通过 `integrations/v1` 的 `economy.ledger` 调用本仓账本原语，本仓成为唯一记账方（见 10.3 / P5） |

### 9.3 接入检查清单（门禁自动校验）

- [ ] 声明了 `backing` / `redemption`，且组合在 2.1 的矩阵里不是 ❌
- [ ] 声明了至少一个 `sink`
- [ ] `withdrawable=1` 时，`backing` 必须是 `cash` 且受累计净充值约束
- [ ] 所有写账调用传了 `ref`
- [ ] 不读取 / 不写入其他应用的域
- [ ] **不自建独立积分 / 点数 / 额度账本**——统一后所有点数必须落在 `xy_balance` 的某个域（v0.2 硬规矩）
- [ ] 若 `redemption` 为「真实外部服务 / 实物」，须声明 `cost_category`，且 `supply_mode` 不是 `mint` / `topup`；**可增发域购买外部服务一律拒绝**
- [ ] 前端展示明确区分「能花」「封闭」「可提现」
- [ ] 在库副本上跑过迁移并 `audit()` 通过
- [ ] 测试覆盖了「域内流转正常 + 跨域被拒」

---

## 10. Cluss 专项（外围案例 · 不定义重建模型）

### 10.1 事实（2026-11-06 调研）

| 项 | 值 |
|---|---|
| 本体 | **另一个仓库** `D:\NetWork\Integration\Cluss`，Vue 2.7 + Express + better-sqlite3 |
| 定位 | 引导式 AI 解题（分层提示，不直接给答案），含拍题、错题本、笔记、长期画像、云盘 |
| 进程 / 端口 | 独立 `cluss-server`，**9003**；本仓 `ecosystem.config.js` 只有 5 个进程，**不含 cluss-server** |
| 数据库 | 独立 `cluss.db`；已知表 `wrong_questions`、`ai_model_health` |
| 用户体系 | 独立注册（学号服务端分配、`net_name`/`real_name` UNIQUE）、独立 JWT 登录 |
| 积分 / 额度 | `GET /api/wallet` → `available_points` / `used_points`；SSE `done.cost_points` / `done.balance`；`PUT /api/admin/users/:id/quota` 的 `quota_yuan` / `weekly_yuan`；无额度时 AI 接口 **HTTP 402** |
| **计费口径【v0.4 核查】** | **平价代收，毛利 0**：`docs/deploy.md:171`「按上游真实价格定价」、`docs/product.md:89`「按上游真实 usage 计费」；内部全程微元（1 元 = 1e6），`cost_micro` **既是向学生扣的售价、也是付给上游的成本**，`cluss_usage_log` 无独立成本列；1 元 = 100 积分（`CLUSS_POINTS_PER_YUAN`，仅展示层）；额度**无过期 / 无沉淀**，可 `DELETE /quota` 收回清零 |
| **实收现金【v0.4 核查】** | 充值走**线下转账 + 管理员后台手工录入** `quota_yuan`（`README.md:6`）；系统只记 `cluss_credit` / `cluss_credit_log` 的**额度分配流水**，**不记实收金额**。所以「收了多少钱、赚了多少钱」在 Cluss 库里查不到 |
| 联邦通道 | `/api/cluss-bridge` 只读四端点（ping / verify / class-roster / student-profile）+ HTTPS 同源反代 `/cluss-app → 127.0.0.1:9003` + 云盘互通 + 共享 `CI_JWT_SECRET` / `RELAY_SECRET` |
| 与经济系统的耦合 | **【现状】零**。`xueyuan.js:3-4` 与 `stock/frontend/entry.js:2966` 两处明文「互不相通」；`/student-profile` 只外传 `exp/level/streak` 等只读画像素材，不写回、不记分。**【v0.2】这句注释将在 P5 被域注册表的一行数据取代** |
| manifest | `apps/cluss/manifest.json` 仅 17 行，**无任何 `capabilities`** |

### 10.2 结论【决策 · v0.2 修订】

负责人 2026-11-06 明确：**后续把积分体系统一为学元体系**。因此「是否统一」不再是问题，**「统一到哪一层」才是**。

#### 统一的三层（只做 L1 + L2，绝不做 L3）

| 层 | 统一什么 | 判定 | 落地物 |
|---|---|---|---|
| **L1 记账** | 一个账本内核、一套 `xy_tx` / `xy_entry` 流水、一套按域守恒与 `audit()`、一个余额查询入口 | ✅ **必须**，这是「统一」的实质 | `xy_domain` + `xy_balance`；Cluss 不再自己写 `available_points` |
| **L2 身份与展示** | 一个稳定 `user_id`、一个「我的资产」页、统一单位（学元分）、统一命名与报表 | ✅ **必须**，否则 L1 落不了地 | `xy_identity` 映射表 + 统一资产页 |
| **L3 购买力** | 所有点数互相自由兑换、随便花、能提现 | ❌ **绝对不做** | 兑换矩阵维持 3.4 的禁令 |

> 类比：**统一科目体系，不等于取消明细科目**。Cluss 积分并进来后是学元体系里的一个域（可更名 `ai_quota`），不是变成能买东西的钱。少了这道区分，「统一」会一次性把两件事毁掉：① 练习金/赠金再次灌进消费市场；② 老师按元采购的 AI 额度被学生当成零成本购买力提走。

#### 短期处置（P3 之前）

维持只读：`xy_domain` 登记 `cluss_points`（`owner_app='cluss'`、`status='readonly'`），管理端能显示这笔负债，但**不写 `xy_balance`、不进守恒、不参与兑换**。理由不变：独立仓 / 独立库 / 独立用户体系，且积分锚定真实 API 成本。

#### 三个前置条件（P5 开工前必须全部满足）

1. **身份映射**：Cluss 独立注册、独立 JWT、学号由它自己分配。统一余额前必须有稳定的全局 `user_id`。已有共享 `CI_JWT_SECRET` 与只读 `class-roster` 端点可作锚，建 `xy_identity` 映射表；**禁止靠姓名 / 网名匹配**。
2. **唯一记账方**：两个库、两个进程，没有分布式事务。统一后 Cluss **不能再自己写 `available_points`**，必须改为调用本仓 `economy.ledger` 原语（本仓是唯一记账方）。否则就是两本账 + 永久对账漂移——这不是统一，是加了一层同步。
3. **计价与兑付锚定**：`quota_yuan` 按元授予，学元 1:1000。存量平移时**只改单位与存放位置**，`redemption` / `sink` / `withdrawable` 三个字段一个都不动；按 ADR 012，汇率一经使用即冻结。绝不能让「1 元 AI 额度」被重估成「1000 学元可消费购买力」——那等于凭空印钱。

### 10.3 四阶段统一路径【v0.2 修订】

| 阶段 | 做什么 | 验收 |
|---|---|---|
| **A 描述**（P4） | 登记 `cluss_points` 为只读域；`integrations/v1` 增加只读 `economy.summary` 端点，Cluss 定期上报汇总 | 管理端能看到 Cluss 侧汇总，不写本仓任何余额 |
| **B 单向**（P4 **主推**） | 开 `cash → cluss_points` 桥：按 AI 实际成本加成定价；`grant` 原则禁止、`practice` 永久禁止（见 6.3）。**⚠️ v0.4：加成定价须先落 10.4 的售价/成本拆分，否则 Cluss 仍是平价代收、毛利 0** | 双边对账：本仓扣的钱 ≡ Cluss 加的额度；`cashbook` 记 `ai_cost` 与正毛利 |
| **C 记账统一**（P5） | Cluss 域 `readonly → active`；存量按冻结汇率 1:1000 平移进 `xy_balance` / `xy_entry`；**Cluss 停写本地余额**，AI 扣费改为调用本仓 `economy.ledger` | 切换前全量双边对账 + 一次性 `adjust` 找平；切换后 `audit()` 全域守恒 |
| **D 身份与展示统一**（P5） | 建 `xy_identity` 映射；统一「我的资产」页按域列出（能花 / 封闭 / 可提现）；统一命名 | 同一个学生在两个系统看到同一个 `user_id` 和同一份余额 |
| **不开的** | `cluss_points → cash / grant` 永久不开放；不合并 `cluss.db`、不合并进程、不物理迁移用户表 | 门禁矩阵 + `xy_bridge` 无对应行，双重拒绝 |

> **统一之后，兑换矩阵一格都不新增**：Cluss 从「系统外的一笔负债」变成「系统内的一个域」，学生看到的是一份资产清单，而不是一份可自由兑换的余额。**体系的扩展价值不在「把 Cluss 并进来」，而在于：来第五个应用时，只需要 `INSERT` 一行域 + 声明 capabilities，不用改账本内核、不用加迁移列、不用再写一句「与 XX 互不相通」的注释。**

---

### 10.4 从流水到毛利【v0.4 新增 · 负责人补充「Cluss 是充多少用多少」】

#### 实证：Cluss 是一条平价代收通道

核查 `D:/NetWork/Integration/Cluss` 源码（2026-11-06）：

```
线下转账 ¥100 → 管理员 PUT /quota {quota_yuan:100} → allocated_micro += 1e8
学生问一次   → cost_micro 按上游真实 usage 计价 → available = allocated − Σcost
学生用完     → HTTP 402，再充值
```

| 证据 | 位置 | 含义 |
|---|---|---|
| 「按上游真实价格定价时，一次对话的成本常常不足 1 积分」 | `docs/deploy.md:171` | 售价 = 上游价 |
| 「放行 → 流式生成 → 完成后按上游真实 usage 计费」 | `docs/product.md:89` | 扣的就是成本 |
| `cluss_usage_log` 只有 `cost_micro` 一列 | `migrations/001_init_schema.js` | **售价与成本共用一个数**，账本里根本没有「毛利」这个概念 |

再叠两条：`quota_yuan` 由管理员**线下收款后手工录入**（`README.md:6`），系统只记额度分配流水，**实收现金从未入账**；额度**无过期、无沉淀**，只能 `DELETE /quota` 收回清零。

> **结论：Cluss 现在的毛利恒等于 0，甚至可能为负**（同步容错 1 元、缓存未命中、失败重放时的少收）。v0.3 把「家长买 AI 额度 ~¥380/月」放进月毛利列是错的，那是**流水**。连同 7.3.3 纠出的日活假数，**三次口径错误**（¥100.10、¥380、日活 54）是同一个毛病：**拿字段当它不是的东西用**。

#### 但它是全场唯一没有通胀风险的域

这条同样重要，不能因为「不赚钱」就把它当成「印出来的积分」防着：`allocated_micro` 每一分都对应**已收真金**，`Σcost_micro` 每一分都对应**已交付的真实 API 成本**。它是四个域里唯一天然满足 `supply_mode = procured` 且自带 `sink` 的域。

因此统一时的准确定性是：**`cluss_points` 属于「预收款负债」一类，与 `cash` 同源，而不是与 `grant` / `practice` 同源。** 3.4 矩阵里 `cluss_points → cash / grant` 的禁令保留，但理由修正为「**双重兑付**」——同一笔已收真金既欠学生一次 AI 调用、又欠一次商品 / 提现，是**一笔钱两处花**，不是凭空印钱。

#### 从 0 到毛利：三条路径（v0.5 按间歇发放重排）

| 路径 | 做法 | 改动 | 学生感知 | 评价 |
|---|---|---|---|---|
| **A 调价** | `price_in / price_out` 本就是可配售价，设为上游成本 × 1.3 | **零代码**，只改配置 | 同样 ¥20 少用 ~23%，提问前开始算值不值 | 最快验证，但与 `docs/product.md:63`「低心理门槛提问」冲突；**与 B′ 叠加更好** |
| **B′ 不过期次数包（推荐）** | 「买 100 次，用完为止，不限时间」；售价含加成，余额可结转 / 可退 | 中：次数包表 + 按次核销（**不做周期重置**） | 拿到设备就能用，没拿到的日子不计费 | 毛利来自**加成**而非过期没收，与发放节奏解耦。**v0.5 取代原「包月套餐」** |
| **C 增值功能单独计价** | 主对话仍平价，复盘报告导出 / 错题本 PDF / 批改包 / 装扮收费 | 中，可与 P2a 合并 | 刚需不收费，锦上添花自愿 | 零边际成本，毛利近 100%，**与设备发不发无关，最稳** |

> **【v0.5 决策 · 撤回包月】** 原 B「每月 ¥30 含 N 次，未用完不结转」在平板间歇发放下不成立：30 天里实际只有 4~8 天能用，「没用完」是设备缺席而不是需求不足，让学生为拿不到平板的日子付钱，家长看到「一个月只用了 5 次还扣 30」极易生争议。**B′ 保留「批量预付费」的现金优势，去掉「过期没收」这个毛利来源**，毛利改由 A 的定价加成承担。

**三条路共用同一个前置：把 Cluss 的一个数劈成两个。** 现在 `cost_micro` 同时是售价与成本，必须拆成 `charge_micro`（向学生扣）与 `cost_micro`（付上游），并在 `xy_cashbook` 记 `recharge`（线下实收）与 `ai_cost`（真实账单）：

```
毛利_AI   = Σ charge_micro − Σ cost_micro
实收现金  = Σ cashbook.in(recharge)        ← 现在这一项在 Cluss 库里查不到
储备充足率 = (Σin − Σout) / 兑付敞口        ← 未用完的额度是负债，不是利润
```

**P4-B 的验收口径据此改写**：不是「桥打通就有第一笔毛利」，而是「`charge / cost` 拆分落地 + 实收入账 + 定价 ≠ 成本」三者齐备，第一笔毛利才成立。**在此之前，AI 额度只报流水，毛利一律显示「暂无数据」。**

---

## 11. 分阶段迁移路线

### 11.0 两条序列：重建主线 vs 应用议题【v0.6 主线归位】

v0.3 曾把优先级写成「先赚钱 → P3 重建放倒数第二」。**那是把约束当成了目标**，予以纠正。两者是**并列序列**，不是一条队列上的先后：

| 序列 | 目标 | 内容 | 关系 |
|---|---|---|---|
| **A · 重建主线（本文主题）** | 让域变成数据 | R1 → R4 → P3（集成）→ P5（收编外部应用） | **独立完成，不依赖 B，也不等 Cluss** |
| **B · 盈利与运营** | 有人用、有毛利 | P0 / P1 / P2a / P4-B / 冷启动 / 设备节奏 | 可并行；其「跨域结算」「返现」「统一积分」三项**必须等 A 的 R2 完成**才有干净落点 |

#### 重建主线 R1–R4（P3 的前置拆解）

| 步 | 做什么 | 主要文件 | 风险 | 验收 |
|---|---|---|---|---|
| **R1** | 建 `xy_domain` 表，**只读**：把现有四池（cash / grant / practice / @system）登记成四行；`POOL` 仍从常量读，但启动时校验「常量 ⊆ 注册表」 | 新迁移（**仅建表 + 插数据，不动任何余额**）、`services/xueyuan.js` 启动校验 | **低**（不碰写路径） | `audit()` 全绿；全套测试不回归；注册表与常量一致 |
| **R2** | 内核去硬编码：`normalizePool` / `poolLabel` / `post` 的 `isPractice` / `mint` / `burn` / `refund` / `hold` / `release` / `settleHold` / `creditTrade` / `audit` / `health` 一律改按域属性（`supply_mode` / `redemption` / `sink` / `transferable` / `withdrawable`）分支 | `services/xueyuan.js`（**2026-11-06 实测：73 处池名引用**） | **高**（动写路径） | 全部既有测试逐项通过；`audit()` 守恒不变；行为与 R1 **逐笔比对一致** |
| **R3** | 双写灰度：`xy_account` 与 `xy_balance` 同事务更新，`audit()` 交叉比对；新域优先读注册表 | 新迁移、`services/xueyuan.js` | 中 | 双写零漂移连续 7 天；可一键回退 |
| **R4** | 切写：废弃 `POOL` 枚举与四组余额列，写路径统一走 `xy_balance`；保留只读视图兼容旧报表 | 新迁移 | 高 | 「新增一行域 = 零内核改动」现场演示通过 |

> **重建完成的唯一判定**：在库里 `INSERT` 一个测试域（如 `honor`），不改内核、不加迁移列、不改代码，即可完成「发放 → 域内流转 → 回收 → `audit()` 按域守恒 → 管理端显示」，且原有四池全部测试仍绿。**做不到这一条，前面写得再完整都只是设计稿。**

> **迁移铁律（见 8.3）**：R1 的建表迁移必须先写在临时路径、在库副本上跑通，再放进 `server/src/migrations/` —— PM2 检测到目录变化会自动重启并执行迁移，034 的半成品迁移就是这样直接落到真实库的。**余额、分录、冻结三样必须一起搬。**

---

| 阶段 | 内容 | 主要文件 | 风险 | 验收 |
|---|---|---|---|---|
| **P0** | 补 `xy_cashbook` 现金台账 + `/admin/pnl` 损益表；修正「充值学元（可提现）」失真标签；用 `adjust` 归位历史 ¥141.44 | 迁移 036、`routes/xueyuan.js`、`apps/admin/frontend/Admin.vue` | 低（只加表 / 只改展示） | 7.3 三个数对齐、645 项测试全绿 |
| **P1** | 双轨红包（本班练习金红包）+ 校正 `routes/wallet.js` 三处遗留文案 | `services/yuanbao.js`、`routes/wallet.js`、`Wallet.vue`、`practice-wall.cjs` | 中（动账本拆分） | 域内闭环、`audit()` 平账、跨班被拒 |
| **P2a** | **自营数字商品**（零库存、零商户）：装扮兑换接 `profile-skin` 与 `splitPayOrder`、AI 额度定价、复盘报告导出；`economy.read/ledger` 能力落地 | `client/src/core/profile-skin.js`（**已实现**）、`routes/app-permissions.js`、钱包内页 | 低 | 第一笔非充值收入进 `cashbook`；装扮上架 ≤ 1 周 |
| **P2b** | 实物商店（**可选，降级**）：需商户 / 进货 / 库存 / 配送 | 新 `market-apps/shop`、进货台账 | 中 | 仅在 P2a 跑通且确有商户时启动；回笼率 > 20%、毛利可算 |
| **P3** | **重建序列 A 的集成步**（前置 R1–R4 见 §11.0）：`POOL` 枚举 → `xy_domain` 注册表；`xy_account` 加列改 `xy_balance` 双写；`audit()` 按域循环 | `services/xueyuan.js`（重构）、迁移 037 | **高** | 「新增一行域 = 零内核改动」演示通过；全套测试 + `audit()` |
| **P4** | 跨域桥 + 返现 / 兑换闸门 + `economy.bridge` 能力；Cluss 登记只读域（统一路径 A / B） | 新 `services/economy-bridge.js`、`xy_bridge`、`integrations-api.js` | 中 | 四道护栏生效、桥关闭时全域不可兑换；**⚠️ v0.4：桥产生毛利的前提是先完成 10.4 的售价 / 成本拆分与实收入账，平价代收下毛利仍为 0** |
| **P5** | **积分体系统一为学元体系**：Cluss 域转 active、存量 1:1000 平移、`xy_identity` 映射、`economy.ledger` 开放给联邦应用、统一资产页；此后新应用一律不得自建积分账 | 迁移 038、`services/economy-ledger.js`、`xy_identity`、`integrations-api.js`、**Cluss 仓（另一仓库）** | **高**（跨仓 + 改唯一记账方） | 全量双边对账找平；`audit()` 全域守恒；Cluss 本地 `available_points` 只读或下线；统一资产页与账本逐人对齐 |

**P0 / P1 / P2 互不依赖，可并行；P4 依赖 P3；P5 依赖 P3 + P4 且需 Cluss 仓配合改调用方。** 每个阶段独立发版、独立 tag，禁止把六件事捆成一次大改。**P3 不再需要等 P1**：它是重建序列 A 的集成步，前置拆解见 §11.0 的 R1–R4，与盈利序列 B 并行。

**【v0.6 纠正】盈利序列 B 的内部顺序**（仅在把「先赚钱」当当期目标时适用，**不影响序列 A**）：`冷启动 → P0 → P2a → P4-B → 扩班`。P1 双轨红包可作裂变工具提前；P2b 实物商店移出关键路径。**原表把 P3 排在盈利之后是错的**：P3 属于重建序列 A（其内部拆为 R1–R4），与 B 并行，且应先于 B 里任何跨域结算落地。

> **⚠️ 时序红线（v0.2）**：积分统一（P5）**绝不能早于 P3**。若在 `POOL` 还是硬编码枚举时就把 Cluss 并进来，等于给十处分支再加一个特判、再写一次迁移列、再补一轮测试，来第六个应用时还得重来一遍。**先让「域」变成数据，统一才是一次性的。**

---

## 12. 决策记录（ADR）

| # | 决策 | 理由 | 反例 / 代价 |
|---|---|---|---|
| 001 | 保留现有账本内核，不推倒重来 | 复式记账 / 幂等 / 守恒已验证，645 项测试护航 | 无 |
| 002 | 隔离的判据是供给约束，不是消费对象 | 无限供给池连通有限供给池必然稀释 | 若哪天让练习金买实物，矛盾当场爆发 |
| 003 | 四池隔离保留，但要泛化为「域是数据」 | 硬编码枚举是扩展性的真正瓶颈 | 拒绝每加一个应用改十处 |
| 004 | 要隔离的是购买力，不是社交 | 域内零和流转不产生兑付义务 | 需防换手洗身份，所以必须池级而非商品级 |
| 005 | 一个红包只属于一个域 | 混池 = 变相打通 | 界面需多一步选择 |
| 006 | 练习金红包锁本班 | `claimRemote` 的 burn+mint 会把 practice 洗成 grant | 牺牲跨班玩红包 |
| 007 | 充值不是收入，是负债 | 收 100 元同时欠 100 元提货权，净利 0 | 需向使用者解释，避免误读面板 |
| 008 | 返现率 ≤ 毛利率，且从已实现毛利出 | 锚定流水会每单亏钱 | 返现规模受毛利限制 |
| 009 | 人民币账与点数账永不混记 | ¥241.12 vs ¥100.10 的错配就是混记后果 | 需维护两套账 |
| 010 | Cluss 短期不打通**购买力**，但目标接入统一账本（v0.2 修订） | 独立仓 / 积分锚定真实 API 成本；负责人已定「积分体系统一为学元体系」 | 统一排到 P3 之后，短期管理端仍只有汇总 |
| 011 | 每个域必须有 `sink` 才能 active | 只发不收必然沉淀成「钱多货少」 | 新应用接入多一道审核 |
| 012 | 汇率与桥汇率一经使用即冻结 | 改比率 = 单方面重估负债 | 需新域而非改旧域 |
| 013 | **全平台积分体系统一为学元体系**（负责人 2026-11-06 定方向） | 每应用自建积分 = 每应用一本账，无法统一对账与报表 | 统一排到 P3 之后；短期仍只读登记 |
| 014 | 统一 = 一本账 + 一套科目 + 一个身份，**不统一购买力** | 合并成可自由兑换的池会同时引爆通胀与 Cluss 真实 API 成本 | Cluss 积分并入后仍不能买东西 / 提现，学生可能觉得「还是两种钱」，需靠统一资产页解释 |
| 015 | 统一后本仓是唯一记账方，Cluss 停写本地余额 | 两库两进程无分布式事务，双写必然漂移 | 需 Cluss 仓改造调用 `economy.ledger`，跨仓联调成本高 |
| 016 | **充值与印钱永不确认为收入；收入 = 已交付订单面值 − 真实成本** | 预收款是负债、铸币是增发负债，两者都不产生价值差 | 毛利须等「交付完成」才确认，报表比直觉滞后 |
| 017 | 外部成本型兑付物（AI 算力 / 实物）禁止用 `mint` / `topup` 域购买 | 每交付一次产生真实账单，可增发域 = 无上限亏损敞口 | 学生不能用练习金买 AI 额度，需靠文案解释 |
| 018 | **不依赖第三方商户，优先自营零库存数字商品** | 两个班规模下实物毛利最低、进货 / 配送最重，且负责人明确「不一定有商户」 | P2b 降级可选；装扮 / AI 额度 / 报告先行 |
| 019 | 付费方优先家长、付费项只卖增值内容，核心功能不锁付费墙 | 学生零花钱天花板 ~百元 / 月；校园场景强制收费易生争议 | 客单价与渗透率须实测校准，不能拍脑袋 |
| 020 | **Cluss 当前为平价代收通道，毛利 0；要赚钱必须先让售价 ≠ 成本** | 售价与成本共用 `cost_micro` 一列，部署文档明确「按上游真实价格定价」，且线下实收未入账 | 三条路径（v0.5 修订）：调 `price_in` 加价／**不过期次数包（推荐，按次不按天）**／增值功能单独计价；三者都要求 `cashbook` 先记实收。⚠️ 原「包月套餐靠沉淀」已由 ADR 021 撤回 |
| 021 | **计费 / 留存 / 限流锚点用「次数」不用「天数」；撤回包月套餐** | 平板不是天天发（近 60 天仅 8 个登录日），按时间收费等于让学生为拿不到设备的日子付钱，且「没用完」不是需求不足而是设备缺席 | 改不过期次数包、连续 7 天→累计 7 次、`weekly_quota` 改滚动次数、限免改前 N 次；毛利来源从「过期没收」改为「定价加成 + 零边际成本增值品」，见 7.3.3 |
| 022 | **重建主线优先；盈利 / 冷启动 / Cluss / 设备节奏是并列外围序列，不参与排重建的先后** | v0.3–v0.5 把约束当目标，P3 被排到倒数第二，文档涨到 843 行而内核一行未动 | 讨论与验收一律以「新增域零内核改动」为准；外围议题不得再改主线优先级，见 §11.0 |

---

## 13. 风险清单与未决问题

| 风险 | 等级 | 缓解 |
|---|---|---|
| P3 重构 `post()` 影响全部调用点 | 高 | 双写灰度 + `audit()` 交叉校验 + 每阶段独立发版 |
| PM2 自动重启提前执行半成品迁移 | 高 | 见 8.3 铁律；迁移先写临时路径、副本验证 |
| 双写期间 `xy_account` 与 `xy_balance` 漂移 | 中 | 每次写账同事务更新两处，`audit()` 逐账户比对 |
| 域注册表被第三方误改 | 中 | 注册表只允许管理端写，变更写审计；应用只有读权限 |
| 商店建成后 `grant` 大量涌入消费 | 中 | `splitPayOrder` 抵扣上限 = 毛利率；`health()` 盯回笼率 |
| Cluss 上报汇总的可信度 | 低 | 只读、不写余额；汇总数标注「外部系统，未经本仓对账」 |
| 统一时身份映射漂移 | **高** | 建 `xy_identity`，以共享 `CI_JWT_SECRET` + `class-roster` 为锚；禁止靠姓名 / 网名匹配 |
| Cluss 本地余额与本仓账本双写 | **高** | P5 起 Cluss 停写 `available_points`，改为调用本仓原语；切换前全量对账并一次性 `adjust` 找平 |
| 存量 `quota_yuan` 平移被误读成「多出购买力」 | 中 | 平移只改单位与存放位置，`redemption` / `sink` / `withdrawable` 一字不动；汇率冻结（ADR 012） |
| **用可增发域购买外部成本服务** | **高** | 门禁硬拦 `practice / grant → cluss_points`；`splitPayOrder` 的 `grant` 抵扣上限必须 ≤ 该商品毛利率 |
| 把预收款当成利润提前花掉 | **高** | `health()` 的 `储备充足率 ≥ 1` 硬门槛；返现只能从「已实现毛利」出（6.2 预算护栏） |
| **真实付费用户为 0，却按「有人消费」出报表** | **高** | P0 先修 `xy_recharge` 脏数据；首笔真实订单前，毛利指标一律显示「暂无数据」，不得画增长曲线 |
| 50 个账号从未登录 | 中 | 冷启动先激活存量、不拉新；见 7.3.2 |
| **Cluss 平价代收被误计为收入** | **高** | 损益表在 `charge_micro` / `cost_micro` 拆分落地前，AI 额度一律只报**流水**、毛利显示「暂无数据」；禁止把 `quota_yuan` 累加当营收 |
| **按天机制在间歇发放下误伤学生 / 高估收入** | **高** | 见 7.3.3 清单；所有「连续 N 天 / 每 7 天 / 每月」上线前必须过一遍发放节奏评审，包月类一律不批 |

**未决问题（需产品/负责人拍板）**
1. `grant` 是否设学期末过期回收？设了能显著改善回笼率，但学生可能抵触。
2. `practice → grant` 的封顶桥开不开？不开则用非货币奖励替代快感。
3. 商店的商品形态与进货流程（决定 `goods_cost` 怎么记）。
4. 返现是「赠金」还是「真现金」——两者在 6.3 里是不同桥。
5. ~~Cluss 阶段 B 是否需要「学元买 AI 额度」~~ → **v0.2 已定方向：全平台积分统一为学元体系**，不再讨论「要不要」，改为拍板下面三项。
6. **统一到哪一层**：本文默认 L1 记账 + L2 身份 / 展示 + **不统一 L3 购买力**（10.2）。若你要的是「Cluss 积分能直接买东西 / 提现」，必须先改 3.4 矩阵，并接受真实 API 成本被印穿的后果。
7. **存量平移口径**：`quota_yuan` / `available_points` 按 1:1000 换成学元分时，历史已消耗部分如何对账、差额走 `adjust` 找平还是一次性清零。
8. **谁当唯一记账方**：Cluss 改调用本仓 `economy.ledger`（推荐，真一本账），还是保留本地余额 + 定时镜像对账（两本账，长期必漂移）。
9. **统一的边界是否只到 Cluss**：系统里其余零散分数 / 成就点 / 等级经验是否一并收编为 `honor` 域，还是保持「纯展示、不进账本」。
10. **AI 额度怎么定价**（按 API 成本加成 / 包月 / 按次）：这是决定毛利率的唯一旋钮，也是 P4-B 开工前必须先定的数。
11. **谁承担 AI 成本**（班费 / 家长充值 / 老师垫付）：决定 `ai_cost` 记在谁的账上、以及要不要做用量熔断。
12. **是否允许 `grant` 买 AI 额度**：本文默认禁止（有真实边际成本）；若开放，必须给学期预算上限并绑定已实现毛利。
13. **P2a 先上哪件数字商品**（装扮 / AI 额度 / 报告导出）：装扮运行时已就绪、上线最快；AI 额度客单最高但需先定价。
14. **AI 额度的目标客单价与渗透率**：决定 7.3.2 天花板模型是否成立，需拿两周实测校准。
15. **是否接受把系统推广到其他班 / 学校**：这是唯一能把月收入从百元提到千元量级的变量。
16. **Cluss 是否放弃「充多少用多少」**：这是 AI 额度从流水变利润的唯一分叉。本文推荐 **B′ 不过期次数包 + A 加成定价**（按次不按天，见 7.3.3）；若坚持平价，Cluss 只能当引流入口，收入全部压在 P2a 数字商品上。
17. **加价系数 / 次数包规格与免费次数**：A 路定价 ×1.2~1.5、B′ 路「¥20 买 100 次」这类规格与「前 N 次免费」，决定毛利率与家长接受度；定之前 `cashbook` 先落 `ai_cost` 才有基准。⚠️ **不设有效期**（平板不天天发），余额须可结转 / 可退。
18. **「连续 N 天」改「累计 N 次」的迁移范围**：每日津贴、签到 streak、证券成就、Cluss `weekly_quota` 是计费侧先改，还是一次性全改？全改体验一致但动点多，先改计费侧风险低。
19. **R2 去硬编码的灰度粒度**（主线）：一次性改完 `xueyuan.js` 里 73 处池名引用（快、风险集中），还是按 `post → mint/burn/refund → hold/release/settleHold → audit/health` 分四批（慢、每批可回退）？本文默认分批，逐批与 R1 行为做逐笔比对。

---

## 14. 附录

### 14.1 术语表

| 词 | 定义 |
|---|---|
| 价值域 / Domain | 一组同质的点数负债，由 `backing` + `redemption` 唯一确定其经济性质 |
| 兑付物 / Redemption | 平台承诺最终交付的东西（现金 / 实物 / 虚拟标的 / 服务 / 荣誉） |
| 供给来源 / Backing | 点数从哪来（真钱 / 铸币 / 算法补足 / 外部采购） |
| Sink | 回收出口；把点数从流通中销毁的机制 |
| 桥 / Bridge | 唯一允许跨域价值移动的机制，默认关闭 |
| 可花余额 | `Σ balance[affects_balance=1]`，钱包首页展示的**唯一**余额 |
| 兑付敞口 | 学生随时能提走的人民币总额 = `Σ min(可用 cash, 累计净充值)` |
| 现金储备 | `Σ cashbook.in − Σ cashbook.out`，唯一以人民币计价的余量 |

### 14.2 与现有代码的关键坐标

| 关注点 | 文件 |
|---|---|
| 账本内核 | `server/src/services/xueyuan.js`（`POOL` L39、`post` L480、`hold` L910、`creditTrade` L1206、`health` L1890、`audit` L2040） |
| 学元接口 | `server/src/routes/xueyuan.js`（24 个端点，`requireTreasury`） |
| 钱包门面 | `server/src/routes/wallet.js`（`sourceList()` L117 有 3 处遗留错误文案） |
| 红包 | `server/src/services/yuanbao.js`（`poolSplit` L94、`takeSplit` L111、`create` L151、`claim` L269、`claimRemote` L388） |
| 四池迁移 | `server/src/migrations/030`、`034`、`035` |
| 证券 | `market-apps/stock/backend/{routes,trading,store,achievements}.js` |
| 市场能力声明 | `docs/spec-app-package.md`、`docs/third-party-development.md`、`market-apps/*/manifest.json` |
| Cluss 联邦 | `server/src/services/cluss-bridge.js`、`server/src/routes/cluss-proxy.js`、`apps/cluss/frontend/Cluss.vue` |

### 14.3 上线检查清单

- [ ] 所有 `【设计】` 项已拆成独立任务并排期
- [ ] 每个迁移都先在库副本验证 `audit().ok === true`
- [ ] 新增域满足 9.3 全部八项
- [ ] 现金台账三个数（7.3）逐日对平
- [ ] 645 项既有测试 + 新增测试全绿
- [ ] `scripts/ci-check.mjs` 加了「无硬编码域名 / sink 非空」门禁
- [ ] 管理端「可花 / 封闭 / 可提现」三类标签无歧义
- [ ] `xueyuan.js` 文件头从「双资金池」更新为「价值域注册表」并注明本文路径

---

## 15. 地基归位：单位、契约、跨班真金（2026-11-07 实施）

### 15.1 一句话

之前所有自测都是「服务函数自己调自己」，传的入参恰好是函数声明里那几个字段；
**没有任何测试覆盖「HTTP 路由 / 前端实际发送的字段形状」**。于是三类错误一路全绿进了生产：
路由传 A、服务读 B；接口回执丢字段；两个班各自少记一笔真金。

### 15.2 单位口径：从「两套」收敛为一条链

唯一真相源 `server/src/ledger/units.js`：

```
1 学元     = 100 账本单位      （前端两位小数）
1 人民币元 = 1000 学元          （汇率冻结，永不改写）
⇒ 1 元     = 100000 账本单位
```

旧值 `UNITS_PER_YUAN = 1000` 把**汇率**当成了**单位换算**，于是同一个库里
钱包/充值/红包/限额按 100000 落库，`/api/xy` 的 `amount_yuan`、订单 ¥ 展示、
真金台账 ¥ 报表按 1000 解释，差 100 倍且**不报错**：

- `/api/xy` 充值 1 元只到账 0.01 元；
- 订单面值 1 元显示成 100 元；
- 账本层单笔充值上限被悄悄收紧 100 倍（20 元 → 0.2 元）；
- 管理端把 CASH 余额 1,001,000 单位报成 ¥1001（实际按统一口径是 ¥10.01）。

**归位方式**：把 `UNITS_PER_YUAN` 改成由另外两个常量推导（100000）。
**不重估任何余额、不改任何前端显示数字、不动冻结汇率**；账本原始整数一个字节没动。
门禁：`node server/scripts/ledger-unit-audit.cjs`（退出码非 0 即拦发版）、
`scripts-test-ledger-guard.cjs` ①、`scripts-test-wallet-contract.cjs` ⓪ 三处绊线。

> ⚠️ 遗留待确认：`xy_recharge` 里两条 `rate=100` 的历史记录（合计 `yuan_cents` ¥1001）
> 此前已被标为脏数据（单笔超 `maxRechargeYuan=200`、真实付费 0）。若其中确有真实现金，
> 需要单独做一次负债重估；本次**没有**动任何余额。

### 15.3 契约层（本次新增）

`server/scripts-test-wallet-contract.cjs`：按前端/路由真实字段形状调用服务，
并在同一进程里跑完跨班两阶段（发送方响应 → 领取方入账 → 后台补账）。
它锁住的是「接口之间的约定」，而不是函数内部实现。以后新增钱包接口必须补一条契约用例。

### 15.4 跨班真金必须两边同时记台账

`cashbook` 的 `scope='liability'` 是 I2 的约束对象。CASH 跨班时：

| 班级 | 账本动作 | 台账动作 |
|---|---|---|
| 发送方 | `burn CASH`（账面现金 −x） | `cross_out` −x |
| 领取方 | `mint CASH`（账面现金 +x） | `cross_in` +x |

只记一边，两边 I2 同时对不平；一个都不记，跨班红包会把赠送学元洗成可提现真金。
迁移 `039` 重建 `xy_ledger_cashbook` 放开 `cross_in/cross_out` 两个 type（SQLite 不能 ALTER CHECK）。

### 15.5 本次修复的具体缺陷

| 现象 | 根因 | 文件 |
|---|---|---|
| 提现输入金额就报「必须是整整数分」 | 路由传 `body.amount`（学元），服务只读 `o.yuan`（人民币元）→ `NaN` | `routes/xueyuan.js` / `services/xueyuan.js`（新增 `requireAmountCent`） |
| 别的班红包领不了 | `/packet/info` 里「只有 code 没 phrase 就短路返回不存在」，而跨班拼手气红包恰好只有 6 位码 | `routes/wallet.js` → 统一走 `packetCross.lookup()` |
| 跨班领取后资产错池 | 发送方回执漏传 `cash_cent/grant_cent`，领取方整笔按 CASH 铸造 | `services/packet-cross.js receiveClaim` |
| 补账重复发钱 | `retryOnce` 调 `mintFor` 参数错位，ref 与资产都变 | 迁移 `038` 落 `cash_cent/grant_cent/legacy`，补账复用同一份数据 |
| pid 定位领到本班无关红包 | 两班 `xy_packet.id` 各自自增，撞号常见 | 调用方给出对端 base 时跳过本地查找 |
| 口令红包答案被预览泄漏 | `preview()` 直接回传 `passphrase` | `services/yuanbao.js` 预览改为空串 |
| AA 合计金额显示差 1000 倍 | 输入框标「元」、合计标「学元」，后端按元换算 | 前端统一按学元传 `per` |

### 15.6 上线门禁（每次改学元必跑）

1. `node server/scripts-test-wallet-contract.cjs`（契约）
2. `node server/scripts-test-ledger-guard.cjs`（单位 + 权限）
3. `node server/scripts/ledger-unit-audit.cjs`（口径）
4. `node server/scripts/ledger-retire-check.cjs`（旧账本无回潮）
5. 账本 `invariants.check().ok === true`（I1–I9）
6. `node scripts/build-app.js wallet` + `node scripts/sync-dist-8i.mjs`
7. 双入口 `classintra-server` / `classintra-https` 定点重建（见 `ops.md`），8i 同理
