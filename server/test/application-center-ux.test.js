var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var routesDir = path.join(__dirname, '..', 'src', 'routes');
var marketRoute = fs.readFileSync(path.join(routesDir, 'market.js'), 'utf8');
var adminRoute = fs.readFileSync(path.join(routesDir, 'admin.js'), 'utf8');

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
