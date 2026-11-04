// 学元（XueYuan）—— 平台统一虚拟货币服务
// ============================================================
// 学元是 ClassIntra 生态里的**唯一**记账货币，供平台功能与第三方应用结算。
// 它与 Cluss 的积分体系**完全独立**：不共享表、不共享接口、不互相兑换。
// 也**不与现实货币挂钩**：没有充值、没有提现、没有汇率 —— 它只在校内闭环流通。
//
// ---- 三条硬规则（改代码前先看这三条）----
// 1. **复式记账，借贷必平**。每笔业务写 xy_tx + ≥2 条 xy_entry，SUM(delta)=0。
//    任何「只加不减」的实现都是发币，必须走 mint()（对手方是 @system:mint）。
// 2. **金额一律整数分**。对外接口收「学元」小数，进来立刻转分；
//    内部绝不用浮点参与运算。
// 3. **幂等靠 ref**。发钱、发津贴、成交结算都必须带稳定 ref，
//    重试/并发不会重复入账（ref 上有唯一索引）。
//
// ---- 为什么余额字段和分录可能对不上 ----
// 正常情况下 balance == SUM(entry.delta)。如果对不上，说明有人绕过本服务
// 直接 UPDATE 了表。audit() 就是为抓这种情况存在的，不要把它删掉。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var db = require('../utils/db');
var config = require('../config');

// ---------- 常量 ----------
var CENT_PER_YUAN = 100;

// 新账户赠金：1000 学元（给新生一笔启动资金去体验生态）
var WELCOME_CENT = 100000;
// 每日助学津贴：10 学元；连续第 7 天起 20 学元
var DAILY_CENT = 1000;
var DAILY_BONUS_CENT = 2000;
var DAILY_BONUS_FROM_DAY = 7;
// 单笔转账上限：500 学元（防手滑把全副身家一次转错人）
var MAX_TRANSFER_CENT = 50000;
// 单笔业务上限：10 万学元
var MAX_TX_CENT = 10000000;
// 单账户余额上限：100 万学元（溢出保护）
var MAX_BALANCE_CENT = 100000000;

var SYSTEM_MINT = '@system:mint';
var SYSTEM_FEE = '@system:fee';

// 允许的 kind 枚举。不在这里的 kind 一律拒绝 —— 是为了让流水可读、
// 可聚合，也防止第三方应用随手发明一个 kind 把统计口径搞乱。
var KINDS = {
  welcome: '开户赠金',
  daily: '助学津贴',
  admin_grant: '教师发放',
  admin_deduct: '教师扣减',
  transfer: '同学转账',
  trade: '交易结算',
  fee: '交易费用',
  reward: '任务奖励',
  refund: '退款',
  adjust: '账目调整'
};

// 普通用户是 6 位学号；系统账户形如 @system:mint / @app:stock:escrow（含冒号）
var USER_ID_RE = /^[A-Za-z0-9_.@:-]{1,64}$/;

// ---------- 工具 ----------

function now() { return Date.now(); }

// 学元 → 分。接受数字或字符串；非法返回 null。
function toCent(yuan) {
  if (yuan === null || yuan === undefined || yuan === '') return null;
  var n = typeof yuan === 'number' ? yuan : Number(String(yuan).trim());
  if (!isFinite(n)) return null;
  // 先四舍五入到分，避免 0.1*3 这类浮点尾巴
  var cent = Math.round(n * CENT_PER_YUAN);
  if (!isFinite(cent)) return null;
  return cent;
}

function fromCent(cent) {
  return Math.round(Number(cent) || 0) / CENT_PER_YUAN;
}

function isValidUserId(userId) {
  var id = String(userId || '');
  if (!USER_ID_RE.test(id)) return false;
  // 系统账户不能被外部冒用为普通账户
  return true;
}

function isSystem(userId) {
  return String(userId || '').charAt(0) === '@';
}

// 中国时区的 YYYY-MM-DD（服务器可能跑在 UTC，津贴按学校所在时区切日）
function todayKey(ts) {
  var d = new Date((ts || now()) + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' +
    ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' +
    ('0' + d.getUTCDate()).slice(-2);
}

function isValidKind(kind) {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KINDS, kind);
}

