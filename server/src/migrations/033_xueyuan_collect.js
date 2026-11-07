// 迁移 033：群收款（AA）
//
// ---- 为什么不是「一个人收、系统记账」 ----
// 群收款本质是 N 笔「同学转账」，不是一笔特殊交易。
// 所以钱走的是既有的 xy.transfer（kind='transfer'），每条支付仍然是
// 独立的、可幂等的、受支付密码与当日额度约束的转账；
// 本表只负责「谁该付、付了没有」这件事，不碰记账。
//
// 这是刻意的：任何新玩法一旦自己造一套资金流，风控口径就会分叉
// （参考 2026-11 的「额度只统计 transfer」事故）。
//
// ---- 为什么每人金额固定 ----
// AA 的真实需求是「平摊」，不是「众筹」。固定 per_cent 让状态机极简：
// 只有 pending / paid 两种，没有「部分付款」，也就不需要退款链路。

function up(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_collect (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  creator TEXT NOT NULL,',
    "  title TEXT NOT NULL DEFAULT '',",
    '  per_cent INTEGER NOT NULL,',
    '  total_cent INTEGER NOT NULL,',
    '  paid_cent INTEGER NOT NULL DEFAULT 0,',
    "  status TEXT NOT NULL DEFAULT 'open',",
    '  expires_at INTEGER NOT NULL DEFAULT 0,',
    '  request_id TEXT,',
    '  created_at INTEGER NOT NULL DEFAULT 0,',
    '  closed_at INTEGER NOT NULL DEFAULT 0',
    ')'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_collect_member (',
    '  collect_id INTEGER NOT NULL,',
    '  user_id TEXT NOT NULL,',
    "  status TEXT NOT NULL DEFAULT 'pending',",
    '  tx_id INTEGER,',
    '  paid_at INTEGER NOT NULL DEFAULT 0,',
    '  PRIMARY KEY (collect_id, user_id)',
    ')'
  ].join('\n'));

  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_collect_creator ON xy_collect(creator, id DESC)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_xy_collect_req ON xy_collect(request_id) WHERE request_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_collect_member_user ON xy_collect_member(user_id, collect_id DESC)');
}

module.exports = {
  version: 33,
  name: 'xueyuan_collect',
  up: up
};
