// 一次性脚本：把象棋引擎资产加入 market/index.json 的 files + hashes
// 用法：node scripts/_chess-engine-index.mjs [--write]
import fs from 'node:fs';
import crypto from 'node:crypto';

const IDX = 'D:/NetWork/Integration/market/index.json';
const ENG = 'D:/NetWork/Integration/ClassIntra/market-apps/chess/backend/engine';
const WRITE = process.argv.includes('--write');

const raw = fs.readFileSync(IDX, 'utf8');
const crlf = raw.includes('\r\n');
console.log('换行符:', crlf ? 'CRLF' : 'LF', '| 字节数:', Buffer.byteLength(raw));

const idx = JSON.parse(raw);
const app = (idx.apps || []).find(a => a.name === 'chess');
if (!app) throw new Error('index.json 中找不到 chess');

const assets = ['pikafish.exe', 'pikafish.nnue'];
for (const f of assets) {
  const abs = `${ENG}/${f}`;
  const buf = fs.readFileSync(abs);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const rel = `apps/chess/backend/engine/${f}`;
  const key = `backend/engine/${f}`;
  if (!app.files.includes(rel)) app.files.push(rel);
  if (!app.hashes) app.hashes = {};
  app.hashes[key] = sha;
  console.log(`${f}: ${buf.length} 字节  sha256=${sha.slice(0, 16)}…`);
}

console.log('\nfiles 共', app.files.length, '项；hashes 共', Object.keys(app.hashes).length, '项');
console.log('新增项:', app.files.slice(-2));

if (WRITE) {
  const out = JSON.stringify(idx, null, 2).replace(/\n/g, crlf ? '\r\n' : '\n') + (crlf ? '\r\n' : '\n');
  fs.writeFileSync(IDX, out, 'utf8');
  console.log('\n✓ 已写入', IDX);
} else {
  console.log('\n(dry-run，加 --write 落盘)');
}
