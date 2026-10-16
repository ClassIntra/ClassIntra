// 对话长图渲染器（纯 Canvas 2D，零依赖）
//
// 为什么不用 html2canvas：
//   1) 它靠 SVG foreignObject 把 DOM 转成图，Chrome 80（校园平板基线）上对外链图片
//      与部分 CSS 的支持很飘，且一旦画布被跨域图片污染，toBlob 直接抛 SecurityError；
//   2) 它要把整页 DOM 全量克隆一遍，长会话下比直接画慢得多。
// 手写 Canvas 的代价是要自己算换行与高度，换来的是：完全可控、不污染、可预测的内存占用。
//
// 输出：PNG Blob，调用方直接 multipart 上传到云盘（POST /api/cloud/upload）。

var W = 760;                 // 图宽（px）。再宽在平板上内存吃紧，再窄手机上看不清
var PAD = 28;                // 左右留白
var MAX_H = 16000;           // 总高上限，超出就丢最旧的消息（并在顶部标注）
var AVATAR = 36;             // 头像直径
var GAP = 12;                // 头像与气泡间距
var BUBBLE_PAD_X = 16;
var BUBBLE_PAD_Y = 14;
var RADIUS = 14;
var FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';
var MONO = 'Consolas, "SFMono-Regular", Menlo, Monaco, "Courier New", monospace';
var BODY_FONT_SIZE = 16;
var BODY_LINE_H = 27;
var CODE_FONT_SIZE = 14;
var CODE_LINE_H = 22;

var C = {
  page: '#f2f3f5',
  headerFrom: '#4f46e5',
  headerTo: '#7c3aed',
  headerText: '#ffffff',
  headerSub: 'rgba(255,255,255,0.82)',
  name: '#6b7280',
  userBubble: '#4f46e5',
  userText: '#ffffff',
  aiBubble: '#ffffff',
  aiText: '#1f2328',
  codeBg: '#f6f8fa',
  codeText: '#24292e',
  codeBorder: '#e5e7eb',
  note: '#9ca3af',
  footer: '#9ca3af',
  divider: '#e5e7eb'
};

var TEXT_MAX_W = W - PAD * 2 - AVATAR - GAP - BUBBLE_PAD_X * 2;

function roundRectPath(ctx, x, y, w, h, r) {
  var rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// Markdown → 画得出的块。不追求还原排版，只求"读起来跟聊天里一样"。
// 块类型：text（普通段落）/ code（等宽底纹）/ hr（分割线）
// 导出只为可测：Node 里能直接断言「表格分隔行被丢掉」这类排版细节。
export function mdToBlocks(md) {
  var text = String(md || '');
  var blocks = [];
  var segs = text.split(/```/);
  for (var i = 0; i < segs.length; i++) {
    if (i % 2 === 1) {
      // 代码块：第一行的语言标识单独摘出来
      var raw = segs[i].replace(/^[a-zA-Z0-9_+-]*\n/, '');
      blocks.push({ type: 'code', text: raw.replace(/\n$/, '') });
    } else {
      var paras = segs[i].split(/\n{2,}/);
      for (var j = 0; j < paras.length; j++) {
        var p = paras[j];
        if (!p.trim()) continue;
        p = p
          .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')          // 图片 → alt
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')           // 链接 → 文字
          .replace(/^\s{0,3}#{1,6}\s+/gm, '')                // 标题井号
          .replace(/^\s{0,3}>\s?/gm, '')                     // 引用符号
          .replace(/\*\*([^*]+)\*\*/g, '$1')                 // 粗体
          .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')         // 斜体
          .replace(/`([^`]+)`/g, '$1')                       // 行内代码
          .replace(/^\s*[-*+]\s+/gm, '· ')                   // 无序列表
          .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')             // 有序列表
          .replace(/^\s*\|(.+)\|\s*$/gm, '$1')               // 表格行去边线
          .replace(/\|/g, '  ');                             // 表格竖线 → 空格
        // 整段就是一条分割线 → 画成横线（必须在按行剔表格分隔行之前判断，否则 --- 会被顺手删掉）
        if (/^\s*([-*_])\1{2,}\s*$/.test(p)) { blocks.push({ type: 'hr' }); continue; }
        // 表格的分隔行（| --- | --- |）此时已变成 " ---  ---  --- "：
        // 整个表格是**一个段落**（行间无空行），分隔行是段落内的一行，
        // 只对整段做判断抓不到，必须按行剔除；剔完还要折叠空行，否则会多出空白高度。
        p = p.split('\n').filter(function(line) {
          return !(/^[\s\-:|]+$/.test(line) && line.indexOf('-') >= 0);
        }).join('\n').replace(/\n{2,}/g, '\n');
        if (p.trim()) blocks.push({ type: 'text', text: p.replace(/\n$/, '') });
      }
    }
  }
  return blocks;
}

