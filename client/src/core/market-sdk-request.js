// Opt-in SDK v1 request contract. Existing get/post keep their axios responses.
// One request = one transport call; callers decide whether retrying is safe.
function sdkError(code, message, status, details, retryAfterMs) {
  var error = new Error(message);
  error.name = 'SdkRequestError';
  error.code = code;
  error.status = status || 0;
  error.details = details === undefined ? null : details;
  error.retryAfterMs = retryAfterMs === undefined ? null : retryAfterMs;
  error.retryable = code === 'SDK_NETWORK_ERROR' || code === 'SDK_TIMEOUT' ||
    [408, 425, 429, 500, 502, 503, 504].indexOf(error.status) !== -1;
  return error;
}

function normalizedError(error) {
  if (error && error.name === 'SdkRequestError') return error;
  if (error && (error.code === 'ERR_CANCELED' || error.name === 'AbortError')) {
    return sdkError('SDK_CANCELLED', '请求已取消');
  }
  if (error && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
    return sdkError('SDK_TIMEOUT', '请求超时，请稍后重试');
  }
  var response = error && error.response;
  if (!response) return sdkError('SDK_NETWORK_ERROR', error && error.message || '网络暂时不可用');
  var body = response.data;
  var headers = response.headers || {};
  var rawRetry = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'] || headers['Retry-After'];
  var retryAfter = null;
  if (rawRetry !== undefined && rawRetry !== null && String(rawRetry).trim()) {
    var seconds = Number(rawRetry);
    if (isFinite(seconds) && seconds >= 0) retryAfter = seconds * 1000;
    else {
      var date = Date.parse(rawRetry);
      if (isFinite(date)) retryAfter = Math.max(0, date - Date.now());
    }
  }
  return sdkError(body && body.error_code || 'SDK_HTTP_ERROR',
    body && body.message || error.message || '请求失败', response.status,
    body && body.data, retryAfter);
}

function validUrl(url) {
  if (typeof url !== 'string' || url.charAt(0) !== '/' || url.indexOf('//') === 0 || /[\\\x00-\x20]/.test(url)) return false;
  var pathname = url.split(/[?#]/)[0];
  var parts = pathname.split('/');
  for (var i = 1; i < parts.length; i++) {
    var part;
    try { part = decodeURIComponent(parts[i]); } catch (e) { return false; }
    if (part === '.' || part === '..' || /[%\\/\x00-\x1f]/.test(part)) return false;
  }
  return true;
}

function createSdkRequest(deps) {
  var d = deps;
  return function request(options) {
    var opts = options || {};
    if (d.isDisposed()) return Promise.reject(sdkError('SDK_DISPOSED', '应用已关闭，请重新打开后重试'));
    if (!validUrl(opts.url)) return Promise.reject(sdkError('SDK_INVALID_URL', '请求地址必须是 / 开头的宿主 API 相对路径'));
    var method = String(opts.method || 'get').toLowerCase();
    if (['get', 'post', 'put', 'patch', 'delete'].indexOf(method) === -1) return Promise.reject(sdkError('SDK_INVALID_METHOD', '不支持此请求方法'));
    if (!d.api || typeof d.api.request !== 'function') return Promise.reject(sdkError('SDK_UNAVAILABLE', '宿主请求接口不可用'));
    var timeout = opts.timeout === undefined ? 10000 : Number(opts.timeout);
    if (!isFinite(timeout) || timeout < 0) return Promise.reject(sdkError('SDK_INVALID_OPTIONS', 'timeout 必须是非负毫秒数'));
    var signal = opts.signal;
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      return Promise.reject(sdkError('SDK_INVALID_OPTIONS', 'signal 必须是 AbortSignal'));
    }
    var identity = d.getIdentity();
    return new Promise(function(resolve, reject) {
      var settled = false;
      var timer = null;
      var unregister = function() {};
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      function cleanup() {
        if (timer !== null) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', cancel);
        unregister();
      }
      function fail(error, abort) {
        if (settled) return;
        settled = true;
        cleanup();
        if (abort && controller) controller.abort();
        reject(error);
      }
      function cancel() { fail(sdkError('SDK_CANCELLED', '请求已取消'), true); }
      unregister = d.onDestroy(function() { fail(sdkError('SDK_DISPOSED', '应用已关闭，请重新打开后重试'), true); });
      if (signal) {
        signal.addEventListener('abort', cancel);
        if (signal.aborted) { cancel(); return; }
      }
      if (timeout > 0) timer = setTimeout(function() { fail(sdkError('SDK_TIMEOUT', '请求超时，请稍后重试'), true); }, timeout);
      var config = { url: opts.url, method: method, timeout: timeout };
      ['params', 'data', 'headers'].forEach(function(key) { if (opts[key] !== undefined) config[key] = opts[key]; });
      if (controller) config.signal = controller.signal;
      else if (signal) config.signal = signal;
      Promise.resolve().then(function() {
        if (settled) return;
        return d.api.request(config);
      }).then(function(response) {
        if (settled) return;
        if (d.getIdentity() !== identity) throw sdkError('SDK_ACCOUNT_CHANGED', '账号已切换，请重新读取数据');
        var body = response && response.data;
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.code !== 'number') {
          throw sdkError('SDK_INVALID_RESPONSE', '服务器返回的数据格式无效');
        }
        if (body.code !== 200) {
          throw normalizedError({ response: { status: body.code, data: body, headers: response.headers }, message: body.message });
        }
        settled = true;
        cleanup();
        resolve(body.data);
      }).catch(function(error) {
        if (settled) return;
        if (d.getIdentity() !== identity) fail(sdkError('SDK_ACCOUNT_CHANGED', '账号已切换，请重新读取数据'));
        else fail(normalizedError(error));
      });
    });
  };
}

export { createSdkRequest };
