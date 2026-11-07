// 群收款（AA）—— 平台级服务
// ============================================================
// 详见 migrations/033 的设计说明：**钱走既有的 xy.transfer**，
// 本服务只维护「谁该付、付了没有」，一行资金流都不自己造。
// 好处是所有风控（支付密码、当日额度、冻结、幂等）自动沿用，不会分叉。
//
// 状态机极简：collect.status = open | closed；member.status = pending | paid。
// 没有「部分付款」——AA 是平摊，不是众筹。
//
// 编码约定：var / function

var db = require('../utils/db');
var xy = require('./xueyuan');

var MAX_MEMBERS = 60;
var MAX_TITLE = 40;
var DEFAULT_EXPIRE_HOURS = 72;
var MAX_EXPIRE_HOURS = 24 * 30;

function now() { return Date.now(); }

function ensureSchema() {
  var row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_collect'").get();
  if (!row) throw new Error('群收款表尚未初始化（缺少 xy_collect），请先执行数据库迁移');
}

function isExpired(row, ts) {
  return !!(row && row.expires_at && row.expires_at < (ts || now()));
}

function summarize(row) {
  if (!row) return null;
  var total = Number(row.total_cent) || 0;
  var paid = Number(row.paid_cent) || 0;
  return {
    id: row.id,
    creator: row.creator,
    title: row.title,
    per_cent: row.per_cent,
    per: xy.fromCent(row.per_cent),
    total_cent: total,
    total: xy.fromCent(total),
    paid_cent: paid,
    paid: xy.fromCent(paid),
    status: row.status,
    expired: row.status === 'open' && isExpired(row),
    progress: total > 0 ? Math.round(paid / total * 100) : 0,
    member_count: Number(row.member_count) || 0,
    paid_count: Number(row.paid_count) || 0,
    expires_at: row.expires_at || 0,
    created_at: row.created_at || 0,
    closed_at: row.closed_at || 0
  };
}

// 一次查出多张单子的成员统计，避免列表页 N+1
function attachCounts(rows) {
  if (!rows.length) return rows;
  var ph = rows.map(function () { return '?'; }).join(',');
  var ids = rows.map(function (r) { return r.id; });
  var stmt = db.prepare(
    'SELECT collect_id, COUNT(*) AS c, SUM(CASE WHEN status = \'paid\' THEN 1 ELSE 0 END) AS p ' +
    'FROM xy_collect_member WHERE collect_id IN (' + ph + ') GROUP BY collect_id'
  );
  var stats = {};
  stmt.all.apply(stmt, ids).forEach(function (s) { stats[s.collect_id] = s; });
  rows.forEach(function (r) {
    var s = stats[r.id];
    r.member_count = s ? Number(s.c) : 0;
    r.paid_count = s ? Number(s.p) : 0;
  });
  return rows;
}

// 成员列表清洗：去空、去重、剔除发起人自己（发起人不用付给自己）
function normalizeMembers(input, creator) {
  var raw = Array.isArray(input) ? input : String(input || '').split(/[\s,，;；]+/);
  var seen = {};
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var uid = String(raw[i] || '').trim();
    if (!uid || uid === creator) continue;
    if (seen[uid]) continue;
    if (!/^[A-Za-z0-9_.@:-]{1,64}$/.test(uid)) throw new Error('学号格式不对：' + uid);
    seen[uid] = 1;
    out.push(uid);
  }
  if (!out.length) throw new Error('请至少选择一位要付款的同学');
  if (out.length > MAX_MEMBERS) throw new Error('一次最多 ' + MAX_MEMBERS + ' 人');
  return out;
}

