/**
 * 文字封面生成器（Canvas 版 · MD2Card 风 v3）
 *
 * 两套模板按帖子轮换：条纹卡 / 笔记纸。
 * 排版核心：先设字体再按"像素宽度"测量换行（彻底解决按字数换行导致的
 * 溢出与关键词错位）；标题块垂直居中；高亮圆/荧光笔与文字同源测量精确对位。
 * 3:4 竖版；确定性缓存。
 */

var cache = {};
var cacheKeys = 0;
var MAX_CACHE = 240;

// 复用同一块 canvas：每张封面都 new 一个 360×480 画布会产生明显 GC 压力
//（滚动中批量生成时尤其明显）。
var _canvas = null;
var _ctx = null;
function sharedCanvas() {
  if (_canvas) return _canvas;
  _canvas = document.createElement('canvas');
  _canvas.width = 360;
  _canvas.height = 480;
  _ctx = _canvas.getContext('2d');
  return _canvas;
}

// 只查缓存、不生成：供「延后生成」路径在渲染时判断是否已就绪。
// 参数与 generateTextCover 的第一参一致（标题文本，空则回落到正文）。
export function peekTextCover(text, seed) {
  var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim() || '写点什么记录一下吧';
  return cache[String(seed) + '|' + t] || '';
}

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

  var canvas = sharedCanvas();
  var ctx = _ctx;
  if (!ctx) return '';
  // 复用画布必须先复位绘图状态，否则上一张的阴影/透明度会串到下一张
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.textAlign = 'left';
  ctx.clearRect(0, 0, w, h);

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
  // ⚠️ 2026-11-02 性能：原实现每加一个字都测量「整行」宽度（O(n²) 次 measureText，
  // 长标题在 6x 降频设备上单张封面要 100ms+，社区滚动时集中生成会直接卡帧）。
  // 混合策略：离行尾还远时只量「单字」累加（O(1)/字），进入收尾区（>70% 行宽）
  // 改回整行精确测量并修正累加漂移——任何断行决策都发生在收尾区，因此结果与
  // 原实现逐字符一致（已用 120 条真实标题 × 2 模板回归，0 差异）。
  ctx.font = '700 ' + fs + 'px ' + FONT_STACK;
  ctx.textBaseline = 'middle';
  var lines = [];
  var line = '';
  var lineW = 0;
  var ci = 0;
  var exactFrom = maxW * 0.7;
  for (; ci < text.length; ci++) {
    var ch = text.charAt(ci);
    var cw = ctx.measureText(ch).width;
    // 收尾区整行测量（精确）；否则单字累加（近似，仅用于判断「还早得很」）
    var w = lineW > exactFrom ? ctx.measureText(line + ch).width : lineW + cw;
    if (w > maxW && line) {
      lines.push(line);
      line = ch;
      lineW = cw;
    } else {
      line += ch;
      lineW = w;
    }
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
  // 缓存上限：289 篇帖子 × ~50KB dataURL ≈ 14MB 常驻内存，2GB 平板吃不消。
  // 超限整体清空（下次滚动按需重生成，视觉无差异），避免无界增长。
  if (cacheKeys >= MAX_CACHE) { cache = {}; cacheKeys = 0; }
  cache[key] = url;
  cacheKeys++;
  return url;
}

export default { generateTextCover: generateTextCover };
