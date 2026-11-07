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
var cashbook = require('../ledger/cashbook');

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
  cash_cent INTEGER NOT NULL DEFAULT 0,
  grant_cent INTEGER NOT NULL DEFAULT 0,
  legacy INTEGER NOT NULL DEFAULT 0,
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
  // 老库没有按池拆分列：补账会按「整笔 CASH」入账，既污染兑付敞口又破坏 I2。
  // 迁移 038 负责正式升级，这里再兜一次底（服务可能被单独加载而没跑迁移）。
  addColumn('xy_cross_packet', 'cash_cent', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('xy_cross_packet', 'grant_cent', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('xy_cross_packet', 'legacy', 'INTEGER NOT NULL DEFAULT 0');
  ready = true;
}

function addColumn(table, col, decl) {
  try {
    var cols = db.prepare('PRAGMA table_info(' + table + ')').all();
    for (var i = 0; i < cols.length; i++) { if (cols[i].name === col) return; }
    db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + decl);
  } catch (e) { /* 并发/已存在都忽略 */ }
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

// 找到红包归属：显式给了 base 就直接问；否则问登记表里的所有班。
// 登记表为空时**降级**：从 RELAY_SERVERS 推导候选（relay 主机的 9001 主实例）。
// 背景：_xy_peer 只能靠 WALLET_PEERS 种子或历史往来「学习」，新装机/没配种子的班
// 这张表是空的 —— 跨班转账能通（地址随收款码 token 走）而跨班红包永远「对方班级
// 离线」。probe 只读且带 HMAC 签名，多问一个无主的地址只是多一次 404，无副作用；
// 一旦命中立即 upsert 进登记表，下次就是正路。
function relayCandidates() {
  var out = [];
  var raw = process.env.RELAY_SERVERS || '';
  String(raw).split(',').forEach(function (s) {
    var m = String(s || '').trim().match(/^wss?:\/\/([^\/:]+):(\d+)/);
    if (m && m[1]) {
      var base = 'http://' + m[1] + ':9001';
      if (out.indexOf(base) === -1 && base !== peers.localBaseHint()) out.push(base);
    }
  });
  return out;
}

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

  async function askAll(candidates) {
    var tasks = candidates.map(function (p) {
      return probe(p.base_url || p, locator).then(function (d) {
        var base = p.base_url || p;
        if (!d) return null;
        if (!p.server_id) peers.upsert(d.server_id || base, base, '', 'packet-fallback');
        return { base_url: base, server_id: d.server_id || p.server_id || '', packet: d.packet };
      });
    });
    var results = await Promise.all(tasks);
    for (var i = 0; i < results.length; i++) { if (results[i]) return results[i]; }
    return null;
  }

  if (list.length) {
    var hit = await askAll(list);
    if (hit) return hit;
  }
  // 登记表没找到（可能是空表）→ 用 RELAY_SERVERS 推导的候选再问一圈
  var relays = relayCandidates();
  if (relays.length) {
    var hit2 = await askAll(relays);
    if (hit2) return hit2;
  }
  return null;
}

// 红包预览（本班 / 外班同一个入口）。
// ⚠️ 以前 /wallet/packet/info 里有一段「只给了 code、没给 phrase 就立刻报不存在」的短路：
//    跨班拼手气红包恰恰只有 6 位 code、没有 phrase，于是**永远查不到外班红包**。
//    查找逻辑必须只有这一份，路由不再自己拼判断。
async function lookup(locatorRaw, viewerId, baseHint) {
  ensure();
  var locator = String(locatorRaw || '').trim();
  if (!locator) throw new Error('缺少红包码或口令');

  var local = findLocalPacket(locator);
  if (local) {
    var pv = yuanbao.preview(local, viewerId);
    pv.cross = false;
    return pv;
  }
  var owner = await resolveOwner(locator, baseHint);
  if (!owner) throw new Error('红包码不存在、已过期，或对方班级当前离线');
  var p = owner.packet || {};
  p.cross = true;
  p.server_id = owner.server_id || p.server_id || '';
  p.base_url = owner.base_url;
  return p;
}