function create(opts) {
  ensureSchema();
  var o = opts || {};
  var creator = String(o.creator || '');
  var title = String(o.title || '').trim();
  var perCent = typeof o.perCent === 'number' ? Math.round(o.perCent) : xy.yuanToCent(o.perYuan);

  if (!db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(creator)) {
    throw new Error('发起人不存在');
  }
  if (!title) throw new Error('请填写收款事由');
  if (title.length > MAX_TITLE) throw new Error('收款事由不能超过 ' + MAX_TITLE + ' 字');
  if (!isFinite(perCent) || perCent <= 0 || Math.floor(perCent) !== perCent) {
    throw new Error('每人金额必须是正整数分');
  }
  if (perCent > xy.LIMITS.MAX_TRANSFER_CENT) {
    throw new Error('每人金额不能超过 ' + xy.fromCent(xy.LIMITS.MAX_TRANSFER_CENT) + ' 学元');
  }

  // 成员必须是本班真用户（有 password_hash），外班镜像收不到本班的 AA
  var members = normalizeMembers(o.members, creator);
  for (var i = 0; i < members.length; i++) {
    var u = db.prepare('SELECT user_id, net_name, status, password_hash FROM users WHERE user_id = ?').get(members[i]);
    if (!u) throw new Error('学号不存在：' + members[i]);
    if (!u.password_hash) throw new Error('外班同学不能参与本班 AA：' + members[i]);
    if (u.status === 'disabled') throw new Error('账号已停用，不能参与 AA：' + members[i]);
  }

  var requestId = o.requestId ? String(o.requestId).slice(0, 40) : null;
  if (requestId) {
    var existed = db.prepare('SELECT * FROM xy_collect WHERE request_id = ?').get(requestId);
    if (existed) return { duplicate: true, collect: summarize(existed) };
  }

  var hours = Math.min(Math.max(parseInt(o.expiresHours, 10) || DEFAULT_EXPIRE_HOURS, 1), MAX_EXPIRE_HOURS);
  var at = now();
  var total = perCent * members.length;

  var run = db.transaction(function () {
    xy.ensureAccount(creator);
    var info = db.prepare([
      'INSERT INTO xy_collect (creator, title, per_cent, total_cent, status, expires_at, request_id, created_at)',
      "VALUES (?, ?, ?, ?, 'open', ?, ?, ?)"
    ].join(' ')).run(creator, title, perCent, total, at + hours * 3600 * 1000, requestId, at);
    var id = Number(info.lastInsertRowid);
    var ins = db.prepare('INSERT INTO xy_collect_member (collect_id, user_id, status) VALUES (?, ?, \'pending\')');
    members.forEach(function (uid) { ins.run(id, uid); });
    return id;
  });

  return { duplicate: false, collect: detail(run()) };
}

function detail(collectId, viewer) {
  ensureSchema();
  var id = parseInt(collectId, 10);
  if (!(id > 0)) throw new Error('收款单编号非法');
  var row = db.prepare('SELECT * FROM xy_collect WHERE id = ?').get(id);
  if (!row) throw new Error('收款单不存在');

  attachCounts([row]);
  var out = summarize(row);
  out.members = db.prepare([
    'SELECT m.user_id, m.status, m.paid_at, COALESCE(u.net_name, \'\') AS net_name',
    'FROM xy_collect_member m LEFT JOIN users u ON u.user_id = m.user_id',
    'WHERE m.collect_id = ? ORDER BY m.status ASC, m.user_id ASC'
  ].join('\n')).all(id).map(function (m) {
    return {
      user_id: m.user_id,
      net_name: m.net_name || '',
      status: m.status,
      paid_at: m.paid_at || 0
    };
  });

  var me = String(viewer || '');
  out.is_creator = !!me && row.creator === me;
  var mine = out.members.filter(function (m) { return m.user_id === me; })[0];
  out.my_status = mine ? mine.status : (out.is_creator ? 'creator' : '');
  out.can_pay = !!mine && mine.status === 'pending' && out.status === 'open' && !out.expired;
  return out;
}

function list(userId, opts) {
  ensureSchema();
  var uid = String(userId || '');
  var o = opts || {};
  var limit = Math.min(Math.max(parseInt(o.limit, 10) || 20, 1), 50);

  var created = db.prepare('SELECT * FROM xy_collect WHERE creator = ? ORDER BY id DESC LIMIT ?').all(uid, limit);
  attachCounts(created);

  var joinedRows = db.prepare([
    'SELECT c.*, m.status AS my_status',
    'FROM xy_collect_member m JOIN xy_collect c ON c.id = m.collect_id',
    'WHERE m.user_id = ? ORDER BY c.id DESC LIMIT ?'
  ].join('\n')).all(uid, limit);
  attachCounts(joinedRows);

  return {
    created: created.map(summarize),
    joined: joinedRows.map(function (r) {
      var s = summarize(r);
      s.my_status = r.my_status;
      return s;
    })
  };
}

