// 学元账本 · 同学转账
// ============================================================
// 转账只在同一资产内进行，且要求 asset.transferable = 1。
// PRACTICE 不可转账 —— 双轨红包的「练习金」只能通过红包发，不能直接转。
//
// 转账不抽成：任何一次同学间转账收费，都会直接制造资金顾虑。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var ledger = require('../ledger');
var assets = require('../assets');

function transfer(opts) {
  var o = opts || {};
  var cfg = assets.assertKnown(o.asset || 'CASH');
  if (cfg.transferable !== 1) throw new Error(cfg.label + '不可转账');

  var amount = o.amount_cent;
  if (typeof amount !== 'number' || !isFinite(amount) || Math.floor(amount) !== amount || amount <= 0) {
    throw new Error('转账金额必须是正整数分');
  }

  var from = String(o.from == null ? '' : o.from).trim();
  var to = String(o.to == null ? '' : o.to).trim();
  if (!from || !to) throw new Error('转账必须提供双方');
  if (from === to) throw new Error('不能给自己转账');

  var ref = String(o.ref == null ? '' : o.ref).trim();
  if (!ref) throw new Error('转账必须提供 ref');

  var a = ledger.accountOf('user', from);
  var b = ledger.accountOf('user', to);

  var tx = ledger.post({
    ref: ref,
    kind: 'transfer',
    initiator: from,
    memo: o.memo || '同学转账',
    entries: [
      { account_id: a.id, asset: cfg.asset, direction: -1, amount_cent: amount },
      { account_id: b.id, asset: cfg.asset, direction: 1, amount_cent: amount }
    ]
  });

  return {
    tx_id: tx.tx_id,
    duplicate: tx.duplicate,
    asset: cfg.asset,
    from_balance: ledger.balanceOf(a.id, cfg.asset),
    to_balance: ledger.balanceOf(b.id, cfg.asset)
  };
}

module.exports = { transfer: transfer };
