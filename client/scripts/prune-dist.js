#!/usr/bin/env node
/**
 * prune-dist.js — 回收 dist/assets 里上一代构建残留的 chunk
 *
 * 背景：vite.config.mjs 里 `emptyOutDir: false`（本机构建环境禁止构建前批量删目录，
 * 否则 Vite 清空 outDir 会被安全删除守卫拦截、构建中途失败并把线上产物删残），
 * 于是每次构建都把整套带哈希的新 chunk 追加进去，旧 chunk 永不回收 ——
 * 实测已堆到 11920 个文件 / 786MB（其中 index-*.js 就有 320 份）。
 *
 * 本脚本只删「确认不再被引用」的文件，且只在 dist/assets 下动手：带哈希的产物都落在这里，
 * 而根目录 index.html 与 public 拷贝（如 xgplayer/）是固定名、每次构建覆盖，不参与清理。
 *
 * 安全设计（四道，任意一道判"还在用"就保留）：
 *   1. 当前构建的 .vite/manifest.json（file / css / assets）
 *   2. dist 根目录所有 html 及其正文引用
 *   3. **不动点扫描**：对存活文件正文里的资源名做迭代解析（覆盖 `./chunk-xxx.js` 这类
 *      相对引用、html 内联脚本、css 的 url() 字体），新发现的文件继续入队扫描，
 *      直到不再有新文件 —— 保证 legacy chunk 图、字体等整条链路都不被误删
 *   4. 年龄水位：默认只删 24 小时以前的残留，兜住「用户已打开但尚未刷新的旧页面」
 *
 * 用法：
 *   node scripts/prune-dist.js                        # 清理 dist
 *   node scripts/prune-dist.js --dry                  # 只报告不删
 *   node scripts/prune-dist.js --dir dist --keep-hours 0
 */
var fs = require('fs');
var path = require('path');

var args = process.argv.slice(2);
function argValue(name, fallback) {
  var i = args.indexOf(name);
  if (i === -1) return fallback;
  var v = args[i + 1];
  return v === undefined ? fallback : v;
}
var DIR = path.resolve(__dirname, '..', argValue('--dir', 'dist'));
var DRY = args.indexOf('--dry') !== -1;
var KEEP_HOURS = parseFloat(argValue('--keep-hours', '24'));
if (isNaN(KEEP_HOURS)) KEEP_HOURS = 24;

// 资源名 token：同时覆盖 `assets/xxx-hash.js`、`./xxx-hash.js`、`url(xxx.woff2)` 三种写法
var TOKEN_RE = /[A-Za-z0-9_@\-]+\.[A-Za-z0-9]{1,6}(?![A-Za-z0-9])/g;
var SCANNABLE = /\.(js|mjs|cjs|css|html?|json)$/i;
var MAX_SCAN_BYTES = 32 * 1024 * 1024;

function norm(p) {
  return String(p).split('\\').join('/').replace(/^\.?\//, '');
}
function relOf(abs) {
  return norm(path.relative(DIR, abs));
}
function walk(dir, out) {
  var items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (var i = 0; i < items.length; i++) {
    var p = path.join(dir, items[i].name);
    if (items[i].isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

var manifestPath = path.join(DIR, '.vite', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.log('[prune] 未找到 .vite/manifest.json（vite.config 需开启 build.manifest）→ 跳过清理');
  process.exit(0);
}
var assetsDir = path.join(DIR, 'assets');
if (!fs.existsSync(assetsDir)) {
  console.log('[prune] 没有 dist/assets → 无需清理');
  process.exit(0);
}

// ---------- 1+2. 白名单起点：manifest + 根目录 html ----------
var keep = new Set();        // 相对 dist 的路径
var queue = [];              // 待扫描的绝对路径

function keepFile(relPath) {
  var r = norm(relPath);
  if (!r || r === '.' || keep.has(r)) return;
  var abs = path.join(DIR, r);
  keep.add(r);
  try {
    if (fs.statSync(abs).isFile()) queue.push(abs);
  } catch (e) {}
}

var manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.log('[prune] manifest.json 解析失败：' + e.message + ' → 跳过清理');
  process.exit(0);
}
Object.keys(manifest).forEach(function(key) {
  var e = manifest[key] || {};
  keepFile(e.file);
  (e.css || []).forEach(keepFile);
  (e.assets || []).forEach(keepFile);
});
keepFile('.vite/manifest.json');

try {
  fs.readdirSync(DIR, { withFileTypes: true })
    .filter(function(d) { return d.isFile(); })
    .forEach(function(d) { keepFile(d.name); });
} catch (e) {}

// ---------- 3. 不动点扫描：正文里出现的资源名一律视为存活 ----------
var byBasename = new Map();   // 文件名 -> 绝对路径（assets 下）
walk(assetsDir, []).forEach(function(abs) {
  byBasename.set(path.basename(abs), abs);
});

var scanned = 0;
var discovered = 0;
while (queue.length) {
  var file = queue.pop();
  if (!SCANNABLE.test(file)) continue;
  var text;
  try {
    var st = fs.statSync(file);
    if (st.size > MAX_SCAN_BYTES) continue;
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    continue;
  }
  scanned++;
  var m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    var base = m[0];
    if (keep.has(base)) continue;
    var target = byBasename.get(base);
    if (!target) continue;                 // 不是产物文件（或无此文件）
    var r = relOf(target);
    if (keep.has(r)) continue;
    keep.add(r);
    queue.push(target);
    discovered++;
  }
}

// ---------- 4. 算出待删集合 ----------
var all = walk(assetsDir, []);
var cutoff = Date.now() - KEEP_HOURS * 3600 * 1000;
var stale = [];
var keptByAge = 0;
var bytes = 0;
all.forEach(function(abs) {
  var r = relOf(abs);
  if (keep.has(r) || keep.has(path.basename(abs))) return;
  var st;
  try { st = fs.statSync(abs); } catch (e) { return; }
  if (st.mtimeMs >= cutoff) { keptByAge++; return; }
  stale.push(abs);
  bytes += st.size;
});

console.log('[prune] dist/assets 共 ' + all.length + ' 个文件');
console.log('[prune] 存活白名单 ' + keep.size + ' 项（扫描 ' + scanned + ' 个文件，其中不动点递推新增 ' + discovered + ' 项）');
console.log('[prune] 年龄水位保护(' + KEEP_HOURS + 'h) ' + keptByAge + ' 个');
console.log('[prune] 可回收 ' + stale.length + ' 个，合计 ' + (bytes / 1024 / 1024).toFixed(1) + ' MB');

if (DRY) {
  console.log('[prune] --dry：仅报告，未删除');
  process.exit(0);
}
if (!stale.length) {
  console.log('[prune] 无需回收');
  process.exit(0);
}

// ---------- 5. 删除 ----------
var removed = 0;
var failed = 0;
for (var i = 0; i < stale.length; i++) {
  try {
    fs.unlinkSync(stale[i]);
    removed++;
  } catch (e) {
    failed++;
  }
}
console.log('[prune] 已回收 ' + removed + ' 个' + (failed ? '，失败 ' + failed + ' 个' : ''));