function ensureSchema() {
  // 迁移由 server 统一执行；这里只做「表是否就绪」的兜底，
  // 让应用后端在迁移尚未跑到的极端情况下给出清晰错误而不是 undefined。
  var row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_account'").get();
  if (!row) throw new Error('学元账本尚未初始化（缺少 xy_account 表），请先执行数据库迁移');
}

// ---------- 账户 ----------

function createIfMissing(userId, txTime) {
  var ts = txTime || now();
  db.prepare(
    "INSERT OR IGNORE INTO xy_account (user_id, balance, frozen, status, opened_at, updated_at) VALUES (?, 0, 0, 'active', ?, ?)"
  ).run(userId, ts, ts);
}

function getAccount(userId) {
  ensureSchema();
  var id = String(userId || '');
  if (!isValidUserId(id)) throw new Error('用户标识非法');
  var row = db.prepare('SELECT user_id, balance, frozen, status, opened_at, updated_at FROM xy_account WHERE user_id = ?').get(id);
  if (!row) {
    return {
      user_id: id,
      exists: false,
      balance: 0,
      frozen: 0,
      available: 0,
      status: 'none'
    };
  }
  return {
    user_id: row.user_id,
    exists: true,
    balance: row.balance,
    frozen: row.frozen,
    available: row.balance - row.frozen,
    status: row.status,
    opened_at: row.opened_at,
    updated_at: row.updated_at
  };
}

// 对外用「学元」计价，返回结构化金额（分 + 元），前端不用自己算
function viewAccount(userId) {
  var a = getAccount(userId);
  return {
    user_id: a.user_id,
    exists: a.exists,
    balance_cent: a.balance,
    frozen_cent: a.frozen,
    available_cent: a.available,
    balance: fromCent(a.balance),
    frozen: fromCent(a.frozen),
    available: fromCent(a.available),
    status: a.status,
    opened_at: a.opened_at
  };
}

// 开户 + 一次性赠金。
// 幂等靠 ref='welcome:<uid>'：无论调用多少次、并发多少次，只发一次。
function ensureAccount(userId) {
  ensureSchema();
  var id = String(userId || '');
  if (!isValidUserId(id)) throw new Error('用户标识非法');
  if (isSystem(id)) throw new Error('系统账户不可开户');

  var existed = !!db.prepare('SELECT 1 FROM xy_account WHERE user_id = ?').get(id);
  createIfMissing(id);

  var granted = false;
  if (WELCOME_CENT > 0) {
    var r = mint({
      to: id,
      amountCent: WELCOME_CENT,
      kind: 'welcome',
      ref: 'welcome:' + id,
      memo: '学元账户开户赠金'
    });
    granted = !r.duplicate;
  }

  return { created: !existed, welcome_granted: granted, account: viewAccount(id) };
}

// ---------- 记账内核 ----------

