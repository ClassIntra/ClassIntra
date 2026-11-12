// 迁移 043：学元贷款支持「每日津贴自动还款」
//
// 只加一列，不动任何现有数据：
//   auto_repay=1：学生领每日助学津贴时，津贴先自动还这笔贷款，剩余的才进钱包。
// 津贴预支（advance）产品强制为 1；其他产品默认 0，学生可在证券信用页自己打开。
// 幂等：字段已存在就跳过。
// 编码约定：var / function（服务端 CommonJS 风格）

function up(db) {
  try {
    db.exec('ALTER TABLE xy_ledger_loans ADD COLUMN auto_repay INTEGER NOT NULL DEFAULT 0 CHECK (auto_repay IN (0,1))');
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
}

module.exports = { version: 43, name: 'xy_loan_auto_repay', up: up };
