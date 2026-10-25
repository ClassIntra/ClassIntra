// 市场完整性链路冒烟：ed25519 签名往返/篡改检测 + 逐文件哈希校验
// 用法：node scripts/market-integrity-smoke.mjs
import { generateKeyPairSync, sign, verify, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const marketService = require('../server/src/core/market-service.js');

let fail = 0;
const check = (label, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ' — ' + detail : ''));
  if (!ok) fail++;
};

// ---- 1. ed25519 签名往返（scripts/market-sign.mjs 同一算法）----
{
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const body = Buffer.from(JSON.stringify({ version: 1, apps: [{ name: 'demo' }] }), 'utf8');
  const sig = sign(null, body, privateKey);
  check('1a 正确签名验签通过', verify(null, body, publicKey, sig) === true);
  check('1b 篡改目录内容被检出', verify(null, Buffer.concat([body, Buffer.from(' ')]), publicKey, sig) === false);
  check('1c 篡改签名被检出', verify(null, body, publicKey, Buffer.from('00' + sig.toString('hex').slice(2), 'hex')) === false);
}

// ---- 2. 逐文件哈希校验（安装链同一实现）----
{
  const good = Buffer.from('entry.js content');
  const entry = {
    name: 'demo',
    files: ['apps/demo/manifest.json', 'apps/demo/frontend/entry.js'],
    hashes: {
      'manifest.json': createHash('sha256').update(Buffer.from('{}')).digest('hex'),
      'frontend/entry.js': createHash('sha256').update(good).digest('hex')
    }
  };
  const downloads = [
    { rel: 'apps/demo/manifest.json', buf: Buffer.from('{}') },
    { rel: 'apps/demo/frontend/entry.js', buf: good }
  ];
  let threw = false;
  try { marketService.verifyFileHashes('app', entry, downloads); } catch (e) { threw = true; }
  check('2a 全部匹配时不抛错', !threw);

  const tampered = downloads.slice();
  tampered[1] = { rel: 'apps/demo/frontend/entry.js', buf: Buffer.from('tampered!') };
  threw = false;
  try { marketService.verifyFileHashes('app', entry, tampered); } catch (e) { threw = true; }
  check('2b 文件被篡改时中止安装', threw);

  threw = false;
  try { marketService.verifyFileHashes('app', { name: 'x', files: [] }, downloads); } catch (e) { threw = true; }
  check('2c 旧目录无 hashes 字段时兼容放行', !threw);
}

// ---- 3. 目录解析全链（getCatalog local：拉取→校验→图标改写）----
// 回归背景：themes 段引入时曾误删 plugins 解析块，三源全挂（plugins is not defined）
{
  try {
    const catalog = await marketService.getCatalog('local');
    const okApps = Array.isArray(catalog.apps) && catalog.apps.length > 0;
    const okSections = Array.isArray(catalog.plugins) && Array.isArray(catalog.themes);
    check('3 目录解析全链（apps=' + catalog.apps.length + '，plugins=' + catalog.plugins.length + '，themes=' + catalog.themes.length + '）', okApps && okSections);
  } catch (e) {
    check('3 目录解析全链', false, e.message);
  }
}

console.log(fail === 0 ? '\n全部通过 ✔' : `\n${fail} 项失败 ✘`);
process.exit(fail === 0 ? 0 : 1);
