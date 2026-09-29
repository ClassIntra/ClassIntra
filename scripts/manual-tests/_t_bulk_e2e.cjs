// 端到端验收：CI 新增的 POST /api/admin/users/bulk-status（「全体」批量动作的执行端点）
//
// 设计原则：**零可见副作用**
//   - 真更新用「重放现状」：拿一个已永久封禁的用户，用他原本的 ban_reason 再封一次
//     → status / ban_expires_at / ban_reason 全部与原来一致，只有 updated_at 变。
//     enable 方向同理，取一个本来就 active 的用户。
//   - 拒绝路径天然无副作用：管理员 / 班管 / 不存在的学号。
//   - 不新建任何用户，不碰其他人的账号状态。
//
// 跑法（须在 CI 运行中；DB_PATH 为相对路径，必须以 server 为 cwd）：
//     cd D:/NetWork/Integration/ClassIntra/server && PYTHONPATH= node ../scripts/manual-tests/_t_bulk_e2e.cjs

const fs = require('fs');
const path = require('path');
const ROOT = 'D:/NetWork/Integration/ClassIntra';

const envPath = path.join(ROOT, 'server', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

const http = require('http');
const db = require(path.join(ROOT, 'server/src/utils/db'));
const constants = require(path.join(ROOT, 'server/src/utils/constants'));
const jwtUtil = require(path.join(ROOT, 'server/src/utils/jwt'));

const BASE = 'http://127.0.0.1:' + (parseInt(process.env.PORT, 10) || 9001);
const ENDPOINT = BASE + '/api/admin/users/bulk-status';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('PASS  ' + name + '  ->  ' + (detail || '')); pass++; }
  else { console.log('FAIL  ' + name + '  ->  ' + (detail || '')); fail++; }
}

function tokenFor(userId) {
  const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  if (!row) throw new Error('账号不存在: ' + userId);
  return jwtUtil.generateToken({
    user_id: row.user_id,
    net_name: row.net_name,
    real_name: row.real_name,
    is_admin: row.is_admin,
    is_class_admin: constants.isClassAdmin(row.user_id),
    role: row.role || 'user',
    officer_permissions: row.officer_permissions || '[]',
    officer_title: row.officer_title || '',
    gender: row.gender
  });
}

