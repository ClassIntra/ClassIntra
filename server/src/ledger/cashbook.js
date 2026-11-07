// 学元账本 · 真金台账
// ============================================================
// 只记人民币真金，不记点数流水。两类必须分开：
//   scope='liability'（recharge / refund）—— 影响「我欠用户多少」，I2 只对比这一侧
//   scope='pnl'（goods_cost / ai_cost / margin / fee）—— 平台损益，不影响兑付敞口
//
// 混在一列会让 I2 永远对不平：卖一件成本 50 元的货，学生余额没变，
// 但 cashbook 少了 50 元 —— 那不是兑付缺口，是经营亏损。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var db = require('../utils/db');

var SCOPE_OF = {
  recharge: 'liability',
  refund: 'liability',
  // 跨班资金流：钱在 A 班被回收（负债减少），在 B 班被铸造（负债增加）。
  // 只记一边，I2「账面现金 ≡ 真金台账负债」就会在两个班同时对不平。
  // 正负由调用方传 amount_cent 的符号决定，ref 幂等保证重试不重复计。
  cross_out: 'liability',
  cross_in: 'liability',
  goods_cost: 'pnl',
  ai_cost: 'pnl',
  margin: 'pnl',
  fee: 'pnl',
  adjust: 'pnl'
};

function q(sql) {
  return db.prepare(sql);
}

function nowIso() {
  return new Date().toISOString();
}

// 记一笔真金。ref 唯一 → 重放不重复记账。
function record(opts) {
  var o = opts || {};
  var type = String(o.type || '');
  var scope = SCOPE_OF[type];
  if (!scope) throw new Error('未知的真金类型: ' + type);

  var amount = o.amount_cent !== undefined ? o.amount_cent : o.amountCent;
  if (typeof amount !== 'number' || !isFinite(amount) || Math.floor(amount) !== amount) {
    throw new Error('真金金额必须是整数分');
  }
  if (amount === 0) throw new Error('真金金额不能为 0');

  var ref = String(o.ref == null ? '' : o.ref).trim();
  if (!ref) throw new Error('必须提供 ref（幂等键）');

  var prior = q('SELECT * FROM xy_ledger_cashbook WHERE ref = ?').get(ref);
  if (prior) return { id: prior.id, duplicate: true, scope: prior.scope };

  var info = q([
    'INSERT INTO xy_ledger_cashbook (tx_id, type, scope, amount_cent, ref, note, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?, ?)'
  ].join(' ')).run(
    o.tx_id == null ? null : o.tx_id,
    type, scope, amount,
    ref,
    o.note == null ? '' : String(o.note),
    nowIso()
  );
  return { id: Number(info.lastInsertRowid), duplicate: false, scope: scope };
}

function totals() {
  var row = q([
    'SELECT',
    "  COALESCE(SUM(CASE WHEN scope = 'liability' THEN amount_cent ELSE 0 END), 0) AS liability,",
    "  COALESCE(SUM(CASE WHEN scope = 'pnl' THEN amount_cent ELSE 0 END), 0) AS pnl",
    'FROM xy_ledger_cashbook'
  ].join('\n')).get();
  return { liability_cent: row.liability, pnl_cent: row.pnl };
}

module.exports = {
  SCOPE_OF: SCOPE_OF,
  record: record,
  totals: totals
};
