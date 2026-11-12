// 学元信用体系 v2 · 内核（阶段 1）
// ============================================================
// 从「单一借款按钮」升级为完整信用体系：
//   · 信用分 300–850，C/B/A/S 四级，分数决定额度上限与利率优惠
//   · 三种产品：周转贷（7 天）、分期贷（2/4 期，每 7 天一期）、投资贷（借出即转证券）
//   · 分期账单：每期一条，按账单还款、逐期逾期判断；提前还清不额外收费
//   · 班管：延期、限额、调分、拉黑、核销，全部留审计
//
// 资金仍然只借 GRANT：
//   放款 clearing → user；还款 user → clearing（本金+利息一起注销）。
//   投资贷在放款后再走 invest.move('in')：GRANT 作废、等额发行 PRACTICE，
//   所以学生拿到的是证券本金，债务仍记在 GRANT 上 —— 真金 CASH 全程不参与。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var db = require('../utils/db');
var config = require('../config');
var ledger = require('./ledger');
var units = require('./units');
var invest = require('./invest');

var USER_ID_RE = /^[A-Za-z0-9_.@:-]{1,64}$/;

function cfgNum(key, fallback) {
  var v = config && config.xueyuan ? Number(config.xueyuan[key]) : NaN;
  return isFinite(v) ? v : fallback;
}

function cfgFlag(key, fallback) {
  var v = config && config.xueyuan ? config.xueyuan[key] : undefined;
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() !== 'false' && String(v) !== '0';
}

// ---------- 金额与额度 ----------
// 1 学元 = 100 单位；下面所有 *_cent 都是账本单位。
var MAX_LOAN_CENT = units.yuanToUnits(cfgNum('loanMaxYuan', 2));        // 单笔上限 2000 学元
var MIN_LOAN_CENT = units.yuanToUnits(cfgNum('loanMinYuan', 0.1));      // 100 学元
var BASE_LIMIT_CENT = units.yuanToUnits(cfgNum('loanBaseLimitYuan', 0.5)); // 500
var STEP_CENT = units.yuanToUnits(cfgNum('loanStepYuan', 0.5));         // 每个按时还款日 +500
var MAX_LIMIT_CENT = units.yuanToUnits(cfgNum('loanMaxLimitYuan', 2));  // 2000
var TERM_DAYS = Math.max(1, Math.round(cfgNum('loanTermDays', 7)));
var INTEREST_PERCENT = Math.max(0, cfgNum('loanInterestPercent', 5));
var GRACE_HOURS = Math.max(0, cfgNum('loanGraceHours', 24));
var GRACE_MS = GRACE_HOURS * 3600000;
var POOL_CAP_CENT = Math.max(0, units.yuanToUnits(cfgNum('loanPoolYuan', 100)));
var WRITE_OFF_COOLDOWN_DAYS = Math.max(0, Math.round(cfgNum('loanWriteOffCooldownDays', 7)));

// ---------- 信用分与等级 ----------
var SCORE_START = 600;
var SCORE_MIN = 300;
var SCORE_MAX = 850;
var SCORE_ON_TIME = 40;
var SCORE_LATE = -40;
var SCORE_WRITE_OFF = -150;
// 防刷分：24 小时内只计一次「按时还清」。同一自然日反复借还不再叠加信用成长。
var SCORE_ON_TIME_COOLDOWN_HOURS = Math.max(0, cfgNum('loanScoreCooldownHours', 24));

// cap 是「额度上限」的账本单位。A/S 的额度上限一样，S 的奖励在利率。
var TIERS = [
  { id: 'C', name: '谨慎', min: 300, max: 599, cap: 100000, rateAdj: 0 },   // 1000 学元
  { id: 'B', name: '良好', min: 600, max: 699, cap: 150000, rateAdj: 0 },   // 1500
  { id: 'A', name: '优秀', min: 700, max: 799, cap: 200000, rateAdj: -1 },  // 2000
  { id: 'S', name: '极好', min: 800, max: 850, cap: 200000, rateAdj: -2 }   // 2000
];

function clampScore(n) {
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(Number(n) || 0)));
}

function tierOf(score) {
  var s = clampScore(score);
  for (var i = 0; i < TIERS.length; i++) {
    if (s >= TIERS[i].min && s <= TIERS[i].max) return TIERS[i];
  }
  return TIERS[0];
}

function nextTierOf(tier) {
  for (var i = 0; i < TIERS.length; i++) {
    if (TIERS[i].id === tier.id) return TIERS[i + 1] || null;
  }
  return null;
}

// ---------- 产品 ----------
var PRODUCTS = [
  {
    id: 'quick', name: '周转贷', desc: '7 天一次还清，适合临时周转',
    term_days: 7, periods: [1], period_days: 7,
    min_cent: MIN_LOAN_CENT, max_cent: MAX_LOAN_CENT,
    base_rate: INTEREST_PERCENT, invest: false
  },
  {
    id: 'installment', name: '分期贷', desc: '每 7 天一期，可选 2 或 4 期，还款压力更小',
    term_days: 28, periods: [2, 4], period_days: 7,
    min_cent: units.yuanToUnits(0.5), max_cent: MAX_LOAN_CENT,
    base_rate: 6, invest: false
  },
  {
    id: 'invest', name: '投资贷', desc: '借出即转入证券当本金，到期还本息',
    term_days: 7, periods: [1], period_days: 7,
    min_cent: MIN_LOAN_CENT, max_cent: MAX_LOAN_CENT,
    base_rate: 4, invest: true
  },
  {
    id: 'advance', name: '津贴预支', desc: '预支未来 3 天助学津贴，0 利息，每日津贴自动还',
    term_days: 7, periods: [1], period_days: 7,
    min_cent: MIN_LOAN_CENT, max_cent: units.yuanToUnits(0.6),
    base_rate: 0, invest: false, auto_repay: true
  }
];
var PRODUCT_BY_ID = {};
PRODUCTS.forEach(function (p) { PRODUCT_BY_ID[p.id] = p; });

function productOf(id) {
  var p = PRODUCT_BY_ID[String(id || 'quick')];
  if (!p) throw new Error('未知的贷款产品: ' + id);
  return p;
}

function rateFor(product, tier) {
  return Math.max(0, Math.round((product.base_rate + tier.rateAdj) * 100) / 100);
}

function fromCent(cent) {
  return units.unitsToXueyuan(cent);
}

function nowIso() {
  return new Date().toISOString();
}

function q(sql) { return db.prepare(sql); }