// 付款：本质是一笔同学转账，收方是发起人。
// 幂等靠 ref='collect:<id>:<uid>'，重复点只会得到 duplicate，不会付两次。
function pay(collectId, userId, opts) {
  ensureSchema();
  var id = parseInt(collectId, 10);
  var uid = String(userId || '');
  var o = opts || {};
  if (!(id > 0)) throw new Error('收款单编号非法');

  var row = db.prepare('SELECT * FROM xy_collect WHERE id = ?').get(id);
  if (!row) throw new Error('收款单不存在');
  if (row.status !== 'open') throw new Error('收款单已结束，不能再付');
  if (isExpired(row)) throw new Error('这张收款单已经过期');

  var mine = db.prepare('SELECT * FROM xy_collect_member WHERE collect_id = ? AND user_id = ?').get(id, uid);
  if (!mine) throw new Error('你不在这次 AA 的名单里，不能付款');
  if (mine.status === 'paid') return { duplicate: true, collect: detail(id, uid) };

  var tx;
  try {
    tx = xy.transfer({
      from: uid,
      to: row.creator,
      amountCent: row.per_cent,
      ref: 'collect:' + id + ':' + uid,
      operator: uid,
      memo: 'AA：' + row.title,
      meta: { collect_id: id, collect_title: row.title }
    });
  } catch (e) {
    // 极少数情况下 transfer 已入账但状态没写回来（进程中断），这里兜住
    if (/重复/.test(e.message)) {
      markPaid(id, uid, null);
      return { duplicate: true, collect: detail(id, uid) };
    }
    throw e;
  }

  markPaid(id, uid, tx && tx.tx_id ? tx.tx_id : null);
  return { duplicate: !!(tx && tx.duplicate), collect: detail(id, uid) };
}

function markPaid(collectId, userId, txId) {
  var at = now();
  var run = db.transaction(function () {
    var before = db.prepare('SELECT status FROM xy_collect_member WHERE collect_id = ? AND user_id = ?')
      .get(collectId, userId);
    if (!before || before.status === 'paid') return;
    db.prepare('UPDATE xy_collect_member SET status = \'paid\', tx_id = ?, paid_at = ? WHERE collect_id = ? AND user_id = ?')
      .run(txId, at, collectId, userId);
    var per = db.prepare('SELECT per_cent FROM xy_collect WHERE id = ?').get(collectId).per_cent;
    db.prepare('UPDATE xy_collect SET paid_cent = paid_cent + ? WHERE id = ?').run(per, collectId);
    // 全员付清就自动结束，省得班管再去点一次
    var left = db.prepare('SELECT COUNT(*) AS c FROM xy_collect_member WHERE collect_id = ? AND status != \'paid\'')
      .get(collectId).c;
    if (!left) {
      db.prepare('UPDATE xy_collect SET status = \'closed\', closed_at = ? WHERE id = ?').run(at, collectId);
    }
  });
  run();
}

// 关闭：已付出的钱不退（那是他们该付的），只是不再接受新的付款。
function close(collectId, userId, opts) {
  ensureSchema();
  var id = parseInt(collectId, 10);
  var uid = String(userId || '');
  var o = opts || {};
  if (!(id > 0)) throw new Error('收款单编号非法');
  var row = db.prepare('SELECT * FROM xy_collect WHERE id = ?').get(id);
  if (!row) throw new Error('收款单不存在');
  if (!o.force && row.creator !== uid) throw new Error('只有发起人可以结束这张收款单，别人不能操作');
  if (row.status === 'closed') return { duplicate: true, collect: detail(id, uid) };

  db.prepare('UPDATE xy_collect SET status = \'closed\', closed_at = ? WHERE id = ? AND status = \'open\'')
    .run(now(), id);
  return { duplicate: false, collect: detail(id, uid) };
}

module.exports = {
  MAX_MEMBERS: MAX_MEMBERS,
  MAX_TITLE: MAX_TITLE,
  DEFAULT_EXPIRE_HOURS: DEFAULT_EXPIRE_HOURS,
  create: create,
  detail: detail,
  list: list,
  pay: pay,
  close: close
};
