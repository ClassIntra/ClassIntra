/**
 * 拼豆「导出到云盘」真链路验证（v0.38.0）
 * 上传一个真实 PNG → 断言返回 hash/url → 下载回来比对字节 → 删除，不留垃圾。
 * 用法：node scripts/_pet-cloud-export-live.mjs [user_id]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(REPO, 'server', 'package.json'));
const jwt = require('jsonwebtoken');

const UID = process.argv[2] || '251800';
const BASE = 'http://127.0.0.1:9001';

function secret() {
  const txt = readFileSync(join(REPO, 'server', '.env'), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('JWT_SECRET not found');
}

// 1×1 PNG（真实字节，用来验证云盘链路而不是画板合成——合成已由 UI 探针断言 57KB）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const token = jwt.sign({ user_id: UID, net_name: 'e2e' }, secret(), { expiresIn: '10m' });
let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) { pass++; console.log('  ✓ ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  ' + extra : '')); }
};

(async () => {
  const name = '拼豆-验证-16x16.png';
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), name);

  const up = await fetch(BASE + '/api/cloud/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  const upJson = await up.json().catch(() => null);
  ok(up.status === 200, '云盘上传返回 200', 'status=' + up.status);
  const d = (upJson && upJson.data) || {};
  ok(!!d.hash, '返回文件 hash', d.hash || 'none');
  ok(!!d.url, '返回可访问 url', d.url || 'none');
  ok(d.name === name, '文件名（中文）未被破坏', d.name || 'none');

  if (d.url) {
    const got = await fetch(BASE + d.url, { headers: { Authorization: 'Bearer ' + token } });
    ok(got.status === 200, '下载回来 200', 'status=' + got.status);
    const buf = Buffer.from(await got.arrayBuffer());
    ok(buf.equals(PNG), '字节完全一致（没被转码/截断）', buf.length + 'B');
    ok(String(got.headers.get('content-type') || '').includes('image/png'), 'Content-Type=image/png',
      got.headers.get('content-type'));
  }

  // 顺手确认作品库删除端点在线（v0.38.0 自测假 Router 补 delete 的由来）
  const del = await fetch(BASE + '/api/cloud/files/' + encodeURIComponent(d.hash || ''), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  ok(del.status === 200 || del.status === 404, '测试文件已清理', 'status=' + del.status);

  console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过：' + pass + ' 项'));
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('探针异常：', e);
  process.exitCode = 1;
});
