// 跨班红包 / 跨班找人（领取方一侧）
// ============================================================
// 红包的钱冻结在**发送者所在班**。跨班领取时：
//
//   1. 领取方班级落一条 pending（ref 幂等）—— 先记账再发请求，避免「钱过去了但没人认领」
//   2. POST 到发送方班级 /api/wallet/cross/packet/claim（HMAC 签名）
//   3. 发送方：分配金额 → 解冻 + 回收（钱离开那一本账）→ 记录领取（含 remote 标记）→ 回传金额
//   4. 领取方：mint 一笔等额给领取人（ref = xpacket:<班级>:<红包>:<学号>，天然幂等）
//
// 幂等性来自两端：
//   · 发送方 xy_packet_claim 有 (packet_id, user_id) 主键 → 重复请求返回同一金额
//   · 领取方 mint 的 ref 是确定的 → 重复 mint 不会加钱
// 因此「响应丢了」也能安全重试。
//
// 三种定位方式（locator，都放在信封的 code 字段里参与签名）：
//   · 'ABC123'      红包码（拼手气跨班红包）
//   · '新年快乐'    口令（口令红包；发送方按口令查找）
//   · 'pid:42'      发送方的红包 id（聊天卡片直带，指定红包用这个）
//
// 另提供 whois：按学号问「这个人在哪个班」，给转账选人用（xy_user_home 做缓存）。

var crypto = require('crypto');
var db = require('../utils/db');
var xy = require('./xueyuan');
var peers = require('./peers');
var crossPay = require('./cross-pay');
var yuanbao = require('./yuanbao');
var payCode = require('./pay-code');

var RETRY_GAP = 60 * 1000;
var MAX_ATTEMPTS = 30;          // 约 30 分钟；领取接口幂等，重试是安全的
var ready = false;
var retryTimer = null;
var retrying = false;

function ensure() {
  if (ready) return;
  db.exec(`
CREATE TABLE IF NOT EXISTS xy_cross_packet (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  packet_id INTEGER,
  owner_server TEXT,
  owner_base TEXT NOT NULL,
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount_cent INTEGER,
  note TEXT,
  sender_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xy_cross_packet_user ON xy_cross_packet(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_xy_cross_packet_status ON xy_cross_packet(status, updated_at);

CREATE TABLE IF NOT EXISTS xy_user_home (
  user_id TEXT PRIMARY KEY,
  server_id TEXT,
  base_url TEXT NOT NULL,
  name TEXT,
  last_seen INTEGER NOT NULL
);
`);
  ready = true;
}

function nowMs() { return Date.now(); }
function normCode(c) { return String(c || '').trim().toUpperCase(); }

// ---- 签名（与 cross-pay 共用 RELAY_SECRET，但用独立 canonical）----
function canonical(p) {
  return [
    'xpk1',
    String(p.ts || ''),
    String(p.kind || ''),
    String(p.ref || ''),
    String(p.code || ''),
    String(p.claimer || ''),
    String(p.from_server || ''),
    String(p.from_base || ''),
    String(p.phrase || '')
  ].join('|');
}

function sign(p) { return crossPay.rawSign(canonical(p)); }

function envelope(kind, extra) {
  var p = {
    ts: nowMs(),
    kind: kind,
    ref: extra.ref || '',
    code: extra.code || '',
    claimer: extra.claimer || '',
    from_server: peers.serverId(),
    from_base: peers.localBaseHint() || '',
    phrase: extra.phrase || ''
  };
  p.sig = sign(p);
  return p;
}

function pidLocator(packetId) { return 'pid:' + packetId; }
function isPid(s) { return /^pid:\d+$/.test(String(s || '')); }
function pidOf(s) { return parseInt(String(s).slice(4), 10); }

