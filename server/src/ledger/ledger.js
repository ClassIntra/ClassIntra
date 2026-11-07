// 学元账本 · 账本内核
// ============================================================
// 全系统**唯一**允许写 xy_ledger_balances 的地方。任何绕过 post() 的余额写入
// 都会让 I1c（账户余额 vs 分录汇总）在下次自检时报出来。
//
// 四条硬规则：
// 1. 每笔交易至少两条分录，且**按资产分组各自守恒**（CASH / GRANT / PRACTICE 互不串账）。
//    分组守恒是「印 GRANT 不会稀释 CASH 兑付能力」的机械保证，不是运营纪律。
// 2. ref 必填且唯一，重放直接返回原交易（幂等）。
// 3. 金额一律正整数分；direction 只接受 +1 / -1。
// 4. 余额是否可为负由账户属性决定：clearing 允许（负值=已发行净额），其余不允许。
//    ⚠️ 不能用表级 CHECK —— CHECK 无法跨表读 allow_negative（V.14 修正 1）。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var db = require('../utils/db');
var assets = require('./assets');

// 单位口径见 units.js：1 学元 = 100 单位，1 元 = 1000 学元 = 10 万单位。
// 本值 = 100 万学元 = ¥1000，只做溢出保护（正常限额都在业务层，远低于此）。
var MAX_TX_CENT = 100000000;

// 交易类型白名单：让流水可聚合，也防第三方随手发明 kind 把统计口径搞乱。
// ⚠️ 不要为了「少几个枚举」把 daily / admin_grant / recharge_revoke 合并成 grant / adjust：
//    津贴连签、教师发放的每日配额、充值撤回后的配额回滚全都按 kind 聚合，
//    合并等于把这些统计口径一次抹平。
var KINDS = {
  // ---- 资金进出 ----
  recharge: '充值',
  withdraw: '提现',
  recharge_revoke: '撤回充值',
  // ---- 发放 ----
  welcome: '开户赠金',
  daily: '助学津贴',
  admin_grant: '教师发放',
  admin_deduct: '教师扣减',
  reward: '任务奖励',
  grant: '发放赠金',
  practice: '发放练习金',
  // ---- 转移 ----
  transfer: '转账',
  hold: '冻结',
  redpacket: '发红包',
  redpacket_claim: '领红包',
  // ---- 交易 ----
  order_pay: '下单支付',
  order_settle: '订单结算',
  order_refund: '订单退款',
  refund: '退款',
  rebate: '返现',
  trade: '交易结算',
  profit: '投资收益',
  fee: '交易费用',
  // ---- 投资进出（赠金 ⇄ 练习金）----
  // invest_out 是「补足到目标练习金」的判重依据：撤资不是亏损，不能重复补发。
  invest_in: '转入投资',
  invest_out: '撤出到钱包',
  // ---- 兜底 ----
  adjust: '账目调整'
};

var cache = {};
function q(sql) {
  if (!cache[sql]) cache[sql] = db.prepare(sql);
  return cache[sql];
}

function nowIso() {
  return new Date().toISOString();
}

function isInt(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
}

function normalizeDirection(d) {
  if (d === 1 || d === '1' || d === '+1') return 1;
  if (d === -1 || d === '-1') return -1;
  return 0;
}

// ---------- 账户 ----------

// 系统单例账户：owner_id 用空串（不是 NULL），这样 UNIQUE(kind, owner_id) 能保证唯一
var SYSTEM_KINDS = { platform: 1, escrow: 1, clearing: 1 };

function createAccount(kind, ownerId) {
  var now = nowIso();
  var allowNegative = kind === 'clearing' ? 1 : 0;
  q([
    'INSERT INTO xy_ledger_accounts (kind, owner_id, allow_negative, status, created_at)',
    'VALUES (?, ?, ?, \'active\', ?)'
  ].join(' ')).run(kind, String(ownerId == null ? '' : ownerId), allowNegative, now);
  return q('SELECT * FROM xy_ledger_accounts WHERE kind = ? AND owner_id = ?')
    .get(kind, String(ownerId == null ? '' : ownerId));
}

function findAccount(kind, ownerId) {
  return q('SELECT * FROM xy_ledger_accounts WHERE kind = ? AND owner_id = ?')
    .get(kind, String(ownerId == null ? '' : ownerId)) || null;
}

