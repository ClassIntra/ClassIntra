// 可选模块访问器
// =====================================
// 模块化边界：核心代码只允许通过 manifest 注册表「按名称 + 存在性」访问可选模块
// （apps/ 与 plugins/ 下的业务模块），禁止静态 require 具体模块路径。
//
// 约定：
//   1. 模块不存在 / 入口缺失 / 加载抛错 → load() 一律返回 null，调用方负责降级
//   2. 核心功能在模块缺失时必须照常工作（仅跳过相关特性并输出一次告警）
//   3. 模块 ← 核心 不允许反向依赖；模块可依赖核心（shared/ 或 server core 导出）
//   4. 加载结果按模块名缓存（仅缓存成功结果）：反复调用（如天气每分钟调度）
//      不会重复执行模块顶层代码；需要热更新时显式传 forceReload（默认 false）
//   5. require 失败不缓存 → 瞬时故障（热更新替换瞬间读到半写文件、语法临时损坏）
//      会在下一次调用自动重试自愈，无需重启核心

var manifestLoader = require('./manifest-loader');

// 缓存：{ [moduleName]: moduleExports }（只存成功结果；失败/不存在不缓存）
var _cache = {};
// 本层成功 require 过的绝对路径集合：clearCache() 时同步清理 Node require 缓存，
// 否则二次 require 命中 Node 旧缓存，clearCache/forceReload 名义热更实际无效
var _loadedEntries = {};

// 按名称加载模块后端入口（relPath 缺省取 manifest.backend.entry）
// 返回模块导出对象；模块不存在 / 入口缺失 / 加载抛错一律返回 null（调用方降级）
function load(name, relPath, forceReload) {
  if (forceReload) delete _cache[name];
  if (Object.prototype.hasOwnProperty.call(_cache, name)) return _cache[name];

  var m = manifestLoader.findManifest(name);
  if (m) {
    var entry = manifestLoader.resolveModuleEntry(name, relPath || (m.backend && m.backend.entry));
    if (entry) {
      // forceReload = 显式热更意图：同步失效 Node require 缓存（未加载过则无害）
      if (forceReload) delete require.cache[entry];
      try {
        // 常规路径只 require 一次（结果入 Node require 缓存 + 本层缓存），
        // 不再每次 delete require.cache，避免周期任务反复执行模块顶层副作用
        var result = require(entry);
        _cache[name] = result; // 成功才缓存
        _loadedEntries[entry] = true;
        return result;
      } catch (e) {
        console.error('[optional-module] 加载模块 "' + name + '" 失败:', e.message);
        // 失败不缓存：文件修复后下次调用可自动恢复，无需重启核心
      }
    }
  }
  return null;
}

// 清除全部模块缓存并同步清理 Node require 缓存（开发时热加载 / 模块批量升级后调用）
function clearCache() {
  _cache = {};
  Object.keys(_loadedEntries).forEach(function(p) { delete require.cache[p]; });
  _loadedEntries = {};
}

// 模块后端是否真实存在（目录被整体删除/未安装时为 false）
function isAvailable(name) {
  return manifestLoader.hasModuleBackend(name);
}

module.exports = {
  load: load,
  isAvailable: isAvailable,
  clearCache: clearCache
};
