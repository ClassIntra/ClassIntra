// 后端集成层：Origin 白名单管理
// 参考 Ditto packages/integration/src/origin-registry.ts
//
// 设计要点：
// 1. 强制 origin 白名单（绝不 '*'），防跨域攻击
// 2. 支持精确匹配 + 通配符匹配（如 https://*.example.com）
// 3. 规范化 origin（去掉尾斜杠，小写）
// 4. postMessage 桥和 webhook 接收共用此模块

// 规范化 origin
// "https://example.com/" → "https://example.com"
// "HTTPS://Example.COM" → "https://example.com"
function normalizeOrigin(origin) {
  if (!origin || typeof origin !== 'string') return '';
  var trimmed = origin.trim().replace(/\/$/, '');
  // 小写化 scheme + host
  return trimmed.toLowerCase();
}

// 检查 origin 是否匹配白名单
// allowed: ['https://example.com', 'https://*.example.com', 'https://app.example.com:8080']
function isAllowed(origin, allowed) {
  if (!origin || !Array.isArray(allowed) || allowed.length === 0) return false;
  var normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  for (var i = 0; i < allowed.length; i++) {
    var pattern = normalizeOrigin(allowed[i]);
    if (!pattern) continue;
    // 精确匹配
    if (pattern === normalized) return true;
    // 通配符匹配：https://*.example.com
    if (pattern.indexOf('*.') !== -1) {
      // 将通配符转为正则：https://*.example.com → ^https://[^/]+\.example\.com$
      var regexStr = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\\./g, '[^/]+\\.');  // *. → [^/]+\.
      // 注意：上面 replace 顺序很重要，先转义点号，再处理 *.
      // 但 \. 已经把 . 转义，所以 *. 已经是 *\. ，需要匹配 *\. 转为 [^/]+\.
      // 上面的 replace 有 bug，重新实现
      var fixedRegexStr = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // 转义特殊字符
        .replace(/\*/g, '[^/]+');  // * → [^/]+
      try {
        var re = new RegExp('^' + fixedRegexStr + '$');
        if (re.test(normalized)) return true;
      } catch (e) {
        // 正则构造失败，跳过
        continue;
      }
    }
  }
  return false;
}

// 从 URL 提取 origin
// "https://example.com/path?query=1" → "https://example.com"
function extractOrigin(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    var match = url.match(/^(https?:\/\/[^/]+)/i);
    return match ? match[1].toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

// 验证 origin 格式合法
function isValidOrigin(origin) {
  if (!origin || typeof origin !== 'string') return false;
  return /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin);
}

module.exports = {
  normalizeOrigin: normalizeOrigin,
  isAllowed: isAllowed,
  extractOrigin: extractOrigin,
  isValidOrigin: isValidOrigin
};
