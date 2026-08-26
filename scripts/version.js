/**
 * version.js — ClassIntra 统一版本管理入口（唯一改版本号的地方）
 *
 * 用法（在仓库根目录 ClassIntra/ 下执行）:
 *   node scripts/version.js show                     # 查看当前版本 + 全文件一致性体检
 *   node scripts/version.js check                    # 只做一致性体检（CI 可用，不修改）
 *   node scripts/version.js patch "说明"             # PATCH +1（默认为交给 git 自动生成）
 *   node scripts/version.js minor "说明"             # MINOR +1（PATCH 归零）
 *   node scripts/version.js major "说明"             # MAJOR +1（MINOR/PATCH 归零）
 *   node scripts/version.js set 2.0.0 "说明"         # 直接指定版本
 *   以上 bump 命令均支持 --dry-run（仅预览不落盘）
 *
 * 同步范围（一次写齐）:
 *   server/version.json + CHANGELOG.md 顶部 + 全部 package.json
 */

var core = require('./version-core');

var args = process.argv.slice(2);
var action = 'show';
var messageParts = [];
var setVersion = '';

for (var i = 0; i < args.length; i++) {
  var a = args[i];
  if (a === '--dry-run') continue;
  if (action === 'show' && /^(show|check|patch|minor|major|set)$/.test(a)) { action = a; continue; }
  if (action === 'set' && !setVersion) { setVersion = a; continue; }
  messageParts.push(a);
}

var dryRun = args.indexOf('--dry-run') !== -1;
var message = messageParts.join(' ');

// ============================================================
// show / check：查看版本与一致性
// ============================================================

if (action === 'show' || action === 'check') {
  var result = core.checkConsistency();
  console.log('=== ClassIntra 版本信息 ===');
  console.log('server/version.json  : ' + result.version);
  console.log('CHANGELOG.md 顶部     : ' + (result.changelogTop || '(空)'));
  for (var key in result.packages) {
    console.log((key + '                    ').slice(0, 22) + ': ' + result.packages[key]);
  }
  console.log('');
  if (result.ok) {
    console.log('✔ 一致性检查通过：所有文件版本一致');
  } else {
    console.log('✘ 一致性检查失败，存在 ' + result.mismatches.length + ' 处不一致:');
    result.mismatches.forEach(function(m) { console.log('  - ' + m); });
    if (action === 'check') process.exit(1);
  }
  return;
}

// ============================================================
// bump：统一升版本 / 指定版本
// ============================================================

var ver = core.readVersionFile();
var currentVersion = ver.version || '1.0.0';
var nextVersion;

if (action === 'set') {
  if (!setVersion || !/^\d+\.\d+\.\d+$/.test(setVersion)) {
    console.error('[version] 用法: node scripts/version.js set <x.y.z> ["说明"]');
    process.exit(1);
  }
  nextVersion = setVersion;
} else {
  nextVersion = core.bumpVersion(currentVersion, action);
}

if (action !== 'show') {
  var changelogBody = message || core.buildChangelog() || '版本更新';
  console.log('=== ClassIntra ' + (action === 'set' ? '指定版本' : '版本升级') + ' ===');
  console.log('版本: ' + currentVersion + ' → ' + nextVersion);
  console.log('变更说明: ' + (message ? message : '(自动从 git log 生成)'));
  console.log('');

  if (dryRun) {
    console.log('（--dry-run 预览，未写入任何文件）');
    console.log('将写入:');
    console.log('  server/version.json  version=' + nextVersion);
    console.log('  CHANGELOG.md 顶部插入 [' + nextVersion + ']');
    for (var pi = 0; pi < core.PKG_FILES.length; pi++) {
      console.log('  ' + core.PKG_FILES[pi] + '  → ' + nextVersion);
    }
    return;
  }

  var applied = core.applyVersionChange(nextVersion, changelogBody);
  console.log('已完成:');
  console.log('  server/version.json   → ' + applied.newVersion + ' (build ' + applied.buildHash + ')');
  console.log('  CHANGELOG.md          ' + (applied.inserted ? '顶部插入 [' + applied.newVersion + ']' : '已存在同版本条目，保留原内容'));
  if (applied.changedPkgs.length) {
    console.log('  同步 package.json:' + applied.changedPkgs.map(function(f) { return ' ' + f + '→' + applied.newVersion; }).join(','));
  } else {
    console.log('  同步 package.json:（均已一致）');
  }
  console.log('');
}