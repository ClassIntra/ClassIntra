#!/usr/bin/env node
/**
 * 存量治理：把「已转存 bot 视频」的 shared 物理副本换成硬链接，回收历史双副本。
 *
 * 背景：转存策略改造（bot 转运硬链接）上线前，bot 下载的视频
 * （Resources/cloud/botmedia/remote/dv*.mp4 等）转存进云盘时是 copyFileSync
 * 复制进 Resources/cloud/shared/<hash>，同一视频在磁盘上有两个物理副本；
 * botmedia 那份又因 downloader._prune_old_videos 的保护逻辑
 * （sha256 在 cloud_files 即跳过清理）永驻不删。本脚本一次性回收这些双副本。
 *
 * 安全设计：
 *   - DB 只读打开（node:sqlite readOnly），不改任何数据库行、不碰 cloud_user_files
 *   - 只替换 shared/ 下的物理实体，且「先建链、后原子改名」——崩溃窗口内
 *     shared 文件始终存在（最坏情况是旧 inode 没被回收，重跑即可）
 *   - 身份认定三重校验：原文件名在 botmedia 存在 + 体积一致 + sha256(botmedia 文件)
 *     等于 cloud_files.hash，杜绝误伤同名文件
 *   - 已是硬链接（同 inode）的自动跳过，脚本可重复执行
 *
 * 用法：
 *   node scripts/cloud-bot-relink.mjs                  # dry-run：只出报告，不动盘
 *   node scripts/cloud-bot-relink.mjs --apply          # 实跑
 *   node scripts/cloud-bot-relink.mjs --apply --limit 100   # 限量实跑（配合人工抽查）
 *
 * 依赖：Node >= 23.4（node:sqlite 免实验旗标；22.5+ 需 --experimental-sqlite）。
 */
import { createReadStream, statSync, existsSync, linkSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ---------- 参数 ----------
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx > -1 ? Math.max(1, parseInt(args[limitIdx + 1], 10) || 1) : Infinity;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RESOURCES = process.env.RESOURCES_DIR || join(ROOT, 'Resources');
const BOTMEDIA = join(RESOURCES, 'cloud', 'botmedia', 'remote');
const SHARED = join(RESOURCES, 'cloud', 'shared');
const DB_PATH = process.env.DB_PATH || join(ROOT, 'server', 'database', 'classintra.db');

// storage_path 形态校验：防目录穿越，只认 "<2位hex>/<64位hex><ext>"
const STORAGE_PATH_RE = /^[a-f0-9]{2}\/[a-f0-9]{64}\.\w{1,8}$/;

function fmt(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB';
  return (bytes / 1024 ** 2).toFixed(1) + ' MB';
}

function sha256File(filePath) {
  return new Promise((res, rej) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('error', rej);
    stream.on('end', () => res(hash.digest('hex')));
  });
}

