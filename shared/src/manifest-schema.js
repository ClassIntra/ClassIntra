// 共享层：Manifest Schema 定义 + 验证器
// 参考 Ditto packages/core/src/types.ts:25-69，适配 ClassIntra 的 JS + Chrome 80 约束
//
// 设计要点：
// 1. type/version 字段为新增，缺省时 type='app'、version='0.0.0'，向后兼容
// 2. validateManifest 返回 { valid, errors, warnings }，不抛异常
// 3. 验证策略：errors 阻断性错误（缺 name/label），warnings 非阻断（缺 icon/color 等）
// 4. 前后端共用此契约：前端 import（ES module），后端在 server/src/core/manifest-schema.js 维护 CommonJS 版
//
// 第十轮新增（第三期「规范收敛」）：
//   - sdk           声明所需的 SDK 主版本（如 "1"）。不满足时应用进入错误态而非静默失败。
//   - capabilities  能力披露清单（非拦截，仅用于安装前告知用户）。
//   - layout        布局偏好（fullscreen / sheet / window），供 AppShell 决定挂载形态。
//
// ⚠️ 注意（重要，易踩坑）：
//   market-apps/ 下走的是 server/src/core/market-service.js 扫描 +
//   client/src/core/market-registry.js 的 _validateMarketManifest()（独立实现），
//   不经过本文件。给市场 manifest 加新字段必须同步改 _validateMarketManifest()，
//   否则字段会被静默丢弃。

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
  frontend: {
    type: 'object', required: false, description: '前端配置' },
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

// 当前 SDK 主版本。第三方 `sdk` 字段与此比较主版本号：
//   相等  -> 正常
//   小于  -> 正常（向后兼容旧应用）
//   大于  -> 应用需要的 SDK 比系统新，进入错误态（而非静默失败）
var CURRENT_SDK_VERSION = '1';

// ========== 能力清单（披露用，非拦截） ==========
// ClassIntra 采「开放模型，不设沙箱，信任开发者」（用户已决策），
// 因此 capabilities 不用于权限拦截，只用于：
//   1. 安装前向用户展示「这个应用会用到什么」
//   2. 市场审核的参考依据
// 命名与 SDK 命名空间对齐（context.data / context.system / ...）。
var KNOWN_CAPABILITIES = [
  // 数据
  'data.storage', 'data.realtime', 'data.http',
  // 系统
  'system.notification', 'system.clipboard', 'system.share', 'system.navigate',
  // 界面
  'ui.toast', 'ui.modal', 'ui.sheet',
  // 应用自身
  'app.config', 'app.storage',
  // 设备
  'device.info', 'device.filePicker', 'device.camera'
];

// ========== 布局模式 ==========
var LAYOUT_MODES = ['fullscreen', 'sheet', 'window'];

// 简易 semver 校验：x.y.z（允许前导 v）
var SEMVER_RE = /^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/;
// 主版本号：纯数字（用于 sdk 字段）
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

  // ---- sdk 字段：版本兼容性检查（阻断性） ----
  var sdk = m.sdk || CURRENT_SDK_VERSION;
  if (typeof sdk !== 'string' || !MAJOR_RE.test(String(sdk))) {
    warnings.push('sdk 字段应为纯数字主版本字符串（如 "1"），已按缺省 "' + CURRENT_SDK_VERSION + '" 处理');
    sdk = CURRENT_SDK_VERSION;
  }
  var sdkNum = parseInt(sdk, 10);
  var curNum = parseInt(CURRENT_SDK_VERSION, 10);
  if (sdkNum > curNum) {
    errors.push(
      '此应用要求 SDK v' + sdk + '，当前系统为 v' + CURRENT_SDK_VERSION +
      '——请升级 ClassIntra 后再安装'
    );
  }

  // ---- capabilities 字段：披露用，非拦截 ----
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
          // 未知能力不阻断（开放模型），但提示，便于发现拼写错误或新能力待登记
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
  // 此前 3 个官方 manifest（admin / bot-admin / market）已在用，但未登记进 schema，
  // 导致该字段无法被校验、也不会出现在第三方文档中。此处补齐。
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

export {
  FIELD_DEFS, SEMVER_RE, MAJOR_RE, CURRENT_SDK_VERSION,
  KNOWN_CAPABILITIES, KNOWN_ROLES, LAYOUT_MODES, compareVersions, validateManifest
};
