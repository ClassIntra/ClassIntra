#!/usr/bin/env node
// 中国象棋人机引擎（Pikafish）安装/校验脚本
//
// 背景：市场应用 chess 的「人机练习」默认走服务端 Pikafish。引擎是 GPL-3 的第三方二进制，
// **不进任何公开仓**（主仓 market-apps/ 已整体 gitignore；market 仓另有 .gitignore 兜底），
// 换机器/新部署时需要单独装一次——本脚本就是那一次。
//
// 用法：
//   node scripts/chess-engine-setup.mjs                       # 安装（已装好则跳过）
//   node scripts/chess-engine-setup.mjs --force               # 强制重装
//   node scripts/chess-engine-setup.mjs --check               # 只校验：文件在不在 + UCI 握手能否出着
//   node scripts/chess-engine-setup.mjs --from <本地.7z 路径>  # 离线安装（用已下载的发布包）
//   node scripts/chess-engine-setup.mjs --tag Pikafish-2026-09-06
//
// 装到哪：market-apps/chess/backend/engine/{pikafish.exe,pikafish.nnue,+许可证}
// 为什么是这个位置：应用目录自包含，`CHESS_ENGINE_DIR` 环境变量可覆盖；
// 8i 的 Syncthing 已忽略 *.exe/*.nnue（DERP 隧道带宽只有 ~8KB/s，57MB 同步不现实），
// 所以 8i 上同样需要跑一次本脚本。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ENGINE_DIR = process.env.CHESS_ENGINE_DIR || path.join(ROOT, 'market-apps', 'chess', 'backend', 'engine');
const REPO = 'official-pikafish/Pikafish';
const DEFAULT_TAG = 'Pikafish-2026-09-06';
const WIN_EXE_IN_ARCHIVE = 'Pikafish-Windows-x86-64-universal.exe';
const KEEP_FILES = [WIN_EXE_IN_ARCHIVE, 'pikafish.nnue', 'Copying.txt', 'NNUE-License.md', 'AUTHORS'];
// 直连 GitHub 在校园网常被掐 SNI，代理列表按稳定性排序，逐个回退
const PROXIES = ['', 'https://v4.gh-proxy.org/', 'https://ghfast.top/', 'https://gh-proxy.com/'];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : '';
};

function log(...parts) { console.log(...parts); }
function fail(message) { console.error('✗ ' + message); process.exit(1); }

function sevenZip() {
  const candidates = [
    process.env.SEVEN_ZIP,
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    '/usr/bin/7z',
    '7z'
  ].filter(Boolean);
  for (const candidate of candidates) {
    const isPath = candidate.includes('\\') || candidate.includes('/');
    if (isPath && !fs.existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['i'], { encoding: 'utf8', windowsHide: true });
    if (!probe.error) return candidate;
  }
  return null;
}

function installedFiles() {
  const exe = path.join(ENGINE_DIR, 'pikafish.exe');
  const net = path.join(ENGINE_DIR, 'pikafish.nnue');
  const sizeOf = (file) => { try { return fs.statSync(file).size; } catch (e) { return 0; } };
  return { exe, net, exeSize: sizeOf(exe), netSize: sizeOf(net) };
}

// 真实跑一次 UCI 握手并要一步棋：只校验「文件在」是不够的——
// 引擎缺权重（pikafish.nnue）时会启动后静默退出，光看文件列表发现不了。
function handshakeCheck() {
  return new Promise((resolve) => {
    const { exe } = installedFiles();
    const proc = spawn(exe, [], { cwd: ENGINE_DIR, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} resolve({ ok: false, detail: '握手超时（30s）' }); }, 30000);
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, detail: '启动失败：' + e.message }); });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      const name = (out.match(/id name (.+)/) || [])[1] || '';
      const best = (out.match(/bestmove ([a-i][0-9][a-i][0-9])/) || [])[1] || '';
      if (best) resolve({ ok: true, detail: (name || 'Pikafish') + ' → bestmove ' + best });
      else resolve({ ok: false, detail: '未拿到 bestmove（exit=' + code + '）' + (err ? ' stderr=' + err.slice(0, 200) : '') });
    });
    const write = (line) => { try { proc.stdin.write(line + '\n'); } catch (e) {} };
    write('uci');
    setTimeout(() => {
      write('setoption name Threads value 1');
      write('isready');
      setTimeout(() => {
        write('position fen rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
        write('go movetime 300');
        setTimeout(() => { try { proc.kill(); } catch (e) {} }, 4000);
      }, 800);
    }, 800);
  });
}

async function latestAssetUrl() {
  const tag = value('--tag') || DEFAULT_TAG;
  const direct = `https://github.com/${REPO}/releases/download/${tag}/Pikafish.${tag.replace('Pikafish-', '')}.7z`;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, { signal: AbortSignal.timeout(20000) });
    if (response.ok) {
      const data = await response.json();
      const asset = (data.assets || []).find((a) => a.name.endsWith('.7z'));
      if (asset) return { url: asset.browser_download_url, name: asset.name, tag };
    }
  } catch (e) { /* API 不可达就用直连约定 URL 兜底 */ }
  return { url: direct, name: path.basename(direct), tag };
}

