// 迁移 037：托管唯一键改成 (order_id, asset)
//
// ---- 为什么 ----
// 学元有两条购买力：CASH（真金）和 GRANT（赠送额度）。设计里的 I4 是
// 「赠送抵扣 ≤ 本单毛利」—— 也就是一单里可能同时压着两种资产：
//   面值 100 元、成本 30 元 → 最多 70 元可以用赠金抵，剩下 30 元必须真金。
// 旧唯一索引是 `UNIQUE(order_id) WHERE state='held'`，一条订单只允许一条托管，
// 于是这种订单根本插不进去 —— 制度写了，代码挡住了。
//
// 改成 (order_id, asset) 之后，一单最多两条 held（CASH 一条、GRANT 一条），
// 既保留了「同一资产不能重复托管」的约束，又允许拆池。
//
// 幂等：先 DROP 再 CREATE，重复执行无副作用。
// 编码约定：var / function（服务端 CommonJS 风格）

function up(db) {
  db.exec('DROP INDEX IF EXISTS uq_xy_ledger_holds_active');
  db.exec([
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_xy_ledger_holds_active',
    "ON xy_ledger_holds(order_id, asset) WHERE state = 'held'"
  ].join(' '));
}

module.exports = { version: 37, name: 'ledger_holds_split_asset', up: up };
