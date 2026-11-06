// 学元红包（平台级服务）
// ============================================================
// 设计：**不引入资金池**。
//   发红包 → 冻结发送者 total_cent（xueyuan.hold）
//   领取   → 解冻该笔金额（release）+ 直接从发送者转账给领取者（transfer）
//   过期   → 解冻剩余（release）
// 这样账本始终是「发送者 → 领取者」，不需要系统托管账户，也不会出现池子对不上账。
//
// 金额分配用「二倍均值法」：每次随机 [1, 剩余/剩余个数×2]，最后一人拿走全部剩余。
//
// 2026-11-04：从 market-apps/stock/backend/packet.js 上移到平台层。
// 原因：钱包成为系统应用后，证券与钱包必须共用同一份实现与同一张表，
// 否则两处状态会分叉（在证券领过的红包在钱包里还能看到可领）。
// 通知不再由本服务发送 —— 调用方（stock / wallet）各自决定推给谁。
//
// 编码约定：var / function

var crypto = require('crypto');
var db = require('../utils/db');
var xueyuan = require('./xueyuan');
var peers = require('./peers');

var MAX_TOTAL_CENT = xueyuan.yuanToCent(500);   // 500 元等值，与单笔转账上限一致
var MAX_COUNT = 20;
var TTL = 24 * 3600 * 1000;
// 红包码字符集：去掉 0/O/1/I/L 这类肉眼易混的字符（要在教室里口头报出来）
var CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
var CODE_LEN = 6;
var ready = false;

function ensure() {
  if (ready) return;
  db.exec([
    'CREATE TABLE IF NOT EXISTS xy_packet (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  sender TEXT NOT NULL,',
    '  total_cent INTEGER NOT NULL,',
    '  count INTEGER NOT NULL,',
    '  note TEXT,',
    '  remaining_cent INTEGER NOT NULL,',
    '  remaining_count INTEGER NOT NULL,',
    "  status TEXT NOT NULL DEFAULT 'open',",
    '  created_at INTEGER NOT NULL,',
    '  expire_at INTEGER NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS xy_packet_claim (',
    '  packet_id INTEGER NOT NULL,',
    '  user_id TEXT NOT NULL,',
    '  amount_cent INTEGER NOT NULL,',
    '  created_at INTEGER NOT NULL,',
    '  PRIMARY KEY (packet_id, user_id)',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_xy_packet_status ON xy_packet(status, expire_at);'
  ].join('\n'));
  // 跨班红包需要：范围、口令、签发班级；领取记录要能标记「来自外班」
  addColumn('xy_packet', 'scope', "TEXT NOT NULL DEFAULT 'local'");
  addColumn('xy_packet', 'code', 'TEXT');
  addColumn('xy_packet', 'server_id', 'TEXT');
  addColumn('xy_packet_claim', 'remote', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('xy_packet_claim', 'remote_server', 'TEXT');
  addColumn('xy_packet_claim', 'remote_name', 'TEXT');
  // 红包玩法：normal 拼手气 / designated 指定（只有选中的同学能领，每人一份）
  // phrase 口令（领取时要输入发红包时写的祝福语，答错不能领）
  addColumn('xy_packet', 'kind', "TEXT NOT NULL DEFAULT 'normal'");
  addColumn('xy_packet', 'passphrase', 'TEXT');
  // 资金池：历史红包是单池时代创建的，标记为 grant；新红包按「充值优先、赠送补足」拆分
  addColumn('xy_packet', 'pool', "TEXT NOT NULL DEFAULT 'grant'");
  db.exec(`
CREATE TABLE IF NOT EXISTS xy_packet_target (
  packet_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  amount_cent INTEGER NOT NULL,
  claimed_at INTEGER,
  PRIMARY KEY (packet_id, user_id)
);
`);
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_xy_packet_code ON xy_packet(code) WHERE code IS NOT NULL");
  } catch (e) { /* 老库可能有重复 code，忽略 */ }
  ready = true;
}

