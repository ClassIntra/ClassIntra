/**
 * 统一富文本渲染工具模块
 *
 * 集中处理聊天消息和 AI 消息中的富文本渲染逻辑，包括：
 * - 媒体类型检测（图片/视频/音频）
 * - 媒体 URL 替换为内联 HTML 元素
 * - 普通 URL 转换为可点击链接
 * - HTML 转义与安全清理
 * - 搜索关键词高亮
 *
 * 该模块从 ChatBubble.vue 和 AIChat.vue 中提取重复逻辑，
 * 确保所有富文本内容经过统一的安全过滤，消除 XSS 风险。
 */

// ========== 媒体类型检测 ==========

var IMG_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
var VID_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.3gp'];
var AUD_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus'];

/**
 * 检测 URL 指向的媒体类型
 * 优先根据文件名中的类型标记（__audio / __video / __image）判断，
 * 回退到文件扩展名，最后兜底 photos 目录视为图片。
 *
 * @param {string} url - 媒体文件 URL
 * @returns {'image'|'video'|'audio'|'other'} 媒体类型
 */
function detectMediaType(url) {
  if (typeof url !== 'string') return 'other';
  var lower = url.toLowerCase();
  // 优先文件名中的类型标记（__audio / __video / __image）
  if (lower.indexOf('__audio') > -1) return 'audio';
  if (lower.indexOf('__video') > -1) return 'video';
  if (lower.indexOf('__image') > -1) return 'image';
  // 回退到扩展名
  for (var e = 0; e < VID_EXTS.length; e++) { if (lower.indexOf(VID_EXTS[e]) > -1) return 'video'; }
  for (var e = 0; e < AUD_EXTS.length; e++) { if (lower.indexOf(AUD_EXTS[e]) > -1) return 'audio'; }
  for (var e = 0; e < IMG_EXTS.length; e++) { if (lower.indexOf(IMG_EXTS[e]) > -1) return 'image'; }
  // 兜底：photos 目录视为图片
  if (lower.indexOf('/photos/') > -1) return 'image';
  return 'other';
}

// ========== HTML 转义与安全清理 ==========

/**
 * HTML 转义：将 & < > " 替换为实体，防止注入
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 安全清理 HTML：优先使用 DOMPurify，不可用时回退到基础转义
 * @param {string} html - 待清理的 HTML 字符串
 * @returns {string} 安全的 HTML 字符串
 */
function sanitizeHtml(html) {
  if (typeof window !== 'undefined' && window.DOMPurify) {
    return window.DOMPurify.sanitize(html);
  }
  // 回退：DOMPurify 不可用时仅保留基础转义
  return escapeHtml(html);
}

// ========== 搜索高亮 ==========

/**
 * 对 HTML 内容中的搜索词添加高亮标记
 * 注意：应在媒体/URL 占位符还原之后调用，避免破坏占位符
 * @param {string} html - 已转义的 HTML 内容
 * @param {string} term - 搜索关键词
 * @returns {string} 带高亮标记的 HTML
 */
function applyHighlight(html, term) {
  if (!term || !html) return html;
  var escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var regex = new RegExp('(' + escaped + ')', 'gi');
  return html.replace(regex, '<mark class="search-highlight">$1</mark>');
}

// ========== 媒体 HTML 生成 ==========

// 视频扩展名 → MIME 类型映射表
var VIDEO_MIME_MAP = {
  '.mp4': 'video/mp4',
  '.mov': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.3gp': 'video/3gpp'
};

/**
 * 根据 URL 中的扩展名返回对应的视频 MIME 类型
 * 用于 <source type="..."> 声明，让浏览器尝试解码 mov 等非 mp4 容器
 * @param {string} url - 视频 URL
 * @returns {string} MIME 类型，默认 video/mp4
 */
function getVideoMime(url) {
  if (!url || typeof url !== 'string') return 'video/mp4';
  var lower = url.toLowerCase();
  for (var ext in VIDEO_MIME_MAP) {
    if (lower.indexOf(ext) > -1) return VIDEO_MIME_MAP[ext];
  }
  return 'video/mp4';
}

