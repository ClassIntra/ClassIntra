// 导出 18 班用户信息到 Resource/public/
var path = require('path');
var fs = require('fs');
var db = require('better-sqlite3')(path.join(__dirname, '../database/classintra.db'));

var rows = db.prepare("SELECT user_id, real_name, net_name FROM users WHERE substr(user_id, 3, 2) = '18' ORDER BY user_id").all();

var lines = ['18班账户列表', '学号\t真实姓名\t网名', '---'];
for (var i = 0; i < rows.length; i++) {
  lines.push(rows[i].user_id + '\t' + rows[i].real_name + '\t' + rows[i].net_name);
}
lines.push('---');
lines.push('共 ' + rows.length + ' 人');
lines.push('导出时间: ' + new Date().toLocaleString('zh-CN'));

var output = lines.join('\n');
var outPath = path.join(__dirname, '../../Resource/public/18class_users.txt');
fs.writeFileSync(outPath, output, 'utf-8');
console.log('已导出到: ' + outPath);
console.log(output);
db.close();
