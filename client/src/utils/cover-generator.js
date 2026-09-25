/**
 * 文字封面生成器（Canvas 版 · 网格光斑风）
 *
 * 每帖封面像一张小壁纸：由哈希色扩展出的类比色系画 3 个大光斑（位置/半径按
 * 帖子种子变化），叠柔光圆环与点阵肌理；构图四种轮换。高度随内容行数分档，
 * 瀑布流天然错落。结果确定性缓存，一张只画一次。
 */

var cache = {};

function hexToRgb(hex) {
  return {
    r: parseInt(hex.substring(1, 3), 16),
    g: parseInt(hex.substring(3, 5), 16),
    b: parseInt(hex.substring(5, 7), 16)
  };
}

// 色相旋转 ±deg 生成类比色（保持同族和谐又有变化）
function hueShift(hex, deg) {
  var c = hexToRgb(hex);
  var r = c.r / 255, g = c.g / 255, b = c.b / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h, s, l = (max + min) / 2;
  if (max === min) { h = 0; s = 0; }
  else {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  h = (h + deg / 360) % 1;
  if (h < 0) h += 1;
  // HSL → RGB
  var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  var p = 2 * l - q;
  function t2v(t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  var r2 = Math.round(t2v(h + 1 / 3) * 255);
  var g2 = Math.round(t2v(h) * 255);
  var b2 = Math.round(t2v(h - 1 / 3) * 255);
  return '#' + [r2, g2, b2].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
}

function seedNum(seed) {
  return Math.abs(String(seed || 'x').split('').reduce(function (a, ch) { return a + ch.charCodeAt(0); }, 0));
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

// 柔光斑：径向渐变圆（中心实、边缘透明），叠加出壁纸质感
function blob(ctx, x, y, r, color, alpha) {
  var g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

export function generateTextCover(title, excerpt, colorHex, seed) {
  var key = String(seed) + '|' + colorHex + '|' + title;
  if (cache[key]) return cache[key];
  if (typeof document === 'undefined') return '';

  var text = String(excerpt || '').trim();
  var lines = wrapLines(text, 17, 3);

  var w = 360;
  var h = lines.length <= 1 ? 190 : lines.length === 2 ? 225 : 265;
  var sn = seedNum(seed);
  var variant = sn % 4;

  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 底：近黑
  ctx.fillStyle = '#101319';
  ctx.fillRect(0, 0, w, h);

  // 类比色系：哈希色 ±32° 色相，三色光斑按种子散布
  var c1 = colorHex;
  var c2 = hueShift(colorHex, 32);
  var c3 = hueShift(colorHex, -32);
  var pos = [
    [[w * 0.75, h * 0.2, w * 0.62], [w * 0.15, h * 0.75, w * 0.55], [w * 0.55, h * 0.55, w * 0.4]],
    [[w * 0.25, h * 0.25, w * 0.6], [w * 0.8, h * 0.7, w * 0.58], [w * 0.5, h * 0.5, w * 0.38]],
    [[w * 0.2, h * 0.2, w * 0.5], [w * 0.85, h * 0.35, w * 0.5], [w * 0.45, h * 0.85, w * 0.55]],
    [[w * 0.6, h * 0.15, w * 0.5], [w * 0.2, h * 0.6, w * 0.55], [w * 0.85, h * 0.8, w * 0.45]]
  ][variant];
  blob(ctx, pos[0][0], pos[0][1], pos[0][2], c1, 0.6);
  blob(ctx, pos[1][0], pos[1][1], pos[1][2], c2, 0.42);
  blob(ctx, pos[2][0], pos[2][2], pos[2][2], c3, 0.34);

  // 装饰变体：细圆环（种子偶数帖）
  if (sn % 2 === 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(w - 46, 40 + (sn % 24), 26 + (sn % 18), 0, Math.PI * 2);
    ctx.stroke();
  }

  // 点阵肌理
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (var y = 14; y < h; y += 24) {
    for (var x = 14; x < w; x += 24) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 底部渐隐压暗，保证摘要可读
  var veil = ctx.createLinearGradient(0, h - 100, 0, h);
  veil.addColorStop(0, 'rgba(8,10,16,0)');
  veil.addColorStop(1, 'rgba(8,10,16,0.72)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, h - 100, w, 100);

  // 摘要排印
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.font = '600 17px ' + FONT_STACK;
  ctx.textBaseline = 'alphabetic';
  var lineHeight = 24;
  var baseY = h - 16 - (lines.length - 1) * lineHeight;
  for (var l = 0; l < lines.length; l++) {
    ctx.fillText(lines[l], 16, baseY + l * lineHeight);
  }

  var url = canvas.toDataURL('image/png');
  cache[key] = url;
  return url;
}

export default { generateTextCover: generateTextCover };