/**
 * 根据媒体类型生成对应的内联 HTML 元素
 * @param {string} url - 已转义的媒体 URL
 * @param {'image'|'video'|'audio'} type - 媒体类型
 * @returns {string} 媒体 HTML 字符串
 */
function generateMediaHtml(url, type) {
  if (type === 'image') {
    // 云盘图片附加缩放参数，加快加载
    var src = url;
    if (url.indexOf('/api/cloud/files/') > -1 && url.indexOf('?w=') === -1) {
      src = url + '?w=800';
    }
    // 内联 SVG 占位图：文件已删除
    var deletedSvg = '<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22>' +
      '<rect fill=%22%23e8e8e8%22 width=%22200%22 height=%22200%22 rx=%228%22/>' +
      '<rect fill=%22%23d0d0d0%22 x=%2270%22 y=%2260%22 width=%2260%22 height=%2250%22 rx=%226%22/>' +
      '<polygon fill=%22%23d0d0d0%22 points=%2270,60 85,30 135,30 150,60%22/>' +
      '<text x=%22100%22 y=%22140%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2213%22 font-family=%22sans-serif%22>文件已删除</text>' +
      '</svg>';
    var deletedPlaceholder = 'data:image/svg+xml,' + deletedSvg;
    return '<img class="msg-image msg-media" data-media-url="' + url + '" data-media-type="image" src="' + src + '" alt="图片" loading="lazy" decoding="async" width="200" height="200" ' +
      'onerror="if(this.src.indexOf(\'data:image/svg+xml\')===-1){this.src=\'' + deletedPlaceholder + '\';this.classList.add(\'msg-image-deleted\');}" />';
  }
  if (type === 'video') {
    return '<div class="msg-media-wrapper msg-video-wrapper msg-media" data-media-url="' + url + '" data-media-type="video">' +
      '<video class="msg-video" data-media-url="' + url + '" data-media-type="video" src="' + url + '" preload="metadata" playsinline webkit-playsinline muted></video>' +
      '<div class="msg-media-play"><i class="fa-solid fa-play"></i></div>' +
      '</div>';
  }
  if (type === 'audio') {
    // 微信式语音条 UI（播放按钮 + 波形 + 时长 + 进度）
    var voiceBars = '';
    for (var b = 0; b < 8; b++) {
      voiceBars += '<span></span>';
    }
    return '<div class="msg-voice-bar msg-media" data-media-url="' + url + '" data-media-type="audio" data-voice-init="0">' +
      '<div class="voice-play-btn"><i class="fa-solid fa-play"></i></div>' +
      '<div class="voice-wave">' +
        '<div class="voice-wave-bars">' + voiceBars + '</div>' +
        '<div class="voice-progress"></div>' +
      '</div>' +
      '<div class="voice-duration">--"</div>' +
    '</div>';
  }
  return '';
}

// ========== 统一渲染接口 ==========

/**
 * 渲染富文本内容（聊天消息专用）
 *
 * 处理流程：
 * 1. 提取媒体 URL → 占位符
 * 2. 提取普通 URL → 占位符
 * 3. HTML 转义剩余文本
 * 4. 应用搜索高亮（如启用）
 * 5. 还原媒体占位符为 HTML 元素
 * 6. 还原 URL 占位符为可点击链接
 *
 * @param {string} content - 原始消息内容
 * @param {Object} [options] - 渲染选项
 * @param {string} [options.highlightTerm=''] - 搜索高亮关键词
 * @param {boolean} [options.enableMedia=true] - 是否处理媒体 URL
 * @param {boolean} [options.linksAsText=false] - 是否将链接渲染为纯文本（无超能岛浏览器权限时使用）
 * @returns {string} 渲染后的 HTML
 */
