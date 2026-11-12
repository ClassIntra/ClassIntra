// 学元账本 · 投资进出（GRANT ⇄ PRACTICE）
// ============================================================
// 唯一实现：系统应用（钱包）与第三方应用（证券）都走这里，避免两套规则漂移。
//
// 为什么不能写一笔「GRANT → PRACTICE」：账本按资产分组守恒，跨资产直接兑换
// 会让两边的分录都平不了。所以拆成两笔独立交易：
//   ① 作废原资产（用户 → clearing）
//   ② 等额发行目标资产（clearing → 用户）
// 各自单资产守恒，CASH 全程不参与 —— 真钱既进不了股市，股市的钱也变不出现金。
//
// ⚠️ 撤出额必须可查：证券按月「补足到 3 万练习金」，若只看当前余额，学生
//    撤资到钱包后会被当成亏损而反复补发，等于凭空印赠金。见 withdrawnOutCent()。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var db = require('../utils/db');
var ledger = require('./ledger');
var errors = require('./errors');

// 单位链以 units.js 为唯一真相源：1 学元 = 100 单位，1 元 = 1000 学元 = 10 万单位。
// ⚠️ 2026-11-07 口径归位：本值归位前注释写「5000 元等值」是旧口径（1 元 = 1000 单位）
//    遗留；现行口径下 5000000 单位 = 5 万学元 = ¥50。数值维持不变（生产一直按此运行）。
var MAX_MOVE_CENT = 5000000;   // 单笔 5 万学元（¥50）等值，防手滑搬空
var USER_ID_RE = /^[A-Za-z0-9_.@:-]{1,64}$/;   // 与 services/xueyuan.js 保持一致

// 报错文案用「学元」而非「元」：fromCent 是账本单位 → 学元（÷ UNITS_PER_XUEYUAN）。
// 不要再在业务代码里写魔法数字换算，统一 require('../units')。
function fromCent(cent) { return Math.round(Number(cent) || 0) / 100; }

function q(sql) { return db.prepare(sql); }

function move(userId, amountCent, dir, opts) {
  var o = opts || {};
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  if (typeof amountCent !== 'number' || !isFinite(amountCent) ||
      Math.floor(amountCent) !== amountCent || amountCent <= 0) {
    throw new Error('金额必须是正整数分');
  }
  if (amountCent > MAX_MOVE_CENT) {
    throw new Error('单笔投资进出不能超过 ' + fromCent(MAX_MOVE_CENT) + ' 学元');
  }

  var into = dir === 'in';
  var fromAsset = into ? 'GRANT' : 'PRACTICE';
  var toAsset = into ? 'PRACTICE' : 'GRANT';

  var user = ledger.findAccount('user', uid);
  if (!user) throw new Error('账户不存在');
  var clearing = ledger.systemAccount('clearing');

  // 托管里的钱已经不在用户账户上：PRACTICE 可用额就是账户余额本身，
  // 所以「挂单冻结的部分不能撤」由模型天然保证，不需要再读冻结列。
  var avail = ledger.balanceOf(user.id, fromAsset);
  if (avail < amountCent) {
    throw new Error(into
      ? '赠送学元不足（可用 ' + fromCent(avail) + ' 学元）'
      : '练习金不足（可用 ' + fromCent(avail) + ' 学元，挂单冻结的部分不能撤）');
  }

  // 只在撤出方向校验信用上限；默认关闭时 assertOutCap 直接返回，零开销。
  if (!into) assertOutCap(uid, amountCent);

  var ref = String(o.ref || ('invest:' + uid + ':' + Date.now() + ':' +
    Math.random().toString(36).slice(2, 8)));

  var run = db.transaction(function () {
    ledger.post({
      ref: ref + ':burn',
      kind: 'adjust',
      initiator: uid,
      memo: into ? '转入投资（赠金作废）' : '撤资（练习金作废）',
      entries: [
        { account_id: user.id, asset: fromAsset, direction: -1, amount_cent: amountCent },
        { account_id: clearing.id, asset: fromAsset, direction: 1, amount_cent: amountCent }
      ]
    });
    ledger.post({
      ref: ref + ':issue',
      kind: into ? 'invest_in' : 'invest_out',
      initiator: uid,
      memo: into ? '转入投资（发放练习金）' : '撤资（发放赠金）',
      entries: [
        { account_id: clearing.id, asset: toAsset, direction: -1, amount_cent: amountCent },
        { account_id: user.id, asset: toAsset, direction: 1, amount_cent: amountCent }
      ]
    });
  });
  run();

  return {
    direction: into ? 'in' : 'out',
    amount_cent: amountCent,
    from_asset: fromAsset,
    to_asset: toAsset,
    ref: ref
  };
}

