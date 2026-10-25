// 迁移 v19：个人封面图 + 用户关注关系
//
// 背景（2026-10-23 用户需求）：个人主页要有封面图（云盘选图 + 缩放裁选）、
// 点赞/关注按钮、帖子列表。头像一个文件一套列的做法已经验证过，封面照搬：
//   · cover_hash 存云盘 hash，封面读取走 /api/cloud/files/<hash>?w=<px>
//   · cover_crop 存裁切参数（zoom/ox/oy），任意尺寸容器裁出同一区域
//
// 关注表设计：
//   · (follower_id, followee_id) 联合主键，天然防重复关注
//   · 不存外键：跨班 relay 同步时对端 user 可能还没落库，FK 会直接拒写
//   · 自关注由路由层拦（DB 层不设 CHECK，保持与项目其它表一致的朴素风格）
//
// 幂等性：PRAGMA table_info + sqlite_master 双重检查。

function up(db) {
  var tableInfo = db.prepare("PRAGMA table_info(users)").all();
  var names = {};
  for (var i = 0; i < tableInfo.length; i++) names[tableInfo[i].name] = true;

  if (!names.cover_hash) {
    db.exec("ALTER TABLE users ADD COLUMN cover_hash TEXT DEFAULT ''");
    console.log('[migration v19] 已添加 users.cover_hash 列');
  } else {
    console.log('[migration v19] users.cover_hash 列已存在，跳过');
  }

  if (!names.cover_crop) {
    db.exec("ALTER TABLE users ADD COLUMN cover_crop TEXT DEFAULT ''");
    console.log('[migration v19] 已添加 users.cover_crop 列');
  } else {
    console.log('[migration v19] users.cover_crop 列已存在，跳过');
  }

  var hasFollows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='user_follows'"
  ).get();
  if (!hasFollows) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS user_follows (" +
      "  follower_id TEXT NOT NULL," +
      "  followee_id TEXT NOT NULL," +
      "  created_at INTEGER NOT NULL," +
      "  PRIMARY KEY (follower_id, followee_id)" +
      ")"
    );
    // 查「我关注了谁」和「谁关注了我」是两个方向都要走索引
    db.exec("CREATE INDEX IF NOT EXISTS idx_user_follows_followee ON user_follows(followee_id)");
    console.log('[migration v19] 已创建 user_follows 表');
  } else {
    console.log('[migration v19] user_follows 表已存在，跳过');
  }
}

module.exports = {
  version: 19,
  name: 'add_user_cover_and_follows',
  up: up
};
