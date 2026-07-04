// 共享层：JSON 安全解析
// 前后端均可使用，无环境依赖

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str || '{}');
  } catch (e) {
    return fallback || {};
  }
}

module.exports = {
  safeJsonParse: safeJsonParse
};
