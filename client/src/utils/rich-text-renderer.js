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
  return 'other