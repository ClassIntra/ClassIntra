// 应用定时任务调度器
// ============================================================
// 为什么需要：
//   第三方应用/插件此前只能自己 setInterval —— 重启即丢、错过不补、执行结果无处可查。
//   这里提供一个最小的「任务托管」：manifest 声明 backend.jobs，宿主负责按时触发与记账。
//
// manifest 声明：
//   "backend": {
//     "mountPath": "/api/my-app",
//     "entry": "./backend/routes.js",
//     "jobs": [
//       { "name": "daily-digest", "daily": "07:30", "handler": "./backend/jobs/digest.js" },
//       { "name": "poll", "every": "5m", "handler": "./backend/jobs/poll.js" }
//     ]
//   }
//
// 语义（刻意保守，宁可少跑不可乱跑）：
//   - every：最小 60 秒；进程重启后重新计时
//   - daily：HH:MM（服务器本地时区）；启动时若「今天的时间点已过且今天没跑过」→ 补跑一次
//   - 同一任务不重叠：上一次还在跑就跳过本次
//   - 执行结果写 app_jobs（last_run_at / last_status / last_error / run_count）
//   - handler 每次执行前清 require 缓存，应用更新后新代码立即生效
//
// 编码约定：var / function。

var fs = require('fs');
var path = require('path');
var manifestLoader = require('./manifest-loader');

var MIN_EVERY_SEC = 60;
var jobs = {};        // `app:job` → { appName, def, dir, timer, running }
var started = false;

function db() {
  try { return require('../utils/db'); } catch (e) { return null; }
}

function parseEvery(value) {
  if (typeof value === 'number' && isFinite(value)) return Math.round(value);
  var s = String(value || '').trim().toLowerCase();
  var m = /^(\d+)\s*(s|m|h)?$/.exec(s);
  if (!m) return 0;
  var n = parseInt(m[1], 10);
  var unit = m[2] || 's';
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 3600;
  return n;
}

function parseDaily(value) {
  var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!m) return null;
  return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) };
}

function msUntilNextDaily(daily) {
  var now = new Date();
  var next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), daily.hour, daily.minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function todayStart() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function recordRun(appName, jobName, status, error) {
  var d = db();
  if (!d) return;
  try {
    d.prepare(
      'INSERT INTO app_jobs (app_name, job_name, last_run_at, last_status, last_error, run_count, locked_until) VALUES (?, ?, ?, ?, ?, 1, 0) ' +
      'ON CONFLICT(app_name, job_name) DO UPDATE SET last_run_at = excluded.last_run_at, last_status = excluded.last_status, ' +
      'last_error = excluded.last_error, run_count = run_count + 1, locked_until = 0'
    ).run(appName, jobName, Date.now(), status, String(error || '').slice(0, 500));
  } catch (e) { /* 表未迁移时静默 */ }
}

function lastRunAt(appName, jobName) {
  var d = db();
  if (!d) return 0;
  try {
    var row = d.prepare('SELECT last_run_at FROM app_jobs WHERE app_name = ? AND job_name = ?').get(appName, jobName);
    return row && row.last_run_at ? row.last_run_at : 0;
  } catch (e) { return 0; }
}

// 分布式抢占：多实例共库时，同一时刻只允许一个实例执行同一任务。
// 锁 5 分钟自动过期（任务正常都远短于此），进程崩溃也不会永久占锁。
var LOCK_TTL_MS = 5 * 60 * 1000;

function claimJob(appName, jobName) {
  var d = db();
  if (!d) return true; // 没有库（极端降级）时不阻塞
  try {
    d.prepare('INSERT OR IGNORE INTO app_jobs (app_name, job_name, run_count, locked_until) VALUES (?, ?, 0, 0)')
      .run(appName, jobName);
    var now = Date.now();
    var info = d.prepare(
      'UPDATE app_jobs SET locked_until = ? WHERE app_name = ? AND job_name = ? AND (locked_until IS NULL OR locked_until < ?)'
    ).run(now + LOCK_TTL_MS, appName, jobName, now);
    return info.changes > 0;
  } catch (e) {
    return true;
  }
}

function runJob(key) {
  var job = jobs[key];
  if (!job || job.running) return Promise.resolve(null);
  if (!claimJob(job.appName, job.def.name)) {
    return Promise.resolve({ skipped: 'locked' });
  }
  var handlerPath = path.resolve(job.dir, job.def.handler);
  // 防穿越：handler 必须落在应用目录内
  if (handlerPath.indexOf(path.resolve(job.dir) + path.sep) !== 0) {
    recordRun(job.appName, job.def.name, 'error', 'handler 路径越界');
    return Promise.resolve(null);
  }

  job.running = true;
  var startedAt = Date.now();
  return Promise.resolve().then(function () {
    try { delete require.cache[handlerPath]; } catch (e) {}
    var fn = require(handlerPath);
    if (typeof fn !== 'function') throw new Error('handler 必须导出函数');
    return fn({
      appName: job.appName,
      jobName: job.def.name,
      startedAt: startedAt,
      log: function () {
        var args = Array.prototype.slice.call(arguments);
        console.log.apply(console, ['[job:' + job.appName + '/' + job.def.name + ']'].concat(args));
      }
    });
  }).then(function () {
    recordRun(job.appName, job.def.name, 'ok', '');
    return { ok: true };
  }).catch(function (e) {
    recordRun(job.appName, job.def.name, 'error', e && e.message);
    try { console.warn('[scheduler] 任务失败 ' + job.appName + '/' + job.def.name + ': ' + (e && e.message)); } catch (_) {}
    return { ok: false, error: e && e.message };
  }).then(function (result) {
    job.running = false;
    return result;
  });
}

