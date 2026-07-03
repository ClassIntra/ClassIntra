var Database = require('better-sqlite3');
var db = new Database('./database/classintra.db', { readonly: true });

// 测试1: 修复后的后端 SQL
var sql1 = "SELECT user_id, net_name, real_name, " +
  "json_extract(info_json, '$.birthday') as birthday " +
  "FROM users " +
  "WHERE json_extract(privacy_settings, '$.birthday') = 0 " +
  "AND json_extract(info_json, '$.birthday') IS NOT NULL " +
  "AND json_extract(info_json, '$.birthday') != '' " +
  "AND strftime('%m', json_extract(info_json, '$.birthday')) = ?";

console.log('=== 测试1: 7月公开生日（修复后SQL） ===');
var rows1 = db.prepare(sql1).all('07');
console.log('结果数:', rows1.length);
rows1.forEach(function(r) { console.log(' ', r.user_id, r.net_name, r.birthday); });

// 测试2: 所有公开生日的用户
console.log('\n=== 测试2: 所有公开生日用户 ===');
var sql2 = "SELECT user_id, net_name, json_extract(info_json, '$.birthday') as birthday, " +
  "json_extract(privacy_settings, '$.birthday') as pb " +
  "FROM users WHERE json_extract(privacy_settings, '$.birthday') = 0";
var rows2 = db.prepare(sql2).all();
console.log('结果数:', rows2.length);
rows2.forEach(function(r) { console.log(' ', r.user_id, r.net_name, 'birthday:', r.birthday, 'pb:', r.pb); });

// 测试3: 检查 json_extract 对 false 的返回值
console.log('\n=== 测试3: json_extract 类型检查 ===');
var sql3 = "SELECT json_extract(privacy_settings, '$.birthday') as pb, " +
  "typeof(json_extract(privacy_settings, '$.birthday')) as pb_type " +
  "FROM users WHERE user_id = '251816'";
var row3 = db.prepare(sql3).get();
console.log('用户251816:', JSON.stringify(row3));

// 测试4: 不加 privacy 过滤，只看7月有生日的
console.log('\n=== 测试4: 7月所有有生日的用户（不区分公开） ===');
var sql4 = "SELECT user_id, net_name, json_extract(info_json, '$.birthday') as birthday, " +
  "json_extract(privacy_settings, '$.birthday') as pb " +
  "FROM users WHERE json_extract(info_json, '$.birthday') IS NOT NULL " +
  "AND json_extract(info_json, '$.birthday') != '' " +
  "AND strftime('%m', json_extract(info_json, '$.birthday')) = '07'";
var rows4 = db.prepare(sql4).all();
console.log('结果数:', rows4.length);
rows4.forEach(function(r) { console.log(' ', r.user_id, r.net_name, 'birthday:', r.birthday, 'pb:', r.pb); });

db.close();