// post：唯一的写账入口。
// opts:
//   entries  [{ user_id, delta }]（分，必须有正有负且和为 0）
//   kind     业务类型（KINDS 白名单）
//   ref      幂等键（可选，建议必填）
//   app      来源应用名（第三方应用传自己的 name）
//   operator 操作人（管理员发放时是管理员 user_id）
//   memo     备注
//   meta     附加信息（JSON 可序列化）
//   at       业务时间（缺省 now）
//
// 返回 { tx_id, duplicate, entries }
function post(opts) {
  ensureSchema();
  var o = opts || {};
  var entries = Array.isArray(o.entries) ? o.entries : [];
  var kind = String(o.kind || '');

  if (!isValidKind(kind)) throw new Error('未知的业务类型: ' + kind);
  if (entries.length < 2) throw new Error('一笔交易至少需要两条分录（复式记账）');

  // ---- 校验与归一 ----
  var sum = 0;
  var normalized = [];
  var touched = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i] || {};
    var uid = String(e.user_id || '');
    var delta = e.delta;
    if (!isValidUserId(uid)) throw new Error('分录中的用户标识非法: ' + uid);
    if (typeof delta !== 'number' || !isFinite(delta) || Math.floor(delta) !== delta) {
      throw new Error('分录金额必须是整数分');
    }
    if (delta === 0) throw new Error('分录金额不能为 0');
    sum += delta;
    normalized.push({ user_id: uid, delta: delta });
  }
  if (sum !== 0) throw new Error('分录不平衡（SUM=' + sum + ' 分），拒绝记账');

  // 同一用户在同一笔交易里出现两次 → 大概率是调用方算错了，直接拒绝
  for (var j = 0; j < normalized.length; j++) {
    if (touched[normalized[j].user_id]) throw new Error('同一交易中重复出现账户: ' + normalized[j].user_id);
    touched[normalized[j].user_id] = true;
  }

  var amount = 0;
  for (var k = 0; k < normalized.length; k++) {
    if (normalized[k].delta > 0) amount += normalized[k].delta;
  }
  if (amount > MAX_TX_CENT) throw new Error('单笔金额超过上限');

  var ref = o.ref ? String(o.ref) : null;
  var at = o.at || now();

  // ---- 幂等短路：已有同 ref 的交易，直接返回 ----
  if (ref) {
    var exist = db.prepare('SELECT id FROM xy_tx WHERE ref = ?').get(ref);
    if (exist) {
      return { tx_id: exist.id, duplicate: true, entries: [] };
    }
  }

  var txFn = db.transaction(function() {
    var info = db.prepare(
      'INSERT INTO xy_tx (ref, kind, app_name, operator, memo, amount, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      ref, kind,
      o.app ? String(o.app) : null,
      o.operator ? String(o.operator) : null,
      o.memo ? String(o.memo) : '',
      amount,
      o.meta ? JSON.stringify(o.meta) : null,
      at
    );
    var txId = Number(info.lastInsertRowid);

    for (var m = 0; m < normalized.length; m++) {
      var item = normalized[m];
      var acc = db.prepare('SELECT balance, frozen, status FROM xy_account WHERE user_id = ?').get(item.user_id);
      if (!acc) {
        // 系统账户之外的账户必须提前开户（防止拼错 id 凭空造账户）
        if (isSystem(item.user_id)) {
          createIfMissing(item.user_id, at);
          acc = db.prepare('SELECT balance, frozen, status FROM xy_account WHERE user_id = ?').get(item.user_id);
        } else {
          throw new Error('账户不存在: ' + item.user_id);
        }
      }
      if (acc.status === 'frozen') throw new Error('账户已被冻结: ' + item.user_id);

      var after = acc.balance + item.delta;

      if (!isSystem(item.user_id)) {
        if (after < 0) throw new Error('学元余额不足（账户 ' + item.user_id + '）');
        if (after > MAX_BALANCE_CENT) throw new Error('账户余额超过上限');
        if (acc.balance - acc.frozen + item.delta < 0 && item.delta < 0) {
          throw new Error('可用学元不足（有 ' + fromCent(acc.frozen) + ' 学元被冻结）');
        }
      }

      db.prepare('UPDATE xy_account SET balance = ?, updated_at = ? WHERE user_id = ?')
        .run(after, at, item.user_id);
      db.prepare('INSERT INTO xy_entry (tx_id, user_id, delta, balance_after, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(txId, item.user_id, item.delta, after, at);
    }

    return txId;
  });

  var txId;
  try {
    txId = txFn();
  } catch (err) {
    // 并发下两个请求可能同时通过幂等短路，落到唯一索引冲突上：
    // 这时回头再查一次 ref，命中就按重复处理（这才是正确的幂等语义）
    if (ref && /UNIQUE constraint failed/i.test(String(err && err.message))) {
      var again = db.prepare('SELECT id FROM xy_tx WHERE ref = ?').get(ref);
      if (again) return { tx_id: again.id, duplicate: true, entries: [] };
    }
    throw err;
  }

  return { tx_id: txId, duplicate: false, entries: normalized, amount: amount };
}

// ---------- 上层业务 ----------

// 铸币：对手方固定为 @system:mint。
// 这是**唯一**能让学元总量变多的入口，调用点必须是有明确经济含义的
// （赠金、津贴、教师发放），不要拿它当「改余额」的快捷方式。
function mint(opts) {
  var o = opts || {};
  var to = String(o.to || '');
  var amountCent = o.amountCent;
  if (!isValidUserId(to) || isSystem(to)) throw new Error('铸币目标账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('铸币金额必须是正整数分');
  }
  createIfMissing(to, o.at);
  return post({
    entries: [
      { user_id: SYSTEM_MINT, delta: -amountCent },
      { user_id: to, delta: amountCent }
    ],
    kind: o.kind || 'admin_grant',
    ref: o.ref,
    app: o.app,
    operator: o.operator,
    memo: o.memo,
    meta: o.meta,
    at: o.at
  });
}