// 探测某班是否持有这个红包（locator：红包码 / 口令 / pid:xx）
async function probe(base, locator) {
  try {
    var body = envelope('probe', { code: locator });
    var r = await crossPay.postJson(base, '/api/wallet/cross/packet/probe', body);
    if (r.status === 200 && r.body && r.body.code === 200 && r.body.data && r.body.data.packet) {
      return r.body.data;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// 找到红包归属：显式给了 base 就直接问；否则问登记表里的所有班
async function resolveOwner(locator, baseHint) {
  ensure();
  var hint = peers.normalizeBase(baseHint || '');
  if (hint) {
    var d = await probe(hint, locator);
    if (d) return { base_url: hint, server_id: (d.packet && d.packet.server_id) || d.server_id || '', packet: d.packet };
    return null;
  }
  var list = peers.list();
  if (process.env.WALLET_DEBUG) {
    console.error('[packet-cross] resolve locator=' + locator + ' peers=' + list.length);
  }
  if (!list.length) return null;
  var tasks = list.map(function (p) {
    return probe(p.base_url, locator).then(function (d) {
      return d ? { base_url: p.base_url, server_id: p.server_id, packet: d.packet } : null;
    });
  });
  var results = await Promise.all(tasks);
  for (var i = 0; i < results.length; i++) { if (results[i]) return results[i]; }
  return null;
}

function mintFor(row, amountCent, packetId, note, senderName) {
  var ref = 'xpacket:' + (row.owner_server || row.owner_base) + ':' + packetId + ':' + row.user_id;
  return xy.mint({
    to: row.user_id,
    amountCent: amountCent,
    pool: 'cash',
    kind: 'transfer',
    ref: ref,
    app: 'wallet',
    memo: '跨班红包 · ' + (note || senderName || '同学')
  });
}

// 对一条 pending 记录再试一次：请求发送方 → 拿到金额 → 本地入账
async function attempt(row) {
  ensure();
  var payload = envelope('claim', {
    ref: row.ref,
    code: row.code,
    claimer: row.user_id,
    phrase: isPid(row.code) ? '' : row.code
  });

  var r;
  try {
    r = await crossPay.postJson(row.owner_base, '/api/wallet/cross/packet/claim', payload);
  } catch (e) {
    bumpAttempt(row.ref, '网络异常：' + (e.message || '未知'));
    return { pending: true, message: '班级之间网络不稳定，红包正在自动重试' };
  }

  var body = r.body || {};
  if (r.status === 200 && body.code === 200 && body.data) {
    var d = body.data;
    var amountCent = Math.round(Number(d.amount_cent) || 0);
    if (!(amountCent > 0)) {
      markFailed(row.ref, '对端返回金额异常');
      throw new Error('对端返回金额异常');
    }
    if (d.server_id) peers.upsert(d.server_id, row.owner_base, '', 'packet');

    db.prepare([
      "UPDATE xy_cross_packet SET packet_id = ?, amount_cent = ?, note = ?, sender_name = ?,",
      "  status = 'assigned', error = NULL, updated_at = ? WHERE ref = ?"
    ].join('\n')).run(d.packet_id || null, amountCent, String(d.note || '').slice(0, 40),
      String(d.sender_name || '').slice(0, 30), nowMs(), row.ref);

    // 入账（幂等）：即使这一步失败，记录已是 assigned，后台会补
    mintFor({ owner_server: d.server_id || row.owner_server, owner_base: row.owner_base, user_id: row.user_id },
      amountCent, d.packet_id, d.note, d.sender_name);
    db.prepare("UPDATE xy_cross_packet SET status = 'paid', updated_at = ? WHERE ref = ?").run(nowMs(), row.ref);

    return {
      amount: amountCent / 100,
      amount_cent: amountCent,
      duplicate: !!d.duplicate,
      note: d.note || '',
      sender_name: d.sender_name || '',
      packet_id: d.packet_id,
      remote: true
    };
  }

  // 4xx = 明确的业务拒绝（领完/过期/自己发/口令错/不是发给你/签名错），重试没意义
  if (r.status >= 400 && r.status < 500) {
    var msg = body.message || '领取失败';
    markFailed(row.ref, msg);
    var err = new Error(msg);
    err.terminal = true;
    throw err;
  }

  bumpAttempt(row.ref, body.message || ('对端返回 ' + r.status));
  return { pending: true, message: '对端暂时没有响应，红包正在自动重试' };
}

function bumpAttempt(ref, error) {
  try {
    db.prepare('UPDATE xy_cross_packet SET attempts = attempts + 1, error = ?, updated_at = ? WHERE ref = ?')
      .run(String(error || '').slice(0, 160), nowMs(), ref);
  } catch (e) { /* 忽略 */ }
}

function markFailed(ref, error) {
  try {
    db.prepare("UPDATE xy_cross_packet SET status = 'failed', error = ?, updated_at = ? WHERE ref = ?")
      .run(String(error || '').slice(0, 160), nowMs(), ref);
  } catch (e) { /* 忽略 */ }
}

// ---- 对外：领取跨班红包 ----
// opts: { userId, code?, phrase?, packetId?, base? } —— 三选一
async function claimRemote(opts) {
  ensure();
  var uid = String(opts.userId || '');
  var locator = '';
  if (opts.packetId) locator = pidLocator(opts.packetId);
  else if (opts.code) locator = normCode(opts.code);
  else if (opts.phrase) locator = String(opts.phrase).trim();
  if (!locator) throw new Error('缺少红包定位信息');
  if (!isPid(locator) && !/^[A-Z0-9]{4,12}$/.test(locator) && locator.length > 12) {
    throw new Error('红包码或口令太长');
  }

  // 本班就有这个红包（口令红包/红包码都能直接领）
  var local = null;
  if (isPid(locator)) {
    local = db.prepare('SELECT * FROM xy_packet WHERE id = ?').get(pidOf(locator)) || null;
  } else {
    local = yuanbao.findByCode(locator) || yuanbao.findByPhrase(locator);
  }
  if (local) {
    if (String(local.sender) === uid) throw new Error('不能领自己发的红包');
    var res = yuanbao.claim(local.id, uid, 'wallet', { phrase: opts.phrase });
    return {
      amount: res.amount, amount_cent: res.amount_cent, duplicate: !!res.duplicate,
      note: res.note || '', sender_name: yuanbao.userName(res.sender), local: true, kind: res.kind
    };
  }

  var owner = await resolveOwner(locator, opts.baseHint);
  if (!owner) throw new Error('红包不存在、已过期，或对方班级当前离线');

  var ref = 'xq:' + uid + ':' + crypto.randomBytes(6).toString('hex');
  var t = nowMs();
  db.prepare([
    'INSERT INTO xy_cross_packet (ref, owner_server, owner_base, code, user_id, status, attempts, created_at, updated_at)',
    "VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)"
  ].join('\n')).run(ref, owner.server_id || '', owner.base_url, locator, uid, t, t);

  var row = db.prepare('SELECT * FROM xy_cross_packet WHERE ref = ?').get(ref);
  var out = await attempt(row);
  if (out && out.pending) return out;
  return out;
}

// ---- 后台补账 ----
async function retryOnce() {
  ensure();
  if (retrying) return 0;
  retrying = true;
  var done = 0;
  try {
    // 1) 还没拿到金额的：重发请求（发送方幂等，重复请求返回同一金额）
    var pendingRows = db.prepare([
      "SELECT * FROM xy_cross_packet WHERE status = 'pending' AND attempts < ? AND updated_at <= ?",
      'ORDER BY id ASC LIMIT 10'
    ].join('\n')).all(MAX_ATTEMPTS, nowMs() - RETRY_GAP);
    for (var i = 0; i < pendingRows.length; i++) {
      try { await attempt(pendingRows[i]); done++; } catch (e) { /* 已记录 */ }
    }

    // 2) 已拿到金额但本地没入账成功的：补 mint（ref 幂等）
    var assigned = db.prepare([
      "SELECT * FROM xy_cross_packet WHERE status = 'assigned' AND updated_at <= ?",
      'ORDER BY id ASC LIMIT 20'
    ].join('\n')).all(nowMs() - 5000);
    for (var j = 0; j < assigned.length; j++) {
      var a = assigned[j];
      try {
        mintFor({ owner_server: a.owner_server, owner_base: a.owner_base, user_id: a.user_id },
          a.amount_cent, a.packet_id, a.note, a.sender_name);
        db.prepare("UPDATE xy_cross_packet SET status = 'paid', updated_at = ? WHERE ref = ?").run(nowMs(), a.ref);
        done++;
      } catch (e) {
        bumpAttempt(a.ref, '入账失败：' + e.message);
      }
    }
  } catch (e) {
    console.error('[packet-cross] 重试失败:', e.message);
  } finally {
    retrying = false;
  }
  return done;
}

function startRetryLoop() {
  if (retryTimer) return;
  retryTimer = setInterval(function () {
    retryOnce().catch(function () { /* 已记录 */ });
  }, RETRY_GAP);
  if (retryTimer.unref) retryTimer.unref();
}

// 我跨班领到的（用于钱包「我领到的」合并展示）
function list(userId, limit) {
  ensure();
  var n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  return db.prepare([
    "SELECT * FROM xy_cross_packet WHERE user_id = ? AND status IN ('paid','assigned')",
    'ORDER BY id DESC LIMIT ?'
  ].join('\n')).all(String(userId), n).map(function (r) {
    return {
      id: r.packet_id,
      ref: r.ref,
      amount: (r.amount_cent || 0) / 100,
      note: r.note || '',
      sender_name: r.sender_name || '',
      scope: 'cross',
      remote: true,
      created_at: r.updated_at
    };
  });
}

// ================= 发送方班级：处理对端请求 =================
// 返回 { code, message, data }，与 cross-pay.receive 保持同一种形状

var SIG_WINDOW = 5 * 60 * 1000;

function checkEnvelope(p) {
  var ts = parseInt(p && p.ts, 10) || 0;
  if (!ts || Math.abs(nowMs() - ts) > SIG_WINDOW) return { code: 400, message: '请求已过期（检查两个班级的时钟）' };
  if (!crossPay.rawVerify(canonical(p), p.sig)) return { code: 403, message: '签名校验失败' };
  return null;
}

function findLocalPacket(locator) {
  if (isPid(locator)) {
    return db.prepare('SELECT * FROM xy_packet WHERE id = ?').get(pidOf(locator)) || null;
  }
  return yuanbao.findByCode(locator) || yuanbao.findByPhrase(locator);
}

// 探测：这个红包是不是我的
function receiveProbe(payload) {
  ensure();
  var p = payload || {};
  var bad = checkEnvelope(p);
  if (bad) return bad;
  var packet = findLocalPacket(p.code);
  if (!packet) {
    // 口令查找失败时不能只说「不存在」——很可能是输错口令
    return { code: 404, message: isPid(p.code) ? '红包不存在' : '红包不存在、已领完，或口令不对' };
  }
  return {
    code: 200,
    message: 'ok',
    data: {
      server_id: peers.serverId(),
      packet: yuanbao.preview(packet, p.claimer || '')
    }
  };
}

// 领取：分配 + 解冻回收 + 记录（重复请求返回同一金额）
function receiveClaim(payload) {
  ensure();
  var p = payload || {};
  var bad = checkEnvelope(p);
  if (bad) return bad;
  var claimer = String(p.claimer || '').trim();
  if (!/^\d{4,12}$/.test(claimer)) return { code: 400, message: '领取人学号不合法' };
  if (p.from_server && p.from_base) peers.upsert(p.from_server, p.from_base, '', 'packet-in');

  var packet = findLocalPacket(p.code);
  if (!packet) return { code: 404, message: '红包不存在或已过期' };

  try {
    var phraseIn = String(p.phrase || '').trim() || (isPid(p.code) ? '' : String(p.code || '').trim());
    var r = yuanbao.claimRemote(packet.id, claimer, p.from_server, '', { phrase: phraseIn });
    return {
      code: 200,
      message: r.duplicate ? '已领取过（重复请求）' : '领取成功',
      data: {
        server_id: peers.serverId(),
        packet_id: r.packet_id,
        amount_cent: r.amount_cent,
        amount: r.amount,
        note: r.note || '',
        sender: r.sender,
        sender_name: r.sender_name || '',
        duplicate: !!r.duplicate,
        kind: r.kind || 'normal'
      }
    };
  } catch (e) {
    return { code: 400, message: e.message || '领取失败' };
  }
}

// 收款号解析（跨班）：返回完整收款码字符串
function receivePayCode(payload) {
  var p = payload || {};
  var bad = checkEnvelope(p);
  if (bad) return bad;
  var short = String(p.code || '').trim().toLowerCase();
  if (!/^[a-f0-9]{6,40}$/.test(short)) return { code: 400, message: '收款号格式不对' };
  var dbRow = db.prepare([
    'SELECT * FROM xy_pay_code WHERE token LIKE ? AND expires_at > ?',
    'ORDER BY created_at DESC LIMIT 1'
  ].join('\n')).get(short + '%', nowMs());
  if (!dbRow) return { code: 404, message: '本班没有这个收款号' };
  var u = db.prepare('SELECT net_name, real_name FROM users WHERE user_id = ?').get(dbRow.user_id);
  var view = payCode.issue(dbRow.user_id, dbRow.base_url);
  return {
    code: 200,
    message: 'ok',
    data: {
      server_id: peers.serverId(),
      user_id: dbRow.user_id,
      name: (u && (u.net_name || u.real_name)) || dbRow.user_id,
      short: dbRow.token.slice(0, 8),
      base_url: dbRow.base_url,
      code: view.code
    }
  };
}

// whois：这些学号里哪些是**本班真用户**（镜像用户不算，钱不能进不会登录的账号）
function receiveWhois(payload) {
  var p = payload || {};
  var bad = checkEnvelope(p);
  if (bad) return bad;
  var ids = String(p.code || '').split(',').map(function (x) { return x.trim(); })
    .filter(function (x) { return /^\d{4,12}$/.test(x); }).slice(0, 50);
  var found = [];
  for (var i = 0; i < ids.length; i++) {
    var u = db.prepare([
      'SELECT user_id, net_name, real_name FROM users',
      "WHERE user_id = ? AND status = 'active' AND password_hash IS NOT NULL AND password_hash <> ''"
    ].join('\n')).get(ids[i]);
    if (u) {
      found.push({ user_id: u.user_id, name: u.net_name || u.real_name || u.user_id });
    }
  }
  return { code: 200, message: 'ok', data: { server_id: peers.serverId(), found: found } };
}

// ================= 领取方：按人选人转账时，找到对方在哪个班 =================

function cacheHome(userId, serverId, baseUrl, name) {
  ensure();
  try {
    db.prepare([
      'INSERT INTO xy_user_home (user_id, server_id, base_url, name, last_seen)',
      'VALUES (?, ?, ?, ?, ?)',
      'ON CONFLICT(user_id) DO UPDATE SET server_id = excluded.server_id,',
      '  base_url = excluded.base_url, name = COALESCE(NULLIF(excluded.name, \'\'), xy_user_home.name),',
      '  last_seen = excluded.last_seen'
    ].join('\n')).run(String(userId), String(serverId || ''), String(baseUrl), String(name || '').slice(0, 32), nowMs());
  } catch (e) { /* 缓存失败不影响主流程 */ }
}

function cachedHome(userId) {
  ensure();
  var r = db.prepare('SELECT * FROM xy_user_home WHERE user_id = ?').get(String(userId));
  if (!r) return null;
  // 缓存 24 小时；对端换地址的情况交给重新 whois
  if (nowMs() - r.last_seen > 24 * 3600 * 1000) return null;
  return { server_id: r.server_id, base_url: r.base_url, name: r.name };
}

// 判断一个用户是不是**本班真用户**（镜像用户 password_hash 为空）
function isLocalUser(userId) {
  var u = db.prepare([
    "SELECT 1 FROM users WHERE user_id = ? AND status = 'active'",
    "AND password_hash IS NOT NULL AND password_hash <> ''"
  ].join('\n')).get(String(userId));
  return !!u;
}

// 问所有登记过的班：这个人是谁 / 在不在
async function whois(userId) {
  ensure();
  var uid = String(userId);
  var cached = cachedHome(uid);
  var list = peers.list();
  var tasks = list.map(function (p) {
    var body = envelope('whois', { code: uid });
    return crossPay.postJson(p.base_url, '/api/wallet/cross/whois', body).then(function (r) {
      if (r.status === 200 && r.body && r.body.code === 200 && r.body.data) {
        var hit = (r.body.data.found || [])[0];
        if (hit && hit.user_id === uid) {
          peers.upsert(r.body.data.server_id, p.base_url, '', 'whois');
          cacheHome(uid, r.body.data.server_id, p.base_url, hit.name);
          return { server_id: r.body.data.server_id, base_url: p.base_url, name: hit.name };
        }
      }
      return null;
    }).catch(function () { return null; });
  });
  var results = await Promise.all(tasks);
  for (var i = 0; i < results.length; i++) { if (results[i]) return results[i]; }
  return cached;   // 都没问到时退回缓存（宁可按旧地址试一次）
}

// 选人转账的跨班通道：不需要收款码，凭「对方是对方班的真用户」即可
// token 字段复用为 'user:<学号>'，接收方以此校验并 mint（见 cross-pay.receive）
async function payByUser(opts) {
  ensure();
  var uid = String(opts.userId || '');
  var to = String(opts.to || '');
  if (isLocalUser(to)) throw new Error('这个同学在本班，直接转账即可');

  var home = await whois(to);
  if (!home) throw new Error('没找到这位同学所在的班级（可能还没和那个班连通）');

  var meRow = db.prepare('SELECT net_name, real_name FROM users WHERE user_id = ?').get(uid);
  return crossPay.pay({
    userId: uid,
    to: to,
    token: 'user:' + to,
    base: home.base_url,
    fromBase: peers.localBaseHint(),
    amountCent: opts.amountCent,
    memo: opts.memo,
    fromName: opts.fromName || (meRow && (meRow.net_name || meRow.real_name)) || uid
  });
}

module.exports = {
  ensure: ensure,
  claimRemote: claimRemote,
  resolveOwner: resolveOwner,
  probe: probe,
  list: list,
  retryOnce: retryOnce,
  startRetryLoop: startRetryLoop,
  receiveProbe: receiveProbe,
  receiveClaim: receiveClaim,
  receivePayCode: receivePayCode,
  receiveWhois: receiveWhois,
  whois: whois,
  payByUser: payByUser,
  isLocalUser: isLocalUser,
  cachedHome: cachedHome,
  cacheHome: cacheHome,
  canonical: canonical,
  sign: sign
};
