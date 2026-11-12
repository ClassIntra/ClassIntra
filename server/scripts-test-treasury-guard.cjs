// 学元财政权 · 专项验收（纯 mock，不连生产库、不启动服务）
// 用法：node server/scripts-test-treasury-guard.cjs（系统 Node / ABI 137）
//
// 背景：2026-11-12 修的旁路 —— 组网 member 角色下，/api/xy/issue 只挂
// auth.requireAdmin，从班班管可绕过 requireTreasury 直接印赠金。
// 本脚本验证共享中间件的判定矩阵，并用静态断言锁住两个门面的挂载方式。

var fs = require('fs');
var os = require('os');
var path = require('path');

// 兜底：万一 require.cache 拦截没生效，也让 db 落到临时文件而不是生产库
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-treasury-')), 'mock.db');
process.env.NODE_ENV = 'test';

var pass = 0;
var fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + JSON.stringify(a) + '）', a === b, { got: a, want: b }); }

// ---- mock xy-mesh：blockTreasury 是全局角色判定 + 系统管理员豁免 ----
global.__meshMember = false;
var meshPath = path.resolve(__dirname, 'src/services/xy-mesh.js');
require.cache[meshPath] = {
  id: meshPath,
  filename: meshPath,
  loaded: true,
  exports: {
    blockTreasury: function (uid) {
      return global.__meshMember === true && String(uid) !== '999999';
    }
  }
};

var treasury = require('./src/middleware/treasury');

function call(mw, user) {
  var res = {
    _status: 0,
    _body: null,
    status: function (c) { this._status = c; return this; },
    json: function (b) { this._body = b; return this; }
  };
  var next = 0;
  mw({ user: user }, res, function () { next++; });
  return { status: res._status, body: res._body, next: next };
}

var ADMIN = { user_id: '251800', is_class_admin: true };
var SYS = { user_id: '999999', is_admin: 1 };
var STUDENT = { user_id: '251801', is_class_admin: false, is_admin: 0 };

console.log('\n=== 中间件导出 ===');
ok('requireTreasury 可用', typeof treasury.requireTreasury === 'function');
ok('treasuryForAdmins 可用', typeof treasury.treasuryForAdmins === 'function');

console.log('\n=== member（从班）：封锁本班班管 ===');
global.__meshMember = true;
var r1 = call(treasury.requireTreasury, ADMIN);
eq('班管发行被拦 403', r1.status, 403);
ok('返回移交提示', !!(r1.body && /移交组网主班/.test(r1.body.message)), r1.body);
eq('被拦时不调用 next', r1.next, 0);
eq('系统管理员豁免', call(treasury.requireTreasury, SYS).next, 1);
eq('普通学生本就无财政权', call(treasury.requireTreasury, STUDENT).status, 403);
eq('未登录 401', call(treasury.requireTreasury, null).status, 401);

eq('学生本人订单动作直接放行', call(treasury.treasuryForAdmins, STUDENT).next, 1);
eq('班管越权操作别人的单被拦', call(treasury.treasuryForAdmins, ADMIN).status, 403);
eq('系统管理员在混合端点也豁免', call(treasury.treasuryForAdmins, SYS).next, 1);
eq('混合端点未登录 401', call(treasury.treasuryForAdmins, null).status, 401);

console.log('\n=== master / 未组网：正常放行 ===');
global.__meshMember = false;
eq('班管发行放行', call(treasury.requireTreasury, ADMIN).next, 1);
eq('普通学生仍无财政权', call(treasury.requireTreasury, STUDENT).status, 403);
eq('班管订单动作放行', call(treasury.treasuryForAdmins, ADMIN).next, 1);
eq('学生订单动作放行', call(treasury.treasuryForAdmins, STUDENT).next, 1);

console.log('\n=== 静态断言：两个门面不许再漂移 ===');
function read(rel) { return fs.readFileSync(path.join(__dirname, rel), 'utf8'); }
var xy = read('src/routes/xueyuan.js');
var ledger = read('src/routes/ledger.js');
var mw = read('src/middleware/treasury.js');
var bridge = read('src/routes/cluss-bridge.js');
var pkg = JSON.parse(read('package.json'));

ok('xueyuan.js 不再自定义 requireTreasury', xy.indexOf('function requireTreasury') === -1);
ok('xueyuan.js 引用共享中间件', xy.indexOf("require('../middleware/treasury')") !== -1);
ok('共享中间件是唯一定义处', mw.indexOf('function requireTreasury') !== -1);
ok('/api/xy 已无裸 auth.requireAdmin', ledger.indexOf('auth.requireAdmin') === -1);
ok('/issue 挂 requireTreasury', /router\.post\('\/issue',\s*treasury\.requireTreasury/.test(ledger));
ok('订单/商品混合动作挂 treasuryForAdmins',
  ledger.indexOf('treasury.treasuryForAdmins') !== -1 && ledger.indexOf('router.use(function (req, res, next)') !== -1);
ok('Cluss 桥额度检查与扣款同事务',
  bridge.indexOf('creditTx.immediate()') !== -1 && bridge.indexOf('{ strict: true }') !== -1);
ok('专项验收已进 test:ledger',
  String((pkg.scripts || {})['test:ledger'] || '').indexOf('scripts-test-treasury-guard.cjs') !== -1);

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
console.log('========================================\n');
process.exit(fail ? 1 : 0);