// 回收：从账户销毁学元（对手方仍是铸币账户，方向相反）
function burn(opts) {
  var o = opts || {};
  var from = String(o.from || '');
  var amountCent = o.amountCent;
  if (!isValidUserId(from) || isSystem(from)) throw new Error('回收账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('回收金额必须是正整数分');
  }
  return post({
    entries: [
      { user_id: from, delta: -amountCent },
      { user_id: SYSTEM_MINT, delta: amountCent }
    ],
    kind: o.kind || 'admin_deduct',
    ref: o.ref,
    app: o.app,
    operator: o.operator,
    memo: o.memo,
    meta: o.meta,
    at: o.at
  });
}

// 同学之间转账。收方必须已开户（否则钱会掉进一个还不存在的账户里）。
function transfer(opts) {
  var o = opts || {};
  var from = String(o.from || '');
  var to = String(o.to || '');
  var amountCent = o.amountCent;

  if (from === to) throw new Error('不能给自己转账');
  if (!isValidUserId(from) || isSystem(from)) throw new Error('转出账户非法');
  if (!isValidUserId(to) || isSystem(to)) throw new Error('转入账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('转账金额必须是正整数分');
  }
  if (amountCent > MAX_TRANSFER_CENT) {
    throw new Error('单笔转账不能超过 ' + fromCent(MAX_TRANSFER_CENT) + ' 学元');
  }
  if (!db.prepare('SELECT 1 FROM xy_account WHERE user_id = ?').get(to)) {
    throw new Error('对方尚未开通学元账户');
  }

  return post({
    entries: [
      { user_id: from, delta: -amountCent },
      { user_id: to, delta: amountCent }
    ],
    kind: 'transfer',
    ref: o.ref,
    app: o.app,
    operator: o.operator || from,
    memo: o.memo,
    meta: o.meta
  });
}

// 把「用户付钱给应用」表达为一笔两腿交易：
//   用户 → 应用托管账户（@app:<name>:escrow）
// 托管账户的余额是「应用收到的学元」，由应用自己再决定怎么用（结算/上缴）。
function appEscrow(appName) {
  var name = String(appName || '');
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(name)) throw new Error('应用名非法');
  return '@app:' + name + ':escrow';
}

function ensureSystemAccount(userId, at) {
  if (!isSystem(userId)) throw new Error('不是系统账户');
  createIfMissing(userId, at);
}

// ---------- 冻结（挂单/担保） ----------
// 冻结只动 frozen，不动 balance —— 所以它不产生分录，
// 也不会破坏「SUM(balance)=0」这条对账不变量。

function hold(userId, amountCent) {
  ensureSchema();
  var id = String(userId || '');
  if (!isValidUserId(id) || isSystem(id)) throw new Error('账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('冻结金额必须是正整数分');
  }
  var info = db.prepare(
    'UPDATE xy_account SET frozen = frozen + ?, updated_at = ? WHERE user_id = ? AND balance - frozen >= ?'
  ).run(amountCent, now(), id, amountCent);
  if (!info.changes) throw new Error('可用学元不足，无法冻结');
  return getAccount(id);
}

function release(userId, amountCent) {
  ensureSchema();
  var id = String(userId || '');
  if (!isValidUserId(id) || isSystem(id)) throw new Error('账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('解冻金额必须是正整数分');
  }
  var info = db.prepare(
    'UPDATE xy_account SET frozen = MAX(0, frozen - ?), updated_at = ? WHERE user_id = ?'
  ).run(amountCent, now(), id);
  if (!info.changes) throw new Error('账户不存在');
  return getAccount(id);
}

