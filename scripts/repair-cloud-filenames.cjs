// 修复历史乱码文件名：multer latin1 解码 bug 留下的 original_name / display_name
// 只改「显示名」（original_name + cloud_user_files.display_name），不动 hash / 物理文件 / 归属。
// old → new 是一次确定性的 latin1→utf8 还原，脚本会把对照表打印出来（可人工复核与回退）。
var Database = require('D:/NetWork/Integration/ClassIntra/server/node_modules/better-sqlite3');
var db = new Database('D:/NetWork/Integration/ClassIntra/server/database/classintra.db');

function looksMojibake(s) { return /[\u0080-\u00ff]/.test(String(s || '')); }
function repair(s) {
  if (!looksMojibake(s)) return null;
  var fixed = Buffer.from(String(s), 'latin1').toString('utf8');
  if (fixed.indexOf('\ufffd') !== -1) return null;   // 还原失败就跳过，绝不写入残缺名
  return fixed;
}

var rows = db.prepare('SELECT hash, original_name FROM cloud_files WHERE deleted = 0').all();
var plan = [];
rows.forEach(function(r) {
  var fixed = repair(r.original_name);
  if (fixed) plan.push({ hash: r.hash, from: r.original_name, to: fixed });
});

if (plan.length === 0) { console.log('没有需要修复的乱码名'); db.close(); process.exit(0); }

console.log('将修复 ' + plan.length + ' 条显示名（对照表）：');
plan.forEach(function(p) { console.log('  ' + JSON.stringify(p.from) + '\n    → ' + JSON.stringify(p.to)); });

var upFile = db.prepare('UPDATE cloud_files SET original_name = ? WHERE hash = ?');
var upRef = db.prepare('UPDATE cloud_user_files SET display_name = ? WHERE file_hash = ?');
var refs = db.prepare('SELECT file_hash, display_name FROM cloud_user_files').all();
db.transaction(function() {
  plan.forEach(function(p) {
    upFile.run(p.to, p.hash);
    // 引用侧显示名同样按「能不能还原」逐条判断，避免把别人改过的正常名覆盖掉
    refs.forEach(function(rf) {
      if (rf.file_hash !== p.hash) return;
      if (rf.display_name === p.from) upRef.run(p.to, p.hash);
    });
  });
})();
console.log('已修复 ' + plan.length + ' 条');
db.close();
