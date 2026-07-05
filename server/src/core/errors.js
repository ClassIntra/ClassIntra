// 后端核心：ClassIntraError 错误类型 + 全局错误处理器
// 与 shared/src/errors.js 保持逻辑同步，但采用 CommonJS 语法（后端专用）
// 参考 Ditto packages/shared/src/errors.ts
//
// 注意：修改此文件时请同步 shared/src/errors.js 和 shared/src/constants.js

var crashLogger = require('../utils/crash-logger');

// ========== 错误码 ==========
// 与 shared/src/constants.js 中的 ERROR_CODES 保持同步
var ERROR_CODES = {
  STORAGE_UNAVAILABLE: 'CLASSINTRA_STORAGE_UNAVAILABLE',
  STORAGE_QUOTA_EXCEEDED: 'CLASSINTRA_STORAGE_QUOTA_EXCEEDED',
  STORAGE_CORRUPTED: 'CLASSINTRA_STORAGE_CORRUPTED',
  APP_NOT_FOUND: 'CLASSINTRA_APP_NOT_FOUND',
  APP_DISABLED: 'CLASSINTRA_APP_DISABLED',
  APP_LOAD_FAILED: 'CLASSINTRA_APP_LOAD_FAILED',
  THEME_NOT_FOUND: 'CLASSINTRA_THEME_NOT_FOUND',
  THEME_INVALID: 'CLASSINTRA_THEME_INVALID',
  INTEGRATION_UNAUTHORIZED: 'CLASSINTRA_INTEGRATION_UNAUTHORIZED',
  INTEGRATION_FORBIDDEN: 'CLASSINTRA_INTEGRATION_FORBIDDEN',
  INTEGRATION_TIMEOUT: 'CLASSINTRA_INTEGRATION_TIMEOUT',
  INTEGRATION_INVALID_ENVELOPE: 'CLASSINTRA_INTEGRATION_INVALID_ENVELOPE',
  INTEGRATION_UNKNOWN_CHANNEL: 'CLASSINTRA_INTEGRATION_UNKNOWN_CHANNEL',
  SERVICE_NOT_FOUND: 'CLASSINTRA_SERVICE_NOT_FOUND',
  SERVICE_UNAVAILABLE: 'CLASSINTRA_SERVICE_UNAVAILABLE',
  SERVICE_ALREADY_REGISTERED: 'CLASSINTRA_SERVICE_ALREADY_REGISTERED',
  PERMISSION_DENIED: 'CLASSINTRA_PERMISSION_DENIED',
  NETWORK_ERROR: 'CLASSINTRA_NETWORK_ERROR',
  DB_ERROR: 'CLASSINTRA_DB_ERROR',
  VALIDATION_ERROR: 'CLASSINTRA_VALIDATION_ERROR',
  NOT_FOUND: 'CLASSINTRA_NOT_FOUND',
  CONFLICT: 'CLASSINTRA_CONFLICT',
  RATE_LIMITED: 'CLASSINTRA_RATE_LIMITED',
  INTERNAL_ERROR: 'CLASSINTRA_INTERNAL_ERROR',
  UNKNOWN: 'CLASSINTRA_UNKNOWN'
};

// ClassIntraError 构造函数
// 与 shared/src/errors.js 中的 ClassIntraError 保持同步
function ClassIntraError(code, message, options) {
  var err = Error.call(this, message);
  this.message = message || '';
  this.name = 'ClassIntraError';
  this.code = code || ERROR_CODES.UNKNOWN;
  if (options) {
    this.details = options.details;
    this.recoverable = options.recoverable === true;
    this.cause = options.cause;
  } else {
    this.recoverable = false;
  }
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, ClassIntraError);
  }
  return this;
}

ClassIntraError.prototype = Object.create(Error.prototype);
ClassIntraError.prototype.constructor = ClassIntraError;

ClassIntraError.fromUnknown = function(error, fallbackCode) {
  if (error instanceof ClassIntraError) return error;
  var code = fallbackCode || ERROR_CODES.UNKNOWN;
  if (error instanceof Error) {
    return new ClassIntraError(code, error.message, { cause: error });
  }
  if (typeof error === 'string') {
    return new ClassIntraError(code, error);
  }
  return new ClassIntraError(code, String(error));
};

// ========== 全局错误处理器 ==========
// 后端版本：内置 crashLogger 订阅，自动写入 crash.log
var _handlers = [];
var _handling = false;

// 注册 crashLogger 作为默认 handler
_handlers.push(function(ciError, originalError) {
  crashLogger.writeCrashLog('GLOBAL_ERROR_HANDLER', ciError);
});

var globalErrorHandler = {
  addHandler: function(handler) {
    if (typeof handler !== 'function') return function() {};
    _handlers.push(handler);
    return function() {
      var idx = _handlers.indexOf(handler);
      if (idx !== -1) _handlers.splice(idx, 1);
    };
  },

  handle: function(error) {
    if (_handling) return;
    var ciError = ClassIntraError.fromUnknown(error);
    _handling = true;
    var snapshot = _handlers.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](ciError, error);
      } catch (e) {
        try { console.error('[globalErrorHandler] handler failed:', e); } catch (_) {}
      }
    }
    _handling = false;
  },

  handlerCount: function() {
    return _handlers.length;
  },

  _reset: function() {
    // 重新注册 crashLogger
    _handlers = [];
    _handlers.push(function(ciError) {
      crashLogger.writeCrashLog('GLOBAL_ERROR_HANDLER', ciError);
    });
  }
};

module.exports = {
  ERROR_CODES: ERROR_CODES,
  ClassIntraError: ClassIntraError,
  globalErrorHandler: globalErrorHandler
};
