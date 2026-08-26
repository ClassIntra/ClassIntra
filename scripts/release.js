/**
 * release.js — ClassIntra 一键发布脚本
 *
 * 用法（在仓库根目录 ClassIntra/ 下执行）:
 *   node scripts/release.js patch                        # 发布补丁版（PATCH +1）
 *   node scripts/release.js minor                        # 发布次版本（MINOR +1, PATCH 归零）
 *   node scripts/release.js major                        # 发布主版本（MAJOR +1, MINOR/PATCH 归零）
 *   node scripts/release.js current                      # 直接发布 version.json 当前版本（不递增）
 *   node scripts/release.js patch --message "修复 xxx"   # 自定义 changelog 说明
 *   node scripts/release.js patch --skip-tests           # 跳过服务端测试
 *   node scripts/release.js patch --push                 # 发布成功后自动推送 main + tag 到 origin
 *   node scripts/release.js patch --dry-run              # 仅预览将要执行的动作（不落盘、不提交）
 *
 * 流程:
 *   1. （可选）运行服务端测试 pnpm test
 *   2. 按 bump 类型计算目标版本 → 调用 version-core 统一同步 version.json / CHANGELOG / package.json
 *   3. 构建客户端（npx vite build，不经 prebuild；版本已由步骤 2 确定）
 *   4. git add + commit + 打 tag（vX.Y.Z）
 *   5. （可选 --push）推送 main 与 tag 到 origin
 *   6. 若 gh 已安装且已认证 → 创建 GitHub Release（notes 取自 CHANGELOG 顶部条目）
 *
 * 发布制度要求:
 *   - 版本权威数据源 = server/version.json
 *   - 打 tag 名称格式 = v<版本>（如 v1.2.1），与 GitHub Release tag 一一对应
 *   - GitHub Release 标题 = v<版本>，正文 = 对应 CHANGELOG 条目
 *   - CHANGELOG 顶部版本 = version.json = GitHub Release tag，三者必须一致
 */

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var core = require('./version-core');

var ROOT = core.ROOT;

// ============================================================
// 参数解析
// ============================================================

var args = process.argv.slice(2);
var bumpType = 'patch';
var message = '';
var skipTests = false;
var push = false;
var dryRun = false;

for (var i = 0; i < args.length; i++) {
  var arg = args[i];
  if (arg === 'patch' || arg === 'minor' || arg === 'major' || arg === 'current') bumpType = arg;
  else if (arg === '--message') message = args[++i] || '';
  else if (arg === '--skip-tests') skipTests = true;
  else if (arg === '--push') push = true;
  else if (arg === '--dry-run') dryRun = true;
  else { console.error('[release] 未知参数: ' + arg); process.exit(1); }
}

// ============================================================
// 工具函数
// ============================================================

// 当前进程可能未继承新安装 gh 的用户级 PATH，先探测常见安装位置
var ghExtraPath = '';
try {
  var home = process.env.LOCALAPPDATA || (process.env.USERPROFILE + '\\AppData\\Local');
  var ghBin = home + '\\Programs\\gh\\bin';
  if (fs.existsSync(ghBin)) ghExtraPath = ghBin;
} catch (e) { /* 忽略 */ }

var execOpts = ghExtraPath ? { extPath: ghExtraPath } : {};

