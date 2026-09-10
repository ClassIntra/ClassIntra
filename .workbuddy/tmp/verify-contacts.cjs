// 验证 /contacts 的跨班联系人补充逻辑（只读，不写库）
process.chdir('D:/NetWork/Integration/ClassIntra/server');

const path = require('path');
const fs = require('fs');

// 读取 .env 中的 DB_PATH
let dbPath = './database/classintra.db';
try {
  const env = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
  const m = env.match(/^DB_PATH=(.*)$/m);
  if (m) dbPath = m[1].trim();
} catch (e) { /* 用默认值 */ }

const absDb = path.resolve(process.cwd(), dbPath);
console.log('DB:', absDb, '存在:', fs.existsSync(absDb));
if (!fs.existsSync(absDb)) process.exit(1);

const Database = require(path.resolve(process.cwd(), 'node_modules/better-sqlite3'));
const db = new Database(absDb, { readonly: true });

// 取一个"本机用户"，模拟其视角
const me = db.prepare('SELECT user_id, net_name FROM users LIMIT 1').get();
if (!me) { console.log('无用户，跳过'); process.exit(0); }
console.log('模拟登录用户:', me.user_id, me.net_name);

// 复刻 routes.js 的 lastMsgMap 查询
const rows = db.prepare(
  'SELECT pm1.sender_id, pm1.receiver_id, pm1.content, pm1.type, pm1.recalled, pm1.created_at ' +
  'FROM private_messages pm1 ' +
  'INNER JOIN ( ' +
  '  SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS other_id, MAX(id) AS max_id ' +
  '  FROM private_messages ' +
  '  WHERE sender_id = ? OR receiver_id = ? ' +
  '  GROUP BY other_id ' +
  ') pm2 ON pm1.id = pm2.max_id'
).all(me.user_id, me.user_id, me.user_id);

console.log('有私聊往来的会话数:', rows.length);

const localUsers = new Set(db.prepare('SELECT user_id FROM users').all().map(r => r.user_id));

let localCount = 0, remoteCount = 0;
for (const row of rows) {
  const otherId = row.sender_id === me.user_id ? row.receiver_id : row.sender_id;
  if (localUsers.has(otherId)) localCount++;
  else {
    remoteCount++;
    console.log('  [跨班] ' + otherId + ' 最后消息: ' + String(row.content || '').slice(0, 30));
  }
}
console.log('本机联系人:', localCount, ' / 跨班联系人:', remoteCount);
console.log(remoteCount > 0
  ? '=> 修复前这些跨班联系人不会出现在 /contacts 返回中（会话入口消失）'
  : '=> 当前无跨班私聊记录，无法直接验证（逻辑已就位）');

db.close();