// 成交结算：把「冻结的一部分」真正花掉，剩余解冻退回。
//   holdCent   下单时冻结的金额
//   costCent   实际应付（成交额 + 费用）
//   costEntries 可选的费用分录（默认全部进 @system:fee）
// 语义：frozen -= holdCent；balance -= costCent；差额自动回到可用。
function settleHold(opts) {
  var o = opts || {};
  var uid = String(o.user_id || '');
  var holdCent = o.holdCent;
  var costCent = o.costCent;
  var feeCent = o.feeCent || 0;

  if (!isValidUserId(uid) || isSystem(uid)) throw new Error('账户非法');
  if (holdCent <= 0 || costCent < 0 || feeCent < 0) throw new Error('结算金额非法');
  if (costCent > holdCent) throw new Error('应付金额超过冻结额（内部错误）');

  var settle = db.transaction(function() {
    var acc = db.prepare('SELECT balance, frozen FROM xy_account WHERE user_id = ?').get(uid);
    if (!acc) throw new Error('账户不存在');
    if (acc.frozen < holdCent) throw new Error('冻结额不足（可能已被其他委托占用）');

    // 1) 解冻整笔
    db.prepare('UPDATE xy_account SET frozen = frozen - ?, updated_at = ? WHERE user_id = ?')
      .run(holdCent, now(), uid);

    // 2) 真正的资金流：成交额 + 费用
    var tradeCent = costCent - feeCent;
    if (costCent > 0) {
      if (tradeCent > 0) {
        ensureSystemAccount('@system:settle', now());
        post({
          entries: [
            { user_id: uid, delta: -tradeCent },
            { user_id: '@system:settle', delta: tradeCent }
          ],
          kind: 'trade',
          ref: o.ref ? o.ref + ':trade' : null,
          app: o.app,
          memo: o.memo,
          meta: o.meta,
          at: o.at
        });
      }
      if (feeCent > 0) {
        ensureSystemAccount(SYSTEM_FEE, now());
        post({
          entries: [
            { user_id: uid, delta: -feeCent },
            { user_id: SYSTEM_FEE, delta: feeCent }
          ],
          kind: 'fee',
          ref: o.ref ? o.ref + ':fee' : null,
          app: o.app,
          memo: (o.memo || '') + '（费用）',
          meta: o.meta,
          at: o.at
        });
      }
    }
    return getAccount(uid);
  });

  return settle();
}

// 冻结资金入账（卖出成交后收到钱）：直接入 balance，不涉及 frozen
function credit(userId, amountCent, opts) {
  var o = opts || {};
  if (amountCent <= 0) throw new Error('入账金额必须为正');
  ensureSystemAccount('@system:settle', now());
  return post({
    entries: [
      { user_id: '@system:settle', delta: -amountCent },
      { user_id: String(userId), delta: amountCent }
    ],
    kind: o.kind || 'trade',
    ref: o.ref,
    app: o.app,
    memo: o.memo,
    meta: o.meta,
    at: o.at
  });
}

// ---------- 每日津贴 ----------

function claimDaily(userId) {
  var id = String(userId || '');
  if (!isValidUserId(id) || isSystem(id)) throw new Error('账户非法');
  var today = todayKey();
  var ref = 'daily:' + id + ':' + today;

  if (DAILY_CENT <= 0) throw new Error('助学津贴已关闭');

  // 连续天数：查最近一条 daily 交易的日期，是昨天就 +1，否则归 1
  var last = db.prepare(
    'SELECT created_at FROM xy_tx WHERE ref LIKE ? ORDER BY id DESC LIMIT 1'
  ).get('daily:' + id + ':%');

  var streak = 1;
  if (last) {
    var lastKey = todayKey(last.created_at);
    var y = new Date(Date.now() + 8 * 3600 * 1000 - 86400000);
    var yesterday = y.getUTCFullYear() + '-' +
      ('0' + (y.getUTCMonth() + 1)).slice(-2) + '-' +
      ('0' + y.getUTCDate()).slice(-2);
    if (lastKey === yesterday) {
      var prev = db.prepare(
        "SELECT meta_json FROM xy_tx WHERE ref = ?"
      ).get('daily:' + id + ':' + lastKey);
      var prevStreak = 0;
      try { prevStreak = JSON.parse(prev && prev.meta_json || '{}').streak || 0; } catch (e) { prevStreak = 0; }
      streak = (prevStreak || 0) + 1;
    } else if (lastKey === today) {
      streak = 0; // 今天已领，交给下面幂等
    }
  }

  var amount = streak >= DAILY_BONUS_FROM_DAY ? DAILY_BONUS_CENT : DAILY_CENT;
  createIfMissing(id);
  var r = mint({
    to: id,
    amountCent: amount,
    kind: 'daily',
    ref: ref,
    memo: '第 ' + (streak || 1) + ' 天助学津贴',
    meta: { streak: streak || 1, date: today }
  });

  return {
    duplicate: !!r.duplicate,
    amount_cent: r.duplicate ? 0 : amount,
    amount: r.duplicate ? 0 : fromCent(amount),
    streak: streak || 1,
    date: today,
    account: viewAccount(id)
  };
}

