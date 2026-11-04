// 跨班支付（两阶段）
// ============================================================
// 两个班是两套独立 SQLite 账本，没有分布式事务。做法：
//
//   1. 付款方 hold（冻结）—— 钱还在，只是不能花
//   2. 落 xy_cross_tx(pending)，ref 幂等
//   3. HTTP 通知收款方班级：/api/wallet/cross/pay（HMAC 签名）
//   4. 对端验签 + 验收款码 → mint 给收款人（ref 幂等）→ 回执
//   5. 付款方收到成功：release + burn（解冻并回收）→ paid
//      失败/超时：release（解冻）→ failed；网络异常保留 pending 由后台重试
//
// 为什么不用中继事件总线：relay 是广播，没有「谁收到了」的回执，也没法重试。
// 跨班支付必须知道对方到底入没入账，否则只能靠猜 —— 猜错就是丢钱或双花。
//
// 安全：
//   · 请求必须带 HMAC(RELAY_SECRET) + 时间戳（±5 分钟），防重放与伪造
//   · 收款人只认收款码 token（由收款方班级签发），不接受请求体自报的学号
//   · 单笔上限 200 元等值（跨班额度，本班内是 500 元）

var crypto = require('crypto');
var http = require('http');
var https = require('https');
var db = require('../utils/db');
var config = require('../config');
var xy = require('./xueyuan');
var payCode = require('./pay-code');
var peers = require('./peers');

var MAX_CROSS_CENT = xy.yuanToCent(200);   // 200 元等值
var NET_TIMEOUT = 8000;
var SIG_WINDOW = 5 * 60 * 1000;
var RETRY_GAP = 60 * 1000;
var MAX_ATTEMPTS = 6;

var retryTimer = null;
var retrying = false;

function secret() {
  var s = (config.relay && config.relay.secret) || process.env.RELAY_SECRET || '';
  if (!s) throw new Error('跨班支付未配置共享密钥（RELAY_SECRET）');
  return s;
}

function ensure() {
  db.exec(`
CREATE TABLE IF NOT EXISTS xy_cross_tx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  to_server TEXT NOT NULL,
  to_base TEXT NOT NULL,
  to_token TEXT,
  from_base TEXT,
  amount_cent INTEGER NOT NULL,
  memo TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  peer_tx TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xy_cross_tx_status ON xy_cross_tx(status, created_at);
CREATE INDEX IF NOT EXISTS idx_xy_cross_tx_user ON xy_cross_tx(from_user, id DESC);
`);
  // 老库补列：重试时要带「自己班级的基址」，否则对端学不到我们
  try {
    var cols = db.prepare('PRAGMA table_info(xy_cross_tx)').all();
    var has = false;
    for (var i = 0; i < cols.length; i++) { if (cols[i].name === 'from_base') has = true; }
    if (!has) db.exec('ALTER TABLE xy_cross_tx ADD COLUMN from_base TEXT');
  } catch (e) { /* 忽略 */ }
}

function nowMs() { return Date.now(); }

// 签名内容固定字段顺序，避免 JSON 键序不同导致验签失败
// from_base / from_server 参与签名：对端靠它们回连与登记，不能被人中间改掉
function canonical(p) {
  return [
    String(p.ts || ''),
    String(p.ref || ''),
    String(p.from || ''),
    String(p.token || ''),
    String(p.amount_cent || 0),
    String(p.from_server || ''),
    String(p.from_base || '')
  ].join('|');
}

function rawSign(text) {
  return crypto.createHmac('sha256', secret()).update(String(text)).digest('hex');
}