// 解析账户。系统账户与 seller 可自动创建；user 必须显式开户，防止拼错学号凭空造账户。
function accountOf(kind, ownerId) {
  var k = String(kind || '');
  if (!k) throw new Error('必须提供账户 kind');
  var owner = String(ownerId == null ? '' : ownerId);
  var acc = findAccount(k, owner);
  if (acc) return acc;
  if (SYSTEM_KINDS[k]) return createAccount(k, owner);
  if (k === 'seller') {
    if (!owner) throw new Error('seller 账户必须提供 owner');
    return createAccount(k, owner);
  }
  if (k === 'user') throw new Error('账户不存在，请先开户: ' + owner);
  throw new Error('未知账户类型: ' + k);
}

function openUser(ownerId) {
  var owner = String(ownerId == null ? '' : ownerId).trim();
  if (!owner) throw new Error('开户必须提供用户标识');
  var acc = findAccount('user', owner);
  if (acc) return acc;
  return createAccount('user', owner);
}

// 系统账户支持 slot：订单托管与红包托管必须分开，
// 否则 I4（托管余额 vs 未结 hold）永远对不平。
function systemAccount(kind, slot) {
  if (!SYSTEM_KINDS[kind]) throw new Error('不是系统账户类型: ' + kind);
  return accountOf(kind, slot == null ? '' : String(slot));
}

// ---------- 幂等 ----------
function findTxByRef(ref) {
  return q('SELECT * FROM xy_ledger_transactions WHERE ref = ?').get(String(ref)) || null;
}

// ---------- 余额读取 ----------
function balanceOf(accountId, asset) {
  var row = q('SELECT balance FROM xy_ledger_balances WHERE account_id = ? AND asset = ?')
    .get(accountId, String(asset).toUpperCase());
  return row ? row.balance : 0;
}

function userBalance(ownerId, asset) {
  var acc = findAccount('user', ownerId);
  if (!acc) return 0;
  return balanceOf(acc.id, asset);
}

function userBalances(ownerId) {
  var acc = findAccount('user', ownerId);
  var out = { CASH: 0, GRANT: 0, PRACTICE: 0 };
  if (!acc) return out;
  var rows = q('SELECT asset, balance FROM xy_ledger_balances WHERE account_id = ?').all(acc.id);
  rows.forEach(function (r) { out[r.asset] = r.balance; });
  return out;
}

