/**
 * version-core.js — ClassIntra 统一版本管理核心（供 version.js / release.js / prebuild.js 共用）
 *
 * 职责：版本号计算、version.json / CHANGELOG.md / package.json 同步、一致性体检。
 * 本项目唯一权威版本数据源 = server/version.json。
 */

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var VERSION_FILE = path.join(ROOT, 'server/version.json');
var CHANGELOG_FILE = path.join(ROOT, 'CHANGELOG.md');

// 需要与 version.json 保持一致的 package.json 清单
var PKG_FILES = [
  'package.json',
  'client/package.json',
  'server/package.json',
  'apps/package.json',
  'plugins/package.json'
];

// ============================================================
// 基础工具
// ============================================================

function parseVersion(v) {
  var parts = String(v).split('.').map(Number);
  return { major: parts[0] || 1, minor: parts[1] || 0, patch: parts[2] || 0 };
}

function bumpVersion(v, type) {
  var p = parseVersion(v);
  if (type === 'major') { p.major++; p.minor = 0; p.patch = 0; }
  else if (type === 'minor') { p.minor++; p.patch = 0; }
  else { p.patch++; }
  return p.major + '.' + p.minor + '.' + p.patch;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function stampToday() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function execGit(cmd) {
  try {
    return childProcess.execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: 15000 }).trim();
  } catch (e) { return ''; }
}

// 读取 version.json（缺失时返回默认结构）
function readVersionFile() {
  try {
    return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  } catch (e) {
    return { version: '1.0.0', lastBuiltVersion: '0.0.0', buildHash: '', buildTime: '', changelog: '', minClientVersion: '1.0.0', forceUpdate: false, updateUrl: '' };
  }
}

// ============================================================
// CHANGELOG 工具
// ============================================================

function gitLogSince(tag) {
  var since = tag ? tag + '..HEAD' : '';
  return execGit('git log ' + since + ' --pretty=format:"%s" --no-merges');
}

// 从 git log 提取并分类提交（跳过 savepoint/docs/chore）
function buildChangelog() {
  var latestTag = execGit('git describe --tags --abbrev=0');
  var log = gitLogSince(latestTag);
  if (!log) return '版本更新';

  var features = [];
  var fixes = [];
  var others = [];
  var seen = {};
  var lines = log.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || seen[line]) continue;
    seen[line] = true;
    if (line.indexOf('savepoint') !== -1 || line.indexOf('💾') !== -1) continue;
    if (/^(chore|docs|release):/.test(line)) continue;
    if (/^feat:/.test(line)) features.push(line.replace(/^feat:\s*/, ''));
    else if (/^fix:/.test(line)) fixes.push(line.replace(/^fix:\s*/, ''));
    else if (/^refactor:/.test(line)) fixes.push(line.replace(/^refactor:\s*/, ''));
    else if (/^perf:/.test(line)) fixes.push(line.replace(/^perf:\s*/, ''));
    else others.push(line);
  }

  var out = '';
  if (features.length) { out += '【新增】\n' + features.map(function(s) { return '- ' + s; }).join('\n') + '\n\n'; }
  if (fixes.length) { out += '【修复/优化】\n' + fixes.map(function(s) { return '- ' + s; }).join('\n') + '\n\n'; }
  if (others.length) { out += '【其他】\n' + others.map(function(s) { return '- ' + s; }).join('\n') + '\n\n'; }
  return out.trim() || '版本更新';
}

