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
// v2 加固（2026-11-11）：在不改变任何资金语义的前提下，post() 外面加了四层保证：
//   ① 同 ref 异 payload 拒绝（原来会静默返回 duplicate，是最难查的一类错账）
//   ② 事务内二次守恒 + 余额 version 乐观锁（绕过 post 写余额会留下断层）
//   ③ 事务内追加分录哈希链 seal 与累计发行计数器（O(1) 供给硬闸）
//   ④ 任何被拒的写入都留结构化凭证
// 详见 docs/ledger-hardening-v2.md。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var db = require('../utils/db');
var assets = require('./assets');
var errors = require('./errors');
var idempotency = require('./idempotency');
var proof = require('./proof');
var supply = require('./supply');

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
  // ---- 学元贷款（只借 GRANT）----
  // loan_out 是放款、loan_repay 是还本息；利息随本金一起回 clearing 注销，
  // 平台不留 GRANT 余额（赠金对平台没有购买力，留着只会变成一笔无意义的额度）。
  loan_out: '学元贷款放款',
  loan_repay: '学元贷款还款',
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
//
// ⚠️ 所有 message 保持原中文文案：15 个回归脚本用中文正则断言错误信息，
//    code 只是新增维度，不替换文案。

// 失败凭证。事务内写的行会随回滚消失，所以事务外由 post 再补一份；
// 留痕本身出错绝不能掩盖原始业务错误。
function recordAttempt(ref, requestHash, err, actor) {
  try {
    var has = q("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_ledger_post_attempts'").get();
    if (!has) return;
    q([
      'INSERT INTO xy_ledger_post_attempts (ref, request_hash, error_code, message, actor, created_at)',
      'VALUES (?, ?, ?, ?, ?, ?)'
    ].join(' ')).run(
      String(ref == null ? '' : ref),
      requestHash == null ? null : String(requestHash),
      err && err.code ? String(err.code) : 'UNEXPECTED',
      err && err.message ? String(err.message) : '未知错误',
      actor == null ? null : String(actor),
      nowIso()
    );
  } catch (e) { /* 留痕失败不能掩盖原错误 */ }
}

function normalizeEntries(o, reject) {
  var raw = Array.isArray(o.entries) ? o.entries : [];
  if (raw.length < 2) throw reject('TOO_FEW_ENTRIES', '一笔交易至少需要两条分录（复式记账）');

  var norm = [];
  var byAsset = {};
  var total = 0;

  for (var i = 0; i < raw.length; i++) {
    var e = raw[i] || {};
    var cfg = assets.get(e.asset);
    if (!cfg) throw reject('UNKNOWN_ASSET', '未知资产: ' + e.asset + '（分录 #' + (i + 1) + '）');

    var dir = normalizeDirection(e.direction);
    if (!dir) throw reject('BAD_DIRECTION', 'direction 只接受 +1 或 -1（分录 #' + (i + 1) + '）');

    var amt = e.amount_cent !== undefined ? e.amount_cent : e.amountCent;
    if (!isInt(amt) || amt <= 0) throw reject('BAD_AMOUNT', '分录金额必须是正整数分（分录 #' + (i + 1) + '）');

    var acc;
    try {
      if (e.account_id) {
        acc = q('SELECT * FROM xy_ledger_accounts WHERE id = ?').get(e.account_id);
        if (!acc) throw new Error('账户不存在: ' + e.account_id);
      } else if (e.account) {
        acc = accountOf(e.account.kind, e.account.owner);
      } else {
        acc = accountOf(e.kind, e.owner);
      }
    } catch (err) {
      var le = errors.normalize(err);
      throw reject(le.code, le.message);
    }

    norm.push({ account_id: acc.id, asset: cfg.asset, direction: dir, amount_cent: amt });
    byAsset[cfg.asset] = (byAsset[cfg.asset] || 0) + dir * amt;
    if (dir > 0) total += amt;
  }
  return { norm: norm, byAsset: byAsset, total: total };
}

