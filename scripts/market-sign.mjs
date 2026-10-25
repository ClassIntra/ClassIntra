#!/usr/bin/env node
// 市场源签名工具（防篡改链的发布端）
// ------------------------------------------------------------
// 生成 ed25519 密钥对并对市场源 index.json 的原始字节签名。
//
//   node scripts/market-sign.mjs --genkey            生成密钥对（私钥 server/.market-signing-key.pem，
//                                                     公钥 server/.market-signing-public.pem，私钥绝不入仓）
//   node scripts/market-sign.mjs [源目录]            对 index.json 签名 → index.json.sig（hex 文本）
//
// 验签端：server/src/core/market-service.js 在配置 MARKET_SIGNING_PUBLIC_KEY 后
// 自动校验 http 市场源（gitee/github）的目录签名，篡改/缺签即拒绝拉取。
// 本地源（local）按文件系统信任处理，不做验签。
import { generateKeyPairSync, sign as cryptoSign, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const PRIVATE_KEY_PATH = REPO + '/server/.market-signing-key.pem';
const PUBLIC_KEY_PATH = REPO + '/server/.market-signing-public.pem';

if (process.argv.includes('--genkey')) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(PRIVATE_KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(PUBLIC_KEY_PATH, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('已生成密钥对：');
  console.log('  私钥 ' + PRIVATE_KEY_PATH + '（绝不入仓 / 不入市场仓库）');
  console.log('  公钥 ' + PUBLIC_KEY_PATH);
  console.log('\n部署端启用验签：把公钥配置到服务器环境变量');
  console.log('  MARKET_SIGNING_PUBLIC_KEY=<上面文件的完整 PEM 内容>');
  process.exit(0);
}

const sourceDir = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : REPO + '/../market');
const indexPath = resolve(sourceDir, 'index.json');
if (!existsSync(indexPath)) {
  console.error('未找到 ' + indexPath);
  process.exit(1);
}
if (!existsSync(PRIVATE_KEY_PATH)) {
  console.error('未找到私钥，先运行：node scripts/market-sign.mjs --genkey');
  process.exit(1);
}

const body = readFileSync(indexPath);
const privateKey = readFileSync(PRIVATE_KEY_PATH, 'utf8');
const signature = cryptoSign(null, body, privateKey).toString('hex');
writeFileSync(resolve(sourceDir, 'index.json.sig'), signature + '\n');
console.log('已签名 ' + indexPath);
console.log('  sha256(index.json) = ' + createHash('sha256').update(body).digest('hex'));
console.log('  signature          = ' + signature.slice(0, 32) + '…');
console.log('请把 index.json 与 index.json.sig 一起推送到市场仓库。');
