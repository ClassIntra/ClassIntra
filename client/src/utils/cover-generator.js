/**
 * 文字封面生成器（Canvas 版 · 暗色雅致风）
 *
 * 设计目标：不再是大色块——深色中性底 + 哈希色轻染 + 超大字形水印 +
 * 细点阵肌理 + 白色摘要，三种构图变体按帖子 id 轮换，避免千篇一律。
 * 高度随内容行数分三档（瀑布流天然错落）；结果按内容确定性缓存。
 */

var cache = {};

function hexToRgb(hex) {
  return {
    r: parseInt(hex.substring(1, 3), 16),
    g: parseInt(hex.substring(3, 5), 16),
    b: parseInt(hex.substring(5, 7), 16)
  };
}

var FONT_STACK = '-apple-system, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

// 细点阵肌理：低透明度白点网格，给纯色底「纸感」
function drawDots(ctx, w, h) {
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  var step = 22;
  for (var y = 12; y < h; y += step) {
    for (var x = 12; x < w; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// 摘要自动换行
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

export function generateTextCover(title, excerpt, colorHex, seed) {
  var key = String(seed) + '|' + colorHex + '|' + title;
  if (cache[key]) return cache[key];
  if (typeof document === 'undefined') return '';

  var text = String(excerpt || '').trim();
  var lines = wrapLines(text, 17, 3);

  var w = 360;
  var h = lines.length <= 1 ? 180 : lines.length === 2 ? 210 : 250;
  var variant = Math.abs(String(seed || '').split('').reduce(function (a, ch) {
    return a + ch.charCodeAt(0);
  }, 0)) % 3;

  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 底：深色中性渐变（不随帖子变色，杜绝缤纷色块）
  var base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, '#1B1D23');
  base.addColorStop(1, '#262932');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  // 哈希色轻染：只提供每帖一丝色相差异
  var c = hexToRgb(colorHex);
  ctx.fillStyle = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.13)';
  ctx.fillRect(0, 0, w, h);

  drawDots(ctx, w, h);

  // 超大首字水印：三种构图变体，哈希色低透明度
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = colorHex;
  ctx.font = '700 210px ' + FONT_STACK;
  ctx.textBaseline = 'top';
  var glyph = String(title || '帖').substring(0, 1);
  if (variant === 0) {
    ctx.fillText(glyph, w - 150, h - 190);
  } else if (variant === 1) {
    ctx.textAlign = 'center';
    ctx.fillText(glyph, w / 2, (h - 170) / 2);
    ctx.textAlign = 'left';
  } else {
    ctx.fillText(glyph, -18, -26);
  }
  ctx.globalAlpha = 1;

  // 摘要：白色排印在左下
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = '600 17px ' + FONT_STACK;
  ctx.textBaseline = 'alphabetic';
  var lineHeight = 24;
  var baseY = h - 18 - (lines.length - 1) * lineHeight;
  for (var l = 0; l < lines.length; l++) {
    ctx.fillText(lines[l], 16, baseY + l * lineHeight);
  }

  var url = canvas.toDataURL('image/png');
  cache[key] = url;
  return url;
}

export default { generateTextCover: generateTextCover };