// 折行：CJK 逐字断、ASCII 单词不断（避免 URL / 变量名被腰斩）
function wrapText(ctx, text, maxW, fontSize, fontFamily) {
  ctx.font = fontSize + 'px ' + fontFamily;
  var out = [];
  var paras = String(text).split('\n');
  for (var p = 0; p < paras.length; p++) {
    var src = paras[p];
    if (!src.length) { out.push(''); continue; }
    var line = '';
    var i = 0;
    while (i < src.length) {
      var chunk;
      if (/[A-Za-z0-9_@.\-/]/.test(src.charAt(i))) {
        chunk = '';
        while (i < src.length && /[A-Za-z0-9_@.\-/]/.test(src.charAt(i))) { chunk += src.charAt(i); i++; }
      } else {
        chunk = src.charAt(i); i++;
      }
      var test = line + chunk;
      if (line !== '' && ctx.measureText(test).width > maxW) {
        out.push(line.replace(/\s+$/, ''));
        line = chunk.replace(/^\s+/, '');
      } else {
        line = test;
      }
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}

// 估算一条消息要占多高（不实际绘制）
function measureMessage(ctx, msg) {
  var blocks = mdToBlocks(msg.content || '');
  var lines = [];
  var h = 0;
  var codeInnerW = TEXT_MAX_W - BUBBLE_PAD_X * 2;
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (b.type === 'hr') { lines.push({ kind: 'hr' }); h += 20; continue; }
    var isCode = b.type === 'code';
    var size = isCode ? CODE_FONT_SIZE : BODY_FONT_SIZE;
    var lh = isCode ? CODE_LINE_H : BODY_LINE_H;
    var maxW = isCode ? codeInnerW : TEXT_MAX_W;
    var ls = wrapText(ctx, b.text, maxW, size, isCode ? MONO : FONT);
    // 单条消息的行数封顶：极端长文不至于把整张图撑爆
    if (ls.length > 400) { ls = ls.slice(0, 400); ls.push('…（内容过长，已截断）'); }
    lines.push({ kind: isCode ? 'code' : 'text', lines: ls, lh: lh });
    h += ls.length * lh + (isCode ? BUBBLE_PAD_Y : 0);
  }
  if (msg.images && msg.images.length) {
    h += (BODY_LINE_H + 8) * msg.images.length;
  }
  return { blocks: blocks, lines: lines, textH: h, bubbleH: h + BUBBLE_PAD_Y * 2 };
}

// 唯一对外入口
// opts: { title, modelLabel, memory, messages: [{role, content, images?}], footer }
// resolve: { blob, width, height, omitted }
export function renderConversationLongImage(opts) {
  return new Promise(function(resolve, reject) {
    try {
      var title = String((opts && opts.title) || 'AI 对话');
      var modelLabel = String((opts && opts.modelLabel) || '');
      var memory = String((opts && opts.memory) || '');
      var footer = String((opts && opts.footer) || 'ClassIntra · AI 对话导出');
      var all = (opts && opts.messages) || [];

      var measure = document.createElement('canvas');
      var mctx = measure.getContext('2d');
      if (!mctx) { reject(new Error('浏览器不支持 Canvas')); return; }

      // ---- 先逐条量高度，算出总高（含头部/尾部/间距）----
      var HEADER_H = 128;
      var FOOTER_H = 64;
      var MSG_GAP = 18;
      var measured = [];
      for (var i = 0; i < all.length; i++) {
        measured.push(measureMessage(mctx, all[i]));
      }

      // 从最旧的开始丢，直到高度进上限
      var startIdx = 0;
      var total = HEADER_H + FOOTER_H + (memory ? measureMessage(mctx, { role: 'assistant', content: memory }).bubbleH + 36 : 0);
      for (var j = 0; j < measured.length; j++) total += measured[j].bubbleH + MSG_GAP + 22;
      while (total > MAX_H && startIdx < measured.length - 1) {
        total -= measured[startIdx].bubbleH + MSG_GAP + 22;
        startIdx++;
      }
      var omitted = startIdx;

      var height = Math.ceil(total) + PAD;
      if (height < 400) height = 400;

      var canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = height;
      var ctx = canvas.getContext('2d');

      // ---- 背景 ----
      ctx.fillStyle = C.page;
      ctx.fillRect(0, 0, W, height);

      // ---- 头部 ----
      var grad = ctx.createLinearGradient(0, 0, W, HEADER_H);
      grad.addColorStop(0, C.headerFrom);
      grad.addColorStop(1, C.headerTo);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, HEADER_H);

      ctx.fillStyle = C.headerText;
      ctx.font = 'bold 24px ' + FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      var titleLines = wrapText(ctx, title, W - PAD * 2, 24, FONT);
      if (titleLines.length > 2) titleLines = titleLines.slice(0, 2);
      for (var t = 0; t < titleLines.length; t++) {
        ctx.fillText(titleLines[t], PAD, 52 + t * 34);
      }
      var subY = 52 + titleLines.length * 34 + 12;
      ctx.fillStyle = C.headerSub;
      ctx.font = '14px ' + FONT;
      var sub = [];
      if (modelLabel) sub.push('模型：' + modelLabel);
      sub.push('共 ' + all.length + ' 条消息');
      sub.push(new Date().toLocaleString('zh-CN', { hour12: false }));
      ctx.fillText(sub.join('  ·  '), PAD, subY);

      var y = HEADER_H + 24;

      // ---- 被省略提示 ----
      if (omitted > 0) {
        ctx.fillStyle = C.note;
        ctx.font = '13px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillText('（为控制图片长度，最旧的 ' + omitted + ' 条消息未包含）', W / 2, y);
        ctx.textAlign = 'left';
        y += 26;
      }

      // ---- 对话记忆 ----
      if (memory) {
        ctx.fillStyle = C.note;
        ctx.font = '13px ' + FONT;
        ctx.fillText('对话记忆', PAD + AVATAR + GAP, y);
        y += 20;
        y = drawBubble(ctx, { role: 'assistant', content: memory }, measureMessage(mctx, { role: 'assistant', content: memory }), y);
        y += 16;
      }

      // ---- 消息 ----
      for (var k = startIdx; k < measured.length; k++) {
        ctx.fillStyle = C.name;
        ctx.font = '13px ' + FONT;
        ctx.textAlign = k >= startIdx ? 'left' : 'left';
        ctx.fillText(all[k].role === 'user' ? '我' : (modelLabel || 'AI'), PAD + AVATAR + GAP, y);
        y += 22;
        y = drawBubble(ctx, all[k], measured[k], y);
        y += MSG_GAP;
      }

      // ---- 页脚 ----
      var footY = Math.max(y + 8, height - 30);
      ctx.strokeStyle = C.divider;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, footY - 16);
      ctx.lineTo(W - PAD, footY - 16);
      ctx.stroke();
      ctx.fillStyle = C.footer;
      ctx.font = '12px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText(footer, W / 2, footY + 4);
      ctx.textAlign = 'left';

      function done(blob) {
        resolve({ blob: blob, width: W, height: height, omitted: omitted, messageCount: all.length - startIdx });
      }
      if (canvas.toBlob) {
        canvas.toBlob(function(blob) {
          if (blob) done(blob);
          else reject(new Error('图片生成失败'));
        }, 'image/png');
      } else {
        // 极老内核兜底
        var dataUrl = canvas.toDataURL('image/png');
        var bin = atob(dataUrl.split(',')[1]);
        var arr = new Uint8Array(bin.length);
        for (var bi = 0; bi < bin.length; bi++) arr[bi] = bin.charCodeAt(bi);
        done(new Blob([arr], { type: 'image/png' }));
      }
    } catch (e) {
      reject(e);
    }
  });
}

