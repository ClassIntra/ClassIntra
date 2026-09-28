/**
 * 文字封面生成器（Canvas 版 · MD2Card 风 v3）
 *
 * 两套模板按帖子轮换：条纹卡 / 笔记纸。
 * 排版核心：先设字体再按"像素宽度"测量换行（彻底解决按字数换行导致的
 * 溢出与关键词错位）；标题块垂直居中；高亮圆/荧光笔与文字同源测量精确对位。
 * 3:4 竖版；确定性缓存。
 */

var cache = {};

function seedNum(seed) {
  return Math.abs(String(seed || 'x').split('').reduce(function (a, ch) { return a + ch.charCodeAt(0); }, 0));
}

function hexToHslDeg(hex) {
  var r = parseInt(hex.substring(1, 3), 16) / 255;
  var g = parseInt(hex.substring(3, 5), 16) / 255;
  var b = parseInt(hex.substring(5, 7), 16) / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h, s, l = (max + min) / 2;
  if (max === min) { h = 210; s = 0.6; }
  else {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = h / 6 * 360;
  }
  return { h: h, s: Math.max(s, 0.35) };
}

var FONT_STACK = '-apple-system, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function generateTextCover(title, excerpt, colorHex, seed) {
  title = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
  excerpt = String(excerpt == null ? '' : excerpt);
  var text = title || excerpt.replace(/\s+/g, ' ').trim() || '写点什么记录一下吧';
  var key = String(seed) + '|' + text;
  if (cache[key]) return cache[key];
  if (typeof document === 'undefined') return '';

  var w = 360, h = 480;
  var sn = seedNum(seed);
  var styleT = sn % 2;
  var hue = hexToHslDeg(colorHex).h;

  var fs = styleT === 0 ? 42 : 38;
  var lh = Math.round(fs * 1.42);
  var textX = styleT === 0 ? 52 : 56;
  var maxW = w - textX - 36;
  var maxLines = 5;

  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // ===== 背景先画 =====
  if (styleT === 0) {
    var base = 'hsl(' + hue + ', 62%, 86%)';
    var stripe = 'hsl(' + hue + ', 58%, 78%)';
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = stripe;
    for (var sx = -720; sx < 720; sx += 96) ctx.fillRect(sx, -720, 48, 1440);
    ctx.restore();
    ctx.save();
    ctx.shadowColor = 'rgba(30,50,90,0.10)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, 30, 30, w - 60, h - 60, 36); ctx.fill();
    ctx.restore();
  } else {
    ctx.fillStyle = '#FCFAF4'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(190,185,175,0.5)'; ctx.lineWidth = 1;
    for (var ry = 52; ry < h; ry += 46) { ctx.beginPath(); ctx.moveTo(0, ry + 0.5); ctx.lineTo(w, ry + 0.5); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(222,120,110,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(36, 0); ctx.lineTo(36, h); ctx.stroke();
  }

  // ===== 文字排版：先设字体，按像素宽度测量换行（杜绝溢出） =====
  ctx.font = '700 ' + fs + 'px ' + FONT_STACK;
  ctx.textBaseline = 'middle';
  var lines = [];
  var line = '';
  for (var ci = 0; ci < text.length; ci++) {
    var test = line + text.charAt(ci);
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = text.charAt(ci); }
    else { line = test; }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && ci < text.length) {
    lines[maxLines - 1] = lines[maxLines - 1].substring(0, lines[maxLines - 1].length - 1) + '…';
  }
  if (!lines.length) lines = [text.substring(0, 6)];

  // 垂直居中
  var blockH = (lines.length - 1) * lh;
  var startY = Math.round(h / 2 - blockH / 2);

  // ===== 关键词高亮：与文字同字体同源测量，精确对位 =====
  var hlLine = Math.min(sn % lines.length, lines.length - 1);
  var lineText = lines[hlLine].replace(/…$/, '');
  var charCount = lineText.length;
  var hlPos = charCount >= 3 ? (sn % (charCount - 2)) : 0;
  var hlLen = Math.min(2, charCount - hlPos);
  if (hlLen < 1) { hlPos = 0; hlLen = Math.min(2, charCount); }
  var prefixW = ctx.measureText(lineText.substring(0, hlPos)).width;
  var keyW = Math.max(ctx.measureText(lineText.substring(hlPos, hlPos + hlLen)).width, fs * 0.9);
  var hlCx = textX + prefixW + keyW / 2;
  var hlCy = startY + hlLine * lh;

  if (styleT === 0) {
    ctx.fillStyle = 'rgba(250,158,128,0.55)';
    ctx.beginPath(); ctx.arc(hlCx, hlCy, fs * 0.58, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(110,170,255,0.6)';
    roundRect(ctx, hlCx - keyW / 2 - 6, hlCy + fs * 0.16, keyW + 12, fs * 0.4, 8); ctx.fill();
  }

  // ===== 标题文字 =====
  ctx.fillStyle = styleT === 0 ? '#1A1A1A' : '#2B3A55';
  for (var li = 0; li < lines.length; li++) {
    ctx.fillText(lines[li], textX, startY + li * lh);
  }

  var url = canvas.toDataURL('image/png');
  cache[key] = url;
  return url;
}

export default { generateTextCover: generateTextCover };
