// 学元账本 · 商品
// ============================================================
// 第一版只有平台自营（seller_account_id = platform）；第三方卖家只要
// 传 seller 学号就能上架，无需改表、无需迁移（seller_account_id 已留好）。
//
// 数字品 cost_cent = 0，这是毛利最高的品类，也不吃设备发放节奏。

var db = require('../utils/db');
var ledger = require('./ledger');

function q(sql) { return db.prepare(sql); }

var KINDS = ['digital', 'physical', 'service'];
var STATUS = ['on_shelf', 'off_shelf'];

// 同学卖家直接用本人 user 账户收款（不另建 seller 账户），
// 否则「卖出去的钱」会落在一个钱包页看不到的账户里。
// kind='seller' 留给未来的机构 / 社团店铺。
function create(opts) {
  var o = opts || {};
  var name = String(o.name == null ? '' : o.name).trim();
  if (!name) throw new Error('商品名称不能为空');

  var price = Number(o.price_cent);
  if (!isFinite(price) || Math.floor(price) !== price || price < 0) throw new Error('商品价格必须是非负整数分');

  var cost = Math.max(0, Math.floor(Number(o.cost_cent) || 0));
  if (cost > 0 && cost > price) {
    // 允许亏本卖，但必须显式确认 —— 否则「售价低于成本」会被当成配置错误
    if (!o.allowLoss) throw new Error('成本高于售价，确认亏本销售请传 allowLoss=true');
  }

  var kind = String(o.kind || 'digital');
  if (KINDS.indexOf(kind) === -1) throw new Error('未知商品类型: ' + kind);

  var seller = (o.seller && String(o.seller) !== 'platform')
    ? ledger.accountOf('user', o.seller)
    : ledger.systemAccount('platform');

  var info = q([
    'INSERT INTO xy_ledger_goods (seller_account_id, name, price_cent, cost_cent, kind, status)',
    "VALUES (?, ?, ?, ?, ?, 'on_shelf')"
  ].join(' ')).run(seller.id, name, price, cost, kind);

  return get(Number(info.lastInsertRowid));
}

function get(id) {
  var row = q([
    'SELECT g.*, a.kind AS seller_kind, a.owner_id AS seller_owner',
    'FROM xy_ledger_goods g JOIN xy_ledger_accounts a ON a.id = g.seller_account_id',
    'WHERE g.id = ?'
  ].join('\n')).get(id);
  if (!row) throw new Error('商品不存在: ' + id);
  return row;
}

function list(opts) {
  var o = opts || {};
  var where = [];
  var args = [];
  if (o.status) { where.push('g.status = ?'); args.push(String(o.status)); }
  if (o.seller && String(o.seller) !== 'platform') {
    var s = ledger.findAccount('user', o.seller);
    if (!s) return [];
    where.push('g.seller_account_id = ?');
    args.push(s.id);
  }
  var limit = Math.min(Math.max(parseInt(o.limit, 10) || 50, 1), 200);
  args.push(limit);

  var sql = [
    'SELECT g.*, a.kind AS seller_kind, a.owner_id AS seller_owner',
    'FROM xy_ledger_goods g JOIN xy_ledger_accounts a ON a.id = g.seller_account_id',
    where.length ? 'WHERE ' + where.join(' AND ') : '',
    'ORDER BY g.id DESC LIMIT ?'
  ].filter(Boolean).join('\n');
  return q(sql).all(...args);
}

function setStatus(id, status) {
  var st = String(status || '');
  if (STATUS.indexOf(st) === -1) throw new Error('未知商品状态: ' + st);
  get(id);
  q('UPDATE xy_ledger_goods SET status = ? WHERE id = ?').run(st, id);
  return get(id);
}

module.exports = {
  KINDS: KINDS,
  STATUS: STATUS,
  create: create,
  get: get,
  list: list,
  setStatus: setStatus
};
