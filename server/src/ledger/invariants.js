// 学元账本 · 不变量自检 I1–I9
// ============================================================
// 三个执行点：
//   1) ledger.post() 内联局部断言（I1 分组守恒 / I8 负余额）—— 每笔都跑，O(1)
//   2) 本文件 check() —— 启动、管理端健康度、日终对账时跑，O(n)
//   3) 日终三方对账 orders ↔ entries ↔ cashbook —— S2 接订单后启用
//
// ⚠️ 不要把 check() 放进 post()：entries 线性增长，每笔全表扫描会拖死写入（V.14 修正 2）。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var ALL = [
  'I1a', 'I1b', 'I1c', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9'
];

function q(sql) {
  return require('../utils/db').prepare(sql);
}

function push(issues, code, detail, extra) {
  var item = { code: code, detail: detail };
  if (extra) item.extra = extra;
  issues.push(item);
}

// I1a 每笔交易、每种资产各自借贷平衡
function checkTxBalanced(issues) {
  var rows = q([
    'SELECT tx_id, asset, SUM(direction * amount_cent) AS s',
    'FROM xy_ledger_entries GROUP BY tx_id, asset HAVING s <> 0 LIMIT 20'
  ].join('\n')).all();
  rows.forEach(function (r) {
    push(issues, 'I1a', '交易 ' + r.tx_id + ' 资产 ' + r.asset + ' 分录不守恒（' + r.s + ' 分）');
  });
}

// I1b 全局每种资产净额为 0（发行对手方 clearing 的负值与之抵消）
function checkGlobalBalanced(issues) {
  var rows = q([
    'SELECT asset, SUM(direction * amount_cent) AS s',
    'FROM xy_ledger_entries GROUP BY asset HAVING s <> 0'
  ].join('\n')).all();
  rows.forEach(function (r) {
    push(issues, 'I1b', '资产 ' + r.asset + ' 全局不守恒（' + r.s + ' 分，疑似绕过 ledger 写入）');
  });
}

// I1c 余额表必须等于分录汇总
function checkBalanceDrift(issues) {
  var rows = q([
    'SELECT b.account_id, b.asset, b.balance, COALESCE(SUM(e.direction * e.amount_cent), 0) AS s',
    'FROM xy_ledger_balances b',
    'LEFT JOIN xy_ledger_entries e ON e.account_id = b.account_id AND e.asset = b.asset',
    'GROUP BY b.account_id, b.asset HAVING b.balance <> s LIMIT 20'
  ].join('\n')).all();
  rows.forEach(function (r) {
    push(issues, 'I1c', '账户 ' + r.account_id + ' 资产 ' + r.asset +
      ' 余额 ' + r.balance + ' 与流水汇总 ' + r.s + ' 不一致');
  });
}

// 账面现金总额（排除发行对手方 clearing —— 它的负值就是「已发行净额」）
function cashOnBookCent() {
  return q([
    'SELECT COALESCE(SUM(b.balance), 0) AS s',
    'FROM xy_ledger_balances b JOIN xy_ledger_accounts a ON a.id = b.account_id',
    "WHERE b.asset = 'CASH' AND a.kind <> 'clearing'"
  ].join('\n')).get().s;
}

// 兑付敞口：用户 / 卖家 / 托管里随时可能被提走或消费的 CASH
function cashLiabilityCent() {
  return q([
    'SELECT COALESCE(SUM(b.balance), 0) AS s',
    'FROM xy_ledger_balances b JOIN xy_ledger_accounts a ON a.id = b.account_id',
    "WHERE b.asset = 'CASH' AND a.kind IN ('user','seller','escrow')"
  ].join('\n')).get().s;
}

function cashbookNetCent() {
  return q('SELECT COALESCE(SUM(amount_cent), 0) AS s FROM xy_ledger_cashbook').get().s;
}

// 只算「欠用户的钱」那一侧（recharge / refund）。损益侧（goods_cost / ai_cost）不在这里，
// 它对应的是平台自己的经营支出，不影响兑付敞口。
function cashbookLiabilityCent() {
  return q("SELECT COALESCE(SUM(amount_cent), 0) AS s FROM xy_ledger_cashbook WHERE scope = 'liability'").get().s;
}

function cashbookPnlCent() {
  return q("SELECT COALESCE(SUM(amount_cent), 0) AS s FROM xy_ledger_cashbook WHERE scope = 'pnl'").get().s;
}

