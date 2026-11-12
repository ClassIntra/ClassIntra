// 学元账本 · 一屏总览
// ============================================================
// v2 加固之后系统有了六套自检：check() / checkDeep() / proof.verify() /
// reconcile.run() / supply 计数器 / post_attempts。能力齐了，但班管要开
// 五个端点才知道「今天到底正不正常」—— 这本身就是混乱。
//
// 本模块把它们**收成一句话**：一个 status、一句 headline、一组统一单位数字。
// 所有金额一律输出「学元」，绝不把 *_cent 直接抛给前端（1 元 = 1000 学元
// × 100 账本单位，历史上 /1000 与 /100 混用让管理端数字差过 100 倍）。
//
// 只读，不写任何表；任何子模块缺席都降级为「暂不可用」而不是抛错。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var db = require('../utils/db');
var inv = require('./invariants');
var proof = require('./proof');
var reconcile = require('./reconcile');
var supply = require('./supply');
var units = require('./units');

function q(sql) { return db.prepare(sql); }

// 账本单位 → 学元（前端展示唯一口径）
function xy(cent) {
  return Math.round(Number(cent || 0)) / units.UNITS_PER_XUEYUAN;
}

function count(sql) {
  try { return q(sql).get().n; } catch (e) { return 0; }
}

function tableExists(name) {
  try {
    return !!q("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  } catch (e) { return false; }
}

function attemptsSummary() {
  var out = { last_24h: 0, top: [] };
  if (!tableExists('xy_ledger_post_attempts')) return out;
  try {
    var since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    out.last_24h = q('SELECT COUNT(*) AS n FROM xy_ledger_post_attempts WHERE created_at >= ?').get(since).n;
    out.top = q([
      'SELECT error_code, COUNT(*) AS n FROM xy_ledger_post_attempts',
      'WHERE created_at >= ? GROUP BY error_code ORDER BY n DESC LIMIT 5'
    ].join('\n')).all(since);
  } catch (e) { /* 老库兼容 */ }
  return out;
}

function adviceFor(issues, status) {
  if (status === 'ok') return ['无需处理。'];
  var out = [];
  function has(re) {
    return issues.some(function (i) { return re.test(i.code); });
  }
  if (has(/SEAL|I11|PROOF/)) {
    out.push('账本哈希链异常：打开详情看「链校验」，确认是否有人改过历史分录。');
  }
  if (has(/BALANCE_DRIFT|I1c|I2|CASH_COVER/)) {
    out.push('余额与流水不一致：点「重新对账」跑一次日终对账，差异会落库可查。');
  }
  if (has(/VERSION|I13|SUPPLY|I12/)) {
    out.push('有余额或发行计数器疑似绕过 ledger.post 写入，请查最近的部署或脚本。');
  }
  if (has(/RECONCILE/)) {
    out.push('最近一次日终对账有差异，重跑后请看差异明细，不要只看总数。');
  }
  if (has(/NO_RECONCILE/)) {
    out.push('今天还没跑过日终对账，点「重新对账」即可生成。');
  }
  if (!out.length) out.push('打开下方详情查看具体问题。');
  return out;
}

function build(opts) {
  var o = opts || {};
  var deep = inv.checkDeep();
  var head = proof.head();
  var last = reconcile.latest();
  var lastRun = last ? last.run : null;
  var lastDiffs = last ? last.diffs : [];
  var attempts = attemptsSummary();
  var proofSummary = deep.summary.proof || {};
  var supplySummary = deep.summary.supply || {};

  var issues = [];
  (deep.base_issues || []).forEach(function (i) {
    issues.push({ level: 'error', code: i.code, detail: i.detail });
  });
  (deep.issues || []).forEach(function (i) {
    issues.push({ level: 'error', code: i.code, detail: i.detail });
  });
  if (lastRun && !lastRun.ok) {
    issues.push({
      level: 'error', code: 'RECONCILE_FAILED',
      detail: '最近一次日终对账有 ' + Number(lastRun.issue_count || 0) + ' 项差异'
    });
  }

  var hardErrors = issues.filter(function (i) { return i.level === 'error'; });
  var notices = [];
  if (!lastRun) notices.push({ level: 'info', code: 'NO_RECONCILE', detail: '今天还没有对账记录' });
  if (attempts.last_24h > 50) {
    notices.push({ level: 'warn', code: 'ATTEMPTS_HIGH', detail: '近 24 小时有 ' + attempts.last_24h + ' 次被拒绝的写入，建议看详情' });
  }

  var status = hardErrors.length ? 'error' : (notices.length ? 'attention' : 'ok');
  var all = issues.concat(notices);
  var headline = status === 'ok'
    ? '账本正常：分录守恒、哈希链完整、日终对账零差异'
    : (status === 'error'
      ? '账本有 ' + hardErrors.length + ' 项异常，需要立即核查'
      : '账本基本正常，有 ' + notices.length + ' 项需要留意');

  var platformCash = inv.platformCashCent();
  var cost = -inv.cashbookPnlCent();

  return {
    status: status,
    headline: headline,
    checked_at: new Date().toISOString(),
    unit: 'xueyuan',
    unit_note: '所有金额单位为学元；1 元 = 1000 学元 = 100000 账本单位',
    money: {
      cash_on_book: xy(inv.cashOnBookCent()),
      cash_liability: xy(inv.cashLiabilityCent()),
      cashbook_liability: xy(inv.cashbookLiabilityCent()),
      platform_cash: xy(platformCash),
      cost: xy(cost),
      gross: xy(platformCash - cost)
    },
    counts: {
      tx: count('SELECT COUNT(*) AS n FROM xy_ledger_transactions'),
      entries: count('SELECT COUNT(*) AS n FROM xy_ledger_entries'),
      orders: count('SELECT COUNT(*) AS n FROM xy_ledger_orders')
    },
    layers: {
      ledger: {
        ok: !!deep.base_ok,
        issue_count: (deep.base_issues || []).length,
        checked: inv.ALL.length
      },
      proof: {
        ok: proofSummary.ok !== false,
        skipped: !!proofSummary.skipped,
        checked: proofSummary.checked || 0,
        legacy_checked: proofSummary.legacy_checked || 0,
        head_tx_id: head ? Number(head.head_tx_id) : null
      },
      reconcile: {
        ok: lastRun ? !!lastRun.ok : null,
        last_at: lastRun ? lastRun.finished_at : null,
        issue_count: lastRun ? Number(lastRun.issue_count || 0) : 0,
        diffs: lastDiffs.slice(0, 10).map(function (d) {
          return { code: d.code, scope: d.scope, key: d.key_name, detail: d.detail, level: d.level };
        })
      },
      supply: {
        ok: supplySummary.ok !== false,
        caps: supply.all().map(function (r) {
          return { asset: r.asset, issued_xy: xy(r.issued_cent), cap_xy: xy(supply.capOf(db, r.asset)) };
        })
      },
      attempts: attempts
    },
    issues: all.slice(0, 20),
    advice: adviceFor(all, status),
    // 兼容标记：老库没跑迁移 046 时，前端应显示「能力未就绪」而不是空白
    capabilities: {
      proof: tableExists('xy_ledger_chain_state'),
      reconcile: reconcile.ready(),
      attempts: tableExists('xy_ledger_post_attempts')
    }
  };
}

module.exports = {
  build: build
};
