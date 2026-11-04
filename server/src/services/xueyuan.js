// 学元（XueYuan）—— 平台统一虚拟货币服务
// ============================================================
// 学元是 ClassIntra 生态里的**唯一**记账货币，供平台功能与第三方应用结算。
// 它与 Cluss 的积分体系**完全独立**：不共享表、不共享接口、不互相兑换。
//
// ---- 双资金池（2026-11-04 起）----
// 学元按来源拆成两个池，从记账层就分开，避免「赠送 → 提现」套现：
//   cash  充值学元：班管线下收现金后录入，可转账、发红包、投资、提现
//   grant 赠送学元：开户礼金 / 每日津贴 / 教师发放 / 成就奖励，只能用于投资
// 所有支出必须显式声明资金池；未声明时按「赠送优先」处理（兼容旧调用）。
//
// ---- 与现实货币的比率 ----
// 默认 1 元 = 1 学元（100 分）。可在配置或环境变量里改（1 / 10 / 100），
// 但充值、提现、流水展示统一走 yuanRate()，不允许各页面自己换算。
//
// ---- 三条硬规则（改代码前先看这三条）----
// 1. **复式记账，借贷必平**。每笔业务写 xy_tx + ≥2 条 xy_entry，SUM(delta)=0。
//    任何「只加不减」的实现都是发币，必须走 mint()（对手方是 @system:mint）。
// 2. **金额一律整数分**。对外接口收「学元」小数，进来立刻转分；
//    内部绝不用浮点参与运算。
// 3. **幂等靠 ref**。发钱、发津贴、成交结算、充值、提现都必须带稳定 ref，
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

var POOL = {
  CASH: 'cash',
  GRANT: 'grant',
  SYSTEM: 'system'
};

// 新账户赠金：1000 学元（给新生一笔启动资金去体验投资）
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
// 单笔线下充值上限：2000 元等值（校园场景足够，异常大额走多次录入）
var MAX_RECHARGE_CENT = 200000;
// 单笔提现上限：1000 元等值；且提现总额不得超过累计净充值
var MAX_WITHDRAW_CENT = 100000;
// 提现最小额：1 元等值
var MIN_WITHDRAW_CENT = 100;
// 学元与现实货币比率：1 元 = 1 学元
var YUAN_RATE = 1;

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
  adjust: '账目调整',
  recharge: '线下充值',
  withdraw: '提现'
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

// 1 元 = 多少学元。只接受 1 / 10 / 100，避免出现无法解释的比率。
function yuanRate() {
  var raw = (config && config.xueyuan && config.xueyuan.yuanRate) || process.env.XUEYUAN_YUAN_RATE || YUAN_RATE;
  var n = Number(raw);
  if (!isFinite(n) || n <= 0) n = YUAN_RATE;
  return n;
}

// 人民币元 → 学元分
function yuanToCent(yuan, rate) {
  var r = rate || yuanRate();
  var n = Number(yuan);
  if (!isFinite(n)) return null;
  return Math.round(n * r * CENT_PER_YUAN);
}

// 学元分 → 人民币元
function centToYuan(cent, rate) {
  var r = rate || yuanRate();
  return Math.round((Number(cent) || 0) / CENT_PER_YUAN / r * 100) / 100;
}

function normalizePool(pool, delta, userId) {
  if (isSystem(userId)) return POOL.SYSTEM;
  var p = String(pool || '');
  if (p === POOL.CASH || p === POOL.GRANT) return p;
  // 未声明：入账默认赠送池；出账也默认赠送池（旧调用行为）
  if (!p) return POOL.GRANT;
  throw new Error('未知的资金池: ' + p);
}

function poolLabel(pool) {
  if (pool === POOL.CASH) return '充值学元';
  if (pool === POOL.GRANT) return '赠送学元';
  return '系统';
}

// ---------- 账户 ----------

function createIfMissing(userId, txTime) {
  var ts = txTime || now();
  db.prepare(
    "INSERT OR IGNORE INTO xy_account (user_id, balance, frozen, cash_balance, grant_balance, frozen_cash, frozen_grant, status, opened_at, updated_at) VALUES (?, 0, 0, 0, 0, 0, 0, 'active', ?, ?)"
  ).run(userId, ts, ts);
}

// 累计净充值（分）：用于提现风控，保证提现总额不会超过真实线下入金。
function netRechargeCent(userId) {
  ensureSchema();
  var id = String(userId || '');
  var recharged = db.prepare([
    'SELECT COALESCE(SUM(e.delta), 0) AS s FROM xy_entry e',
    'JOIN xy_tx t ON t.id = e.tx_id',
    "WHERE e.user_id = ? AND t.kind = 'recharge' AND e.delta > 0"
  ].join('\n')).get(id).s;
  var withdrawn = db.prepare([
    'SELECT COALESCE(SUM(-e.delta), 0) AS s FROM xy_entry e',
    'JOIN xy_tx t ON t.id = e.tx_id',
    "WHERE e.user_id = ? AND t.kind = 'withdraw' AND e.delta < 0"
  ].join('\n')).get(id).s;
  return Number(recharged) - Number(withdrawn);
}

