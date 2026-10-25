// 清空测试库中的指令与大字记录（仅用于隔离实例的重复联调）
var Database = require('better-sqlite3');
var db = new Database('C:\\Users\\iflytek\\AppData\\Local\\Temp\\ci-e2e\\e2e.db');
var a = db.prepare('DELETE FROM device_commands').run().changes;
var b = db.prepare('DELETE FROM big_text_broadcasts').run().changes;
db.prepare("UPDATE users SET status='active', ban_reason=NULL, ban_expires_at=NULL WHERE ban_reason='E2E 联调封禁'").run();
console.log('cleared device_commands=' + a + ' big_text_broadcasts=' + b);
db.close();
