// 组网反向隧道（18i → 8i）：把 18i 的 CI 9001 映射到 8i 的 127.0.0.1:9120
//
// 为什么存在：8i 的入站被防火墙拦着（8i→18i 新建 TCP 不通，已知缺陷），
// 而 18i→8i 方向是通的（Cluss 仓的 mesh-tunnel-8i 同款 SSH 反向隧道常驻）。
// 云盘读路径「按需回源」需要 8i 能主动访问 18i 的 /api/cloud/peer-fetch，
// 于是由 18i 主动 SSH，把本机 9001 反向映射到 8i 的回环 9120；8i 的 CI 配
// PEER_MEDIA_BASES=http://127.0.0.1:9120 即走这条隧道回源（对端基址派生
// 逻辑见 apps/resource/backend/cloud-routes.js 的 peerBackfillBases）。
//
// 与 cluss-mesh-tunnel-8i（-R 9119 → 中枢 9003）并列，互不干扰。
// 隧道断开时 8i 的回源请求连不上回环 → 快速失败 → 负缓存 60s → 404 回落，
// 不影响业务（Syncthing 仍是主通道）；PM2 负责拉起下一次连接。
//
// 为什么是 .mjs 而不是 .bat：PM2 不会把 .bat 当脚本执行；Node 进程才能
// 获得 PM2 原生的自动重启/日志轮转。这里只做一件事：托管 ssh 子进程，
// 子进程退出就跟着退出，让 PM2 拉起下一次。
import { spawn } from 'node:child_process';

const SSH = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';
const TARGET = 'cideploy@100.115.93.90';
const ARGS = [
  '-N',
  '-o', 'BatchMode=yes',
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-R', '9120:127.0.0.1:9001',   // 8i:9120(回环) → 18i:9001
  TARGET
];

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] ' + msg);
}

function run() {
  log('建立反向隧道 8i:9120(回环) → 18i:9001');
  const child = spawn(SSH, ARGS, { stdio: ['ignore', 'inherit', 'inherit'] });

  child.on('error', (e) => {
    log('启动 ssh 失败: ' + e.message);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    log('ssh 退出 code=' + code + ' signal=' + signal + '，交给 PM2 重启');
    process.exit(typeof code === 'number' ? code : 1);
  });

  process.on('SIGINT', () => { child.kill(); process.exit(0); });
  process.on('SIGTERM', () => { child.kill(); process.exit(0); });
}

run();