// ---------- 主流程 ----------
async function main() {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch (e) {
    console.error('本脚本需要 node:sqlite（Node >= 23.4，或 22.5+ 加 --experimental-sqlite）。');
    process.exit(1);
  }

  if (!existsSync(DB_PATH)) {
    console.error('找不到数据库：' + DB_PATH);
    process.exit(1);
  }
  if (!existsSync(BOTMEDIA)) {
    console.error('找不到 botmedia 目录：' + BOTMEDIA);
    process.exit(1);
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  // deleted=0 的全部云盘文件；original_name 对 bot 转存文件就是 dv*/mu* 文件名
  const rows = db.prepare(
    'SELECT hash, original_name, size, storage_path, IFNULL(source, \'\') AS source FROM cloud_files WHERE deleted = 0'
  ).all();
  db.close();

  // botmedia 文件索引：文件名 → { path, size }
  const botFiles = new Map();
  for (const name of readdirSync(BOTMEDIA)) {
    const full = join(BOTMEDIA, name);
    try {
      const st = statSync(full);
      if (st.isFile()) botFiles.set(name, { path: full, size: st.size });
    } catch (e) { /* 文件在读目录时被删，跳过 */ }
  }

  console.log('cloud_files(deleted=0): ' + rows.length + ' 行；botmedia/remote: ' + botFiles.size + ' 个文件');
  console.log(APPLY ? '模式：实跑（--apply' + (LIMIT !== Infinity ? '，限量 ' + LIMIT : '') + '）' : '模式：dry-run（只看不动，加 --apply 实跑）');
  console.log('');

  const candidates = [];   // 待换硬链接
  const alreadyLinked = []; // 已是硬链接
  const missing = [];       // shared 实体丢失（换链即修复）
  const badPath = [];       // storage_path 形态异常（跳过）
  let skipped = 0;

  for (const row of rows) {
    if (!STORAGE_PATH_RE.test(String(row.storage_path || ''))) { badPath.push(row); continue; }
    const name = String(row.original_name || '');
    const bot = botFiles.get(name);
    if (!bot || bot.size !== row.size) { skipped++; continue; }
    const sharedPath = join(SHARED, row.storage_path);
    const sharedExists = existsSync(sharedPath);
    if (sharedExists) {
      let sameIno = false;
      try {
        sameIno = statSync(sharedPath).ino === statSync(bot.path).ino;
      } catch (e) { /* stat 失败按不同 ino 处理，走哈希复核 */ }
      if (sameIno) { alreadyLinked.push({ row, sharedPath }); continue; }
    }
    candidates.push({ row, bot, sharedPath, sharedExists });
    if (!sharedExists) missing.push({ row, sharedPath });
  }

  // 三重校验的最后一重：哈希复核（只对候选做，逐个流式计算）
  const verified = [];
  const hashMismatch = [];
  for (const c of candidates) {
    let digest;
    try {
      digest = await sha256File(c.bot.path);
    } catch (e) {
      hashMismatch.push({ row: c.row, reason: '读取失败: ' + e.message });
      continue;
    }
    if (digest === c.row.hash) verified.push(c);
    else hashMismatch.push({ row: c.row, reason: 'sha256 不一致' });
  }

  const reclaimBytes = verified.reduce((s, c) => s + (c.row.size || 0), 0);
  const restoreBytes = missing.reduce((s, m) => s + (m.row.size || 0), 0);

  console.log('—— 普查结果 ——');
  console.log('  已是硬链接（跳过）      : ' + alreadyLinked.length);
  console.log('  待换硬链接（可回收）    : ' + verified.length + ' 个，合计 ' + fmt(reclaimBytes));
  if (missing.length) {
    console.log('    其中 shared 实体丢失   : ' + missing.length + ' 个（换链即修复，合计 ' + fmt(restoreBytes) + '）');
  }
  console.log('  哈希不符/读取失败（跳过）: ' + hashMismatch.length);
  console.log('  storage_path 异常（跳过）: ' + badPath.length);
  console.log('  非 botmedia 产物（跳过） : ' + skipped);

  if (hashMismatch.length) {
    console.log('');
    console.log('  哈希不符明细（前 10）：');
    hashMismatch.slice(0, 10).forEach((m) => {
      console.log('    ' + m.row.original_name + ' — ' + m.reason);
    });
  }

  if (!APPLY) {
    console.log('');
    console.log('dry-run 结束，未动盘。确认后加 --apply 实跑（可先 --apply --limit 20 抽查）。');
    return;
  }

  // ---------- 实跑 ----------
  const todo = LIMIT === Infinity ? verified : verified.slice(0, LIMIT);
  let done = 0;
  const failed = [];
  for (const c of todo) {
    const tmp = c.sharedPath + '.relink-tmp';
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
      linkSync(c.bot.path, tmp);      // 先建链（shared 旧实体仍在，崩溃无损失）
      renameSync(tmp, c.sharedPath);  // 原子替换：旧 inode 在此刻释放
      done++;
      if (done % 50 === 0 || done === todo.length) {
        console.log('  进度 ' + done + '/' + todo.length);
      }
    } catch (e) {
      failed.push({ name: c.row.original_name, reason: e.code || e.message });
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch (e2) { /* 忽略 */ }
    }
  }

  console.log('');
  console.log('—— 实跑结果 ——');
  console.log('  成功换链: ' + done + ' 个，回收 ' + fmt(todo.reduce((s, c) => s + (c.row.size || 0), 0) - failed.reduce((s, f) => s + (f.size || 0), 0)));
  if (failed.length) {
    console.log('  失败: ' + failed.length + ' 个（明细前 10，可重跑）：');
    failed.slice(0, 10).forEach((f) => console.log('    ' + f.name + ' — ' + f.reason));
  }
  const remain = verified.length - done;
  if (remain > 0) console.log('  剩余未处理: ' + remain + ' 个（重跑本脚本继续，已完成的会自动跳过）');
}

main().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});
