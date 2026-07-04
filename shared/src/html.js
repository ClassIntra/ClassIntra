// 共享层：HTML 转义工具
// 前后端均可使用，无环境依赖

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  escapeHtml: escapeHtml
};