// ---------- 可读性检查 ----------
function tableExists(name) {
  return !!q("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

function schemaReady() {
  return tableExists('xy_ledger_loans') &&
    tableExists('xy_ledger_loan_installments') &&
    tableExists('xy_ledger_credit_profiles') &&
    tableExists('xy_ledger_credit_events') &&
    tableExists('xy_ledger_credit_audit');
}

function ensureReady() {
  if (!schemaReady()) {
    throw new Error('学元信用体系尚未初始化（缺少贷款/分期/信用表），请重启服务执行迁移 042/043/044 后再试');
  }
}

function isEnabled() {
  return cfgFlag('loanEnabled', true);
}

// ---------- 信用档案 ----------
function profileRow(userId) {
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  var row = q('SELECT * FROM xy_ledger_credit_profiles WHERE user_id = ?').get(uid);
  if (row) return row;

  var at = nowIso();
  q([
    'INSERT OR IGNORE INTO xy_ledger_credit_profiles',
    '(user_id, score, limit_override_cent, created_at, updated_at)',
    'VALUES (?, ?, 0, ?, ?)'
  ].join(' ')).run(uid, SCORE_START, at, at);
  q([
    'INSERT OR IGNORE INTO xy_ledger_credit_events',
    '(user_id, delta, score_after, reason, ref, created_at)',
    'VALUES (?, 0, ?, ?, ?, ?)'
  ].join(' ')).run(uid, SCORE_START, '初始信用分 ' + SCORE_START, 'score:init:' + uid, at);
  return q('SELECT * FROM xy_ledger_credit_profiles WHERE user_id = ?').get(uid);
}

function profileView(row) {
  var tier = tierOf(row.score);
  var next = nextTierOf(tier);
  var untilMs = row.blacklist_until ? Date.parse(row.blacklist_until) : NaN;
  var blacklisted = isFinite(untilMs) && untilMs > Date.now();
  var progress;
  if (next) {
    progress = Math.round((row.score - tier.min) / (next.min - tier.min) * 100);
  } else {
    progress = 100;
  }
  return {
    score: row.score,
    tier: tier.id,
    tier_name: tier.name,
    cap_cent: tier.cap,
    cap: fromCent(tier.cap),
    rate_adj: tier.rateAdj,
    next_tier: next ? next.id : '',
    next_tier_name: next ? next.name : '',
    next_tier_score: next ? next.min : null,
    progress: Math.max(0, Math.min(100, progress)),
    blacklisted: blacklisted,
    blacklist_until: row.blacklist_until || null,
    blacklist_reason: row.blacklist_reason || '',
    limit_override_cent: row.limit_override_cent || 0,
    limit_override: fromCent(row.limit_override_cent || 0)
  };
}

function onTimeCount(userId) {
  return Number(q([
    "SELECT COUNT(*) AS n FROM xy_ledger_loans",
    "WHERE user_id = ? AND status = 'repaid' AND late_flag = 0"
  ].join(' ')).get(String(userId)).n) || 0;
}

// 平台按东八区记「自然日」。额度成长只看天数，不看同一天借还了几笔 ——
// 否则 100 学元借还三次（利息 15）就能把额度刷到 2000，信用成长失去意义。
function localDayKey(iso) {
  var ms = Date.parse(iso);
  if (!isFinite(ms)) ms = Date.now();
  var d = new Date(ms + 8 * 3600000);
  return d.getUTCFullYear() + '-' +
    ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' +
    ('0' + d.getUTCDate()).slice(-2);
}

function onTimeDays(userId) {
  var rows = q([
    'SELECT closed_at FROM xy_ledger_loans',
    "WHERE user_id = ? AND status = 'repaid' AND late_flag = 0 AND closed_at IS NOT NULL"
  ].join(' ')).all(String(userId));
  var seen = {};
  rows.forEach(function (r) { seen[localDayKey(r.closed_at)] = 1; });
  return Object.keys(seen).length;
}

function lateCount(userId) {
  return Number(q([
    "SELECT COUNT(*) AS n FROM xy_ledger_loans",
    "WHERE user_id = ? AND status = 'repaid' AND late_flag = 1"
  ].join(' ')).get(String(userId)).n) || 0;
}

function repaidCount(userId) {
  return Number(q([
    "SELECT COUNT(*) AS n FROM xy_ledger_loans WHERE user_id = ? AND status = 'repaid'"
  ].join(' ')).get(String(userId)).n) || 0;
}

function creditLimitCent(userId) {
  var uid = String(userId);
  var prof = profileRow(uid);
  var tier = tierOf(prof.score);
  if (prof.limit_override_cent > 0) {
    return Math.min(prof.limit_override_cent, MAX_LOAN_CENT);
  }
  var computed = Math.min(
    BASE_LIMIT_CENT + onTimeDays(uid) * STEP_CENT,
    tier.cap,
    MAX_LOAN_CENT
  );
  // 高水位只兜「规则切换前的历史额度」，不兜逾期降级：
  // 当前等级 cap 仍会压住它，信用掉档时额度照样下调。
  var stored = Number(prof.limit_high_water_cent) || 0;
  var highWater = Math.min(stored, tier.cap, MAX_LOAN_CENT);
  var limit = Math.max(computed, highWater);
  if (limit > stored) {
    q('UPDATE xy_ledger_credit_profiles SET limit_high_water_cent = ?, updated_at = ? WHERE user_id = ?')
      .run(limit, nowIso(), uid);
  }
  return limit;
}

// 记分：ref 幂等；分数落库并更新档案。调用方负责包在业务事务里。
function scoreEvent(userId, delta, reason, ref, at) {
  var uid = String(userId);
  var existing = q('SELECT 1 AS x FROM xy_ledger_credit_events WHERE ref = ?').get(String(ref));
  if (existing) return { duplicate: true };
  var prof = profileRow(uid);
  var next = clampScore(prof.score + Number(delta));
  var when = at || nowIso();
  q([
    'INSERT INTO xy_ledger_credit_events',
    '(user_id, delta, score_after, reason, ref, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?)'
  ].join(' ')).run(uid, Number(delta), next, String(reason || ''), String(ref), when);
  q('UPDATE xy_ledger_credit_profiles SET score = ?, updated_at = ? WHERE user_id = ?')
    .run(next, when, uid);
  return { duplicate: false, score: next };
}

function scoreEvents(userId, limit) {
  if (!schemaReady()) return [];
  var n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  return q([
    'SELECT delta, score_after, reason, created_at FROM xy_ledger_credit_events',
    'WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ].join(' ')).all(String(userId), n).map(function (r) {
    return {
      delta: r.delta,
      score_after: r.score_after,
      reason: r.reason,
      created_at: r.created_at
    };
  });
}

function auditRow(userId, action, operator, reason, payload, ref, at) {
  // 同一毫秒内连续操作（如快速开关自动还款）会撞 ref；审计不能被幂等键吞掉。
  var key = String(ref);
  if (q('SELECT 1 AS x FROM xy_ledger_credit_audit WHERE ref = ?').get(key)) {
    key = key + ':' + Math.random().toString(36).slice(2, 8);
  }
  q([
    'INSERT OR IGNORE INTO xy_ledger_credit_audit',
    '(user_id, action, operator, reason, payload, ref, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?, ?)'
  ].join(' ')).run(
    String(userId), String(action), String(operator || ''),
    String(reason || ''), payload == null ? null : JSON.stringify(payload),
    key, at || nowIso()
  );
}

function auditList(userId, limit) {
  if (!schemaReady()) return [];
  var n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  return q([
    'SELECT action, operator, reason, payload, created_at FROM xy_ledger_credit_audit',
    'WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ].join(' ')).all(String(userId), n).map(function (r) {
    var p = null;
    try { p = r.payload ? JSON.parse(r.payload) : null; } catch (e) { p = null; }
    return {
      action: r.action, operator: r.operator, reason: r.reason,
      payload: p, created_at: r.created_at
    };
  });
}

// ---------- 额度池 / 核销冷静期 ----------
function outstandingPrincipalCent(userId) {
  var row = q([
    'SELECT COALESCE(SUM(principal_cent - repaid_principal_cent), 0) AS s',
    "FROM xy_ledger_loans WHERE user_id = ? AND status = 'active'"
  ].join(' ')).get(String(userId));
  return Number(row.s) || 0;
}

function outstandingTotalCent() {
  var row = q([
    'SELECT COALESCE(SUM(principal_cent - repaid_principal_cent), 0) AS s',
    "FROM xy_ledger_loans WHERE status = 'active'"
  ].join(' ')).get();
  return Number(row.s) || 0;
}

function poolInfo() {
  var used = outstandingTotalCent();
  return {
    cap_cent: POOL_CAP_CENT,
    cap: fromCent(POOL_CAP_CENT),
    used_cent: used,
    used: fromCent(used),
    available_cent: Math.max(0, POOL_CAP_CENT - used),
    available: fromCent(Math.max(0, POOL_CAP_CENT - used))
  };
}

function latestWriteOff(userId) {
  return q([
    "SELECT * FROM xy_ledger_loans WHERE user_id = ? AND status = 'written_off'",
    'ORDER BY write_off_at DESC, id DESC LIMIT 1'
  ].join(' ')).get(String(userId)) || null;
}

function writeOffBlockUntilMs(userId) {
  if (WRITE_OFF_COOLDOWN_DAYS <= 0) return 0;
  var row = latestWriteOff(userId);
  if (!row || !row.write_off_at) return 0;
  var t = Date.parse(row.write_off_at);
  if (!isFinite(t)) return 0;
  var until = t + WRITE_OFF_COOLDOWN_DAYS * 86400000;
  return until > Date.now() ? until : 0;
}

// ---------- 分期账单 ----------
function installmentRows(loanId) {
  return q([
    'SELECT * FROM xy_ledger_loan_installments WHERE loan_id = ? ORDER BY seq ASC'
  ].join(' ')).all(Number(loanId));
}

function installmentView(row) {
  var principal = Number(row.principal_cent) || 0;
  var interest = Number(row.interest_cent) || 0;
  var paidP = Number(row.paid_principal_cent) || 0;
  var paidI = Number(row.paid_interest_cent) || 0;
  var dueMs = Date.parse(row.due_at);
  var cutoff = isFinite(dueMs) ? dueMs + GRACE_MS : NaN;
  var pending = row.status !== 'paid';
  var overdue = pending && isFinite(cutoff) && Date.now() > cutoff;
  var inGrace = pending && isFinite(dueMs) && Date.now() > dueMs && !overdue;
  return {
    seq: row.seq,
    due_at: row.due_at,
    principal_cent: principal,
    principal: fromCent(principal),
    interest_cent: interest,
    interest: fromCent(interest),
    total_cent: principal + interest,
    total: fromCent(principal + interest),
    paid_principal_cent: paidP,
    paid_principal: fromCent(paidP),
    paid_interest_cent: paidI,
    paid_interest: fromCent(paidI),
    remaining_cent: Math.max(0, principal - paidP) + Math.max(0, interest - paidI),
    remaining: fromCent(Math.max(0, principal - paidP) + Math.max(0, interest - paidI)),
    status: row.status,
    late_paid: row.late_paid === 1,
    overdue: overdue,
    in_grace: inGrace,
    overdue_days: overdue ? Math.max(1, Math.ceil((Date.now() - cutoff) / 86400000)) : 0,
    paid_at: row.paid_at || null
  };
}

function scheduleOf(loanId) {
  return installmentRows(loanId).map(installmentView);
}

// 等额拆本金/利息，最后一期兜住余数。
function buildSchedule(principalCent, interestCent, product, count, openedAt) {
  var n = product.id === 'installment' ? Math.max(1, Math.round(count || 2)) : 1;
  var periodDays = product.period_days || product.term_days || TERM_DAYS;
  var pBase = Math.floor(principalCent / n);
  var iBase = Math.floor(interestCent / n);
  var rows = [];
  for (var i = 1; i <= n; i++) {
    var p = i === n ? principalCent - pBase * (n - 1) : pBase;
    var it = i === n ? interestCent - iBase * (n - 1) : iBase;
    rows.push({
      seq: i,
      due_at: new Date(openedAt.getTime() + periodDays * i * 86400000).toISOString(),
      principal_cent: p,
      interest_cent: it
    });
  }
  return rows;
}

function insertSchedule(loanId, schedule) {
  var stmt = q([
    'INSERT INTO xy_ledger_loan_installments',
    '(loan_id, seq, due_at, principal_cent, interest_cent)',
    'VALUES (?, ?, ?, ?, ?)'
  ].join(' '));
  schedule.forEach(function (s) {
    stmt.run(loanId, s.seq, s.due_at, s.principal_cent, s.interest_cent);
  });
}

// ---------- 视图 ----------
function view(row) {
  if (!row) return null;
  var product = productOf(row.product || 'quick');
  var inst = scheduleOf(row.id);
  var principal = Number(row.principal_cent) || 0;
  var interest = Number(row.interest_cent) || 0;
  var paidP = 0;
  var paidI = 0;
  var remP = 0;
  var remI = 0;
  var overdue = false;
  var inGrace = false;
  var overdueDays = 0;
  var paidCount = 0;
  var next = null;

  inst.forEach(function (x) {
    paidP += x.paid_principal_cent;
    paidI += x.paid_interest_cent;
    if (x.status === 'paid') {
      paidCount++;
      return;
    }
    remP += Math.max(0, x.principal_cent - x.paid_principal_cent);
    remI += Math.max(0, x.interest_cent - x.paid_interest_cent);
    if (!next) next = x;
    if (x.overdue) {
      overdue = true;
      overdueDays = Math.max(overdueDays, x.overdue_days);
    }
    if (x.in_grace) inGrace = true;
  });

  var late = row.late_flag === 1;
  var nextDueCent = next ? next.remaining_cent : 0;
  return {
    id: row.id,
    ref: row.ref,
    user_id: row.user_id,
    status: row.status,
    product: row.product || 'quick',
    product_name: product.name,
    installments: Number(row.installments) || 1,
    rate_percent: row.rate_percent == null ? INTEREST_PERCENT : Number(row.rate_percent),
    principal_cent: principal,
    principal: fromCent(principal),
    interest_cent: interest,
    interest: fromCent(interest),
    total_cent: principal + interest,
    total: fromCent(principal + interest),
    repaid_principal_cent: paidP,
    repaid_principal: fromCent(paidP),
    repaid_interest_cent: paidI,
    repaid_interest: fromCent(paidI),
    remaining_principal_cent: remP,
    remaining_principal: fromCent(remP),
    remaining_interest_cent: remI,
    remaining_interest: fromCent(remI),
    remaining_cent: remP + remI,
    remaining: fromCent(remP + remI),
    overdue: overdue,
    in_grace: inGrace,
    overdue_days: overdueDays,
    late: late,
    on_time: row.status === 'repaid' && !late,
    next_due_at: next ? next.due_at : null,
    next_due_cent: nextDueCent,
    next_due_amount: fromCent(nextDueCent),
    next_due: fromCent(nextDueCent),
    paid_installments: paidCount,
    total_installments: inst.length,
    schedule: inst,
    opened_at: row.opened_at,
    due_at: row.due_at,
    closed_at: row.closed_at,
    last_repay_at: row.last_repay_at,
    write_off_at: row.write_off_at || null,
    write_off_reason: row.write_off_reason || '',
    invested: product.invest,
    auto_repay: row.auto_repay === 1,
    auto_repay_forced: product.auto_repay === true
  };
}

function list(userId, limit) {
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  ensureReady();
  var n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  return q('SELECT * FROM xy_ledger_loans WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(uid, n).map(view);
}

function activeLoan(userId) {
  return q([
    "SELECT * FROM xy_ledger_loans WHERE user_id = ? AND status = 'active'",
    'ORDER BY id ASC LIMIT 1'
  ].join(' ')).get(String(userId)) || null;
}

// ---------- 汇总（学生端信用中心） ----------
function summary(userId) {
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  ensureReady();

  var prof = profileRow(uid);
  var pv = profileView(prof);
  var tier = tierOf(prof.score);
  var limit = creditLimitCent(uid);
  var used = outstandingPrincipalCent(uid);
  var available = Math.max(0, limit - used);
  var onTime = onTimeCount(uid);
  var onTimeDayCount = onTimeDays(uid);
  var late = lateCount(uid);
  var nextLimit = prof.limit_override_cent > 0
    ? limit
    : Math.min(
      Math.max(BASE_LIMIT_CENT + (onTimeDayCount + 1) * STEP_CENT, limit),
      tier.cap,
      MAX_LOAN_CENT
    );
  var row = activeLoan(uid);
  var active = view(row);
  var overdue = !!(active && active.overdue);
  var pool = poolInfo();
  var blockUntil = writeOffBlockUntilMs(uid);
  var enabled = isEnabled();
  var can = enabled && !row && !pv.blacklisted && !blockUntil &&
    available >= MIN_LOAN_CENT && pool.available_cent >= MIN_LOAN_CENT;
  var reason = '';

  if (!enabled) reason = '贷款功能暂时关闭';
  else if (pv.blacklisted) {
    reason = '借款已暂停至 ' + String(pv.blacklist_until || '').slice(0, 10) +
      (pv.blacklist_reason ? '：' + pv.blacklist_reason : '');
  } else if (row) reason = overdue
    ? '有一笔贷款已逾期，先还清再借'
    : '已有一笔贷款未还清';
  else if (blockUntil) reason = '有一笔贷款已核销，' +
    Math.max(1, Math.ceil((blockUntil - Date.now()) / 86400000)) + ' 天后才能再借';
  else if (pool.available_cent < MIN_LOAN_CENT) reason = '本期贷款额度池已用完，等同学还一点再借';
  else if (available < MIN_LOAN_CENT) reason = '当前可借额度不足 ' + fromCent(MIN_LOAN_CENT) + ' 学元';

  var products = PRODUCTS.map(function (p) {
    var rate = rateFor(p, tier);
    var maxCent = Math.min(p.max_cent, limit);
    return {
      id: p.id,
      name: p.name,
      desc: p.desc,
      term_days: p.term_days,
      period_days: p.period_days,
      periods: p.periods,
      min_cent: p.min_cent,
      min: fromCent(p.min_cent),
      max_cent: maxCent,
      max: fromCent(maxCent),
      base_rate: p.base_rate,
      rate: rate,
      invest: p.invest,
      auto_repay: !!p.auto_repay,
      available: maxCent >= p.min_cent && available >= p.min_cent
    };
  });

  return {
    enabled: enabled,
    blacklisted: pv.blacklisted,
    blacklist_until: pv.blacklist_until,
    blacklist_reason: pv.blacklist_reason,
    overdue: overdue,
    can_borrow: can,
    reason: reason,
    profile: pv,
    credit: {
      limit_cent: limit,
      limit: fromCent(limit),
      used_cent: used,
      used: fromCent(used),
      available_cent: available,
      available: fromCent(available),
      on_time_count: onTime,
      on_time_days: onTimeDayCount,
      late_count: late,
      repaid_count: onTime + late,
      next_limit_cent: nextLimit,
      next_limit: fromCent(nextLimit),
      override_cent: prof.limit_override_cent || 0,
      override: fromCent(prof.limit_override_cent || 0)
    },
    products: products,
    pool: pool,
    active: active,
    config: {
      min_cent: MIN_LOAN_CENT,
      min: fromCent(MIN_LOAN_CENT),
      max_cent: MAX_LOAN_CENT,
      max: fromCent(MAX_LOAN_CENT),
      term_days: TERM_DAYS,
      interest_percent: INTEREST_PERCENT,
      grace_hours: GRACE_HOURS,
      write_off_cooldown_days: WRITE_OFF_COOLDOWN_DAYS,
      score_on_time: SCORE_ON_TIME,
      score_late: SCORE_LATE,
      score_write_off: SCORE_WRITE_OFF
    },
    score_events: scoreEvents(uid, 20),
    loans: list(uid, 20)
  };
}

// ---------- 借款 ----------
function apply(userId, amountCent, opts) {
  var o = opts || {};
  var uid = String(userId == null ? '' : userId);
  if (!isEnabled()) throw new Error('贷款功能暂时关闭');
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  ensureReady();

  var ref = String(o.ref == null ? '' : o.ref).trim();
  if (!ref) throw new Error('必须提供 ref（幂等键）');
  if (ref.length > 120) throw new Error('申请号过长');

  var existed = q('SELECT * FROM xy_ledger_loans WHERE ref = ?').get(ref);
  if (existed) {
    if (String(existed.user_id) !== uid) throw new Error('重复的申请号');
    return { duplicate: true, loan: view(existed) };
  }

  var product = productOf(o.product || 'quick');
  // 预支的还款来源就是每日津贴；津贴关闭时借出去就没有自动还款来源。
  if (product.auto_repay && cfgNum('dailyYuan', 0.2) <= 0) {
    throw new Error('每日助学津贴已关闭，暂时不能申请津贴预支');
  }
  var count = product.id === 'installment' ? Math.round(Number(o.installments || 2)) : 1;
  if (product.periods.indexOf(count) === -1) {
    throw new Error('分期期数只能是 ' + product.periods.join(' 或 ') + ' 期');
  }

  var amt = Number(amountCent);
  if (!isFinite(amt) || Math.floor(amt) !== amt || amt <= 0) throw new Error('借款金额不合法');
  if (amt < product.min_cent) {
    throw new Error(product.name + '不能少于 ' + fromCent(product.min_cent) + ' 学元');
  }
  if (amt > Math.min(product.max_cent, MAX_LOAN_CENT)) {
    throw new Error(product.name + '不能超过 ' + fromCent(Math.min(product.max_cent, MAX_LOAN_CENT)) + ' 学元');
  }

  var acc = ledger.findAccount('user', uid);
  if (!acc) throw new Error('账户不存在，请先打开钱包');

  var cur = activeLoan(uid);
  if (cur) {
    var cv = view(cur);
    throw new Error(cv.overdue ? '有一笔贷款已逾期，先还清再借' : '已有一笔贷款未还清');
  }

  var prof = profileRow(uid);
  var pv = profileView(prof);
  if (pv.blacklisted) {
    throw new Error('借款已暂停至 ' + String(pv.blacklist_until || '').slice(0, 10) +
      (pv.blacklist_reason ? '：' + pv.blacklist_reason : ''));
  }

  var blockUntil = writeOffBlockUntilMs(uid);
  if (blockUntil) {
    throw new Error('有一笔贷款已核销，' +
      Math.max(1, Math.ceil((blockUntil - Date.now()) / 86400000)) + ' 天后才能再借');
  }

  var limit = creditLimitCent(uid);
  if (outstandingPrincipalCent(uid) + amt > limit) {
    throw new Error('超过可借额度（当前额度 ' + fromCent(limit) + ' 学元）');
  }

  var pool = poolInfo();
  if (amt > pool.available_cent) {
    throw new Error('本期贷款额度池已用完（剩余 ' + fromCent(pool.available_cent) + ' 学元）');
  }

  var tier = tierOf(prof.score);
  var rate = rateFor(product, tier);
  var interest = Math.ceil(amt * rate / 100);
  var autoRepay = product.auto_repay ? 1 : (o.auto_repay ? 1 : 0);
  var openedAt = new Date();
  var schedule = buildSchedule(amt, interest, product, count, openedAt);
  var dueAt = schedule[schedule.length - 1].due_at;
  var clearing = ledger.systemAccount('clearing');
  var loanId = 0;
  var duplicate = false;

  var run = db.transaction(function () {
    var again = q('SELECT * FROM xy_ledger_loans WHERE ref = ?').get(ref);
    if (again) {
      if (String(again.user_id) !== uid) throw new Error('重复的申请号');
      loanId = again.id;
      duplicate = true;
      return;
    }

    if (outstandingTotalCent() + amt > POOL_CAP_CENT) {
      throw new Error('本期贷款额度池已用完');
    }

    var info = q([
      'INSERT INTO xy_ledger_loans',
      '(ref, user_id, account_id, principal_cent, interest_cent, due_at, status,',
      ' product, installments, rate_percent, late_flag, auto_repay,',
      ' repaid_principal_cent, repaid_interest_cent, opened_at)',
      "VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, ?, 0, 0, ?)"
    ].join(' ')).run(
      ref, uid, acc.id, amt, interest, dueAt,
      product.id, count, rate, autoRepay, openedAt.toISOString()
    );
    loanId = Number(info.lastInsertRowid);
    insertSchedule(loanId, schedule);

    var posted = ledger.post({
      ref: 'loan:' + ref + ':out',
      kind: 'loan_out',
      initiator: uid,
      memo: product.name + '放款（赠送学元 ' + fromCent(amt) + '，利息 ' + fromCent(interest) + '）',
      payload: {
        loan_id: loanId,
        product: product.id,
        installments: count,
        rate_percent: rate,
        auto_repay: autoRepay,
        principal_cent: amt,
        interest_cent: interest,
        due_at: dueAt
      },
      entries: [
        { account_id: clearing.id, asset: 'GRANT', direction: -1, amount_cent: amt },
        { account_id: acc.id, asset: 'GRANT', direction: 1, amount_cent: amt }
      ]
    });
    if (posted.duplicate) throw new Error('放款流水已存在但贷款记录缺失，请联系管理员');

    q('UPDATE xy_ledger_loans SET out_tx_id = ? WHERE id = ?').run(posted.tx_id, loanId);

    // 投资贷：本金当场转进证券（GRANT 作废、等额发行 PRACTICE）。
    // 与放款在同一个事务里：任何一步失败，贷款与转账一起回滚。
    if (product.invest) {
      invest.move(uid, amt, 'in', { ref: 'loan:' + ref + ':invest' });
    }
  });
  run();

  var row = q('SELECT * FROM xy_ledger_loans WHERE id = ?').get(loanId);
  return { duplicate: duplicate, loan: view(row) };
}

// ---------- 还款 ----------
function repay(userId, amountCent, opts) {
  var o = opts || {};
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  ensureReady();

  var ref = String(o.ref == null ? '' : o.ref).trim();
  if (!ref) throw new Error('必须提供 ref（幂等键）');
  if (ref.length > 120) throw new Error('还款号过长');

  var dup = q('SELECT * FROM xy_ledger_loan_repays WHERE ref = ?').get(ref);
  if (dup) {
    var dupLoan = q('SELECT * FROM xy_ledger_loans WHERE id = ?').get(dup.loan_id);
    if (!dupLoan || String(dupLoan.user_id) !== uid) throw new Error('重复的还款号');
    return {
      duplicate: true,
      loan: view(dupLoan),
      repaid_cent: dup.amount_cent,
      repaid: fromCent(dup.amount_cent),
      allocation: { principal_cent: dup.principal_cent, interest_cent: dup.interest_cent }
    };
  }

  var loan = activeLoan(uid);
  if (!loan) throw new Error('没有待还的贷款');

  var insts = q([
    "SELECT * FROM xy_ledger_loan_installments WHERE loan_id = ? AND status = 'pending' ORDER BY seq ASC"
  ].join(' ')).all(loan.id);
  var remaining = 0;
  insts.forEach(function (x) {
    remaining += Math.max(0, x.principal_cent - x.paid_principal_cent) +
      Math.max(0, x.interest_cent - x.paid_interest_cent);
  });
  if (remaining <= 0) throw new Error('这笔贷款已经还清');

  var amt;
  if (o.full) {
    amt = remaining;
  } else {
    amt = Number(amountCent);
    if (!isFinite(amt) || Math.floor(amt) !== amt || amt <= 0) throw new Error('还款金额不合法');
    if (amt > remaining) throw new Error('还款金额超过应还（应还 ' + fromCent(remaining) + ' 学元）');
  }

  var acc = ledger.findAccount('user', uid);
  if (!acc) throw new Error('账户不存在');
  var clearing = ledger.systemAccount('clearing');
  var allocated = { principal_cent: 0, interest_cent: 0 };
  var closed = false;
  var lateFlag = false;

  var run = db.transaction(function () {
    var again = q('SELECT * FROM xy_ledger_loan_repays WHERE ref = ?').get(ref);
    if (again) {
      if (again.loan_id !== loan.id) throw new Error('重复的还款号');
      allocated = { principal_cent: again.principal_cent, interest_cent: again.interest_cent };
      return;
    }

    var curLoan = q('SELECT * FROM xy_ledger_loans WHERE id = ?').get(loan.id);
    if (!curLoan || curLoan.status !== 'active') throw new Error('这笔贷款已经结清');
    var curInsts = q([
      "SELECT * FROM xy_ledger_loan_installments WHERE loan_id = ? AND status = 'pending' ORDER BY seq ASC"
    ].join(' ')).all(loan.id);
    var curRemaining = 0;
    curInsts.forEach(function (x) {
      curRemaining += Math.max(0, x.principal_cent - x.paid_principal_cent) +
        Math.max(0, x.interest_cent - x.paid_interest_cent);
    });
    if (amt > curRemaining) throw new Error('还款金额超过应还');

    var posted = ledger.post({
      ref: 'loanrepay:' + ref,
      kind: 'loan_repay',
      initiator: uid,
      memo: '学元贷款还款（' + fromCent(amt) + '）',
      payload: { loan_id: loan.id, amount_cent: amt },
      entries: [
        { account_id: acc.id, asset: 'GRANT', direction: -1, amount_cent: amt },
        { account_id: clearing.id, asset: 'GRANT', direction: 1, amount_cent: amt }
      ]
    });
    if (posted.duplicate) throw new Error('还款流水已存在但还款记录缺失，请联系管理员');

    var left = amt;
    var at = nowIso();
    var nowMs = Date.now();

    curInsts.forEach(function (x) {
      if (left <= 0) return;
      var remI = Math.max(0, x.interest_cent - x.paid_interest_cent);
      var remP = Math.max(0, x.principal_cent - x.paid_principal_cent);
      var payI = Math.min(left, remI);
      left -= payI;
      var payP = Math.min(left, remP);
      left -= payP;
      if (payI + payP <= 0) return;

      var dueMs = Date.parse(x.due_at);
      var isLate = isFinite(dueMs) && nowMs > dueMs + GRACE_MS;
      if (isLate) lateFlag = true;

      var nextP = x.paid_principal_cent + payP;
      var nextI = x.paid_interest_cent + payI;
      var full = nextP >= x.principal_cent && nextI >= x.interest_cent;
      q([
        'UPDATE xy_ledger_loan_installments SET paid_principal_cent = ?, paid_interest_cent = ?,',
        ' status = ?, late_paid = ?, paid_at = ? WHERE id = ?'
      ].join(' ')).run(
        nextP, nextI,
        full ? 'paid' : 'pending',
        (x.late_paid === 1 || isLate) ? 1 : 0,
        full ? at : (x.paid_at || null),
        x.id
      );

      allocated.principal_cent += payP;
      allocated.interest_cent += payI;
    });

    if (left !== 0) throw new Error('还款分配异常，请联系管理员');

    var sums = q([
      'SELECT COALESCE(SUM(paid_principal_cent), 0) AS p,',
      '       COALESCE(SUM(paid_interest_cent), 0) AS i,',
      "       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending",
      'FROM xy_ledger_loan_installments WHERE loan_id = ?'
    ].join(' ')).get(loan.id);
    var pendingCount = Number(sums.pending) || 0;
    closed = pendingCount === 0;
    var nextLate = (curLoan.late_flag === 1 || lateFlag) ? 1 : 0;

    q([
      'UPDATE xy_ledger_loans SET repaid_principal_cent = ?, repaid_interest_cent = ?,',
      ' late_flag = ?, status = ?, closed_at = ?, last_repay_at = ? WHERE id = ?'
    ].join(' ')).run(
      sums.p, sums.i, nextLate,
      closed ? 'repaid' : 'active',
      closed ? at : null,
      at, loan.id
    );

    q([
      'INSERT INTO xy_ledger_loan_repays',
      '(loan_id, ref, amount_cent, principal_cent, interest_cent, tx_id, created_at)',
      'VALUES (?, ?, ?, ?, ?, ?, ?)'
    ].join(' ')).run(
      loan.id, ref, amt, allocated.principal_cent, allocated.interest_cent, posted.tx_id, at
    );

    if (closed) {
      var late = nextLate === 1;
      if (late) {
        scoreEvent(
          uid,
          SCORE_LATE,
          '贷款逾期还清',
          'score:loan:' + loan.id + ':close',
          at
        );
      } else {
        var cooldownFrom = new Date(Date.parse(at) - SCORE_ON_TIME_COOLDOWN_HOURS * 3600000).toISOString();
        var recentOnTime = q([
          'SELECT 1 AS x FROM xy_ledger_credit_events',
          "WHERE user_id = ? AND reason LIKE '贷款按时还清%' AND created_at > ? LIMIT 1"
        ].join(' ')).get(uid, cooldownFrom);
        scoreEvent(
          uid,
          recentOnTime ? 0 : SCORE_ON_TIME,
          recentOnTime
            ? ('贷款按时还清（' + SCORE_ON_TIME_COOLDOWN_HOURS + ' 小时内已计分）')
            : '贷款按时还清',
          'score:loan:' + loan.id + ':close',
          at
        );
      }
    }
  });
  run();

  var after = q('SELECT * FROM xy_ledger_loans WHERE id = ?').get(loan.id);
  return {
    duplicate: false,
    loan: view(after),
    repaid_cent: amt,
    repaid: fromCent(amt),
    allocation: allocated
  };
}

// ---------- 核销 ----------
function writeOff(loanId, opts) {
  var o = opts || {};
  var id = Number(loanId);
  if (!isFinite(id) || id <= 0) throw new Error('贷款不存在');
  ensureReady();
  var operator = String(o.operator == null ? '' : o.operator).trim();
  if (!operator) throw new Error('核销必须记录操作人');
  var reason = String(o.reason == null ? '' : o.reason).trim().slice(0, 120) || '班管核销';

  var row = q('SELECT * FROM xy_ledger_loans WHERE id = ?').get(id);
  if (!row) throw new Error('贷款不存在');
  if (row.status === 'written_off') return { duplicate: true, loan: view(row) };
  if (row.status !== 'active') throw new Error('只有还款中的贷款可以核销');

  var at = nowIso();
  var run = db.transaction(function () {
    var cur = q('SELECT * FROM xy_ledger_loans WHERE id = ?').get(id);
    if (!cur) throw new Error('贷款不存在');
    if (cur.status === 'written_off') return;
    if (cur.status !== 'active') throw new Error('只有还款中的贷款可以核销');

    q([
      'UPDATE xy_ledger_loans SET status = ?, closed_at = ?,',
      ' write_off_at = ?, write_off_by = ?, write_off_reason = ? WHERE id = ?'
    ].join(' ')).run('written_off', at, at, operator, reason, id);

    auditRow(cur.user_id, 'write_off', operator, reason,
      { loan_id: id, remaining_principal_cent: cur.principal_cent - cur.repaid_principal_cent },
      'audit:loan:' + id + ':writeoff', at);
    scoreEvent(cur.user_id, SCORE_WRITE_OFF, '贷款核销', 'score:loan:' + id + ':writeoff', at);
  });
  run();

  return { duplicate: false, loan: view(q('SELECT * FROM xy_ledger_loans WHERE id = ?').get(id)) };
}

// ---------- 自动还款 ----------
// 学生可在证券信用页把某笔贷款设为「每日津贴自动还」；津贴预支强制开启。
function setAutoRepay(userId, loanId, on, opts) {
  var o = opts || {};
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  ensureReady();
  var id = Number(loanId);
  if (!isFinite(id) || id <= 0) throw new Error('贷款不存在');
  var row = q('SELECT * FROM xy_ledger_loans WHERE id = ? AND user_id = ?').get(id, uid);
  if (!row) throw new Error('贷款不存在');
  if (row.status !== 'active') throw new Error('只有还款中的贷款可以设置自动还款');
  var product = productOf(row.product || 'quick');
  if (product.auto_repay && !on) throw new Error('津贴预支必须用津贴自动还款');

  var at = nowIso();
  q('UPDATE xy_ledger_loans SET auto_repay = ? WHERE id = ?').run(on ? 1 : 0, id);
  auditRow(uid, 'auto_repay', String(o.operator || uid), String(o.reason || ''),
    { loan_id: id, on: !!on }, 'audit:loan:' + id + ':auto:' + at, at);
  return view(q('SELECT * FROM xy_ledger_loans WHERE id = ?').get(id));
}

// 每日津贴到账后调用：只还 auto_repay=1 的那笔贷款，金额封顶为当日津贴/剩余应还。
// 返回 null 表示没有自动还款的贷款；调用方（钱包每日津贴）不应因此报错。
function autoRepayFromDaily(userId, amountCent, ref) {
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid) || !schemaReady()) return null;
  var row = q([
    "SELECT * FROM xy_ledger_loans WHERE user_id = ? AND status = 'active' AND auto_repay = 1",
    'ORDER BY id ASC LIMIT 1'
  ].join(' ')).get(uid);
  if (!row) return null;
  var v = view(row);
  var amt = Math.min(Math.floor(Number(amountCent) || 0), v.remaining_cent);
  if (amt <= 0) return null;
  var r = repay(uid, amt, { ref: ref });
  return {
    amount_cent: amt,
    amount: fromCent(amt),
    loan: r.loan,
    allocation: r.allocation
  };
}

// ---------- 明细 / 提醒 ----------
function detail(loanId, userId) {
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  ensureReady();
  var id = Number(loanId);
  if (!isFinite(id) || id <= 0) throw new Error('贷款不存在');
  var row = q('SELECT * FROM xy_ledger_loans WHERE id = ?').get(id);
  if (!row || String(row.user_id) !== uid) throw new Error('贷款不存在');

  var repays = q([
    'SELECT ref, amount_cent, principal_cent, interest_cent, created_at',
    'FROM xy_ledger_loan_repays WHERE loan_id = ? ORDER BY id ASC'
  ].join(' ')).all(id).map(function (r) {
    return {
      ref: r.ref,
      amount_cent: r.amount_cent,
      amount: fromCent(r.amount_cent),
      principal_cent: r.principal_cent,
      principal: fromCent(r.principal_cent),
      interest_cent: r.interest_cent,
      interest: fromCent(r.interest_cent),
      created_at: r.created_at
    };
  });
  return { loan: view(row), repayments: repays };
}

function alert(userId) {
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) return null;
  if (!schemaReady()) return null;
  var row = activeLoan(uid);
  if (!row) return null;
  var v = view(row);
  if (!v.next_due_at) return null;
  var dueMs = Date.parse(v.next_due_at);
  var dueSoon = isFinite(dueMs) && Date.now() >= dueMs - 86400000;
  if (!v.overdue && !v.in_grace && !dueSoon) return null;
  return {
    id: v.id,
    product: v.product,
    product_name: v.product_name,
    overdue: v.overdue,
    in_grace: v.in_grace,
    due_soon: dueSoon,
    overdue_days: v.overdue_days,
    due_at: v.next_due_at,
    remaining_cent: v.next_due_cent,
    remaining: v.next_due_amount,
    total_remaining: v.remaining,
    installment: v.paid_installments + 1,
    installments: v.total_installments
  };
}

