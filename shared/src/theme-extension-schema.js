// 共享层：扩展主题 Manifest Schema 定义 + 验证器
// ============================================================
// 与内置主题 manifest（themes/*/manifest.json，字段较简单）不同，
// 扩展主题 manifest 需描述：
//   - 扩展元信息（schema/id/name/version/author/homepage）
//   - 引擎兼容性（engine.min）
//   - 主题类型（kind=extension, type=static|dynamic）
//   - 颜色模式（colorMode=light|dark|both）
//   - 静态 token（shape/motion/shadow，可直接定义在 manifest 内）
//   - 动态色入口（dynamicColor: './dynamic-color.js'）
//   - 应用入口（entry: './apply.js'）
//   - 静态 token 文件（tokens: './tokens.js'）
//   - 能力声明（capabilities: ['dynamic-color', 'shape-shift', ...]）
//
// 验证策略：
//   - errors: 阻断性错误（缺 id/name/entry，schema 版本不兼容）
//   - warnings: 非阻断（缺 author/homepage/shape 等，使用默认值）
//   - 返回归一化后的 manifest（补充缺省值）

// ========== Schema 版本 ==========
var SCHEMA_VERSION = 'classintra-theme-extension/v1';

// ========== 能力枚举 ==========
var CAPABILITIES = ['dynamic-color', 'shape-shift', 'tonal-palette', 'motion-tuning'];

// ========== 简易 semver 校验 ==========
var SEMVER_RE = /^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/;

// HEX 颜色校验（#RRGGBB 或 #RGB）
var HEX_RE = /^#([a-f\d]{6}|[a-f\d]{3})$/i;

