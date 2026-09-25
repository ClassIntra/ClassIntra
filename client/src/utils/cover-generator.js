/**
 * 文字封面生成器（Canvas 版）
 *
 * 为纯文本帖子绘制封面图：哈希色渐变底 + 首字大水印 + 底部渐隐压暗 + 摘要排印。
 * 同等效果下比 Satori 方案更适合本项目：无新依赖、无字体打包（用系统字体）、
 * 结果按内容确定性缓存，一张图只画一次。
 */

var cache = {};

function hexToRgb(hex) {
  return {
    r: parseInt(hex.substring(1, 3), 16),
    g: parseInt(hex.substring(3, 5), 16),
    b: parseInt(hex.substring(5, 7), 16)
  };
}

function shade(hex, f) {
  var c = hexToRgb(hex);
  return 'rgb(' + Math.round(c.r * f) + ',' + Math.round(c.g * f) + ',' + Math.round(c.b * f) + ')';
}

var FONT_STACK = '-apple-system, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

/**
 * 生成文字封面 dataURL
 * @param {string} title 帖子标题（取首字做水印）
 * @param {string} excerpt 摘要文本（底部排印，自动换行最多 3 行）
 * @param {string} colorHex 哈希色（#RRGGBB）
 */
export function generateTextCover(title, excerpt, colorHex) {
  var key = colorHex + '|' + title;
  if (cache[key]) return cache[key];
  if (typeof document === 'undefined') return '';

  var w = 360;
  var h = 200;
  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 底：哈希色对角渐变（主色 → 深化色）
  var grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, colorHex);
  grad.addColorStop(1, shade(colorHex, 0.5));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 首字大水印：极低透明度，增加封面辨识度
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 150px ' + FONT_STACK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(String(title || '帖').substring(0, 1), w - 128, -10);
  ctx.globalAlpha = 1;

  // 底部渐隐压暗，保证白字摘要可读
  var veil = ctx.createLinearGradient(0, h - 96, 0, h);
  veil.addColorStop(0, 'rgba(0,0,0,0)');
  veil.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, h - 96, w, 96);

  // 摘要排印：自动换行，最多 3 行，末行截断加省略号
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.font = '600 17px ' + FONT_STACK;
  ctx.textBaseline = 'alphabetic';
  var text = String(excerpt || '').trim();
  var perLine = 18;
  var lines = [];
  for (var i = 0; i < text.length && lines.length < 3; i += perLine) {
    lines.push(text.substring(i, i + perLine));
  }
  if (lines.length === 3 && text.length > perLine * 3) {
    lines[2] = lines[2].substring(0, perLine - 1) + '…';
  }
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
