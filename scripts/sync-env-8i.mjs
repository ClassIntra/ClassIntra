#!/usr/bin/env node
/**
 * 把本机 server/.env 的「通用配置」合并到 8i，保留 8i 的机器身份值。
 *
 * 背景：.stignore 排除了 server/.env（合理，因为里面混着机器身份），
 * 但这样一来 8i 永远收不到通用配置的更新 —— 2026-10-04 实测漂移 11 天、
 * 缺 13 个键（AstrBot 集成块）。本脚本补上这个缺口。
 *
 * 安全设计：合并运算在 8i 上就地完成，8i 的敏感值不离开 8i；
 * 本机只上传基线、只回收键级 diff（键名 + 长度，不含值）。
 *
 * 用法：
 *   node scripts/sync-env-8i.mjs            # 合并 + 覆盖 + 重启（默认）
 *   node scripts/sync-env-8i.mjs --dry      # 只试算，写 .env.merged 不覆盖
 *   node scripts/sync-env-8i.mjs --no-restart
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST = 'cideploy@100.115.93.90';
const REMOTE_ROOT = 'D:/NetWork/ClassIntra';
const REMOTE_TMP = 'C:/Users/cideploy';
const LOCAL_ENV = 'server/.env';
const SSH = ['-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=20'];

/** 机器身份键：8i 的值必须赢过基线。改这里等于改同步语义。 */
const KEEP_LOCAL = [
  'SYNCTHING_API_KEY',
  'SYNCTHING_HOST',
  'SYNCTHING_PORT',
  'ADMIN_USER_IDS',      // 18班 2518xx vs 8班 2508xx
  'RELAY_SERVER_ID',     // 18i vs 8i
  'RELAY_SERVERS',       // 互指对方
  'TAILSCALE_RELAY_IP',  // 互指对方
  'WS_PORT',
  'AI_API_KEY',
  'AI_API_URL',
  'AI_MODEL',
  'AB_ONEBOT_DISABLED',  // 8i 特有
  'AB_ALLOWED_USERS',    // 8i 特有
];

const MERGER = `
import { readFileSync, writeFileSync } from 'node:fs';
const [oldPath, newPath, outPath] = process.argv.slice(2);
const KEEP_LOCAL = ${JSON.stringify(KEEP_LOCAL)};
const parse = (p) => {
  const m = new Map();
  for (const l of readFileSync(p, 'utf8').split(/\\r?\\n/)) {
    const s = l.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    m.set(s.slice(0, i).trim(), s.slice(i + 1).trim());
  }
  return m;
};
const oldMap = parse(oldPath);
const raw = readFileSync(newPath, 'utf8');
const eol = /\\r\\n/.test(raw) ? '\\r\\n' : '\\n';
const changed = [], added = [], kept = [];
const out = [];
const seen = new Set();
for (const line of raw.split(/\\r?\\n/)) {
  const s = line.trim();
  const i = s.indexOf('=');
  if (!s || s.startsWith('#') || i < 0) { out.push(line); continue; }
  const k = s.slice(0, i).trim();
  let v = s.slice(i + 1).trim();
  seen.add(k);
  if (KEEP_LOCAL.includes(k) && oldMap.has(k) && oldMap.get(k) !== '') {
    const ov = oldMap.get(k);
    kept.push(k + (ov === v ? '  (identical)' : '  (keep local ' + ov.length + 'ch over baseline ' + v.length + 'ch)'));
    v = ov;
  } else if (!oldMap.has(k)) {
    added.push(k + '  (' + v.length + 'ch)');
  } else if (oldMap.get(k) !== v) {
    changed.push(k + '  (' + oldMap.get(k).length + 'ch -> ' + v.length + 'ch)');
  }
  out.push(k + '=' + v);
}
const extra = [];
for (const [k, v] of oldMap) if (!seen.has(k)) { extra.push(k + '=' + v); added.push(k + '  [local-only, preserved]'); }
if (extra.length) { out.push('', '# --- machine-local keys not present in baseline ---', ...extra); }
writeFileSync(outPath, out.join(eol) + eol);
console.log('KEPT:'); kept.forEach((x) => console.log('  ' + x));
console.log('CHANGED:'); changed.length ? changed.forEach((x) => console.log('  ' + x)) : console.log('  (none)');
console.log('ADDED:'); added.forEach((x) => console.log('  ' + x));
console.log('keys old=' + oldMap.size + ' merged=' + (seen.size + extra.length));
`;

const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const ssh = (remote) => {
  const out = execFileSync('ssh', [...SSH, HOST, remote], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out;
};

const dry = process.argv.includes('--dry');
const doRestart = !process.argv.includes('--no-restart') && !dry;

const baseName = '.ci-env-base-' + Date.now();
const localBase = join(tmpdir(), baseName);
const localMerger = join(tmpdir(), '.ci-env-merge-' + Date.now() + '.mjs');
writeFileSync(localBase, readFileSync(LOCAL_ENV));
writeFileSync(localMerger, MERGER);

try {
  console.log('[1/4] uploading baseline + merger to 8i ...');
  run('scp', [...SSH, localBase, `${HOST}:${REMOTE_TMP}/${baseName}`]);
  run('scp', [...SSH, localMerger, `${HOST}:${REMOTE_TMP}/_ci-env-merge.mjs`]);

  console.log('[2/4] merging on 8i (machine secrets stay on 8i) ...');
  const merged = `${REMOTE_ROOT}/server/.env.merged`;
  const diff = ssh(
    `"C:\\Program Files\\nodejs\\node.exe" ${REMOTE_TMP}/_ci-env-merge.mjs ` +
      `${REMOTE_ROOT}/server/.env ${REMOTE_TMP}/${baseName} ${merged}`
  );
  console.log(diff.trim());

  if (dry) {
    console.log('\n--dry: merged file left at 8i:' + merged + ' (not applied)');
  } else {
    console.log('[3/4] backup + apply ...');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    ssh(`copy /y ${REMOTE_ROOT}\\server\\.env ${REMOTE_ROOT}\\server\\.env.bak-${stamp} && copy /y ${merged} ${REMOTE_ROOT}\\server\\.env && del /q ${merged}`);
    console.log('applied. old env backed up as .env.bak-' + stamp);

    if (doRestart) {
      console.log('[4/4] restarting classintra-server on 8i ...');
      try {
        ssh(
          'set PATH=C:\\Users\\iflytek\\AppData\\Roaming\\npm;C:\\Program Files\\nodejs;%PATH% && pm2 restart classintra-server'
        );
        console.log('restarted.');
      } catch (e) {
        console.log('restart failed (check iflytek pm2 daemon alive): ' + (e.stderr || e.message));
      }
    }
  }
} finally {
  try { unlinkSync(localBase); } catch {}
  try { unlinkSync(localMerger); } catch {}
  try {
    ssh(`del /q ${REMOTE_TMP}\\${baseName} ${REMOTE_TMP}\\_ci-env-merge.mjs`);
  } catch {}
}