function addTimer(job, timer) {
  if (timer && timer.unref) timer.unref();
  if (timer) job.timers.push(timer);
  return timer;
}

function scheduleDaily(job, key) {
  var daily = parseDaily(job.def.daily);
  if (!daily) return;
  addTimer(job, setTimeout(function () {
    runJob(key).then(function () {
      if (jobs[key] === job) scheduleDaily(job, key);
    });
  }, msUntilNextDaily(daily)));

  // 补跑：今天的时间点已过，且今天还没跑过 → 5 秒后补一次
  var scheduledToday = new Date();
  scheduledToday.setHours(daily.hour, daily.minute, 0, 0);
  var last = lastRunAt(job.appName, job.def.name);
  if (Date.now() >= scheduledToday.getTime() && last < todayStart()) {
    addTimer(job, setTimeout(function () { runJob(key); }, 5000));
  }
}

function registerJob(appName, jobDef, dir) {
  if (!jobDef || !jobDef.name || !jobDef.handler) return false;
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(String(jobDef.name))) return false;
  var key = appName + ':' + jobDef.name;
  if (jobs[key]) return true;

  var job = { appName: appName, def: jobDef, dir: dir, timers: [], running: false };
  jobs[key] = job;

  if (jobDef.every !== undefined) {
    var sec = Math.max(MIN_EVERY_SEC, parseEvery(jobDef.every));
    if (!sec) { delete jobs[key]; return false; }
    addTimer(job, setInterval(function () { runJob(key); }, sec * 1000));
    return true;
  }
  if (jobDef.daily !== undefined) {
    if (!parseDaily(jobDef.daily)) { delete jobs[key]; return false; }
    scheduleDaily(job, key);
    return true;
  }
  delete jobs[key];
  return false;
}

// 同步单个应用：先撤掉旧任务，再按当前 manifest 注册（安装/更新/启用后调用）
function syncApp(appName) {
  unregister(appName);
  var manifest = null;
  try {
    manifest = manifestLoader.loadManifests().filter(function (m) { return m.name === appName; })[0] || null;
  } catch (e) { manifest = null; }
  if (!manifest || !manifest.backend || !Array.isArray(manifest.backend.jobs)) return 0;

  // 停用的应用不跑任务
  try {
    var d = db();
    if (d) {
      var row = d.prepare('SELECT enabled FROM app_control WHERE app_name = ?').get(appName);
      if (row && !row.enabled) return 0;
    }
  } catch (e) {}

  var dir = manifest._sourceDir || '';
  if (!dir) return 0;
  var registered = 0;
  for (var i = 0; i < manifest.backend.jobs.length; i++) {
    if (registerJob(appName, manifest.backend.jobs[i], dir)) registered++;
  }
  return registered;
}

function unregister(appName) {
  var removed = 0;
  Object.keys(jobs).forEach(function (key) {
    if (jobs[key].appName !== appName) return;
    (jobs[key].timers || []).forEach(function (t) {
      try { clearInterval(t); } catch (e) {}
      try { clearTimeout(t); } catch (e) {}
    });
    delete jobs[key];
    removed++;
  });
  return removed;
}

function reloadAll() {
  unregisterAll();
  var count = 0;
  try {
    var manifests = manifestLoader.loadManifests();
    for (var i = 0; i < manifests.length; i++) {
      if (manifests[i].backend && Array.isArray(manifests[i].backend.jobs)) {
        count += syncApp(manifests[i].name);
      }
    }
  } catch (e) {
    console.warn('[scheduler] 扫描任务失败:', e.message);
  }
  return count;
}

function unregisterAll() {
  var names = {};
  Object.keys(jobs).forEach(function (key) { names[jobs[key].appName] = true; });
  Object.keys(names).forEach(function (name) { unregister(name); });
}

function start() {
  if (started) return { started: false, jobs: Object.keys(jobs).length };
  started = true;
  var count = reloadAll();
  console.log('[scheduler] 已启动，注册任务 ' + count + ' 个');
  return { started: true, jobs: count };
}

function stop() {
  unregisterAll();
  started = false;
}

function getStatus() {
  var d = db();
  var rows = [];
  if (d) {
    try { rows = d.prepare('SELECT * FROM app_jobs').all(); } catch (e) { rows = []; }
  }
  return Object.keys(jobs).map(function (key) {
    var j = jobs[key];
    var row = rows.filter(function (r) { return r.app_name === j.appName && r.job_name === j.def.name; })[0] || null;
    return {
      app: j.appName,
      job: j.def.name,
      schedule: j.def.daily ? ('daily ' + j.def.daily) : ('every ' + j.def.every),
      running: j.running,
      lastRunAt: row ? row.last_run_at : 0,
      lastStatus: row ? row.last_status : '',
      lastError: row ? row.last_error : '',
      runCount: row ? row.run_count : 0,
      locked: !!(row && row.locked_until && row.locked_until > Date.now())
    };
  });
}

module.exports = {
  start: start,
  stop: stop,
  syncApp: syncApp,
  unregister: unregister,
  reloadAll: reloadAll,
  getStatus: getStatus,
  // 测试用：直接触发某个任务
  runJob: runJob,
  _parseEvery: parseEvery,
  _parseDaily: parseDaily,
  // 测试用：注册/清理单个任务（生产路径请走 syncApp）
  _registerJob: registerJob,
  _jobs: jobs
};
