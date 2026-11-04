// 图标瘦身：为 DPR<=2 设备生成 120px 变体（60 CSS px × 2）
// 原图 180×180（3x）保留给高 DPR 设备。视觉在 DPR2 上逐像素等价。
// 用法：node scripts/build-icon-thumbs.mjs
import sharp from 'sharp';
import { readdir, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = 'D:/NetWork/Integration/ClassIntra/Resources/public/icons';
const OUT = join(DIR, '120');
const TARGET = 120;

await mkdir(OUT, { recursive: true });
const files = (await readdir(DIR)).filter(f => /\.png$/i.test(f));
let totalBefore = 0, totalAfter = 0;
for (const f of files) {
  const src = join(DIR, f);
  const dst = join(OUT, f);
  const before = (await stat(src)).size;
  await sharp(src)
    .resize(TARGET, TARGET, { fit: 'inside', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, palette: false })
    .toFile(dst);
  const after = (await stat(dst)).size;
  totalBefore += before; totalAfter += after;
  console.log(`${f.padEnd(18)} ${String(Math.round(before / 1024)).padStart(4)}KB → ${String(Math.round(after / 1024)).padStart(3)}KB`);
}
console.log(`\n合计 ${Math.round(totalBefore / 1024)}KB → ${Math.round(totalAfter / 1024)}KB（省 ${Math.round((1 - totalAfter / totalBefore) * 100)}%）`);
