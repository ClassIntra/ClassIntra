// 迁移 v17：用户头像图片（云盘选取 + 缩放裁选）
//
// 设计取舍（2026-10-23）：
//   - 存**云盘文件 hash** 而不是把图片复制一份到头像目录。云盘已有 ?w= 实时缩放
//     （sharp + LRU），列表用 ?w=128、详情用 ?w=512，零额外存储、零额外接口。
//   - 存**裁切参数**（zoom/ox/oy）而不是服务端预裁剪。前端用同一套公式渲染，
//     任何尺寸的容器裁出来的区域都一致；用户改裁切不用重新传图。
//   - 明文存 hash 而非路径，天然防目录穿越（hash 由 /api/cloud/files/:hash 校验归属）。
//
// 幂等性：PRAGMA table_info 检查后再 ALTER TABLE。

function up(db) {
  var tableInfo = db.prepare("PRAGMA table_info(users)").all();
  var names = {};
  for (var i = 0; i < tableInfo.length; i++) names[tableInfo[i].name] = true;

  if (!names.avatar_hash) {
    db.exec("ALTER TABLE users ADD COLUMN avatar_hash TEXT DEFAULT ''");
    console.log('[migration v17] 已添加 users.avatar_hash 列');
  } else {
    console.log('[migration v17] users.avatar_hash 列已存在，跳过');
  }

  if (!names.avatar_crop) {
    db.exec("ALTER TABLE users ADD COLUMN avatar_crop TEXT DEFAULT ''");
    console.log('[migration v17] 已添加 users.avatar_crop 列');
  } else {
    console.log('[migration v17] users.avatar_crop 列已存在，跳过');
  }
}

module.exports = {
  version: 17,
  name: 'add_user_avatar',
  up: up
};
