// 迁移 009：cloud_files 增加 status 列（班管事后审核）
//
// 背景：家庭上传链路开通后，学生可从公网上传媒体到云盘。
// 审核模式为「先上传再审核」：文件上传即可见（status='ok'），
// 班管在「上传审核」页发现违规文件后将其下架（status='hidden'），
// 下架后从所有列表消失、文件下发返回占位响应。
//
// 幂等性说明：列已存在时跳过。

function up(db) {
  var cols = db.prepare('PRAGMA table_info(cloud_files)').all();
  var hasStatus = cols.some(function (c) { return c.name === 'status'; });
  if (!hasStatus) {
    db.exec("ALTER TABLE cloud_files ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_cf_status ON cloud_files(status)");
  }
}

module.exports = { version: 9, name: 'cloud_files_status', up: up };
