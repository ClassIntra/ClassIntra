// 学元收款码
// ============================================================
// 为什么收款码要由**收款方所在班级签发**并落库：
//   users 表里有跨班镜像用户，光凭学号无法判断「这个人属于哪个班」。
//   如果允许付款方在请求里自报收款人，镜像用户就能被凭空入账（钱进了不会登录的账号）。
//   收款码 = 本班签发的 token：只有在本班登录过的人才能拿到，对端入账只认 token。
//
// 内容格式（base64url JSON）：
//   { v:1, u:'251801', t:'<token>', b:'http://<本班地址>:9001', n:'张三' }
//   v=版本 u=学号 t=token b=对端 HTTP 基址 n=昵称（仅展示，不参与校验）
//
// 有效期 30 天，可重复收款（微信个人码也是长期码）。吊销由用户重新生成覆盖。

var crypto = require('crypto');
var os = require('os');
var db = require('../utils/db');
var config = require('../config');

var TTL = 30 * 24 * 3600 * 1000;

function ensure() {
  db.exec(`
CREATE TABLE IF NOT EXISTS xy_pay_code (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  base_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_xy_pay_code_user ON xy_pay_code(user_id);
`);
}

function serverId() {
  return String(
    (config.relay && config.relay.serverId) ||
    process.env.WALLET_SERVER_ID ||
    os.hostname()
  ).slice(0, 64);
}

// base 只接受 http/https，去掉尾部斜杠；跨班支付要用它回连
function normalizeBase(base) {
  var b = String(base || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[A-Za-z0-9_.:\-\[\]]{3,120}$/.test(b)) throw new Error('收款地址不合法');
  return b;
}

function userName(uid) {
  try {
    var r = db.prepare('SELECT net_name, real_name FROM users WHERE user_id = ?').get(String(uid));
    return (r && (r.net_name || r.real_name)) || '';
  } catch (e) { return ''; }
}

// 取当前有效的收款码；没有就生成一个（同一用户长期复用，便于贴二维码）
function issue(userId, base) {
  ensure();
  var uid = String(userId);
  var now = Date.now();
  var b = normalizeBase(base);

  var cur = db.prepare('SELECT * FROM xy_pay_code WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
    .get(uid, now);

  if (cur) {
    // 地址变了（换网络/换实例）要更新，否则二维码指向旧地址
    if (cur.base_url !== b) {
      db.prepare('UPDATE xy_pay_code SET base_url = ? WHERE token = ?').run(b, cur.token);
      cur.base_url = b;
    }
    return view(cur);
  }

  var token = crypto.randomBytes(18).toString('hex');
  db.prepare([
    'INSERT INTO xy_pay_code (token, user_id, server_id, base_url, created_at, expires_at, uses)',
    'VALUES (?, ?, ?, ?, ?, ?, 0)'
  ].join('\n')).run(token, uid, serverId(), b, now, now + TTL);

  return view(db.prepare('SELECT * FROM xy_pay_code WHERE token = ?').get(token));
}

function view(row) {
  var payload = {
    v: 1,
    u: row.user_id,
    t: row.token,
    b: row.base_url,
    n: userName(row.user_id)
  };
  var raw = JSON.stringify(payload);
  return {
    user_id: row.user_id,
    name: payload.n,
    token: row.token,
    server_id: row.server_id,
    base_url: row.base_url,
    expires_at: row.expires_at,
    uses: row.uses,
    // 前端用这个字符串生成二维码（不用自己拼 JSON）
    content: raw,
    code: Buffer.from(raw, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  };
}

function decode(code) {
  var raw = String(code || '').trim();
  if (!raw) throw new Error('收款码为空');
  // 允许直接传 base64url 或原始 JSON
  var text = raw;
  if (raw[0] !== '{') {
    text = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  }
  var obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error('收款码格式不对'); }
  if (!obj || obj.v !== 1 || !obj.u || !obj.t) throw new Error('不是有效的学元收款码');
  return {
    version: 1,
    user_id: String(obj.u),
    token: String(obj.t),
    base_url: String(obj.b || ''),
    name: String(obj.n || '')
  };
}

// 校验 token：必须存在、未过期、属于该学号
function verify(token, userId) {
  ensure();
  var row = db.prepare('SELECT * FROM xy_pay_code WHERE token = ?').get(String(token));
  if (!row) throw new Error('收款码无效（可能已重新生成）');
  if (row.expires_at <= Date.now()) throw new Error('收款码已过期，请让对方刷新');
  if (userId && String(row.user_id) !== String(userId)) throw new Error('收款码与收款人不匹配');
  return row;
}

function touch(token) {
  try {
    db.prepare('UPDATE xy_pay_code SET uses = uses + 1 WHERE token = ?').run(String(token));
  } catch (e) { /* 计数失败不影响收款 */ }
}

module.exports = {
  ensure: ensure,
  issue: issue,
  decode: decode,
  verify: verify,
  touch: touch,
  serverId: serverId,
  normalizeBase: normalizeBase,
  TTL: TTL
};
