// 后端核心：Manifest Schema 验证器（CommonJS 版）
// 与 shared/src/manifest-schema.js 逻辑同步，但 module.exports
// 后端 manifest-loader.js 调用此模块验证 manifest
//
// ⚠️ 两个文件必须保持同步。改任一处时记得同步另一处，
//    否则前后端对同一 manifest 的判定会不一致。

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
  integration: { type: 'object', required: false, description: '插件联动配置（type=plugin 时使用）：contract/frontendBridge/clientEntry/channels' },
  sdk: { type: 'string', required: false, default: '1', description: '所需 SDK 主版本（缺省视为 "1"，向后兼容旧应用）' },
  capabilities: { type: 'array', required: false, default: [], description: '能力披露清单（仅展示，不拦截）' },
  layout: { type: 'object', required: false, description: '布局偏好：mode(fullscreen/sheet/window) / resizable / minWidth / minHeight' },
  visibleRoles: { type: 'array', required: false, default: [], description: '可见角色白名单（空数组=所有角色可见）：admin / officer / student' }
};

// 合法角色枚举（与认证系统的 role 字段对齐）
var KNOWN_ROLES = ['admin', 'officer', 'student'];

// 当前 SDK 主版本（与 client/src/core/market-sdk.js 的 context.version 对齐）
var CURRENT_SDK_VERSION = '1';

// 已知能力名（披露用，非拦截）
var KNOWN_CAPABILITIES = [
  'data.storage', 'data.realtime', 'data.http',
  'system.notification', 'system.clipboard', 'system.share', 'system.navigate',
  'ui.toast', 'ui.modal', 'ui.sheet',
  'app.config', 'app.storage',
  'device.info', 'device.filePicker', 'device.camera'
];

// 布局模式枚举
var LAYOUT_MODES = ['fullscreen', 'sheet', 'window'];

var SEMVER_RE = /^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/;
var MAJOR_RE = /^\d+$/;

// 比较两个 x.y.z 版本号。返回 1 / 0 / -1
function compareVersions(a, b) {
  var pa = String(a).replace(/^v/, '').split('.').map(Number);
  var pb = String(b).replace(/^v/, '').split('.').map(Number);
  var len = Math.max(pa.length, pb.length);
  for (var i = 0; i < len; i++) {
    var va = pa[i] || 0;
    var vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

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
  if (['app', 'system', 'widget', 'plugin'].indexOf(type) === -1) {
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
    if (m.frontend.entry) {
      if (typeof m.frontend.entry !== 'string') {
        warnings.push('frontend.entry 应为字符串');
      }
    } else if (!m.frontend.component || typeof m.frontend.component !== 'string') {
      warnings.push('frontend.component 缺失或非字符串');
    }
    if (m.frontend.style && typeof m.frontend.style !== 'string') {
      warnings.push('frontend.style 应为字符串');
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

  // ---- sdk 字段：版本兼容性检查（阻断性） ----
  // 应用声明所需 SDK 主版本；大于当前系统主版本时进入错误态，
  // 而非静默失败（避免出现"装了但用不了"的黑盒体验）。
  var sdk = m.sdk || CURRENT_SDK_VERSION;
  if (typeof sdk !== 'string' || !MAJOR_RE.test(String(sdk))) {
    warnings.push('sdk 字段应为纯数字主版本字符串（如 "1"），已按缺省 "' + CURRENT_SDK_VERSION + '" 处理');
    sdk = CURRENT_SDK_VERSION;
  }
  if (parseInt(sdk, 10) > parseInt(CURRENT_SDK_VERSION, 10)) {
    errors.push(
      '此应用要求 SDK v' + sdk + '，当前系统为 v' + CURRENT_SDK_VERSION +
      '——请升级 ClassIntra 后再安装'
    );
  }

  // ---- capabilities 字段：披露用，非拦截（开放模型） ----
  var capabilities = [];
  if (m.capabilities !== undefined) {
    if (!Array.isArray(m.capabilities)) {
      warnings.push('capabilities 应为数组类型，已忽略');
    } else {
      for (var c = 0; c < m.capabilities.length; c++) {
        var cap = m.capabilities[c];
        if (typeof cap !== 'string') {
          warnings.push('capabilities[' + c + '] 应为字符串，已忽略');
          continue;
        }
        capabilities.push(cap);
        if (KNOWN_CAPABILITIES.indexOf(cap) === -1) {
          warnings.push('capabilities 中的 "' + cap + '" 不是已知能力名，请检查拼写或登记到 KNOWN_CAPABILITIES');
        }
      }
    }
  }

  // ---- layout 字段：布局偏好 ----
  var layout = null;
  var layoutWasInvalid = false;
  if (m.layout !== undefined) {
    if (!m.layout || typeof m.layout !== 'object' || Array.isArray(m.layout)) {
      warnings.push('layout 应为对象类型，已忽略');
      layoutWasInvalid = true;
    } else {
      var mode = m.layout.mode || 'fullscreen';
      if (LAYOUT_MODES.indexOf(mode) === -1) {
        warnings.push('layout.mode "' + mode + '" 不在枚举中，已降级为 "fullscreen"');
        mode = 'fullscreen';
      }
      layout = Object.assign({}, m.layout, { mode: mode });
      if (layout.resizable !== undefined && typeof layout.resizable !== 'boolean') {
        warnings.push('layout.resizable 应为布尔类型，已忽略');
        delete layout.resizable;
      }
      ['minWidth', 'minHeight'].forEach(function (k) {
        if (layout[k] !== undefined && typeof layout[k] !== 'number') {
          warnings.push('layout.' + k + ' 应为数字类型，已忽略');
          delete layout[k];
        }
      });
    }
  }

  // ---- visibleRoles 字段：可见角色白名单 ----
  var visibleRoles = [];
  if (m.visibleRoles !== undefined) {
    if (!Array.isArray(m.visibleRoles)) {
      warnings.push('visibleRoles 应为数组类型，已忽略');
    } else {
      for (var vr = 0; vr < m.visibleRoles.length; vr++) {
        var role = m.visibleRoles[vr];
        if (typeof role !== 'string') {
          warnings.push('visibleRoles[' + vr + '] 应为字符串，已忽略');
          continue;
        }
        visibleRoles.push(role);
        if (KNOWN_ROLES.indexOf(role) === -1) {
          warnings.push('visibleRoles 中的 "' + role + '" 不是已知角色（' + KNOWN_ROLES.join(' / ') + '）');
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
    canDisable: typeof m.canDisable === 'boolean' ? m.canDisable : true,
    sdk: sdk,
    capabilities: capabilities,
    visibleRoles: visibleRoles
  });
  if (layout) {
    normalized.layout = layout;
  } else if (layoutWasInvalid) {
    // layout 声明了但格式非法：显式删除，避免把原始非法值透传出去
    delete normalized.layout;
  }

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
  MAJOR_RE: MAJOR_RE,
  CURRENT_SDK_VERSION: CURRENT_SDK_VERSION,
  KNOWN_CAPABILITIES: KNOWN_CAPABILITIES,
  KNOWN_ROLES: KNOWN_ROLES,
  LAYOUT_MODES: LAYOUT_MODES,
  compareVersions: compareVersions,
  validateManifest: validateManifest
};
