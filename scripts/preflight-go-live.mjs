#!/usr/bin/env node
// 学元 v2 上线预检 · 只读于生产，任何失败都给 NO-GO
// ============================================================
// 用法：node scripts/preflight-go-live.mjs [--quick]
//   --quick  跳过全量 test:ledger（只跑三个关键脚本）
//
// 本脚本**不重启服务、不 build、不写 client/dist、不改生产库**。
// 它只回答一个问题：现在按 docs/system-excellence.md §5 上线，安全吗？
// 真正的部署动作留在人手里 —— 动 PM2 进程需要有人在场。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const quick = process.argv.includes('--quick');
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + detail : ''));
}
function run(rel, args, cwd) {
  const r = spawnSync(NODE, [rel].concat(args || []), {
    cwd: cwd || ROOT,
    encoding: 'utf8',
    timeout: 180000
  });
  return { code: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function tail(s, n) {
  return String(s || '').trim().split('\n').slice(-n).join(' | ');
}

console.log('\n=== 学元 v2 上线预检（只读） ===\n');

// 1. 内核与全维度门禁
let r = run('scripts/ci-check.mjs');
record('ci-check 六项门禁', r.code === 0, tail(r.out, 1));
r = run('scripts/system-audit.mjs');
record('system-audit 无硬性缺口', r.code === 0, tail(r.out, 2));

// 2. 回归：默认全量 22 脚本，--quick 只跑三个关键
const key = [
  'scripts-test-ledger-hardening.cjs',
  'scripts-test-treasury-guard.cjs',
  'scripts-test-wallet-contract.cjs'
];
const all = [
  'scripts-test-ledger-s1.cjs', 'scripts-test-ledger-s2.cjs', 'scripts-test-ledger-guard.cjs',
  'scripts-test-ledger-routes.cjs', 'scripts-test-ledger-shop.cjs', 'scripts-test-ledger-trading.cjs',
  'scripts-test-ledger-invest.cjs', 'scripts-test-stock-ledger.cjs', 'scripts-test-ledger-appapi.cjs',
  'scripts-test-wallet-contract.cjs', 'scripts-test-wallet.cjs', 'scripts-test-xueyuan.cjs',
  'scripts-test-xueyuan-limits.cjs', 'scripts-test-collect.cjs', 'scripts-test-xy-mesh.cjs',
  'scripts-test-ledger-loan.cjs', 'scripts-test-loan-integrity.cjs', 'scripts-test-loan-v2.cjs',
  'scripts-test-loan-v22.cjs', 'scripts-test-trading-sweep.cjs',
  'scripts-test-ledger-hardening.cjs', 'scripts-test-treasury-guard.cjs'
];
const scripts = quick ? key : all;
let failed = [];
let assertions = 0;
for (const f of scripts) {
  const one = run('server/' + f, [], ROOT);
  const m = one.out.match(/通过 (\d+)/g);
  if (m) assertions += Number(m[m.length - 1].match(/\d+/)[0]);
  if (one.code !== 0) failed.push(f);
}
record('回归 ' + scripts.length + ' 脚本 / ' + assertions + ' 项断言',
  failed.length === 0, failed.length ? failed.join(', ') : (quick ? 'quick 模式' : '全量'));

// 3. 生产库快照 + 迁移副本验证（副本放系统临时目录，跑完即删）
const backup = path.join(ROOT, 'backup/classintra-pre-ledger-v2-20261111.db');
record('生产库备份快照存在', fs.existsSync(backup),
  fs.existsSync(backup) ? (fs.statSync(backup).size / 1024 / 1024).toFixed(1) + ' MB' : '缺失');
let copy = '';
try {
  copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-preflight-')), 'verify.db');
  // ⚠️ 不能直接 copyFileSync 生产 .db：WAL 模式下最近交易可能还在 -wal 里，
  // 拿到的是不一致快照。VACUUM INTO 由 SQLite 自己生成原子一致副本。
  const Database = createRequire(path.join(ROOT, 'server/package.json'))('better-sqlite3');
  const src = new Database(path.join(ROOT, 'server/database/classintra.db'), { readonly: true });
  src.prepare('VACUUM INTO ?').run(copy);
  src.close();
  r = run('server/scripts/ledger-verify-migration-046.cjs', ['--db', copy], ROOT);
  record('迁移 046 在最新生产快照上预演', r.code === 0, tail(r.out, 3));
} catch (e) {
  record('迁移 046 在最新生产快照上预演', false, e.message);
} finally {
  try { if (copy) fs.rmSync(path.dirname(copy), { recursive: true, force: true }); } catch (e) {}
}

// 4. 当前服务状态
function probe(port, urlPath) {
  return new Promise(function (resolve) {
    const req = http.request({ host: '127.0.0.1', port: port, path: urlPath, method: 'GET', timeout: 3000 }, function (res) {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', function () { req.destroy(); resolve(0); });
    req.on('error', function () { resolve(0); });
    req.end();
  });
}
const home = await probe(9001, '/');
record('18i 首页 9001 可用', home === 200, 'HTTP ' + home);

// 5. 关键文件齐备
const needed = [
  'server/src/middleware/treasury.js',
  'server/src/migrations/046_ledger_hardening_v2.js',
  'server/src/ledger/overview.js',
  'apps/admin/frontend/XueyuanOverview.vue',
  'docs/system-excellence.md'
];
const missing = needed.filter(function (f) { return !fs.existsSync(path.join(ROOT, f)); });
record('上线关键文件齐备', missing.length === 0, missing.length ? missing.join(', ') : needed.length + ' 个');

// 汇总：先看迁移是否已落地，避免对着一个已经上线的系统继续喊「请上线」
let alreadyLive = false;
try {
  const Database = createRequire(path.join(ROOT, 'server/package.json'))('better-sqlite3');
  const live = new Database(path.join(ROOT, 'server/database/classintra.db'), { readonly: true });
  alreadyLive = Number(live.prepare('SELECT MAX(version) AS v FROM schema_version').get().v) >= 46;
  live.close();
} catch (e) {}

const bad = results.filter(function (x) { return !x.ok; });
console.log('\n' + (bad.length
  ? '结论: NO-GO — ' + bad.length + ' 项未过，先修再上线'
  : (alreadyLive
      ? '结论: GO — 预检全过；迁移 046 已在生产执行，前后端已对齐，无需再部署'
      : '结论: GO — 可以按 docs/system-excellence.md §5 执行上线')));
if (!bad.length) {
  if (alreadyLive) {
    console.log('\n后续只改前端时：node scripts/build-app.js wallet && node scripts/sync-dist-8i.mjs');
    console.log('（静态产物直读，无需重启 PM2；改后端才需要按 ops.md 定点重建）\n');
  } else {
    console.log('\n上线顺序（先后端、后前端；反过来会让新前端撞旧后端 404）：');
    console.log('  1) 双端按 ops.md 定点重建 PM2（18i: classintra-server + classintra-https）→ 迁移 046 随之执行');
    console.log('  2) 验证 GET /api/xy/admin/overview 返回 status=ok；schema_version 应到 46');
    console.log('  3) node scripts/build-app.js wallet && node scripts/sync-dist-8i.mjs');
    console.log('  4) 两端首页 200、index.html md5 对齐、I1–I13 全绿\n');
  }
}
process.exit(bad.length ? 1 : 0);
