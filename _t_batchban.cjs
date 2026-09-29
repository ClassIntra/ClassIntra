// 隔离单测：只调用 manage.js 的 OPS.resolve（纯函数，读库不写库、不发任何 HTTP）
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/NetWork/Integration/ClassIntra';

// 载入 server/.env：仅为了满足 config 对 JWT_SECRET 的强制校验（resolve 不签令牌）
const envPath = path.join(ROOT, 'server', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'local-test-secret-not-used';

const manage = require(path.join(ROOT, 'plugins/astrbot-relay/backend/manage.js'));
const db = require(path.join(ROOT, 'server/src/utils/db'));
const constants = require(path.join(ROOT, 'server/src/utils/constants'));
const OPS = manage.OPS;

let pass = 0, fail = 0;
function ok(name, detail) { console.log('PASS  ' + name + '  ->  ' + detail); pass++; }
function bad(name, detail) { console.log('FAIL  ' + name + '  ->  ' + detail); fail++; }
function check(name, fn) {
  try { ok(name, fn()); } catch (e) { bad(name, e.message); }
}
function expectThrow(name, fn, want) {
  try { bad(name, '未抛错，返回 ' + JSON.stringify(fn())); }
  catch (e) {
    if (want && e.message.indexOf(want) === -1) bad(name, '抛错但消息不符: ' + e.message);
    else ok(name, '正确拒绝: ' + e.message);
  }
}

const rows = db.prepare(
  "SELECT id, user_id, net_name FROM users WHERE (is_admin IS NULL OR is_admin = 0) " +
  "AND net_name IS NOT NULL AND net_name <> '' LIMIT 3"
).all();
if (rows.length < 3) { console.log('样本不足，无法测试'); process.exit(2); }
console.log('样本用户: ' + rows.map(function (r) { return r.user_id + '/' + r.net_name; }).join(', ') + '\n');

check('targets 单元素 -> 1 条计划', function () {
  const p = OPS.user_ban.resolve({ targets: [rows[0].user_id], content: '测试原因', num: 0 });
  if (!Array.isArray(p) || p.length !== 1) throw new Error('计划数不对: ' + JSON.stringify(p));
  return p[0].method + ' ' + p[0].path + '  body=' + JSON.stringify(p[0].body);
});

check('targets 三元素 -> 3 条计划', function () {
  const p = OPS.user_ban.resolve({ targets: rows.map(function (r) { return r.user_id; }), content: '批量', num: 60 });
  if (p.length !== 3) throw new Error('计划数不对: ' + p.length);
  return p.map(function (x) { return x.auditTarget; }).join(' | ');
});

check('target 顿号/逗号分隔 -> 3 条计划', function () {
  const p = OPS.user_ban.resolve({ target: rows.map(function (r) { return r.user_id; }).join('，') });
  if (p.length !== 3) throw new Error('计划数不对: ' + p.length);
  return p.length + ' 条';
});

check('同一人两种写法(user_id + 网名) -> 去重为 1 条', function () {
  const u = rows[0];
  const p = OPS.user_ban.resolve({ targets: [u.user_id, u.net_name] });
  if (p.length !== 1) throw new Error('去重失败，得到 ' + p.length + ' 条: ' + p.map(function (x) { return x.auditTarget; }).join(','));
  return p[0].auditTarget;
});

check('时长与原因正确写入 body', function () {
  const p = OPS.user_ban.resolve({ targets: [rows[1].user_id], content: '上课玩手机', num: '30' });
  const b = p[0].body;
  if (b.status !== 'disabled' || b.duration !== 30 || b.reason !== '上课玩手机') throw new Error(JSON.stringify(b));
  return JSON.stringify(b);
});

expectThrow('不存在用户 -> 抛错', function () {
  return OPS.user_ban.resolve({ targets: ['这个人绝对不存在zzz111'] });
}, '找不到用户');

expectThrow('超过 50 个目标 -> 抛错', function () {
  const many = [];
  for (let i = 0; i < 51; i++) many.push(rows[0].user_id);
  return OPS.user_ban.resolve({ targets: many });
}, '最多 50');

expectThrow('空目标 -> 抛错', function () { return OPS.user_ban.resolve({}); }, '需要指定用户');

check('user_unban 同样支持批量 -> 3 条 active', function () {
  const p = OPS.user_unban.resolve({ targets: rows.map(function (r) { return r.user_id; }) });
  if (p.length !== 3) throw new Error('计划数不对: ' + p.length);
  if (p[0].body.status !== 'active') throw new Error('body 不对: ' + JSON.stringify(p[0].body));
  return p.length + ' 条, status=active';
});

// ── 「全体」令牌 all / all_except_<用户…>（2026-09-28）──
// 期望集合独立算一遍：全部用户 - is_admin=1 - 班管
const allRows = db.prepare('SELECT id, user_id, net_name, is_admin FROM users').all();
const expectAll = allRows.filter(function (r) {
  return r.is_admin !== 1 && !constants.isClassAdmin(String(r.user_id));
});
const forbidden = allRows.filter(function (r) {
  return r.is_admin === 1 || constants.isClassAdmin(String(r.user_id));
}).map(function (r) { return r.user_id; });

check('all -> 单个批量计划（不是上百条数组）', function () {
  const p = OPS.user_ban.resolve({ target: 'all', content: '全员静默', num: 1 });
  if (Array.isArray(p)) throw new Error('返回了数组(' + p.length + ' 条)，应为单个批量计划');
  if (p.method !== 'post' || p.path !== '/users/bulk-status') throw new Error(p.method + ' ' + p.path);
  if (!Array.isArray(p.body.user_ids)) throw new Error('body.user_ids 不是数组');
  if (p.body.user_ids.length !== expectAll.length) {
    throw new Error('人数 ' + p.body.user_ids.length + ' != 期望 ' + expectAll.length);
  }
  return 'POST ' + p.path + '  ' + p.body.user_ids.length + ' 人  auditTarget=' + p.auditTarget;
});

check('all 一定不含管理员与班管', function () {
  const p = OPS.user_ban.resolve({ target: 'all' });
  const hit = forbidden.filter(function (x) { return p.body.user_ids.indexOf(x) !== -1; });
  if (hit.length) throw new Error('未排除: ' + hit.join(','));
  return '已排除 ' + forbidden.join('/') + '，剩 ' + p.body.user_ids.length + ' 人';
});

check('all 携带封禁原因与时长', function () {
  const p = OPS.user_ban.resolve({ target: 'all', content: '系统维护', num: 1 });
  if (p.body.status !== 'disabled' || p.body.duration !== 1 || p.body.reason !== '系统维护') {
    throw new Error(JSON.stringify(p.body).slice(0, 120));
  }
  return JSON.stringify({ status: p.body.status, duration: p.body.duration, reason: p.body.reason });
});

check('all_except_<学号> -> 少一人', function () {
  const u = expectAll[0];
  const p = OPS.user_ban.resolve({ target: 'all_except_' + u.user_id });
  if (p.body.user_ids.length !== expectAll.length - 1) {
    throw new Error('人数 ' + p.body.user_ids.length + ' != ' + (expectAll.length - 1));
  }
  if (p.body.user_ids.indexOf(u.user_id) !== -1) throw new Error('未排除 ' + u.user_id);
  return 'all_except_' + u.user_id + ' -> ' + p.body.user_ids.length + ' 人';
});

check('all_except_<学号>,<学号> -> 少两人', function () {
  const a = expectAll[0], b = expectAll[1];
  const p = OPS.user_ban.resolve({ target: 'all_except_' + a.user_id + ',' + b.user_id });
  if (p.body.user_ids.length !== expectAll.length - 2) throw new Error('人数 ' + p.body.user_ids.length);
  if (p.body.user_ids.indexOf(a.user_id) !== -1 || p.body.user_ids.indexOf(b.user_id) !== -1) {
    throw new Error('未排除');
  }
  return p.body.user_ids.length + ' 人';
});

check('all_except:<网名>（冒号写法）也能排除', function () {
  const u = expectAll.filter(function (r) {
    return r.net_name && /^[\w\u4e00-\u9fa5]+$/.test(r.net_name);
  })[0];
  if (!u) throw new Error('找不到适合的样本网名');
  const p = OPS.user_ban.resolve({ target: 'all_except:' + u.net_name });
  if (p.body.user_ids.indexOf(u.user_id) !== -1) throw new Error('未排除 ' + u.net_name);
  return 'all_except:' + u.net_name + ' -> ' + p.body.user_ids.length + ' 人';
});

check('user_unban 支持 all -> active 批量计划', function () {
  const p = OPS.user_unban.resolve({ target: 'all' });
  if (Array.isArray(p)) throw new Error('应为单个批量计划');
  if (p.path !== '/users/bulk-status' || p.body.status !== 'active') {
    throw new Error(JSON.stringify(p.body).slice(0, 120));
  }
  return p.path + ' status=active ' + p.body.user_ids.length + ' 人';
});

expectThrow('all_except 里的用户不存在 -> 抛错（不静默放过）', function () {
  return OPS.user_ban.resolve({ target: 'all_except_这个人绝对不存在zzz111' });
}, '找不到用户');

check('回归：all 不误伤以 all 开头的普通名字（isAllToken 只认完整令牌）', function () {
  const p = OPS.user_ban.resolve({ target: rows[0].user_id });
  if (!Array.isArray(p) || p.length !== 1) throw new Error('普通目标被当成 all 令牌');
  return p[0].path;
});

check('回归：null/undefined 仍抛「需要指定用户」而非被当 all', function () {
  try { OPS.user_ban.resolve({ target: null, targets: null }); }
  catch (e) { if (e.message.indexOf('需要指定用户') === -1) throw new Error(e.message); return '正确拒绝'; }
  throw new Error('未抛错');
});

check('回归：user_list 仍返回单个计划对象（未被改成数组）', function () {
  const p = OPS.user_list.resolve({ target: 'x' });
  if (Array.isArray(p)) throw new Error('被误改为数组');
  return p.method + ' ' + p.path;
});

check('回归：user_delete 仍为单目标对象', function () {
  const p = OPS.user_delete.resolve({ target: rows[0].user_id });
  if (Array.isArray(p)) throw new Error('被误改为数组');
  return p.method + ' ' + p.path;
});

check('回归：catalog 仍列出全部 op 且 user_ban 为破坏性', function () {
  const c = manage.catalog();
  const ban = c.filter(function (x) { return x.op === 'user_ban'; })[0];
  if (!ban || !ban.destructive) throw new Error('user_ban 破坏性标记丢失');
  return c.length + ' 个 op, user_ban.destructive=' + ban.destructive;
});

console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail ? 1 : 0);
