// 迁移 038：跨班红包 pending 记录保存「按资产拆分」
//
// ---- 为什么 ----
// 领取方班级在拿到对端回执后，先落一条 status=assigned 的 pending，再 mint 入账。
// 如果 mint 失败（进程重启 / 库锁），后台 retryOnce() 要能按当初的拆分补账。
// 旧表只存了 amount_cent，补账时又传错了 mintFor 的参数顺序，于是：
//   · 整笔被当成 CASH 铸造（赠送学元变成可提现）
//   · ref 不带 :cash/:grant 后缀，幂等失效，补一次就多发一次钱
// 现在把 cash_cent / grant_cent / legacy 一起落库，补账与首轮入账用同一份数据。
//
// 幂等：先查列再 ALTER，重复执行无副作用。
// 编码约定：var / function（服务端 CommonJS 风格）

var COLUMNS = [
  ['cash_cent', 'INTEGER NOT NULL DEFAULT 0'],
  ['grant_cent', 'INTEGER NOT NULL DEFAULT 0'],
  ['legacy', 'INTEGER NOT NULL DEFAULT 0']
];

function up(db) {
  var exists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='xy_cross_packet'"
  ).get();
  if (!exists) return;   // 表由 packet-cross.ensure() 首次使用时按新结构创建

  var cols = db.prepare('PRAGMA table_info(xy_cross_packet)').all().map(function (c) { return c.name; });
  for (var i = 0; i < COLUMNS.length; i++) {
    if (cols.indexOf(COLUMNS[i][0]) === -1) {
      db.exec('ALTER TABLE xy_cross_packet ADD COLUMN ' + COLUMNS[i][0] + ' ' + COLUMNS[i][1]);
    }
  }
}

module.exports = { version: 38, name: 'cross_packet_asset_split', up: up };
