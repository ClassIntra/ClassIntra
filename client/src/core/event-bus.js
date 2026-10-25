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
  this._owners = {};   // { owner: [ { eventName, handler } ] } —— on 时带 owner 登记用于批量退订
}

// 注册事件监听器
// owner（可选）：订阅归属（如 'market:gomoku'）——offOwner(owner) 可整批退订，
// 第三方应用卸载时治理订阅泄漏。不影响 emit 路径（登记表独立维护）。
// 返回取消订阅函数
EventEmitter.prototype.on = function(eventName, handler, owner) {
  if (typeof eventName !== 'string' || typeof handler !== 'function') {
    return function() {};
  }
  if (!this._handlers[eventName]) {
    this._handlers[eventName] = [];
  }
  this._handlers[eventName].push(handler);
  if (owner) {
    if (!this._owners[owner]) this._owners[owner] = [];
    this._owners[owner].push({ eventName: eventName, handler: handler });
  }
  var self = this;
  return function() {
    self.off(eventName, handler);
  };
};

// 注册一次性事件监听器
EventEmitter.prototype.once = function(eventName, handler, owner) {
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
      self._reportHandlerError(eventName, wrapper, e);
    }
  };
  return this.on(eventName, wrapper, owner);
};

// 移除事件监听器
EventEmitter.prototype.off = function(eventName, handler) {
  var list = this._handlers[eventName];
  if (list) {
    var idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) delete this._handlers[eventName];
  }
  // 同步清理 owner 登记表（避免 offOwner 退订已失效引用——无害但占内存）
  var ownerKeys = Object.keys(this._owners);
  if (ownerKeys.length) {
    var self = this;
    ownerKeys.forEach(function(owner) {
      var recs = self._owners[owner];
      for (var i = recs.length - 1; i >= 0; i--) {
        if (recs[i].eventName === eventName && recs[i].handler === handler) recs.splice(i, 1);
      }
      if (recs.length === 0) delete self._owners[owner];
    });
  }
};

// 按 owner 批量退订（第三方应用卸载时治理订阅泄漏）。返回退订数量。
EventEmitter.prototype.offOwner = function(owner) {
  var recs = this._owners[owner];
  if (!recs || !recs.length) return 0;
  var count = recs.length;
  // 复制后清空登记表再逐条 off（off 内部会尝试清理登记表，先清可省功）
  var snapshot = recs.slice();
  delete this._owners[owner];
  var self = this;
  snapshot.forEach(function(rec) {
    self.off(rec.eventName, rec.handler);
  });
  return count;
};

// 各 owner 的存活订阅数（诊断用）
EventEmitter.prototype.ownerStats = function() {
  var out = {};
  var self = this;
  Object.keys(this._owners).forEach(function(owner) {
    out[owner] = self._owners[owner].length;
  });
  return out;
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
      this._reportHandlerError(eventName, snapshot[j], e);
    }
  }
};

// 报告 handler 异常（避免递归：直接 console.error + 触发 'error:handler'）
// 归因：反查该 handler 的订阅 owner（如 market:gomoku），错误可定位到具体应用
EventEmitter.prototype._reportHandlerError = function(eventName, handler, error) {
  var owner = '';
  var ownerKeys = Object.keys(this._owners);
  for (var oi = 0; oi < ownerKeys.length && !owner; oi++) {
    var recs = this._owners[ownerKeys[oi]];
    for (var ri = 0; ri < recs.length; ri++) {
      if (recs[ri].handler === handler) { owner = ownerKeys[oi]; break; }
    }
  }
  try {
    console.error('[EventBus] handler error for "' + eventName + '"' + (owner ? '（归属 ' + owner + '）' : '') + ':', error);
  } catch (_) {}
  // 触发 'error:handler'，但不再 try/catch（避免无限递归）
  // 如果 'error:handler' 的 handler 也 throw，异常会向上传播
  var errList = this._handlers['error:handler'];
  if (errList && errList.length > 0) {
    var ciError = ClassIntraError.fromUnknown(error, ERROR_CODES.INTERNAL_ERROR);
    var snapshot = errList.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i]({ event: eventName, owner: owner, error: ciError });
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