function assertConserved(parsed, reject) {
  var names = Object.keys(parsed.byAsset);
  for (var m = 0; m < names.length; m++) {
    if (parsed.byAsset[names[m]] !== 0) {
      throw reject('UNBALANCED', '资产 ' + names[m] + ' 分录不守恒（差 ' +
        parsed.byAsset[names[m]] + ' 分），拒绝记账');
    }
  }
  if (parsed.total > MAX_TX_CENT) throw reject('TX_TOO_LARGE', '单笔金额超过上限');
}

function post(opts) {
  var o = opts || {};
  var ref = String(o.ref == null ? '' : o.ref).trim();
  var actor = o.initiator == null ? null : String(o.initiator);
  var reqHash = null;

  function reject(code, message, extra) {
    var e = errors.of(code, message, extra);
    recordAttempt(ref, reqHash, e, actor);
    return e;
  }

  if (!ref) throw reject('MISSING_REF', '必须提供 ref（幂等键）');
  var kind = String(o.kind || '');
  if (!kind) throw reject('MISSING_KIND', '必须提供 kind');
  if (!KINDS[kind]) throw reject('UNKNOWN_KIND', '未知的业务类型: ' + kind);

  var raw = Array.isArray(o.entries) ? o.entries : [];
  if (raw.length < 2) throw reject('TOO_FEW_ENTRIES', '一笔交易至少需要两条分录（复式记账）');

  var early = findTxByRef(ref);
  // legacy 快速路径：迁移 046 之前存在的交易没有 request_hash，保持原行为、零副作用。
  // 历史重放不该因为载荷写法变化而被误判成冲突。
  if (early && early.request_hash == null) {
    return { tx_id: early.id, duplicate: true, lines: 0 };
  }

  var parsed = normalizeEntries(o, reject);
  assertConserved(parsed, reject);
  reqHash = idempotency.fingerprint(ref, kind, o, parsed.norm);

  if (early) {
    if (early.request_hash !== reqHash) {
      throw reject('IDEMPOTENCY_CONFLICT',
        '幂等键 ' + ref + ' 已用于另一笔不同内容的交易，请换一个 ref',
        { existing: early.request_hash, got: reqHash, tx_id: early.id });
    }
    return { tx_id: early.id, duplicate: true, lines: 0 };
  }

  // genesis 与供给计数器必须在事务外、本笔 INSERT 之前初始化：
  // 若在同一事务内，MAX(tx.id) 会把本笔也算进历史段，导致它永远不上链。
  proof.ensureGenesis();
  supply.ensure();

  var at = o.at ? String(o.at) : nowIso();
  var norm = parsed.norm;

  var run = db.transaction(function () {
    // 并发/重入二次幂等：唯一索引之外再挡一次，避免唯一冲突抛到调用方
    var again = findTxByRef(ref);
    if (again) {
      if (again.request_hash == null) return { tx_id: again.id, duplicate: true, lines: 0 };
      if (again.request_hash !== reqHash) {
        throw reject('IDEMPOTENCY_CONFLICT',
          '幂等键 ' + ref + ' 已用于另一笔不同内容的交易，请换一个 ref');
      }
      return { tx_id: again.id, duplicate: true, lines: 0 };
    }

    // 事务内二次守恒：校验与写入之间的窗口不再留下任何可乘之机
    assertConserved(parsed, reject);

    var txId = Number(q([
      'INSERT INTO xy_ledger_transactions',
      '  (ref, kind, status, initiator, memo, payload, amount_cent, request_hash, created_at)',
      'VALUES (?, ?, \'posted\', ?, ?, ?, ?, ?, ?)'
    ].join(' ')).run(
      ref, kind,
      o.initiator == null ? null : String(o.initiator),
      o.memo == null ? '' : String(o.memo),
      o.payload == null ? null : JSON.stringify(o.payload),
      parsed.total, reqHash, at
    ).lastInsertRowid);

    var deltas = {};
    var lines = [];
    for (var n = 0; n < norm.length; n++) {
      var line = norm[n];
      var lineNo = n + 1;
      q([
        'INSERT INTO xy_ledger_entries (tx_id, line_no, account_id, asset, direction, amount_cent, created_at)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ].join(' ')).run(txId, lineNo, line.account_id, line.asset, line.direction, line.amount_cent, at);

      lines.push({
        line_no: lineNo, account_id: line.account_id, asset: line.asset,
        direction: line.direction, amount_cent: line.amount_cent
      });

      var key = line.account_id + '|' + line.asset;
      deltas[key] = (deltas[key] || 0) + line.direction * line.amount_cent;
    }

    var keys = Object.keys(deltas);
    for (var k = 0; k < keys.length; k++) {
      var parts = keys[k].split('|');
      var accId = Number(parts[0]);
      var asset = parts[1];
      var delta = deltas[keys[k]];

      var meta = q('SELECT * FROM xy_ledger_accounts WHERE id = ?').get(accId);
      if (!meta) throw reject('ACCOUNT_MISSING', '账户不存在: ' + accId);
      if (meta.status !== 'active') throw reject('ACCOUNT_INACTIVE', '账户不可用（' + meta.status + '）: ' + accId);

      var cur = q('SELECT balance, version FROM xy_ledger_balances WHERE account_id = ? AND asset = ?')
        .get(accId, asset);
      var next = (cur ? Number(cur.balance) : 0) + delta;
      if (next < 0 && meta.allow_negative !== 1) {
        throw reject('INSUFFICIENT_BALANCE',
          '余额不足（账户 ' + accId + ' ' + meta.kind + '/' + (meta.owner_id || '-') +
          ' 资产 ' + asset + '：当前 ' + (cur ? cur.balance : 0) + ' 分，需支出 ' +
          (-delta) + ' 分）');
      }

      if (delta === 0) {
        // 同账户同资产对冲：余额不变，但仍要推进一次版本，
        // 否则日终对账会把「有分录却 version=0」误判成绕过 post 写入。
        if (cur) {
          q('UPDATE xy_ledger_balances SET version = version + 1 WHERE account_id = ? AND asset = ? AND version = ?')
            .run(accId, asset, Number(cur.version));
        }
        continue;
      }

      if (cur) {
        var upd = q([
          'UPDATE xy_ledger_balances SET balance = ?, version = version + 1',
          'WHERE account_id = ? AND asset = ? AND version = ?'
        ].join(' ')).run(next, accId, asset, Number(cur.version));
        if (!upd.changes) {
          throw reject('VERSION_CONFLICT',
            '余额版本冲突（账户 ' + accId + ' ' + asset + '），请重试');
        }
      } else {
        q('INSERT INTO xy_ledger_balances (account_id, asset, balance, version) VALUES (?, ?, ?, 1)')
          .run(accId, asset, next);
      }
    }

    // 累计发行硬闸：只统计 clearing 的发行方向分录，O(1) 计数器 + cap 校验
    var clearingIds = {};
    q("SELECT id FROM xy_ledger_accounts WHERE kind = 'clearing'").all().forEach(function (r) {
      clearingIds[r.id] = true;
    });
    var issueByAsset = {};
    norm.forEach(function (line) {
      if (clearingIds[line.account_id] && line.direction === -1) {
        issueByAsset[line.asset] = (issueByAsset[line.asset] || 0) + line.amount_cent;
      }
    });
    supply.apply(db, issueByAsset);

    // 分录哈希链：整笔交易（头 + 全部分录）接在链尾，与余额写入同一事务
    var tx = q('SELECT * FROM xy_ledger_transactions WHERE id = ?').get(txId);
    proof.seal(db, tx, lines, actor);

    return { tx_id: txId, duplicate: false, lines: norm.length };
  });

  // BEGIN IMMEDIATE：多进程下提前拿写锁，避免事务半途 SQLITE_BUSY。
  // 嵌套在 orders.db.transaction() 内时 better-sqlite3 自动退化为 SAVEPOINT。
  try {
    return run.immediate();
  } catch (e) {
    var le = errors.normalize(e);
    // 事务内写的凭证已随回滚消失，在事务外补一份（外层若也回滚，由路由 wrap 再补）
    recordAttempt(ref, reqHash, le, actor);
    throw le;
  }
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
  post: post,
  errors: errors,
  recordAttempt: recordAttempt,
  fingerprint: idempotency.fingerprint
};