// 提取 CHANGELOG 顶部第一个 ## [x.y.z] 条目的正文
function latestChangelogEntry() {
  if (!fs.existsSync(CHANGELOG_FILE)) return '';
  var content = fs.readFileSync(CHANGELOG_FILE, 'utf8');
  var m = content.match(/## \[[^\]]+\][^\n]*\n([\s\S]*?)(?=\n## \[|$)/);
  return m ? m[1].trim() : '';
}

// 提取 CHANGELOG 顶部条目的版本号（用于一致性检查）
function latestChangelogVersion() {
  if (!fs.existsSync(CHANGELOG_FILE)) return '';
  var content = fs.readFileSync(CHANGELOG_FILE, 'utf8');
  var m = content.match(/## \[([^\]]+)\]/);
  return m ? m[1].trim() : '';
}

// 顶部插入同版本条目：若已存在该版本条目则保留原样（保护手工整理内容），否则顶部插入新条目
function upsertChangelogEntry(version, body, dateStr) {
  var content = fs.existsSync(CHANGELOG_FILE) ? fs.readFileSync(CHANGELOG_FILE, 'utf8') : '';
  content = content.replace(/^# Changelog\s*\n+/i, '');
  var esc = version.replace(/\./g, '\\.');
  var existing = new RegExp('## \\[' + esc + '\\]', 'i');
  if (existing.test(content)) return false; // 同版本条目已存在
  var header = '## [' + version + '] - ' + dateStr;
  content = header + '\n' + body + '\n\n' + content;
  fs.writeFileSync(CHANGELOG_FILE, '# Changelog\n\n' + content, 'utf8');
  return true;
}

// ============================================================
// 版本同步（写入 version.json + upsert CHANGELOG + 同步 package.json）
// ============================================================

// 同步所有 package.json 的 version 字段，返回发生变更的文件列表
function syncPackageJson(version) {
  var changed = [];
  for (var i = 0; i < PKG_FILES.length; i++) {
    var pkgPath = path.join(ROOT, PKG_FILES[i]);
    if (!fs.existsSync(pkgPath)) continue;
    var pkg = readJson(pkgPath);
    if (pkg.version !== version) {
      pkg.version = version;
      writeJson(pkgPath, pkg);
      changed.push(PKG_FILES[i]);
    }
  }
  return changed;
}

/**
 * 应用一次版本变更（version.js 与 release.js 共用）
 * @param {string} newVersion 目标版本号
 * @param {string} changelog  版本条目正文
 * @param {object} options    可选 { dryRun, skipChangelog }
 * @returns {{oldVersion:string,newVersion:string,dateStr:string,buildHash:string,inserted:boolean,changedPkgs:string[]}}
 */
function applyVersionChange(newVersion, changelog, options) {
  options = options || {};
  var ver = readVersionFile();
  var oldVersion = ver.version || '1.0.0';
  var buildTime = new Date().toISOString();
  var buildHash = require('crypto').randomBytes(8).toString('hex');
  var dateStr = stampToday();
  var inserted = false;
  var changedPkgs = [];

  if (!options.dryRun) {
    ver.version = newVersion;
    ver.lastBuiltVersion = newVersion;
    ver.buildHash = buildHash;
    ver.buildTime = buildTime;
    ver.changelog = changelog;
    writeJson(VERSION_FILE, ver);
    if (!options.skipChangelog) inserted = upsertChangelogEntry(newVersion, changelog, dateStr);
    changedPkgs = syncPackageJson(newVersion);
  }

  return {
    oldVersion: oldVersion,
    newVersion: newVersion,
    dateStr: dateStr,
    buildHash: buildHash,
    inserted: inserted,
    changedPkgs: changedPkgs
  };
}

// ============================================================
// 一致性体检（check / show 使用）
// ============================================================

/**
 * 检查 version.json、CHANGELOG 顶部、所有 package.json 是否一致
 * @returns {{ ok:boolean, version:string, changelogTop:string, packages:object, mismatches:string[] }}
 */
function checkConsistency() {
  var ver = readVersionFile();
  var version = ver.version || '1.0.0';
  var changelogTop = latestChangelogVersion();
  var packages = {};
  var mismatches = [];

  for (var i = 0; i < PKG_FILES.length; i++) {
    var pkgPath = path.join(ROOT, PKG_FILES[i]);
    if (!fs.existsSync(pkgPath)) continue;
    var pkg = readJson(pkgPath);
    packages[PKG_FILES[i]] = pkg.version || '(无)';
    if ((pkg.version || '') !== version) mismatches.push(PKG_FILES[i] + ' = ' + (pkg.version || '无') + ' ≠ ' + version);
  }

  if (changelogTop !== version) mismatches.push('CHANGELOG.md 顶部 = ' + (changelogTop || '无') + ' ≠ ' + version);

  return {
    ok: mismatches.length === 0,
    version: version,
    changelogTop: changelogTop,
    packages: packages,
    mismatches: mismatches
  };
}

module.exports = {
  ROOT: ROOT,
  VERSION_FILE: VERSION_FILE,
  CHANGELOG_FILE: CHANGELOG_FILE,
  PKG_FILES: PKG_FILES,
  parseVersion: parseVersion,
  bumpVersion: bumpVersion,
  readJson: readJson,
  writeJson: writeJson,
  stampToday: stampToday,
  readVersionFile: readVersionFile,
  buildChangelog: buildChangelog,
  latestChangelogEntry: latestChangelogEntry,
  latestChangelogVersion: latestChangelogVersion,
  upsertChangelogEntry: upsertChangelogEntry,
  syncPackageJson: syncPackageJson,
  applyVersionChange: applyVersionChange,
  checkConsistency: checkConsistency
};