// ---------- 查询 ----------

function history(userId, opts) {
  ensureSchema();
  var o = opts || {};
  var limit = Math.min(Math.max(parseInt(o.limit, 10) || 20, 1), 100);
  var beforeId = parseInt(o.beforeId, 10) || 0;

  var rows = db.prepare([
    'SELECT e.id, e.tx_id, e.delta, e.balance_after, e.created_at,',
    '       t.kind, t.app_name, t.operator, t.memo, t.meta_json',
    'FROM xy_entry e JOIN xy_tx t ON t.id = e.tx_id',
    'WHERE e.user_id = ? AND (? = 0 OR e.id < ?)',
    'ORDER BY e.id DESC LIMIT ?'
  ].join('\n')).all(String(userId), beforeId, beforeId, limit);

  var list = rows.map(function (r) {
    var meta = null;
    if (r.meta_json) { try { meta = JSON.parse(r.meta_json); } catch (e) { meta = null; } }
    return {
      id: r.id,
      tx_id: r.tx_id,
      delta_cent: r.delta,
      delta: fromCent(r.delta),
      balance_after: fromCent(r.balance_after),
      kind: r.kind,
      kind_label: KINDS[r.kind] || r.kind,
      app: r.app_name,
      operator: r.operator,
      memo: r.memo,
      meta: meta,
      created_at: r.created_at
    };
  });

  return {
    list: list,
    next_before_id: list.length === limit ? list[list.length - 1].id : 0
  };
}

// 系统账户不参与榜单
function leaderboard(opts) {
  ensureSchema();
  var o = opts || {};
  var limit = Math.min(Math.max(parseInt(o.limit, 10) || 10, 1), 50);
  var rows = db.prepare([
    'SELECT a.user_id, a.balance, u.net_name, u.real_name',
    'FROM xy_account a LEFT JOIN users u ON u.user_id = a.user_id',
    "WHERE a.user_id NOT LIKE '@%' AND a.status = 'active'",
    'ORDER BY a.balance DESC LIMIT ?'
  ].join('\n')).all(limit);
  return rows.map(function (r, i) {
    return {
      rank: i + 1,
      user_id: r.user_id,
      net_name: r.net_name || '',
      real_name: r.real_name || '',
      balance: fromCent(r.balance),
      balance_cent: r.balance
    };
  });
}

// ---------- 统计与对账 ----------

function summary(opts) {
  ensureSchema();
  var o = opts || {};
  var todayStart = (function () {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime() - 8 * 3600 * 1000;
  })();

  var accounts = db.prepare("SELECT COUNT(*) AS c FROM xy_account WHERE user_id NOT LIKE '@%'").get().c;
  var circulation = db.prepare("SELECT COALESCE(SUM(balance), 0) AS s FROM xy_account WHERE user_id NOT LIKE '@%'").get().s;
  var frozen = db.prepare("SELECT COALESCE(SUM(frozen), 0) AS s FROM xy_account WHERE user_id NOT LIKE '@%'").get().s;
  var minted = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS s FROM xy_tx WHERE kind IN ('welcome','daily','admin_grant','reward') AND created_at >= ?"
  ).get(todayStart).s;
  var burned = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS s FROM xy_tx WHERE kind IN ('admin_deduct') AND created_at >= ?"
  ).get(todayStart).s;
  var txToday = db.prepare('SELECT COUNT(*) AS c FROM xy_tx WHERE created_at >= ?').get(todayStart).c;

  return {
    accounts: accounts,
    circulation_cent: circulation,
    circulation: fromCent(circulation),
    frozen_cent: frozen,
    frozen: fromCent(frozen),
    minted_today: fromCent(minted),
    burned_today: fromCent(burned),
    tx_today: txToday,
    // 人均持有（元），保留 2 位
    avg_balance: accounts ? Math.round(circulation / accounts) / CENT_PER_YUAN : 0,
    daily_cent: DAILY_CENT,
    welcome_cent: WELCOME_CENT,
    limits: {
      max_transfer: fromCent(MAX_TRANSFER_CENT),
      max_balance: fromCent(MAX_BALANCE_CENT)
    },
    // 可选：管理员视角下的操作记录（按时间倒序）
    recent: o.recent === false ? [] : (function () {
      var rows = db.prepare([
        'SELECT id, kind, app_name, operator, memo, amount, created_at, meta_json',
        'FROM xy_tx ORDER BY id DESC LIMIT ?'
      ].join('\n')).all(Math.min(parseInt(o.recentLimit, 10) || 8, 50));
      return rows.map(function (r) {
        var meta = null;
        if (r.meta_json) { try { meta = JSON.parse(r.meta_json); } catch (e) {} }
        return {
          tx_id: r.id, kind: r.kind, kind_label: KINDS[r.kind] || r.kind,
          app: r.app_name, operator: r.operator, memo: r.memo,
          amount: fromCent(r.amount), meta: meta, created_at: r.created_at
        };
      });
    })()
  };
}

