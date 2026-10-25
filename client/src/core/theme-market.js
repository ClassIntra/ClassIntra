// 前端核心：市场主题同步
// ============================================================
// 把 market-themes/ 下已安装的主题包（pack.json，安装时由服务端合成
// manifest + tokens 内联）注册进 ThemeEngine，使其出现在所有主题选择 UI。
//
// 契约（详见 docs/market-dev-guide.md）：
//   - 主题包为纯数据 JSON（无脚本），GET /market/themes-installed 拿清单，
//     每个主题经 ThemeEngine.loadExternalTheme(packUrl) 一次取全并注册
//   - 版本号作为加载缓存键：更新（版本变化）才重新 fetch（no-store）
//   - 安装/卸载由 WS market_theme_changed 广播驱动重同步
//   - 卸载后调用 engine.unregisterTheme；正使用中的主题回退 light
//
// 编码约定：var / function / 单引号（Chrome 80 基线）

import api from '@/utils/api';
import { getThemeEngine } from '@/core/theme-engine';

var _loadedVersions = {}; // themeId -> 已加载版本（变更才重新注册）
var _syncing = null;

function syncMarketThemes() {
  if (_syncing) return _syncing;
  _syncing = api.get('/market/themes-installed').then(function(response) {
    var themes = (response.data && response.data.data && response.data.data.themes) || [];
    var engine = getThemeEngine();
    var wanted = {};
    var jobs = [];
    themes.forEach(function(t) {
      if (!t || !t.id || !t.packUrl) return;
      wanted[t.id] = true;
      var version = t.version || '';
      if (_loadedVersions[t.id] === version) return;
      _loadedVersions[t.id] = version;
      jobs.push(
        engine.loadExternalTheme(t.packUrl + '?v=' + encodeURIComponent(version))
          .catch(function(err) {
            console.warn('[theme-market] 主题加载失败:', t.id, err && err.message);
            delete _loadedVersions[t.id];
            return null;
          })
      );
    });
    // 卸载：不在最新清单中的已注册市场主题 → 注销（内置主题不受影响）
    engine.listThemes().forEach(function(t) {
      if (!wanted[t.id] && _loadedVersions[t.id] !== undefined) {
        engine.unregisterTheme(t.id);
        delete _loadedVersions[t.id];
      }
    });
    return Promise.all(jobs).then(function() { return true; });
  }).finally(function() {
    _syncing = null;
  });
  return _syncing;
}

export { syncMarketThemes };