// 对端领取成功后，在本班 mint 等额学元。pool 由发送方班级回传（cash/grant），
// ref 带池后缀保证两笔入账各自幂等；老对端不返回拆分会走 legacy（无后缀，保持旧 ref）。
function mintFor(row, amountCent, pool, packetId, note, senderName, refSuffix) {
  var ref = 'xpacket:' + (row.owner_server || row.owner_base) + ':' + packetId + ':' + row.user_id + (refSuffix || '');
  var isCash = pool === 'cash';
  var r = xy.mint({
    to: row.user_id,
    amountCent: amountCent,
    pool: isCash ? 'cash' : 'grant',
    kind: 'transfer',
    ref: ref,
    app: 'wallet',
    memo: '跨班红包 · ' + (note || senderName || '同学')
  });
  // CASH 是可兑付的真金。跨班 mint 等于本班多了一笔兑付义务，
  // 必须同步记进真金台账，否则 I2「账面现金 ≡ 负债」立刻被打破。
  if (isCash) {
    cashbook.record({
      tx_id: r && r.tx_id,
      type: 'cross_in',
      amount_cent: amountCent,
      ref: ref + ':cashbook',
      note: '跨班红包转入（对端已回收等额真金）'
    });
  }
  return r;
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

    // 按发送方回传的资金池拆分入账；老对端没有拆分字段时按充值学元整笔入账，
    // 且沿用旧 ref，避免历史 pending 重试时重复发放。
    var cashCent = 0;
    var grantCent = 0;
    var legacy = typeof d.cash_cent === 'undefined' && typeof d.grant_cent === 'undefined';
    if (legacy) {
      cashCent = amountCent;
    } else {
      cashCent = Math.max(0, Math.round(Number(d.cash_cent) || 0));
      grantCent = Math.max(0, Math.round(Number(d.grant_cent) || 0));
      if (cashCent + grantCent !== amountCent) {   // 对端拆分异常时以金额正确优先
        cashCent = amountCent;
        grantCent = 0;
      }
    }
    // 先把「拿到多少钱、按什么池拆」落库，再入账。
    // 入账（幂等）：即使这一步失败，记录已是 assigned，后台会按同一份拆分补账。
    db.prepare([
      "UPDATE xy_cross_packet SET packet_id = ?, owner_server = ?,",
      "  amount_cent = ?, cash_cent = ?, grant_cent = ?, legacy = ?,",
      "  note = ?, sender_name = ?, status = 'assigned', error = NULL, updated_at = ? WHERE ref = ?"
    ].join('\n')).run(d.packet_id || null, d.server_id || row.owner_server || '',
      amountCent, cashCent, grantCent, legacy ? 1 : 0,
      String(d.note || '').slice(0, 40), String(d.sender_name || '').slice(0, 30), nowMs(), row.ref);

    var rowFor = { owner_server: d.server_id || row.owner_server, owner_base: row.owner_base, user_id: row.user_id };
    if (cashCent > 0) mintFor(rowFor, cashCent, 'cash', d.packet_id, d.note, d.sender_name, legacy ? '' : ':cash');
    if (grantCent > 0) mintFor(rowFor, grantCent, 'grant', d.packet_id, d.note, d.sender_name, legacy ? '' : ':grant');
    db.prepare("UPDATE xy_cross_packet SET status = 'paid', updated_at = ? WHERE ref = ?").run(nowMs(), row.ref);

    return {
      amount: xy.fromCent(amountCent),
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
  if (!isPid(locator) && locator.length > 24) throw new Error('红包码或口令太长');

  // 调用方明确给了对端地址 → 这个红包一定在外班。
  // 否则 pid:42 这种 locator 会先按「本班 id=42 的红包」命中一张完全无关的单子，
  // 领到别人的钱（两个班的 xy_packet.id 各自自增，撞号非常常见）。
  var hint = peers.normalizeBase(opts.baseHint || '');
  var forceRemote = !!hint && hint !== peers.localBaseHint();

  var local = forceRemote ? null : findLocalPacket(locator);
  if (local) {
    if (String(local.sender) === uid) throw new Error('不能领自己发的红包');
    var res = yuanbao.claim(local.id, uid, 'wallet', {
      phrase: opts.phrase || (isPid(locator) ? '' : locator)
    });
    return {
      amount: res.amount, amount_cent: res.amount_cent, duplicate: !!res.duplicate,
      note: res.note || '', sender_name: yuanbao.userName(res.sender), local: true, kind: res.kind
    };
  }

  var owner = await resolveOwner(locator, hint);
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
        // 以前这里把 (packet_id, note, sender_name) 当成 (pool, packetId, note) 传进 mintFor，
        // 补账会按错误资产、错误 ref 再发一遍钱 —— 幂等失效 + 池子串账。
        // 现在一律复用落库时保存的拆分，与 attempt() 用完全相同的参数。
        var legacyRow = !!a.legacy;
        var cash = Math.max(0, Number(a.cash_cent) || 0);
        var grant = Math.max(0, Number(a.grant_cent) || 0);
        if (cash + grant !== (Number(a.amount_cent) || 0)) {
          cash = Number(a.amount_cent) || 0;
          grant = 0;
          legacyRow = true;
        }
        var rowFor = { owner_server: a.owner_server, owner_base: a.owner_base, user_id: a.user_id };
        if (cash > 0) mintFor(rowFor, cash, 'cash', a.packet_id, a.note, a.sender_name, legacyRow ? '' : ':cash');
        if (grant > 0) mintFor(rowFor, grant, 'grant', a.packet_id, a.note, a.sender_name, legacyRow ? '' : ':grant');
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
      amount: xy.fromCent(r.amount_cent || 0),
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
        // 必须把按池拆分回传：领取方据此把真金记进 CASH、赠送记进 GRANT，
        // 并同步真金台账。以前漏了这两个字段，对方会把整笔当成 CASH 入账，
        // 既让赠金变成可提现，又让 I2 对不平。
        cash_cent: r.cash_cent || 0,
        grant_cent: r.grant_cent || 0,
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
      // 只排除停用：历史脏值状态（admin_promoted 等）不该让收款人凭空消失，
      // 否则转账会报「没找到这位同学所在的班级」（见 migrations/031）
      "WHERE user_id = ? AND status <> 'disabled' AND password_hash IS NOT NULL AND password_hash <> ''"
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
// 状态只排除「停用」：admin_promoted 之类的历史脏值不是封禁（见 migrations/031）
function isLocalUser(userId) {
  var u = db.prepare([
    "SELECT 1 FROM users WHERE user_id = ? AND status <> 'disabled'",
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
    pool: opts.pool,
    fromName: opts.fromName || (meRow && (meRow.net_name || meRow.real_name)) || uid
  });
}

module.exports = {
  ensure: ensure,
  claimRemote: claimRemote,
  lookup: lookup,
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