// ---------- 班管 ----------
function adminList(opts) {
  var o = opts || {};
  ensureReady();
  var status = String(o.status || 'active');
  var limit = Math.min(Math.max(parseInt(o.limit, 10) || 50, 1), 200);
  var where = [];
  var args = [];
  var cutoffIso = new Date(Date.now() - GRACE_MS).toISOString();

  if (status === 'active') {
    where.push("l.status = 'active'");
  } else if (status === 'overdue') {
    where.push([
      "l.status = 'active' AND EXISTS (",
      '  SELECT 1 FROM xy_ledger_loan_installments i',
      "  WHERE i.loan_id = l.id AND i.status = 'pending' AND i.due_at < ?)"
    ].join(' '));
    args.push(cutoffIso);
  } else if (status === 'repaid' || status === 'written_off') {
    where.push('l.status = ?');
    args.push(status);
  } else if (status !== 'all') {
    throw new Error('未知的贷款状态: ' + status);
  }
  args.push(limit);

  var rows = q([
    "SELECT l.*, COALESCE(NULLIF(u.net_name, ''), NULLIF(u.real_name, ''), l.user_id) AS user_name",
    'FROM xy_ledger_loans l LEFT JOIN users u ON u.user_id = l.user_id',
    where.length ? 'WHERE ' + where.join(' AND ') : '',
    'ORDER BY l.id DESC LIMIT ?'
  ].filter(Boolean).join('\n')).all(...args);

  return rows.map(function (r) {
    var v = view(r);
    var prof = profileRow(r.user_id);
    var tier = tierOf(prof.score);
    v.user_id = r.user_id;
    v.user_name = r.user_name || r.user_id;
    v.score = prof.score;
    v.tier = tier.id;
    v.tier_name = tier.name;
    return v;
  });
}