// 可提现额度（分）= 可用充值学元 ∩ 累计净充值
function withdrawableCent(userId) {
  var a = getAccount(userId);
  if (!a.exists || isSystem(userId)) return 0;
  var cashAvail = Math.max(0, a.cash_balance - a.frozen_cash);
  var net = Math.max(0, netRechargeCent(userId));
  return Math.min(cashAvail, net);
}

function getAccount(userId) {
  ensureSchema();
  var id = String(userId || '');
  if (!isValidUserId(id)) throw new Error('用户标识非法');
  var row = db.prepare([
    'SELECT user_id, balance, frozen, cash_balance, grant_balance, frozen_cash, frozen_grant,',
    '       status, opened_at, updated_at FROM xy_account WHERE user_id = ?'
  ].join(' ')).get(id);
  if (!row) {
    return {
      user_id: id,
      exists: false,
      balance: 0,
      frozen: 0,
      available: 0,
      cash_balance: 0,
      grant_balance: 0,
      frozen_cash: 0,
      frozen_grant: 0,
      available_cash: 0,
      available_grant: 0,
      withdrawable: 0,
      status: 'none'
    };
  }
  return {
    user_id: row.user_id,
    exists: true,
    balance: row.balance,
    frozen: row.frozen,
    available: row.balance - row.frozen,
    cash_balance: row.cash_balance,
    grant_balance: row.grant_balance,
    frozen_cash: row.frozen_cash,
    frozen_grant: row.frozen_grant,
    available_cash: row.cash_balance - row.frozen_cash,
    available_grant: row.grant_balance - row.frozen_grant,
    status: row.status,
    opened_at: row.opened_at,
    updated_at: row.updated_at
  };
}

// 对外用「学元」计价，返回结构化金额（分 + 元），前端不用自己算
function viewAccount(userId) {
  var a = getAccount(userId);
  var withdrawable = 0;
  if (a.exists && !isSystem(a.user_id)) {
    withdrawable = withdrawableCent(a.user_id);
  }
  return {
    user_id: a.user_id,
    exists: a.exists,
    balance_cent: a.balance,
    frozen_cent: a.frozen,
    available_cent: a.available,
    balance: fromCent(a.balance),
    frozen: fromCent(a.frozen),
    available: fromCent(a.available),
    // 充值学元
    cash_cent: a.cash_balance,
    cash: fromCent(a.cash_balance),
    available_cash_cent: a.available_cash,
    available_cash: fromCent(a.available_cash),
    frozen_cash_cent: a.frozen_cash,
    frozen_cash: fromCent(a.frozen_cash),
    // 赠送学元
    grant_cent: a.grant_balance,
    grant: fromCent(a.grant_balance),
    available_grant_cent: a.available_grant,
    available_grant: fromCent(a.available_grant),
    frozen_grant_cent: a.frozen_grant,
    frozen_grant: fromCent(a.frozen_grant),
    // 可提现（充值学元中未超出净充值的部分）
    withdrawable_cent: withdrawable,
    withdrawable: fromCent(withdrawable),
    yuan_rate: yuanRate(),
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
      pool: POOL.GRANT,
      ref: 'welcome:' + id,
      memo: '学元账户开户赠金（仅可用于投资）'
    });
    granted = !r.duplicate;
  }

  return { created: !existed, welcome_granted: granted, account: viewAccount(id) };
}

// ---------- 记账内核 ----------