// ========== 验证器 ==========
// m: 扩展主题 manifest 对象
// 返回 { valid, errors, warnings, manifest }
function validateThemeExtensionManifest(m) {
  var errors = [];
  var warnings = [];

  if (!m || typeof m !== 'object') {
    return {
      valid: false,
      errors: ['扩展主题 manifest 必须是对象'],
      warnings: warnings,
      manifest: null
    };
  }

  // schema 字段（必须，且必须等于当前版本）
  if (!m.schema || typeof m.schema !== 'string') {
    errors.push('schema 字段缺失或非字符串（当前支持：' + SCHEMA_VERSION + '）');
  } else if (m.schema !== SCHEMA_VERSION) {
    errors.push('schema 版本 "' + m.schema + '" 不被支持（当前仅支持：' + SCHEMA_VERSION + '）');
  }

  // id 字段（必须，kebab-case）
  if (!m.id || typeof m.id !== 'string') {
    errors.push('id 字段缺失或非字符串');
  } else if (!/^[a-z][a-z0-9-]*$/.test(m.id)) {
    warnings.push('id 建议使用 kebab-case: ' + m.id);
  } else if (m.id === 'light' || m.id === 'dark') {
    errors.push('id "' + m.id + '" 与内置主题冲突，扩展主题禁止使用此 id');
  }

  // name 字段（必须）
  if (!m.name || typeof m.name !== 'string') {
    errors.push('name 字段缺失或非字符串');
  }

  // version 字段（可选，缺省 '0.0.0'）
  var version = m.version || '0.0.0';
  if (m.version !== undefined && !SEMVER_RE.test(m.version)) {
    warnings.push('version "' + m.version + '" 不符合 semver 规范');
  }

  // kind 字段（可选，缺省 'extension'）
  var kind = m.kind || 'extension';
  if (kind !== 'extension') {
    warnings.push('kind 字段当前仅支持 "extension"，已降级');
    kind = 'extension';
  }

  // type 字段（可选，缺省 'static'）
  var type = m.type || 'static';
  if (['static', 'dynamic'].indexOf(type) === -1) {
    warnings.push('type 字段值 "' + type + '" 不在枚举中，已降级为 "static"');
    type = 'static';
  }

  // colorMode 字段（可选，缺省 'both'）
  var colorMode = m.colorMode || 'both';
  if (['light', 'dark', 'both'].indexOf(colorMode) === -1) {
    warnings.push('colorMode 字段值 "' + colorMode + '" 不在枚举中，已降级为 "both"');
    colorMode = 'both';
  }

  // base 字段（可选，缺省 'auto'）：继承哪个内置主题作为基础
  var base = m.base || 'auto';
  if (['auto', 'light', 'dark'].indexOf(base) === -1) {
    warnings.push('base 字段值 "' + base + '" 不在枚举中，已降级为 "auto"');
    base = 'auto';
  }

  // entry 字段（必须，扩展应用入口）
  if (!m.entry || typeof m.entry !== 'string') {
    errors.push('entry 字段缺失或非字符串（扩展应用入口文件路径）');
  }

  // tokens 字段（可选，但强烈推荐）
  if (m.tokens !== undefined && (typeof m.tokens !== 'string' || !m.tokens)) {
    warnings.push('tokens 字段应为字符串（token 文件路径）');
  }

  // dynamicColor 字段（type=dynamic 时必须，static 时忽略）
  if (type === 'dynamic') {
    if (!m.dynamicColor || typeof m.dynamicColor !== 'string') {
      errors.push('type=dynamic 时 dynamicColor 字段必须提供（动态色生成器路径）');
    }
  }

  // defaultSeed 字段（type=dynamic 时推荐提供，且必须为合法 HEX）
  var defaultSeed = m.defaultSeed;
  if (defaultSeed !== undefined) {
    if (typeof defaultSeed !== 'string' || !HEX_RE.test(defaultSeed)) {
      warnings.push('defaultSeed "' + defaultSeed + '" 不是合法的 HEX 颜色（#RRGGBB 或 #RGB）');
      defaultSeed = undefined;
    }
  }
  if (type === 'dynamic' && !defaultSeed) {
    warnings.push('type=dynamic 时建议提供 defaultSeed（缺省将使用 #0061A4）');
    defaultSeed = '#0061A4';
  }

  // engine.min 字段（可选，引擎兼容性检查）
  if (m.engine !== undefined) {
    if (typeof m.engine !== 'object' || m.engine === null) {
      warnings.push('engine 字段应为对象 { min, max }');
    } else if (m.engine.min !== undefined && !SEMVER_RE.test(m.engine.min)) {
      warnings.push('engine.min "' + m.engine.min + '" 不符合 semver 规范');
    }
  }

  // shape 字段（可选，结构检查）
  if (m.shape !== undefined) {
    if (typeof m.shape !== 'object' || m.shape === null) {
      warnings.push('shape 字段应为对象 { xs, sm, md, lg, xl, 2xl, 3xl, pill }');
    } else {
      var shapeKeys = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'pill'];
      for (var i = 0; i < shapeKeys.length; i++) {
        var k = shapeKeys[i];
        if (m.shape[k] !== undefined && typeof m.shape[k] !== 'string') {
          warnings.push('shape.' + k + ' 应为字符串（CSS 长度值）');
        }
      }
    }
  }

  // motion 字段（可选，结构检查）
  if (m.motion !== undefined) {
    if (typeof m.motion !== 'object' || m.motion === null) {
      warnings.push('motion 字段应为对象');
    }
  }

  // shadow 字段（可选，结构检查）
  if (m.shadow !== undefined) {
    if (typeof m.shadow !== 'object' || m.shadow === null) {
      warnings.push('shadow 字段应为对象 { light, dark }');
    } else if (m.shadow.light !== undefined && typeof m.shadow.light !== 'object') {
      warnings.push('shadow.light 应为对象 { sm, md, lg, xl }');
    } else if (m.shadow.dark !== undefined && typeof m.shadow.dark !== 'object') {
      warnings.push('shadow.dark 应为对象 { sm, md, lg, xl }');
    }
  }

  // capabilities 字段（可选，数组，值必须在 CAPABILITIES 枚举内）
  if (m.capabilities !== undefined) {
    if (!Array.isArray(m.capabilities)) {
      warnings.push('capabilities 应为数组类型，已忽略');
    } else {
      for (var j = 0; j < m.capabilities.length; j++) {
        if (CAPABILITIES.indexOf(m.capabilities[j]) === -1) {
          warnings.push('capabilities["' + m.capabilities[j] + '"] 不在枚举中，将被忽略');
        }
      }
    }
  }

  // 归一化后的 manifest（补充缺省值，不修改原对象）
  var normalized = Object.assign({}, m, {
    schema: SCHEMA_VERSION,
    kind: kind,
    type: type,
    colorMode: colorMode,
    base: base,
    version: version,
    capabilities: Array.isArray(m.capabilities) ? m.capabilities.filter(function(c) {
      return CAPABILITIES.indexOf(c) !== -1;
    }) : []
  });
  if (type === 'dynamic' && defaultSeed) {
    normalized.defaultSeed = defaultSeed;
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    manifest: normalized
  };
}

export {
  SCHEMA_VERSION,
  CAPABILITIES,
  SEMVER_RE,
  HEX_RE,
  validateThemeExtensionManifest
};