// ---------- 唯一写入口 ----------
// opts = { ref, kind, initiator, memo, payload,
//          entries: [{ account_id } | { kind, owner } | { account: {kind, owner} },
//                    asset, direction: +1|-1, amount_cent] }
function post(opts) {
  var o = opts || {};
  var ref = String(o.ref == null ? '' : o.ref).trim();
  if (!ref) throw new Error('必须提供 ref（幂等键）');
  var kind = String(o.kind || '');
  if (!kind) throw new Error('必须提供 kind');
  if (!KINDS[kind]) throw new Error('未知的业务类型: ' + kind);

  var raw = Array.isArray(o.entries) ? o.entries : [];
  if (raw.length < 2) throw new Error('一笔交易至少需要两条分录（复式记账）');

  var early = findTxByRef(ref);
  if (early) return { tx_id: early.id, duplicate: true, lines: 0 };

  var norm = [];
  var byAsset = {};
  var total = 0;

  for (var i = 0; i < raw.length; i++) {
    var e = raw[i] || {};
    var cfg = assets.get(e.asset);
    if (!cfg) throw new Error('未知资产: ' + e.asset + '（分录 #' + (i + 1) + '）');

    var dir = normalizeDirection(e.direction);
    if (!dir) throw new Error('direction 只接受 +1 或 -1（分录 #' + (i + 1) + '）');

    var amt = e.amount_cent !== undefined ? e.amount_cent : e.amountCent;
    if (!isInt(amt) || amt <= 0) throw new Error('分录金额必须是正整数分（分录 #' + (i + 1) + '）');

    var acc;
    if (e.account_id) {
      acc = q('SELECT * FROM xy_ledger_accounts WHERE id = ?').get(e.account_id);
      if (!acc) throw new Error('账户不存在: ' + e.account_id);
    } else if (e.account) {
      acc = accountOf(e.account.kind, e.account.owner);
    } else {
      acc = accountOf(e.kind, e.owner);
    }

    norm.push({ account_id: acc.id, asset: cfg.asset, direction: dir, amount_cent: amt });
    byAsset[cfg.asset] = (byAsset[cfg.asset] || 0) + dir * amt;
    if (dir > 0) total += amt;
  }

  var names = Object.keys(byAsset);
  for (var m = 0; m < names.length; m++) {
    if (byAsset[names[m]] !== 0) {
      throw new Error('资产 ' + names[m] + ' 分录不守恒（差 ' + byAsset[names[m]] + ' 分），拒绝记账');
    }
  }
  if (total > MAX_TX_CENT) throw new Error('单笔金额超过上限');

  var at = o.at ? String(o.at) : nowIso();

  var run = db.transaction(function () {
    // 并发/重入二次幂等：唯一索引之外再挡一次，避免唯一冲突抛到调用方
    var again = findTxByRef(ref);
    if (again) return { tx_id: again.id, duplicate: true, lines: 0 };

    var txId = Number(q([
      'INSERT INTO xy_ledger_transactions (ref, kind, status, initiator, memo, payload, amount_cent, created_at)',
      'VALUES (?, ?, \'posted\', ?, ?, ?, ?, ?)'
    ].join(' ')).run(
      ref, kind,
      o.initiator == null ? null : String(o.initiator),
      o.memo == null ? '' : String(o.memo),
      o.payload == null ? null : JSON.stringify(o.payload),
      total, at
    ).lastInsertRowid);

    var deltas = {};
    for (var n = 0; n < norm.length; n++) {
      var line = norm[n];
      q([
        'INSERT INTO xy_ledger_entries (tx_id, line_no, account_id, asset, direction, amount_cent, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ].join(' ')).run(txId, n + 1, line.account_id, line.asset, line.direction, line.amount_cent, at);

      var key = line.account_id + '|' + line.asset;
      deltas[key] = (deltas[key] || 0) + line.direction * line.amount_cent;
    }

    var keys = Object.keys(deltas);
    for (var k = 0; k < keys.length; k++) {
      var parts = keys[k].split('|');
      var accId = Number(parts[0]);
      var asset = parts[1];
      var delta = deltas[keys[k]];
      if (delta === 0) continue; // 同账户同资产对冲，不必落库

      var meta = q('SELECT * FROM xy_ledger_accounts WHERE id = ?').get(accId);
      if (!meta) throw new Error('账户不存在: ' + accId);
      if (meta.status !== 'active') throw new Error('账户不可用（' + meta.status + '）: ' + accId);

      var cur = balanceOf(accId, asset);
      var next = cur + delta;
      if (next < 0 && meta.allow_negative !== 1) {
        throw new Error('余额不足（账户 ' + accId + ' ' + meta.kind + '/' + (meta.owner_id || '-') +
          ' 资产 ' + asset + '：当前 ' + cur + ' 分，需支出 ' + (-delta) + ' 分）');
      }

      var exists = q('SELECT 1 AS x FROM xy_ledger_balances WHERE account_id = ? AND asset = ?').get(accId, asset);
      if (exists) {
        q('UPDATE xy_ledger_balances SET balance = ? WHERE account_id = ? AND asset = ?').run(next, accId, asset);
      } else {
        q('INSERT INTO xy_ledger_balances (account_id, asset, balance) VALUES (?, ?, ?)').run(accId, asset, next);
      }
    }

    return { tx_id: txId, duplicate: false, lines: norm.length };
  });

  return run();
}

function getTx(txId) {
  var tx = q('SELECT * FROM xy_ledger_transactions WHERE id = ?').get(txId);
  if (!tx) return null;
  tx.entries = q([
    'SELECT e.*, a.kind AS account_kind, a.owner_id',
    'FROM xy_ledger_entries e JOIN xy_ledger_accounts a ON a.id = e.account_id',
    'WHERE e.tx_id = ? ORDER BY e.line_no'
  ].join(' ')).all(txId);
  return tx;
}

module.exports = {
  KINDS: KINDS,
  MAX_TX_CENT: MAX_TX_CENT,
  openUser: openUser,
  accountOf: accountOf,
  findAccount: findAccount,
  systemAccount: systemAccount,
  findTxByRef: findTxByRef,
  getTx: getTx,
  balanceOf: balanceOf,
  userBalance: userBalance,
  userBalances: userBalances,
  post: post
};