// post：唯一的写账入口。
// opts:
//   entries  [{ user_id, delta, pool }]（分，必须有正有负且和为 0）
//   kind     业务类型（KINDS 白名单）
//   ref      幂等键（可选，建议必填）
//   app      来源应用名（第三方应用传自己的 name）
//   operator 操作人（管理员发放时是管理员 user_id）
//   memo     备注
//   meta     附加信息（JSON 可序列化）
//   at       业务时间（缺省 now）
//
// pool: 'cash' 充值池 / 'grant' 赠送池；系统账户自动为 'system'。
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
    var pool = normalizePool(e.pool, delta, uid);
    sum += delta;
    normalized.push({ user_id: uid, delta: delta, pool: pool });
  }
  if (sum !== 0) throw new Error('分录不平衡（SUM=' + sum + ' 分），拒绝记账');

  // 同一用户同一池在同一笔交易里出现两次 → 大概率是调用方算错了，直接拒绝
  for (var j = 0; j < normalized.length; j++) {
    var key = normalized[j].user_id + '|' + normalized[j].pool;
    if (touched[key]) throw new Error('同一交易中重复出现账户: ' + normalized[j].user_id);
    touched[key] = true;
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
      var acc = db.prepare([
        'SELECT balance, frozen, cash_balance, grant_balance, frozen_cash, frozen_grant, status',
        'FROM xy_account WHERE user_id = ?'
      ].join(' ')).get(item.user_id);
      if (!acc) {
        // 系统账户之外的账户必须提前开户（防止拼错 id 凭空造账户）
        if (isSystem(item.user_id)) {
          createIfMissing(item.user_id, at);
          acc = db.prepare([
            'SELECT balance, frozen, cash_balance, grant_balance, frozen_cash, frozen_grant, status',
            'FROM xy_account WHERE user_id = ?'
          ].join(' ')).get(item.user_id);
        } else {
          throw new Error('账户不存在: ' + item.user_id);
        }
      }
      if (acc.status === 'frozen') throw new Error('账户已被冻结: ' + item.user_id);

      var after = acc.balance + item.delta;
      var cashAfter = acc.cash_balance + (item.pool === POOL.CASH ? item.delta : 0);
      var grantAfter = acc.grant_balance + (item.pool === POOL.GRANT ? item.delta : 0);

      if (!isSystem(item.user_id)) {
        if (after < 0) throw new Error('学元余额不足（账户 ' + item.user_id + '）');
        if (after > MAX_BALANCE_CENT) throw new Error('账户余额超过上限');

        if (item.pool === POOL.CASH) {
          if (cashAfter < 0) throw new Error('充值学元余额不足（账户 ' + item.user_id + '）');
          if (item.delta < 0 && acc.cash_balance - acc.frozen_cash + item.delta < 0) {
            throw new Error('充值学元可用不足（有 ' + fromCent(acc.frozen_cash) + ' 学元被冻结）');
          }
        } else if (item.pool === POOL.GRANT) {
          if (grantAfter < 0) throw new Error('赠送学元余额不足（账户 ' + item.user_id + '）');
          if (item.delta < 0 && acc.grant_balance - acc.frozen_grant + item.delta < 0) {
            throw new Error('赠送学元可用不足（有 ' + fromCent(acc.frozen_grant) + ' 学元被冻结）');
          }
        }

        if (item.delta < 0 && acc.balance - acc.frozen + item.delta < 0) {
          throw new Error('可用学元不足（有 ' + fromCent(acc.frozen) + ' 学元被冻结）');
        }
      }

      db.prepare([
        'UPDATE xy_account SET balance = ?, cash_balance = ?, grant_balance = ?, updated_at = ?',
        'WHERE user_id = ?'
      ].join(' ')).run(after, cashAfter, grantAfter, at, item.user_id);
      db.prepare('INSERT INTO xy_entry (tx_id, user_id, delta, pool, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(txId, item.user_id, item.delta, item.pool, after, at);
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
// （赠金、津贴、教师发放、线下充值），不要拿它当「改余额」的快捷方式。
// pool 缺省为赠送池：系统发放默认只能用于投资，避免凭空产生可提现余额。
function mint(opts) {
  var o = opts || {};
  var to = String(o.to || '');
  var amountCent = o.amountCent;
  var pool = o.pool === POOL.CASH ? POOL.CASH : POOL.GRANT;
  if (!isValidUserId(to) || isSystem(to)) throw new Error('铸币目标账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('铸币金额必须是正整数分');
  }
  createIfMissing(to, o.at);
  return post({
    entries: [
      { user_id: SYSTEM_MINT, delta: -amountCent, pool: POOL.SYSTEM },
      { user_id: to, delta: amountCent, pool: pool }
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
// pool 缺省为赠送池：教师扣减默认先收赠送学元，避免误扣学生线下充值的钱。
function burn(opts) {
  var o = opts || {};
  var from = String(o.from || '');
  var amountCent = o.amountCent;
  var pool = o.pool === POOL.CASH ? POOL.CASH : POOL.GRANT;
  if (!isValidUserId(from) || isSystem(from)) throw new Error('回收账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('回收金额必须是正整数分');
  }
  return post({
    entries: [
      { user_id: from, delta: -amountCent, pool: pool },
      { user_id: SYSTEM_MINT, delta: amountCent, pool: POOL.SYSTEM }
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
// 转账只允许使用充值学元：赠送学元只能用于投资，不允许在同学间流转套现。
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
      { user_id: from, delta: -amountCent, pool: POOL.CASH },
      { user_id: to, delta: amountCent, pool: POOL.CASH }
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

// ---------- 冻结（挂单/担保/提现） ----------
// 冻结只动 frozen，不动 balance —— 所以它不产生分录，
// 也不会破坏「SUM(balance)=0」这条对账不变量。
// opts.pool: 'cash' | 'grant' | 'grant_first'（缺省：投资场景赠送优先）

function hold(userId, amountCent, opts) {
  ensureSchema();
  var o = opts || {};
  var id = String(userId || '');
  var mode = o.pool || 'grant_first';
  if (!isValidUserId(id) || isSystem(id)) throw new Error('账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('冻结金额必须是正整数分');
  }

  var account = db.prepare('SELECT cash_balance, grant_balance, frozen_cash, frozen_grant FROM xy_account WHERE user_id = ?').get(id);
  if (!account) throw new Error('账户不存在');

  var useGrant = 0;
  var useCash = 0;
  if (mode === 'cash') {
    useCash = amountCent;
  } else if (mode === 'grant') {
    useGrant = amountCent;
  } else {
    useGrant = Math.min(Math.max(0, account.grant_balance - account.frozen_grant), amountCent);
    useCash = amountCent - useGrant;
  }

  var ts = now();
  var tx = db.transaction(function() {
    if (useGrant > 0) {
      var g = db.prepare([
        'UPDATE xy_account SET frozen = frozen + ?, frozen_grant = frozen_grant + ?, updated_at = ?',
        'WHERE user_id = ? AND grant_balance - frozen_grant >= ?'
      ].join(' ')).run(useGrant, useGrant, ts, id, useGrant);
      if (!g.changes) throw new Error('赠送学元不足，无法冻结');
    }
    if (useCash > 0) {
      var c = db.prepare([
        'UPDATE xy_account SET frozen = frozen + ?, frozen_cash = frozen_cash + ?, updated_at = ?',
        'WHERE user_id = ? AND cash_balance - frozen_cash >= ?'
      ].join(' ')).run(useCash, useCash, ts, id, useCash);
      if (!c.changes) throw new Error('充值学元不足，无法冻结');
    }
  });
  tx();
  return getAccount(id);
}

// 解冻。opts.pool：'cash' | 'grant'；缺省按「赠送冻结优先」释放
// （与缺省 hold 的 grant_first 对称，投资撤单不会误动红包冻结）。
function release(userId, amountCent, opts) {
  ensureSchema();
  var o = opts || {};
  var id = String(userId || '');
  if (!isValidUserId(id) || isSystem(id)) throw new Error('账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('解冻金额必须是正整数分');
  }

  var tx = db.transaction(function() {
    var acc = db.prepare('SELECT frozen, frozen_cash, frozen_grant FROM xy_account WHERE user_id = ?').get(id);
    if (!acc) throw new Error('账户不存在');
    if (acc.frozen < amountCent) throw new Error('解冻额超过冻结总额');

    var fromGrant = 0;
    var fromCash = 0;
    if (o.pool === POOL.CASH) {
      fromCash = amountCent;
      if (acc.frozen_cash < fromCash) throw new Error('充值学元冻结额不足');
    } else if (o.pool === POOL.GRANT) {
      fromGrant = amountCent;
      if (acc.frozen_grant < fromGrant) throw new Error('赠送学元冻结额不足');
    } else {
      fromGrant = Math.min(acc.frozen_grant, amountCent);
      fromCash = amountCent - fromGrant;
      if (acc.frozen_cash < fromCash) throw new Error('冻结额不足');
    }

    db.prepare([
      'UPDATE xy_account SET frozen = frozen - ?, frozen_cash = frozen_cash - ?,',
      'frozen_grant = frozen_grant - ?, updated_at = ? WHERE user_id = ?'
    ].join(' ')).run(amountCent, fromCash, fromGrant, now(), id);
  });
  tx();
  return getAccount(id);
}

// 成交结算：把「冻结的一部分」真正花掉，剩余解冻退回。
//   holdCent   下单时冻结的金额
//   costCent   实际应付（成交额 + 费用）
//   pool       可选，显式指定资金池；缺省按冻结拆分：赠送冻结优先消耗
// 语义：frozen -= holdCent；按池扣减 costCent；差额自动回到可用。
function settleHold(opts) {
  var o = opts || {};
  var uid = String(o.user_id || '');
  var holdCent = o.holdCent;
  var costCent = o.costCent;
  var feeCent = o.feeCent || 0;

  if (!isValidUserId(uid) || isSystem(uid)) throw new Error('账户非法');
  if (!(holdCent > 0) || costCent < 0 || feeCent < 0) throw new Error('结算金额非法');
  if (costCent > holdCent) throw new Error('应付金额超过冻结额（内部错误）');
  if (feeCent > costCent) throw new Error('费用不能超过应付总额');

  var settle = db.transaction(function() {
    var acc = db.prepare([
      'SELECT balance, frozen, cash_balance, grant_balance, frozen_cash, frozen_grant',
      'FROM xy_account WHERE user_id = ?'
    ].join(' ')).get(uid);
    if (!acc) throw new Error('账户不存在');
    if (acc.frozen < holdCent) throw new Error('冻结额不足（可能已被其他委托占用）');

    var grantHold = 0;
    var cashHold = 0;
    if (o.pool === POOL.CASH) {
      cashHold = holdCent;
      if (acc.frozen_cash < cashHold) throw new Error('充值学元冻结额不足');
    } else if (o.pool === POOL.GRANT) {
      grantHold = holdCent;
      if (acc.frozen_grant < grantHold) throw new Error('赠送学元冻结额不足');
    } else {
      grantHold = Math.min(acc.frozen_grant, holdCent);
      cashHold = holdCent - grantHold;
      if (acc.frozen_cash < cashHold) throw new Error('冻结额不足');
    }

    // 成本优先从赠送冻结部分扣，不足再扣充值部分
    var grantSpend = Math.min(costCent, grantHold);
    var cashSpend = costCent - grantSpend;
    var tradeCent = costCent - feeCent;
    var grantTrade = Math.min(tradeCent, grantSpend);
    var grantFee = grantSpend - grantTrade;
    var cashTrade = tradeCent - grantTrade;
    var cashFee = feeCent - grantFee;

    // 1) 解冻整笔
    db.prepare([
      'UPDATE xy_account SET frozen = frozen - ?, frozen_grant = frozen_grant - ?,',
      'frozen_cash = frozen_cash - ?, updated_at = ? WHERE user_id = ?'
    ].join(' ')).run(holdCent, grantHold, cashHold, now(), uid);

    // 2) 真正的资金流：成交额 + 费用，按池分别记账
    if (grantTrade > 0) {
      ensureSystemAccount('@system:settle', now());
      post({
        entries: [
          { user_id: uid, delta: -grantTrade, pool: POOL.GRANT },
          { user_id: '@system:settle', delta: grantTrade, pool: POOL.SYSTEM }
        ],
        kind: 'trade',
        ref: o.ref ? o.ref + ':trade:grant' : null,
        app: o.app,
        memo: o.memo,
        meta: o.meta,
        at: o.at
      });
    }
    if (cashTrade > 0) {
      ensureSystemAccount('@system:settle', now());
      post({
        entries: [
          { user_id: uid, delta: -cashTrade, pool: POOL.CASH },
          { user_id: '@system:settle', delta: cashTrade, pool: POOL.SYSTEM }
        ],
        kind: 'trade',
        ref: o.ref ? o.ref + ':trade:cash' : null,
        app: o.app,
        memo: o.memo,
        meta: o.meta,
        at: o.at
      });
    }
    if (grantFee > 0) {
      ensureSystemAccount(SYSTEM_FEE, now());
      post({
        entries: [
          { user_id: uid, delta: -grantFee, pool: POOL.GRANT },
          { user_id: SYSTEM_FEE, delta: grantFee, pool: POOL.SYSTEM }
        ],
        kind: 'fee',
        ref: o.ref ? o.ref + ':fee:grant' : null,
        app: o.app,
        memo: (o.memo || '') + '（费用）',
        meta: o.meta,
        at: o.at
      });
    }
    if (cashFee > 0) {
      ensureSystemAccount(SYSTEM_FEE, now());
      post({
        entries: [
          { user_id: uid, delta: -cashFee, pool: POOL.CASH },
          { user_id: SYSTEM_FEE, delta: cashFee, pool: POOL.SYSTEM }
        ],
        kind: 'fee',
        ref: o.ref ? o.ref + ':fee:cash' : null,
        app: o.app,
        memo: (o.memo || '') + '（费用）',
        meta: o.meta,
        at: o.at
      });
    }
    return getAccount(uid);
  });

  return settle();
}

// 冻结资金入账（卖出成交后收到钱）：直接入 balance，不涉及 frozen。
// 默认入充值池：投资回款可继续流转；提现仍受「累计净充值」上限约束，
// 赠送学元无法通过卖出提现套利。
function credit(userId, amountCent, opts) {
  var o = opts || {};
  var pool = o.pool === POOL.GRANT ? POOL.GRANT : POOL.CASH;
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('入账金额必须为正整数分');
  }
  ensureSystemAccount('@system:settle', now());
  return post({
    entries: [
      { user_id: '@system:settle', delta: -amountCent, pool: POOL.SYSTEM },
      { user_id: String(userId), delta: amountCent, pool: pool }
    ],
    kind: o.kind || 'trade',
    ref: o.ref,
    app: o.app,
    memo: o.memo,
    meta: o.meta,
    at: o.at
  });
}

// ---------- 线下充值 / 提现 ----------

// 班管线下收现金后录入充值。
// opts: { user, amountCent | yuan, operator, requestId, method, memo, rate }
function recharge(opts) {
  ensureSchema();
  var o = opts || {};
  var uid = String(o.user || '');
  var operator = String(o.operator || '');
  if (!isValidUserId(uid) || isSystem(uid)) throw new Error('充值账户非法');
  if (!isValidUserId(operator) || isSystem(operator)) throw new Error('操作人非法');

  var rate = Number(o.rate) > 0 ? Number(o.rate) : yuanRate();
  var amountCent = typeof o.amountCent === 'number' ? Math.round(o.amountCent) : yuanToCent(o.yuan, rate);
  if (!isFinite(amountCent) || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('充值金额必须是正整数分');
  }
  if (amountCent > MAX_RECHARGE_CENT) {
    throw new Error('单笔充值不能超过 ' + centToYuan(MAX_RECHARGE_CENT, rate) + ' 元');
  }
  if (!db.prepare('SELECT 1 FROM xy_account WHERE user_id = ?').get(uid)) {
    throw new Error('该同学尚未开通学元账户');
  }

  var requestId = o.requestId ? String(o.requestId) : null;
  if (requestId) {
    var existed = db.prepare('SELECT * FROM xy_recharge WHERE request_id = ?').get(requestId);
    if (existed) {
      return { duplicate: true, recharge: mapRecharge(existed), account: viewAccount(uid) };
    }
  }

  var tx = db.transaction(function() {
    createIfMissing(uid);
    var r = mint({
      to: uid,
      amountCent: amountCent,
      kind: 'recharge',
      pool: POOL.CASH,
      ref: requestId ? 'recharge:' + requestId : null,
      operator: operator,
      memo: o.memo || ('线下充值 ' + fromCent(amountCent) + ' 学元'),
      meta: { yuan: centToYuan(amountCent, rate), rate: rate, method: o.method || 'cash' }
    });
    if (r.duplicate) {
      var old = requestId ? db.prepare('SELECT * FROM xy_recharge WHERE request_id = ?').get(requestId) : null;
      if (old) return { duplicate: true, row: old };
      throw new Error('充值请求重复');
    }
    var info = db.prepare([
      'INSERT INTO xy_recharge (user_id, amount_cent, yuan_cents, rate, method, operator, memo, request_id, tx_id, created_at)',
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join(' ')).run(
      uid, amountCent,
      Math.round(centToYuan(amountCent, rate) * CENT_PER_YUAN),
      rate, o.method || 'cash', operator,
      o.memo ? String(o.memo) : '', requestId, r.tx_id, now()
    );
    return { duplicate: false, row: db.prepare('SELECT * FROM xy_recharge WHERE id = ?').get(Number(info.lastInsertRowid)) };
  });

  var result = tx();
  return {
    duplicate: !!result.duplicate,
    recharge: mapRecharge(result.row),
    account: viewAccount(uid)
  };
}

function mapRecharge(r) {
  if (!r) return null;
  return {
    id: r.id,
    user_id: r.user_id,
    amount_cent: r.amount_cent,
    amount: fromCent(r.amount_cent),
    yuan: centToYuan(r.amount_cent, r.rate || 1),
    rate: r.rate,
    method: r.method,
    operator: r.operator,
    memo: r.memo,
    request_id: r.request_id,
    tx_id: r.tx_id,
    created_at: r.created_at
  };
}

// 学生发起提现申请：先把充值学元冻结，防止审批期间被花掉。
function requestWithdraw(opts) {
  ensureSchema();
  var o = opts || {};
  var uid = String(o.user || '');
  var amountCent = typeof o.amountCent === 'number' ? Math.round(o.amountCent) : yuanToCent(o.yuan);
  if (!isValidUserId(uid) || isSystem(uid)) throw new Error('提现账户非法');
  if (!(amountCent > 0) || Math.floor(amountCent) !== amountCent) throw new Error('提现金额必须是正整数分');
  if (amountCent > MAX_WITHDRAW_CENT) throw new Error('单笔提现不能超过 ' + fromCent(MAX_WITHDRAW_CENT) + ' 学元');
  if (amountCent < MIN_WITHDRAW_CENT) throw new Error('单笔提现不能低于 ' + fromCent(MIN_WITHDRAW_CENT) + ' 学元');

  var requestId = o.requestId ? String(o.requestId) : null;
  if (requestId) {
    var existed = db.prepare('SELECT * FROM xy_withdraw WHERE request_id = ?').get(requestId);
    if (existed) return { duplicate: true, withdraw: mapWithdraw(existed), account: viewAccount(uid) };
  }

  var pending = db.prepare("SELECT * FROM xy_withdraw WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1").get(uid);
  if (pending) throw new Error('已有一笔提现待班管处理，请等处理完再申请');

  var available = withdrawableCent(uid);
  if (amountCent > available) {
    throw new Error('可提现学元不足（可提现 ' + fromCent(available) + ' 学元，只有充值学元可提现）');
  }

  var result;
  var tx = db.transaction(function() {
    hold(uid, amountCent, { pool: POOL.CASH });
    var info = db.prepare([
      'INSERT INTO xy_withdraw (user_id, amount_cent, status, memo, request_id, created_at)',
      "VALUES (?, ?, 'pending', ?, ?, ?)"
    ].join(' ')).run(uid, amountCent, o.memo ? String(o.memo) : '', requestId, now());
    result = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(Number(info.lastInsertRowid));
  });
  tx();
  return { duplicate: false, withdraw: mapWithdraw(result), account: viewAccount(uid) };
}

function mapWithdraw(r) {
  if (!r) return null;
  return {
    id: r.id,
    user_id: r.user_id,
    amount_cent: r.amount_cent,
    amount: fromCent(r.amount_cent),
    status: r.status,
    memo: r.memo,
    review_memo: r.review_memo,
    operator: r.operator,
    reviewer: r.reviewer,
    request_id: r.request_id,
    tx_id: r.tx_id,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at
  };
}

// 班管审批提现：通过 → 解冻并扣款（线下已付现金）；驳回 → 解冻退回。
function reviewWithdraw(id, approve, opts) {
  ensureSchema();
  var o = opts || {};
  var reviewer = String(o.reviewer || '');
  if (!isValidUserId(reviewer) || isSystem(reviewer)) throw new Error('审批人非法');
  var wid = parseInt(id, 10);
  if (!(wid > 0)) throw new Error('提现单号非法');

  var out;
  var tx = db.transaction(function() {
    var row = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(wid);
    if (!row) throw new Error('提现单不存在');
    if (row.status !== 'pending') throw new Error('该提现单已处理');

    var ts = now();
    release(row.user_id, row.amount_cent, { pool: POOL.CASH });

    if (!approve) {
      db.prepare([
        "UPDATE xy_withdraw SET status = 'rejected', reviewer = ?, review_memo = ?,",
        'reviewed_at = ?, operator = ? WHERE id = ? AND status = \'pending\''
      ].join(' ')).run(reviewer, o.memo ? String(o.memo) : '', ts, reviewer, wid);
      out = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(wid);
      return;
    }

    var burnResult = burn({
      from: row.user_id,
      amountCent: row.amount_cent,
      pool: POOL.CASH,
      kind: 'withdraw',
      ref: 'withdraw:' + wid,
      operator: reviewer,
      memo: '提现（线下付现）' + (o.memo ? '：' + o.memo : '')
    });

    db.prepare([
      "UPDATE xy_withdraw SET status = 'paid', reviewer = ?, review_memo = ?,",
      'reviewed_at = ?, operator = ?, tx_id = ? WHERE id = ? AND status = \'pending\''
    ].join(' ')).run(reviewer, o.memo ? String(o.memo) : '', ts, reviewer, burnResult.tx_id, wid);
    out = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(wid);
  });
  tx();
  return { withdraw: mapWithdraw(out), account: viewAccount(out.user_id) };
}

function listWithdrawals(opts) {
  ensureSchema();
  var o = opts || {};
  var status = o.status ? String(o.status) : '';
  var user = o.user ? String(o.user) : '';
  var limit = Math.min(Math.max(parseInt(o.limit, 10) || 30, 1), 100);

  var where = [];
  var args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (user) { where.push('user_id = ?'); args.push(user); }
  var clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
  args.push(limit);

  var stmt = db.prepare('SELECT * FROM xy_withdraw' + clause + ' ORDER BY id DESC LIMIT ?');
  var rows = stmt.all.apply(stmt, args);
  return rows.map(mapWithdraw);
}

// 学生撤销自己待审批的提现申请：解冻，钱回到可用余额。
function cancelWithdraw(id, opts) {
  ensureSchema();
  var o = opts || {};
  var uid = String(o.user || '');
  if (!isValidUserId(uid) || isSystem(uid)) throw new Error('账户非法');
  var wid = parseInt(id, 10);
  if (!(wid > 0)) throw new Error('提现单号非法');

  var out;
  var tx = db.transaction(function() {
    var row = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(wid);
    if (!row) throw new Error('提现单不存在');
    if (row.user_id !== uid) throw new Error('只能撤销自己的提现申请');
    if (row.status !== 'pending') throw new Error('该提现单已处理，无法撤销');

    release(row.user_id, row.amount_cent, { pool: POOL.CASH });
    db.prepare([
      "UPDATE xy_withdraw SET status = 'cancelled', review_memo = ?, reviewed_at = ?",
      "WHERE id = ? AND status = 'pending'"
    ].join(' ')).run('学生撤销', now(), wid);
    out = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(wid);
  });
  tx();
  return { withdraw: mapWithdraw(out), account: viewAccount(uid) };
}

function listRecharges(opts) {
  ensureSchema();
  var o = opts || {};
  var limit = Math.min(Math.max(parseInt(o.limit, 10) || 30, 1), 100);
  var uid = o.user ? String(o.user) : '';
  var rows = uid
    ? db.prepare('SELECT * FROM xy_recharge WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(uid, limit)
    : db.prepare('SELECT * FROM xy_recharge ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map(mapRecharge);
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
    pool: POOL.GRANT,
    ref: ref,
    memo: '第 ' + (streak || 1) + ' 天助学津贴（仅可用于投资）',
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
    'SELECT e.id, e.tx_id, e.delta, e.pool, e.balance_after, e.created_at,',
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
      pool: r.pool,
      pool_label: poolLabel(r.pool),
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
  var cash = db.prepare("SELECT COALESCE(SUM(cash_balance), 0) AS s FROM xy_account WHERE user_id NOT LIKE '@%'").get().s;
  var grant = db.prepare("SELECT COALESCE(SUM(grant_balance), 0) AS s FROM xy_account WHERE user_id NOT LIKE '@%'").get().s;
  var frozenCash = db.prepare("SELECT COALESCE(SUM(frozen_cash), 0) AS s FROM xy_account WHERE user_id NOT LIKE '@%'").get().s;
  var frozenGrant = db.prepare("SELECT COALESCE(SUM(frozen_grant), 0) AS s FROM xy_account WHERE user_id NOT LIKE '@%'").get().s;
  var minted = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS s FROM xy_tx WHERE kind IN ('welcome','daily','admin_grant','reward') AND created_at >= ?"
  ).get(todayStart).s;
  var burned = db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS s FROM xy_tx WHERE kind IN ('admin_deduct','withdraw') AND created_at >= ?"
  ).get(todayStart).s;
  var rechargedToday = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS s FROM xy_tx WHERE kind = ? AND created_at >= ?'
  ).get('recharge', todayStart).s;
  var withdrawnToday = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS s FROM xy_tx WHERE kind = ? AND created_at >= ?'
  ).get('withdraw', todayStart).s;
  var rechargeTotal = db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM xy_tx WHERE kind = 'recharge'").get().s;
  var withdrawTotal = db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM xy_tx WHERE kind = 'withdraw'").get().s;
  var pendingWithdraw = db.prepare(
    "SELECT COUNT(*) AS c, COALESCE(SUM(amount_cent), 0) AS s FROM xy_withdraw WHERE status = 'pending'"
  ).get();
  var txToday = db.prepare('SELECT COUNT(*) AS c FROM xy_tx WHERE created_at >= ?').get(todayStart).c;

  return {
    accounts: accounts,
    circulation_cent: circulation,
    circulation: fromCent(circulation),
    cash_cent: cash,
    cash: fromCent(cash),
    grant_cent: grant,
    grant: fromCent(grant),
    frozen_cent: frozen,
    frozen: fromCent(frozen),
    frozen_cash: fromCent(frozenCash),
    frozen_grant: fromCent(frozenGrant),
    minted_today: fromCent(minted),
    burned_today: fromCent(burned),
    recharged_today: fromCent(rechargedToday),
    withdrawn_today: fromCent(withdrawnToday),
    recharge_total: fromCent(rechargeTotal),
    withdraw_total: fromCent(withdrawTotal),
    net_recharge_total: fromCent(rechargeTotal - withdrawTotal),
    pending_withdraw_count: pendingWithdraw.c,
    pending_withdraw_cent: pendingWithdraw.s,
    tx_today: txToday,
    avg_balance: accounts ? Math.round(circulation / accounts) / CENT_PER_YUAN : 0,
    daily_cent: DAILY_CENT,
    welcome_cent: WELCOME_CENT,
    yuan_rate: yuanRate(),
    limits: {
      max_transfer: fromCent(MAX_TRANSFER_CENT),
      max_balance: fromCent(MAX_BALANCE_CENT),
      max_recharge: fromCent(MAX_RECHARGE_CENT),
      max_withdraw: fromCent(MAX_WITHDRAW_CENT),
      min_withdraw: fromCent(MIN_WITHDRAW_CENT)
    },
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

// 对账：任何一条都意味着账本被绕过或写坏了。
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

  // 双池对账：普通账户的池余额必须与分池分录汇总一致
  var poolDrift = db.prepare([
    'SELECT a.user_id,',
    '       a.cash_balance, COALESCE(SUM(CASE WHEN e.pool = \'cash\' THEN e.delta ELSE 0 END), 0) AS cash_sum,',
    '       a.grant_balance, COALESCE(SUM(CASE WHEN e.pool = \'grant\' THEN e.delta ELSE 0 END), 0) AS grant_sum',
    'FROM xy_account a LEFT JOIN xy_entry e ON e.user_id = a.user_id',
    "WHERE a.user_id NOT LIKE '@%'",
    'GROUP BY a.user_id',
    'HAVING a.cash_balance <> cash_sum OR a.grant_balance <> grant_sum',
    'LIMIT 20'
  ].join('\n')).all();
  for (var k = 0; k < poolDrift.length; k++) {
    issues.push({
      type: 'pool_drift',
      detail: '账户 ' + poolDrift[k].user_id + ' 充值/赠送池 ' + poolDrift[k].cash_balance + '/' + poolDrift[k].grant_balance +
        ' 与分池流水 ' + poolDrift[k].cash_sum + '/' + poolDrift[k].grant_sum + ' 不一致'
    });
  }

  var badPool = db.prepare([
    'SELECT user_id, balance, cash_balance, grant_balance, frozen, frozen_cash, frozen_grant',
    "FROM xy_account WHERE user_id NOT LIKE '@%' AND (",
    '  balance <> cash_balance + grant_balance',
    '  OR cash_balance < 0 OR grant_balance < 0',
    '  OR frozen_cash < 0 OR frozen_grant < 0',
    '  OR frozen_cash > cash_balance OR frozen_grant > grant_balance',
    '  OR frozen <> frozen_cash + frozen_grant',
    ') LIMIT 20'
  ].join('\n')).all();
  for (var m = 0; m < badPool.length; m++) {
    issues.push({
      type: 'pool_inconsistent',
      detail: '账户 ' + badPool[m].user_id + ' 分池字段不自洽（balance=' + badPool[m].balance +
        ' cash=' + badPool[m].cash_balance + ' grant=' + badPool[m].grant_balance + '）'
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
  POOL: POOL,
  SYSTEM_MINT: SYSTEM_MINT,
  SYSTEM_FEE: SYSTEM_FEE,
  toCent: toCent,
  fromCent: fromCent,
  yuanToCent: yuanToCent,
  centToYuan: centToYuan,
  yuanRate: yuanRate,
  todayKey: todayKey,
  isSystem: isSystem,
  appEscrow: appEscrow,
  ensureAccount: ensureAccount,
  ensureSystemAccount: ensureSystemAccount,
  getAccount: getAccount,
  viewAccount: viewAccount,
  netRechargeCent: netRechargeCent,
  withdrawableCent: withdrawableCent,
  post: post,
  mint: mint,
  burn: burn,
  transfer: transfer,
  hold: hold,
  release: release,
  settleHold: settleHold,
  credit: credit,
  recharge: recharge,
  requestWithdraw: requestWithdraw,
  reviewWithdraw: reviewWithdraw,
  cancelWithdraw: cancelWithdraw,
  listWithdrawals: listWithdrawals,
  listRecharges: listRecharges,
  claimDaily: claimDaily,
  history: history,
  leaderboard: leaderboard,
  summary: summary,
  audit: audit,
  LIMITS: {
    MAX_TRANSFER_CENT: MAX_TRANSFER_CENT,
    MAX_TX_CENT: MAX_TX_CENT,
    MAX_BALANCE_CENT: MAX_BALANCE_CENT,
    MAX_RECHARGE_CENT: MAX_RECHARGE_CENT,
    MAX_WITHDRAW_CENT: MAX_WITHDRAW_CENT,
    MIN_WITHDRAW_CENT: MIN_WITHDRAW_CENT,
    WELCOME_CENT: WELCOME_CENT,
    DAILY_CENT: DAILY_CENT,
    DAILY_BONUS_CENT: DAILY_BONUS_CENT,
    DAILY_BONUS_FROM_DAY: DAILY_BONUS_FROM_DAY
  }
};
