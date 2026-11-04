// 从图集里裁一块并另存为独立 PNG —— CSS 平铺 wall/floor 需要「单块可重复」的小图，
// 直接拿整张图集当背景没法平铺。
// 用法：node scripts/_tilesheet-crop.mjs <src.png> <c> <r> <w> <h> <out.png> [tile] [margin]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { dirname } from 'node:path';

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let pos = 8, w = 0, h = 0, colorType = 6, bitDepth = 8;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit');
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
    prev = cur;
  }
  return { w, h, bpp, data: out };
}

// --- 极简 PNG 编码（RGBA，filter 0）---
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const [src, cs, rs, ws, hs, outPath] = process.argv.slice(2);
// argv: 0 node,1 script,2 src,3 c,4 r,5 w,6 h,7 out,8 tile,9 margin
const TILE = Number(process.argv[8] || 16);
const MARG = Number(process.argv[9] || 1);
const img = decodePNG(readFileSync(src));
const c = +cs, r = +rs, tw = +ws, th = +hs;
const x0 = c * (TILE + MARG), y0 = r * (TILE + MARG);
// 输出只含 tile 像素，**丢掉格子之间的 margin**（否则平铺会出现透明缝）
const cw = tw * TILE, ch = th * TILE;
const dst = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const sx = x0 + Math.floor(x / TILE) * (TILE + MARG) + (x % TILE);
    const sy = y0 + Math.floor(y / TILE) * (TILE + MARG) + (y % TILE);
    if (sx >= img.w || sy >= img.h) continue;
    const si = (sy * img.w + sx) * img.bpp;
    const di = (y * cw + x) * 4;
    if (img.bpp === 4) { dst[di] = img.data[si]; dst[di + 1] = img.data[si + 1]; dst[di + 2] = img.data[si + 2]; dst[di + 3] = img.data[si + 3]; }
    else { dst[di] = img.data[si]; dst[di + 1] = img.data[si + 1]; dst[di + 2] = img.data[si + 2]; dst[di + 3] = 255; }
  }
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, encodePNG(cw, ch, dst));
console.log(`✂️  ${outPath}  ${cw}x${ch}  (from ${c},${r} ${tw}x${th})`);