// 画一条气泡（头像 + 内容），返回画完后的 y
function drawBubble(ctx, msg, m, top) {
  var isUser = msg.role === 'user';
  var h = m.bubbleH;
  var bubbleX = PAD + AVATAR + GAP;
  var bubbleW = TEXT_MAX_W + BUBBLE_PAD_X * 2;

  // 头像
  ctx.beginPath();
  ctx.arc(PAD + AVATAR / 2, top + AVATAR / 2 + 2, AVATAR / 2, 0, Math.PI * 2);
  ctx.fillStyle = isUser ? C.userBubble : '#9ca3af';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px ' + FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isUser ? '我' : 'AI', PAD + AVATAR / 2, top + AVATAR / 2 + 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 气泡底
  roundRectPath(ctx, bubbleX, top, bubbleW, h, RADIUS);
  ctx.fillStyle = isUser ? C.userBubble : C.aiBubble;
  ctx.fill();

  var y = top + BUBBLE_PAD_Y;
  var x = bubbleX + BUBBLE_PAD_X;
  for (var i = 0; i < m.lines.length; i++) {
    var item = m.lines[i];
    if (item.kind === 'hr') {
      ctx.strokeStyle = C.divider;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 10);
      ctx.lineTo(x + TEXT_MAX_W, y + 10);
      ctx.stroke();
      y += 20;
      continue;
    }
    if (item.kind === 'code') {
      var codeH = item.lines.length * CODE_LINE_H + BUBBLE_PAD_Y;
      roundRectPath(ctx, x, y, TEXT_MAX_W, codeH, 8);
      ctx.fillStyle = C.codeBg;
      ctx.fill();
      ctx.strokeStyle = C.codeBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = C.codeText;
      ctx.font = CODE_FONT_SIZE + 'px ' + MONO;
      for (var cl = 0; cl < item.lines.length; cl++) {
        ctx.fillText(item.lines[cl], x + 8, y + BUBBLE_PAD_Y / 2 + 16 + cl * CODE_LINE_H);
      }
      y += codeH + 6;
      continue;
    }
    ctx.fillStyle = isUser ? C.userText : C.aiText;
    ctx.font = BODY_FONT_SIZE + 'px ' + FONT;
    for (var l = 0; l < item.lines.length; l++) {
      ctx.fillText(item.lines[l], x, y + 18 + l * item.lh);
    }
    y += item.lines.length * item.lh + 8;
  }

  // 图片附件：不画原图（避免画布污染 + 鉴权麻烦），只留一行文字说明
  if (msg.images && msg.images.length) {
    ctx.fillStyle = isUser ? 'rgba(255,255,255,0.85)' : C.note;
    ctx.font = '13px ' + FONT;
    for (var im = 0; im < msg.images.length; im++) {
      ctx.fillText('[图片] ' + (msg.images[im].name || '附件'), x, y + 16 + im * (BODY_LINE_H + 8));
    }
  }

  return top + h;
}

export default { renderConversationLongImage: renderConversationLongImage };
