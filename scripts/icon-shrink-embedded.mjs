// icon-shrink-embedded.mjs — 降采样「内嵌 base64 位图的 SVG」图标。
//
// 为什么需要它：
//   Resources/public/icons 下有一批 legacy 图标，形态是把一张 768~1024px 的位图
//   base64 塞进 SVG 壳里（<image href="data:image/png;base64,...">）。单文件 200KB~940KB，
//   而桌面上只显示几十像素。它们还会挡住 scripts/icon-trim.ps1 —— 那个脚本的 Notes 明确写着
//   「over 480KB 的文件会被跳过；System.Drawing 重编码反而会让这类内嵌位图 SVG 变大，
//     legacy oversized assets must be downscaled first, not re-encoded here」。
//   本脚本就是那句「downscaled first」：把位图降到 512px 再交给 icon-trim 做满铺。
//
// 安全性：
//   - 只替换 base64 数据段，**不改动 <image> / <svg> 的 width/height 属性**
//     → 渲染尺寸与视觉完全不变（浏览器把缩小的位图放大到声明尺寸显示）
//   - 仍是内嵌 PNG（不是 WebP），与 icon-trim.ps1 的处理链保持兼容
//   - 重编码后若反而更大，则放弃该文件（不会做负优化）
//
// 用法：
//   node scripts/icon-shrink-embedded.mjs                 # 处理 Resources/public/icons
//   node scripts/icon-shrink-embedded.mjs --dir <path>    # 处理其它目录
//   node scripts/icon-shrink-embedded.mjs --size 384      # 指定边长（默认 512）
//   node scripts/icon-shrink-embedded.mjs --min-kb 100    # 只处理大于该体积的文件（默认 100）
//   node scripts/icon-shrink-embedded.mjs --dry           # 只报告不落盘
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';

const REPO = resolve(import.meta.dirname, '..');
const require = createRequire(join(REPO, 'server', 'node_modules', ''));
const sharp = require('sharp');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith('--')) ? v : true;
}

const DIR = String(arg('dir', join(REPO, 'Resources', 'public', 'icons')));
const SIZE = parseInt(arg('size', '512'), 10);
const MIN_BYTES = parseFloat(arg('min-kb', '100')) * 1024;
const DRY = process.argv.includes('--dry');
// 幂等标记：跑过的文件打上，重复运行不再动它。
// （体积门槛只能挡住「压完就变小」的常规情况；若某张图压完仍偏大，没有标记就会被反复
//   palette 重编码，质量逐次劣化。）
const MARK = '<!-- ci-icon-shrunk:';

let files;
try {
  files = readdirSync(DIR).filter(f => /\.svg$/i.test(f)).sort();
} catch (e) {
  console.error('✗ 目录不可读：' + DIR);
  process.exit(1);
}

let totalBefore = 0, totalAfter = 0, changed = 0, skipped = 0;

for (const name of files) {
  const file = join(DIR, name);
  const bytes = statSync(file).size;
  if (bytes < MIN_BYTES) { skipped++; continue; }

  const src = readFileSync(file, 'utf8');
  if (src.indexOf(MARK) !== -1) { skipped++; continue; }
  const m = src.match(/base64,([A-Za-z0-9+/=]+)/);
  if (!m) { console.log('  跳过（无内嵌位图） ' + name); skipped++; continue; }

  const raw = Buffer.from(m[1], 'base64');
  let meta;
  try { meta = await sharp(raw).metadata(); }
  catch (e) { console.log('  跳过（位图不可解析） ' + name + '：' + e.message); skipped++; continue; }

  // 只按体积门槛筛选（前面已过滤 <MIN_BYTES）。即便位图边长已经 <=SIZE，
  // 也可能只是编码差（同样 512px 却有 300KB）——重编码有收益就应当处理。
  const out = await sharp(raw)
    .resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
    .toBuffer();

  if (out.length >= raw.length) {
    console.log('  ' + pad(name, 18) + '重编码无收益（' + kb(raw.length) + ' -> ' + kb(out.length) + '），保持原样');
    skipped++; continue;
  }

  let next = src.replace(m[1], out.toString('base64'));
  // 打幂等标记（插在 <svg ...> 开标签之后）
  next = next.replace(/(<svg\b[^>]*>)/, '$1' + MARK + SIZE + ' -->');
  if ((src.match(/base64,/g) || []).length !== (next.match(/base64,/g) || []).length) {
    throw new Error('base64 段数量变化，中止（避免破坏 SVG）：' + file);
  }
  if (next.indexOf(MARK) === -1) {
    throw new Error('未能插入幂等标记，中止：' + file);
  }

  const after = Buffer.byteLength(next, 'utf8');
  totalBefore += bytes; totalAfter += after; changed++;
  console.log('  ✔ ' + pad(name, 18) +
    pad(meta.width + 'x' + meta.height, 11) + ' -> ' + pad(SIZE + 'x' + SIZE, 11) +
    pad(kb(bytes), 10) + ' -> ' + pad(kb(after), 10) +
    '(位图 ' + kb(raw.length) + ' -> ' + kb(out.length) + ')');

  if (!DRY) writeFileSync(file, next, 'utf8');
}

function kb(n) { return Math.round(n / 1024) + 'KB'; }
function pad(s, n) { return String(s).padEnd(n); }

console.log('\n处理 ' + changed + ' 个文件，跳过 ' + skipped + ' 个' + (DRY ? '（--dry 未落盘）' : ''));
if (changed) {
  console.log('体积合计 ' + kb(totalBefore) + ' -> ' + kb(totalAfter) +
    '（省 ' + kb(totalBefore - totalAfter) + '，-' + Math.round((1 - totalAfter / totalBefore) * 100) + '%）');
}
