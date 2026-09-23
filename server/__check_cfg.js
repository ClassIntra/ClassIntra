// 临时诊断：读取网易云插件配置
var Database = require('better-sqlite3');
var db = new Database('database/classintra.db', { readonly: true });
var tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(function (t) { return t.name; });
console.log('tables:', tables.filter(function (t) { return /plugin|config|setting/i.test(t); }).join(', '));
tables.forEach(function (t) {
  if (!/plugin|config|setting/i.test(t)) return;
  try {
    var rows = db.prepare('SELECT * FROM ' + t).all();
    rows.forEach(function (r) {
      var s = JSON.stringify(r);
      console.log(t + ' => ' + s.slice(0, 300));
    });
  } catch (e) { console.log(t + ' 读取失败: ' + e.message); }
});
db.close();