// 累计「撤出到钱包」的金额（单位）。补发基数要把它加回去：
// 学生主动拿走的钱不是亏损，不该由平台再补一次。
function withdrawnOutCent(userId) {
  var uid = String(userId == null ? '' : userId);
  var user = ledger.findAccount('user', uid);
  if (!user) return 0;
  var row = q([
    'SELECT COALESCE(SUM(e.amount_cent), 0) AS s',
    'FROM xy_ledger_entries e',
    'JOIN xy_ledger_transactions t ON t.id = e.tx_id',
    "WHERE t.kind = 'invest_out' AND e.account_id = ?",
    "  AND e.asset = 'GRANT' AND e.direction = 1"
  ].join('\n')).get(user.id);
  return Number(row.s) || 0;
}

// ---------- v2：套取路径量化指标 + 可配置撤出信用上限 ----------
// V.23.1.3 的「故意亏光 → 平台补发 → 撤出」之所以难封，是因为一刀切的
// 信用上限会连带挡住成就 / 周冠军这类平台奖励的提取。这里先让风险**可见**：
// 累计转入 / 撤出 / 平台补发 / 提取比四个数摆到管理端，再给一个默认关闭的开关。
// 0 = 不限（保持线上行为）；要收紧时设 LEDGER_INVEST_OUT_CAP_CENT。
var OUT_CAP_CENT = Math.max(0, Number(process.env.LEDGER_INVEST_OUT_CAP_CENT || 0));

function metrics(userId) {
  var uid = String(userId == null ? '' : userId);
  var user = ledger.findAccount('user', uid);
  var zero = {
    user_id: uid, invested_in_cent: 0, withdrawn_out_cent: 0, platform_topup_cent: 0,
    current_practice_cent: 0, current_grant_cent: 0, extraction_ratio: 0,
    risk: 'low', cap_cent: OUT_CAP_CENT
  };
  if (!user) return zero;

  var rows = q([
    'SELECT t.kind, e.asset, e.direction, COALESCE(SUM(e.amount_cent), 0) AS s',
    'FROM xy_ledger_entries e JOIN xy_ledger_transactions t ON t.id = e.tx_id',
    'WHERE e.account_id = ? GROUP BY t.kind, e.asset, e.direction'
  ].join('\n')).all(user.id);
  var tally = {};
  rows.forEach(function (r) {
    tally[r.kind + '|' + r.asset + '|' + r.direction] = Number(r.s) || 0;
  });
  function take(kind, asset, dir) { return tally[kind + '|' + asset + '|' + dir] || 0; }

  var invested = take('invest_in', 'PRACTICE', 1);
  var withdrawn = take('invest_out', 'GRANT', 1);   // 与 withdrawnOutCent 同口径
  var topup = take('practice', 'PRACTICE', 1);      // 平台发行 / 月度补发
  var base = invested + topup;
  var ratio = base > 0 ? withdrawn / base : 0;

  return {
    user_id: uid,
    invested_in_cent: invested,
    withdrawn_out_cent: withdrawn,
    platform_topup_cent: topup,
    current_practice_cent: ledger.balanceOf(user.id, 'PRACTICE'),
    current_grant_cent: ledger.balanceOf(user.id, 'GRANT'),
    // 撤出 / (自有投入 + 平台补发)。>1 意味着拿走的比投入和补发的还多，
    // 是「补发被提走」的直接信号；不是定罪，是给班管看的观测值。
    extraction_ratio: Math.round(ratio * 1000) / 1000,
    risk: ratio > 1.2 ? 'high' : (ratio > 0.8 && topup > 0 ? 'watch' : 'low'),
    cap_cent: OUT_CAP_CENT
  };
}

function assertOutCap(userId, amountCent) {
  if (OUT_CAP_CENT <= 0) return;   // 默认不限：零开销、零行为变化
  var m = metrics(userId);
  if (m.withdrawn_out_cent + amountCent > OUT_CAP_CENT) {
    throw errors.of('BUSINESS_RULE',
      '累计撤出超过信用上限（已撤 ' + m.withdrawn_out_cent + ' 分，本笔 ' + amountCent +
      ' 分，上限 ' + OUT_CAP_CENT + ' 分），请联系班管');
  }
}

module.exports = {
  MAX_MOVE_CENT: MAX_MOVE_CENT,
  OUT_CAP_CENT: OUT_CAP_CENT,
  move: move,
  withdrawnOutCent: withdrawnOutCent,
  metrics: metrics,
  assertOutCap: assertOutCap
};
