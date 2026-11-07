// 学元账本 · 返现
// ============================================================
// 返现只能从**已实现的毛利**里出，且只能对已完成的订单执行一次。
//   GRANT 返现：clearing 发行给买家，不动真金（推荐，未成年人不打真钱）
//   CASH  返现：platform 余额转给买家，是真金流出
//
// 上限 = settlement.platformMarginCent(order)
//   自营 CASH 单 = face − cost
//   第三方 CASH 单 = fee
//   权益单 = 0（本来就没有真金收入）
//
// 编码约定：var / function（服务端 CommonJS 风格）

var ledger = require('../ledger');
var assets = require('../assets');
var orders = require('../orders');
var settlement = require('../settlement');
var db = require('../../utils/db');

function give(opts) {
  var o = opts || {};
  var order = orders.get(o.orderId);
  if (order.status !== 'done') throw new Error('只有已完成订单可以返现（当前 ' + order.status + '）');

  var cfg = assets.assertKnown(o.asset || 'GRANT');
  if (cfg.redeemable === 1 && cfg.asset !== 'CASH') throw new Error('不支持的返现资产: ' + cfg.asset);

  var amount = o.amount_cent;
  if (typeof amount !== 'number' || !isFinite(amount) || Math.floor(amount) !== amount || amount <= 0) {
    throw new Error('返现金额必须是正整数分');
  }

  var cap = settlement.maxRebateCent(order);
  if (cap <= 0) throw new Error('该订单没有可实现毛利，不能返现');
  if (amount > cap) throw new Error('返现不能超过本单毛利（上限 ' + cap + ' 分）');

  var ref = String(o.ref || (order.ref + ':rebate'));

  // 只能执行一次：同一订单的返现 ref 固定
  var prior = db.prepare("SELECT 1 AS x FROM xy_ledger_transactions WHERE ref = ?").get(ref);
  if (prior) throw new Error('该订单已返现过');

  var entries;
  if (cfg.asset === 'CASH') {
    entries = [
      { account_id: settlement.platformId(), asset: 'CASH', direction: -1, amount_cent: amount },
      { account_id: order.buyer_account_id, asset: 'CASH', direction: 1, amount_cent: amount }
    ];
  } else {
    entries = [
      { account_id: settlement.clearingId(), asset: cfg.asset, direction: -1, amount_cent: amount },
      { account_id: order.buyer_account_id, asset: cfg.asset, direction: 1, amount_cent: amount }
    ];
  }

  var tx = ledger.post({
    ref: ref,
    kind: 'rebate',
    initiator: 'system',
    memo: '订单返现 #' + order.id,
    entries: entries
  });

  return {
    tx_id: tx.tx_id,
    asset: cfg.asset,
    amount_cent: amount,
    cap_cent: cap,
    balance: ledger.balanceOf(order.buyer_account_id, cfg.asset)
  };
}

// 预览：这一单最多能返多少
function preview(orderId) {
  var order = orders.get(orderId);
  return {
    order_id: order.id,
    status: order.status,
    face_cent: order.face_cent,
    cost_cent: order.cost_cent,
    fee_cent: order.fee_cent,
    margin_cent: settlement.platformMarginCent(order),
    max_rebate_cent: settlement.maxRebateCent(order)
  };
}

module.exports = { give: give, preview: preview };
