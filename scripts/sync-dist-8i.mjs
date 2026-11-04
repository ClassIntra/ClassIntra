// 把 client/dist 同步到 8i
// ============================================================
// 为什么需要这个脚本：
//   apps/ 下的「系统应用」前端由 vite **全量打包**进 client/dist，
//   而 18i → 8i 的自动文件同步**不包含 dist**（构建产物，避免半成品互相覆盖）。
//   结果就是：改了系统应用、只在 18i 构建，8i 上的平板还是旧界面 —— 而且不会报错，
//   只是「怎么没变」。
//
//   市场应用（market-apps/）不受影响：它们是 entry.js 直出，不走 dist。
//
// 用法：node scripts/sync-dist-8i.mjs
//   1. 打包 client/dist → 临时 tar.gz
//   2. scp 到 8i（Tailscale，4–5 MB，慢的时候要几分钟）
//   3. 在 8i 上解压覆盖（旧 assets 保留，index.html 指向新 hash，不影响）
//   4. 比对两端 index.html 的入口 hash，一致才算成功
//
// 注意：不要用 scp -r 逐文件传（259 个小文件 + 高延迟，比 tar 慢一个数量级）。

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const HOST = process.env.CI_8I_HOST || 'deploy@10.0.0.8';
// 必须用 Windows 自带的 bsdtar：PATH 里的 GNU tar（Git Bash）会把 "C:\..." 当成远程主机
const WIN_TAR = process.env.SystemRoot
  ? join(process.env.SystemRoot, 'System32', 'tar.exe')
  : 'C:\Windows\System32\tar.exe';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'client', 'dist');
const REMOTE_TAR = 'C:/Users/deploy/ci-dist.tar.gz';
const REMOTE_DIST = 'D:\\NetWork\\ClassIntra\\client\\dist';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function entryHash(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const m = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html);
  return m ? m[0] : '';
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('✗ 找不到 client/dist/index.html —— 先在 18i 构建：node scripts/build-app.js <app>');
  process.exit(1);
}

const localHash = entryHash(join(DIST, 'index.html'));
console.log('本地入口：' + localHash);

const tarPath = join(tmpdir(), 'ci-dist-' + Date.now() + '.tar.gz');
console.log('\n[1/4] 打包 client/dist');
run(WIN_TAR, ['-czf', tarPath, '-C', DIST, '.']);
console.log('      ' + (statSync(tarPath).size / 1024 / 1024).toFixed(1) + ' MB');

console.log('\n[2/4] 传输到 8i（Tailscale，可能要几分钟）');
run('scp', ['-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=15', tarPath, HOST + ':' + REMOTE_TAR]);

console.log('\n[3/4] 在 8i 上解压覆盖');
run('ssh', ['-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=15', HOST,
  'cd /d ' + REMOTE_DIST + ' & tar -xzf ' + REMOTE_TAR]);

console.log('\n[4/4] 校验入口 hash');
const remote = execFileSync('ssh', ['-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=15', HOST,
  'findstr /C:"assets/index-" ' + REMOTE_DIST + '\\index.html'], { encoding: 'utf8' });
const rm = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(remote);
const remoteHash = rm ? rm[0] : '(未取到)';
console.log('8i 入口：' + remoteHash);

if (remoteHash === localHash) {
  console.log('\n✓ 同步完成：两端入口一致');
} else {
  console.error('\n✗ 同步失败：两端入口不一致，检查 8i 上的解压结果');
  process.exit(1);
}
