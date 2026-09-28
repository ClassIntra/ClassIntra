/**
 * 文字封面生成器（Canvas 版 · MD2Card 风）
 *
 * 两套模板按帖子轮换，复刻小红书文转图封面：
 *   A 条纹卡：粉彩斜纹底 + 白色圆角内衬卡 + 特大黑体标题 + 关键词圆形高亮
 *   B 笔记纸：米白横线纸 + 红色页边线 + 深蓝粗体标题 + 关键词荧光笔标记
 * 3:4 竖版；关键词位置与配色由帖子种子决定；确定性缓存。
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

function wrapLines(text, perLine, maxLines) {
  var lines = [];
  for (var i = 0; i < text.length && lines.length < maxLines; i += perLine) {
    lines.push(text.substring(i, i + perLine));
  }
  if (lines.length === maxLines && text.length > perLine * maxLines) {
    lines[maxLines - 1] = lines[maxLines - 1].substring(0, perLine - 1) + '…';
  }
  return lines;
}

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
  title = String(title == null ? '' : title);
  excerpt = String(excerpt == null ? '' : excerpt);
  colorHex = String(colorHex || '#007AFF');
  seed = String(seed == null ? 'x' : seed);
  var text = title || excerpt;
  if (!text) text = '写点什么记录一下吧';
  var key = String(seed) + '|' + text;
  if (cache[key]) return cache[key];
  if (typeof document === 'undefined') return '';

  var w = 360, h = 480;
  var sn = seedNum(seed);
  var styleT = sn % 2;
  var hue = hexToHslDeg(colorHex).h;

  var fs = styleT === 0 ? 44 : 40;
  var perLine = styleT === 0 ? 7 : 8;
  var lh = styleT === 0 ? 62 : 58;
  var lines = wrapLines(text, perLine, 4);

  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d');
  if (!ctx) return '';

  var textX = styleT === 0 ? 54 : 58;
  var blockH = (lines.length - 1) * lh;
  var textY = Math.round(h / 2 - blockH / 2 + fs * 0.05);

  if (styleT === 0) {
    // ===== A 条纹卡 =====
    var base = 'hsl(' + hue + ', 62%, 86%)';
    var stripe = 'hsl(' + hue + ', 58%, 78%)';
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = stripe;
    for (var sx = -720; sx < 720; sx += 96) ctx.fillRect(sx, -720, 48, 1440);
    ctx.restore();
    // 白色内衬卡
    ctx.save();
    ctx.shadowColor = 'rgba(30,50,90,0.10)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, 30, 30, w - 60, h - 60, 36); ctx.fill();
    ctx.restore();
  } else {
    // ===== B 笔记纸 =====
    ctx.fillStyle = '#FCFAF4'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(190,185,175,0.5)'; ctx.lineWidth = 1;
    for (var ry = 52; ry < h; ry += 46) { ctx.beginPath(); ctx.moveTo(0, ry + 0.5); ctx.lineTo(w, ry + 0.5); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(222,120,110,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(36, 0); ctx.lineTo(36, h); ctx.stroke();
  }

  // 关键词高亮：种子选定第 idx 个字（取 2 字），先画底衬再叠字
  var hlIdx = Math.min(sn % Math.max(text.length - 2, 1), text.length - 2);
  var hlLine = Math.floor(hlIdx / perLine);
  var hlPos = hlIdx % perLine;
  if (hlLine >= lines.length) hlLine = lines.length - 1;
  var hlLineText = lines[hlLine];
  if (hlPos > hlLineText.length - 2) hlPos = Math.max(hlLineText.length - 2, 0);
  var prefixW = ctx.measureText(hlLineText.substring(0, hlPos)).width;
  var keyW = ctx.measureText(hlLineText.substring(hlPos, hlPos + 2)).width;
  var hlCx = textX + prefixW + keyW / 2;
  var hlCy = textY + hlLine * lh;

  if (styleT === 0) {
    ctx.fillStyle = 'rgba(250,158,128,0.55)';
    ctx.beginPath(); ctx.arc(hlCx, hlCy + 4, fs * 0.56, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(110,170,255,0.6)';
    roundRect(ctx, hlCx - keyW / 2 - 6, hlCy + 12, keyW + 12, fs * 0.4, 8); ctx.fill();
  }

  // 标题文字
  ctx.fillStyle = styleT === 0 ? '#1A1A1A' : '#2B3A55';
  ctx.font = '700 ' + fs + 'px ' + FONT_STACK;
  ctx.textBaseline = 'middle';
  for (var li = 0; li < lines.length; li++) {
    ctx.fillText(lines[li], textX, textY + li * lh);
  }

  var url = canvas.toDataURL('image/png');
  cache[key] = url;
  return url;
}

export default { generateTextCover: generateTextCover };
