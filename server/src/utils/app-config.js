// 后端工具：应用/插件配置存取（app_config 表）+ 三级回退解析
//
// 背景：应用/插件配置项此前只存在于 .env，安装链路感知不到——管理员装完插件
// 不知道要配什么、去哪配。现在 manifest 可声明 config 配置项，管理端安装时
// 检测缺失并引导填写，值统一存数据库（改配置即时生效，免改文件免重启）。
//
// 读取回退顺序：app_config 表 → process.env → manifest.config[].default
//
// 用法（插件/应用后端逐步用此替代直接读 process.env）：
//   var appConfig = require('../utils/app-config');
//   var cfg = appConfig.getConfig('astrbot-relay');   // 按类型转换后的 { key: value }
//   var status = appConfig.getConfigStatus('astrbot-relay'); // 含 missingRequired 等
//
// 注意：secret 类型值绝不出现在 getConfigStatus 的 values 里（只给 configured 布尔），
// 避免管理端轮询接口泄露明文；明文只经 getConfig 给应用后端自身。

var CONFIG_TYPES = ['string', 'number', 'boolean', 'secret'];

// 惰性加载 db（与 market-service 一致，避免模块加载顺序问题）
function _db() {
  return require('./db');
}

// 读取某应用在数据库中的原始配置值 { key: value }（均为字符串）
function readValues(appName) {
  try {
    var rows = _db().prepare('SELECT config_key, config_value FROM app_config WHERE app_name = ?').all(String(appName || ''));
    var map = {};
    rows.forEach(function (r) { map[r.config_key] = r.config_value; });
    return map;
  } catch (e) {
    // 表未初始化（迁移未跑）时静默降级为空配置，不打断应用加载
    console.warn('[app-config] 读取 app_config 失败（表可能未初始化）:', e.message);
    return {};
  }
}

// 写入配置补丁 { key: value }（值为 null/undefined 表示删除该项）
function saveValues(appName, patch) {
  if (!appName || typeof appName !== 'string') throw new Error('appName 非法');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('配置补丁应为对象');
  var now = Date.now();
  var stmt = _db().prepare(
    'INSERT INTO app_config (app_name, config_key, config_value, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(app_name, config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = excluded.updated_at'
  );
  var del = _db().prepare('DELETE FROM app_config WHERE app_name = ? AND config_key = ?');
  var written = 0;
  var run = _db().transaction(function () {
    Object.keys(patch).forEach(function (key) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('配置 key 非法: ' + key);
      var val = patch[key];
      if (val === null || val === undefined) {
        del.run(appName, key);
      } else {
        stmt.run(appName, key, String(val), now);
        written++;
      }
    });
  });
  run();
  return written;
}

// 删除某应用的全部配置（卸载应用时调用）
function clearValues(appName) {
  try {
    _db().prepare('DELETE FROM app_config WHERE app_name = ?').run(String(appName || ''));
  } catch (e) {
    console.warn('[app-config] 清理 app_config 失败:', e.message);
  }
}

// 按声明类型转换值（数据库/环境变量里一律是字符串）
function coerceValue(item, val) {
  if (val === undefined || val === null || val === '') return undefined;
  var str = String(val);
  if (item.type === 'number') {
    var num = Number(str);
    return isNaN(num) ? undefined : num;
  }
  if (item.type === 'boolean') {
    return str === 'true' || str === '1' || str === 'on';
  }
  return str; // string / secret
}

// 解析配置：对 configSchema 逐项做三级回退（DB → env → default）
// 返回 {
//   values:          { key: 转换后的值 }（含 default，缺失项无键）
//   configured:      { key: 布尔 }——DB 或 env 已显式配置（不含 default 兜底）
//   missingRequired: [{ key, label }]——required 且三级回退全空
// }
function resolveConfig(appName, configSchema) {
  var schema = Array.isArray(configSchema) ? configSchema : [];
  var stored = readValues(appName);
  var values = {};
  var configured = {};
  var missingRequired = [];
  schema.forEach(function (item) {
    if (!item || !item.key) return;
    var key = item.key;
    var raw;
    if (stored[key] !== undefined && String(stored[key]).trim() !== '') {
      raw = stored[key];
      configured[key] = true;
    } else if (process.env[key] !== undefined && String(process.env[key]).trim() !== '') {
      raw = process.env[key];
      configured[key] = true;
    } else if (item.default !== undefined && String(item.default).trim() !== '') {
      raw = item.default;
      configured[key] = false;
    }
    var val = raw === undefined ? undefined : coerceValue(item, raw);
    if (val !== undefined) values[key] = val;
    if (val === undefined && item.required) missingRequired.push({ key: key, label: item.label || key });
  });
  return { values: values, configured: configured, missingRequired: missingRequired };
}

// 按应用名从 manifest-loader 的清单中找 manifest（含市场应用与插件）
function _findManifest(appName) {
  try {
    var loader = require('../core/manifest-loader');
    var list = loader.loadManifests();
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === appName) return list[i];
    }
  } catch (e) { /* loader 不可用时按无声明处理 */ }
  return null;
}

// 应用后端取配置：返回按类型转换后的 { key: value }（无声明时回落到原始 env 读取行为之外的全空对象）
function getConfig(appName) {
  var manifest = _findManifest(appName);
  var schema = manifest && Array.isArray(manifest.config) ? manifest.config : [];
  return resolveConfig(appName, schema).values;
}

// 管理端用状态查询：values 只含非 secret 项（secret 只回 configured 布尔，不回明文）
function getConfigStatus(appName, configSchema) {
  var schema = Array.isArray(configSchema)
    ? configSchema
    : (function () {
        var manifest = _findManifest(appName);
        return manifest && Array.isArray(manifest.config) ? manifest.config : [];
      })();
  var resolved = resolveConfig(appName, schema);
  var safeValues = {};
  schema.forEach(function (item) {
    if (!item || !item.key) return;
    if (item.type === 'secret') return; // 绝不回显明文
    if (resolved.values[item.key] !== undefined) safeValues[item.key] = resolved.values[item.key];
  });
  return {
    schema: schema,
    values: safeValues,
    configured: resolved.configured,
    missingRequired: resolved.missingRequired
  };
}

module.exports = {
  CONFIG_TYPES: CONFIG_TYPES,
  readValues: readValues,
  saveValues: saveValues,
  clearValues: clearValues,
  resolveConfig: resolveConfig,
  getConfig: getConfig,
  getConfigStatus: getConfigStatus
};
