// 学元账本 · 第三方应用能力面
// ============================================================
// 分层约定：
//   apps/          系统应用（钱包、管理端）→ 直接调 src/ledger/*，可访问全部资产
//   market-apps/   第三方应用（证券、桌宠…）→ 只能调本文件，且**只能碰 PRACTICE**
//
// 为什么要有这一层：第三方应用和主进程同进程，直接 require 内部服务就能
// 拿到 CASH / GRANT，等于把「印钱」和「提现」的钥匙交给插件。这里把能力
// 收窄成「练习金 + 自己域内的结算」，资产名写死，不暴露 asset 参数。
//
// ⚠️ 唯一例外是 invest()：学生要把赠金投进沙盘、把赚的撤出到钱包花。
//    这是唯一允许触碰 GRANT 的能力，且被写死成三条：只改本人账户、
//    只在 GRANT ⇄ PRACTICE 之间、CASH 永不参与。第三方仍然拿不到 CASH，
//    也不能指定收款方。放在能力面里而不是让应用直连 /api/xueyuan/*，
//    是为了让平台能审计、限流、随时收回这条通道。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var ledger = require('./ledger');
var trading = require('./trading');
var invest = require('./invest');

// 已接入的第三方应用白名单。新增应用要在这里显式登记。
var APPS = {
  stock: { label: '学元证券', asset: 'PRACTICE' }
};

function assertApp(appId) {
  var id = String(appId || '').trim();
  var cfg = APPS[id];
  if (!cfg) throw new Error('未登记的第三方应用: ' + (id || '(空)'));
  return { id: id, cfg: cfg };
}

function traderAccount(appId, userId) {
  var a = assertApp(appId);
  if (!ledger.findAccount('user', userId)) {
    throw new Error('账户不存在，请先开户: ' + userId);
  }
  return a;
}

// 练习金视图：字段名与旧 xueyuan.viewAccount 对齐，方便应用少改
function practiceAccount(appId, userId) {
  assertApp(appId);
  var uid = String(userId == null ? '' : userId);
  var acc = ledger.findAccount('user', uid);
  if (!acc) {
    return {
      user_id: uid, exists: false,
      practice_cent: 0, available_practice_cent: 0, frozen_practice_cent: 0,
      cash_cent: 0, grant_cent: 0, balance: 0
    };
  }
  var b = ledger.userBalances(uid);
  var frozen = ledger.balanceOf(trading.escrowIdOf(uid), 'PRACTICE');
  return {
    user_id: uid,
    exists: true,
    practice_cent: b.PRACTICE + frozen,
    available_practice_cent: b.PRACTICE,
    frozen_practice_cent: frozen,
    // 第三方拿不到真钱口径：这两个字段恒为 0，避免应用误用
    cash_cent: 0,
    grant_cent: 0,
    balance: b.PRACTICE
  };
}

function ensureTrader(appId, userId) {
  assertApp(appId);
  var existed = !!ledger.findAccount('user', userId);
  ledger.openUser(userId);
  return { created: !existed, account: practiceAccount(appId, userId) };
}

function reserve(appId, userId, amountCent, ref, memo) {
  traderAccount(appId, userId);
  return trading.reserve(userId, amountCent, ref, memo);
}

function release(appId, userId, amountCent, ref, memo) {
  traderAccount(appId, userId);
  return trading.release(userId, amountCent, ref, memo);
}

function settleBuy(appId, opts) {
  var o = opts || {};
  traderAccount(appId, o.userId);
  var r = trading.settleBuy({
    userId: o.userId,
    holdCent: o.holdCent,
    costCent: o.costCent,
    feeCent: o.feeCent,
    ref: o.ref,
    memo: o.memo,
    meta: { app: String(appId) }
  });
  // 兼容旧口径：证券要按「成本来自哪个池」记持仓。
  // 第三方只能拿到练习金，所以成本恒为 practice。
  r.spent = {
    cash_cent: 0,
    grant_cent: 0,
    practice_cent: Math.max(0, Math.floor(Number(o.costCent) || 0))
  };
  return r;
}

function settleSell(appId, userId, netCent, opts) {
  var o = opts || {};
  traderAccount(appId, userId);
  return trading.settleSell(userId, netCent, {
    ref: o.ref,
    memo: o.memo,
    meta: { app: String(appId) }
  });
}

// 发行练习金：练习金不可兑付，不占用充值配额，但必须带稳定 ref（月度补发）
function issue(appId, userId, amountCent, ref, memo) {
  var a = traderAccount(appId, userId);
  if (a.cfg.asset !== 'PRACTICE') throw new Error('该应用不允许发行资产');
  var r = trading.issue(userId, amountCent, {
    ref: ref,
    operator: 'app:' + a.id,
    memo: memo
  });
  r.view = practiceAccount(appId, userId);
  return r;
}

var KIND_LABEL = {
  practice: '练习金发放',
  order_pay: '买入冻结',
  order_settle: '交易结算',
  order_refund: '解冻退回',
  adjust: '账目调整'
};

