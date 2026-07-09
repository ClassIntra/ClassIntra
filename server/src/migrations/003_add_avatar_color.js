// 迁移 v3：用户头像颜色持久化
// 在 user_settings 表添加 avatar_color 列，支持跨设备同步
//
// 幂等性：使用 PRAGMA table_info 检查列是否存在后再 ALTER TABLE

function up(db) {
  var tableInfo = db.prepare("PRAGMA table_info(user_settings)").all();
  var hasColumn = false;
  for (var i = 0; i < tableInfo.length; i++) {
    if (tableInfo[i].name === 'avatar_color') {
      hasColumn = true;
      break;
    }
  }

  if (!hasColumn) {
    db.exec("ALTER TABLE user_settings ADD COLUMN avatar_color TEXT DEFAULT ''");
    console.log('[migration v3] 已添加 user_settings.avatar_color 列');
  } else {
    console.log('[migration v3] avatar_color 列已存在，跳过');
  }
}

module.exports = {
  version: 3,
  name: 'add_avatar_color',
  up: up
};