function adminCredit(userId) {
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  ensureReady();
  var prof = profileRow(uid);
  var user = q('SELECT user_id, net_name, real_name FROM users WHERE user_id = ?').get(uid);
  return {
    user_id: uid,
    user_name: user ? (user.net_name || user.real_name || uid) : uid,
    profile: profileView(prof),
    limit_cent: creditLimitCent(uid),
    limit: fromCent(creditLimitCent(uid)),
    used_cent: outstandingPrincipalCent(uid),
    used: fromCent(outstandingPrincipalCent(uid)),
    on_time_count: onTimeCount(uid),
    late_count: lateCount(uid),
    events: scoreEvents(uid, 50),
    audits: auditList(uid, 50),
    loans: list(uid, 50)
  };
}

function extend(loanId, days, opts) {
  var o = opts || {};
  var id = Number(loanId);
  var d = Math.round(Number(days));
  if (!isFinite(id) || id <= 0) throw new Error('贷款不存在');
  if (!isFinite(d) || d <= 0 || d > 90) throw new Error('延期天数必须在 1–90 天之间');
  ensureReady();
  var operator = String(o.operator == null ? '' : o.operator).trim();
  if (!operator) throw new Error('延期必须记录操作人');
  var reason = String(o.reason == null ? '' : o.reason).trim().slice(0, 120) || '班管延期';

  var row = q('SELECT * FROM xy_ledger_loans WHERE id = ?').get(id);
  if (!row) throw new Error('贷款不存在');
  if (row.status !== 'active') throw new Error('只有还款中的贷款可以延期');

  var at = nowIso();
  var run = db.transaction(function () {
    var pending = q([
      "SELECT * FROM xy_ledger_loan_installments WHERE loan_id = ? AND status = 'pending'"
    ].join(' ')).all(id);
    pending.forEach(function (x) {
      var dueMs = Date.parse(x.due_at);
      var next = new Date((isFinite(dueMs) ? dueMs : Date.now()) + d * 86400000).toISOString();
      q('UPDATE xy_ledger_loan_installments SET due_at = ? WHERE id = ?').run(next, x.id);
    });
    var last = q('SELECT MAX(due_at) AS d FROM xy_ledger_loan_installments WHERE loan_id = ?').get(id);
    q('UPDATE xy_ledger_loans SET due_at = ? WHERE id = ?').run(last.d || row.due_at, id);
    auditRow(row.user_id, 'extend', operator, reason, { loan_id: id, days: d },
      'audit:loan:' + id + ':extend:' + at, at);
  });
  run();

  return { loan: view(q('SELECT * FROM xy_ledger_loans WHERE id = ?').get(id)), days: d };
}

