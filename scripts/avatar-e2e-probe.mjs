// 头像系统端到端验证：设置 / 裁切 / 批量 / 越权 / 还原
// 用一个真实持有云盘图片的用户（251801）跑完整流程，结束后还原初始状态。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const BASE = 'http://127.0.0.1:9001';
const USER = '251801';

let SECRET = '';
for (const line of fs.readFileSync(path.join(REPO, 'server/.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function sign(uid) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ user_id: uid, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return h + '.' + p + '.' + b64u(crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest());
}
const H = (uid) => ({ Authorization: 'Bearer ' + sign(uid), 'Content-Type': 'application/json' });

async function call(label, method, url, body, uid) {
  try {
    const res = await fetch(BASE + url, { method, headers: H(uid || USER), body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch { j = null; }
    console.log(label.padEnd(40) + res.status + '  ' + JSON.stringify(j).slice(0, 200));
    return { status: res.status, body: j };
  } catch (e) {
    console.log(label.padEnd(40) + 'ERR ' + e.message);
    return null;
  }
}

// 找出该用户的云盘图片 hash，以及一个不属于它的 hash
const sqlite = path.join(REPO, 'server/node_modules/better-sqlite3');
const Database = (await import('node:module')).createRequire(REPO + '/server/package.json')(sqlite);
const db = new Database(path.join(REPO, 'server/database/classintra.db'), { readonly: true });
const mine = db.prepare("SELECT cuf.file_hash FROM cloud_user_files cuf JOIN cloud_files cf ON cuf.file_hash=cf.hash WHERE cuf.user_id=? AND cf.deleted=0 AND cf.mime_type LIKE 'image/%' LIMIT 1").get(USER);
const others = db.prepare("SELECT cuf.file_hash, cuf.user_id FROM cloud_user_files cuf JOIN cloud_files cf ON cuf.file_hash=cf.hash WHERE cuf.user_id<>? AND cf.deleted=0 LIMIT 1").get(USER);
db.close();

if (!mine) { console.log('该用户没有云盘图片，终止'); process.exit(1); }
console.log('自有图片 hash:', mine.file_hash.slice(0, 12) + '…');
console.log('他人图片 hash:', (others ? others.file_hash.slice(0, 12) + '… (owner=' + others.user_id + ')' : '无'));

console.log('\n--- 1. 初始状态 ---');
await call('GET /user/avatar', 'GET', '/api/user/avatar');

console.log('\n--- 2. 越权：用别人的云盘文件当头像 ---');
if (others) await call('PUT 他人 hash（应 403）', 'PUT', '/api/user/avatar', { hash: others.file_hash, crop: { zoom: 1, ox: 0, oy: 0 } });

console.log('\n--- 3. 非法 hash ---');
await call('PUT 假 hash（应 403）', 'PUT', '/api/user/avatar', { hash: 'a'.repeat(64) });
await call('PUT 空 hash（应 400）', 'PUT', '/api/user/avatar', { hash: '' });

console.log('\n--- 4. 正常设置 + 裁切参数 ---');
await call('PUT 自有 hash + 裁切', 'PUT', '/api/user/avatar', { hash: mine.file_hash, crop: { zoom: 2.5, ox: 0.3, oy: -0.75 } });

console.log('\n--- 5. 裁切参数越界应被夹紧 ---');
await call('PUT zoom=99/ox=5（应夹紧）', 'PUT', '/api/user/avatar', { hash: mine.file_hash, crop: { zoom: 99, ox: 5, oy: -9 } });

console.log('\n--- 6. 只改裁切 ---');
await call('PATCH 裁切', 'PATCH', '/api/user/avatar', { crop: { zoom: 1.5, ox: 0, oy: 0.2 } });

console.log('\n--- 7. 批量查询（含他人可见性）---');
await call('GET avatar/batch', 'GET', '/api/user/avatar/batch?ids=' + USER + ',251802,251999');

console.log('\n--- 8. 头像文件可读性（云盘中转 + ?w= 缩放）---');
for (const w of [128, 512]) {
  const res = await fetch(BASE + '/api/cloud/files/' + mine.file_hash + '?w=' + w, { headers: H(USER) });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(('GET cloud/files ?w=' + w).padEnd(40) + res.status + '  ' + buf.length + 'B  ' + (res.headers.get('content-type') || ''));
}

console.log('\n--- 9. 还原 ---');
await call('DELETE /user/avatar', 'DELETE', '/api/user/avatar');
await call('GET /user/avatar（应无头像）', 'GET', '/api/user/avatar');
