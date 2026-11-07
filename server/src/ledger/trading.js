// 学元账本 · 证券资金原语
// ============================================================
// 证券只用练习金（PRACTICE）：封闭、不可兑付、不可转账、不可买实物。
// 这里只做资金搬运，不做撮合 —— 撮合、持仓、行情仍在 market-apps/stock。
//
// 账户布局：
//   user:<学号>             可用练习金
//   escrow:trading:<学号>   该用户的挂单冻结（按人分槽，解冻能精确定位）
//   clearing                发行 / 回收对手方
//
// 资金流：
//   冻结 reserve   user → escrow:trading:uid
//   解冻 release   escrow:trading:uid → user
//   买入结算 settleBuy  escrow:trading:uid → clearing(成本+手续费) + user(差额退回)
//   卖出结算 settleSell clearing → user(净额)；手续费不发行（等于回收）
//
// 为什么买入不直接给卖方：证券撮合在 stock 内部完成，买卖双方不一定同时在线，
// 用 clearing 做中央对手方，卖出时再发行给卖方 —— 练习金总量只受发行配额约束，
// 且永远不会流出 practice 域。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var ledger = require('./ledger');
var assets = require('./assets');
var db = require('../utils/db');

function nowIso() { return new Date().toISOString(); }

function escrowIdOf(userId) {
  return ledger.systemAccount('escrow', 'trading:' + String(userId)).id;
}

function clearingId() {
  return ledger.systemAccount('clearing').id;
}

function positiveInt(n, label) {
  if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n <= 0) {
    throw new Error(label + '必须是正整数分');
  }
  return n;
}

function genRef(prefix) {
  return prefix + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8);
}

// 证券视角的账户视图。字段名沿用旧 xueyuan.viewAccount，方便 stock 直接读。
function view(userId) {
  var uid = String(userId == null ? '' : userId);
  var acc = ledger.findAccount('user', uid);
  if (!acc) {
    return {
      user_id: uid, exists: false,
      practice_cent: 0, available_practice_cent: 0, frozen_practice_cent: 0,
      cash_cent: 0, available_cash_cent: 0,
      grant_cent: 0, available_grant_cent: 0,
      balance: 0, practice: 0, cash: 0, grant: 0
    };
  }
  var b = ledger.userBalances(uid);
  var frozen = ledger.balanceOf(escrowIdOf(uid), 'PRACTICE');
  return {
    user_id: uid,
    exists: true,
    // 旧口径：practice_cent 是总额，available 是可用
    practice_cent: b.PRACTICE + frozen,
    available_practice_cent: b.PRACTICE,
    frozen_practice_cent: frozen,
    cash_cent: b.CASH,
    available_cash_cent: b.CASH,
    grant_cent: b.GRANT,
    available_grant_cent: b.GRANT,
    balance: b.CASH + b.GRANT + b.PRACTICE,
    practice: b.PRACTICE,
    cash: b.CASH,
    grant: b.GRANT
  };
}

// 冻结：下单时把练习金移进个人托管槽
function reserve(userId, amountCent, ref, memo) {
  var uid = String(userId);
  var amount = positiveInt(amountCent, '冻结金额');

  var user = ledger.accountOf('user', uid);
  var escrow = escrowIdOf(uid);

  var tx = ledger.post({
    ref: String(ref || genRef('hold')),
    kind: 'order_pay',
    initiator: uid,
    memo: memo || '证券下单冻结',
    entries: [
      { account_id: user.id, asset: 'PRACTICE', direction: -1, amount_cent: amount },
      { account_id: escrow, asset: 'PRACTICE', direction: 1, amount_cent: amount }
    ]
  });

  // 幂等短路意味着「这笔冻结根本没发生」。静默返回会让调用方以为冻结成功，
  // 后续成交结算时才发现托管里没钱 —— 那就是超卖。宁可当场报错。
  if (tx.duplicate) {
    throw new Error('冻结 ref 已被使用，本次冻结未生效: ' + ref);
  }

  return { tx_id: tx.tx_id, duplicate: false, view: view(uid) };
}

// 解冻：撤单 / 废单 / 部分未成交退回
function release(userId, amountCent, ref, memo) {
  var uid = String(userId);
  var amount = positiveInt(amountCent, '解冻金额');
  var escrow = escrowIdOf(uid);

  var tx = ledger.post({
    ref: String(ref || genRef('release')),
    kind: 'order_refund',
    initiator: uid,
    memo: memo || '证券解冻',
    entries: [
      { account_id: escrow, asset: 'PRACTICE', direction: -1, amount_cent: amount },
      { account_id: ledger.accountOf('user', uid).id, asset: 'PRACTICE', direction: 1, amount_cent: amount }
    ]
  });

  if (tx.duplicate) {
    throw new Error('解冻 ref 已被使用，本次解冻未生效: ' + ref);
  }

  return { tx_id: tx.tx_id, duplicate: false, view: view(uid) };
}

