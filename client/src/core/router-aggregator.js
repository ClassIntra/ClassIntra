// 前端聚合层：路由聚合器
// 从 apps/*/manifest.json 聚合 Vue Router 路由表
// 同时处理 frontend.route（主路由）和 frontend.extraRoutes（附加路由，如 cloud-picker）
// 输出 ROUTE_APP_MAP 用于应用管控检查

import { loadManifests, getComponent } from './manifest-loader';

var manifests = loadManifests();
var appRoutes = [];
var ROUTE_APP_MAP = {};

manifests.forEach(function(m) {
  if (!m.frontend || !m.frontend.route) return;
  // 主路由
  if (m.frontend.component) {
    var mainLoader = getComponent(m.name, m.frontend.component);
    if (!mainLoader) {
      console.error('[router-aggregator] 找不到主组件:', m.name, m.frontend.component);
    } else {
      appRoutes.push({
        path: m.frontend.route,
        name: m.frontend.routeName,
        component: mainLoader,
        meta: { requiresAuth: true, appName: m.name }
      });
      ROUTE_APP_MAP[m.frontend.route] = m.name;
    }
  }
  // 附加路由（如 cloud-picker、cloud-upload）
  if (m.frontend.extraRoutes && m.frontend.extraRoutes.length) {
    m.frontend.extraRoutes.forEach(function(er) {
      var loader = getComponent(m.name, er.component);
      if (!loader) {
        console.error('[router-aggregator] 找不到附加组件:', m.name, er.component);
        return;
      }
      appRoutes.push({
        path: er.path,
        name: er.routeName,
        component: loader,
        meta: { requiresAuth: er.requiresAuth !== false, appName: m.name }
      });
      // 附加路由也加入 ROUTE_APP_MAP（除非显式声明不纳入管控）
      if (er.appControl !== false) {
        ROUTE_APP_MAP[er.path] = m.name;
      }
    });
  }
});

export { appRoutes, ROUTE_APP_MAP };
