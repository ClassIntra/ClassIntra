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

/**
 * 根据媒体类型生成对应的内联 HTML 元素
 * @param {string} url - 已转义的媒体 URL
 * @param {'image'|'video'|'audio'} type - 媒体类型
 * @returns {string} 媒体 HTML 字符串
 */
function generateMediaHtml(url, type) {
  if (type === 'image') {
    return '<img class="msg-image msg-media" data-media-url="' + url + '" data-media-type="image" src="' + url + '" alt="图片" loading="lazy" />';
  }
  if (type === 'video') {
    return '<div class="msg-media-wrapper msg-video-wrapper msg-media" data-media-url="' + url + '" data-media-type="video">' +
      '<video class="msg-video" data-media-url="' + url + '" data-media-type="video" src="' + url + '" preload="metadata" playsinline muted></video>' +
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
 * @returns {string} 渲染后的 HTML
 */
function renderRichText(content, options) {
  if (!content) return '';
  options = options || {};
  var highlightTerm = options.highlightTerm || '';
  var enableMedia = options.enableMedia !== false;

  // Step 1: 提取媒体 URL 并替换为占位符
  var mediaItems = []; // { url, type, placeholder }
  var text = content;
  if (enableMedia) {
    text = content.replace(/(\/api\/cloud\/files\/[^\s<>"]+|\/resources\/[^\s<>"]+)/g, function(url) {
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

  // Step 5: 还原媒体占位符为 HTML 元素
  for (var i = 0; i < mediaItems.length; i++) {
    var placeholder = '%%MEDIA' + i + '%%';
    var item = mediaItems[i];
    var escapedUrl = escapeHtml(item.url);
    var mediaHtml = generateMediaHtml(escapedUrl, item.type);
    html = html.replace(placeholder, mediaHtml);
  }

  // Step 6: 还原普通 URL 为可点击链接
  for (var j = 0; j < urls.length; j++) {
    var urlPlaceholder = '%%URL' + j + '%%';
    var url = urls[j];
    var escapedUrl = escapeHtml(url);
    var urlHtml = '<a href="' + escapedUrl + '" class="msg-link" data-external="true">' + escapedUrl + '</a>';
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
  renderRichText: renderRichText,
  renderUserMarkdown: renderUserMarkdown
};