function setLimit(userId, limitCent, opts) {
  var o = opts || {};
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  ensureReady();
  var operator = String(o.operator == null ? '' : o.operator).trim();
  if (!operator) throw new Error('限额必须记录操作人');
  var n = Number(limitCent);
  if (!isFinite(n) || Math.floor(n) !== n || n < 0) throw new Error('限额不合法');
  if (n > MAX_LOAN_CENT) throw new Error('限额不能超过 ' + fromCent(MAX_LOAN_CENT) + ' 学元');
  var reason = String(o.reason == null ? '' : o.reason).trim().slice(0, 120) || '班管调整限额';
  var prof = profileRow(uid);
  var at = nowIso();
  q('UPDATE xy_ledger_credit_profiles SET limit_override_cent = ?, updated_at = ? WHERE user_id = ?')
    .run(n, at, uid);
  auditRow(uid, 'limit', operator, reason, { before_cent: prof.limit_override_cent, after_cent: n },
    'audit:credit:' + uid + ':limit:' + at, at);
  return {
    user_id: uid,
    limit_override_cent: n,
    limit_override: fromCent(n),
    limit_cent: creditLimitCent(uid),
    limit: fromCent(creditLimitCent(uid))
  };
}

function adjustScore(userId, delta, opts) {
  var o = opts || {};
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  ensureReady();
  var operator = String(o.operator == null ? '' : o.operator).trim();
  if (!operator) throw new Error('调分必须记录操作人');
  var d = Math.round(Number(delta));
  if (!isFinite(d) || d === 0 || Math.abs(d) > 200) throw new Error('调分幅度必须在 -200 到 200 之间');
  var reason = String(o.reason == null ? '' : o.reason).trim().slice(0, 120);
  if (!reason) throw new Error('调分必须填写原因');
  var ref = String(o.ref == null ? '' : o.ref).trim() ||
    ('score:admin:' + uid + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8));
  var prof = profileRow(uid);
  var at = nowIso();
  var r = scoreEvent(uid, d, '班管调分：' + reason, ref, at);
  auditRow(uid, 'score', operator, reason, { delta: d, before: prof.score, after: r.score, ref: ref },
    'audit:credit:' + uid + ':score:' + ref, at);
  return { duplicate: !!r.duplicate, score: r.score, ref: ref };
}

