// 迁移 045：班级集市 v2（库存 / 数量 / 商品描述）
//
// 旧商品是「无限量」的，订单也只记面值不记数量；退款时无法把库存还回去。
// 这次补上：
//   goods.stock_qty  -1=不限量，>=0=真实库存；下单即占用，关单/退款归还
//   goods.sold_qty   成交后累计（结算时 +qty）
//   goods.description / cover  商品说明与封面字符（emoji）
//   orders.qty       本单数量（退款/统计都靠它）
//   orders.note      买家备注（取货地点/时间等）
// 老数据：库存默认 -1（不限量），数量按「面值 / 单价」回填，销量按已结算订单回填。
// 幂等：列已存在跳过；回填只在对应列刚补上时执行一次。
// 编码约定：var / function（服务端 CommonJS 风格）

function hasCol(db, table, col) {
  var rows = db.prepare('PRAGMA table_info(' + table + ')').all();
  for (var i = 0; i < rows.length; i++) if (rows[i].name === col) return true;
  return false;
}

function addCol(db, table, col, ddl) {
  if (hasCol(db, table, col)) return false;
  db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + ddl);
  return true;
}

function up(db) {
  addCol(db, 'xy_ledger_goods', 'description', "description TEXT NOT NULL DEFAULT ''");
  addCol(db, 'xy_ledger_goods', 'cover', "cover TEXT NOT NULL DEFAULT ''");
  addCol(db, 'xy_ledger_goods', 'stock_qty', 'stock_qty INTEGER NOT NULL DEFAULT -1');
  addCol(db, 'xy_ledger_goods', 'sold_qty', 'sold_qty INTEGER NOT NULL DEFAULT 0');

  var qtyAdded = addCol(db, 'xy_ledger_orders', 'qty', 'qty INTEGER NOT NULL DEFAULT 1');
  addCol(db, 'xy_ledger_orders', 'note', "note TEXT NOT NULL DEFAULT ''");

  // 回填历史订单数量：有商品且单价 > 0 时按面值/单价反推
  if (qtyAdded) {
    var rows = db.prepare([
      'SELECT o.id, o.face_cent, g.price_cent',
      'FROM xy_ledger_orders o JOIN xy_ledger_goods g ON g.id = o.goods_id',
      'WHERE g.price_cent > 0'
    ].join(' ')).all();
    var upd = db.prepare('UPDATE xy_ledger_orders SET qty = ? WHERE id = ?');
    rows.forEach(function (r) {
      var q = Math.max(1, Math.round(Number(r.face_cent) / Number(r.price_cent)));
      upd.run(q, r.id);
    });
  }

  // 已结算订单计入销量（历史商品没有销量字段，先归零再汇总）
  db.exec('UPDATE xy_ledger_goods SET sold_qty = 0');
  var sold = db.prepare([
    "SELECT goods_id, COALESCE(SUM(qty), 0) AS n",
    "FROM xy_ledger_orders WHERE status = 'done' AND goods_id IS NOT NULL GROUP BY goods_id"
  ].join(' ')).all();
  var supd = db.prepare('UPDATE xy_ledger_goods SET sold_qty = ? WHERE id = ?');
  sold.forEach(function (r) { supd.run(Number(r.n) || 0, r.goods_id); });
}

module.exports = { version: 45, name: 'market_goods_v2', up: up };
