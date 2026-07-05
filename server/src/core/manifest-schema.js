// 后端核心：Manifest Schema 验证器（CommonJS 版）
// 与 shared/src/manifest-schema.js 逻辑同步，但 module.exports
// 后端 manifest-loader.js 调用此模块验证 manifest

var FIELD_DEFS = {
  name: { type: 'string', required: true, description: '应用唯一标识（kebab-case）' },
  label: { type: 'string', required: true, description: '显示名称' },
  icon: { type: 'string', required: false, description: '图标路径' },
  color: { type: 'string', required: false, description: '主题色（hex）' },
  category: { type: 'string', required: false, default: 'desktop', enum: ['desktop', 'system', 'hidden'], description: '应用分类' },
  order: { type: 'number', required: false, default: 99, description: '排序权重（越小越靠前）' },
  defaultEnabled: { type: 'boolean', required: false, default: true, description: '默认是否启用' },
  canDisable: { type: 'boolean', required: false, default: true, description: '是否允许用户禁用' },
  type: { type: 'string', required: false, default: 'app', enum: ['app', 'system', 'widget'], description: '应用类型' },
  version: { type: 'string', required: false, default: '0.0.0', description: '语义化版本号' },
  frontend: { type: 'object', required: false, description: '前端配置' },
  backend: { type: 'object', required: false, description: '后端配置' },
  extraBackends: { type: 'array', required: false, description: '额外后端路由' }
};

var SEMVER_RE = /^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/;

function validateManifest(m) {
  var errors = [];
  var warnings = [];

  if (!m || typeof m !== 'object') {
    return { valid: false, errors: ['manifest 必须是对象'], warnings: warnings, manifest: null };
  }

  if (!m.name || typeof m.name !== 'string') {
    errors.push('name 字段缺失或非字符串');
  } else if (!/^[a-z][a-z0-9-]*$/.test(m.name)) {
    warnings.push('name 建议使用 kebab-case（小写字母+数字+连字符）: ' + m.name);
  }

  if (!m.label || typeof m.label !== 'string') {
    errors.push('label 字段缺失或非字符串');
  }

  var type = m.type || 'app';
  if (['app', 'system', 'widget'].indexOf(type) === -1) {
    warnings.push('type 字段值 "' + type + '" 不在枚举中，已降级为 "app"');
    type = 'app';
  }

  var version = m.version || '0.0.0';
  if (!SEMVER_RE.test(version)) {
    warnings.push('version "' + version + '" 不符合 semver 规范，建议格式 x.y.z');
  }

  var category = m.category || 'desktop';
  if (['desktop', 'system', 'hidden'].indexOf(category) === -1) {
    warnings.push('category 字段值 "' + category + '" 不在枚举中，已降级为 "desktop"');
    category = 'desktop';
  }

  if (m.order !== undefined && typeof m.order !== 'number') {
    warnings.push('order 应为数字类型，已忽略');
  }
  if (m.defaultEnabled !== undefined && typeof m.defaultEnabled !== 'boolean') {
    warnings.push('defaultEnabled 应为布尔类型，已忽略');
  }
  if (m.canDisable !== undefined && typeof m.canDisable !== 'boolean') {
    warnings.push('canDisable 应为布尔类型，已忽略');
  }

  if (m.frontend && typeof m.frontend === 'object') {
    if (!m.frontend.route || typeof m.frontend.route !== 'string') {
      warnings.push('frontend.route 缺失或非字符串');
    }
    if (!m.frontend.component || typeof m.frontend.component !== 'string') {
      warnings.push('frontend.component 缺失或非字符串');
    }
  }

  if (m.backend && typeof m.backend === 'object') {
    if (!m.backend.mountPath || typeof m.backend.mountPath !== 'string') {
      warnings.push('backend.mountPath 缺失或非字符串');
    }
    if (!m.backend.entry || typeof m.backend.entry !== 'string') {
      warnings.push('backend.entry 缺失或非字符串');
    }
  }

  if (m.extraBackends !== undefined) {
    if (!Array.isArray(m.extraBackends)) {
      warnings.push('extraBackends 应为数组类型，已忽略');
    } else {
      for (var i = 0; i < m.extraBackends.length; i++) {
        var eb = m.extraBackends[i];
        if (!eb || !eb.mountPath || !eb.entry) {
          warnings.push('extraBackends[' + i + '] 缺少 mountPath 或 entry');
        }
      }
    }
  }

  var normalized = Object.assign({}, m, {
    type: type,
    version: version,
    category: category,
    order: typeof m.order === 'number' ? m.order : 99,
    defaultEnabled: typeof m.defaultEnabled === 'boolean' ? m.defaultEnabled : true,
    canDisable: typeof m.canDisable === 'boolean' ? m.canDisable : true
  });

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings,
    manifest: normalized
  };
}

module.exports = {
  FIELD_DEFS: FIELD_DEFS,
  SEMVER_RE: SEMVER_RE,
  validateManifest: validateManifest
};