function renderRichText(content, options) {
  if (!content || typeof content !== 'string') return '';
  options = options || {};
  var highlightTerm = options.highlightTerm || '';
  var enableMedia = options.enableMedia !== false;
  var linksAsText = options.linksAsText === true;

  // Step 0: 处理云盘媒体标签 [cloud-img:hash.ext] / [cloud-video:hash.ext] / [cloud-audio:hash.ext]
  var cloudTagItems = [];
  var text = content;
  text = text.replace(/\[cloud-(img|video|audio):([a-f0-9]{64}(?:\.\w+)?)\]/g, function(match, tag, identifier) {
    var url = '/api/cloud/files/' + identifier;
    var type = tag === 'img' ? 'image' : tag === 'video' ? 'video' : 'audio';
    var idx = cloudTagItems.length;
    cloudTagItems.push({ url: url, type: type });
    return '%%CLOUDTAG' + idx + '%%';
  });

  // Step 1: 提取媒体 URL 并替换为占位符
  var mediaItems = []; // { url, type, placeholder }
  if (enableMedia) {
    text = text.replace(/(\/api\/cloud\/files\/[^\s<>"]+|\/resources\/[^\s<>"]+)/g, function(url) {
      var type = detectMediaType(url);
      if (type === 'image' || type === 'video' || type === 'audio') {
        var idx = mediaItems.length;
        mediaItems.push({ url: url, type: type });
        return '%%MEDIA' + idx + '%%';
      }
      return url;
    });
  }

  // Step 2: 提取普通 URL 并替换为占位符
  var urls = [];
  text = text.replace(/(https?:\/\/[^\s<>"]+)/g, function(url) {
    urls.push(url);
    return '%%URL' + (urls.length - 1) + '%%';
  });

  // Step 3: HTML 转义
  var html = escapeHtml(text);

  // Step 4: 应用搜索高亮
  if (highlightTerm) {
    html = applyHighlight(html, highlightTerm);
  }

  // Step 4.5: 还原云盘标签占位符为媒体元素
  for (var ci = 0; ci < cloudTagItems.length; ci++) {
    var ctPlaceholder = '%%CLOUDTAG' + ci + '%%';
    var ctItem = cloudTagItems[ci];
    var ctEscapedUrl = escapeHtml(ctItem.url);
    var ctMediaHtml = generateMediaHtml(ctEscapedUrl, ctItem.type);
    html = html.replace(ctPlaceholder, ctMediaHtml);
  }

  // Step 5: 还原媒体占位符为 HTML 元素
  for (var i = 0; i < mediaItems.length; i++) {
    var placeholder = '%%MEDIA' + i + '%%';
    var item = mediaItems[i];
    var escapedUrl = escapeHtml(item.url);
    var mediaHtml = generateMediaHtml(escapedUrl, item.type);
    html = html.replace(placeholder, mediaHtml);
  }

  // Step 6: 还原普通 URL 为可点击链接（或纯文本）
  for (var j = 0; j < urls.length; j++) {
    var urlPlaceholder = '%%URL' + j + '%%';
    var url = urls[j];
    var escapedUrl = escapeHtml(url);
    var urlHtml;
    if (linksAsText) {
      // 无超能岛浏览器权限：显示为纯文本，不可点击
      urlHtml = '<span class="msg-link-text">' + escapedUrl + '</span>';
    } else {
      urlHtml = '<a href="' + escapedUrl + '" class="msg-link" data-external="true">' + escapedUrl + '</a>';
    }
    html = html.replace(urlPlaceholder, urlHtml);
  }

  return html;
}

/**
 * 渲染用户消息的轻量 Markdown（AIChat 专用）
 * 处理行内代码和加粗，换行转为 <br>
 * @param {string} content - 原始用户消息
 * @returns {string} 渲染后的 HTML
 */
function renderUserMarkdown(content) {
  if (!content) return '';
  var escaped = escapeHtml(content).replace(/\n/g, '<br>');
  escaped = escaped.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return escaped;
}

export default {
  detectMediaType: detectMediaType,
  escapeHtml: escapeHtml,
  sanitizeHtml: sanitizeHtml,
  applyHighlight: applyHighlight,
  generateMediaHtml: generateMediaHtml,
  getVideoMime: getVideoMime,
  renderRichText: renderRichText,
  renderUserMarkdown: renderUserMarkdown
};
