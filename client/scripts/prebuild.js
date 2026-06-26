/**
 * prebuild.js — 构建前版本号自动管理
 *
 * 功能：
 * 1. PATCH 版本号自动 +1（用户手动改 MAJOR/MINOR 时归零）
 * 2. 从 git log 自动生成 changelog
 * 3. 更新 version.json 的 buildTime、buildHash、changelog
 * 4. 写入 CHANGELOG.md
 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var childProcess = require('child_process');

var ROOT = path.resolve(__dirname, '../..');
var VERSION_FILE = path.join(ROOT, 'server/version.json');
var CHANGELOG_FILE = path.join(ROOT, 'CHANGELOG.md');

// ============================================================
// 工具函数
// ============================================================

function exec(cmd) {
  try {
    return childProcess.execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: 10000 }).trim();
  } catch (e) {
    return '';
  }
}

function parseVersion(v) {
  var parts = String(v).split('.').map(Number);
  return {
    major: parts[0] || 1,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
    string: (parts[0] || 1) + '.' + (parts[1] || 0) + '.' + (parts[2] || 0)
  };
}

function readVersionFile() {
  try {
    return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  } catch (e) {
    return {
      version: '1.0.0',
      lastBuiltVersion: '0.0.0',
      buildHash: '',
      buildTime: '',
      changelog: '',
      minClientVersion: '1.0.0',
      forceUpdate: false,
      updateUrl: ''
    };
  }
}

// ============================================================
// 主流程
// ============================================================

console.log('[prebuild] 版本号管理...');

var data = readVersionFile();
var currentVersion = data.version || '1.0.0';
var lastBuiltVersion = data.lastBuiltVersion || '0.0.0';

var cur = parseVersion(currentVersion);
var last = parseVersion(lastBuiltVersion);

// 判断用户是否手动修改了 MAJOR 或 MINOR
var manualMajorMinorChange = (cur.major !== last.major) || (cur.minor !== last.minor);

var newVersion;
if (manualMajorMinorChange) {
  // 用户手动改了 MAJOR/MINOR → PATCH 归零
  newVersion = cur.major + '.' + cur.minor + '.0';
  console.log('[prebuild] 检测到 MAJOR/MINOR 手动变更，PATCH 归零: ' + currentVersion + ' → ' + newVersion);
} else {
  // 自动递增 PATCH
  newVersion = cur.major + '.' + cur.minor + '.' + (cur.patch + 1);
  console.log('[prebuild] PATCH 自动递增: ' + currentVersion + ' → ' + newVersion);
}

// ============================================================
// 生成 Changelog（从 git log 提取，分类展示）
// ============================================================

var lastBuildTime = data.buildTime || '';
var gitRange = lastBuildTime ? '--since="' + lastBuildTime + '"' : '--max-count=50';
var gitLog = exec('git log ' + gitRange + ' --pretty=format:"%s" --no-merges');

// 解析并分类提交，过滤无意义的 savepoint
var features = [];
var fixes = [];
var others = [];

if (gitLog) {
  var lines = gitLog.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    // 跳过备份点
    if (line.indexOf('savepoint') !== -1 || line.indexOf('💾') !== -1) continue;
    // 跳过 chore/docs 类
    if (/^(chore|docs):/.test(line)) continue;

    // 分类
    if (/^feat:/.test(line)) {
      features.push(line.replace(/^feat:\s*/, ''));
    } else if (/^fix:/.test(line)) {
      fixes.push(line.replace(/^fix:\s*/, ''));
    } else if (/^refactor:/.test(line)) {
      fixes.push(line.replace(/^refactor:\s*/, ''));
    } else if (/^style:/.test(line)) {
      features.push(line.replace(/^style:\s*/, ''));
    } else {
      // 非规范格式但可能是重要提交，放其他
      others.push(line);
    }
  }
}

var changelogEntry = '';
if (features.length > 0) {
  changelogEntry += '【新增】\n';
  for (var f = 0; f < features.length; f++) {
    changelogEntry += features[f] + '\n';
  }
  changelogEntry += '\n';
}
if (fixes.length > 0) {
  changelogEntry += '【修复/优化】\n';
  for (var fx = 0; fx < fixes.length; fx++) {
    changelogEntry += fixes[fx] + '\n';
  }
  changelogEntry += '\n';
}
if (others.length > 0) {
  changelogEntry += '【其他】\n';
  for (var o = 0; o < others.length; o++) {
    changelogEntry += others[o] + '\n';
  }
  changelogEntry += '\n';
}
if (!changelogEntry) {
  changelogEntry = '版本更新';
}

var now = new Date();
var buildTime = now.toISOString();
var buildHash = crypto.randomBytes(8).toString('hex');
var dateStr = now.getFullYear() + '-' +
  String(now.getMonth() + 1).padStart(2, '0') + '-' +
  String(now.getDate()).padStart(2, '0');

// ============================================================
// 写入 CHANGELOG.md（幂等：同版本不重复）
// ============================================================

var existingChangelog = '';
if (fs.existsSync(CHANGELOG_FILE)) {
  existingChangelog = fs.readFileSync(CHANGELOG_FILE, 'utf8');
  // 移除文件头部的 "# Changelog" 行（如果存在）
  existingChangelog = existingChangelog.replace(/^# Changelog\s*\n+/i, '');
}

var versionHeader = '## [' + newVersion + '] - ' + dateStr;
// 如果该版本已存在于 changelog 中，移除旧条目（避免重复）
var versionRegex = new RegExp('## \\[' + newVersion.replace(/\./g, '\\.') + '\\][^\\n]*\\n(?:[-*].*\\n)*', 'g');
existingChangelog = existingChangelog.replace(versionRegex, '');

var newChangelogContent = '# Changelog\n\n' +
  versionHeader + '\n' +
  (changelogEntry || '*此版本无提交记录*') + '\n\n' +
  existingChangelog;

fs.writeFileSync(CHANGELOG_FILE, newChangelogContent, 'utf8');
console.log('[prebuild] CHANGELOG.md 已更新');

// ============================================================
// 更新 version.json
// ============================================================

data.version = newVersion;
data.lastBuiltVersion = newVersion;
data.buildHash = buildHash;
data.buildTime = buildTime;
data.changelog = changelogEntry.trim();
data.minClientVersion = data.minClientVersion || '1.0.0';

fs.writeFileSync(VERSION_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('[prebuild] version.json 已更新: ' + newVersion + ' (build ' + buildHash + ')');
