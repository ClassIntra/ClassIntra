#!/usr/bin/env node
// 市场源 index.json 生成器
// ------------------------------------------------------------
// 扫描市场源目录下的 apps/、plugins/、themes/，为每个包生成目录条目：
//   { name, label, version, description, author, icon, files: [...] }
// 并合并回 index.json（保留手工维护的额外字段：screenshots / changelog / color 等）。
//
// 用法：
//   node scripts/market-index-gen.mjs [源目录] [--check]
//     源目录默认 <项目根>/../market（与 MARKET_LOCAL_DIR 一致）
//     --check  只校验不写入（退出码：0 干净 / 1 有差异）
//
// 说明：files 清单从此不再手工维护；screenshots / changelog 等运营字段
//       仍写在 index.json 里，生成器会原样保留。

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const sourceDir = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : REPO + '/../market');
const checkOnly = process.argv.includes('--check');

const SECTION_DIRS = [
  { section: 'apps', dir: 'apps' },
  { section: 'plugins', dir: 'plugins' },
  { section: 'themes', dir: 'themes' }
];

function walkFiles(absDir, prefix, out) {
  let entries;
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch (e) { return; }
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..' || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const abs = join(absDir, entry.name);
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) walkFiles(abs, rel, out);
    else if (entry.isFile()) out.push(rel.replace(/\\/g, '/'));
  }
}

function scanSection(sectionRoot, kind) {
  const items = [];
  if (!existsSync(sectionRoot)) return items;
  for (const name of readdirSync(sectionRoot)) {
    if (name.startsWith('.')) continue;
    const pkgDir = join(sectionRoot, name);
    const manifestPath = join(pkgDir, 'manifest.json');
    if (!statSync(pkgDir).isDirectory() || !existsSync(manifestPath)) {
      console.warn(`跳过 ${sectionRoot}/${name}：缺少 manifest.json`);
      continue;
    }
    let manifest;
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (e) {
      console.warn(`跳过 ${sectionRoot}/${name}：manifest.json 解析失败（${e.message}）`);
      continue;
    }
    if (manifest.name && manifest.name !== name) {
      console.warn(`警告 ${kind}/${name}: manifest.name (${manifest.name}) 与目录名不一致`);
    }
    const files = [];
    walkFiles(pkgDir, `${kind}/${name}`, files);
    // 逐文件 sha256：服务端安装时逐一比对（防镜像损坏/半更新；配合目录签名构成完整防篡改链）
    const hashes = {};
    for (const rel of files) {
      const inner = rel.slice(`${kind}/${name}/`.length);
      hashes[inner] = createHash('sha256').update(readFileSync(join(sourceDir, rel))).digest('hex');
    }
    items.push({
      name: manifest.name || name,
      label: manifest.label || name,
      version: manifest.version || '0.0.0',
      description: manifest.description || '',
      author: manifest.author || '',
      icon: manifest.icon && manifest.icon.startsWith('./') ? `${kind}/${name}/` + manifest.icon.replace(/^\.\//, '') : (manifest.icon || undefined),
      files,
      hashes
    });
  }
  return items;
}

const indexPath = join(sourceDir, 'index.json');
let existing = {};
if (existsSync(indexPath)) {
  try { existing = JSON.parse(readFileSync(indexPath, 'utf8')); } catch (e) {
    console.error('现有 index.json 解析失败，将重新生成（手工字段会丢失）:', e.message);
  }
}
const existingBySection = {
  apps: new Map((existing.apps || []).map(a => [a.name, a])),
  plugins: new Map((existing.plugins || []).map(p => [p.name, p])),
  themes: new Map((existing.themes || []).map(t => [t.name, t]))
};

const result = { version: existing.version || 1, updated_at: new Date().toISOString() };
for (const { section, dir } of SECTION_DIRS) {
  const scanned = scanSection(join(sourceDir, dir), dir);
  result[section] = scanned.map(item => {
    // 保留手工运营字段（screenshots/changelog/color/…），files/version/label 以扫描为准
    const prev = existingBySection[section].get(item.name) || {};
    return Object.assign({}, prev, item);
  });
  console.log(`${section}: ${scanned.length} 个包`);
}

if (checkOnly) {
  const before = JSON.stringify({ apps: (existing.apps || []).map(a => [a.name, a.files]) }, null, 0);
  const after = JSON.stringify({ apps: result.apps.map(a => [a.name, a.files]) }, null, 0);
  if (before === after) { console.log('--check: index.json 与扫描结果一致'); process.exit(0); }
  console.error('--check: index.json 与扫描结果不一致（请运行生成器更新）');
  process.exit(1);
}

writeFileSync(indexPath, JSON.stringify(result, null, 2) + '\n');
console.log('已写入 ' + indexPath);
