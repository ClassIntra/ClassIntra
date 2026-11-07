// 迁移 032：线下充值可撤回
//
// ---- 为什么要"撤回"而不是"扣款" ----
// 班管录错金额、家长临时要退、学生转班……这些都不是"处罚"，而是"撤销一笔业务"。
// 用 admin_deduct（教师扣减）来做会导致两个后果：
//   1) 学生流水里出现一条"被扣钱"，家长会问「凭什么扣我孩子的钱」
//   2) 累计净充值（netRechargeCent）不减，那笔钱仍被算作"他交过的学费"，
//      提现额度、学期充值配额都会被永久占住 —— 录错一次，额度就少一块
// 所以撤回必须是一条**独立业务**：新的 kind、独立的 ref、在 xy_recharge 上留痕。
//
// ---- 为什么留痕放在 xy_recharge 而不是另建表 ----
// 撤回永远只作用于"某一笔充值"，一对一。放同表能保证「一笔充值最多撤回一次」
// 由唯一索引 + 条件更新实现，不需要分布式约束。
// revoke_tx_id 指回那张冲账流水，事后可以从任一方向追到对方。

function up(db) {
  var cols = [
    ['revoked_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['revoked_by', 'TEXT'],
    ['revoke_reason', 'TEXT'],
    ['revoke_tx_id', 'INTEGER']
  ];
  cols.forEach(function (c) {
    try {
      db.exec('ALTER TABLE xy_recharge ADD COLUMN ' + c[0] + ' ' + c[1]);
    } catch (e) {
      // 幂等：字段已存在就跳过，允许重复执行
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  });
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_recharge_revoked ON xy_recharge(revoked_at)');
}

module.exports = {
  version: 32,
  name: 'xueyuan_recharge_revoke',
  up: up
};
