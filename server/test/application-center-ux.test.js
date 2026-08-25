var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var routesDir = path.join(__dirname, '..', 'src', 'routes');
var marketRoute = fs.readFileSync(path.join(routesDir, 'market.js'), 'utf8');
var adminRoute = fs.readFileSync(path.join(routesDir, 'admin.js'), 'utf8');
var marketService = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'market-service.js'), 'utf8');
var resourceVue = fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'resource', 'frontend', 'Resource.vue'), 'utf8');
var marketVue = fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'market', 'frontend', 'Market.vue'), 'utf8');
var marketManifest = fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'market', 'manifest.json'), 'utf8');

test('应用市场应使用专用图标', function() {
  assert.match(marketManifest, /"icon"\s*:\s*"\/resources\/public\/icons\/Market\.png"/);
});

test('资源页面不得给 template 节点设置 key', function() {
  assert.doesNotMatch(resourceVue, /<template[^>]+:key=/);
});

test('应用商店内容区域应有独立的加载条件', function() {
  assert.match(marketVue, /<template v-if="!loading">/);
  assert.doesNotMatch(marketVue, /<template v-else>\s*<section class="market-section">/);
});

test('市场源应优先使用 Gitee 并保留 GitHub 备用源', function() {
  assert.match(marketService, /id:\s*'gitee'/);
  assert.match(marketService, /https:\/\/gitee\.com\/classintra\/market\/raw\/main\//);
  assert.match(marketService, /id:\s*'github'/);
  assert.match(marketService, /https:\/\/raw\.githubusercontent\.com\/ClassIntra\/market\/main\//);
});

test('市场目录接口应返回实际成功使用的市场源', function() {
  assert.match(marketRoute, /getCatalogWithFallback/);
  assert.match(marketRoute, /source:\s*result\.source\.id/);
});

test('市场安装和更新应使用统一的备用源链路', function() {
  assert.match(marketService, /installApp[\s\S]*getCatalogWithFallback/);
  assert.match(marketService, /updateApp[\s\S]*getCatalogWithFallback/);
  assert.match(marketService, /sourceId/);
});

test('市场生命周期操作应广播统一应用变更事件', function() {
  assert.match(marketRoute, /type:\s*['"]market_app_changed['"]/);
  assert.match(marketRoute, /broadcastMarketChange\(['"]installed['"]\s*,/);
  assert.match(marketRoute, /broadcastMarketChange\(['"]updated['"]\s*,/);
  assert.match(marketRoute, /broadcastMarketChange\(['"]uninstalled['"]\s*,/);
});

test('应用管控变更应广播并包含操作者信息', function() {
  assert.match(adminRoute, /type:\s*['"]market_app_control_changed['"]/);
  assert.match(adminRoute, /updatedBy/);
});
