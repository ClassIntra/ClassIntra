// 前端聚合层：Vuex store 模块聚合器
// 从 apps/*/manifest.json 聚合应用的 Vuex 模块
// 当前项目应用多为无独立 store 的页面（数据通过 api 直接获取），此聚合器预留扩展
//
// manifest.frontend.store 字段格式：
//   { moduleName: './frontend/store.js' }
// 聚合输出：
//   { moduleName: VuexModule }

import { loadManifests, getComponent } from './manifest-loader';

var manifests = loadManifests();
var APP_STORE_MODULES = {};

manifests.forEach(function(m) {
  if (!m.frontend || !m.frontend.store) return;
  var storeMap = m.frontend.store;
  if (typeof storeMap === 'string') {
    // 简写：store: './frontend/store.js' → moduleName = m.name
    var loader = getComponent(m.name, storeMap);
    if (loader) {
      // 注意：store 文件是 JS 模块，import.meta.glob 已加载为模块对象
      // 但 store 模块需要同步获取，Vite eager glob 已支持
      APP_STORE_MODULES[m.name] = loader;
    }
  } else if (typeof storeMap === 'object') {
    Object.keys(storeMap).forEach(function(moduleName) {
      var loader = getComponent(m.name, storeMap[moduleName]);
      if (loader) {
        APP_STORE_MODULES[moduleName] = loader;
      }
    });
  }
});

export { APP_STORE_MODULES };
