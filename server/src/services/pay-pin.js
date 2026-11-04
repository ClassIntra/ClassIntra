// 学元支付密码
// ============================================================
// 与登录密码的区别（别合并）：
//   登录密码 = 进这个班的凭证，错了由 auth 锁会话
//   支付密码 = 花这笔钱的凭证，错了只锁支付 15 分钟 —— 看余额、领津贴不受影响
//
// 规则（对齐微信支付的直觉）：
//   · 6 位数字
//   · 不能 6 位全相同（111111）、不能顺增/顺减（123456 / 654321）
//   · bcrypt 存储，任何人（包括班管）都看不到明文
//   · 连错 5 次锁 15 分钟；成功一次清零
//   · 忘记密码 → 用**登录密码**重置（不是找老师）
//
// 编码约定：var / function

var db = require('../utils/db');
var bcrypt = require('bcryptjs');
var pwdUtil = require('../utils/password');

var MAX_FAIL = 5;
var LOCK_MS = 15 * 60 * 1000;
var PIN_RE = /^\d{6}$/;

function ensure() {
  // 迁移已建表；这里兜底，防止在旧库上先调服务再迁移
  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_pay_pin (',
    '  user_id TEXT PRIMARY KEY,',
    '  pin_hash TEXT NOT NULL,',
    '  fail_count INTEGER NOT NULL DEFAULT 0,',
    '  locked_until INTEGER NOT NULL DEFAULT 0,',
    '  set_at INTEGER NOT NULL,',
    '  updated_at INTEGER NOT NULL',
    ')'
  ].join('\n'));
}

function nowMs() { return Date.now(); }

// 弱密码：微信允许 123456 吗？其实不允许「过于简单」的连续/重复
function weakReason(pin) {
  if (!PIN_RE.test(String(pin))) return '支付密码必须是 6 位数字';
  if (/^(\d)\1{5}$/.test(pin)) return '不能用 6 个相同的数字';
  var up = true, down = true;
  for (var i = 1; i < pin.length; i++) {
    var d = parseInt(pin[i], 10) - parseInt(pin[i - 1], 10);
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  if (up || down) return '不能用连续的数字（如 123456）';
  return '';
}

function row(userId) {
  ensure();
  return db.prepare('SELECT * FROM xy_pay_pin WHERE user_id = ?').get(String(userId));
}

// 状态（前端用来决定「去设置」还是「输密码」）
function state(userId) {
  var r = row(userId);
  if (!r) return { set: false, locked: false, locked_until: 0, fail_count: 0 };
  var locked = r.locked_until > nowMs();
  return {
    set: true,
    locked: locked,
    locked_until: locked ? r.locked_until : 0,
    fail_count: locked ? r.fail_count : 0,
    set_at: r.set_at
  };
}

function save(userId, pin) {
  ensure();
  var uid = String(userId);
  var weak = weakReason(pin);
  if (weak) throw new Error(weak);
  var hash = bcrypt.hashSync(String(pin), 10);
  var t = nowMs();
  db.prepare([
    'INSERT INTO xy_pay_pin (user_id, pin_hash, fail_count, locked_until, set_at, updated_at)',
    'VALUES (?, ?, 0, 0, ?, ?)',
    'ON CONFLICT(user_id) DO UPDATE SET pin_hash = excluded.pin_hash, fail_count = 0,',
    '  locked_until = 0, updated_at = excluded.updated_at'
  ].join('\n')).run(uid, hash, t, t);
  return { set: true };
}

// 校验登录密码（设置/重置支付密码前的身份验证）
function checkLoginPassword(userId, password) {
  var u = db.prepare('SELECT password_hash FROM users WHERE user_id = ?').get(String(userId));
  if (!u || !u.password_hash) throw new Error('账号异常，无法验证身份');
  if (!password) throw new Error('请输入登录密码');
  if (!pwdUtil.verifyPassword(String(password), u.password_hash)) throw new Error('登录密码不对');
  return true;
}

// 首次设置：必须验证登录密码（防止别人拿到未锁屏的平板直接设一个支付密码）
function setup(userId, pin, loginPassword) {
  if (row(userId)) throw new Error('支付密码已设置，请用「修改支付密码」');
  checkLoginPassword(userId, loginPassword);
  return save(userId, pin);
}

function change(userId, oldPin, newPin) {
  var r = row(userId);
  if (!r) throw new Error('还没设置支付密码');
  // ⚠️ verify 不抛错，只返回结果 —— 这里必须显式判断，
  // 否则「旧密码错了也能改密码」，等于支付密码形同虚设。
  var v = verify(userId, oldPin);
  if (!v.ok) {
    var err = new Error(v.error);
    err.pay_pin = v;
    throw err;
  }
  return save(userId, newPin);
}

// 忘记密码：登录密码验证通过即可重设（校园场景没有短信验证码）
function reset(userId, loginPassword, newPin) {
  checkLoginPassword(userId, loginPassword);
  return save(userId, newPin);
}

// 校验支付密码。返回 { ok, error, locked_until, remaining }
// 不抛错 —— 调用方要把「密码错」和「余额不足」区分开
function verify(userId, pin) {
  ensure();
  var uid = String(userId);
  var r = row(uid);
  if (!r) return { ok: false, error: '未设置支付密码', need_setup: true };

  var t = nowMs();
  if (r.locked_until > t) {
    return {
      ok: false,
      error: '支付密码连续输错，已锁定',
      locked: true,
      locked_until: r.locked_until,
      remaining: 0
    };
  }

  if (!PIN_RE.test(String(pin || ''))) {
    return { ok: false, error: '请输入 6 位支付密码', remaining: Math.max(0, MAX_FAIL - r.fail_count) };
  }

  if (!bcrypt.compareSync(String(pin), r.pin_hash)) {
    var fail = (r.fail_count || 0) + 1;
    var lockedUntil = 0;
    if (fail >= MAX_FAIL) {
      lockedUntil = t + LOCK_MS;
      fail = 0;   // 锁定后计数清零，解锁重新给 5 次
    }
    db.prepare('UPDATE xy_pay_pin SET fail_count = ?, locked_until = ?, updated_at = ? WHERE user_id = ?')
      .run(fail, lockedUntil, t, uid);
    if (lockedUntil) {
      return { ok: false, error: '连续输错 5 次，已锁定 15 分钟', locked: true, locked_until: lockedUntil, remaining: 0 };
    }
    return {
      ok: false,
      error: '支付密码不对',
      remaining: MAX_FAIL - fail
    };
  }

  if (r.fail_count || r.locked_until) {
    db.prepare('UPDATE xy_pay_pin SET fail_count = 0, locked_until = 0, updated_at = ? WHERE user_id = ?')
      .run(t, uid);
  }
  return { ok: true, remaining: MAX_FAIL };
}

// 需要密码的接口统一用这个：错就抛，路由层转 400
function requirePin(userId, pin) {
  var r = verify(userId, pin);
  if (!r.ok) {
    var err = new Error(r.error);
    err.payPin = r;
    throw err;
  }
  return true;
}

module.exports = {
  ensure: ensure,
  state: state,
  setup: setup,
  change: change,
  reset: reset,
  verify: verify,
  requirePin: requirePin,
  weakReason: weakReason,
  MAX_FAIL: MAX_FAIL,
  LOCK_MS: LOCK_MS
};
