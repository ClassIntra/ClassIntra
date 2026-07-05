// 共享层：ClassIntraError 错误类型 + 全局错误处理器
// 参考 Ditto packages/shared/src/errors.ts，适配 ClassIntra 的 JS + Chrome 80 约束
//
// 设计要点：
// 1. ClassIntraError 携带 code（机器可读）、message（人类可读）、details、recoverable、cause
// 2. globalErrorHandler 支持多订阅者，每个订阅者异常隔离
// 3. fromUnknown 工厂方法把任意值转为 ClassIntraError，避免 throw 非 Error 的隐患
// 4. 不依赖运行时环境（浏览器/Node 通用），但当前仅前端引用

import { ERROR_CODES } from './constants';

// ClassIntraError 构造函数
// code: ERROR_CODES 中的某个值
// message: 人类可读错误描述
// options: { details, recoverable, cause }
//   - details: 任意附加信息（对象）
//   - recoverable: 是否可恢复（默认 false）
//   - cause: 原始错误（Error 实例）
function ClassIntraError(code, message, options) {
  // 兼容 Error 子类化（不使用 class 语法，确保 Chrome 80 兼容）
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

// 原型链继承 Error
ClassIntraError.prototype = Object.create(Error.prototype);
ClassIntraError.prototype.constructor = ClassIntraError;

// 工厂方法：把任意值转为 ClassIntraError
// - 若已是 ClassIntraError，原样返回
// - 若是 Error 实例，包裹并使用其 message
// - 若是字符串，作为 message
// - 其他值，String() 转换
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

// 便捷工厂方法（参考 Ditto errors.ts 的工厂模式）
ClassIntraError.appNotFound = function(appName) {
  return new ClassIntraError(ERROR_CODES.APP_NOT_FOUND, '应用不存在: ' + appName, { details: { appName: appName } });
};

ClassIntraError.appDisabled = function(appName) {
  return new ClassIntraError(ERROR_CODES.APP_DISABLED, '应用已被禁用: ' + appName, { details: { appName: appName }, recoverable: true });
};

ClassIntraError.themeNotFound = function(themeId) {
  return new ClassIntraError(ERROR_CODES.THEME_NOT_FOUND, '主题不存在: ' + themeId, { details: { themeId: themeId } });
};

ClassIntraError.storageUnavailable = function(reason) {
  return new ClassIntraError(ERROR_CODES.STORAGE_UNAVAILABLE, '存储不可用' + (reason ? ': ' + reason : ''), { recoverable: true });
};

ClassIntraError.serviceNotFound = function(name) {
  return new ClassIntraError(ERROR_CODES.SERVICE_NOT_FOUND, '服务未注册: ' + name, { details: { serviceName: name } });
};

ClassIntraError.validationError = function(field, reason) {
  return new ClassIntraError(ERROR_CODES.VALIDATION_ERROR, '参数校验失败: ' + field + ' ' + reason, { details: { field: field, reason: reason }, recoverable: true });
};

ClassIntraError.networkError = function(message, cause) {
  return new ClassIntraError(ERROR_CODES.NETWORK_ERROR, message || '网络错误', { cause: cause, recoverable: true });
};

// ========== 全局错误处理器 ==========
// 多订阅者模式：各模块（如 crashLogger、UI toast、监控上报）可注册 handler
// handle() 调用时异常隔离，单个 handler 失败不影响其他 handler
var _handlers = [];
var _handling = false; // 防止递归

var globalErrorHandler = {
  // 注册一个错误处理订阅者，返回取消订阅函数
  // handler: function(classIntraError, originalError) { ... }
  addHandler: function(handler) {
    if (typeof handler !== 'function') return function() {};
    _handlers.push(handler);
    return function() {
      var idx = _handlers.indexOf(handler);
      if (idx !== -1) _handlers.splice(idx, 1);
    };
  },

  // 处理一个错误（同步）
  // error: 任意值，会被 fromUnknown 转换
  handle: function(error) {
    if (_handling) return; // 防止 handler 内部 throw 导致递归
    var ciError = ClassIntraError.fromUnknown(error);
    _handling = true;
    // 复制 handlers 数组，防止遍历过程中被修改
    var snapshot = _handlers.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](ciError, error);
      } catch (e) {
        // handler 异常仅 console.error，不传播、不递归
        try { console.error('[globalErrorHandler] handler failed:', e); } catch (_) {}
      }
    }
    _handling = false;
  },

  // 当前注册的 handler 数量（供调试/测试用）
  handlerCount: function() {
    return _handlers.length;
  },

  // 清空所有 handler（仅供测试用）
  _reset: function() {
    _handlers = [];
  }
};

export {
  ClassIntraError,
  globalErrorHandler
};