function call(token, body) {
  return new Promise(function (resolve) {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const u = new URL(ENDPOINT);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length
      }
    }, function (res) {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { buf += c; });
      res.on('end', function () {
        let parsed = {};
        try { parsed = JSON.parse(buf); } catch (e) { parsed = { message: buf.slice(0, 200) }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', function (e) { resolve({ status: 0, body: { message: e.message } }); });
    req.setTimeout(30000, function () { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

function userRow(uid) {
  return db.prepare('SELECT status, ban_expires_at, ban_reason, is_admin FROM users WHERE user_id = ?').get(uid);
}

// ---------------------------------------------------------------------------
// 自带夹具
//
// 教训（2026-09-29）：早期版本靠「库里恰好存在某种状态的样本」来跑真更新用例，
// 生产数据一变就整条跳过 —— 先是被判为 FAIL 吓一跳，实际什么都没验到。
// 2026-09-29 早上 18 班 50 人被真实解封后，F 用例就因此失效了一次。
//
// 这里统一改为：挑一个普通学生 → 快照封禁四列 → 改造成用例需要的状态 → 跑 →
// 按快照整行还原。于是「真更新」用例永远有样本、永远零残留。
// ---------------------------------------------------------------------------
const FIX_COLS = 'status, ban_expires_at, ban_reason, updated_at';

function pickFixtureUser() {
  // 排除管理员、班管（末两位 00）、机器人号，挑一个普通学生
  return db.prepare(
    "SELECT user_id FROM users WHERE COALESCE(is_admin, 0) = 0 " +
    "AND user_id NOT LIKE '____00' AND user_id NOT IN ('251800', 'linxi_ai') " +
    "ORDER BY user_id LIMIT 1"
  ).get();
}

function snapshot(uid) {
  return db.prepare('SELECT ' + FIX_COLS + ' FROM users WHERE user_id = ?').get(uid);
}

function restore(uid, snap) {
  db.prepare('UPDATE users SET status = ?, ban_expires_at = ?, ban_reason = ?, updated_at = ? WHERE user_id = ?')
    .run(snap.status, snap.ban_expires_at, snap.ban_reason, snap.updated_at, uid);
}

function restoredExactly(uid, snap) {
  const now = db.prepare('SELECT ' + FIX_COLS + ' FROM users WHERE user_id = ?').get(uid);
  return now.status === snap.status && now.ban_expires_at === snap.ban_expires_at &&
    now.ban_reason === snap.ban_reason && now.updated_at === snap.updated_at;
}

async function main() {
  const adminTok = tokenFor('linxi_ai');        // 系统管理员（机器人自己）

  // ── A. 缺 user_ids → 400 ──
  let r = await call(adminTok, { status: 'disabled' });
  check('A 缺 user_ids -> 400', r.status === 400 && /user_ids/.test(r.body.message || ''),
    r.status + ' ' + (r.body.message || ''));

  // ── B. 非法状态值 → 400 ──
  r = await call(adminTok, { status: 'xxx', user_ids: ['25999999'] });
  check('B 非法状态值 -> 400', r.status === 400 && /状态值/.test(r.body.message || ''),
    r.status + ' ' + (r.body.message || ''));

  // ── C. 非系统管理员（班管 250800）→ 403 ──
  const classAdmin = db.prepare(
    "SELECT user_id FROM users WHERE user_id <> '999999' AND is_admin <> 1"
  ).all().filter(function (x) { return constants.isClassAdmin(String(x.user_id)); })[0];
  if (classAdmin) {
    r = await call(tokenFor(classAdmin.user_id), { status: 'disabled', user_ids: ['25999999'] });
    check('C 班管调用 -> 403（仅系统管理员）', r.status === 403 && /仅系统管理员/.test(r.body.message || ''),
      classAdmin.user_id + ': ' + r.status + ' ' + (r.body.message || ''));
  } else {
    check('C 班管调用 -> 403（仅系统管理员）', false, '库里找不到班管样本，跳过');
  }

  // ── D. 不存在的学号 → affected=0 且进 failed ──
  r = await call(adminTok, { status: 'disabled', reason: 'e2e', user_ids: ['25999999', ''] });
  const d = (r.body && r.body.data) || {};
  check('D 不存在/空学号 -> 200 + affected=0 + failed 两条',
    r.status === 200 && d.affected === 0 && d.total === 2 && (d.failed || []).length === 2,
    JSON.stringify(d));

  // ── E. 管理员与班管被硬性拦下（无副作用）──
  const banTarget = db.prepare(
    "SELECT user_id, status, ban_expires_at, ban_reason FROM users WHERE user_id = '250800'"
  ).get();
  r = await call(adminTok, { status: 'disabled', reason: 'e2e', user_ids: ['251800', '250800', 'linxi_ai'] });
  const e = (r.body && r.body.data) || {};
  check('E 管理员/班管 -> 全部进 failed，affected=0',
    r.status === 200 && e.affected === 0 && (e.failed || []).length === 3,
    JSON.stringify((e.failed || []).map(function (f) { return f.target + ':' + f.message; })));
  const after = userRow('251800');
  check('E2 管理员状态未被改动', after.status !== 'disabled', '251800 status=' + after.status);

  // ── F. 真更新 · 封禁方向（重放现状，零变化）──
  // 必须挑「原因非空」的样本：本端点的空原因语义与单用户 PATCH 一致（写空串，不做
  // '批量操作' 兜底），所以原因本来就为 NULL 的样本回放后会从 NULL 变 ''，不算全等。
  // 夹具自带（见文件上方说明）：把用户临时改造成「永久封禁 + 原因非空」再回放。
  const fixtureF = pickFixtureUser();
  if (fixtureF) {
    const uid = fixtureF.user_id;
    const snap = snapshot(uid);
    const reason = 'e2e-重放-' + Date.now();
    db.prepare(
      "UPDATE users SET status = 'disabled', ban_expires_at = NULL, ban_reason = ? WHERE user_id = ?"
    ).run(reason, uid);
    r = await call(adminTok, { status: 'disabled', reason: reason, duration: 0, user_ids: [uid] });
    const f = (r.body && r.body.data) || {};
    const afterF = userRow(uid);
    const okF = r.status === 200 && f.affected === 1 && (f.failed || []).length === 0 &&
      afterF.status === 'disabled' && afterF.ban_expires_at === null &&
      afterF.ban_reason === reason;
    check('F 真封禁 1 人 -> affected=1 且行内容与原来逐字段一致', okF,
      uid + ' affected=' + f.affected + ' status=' + afterF.status +
      ' reason=' + JSON.stringify(afterF.ban_reason) + '（期望 ' + JSON.stringify(reason) + '）');
    restore(uid, snap);
    check('F3 夹具已整行还原', restoredExactly(uid, snap), uid + ' -> ' + JSON.stringify(snapshot(uid)));
  } else {
    check('F 真封禁 1 人 -> affected=1 且行内容与原来逐字段一致', false, '找不到可用夹具用户，跳过');
  }

  // ── F2. 空原因不做 '批量操作' 兜底（与单用户 PATCH 语义一致）──
  // 这条正是首轮跑出来的缺陷：批量路由原本沿用旧按班版本的 `reason || '批量操作'`，
  // 会把「管理员没给原因」写成一句假原因、覆盖用户原有字段。
  // 夹具自带，不依赖生产数据现状：早期版本挑「库里恰好存在 ban_reason IS NULL 的
  // 永久封禁样本」，生产数据一变就整条跳过（假 FAIL）。这里自己造一个：选一个普通
  // 学生，把封禁列临时改成「永久封禁 + 原因 NULL」，跑完按快照整行还原，零残留。
  const fixture = db.prepare(
    "SELECT user_id FROM users WHERE COALESCE(is_admin, 0) = 0 " +
    "AND user_id NOT LIKE '____00' AND user_id NOT IN ('251800', 'linxi_ai') " +
    "ORDER BY user_id LIMIT 1"
  ).get();
  if (fixture) {
    const uid = fixture.user_id;
    const cols = 'status, ban_expires_at, ban_reason, updated_at';
    const snap = db.prepare('SELECT ' + cols + ' FROM users WHERE user_id = ?').get(uid);
    db.prepare(
      "UPDATE users SET status = 'disabled', ban_expires_at = NULL, ban_reason = NULL WHERE user_id = ?"
    ).run(uid);
    r = await call(adminTok, { status: 'disabled', reason: '', duration: 0, user_ids: [uid] });
    const rr = db.prepare('SELECT ban_reason FROM users WHERE user_id = ?').get(uid);
    check('F2 空原因写空串（不兜底成「批量操作」）', rr.ban_reason === '',
      uid + ' ban_reason=' + JSON.stringify(rr.ban_reason));
    // 整行还原（含 updated_at），保证对生产数据零残留
    db.prepare('UPDATE users SET status = ?, ban_expires_at = ?, ban_reason = ?, updated_at = ? WHERE user_id = ?')
      .run(snap.status, snap.ban_expires_at, snap.ban_reason, snap.updated_at, uid);
    const back = db.prepare('SELECT ' + cols + ' FROM users WHERE user_id = ?').get(uid);
    check('F3 测试痕迹已整行还原',
      back.status === snap.status && back.ban_expires_at === snap.ban_expires_at &&
      back.ban_reason === snap.ban_reason && back.updated_at === snap.updated_at,
      uid + ' -> ' + JSON.stringify(back));
  } else {
    check('F2 空原因写空串（不兜底成「批量操作」）', false, '找不到可用夹具用户，跳过');
    check('F3 测试痕迹已整行还原', false, '跳过');
  }

  // ── G. 真更新 · 解封方向（重放现状，零变化）──
  const activeUser = db.prepare(
    "SELECT user_id FROM users WHERE status = 'active' AND is_admin <> 1 AND ban_expires_at IS NULL " +
    "AND ban_reason IS NULL LIMIT 1"
  ).get();
  if (activeUser) {
    r = await call(adminTok, { status: 'active', user_ids: [activeUser.user_id] });
    const g = (r.body && r.body.data) || {};
    const afterG = userRow(activeUser.user_id);
    check('G 真解封 1 人 -> affected=1 且状态仍为 active',
      r.status === 200 && g.affected === 1 && afterG.status === 'active' &&
      afterG.ban_expires_at === null && afterG.ban_reason === null,
      'affected=' + g.affected + ' status=' + afterG.status);
  } else {
    check('G 真解封 1 人 -> affected=1 且状态仍为 active', false, '找不到样本，跳过');
  }

  // ── H. 混合：真目标 + 不可操作目标 → affected 与 failed 并存 ──
  if (activeUser) {
    r = await call(adminTok, { status: 'active', user_ids: [activeUser.user_id, '251800', '25999999'] });
    const h = (r.body && r.body.data) || {};
    check('H 混合 3 目标 -> affected=1, failed=2',
      r.status === 200 && h.affected === 1 && h.total === 3 && (h.failed || []).length === 2,
      JSON.stringify(h));
  }

  // ── I. 审计落库（含具体学号，可追溯「批量封了谁」）──
  const log = db.prepare(
    "SELECT admin_id, action, target FROM admin_logs WHERE action IN ('bulk_disable_users','bulk_enable_users') " +
    "ORDER BY id DESC LIMIT 1"
  ).get();
  check('I 审计已落库（admin_id = 林晞自己）', !!log && log.admin_id === 'linxi_ai',
    log ? log.admin_id + ' / ' + log.action + ' / ' + log.target : '无记录');
  check('I2 审计 target 含真实学号', !!log && /\d{6}/.test(log.target || ''),
    log ? log.target : '无记录');

  console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
  return fail ? 1 : 0;
}

main().then(function (code) { process.exit(code); }, function (e) {
  console.error('异常：' + (e && e.message));
  process.exit(3);
});