function addColumn(table, col, decl) {
  try {
    var cols = db.prepare('PRAGMA table_info(' + table + ')').all();
    for (var i = 0; i < cols.length; i++) { if (cols[i].name === col) return; }
    db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col + ' ' + decl);
  } catch (e) { /* 并发/已存在都忽略 */ }
}

// 红包冻结的资金池拆分。历史红包 pool 存的是单池名（'cash'/'grant'），
// 新红包存 JSON（{"cash":x,"grant":y}）。两种格式都要能读：
// 单池历史数据的剩余冻结额整体归该池，因为每次领取都是按池精确释放的。
function poolSplit(p) {
  var raw = String(p.pool || '');
  if (raw === 'cash') return { cash: p.remaining_cent, grant: 0 };
  if (raw === 'grant') return { cash: 0, grant: p.remaining_cent };
  try {
    var o = JSON.parse(raw);
    return {
      cash: Math.max(0, Math.round(Number(o.cash) || 0)),
      grant: Math.max(0, Math.round(Number(o.grant) || 0))
    };
  } catch (e) {
    return { cash: 0, grant: p.remaining_cent };
  }
}

// 本次领取从红包冻结里释放多少：现金优先，与创建时的拆分顺序对称。
// rest 是释放后剩余的冻结拆分，回写到 xy_packet.pool。
function takeSplit(p, amount) {
  var ps = poolSplit(p);
  var useCash = Math.min(ps.cash, amount);
  var useGrant = amount - useCash;
  return {
    cash: useCash,
    grant: useGrant,
    rest: { cash: ps.cash - useCash, grant: ps.grant - useGrant }
  };
}