// 对账：三类不一致，任何一条都意味着账本被绕过或写坏了。
function audit() {
  ensureSchema();
  var issues = [];

  var globalSum = db.prepare('SELECT COALESCE(SUM(balance), 0) AS s FROM xy_account').get().s;
  if (globalSum !== 0) {
    issues.push({ type: 'circulation_leak', detail: '全体账户余额之和不为 0（' + globalSum + ' 分）' });
  }

  var unbalanced = db.prepare([
    'SELECT tx_id, SUM(delta) AS s FROM xy_entry GROUP BY tx_id HAVING s <> 0 LIMIT 20'
  ].join('\n')).all();
  for (var i = 0; i < unbalanced.length; i++) {
    issues.push({ type: 'tx_unbalanced', detail: '交易 ' + unbalanced[i].tx_id + ' 分录不平（' + unbalanced[i].s + ' 分）' });
  }

  var drift = db.prepare([
    'SELECT a.user_id, a.balance, COALESCE(SUM(e.delta), 0) AS s',
    'FROM xy_account a LEFT JOIN xy_entry e ON e.user_id = a.user_id',
    'GROUP BY a.user_id HAVING a.balance <> s LIMIT 20'
  ].join('\n')).all();
  for (var j = 0; j < drift.length; j++) {
    issues.push({
      type: 'balance_drift',
      detail: '账户 ' + drift[j].user_id + ' 余额 ' + drift[j].balance + ' 与流水汇总 ' + drift[j].s + ' 不一致'
    });
  }

  return {
    ok: issues.length === 0,
    issues: issues,
    checked_at: now(),
    accounts: db.prepare("SELECT COUNT(*) AS c FROM xy_account WHERE user_id NOT LIKE '@%'").get().c,
    entries: db.prepare('SELECT COUNT(*) AS c FROM xy_entry').get().c,
    transactions: db.prepare('SELECT COUNT(*) AS c FROM xy_tx').get().c
  };
}

module.exports = {
  CENT_PER_YUAN: CENT_PER_YUAN,
  KINDS: KINDS,
  SYSTEM_MINT: SYSTEM_MINT,
  SYSTEM_FEE: SYSTEM_FEE,
  toCent: toCent,
  fromCent: fromCent,
  todayKey: todayKey,
  isSystem: isSystem,
  appEscrow: appEscrow,
  ensureAccount: ensureAccount,
  ensureSystemAccount: ensureSystemAccount,
  getAccount: getAccount,
  viewAccount: viewAccount,
  post: post,
  mint: mint,
  burn: burn,
  transfer: transfer,
  hold: hold,
  release: release,
  settleHold: settleHold,
  credit: credit,
  claimDaily: claimDaily,
  history: history,
  leaderboard: leaderboard,
  summary: summary,
  audit: audit,
  LIMITS: {
    MAX_TRANSFER_CENT: MAX_TRANSFER_CENT,
    MAX_TX_CENT: MAX_TX_CENT,
    MAX_BALANCE_CENT: MAX_BALANCE_CENT,
    WELCOME_CENT: WELCOME_CENT,
    DAILY_CENT: DAILY_CENT
  }
};
