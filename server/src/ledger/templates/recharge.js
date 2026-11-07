// 学元账本 · 充值 / 提现
// ============================================================
// 充值 = 收到真金、同时欠用户等额 CASH（负债，不是收入）。
// 提现 = 退还真金、等额冲减负债。
//
// 额度是「小额预存」而不是储值卡：默认单笔上限 20 元。
// 想提高就把 maxCent 显式传进来 —— 不提供任何「绕过」入口。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var ledger = require('../ledger');
var cashbook = require('../cashbook');
var units = require('../units');

// 单笔上限 20 元 = 20 × UNITS_PER_YUAN(100000) = 2000000 账本单位。
// ⚠️ 旧值 2000 是归位前拿「人民币分」当「账本单位」用，实际只放开 2 分钱，与注释矛盾，已修。
var MAX_RECHARGE_CENT = 20 * units.UNITS_PER_YUAN;
var MAX_WITHDRAW_CENT = 20 * units.UNITS_PER_YUAN;
var MIN_CENT = 1;

function positiveInt(n, label) {
  if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n <= 0) {
    throw new Error(label + '必须是正整数分');
  }
  return n;
}

function recharge(opts) {
  var o = opts || {};
  var amount = positiveInt(o.amount_cent, '充值金额');
  var max = o.maxCent == null ? MAX_RECHARGE_CENT : positiveInt(o.maxCent, '充值上限');
  if (amount > max) throw new Error('单笔充值不能超过 ' + max + ' 分（小额预存）');
  if (amount < MIN_CENT) throw new Error('充值金额太小');

  var ref = String(o.ref == null ? '' : o.ref).trim();
  if (!ref) throw new Error('充值必须提供 ref');

  var user = ledger.accountOf('user', o.to);
  var clearing = ledger.systemAccount('clearing');

  var tx = ledger.post({
    ref: ref,
    kind: 'recharge',
    initiator: o.operator == null ? String(o.to) : String(o.operator),
    memo: o.memo || '线下充值',
    entries: [
      { account_id: clearing.id, asset: 'CASH', direction: -1, amount_cent: amount },
      { account_id: user.id, asset: 'CASH', direction: 1, amount_cent: amount }
    ]
  });

  if (!tx.duplicate) {
    cashbook.record({
      tx_id: tx.tx_id,
      type: 'recharge',
      amount_cent: amount,
      ref: ref + ':cash',
      note: o.memo || '线下充值'
    });
  }
  return { tx_id: tx.tx_id, duplicate: tx.duplicate, balance: ledger.balanceOf(user.id, 'CASH') };
}

function withdraw(opts) {
  var o = opts || {};
  var amount = positiveInt(o.amount_cent, '提现金额');
  var max = o.maxCent == null ? MAX_WITHDRAW_CENT : positiveInt(o.maxCent, '提现上限');
  if (amount > max) throw new Error('单笔提现不能超过 ' + max + ' 分');

  var ref = String(o.ref == null ? '' : o.ref).trim();
  if (!ref) throw new Error('提现必须提供 ref');

  var user = ledger.accountOf('user', o.from);
  var clearing = ledger.systemAccount('clearing');

  var tx = ledger.post({
    ref: ref,
    kind: 'withdraw',
    initiator: String(o.from),
    memo: o.memo || '提现',
    entries: [
      { account_id: user.id, asset: 'CASH', direction: -1, amount_cent: amount },
      { account_id: clearing.id, asset: 'CASH', direction: 1, amount_cent: amount }
    ]
  });

  if (!tx.duplicate) {
    cashbook.record({
      tx_id: tx.tx_id,
      type: 'refund',
      amount_cent: -amount,
      ref: ref + ':cash',
      note: o.memo || '提现'
    });
  }
  return { tx_id: tx.tx_id, duplicate: tx.duplicate, balance: ledger.balanceOf(user.id, 'CASH') };
}

module.exports = {
  MAX_RECHARGE_CENT: MAX_RECHARGE_CENT,
  MAX_WITHDRAW_CENT: MAX_WITHDRAW_CENT,
  recharge: recharge,
  withdraw: withdraw
};
