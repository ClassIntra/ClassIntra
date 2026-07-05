// 前端核心：PersistenceStore 持久化存储
// 参考 Ditto packages/core/src/persistence/store.ts
//
// 设计要点：
// 1. localStorage 优先，memory 降级（隐私模式或 storage 被禁用时）
// 2. prefix 隔离命名空间，避免与其他应用冲突
// 3. MigrationStep 支持数据迁移（按 version 升序执行）
// 4. onChange 订阅机制，key 变化时通知订阅者
// 5. Chrome 80 兼容：不使用可选链、空值合并等
// 6. 单例模式 getDefaultStore()

import { ClassIntraError } from '@shared/errors';
import { ERROR_CODES, STORAGE_PREFIX } from '@shared/constants';

// 检测 localStorage 是否可用
function _detectLocalStorage() {
  try {
    var testKey = '__ci_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
}

// PersistenceStore 构造函数
// prefix: key 前缀（默认 'classintra:'）
// options: { migrations: [{ version: Number, migrate: function(store) {} }] }
function PersistenceStore(prefix, options) {
  this._prefix = prefix || STORAGE_PREFIX;
  this._options = options || {};
  this._memory = {}; // memory 降级存储
  this._listeners = {}; // { fullKey: [handler, ...] }
  this._useLocalStorage = _detectLocalStorage();

  // 运行迁移
  this._runMigrations();
}

// 内部：完整 key（带前缀）
PersistenceStore.prototype._fullKey = function(key) {
  return this._prefix + key;
};

// 内部：从 localStorage 或 memory 读取原始字符串
PersistenceStore.prototype._rawGet = function(fullKey) {
  if (this._useLocalStorage) {
    try {
      var v = window.localStorage.getItem(fullKey);
      return v;
    } catch (e) {
      // localStorage 异常时降级到 memory
      this._useLocalStorage = false;
      return this._memory[fullKey];
    }
  }
  return this._memory[fullKey];
};

// 内部：写入 localStorage 或 memory
PersistenceStore.prototype._rawSet = function(fullKey, value) {
  if (this._useLocalStorage) {
    try {
      window.localStorage.setItem(fullKey, value);
      return;
    } catch (e) {
      // 配额超限或 storage 被禁用时降级到 memory
      this._useLocalStorage = false;
    }
  }
  this._memory[fullKey] = value;
};

// 内部：删除
PersistenceStore.prototype._rawRemove = function(fullKey) {
  if (this._useLocalStorage) {
    try {
      window.localStorage.removeItem(fullKey);
      return;
    } catch (e) {
      this._useLocalStorage = false;
    }
  }
  delete this._memory[fullKey];
};

// 读取并反序列化 JSON
PersistenceStore.prototype.get = function(key, defaultValue) {
  var raw = this._rawGet(this._fullKey(key));
  if (raw === null || raw === undefined) return defaultValue;
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 数据损坏，返回默认值
    return defaultValue;
  }
};

// 序列化并写入
PersistenceStore.prototype.set = function(key, value) {
  var fullKey = this._fullKey(key);
  var serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (e) {
    throw ClassIntraError.fromUnknown(e, ERROR_CODES.STORAGE_CORRUPTED);
  }
  this._rawSet(fullKey, serialized);
  this._notifyChange(fullKey, value);
};

// 删除
PersistenceStore.prototype.remove = function(key) {
  var fullKey = this._fullKey(key);
  this._rawRemove(fullKey);
  this._notifyChange(fullKey, undefined);
};

// 是否存在
PersistenceStore.prototype.has = function(key) {
  var raw = this._rawGet(this._fullKey(key));
  return raw !== null && raw !== undefined;
};

// 清空所有以当前 prefix 开头的 key
PersistenceStore.prototype.clear = function() {
  var keysToRemove = [];
  if (this._useLocalStorage) {
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(this._prefix) === 0) {
          keysToRemove.push(k);
        }
      }
      for (var j = 0; j < keysToRemove.length; j++) {
        this._rawRemove(keysToRemove[j]);
      }
      return;
    } catch (e) {
      this._useLocalStorage = false;
    }
  }
  // memory 模式
  var memKeys = Object.keys(this._memory);
  for (var m = 0; m < memKeys.length; m++) {
    if (memKeys[m].indexOf(this._prefix) === 0) {
      delete this._memory[memKeys[m]];
    }
  }
};

// 订阅某个 key 的变化
// handler: function(newValue, oldFullKey) {}
// 返回取消订阅函数
PersistenceStore.prototype.onChange = function(key, handler) {
  if (typeof handler !== 'function') return function() {};
  var fullKey = this._fullKey(key);
  if (!this._listeners[fullKey]) {
    this._listeners[fullKey] = [];
  }
  this._listeners[fullKey].push(handler);
  var self = this;
  return function() {
    var list = self._listeners[fullKey];
    if (!list) return;
    var idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) delete self._listeners[fullKey];
  };
};

// 内部：通知订阅者
PersistenceStore.prototype._notifyChange = function(fullKey, newValue) {
  var list = this._listeners[fullKey];
  if (!list || list.length === 0) return;
  var snapshot = list.slice();
  for (var i = 0; i < snapshot.length; i++) {
    try {
      snapshot[i](newValue, fullKey);
    } catch (e) {
      try { console.error('[PersistenceStore] onChange handler error:', e); } catch (_) {}
    }
  }
};

// 获取当前数据版本（用于迁移后检查）
PersistenceStore.prototype.getVersion = function() {
  return this.get('__version__', 0);
};

// 内部：运行迁移
// migrations 数组按 version 升序排序，执行 version > 当前版本的 migrate
PersistenceStore.prototype._runMigrations = function() {
  var migrations = this._options.migrations;
  if (!migrations || migrations.length === 0) return;
  // 按 version 升序排序
  var sorted = migrations.slice().sort(function(a, b) {
    return (a.version || 0) - (b.version || 0);
  });
  var current = this.getVersion();
  for (var i = 0; i < sorted.length; i++) {
    var m = sorted[i];
    var v = m.version || 0;
    if (v > current) {
      try {
        m.migrate(this);
        this.set('__version__', v);
        current = v;
      } catch (e) {
        try { console.error('[PersistenceStore] migration ' + v + ' failed:', e); } catch (_) {}
        // 迁移失败不中断，保留当前版本
        break;
      }
    }
  }
};

// 是否使用 localStorage（供调试用）
PersistenceStore.prototype.isUsingLocalStorage = function() {
  return this._useLocalStorage;
};

// ========== 单例 ==========
var _defaultStore = null;
function getDefaultStore() {
  if (!_defaultStore) {
    _defaultStore = new PersistenceStore(STORAGE_PREFIX);
  }
  return _defaultStore;
}

export {
  PersistenceStore,
  getDefaultStore
};
