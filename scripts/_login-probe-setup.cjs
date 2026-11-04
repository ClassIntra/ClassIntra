// 登录流探针的隔离环境准备：把生产库快照到临时目录，只在这份副本里造探针账号。
// 生产库以 readonly 打开，绝不写入。
//
// 用法：node scripts/_login-probe-setup.cjs
// 产物：<tmp>/ci-login-probe/probe.db
//   - 251899 / ProbePass123：普通学生，壁纸 ci-probe-wallpaper.jpg
//   - 251898 / ProbePass123：普通学生，壁纸 ci-probe-wallpaper-b.jpg（换账号回归用）
//   - 251897 / ProbePass123：管理员（管理端启停应用回归用）
var fs = require('fs');
var path = require('path');
var os = require('os');
var Database = require('../server/node_modules/better-sqlite3');
var bcrypt = require('../server/node_modules/bcryptjs');

var SRC = path.resolve(__dirname, '../server/database/classintra.db');
var DIR = path.join(os.tmpdir(), 'ci-login-probe');
var DEST = path.join(DIR, 'probe.db');
var PASSWORD = 'ProbePass123';

var USERS = [
  { user_id: '251899', net_name: '登录探针', wallpaper: 'ci-probe-wallpaper.jpg', theme: 'dark', is_admin: 0, role: 'user' },
  { user_id: '251898', net_name: '登录探针B', wallpaper: 'ci-probe-wallpaper-b.jpg', theme: 'dark', is_admin: 0, role: 'user' },
  { user_id: '251897', net_name: '登录探针管理员', wallpaper: 'default', theme: 'dark', is_admin: 1, role: 'admin' }
];

(async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  for (var suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DEST + suffix); } catch (e) { /* 不存在 */ }
  }

  var src = new Database(SRC, { readonly: true });
  await src.backup(DEST);
  src.close();
  console.log('已快照:', DEST);

  var db = new Database(DEST);
  db.pragma('foreign_keys = ON');

  var userCols = db.prepare('PRAGMA table_info(users)').all().map(function(c) { return c.name; });
  var setCols = db.prepare('PRAGMA table_info(user_settings)').all().map(function(c) { return c.name; });
  console.log('users 列数:', userCols.length, '| user_settings 列数:', setCols.length);

  // 基准行：取一个在职普通学生，继承班级/年级等字段（只要登录与设置，不涉及权限）
  var base = db.prepare("SELECT * FROM users WHERE password_hash IS NOT NULL AND (is_admin IS NULL OR is_admin = 0) AND status = 'active' LIMIT 1").get();
  if (!base) { throw new Error('找不到可用基准用户行'); }

  var hash = bcrypt.hashSync(PASSWORD, 10);
  var now = new Date().toISOString();

  USERS.forEach(function(probe) {
    // ---- users ----
    var existing = db.prepare('SELECT id FROM users WHERE user_id = ?').get(probe.user_id);
    if (existing) {
      db.prepare('UPDATE users SET net_name = ?, real_name = ?, password_hash = ?, status = ?, is_admin = ?, role = ? WHERE user_id = ?')
        .run(probe.net_name, probe.net_name, hash, 'active', probe.is_admin, probe.role, probe.user_id);
    } else {
      var keys = Object.keys(base).filter(function(k) { return k !== 'id'; });
      var overrides = {
        user_id: probe.user_id,
        net_name: probe.net_name,
        real_name: probe.net_name,
        password_hash: hash,
        status: 'active',
        is_admin: probe.is_admin,
        role: probe.role
      };
      var sql = 'INSERT INTO users (' + keys.join(',') + ') VALUES (' + keys.map(function() { return '?'; }).join(',') + ')';
      db.prepare(sql).run(keys.map(function(k) {
        return Object.prototype.hasOwnProperty.call(overrides, k) ? overrides[k] : base[k];
      }));
    }

    // ---- user_settings：壁纸/主题可辨识，用于断言「登录后水合」而非默认壁纸 ----
    var setRow = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(probe.user_id);
    if (setRow) {
      db.prepare('UPDATE user_settings SET wallpaper = ?, theme = ?, updated_at = ? WHERE user_id = ?')
        .run(probe.wallpaper, probe.theme, now, probe.user_id);
    } else {
      var baseSet = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(base.user_id);
      var cols = ['user_id', 'wallpaper', 'theme', 'updated_at'];
      var vals = [probe.user_id, probe.wallpaper, probe.theme, now];
      if (baseSet) {
        Object.keys(baseSet).forEach(function(k) {
          if (k === 'id' || cols.indexOf(k) !== -1) return;
          cols.push(k); vals.push(baseSet[k]);
        });
      }
      db.prepare('INSERT INTO user_settings (' + cols.join(',') + ') VALUES (' + cols.map(function() { return '?'; }).join(',') + ')').run(vals);
    }

    var checkUser = db.prepare('SELECT user_id, net_name, status, is_admin, role, length(password_hash) AS hl FROM users WHERE user_id = ?').get(probe.user_id);
    var checkSet = db.prepare('SELECT user_id, wallpaper, theme FROM user_settings WHERE user_id = ?').get(probe.user_id);
    console.log('verify user:', JSON.stringify(checkUser));
    console.log('verify settings:', JSON.stringify(checkSet));
  });

  db.close();
})().catch(function(e) {
  console.error('✗ 准备失败:', e && e.stack || e);
  process.exit(1);
});