// 从 Windows 凭据管理器 / git credential helper 提取 github.com 凭据（不打印明文）
function readStoredCredential() {
  try {
    var out = childProcess.execSync('git credential fill', {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8', cwd: ROOT, windowsHide: true, timeout: 15000
    });
    var m = String(out).match(/password=(\S+)/);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

// 探测当前 GH_TOKEN 是否对远程仓库真正拥有 push 权限
// （gh auth status 只报"已认证"，陈旧/无权限 token 也会误报 → 必须实际探测）
function probeGhToken(repo) {
  var candidates = [];
  var stored = readStoredCredential();
  if (stored) candidates.push({ label: '系统凭据', token: stored });
  if (process.env.GH_TOKEN) candidates.push({ label: 'GH_TOKEN', token: process.env.GH_TOKEN });
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    try {
      var env = Object.assign({}, process.env);
      if (ghExtraPath) { env.Path = (env.Path || '') + ';' + ghExtraPath; env.PATH = env.Path; }
      env.GH_TOKEN = c.token;
      env.GITHUB_TOKEN = '';
      var probe = 'gh api repos/' + repo + ' --jq .permissions.push';
      var out = childProcess.execSync(probe, { env: env, encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
      if (out === 'true') return { label: c.label, token: c.token };
    } catch (e) { /* 尝试下一个候选 */ }
  }
  return null;
}

function exec(cmd, opts) {
  opts = opts || {};
  var env = process.env;
  if (opts.extPath || opts.ghToken) {
    env = Object.assign({}, process.env);
    if (opts.extPath) {
      env.Path = env.Path + (env.Path ? ';' : '') + opts.extPath;
      env.PATH = env.Path;
    }
    if (opts.ghToken) { env.GH_TOKEN = opts.ghToken; env.GITHUB_TOKEN = ''; }
  }
  var options = { cwd: opts.cwd || ROOT, encoding: 'utf8', stdio: opts.stdio || 'pipe', env: env };
  if (!opts.ignoreFail) options.stdio = 'inherit';
  try {
    var out = childProcess.execSync(cmd, options);
    return out ? out.trim() : '';
  } catch (e) {
    if (opts.ignoreFail) return '';
    console.error('[release] 命令执行失败: ' + cmd);
    process.exit(e.status || 1);
  }
}

// ============================================================
// 检查前置条件
// ============================================================

console.log('[release] === ClassIntra 发布流程 ===');
console.log('[release] bump 类型: ' + bumpType + (dryRun ? ' （dry-run 预览模式）' : ''));

var ghAvailable = false;
var ghToken = null;
try {
  var ghVersion = exec('gh --version', Object.assign({ ignoreFail: true }, execOpts));
  ghAvailable = !!ghVersion;
} catch (e) { ghAvailable = false; }
if (ghAvailable) console.log('[release] gh CLI: 可用');
else console.log('[release] gh CLI: 未安装（跳过 GitHub Release 创建，仅本地提交+tag）');

if (ghAvailable) {
  // 获取远程仓库 owner/name，用于权限探测
  var ghRepo = exec('git config --get remote.origin.url', { ignoreFail: true })
    .replace(/^.*github\.com[:/](.+?)(\.git)?$/, '$1').replace(/\.git$/, '');
  if (!ghRepo) {
    console.warn('[release] 无法解析远程仓库 → 跳过 GitHub Release');
    ghAvailable = false;
  } else {
    ghToken = probeGhToken(ghRepo);
    if (ghToken) console.log('[release] gh 认证: ' + ghToken.label + '（已实际探测 push 权限）');
    else {
      ghAvailable = false;
      console.warn('[release] 无有效 GH_TOKEN（GH_TOKEN 无 push 权限且系统凭据不可用）→ 跳过 GitHub Release');
    }
  }
}

// ============================================================
// 1. 服务端测试（可选）
// ============================================================

if (!skipTests && !dryRun) {
  console.log('\n[release] 步骤 1/5: 运行服务端测试...');
  exec('pnpm test', { cwd: path.join(ROOT, 'server') });
} else {
  console.log('\n[release] 步骤 1/5: 跳过测试' + (dryRun ? '（dry-run）' : '（--skip-tests）'));
}

// ============================================================
// 2. 计算目标版本并统一同步（version.json + CHANGELOG + package.json）
// ============================================================

console.log('\n[release] 步骤 2/5: 计算版本并同步所有版本文件...');
var ver = core.readVersionFile();
var releaseVersion = bumpType === 'current' ? (ver.version || '1.0.0') : core.bumpVersion(ver.version || '1.0.0', bumpType);
// current 模式优先复用已有 CHANGELOG 条目（保护手工整理的安全修复详情），否则从 git log 生成
var releaseChangelog;
if (bumpType === 'current') {
  releaseChangelog = message || core.latestChangelogEntry() || ver.changelog || '版本更新';
} else {
  releaseChangelog = message || core.buildChangelog();
}
console.log('[release] 版本: ' + (ver.version || '1.0.0') + ' → ' + releaseVersion);

if (!dryRun) {
  var applied = core.applyVersionChange(releaseVersion, releaseChangelog);
  console.log('[release] version.json / CHANGELOG.md / package.json 已同步' +
    (applied.changedPkgs.length ? '（' + applied.changedPkgs.join(', ') + '）' : ''));
} else {
  console.log('[release] dry-run: 将写入 version=' + releaseVersion + '，并同步 CHANGELOG 与 package.json');
}

// ============================================================
// 3. 构建客户端（vite build 直连，不经 prebuild；版本已由步骤 2 确定）
// ============================================================

console.log('\n[release] 步骤 3/5: 构建客户端...');
if (!dryRun) {
  exec('npx vite build', { cwd: path.join(ROOT, 'client') });
  console.log('[release] 客户端构建完成');
} else {
  console.log('[release] dry-run: 在 client/ 下执行 npx vite build');
}

var tagName = 'v' + releaseVersion;

// ============================================================
// 4. git commit + tag
// ============================================================

console.log('\n[release] 步骤 4/5: git commit + tag...');
if (dryRun) {
  console.log('[release] dry-run: git add -A && git commit -m "chore(release): prepare ' + releaseVersion + '"');
  console.log('[release] dry-run: git tag ' + tagName);
} else {
  exec('git add -A');
  exec('git commit -m "chore(release): prepare ' + releaseVersion + '"', { ignoreFail: true });
  var existingTag = exec('git tag -l ' + tagName, { ignoreFail: true });
  if (existingTag) {
    console.warn('[release] tag ' + tagName + ' 已存在，跳过创建');
  } else {
    exec('git tag ' + tagName);
    console.log('[release] 已创建 tag: ' + tagName);
  }
}

if (!releaseChangelog) releaseChangelog = '版本更新';

// ============================================================
// 5. 推送（可选，需在 gh release 之前确保 tag 存在于远程）
// ============================================================

if (push && !dryRun) {
  console.log('\n[release] 步骤 5/5: 推送 main 与 tag 到 origin...');
  exec('git push origin main');
  exec('git push origin ' + tagName);
  console.log('[release] 推送完成');
} else if (push && dryRun) {
  console.log('[release] dry-run: git push origin main && git push origin ' + tagName);
} else {
  console.log('\n[release] 步骤 5/5: （未指定 --push，跳过推送）');
}

// ============================================================
// 6. gh release 创建（可选）
// ============================================================

if (ghAvailable && !dryRun) {
  console.log('\n[release] 创建 GitHub Release...');
  var ghReleaseArgs = 'gh release create ' + tagName + ' --title "' + tagName + '" --notes "' + releaseChangelog.replace(/"/g, "'") + '"';
  if (ghToken) exec(ghReleaseArgs, Object.assign({}, execOpts, { ghToken: ghToken.token }));
  else exec(ghReleaseArgs, execOpts);
  console.log('[release] GitHub Release 已创建: https://github.com/ClassIntra/ClassIntra/releases/tag/' + tagName);
} else if (dryRun) {
  console.log('\n[release] dry-run: gh release create ' + tagName + ' --title "' + tagName + '" --notes "<changelog>"');
} else {
  console.log('\n[release] 跳过 GitHub Release（gh 不可用/未认证）');
}

// ============================================================
// 收尾
// ============================================================

console.log('\n[release] === 完成 ===');
if (dryRun) {
  console.log('[release] 这是预览结果，未做任何修改。确认无误后去掉 --dry-run 正式发布。');
} else if (!ghAvailable) {
  console.log('[release] 提示: 运行 gh auth login 认证后，下次发布将自动创建 GitHub Release。');
}