// 买入结算：冻结额里扣掉真实成本与手续费，差额退回可用
function settleBuy(opts) {
  var o = opts || {};
  var uid = String(o.userId == null ? o.user_id : o.userId);
  var hold = positiveInt(o.holdCent, '冻结额');
  var cost = Math.max(0, Math.floor(Number(o.costCent) || 0));
  var fee = Math.max(0, Math.floor(Number(o.feeCent) || 0));
  if (cost + fee > hold) throw new Error('成本与手续费超过冻结额（' + cost + '+' + fee + ' > ' + hold + '）');

  var back = hold - cost - fee;
  var escrow = escrowIdOf(uid);
  var userAcc = ledger.accountOf('user', uid).id;
  var base = String(o.ref || genRef('settle'));

  // 两步记账，不是一步净额：
  //   ① 整笔解冻（托管 → 账户）      ② 真正扣款（账户 → 发行方）
  // 一步净额（托管 −冻结、账户 +差额、发行方 +成本）算术上等价，
  // 但学生流水里「买入」那一行会变成**正数**，看起来像赚了钱。
  // 流水的可读性是账本的一部分，不能为了少一条分录牺牲它。
  var out = null;
  var run = db.transaction(function () {
    ledger.post({
      ref: base + ':release',
      kind: 'order_refund',
      initiator: uid,
      memo: '结算解冻',
      entries: [
        { account_id: escrow, asset: 'PRACTICE', direction: -1, amount_cent: hold },
        { account_id: userAcc, asset: 'PRACTICE', direction: 1, amount_cent: hold }
      ]
    });

    if (cost + fee > 0) {
      out = ledger.post({
        ref: base,
        kind: 'order_settle',
        initiator: uid,
        memo: o.memo || '证券买入结算',
        payload: o.meta || null,
        entries: [
          { account_id: userAcc, asset: 'PRACTICE', direction: -1, amount_cent: cost + fee },
          { account_id: clearingId(), asset: 'PRACTICE', direction: 1, amount_cent: cost + fee }
        ]
      });
    }
  });
  run();

  return {
    tx_id: out ? out.tx_id : 0,
    duplicate: out ? out.duplicate : false,
    back_cent: back,
    view: view(uid)
  };
}

// 卖出结算：净额从 clearing 发行给用户；手续费不发行（等于回收）
function settleSell(userId, netCent, opts) {
  var o = opts || {};
  var uid = String(userId);
  var net = positiveInt(netCent, '卖出净额');

  var tx = ledger.post({
    ref: String(o.ref || genRef('sell')),
    kind: 'order_settle',
    initiator: uid,
    memo: o.memo || '证券卖出回款',
    payload: o.meta || null,
    entries: [
      { account_id: clearingId(), asset: 'PRACTICE', direction: -1, amount_cent: net },
      { account_id: ledger.accountOf('user', uid).id, asset: 'PRACTICE', direction: 1, amount_cent: net }
    ]
  });

  return { tx_id: tx.tx_id, duplicate: tx.duplicate, view: view(uid) };
}

// 发行练习金（月度补发 / 教学发放）。练习金不可兑付，所以不走充值配额。
function issue(userId, amountCent, opts) {
  var o = opts || {};
  var uid = String(userId);
  var amount = positiveInt(amountCent, '发放金额');
  assets.assertKnown('PRACTICE');

  var tx = ledger.post({
    ref: String(o.ref || genRef('practice')),
    kind: 'practice',
    initiator: o.operator || 'system',
    memo: o.memo || '发放练习金',
    entries: [
      { account_id: clearingId(), asset: 'PRACTICE', direction: -1, amount_cent: amount },
      { account_id: ledger.accountOf('user', uid).id, asset: 'PRACTICE', direction: 1, amount_cent: amount }
    ]
  });

  return { tx_id: tx.tx_id, duplicate: tx.duplicate, view: view(uid) };
}

// 托管槽总额（对账用）
function escrowTotalCent() {
  return require('../utils/db').prepare([
    'SELECT COALESCE(SUM(b.balance), 0) AS s',
    'FROM xy_ledger_balances b JOIN xy_ledger_accounts a ON a.id = b.account_id',
    "WHERE a.kind = 'escrow' AND a.owner_id LIKE 'trading:%' AND b.asset = 'PRACTICE'"
  ].join('\n')).get().s;
}

module.exports = {
  view: view,
  reserve: reserve,
  release: release,
  settleBuy: settleBuy,
  settleSell: settleSell,
  issue: issue,
  escrowIdOf: escrowIdOf,
  escrowTotalCent: escrowTotalCent,
  nowIso: nowIso,
  genRef: genRef
};