// 流水：**返回 { list, next_before_id }**，与 wallet 的 /ledger 同形。
// 第三方应用的前端是按这个形状写的（列表 + 滚动加载游标 + 每行余额快照），
// 直接甩一个裸数组会让「有流水」变成 0 条 —— 契约比实现更容易被踩坏。
function history(appId, userId, limit, beforeId) {
  assertApp(appId);
  var acc = ledger.findAccount('user', userId);
  if (!acc) return { list: [], next_before_id: 0 };
  var n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  var before = parseInt(beforeId, 10) || 0;

  var rows = require('../utils/db').prepare([
    'SELECT e.id, e.tx_id, e.asset, e.direction, e.amount_cent, e.created_at,',
    '       t.kind, t.memo,',
    '  (SELECT COALESCE(SUM(e2.direction * e2.amount_cent), 0)',
    '     FROM xy_ledger_entries e2',
    '    WHERE e2.account_id = e.account_id AND e2.id <= e.id',
    "      AND (CASE WHEN e.asset = 'PRACTICE' THEN e2.asset = 'PRACTICE' ELSE e2.asset <> 'PRACTICE' END)",
    '  ) AS balance_after',
    'FROM xy_ledger_entries e JOIN xy_ledger_transactions t ON t.id = e.tx_id',
    'WHERE e.account_id = ? AND (? = 0 OR e.id < ?)',
    'ORDER BY e.id DESC LIMIT ?'
  ].join('\n')).all(acc.id, before, before, n);

  var list = rows.map(function (r) {
    var deltaCent = r.direction * r.amount_cent;
    return {
      id: r.id,
      tx_id: r.tx_id,
      asset: r.asset,
      pool: String(r.asset).toLowerCase(),
      pool_label: r.asset === 'PRACTICE' ? '练习金' : (r.asset === 'CASH' ? '充值学元' : '赠送学元'),
      delta_cent: deltaCent,
      delta: deltaCent / 1000,          // 学元，供旧 UI 直接显示
      balance_after: r.balance_after / 1000,
      kind: r.kind,
      kind_label: KIND_LABEL[r.kind] || r.kind,
      memo: r.memo,
      created_at: r.created_at
    };
  });

  return {
    list: list,
    next_before_id: list.length === n ? list[list.length - 1].id : 0
  };
}

// 投资进出：赠金 ⇄ 练习金。方向写死，不接受 asset / to 参数。
// 返回练习金视图，方便应用刷新余额而不必再调一次。
function investMove(appId, userId, direction, amountCent, ref) {
  assertApp(appId);
  var dir = String(direction || '');
  if (dir !== 'in' && dir !== 'out') throw new Error('direction 只能是 in 或 out');
  var uid = String(userId == null ? '' : userId);
  var cent = Math.floor(Number(amountCent));
  if (!isFinite(cent) || cent <= 0) throw new Error('金额不合法');
  var r = invest.move(uid, cent, dir, { ref: ref });
  return {
    direction: r.direction,
    amount_cent: r.amount_cent,
    account: practiceAccount(appId, uid)
  };
}

// 可转入沙盘的赠金额度（只读）。第三方能看见「有多少可投」，但拿不到 CASH，
// 也不能直接改 GRANT —— 唯一改动入口是上面的 investMove()。
function grantAvailable(appId, userId) {
  assertApp(appId);
  var acc = ledger.findAccount('user', userId);
  if (!acc) return 0;
  // 冻结的赠金已转到 escrow 账户，用户账户余额就是可用额。
  return Math.max(0, ledger.balanceOf(acc.id, 'GRANT'));
}

// 「补足到目标练习金」的资产基数，由平台定义，第三方只提供持仓市值。
// 规则：可用练习金 + 持仓市值 + 累计撤出。第三项是关键 —— 主动撤到钱包
// 的钱不是亏损，不能因为学生把钱拿走就再补一次（否则可反复套取赠金）。
function topUpBase(appId, userId, holdingValueCent) {
  assertApp(appId);
  var acc = practiceAccount(appId, userId);
  return Math.max(0, acc.available_practice_cent || 0) +
    Math.max(0, Math.floor(Number(holdingValueCent) || 0)) +
    invest.withdrawnOutCent(String(userId == null ? '' : userId));
}

// 累计撤出到钱包的金额（供应用展示 / 审计）。
function withdrawnOut(appId, userId) {
  assertApp(appId);
  return invest.withdrawnOutCent(String(userId == null ? '' : userId));
}

module.exports = {
  APPS: APPS,
  practiceAccount: practiceAccount,
  ensureTrader: ensureTrader,
  reserve: reserve,
  release: release,
  settleBuy: settleBuy,
  settleSell: settleSell,
  issue: issue,
  invest: investMove,
  withdrawnOut: withdrawnOut,
  topUpBase: topUpBase,
  grantAvailable: grantAvailable,
  history: history
};
