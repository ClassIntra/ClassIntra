// 学元钱包（/api/wallet）集成自测
// 用法：node server/scripts-test-wallet.cjs
//
// 为什么单独一个脚本：
//   scripts-test-xueyuan.cjs 测的是「学元内核」（复式记账、冻结、守恒），
//   本脚本测「钱包门面」—— 系统应用 apps/wallet 真正调的那一层：
//   账户聚合、每日津贴幂等、转账幂等、红包冻结与领取、流水一致、榜单。
//   两者都跑，才能保证「内核正确 + 门面也没把参数接错」。
//
// 独立临时库 + 独立端口 9099，绝不碰生产数据。

var fs = require('fs');
var os = require('os');
var path = require('path');
var spawn = require('child_process').spawn;

var SERVER_DIR = __dirname;
var ROOT = path.resolve(__dirname, '..');
var PORT = 9099;
var TMP = path.join(ROOT, '.workbuddy', 'tmp', 'wallet-test');
var DB = path.join(TMP, 'wallet.db');

var pass = 0;
var fail = 0;
var serverLog = '';   // 服务端输出（失败时打印尾部，省得盲猜）

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function eq(name, a, b) { ok(name + '（' + JSON.stringify(a) + '）', a === b, { got: a, want: b }); }

function rmrf(p) {
  try {
    if (!fs.existsSync(p)) return;
    fs.readdirSync(p).forEach(function (f) {
      var fp = path.join(p, f);
      if (fs.statSync(fp).isDirectory()) rmrf(fp);
      else fs.unlinkSync(fp);
    });
    fs.rmdirSync(p);
  } catch (e) { /* ignore */ }
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function waitReady(timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 45000);
  while (Date.now() < deadline) {
    try {
      var r = await fetch('http://127.0.0.1:' + PORT + '/api/system/health');
      if (r.status === 200) return true;
    } catch (e) { /* not yet */ }
    await sleep(400);
  }
  return false;
}

