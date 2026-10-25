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
var CAPABILITIES = ['dynamic-color', 'shape-shift', 'tonal-palette', 'motion-tuning', 'profile-skin'];

// ========== 个人主页装扮令牌（唯一清单） ==========
// manifest 的可选 `profile` 段只允许这些键；写入后由 flattenTokens 落成
// `--ci-profile-<key>`，个人主页通过 global.scss 的 `--pf-*` 别名消费。
// 键名即 CSS 变量后缀，**改成 kebab-case**（flattenTokens 会再转一次，已是短横线则不变）。
var PROFILE_TOKENS = [
  'accent',          // 主色：按钮/tab 下划线/chip/复制按钮
  'surface',         // 浅色衬底：统计 hover、徽章底
  'card-bg',         // 卡片/头像盘底色
  'hairline',        // 发丝线与描边
  'radius',          // 卡片圆角
  'radius-sm',       // 小控件圆角
  'avatar',          // 头像直径（px）
  'cover-overlay'    // 封面蒙版（可放渐变/纹理，写在 background 上）
];

// 只接受「颜色或长度/阴影类」的简单值：挡掉 url() 之类会在样式层产生外部请求的写法。
// 装扮包将来若要放图片，应走独立字段而不是塞进变量。
var PROFILE_VALUE_RE = /^[#a-zA-Z0-9(),.%\s\/\-_]+$/;

// 把任意来源（manifest / 装扮包 / 用户自建）的 profile 对象洗成可用令牌
// 返回 { tokens, warnings }。schema 校验与运行时（core/profile-skin.js）共用同一套规则，
// 避免「校验放行、运行时又拦」这种两边不一致的经典坑。
function sanitizeProfileTokens(input) {
  var tokens = {};
  var warnings = [];
  if (input === undefined || input === null) return { tokens: tokens, warnings: warnings };
  if (typeof input !== 'object' || Array.isArray(input)) {
    warnings.push('profile 字段应为对象（允许键：' + PROFILE_TOKENS.join(' / ') + '）');
    return { tokens: tokens, warnings: warnings };
  }
  var keys = Object.keys(input);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = input[k];
    if (PROFILE_TOKENS.indexOf(k) === -1) {
      warnings.push('profile.' + k + ' 不在可覆盖清单内，已忽略（允许：' + PROFILE_TOKENS.join(' / ') + '）');
      continue;
    }
    if (typeof v !== 'string' || !v.replace(/\s/g, '')) {
      warnings.push('profile.' + k + ' 应为非空字符串');
      continue;
    }
    if (!PROFILE_VALUE_RE.test(v)) {
      warnings.push('profile.' + k + ' 的值含不安全字符（不允许引号/反斜杠/url()），已忽略');
      continue;
    }
    tokens[k] = v.trim();
  }
  return { tokens: tokens, warnings: warnings };
}

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

  // profile 字段（可选）：个人主页装扮令牌
  // 校验只做「白名单 + 值类型」，具体视觉后果由个人主页负责；
  // 未知键一律忽略而不是报错，保证旧版本端遇到新扩展不会整包失效。
  var profileSanitized = sanitizeProfileTokens(m.profile);
  (profileSanitized.warnings || []).forEach(function(w) { warnings.push(w); });
  var profile = profileSanitized.tokens;

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
  // 只有真给了可用键才挂 profile，避免每份 manifest 都多一个空对象
  if (Object.keys(profile).length > 0) {
    normalized.profile = profile;
  } else {
    delete normalized.profile;
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
  PROFILE_TOKENS,
  SEMVER_RE,
  HEX_RE,
  sanitizeProfileTokens,
  validateThemeExtensionManifest
};