// 生成不重复的 6 位口令（32^6 ≈ 10 亿，两个班撞车概率可忽略；仍做一次查重）
function newCode() {
  for (var attempt = 0; attempt < 20; attempt++) {
    var buf = crypto.randomBytes(CODE_LEN);
    var s = '';
    for (var i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    var hit = db.prepare('SELECT 1 FROM xy_packet WHERE code = ?').get(s);
    if (!hit) return s;
  }
  throw new Error('红包码生成失败，请重试');
}

function userName(uid) {
  try {
    var r = db.prepare('SELECT net_name, real_name FROM users WHERE user_id = ?').get(String(uid));
    return (r && (r.net_name || r.real_name)) || String(uid).slice(-4);
  } catch (e) { return String(uid).slice(-4); }
}

function toCent(v) {
  var n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

// 发红包
// opts: { scope: 'local'|'cross', kind: 'normal'|'designated'|'phrase', passphrase, targets: [userId] }
//  · designated：targets 里每人一份均分金额（count = 人数，忽略手填个数）
//  · phrase：祝福语就是口令，领取时必须原样输入
function create(sender, totalCent, count, note, appName, opts) {
  ensure();
  var o = opts || {};
  var scope = o.scope === 'cross' ? 'cross' : 'local';
  var kind = ['normal', 'designated', 'phrase'].indexOf(o.kind) >= 0 ? o.kind : 'normal';
  var total = Math.round(Number(totalCent) || 0);
  if (total < 1) throw new Error('红包金额至少 0.01 学元');
  if (total > MAX_TOTAL_CENT) throw new Error('单个红包不能超过 ' + xueyuan.fromCent(MAX_TOTAL_CENT) + ' 学元');

  var targets = Array.isArray(o.targets) ? o.targets.map(function (x) { return String(x || '').trim(); })
    .filter(function (x) { return /^\d{4,12}$/.test(x); }) : [];
  var uniq = [];
  for (var ti = 0; ti < targets.length; ti++) {
    if (String(targets[ti]) === String(sender)) continue;   // 不能指定自己
    if (uniq.indexOf(targets[ti]) < 0) uniq.push(targets[ti]);
  }
  targets = uniq;

  var passphrase = '';
  if (kind === 'designated') {
    if (!targets.length) throw new Error('指定红包要至少选一位同学（不能只有你自己）');
    if (targets.length > MAX_COUNT) throw new Error('指定红包最多 ' + MAX_COUNT + ' 位同学');
  }
  if (kind === 'phrase') {
    passphrase = String(note || o.passphrase || '').trim();
    if (passphrase.length < 1) throw new Error('口令红包要写一句祝福语当口令');
    if (passphrase.length > 12) throw new Error('口令最长 12 个字，太长不好输');
  }

  var n;
  if (kind === 'designated') {
    n = targets.length;
  } else {
    n = Math.round(Number(count) || 0);
    if (n < 1 || n > MAX_COUNT) throw new Error('红包个数需在 1–' + MAX_COUNT + ' 之间');
  }
  if (total < n) throw new Error('每个红包至少 0.01 学元，总金额不够分');

  // 指定红包的分配：均分，余数给前面的同学（总额始终精确等于 total）
  var shares = [];
  if (kind === 'designated') {
    var base = Math.floor(total / n);
    var rem = total - base * n;
    for (var si = 0; si < n; si++) shares.push(base + (si < rem ? 1 : 0));
  }

  var now = Date.now();
  var id = 0;
  var code = '';
  var tx = db.transaction(function () {
    // 红包资金：充值学元优先，不足由赠送学元补足（与转账同一套规则）
    var parts = xueyuan.splitPayable(sender, total);
    if (parts.cash > 0) xueyuan.hold(sender, parts.cash, { pool: 'cash' });
    if (parts.grant > 0) xueyuan.hold(sender, parts.grant, { pool: 'grant' });
    if (scope === 'cross') code = newCode();
    var info = db.prepare([
      'INSERT INTO xy_packet (sender, total_cent, count, note, remaining_cent, remaining_count, status, created_at, expire_at, scope, code, server_id, kind, passphrase, pool)',
      'VALUES (?, ?, ?, ?, ?, ?, \'open\', ?, ?, ?, ?, ?, ?, ?, ?)'
    ].join('\n')).run(String(sender), total, n,
      kind === 'phrase' ? passphrase : String(note || '').slice(0, 40),
      total, n, now, now + TTL, scope, code || null, peers.serverId(), kind,
      kind === 'phrase' ? passphrase : null, JSON.stringify(parts));
    id = info.lastInsertRowid;
    if (kind === 'designated') {
      var ins = db.prepare('INSERT INTO xy_packet_target (packet_id, user_id, amount_cent) VALUES (?, ?, ?)');
      for (var i = 0; i < targets.length; i++) ins.run(id, targets[i], shares[i]);
    }
  });
  tx();

  return {
    id: id,
    total: total / 100,
    count: n,
    remaining_cent: total,
    remaining_count: n,
    expire_at: now + TTL,
    note: kind === 'phrase' ? passphrase : (note || ''),
    scope: scope,
    kind: kind,
    code: code,
    passphrase: kind === 'phrase' ? passphrase : '',
    targets: kind === 'designated' ? targets : [],
    server_id: peers.serverId(),
    app: appName || 'wallet'
  };
}

function findByCode(code) {
  ensure();
  var c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  return db.prepare('SELECT * FROM xy_packet WHERE code = ?').get(c) || null;
}

function findBySenderCode(sender, code) {
  ensure();
  var c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  return db.prepare('SELECT * FROM xy_packet WHERE code = ? AND sender = ?').get(c, String(sender)) || null;
}

// 二倍均值随机：最后一个拿剩余全部
function pickAmount(p) {
  if (p.remaining_count === 1) return p.remaining_cent;
  var max = Math.floor(p.remaining_cent / p.remaining_count * 2) - 1;
  var min = 1;
  var cap = p.remaining_cent - (p.remaining_count - 1);
  var amount = Math.min(cap, min + Math.floor(Math.random() * Math.max(1, Math.min(max, cap) - min + 1)));
  return amount < 1 ? 1 : amount;
}

function normPhrase(s) {
  return String(s || '').trim().replace(/\s+/g, '').toLowerCase();
}

// 领红包
// opts: { phrase } —— 口令红包必填；返回 { claimed, duplicate, amount, ... }
function claim(packetId, userId, appName, opts) {
  ensure();
  var o = opts || {};
  var out = null;
  var tx = db.transaction(function () {
    var p = db.prepare('SELECT * FROM xy_packet WHERE id = ?').get(packetId);
    if (!p) throw new Error('红包不存在');
    var kind = p.kind || 'normal';
    var prev = db.prepare('SELECT * FROM xy_packet_claim WHERE packet_id = ? AND user_id = ?')
      .get(packetId, String(userId));
    if (prev) {
      out = {
        claimed: true, duplicate: true, amount: prev.amount_cent / 100, amount_cent: prev.amount_cent,
        sender: p.sender, note: p.note || '', kind: kind
      };
      return;
    }
    if (String(p.sender) === String(userId)) throw new Error('不能领自己发的红包');
    if (Date.now() > p.expire_at) throw new Error('红包已过期');
    // 指定红包先判「是不是发给你」——否则非指定人只会看到「已被领完」，一头雾水
    if (kind === 'designated') {
      var t0 = db.prepare('SELECT * FROM xy_packet_target WHERE packet_id = ? AND user_id = ?')
        .get(packetId, String(userId));
      if (!t0) throw new Error('这个红包不是发给你的');
      if (t0.claimed_at) throw new Error('你已经领过这个红包');
    }
    if (p.status !== 'open' || p.remaining_count <= 0) throw new Error('红包已被领完');

    var amount;
    if (kind === 'designated') {
      var t = db.prepare('SELECT * FROM xy_packet_target WHERE packet_id = ? AND user_id = ?')
        .get(packetId, String(userId));
      amount = t.amount_cent;
    } else {
      if (kind === 'phrase' && normPhrase(o.phrase) !== normPhrase(p.passphrase)) {
        throw new Error('口令不对，再想想');
      }
      amount = pickAmount(p);
    }

    var take = takeSplit(p, amount);
    // 先按池解冻，再按同样的池转出（转账失败会抛，事务回滚解冻）
    if (take.cash > 0) xueyuan.release(p.sender, take.cash, { pool: 'cash' });
    if (take.grant > 0) xueyuan.release(p.sender, take.grant, { pool: 'grant' });
    var entries = [];
    if (take.cash > 0) {
      entries.push({ user_id: p.sender, delta: -take.cash, pool: 'cash' });
      entries.push({ user_id: String(userId), delta: take.cash, pool: 'cash' });
    }
    if (take.grant > 0) {
      entries.push({ user_id: p.sender, delta: -take.grant, pool: 'grant' });
      entries.push({ user_id: String(userId), delta: take.grant, pool: 'grant' });
    }
    xueyuan.post({
      entries: entries,
      kind: 'transfer',
      ref: 'packet:' + p.id + ':' + userId,
      app: appName || 'wallet',
      memo: '红包 · ' + (p.note || '恭喜发财')
    });
    db.prepare('UPDATE xy_packet SET pool = ? WHERE id = ?')
      .run(JSON.stringify(take.rest), p.id);
    db.prepare([
      'UPDATE xy_packet SET remaining_cent = remaining_cent - ?, remaining_count = remaining_count - 1,',
      "  status = CASE WHEN remaining_count - 1 <= 0 THEN 'done' ELSE status END",
      'WHERE id = ?'
    ].join('\n')).run(amount, p.id);
    db.prepare('INSERT INTO xy_packet_claim (packet_id, user_id, amount_cent, created_at) VALUES (?, ?, ?, ?)')
      .run(p.id, String(userId), amount, Date.now());
    if (kind === 'designated') {
      db.prepare('UPDATE xy_packet_target SET claimed_at = ? WHERE packet_id = ? AND user_id = ?')
        .run(Date.now(), p.id, String(userId));
    }

    out = {
      claimed: true,
      duplicate: false,
      amount: amount / 100,
      amount_cent: amount,
      remaining_count: p.remaining_count - 1,
      sender: p.sender,
      note: p.note || '',
      kind: kind
    };
  });
  tx();
  return out;
}

// 重复领取（跨班重试）时，从账本反查当时实际回收的资金拆分。
// 新版按池写两条回收交易（ref ...:cash / ...:grant），xy_tx.amount 就是该池金额；
// 老版是单条无后缀（ref ...:<学号>），资金池记在分录的 pool 上。
// 都查不到时整笔按充值学元返回 —— 与老对端的入账口径保持一致。
function burnSplitOf(packetId, claimerId, totalCent) {
  var total = Math.max(0, Math.round(Number(totalCent) || 0));
  var cash = 0;
  var grant = 0;
  try {
    var rows = db.prepare([
      'SELECT t.amount AS amount, e.pool AS pool',
      'FROM xy_tx t JOIN xy_entry e ON e.tx_id = t.id AND e.delta < 0',
      'WHERE t.ref IN (?, ?, ?)'
    ].join('\n')).all(
      'xpacket:' + packetId + ':' + claimerId + ':cash',
      'xpacket:' + packetId + ':' + claimerId + ':grant',
      'xpacket:' + packetId + ':' + claimerId);
    for (var i = 0; i < rows.length; i++) {
      var n = Math.max(0, Math.round(Number(rows[i].amount) || 0));
      if (String(rows[i].pool) === 'cash') cash += n; else grant += n;
    }
  } catch (e) { /* 查不到就回退 */ }
  if (total <= 0 || cash + grant !== total) return { cash: total, grant: 0 };
  return { cash: cash, grant: grant };
}

// 跨班领取（发送方一侧）
// 领取人不在本班账本里，所以不能 transfer —— 用「解冻 + 回收」让钱离开本班，
// 由领取方班级 mint 一笔等额（ref 幂等）。两边的领取记录都以本表为准，重复请求返回同一金额。
// opts: { phrase }
function claimRemote(packetId, claimerId, callerServer, callerName, opts) {
  ensure();
  var o = opts || {};
  var out = null;
  var tx = db.transaction(function () {
    var p = db.prepare('SELECT * FROM xy_packet WHERE id = ?').get(packetId);
    if (!p) throw new Error('红包不存在');
    if (String(p.scope || 'local') !== 'cross') throw new Error('这个红包不支持跨班领取');
    var kind = p.kind || 'normal';

    var prev = db.prepare('SELECT * FROM xy_packet_claim WHERE packet_id = ? AND user_id = ?')
      .get(packetId, String(claimerId));
    if (prev) {
      var prevSplit = burnSplitOf(p.id, claimerId, prev.amount_cent);
      out = {
        duplicate: true,
        amount_cent: prev.amount_cent,
        amount: prev.amount_cent / 100,
        // 重试也要回传当初的按池拆分，否则领取方会按错误池入账
        cash_cent: prevSplit.cash,
        grant_cent: prevSplit.grant,
        packet_id: p.id,
        note: p.note || '',
        sender: p.sender,
        sender_name: userName(p.sender),
        remaining_count: p.remaining_count,
        kind: kind
      };
      return;
    }
    if (String(p.sender) === String(claimerId)) throw new Error('不能领自己发的红包');
    if (Date.now() > p.expire_at) throw new Error('红包已过期');
    if (kind === 'designated') {
      var t0 = db.prepare('SELECT * FROM xy_packet_target WHERE packet_id = ? AND user_id = ?')
        .get(packetId, String(claimerId));
      if (!t0) throw new Error('这个红包不是发给你的');
      if (t0.claimed_at) throw new Error('你已经领过这个红包');
    }
    if (p.status !== 'open' || p.remaining_count <= 0) throw new Error('红包已被领完');

    var amount;
    if (kind === 'designated') {
      var t = db.prepare('SELECT * FROM xy_packet_target WHERE packet_id = ? AND user_id = ?')
        .get(packetId, String(claimerId));
      amount = t.amount_cent;
    } else {
      if (kind === 'phrase' && normPhrase(o.phrase) !== normPhrase(p.passphrase)) {
        throw new Error('口令不对，再想想');
      }
      amount = pickAmount(p);
    }

    var take = takeSplit(p, amount);
    // 跨班领取：解冻后回收，由领取方班级 mint 等额；按池分两笔，便于对账追溯
    if (take.cash > 0) {
      xueyuan.release(p.sender, take.cash, { pool: 'cash' });
      xueyuan.burn({
        from: p.sender,
        amountCent: take.cash,
        pool: 'cash',
        kind: 'transfer',
        ref: 'xpacket:' + p.id + ':' + claimerId + ':cash',
        app: 'wallet',
        memo: '跨班红包 · ' + (p.note || '恭喜发财')
      });
    }
    if (take.grant > 0) {
      xueyuan.release(p.sender, take.grant, { pool: 'grant' });
      xueyuan.burn({
        from: p.sender,
        amountCent: take.grant,
        pool: 'grant',
        kind: 'transfer',
        ref: 'xpacket:' + p.id + ':' + claimerId + ':grant',
        app: 'wallet',
        memo: '跨班红包 · ' + (p.note || '恭喜发财')
      });
    }
    db.prepare('UPDATE xy_packet SET pool = ? WHERE id = ?')
      .run(JSON.stringify(take.rest), p.id);
    db.prepare([
      'UPDATE xy_packet SET remaining_cent = remaining_cent - ?, remaining_count = remaining_count - 1,',
      "  status = CASE WHEN remaining_count - 1 <= 0 THEN 'done' ELSE status END",
      'WHERE id = ?'
    ].join('\n')).run(amount, p.id);
    db.prepare([
      'INSERT INTO xy_packet_claim (packet_id, user_id, amount_cent, created_at, remote, remote_server, remote_name)',
      'VALUES (?, ?, ?, ?, 1, ?, ?)'
    ].join('\n')).run(p.id, String(claimerId), amount, Date.now(),
      String(callerServer || '').slice(0, 32), String(callerName || '').slice(0, 30));
    if (kind === 'designated') {
      db.prepare('UPDATE xy_packet_target SET claimed_at = ? WHERE packet_id = ? AND user_id = ?')
        .run(Date.now(), p.id, String(claimerId));
    }

    out = {
      duplicate: false,
      amount_cent: amount,
      amount: amount / 100,
      // 资金来源拆分：对端班级据此按池入账，保证赠送学元跨班后仍不可提现
      cash_cent: take.cash,
      grant_cent: take.grant,
      packet_id: p.id,
      note: p.note || '',
      sender: p.sender,
      sender_name: userName(p.sender),
      remaining_count: p.remaining_count - 1,
      kind: kind
    };
  });
  tx();
  return out;
}

// 红包预览（不含金额分配）：领取前让对方看到「谁发的、什么玩法、还剩几个」
function preview(p, viewerId) {
  if (!p) return null;
  var mine = viewerId && String(p.sender) === String(viewerId);
  var kind = p.kind || 'normal';
  var claimed = false;
  if (viewerId) {
    claimed = !!db.prepare('SELECT 1 FROM xy_packet_claim WHERE packet_id = ? AND user_id = ?')
      .get(p.id, String(viewerId));
  }
  var isTarget = false;
  if (kind === 'designated' && viewerId) {
    var t = db.prepare('SELECT claimed_at FROM xy_packet_target WHERE packet_id = ? AND user_id = ?')
      .get(p.id, String(viewerId));
    isTarget = !!t && !t.claimed_at;
  }
  return {
    id: p.id,
    scope: p.scope || 'local',
    kind: kind,
    code: p.code || '',
    passphrase: kind === 'phrase' ? (p.passphrase || '') : '',
    is_target: isTarget,
    server_id: p.server_id || '',
    sender: p.sender,
    sender_name: userName(p.sender),
    total: p.total_cent / 100,
    count: p.count,
    note: p.note || '',
    remaining: p.remaining_cent / 100,
    remaining_count: p.remaining_count,
    expire_at: p.expire_at,
    status: p.status,
    mine: !!mine,
    claimed: claimed
  };
}

// 按口令找**跨班**红包（本班口令红包在列表里就能看到，不用查）
function findByPhrase(phrase) {
  ensure();
  var want = normPhrase(phrase);
  if (!want) return null;
  var rows = db.prepare([
    "SELECT * FROM xy_packet WHERE kind = 'phrase' AND status = 'open' AND remaining_count > 0",
    'AND expire_at > ? ORDER BY id DESC LIMIT 10'
  ].join('\n')).all(Date.now());
  for (var i = 0; i < rows.length; i++) {
    if (normPhrase(rows[i].passphrase) === want) return rows[i];
  }
  return null;
}

// 列表：可领的（本班：拼手气 + 口令 + 发给我的指定红包）+ 我发出的 + 我领过的
function list(userId) {
  ensure();
  var now = Date.now();
  var available = db.prepare([
    'SELECT p.*, (SELECT COUNT(*) FROM xy_packet_claim c WHERE c.packet_id = p.id) AS claimed_count,',
    '  0 AS for_me',
    'FROM xy_packet p',
    "WHERE p.status = 'open' AND p.remaining_count > 0 AND p.expire_at > ? AND p.sender <> ?",
    "  AND COALESCE(p.scope, 'local') = 'local'",
    "  AND (COALESCE(p.kind, 'normal') IN ('normal','phrase')",
    "       OR (COALESCE(p.kind, 'normal') = 'designated' AND EXISTS (",
    "            SELECT 1 FROM xy_packet_target t WHERE t.packet_id = p.id AND t.user_id = ? AND t.claimed_at IS NULL)))",
    '  AND NOT EXISTS (SELECT 1 FROM xy_packet_claim c2 WHERE c2.packet_id = p.id AND c2.user_id = ?)',
    'ORDER BY p.id DESC LIMIT 20'
  ].join('\n')).all(now, String(userId), String(userId), String(userId));

  var mine = db.prepare([
    'SELECT p.*,',
    '  (SELECT COUNT(*) FROM xy_packet_claim c WHERE c.packet_id = p.id) AS claimed_count,',
    '  (SELECT COALESCE(SUM(amount_cent), 0) FROM xy_packet_claim c WHERE c.packet_id = p.id) AS claimed_cent',
    'FROM xy_packet p WHERE p.sender = ? ORDER BY p.id DESC LIMIT 10'
  ].join('\n')).all(String(userId));

  var claimedByMe = db.prepare([
    'SELECT c.*, p.note, p.sender, p.scope, p.kind FROM xy_packet_claim c JOIN xy_packet p ON p.id = c.packet_id',
    'WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 10'
  ].join('\n')).all(String(userId));

  function view(p) {
    return {
      id: p.id,
      sender: p.sender,
      sender_name: userName(p.sender),
      total: p.total_cent / 100,
      count: p.count,
      note: p.note || '',
      remaining: p.remaining_cent / 100,
      remaining_count: p.remaining_count,
      claimed_count: p.claimed_count || 0,
      status: p.status,
      expire_at: p.expire_at,
      scope: p.scope || 'local',
      kind: p.kind || 'normal',
      code: p.code || '',
      passphrase: (p.kind === 'phrase') ? (p.passphrase || '') : '',
      server_id: p.server_id || '',
      for_me: !!p.for_me,
      mine: String(p.sender) === String(userId)
    };
  }

  return {
    available: available.map(view),
    mine: mine.map(view),
    claimed: claimedByMe.map(function (c) {
      return {
        id: c.packet_id,
        amount: c.amount_cent / 100,
        note: c.note || '',
        sender_name: c.remote_name || userName(c.sender),
        scope: c.scope || 'local',
        kind: c.kind || 'normal',
        remote: !!c.remote,
        created_at: c.created_at
      };
    })
  };
}

// 领取记录：谁领了、各领多少。
// 只有发送者和已经领过的人能查看 —— 红包 id 是自增的，不设限会被逐个枚举。
function claims(packetId, viewerId) {
  ensure();
  var p = db.prepare('SELECT * FROM xy_packet WHERE id = ?').get(Number(packetId));
  if (!p) throw new Error('红包不存在');

  var uid = String(viewerId || '');
  var isSender = String(p.sender) === uid;
  var isClaimant = !!db.prepare(
    'SELECT 1 FROM xy_packet_claim WHERE packet_id = ? AND user_id = ?'
  ).get(p.id, uid);
  if (!isSender && !isClaimant) throw new Error('领过这个红包才能查看领取记录');

  var rows = db.prepare([
    'SELECT user_id, amount_cent, created_at, remote, remote_name',
    'FROM xy_packet_claim WHERE packet_id = ? ORDER BY created_at ASC, user_id ASC'
  ].join('\n')).all(p.id);

  return {
    id: p.id,
    sender: p.sender,
    sender_name: userName(p.sender),
    note: p.note || '',
    total: p.total_cent / 100,
    count: p.count,
    remaining: p.remaining_cent / 100,
    remaining_count: p.remaining_count,
    claimed_count: rows.length,
    status: p.status,
    expire_at: p.expire_at,
    scope: p.scope || 'local',
    kind: p.kind || 'normal',
    claims: rows.map(function (c) {
      return {
        user_id: c.user_id,
        // 跨班领取记录用对端班级里的昵称
        name: (c.remote && c.remote_name) ? c.remote_name : userName(c.user_id),
        amount: c.amount_cent / 100,
        created_at: c.created_at,
        remote: !!c.remote
      };
    })
  };
}

// 过期退款：把还没领完的冻结点解冻（无定时任务，懒清理）
function sweepExpired() {
  ensure();
  var now = Date.now();
  var rows = db.prepare("SELECT * FROM xy_packet WHERE status = 'open' AND expire_at <= ? AND remaining_cent > 0")
    .all(now);
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    var p = rows[i];
    try {
      var ps = poolSplit(p);
      if (ps.cash > 0) xueyuan.release(p.sender, ps.cash, { pool: 'cash' });
      if (ps.grant > 0) xueyuan.release(p.sender, ps.grant, { pool: 'grant' });
      db.prepare("UPDATE xy_packet SET status = 'expired', remaining_count = 0 WHERE id = ?").run(p.id);
      n++;
    } catch (e) { /* 下一轮再试 */ }
  }
  return n;
}

module.exports = {
  ensure: ensure,
  toCent: toCent,
  create: create,
  claim: claim,
  claimRemote: claimRemote,
  findByCode: findByCode,
  findBySenderCode: findBySenderCode,
  findByPhrase: findByPhrase,
  normPhrase: normPhrase,
  preview: preview,
  newCode: newCode,
  list: list,
  claims: claims,
  sweepExpired: sweepExpired,
  userName: userName,
  MAX_TOTAL_CENT: MAX_TOTAL_CENT,
  MAX_COUNT: MAX_COUNT,
  CODE_LEN: CODE_LEN,
  TTL: TTL
};
