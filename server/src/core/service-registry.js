// 后端核心：ServiceRegistry 服务注册中心
// 参考 Ditto packages/core/src/service-registry.ts
//
// 与 client/src/core/service-registry.js 逻辑同步，但 module.exports
// 用于后端服务编排（如 db、cache、integration-token-service 等）

function ServiceRegistry() {
  this._factories = {};
  this._instances = {};
  this._destroyers = {};
  this._order = [];
}

ServiceRegistry.prototype.register = function(name, factory, options) {
  if (!name || typeof factory !== 'function') {
    throw new Error('ServiceRegistry.register: name 和 factory 必填');
  }
  this._factories[name] = {
    factory: factory,
    options: options || { singleton: true }
  };
};

ServiceRegistry.prototype.resolve = function(name) {
  if (this._instances[name]) {
    return this._instances[name];
  }
  var entry = this._factories[name];
  if (!entry) {
    return undefined;
  }
  var result = entry.factory(this);
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

ServiceRegistry.prototype.has = function(name) {
  return !!this._factories[name];
};

ServiceRegistry.prototype.list = function() {
  return Object.keys(this._factories);
};

ServiceRegistry.prototype.shutdown = function() {
  var self = this;
  var errors = [];
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

var _instance = null;
function getServiceRegistry() {
  if (!_instance) {
    _instance = new ServiceRegistry();
  }
  return _instance;
}

module.exports = {
  ServiceRegistry: ServiceRegistry,
  getServiceRegistry: getServiceRegistry
};
