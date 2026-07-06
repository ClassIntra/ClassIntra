// 应用级缓存工具（仅 weather 应用使用，用于避免频繁调用限流天气 API）
// 全局禁缓存规则不适用于此类"外部 API 限流保护"场景
// 注意：仅对低频外部 API 使用，禁止用于本地数据/服务端 API
var cache = {};
var DEFAULT_TTL = 30000;

function get(key) {
  var entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

function set(key, data, ttl) {
  cache[key] = { data: data, timestamp: Date.now(), ttl: ttl || DEFAULT_TTL };
}

function invalidate(key) {
  if (key) {
    delete cache[key];
  } else {
    cache = {};
  }
}

function invalidatePattern(pattern) {
  var keys = Object.keys(cache);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(pattern) === 0) {
      delete cache[keys[i]];
    }
  }
}

setInterval(function() {
  var now = Date.now();
  var keys = Object.keys(cache);
  for (var i = 0; i < keys.length; i++) {
    if (now - cache[keys[i]].timestamp > cache[keys[i]].ttl) {
      delete cache[keys[i]];
    }
  }
}, 60000);

export default {
  get: get,
  set: set,
  invalidate: invalidate,
  invalidatePattern: invalidatePattern
};