async function download(url, dest) {
  log('  下载 ' + url);
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(600000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const total = Number(response.headers.get('content-length') || 0);
  const out = fs.createWriteStream(dest);
  let received = 0;
  let lastPrint = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    out.write(chunk);
    if (total && Date.now() - lastPrint > 2000) {
      lastPrint = Date.now();
      log('    ' + (received / 1048576).toFixed(1) + ' / ' + (total / 1048576).toFixed(1) + ' MB');
    }
  }
  await new Promise((resolve) => out.end(resolve));
  if (received < 1048576) throw new Error('下载内容过小（' + received + ' 字节）');
  return received;
}

async function obtainArchive(target) {
  const local = value('--from');
  if (local) {
    const resolved = path.resolve(local);
    if (!fs.existsSync(resolved)) fail('指定的本地包不存在：' + resolved);
    log('· 使用本地发布包：' + resolved);
    return resolved;
  }
  const { url, name } = await latestAssetUrl();
  const errors = [];
  for (const proxy of PROXIES) {
    const attempt = proxy ? proxy + url : url;
    try {
      await download(attempt, target);
      log('· 下载完成（' + (fs.statSync(target).size / 1048576).toFixed(1) + ' MB，来源 ' + (proxy || 'GitHub 直连') + '）');
      return target;
    } catch (e) {
      errors.push((proxy || '直连') + ' → ' + e.message);
      try { fs.unlinkSync(target); } catch (e2) { /* 忽略 */ }
    }
  }
  fail('所有下载通道都失败：\n  ' + errors.join('\n  ') + '\n可用 --from 指定本地 ' + name);
}

async function install() {
  const sevenZipExe = sevenZip();
  if (!sevenZipExe) fail('找不到 7z（装 7-Zip 或设 SEVEN_ZIP 环境变量；Linux 上 apt install p7zip-full）');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pikafish-'));
  const archive = path.join(tmpDir, 'pikafish-release.7z');
  try {
    // --from 时直接用本地包，不走临时目录（否则解压的是那个还没被创建的空路径）
    const archivePath = await obtainArchive(archive);
    log('· 解压（' + sevenZipExe + '）');
    fs.mkdirSync(ENGINE_DIR, { recursive: true });
    const extract = spawnSync(sevenZipExe, ['e', archivePath, '-o' + ENGINE_DIR, ...KEEP_FILES, '-y', '-sccUTF-8'], { encoding: 'utf8', windowsHide: true });
    if (extract.error || extract.status !== 0) fail('解压失败：' + (extract.error ? extract.error.message : extract.stdout + extract.stderr));
    const from = path.join(ENGINE_DIR, WIN_EXE_IN_ARCHIVE);
    const to = path.join(ENGINE_DIR, 'pikafish.exe');
    if (fs.existsSync(from)) { fs.rmSync(to, { force: true }); fs.renameSync(from, to); }
    if (!fs.existsSync(to)) fail('解压后没有拿到 Windows 可执行文件');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  log('Pikafish 引擎安装器');
  log('  目标目录：' + ENGINE_DIR);
  const { exe, net, exeSize, netSize } = installedFiles();

  if (flag('--check')) {
    log('· 可执行文件：' + (exeSize ? (exeSize / 1048576).toFixed(1) + ' MB' : '缺失'));
    log('· 权重文件：' + (netSize ? (netSize / 1048576).toFixed(1) + ' MB' : '缺失'));
    if (!exeSize || !netSize) fail('引擎文件不完整，去掉 --check 重新安装');
    const check = await handshakeCheck();
    return check.ok ? (log('✓ 引擎可用：' + check.detail), undefined) : fail('引擎不可用：' + check.detail);
  }

  if (exeSize > 1048576 && netSize > 1048576 && !flag('--force')) {
    log('· 已存在（exe ' + (exeSize / 1048576).toFixed(1) + ' MB / net ' + (netSize / 1048576).toFixed(1) + ' MB），跳过；要重装加 --force');
  } else {
    await install();
    const after = installedFiles();
    log('· 安装完成：exe ' + (after.exeSize / 1048576).toFixed(1) + ' MB / net ' + (after.netSize / 1048576).toFixed(1) + ' MB');
  }

  const check = await handshakeCheck();
  if (!check.ok) fail('自检失败：' + check.detail);
  log('✓ 引擎可用：' + check.detail);
  log('  提示：应用侧可用 CHESS_ENGINE_DISABLE=1 强制降级到内置 AI；改完引擎文件无需重启服务（下次应手自动拉起新进程）。');
}

main().catch((error) => fail(error && error.stack || String(error)));
