// 迁移 v1：初始 schema 版本标记
// 此迁移为版本标记占位，不执行任何 schema 变更
// 用途：在 baseline(v0) 完成后标记"初始版本"已建立，为后续增量迁移预留版本号空间
//
// 历史背景：
// - v0 baseline 抽取自原 init-db.js 的全部表结构
// - v1 标记迁移系统已正式启用，schema_version 表中存在此记录表示迁移流程跑通
// - v2+ 为后续增量迁移（如 integrations 表）

function up(db) {
  // 无操作：仅作为版本标记
  // migration-runner 会在事务中执行 up() 后插入 schema_version 记录
}

module.exports = {
  version: 1,
  name: 'initial_schema_version',
  up: up
};
