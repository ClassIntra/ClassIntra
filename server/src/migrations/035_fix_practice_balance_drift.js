// 迁移 035：修复 034 引入的账本不一致
//
// ---- 034 犯了两个错 ----
// 1) 只改 xy_account 的列（grant→practice），没有写 xy_entry 分录。
//    结果余额躺在 practice 列，流水还记在 grant 池 —— audit 的 pool_drift 立刻报错。
// 2) 改 grant_balance 时没同步改 balance。而 balance 的定义是 cash + grant，
//    于是「可花余额」虚高，audit 报 circulation_leak，个别账户出现负余额。
//
// ---- 本迁移怎么修 ----
// 对每个「练习金余额 > 练习金流水」的账户：
//   a. 补一笔内部调账交易（kind='adjust'）：grant 池 -diff，practice 池 +diff
//      —— 分录补齐，两边的池汇总与余额就对齐了。
//   b. 只补 xy_entry，不再动余额：余额在 034 里已经搬到位了，
//      再动一次会变成负数。这条调账记的是「已经发生的事实」，不是新操作。
//   c. 最后重算 balance = cash + grant，把虚高一次性抹平。
//
// 为什么不重跑 034：migration-runner 按版本号记录，已执行不会重跑；
// 而且 034 的搬迁已被后续交易叠加，重跑无法还原当时状态。

function up(db) {
  var users = db.prepare([
    'SELECT a.user_id, a.practice_balance,',
    "  COALESCE((SELECT SUM(e.delta) FROM xy_entry e WHERE e.user_id = a.user_id AND e.pool = 'practice'), 0) AS practice_sum",
    "FROM xy_account a WHERE a.user_id NOT LIKE '@%' AND a.practice_balance > 0"
  ].join(' ')).all();

  var now = Date.now();
  var fixed = 0;
  var total = 0;

  var txInsert = db.prepare([
    'INSERT INTO xy_tx (ref, kind, app_name, operator, memo, amount, meta_json, created_at)',
    "VALUES (?, 'adjust', NULL, NULL, ?, ?, ?, ?)"
  ].join(' '));
  var entryInsert = db.prepare([
    'INSERT INTO xy_entry (tx_id, user_id, delta, pool, balance_after, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?)'
  ].join(' '));

  db.transaction(function () {
    users.forEach(function (u) {
      var diff = Number(u.practice_balance) - Number(u.practice_sum);
      if (diff <= 0) return;   // 流水已经对上，不需要补

      var info = txInsert.run(
        'mig35:practice:' + u.user_id,
        '练习金分池调账：把历史上误记在赠送池的 ' + (diff / 100).toFixed(0) + ' 学元转入练习金池',
        diff,
        JSON.stringify({ user_id: u.user_id, diff: diff, from: 'grant', to: 'practice' }),
        now
      );
      var txId = Number(info.lastInsertRowid);

      // 余额已经是调账后的状态，所以这里只写分录、不再 UPDATE 账户
      entryInsert.run(txId, u.user_id, -diff, 'grant', 0, now);
      entryInsert.run(txId, u.user_id, diff, 'practice', Number(u.practice_balance), now);
      fixed++;
      total += diff;
    });
  })();

  // balance 必须恒等于 cash + grant（练习金不计入可花余额）
  var r = db.prepare([
    'UPDATE xy_account SET balance = cash_balance + grant_balance, updated_at = ?',
    "WHERE user_id NOT LIKE '@%' AND balance <> cash_balance + grant_balance"
  ].join(' ')).run(now);

  // 冻结额跟着钱走：034 搬走 grant 时，被冻结的那部分也跟着少了，
  // 于是出现 frozen_grant > grant_balance（冻结额大于余额，audit 直接判不自洽）。
  // 把它挪到 frozen_practice：钱现在在练习金池，冻结也该在练习金池。
  // frozen 是「可花余额的冻结总额」，不含练习金，所以要同步减。
  var fr = db.prepare([
    'UPDATE xy_account SET',
    '  frozen_practice = frozen_practice + (frozen_grant - grant_balance),',
    '  frozen = MAX(0, frozen - (frozen_grant - grant_balance)),',
    '  frozen_grant = grant_balance, updated_at = ?',
    "WHERE user_id NOT LIKE '@%' AND frozen_grant > grant_balance"
  ].join(' ')).run(now);

  console.log('[migration 035] 补调账 ' + fixed + ' 个账户（' + (total / 100).toFixed(0) +
    ' 学元）；重算 balance 修正 ' + r.changes + ' 个账户；迁移超额冻结 ' + fr.changes + ' 个账户');
}

module.exports = {
  version: 35,
  name: 'fix_practice_balance_drift',
  up: up
};