function platformCashCent() {
  return q([
    'SELECT COALESCE(SUM(b.balance), 0) AS s',
    'FROM xy_ledger_balances b JOIN xy_ledger_accounts a ON a.id = b.account_id',
    "WHERE b.asset = 'CASH' AND a.kind = 'platform'"
  ].join('\n')).get().s;
}

// I2a 账面现金 ≡ 真金台账「负债侧」
// 口径必须是分层对平，不能拿「台账净额」去比：
//   真金收进来 120000（负债）−  平台赚走 8000（变成平台账户余额）
//   学生侧还剩 112000，但账面现金总额仍是 120000 —— 拿净额比会每卖一件货就误报一次。
function checkCashCover(issues) {
  var onBook = cashOnBookCent();
  var liab = cashbookLiabilityCent();
  if (onBook !== liab) {
    push(issues, 'I2', '账面现金 ' + onBook + ' 分与真金台账负债 ' + liab + ' 分不一致（差 ' + (onBook - liab) + '）');
  }
  return {
    cashOnBookCent: onBook,
    cashLiabilityCent: cashLiabilityCent(),
    cashbookLiabilityCent: liab,
    cashbookNetCent: cashbookNetCent()
  };
}

// 平台损益（报表口径，不是约束）
// 平台账户里的现金 = 累计卖货收到的真金 + 第三方抽成（账本内转移，没有真金进出，
// 所以不该、也不能写进真金台账 —— 那张表只记账本之外的人民币动作）。
// 真实成本另外记在 pnl 侧（goods_cost）。于是：
//   已实现毛利 = 平台现金 − 真实成本
function pnlSummary() {
  var cash = platformCashCent();
  var cost = -cashbookPnlCent();     // pnl 侧目前只有成本（负数）
  return { platformCashCent: cash, costCent: cost, grossCent: cash - cost };
}

// I3 备付：可兑付敞口不得超过现金储备
function checkReserve(issues, reserveCent) {
  var cash = cashLiabilityCent();
  if (reserveCent == null) {
    return { skipped: true, reason: '未提供现金储备', cashLiabilityCent: cash };
  }
  if (cash > reserveCent) {
    push(issues, 'I3', '备付不足：可兑付 ' + cash + ' 分 > 现金储备 ' + reserveCent + ' 分');
  }
  return { cashLiabilityCent: cash, reserveCent: reserveCent, coverage: reserveCent === 0 ? null : cash / reserveCent };
}

// I4 托管：escrow 余额 == 未结 hold == 未完成订单面值（三者按资产分组）
function groupMap(rows, key) {
  var map = {};
  rows.forEach(function (r) { map[r.asset] = r.s; });
  return map;
}

function mergeKeys(maps) {
  var set = {};
  maps.forEach(function (m) {
    Object.keys(m).forEach(function (k) { set[k] = true; });
  });
  return Object.keys(set);
}

function checkEscrow(issues) {
  var escrow = groupMap(q([
    'SELECT b.asset, COALESCE(SUM(b.balance), 0) AS s',
    'FROM xy_ledger_balances b JOIN xy_ledger_accounts a ON a.id = b.account_id',
    "WHERE a.kind = 'escrow' AND a.owner_id = 'orders' GROUP BY b.asset"
  ].join('\n')).all());

  var holds = groupMap(q([
    'SELECT asset, COALESCE(SUM(amount_cent), 0) AS s',
    "FROM xy_ledger_holds WHERE state = 'held' GROUP BY asset"
  ].join('\n')).all());

  var orders = groupMap(q([
    'SELECT asset, COALESCE(SUM(face_cent), 0) AS s',
    "FROM xy_ledger_orders WHERE status IN ('paid','fulfilled','refunding','disputed') GROUP BY asset"
  ].join('\n')).all());

  mergeKeys([escrow, holds, orders]).forEach(function (asset) {
    var e = escrow[asset] || 0;
    var h = holds[asset] || 0;
    var o = orders[asset] || 0;
    if (e !== h) {
      push(issues, 'I4', '托管 ' + asset + ' 余额 ' + e + ' 分 ≠ 未结 hold ' + h + ' 分');
    }
    if (o !== 0 && h !== o) {
      push(issues, 'I4', '未完成订单 ' + asset + ' 面值 ' + o + ' 分 ≠ 未结 hold ' + h + ' 分');
    }
  });
  return { escrow: escrow, holds: holds, orders: orders };
}

