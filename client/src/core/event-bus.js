// 前端核心：EventBus 事件总线
// 参考 Ditto packages/core/src/event/emitter.ts
//
// 设计要点：
// 1. handler 异常隔离：单个 handler throw 不影响其他 handler
// 2. emit 时复制 handlers 数组，防止遍历中被修改
// 3. 'error:handler' 事件用于报告 handler 异常（避免递归）
// 4. 单例模式 getEventBus()
// 5. Chrome 80 兼容：不使用可选链、空值合并等 ES2020+ 语法

import { ClassIntraError } from '@shared/errors';
import { ERROR_CODES } from '@shared/constants';

function EventEmitter() {
  this._handlers = {}; // { eventName: [handler, ...] }
}

// 注册事件监听器
// 返回取消订阅函数
EventEmitter.prototype.on = function(eventName, handler) {
  if (typeof eventName !== 'string' || typeof handler !== 'function') {
    return function() {};
  }
  if (!this._handlers[eventName]) {
    this._handlers[eventName] = [];
  }
  this._handlers[eventName].push(handler);
  var self = this;
  return function() {
    self.off(eventName, handler);
  };
};

// 注册一次性事件监听器
EventEmitter.prototype.once = function(eventName, handler) {
  if (typeof eventName !== 'string' || typeof handler !== 'function') {
    return function() {};
  }
  var self = this;
  var wrapper = function() {
    // 先移除再调用，防止 handler 内部再次触发导致重入
    self.off(eventName, wrapper);
    try {
      handler.apply(null, arguments);
    } catch (e) {
      self._reportHandlerError(eventName, e);
    }
  };
  return this.on(eventName, wrapper);
};

// 移除事件监听器
EventEmitter.prototype.off = function(eventName, handler) {
  var list = this._handlers[eventName];
  if (!list) return;
  var idx = list.indexOf(handler);
  if (idx !== -1) list.splice(idx, 1);
  if (list.length === 0) delete this._handlers[eventName];
};

// 触发事件
// 所有参数（除 eventName 外）透传给 handler
// handler 异常隔离：单个 handler throw 不影响其他 handler
EventEmitter.prototype.emit = function(eventName) {
  var list = this._handlers[eventName];
  if (!list || list.length === 0) return;
  // 复制数组，防止遍历中 on/off 修改原数组
  var snapshot = list.slice();
  // 复制参数（去掉第一个 eventName）
  var args = [];
  for (var i = 1; i < arguments.length; i++) {
    args.push(arguments[i]);
  }
  for (var j = 0; j < snapshot.length; j++) {
    try {
      snapshot[j].apply(null, args);
    } catch (e) {
      this._reportHandlerError(eventName, e);
    }
  }
};

// 报告 handler 异常（避免递归：直接 console.error + 触发 'error:handler'）
EventEmitter.prototype._reportHandlerError = function(eventName, error) {
  try { console.error('[EventBus] handler error for "' + eventName + '":', error); } catch (_) {}
  // 触发 'error:handler'，但不再 try/catch（避免无限递归）
  // 如果 'error:handler' 的 handler 也 throw，异常会向上传播
  var errList = this._handlers['error:handler'];
  if (errList && errList.length > 0) {
    var ciError = ClassIntraError.fromUnknown(error, ERROR_CODES.INTERNAL_ERROR);
    var snapshot = errList.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i]({ event: eventName, error: ciError });
      } catch (_) {
        // 'error:handler' 自身异常仅 console.error，不再传播
      }
    }
  }
};

// 移除某事件的所有监听器
EventEmitter.prototype.removeAllListeners = function(eventName) {
  if (eventName) {
    delete this._handlers[eventName];
  } else {
    this._handlers = {};
  }
};

// 获取某事件的监听器数量
EventEmitter.prototype.listenerCount = function(eventName) {
  var list = this._handlers[eventName];
  return list ? list.length : 0;
};

// ========== 单例 ==========
var _instance = null;
function getEventBus() {
  if (!_instance) {
    _instance = new EventEmitter();
  }
  return _instance;
}

export {
  EventEmitter,
  getEventBus
};
