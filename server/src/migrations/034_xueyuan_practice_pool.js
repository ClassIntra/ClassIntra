// 迁移 034：练习金独立成池（第四池 practice）
//
// ---- 为什么要分池 ----
// 在这之前，证券的「投资练习金」和教师发的奖励共用同一个 grant 池。
// 后果是：练习金可以直接转账给同学、发红包、在网店买东西。
// 于是一次性补发 87 万学元练习金，等于往消费市场里灌了 876 元等值的购买力，
// 而全班真实充值只有 100 元 —— 赠送池变成真金的 5.8 倍，钱当然不值钱。
//
// 分池之后：
//   cash      充值学元    可消费、可提现（受净充值上限约束）
//   grant     赠送学元    可消费，不可提现（教师奖励、开户礼金）
//   practice  练习金      只能在证券里买卖，不能转账、不能发红包、不能买货
//
// ---- 为什么 balance 不把 practice 算进去 ----
// balance 是「可花的总余额」，钱包首页直接展示它。如果练习金算进去，
// 一个学生钱包会显示 30,142 学元，而实际只能花 142 —— 这是误导。
// 所以 practice 独立记账：账本守恒由 balance + practice_balance 一起保证。
//
// ---- 为什么历史数据只搬 min(领取额, 现有 grant) ----
// 练习金进 grant 之后可能已被转走或花掉，无法逐笔追溯。
// 取两者较小值是唯一不会把余额搬成负数的做法；
// 搬不干净的差额留在 grant 里（等同于把历史练习金当成普通赠送学元），
// 属于一次性过渡的已知让步。证券侧随后会按需补足到目标额度。

function up(db) {
  var cols = [
    ['practice_balance', 'INTEGER NOT NULL DEFAULT 0'],
    ['frozen_practice', 'INTEGER NOT NULL DEFAULT 0']
  ];
  cols.forEach(function (c) {
    try {
      db.exec('ALTER TABLE xy_account ADD COLUMN ' + c[0] + ' ' + c[1]);
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  });

  // 统计每个用户历史上领到的练习金总额
  var rows = db.prepare([
    'SELECT e.user_id AS uid, SUM(e.delta) AS granted',
    'FROM xy_entry e JOIN xy_tx t ON t.id = e.tx_id',
    "WHERE t.ref LIKE 'stock:practice:%' AND e.delta > 0",
    'GROUP BY e.user_id'
  ].join('\n')).all();

  var moved = 0;
  var accounts = 0;
  // 注意：balance = cash_balance + grant_balance（balance 不含 practice）。
  // 所以 grant 减多少，balance 就必须减多少 —— 只改 grant 不改 balance
  // 会让「可花余额」凭空变多，audit 立刻报 circulation_leak。
  var stmt = db.prepare([
    'UPDATE xy_account SET practice_balance = practice_balance + ?,',
    'grant_balance = grant_balance - ?, balance = balance - ?, updated_at = ?',
    'WHERE user_id = ? AND grant_balance >= ? AND user_id NOT LIKE ?'
  ].join(' '));

  db.transaction(function () {
    rows.forEach(function (r) {
      var acc = db.prepare('SELECT grant_balance FROM xy_account WHERE user_id = ?').get(r.uid);
      if (!acc) return;
      var move = Math.min(Number(r.granted) || 0, Number(acc.grant_balance) || 0);
      if (move <= 0) return;
      var n = stmt.run(move, move, move, Date.now(), r.uid, move, '@%');
      if (n.changes) {
        moved += move;
        accounts++;
      }
    });
  })();

  // 迁移留痕：事后能回答「这批练习金是什么时候从 grant 搬到 practice 的」
  console.log('[migration 034] 练习金分池：' + accounts + ' 个账户，共搬 ' +
    (moved / 100).toFixed(0) + ' 学元');
}

module.exports = {
  version: 34,
  name: 'xueyuan_practice_pool',
  up: up
};
