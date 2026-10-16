// 线上探针：额度闸门 + 看板 CSV + 视觉回归（打真实 9001，自签 admin token）
// 注意：不发真实消息（那会烧用户的上游 API 钱），402 用「把额度调到极小」来触发。
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
const SECRET = fs.readFileSync(path.join(ROOT, 'server/.env'), 'utf8').match(/^JWT_SECRET=(.*)$/m)[1].trim().replace(/^["']|["']$/g, '');
const db = new Database(path.join(ROOT, 'server/database/classintra.db'), { readonly: true });
const admin = db.prepare('SELECT user_id, net_name FROM users WHERE is_admin = 1 LIMIT 1').get();
const TOKEN = jwt.sign({ user_id: admin.user_id }, SECRET, { expiresIn: '1h' });
console.log('admin', admin.user_id, admin.net_name);

let PASS = 0, FAIL = 0;
const check = (n, c, e) => { if (c) { PASS++; console.log('  ✓ ' + n); } else { FAIL++; console.log('  ✗ ' + n + (e !== undefined ? ' → ' + JSON.stringify(e) : '')); } };
const req = async (m, u, b) => {
  const o = { method: m, headers: { Authorization: 'Bearer ' + TOKEN } };
  if (b !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(b); }
  const r = await fetch(BASE + u, o);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t.slice(0, 120); }
  return { status: r.status, headers: r.headers, text: t, data: d };
};

console.log('\n[1] 迁移与结构');
check('schema_version 含 16:ai_wallet_quota',
  db.prepare('SELECT name FROM schema_version WHERE version = 16').get()?.name === 'ai_wallet_quota');
check('ai_wallet 表存在', !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_wallet'").get());

console.log('\n[2] 用户端余额');
let r = await req('GET', '/api/ai-chat/wallet');
check('200', r.status === 200, r.status);
const wasUnlimited = !!(r.data.data && r.data.data.unlimited);
check('默认不限额', wasUnlimited, r.data);

console.log('\n[3] 管理端列表 / CSV');
r = await req('GET', '/api/ai-chat/admin/wallet?days=30');
check('列表 200 且是数组', r.status === 200 && Array.isArray(r.data.data.users), r.data);
check('返回 priced_models 字段（单价全 0 时前端要提示）', typeof r.data.data.priced_models === 'number', r.data.data);
r = await req('GET', '/api/ai-chat/admin/usage/export.csv?days=7&group=user');
check('CSV 200 + text/csv', r.status === 200 && /text\/csv/.test(r.headers.get('content-type') || ''), r.headers.get('content-type'));
// undici 的 text() 会把 UTF-8 BOM 剥掉，所以要用原始字节验证
const raw = new Uint8Array(await (await fetch(BASE + '/api/ai-chat/admin/usage/export.csv?days=7&group=user', { headers: { Authorization: 'Bearer ' + TOKEN } })).arrayBuffer());
check('CSV 带 BOM（EF BB BF，Excel 中文不乱码）', raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf, [raw[0], raw[1], raw[2]]);
const headText = new TextDecoder('utf-8').decode(raw.slice(0, 40));
check('CSV 表头是中文', headText.includes('名称'), headText);

console.log('\n[4] 额度闸门（造一笔 1 元的合成流水触发 402，不烧上游钱）');
// 生产库里模型单价都是 0 → 记账恒为 0，额度永远到不了上限；插一笔合成流水再删掉
const ins = `INSERT INTO ai_usage_log (user_id, conversation_id, model_id, source, prompt_tokens, completion_tokens, total_tokens, cost_micro, created_at)
  VALUES ('${admin.user_id}', 'wallet_probe', 'probe', 'chat', 0, 0, 0, 1000000, datetime('now'))`;
const wdb = new Database(path.join(ROOT, 'server/database/classintra.db'));
wdb.prepare(ins).run();
let probeConvId = null;
try {
  r = await req('PUT', '/api/ai-chat/admin/wallet/' + admin.user_id, { quota_yuan: 0.5, window_days: 30 });
  check('PUT 200', r.status === 200, r.data);
  r = await req('GET', '/api/ai-chat/wallet');
  check('余额视图不再 unlimited', r.data.data && r.data.data.unlimited === false, r.data);
  check('percent = 100（已用 1 元 ≥ 上限 0.5 元）', r.data.data.percent === 100, r.data);
  r = await req('POST', '/api/ai-chat/conversations', { title: '额度探针-可删' });
  probeConvId = r.data.data && r.data.data.id;
  r = await req('POST', '/api/ai-chat/chat/stream', { conversation_id: probeConvId, message: 'hi' });
  check('发消息 → 402', r.status === 402, r.status);
  check('文案提到额度', /额度/.test((r.data && r.data.message) || ''), r.data);
} finally {
  // 自清理：合成流水 + 额度 + 临时会话，生产数据零残留
  wdb.prepare("DELETE FROM ai_usage_log WHERE user_id = ? AND conversation_id = 'wallet_probe'").run(admin.user_id);
  wdb.close();
  await req('DELETE', '/api/ai-chat/admin/wallet/' + admin.user_id);
  if (probeConvId) await req('DELETE', '/api/ai-chat/conversations/' + probeConvId);
}
r = await req('GET', '/api/ai-chat/wallet');
check('已恢复不限额', r.data.data.unlimited === true, r.data);

console.log('\n[5] 视觉与模型接口未回归');
r = await req('GET', '/api/ai-chat/models');
check('models 带 vision 块', !!(r.data.data && r.data.data.vision), r.data.data && r.data.data.vision);
check('模型带 supports_vision', typeof r.data.data.models[0].supports_vision === 'boolean');
r = await req('GET', '/api/ai-chat/admin/vision');
check('admin/vision 200', r.status === 200 && Array.isArray(r.data.data.models), r.status);
r = await req('GET', '/api/ai-chat/admin/usage/summary?days=7&group=day');
check('按天聚合可用（趋势图数据源）', r.status === 200 && Array.isArray(r.data.data.rows), r.data.data && Object.keys(r.data.data));

console.log('\n============================');
console.log('PASS ' + PASS + ' / FAIL ' + FAIL);
console.log('============================');
db.close();
process.exit(FAIL === 0 ? 0 : 1);
