// 临时探针：验证「资源管理」重命名 / 移动 的真实报错
// 用法：node scripts/probe-resource-ops.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:9001';
const ROOT = 'D:/NetWork/Integration/ClassIntra';

// ---- 读取 .env 的 JWT_SECRET ----
let SECRET = '';
const envTxt = fs.readFileSync(path.join(ROOT, 'server/.env'), 'utf8');
for (const line of envTxt.split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function signToken(payload) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const s = crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest();
  return h + '.' + p + '.' + b64u(s);
}
const H = { Authorization: 'Bearer ' + signToken({ user_id: '250800', is_admin: 1, is_class_admin: 1, role: 'admin' }), 'Content-Type': 'application/json' };

async function call(label, method, p, body) {
  try {
    const res = await fetch(BASE + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch { j = null; }
    const sum = j ? JSON.stringify(j).slice(0, 220) : text.slice(0, 160);
    console.log(label.padEnd(46) + res.status + '  ' + sum);
    return { status: res.status, body: j };
  } catch (e) {
    console.log(label.padEnd(46) + 'ERR ' + e.message);
    return null;
  }
}

const RES = path.join(ROOT, 'Resources');
const TMP = '__probe_ops__';
const tmpAbs = path.join(RES, TMP);
fs.rmSync(tmpAbs, { recursive: true, force: true });
fs.mkdirSync(path.join(tmpAbs, 'sub'), { recursive: true });
fs.writeFileSync(path.join(tmpAbs, 'a.txt'), 'hello');
fs.writeFileSync(path.join(tmpAbs, 'sub', 'b.txt'), 'hello');
fs.writeFileSync(path.join(tmpAbs, '中文 文件.txt'), 'hello');

console.log('=== 1. 列表 ===');
await call('GET /api/resources?path=', 'GET', '/api/resources?path=');
await call('GET /api/resources?path=' + TMP, 'GET', '/api/resources?path=' + TMP);

console.log('=== 2. 重命名（相对路径，无前导斜杠）===');
await call('PATCH rename  __probe/a.txt -> a2.txt', 'PATCH', '/api/resources/rename', { old_path: `${TMP}/a.txt`, new_name: 'a2.txt' });

console.log('=== 3. 重命名（带前导斜杠，模拟前端在子目录的拼接）===');
await call('PATCH rename  /__probe/a2.txt -> a3.txt', 'PATCH', '/api/resources/rename', { old_path: `/${TMP}/a2.txt`, new_name: 'a3.txt' });

console.log('=== 4. 重命名（中文 + 空格）===');
await call('PATCH rename  中文 -> 中文2', 'PATCH', '/api/resources/rename', { old_path: `${TMP}/中文 文件.txt`, new_name: '中文 文件2.txt' });

console.log('=== 5. 移动（子目录 -> 父目录）===');
await call('POST move  __probe/sub/b.txt -> __probe', 'POST', '/api/resources/move', { source_paths: [`${TMP}/sub/b.txt`], target_dir: TMP });

console.log('=== 6. 移动（带前导斜杠）===');
await call('POST move  /__probe/sub -> /__probe', 'POST', '/api/resources/move', { source_paths: [`/${TMP}/sub`], target_dir: `/${TMP}` });

console.log('=== 7. 移动到根目录（空 target_dir）===');
await call('POST move  __probe/a3.txt -> (root)', 'POST', '/api/resources/move', { source_paths: [`${TMP}/a3.txt`], target_dir: '' });

console.log('=== 8. 重命名为同名（前端易触发）===');
await call('PATCH rename  同名', 'PATCH', '/api/resources/rename', { old_path: `${TMP}/a2.txt`, new_name: 'a2.txt' });

console.log('=== 9. 清理 ===');
await call('DELETE /api/resources/file', 'DELETE', '/api/resources/file', { path: TMP });
fs.rmSync(tmpAbs, { recursive: true, force: true });
console.log('done');