function rawVerify(text, sig) {
  var a = Buffer.from(String(sig || ''), 'utf8');
  var b = Buffer.from(rawSign(text), 'utf8');
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

function sign(p) {
  return rawSign(canonical(p));
}

function verifySig(p, sig) {
  return rawVerify(canonical(p), sig);
}

function postJson(base, path, body) {
  return new Promise(function (resolve, reject) {
    var url;
    try { url = new URL(base + path); } catch (e) { return reject(new Error('收款地址不合法')); }
    var mod = url.protocol === 'https:' ? https : http;
    var data = Buffer.from(JSON.stringify(body), 'utf8');
    var req = mod.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      timeout: NET_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        var json = null;
        try { json = JSON.parse(text); } catch (e) { /* 非 JSON 视为失败 */ }
        resolve({ status: res.statusCode, body: json, raw: text.slice(0, 300) });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('对端超时')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function findTx(ref) {
  ensure();
  return db.prepare('SELECT * FROM xy_cross_tx WHERE ref = ?').get(String(ref));
}

// ---- 付款方：发起跨班转账 ----
// opts: { userId, to, token, base, amountCent, memo, fromName }
async function pay(opts) {
  ensure();
  var uid = String(opts.userId || '');
  var to = String(opts.to || '');
  var amount = Math.round(Number(opts.amountCent) || 0);
  var base = payCode.normalizeBase(opts.base);
  var token = String(opts.token || '');
  var memo = String(opts.memo || '').slice(0, 40);

  if (!token) throw new Error('缺少收款码');
  if (!(amount > 0)) throw new Error('金额至少 0.01 学元');
  if (amount > MAX_CROSS_CENT) throw new Error('跨班单笔不能超过 ' + xy.fromCent(MAX_CROSS_CENT) + ' 学元');
  if (to === uid) throw new Error('不能给自己转账');

  // 冻结（可用不足会抛）。跨班转账只能动用充值学元：赠送学元仅可投资
  xy.hold(uid, amount, { pool: 'cash' });

  var fromBase = '';
  try { fromBase = payCode.normalizeBase(opts.fromBase || ''); } catch (e) { fromBase = ''; }

  var ref = 'xp:' + uid + ':' + crypto.randomBytes(8).toString('hex');
  var t = nowMs();
  db.prepare([
    'INSERT INTO xy_cross_tx (ref, from_user, to_user, to_server, to_base, to_token, from_base, amount_cent, memo, status, attempts, created_at, updated_at, pool)',
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, 'cash')"
  ].join('\n')).run(ref, uid, to, '', base, token, fromBase, amount, memo, t, t);

  var payload = {
    ts: t,
    ref: ref,
    from: uid,
    from_name: String(opts.fromName || '').slice(0, 30),
    from_server: peers.serverId(),
    from_base: fromBase,
    token: token,
    amount_cent: amount,
    memo: memo
  };
  payload.sig = sign(payload);

  var result = await deliver(ref, base, payload);
  return result;
}

// 发送一次并落状态
async function deliver(ref, base, payload) {
  var tx = findTx(ref);
  if (!tx) throw new Error('跨班记录不存在');
  if (tx.status !== 'pending') return view(tx);

  try {
    var r = await postJson(base, '/api/wallet/cross/pay', payload);
    var body = r.body || {};
    if (r.status === 200 && body.code === 200) {
      // 顺手学会对端是谁：以后凭「短收款号」也能找到它
      if (body.data && body.data.server_id) peers.upsert(body.data.server_id, base, '', 'pay');
      settle(ref, body.data && body.data.tx_id);
      return view(findTx(ref));
    }
    // 明确被拒（余额/收款码问题）→ 立即退款，不重试
    var msg = body.message || ('对端返回 ' + r.status);
    refund(ref, msg);
    return view(findTx(ref));
  } catch (e) {
    // 网络异常：对端可能已经入账，不能退款，保留 pending 重试
    db.prepare('UPDATE xy_cross_tx SET attempts = attempts + 1, error = ?, updated_at = ? WHERE ref = ?')
      .run('网络异常：' + (e.message || '未知'), nowMs(), ref);
    return view(findTx(ref));
  }
}

function settle(ref, peerTx) {
  var tx = findTx(ref);
  if (!tx || tx.status !== 'pending') return;
  db.transaction(function () {
    // 解冻 + 回收（钱离开本班账本，对端会 mint 一笔等额）
    var pool = tx.pool === 'cash' ? 'cash' : 'grant';
    xy.release(tx.from_user, tx.amount_cent, { pool: pool });
    xy.burn({
      from: tx.from_user,
      amountCent: tx.amount_cent,
      pool: pool,
      kind: 'transfer',
      ref: 'cross:' + ref,
      app: 'wallet',
      memo: '跨班转出 · ' + (tx.to_user || '')
    });
    db.prepare("UPDATE xy_cross_tx SET status = 'paid', peer_tx = ?, updated_at = ? WHERE ref = ? AND status = 'pending'")
      .run(String(peerTx || ''), nowMs(), ref);
  })();
}

function refund(ref, reason) {
  var tx = findTx(ref);
  if (!tx || tx.status !== 'pending') return;
  db.transaction(function () {
    var pool = tx.pool === 'cash' ? 'cash' : 'grant';
    xy.release(tx.from_user, tx.amount_cent, { pool: pool });
    db.prepare("UPDATE xy_cross_tx SET status = 'refunded', error = ?, updated_at = ? WHERE ref = ? AND status = 'pending'")
      .run(String(reason || '').slice(0, 120), nowMs(), ref);
  })();
}

function view(tx) {
  if (!tx) return null;
  return {
    id: tx.id,
    ref: tx.ref,
    from: tx.from_user,
    to: tx.to_user,
    amount: tx.amount_cent / 100,
    memo: tx.memo || '',
    status: tx.status,
    peer_tx: tx.peer_tx || '',
    error: tx.error || '',
    created_at: tx.created_at,
    updated_at: tx.updated_at
  };
}

function list(userId, limit) {
  ensure();
  var n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  var rows = db.prepare('SELECT * FROM xy_cross_tx WHERE from_user = ? ORDER BY id DESC LIMIT ?')
    .all(String(userId), n);
  return rows.map(view);
}

// ---- 收款方：处理对端请求 ----
// 返回 { code, message, data }
function receive(payload) {
  ensure();
  var p = payload || {};
  var ts = parseInt(p.ts, 10) || 0;
  if (!ts || Math.abs(nowMs() - ts) > SIG_WINDOW) {
    return { code: 400, message: '请求已过期（检查两个班级的时钟）' };
  }
  if (!verifySig(p, p.sig)) {
    return { code: 403, message: '签名校验失败' };
  }
  // 学到的班级下次可以按短号找到（不覆盖 env 种下的同 id 记录，只更新 base）
  if (p.from_server && p.from_base) peers.upsert(p.from_server, p.from_base, '', 'pay-in');

  var amount = Math.round(Number(p.amount_cent) || 0);
  if (!(amount > 0) || amount > MAX_CROSS_CENT) {
    return { code: 400, message: '金额不合法' };
  }

  var row;
  var to;
  if (String(p.token || '').indexOf('user:') === 0) {
    // 选人转账模式（token 复用为 'user:<学号>'）：收款人必须是**本班真用户**。
    // 镜像用户 password_hash 为空，钱进了也不会有人登录，坚决不收。
    var target = String(p.token).slice(5);
    var u = db.prepare([
      "SELECT user_id FROM users WHERE user_id = ? AND status = 'active'",
      "AND password_hash IS NOT NULL AND password_hash <> ''"
    ].join('\n')).get(target);
    if (!u) return { code: 400, message: '收款人不在这个班，或不是有效用户' };
    to = target;
  } else {
    try {
      row = payCode.verify(p.token);
    } catch (e) {
      return { code: 400, message: e.message };
    }
    // token 自带收款人，绝不信任请求体里的学号
    to = String(row.user_id);
  }

  try {
    var r = xy.mint({
      to: to,
      amountCent: amount,
      pool: 'cash',
      kind: 'transfer',
      ref: 'cross:' + String(p.ref || ''),
      app: 'wallet',
      memo: '跨班转入 · ' + (String(p.from_name || p.from || '').slice(0, 20) || '同学')
    });
    payCode.touch(p.token);
    return {
      code: 200,
      message: r && r.duplicate ? '已入账（重复请求）' : '入账成功',
      data: {
        tx_id: (r && (r.tx_id || r.id)) || '',
        to: to,
        amount: amount / 100,
        duplicate: !!(r && r.duplicate),
        server_id: peers.serverId()
      }
    };
  } catch (e) {
    return { code: 400, message: e.message || '入账失败' };
  }
}

// ---- 后台重试 pending ----
async function retryOnce() {
  if (retrying) return 0;
  retrying = true;
  var done = 0;
  try {
    var since = nowMs() - RETRY_GAP;
    var rows = db.prepare([
      "SELECT * FROM xy_cross_tx WHERE status = 'pending' AND attempts < ? AND updated_at <= ?",
      'ORDER BY id ASC LIMIT 10'
    ].join('\n')).all(MAX_ATTEMPTS, since);

    for (var i = 0; i < rows.length; i++) {
      var tx = rows[i];
      // 重试必须带**原 token**：收款码是签发时落库的，不能拿「收款人当前最新的码」猜
      // （用户可能已经重新生成过，新旧 token 指向不同的码）
      var payload = {
        ts: nowMs(),
        ref: tx.ref,
        from: tx.from_user,
        from_name: '',
        from_server: peers.serverId(),
        from_base: tx.from_base || '',
        token: tx.to_token || '',
        amount_cent: tx.amount_cent,
        memo: tx.memo || ''
      };
      payload.sig = sign(payload);
      await deliver(tx.ref, tx.to_base, payload);
      done++;
    }

    // 超过重试上限仍 pending：退款（宁可退款也不能把钱卡住）
    var stuck = db.prepare([
      "SELECT * FROM xy_cross_tx WHERE status = 'pending' AND attempts >= ? AND updated_at <= ?"
    ].join('\n')).all(MAX_ATTEMPTS, nowMs() - 10 * 60 * 1000);
    for (var j = 0; j < stuck.length; j++) {
      refund(stuck[j].ref, '多次重试未成功，已自动退回');
      done++;
    }
  } catch (e) {
    console.error('[cross-pay] 重试失败:', e.message);
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

module.exports = {
  ensure: ensure,
  pay: pay,
  receive: receive,
  list: list,
  review: view,
  retryOnce: retryOnce,
  startRetryLoop: startRetryLoop,
  sign: sign,
  rawSign: rawSign,
  rawVerify: rawVerify,
  postJson: postJson,
  secret: secret,
  MAX_CROSS_CENT: MAX_CROSS_CENT
};
