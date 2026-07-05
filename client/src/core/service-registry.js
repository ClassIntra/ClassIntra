// 前端核心：ServiceRegistry 服务注册中心
// 参考 Ditto packages/core/src/service-registry.ts
//
// 设计要点：
// 1. 懒创建：register 仅注册工厂，resolve 时才实例化
// 2. 单例缓存：首次 resolve 创建并缓存，后续 resolve 返回同一实例
// 3. 生命周期：factory 可返回 { instance, destroy }，shutdown 时逆序调用 destroy
// 4. 异常隔离：单个服务 destroy 异常不中断其他服务销毁
// 5. 异步支持：resolveAsync 支持 factory 返回 Promise
// 6. 单例模式：getServiceRegistry() 全局唯一实例

function ServiceRegistry() {
  this._factories = {};    // { name: { factory, options } }
  this._instances = {};    // { name: instance }
  this._destroyers = {};   // { name: destroyFn }
  this._order = [];        // 创建顺序（用于逆序销毁）
}

// 注册服务
// name: 服务名（如 'eventBus'、'store'、'themeEngine'）
// factory: function(registry) => instance | { instance, destroy }
// options: { singleton: true }（默认 true，false 时每次 resolve 创建新实例）
ServiceRegistry.prototype.register = function(name, factory, options) {
  if (!name || typeof factory !== 'function') {
    throw new Error('ServiceRegistry.register: name 和 factory 必填');
  }
  this._factories[name] = {
    factory: factory,
    options: options || { singleton: true }
  };
};

// 同步解析服务（懒创建 + 缓存）
ServiceRegistry.prototype.resolve = function(name) {
  if (this._instances[name]) {
    return this._instances[name];
  }
  var entry = this._factories[name];
  if (!entry) {
    return undefined;
  }
  var result = entry.factory(this);
  // 支持 { instance, destroy } 返回结构
  var instance = result;
  var destroy = null;
  if (result && typeof result === 'object' && 'instance' in result) {
    instance = result.instance;
    destroy = typeof result.destroy === 'function' ? result.destroy : null;
  }
  if (entry.options.singleton !== false) {
    this._instances[name] = instance;
    this._destroyers[name] = destroy;
    this._order.push(name);
  }
  return instance;
};

// 异步解析服务（factory 返回 Promise）
ServiceRegistry.prototype.resolveAsync = function(name) {
  var self = this;
  if (self._instances[name]) {
    return Promise.resolve(self._instances[name]);
  }
  var entry = self._factories[name];
  if (!entry) {
    return Promise.resolve(undefined);
  }
  return Promise.resolve()
    .then(function() { return entry.factory(self); })
    .then(function(result) {
      var instance = result;
      var destroy = null;
      if (result && typeof result === 'object' && 'instance' in result) {
        instance = result.instance;
        destroy = typeof result.destroy === 'function' ? result.destroy : null;
      }
      if (entry.options.singleton !== false) {
        self._instances[name] = instance;
        self._destroyers[name] = destroy;
        self._order.push(name);
      }
      return instance;
    });
};

// 检查服务是否已注册
ServiceRegistry.prototype.has = function(name) {
  return !!this._factories[name];
};

// 列出所有已注册服务名
ServiceRegistry.prototype.list = function() {
  return Object.keys(this._factories);
};

// 逆序销毁所有服务（单个异常不中断）
ServiceRegistry.prototype.shutdown = function() {
  var self = this;
  var errors = [];
  // 逆序销毁（后创建的先销毁）
  for (var i = self._order.length - 1; i >= 0; i--) {
    var name = self._order[i];
    var destroy = self._destroyers[name];
    if (typeof destroy === 'function') {
      try {
        destroy();
      } catch (e) {
        errors.push({ name: name, error: e });
        try { console.error('[ServiceRegistry] destroy ' + name + ' failed:', e); } catch (_) {}
      }
    }
  }
  self._instances = {};
  self._destroyers = {};
  self._order = [];
  return errors;
};

// ========== 单例 ==========
var _instance = null;
function getServiceRegistry() {
  if (!_instance) {
    _instance = new ServiceRegistry();
  }
  return _instance;
}

export { ServiceRegistry, getServiceRegistry };
