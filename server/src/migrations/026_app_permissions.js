// 迁移 026：第三方应用的运行时权限（按 应用 × 用户 × 能力 记授权）
//
// 为什么需要：
//   「能力披露」（manifest.capabilities）只是安装期告知，装完就拥有一切。
//   iOS / Android 都是「声明 + 用时授权」两段式：manifest 声明，首次调用弹窗。
//   校园场景里相机、麦克风、通知属于敏感面，班管需要能看见并撤销。
//
// 语义：
//   - 一行 = 某用户对某应用的某项敏感能力已授权
//   - granted_via: 'prompt'（用户点允许）/ 'admin'（班管代授）
//   - 撤销即删行，应用下次调用会重新弹窗
//   - 应用卸载不自动删（重装后用户不必再点一遍）；班管可显式清

function up(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_permissions (' +
    '  app_name TEXT NOT NULL,' +
    '  user_id TEXT NOT NULL,' +
    '  capability TEXT NOT NULL,' +
    '  granted_via TEXT DEFAULT "prompt",' +
    '  granted_at INTEGER,' +
    '  PRIMARY KEY (app_name, user_id, capability)' +
    ')'
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_app_permissions_app ON app_permissions (app_name)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_app_permissions_user ON app_permissions (user_id)');
}

module.exports = { version: 26, name: 'app_permissions', up: up };
