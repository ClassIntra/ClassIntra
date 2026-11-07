// health-foundation.cjs - 学元地基全面体检（只读，跑在生产库上）
var db = require('./src/utils/db');
var inv = require('./src/ledger/invariants');
var units = require('./src/ledger/units');
var svc = require('./src/ledger/service');
var xy = require('./src/services/xueyuan');
var xyMesh = require('./src/services/xy-mesh');
var cashbook = require('./src/ledger/cashbook');

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

console.log('=== 1. 账本八项不变量（I1–I9） ===');
var inv1 = inv.check();
ok('不变量全绿', inv1.ok, inv1.issues);
inv1.issues && inv1.issues.forEach(function (i) { console.log('    [' + i.code + '] ' + i.detail); });

console.log('=== 2. 单位口径唯一链 ===');
var scale = units.scaleAudit();
ok('1 元 = 1000 学元', scale.xueyuanPerYuan === 1000, scale);
ok('1 学元 = 100 账本单位', scale.unitsPerXueyuan === 100, scale);
ok('账本口径 1 元 = 100000 单位', scale.ledgerUnitsPerYuan === 100000, scale);
ok('口径已统一（倍差 1）', scale.unified === true, scale);

console.log('=== 3. 真金台账（I2 对账） ===');
var m = inv1.metrics || {};
console.log('  账面现金', m.cash_on_book_cent, '| cashbook liability', m.cashbook_liability_cent, '| 兑付覆盖率', m.reserve_coverage);
ok('账面现金 ≡ 真金台账负债', m.cash_on_book_cent === m.cashbook_liability_cent, { a: m.cash_on_book_cent, b: m.cashbook_liability_cent });

console.log('=== 4. 充值凭证卫生 ===');
var bad = db.prepare("SELECT COUNT(*) c FROM xy_recharge WHERE revoked_at = 0").get();
ok('无未撤回的遗留测试充值', bad.c === 0, bad);
var withdrawn = db.prepare("SELECT COUNT(*) c FROM xy_recharge WHERE revoked_at > 0").get();
console.log('  已撤回凭证（审计留痕）:', withdrawn.c);

console.log('=== 5. 学员账户健康 ===');
var acc = db.prepare("SELECT COUNT(*) c FROM xy_ledger_accounts WHERE kind='user'").get();
var negCash = db.prepare("SELECT COUNT(*) c FROM xy_ledger_balances b JOIN xy_ledger_accounts a ON a.id=b.account_id WHERE a.kind='user' AND b.asset='CASH' AND b.balance < 0").get();
ok('无学员 CASH 负余额', negCash.c === 0, negCash);
var negGrant = db.prepare("SELECT COUNT(*) c FROM xy_ledger_balances b JOIN xy_ledger_accounts a ON a.id=b.account_id WHERE a.kind='user' AND b.asset='GRANT' AND b.balance < 0").get();
ok('无学员 GRANT 负余额', negGrant.c === 0, negGrant);
console.log('  学员账户总数:', acc.c);

console.log('=== 6. 组网（mesh）状态 ===');
var cfg = xyMesh.getConfig();
console.log('  role =', cfg.role, '| peers =', JSON.stringify(cfg.peers));
ok('本机角色为 master（18 班总管）', cfg.role === 'master', cfg.role);
ok('从班 08 已配置', cfg.peers.some(function (p) { return p.class === '08'; }), cfg.peers);
var peerRows = db.prepare('SELECT server_id, base_url FROM xy_peer').all();
console.log('  xy_peer 寻址表:', JSON.stringify(peerRows));

console.log('=== 7. 账本服务就绪 ===');
ok('svc.ensureReady 通过', (function () { try { svc.ensureReady(); return true; } catch (e) { console.log('   ', e.message); return false; } })(), null);
var sum = xy.summary({ recentLimit: 1 });
ok('summary 可用', !!sum, null);
var health = xy.health({ days: 30 });
ok('币值健康度输出', !!health && !!health.level, health && health.level);
console.log('  健康等级:', health.level, '| 警告:', (health.warnings || []).length);

console.log('=== 8. 配额护栏 ===');
var LIMITS = xy.LIMITS;
ok('单笔充值上限存在', LIMITS.MAX_RECHARGE_CENT > 0, LIMITS.MAX_RECHARGE_CENT);
ok('学期充值配额存在', LIMITS.RECHARGE_QUOTA_CENT > 0, LIMITS.RECHARGE_QUOTA_CENT);
ok('单次发放上限存在', LIMITS.MAX_GRANT_CENT > 0, LIMITS.MAX_GRANT_CENT);

console.log('===== 学元地基体检：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
