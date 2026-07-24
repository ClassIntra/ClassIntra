// 前端核心：扩展主题加载器
// ============================================================
// 扫描独立的顶级 theme-extensions/ 目录，加载所有 theme-extensions/*/manifest.json
// 与内置 themes/ 不同，扩展主题是"独立安装包"形式：
//   - 必须提供 entry 字段（apply.js），由加载器调用 apply(engine, manifest) 注册主题
//   - 可选提供 tokens 字段（tokens.js）作为静态 token 来源
//   - 可选提供 dynamicColor 字段（dynamic-color.js）实现动态色生成
//
// 与 theme-loader.js 的关系：
//   theme-loader.js：加载内置主题（light/dark），返回主题数组，由 ThemeEngine 单例构造时调用
//   theme-extension-loader.js：加载扩展主题（material-you 等），返回 Promise<appliedIds[]>，
//     在 ThemeEngine 初始化后由调用方按需触发（如 Settings 页"添加扩展主题"按钮）
//
// 此文件位于 client/src/core/，到 theme-extensions/ 的相对路径为 ../../../theme-extensions/

import { validateThemeExtensionManifest } from '@shared/theme-extension-schema';

// eager 加载所有扩展主题的 manifest、entry、tokens、dynamicColor 模块
// 用 glob 模式匹配，Vite 5+ 在构建时静态分析，把匹配的文件全部打包
var extManifests = import.meta.glob('../../../theme-extensions/*/manifest.json', { eager: true, query: '?json' });
var extEntries = import.meta.glob('../../../theme-extensions/*/apply.js', { eager: true });
var extTokens = import.meta.glob('../../../theme-extensions/*/tokens.js', { eager: true });
var extDynamicColors = import.meta.glob('../../../theme-extensions/*/dynamic-color.js', { eager: true });

// 缓存已扫描的扩展主题描述符
var _cache = null;

// 扫描所有扩展主题，返回描述符数组（不执行 apply）
// 每个 descriptor：{ manifest, entryModule, tokensModule, dynamicColorModule }
function scanExtensions() {
  if (_cache) return _cache;
  var descriptors = [];
  Object.keys(extManifests).forEach(function(p) {
    var mod = extManifests[p];
    var rawManifest = mod.default || mod;
    if (!rawManifest) return;

    // 验证 manifest
    var result = validateThemeExtensionManifest(rawManifest);
    if (!result.valid) {
      console.warn('[theme-extension-loader] 扩展主题 manifest 验证失败:', p, result.errors);
      return;
    }
    if (result.warnings.length > 0) {
      console.warn('[theme-extension-loader] 扩展主题 "' + rawManifest.id + '" 警告:', result.warnings);
    }
    var manifest = result.manifest;

    // 解析 entry 模块（必须存在）
    var dir = p.replace(/manifest\.json$/, '');
    var entryKey = dir + (manifest.entry || './apply.js').replace(/^\.\//, '');
    var entryModule = extEntries[entryKey];
    if (!entryModule) {
      console.warn('[theme-extension-loader] 扩展主题 "' + manifest.id + '" 的 entry 文件未找到:', entryKey);
      return;
    }

    // 解析 tokens 模块（可选）
    var tokensModule = null;
    if (manifest.tokens) {
      var tokensKey = dir + manifest.tokens.replace(/^\.\//, '');
      tokensModule = extTokens[tokensKey] || null;
      if (!tokensModule) {
        console.warn('[theme-extension-loader] 扩展主题 "' + manifest.id + '" 的 tokens 文件未找到:', tokensKey);
      }
    }

    // 解析 dynamicColor 模块（type=dynamic 时必须存在）
    var dynamicColorModule = null;
    if (manifest.type === 'dynamic' && manifest.dynamicColor) {
      var dynKey = dir + manifest.dynamicColor.replace(/^\.\//, '');
      dynamicColorModule = extDynamicColors[dynKey] || null;
      if (!dynamicColorModule) {
        console.warn('[theme-extension-loader] 扩展主题 "' + manifest.id + '" 的 dynamicColor 文件未找到:', dynKey);
      }
    }

    descriptors.push({
      manifest: manifest,
      entryModule: entryModule,
      tokensModule: tokensModule,
      dynamicColorModule: dynamicColorModule
    });
  });
  _cache = descriptors;
  return descriptors;
}

// 加载并应用所有扩展主题到 ThemeEngine
// engine: ThemeEngine 实例
// options: { apply: boolean }（apply=true 时切换到第一个扩展主题，用于调试）
// 返回 Promise<appliedIds[]>（成功应用的主题 id 数组）
function loadExtensions(engine, options) {
  options = options || {};
  var descriptors = scanExtensions();
  var appliedIds = [];

  descriptors.forEach(function(desc) {
    var entryMod = desc.entryModule;
    var entry = entryMod.default || entryMod.apply || entryMod;
    if (typeof entry !== 'function') {
      console.warn('[theme-extension-loader] 扩展主题 "' + desc.manifest.id + '" 的 entry 未导出 apply 函数，跳过');
      return;
    }
    try {
      var ids = entry(engine, desc.manifest, { apply: false });
      if (Array.isArray(ids)) {
        appliedIds = appliedIds.concat(ids);
      }
    } catch (e) {
      console.error('[theme-extension-loader] 扩展主题 "' + desc.manifest.id + '" 应用失败:', e);
    }
  });

  // 调试模式：切换到第一个扩展主题
  if (options.apply && appliedIds.length > 0 && engine && typeof engine.setTheme === 'function') {
    try {
      var currentType = engine.getCurrentThemeType ? engine.getCurrentThemeType() : 'light';
      // 找一个匹配当前类型的扩展主题 id
      var targetId = null;
      for (var i = 0; i < appliedIds.length; i++) {
        var t = engine.getTheme(appliedIds[i]);
        if (t && t.type === currentType) {
          targetId = appliedIds[i];
          break;
        }
      }
      if (targetId) {
        engine.setTheme(targetId);
      }
    } catch (e) {
      console.error('[theme-extension-loader] 调试切换主题失败:', e);
    }
  }

  return Promise.resolve(appliedIds);
}

// 列出所有可用扩展主题的元信息（不应用）
function listExtensions() {
  return scanExtensions().map(function(desc) {
    var m = desc.manifest;
    return {
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description || '',
      type: m.type,
      colorMode: m.colorMode,
      capabilities: m.capabilities || [],
      author: m.author || '',
      hasDynamicColor: !!desc.dynamicColorModule
    };
  });
}

// 获取指定扩展主题的描述符（供 ThemeEngine.setDynamicColor 使用）
function getExtension(id) {
  var descriptors = scanExtensions();
  for (var i = 0; i < descriptors.length; i++) {
    if (descriptors[i].manifest.id === id) return descriptors[i];
  }
  return null;
}

export {
  scanExtensions,
  loadExtensions,
  listExtensions,
  getExtension
};
