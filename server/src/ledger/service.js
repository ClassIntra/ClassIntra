// 学元账本 · 服务门面
// ============================================================
// 路由层只依赖本文件，不直接拼分录。所有业务模板从这里导出。
//
// ⚠️ ensureReady() **不会自动建表**：建表必须显式跑 `node server/scripts/ledger-init.cjs`。
//    原因：PM2 重启会重新执行进程内代码，自动建表等于把 DDL 变成隐式启动副作用。

var db = require('../utils/db');
var assets = require('./assets');
var ledger = require('./ledger');
var cashbook = require('./cashbook');
var invariants = require('./invariants');
var orders = require('./orders');
var goods = require('./goods');
var settlement = require('./settlement');
var recharge = require('./templates/recharge');
var grant = require('./templates/grant');
var transfer = require('./templates/transfer');
var rebate = require('./templates/rebate');

function schemaReady() {
  var row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_ledger_assets'").get();
  return !!row;
}

function ensureReady() {
  if (!schemaReady()) {
    throw new Error('学元账本 尚未建表，请先运行：node server/scripts/ledger-init.cjs');
  }
  assets.seed(db);
  ledger.systemAccount('platform');
  ledger.systemAccount('escrow', 'orders');
  ledger.systemAccount('clearing');
  return true;
}

function seedAssets() {
  if (!schemaReady()) throw new Error('学元账本 尚未建表');
  return assets.seed(db);
}

function balanceOf(userId) {
  return ledger.userBalances(userId);
}

module.exports = {
  schemaReady: schemaReady,
  ensureReady: ensureReady,
  seedAssets: seedAssets,
  balanceOf: balanceOf,

  assets: assets,
  ledger: ledger,
  cashbook: cashbook,
  invariants: invariants,
  orders: orders,
  goods: goods,
  settlement: settlement,

  recharge: recharge.recharge,
  withdraw: recharge.withdraw,
  issue: grant.issue,
  transfer: transfer.transfer,
  rebate: rebate
};
