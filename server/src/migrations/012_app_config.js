// 迁移 012：应用/插件配置表（app_config）
//
// 背景：应用/插件的配置项此前只存在于 .env 文件，安装链路完全感知不到——
// 管理员从市场装完插件后不知道要配什么、去哪配，插件静默跑在缺省值上。
// manifest 现可声明 config 配置项（见 shared/src/manifest-schema.js），
// 管理端在安装时检测缺失并引导填写，值统一存入本表。
//
// 读取回退顺序：app_config 表 → process.env → manifest.config[].default
// （见 server/src/utils/app-config.js）
//
// 幂等性说明：IF NOT EXISTS。

function up(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS app_config (' +
    '  app_name TEXT NOT NULL,' +
    '  config_key TEXT NOT NULL,' +
    '  config_value TEXT,' +
    '  updated_at INTEGER,' +
    '  PRIMARY KEY (app_name, config_key)' +
    ')'
  );
}

module.exports = { version: 12, name: 'app_config', up: up };
