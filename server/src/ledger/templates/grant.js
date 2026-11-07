// 学元账本 · 发放（GRANT / PRACTICE）
// ============================================================
// 发放 = 发行权益，不产生真金流，所以永远不会影响 I2 的兑付敞口。
// 两道配额是硬约束：单次上限 + 每人每日上限（防止拆成多笔绕过）。
//
// ⚠️ 发放只能发「不可兑付」的资产。CASH 的入口只有充值（recharge），
//    否则就是凭空印钱去兑付真金。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var db = require('../../utils/db');
var ledger = require('../ledger');
var assets = require('../assets');

// 单位口径见 units.js：1 学元 = 100 单位，1 元 = 1000 学元 = 10 万单位。
// 默认配额（5000 单位 = 50 学元 ≈ ¥0.05 / 日累计 20000 单位 = 200 学元 ≈ ¥0.2）
// 刻意比班管默认（services/xueyuan.js maxGrantYuan 0.5 元 / grantDailyCapYuan 2 元）更紧：
// 本模板通过 /api/ledger/issue 面向管理端调用方，默认从严；
// 需要放宽时显式传 maxCent / dailyCapCent（班管批量发放走 services 层，不经这里）。
var MAX_GRANT_CENT = 5000;        // 单次 50 学元等值
var GRANT_DAILY_CAP_CENT = 20000; // 每人每日 200 学元等值

function positiveInt(n, label) {
  if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n <= 0) {
    throw new Error(label + '必须是正整数分');
  }
  return n;
}

// 今日已发（同一用户、同一资产、发放类交易）
function issuedTodayCent(accountId, asset) {
  var today = new Date().toISOString().slice(0, 10);
  var row = db.prepare([
    'SELECT COALESCE(SUM(e.amount_cent), 0) AS s',
    'FROM xy_ledger_entries e',
    'JOIN xy_ledger_transactions t ON t.id = e.tx_id',
    "WHERE e.account_id = ? AND e.asset = ? AND e.direction = 1",
    "  AND t.kind IN ('grant','practice') AND t.created_at >= ?"
  ].join('\n')).get(accountId, asset, today);
  return row.s;
}

// opts = { to, asset, amount_cent, ref, operator, memo, maxCent, dailyCapCent }
function issue(opts) {
  var o = opts || {};
  var cfg = assets.assertKnown(o.asset || 'GRANT');
  if (cfg.redeemable === 1) throw new Error('可兑付资产不能直接发放，请走充值');

  var amount = positiveInt(o.amount_cent, '发放金额');
  if (!o.skipQuota) {
    var max = o.maxCent == null ? MAX_GRANT_CENT : positiveInt(o.maxCent, '单次上限');
    if (amount > max) throw new Error('单次发放不能超过 ' + max + ' 分');
  }

  var ref = String(o.ref == null ? '' : o.ref).trim();
  if (!ref) throw new Error('发放必须提供 ref');

  var user = ledger.accountOf('user', o.to);
  var clearing = ledger.systemAccount('clearing');

  // 日累计在写之前查；同一 ref 的重放会走 post 的幂等短路，不受影响
  if (!o.skipQuota && !ledger.findTxByRef(ref)) {
    var cap = o.dailyCapCent == null ? GRANT_DAILY_CAP_CENT : positiveInt(o.dailyCapCent, '每日上限');
    var used = issuedTodayCent(user.id, cfg.asset);
    if (used + amount > cap) {
      throw new Error('今日发放已达上限（已发 ' + used + ' 分，上限 ' + cap + ' 分）');
    }
  }

  var kind = cfg.asset === 'PRACTICE' ? 'practice' : 'grant';
  var tx = ledger.post({
    ref: ref,
    kind: kind,
    initiator: o.operator == null ? 'system' : String(o.operator),
    memo: o.memo || '发放' + cfg.label,
    entries: [
      { account_id: clearing.id, asset: cfg.asset, direction: -1, amount_cent: amount },
      { account_id: user.id, asset: cfg.asset, direction: 1, amount_cent: amount }
    ]
  });

  return {
    tx_id: tx.tx_id,
    duplicate: tx.duplicate,
    asset: cfg.asset,
    balance: ledger.balanceOf(user.id, cfg.asset)
  };
}

module.exports = {
  MAX_GRANT_CENT: MAX_GRANT_CENT,
  GRANT_DAILY_CAP_CENT: GRANT_DAILY_CAP_CENT,
  issuedTodayCent: issuedTodayCent,
  issue: issue
};
