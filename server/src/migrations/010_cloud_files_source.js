// 迁移 010：cloud_files 增加 source 列（上传渠道标记）
//
// 背景：班管审核只应针对「家庭上传通道」进来的文件（专属页 CloudLite = 'lite'、
// 上传码免登录 = 'guest'），教室局域网日常上传（'app'）不进入审核流。
//
// 幂等性说明：列已存在时跳过。

function up(db) {
  var cols = db.prepare('PRAGMA table_info(cloud_files)').all();
  var hasSource = cols.some(function (c) { return c.name === 'source'; });
  if (!hasSource) {
    db.exec("ALTER TABLE cloud_files ADD COLUMN source TEXT NOT NULL DEFAULT 'app'");
  }
}

module.exports = { version: 10, name: 'cloud_files_source', up: up };
