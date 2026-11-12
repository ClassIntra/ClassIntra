var rateLimitStore = {};

function cleanupStore() {
  var now = Date.now();
  var keys = Object.keys(rateLimitStore);
  for (var i = 0; i < keys.length; i++) {
    if (now - rateLimitStore[keys[i]].windowStart > rateLimitStore[keys[i]].windowMs) {
      delete rateLimitStore[keys[i]];
    }
  }
}

// 模块级定时器只挂一次：热重载 / 多入口 require 会重复叠加清理任务。
// unref 让它不阻止进程退出（探针、CLI 尤其需要）。
var CLEANUP_TIMER_KEY = '__ci_rate_limit_cleanup_timer__';
if (!global[CLEANUP_TIMER_KEY]) {
  var cleanupTimer = setInterval(cleanupStore, 60000);
  if (cleanupTimer.unref) cleanupTimer.unref();
  global[CLEANUP_TIMER_KEY] = cleanupTimer;
}

function createRateLimiter(options) {
  var maxRequests = options.max || 100;
  var windowMs = options.windowMs || 60000;
  var message = options.message || '请求过于频繁，请稍后再试';

  return function(req, res, next) {
    var key = req.ip + ':' + (options.keyGenerator ? options.keyGenerator(req) : req.path);
    var now = Date.now();

    if (!rateLimitStore[key] || now - rateLimitStore[key].windowStart > windowMs) {
      rateLimitStore[key] = { count: 1, windowStart: now, windowMs: windowMs };
      return next();
    }

    rateLimitStore[key].count++;
    if (rateLimitStore[key].count > maxRequests) {
      return res.status(429).json({ code: 429, message: message });
    }

    next();
  };
}

module.exports = { createRateLimiter: createRateLimiter };