async function main() {
  console.log('\n=== 准备临时库 ===');
  rmrf(TMP);
  fs.mkdirSync(TMP, { recursive: true });

  var env = Object.assign({}, process.env, {
    PORT: String(PORT),
    WS_PORT: '19001',
    RELAY_PORT: '19011',
    DB_PATH: DB,
    XUEYUAN_YUAN_RATE: '100',
    // 本套用例要构造 2000 元级别的流水来验证转账/红包的「当日额度」，
    // 所以把充值、发放的上限抬到测试档，避免资金不够导致用例互相污染。
    // 生产默认值（单笔 200 元 / 学期 300 元 / 单次 0.5 元 / 每日 2 元）
    // 由 scripts-test-xueyuan-limits.cjs 单独守护 —— 那里不覆盖任何参数。
    XUEYUAN_MAX_RECHARGE_YUAN: '2000',
    XUEYUAN_RECHARGE_QUOTA_YUAN: '5000',
    XUEYUAN_MAX_GRANT_YUAN: '10',
    XUEYUAN_GRANT_DAILY_CAP_YUAN: '100',
    RESOURCES_DIR: path.join(TMP, 'res'),
    JWT_SECRET: 'wallet-test-secret',
    RELAY_SECRET: 'wallet-test-secret',   // 跨班支付用同一把 HMAC 密钥（覆盖 .env 里的生产密钥）
    RELAY_SERVER_ID: 'main-class',
    WALLET_PEERS: 'peer-class=http://127.0.0.1:9098',
    WALLET_DEBUG: '1',
    NODE_ENV: 'test',
    RELAY_SERVERS: '',
    TAILSCALE_ENABLED: 'false'
  });

  var child = spawn(process.execPath, ['src/app.js'], {
    cwd: SERVER_DIR, env: env, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function (b) { serverLog += b.toString(); });
  child.stderr.on('data', function (b) { serverLog += b.toString(); });

  var ready = await waitReady();
  if (!ready) {
    console.error('服务未就绪，日志：\n' + log.slice(-2000));
    try { child.kill(); } catch (e) {}
    process.exit(1);
  }
  console.log('服务已就绪 :' + PORT);

  // ---- 造账号 ----
  var Database = require(path.join(SERVER_DIR, 'node_modules', 'better-sqlite3'));
  var jwt = require(path.join(SERVER_DIR, 'node_modules', 'jsonwebtoken'));
  var db = new Database(DB);
  db.pragma('busy_timeout = 5000');
  var nowIso = new Date().toISOString();
  // 真 bcrypt：设置/重设支付密码要求验证**登录密码**，用假 hash 测不了
  var bcrypt = require(path.join(SERVER_DIR, 'node_modules', 'bcryptjs'));
  var loginHash = bcrypt.hashSync('test1234', 10);
  ['251901', '251902', '251903'].forEach(function (uid, i) {
    db.prepare([
      'INSERT OR IGNORE INTO users (net_name, real_name, user_id, gender, password_hash, status, is_admin, info_json, created_at)',
      "VALUES (?, ?, ?, '男', ?, 'active', 0, '{}', ?)"
    ].join('\n')).run('测试' + (i + 1), '测试同学' + (i + 1), uid, loginHash, nowIso);
  });

  // 班管 251800：本班真用户（有登录密码），但 status 被旧版「升管理员」事件写坏成
  // admin_promoted。历史脏数据回归：他必须仍能被选到、能正常收款。
  db.prepare([
    'INSERT OR IGNORE INTO users (net_name, real_name, user_id, gender, password_hash, status, is_admin, info_json, created_at)',
    "VALUES (?, ?, ?, '男', ?, 'admin_promoted', 1, '{}', ?)"
  ].join('\n')).run('班管', '班管老师', '251800', loginHash, nowIso);

  // 停用账号 251801：既不该出现在选人列表，也不该能收款
  db.prepare([
    'INSERT OR IGNORE INTO users (net_name, real_name, user_id, gender, password_hash, status, is_admin, info_json, created_at)',
    "VALUES (?, ?, ?, '男', ?, 'disabled', 0, '{}', ?)"
  ].join('\n')).run('停用', '停用账号', '251801', loginHash, nowIso);

  // 外班镜像账号 251802：由中继同步而来，没有登录密码（本班永远无人登录）。
  // 班管发放 / 充值必须拒绝，否则钱会锁死在这种账户里。
  db.prepare([
    'INSERT OR IGNORE INTO users (net_name, real_name, user_id, gender, password_hash, status, is_admin, info_json, created_at)',
    "VALUES (?, ?, ?, '男', '', 'active', 0, '{}', ?)"
  ].join('\n')).run('外班同学', '外班镜像', '251802', nowIso);

  // 251804：用于「正常发放 → 停用 → 扣减」回归，验证扣减不被停用状态拦住
  db.prepare([
    'INSERT OR IGNORE INTO users (net_name, real_name, user_id, gender, password_hash, status, is_admin, info_json, created_at)',
    "VALUES (?, ?, ?, '男', ?, 'active', 0, '{}', ?)"
  ].join('\n')).run('回收测试', '回收同学', '251804', loginHash, nowIso);

  function token(uid) {
    return jwt.sign({ user_id: uid, is_admin: 0, is_class_admin: 0, role: 'student' },
      'wallet-test-secret', { expiresIn: '2h' });
  }
  var T1 = token('251901');
  var T2 = token('251902');
  var T3 = token('251903');
  var PIN = '246810';   // 测试支付密码（非连续、非重复，能过弱密码校验）

  async function api(method, url, opts) {
    var o = opts || {};
    var headers = { Authorization: 'Bearer ' + (o.token || T1) };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    var res = await fetch((o.base || ('http://127.0.0.1:' + PORT)) + url, {
      method: method,
      headers: headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body)
    });
    var text = await res.text();
    var body = null;
    try { body = JSON.parse(text); } catch (e) { body = { raw: text }; }
    return { status: res.status, body: body };
  }

  // ================= 1. 账户聚合 =================
  console.log('\n=== 1. 账户聚合 ===');
  var w1 = await api('GET', '/api/wallet');
  eq('GET /api/wallet 200', w1.status, 200);
  var d1 = w1.body.data || {};
  eq('首次访问自动开户并发放开户赠金', d1.account && d1.account.balance, 1000);
  ok('返回可用与冻结', d1.account && typeof d1.account.available === 'number' && typeof d1.account.frozen === 'number',
    { available: d1.account && d1.account.available, frozen: d1.account && d1.account.frozen });
  ok('今日津贴未领', d1.daily && d1.daily.claimed === false, d1.daily);
  eq('津贴基础金额 20 学元', d1.daily && d1.daily.amount, 20);
  ok('带学元来源清单', Array.isArray(d1.sources) && d1.sources.length >= 6, (d1.sources || []).length);
  ok('带限额（转账 50000）', d1.limits && d1.limits.transfer === 50000, d1.limits);
  ok('最近流水含开户赠金', (d1.recent || []).some(function (x) { return x.kind === 'welcome'; }),
    (d1.recent || []).map(function (x) { return x.kind; }).join(','));

  // ================= 2. 津贴幂等 =================
  console.log('\n=== 2. 每日津贴 ===');
  var c1 = await api('POST', '/api/wallet/daily');
  eq('领取津贴 200', c1.status, 200);
  ok('首次领取到账 20 学元', c1.body.data.duplicate === false && c1.body.data.amount === 20,
    { dup: c1.body.data.duplicate, amount: c1.body.data.amount });
  eq('连签 1 天', c1.body.data.streak, 1);
  eq('余额 1000 → 1020', c1.body.data.account.balance, 1020);

  var c2 = await api('POST', '/api/wallet/daily');
  ok('重复领取不重复发钱', c2.body.data.duplicate === true && c2.body.data.amount === 0,
    { dup: c2.body.data.duplicate, amount: c2.body.data.amount });
  eq('重复领取后余额仍 1020', c2.body.data.account.balance, 1020);

  var w2 = await api('GET', '/api/wallet');
  ok('概览里今日津贴变为已领', w2.body.data.daily.claimed === true, w2.body.data.daily);

  // ================= 3. 流水 =================
  console.log('\n=== 3. 流水 ===');
  var l1 = await api('GET', '/api/wallet/ledger?limit=10');
  eq('流水 200', l1.status, 200);
  var rows = l1.body.data.list || [];
  ok('流水含 welcome + daily 两笔', rows.length >= 2 &&
    rows.some(function (r) { return r.kind === 'welcome'; }) &&
    rows.some(function (r) { return r.kind === 'daily'; }),
    rows.map(function (r) { return r.kind; }).join(','));
  ok('每笔带余额快照（可对账）', rows.every(function (r) { return typeof r.balance_after === 'number'; }),
    rows.map(function (r) { return r.balance_after; }));
  eq('最新一笔余额 = 当前余额', rows[0].balance_after, 1020);

  var lIn = await api('GET', '/api/wallet/ledger?limit=10&direction=in');
  ok('收入筛选只有正数', (lIn.body.data.list || []).every(function (r) { return r.delta_cent > 0; }),
    (lIn.body.data.list || []).map(function (r) { return r.delta_cent; }));
  var lOut = await api('GET', '/api/wallet/ledger?limit=10&direction=out');
  eq('支出筛选为空（还没花钱）', (lOut.body.data.list || []).length, 0);

  // ================= 4. 找同学 =================
  console.log('\n=== 4. 找同学 ===');
  var s1 = await api('GET', '/api/wallet/search?q=251902');
  eq('按学号搜到同学', (s1.body.data.list || []).length, 1);
  eq('返回昵称', s1.body.data.list[0].name, '测试2');
  var s2 = await api('GET', '/api/wallet/search?q=' + encodeURIComponent('测试3'));
  ok('按昵称搜到同学', (s2.body.data.list || []).some(function (x) { return x.user_id === '251903'; }),
    s2.body.data.list);
  var s3 = await api('GET', '/api/wallet/search?q=' + encodeURIComponent('测试1'));
  ok('搜索不会把自己列出来', !(s3.body.data.list || []).some(function (x) { return x.user_id === '251901'; }),
    s3.body.data.list);

  // ================= 4b. 线下充值（班管录入） =================
  // 转账 / 红包 / 跨班只允许「充值学元」；开户赠金与每日津贴属于「赠送学元」。
  // 所以先用班管身份给三个测试账号各录一笔线下充值，后面的支付用例才有资金池可用。
  console.log('\n=== 4b. 线下充值 ===');
  // 班管身份：auth 中间件会以库里的 is_admin 为准，所以先落库再签 token
  db.prepare("UPDATE users SET is_admin = 1 WHERE user_id = '251901'").run();
  var TADMIN = jwt.sign({ user_id: '251901', is_admin: 1, is_class_admin: 1, role: 'admin' },
    'wallet-test-secret', { expiresIn: '1h' });
  // 先开户，确保赠金先入账，再看充值是否只进充值池
  await api('GET', '/api/wallet', { token: T2 });
  await api('GET', '/api/wallet', { token: T3 });

  var rc = await api('POST', '/api/xueyuan/admin/recharge', {
    token: TADMIN,
    body: { userIds: ['251901', '251902', '251903'], yuan: 10, memo: '校园卡线下充值', requestId: 'rc-wallet' }
  });
  eq('班管录入线下充值 200', rc.status, 200);
  eq('三人充值成功', (rc.body.data.done || []).length, 3);
  eq('充值按 1:100 换算', rc.body.data.rate, 100);

  var wRc = (await api('GET', '/api/wallet')).body.data.account;
  eq('充值进入充值学元', wRc.cash, 1000);
  eq('赠送学元不受影响', wRc.grant, 1020);
  eq('总余额 = 1020 赠送 + 1000 充值', wRc.balance, 2020);
  eq('可提现额度只认充值学元', wRc.withdrawable, 1000);

  var rcAgain = await api('POST', '/api/xueyuan/admin/recharge', {
    token: TADMIN,
    body: { userIds: ['251901'], yuan: 10, memo: '重复请求号', requestId: 'rc-wallet' }
  });
  var wRc2 = (await api('GET', '/api/wallet')).body.data.account;
  ok('同一请求号重复充值不重复入账',
    wRc2.balance === 2020 && rcAgain.body.data.done[0].duplicate === true,
    { balance: wRc2.balance, dup: rcAgain.body.data.done[0].duplicate });

  var rcForbidden = await api('POST', '/api/xueyuan/admin/recharge', {
    token: T2, body: { userIds: ['251901'], yuan: 10 }
  });
  ok('普通学生不能录充值（403）', rcForbidden.status === 403, rcForbidden.body.message);

  // 再给 A 追加一笔 2000 元（单笔上限）充值：后面要连续发大额转账验证「当日额度」，
  // 需要足够多的充值学元做支撑。
  var rcMore = await api('POST', '/api/xueyuan/admin/recharge', {
    token: TADMIN,
    body: { userIds: ['251901'], yuan: 2000, memo: '额度回归垫资', requestId: 'rc-wallet-quota' }
  });
  eq('追加充值 200', rcMore.status, 200);
  eq('追加充值到账 200000 学元', (await api('GET', '/api/wallet')).body.data.account.cash, 201000);

  // ---- 4c. 管理端准入：外班镜像 / 停用账号 ----
  // 给外班镜像充值或发放 = 铸币到一个本班永远没人登录的账户（死钱）；
  // 停用账号不能收钱；全员失败必须报错，不能返回 200 让班管误以为已生效。
  console.log('\n=== 4c. 管理端准入 ===');
  var rcMirror = await api('POST', '/api/xueyuan/admin/recharge', {
    token: TADMIN,
    body: { userIds: ['251802'], yuan: 10, memo: '给外班同学充值', requestId: 'rc-mirror' }
  });
  ok('给外班镜像账号充值被拒', rcMirror.status === 400 && /外班/.test(rcMirror.body.message), rcMirror.body.message);

  var rcDisabled = await api('POST', '/api/xueyuan/admin/recharge', {
    token: TADMIN,
    body: { userIds: ['251801'], yuan: 10, memo: '给停用账号充值', requestId: 'rc-disabled' }
  });
  ok('给停用账号充值被拒', rcDisabled.status === 400 && /停用/.test(rcDisabled.body.message), rcDisabled.body.message);

  var grMirror = await api('POST', '/api/xueyuan/admin/grant', {
    token: TADMIN,
    body: { userIds: ['251802'], amount: 10, memo: '外班发放', requestId: 'gr-mirror' }
  });
  ok('给外班镜像账号发放被拒', grMirror.status === 400 && /外班/.test(grMirror.body.message), grMirror.body.message);

  var grDisabled = await api('POST', '/api/xueyuan/admin/grant', {
    token: TADMIN,
    body: { userIds: ['251801'], amount: 10, memo: '停用发放', requestId: 'gr-disabled' }
  });
  ok('给停用账号发放被拒', grDisabled.status === 400 && /停用/.test(grDisabled.body.message), grDisabled.body.message);

  var grAllSkipped = await api('POST', '/api/xueyuan/admin/grant', {
    token: TADMIN,
    body: { userIds: ['251802', '999999'], amount: 10, memo: '全员跳过', requestId: 'gr-none' }
  });
  ok('全员跳过时返回失败而不是 200',
    grAllSkipped.status === 400 && /发放未生效/.test(grAllSkipped.body.message), grAllSkipped.body.message);

  // 发放上限跟 LIMITS 走：测试环境 1 元 = 100 学元，单人单次上限 10 元 = 1000 学元
  var grBig = await api('POST', '/api/xueyuan/admin/grant', {
    token: TADMIN, body: { userIds: ['251902'], amount: 1001, memo: '超限' }
  });
  ok('超过单人发放上限被拒且按汇率折算',
    grBig.status === 400 && /1000 学元/.test(grBig.body.message), grBig.body.message);

  // 扣减不拦停用账号：班管需要能回收停用账号的余额
  var grNormal = await api('POST', '/api/xueyuan/admin/grant', {
    token: TADMIN,
    body: { userIds: ['251804'], amount: 10, memo: '发放后停用', requestId: 'gr-251804' }
  });
  eq('正常账号发放 200', grNormal.status, 200);
  db.prepare("UPDATE users SET status = 'disabled' WHERE user_id = '251804'").run();
  var ddDisabled = await api('POST', '/api/xueyuan/admin/deduct', {
    token: TADMIN,
    body: { userIds: ['251804'], amount: 1, memo: '回收停用账号余额', requestId: 'dd-251804' }
  });
  eq('停用账号允许扣减', ddDisabled.status, 200);

  // ================= 5. 支付密码 =================
  console.log('\n=== 5. 支付密码 ===');
  var ps0 = await api('GET', '/api/wallet/pay-pin');
  ok('初始状态：未设置', ps0.body.data.set === false, ps0.body.data);

  var noPwd = await api('POST', '/api/wallet/pay-pin', { body: { pin: PIN, password: '' } });
  ok('设置支付密码必须验证登录密码', noPwd.status === 400 && /登录密码/.test(noPwd.body.message), noPwd.body.message);

  var weak1 = await api('POST', '/api/wallet/pay-pin', { body: { pin: '111111', password: 'test1234' } });
  ok('拒绝 6 个相同数字', weak1.status === 400, weak1.body.message);
  var weak2 = await api('POST', '/api/wallet/pay-pin', { body: { pin: '123456', password: 'test1234' } });
  ok('拒绝连续数字', weak2.status === 400, weak2.body.message);

  var setOk = await api('POST', '/api/wallet/pay-pin', { body: { pin: PIN, password: 'test1234' } });
  eq('设置支付密码 200', setOk.status, 200);
  // 251902 也要设：扫码付款用例是「B 付给 A」
  await api('POST', '/api/wallet/pay-pin', { token: T2, body: { pin: PIN, password: 'test1234' } });
  var ps1 = await api('GET', '/api/wallet/pay-pin');
  ok('状态变为已设置', ps1.body.data.set === true && ps1.body.data.locked === false, ps1.body.data);

  var dupSet = await api('POST', '/api/wallet/pay-pin', { body: { pin: '135791', password: 'test1234' } });
  ok('重复设置被拒（要走修改）', dupSet.status === 400 && /已设置/.test(dupSet.body.message), dupSet.body.message);

  var noPinTr = await api('POST', '/api/wallet/transfer', { body: { to: '251902', amount: 1 } });
  ok('转账不带支付密码被拒', noPinTr.status === 400 && /支付密码/.test(noPinTr.body.message), noPinTr.body.message);

  var wrongPin = await api('POST', '/api/wallet/transfer', { body: { to: '251902', amount: 1, pin: '000001' } });
  ok('支付密码错被拒且提示剩余次数',
    wrongPin.status === 400 && wrongPin.body.data && wrongPin.body.data.pay_pin &&
    wrongPin.body.data.pay_pin.remaining === 4,
    wrongPin.body.data || wrongPin.body.message);

  var changeBad = await api('POST', '/api/wallet/pay-pin/change', { body: { old_pin: '000002', new_pin: '135791' } });
  eq('修改支付密码要验旧密码', changeBad.status, 400);
  var changeOk = await api('POST', '/api/wallet/pay-pin/change', { body: { old_pin: PIN, new_pin: '135791' } });
  eq('修改支付密码 200', changeOk.status, 200);
  var changeBack = await api('POST', '/api/wallet/pay-pin/change', { body: { old_pin: '135791', new_pin: PIN } });
  eq('改回测试密码', changeBack.status, 200);

  // ================= 6. 转账 =================
  console.log('\n=== 6. 转账 ===');
  var tr1 = await api('POST', '/api/wallet/transfer', {
    body: { to: '251902', amount: 50, memo: '请你喝水', request_id: 'req-1', pin: PIN }
  });
  eq('转账 200', tr1.status, 200);
  eq('转出后余额 202020 → 201970', tr1.body.data.account.balance, 201970);
  eq('只扣充值学元 201000 → 200950', tr1.body.data.account.cash, 200950);
  eq('赠送学元不被挪用', tr1.body.data.account.grant, 1020);
  eq('收款方昵称回填', tr1.body.data.to_name, '测试2');

  var tr2 = await api('POST', '/api/wallet/transfer', {
    body: { to: '251902', amount: 50, memo: '请你喝水', request_id: 'req-1', pin: PIN }
  });
  ok('同一 request_id 重放不重复扣钱（幂等）', tr2.body.data.duplicate === true && tr2.body.data.account.balance === 201970,
    { dup: tr2.body.data.duplicate, balance: tr2.body.data.account.balance });

  var wB = await api('GET', '/api/wallet', { token: T2 });
  eq('收款方余额 2000 + 50 = 2050', wB.body.data.account.balance, 2050);

  var trSelf = await api('POST', '/api/wallet/transfer', { body: { to: '251901', amount: 1, pin: PIN } });
  eq('不能给自己转账', trSelf.status, 400);
  var trGhost = await api('POST', '/api/wallet/transfer', { body: { to: '999999', amount: 1, pin: PIN } });
  ok('学号不存在被拒', trGhost.status === 400 && /没找到/.test(trGhost.body.message), trGhost.body.message);

  // ---- 状态字段回归（2026-11-05 生产事故：给班管转账转不了）----
  // 旧版「升/降管理员」事件会把 users.status 写成 admin_promoted / admin_demoted，
  // 于是班管从选人列表消失、转账报「没找到」、跨班校验判他「不是有效用户」。
  var ppl = await api('GET', '/api/wallet/people', { token: T1 });
  var list = ppl.body.data.list || [];
  var rowAdmin = list.filter(function (p) { return p.user_id === '251800'; })[0];
  ok('脏状态班管仍出现在选人列表', !!rowAdmin, list);
  ok('选人列表标出班管身份', !!rowAdmin && rowAdmin.class_admin === true, rowAdmin);
  ok('停用账号不出现在选人列表', !list.some(function (p) { return p.user_id === '251801'; }), list);

  var trAdmin = await api('POST', '/api/wallet/transfer', {
    body: { to: '251800', amount: 20, pin: PIN, memo: '交给班管' }
  });
  eq('转账给班管 200', trAdmin.status, 200);

  var trDead = await api('POST', '/api/wallet/transfer', { body: { to: '251801', amount: 1, pin: PIN } });
  ok('给停用账号转账被拒且提示明确', trDead.status === 400 && /停用/.test(trDead.body.message), trDead.body.message);
  var trBig = await api('POST', '/api/wallet/transfer', { body: { to: '251902', amount: 60000, pin: PIN } });
  ok('超过单笔上限（50000）被拒', trBig.status === 400 && /单笔/.test(trBig.body.message), trBig.body.message);

  // 当日额度：先成功转 3 笔 50000（含前面 50，累计 150050），下一笔 50000 才会顶破 200000
  for (var fi = 0; fi < 3; fi++) {
    var trFill = await api('POST', '/api/wallet/transfer', {
      body: { to: '251902', amount: 50000, request_id: 'req-fill-' + fi, pin: PIN }
    });
    eq('额度填充转账 #' + (fi + 1) + ' 200', trFill.status, 200);
  }
  var trQuota = await api('POST', '/api/wallet/transfer', { body: { to: '251902', amount: 50000, pin: PIN } });
  ok('超过当日转出额度被拒', trQuota.status === 400 && /额度/.test(trQuota.body.message), trQuota.body.message);
  var trZero = await api('POST', '/api/wallet/transfer', { body: { to: '251902', amount: 0, pin: PIN } });
  eq('金额 0 被拒', trZero.status, 400);

  // ================= 6. 红包 =================
  console.log('\n=== 6. 红包 ===');
  var pk1 = await api('POST', '/api/wallet/packet', { body: { total: 30, count: 2, note: '新年快乐', pin: PIN } });
  eq('发红包 200', pk1.status, 200);
  var packetId = pk1.body.data.id;
  ok('发红包返回 id 与冻结金额', packetId > 0 && pk1.body.data.total === 30, pk1.body.data);

  var wAfterPacket = await api('GET', '/api/wallet');
  eq('发红包后余额不变（冻结而非扣款）', wAfterPacket.body.data.account.balance, 51950);
  eq('冻结金额 30', wAfterPacket.body.data.account.frozen, 30);
  eq('可用余额 51920', wAfterPacket.body.data.account.available, 51920);
  // 红包在「被领取」之前只有冻结、没有分录，额度也必须立刻占用，
  // 否则连发几个红包就能绕过当日转出上限（70 + 150000 + 30 → 剩 49900）
  eq('发红包立即占用当日转出额度（未领取也占）',
    Math.round(wAfterPacket.body.data.limits.daily_left), 49900);

  var pListB = await api('GET', '/api/wallet/packets', { token: T2 });
  ok('同学能看到可领红包', (pListB.body.data.available || []).some(function (p) { return p.id === packetId; }),
    (pListB.body.data.available || []).map(function (p) { return p.id; }));

  var cl1 = await api('POST', '/api/wallet/packet/' + packetId + '/claim', { token: T2 });
  eq('领取红包 200', cl1.status, 200);
  ok('领到正数金额', cl1.body.data.amount > 0 && cl1.body.data.amount <= 30, cl1.body.data.amount);

  var cl2 = await api('POST', '/api/wallet/packet/' + packetId + '/claim', { token: T2 });
  ok('重复领取不重复发钱', cl2.body.data.duplicate === true, cl2.body.data);

  var selfClaim = await api('POST', '/api/wallet/packet/' + packetId + '/claim', { token: T1 });
  ok('不能领自己的红包', selfClaim.status === 400 && /自己/.test(selfClaim.body.message), selfClaim.body.message);

  await api('GET', '/api/wallet', { token: T3 });   // 先开户（转账要求对方账户已存在）
  var cl3 = await api('POST', '/api/wallet/packet/' + packetId + '/claim', { token: T3 });
  eq('第三个人可以领（最后一个拿剩余）', cl3.status, 200);
  var cl4 = await api('POST', '/api/wallet/packet/' + packetId + '/claim', { token: T3 });
  ok('同一人第二次领取判重', cl4.body.data.duplicate === true, cl4.body.data);

  // 领取记录：谁能看、看到什么
  var pkDetail = await api('GET', '/api/wallet/packet/' + packetId + '/claims', { token: T1 });
  eq('发送者能查看领取记录', pkDetail.status, 200);
  var pkClaims = (pkDetail.body.data && pkDetail.body.data.claims) || [];
  ok('记录列出 2 人且金额合计 30',
    pkClaims.length === 2 &&
    Math.abs(pkClaims.reduce(function (s, x) { return s + x.amount; }, 0) - 30) < 0.01,
    pkClaims);
  ok('每条记录带领取人和金额',
    pkClaims.every(function (x) { return !!x.name && typeof x.amount === 'number'; }),
    pkClaims);

  var outsiderToken = jwt.sign({ user_id: '251800', is_admin: 0, is_class_admin: 0, role: 'student' },
    'wallet-test-secret', { expiresIn: '1h' });
  var pkOutsider = await api('GET', '/api/wallet/packet/' + packetId + '/claims', { token: outsiderToken });
  ok('没领过的人看不到领取记录',
    pkOutsider.status === 400 && /领过/.test(pkOutsider.body.message), pkOutsider.body.message);

  var wEnd = await api('GET', '/api/wallet');
  ok('红包领完后发送者冻结归零', wEnd.body.data.account.frozen === 0, wEnd.body.data.account.frozen);
  // 已领部分变成负分录、未领部分仍是 remaining_cent，两部分之和恒等于红包总额，
  // 所以领完不该让额度再扣一遍
  eq('红包领完后额度不重复扣（剩余 + 已领 = 总额）',
    Math.round(wEnd.body.data.limits.daily_left), 49900);
  ok('发送者余额减少（只减被领走的，未领完的会退还）',
    wEnd.body.data.account.balance < 51950 && wEnd.body.data.account.balance >= 51920,
    wEnd.body.data.account.balance);

  // 余额守恒：A 减少的 = B + C 增加的
  var wB2 = await api('GET', '/api/wallet', { token: T2 });
  var wC2 = await api('GET', '/api/wallet', { token: T3 });
  var aOut = 51950 - wEnd.body.data.account.balance;
  var bIn = wB2.body.data.account.balance - 152050;
  var cIn = wC2.body.data.account.balance - 2000;
  ok('红包金额守恒（A 支出 = B + C 收入，误差 < 0.01）',
    Math.abs(aOut - (bIn + cIn)) < 0.01,
    { aOut: aOut, bIn: bIn, cIn: cIn });

  // ================= 7. 过期退款 =================
  console.log('\n=== 7. 过期退款 ===');
  var pk2 = await api('POST', '/api/wallet/packet', { body: { total: 20, count: 4, note: '会过期', pin: PIN } });
  var pid2 = pk2.body.data.id;
  db.prepare('UPDATE xy_packet SET expire_at = ? WHERE id = ?').run(Date.now() - 1000, pid2);
  var beforeSweep = (await api('GET', '/api/wallet')).body.data.account;
  var afterSweepRes = await api('GET', '/api/wallet/packets');
  var afterSweep = (await api('GET', '/api/wallet')).body.data.account;
  ok('过期红包从可领列表消失',
    !(afterSweepRes.body.data.available || []).some(function (p) { return p.id === pid2; }),
    (afterSweepRes.body.data.available || []).map(function (p) { return p.id; }));
  ok('扫描后冻结退回', afterSweep.frozen === 0 && afterSweep.available === afterSweep.balance,
    { frozen: afterSweep.frozen, available: afterSweep.available, balance: afterSweep.balance });

  // ================= 8. 榜单 =================
  console.log('\n=== 8. 榜单 ===');
  var rank = await api('GET', '/api/wallet/leaderboard?limit=10');
  eq('榜单 200', rank.status, 200);
  var rl = rank.body.data.list || [];
  ok('榜单包含三个测试账号', ['251901', '251902', '251903'].every(function (uid) {
    return rl.some(function (r) { return r.user_id === uid; });
  }), rl.map(function (r) { return r.user_id; }));
  ok('榜单标记「我」', (rl.filter(function (r) { return r.is_me; }) || []).length === 1,
    rl.filter(function (r) { return r.is_me; }).map(function (r) { return r.user_id; }));
  ok('按余额降序', rl.every(function (r, i) { return i === 0 || rl[i - 1].balance >= r.balance; }),
    rl.map(function (r) { return r.balance; }));

  // ================= 9. 与学元内核一致 =================
  console.log('\n=== 9. 与 /api/xueyuan 同账 ===');
  var xyMe = await api('GET', '/api/xueyuan/me');
  var wMe = await api('GET', '/api/wallet');
  eq('钱包余额 = 学元内核余额', wMe.body.data.account.balance, xyMe.body.data.account.balance);
  eq('钱包冻结 = 学元内核冻结', wMe.body.data.account.frozen, xyMe.body.data.account.frozen);

  // 对账（复式记账守恒）——走 HTTP，避免主进程另开一个连接误连生产库
  try {
    db.prepare("UPDATE users SET is_admin = 1 WHERE user_id = '251901'").run();
    var TADMIN = jwt.sign({ user_id: '251901', is_admin: 1, is_class_admin: 1, role: 'admin' },
      'wallet-test-secret', { expiresIn: '1h' });
    var au = await api('GET', '/api/xueyuan/admin/audit', { token: TADMIN });
    ok('账本对账平衡', !!(au.body.data && au.body.data.ok), au.body.data || au.body);
  } catch (e) {
    ok('账本对账平衡（异常：' + e.message + '）', false);
  }

  // ================= 10. 收款码 =================
  console.log('\n=== 10. 收款码 ===');
  var qr = await api('GET', '/api/wallet/pay-code?base=' + encodeURIComponent('http://127.0.0.1:' + PORT));
  eq('签发收款码 200', qr.status, 200);
  var qrData = qr.body.data;
  ok('收款码带 token 与内容', !!qrData.token && /"u":"251901"/.test(qrData.content || ''),
    (qrData.content || '').slice(0, 70));

  var beforeQrB = (await api('GET', '/api/wallet', { token: T2 })).body.data.account.balance;
  var beforeQrA = (await api('GET', '/api/wallet')).body.data.account.balance;
  var qrPay = await api('POST', '/api/wallet/pay-code/pay', {
    token: T2,
    body: { code: qrData.code, amount: 5, pin: PIN, memo: '扫码给你的' }
  });
  if (qrPay.status !== 200) console.log('    [诊断] pay-code/pay →', JSON.stringify(qrPay.body));
  eq('扫码付款 200', qrPay.status, 200);
  eq('收款方 +5', (await api('GET', '/api/wallet')).body.data.account.balance - beforeQrA, 5);
  eq('付款方 -5', beforeQrB - (await api('GET', '/api/wallet', { token: T2 })).body.data.account.balance, 5);

  var selfQr = await api('POST', '/api/wallet/pay-code/pay', { body: { code: qrData.code, amount: 1, pin: PIN } });
  ok('不能扫自己的收款码', selfQr.status === 400 && /自己/.test(selfQr.body.message), selfQr.body.message);

  var badQr = await api('POST', '/api/wallet/pay-code/pay', { body: { code: 'not-a-code', amount: 1, pin: PIN } });
  eq('非法收款码被拒', badQr.status, 400);

  // ================= 11. 跨班支付（真起第二个实例） =================
  console.log('\n=== 11. 跨班支付 ===');
  var PEER_PORT = 9098;
  var PEER_DB = path.join(TMP, 'peer.db');
  var peerEnv = Object.assign({}, env, {
    PORT: String(PEER_PORT),
    WS_PORT: '19002',
    RELAY_PORT: '19012',
    DB_PATH: PEER_DB,
    RELAY_SERVER_ID: 'peer-class',
    WALLET_PEERS: 'main-class=http://127.0.0.1:' + PORT
  });
  var peerLog = '';
  var peer = spawn(process.execPath, ['src/app.js'], { cwd: SERVER_DIR, env: peerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  peer.stdout.on('data', function (b) { peerLog += b.toString(); });
  peer.stderr.on('data', function (b) { peerLog += b.toString(); });

  var peerReady = false;
  for (var pi = 0; pi < 60; pi++) {
    try {
      var hr = await fetch('http://127.0.0.1:' + PEER_PORT + '/api/system/health');
      if (hr.status === 200) { peerReady = true; break; }
    } catch (e) { /* not yet */ }
    await sleep(500);
  }
  ok('对端班级实例已启动（模拟另一个班）', peerReady);

  var PEER_BASE = 'http://127.0.0.1:' + PEER_PORT;
  var peerDb = new Database(PEER_DB);
  peerDb.pragma('busy_timeout = 5000');
  peerDb.prepare([
    'INSERT OR IGNORE INTO users (net_name, real_name, user_id, gender, password_hash, status, is_admin, info_json, created_at)',
    "VALUES (?, ?, ?, '女', ?, 'active', 0, '{}', ?)"
  ].join('\n')).run('对班同学', '对班同学', '252001', loginHash, nowIso);
  peerDb.close();

  var peerToken = jwt.sign({ user_id: '252001', is_admin: 0, is_class_admin: 0, role: 'student' },
    'wallet-test-secret', { expiresIn: '2h' });

  // 对班用户先开户 + 签发自己的收款码（base 指向对班实例）
  await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE });
  var peerQr = await api('GET', '/api/wallet/pay-code?base=' + encodeURIComponent(PEER_BASE),
    { token: peerToken, base: PEER_BASE });
  eq('对班签发收款码 200', peerQr.status, 200);
  ok('收款码里的地址指向对班', /127\.0\.0\.1:9098/.test(peerQr.body.data.content || ''), peerQr.body.data.base_url);

  var crossBeforeA = (await api('GET', '/api/wallet')).body.data.account.balance;
  var cross = await api('POST', '/api/wallet/cross/send', {
    body: { code: peerQr.body.data.code, amount: 10, pin: PIN, memo: '跨班买水' }
  });
  if (cross.status !== 200) console.log('    [诊断] cross/send →', JSON.stringify(cross.body));
  eq('跨班转账 200', cross.status, 200);
  ok('跨班记录已入账（paid）', cross.body.data && cross.body.data.tx && cross.body.data.tx.status === 'paid',
    cross.body.data && cross.body.data.tx);
  eq('本班余额 -10', crossBeforeA - (await api('GET', '/api/wallet')).body.data.account.balance, 10);

  var peerWallet = await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE });
  eq('对班余额 1000 + 10 = 1010', peerWallet.body.data.account.balance, 1010);

  var crossList = await api('GET', '/api/wallet/cross/tx');
  ok('本班能查到跨班记录', (crossList.body.data.list || []).some(function (x) { return x.status === 'paid'; }),
    (crossList.body.data.list || []).length);

  // 跨班也走「充值优先、赠送补足」：新同学只有开户赠金，
  // 验证赠送学元跨班后仍然是赠送学元，不会在对班变成可提现余额
  db.prepare([
    'INSERT OR IGNORE INTO users (net_name, real_name, user_id, gender, password_hash, status, is_admin, info_json, created_at)',
    "VALUES (?, ?, ?, '男', ?, 'active', 0, '{}', ?)"
  ].join('\n')).run('新同学', '新同学', '251904', loginHash, nowIso);
  var T4 = jwt.sign({ user_id: '251904', is_admin: 0, is_class_admin: 0, role: 'student' },
    'wallet-test-secret', { expiresIn: '2h' });
  var w4a = (await api('GET', '/api/wallet', { token: T4 })).body.data.account;
  eq('新同学没有充值学元', w4a.cash, 0);
  eq('新同学只有开户赠送 1000', w4a.grant, 1000);
  await api('POST', '/api/wallet/pay-pin', { token: T4, body: { pin: PIN, password: 'test1234' } });
  var peerAcctA = (await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE })).body.data.account;
  var crossGrant = await api('POST', '/api/wallet/cross/send', {
    token: T4, body: { code: peerQr.body.data.code, amount: 10, pin: PIN, memo: '跨班赠送学元' }
  });
  if (crossGrant.status !== 200) console.log('    [诊断] 赠送学元跨班 →', JSON.stringify(crossGrant.body));
  eq('纯赠送账户跨班 200', crossGrant.status, 200);
  var w4b = (await api('GET', '/api/wallet', { token: T4 })).body.data.account;
  eq('本班充值池不动', w4b.cash, 0);
  eq('本班赠送池 -10', w4b.grant, 990);
  var peerAcctB = (await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE })).body.data.account;
  eq('对班充值池不变', peerAcctB.cash, peerAcctA.cash);
  eq('对班赠送池 +10', peerAcctB.grant, peerAcctA.grant + 10);

  // 安全：伪造签名必须被拒
  var forged = await fetch(PEER_BASE + '/api/wallet/cross/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ts: Date.now(), ref: 'hack-1', from: '251901', from_name: 'hacker',
      token: peerQr.body.data.token, amount_cent: 100, sig: 'deadbeef'
    })
  });
  eq('伪造签名被拒 403', forged.status, 403);

  // 安全：过期时间戳（即使签名对也要拒）
  var expiredPayload = {
    ts: Date.now() - 10 * 60 * 1000, ref: 'old-1', from: '251901',
    token: peerQr.body.data.token, amount_cent: 100
  };
  // 主进程自行算签名（不能 require cross-pay：它会把生产库连接打开）
  var cryptoMod = require('crypto');
  function testSign(p) {
    var canonical = [
      String(p.ts), String(p.ref), String(p.from), String(p.token), String(p.amount_cent),
      String(p.from_server || ''), String(p.from_base || '')
    ].join('|');
    return cryptoMod.createHmac('sha256', 'wallet-test-secret').update(canonical).digest('hex');
  }
  expiredPayload.sig = testSign(expiredPayload);
  var expired = await fetch(PEER_BASE + '/api/wallet/cross/pay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expiredPayload)
  });
  eq('过期请求被拒 400', expired.status, 400);

  // 未知 token（签名正确）也必须被拒
  var noToken = {
    ts: Date.now(), ref: 'no-token-1', from: '251901', token: 'nope', amount_cent: 100
  };
  noToken.sig = testSign(noToken);
  var noTokRes = await fetch(PEER_BASE + '/api/wallet/cross/pay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(noToken)
  });
  eq('未知收款码被拒 400', noTokRes.status, 400);

  // ================= 11b. 跨班红包 =================
  console.log('\n=== 11b. 跨班红包 ===');

  var acctBefore = (await api('GET', '/api/wallet')).body.data.account;
  var pkCross = await api('POST', '/api/wallet/packet', {
    body: { total: 20, count: 2, note: '跨班试试', pin: PIN, scope: 'cross' }
  });
  if (pkCross.status !== 200) console.log('    [诊断] 发跨班红包 →', JSON.stringify(pkCross.body));
  eq('发跨班红包 200', pkCross.status, 200);
  var xcode = (pkCross.body.data || {}).code || '';
  ok('返回 6 位红包码', /^[A-Z0-9]{6}$/.test(xcode), xcode);
  eq('红包范围标记为 cross', (pkCross.body.data || {}).scope, 'cross');

  var acctAfterSend = (await api('GET', '/api/wallet')).body.data.account;
  eq('发出后冻结 +20', Math.round((acctAfterSend.frozen - acctBefore.frozen) * 100), 2000);

  // 本班同学凭口令领取（走本地分支，不经网络）
  var c1 = await api('POST', '/api/wallet/packet/claim-code', { token: T2, body: { code: xcode } });
  eq('本班同学凭口令领取 200', c1.status, 200);
  ok('本班领到金额 > 0', c1.body.data && c1.body.data.amount > 0, c1.body.data && c1.body.data.amount);

  // 对班同学凭口令领取：对班不认识这个码 → 查登记表 → 打到主班 → 分配 + 回收 → 对班 mint
  var peerBefore = (await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE })).body.data.account.balance;
  var c2 = await api('POST', '/api/wallet/packet/claim-code', {
    token: peerToken, base: PEER_BASE, body: { code: xcode }
  });
  if (c2.status !== 200) {
    console.log('    [诊断] 对班领口令 →', JSON.stringify(c2.body));
    console.log('    [诊断] 对班日志尾部 →', peerLog.split(/\r?\n/).filter(function (l) {
      return /packet-cross|peers|Error/.test(l);
    }).slice(-6).join(' | '));
  }
  eq('对班同学凭口令领取 200', c2.status, 200);
  var peerAfter = (await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE })).body.data.account.balance;
  ok('对班余额增加（跨班红包真的到账）', peerAfter > peerBefore,
    peerBefore + ' → ' + peerAfter);
  ok('对端标记为跨班领取', !!(c2.body.data && c2.body.data.remote), c2.body.data && c2.body.data.remote);

  // 重复领取：金额相同、余额不变（两端幂等）
  var c2b = await api('POST', '/api/wallet/packet/claim-code', {
    token: peerToken, base: PEER_BASE, body: { code: xcode }
  });
  var peerAfter2 = (await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE })).body.data.account.balance;
  ok('对班重复领取不重复加钱',
    c2b.status === 200 && Math.abs(peerAfter2 - peerAfter) < 0.001 && Number(c2b.body.data.amount) === Number(c2.body.data.amount),
    JSON.stringify({ amount1: c2.body.data.amount, amount2: c2b.body.data && c2b.body.data.amount, bal: peerAfter2 }));

  // 两个都领完后第三个人拿不到
  var c3 = await api('POST', '/api/wallet/packet/claim-code', { token: T3, body: { code: xcode } });
  ok('领完后第三人被拒（已领完/过期）', c3.status === 400 && /领完|过期/.test(c3.body.message || ''), c3.body.message);

  // 本班「我发出的」带红包码，便于再次分享
  var pkList2 = await api('GET', '/api/wallet/packets');
  var mineCross = ((pkList2.body.data || {}).mine || []).filter(function (x) { return x.code === xcode; })[0];
  ok('我发出的列表带红包码', !!mineCross && mineCross.scope === 'cross', mineCross && mineCross.code);

  // 对班「我领到的」要合并显示跨班记录
  var peerPk = await api('GET', '/api/wallet/packets', { token: peerToken, base: PEER_BASE });
  ok('对班「我领到的」含跨班记录',
    ((peerPk.body.data || {}).claimed || []).some(function (x) { return x.remote === true; }),
    ((peerPk.body.data || {}).claimed || []).length);

  // 安全：伪造签名的探测必须 403
  var forgedProbe = await fetch(PEER_BASE + '/api/wallet/cross/packet/probe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ts: Date.now(), kind: 'probe', code: xcode, sig: 'deadbeef' })
  });
  eq('跨班红包探测伪造签名被拒 403', forgedProbe.status, 403);

  // ================= 11c. 收款号跨班 =================
  console.log('\n=== 11c. 收款号跨班 ===');
  var peerShort = String(peerQr.body.data.token || '').slice(0, 8);
  var findRes = await api('GET', '/api/wallet/pay-code/find?short=' + peerShort);
  if (findRes.status !== 200) console.log('    [诊断] pay-code/find →', JSON.stringify(findRes.body));
  eq('凭 8 位收款号找到外班收款人', findRes.status, 200);
  ok('识别为跨班并给出完整收款码',
    !!(findRes.body.data && findRes.body.data.cross && findRes.body.data.code),
    findRes.body.data && { cross: findRes.body.data.cross, name: findRes.body.data.name });

  var peerBeforePay = (await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE })).body.data.account.balance;
  var qrCross = await api('POST', '/api/wallet/pay-code/pay', {
    body: { code: findRes.body.data.code, amount: 5, pin: PIN, memo: '扫码给对班' }
  });
  if (qrCross.status !== 200) console.log('    [诊断] pay-code/pay 跨班 →', JSON.stringify(qrCross.body));
  eq('扫码付给外班 200', qrCross.status, 200);
  ok('走的是跨班通道', !!(qrCross.body.data && qrCross.body.data.cross), qrCross.body.data && qrCross.body.data.status);
  var peerAfterPay = (await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE })).body.data.account.balance;
  eq('对班收款 +5', Math.round((peerAfterPay - peerBeforePay) * 100), 500);

  // ================= 11d. 指定红包 + 口令红包 =================
  console.log('\n=== 11d. 指定红包 + 口令红包 ===');
  
  // 指定（本班）：发给 251902 全额 20
  var dg = await api('POST', '/api/wallet/packet', {
    body: { total: 20, count: 1, kind: 'designated', targets: ['251902'], pin: PIN, note: '专属红包' }
  });
  if (dg.status !== 200) console.log('    [诊断] 发指定红包 →', JSON.stringify(dg.body));
  eq('发指定红包 200', dg.status, 200);
  ok('指定红包不需要红包码', !(dg.body.data && dg.body.data.code), dg.body.data && dg.body.data.scope);
  var dgc = await api('POST', '/api/wallet/packet/' + dg.body.data.id + '/claim', { token: T2 });
  eq('被指定人领到全额', dgc.body.data && dgc.body.data.amount, 20);
  var dgc2 = await api('POST', '/api/wallet/packet/' + dg.body.data.id + '/claim', { token: T3 });
  ok('非指定人被拒（不是发给你的）', dgc2.status === 400 && /发给你的/.test(dgc2.body.message || ''), dgc2.body.message);
  var dgc3 = await api('POST', '/api/wallet/packet/' + dg.body.data.id + '/claim', { token: T2 });
  ok('重复领取返回同一金额', dgc3.status === 200 && dgc3.body.data.duplicate === true, dgc3.body.data);
  
  // 指定（跨班）：含外班同学 → 自动 scope=cross + 生成红包码
  var dgx = await api('POST', '/api/wallet/packet', {
    body: { total: 8, count: 1, kind: 'designated', targets: ['252001'], pin: PIN }
  });
  eq('含外班指定红包 200', dgx.status, 200);
  ok('自动升级为跨班并生成红包码', (dgx.body.data || {}).scope === 'cross' && !!(dgx.body.data || {}).code,
    JSON.stringify({ scope: dgx.body.data && dgx.body.data.scope, code: dgx.body.data && dgx.body.data.code }));
  
  var peerB4 = (await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE })).body.data.account.balance;
  var dpx = await api('POST', '/api/wallet/packet/claim-code', {
    token: peerToken, base: PEER_BASE, body: { code: dgx.body.data.code }
  });
  if (dpx.status !== 200) console.log('    [诊断] 外班指定领取 →', JSON.stringify(dpx.body));
  eq('外班指定人领到全额 8', dpx.body.data && dpx.body.data.amount, 8);
  var peerA4 = (await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE })).body.data.account.balance;
  eq('对班余额 +8', Math.round((peerA4 - peerB4) * 100), 800);
  
  // 没被指定的人（本班 T3）不能领这个跨班指定红包
  var dpx3 = await api('POST', '/api/wallet/packet/claim-code', { token: T3, body: { code: dgx.body.data.code } });
  ok('非指定人领跨班红包被拒', dpx3.status === 400 && /发给你的/.test(dpx3.body.message || ''), dpx3.body.message);
  
  // 口令（本班）：口令错不能领；带空格差异能领
  var ph = await api('POST', '/api/wallet/packet', {
    body: { total: 6, count: 2, kind: 'phrase', note: '新年快乐', pin: PIN }
  });
  eq('发口令红包 200', ph.status, 200);
  var phBad = await api('POST', '/api/wallet/packet/' + ph.body.data.id + '/claim', { token: T2, body: { phrase: '万事如意' } });
  ok('口令错被拒', phBad.status === 400 && /口令/.test(phBad.body.message || ''), phBad.body.message);
  var phOk = await api('POST', '/api/wallet/packet/' + ph.body.data.id + '/claim', { token: T2, body: { phrase: ' 新年快乐 ' } });
  ok('口令对（忽略首尾空格）能领', phOk.status === 200 && phOk.body.data.amount > 0, phOk.body.data && phOk.body.data.amount);
  
  // 口令（跨班）：对班凭口令领取
  var phx = await api('POST', '/api/wallet/packet', {
    body: { total: 10, count: 2, kind: 'phrase', scope: 'cross', note: '考试必过', pin: PIN }
  });
  eq('发跨班口令红包 200', phx.status, 200);
  var pph = await api('POST', '/api/wallet/packet/claim-code', {
    token: peerToken, base: PEER_BASE, body: { phrase: '考试必过' }
  });
  if (pph.status !== 200) console.log('    [诊断] 对班口令领取 →', JSON.stringify(pph.body));
  eq('对班凭口令领到跨班红包', pph.status, 200);
  ok('金额大于 0', pph.body.data && pph.body.data.amount > 0, pph.body.data && pph.body.data.amount);
  var pphBad = await api('POST', '/api/wallet/packet/claim-code', {
    token: peerToken, base: PEER_BASE, body: { phrase: '科目二必过' }
  });
  ok('口令错领不了（跨班也一样）', pphBad.status === 400 && /口令|不存在/.test(pphBad.body.message || ''), pphBad.body.message);
  
  // 选人转账（跨班）：本班库根本没有 252001 → whois 问对班 → user 模式入账
  var tuW = (await api('GET', '/api/wallet', { token: T2 })).body.data;
  var tuB = tuW.account.balance;
  var tuPeerB = (await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE })).body.data.account.balance;
  var tu = await api('POST', '/api/wallet/transfer', {
    token: T2, body: { to: '252001', amount: 3, pin: PIN, memo: '选人转账' }
  });
  if (tu.status !== 200) console.log('    [诊断] 选人转账 →', JSON.stringify(tu.body));
  eq('转账给外班同学 200', tu.status, 200);
  ok('走的是跨班通道', !!(tu.body.data && tu.body.data.cross), tu.body.data && tu.body.data.status);
  var tuA = (await api('GET', '/api/wallet', { token: T2 })).body.data.account.balance;
  var tuPeerA = (await api('GET', '/api/wallet', { token: peerToken, base: PEER_BASE })).body.data.account.balance;
  eq('本班 -3', Math.round((tuB - tuA) * 100), 300);
  eq('对班 +3', Math.round((tuPeerA - tuPeerB) * 100), 300);
  var tuW2 = (await api('GET', '/api/wallet', { token: T2 })).body.data;
  eq('跨班转出成功后计入当日额度',
    Math.round((tuW.limits.daily_left - tuW2.limits.daily_left) * 100), 300);
  
  // ================= 11e. 额度只看转账，不看炒股 =================
  console.log('\n=== 11e. 额度只看转账 ===');
  // 生产事故复盘：风控额度把炒股支出（kind=trade）也算进去，
  // 学生买股票花了 1 万练习金后，转账/红包全被 400「额度不足」。
  // 回归：灌一笔 5000 元的 kind=trade 支出，转账必须照常成功。
  var dbQ = new Database(DB);
  dbQ.pragma('busy_timeout = 5000');
  var qTx = dbQ.prepare([
    'INSERT INTO xy_tx (ref, kind, app_name, memo, amount, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?)'
  ].join(' '));
  var qEntry = dbQ.prepare([
    'INSERT INTO xy_entry (tx_id, user_id, delta, balance_after, created_at)',
    'VALUES (?, ?, ?, ?, ?)'
  ].join(' '));
  var qNow = Date.now();
  var qIns = qTx.run('test-trade-' + qNow, 'trade', 'stock', '模拟买入', 500000, qNow);
  qEntry.run(qIns.lastInsertRowid, '251902', -500000, 100, qNow);
  dbQ.close();
  
  var trAfterTrade = await api('POST', '/api/wallet/transfer', {
    token: T2, body: { to: '251903', amount: 1, pin: PIN, memo: '额度回归' }
  });
  if (trAfterTrade.status !== 200) console.log('    [诊断] 额度回归 →', JSON.stringify(trAfterTrade.body));
  eq('炒股支出不计入转出额度（转账照常成功）', trAfterTrade.status, 200);
  
  try { peer.kill(); } catch (e) {}
  await sleep(300);
  
  // ================= 12. 连续输错锁定（放最后，会锁 15 分钟） =================
  
  // ================= 12. 连续输错锁定（放最后，会锁 15 分钟） =================
  console.log('\n=== 12. 支付密码锁定 ===');
  var setC = await api('POST', '/api/wallet/pay-pin', { token: T3, body: { pin: '246802', password: 'test1234' } });
  eq('第三个账号设置支付密码', setC.status, 200);

  var lastLock = null;
  for (var li = 0; li < 5; li++) {
    lastLock = await api('POST', '/api/wallet/transfer', { token: T3, body: { to: '251902', amount: 1, pin: '000000' } });
  }
  ok('连错 5 次后锁定', lastLock.status === 400 && lastLock.body.data &&
    lastLock.body.data.pay_pin && lastLock.body.data.pay_pin.locked === true,
    lastLock.body.data || lastLock.body.message);

  var correctWhileLocked = await api('POST', '/api/wallet/transfer', { token: T3, body: { to: '251902', amount: 1, pin: '246802' } });
  ok('锁定期间正确密码也不能支付', correctWhileLocked.status === 400 && /锁定/.test(correctWhileLocked.body.message),
    correctWhileLocked.body.message);

  var resetPin = await api('POST', '/api/wallet/pay-pin/reset', { token: T3, body: { password: 'test1234', new_pin: '975310' } });
  eq('用登录密码重设可解锁', resetPin.status, 200);
  var afterReset = await api('GET', '/api/wallet/pay-pin', { token: T3 });
  ok('重设后锁定解除', afterReset.body.data.locked === false, afterReset.body.data);

  console.log('\n=== 结果 ===');
  console.log('通过 ' + pass + ' / ' + (pass + fail) + (fail ? '，失败 ' + fail : ''));
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) {
  console.error('测试异常：', e);
  console.error('--- 服务端日志尾部 ---');
  console.error(serverLog.slice(-2500));
  process.exit(1);
});
