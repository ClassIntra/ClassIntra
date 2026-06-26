var AVATAR_COLORS = [
  '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30',
  '#5AC8FA', '#FF2D55', '#5856D6', '#00C7BE', '#FF6482'
];

var AVATAR_PRESETS = [
  '#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30',
  '#5AC8FA', '#FF2D55', '#5856D6', '#00C7BE', '#FF6482',
  '#8E8E93', '#636366', '#FFCC00', '#00D4FF', '#BF5AF2'
];

function ensureUTC(time) {
  if (!time) return time;
  var str = String(time);
  if (str.indexOf('T') === -1) {
    str = str.replace(' ', 'T');
  }
  if (str.indexOf('Z') === -1 && str.indexOf('+') === -1 && str.indexOf('-', 6) === -1) {
    str = str + 'Z';
  }
  return str;
}

function formatTime(time) {
  if (!time) return '';
  var date = new Date(ensureUTC(time));
  if (isNaN(date.getTime())) return '';
  var now = new Date();
  var diff = now.getTime() - date.getTime();
  if (diff < 0) diff = 0;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
  var m = date.getMonth() + 1;
  var d = date.getDate();
  return m + '月' + d + '日';
}

function formatTimeShort(time) {
  if (!time) return '';
  var date = new Date(ensureUTC(time));
  if (isNaN(date.getTime())) return '';
  var h = date.getHours().toString().padStart(2, '0');
  var min = date.getMinutes().toString().padStart(2, '0');
  return h + ':' + min;
}

function formatTimeFull(time) {
  if (!time) return '';
  var date = new Date(ensureUTC(time));
  if (isNaN(date.getTime())) return '';
  var y = date.getFullYear();
  var m = (date.getMonth() + 1).toString().padStart(2, '0');
  var d = date.getDate().toString().padStart(2, '0');
  var h = date.getHours().toString().padStart(2, '0');
  var min = date.getMinutes().toString().padStart(2, '0');
  return y + '-' + m + '-' + d + ' ' + h + ':' + min;
}

function getAvatarColor(userId) {
  if (!userId) return '#9E9E9E';
  var customColor = localStorage.getItem('avatar_color_' + userId);
  if (customColor) return customColor;
  var sum = 0;
  for (var i = 0; i < String(userId).length; i++) { sum += String(userId).charCodeAt(i); }
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function setAvatarColor(userId, color) {
  if (!userId) return;
  if (color) {
    localStorage.setItem('avatar_color_' + userId, color);
  } else {
    localStorage.removeItem('avatar_color_' + userId);
  }
}

function getAvatarText(name) {
  if (!name) return '?';
  // Array.from 正确处理 emoji / 数学粗体等代理对字符（charAt 会把它们拆成半个显示为 ?）
  var chars = Array.from(name);
  return chars[0] || '?';
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default {
  formatTime: formatTime,
  formatTimeShort: formatTimeShort,
  formatTimeFull: formatTimeFull,
  getAvatarColor: getAvatarColor,
  setAvatarColor: setAvatarColor,
  getAvatarText: getAvatarText,
  escapeHtml: escapeHtml,
  AVATAR_COLORS: AVATAR_COLORS,
  AVATAR_PRESETS: AVATAR_PRESETS
};
