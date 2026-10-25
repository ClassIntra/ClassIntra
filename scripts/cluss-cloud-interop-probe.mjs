// 验证：云盘 ⇄ Cluss 导入导出互通（纯 API 探针，打真机 Cluss 9003）
// 流程：本盘上传 txt → 导出 Cluss → Cluss 列表可见 → 导入回本盘 → 本盘可见 → 善清测试文件
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const CLUSS = 'http://127.0.0.1:9003';

const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const ME = '251801';
const TOKEN = jwt.sign({ user_id: ME }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + TOKEN };

let fail = 0;
const check = (label, ok, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ' — ' + detail : '')); if (!ok) fail++; };

async function j(method, url, headers, body) {
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, json, text };
}

function multipart(filename, mime, content) {
  const boundary = '----probe' + Math.random().toString(16).slice(2);
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`;
  return {
    contentType: 'multipart/form-data; boundary=' + boundary,
    body: head + content + `\r\n--${boundary}--\r\n`
  };
}

// ---- 0. 前置：删除应用后旧路由应 404（或落入 SPA 兜底返回 HTML，总之不再有 API）----
const oldNotes = await j('GET', APP + '/api/notes/files', H);
const notesGone = oldNotes.status === 404 || (oldNotes.text || '').indexOf('<!DOCTYPE html>') === 0;
check('0a /api/notes 已随应用删除', notesGone, 'status=' + oldNotes.status + ' ctype=' + (oldNotes.text || '').slice(0, 15));
const oldAi = await j('GET', APP + '/api/ai-chat/models', H);
const aiGone = oldAi.status === 404 || (oldAi.text || '').indexOf('<!DOCTYPE html>') === 0;
check('0b /api/ai-chat 已随应用删除', aiGone, 'status=' + oldAi.status);

// ---- 1. Cluss 状态 ----
const st = await j('GET', APP + '/api/cloud/cluss/status', H);
check('1 Cluss 探活可用', st.json && st.json.data && st.json.data.available === true, JSON.stringify(st.json && st.json.data));

// ---- 2. 本盘上传一个 txt（走正式上传管道）----
const stamp = Date.now();
const upContent = '互通探针测试文件 ' + stamp + '\nexport→import roundtrip';
const mp = multipart('互通探针-' + stamp + '.txt', 'text/plain', upContent);
const up = await j('POST', APP + '/api/cloud/upload', Object.assign({ 'Content-Type': mp.contentType }, H), mp.body);
const ciHash = up.json && up.json.data && up.json.data.hash;
check('2 本盘上传测试文件', up.status === 200 && /^[a-f0-9]{64}$/.test(ciHash || ''), (up.json && up.json.message) || '');

// ---- 3. 导出到 Cluss ----
const exp = await j('POST', APP + '/api/cloud/cluss/export', Object.assign({ 'Content-Type': 'application/json' }, H), JSON.stringify({ hashes: [ciHash] }));
const expOk = exp.json && exp.json.data && exp.json.data.ok_count === 1;
check('3 导出到 Cluss 成功', expOk, JSON.stringify(exp.json && exp.json.data && exp.json.data.results));

// ---- 4. Cluss 侧列表可见（直接打 Cluss，验证联邦账号名下）----
const clist = await j('GET', CLUSS + '/api/cloud/files?limit=50', H);
const clussFiles = (clist.json && clist.json.data && clist.json.data.files) || [];
const found = clussFiles.find(f => f.hash === (exp.json && exp.json.data && exp.json.data.results && exp.json.data.results[0].cluss_hash));
check('4 Cluss 名下可见导出文件', !!found, found ? found.name : 'not-found');

// ---- 5. 概览端点（文件 + 配额）----
const ov = await j('GET', APP + '/api/cloud/cluss/overview', H);
const ovFiles = (ov.json && ov.json.data && ov.json.data.files) || [];
const ovQuota = ov.json && ov.json.data && ov.json.data.quota;
check('5a 概览含文件列表', ov.status === 200 && ovFiles.length > 0, String(ovFiles.length));
check('5b 概览含配额', !!ovQuota && typeof ovQuota.remaining_bytes === 'number', JSON.stringify(ovQuota));

// ---- 6. 缩略图代理（对文本文件应 404/502 而非崩溃；对图片有 Cluss 文件则应 200）----
const imgFile = clussFiles.find(f => f.kind === 'image');
if (imgFile) {
  const th = await fetch(APP + '/api/cloud/cluss/thumb/' + imgFile.hash, { headers: H });
  check('6 缩略图代理 200', th.status === 200, String(th.status));
  await th.arrayBuffer();
} else {
  console.log('SKIP 6 缩略图代理（Cluss 无图片文件）');
}

// ---- 7. 导入回本盘 ----
const clussHash = found && found.hash;
const imp = await j('POST', APP + '/api/cloud/cluss/import', Object.assign({ 'Content-Type': 'application/json' }, H), JSON.stringify({ items: [{ hash: clussHash, name: found.name }] }));
const impData = imp.json && imp.json.data;
check('7a 导入回本盘成功', impData && impData.ok_count === 1, JSON.stringify(impData && impData.results));
const ciList = await j('GET', APP + '/api/cloud/files', H);
const ciFiles = (ciList.json && ciList.json.data && ciList.json.data.files) || [];
const imported = ciFiles.find(f => f.hash === (impData && impData.results && impData.results[0].ci_hash));
check('7b 本盘列表可见导入文件', !!imported, imported ? imported.name : 'not-found');

// ---- 8. 非法 hash 与不存在的 hash 的防御 ----
const bad = await j('POST', APP + '/api/cloud/cluss/export', Object.assign({ 'Content-Type': 'application/json' }, H), JSON.stringify({ hashes: ['deadbeef'] }));
check('8a 非法 hash 被拒', bad.json && bad.json.data && bad.json.data.results && bad.json.data.results[0].ok === false, JSON.stringify(bad.json && bad.json.data && bad.json.data.results));
const miss = await j('POST', APP + '/api/cloud/cluss/import', Object.assign({ 'Content-Type': 'application/json' }, H), JSON.stringify({ items: [{ hash: 'a'.repeat(64), name: 'x.txt' }] }));
check('8b 不存在的 Cluss hash 给出原因', miss.json && miss.json.data && miss.json.data.results && miss.json.data.results[0].ok === false, JSON.stringify(miss.json && miss.json.data && miss.json.data.results));

// ---- 善后：清掉测试文件（本盘两份 + Cluss 一份）----
async function cleanup() {
  const hashes = new Set();
  if (ciHash) hashes.add(ciHash);
  if (impData && impData.results && impData.results[0].ci_hash) hashes.add(impData.results[0].ci_hash);
  for (const h of hashes) {
    await j('DELETE', APP + '/api/cloud/files/' + h, H);
  }
  if (clussHash) {
    await j('DELETE', CLUSS + '/api/cloud/files/' + clussHash, H);
  }
  console.log('cleanup: 测试文件已清除（' + (hashes.size + 1) + ' 个）');
}
await cleanup();

console.log(fail === 0 ? '\n=== ALL PASS ===' : '\n=== ' + fail + ' FAIL ===');
process.exit(fail === 0 ? 0 : 1);
