// 8i 侧「按需回源」验证探针（临时文件，跑完即删）
// 用法：node probe-8i-backfill.cjs <mode> [hash]
//   status          —— 8i 本机 CI 存活探测（期望 401 = 服务在）
//   hit <hash>      —— 请求一个 18i 有、8i 无的文件，打印 http/x-backfilled/字节数/sha256
//   thumb <hash> <w>—— 同上但走缩略图路径（?w=<w>），只回源几 KB
//   miss <hash>     —— 请求不存在的 hash，期望 404
const crypto = require('crypto');
const jwt = require('D:/NetWork/ClassIntra/server/src/utils/jwt.js');

const BASE = 'http://127.0.0.1:9001';
const mode = process.argv[2];
const hash = process.argv[3];
const token = jwt.generateToken({ user_id: '250800', net_name: 'probe8i' });

async function main() {
  if (mode === 'status') {
    const r = await fetch(BASE + '/api/cloud/files/' + '0'.repeat(64), {
      headers: { Authorization: 'Bearer ' + token }
    });
    console.log('status http=' + r.status);
    return;
  }
  const url = BASE + '/api/cloud/files/' + hash + (mode === 'thumb' ? '?w=' + (process.argv[4] || '96') : '');
  const t0 = Date.now();
  const r = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token }
  });
  const buf = Buffer.from(await r.arrayBuffer());
  console.log(JSON.stringify({
    mode: mode,
    http: r.status,
    backfilled: r.headers.get('x-backfilled'),
    url: url.replace(BASE, ''),
    ms: Date.now() - t0,
    bytes: buf.length,
    ct: r.headers.get('content-type'),
    sha256: buf.length ? crypto.createHash('sha256').update(buf).digest('hex') : null
  }));
}
main().catch(function(e) { console.error('PROBE-ERR ' + e.message); process.exit(1); });
