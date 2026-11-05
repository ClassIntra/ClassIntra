// 转出统一风控：支付密码 + 当日转出额度
// ============================================================
// 钱包（转账 / 红包 / 跨班）和学元内核接口（POST /api/xueyuan/transfer）共用这一套。
// 风控必须只有一个入口 —— 否则「换一个接口就能绕过支付密码和日额度」，
// 这正是 2026-11-05 排查时发现的第二个洞。
//
// 口径说明：
//   · 只统计「转给同学 / 发红包 / 跨班」的钱，不碰投资消费。
//     学生今天炒股花掉 1 万练习金不该让转账额度爆表（2026-11-04 生产踩坑）。
//   · 红包和跨班在**领取/成功之前不写分录**（只有冻结），只查 xy_entry 会漏掉，
//     所以补上「未领完的红包剩余」和「pending 跨班」：
//       红包：剩余 + 已领（负分录）= 今天发出的总额
//       跨班：pending + 已成功（负分录）= 今天发出的总额
//
// 编码约定：var / function

var db = require('../utils/db');
var xy = require('./xueyuan');
var payPin = require('./pay-pin');

// 风控额度：单日转出总额 2000 元等值（1:1000 下为 2000000 学元）。
// 单笔上限在 xueyuan 里是 500 元等值；日累计是为了挡住「拆成很多笔」的异常行为。
var MAX_DAILY_OUT_CENT = xy.yuanToCent(2000);

function dayStartMs() {
  var d = new Date(Date.now() + 8 * 3600 * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600 * 1000;
}

function dailyOutCent(uid) {
  try {
    var uidStr = String(uid);
    var start = dayStartMs();

    var settled = db.prepare([
      'SELECT COALESCE(SUM(CASE WHEN e.delta < 0 THEN -e.delta ELSE 0 END), 0) AS out',
      'FROM xy_entry e JOIN xy_tx t ON t.id = e.tx_id',
      "WHERE e.user_id = ? AND e.created_at >= ? AND t.kind = 'transfer'"
    ].join('\n')).get(uidStr, start).out || 0;

    var packets = db.prepare([
      'SELECT COALESCE(SUM(remaining_cent), 0) AS out FROM xy_packet',
      "WHERE sender = ? AND status = 'open' AND created_at >= ?"
    ].join('\n')).get(uidStr, start).out || 0;

    var cross = db.prepare([
      'SELECT COALESCE(SUM(amount_cent), 0) AS out FROM xy_cross_tx',
      "WHERE from_user = ? AND status = 'pending' AND created_at >= ?"
    ].join('\n')).get(uidStr, start).out || 0;

    return settled + packets + cross;
  } catch (e) {
    // fail-open 是为了不因统计异常阻断学生正常转账，但必须留痕，便于发现账本/表结构问题
    console.error('[pay-guard] 日额度统计失败:', e.message);
    return 0;
  }
}

// 转账/红包/跨班共用的前置校验：支付密码 → 当日额度
function guardPay(uid, pin, amountCent) {
  var v = payPin.verify(uid, pin);
  if (!v.ok) {
    var err = new Error(v.error);
    err.pay_pin = v;
    throw err;
  }
  var used = dailyOutCent(uid);
  if (used + amountCent > MAX_DAILY_OUT_CENT) {
    var left = Math.max(0, MAX_DAILY_OUT_CENT - used);
    var e2 = new Error('今日转出额度只剩 ' + xy.fromCent(left).toFixed(2) + ' 学元（每日上限 ' + xy.fromCent(MAX_DAILY_OUT_CENT) + ' 学元）');
    e2.quota = true;
    throw e2;
  }
  return true;
}

module.exports = {
  MAX_DAILY_OUT_CENT: MAX_DAILY_OUT_CENT,
  dailyOutCent: dailyOutCent,
  guardPay: guardPay
};
