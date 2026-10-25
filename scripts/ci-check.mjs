#!/usr/bin/env node
/*
 * 内核体检（CI 入口）
 * ============================================================
 * 这个仓库的问题从来不是「设计不够」，而是「设计密度远高于验证密度」：
 * 大量规则写在注释里（「两份入口必须同步」「迁移撞号会被静默跳过」
 * 「shared 与 server 的错误码必须一致」），但没有任何一次提交能自动证明它们没被破坏。
 *
 * 本脚本把其中最贵的 5 类「只能靠人肉发现」的问题变成一次可执行检查：
 *
 *   1. 服务端语法   —— 85 个 .js 逐个 node --check（拦 ES 语法误用/半截编辑）
 *   2. 迁移契约     —— version(number) + up(fn) + **版本号撞号**（撞号会被 runner 静默跳过）
 *   3. manifest 契约 —— apps/* 全部过 validateManifest（拦字段拼错被静默降级）
 *   4. 共享契约同步 —— shared 与 server 的 ERROR_CODES 键集合必须一致
 *   5. 前端内核冒烟 —— 调 scripts/kernel-smoke.mjs（BootOrchestrator / 生命周期 / 资源回收）
 *
 * 设计原则：只依赖 Node 内置模块，不装任何依赖，不做网络/数据库访问。
 * 目标：GitHub Actions 上 60 秒内跑完（私有仓 Actions 额度很贵）。
 *
 * 用法：node scripts/ci-check.mjs
 * 退出码：0 = 全绿；1 = 有 FAIL
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireCJS = createRequire(import.meta.url);

let pass = 0;
const failures = [];

function ok(label, detail) {
  pass++;
  console.log('PASS ' + label + (detail ? ' — ' + detail : ''));
}
function bad(label, detail) {
  failures.push(label + (detail ? ' — ' + detail : ''));
  console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
}
function warn(label, detail) {
  console.log('WARN ' + label + (detail ? ' — ' + detail : ''));
}
function rel(p) {
  return relative(ROOT, p).split(sep).join('/');
}

function walk(dir, out) {
  out = out || [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.charAt(0) === '.') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ============================================================
// 1. 服务端语法
// ============================================================
(function checkSyntax() {
  const files = walk(join(ROOT, 'server/src')).filter(function (f) { return f.endsWith('.js'); });
  const broken = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) {
      const first = String(r.stderr || '').split('\n').filter(Boolean).slice(0, 2).join(' ');
      broken.push(rel(f) + ' :: ' + first);
    }
  }
  if (broken.length) bad('服务端语法（' + files.length + ' 文件）', broken.slice(0, 3).join(' | '));
  else ok('服务端语法（' + files.length + ' 文件）');
})();

// ============================================================
// 2. 迁移契约（含撞号检测）
// ============================================================
(function checkMigrations() {
  const dir = join(ROOT, 'server/src/migrations');
  if (!existsSync(dir)) { warn('迁移契约', '目录不存在，跳过'); return; }
  const files = readdirSync(dir).filter(function (f) { return f.endsWith('.js'); }).sort();
  const byVersion = new Map();
  const problems = [];
  let maxVersion = -1;

  for (const f of files) {
    let mod;
    try {
      mod = requireCJS(join(dir, f));
    } catch (e) {
      problems.push(f + ' 加载失败: ' + e.message);
      continue;
    }
    if (typeof mod.version !== 'number') problems.push(f + ' 缺 version(number)');
    if (typeof mod.up !== 'function') problems.push(f + ' 缺 up(db)');
    if (typeof mod.version !== 'number') continue;

    // 撞号是这里最值钱的一条：runner 按 version > current 过滤，撞号的后一个会被静默跳过，
    // 表现为「迁移写了但库没变」，而且日志里毫无异常。
    if (byVersion.has(mod.version)) {
      problems.push('版本号 ' + mod.version + ' 撞号: ' + byVersion.get(mod.version) + ' ↔ ' + f);
    } else {
      byVersion.set(mod.version, f);
    }
    if (mod.version > maxVersion) maxVersion = mod.version;
  }

  // 文件名前缀与 version 是否一致（001_xxx.js 里写 version: 2 这种错位）
  for (const f of files) {
    const m = /^(\d+)_/.exec(f);
    if (!m) continue;
    const fileVer = parseInt(m[1], 10);
    const mod = byVersion.get(fileVer);
    if (mod && f !== mod && byVersion.has(fileVer)) {
      // 仅在「该文件自己的 version 与文件名不一致」时报
    }
  }
  for (const f of files) {
    const m = /^(\d+)_/.exec(f);
    if (!m) continue;
    let mod;
    try { mod = requireCJS(join(dir, f)); } catch (e) { continue; }
    if (typeof mod.version === 'number' && mod.version !== parseInt(m[1], 10)) {
      problems.push(f + ' 文件名序号 ' + m[1] + ' ≠ version ' + mod.version);
    }
  }

  if (problems.length) bad('迁移契约（' + files.length + ' 个）', problems.slice(0, 3).join(' | '));
  else ok('迁移契约（' + files.length + ' 个，最高 v' + maxVersion + '，无撞号）');
})();

// ============================================================
// 3. manifest 契约
// ============================================================
(function checkManifests() {
  let validateManifest;
  try {
    validateManifest = requireCJS(join(ROOT, 'server/src/core/manifest-schema.js')).validateManifest;
  } catch (e) {
    bad('manifest 契约', '校验器加载失败: ' + e.message);
    return;
  }

  const dirs = [join(ROOT, 'apps'), join(ROOT, 'market-apps')];
  const problems = [];
  const warns = [];
  let checked = 0;

  for (const base of dirs) {
    if (!existsSync(base)) continue;
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === 'node_modules') continue;
      const mf = join(base, e.name, 'manifest.json');
      if (!existsSync(mf)) continue;
      checked++;
      let raw;
      try {
        raw = JSON.parse(readFileSync(mf, 'utf8'));
      } catch (err) {
        problems.push(rel(mf) + ' JSON 解析失败: ' + err.message);
        continue;
      }
      const r = validateManifest(raw);
      if (!r.valid) problems.push(rel(mf) + ' :: ' + r.errors.join('; '));
      else if (r.warnings && r.warnings.length) warns.push(rel(mf) + ' :: ' + r.warnings.join('; '));
    }
  }

  if (problems.length) bad('manifest 契约（' + checked + ' 个）', problems.slice(0, 3).join(' | '));
  else ok('manifest 契约（' + checked + ' 个）');
  if (warns.length) warn('manifest 警告（不阻断）', warns.slice(0, 3).join(' | '));
})();

// ============================================================
// 4. shared ↔ server 共享契约同步
//    注释里反复写「修改此文件时请同步 shared/src/xxx」，但从来没有机器校验过。
//
//    不变量是**单向**的：server 声明的每一个错误码，前端都必须能识别 ——
//    否则前端拿到 CODE 只能落进「未知错误」分支，用户看到的就是一句无信息的话。
//    反向不成立：集成协议里有一批「客户端侧专用」错误码（INTEGRATION_*），
//    server 永远不会产出它们，要求双侧等长只会逼人往 server 里塞死代码。
// ============================================================
(function checkSharedParity() {
  function errorCodeKeys(file) {
    if (!existsSync(file)) return null;
    const src = readFileSync(file, 'utf8');
    const start = src.indexOf('var ERROR_CODES');
    if (start < 0) return null;
    const end = src.indexOf('};', start);
    if (end < 0) return null;
    const body = src.slice(start, end);
    const keys = new Set();
    const re = /(?:^|\n)\s*([A-Z][A-Z0-9_]*)\s*:/g;
    let m;
    while ((m = re.exec(body))) keys.add(m[1]);
    return keys;
  }

  const sharedKeys = errorCodeKeys(join(ROOT, 'shared/src/constants.js'));
  const serverKeys = errorCodeKeys(join(ROOT, 'server/src/core/errors.js'));
  if (!sharedKeys || !serverKeys) { warn('共享契约同步', '未找到 ERROR_CODES 字面量，跳过'); return; }

  // 阻断项：server 会产出、但前端不认识
  const missingInShared = [...serverKeys].filter(function (k) { return !sharedKeys.has(k); });
  // 允许项：客户端侧专用（不阻断，仅提示数量，便于发现误删）
  const clientOnly = [...sharedKeys].filter(function (k) { return !serverKeys.has(k); });

  if (missingInShared.length) {
    bad(
      '共享契约同步（server ' + serverKeys.size + ' / shared ' + sharedKeys.size + '）',
      'server 产出但前端不认识: ' + missingInShared.join(',')
    );
  } else {
    ok(
      '共享契约同步（server ' + serverKeys.size + ' 键 ⊆ shared ' + sharedKeys.size +
      (clientOnly.length ? '，含 ' + clientOnly.length + ' 个客户端专用' : '') + '）'
    );
  }
})();

// ============================================================
// 5. 前端内核冒烟
// ============================================================
(function checkKernelSmoke() {
  const script = join(ROOT, 'scripts/kernel-smoke.mjs');
  if (!existsSync(script)) { warn('前端内核冒烟', '脚本不存在，跳过'); return; }
  const r = spawnSync(
    process.execPath,
    ['--import', './scripts/alias-loader.mjs', 'scripts/kernel-smoke.mjs'],
    { cwd: ROOT, encoding: 'utf8' }
  );
  const out = String(r.stdout || '') + String(r.stderr || '');
  const cases = (out.match(/^PASS /gm) || []).length;
  const skipped = (out.match(/^SKIP /gm) || []).length;
  if (r.status !== 0 || out.indexOf('全部通过') === -1) {
    const tail = out.split('\n').filter(Boolean).slice(-4).join(' | ');
    bad('前端内核冒烟', tail);
  } else {
    ok('前端内核冒烟', cases + ' 通过' + (skipped ? ' / ' + skipped + ' 跳过' : ''));
  }
})();

// ============================================================
// 汇总
// ============================================================
console.log('');
if (failures.length) {
  console.log('体检未通过：' + pass + ' 项通过，' + failures.length + ' 项失败');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('体检通过：' + pass + ' 项全绿 ✔');
process.exit(0);
