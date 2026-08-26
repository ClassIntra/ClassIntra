/**
 * prebuild.js — 构建前构建元信息刷新（版本号管理已移交给 scripts/version.js）
 *
 * 功能：
 * 1. 从 git log 自动生成本次构建的变更摘要（供客户端"更新日志"展示）
 * 2. 更新 version.json 的 buildTime、buildHash、changelog
 *
 * 注意：本脚本不再自动递增版本号、不再写 CHANGELOG.md。
 *       版本号变更统一走 `node scripts/version.js`（唯一入口）。
 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var childProcess = require('child_process');

var ROOT = path.resolve(__dirname, '../..');
var VERSION_FILE = path.join(ROOT, 'server/version.json');

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

console.log('[prebuild] 构建元信息刷新...');

var data = readVersionFile();
var currentVersion = data.version || '1.0.0';
console.log('[prebuild] 当前版本: ' + currentVersion + '（版本号由 scripts/version.js 管理，本脚本不递增）');

// ============================================================
// 生成变更摘要（从 git log 提取，分类展示，供客户端运行期展示）
// ============================================================

var lastBuildTime = data.buildTime || '';
var gitRange = lastBuildTime ? '--since="' + lastBuildTime + '"' : '--max-count=50';
var gitLog = exec('git log ' + gitRange + ' --pretty=format:"%s" --no-merges');

var features = [];
var fixes = [];
var others = [];

if (gitLog) {
  var lines = gitLog.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (line.indexOf('savepoint') !== -1 || line.indexOf('💾') !== -1) continue;
    if (/^(chore|docs):/.test(line)) continue;

    if (/^feat:/.test(line)) {
      features.push(line.replace(/^feat:\s*/, ''));
    } else if (/^fix:/.test(line)) {
      fixes.push(line.replace(/^fix:\s*/, ''));
    } else if (/^refactor:/.test(line)) {
      fixes.push(line.replace(/^refactor:\s*/, ''));
    } else if (/^style:/.test(line)) {
      features.push(line.replace(/^style:\s*/, ''));
    } else {
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

// ============================================================
// 更新 version.json（版本号不变，仅刷新构建元信息）
// ============================================================

data.buildHash = crypto.randomBytes(8).toString('hex');
data.buildTime = new Date().toISOString();
data.changelog = changelogEntry.trim();
data.minClientVersion = data.minClientVersion || '1.0.0';

fs.writeFileSync(VERSION_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('[prebuild] version.json 已更新: ' + currentVersion + ' (build ' + data.buildHash + ')');
console.log('[prebuild] 变更摘要长度: ' + data.changelog.length + ' 字符');