function setBlacklist(userId, until, opts) {
  var o = opts || {};
  var uid = String(userId == null ? '' : userId);
  if (!USER_ID_RE.test(uid)) throw new Error('账户非法');
  ensureReady();
  var operator = String(o.operator == null ? '' : o.operator).trim();
  if (!operator) throw new Error('拉黑必须记录操作人');
  var reason = String(o.reason == null ? '' : o.reason).trim().slice(0, 120);
  var untilIso = null;
  if (until) {
    var t = Date.parse(until);
    if (!isFinite(t)) throw new Error('解禁时间不合法');
    untilIso = new Date(t).toISOString();
    if (!reason) throw new Error('拉黑必须填写原因');
  }
  var at = nowIso();
  profileRow(uid);
  q('UPDATE xy_ledger_credit_profiles SET blacklist_until = ?, blacklist_reason = ?, updated_at = ? WHERE user_id = ?')
    .run(untilIso, untilIso ? reason : null, at, uid);
  var action = untilIso ? 'blacklist' : 'unblacklist';
  auditRow(uid, action, operator, reason, { until: untilIso },
    'audit:credit:' + uid + ':' + action + ':' + at, at);
  return { user_id: uid, blacklist_until: untilIso, blacklist_reason: untilIso ? reason : '' };
}

