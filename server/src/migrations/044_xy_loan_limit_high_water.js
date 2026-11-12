// 迁移 044：信用额度按「按时还款的自然日」成长
//
// 旧规则按「按时还清笔数」提额：同一天小额借还三次就能把额度从 500 刷到 2000。
// 新规则只按不同自然日计数，并在档案里记一个高水位，避免规则切换当天
// 让已有用户额度突然下调；高水位仍受当前等级 cap 约束，逾期降级照常生效。
//
// 幂等：字段已存在就跳过；回填只写一次（值为 0 的档案才回填）。
// 编码约定：var / function（服务端 CommonJS 风格）

function up(db) {
  try {
    db.exec('ALTER TABLE xy_ledger_credit_profiles ADD COLUMN limit_high_water_cent INTEGER NOT NULL DEFAULT 0 CHECK (limit_high_water_cent >= 0)');
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }

  // 回填旧口径额度（500 + 按时还清笔数 × 500，受等级 cap 与单笔上限约束）。
  var BASE = 50000;
  var STEP = 50000;
  var MAX = 200000;
  var rows = db.prepare('SELECT user_id, score FROM xy_ledger_credit_profiles').all();
  var count = db.prepare([
    "SELECT COUNT(*) AS n FROM xy_ledger_loans",
    "WHERE user_id = ? AND status = 'repaid' AND late_flag = 0"
  ].join(' '));
  var upd = db.prepare('UPDATE xy_ledger_credit_profiles SET limit_high_water_cent = ? WHERE user_id = ?');
  rows.forEach(function (r) {
    var n = Number(count.get(r.user_id).n) || 0;
    var cap = r.score >= 700 ? 200000 : (r.score >= 600 ? 150000 : 100000);
    upd.run(Math.min(BASE + n * STEP, cap, MAX), r.user_id);
  });
}

module.exports = { version: 44, name: 'xy_loan_limit_high_water', up: up };
