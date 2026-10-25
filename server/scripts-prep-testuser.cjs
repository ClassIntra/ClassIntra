// 在隔离测试库中造一个探针账号（只用于浏览器视觉验证，绝不碰生产库）
var Database = require('better-sqlite3');
var DB = 'C:/Users/iflytek/AppData/Local/Temp/ci-e2e/e2e.db';
var db = new Database(DB);

var exists = db.prepare("SELECT user_id FROM users WHERE user_id = '251898'").get();
if (!exists) {
  var src = db.prepare("SELECT * FROM users WHERE user_id = '251801'").get();
  if (!src) { console.error('缺少基准行 251801'); process.exit(1); }
  var keys = Object.keys(src).filter(function (k) { return k !== 'id'; });
  var sql = 'INSERT INTO users (' + keys.join(',') + ') VALUES (' + keys.map(function () { return '?'; }).join(',') + ')';
  var stmt = db.prepare(sql);
  var vals = keys.map(function (k) {
    if (k === 'user_id') return '251898';
    if (k === 'net_name') return 'E2E探针';
    if (k === 'real_name') return 'E2E探针';
    if (k === 'status') return 'active';
    if (k === 'is_admin') return 0;
    if (k === 'role') return 'user';
    return src[k];
  });
  stmt.run(vals);
  console.log('已创建测试账号 251898');
} else {
  console.log('测试账号 251898 已存在');
}

var check = db.prepare("SELECT id, user_id, net_name, status, is_admin, role FROM users WHERE user_id = '251898'").get();
console.log('verify:', JSON.stringify(check));
db.close();