// ---------- 统计与自检 ----------
function stats() {
  if (!schemaReady()) return { ready: false };
  var cutoffIso = new Date(Date.now() - GRACE_MS).toISOString();
  var row = q([
    'SELECT COUNT(*) AS total,',
    " SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,",
    " SUM(CASE WHEN status = 'repaid' THEN 1 ELSE 0 END) AS repaid,",
    " SUM(CASE WHEN status = 'written_off' THEN 1 ELSE 0 END) AS written_off,",
    " SUM(CASE WHEN status = 'repaid' AND late_flag = 0 THEN 1 ELSE 0 END) AS on_time,",
    " SUM(CASE WHEN status = 'repaid' AND late_flag = 1 THEN 1 ELSE 0 END) AS late,",
    ' COALESCE(SUM(CASE WHEN status = \'active\'',
    '   THEN principal_cent - repaid_principal_cent ELSE 0 END), 0) AS principal_outstanding_cent,',
    ' COALESCE(SUM(CASE WHEN status = \'active\'',
    '   THEN interest_cent - repaid_interest_cent ELSE 0 END), 0) AS interest_outstanding_cent,',
    ' COALESCE(SUM(CASE WHEN status = \'written_off\'',
    '   THEN principal_cent - repaid_principal_cent ELSE 0 END), 0) AS written_off_principal_cent,',
    ' COALESCE(SUM(repaid_principal_cent), 0) AS repaid_principal_cent,',
    ' COALESCE(SUM(repaid_interest_cent), 0) AS repaid_interest_cent,',
    ' COUNT(DISTINCT user_id) AS borrowers',
    'FROM xy_ledger_loans'
  ].join('\n')).get();

  var overdue = Number(q([
    "SELECT COUNT(*) AS n FROM xy_ledger_loans l WHERE l.status = 'active' AND EXISTS (",
    '  SELECT 1 FROM xy_ledger_loan_installments i',
    "  WHERE i.loan_id = l.id AND i.status = 'pending' AND i.due_at < ?)"
  ].join('\n')).get(cutoffIso).n) || 0;

  var overduePrincipalCent = Number(q([
    'SELECT COALESCE(SUM(l.principal_cent - l.repaid_principal_cent), 0) AS s',
    'FROM xy_ledger_loans l',
    "WHERE l.status = 'active' AND EXISTS (",
    '  SELECT 1 FROM xy_ledger_loan_installments i',
    "  WHERE i.loan_id = l.id AND i.status = 'pending' AND i.due_at < ?)"
  ].join('\n')).get(cutoffIso).s) || 0;

  var nowIsoStr = new Date().toISOString();
  var soonIso = new Date(Date.now() + 7 * 86400000).toISOString();
  var due7Cent = Number(q([
    'SELECT COALESCE(SUM(l.principal_cent - l.repaid_principal_cent), 0) AS s',
    'FROM xy_ledger_loans l',
    "WHERE l.status = 'active' AND EXISTS (",
    '  SELECT 1 FROM xy_ledger_loan_installments i',
    "  WHERE i.loan_id = l.id AND i.status = 'pending' AND i.due_at >= ? AND i.due_at <= ?)"
  ].join('\n')).get(nowIsoStr, soonIso).s) || 0;

  var productRows = q([
    'SELECT product, COUNT(*) AS n,',
    " SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,",
    ' COALESCE(SUM(CASE WHEN status = \'active\'',
    '   THEN principal_cent - repaid_principal_cent ELSE 0 END), 0) AS outstanding_cent',
    'FROM xy_ledger_loans GROUP BY product'
  ].join('\n')).all();
  var products = {};
  PRODUCTS.forEach(function (p) { products[p.id] = { n: 0, active: 0, outstanding_cent: 0, outstanding: 0 }; });
  productRows.forEach(function (r) {
    if (!products[r.product]) products[r.product] = { n: 0, active: 0, outstanding_cent: 0, outstanding: 0 };
    products[r.product] = {
      n: Number(r.n) || 0,
      active: Number(r.active) || 0,
      outstanding_cent: Number(r.outstanding_cent) || 0,
      outstanding: fromCent(r.outstanding_cent)
    };
  });

  var profiles = q('SELECT score FROM xy_ledger_credit_profiles').all();
  var tiers = { C: 0, B: 0, A: 0, S: 0 };
  var scoreSum = 0;
  profiles.forEach(function (p) {
    tiers[tierOf(p.score).id]++;
    scoreSum += p.score;
  });

  var pool = poolInfo();
  return {
    ready: true,
    total: Number(row.total) || 0,
    active: Number(row.active) || 0,
    repaid: Number(row.repaid) || 0,
    on_time_repaid: Number(row.on_time) || 0,
    late_repaid: Number(row.late) || 0,
    written_off: Number(row.written_off) || 0,
    overdue: overdue,
    overdue_principal_cent: overduePrincipalCent,
    overdue_principal: fromCent(overduePrincipalCent),
    due_7d_principal_cent: due7Cent,
    due_7d_principal: fromCent(due7Cent),
    borrowers: Number(row.borrowers) || 0,
    grace_hours: GRACE_HOURS,
    write_off_cooldown_days: WRITE_OFF_COOLDOWN_DAYS,
    principal_outstanding_cent: Number(row.principal_outstanding_cent) || 0,
    principal_outstanding: fromCent(row.principal_outstanding_cent),
    interest_outstanding_cent: Number(row.interest_outstanding_cent) || 0,
    interest_outstanding: fromCent(row.interest_outstanding_cent),
    written_off_principal_cent: Number(row.written_off_principal_cent) || 0,
    written_off_principal: fromCent(row.written_off_principal_cent),
    repaid_principal_cent: Number(row.repaid_principal_cent) || 0,
    repaid_principal: fromCent(row.repaid_principal_cent),
    repaid_interest_cent: Number(row.repaid_interest_cent) || 0,
    repaid_interest: fromCent(row.repaid_interest_cent),
    products: products,
    tiers: tiers,
    avg_score: profiles.length ? Math.round(scoreSum / profiles.length) : SCORE_START,
    pool_cap_cent: pool.cap_cent,
    pool_cap: pool.cap,
    pool_used_cent: pool.used_cent,
    pool_used: pool.used,
    pool_available_cent: pool.available_cent,
    pool_available: pool.available
  };
}

