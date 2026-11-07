// 学元账本 · 结算与毛利
// ============================================================
// 只做两件事：算得出「平台在这一单上赚多少」，以及把托管里的钱搬给谁。
//
// 三条规则（改之前先确认）：
// 1. 只有 CASH 订单产生真金收入。GRANT / PRACTICE 订单结算是「权益回收」，
//    钱回 clearing，卖家和平台都不收 —— 因为权益本来就不能兑付。
// 2. 平台毛利：自营 = face − cost；第三方 = fee。返现上限就是这个数（I6/I7）。
// 3. 真实成本（cost）在结算时记 cashbook.pnl，不参与「欠用户多少」。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var db = require('../utils/db');
var ledger = require('./ledger');

function accountRow(id) {
  var row = db.prepare('SELECT * FROM xy_ledger_accounts WHERE id = ?').get(id);
  if (!row) throw new Error('账户不存在: ' + id);
  return row;
}

function escrowId()   { return ledger.systemAccount('escrow', 'orders').id; }
function platformId() { return ledger.systemAccount('platform').id; }
function clearingId() { return ledger.systemAccount('clearing').id; }

function sellerIsPlatform(order) {
  return accountRow(order.seller_account_id).kind === 'platform';
}

function isCash(order) {
  return String(order.asset).toUpperCase() === 'CASH';
}

// 平台在这一单上的真金毛利（分）。非 CASH 订单为 0。
function platformMarginCent(order) {
  if (!isCash(order)) return 0;
  if (sellerIsPlatform(order)) {
    return Math.max(0, order.face_cent - order.cost_cent);
  }
  return Math.max(0, order.fee_cent);
}

function maxRebateCent(order) {
  return platformMarginCent(order);
}

// 赠送学元最多能抵多少（分）——**恒为 0**。
//
// 2026-11-07 定：商品只能用「自己充值的学元」买。
//   · 赚来的（证券撤出）、领到的（津贴 / 成就 / 同学转账 / 红包）都是赠金；
//   · 赠金只能转账、发红包、互相送 —— 那是乐趣，不是购买力；
//   · 否则「印出来的额度」会经由小铺变成实物，这跟当年赠金洗成真钱是同一类漏洞。
//
// 保留这个函数，是因为支付试算接口按它算明细；返回 0 就是规则本身，不是占位。
// 权益订单（asset=GRANT，仅内部补偿单）不走这里，由 paySplitCent 单独处理。
function maxGrantOffsetCent() {
  return 0;
}

// 本单实际托管了哪些资产、各多少（一单可能同时压 CASH + GRANT）
function heldByAsset(orderId) {
  return require('../utils/db').prepare([
    'SELECT asset, COALESCE(SUM(amount_cent), 0) AS amount',
    "FROM xy_ledger_holds WHERE order_id = ? AND state = 'held'",
    'GROUP BY asset'
  ].join('\n')).all(orderId);
}

// 结算分录：按**实际托管**出账，不按面值拍脑袋。
// 托管的资产构成 = 买家真实付了什么；按面值出账会在拆池订单上凭空多出/少掉一笔。
function settleEntries(order) {
  var out = [];
  var cashTotal = 0;

  heldByAsset(order.id).forEach(function (h) {
    var asset = String(h.asset);
    var amount = Number(h.amount) || 0;
    if (amount <= 0) return;
    out.push({ account_id: escrowId(), asset: asset, direction: -1, amount_cent: amount });

    if (asset !== 'CASH') {
      // 赠送学元 / 权益：回收进发行账户，不流向卖家 —— 给谁都不能兑成真钱
      out.push({ account_id: clearingId(), asset: asset, direction: 1, amount_cent: amount });
      return;
    }
    cashTotal += amount;
  });

  if (cashTotal > 0) {
    if (sellerIsPlatform(order)) {
      out.push({ account_id: platformId(), asset: 'CASH', direction: 1, amount_cent: cashTotal });
    } else {
      var fee = Math.min(order.fee_cent, cashTotal);
      var sellerGets = cashTotal - fee;
      if (sellerGets > 0) {
        out.push({ account_id: order.seller_account_id, asset: 'CASH', direction: 1, amount_cent: sellerGets });
      }
      if (fee > 0) {
        out.push({ account_id: platformId(), asset: 'CASH', direction: 1, amount_cent: fee });
      }
    }
  }

  return out;
}

// 退款分录：托管里的每一份都原路退回买家
function refundEntries(order) {
  var out = [];
  heldByAsset(order.id).forEach(function (h) {
    var amount = Number(h.amount) || 0;
    if (amount <= 0) return;
    out.push({ account_id: escrowId(), asset: String(h.asset), direction: -1, amount_cent: amount });
    out.push({ account_id: order.buyer_account_id, asset: String(h.asset), direction: 1, amount_cent: amount });
  });
  return out;
}

// 平台在这一单上真正落袋的现金（分）。结算时按这个数记「收入」台账。
//   自营：收到的真金（赠金部分不计，它本来就不是钱）
//   第三方：抽成
function platformTakeCent(order) {
  if (!isCash(order)) return 0;
  var cashHeld = 0;
  heldByAsset(order.id).forEach(function (h) {
    if (String(h.asset) === 'CASH') cashHeld += Number(h.amount) || 0;
  });
  if (sellerIsPlatform(order)) return cashHeld;
  return Math.min(order.fee_cent, cashHeld);
}

// 平台真实成本是否需要在结算时记账
function realCostCent(order) {
  if (!isCash(order)) return 0;
  if (!sellerIsPlatform(order)) return 0;
  return Math.max(0, order.cost_cent);
}

module.exports = {
  accountRow: accountRow,
  escrowId: escrowId,
  platformId: platformId,
  clearingId: clearingId,
  sellerIsPlatform: sellerIsPlatform,
  isCash: isCash,
  platformMarginCent: platformMarginCent,
  maxRebateCent: maxRebateCent,
  maxGrantOffsetCent: maxGrantOffsetCent,
  platformTakeCent: platformTakeCent,
  heldByAsset: heldByAsset,
  settleEntries: settleEntries,
  refundEntries: refundEntries,
  realCostCent: realCostCent
};
