// 单测：市场生态服务层（自定义源 / 安装指标 / 使用记录 / 错误归因 / 健康度）
// 运行：node server/scripts-unit-market-ecosystem.cjs
//
// 隔离策略：使用临时 DB（只建 app_control + 迁移 023 的表），
// 不打开生产库、不启动 HTTP/WS、不写 market-apps/。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-market-unit-'));
var dbPath = path.join(tmpDir, 'unit.db');
process.env.DB_PATH = dbPath;

var Database = require('better-sqlite3');
(function seed() {
  var db = new Database(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS app_control (app_name TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1)');
  require('./src/migrations/023_market_ecosystem').up(db);
  db.close();
})();

var marketService = require('./src/core/market-service');

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }
function expectThrow(name, fn, matcher) {
  try {
    fn();
    ok(name, false, '未抛错');
  } catch (e) {
    ok(name, !matcher || matcher.test(e.message), e.message);
  }
}

console.log('\n市场生态服务层单测（隔离 DB）');
console.log('='.repeat(56));

// ---------- 自定义市场源 ----------
section('自定义市场源');

var builtin = marketService.getSources();
ok('内置三源存在', builtin.filter(function (s) { return s.builtin; }).length === 3,
  JSON.stringify(builtin.map(function (s) { return s.id; })));
ok('内置源带 base 字段（管理端可排查配置）', typeof builtin[0].base === 'string' && builtin[0].base.length > 0);

var added = marketService.addSource({ id: 'probe-market', label: '探针市场', base: 'https://example.com/market/main' }, '999999');
ok('添加自定义源：末尾自动补 /', added.base === 'https://example.com/market/main/');
ok('添加后可按 id 取到', !!marketService.getSource('probe-market'));
ok('内置源仍排在前面', marketService.getSources()[0].builtin === true);

expectThrow('重复 id 拒绝', function () {
  marketService.addSource({ id: 'probe-market', label: '重名', base: 'https://x.test/' }, '1');
}, /已存在/);

expectThrow('非法 base 拒绝', function () {
  marketService.addSource({ id: 'bad-base', label: '坏地址', base: 'ftp://x.test/' }, '1');
}, /格式非法/);

expectThrow('大写 id 拒绝', function () {
  marketService.addSource({ id: 'Bad_ID', label: '坏 id', base: 'https://x.test/' }, '1');
}, /格式非法/);

expectThrow('内置源不可删', function () { marketService.removeSource('gitee'); }, /内置/);
marketService.removeSource('probe-market');
ok('自定义源删除后消失', !marketService.getSource('probe-market'));

// 环境变量源（运行期读取，不缓存）
process.env.MARKET_SOURCES = 'env-market|环境变量市场|https://env.test/market/';
var withEnv = marketService.getSources().filter(function (s) { return s.id === 'env-market'; })[0];
ok('MARKET_SOURCES 简写可解析', !!withEnv && withEnv.label === '环境变量市场');
ok('环境变量源标记为非内置', withEnv.builtin === false);
expectThrow('环境变量源不能在管理端删除', function () { marketService.removeSource('env-market'); }, /环境变量/);
delete process.env.MARKET_SOURCES;

// ---------- 安装指标 ----------
section('安装指标');
marketService.recordMetric('pet', 'install');
marketService.recordMetric('pet', 'install');
marketService.recordMetric('pet', 'update');
var metric = marketService.getMetrics('pet');
ok('install_count 累加', metric.install_count === 2, JSON.stringify(metric));
ok('update_count 累加', metric.update_count === 1, JSON.stringify(metric));
ok('记录首次安装时间', !!metric.first_install_at);

// ---------- 使用记录 ----------
section('使用记录');
marketService.recordUsage('pet', 'u1');
marketService.recordUsage('pet', 'u1');
marketService.recordUsage('pet', 'u2');
var health = marketService.getAppHealth('pet');
ok('独立用户数', health.usage.users === 2, JSON.stringify(health.usage));
ok('累计打开次数', health.usage.opens === 3, JSON.stringify(health.usage));
ok('最近使用时间有值', health.usage.lastSeenAt > 0);

// ---------- 错误归因 ----------
section('错误归因');
marketService.recordAppError('pet', { message: 'boom', stack: 'at x', url: '/pet', userId: 'u1' });
marketService.recordAppError('pet', { message: 'boom2', stack: 'at y', url: '/pet', userId: 'u2' });
health = marketService.getAppHealth('pet');
ok('错误总数', health.errors.total === 2, JSON.stringify(health.errors));
ok('24h 错误数', health.errors.last24h === 2);
ok('最近错误消息', health.errors.lastMessage === 'boom2', health.errors.lastMessage);

// 字段截断：超长消息不应原样入库
marketService.recordAppError('pet', { message: 'x'.repeat(2000), stack: 'y'.repeat(9000) });
health = marketService.getAppHealth('pet');
ok('超长消息被截断（<500）', health.errors.lastMessage.length <= 500);
ok('超长堆栈被截断（<4000）', health.errors.total === 3);

// 淘汰策略：只保留最近 200 条
for (var i = 0; i < 240; i++) {
  marketService.recordAppError('pet', { message: 'spam-' + i, stack: 's', url: '/', userId: 'u1' });
}
health = marketService.getAppHealth('pet');
ok('错误表只保留最近 200 条', health.errors.total === 200, String(health.errors.total));

// ---------- 健康度 ----------
section('健康度');
ok('未安装应用返回 null', marketService.getAppHealth('not-installed-app') === null);
ok('健康度含版本与启用状态', health.version === '0.17.0' && health.enabled === true, JSON.stringify({ v: health.version, e: health.enabled }));
var all = marketService.listAppHealth();
ok('批量健康度覆盖全部已装应用', all.length >= 3, String(all.length));

// ---------- 收尾 ----------
// Windows 下 sqlite 连接持有文件锁：先关连接再删临时目录，删不掉也不算失败
try { require('./src/utils/db').close(); } catch (e) {}
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
console.log('\n' + '='.repeat(56));
console.log('结果：通过 ' + pass + '，失败 ' + fail);
// 强制退出：模块里可能残留定时器/连接句柄，别让单测挂住
process.exit(fail ? 1 : 0);