function audit() {
  if (!schemaReady()) return { ok: true, skipped: true, issues: [] };
  var issues = [];
  function push(detail) { issues.push({ code: 'I10', detail: detail }); }

  q([
    'SELECT id FROM xy_ledger_loans',
    'WHERE repaid_principal_cent > principal_cent OR repaid_interest_cent > interest_cent',
    '   OR repaid_principal_cent < 0 OR repaid_interest_cent < 0 LIMIT 20'
  ].join('\n')).all().forEach(function (r) {
    push('贷款 ' + r.id + ' 已还金额越界');
  });

  q([
    'SELECT id FROM xy_ledger_loans',
    "WHERE status = 'written_off' AND write_off_at IS NULL LIMIT 20"
  ].join('\n')).all().forEach(function (r) {
    push('贷款 ' + r.id + ' 标记已核销但没有核销时间');
  });

  q([
    'SELECT id FROM xy_ledger_loans',
    "WHERE status = 'repaid' AND (repaid_principal_cent <> principal_cent OR repaid_interest_cent <> interest_cent)",
    'LIMIT 20'
  ].join('\n')).all().forEach(function (r) {
    push('贷款 ' + r.id + ' 标记已还清但仍有未还金额');
  });

  q([
    'SELECT l.id FROM xy_ledger_loans l LEFT JOIN xy_ledger_loan_installments i ON i.loan_id = l.id',
    'GROUP BY l.id',
    'HAVING COALESCE(SUM(i.principal_cent), 0) <> l.principal_cent',
    '   OR COALESCE(SUM(i.interest_cent), 0) <> l.interest_cent LIMIT 20'
  ].join('\n')).all().forEach(function (r) {
    push('贷款 ' + r.id + ' 的分期本金/利息与贷款总额不一致');
  });

  q([
    'SELECT l.id, l.principal_cent, l.interest_cent,',
    '       COALESCE(SUM(i.paid_principal_cent), 0) AS pp,',
    '       COALESCE(SUM(i.paid_interest_cent), 0) AS pi,',
    '       l.repaid_principal_cent, l.repaid_interest_cent',
    'FROM xy_ledger_loans l LEFT JOIN xy_ledger_loan_installments i ON i.loan_id = l.id',
    'GROUP BY l.id',
    'HAVING l.repaid_principal_cent <> pp OR l.repaid_interest_cent <> pi LIMIT 20'
  ].join('\n')).all().forEach(function (r) {
    push('贷款 ' + r.id + ' 累计已还与分期账单不一致');
  });

  q([
    "SELECT l.id FROM xy_ledger_loans l",
    "WHERE l.status = 'repaid' AND EXISTS (",
    "  SELECT 1 FROM xy_ledger_loan_installments i WHERE i.loan_id = l.id AND i.status = 'pending')",
    'LIMIT 20'
  ].join('\n')).all().forEach(function (r) {
    push('贷款 ' + r.id + ' 标记已还清但仍有未结清分期');
  });

  q([
    "SELECT l.id FROM xy_ledger_loans l",
    "WHERE l.status = 'active' AND NOT EXISTS (",
    "  SELECT 1 FROM xy_ledger_loan_installments i WHERE i.loan_id = l.id AND i.status = 'pending')",
    'LIMIT 20'
  ].join('\n')).all().forEach(function (r) {
    push('贷款 ' + r.id + ' 所有分期已结清但状态仍为 active');
  });

  q([
    'SELECT l.id, l.repaid_principal_cent, l.repaid_interest_cent,',
    '       COALESCE(SUM(r.principal_cent), 0) AS rp,',
    '       COALESCE(SUM(r.interest_cent), 0) AS ri',
    'FROM xy_ledger_loans l LEFT JOIN xy_ledger_loan_repays r ON r.loan_id = l.id',
    'GROUP BY l.id',
    'HAVING l.repaid_principal_cent <> rp OR l.repaid_interest_cent <> ri',
    'LIMIT 20'
  ].join('\n')).all().forEach(function (r) {
    push('贷款 ' + r.id + ' 累计已还与还款明细不一致');
  });

  q([
    'SELECT l.id, l.principal_cent, COALESCE(SUM(e.amount_cent), 0) AS paid_in',
    'FROM xy_ledger_loans l',
    "LEFT JOIN xy_ledger_entries e ON e.tx_id = l.out_tx_id AND e.asset = 'GRANT'",
    '  AND e.account_id = l.account_id AND e.direction = 1',
    'GROUP BY l.id',
    'HAVING l.principal_cent <> paid_in LIMIT 20'
  ].join('\n')).all().forEach(function (r) {
    push('贷款 ' + r.id + ' 放款流水与本金不一致');
  });

  q([
    'SELECT * FROM (',
    '  SELECT p.user_id, p.score,',
    '    (SELECT e.score_after FROM xy_ledger_credit_events e',
    '     WHERE e.user_id = p.user_id ORDER BY e.id DESC LIMIT 1) AS last_score',
    '  FROM xy_ledger_credit_profiles p',
    ') WHERE last_score IS NOT NULL AND score <> last_score LIMIT 20'
  ].join('\n')).all().forEach(function (r) {
    push('用户 ' + r.user_id + ' 信用分 ' + r.score + ' 与最后一条记分 ' + r.last_score + ' 不一致');
  });

  return { ok: issues.length === 0, skipped: false, issues: issues };
}

module.exports = {
  MIN_LOAN_CENT: MIN_LOAN_CENT,
  MAX_LOAN_CENT: MAX_LOAN_CENT,
  BASE_LIMIT_CENT: BASE_LIMIT_CENT,
  MAX_LIMIT_CENT: MAX_LIMIT_CENT,
  STEP_CENT: STEP_CENT,
  TERM_DAYS: TERM_DAYS,
  INTEREST_PERCENT: INTEREST_PERCENT,
  GRACE_HOURS: GRACE_HOURS,
  POOL_CAP_CENT: POOL_CAP_CENT,
  WRITE_OFF_COOLDOWN_DAYS: WRITE_OFF_COOLDOWN_DAYS,
  SCORE_START: SCORE_START,
  SCORE_ON_TIME: SCORE_ON_TIME,
  SCORE_ON_TIME_COOLDOWN_HOURS: SCORE_ON_TIME_COOLDOWN_HOURS,
  SCORE_LATE: SCORE_LATE,
  SCORE_WRITE_OFF: SCORE_WRITE_OFF,
  TIERS: TIERS,
  PRODUCTS: PRODUCTS,
  isEnabled: isEnabled,
  schemaReady: schemaReady,
  ensureReady: ensureReady,
  productOf: productOf,
  tierOf: tierOf,
  rateFor: rateFor,
  profile: profileRow,
  profileView: profileView,
  scoreEvents: scoreEvents,
  creditLimitCent: creditLimitCent,
  onTimeCount: onTimeCount,
  onTimeDays: onTimeDays,
  lateCount: lateCount,
  repaidCount: repaidCount,
  outstandingTotalCent: outstandingTotalCent,
  poolInfo: poolInfo,
  summary: summary,
  list: list,
  apply: apply,
  repay: repay,
  writeOff: writeOff,
  detail: detail,
  alert: alert,
  adminList: adminList,
  adminCredit: adminCredit,
  extend: extend,
  setLimit: setLimit,
  adjustScore: adjustScore,
  setBlacklist: setBlacklist,
  setAutoRepay: setAutoRepay,
  autoRepayFromDaily: autoRepayFromDaily,
  stats: stats,
  audit: audit,
  view: view
};
