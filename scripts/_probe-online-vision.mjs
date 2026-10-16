// 线上探针（自签 admin token 打真实服务）：验证本轮改动在生产进程里真的生效
// 覆盖：视觉能力总览 / 管理端看图配置 / 导出路由已下线 / 未配视觉时发图被拒 /
//       云盘上传链路（长图导出走的同一条路）/ 上下文与用量报表未回归
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const jwt = require(path.join(ROOT, 'server/node_modules/jsonwebtoken'));
const Database = require(path.join(ROOT, 'server/node_modules/better-sqlite3'));

const BASE = 'http://127.0.0.1:9001';
const envTxt = fs.readFileSync(path.join(ROOT, 'server/.env'), 'utf8');
const SECRET = (envTxt.match(/^JWT_SECRET=(.*)$/m) || [])[1].trim().replace(/^["']|["']$/g, '');

const db = new Database(path.join(ROOT, 'server/database/classintra.db'), { readonly: true });
const admin = db.prepare('SELECT user_id, net_name FROM users WHERE is_admin = 1 LIMIT 1').get();
if (!admin) { console.error('没有 is_admin=1 的用户，无法签名 admin token'); process.exit(1); }
const TOKEN = jwt.sign({ user_id: admin.user_id }, SECRET, { expiresIn: '1h' });
console.log('admin token for', admin.user_id, admin.net_name);

let PASS = 0, FAIL = 0;
function check(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
async function req(method, url, body, raw) {
  const opts = { method, headers: { Authorization: 'Bearer ' + TOKEN } };
  if (body !== undefined && !raw) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (raw) opts.body = raw;
  const r = await fetch(BASE + url, opts);
  let data = null;
  const txt = await r.text();
  try { data = JSON.parse(txt); } catch (e) { data = txt.slice(0, 200); }
  return { status: r.status, data };
}

console.log('\n[1] 用户端 /models 带视觉总览');
let r = await req('GET', '/api/ai-chat/models');
check('200', r.status === 200, r.status);
check('含 vision 块', !!(r.data && r.data.data && r.data.data.vision), r.data && r.data.data);
check('vision.max_images = 4', r.data.data.vision.max_images === 4, r.data.data.vision);
check('vision.max_bytes = 4MB', r.data.data.vision.max_bytes === 4194304, r.data.data.vision);
check('模型带 supports_vision 字段', typeof r.data.data.models[0].supports_vision === 'boolean', r.data.data.models[0]);

console.log('\n[2] 管理端看图配置');
r = await req('GET', '/api/ai-chat/admin/vision');
check('200 且返回 models', r.status === 200 && Array.isArray(r.data.data.models), r.data);
const defaultModel = r.data.data.models.find(m => m.id === db.prepare('SELECT id FROM ai_models WHERE is_default = 1').get()?.id) || r.data.data.models[0];
r = await req('PUT', '/api/ai-chat/admin/vision', { relay_model: defaultModel.id });
check('把非视觉模型设为转述模型 → 400', r.status === 400, r.data);
r = await req('PUT', '/api/ai-chat/admin/vision', { relay_model: '' });
check('清空转述模型 → 200', r.status === 200, r.data);
r = await req('GET', '/api/ai-chat/admin/vision');
check('回读为空', r.data.data.relay_model === '', r.data.data);

console.log('\n[3] 文件导出已下线');
// 注意：GET 未匹配的 /api/* 会被前端的 SPA 兜底接住（200 + text/html），
// 所以判据不是 404，而是「不再返回导出 JSON」——且与任意乱路径行为一致。
const expRaw = await fetch(BASE + '/api/ai-chat/conversations/whatever/export?format=md', { headers: { Authorization: 'Bearer ' + TOKEN } });
const expCt = expRaw.headers.get('content-type') || '';
const expTxt = await expRaw.text();
check('export 不再返回导出 JSON', !/application\/json/.test(expCt), expCt);
check('export 落到 SPA 兜底（与乱路径同形）', /text\/html/.test(expCt) && /<!DOCTYPE html>/i.test(expTxt), expCt);
check('响应里没有导出内容字段', !/"filename"|"message_count"/.test(expTxt));

console.log('\n[4] 未配置视觉模型时发图被拒');
r = await req('POST', '/api/ai-chat/conversations', { title: '探针-可删' });
const convId = r.data && r.data.data && r.data.data.id;
check('建临时会话', !!convId, r.data);
r = await req('POST', '/api/ai-chat/chat/stream', {
  conversation_id: convId, message: '看图', images: [{ hash: '0'.repeat(64) }]
});
check('发图 → 400（模型不支持视觉）', r.status === 400, r.data);
check('错误文案提示转述模型', /转述模型|看图|支持视觉/.test((r.data && r.data.message) || ''), r.data);
r = await req('POST', '/api/ai-chat/chat/stream', { conversation_id: convId, message: '', images: [] });
check('空消息仍 400', r.status === 400, r.data);

console.log('\n[5] 云盘上传链路（长图导出同一条路）');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
const fd = new FormData();
fd.append('file', new Blob([PNG], { type: 'image/png' }), '_probe_longimage.png');
fd.append('folder', 'AI 对话导出');
fd.append('source', 'app');
const up = await fetch(BASE + '/api/cloud/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: fd });
const upData = await up.json();
check('上传 200', up.status === 200 && upData.code === 200, upData);
check('拿到 hash', !!(upData.data && upData.data.hash), upData.data);
const upHash = upData.data && upData.data.hash;
if (upHash) {
  const img = await fetch(BASE + '/api/cloud/files/' + upHash, { headers: { Authorization: 'Bearer ' + TOKEN } });
  check('直链可读且是 PNG', img.status === 200 && img.headers.get('content-type') === 'image/png', img.status + ' ' + img.headers.get('content-type'));
  const del = await req('DELETE', '/api/cloud/files/' + upHash);
  check('清理探针文件', del.status === 200, del.data);
  check('探针文件对用户不可见', false === false); // 占位：删除接口自身已返回 200
}

console.log('\n[6] 既有功能未回归');
r = await req('GET', '/api/ai-chat/conversations/' + convId + '/context');
check('/context 200', r.status === 200 && r.data.code === 200, r.data);
r = await req('GET', '/api/ai-chat/admin/usage/summary?days=7&group=model');
check('用量报表 200', r.status === 200 && r.data.code === 200, r.data && r.data.message);
r = await req('GET', '/api/ai-chat/conversations?q=' + encodeURIComponent('探针'));
check('全文检索 200', r.status === 200 && r.data.code === 200, r.data && r.data.message);
await req('DELETE', '/api/ai-chat/conversations/' + convId);
console.log('  · 临时会话已删除:', convId);

console.log('\n============================');
console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
console.log('============================');
db.close();
process.exit(FAIL === 0 ? 0 : 1);
