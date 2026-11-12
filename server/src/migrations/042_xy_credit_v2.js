// 迁移 042：学元信用体系 v2（阶段 1）
//
// 只做加法，不重建任何表：
//   · 贷款表补 product / installments / rate_percent / late_flag
//   · 新增分期账单、信用档案、信用分变动、班管信用审计四张表
//   · 现有贷款回填成 1 期账单；现有借款人按历史还清记录补信用分
//
// 生产库在 041 之后已有 4 笔真实贷款（3 笔按时还清、1 笔未还）。
// 回填后：3 笔按时 = 600 + 3×40 = 720 分（A 级），额度仍为 2000，不改变现有状态。
// 幂等：新增列逐列 try/catch；表 IF NOT EXISTS；回填 INSERT OR IGNORE。
// 编码约定：var / function（服务端 CommonJS 风格）

var GRACE_DAYS = 1;   // 24 小时宽限，与 loan.js 默认一致
var SCORE_START = 600;
var SCORE_MIN = 300;
var SCORE_MAX = 850;
var SCORE_ON_TIME = 40;
var SCORE_LATE = -40;
var SCORE_WRITE_OFF = -150;

function clampScore(n) {
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, n));
}

function up(db) {
  // ---- 1. 贷款表加列（向后兼容：旧代码不读这些列也能跑） ----
  [
    ['product', "TEXT NOT NULL DEFAULT 'quick'"],
    ['installments', 'INTEGER NOT NULL DEFAULT 1'],
    ['rate_percent', 'REAL NOT NULL DEFAULT 5'],
    ['late_flag', 'INTEGER NOT NULL DEFAULT 0 CHECK (late_flag IN (0,1))']
  ].forEach(function (c) {
    try {
      db.exec('ALTER TABLE xy_ledger_loans ADD COLUMN ' + c[0] + ' ' + c[1]);
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e;
    }
  });

  // ---- 2. 新表 ----
  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_ledger_loan_installments (',
    '  id                   INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  loan_id              INTEGER NOT NULL REFERENCES xy_ledger_loans(id),',
    '  seq                  INTEGER NOT NULL CHECK (seq > 0),',
    '  due_at               TEXT NOT NULL,',
    '  principal_cent       INTEGER NOT NULL CHECK (principal_cent >= 0),',
    '  interest_cent        INTEGER NOT NULL CHECK (interest_cent >= 0),',
    '  paid_principal_cent  INTEGER NOT NULL DEFAULT 0',
    '                       CHECK (paid_principal_cent >= 0 AND paid_principal_cent <= principal_cent),',
    '  paid_interest_cent   INTEGER NOT NULL DEFAULT 0',
    '                       CHECK (paid_interest_cent >= 0 AND paid_interest_cent <= interest_cent),',
    "  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),",
    '  late_paid            INTEGER NOT NULL DEFAULT 0 CHECK (late_paid IN (0,1)),',
    '  paid_at              TEXT,',
    '  UNIQUE (loan_id, seq),',
    "  CHECK (status <> 'paid' OR (paid_principal_cent = principal_cent AND paid_interest_cent = interest_cent))",
    ');'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_ledger_loan_installments_loan ON xy_ledger_loan_installments(loan_id, seq)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_ledger_loan_installments_due ON xy_ledger_loan_installments(status, due_at)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_ledger_credit_profiles (',
    '  user_id              TEXT PRIMARY KEY,',
    '  score                INTEGER NOT NULL DEFAULT 600 CHECK (score BETWEEN 300 AND 850),',
    '  limit_override_cent  INTEGER NOT NULL DEFAULT 0 CHECK (limit_override_cent >= 0),',
    '  blacklist_until      TEXT,',
    '  blacklist_reason     TEXT,',
    '  created_at           TEXT NOT NULL,',
    '  updated_at           TEXT NOT NULL',
    ');'
  ].join('\n'));

  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_ledger_credit_events (',
    '  id          INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id     TEXT NOT NULL,',
    '  delta       INTEGER NOT NULL,',
    '  score_after INTEGER NOT NULL CHECK (score_after BETWEEN 300 AND 850),',
    '  reason      TEXT NOT NULL,',
    '  ref         TEXT NOT NULL UNIQUE,',
    '  created_at  TEXT NOT NULL',
    ');'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_ledger_credit_events_user ON xy_ledger_credit_events(user_id, id)');

  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_ledger_credit_audit (',
    '  id          INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  user_id     TEXT NOT NULL,',
    '  action      TEXT NOT NULL,',
    '  operator    TEXT NOT NULL,',
    '  reason      TEXT,',
    '  payload     TEXT,',
    '  ref         TEXT NOT NULL UNIQUE,',
    '  created_at  TEXT NOT NULL',
    ');'
  ].join('\n'));
  db.exec('CREATE INDEX IF NOT EXISTS idx_xy_ledger_credit_audit_user ON xy_ledger_credit_audit(user_id, id)');

  // ---- 3. 回填历史逾期标记 ----
  db.prepare([
    "UPDATE xy_ledger_loans SET late_flag = 1",
    "WHERE status = 'repaid' AND closed_at IS NOT NULL",
    '  AND julianday(closed_at) > julianday(due_at) + ?'
  ].join('\n')).run(GRACE_DAYS);

  // ---- 4. 每笔旧贷款回填为 1 期账单 ----
  var insInst = db.prepare([
    'INSERT OR IGNORE INTO xy_ledger_loan_installments',
    '  (loan_id, seq, due_at, principal_cent, interest_cent,',
    '   paid_principal_cent, paid_interest_cent, status, late_paid, paid_at)',
    'VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)'
  ].join(' '));
  db.prepare('SELECT * FROM xy_ledger_loans ORDER BY id').all().forEach(function (l) {
    var full = l.repaid_principal_cent >= l.principal_cent &&
      l.repaid_interest_cent >= l.interest_cent;
    insInst.run(
      l.id, l.due_at, l.principal_cent, l.interest_cent,
      l.repaid_principal_cent, l.repaid_interest_cent,
      full ? 'paid' : 'pending',
      full && l.late_flag ? 1 : 0,
      full ? (l.closed_at || l.last_repay_at || null) : null
    );
  });

  // ---- 5. 回填信用档案与记分历史 ----
  var insProfile = db.prepare([
    'INSERT OR IGNORE INTO xy_ledger_credit_profiles',
    '  (user_id, score, limit_override_cent, created_at, updated_at)',
    'VALUES (?, ?, 0, ?, ?)'
  ].join(' '));
  var insEvent = db.prepare([
    'INSERT OR IGNORE INTO xy_ledger_credit_events',
    '  (user_id, delta, score_after, reason, ref, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?)'
  ].join(' '));

  var users = db.prepare('SELECT DISTINCT user_id FROM xy_ledger_loans').all();
  users.forEach(function (u) {
    var exists = db.prepare('SELECT 1 AS x FROM xy_ledger_credit_profiles WHERE user_id = ?').get(u.user_id);
    if (exists) return;

    var loans = db.prepare('SELECT * FROM xy_ledger_loans WHERE user_id = ? ORDER BY id').all(u.user_id);
    var score = SCORE_START;
    var events = [];
    var nowIso = new Date().toISOString();

    loans.forEach(function (l) {
      if (l.status === 'repaid') {
        var delta = l.late_flag ? SCORE_LATE : SCORE_ON_TIME;
        score = clampScore(score + delta);
        events.push({
          delta: delta, score: score,
          reason: l.late_flag ? '补录历史：逾期还清' : '补录历史：按时还清',
          ref: 'score:backfill:loan:' + l.id,
          at: l.closed_at || nowIso
        });
      } else if (l.status === 'written_off') {
        var d = SCORE_WRITE_OFF;
        score = clampScore(score + d);
        events.push({
          delta: d, score: score, reason: '补录历史：贷款核销',
          ref: 'score:backfill:loan:' + l.id,
          at: l.write_off_at || nowIso
        });
      }
    });

    insProfile.run(u.user_id, score, nowIso, nowIso);
    events.forEach(function (e) {
      insEvent.run(u.user_id, e.delta, e.score, e.reason, e.ref, e.at);
    });
  });
}

module.exports = {
  version: 42,
  name: 'xy_credit_v2',
  up: up
};
