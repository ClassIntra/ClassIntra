// 单测：应用定时任务调度器 + 事件总线
// 运行：node server/scripts-unit-app-jobs.cjs
//
// 隔离策略：临时 DB（只建 app_control + 迁移 024 的表）+ 临时应用目录。
// 不启动 HTTP/WS，不碰生产库。

var fs = require('fs');
var os = require('os');
var path = require('path');

var tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-jobs-unit-'));
var dbPath = path.join(tmpRoot, 'unit.db');
process.env.DB_PATH = dbPath;

var Database = require('better-sqlite3');
(function seed() {
  var db = new Database(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS app_control (app_name TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1)');
  require('./src/migrations/024_app_data_and_jobs').up(db);
  require('./src/migrations/025_integration_idempotency_and_job_lock').up(db);
  db.close();
})();

var scheduler = require('./src/core/app-scheduler');
var bus = require('./src/core/app-events');

var pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function main() {
  console.log('\n定时任务与事件总线单测（隔离 DB）');
  console.log('='.repeat(56));

  section('周期解析');
  ok(scheduler._parseEvery(90) === 90, '数字按秒');
  ok(scheduler._parseEvery('5m') === 300, '5m = 300s');
  ok(scheduler._parseEvery('2h') === 7200, '2h = 7200s');
  ok(scheduler._parseEvery('30s') === 30, '30s = 30s');
  ok(scheduler._parseEvery('bad') === 0, '非法值返回 0');
  ok(JSON.stringify(scheduler._parseDaily('07:30')) === '{"hour":7,"minute":30}', '07:30 解析');
  ok(scheduler._parseDaily('24:00') === null, '24:00 拒绝');
  ok(scheduler._parseDaily('7:30') === null, '7:30 拒绝（必须两位）');

  section('任务注册与执行');
  var appDir = path.join(tmpRoot, 'demo-app');
  fs.mkdirSync(appDir, { recursive: true });
  var marker = path.join(tmpRoot, 'ran.txt');
  fs.writeFileSync(path.join(appDir, 'handler.js'),
    "var fs = require('fs');\n" +
    "module.exports = function (ctx) { fs.writeFileSync(" + JSON.stringify(marker) + ", ctx.jobName + ':' + ctx.appName); };\n");

  var registered = scheduler._registerJob('demo-app', { name: 'tick', every: 60, handler: './handler.js' }, appDir);
  ok(registered === true, '注册 every 任务');
  ok(Object.keys(scheduler._jobs).indexOf('demo-app:tick') !== -1, '内部任务表可见');

  var result = await scheduler.runJob('demo-app:tick');
  ok(result && result.ok === true, '执行成功');
  ok(fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === 'tick:demo-app', 'handler 收到正确上下文');

  var db = new Database(dbPath, { readonly: true });
  var row = db.prepare("SELECT * FROM app_jobs WHERE app_name='demo-app' AND job_name='tick'").get();
  ok(!!row && row.last_status === 'ok' && row.run_count === 1, '执行结果落库（ok / 计数 1）', row);

  section('失败与越界');
  fs.writeFileSync(path.join(appDir, 'boom.js'), "module.exports = function () { throw new Error('boom'); };\n");
  scheduler._registerJob('demo-app', { name: 'boom', every: 60, handler: './boom.js' }, appDir);
  var boom = await scheduler.runJob('demo-app:boom');
  ok(boom && boom.ok === false, '抛错任务返回 ok=false');
  db = new Database(dbPath, { readonly: true });
  var boomRow = db.prepare("SELECT * FROM app_jobs WHERE app_name='demo-app' AND job_name='boom'").get();
  ok(!!boomRow && boomRow.last_status === 'error' && boomRow.last_error.indexOf('boom') !== -1, '错误信息落库', boomRow);

  var escape = scheduler._registerJob('demo-app', { name: 'escape', every: 60, handler: '../outside.js' }, appDir);
  ok(escape === true, '越界 handler 允许注册（运行时拦截）');
  await scheduler.runJob('demo-app:escape');
  db = new Database(dbPath, { readonly: true });
  var escRow = db.prepare("SELECT * FROM app_jobs WHERE app_name='demo-app' AND job_name='escape'").get();
  ok(!!escRow && escRow.last_status === 'error' && escRow.last_error.indexOf('越界') !== -1, '越界路径被拒绝执行', escRow);

  section('分布式锁');
  // 手动把锁占住，模拟另一个实例正在执行
  var lockDb = new Database(dbPath);
  lockDb.prepare("UPDATE app_jobs SET locked_until = ? WHERE app_name='demo-app' AND job_name='tick'").run(Date.now() + 60000);
  lockDb.close();
  var skipped = await scheduler.runJob('demo-app:tick');
  ok(skipped && skipped.skipped === 'locked', '被占用时跳过本次执行', skipped);
  var lockDb2 = new Database(dbPath);
  lockDb2.prepare("UPDATE app_jobs SET locked_until = 0 WHERE app_name='demo-app' AND job_name='tick'").run();
  lockDb2.close();
  var resumed = await scheduler.runJob('demo-app:tick');
  ok(resumed && resumed.ok === true, '锁释放后可正常执行', resumed);

  section('清理与状态');
  var before = scheduler.getStatus().filter(function (j) { return j.app === 'demo-app'; }).length;
  ok(before >= 3, '状态列表包含全部任务（' + before + '）');
  var removed = scheduler.unregister('demo-app');
  ok(removed >= 3, 'unregister 移除全部任务（' + removed + '）');
  ok(scheduler.getStatus().filter(function (j) { return j.app === 'demo-app'; }).length === 0, '移除后状态为空');

  section('事件总线');
  var got = [];
  var off = bus.on('test.event', function (p) { got.push(p.n); }, 'owner-a');
  bus.emit('test.event', { n: 1 });
  ok(got.length === 1 && got[0] === 1, '订阅并收到事件');

  var badOff = bus.on('test.event', function () { throw new Error('subscriber boom'); }, 'owner-a');
  var goodOff = bus.on('test.event', function (p) { got.push(p.n); }, 'owner-b');
  bus.emit('test.event', { n: 2 });
  // 此时有三个订阅者：pushA / throwing / pushB → 正常订阅者都应收到
  ok(got.length === 3 && got[1] === 2 && got[2] === 2, '单个订阅者抛错不影响其他订阅者');

  var removedOwner = bus.offOwner('owner-a');
  ok(removedOwner >= 2, '按归属整批退订（' + removedOwner + '）');
  bus.emit('test.event', { n: 3 });
  ok(got.length === 4 && got[3] === 3, '退订后只剩 owner-b 收到');

  var stats = bus.stats();
  ok(stats['test.event'].length === 1 && stats['test.event'][0] === 'owner-b', 'stats 反映剩余订阅者', stats);

  off(); badOff(); goodOff();

  console.log('\n' + '='.repeat(56));
  console.log('结果：通过 ' + pass + '，失败 ' + fail);
  try { require('./src/utils/db').close(); } catch (e) {}
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('单测异常:', e && e.stack || e);
  process.exit(1);
});
