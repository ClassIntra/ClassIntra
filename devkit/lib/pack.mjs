// 打包：生成 index.json 条目（文件清单 + 逐文件 sha256），可直接合并进市场目录。
// 不需要主仓库的 scripts/ —— 外部开发者 clone 自己的包就能出条目。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { packageFiles } from './package-files.mjs';
import { checkPackage } from './check.mjs';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function collectPackage(targetDir) {
  const dir = path.resolve(targetDir || '.');
  const checked = checkPackage(dir);
  if (!checked.ok) throw new Error('包校验失败:\n' + checked.errors.join('\n'));
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('缺少 manifest.json: ' + dir);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let section = 'apps';
  let kind = 'app';
  if (manifest.type === 'plugin') { section = 'plugins'; kind = 'plugin'; }
  else if (manifest.type === 'light' || manifest.type === 'dark') { section = 'themes'; kind = 'theme'; }

  const name = String(kind === 'theme' ? manifest.id : manifest.name || '');
  if (!name) throw new Error('manifest 缺少 name/id');

  const absFiles = packageFiles(dir);
  const files = [];
  const hashes = {};
  let bytes = 0;

  for (const abs of absFiles) {
    const rel = path.relative(dir, abs).replace(/\\/g, '/');
    files.push(section + '/' + name + '/' + rel);
    hashes[rel] = sha256(abs);
    bytes += fs.statSync(abs).size;
  }

  const entry = {
    name: name,
    label: manifest.label || manifest.name || name,
    version: manifest.version || '0.0.0',
    description: manifest.description || '',
    author: manifest.author || '',
    files: files.sort(),
    hashes: hashes
  };
  if (manifest.icon) entry.icon = manifest.icon;
  if (kind === 'theme') entry.type = manifest.type;

  return { dir, kind, section, name, entry, bytes, count: files.length };
}

export function mergeIndex(indexPath, collected, options) {
  const opts = options || {};
  const abs = path.resolve(indexPath);
  let index = { version: 1, updated_at: new Date().toISOString(), apps: [], plugins: [], themes: [] };

  if (fs.existsSync(abs)) {
    try {
      index = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      throw new Error('现有 index.json 解析失败: ' + e.message);
    }
    if (!index || typeof index !== 'object' || Array.isArray(index)) throw new Error('现有 index.json 必须是对象，已保留原文件');
    for (const section of ['apps', 'plugins', 'themes']) {
      if (index[section] !== undefined && !Array.isArray(index[section])) throw new Error('现有 index.json 的 ' + section + ' 必须是数组，已保留原文件');
    }
    if (index.version !== undefined && (!Number.isSafeInteger(index.version) || index.version < 0)) {
      throw new Error('现有 index.json 的 version 必须是非负整数，已保留原文件');
    }
  }
  if (!Array.isArray(index.apps)) index.apps = [];
  if (!Array.isArray(index.plugins)) index.plugins = [];
  if (!Array.isArray(index.themes)) index.themes = [];

  const list = index[collected.section];
  const idx = list.findIndex((item) => item && item.name === collected.name);
  const previous = idx >= 0 ? list[idx] : null;

  // 运营字段保留：截图 / 更新日志由维护者维护，重新打包不该把它们抹掉
  const merged = Object.assign({}, collected.entry);
  if (previous) {
    for (const key of ['screenshots', 'changelog', 'tags', 'featured', 'homepage']) {
      if (previous[key] !== undefined && merged[key] === undefined) merged[key] = previous[key];
    }
  }
  if (opts.screenshots && !merged.screenshots) merged.screenshots = opts.screenshots;
  if (opts.changelog && !merged.changelog) merged.changelog = opts.changelog;

  if (idx >= 0) list[idx] = merged;
  else list.push(merged);

  index.version = (typeof index.version === 'number' ? index.version : 1) + 1;
  index.updated_at = new Date().toISOString();

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const temporary = abs + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(index, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, abs);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { index: abs, replaced: idx >= 0, section: collected.section, name: collected.name, version: index.version };
}