// I6 / I7 / I9 结构约束（明细校验待 order_lines 后启用）
function checkOrderRules(issues) {
  var badAsset = q("SELECT COUNT(*) AS n FROM xy_ledger_orders WHERE asset = 'PRACTICE'").get().n;
  if (badAsset > 0) push(issues, 'I6', '存在 ' + badAsset + ' 笔练习金订单（结构性禁令被绕过）');

  var badRebate = q('SELECT COUNT(*) AS n FROM xy_ledger_orders WHERE rebate_cent > face_cent').get().n;
  if (badRebate > 0) push(issues, 'I7', '存在 ' + badRebate + ' 笔返现超过面值的订单');

  // I9：商品订单不得以赠送学元支付（2026-11-07 定）。
  // 赠金只能转账、发红包；一旦有人把抵扣重新打开，这里立刻报出来，
  // 而不是等月底发现「小铺卖出去的东西没收到钱」。
  var badGrantPay = q([
    'SELECT COUNT(*) AS n FROM xy_ledger_holds h',
    'JOIN xy_ledger_orders o ON o.id = h.order_id',
    "WHERE h.asset = 'GRANT' AND o.kind = 'goods'"
  ].join('\n')).get().n;
  if (badGrantPay > 0) {
    push(issues, 'I9', '存在 ' + badGrantPay + ' 笔商品订单用赠送学元支付（赠金不构成购买力）');
  }
}

// I8 allow_negative=0 的账户不得为负
function checkNegative(issues) {
  var rows = q([
    'SELECT b.account_id, b.asset, b.balance, a.kind, a.owner_id',
    'FROM xy_ledger_balances b JOIN xy_ledger_accounts a ON a.id = b.account_id',
    'WHERE b.balance < 0 AND a.allow_negative = 0 LIMIT 20'
  ].join('\n')).all();
  rows.forEach(function (r) {
    push(issues, 'I8', '账户 ' + r.kind + '/' + (r.owner_id || '-') + ' 资产 ' +
      r.asset + ' 出现负余额 ' + r.balance);
  });
}

// 统一自检。opts.reserveCent 提供时校验 I3。
function check(opts) {
  var o = opts || {};
  var issues = [];
  var summary = {};

  checkTxBalanced(issues);            // I1a
  checkGlobalBalanced(issues);        // I1b
  checkBalanceDrift(issues);          // I1c
  summary.cash = checkCashCover(issues);   // I2
  summary.pnl = pnlSummary();              // 报表口径（不入 issues）
  summary.reserve = checkReserve(issues, o.reserveCent); // I3
  summary.escrow = checkEscrow(issues);    // I4
  checkOrderRules(issues);            // I6 / I7 / I9 结构约束
  checkNegative(issues);              // I8

  return {
    ok: issues.length === 0,
    checked: ALL,
    deferred: ['I5（entries 只增不改：由 API 与 schema 约束保证，无 UPDATE 路径）'],
    issues: issues,
    summary: summary
  };
}

// 健康度：给管理端一屏看的数
function health(opts) {
  var result = check(opts);
  var cash = result.summary.cash || {};
  var escrow = result.summary.escrow || {};
  var book = require('./cashbook').totals();
  return {
    ok: result.ok,
    issues: result.issues,
    metrics: {
      cash_on_book_cent: cash.cashOnBookCent || 0,
      cash_liability_cent: cash.cashLiabilityCent || 0,
      // 真金台账拆两侧：负债（欠用户的）与损益（平台自己的成本支出）。
      // 管理端「真金台账」要显示负债侧，拿净额比会看起来永远差一笔成本。
      cashbook_net_cent: cash.cashbookNetCent || 0,
      cashbook_liability_cent: cash.cashbookLiabilityCent || 0,
      cashbook_pnl_cent: cashbookPnlCent(),
      platform_cash_cent: (result.summary.pnl || {}).platformCashCent || 0,
      cost_cent: (result.summary.pnl || {}).costCent || 0,
      gross_cent: (result.summary.pnl || {}).grossCent || 0,
      pnl_cent: book.pnl_cent,
      escrow_held: escrow.holds || {},
      escrow_balance: escrow.escrow || {},
      reserve_coverage: (result.summary.reserve || {}).coverage
    }
  };
}

module.exports = {
  ALL: ALL,
  check: check,
  health: health,
  cashOnBookCent: cashOnBookCent,
  cashLiabilityCent: cashLiabilityCent,
  cashbookNetCent: cashbookNetCent,
  cashbookLiabilityCent: cashbookLiabilityCent,
  cashbookPnlCent: cashbookPnlCent,
  platformCashCent: platformCashCent
};
