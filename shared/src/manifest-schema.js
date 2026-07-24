// 共享层：Manifest Schema 定义 + 验证器
// 参考 Ditto packages/core/src/types.ts:25-69，适配 ClassIntra 的 JS + Chrome 80 约束
//
// 设计要点：
// 1. type/version 字段为新增，缺省时 type='app'、version='0.0.0'，向后兼容
// 2. validateManifest 返回 { valid, errors, warnings }，不抛异常
// 3. 验证策略：errors 阻断性错误（缺 name/label），warnings 非阻断（缺 icon/color 等）
// 4. 前后端共用此契约：前端 import（ES module），后端在 server/src/core/manifest-schema.js 维护 CommonJS 版

// ========== 字段定义 ==========
var FIELD_DEFS = {
  name: { type: 'string', required: true, description: '应用唯一标识（kebab-case）' },
  label: { type: 'string', required: true, description: '显示名称' },
  icon: { type: 'string', required: false, description: '图标路径' },
  color: { type: 'string', required: false, description: '主题色（hex）' },
  category: { type: 'string', required: false, default: 'desktop', enum: ['desktop', 'system', 'hidden'], description: '应用分类' },
  order: { type: 'number', required: false, default: 99, description: '排序权重（越小越靠前）' },
  defaultEnabled: { type: 'boolean', required: false, default: true, description: '默认是否启用' },
  canDisable: { type: 'boolean', required: false, default: true, description: '是否允许用户禁用' },
  type: { type: 'string', required: false, default: 'app', enum: ['app', 'system', 'widget', 'plugin'], description: '应用类型（app=应用，plugin=插件，system=系统，widget=小组件）' },
  version: { type: 'string', required: false, default: '0.0.0', description: '语义化版本号' },
  frontend: { type: 'object', required: false, description: '前端配置' },
  backend: { type: 'object', required: false, description: '后端配置' },
  extraBackends: { type: 'array', required: false, description: '额外后端路由（阶段 0 引入）' },
  integration: { type: 'object', required: false, description: '插件联动配置（type=plugin 时使用）：contract/frontendBridge/clientEntry/channels' }
};

// 简易 semver 校验：x.y.z（允许前导 v）
var SEMVER_RE = /^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/;

// ========== 验证器 ==========
// m: manifest 对象
// 返回 { valid: boolean, errors: string[], warnings: string[], manifest: normalizedManifest }
function validateManifest(m) {
  var errors = [];
  var warnings = [];

  if (!m || typeof m !== 'object') {
    return { valid: false, errors: ['manifest 必须是对象'], warnings: warnings, manifest: null };
  }

  // 必填字段
  if (!m.name || typeof m.name !== 'string') {
    errors.push('name 字段缺失或非字符串');
  } else if (!/^[a-z][a-z0-9-]*$/.test(m.name)) {
    warnings.push('name 建议使用 kebab-case（小写字母+数字+连字符）: ' + m.name);
  }

  if (!m.label || typeof m.label !== 'string') {
    errors.push('label 字段缺失或非字符串');
  }

  // type 字段（缺省 'app'）
  var type = m.type || 'app';
  if (['app', 'system', 'widget', 'plugin'].indexOf(type) === -1) {
    warnings.push('type 字段值 "' + type + '" 不在枚举中，已降级为 "app"');
    type = 'app';
  }

  // version 字段（缺省 '0.0.0'）
  var version = m.version || '0.0.0';
  if (!SEMVER_RE.test(version)) {
    warnings.push('version "' + version + '" 不符合 semver 规范，建议格式 x.y.z');
  }

  // category 字段
  var category = m.category || 'desktop';
  if (['desktop', 'system', 'hidden'].indexOf(category) === -1) {
    warnings.push('category 字段值 "' + category + '" 不在枚举中，已降级为 "desktop"');
    category = 'desktop';
  }

  // 可选字段类型检查
  if (m.order !== undefined && typeof m.order !== 'number') {
    warnings.push('order 应为数字类型，已忽略');
  }
  if (m.defaultEnabled !== undefined && typeof m.defaultEnabled !== 'boolean') {
    warnings.push('defaultEnabled 应为布尔类型，已忽略');
  }
  if (m.canDisable !== undefined && typeof m.canDisable !== 'boolean') {
    warnings.push('canDisable 应为布尔类型，已忽略');
  }

  // frontend 结构检查
  if (m.frontend && typeof m.frontend === 'object') {
    if (!m.frontend.route || typeof m.frontend.route !== 'string') {
      warnings.push('frontend.route 缺失或非字符串');
    }
    if (!m.frontend.component || typeof m.frontend.component !== 'string') {
      warnings.push('frontend.component 缺失或非字符串');
    }
  }

  // backend 结构检查
  if (m.backend && typeof m.backend === 'object') {
    if (!m.backend.mountPath || typeof m.backend.mountPath !== 'string') {
      warnings.push('backend.mountPath 缺失或非字符串');
    }
    if (!m.backend.entry || typeof m.backend.entry !== 'string') {
      warnings.push('backend.entry 缺失或非字符串');
    }
  }

  // extraBackends 结构检查
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

  // 归一化后的 manifest（补充缺省值，不修改原对象）
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

export { FIELD_DEFS, SEMVER_RE, validateManifest };
