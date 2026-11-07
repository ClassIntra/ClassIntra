// 学元（XueYuan）—— 平台统一虚拟货币服务
// ============================================================
// ⚠️ 2026-11-07：本文件已从「自带一套账本」改为**学元账本的门面**。
//
// ---- 这次改了什么 ----
// 以前这里直接读写 xy_account / xy_tx / xy_entry 三张表，自己实现复式记账、
// 冻结、配额、统计。现在资金全部委托给 src/ledger/*：
//
//   学元钱包 / 红包 / 收款 / 支付密码 / 证券
//          ↓（调用不变的 40 个函数）
//   services/xueyuan.js  ← 本文件，只做语义翻译与业务校验
//          ↓
//   src/ledger/ledger.js  post() 唯一写入口，按资产分组守恒
//
// 保留本文件、而不是让所有调用方直接 require ledger/*，原因是：
// 1. 对外语义是「学元」，入参出参都是 (user_id, delta, pool) 这套旧形状，
//    前端与第三方应用已经按它写好了；换掉等于全站改接口。
// 2. 配额（单笔/每日/学期）、账户状态、提示文案这些**业务规则**留在这里，
//    账本只管「钱不能凭空多、不能透支」。两者职责不同。
// 3. 旧表 xy_recharge / xy_withdraw 是业务凭证（谁在什么时候交了现金、
//    哪张提现单被谁批的），不是账本，继续留在原处。
//
// ---- 三条硬规则（改代码前先看）----
// 1. **钱只有一种**：CASH 1 学元分 = 1 人民币分，锚定永不改变。
//    GRANT / PRACTICE 是权益额度，不是钱，永不兑付。
// 2. **每笔业务都要有 ref**。没有稳定 ref 的写账等于放弃幂等，重试就重复扣款。
// 3. **冻结不再是 balance 上的一个数**。新账本用托管账户表达冻结：
//    hold = 用户 → escrow:hold:<学号>，release = 反向。
//    所以 getAccount().cash_balance 报的是**可用**余额（已扣掉冻结）。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var db = require('../utils/db');
var config = require('../config');
var ledger = require('../ledger/ledger');
var invariants = require('../ledger/invariants');
var cashbook = require('../ledger/cashbook');
var rechargeTpl = require('../ledger/templates/recharge');
var invest = require('../ledger/invest');
var units = require('../ledger/units');

// ---------- 常量 ----------
// 单位换算一律走 ledger/units.js，绝不在本文件里再写 /100、*1000。
// 两套口径的倍差及未决事项见 units.js 顶部说明。
var CENT_PER_YUAN = units.UNITS_PER_XUEYUAN;

var POOL = {
  CASH: 'cash',
  GRANT: 'grant',
  // 练习金：证券沙盘专用。只能在证券里买卖，不能转账、发红包、买货、提现。
  PRACTICE: 'practice',
  SYSTEM: 'system'
};

// 旧池名 → 新资产名。这是本文件里唯一一处「名字对照」，
// 其余地方一律用 ASSET_OF / assetOf()，不要再散落 if。
var ASSET_OF = { cash: 'CASH', grant: 'GRANT', practice: 'PRACTICE' };

// 学元与现实货币比率：1 元 = 1000 学元（默认）。
// ⚠️ 有过充值之后它就是负债的计量单位：改 2000 学生认为你违约，改 500 你凭空多欠一倍。
//    所以 yuanRate() 只读，不允许任何地方写。
var YUAN_RATE = units.XUEYUAN_PER_YUAN;

var WELCOME_CENT = yuanToCent(cfgNum('welcomeYuan', 10));
var DAILY_CENT = yuanToCent(cfgNum('dailyYuan', 0.2));
var DAILY_BONUS_CENT = yuanToCent(cfgNum('dailyBonusYuan', 0.4));
var DAILY_BONUS_FROM_DAY = Math.max(1, Math.round(cfgNum('dailyBonusFromDay', 7)));
var MAX_TRANSFER_CENT = yuanToCent(500);
var MAX_TX_CENT = yuanToCent(10000);
var MAX_BALANCE_CENT = yuanToCent(10000);
var MAX_RECHARGE_CENT = yuanToCent(cfgNum('maxRechargeYuan', 200));
var RECHARGE_QUOTA_CENT = yuanToCent(cfgNum('rechargeQuotaYuan', 300));
var MAX_GRANT_CENT = yuanToCent(cfgNum('maxGrantYuan', 0.5));
var GRANT_DAILY_CAP_CENT = yuanToCent(cfgNum('grantDailyCapYuan', 2));
var MAX_WITHDRAW_CENT = yuanToCent(1000);
var MIN_WITHDRAW_CENT = yuanToCent(1);

var SYSTEM_MINT = '@system:mint';
var SYSTEM_FEE = '@system:fee';
var SYSTEM_SETTLE = '@system:settle';

// 业务类型清单以账本白名单为准，这里只做一次映射到中文标签，
// 避免出现「账本能记、这里不认」的两套枚举。
var KINDS = ledger.KINDS;

var USER_ID_RE = /^[A-Za-z0-9_.@:-]{1,64}$/;

// ---------- 工具 ----------

function now() { return Date.now(); }

function cfgNum(key, fallback) {
  var v = config && config.xueyuan ? Number(config.xueyuan[key]) : NaN;
  return isFinite(v) ? v : fallback;
}

// 中国时区某一天的 00:00
function dayStartMs(ts) {
  var t = ts || now();
  var d = new Date(t + 8 * 3600 * 1000);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - 8 * 3600 * 1000;
}

// 学期区间：9/1–次年 1/31 为秋季（S1），2/1–8/31 为春季（S2）
function semesterRange(ts) {
  var t = ts || now();
  var d = new Date(t + 8 * 3600 * 1000);
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth() + 1;
  var startYear;
  var key;
  if (m >= 9) {
    startYear = y; key = y + '-S1';
  } else if (m === 1) {
    startYear = y - 1; key = (y - 1) + '-S1';
  } else {
    startYear = y; key = y + '-S2';
  }
  var startUtc = (m >= 9 || m === 1)
    ? Date.UTC(startYear, 8, 1)
    : Date.UTC(startYear, 1, 1);
  return { key: key, startMs: startUtc - 8 * 3600 * 1000 };
}

// 学元 → 账本单位。接受数字或字符串；非法返回 null。
function toCent(yuan) {
  return units.xueyuanToUnits(yuan);
}

function fromCent(cent) {
  return units.unitsToXueyuan(cent);
}

// 业务入参金额解析（唯一入口）。
// 三个来源按优先级取一个，避免「路由传 amount、服务读 yuan」这类静默 NaN：
//   amountCent  已换算好的账本单位（内部调用 / 已校验的路由）
//   amount      学元，前端绝大多数金额输入框的单位
//   yuan        人民币元，只有班管充值/退款才用它
// 三者都没给返回 null，由调用方决定报什么错。
function parseAmountCent(o, rate) {
  var opt = o || {};
  if (typeof opt.amountCent === 'number') return Math.round(opt.amountCent);
  if (opt.amount !== undefined && opt.amount !== null && opt.amount !== '') {
    return toCent(opt.amount);
  }
  if (opt.yuan !== undefined && opt.yuan !== null && opt.yuan !== '') {
    return yuanToCent(opt.yuan, rate);
  }
  return null;
}

// 校验 + 解析一步到位：非法金额必须给出「用户能看懂」的提示，
// 而不是「必须是正整数分」这种把内部单位漏给学生的黑话。
function requireAmountCent(o, label, rate) {
  var tag = label || '金额';
  var cent = parseAmountCent(o, rate);
  if (cent === null || !isFinite(cent) || cent <= 0 || Math.floor(cent) !== cent) {
    throw new Error(tag + '不合法：请填写大于 0 的学元数额（最多两位小数）');
  }
  return cent;
}

function isValidUserId(userId) {
  return USER_ID_RE.test(String(userId || ''));
}

function isSystem(userId) {
  return String(userId || '').charAt(0) === '@';
}

// 中国时区的 YYYY-MM-DD
function todayKey(ts) {
  var d = new Date((ts || now()) + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' +
    ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' +
    ('0' + d.getUTCDate()).slice(-2);
}

function isValidKind(kind) {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KINDS, kind);
}

// 账本时间戳是 ISO 字符串，对外一律回到毫秒数 —— 旧前端按数字做格式化，
// 这里换格式等于让所有「几天前」都显示成 NaN。
function msOf(iso) {
  var t = Date.parse(iso);
  return isFinite(t) ? t : 0;
}

function isoOf(ms) {
  if (ms == null) return new Date().toISOString();
  var n = Number(ms);
  return isFinite(n) ? new Date(n).toISOString() : String(ms);
}

function genRef(prefix) {
  return 'auto:' + prefix + ':' + now().toString(36) + ':' + Math.random().toString(36).slice(2, 8);
}

function ensureSchema() {
  // 表由 migrations/036 创建。这里只做「是否就绪」的兜底，
  // 让服务在迁移没跑到的极端情况下报清晰错误，而不是 undefined。
  var row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='xy_ledger_accounts'"
  ).get();
  if (!row) {
    throw new Error('学元账本尚未初始化（缺少 xy_ledger_accounts 表）。请先执行 node scripts/ledger-init.cjs 或重启服务跑迁移');
  }
}

function yuanRate() {
  var raw = (config && config.xueyuan && config.xueyuan.yuanRate) || process.env.XUEYUAN_YUAN_RATE || YUAN_RATE;
  var n = Number(raw);
  if (!isFinite(n) || n <= 0) n = YUAN_RATE;
  return n;
}

function yuanToCent(yuan, rate) {
  return units.yuanToWalletUnits(yuan, rate || yuanRate());
}

function centToYuan(cent, rate) {
  return units.walletUnitsToYuan(cent, rate || yuanRate());
}

function normalizePool(pool, delta, userId) {
  if (isSystem(userId)) return POOL.SYSTEM;
  var p = String(pool || '');
  if (p === POOL.CASH || p === POOL.GRANT || p === POOL.PRACTICE) return p;
  // 未声明：入账默认赠送池；出账也默认赠送池（旧调用行为）
  // 刻意不让 practice 成为默认值，否则任何一处漏传 pool 的旧代码都会悄悄发进证券账户。
  if (!p) return POOL.GRANT;
  throw new Error('未知的资金池: ' + p);
}

function poolLabel(pool) {
  if (pool === POOL.CASH) return '充值学元';
  if (pool === POOL.GRANT) return '赠送学元';
  if (pool === POOL.PRACTICE) return '练习金';
  return '系统';
}

function assetOf(pool) {
  var a = ASSET_OF[String(pool || '')];
  if (!a) throw new Error('未知的资金池: ' + pool);
  return a;
}

// ---------- 系统账户 ----------
// 旧代码把 @system:* 当成「不分池的系统户」，余额直接存在 xy_account 上。
// 新账本里没有这种「万能户」，得按语义拆开：
//   @system:mint   → clearing（发行对手方，负值=已发行净额，允许为负）
//   @system:settle → escrow/system:settle（成交额沉淀，只会变多）
//   @system:fee    → escrow/system:fee（手续费沉淀）
//   @app:x:escrow  → escrow/app:x:escrow（第三方应用托管）
// 拆开的理由：面板要看「手续费沉淀多少」「投资盘有没有超支」，
// 全塞进 clearing 就只剩一个净额，什么问题都看不出来。
function resolveSystem(uid) {
  var id = String(uid);
  if (id === SYSTEM_MINT) return { kind: 'clearing', owner: '' };
  if (/^@system:/.test(id)) return { kind: 'escrow', owner: 'system:' + id.slice(8) };
  if (/^@app:/.test(id)) return { kind: 'escrow', owner: 'app:' + id.slice(5) };
  return { kind: 'escrow', owner: 'sys:' + id.slice(1) };
}

function systemBalances(uid) {
  var t = resolveSystem(uid);
  var acc = ledger.systemAccount(t.kind, t.owner);
  return {
    account: acc,
    CASH: ledger.balanceOf(acc.id, 'CASH'),
    GRANT: ledger.balanceOf(acc.id, 'GRANT'),
    PRACTICE: ledger.balanceOf(acc.id, 'PRACTICE')
  };
}

// ---------- 托管账户（冻结） ----------
// 冻结不写在用户的 balance 上，而是一笔真实的分录：用户 → escrow。
// 好处是冻结点不需要「余额减去 frozen」这种两处口径，也不会有 034 那种
// 「加了列忘了迁移冻结额」的问题 —— 托管账户余额本身就是冻结额。

function holdEscrow(userId) {
  return ledger.systemAccount('escrow', 'hold:' + String(userId));
}

function tradingEscrow(userId) {
  return ledger.findAccount('escrow', 'trading:' + String(userId));
}

function frozenOf(userId) {
  var uid = String(userId);
  var out = { cash: 0, grant: 0, practice: 0 };
  [holdEscrow(uid), tradingEscrow(uid)].forEach(function (acc) {
    if (!acc) return;
    out.cash += ledger.balanceOf(acc.id, 'CASH');
    out.grant += ledger.balanceOf(acc.id, 'GRANT');
    out.practice += ledger.balanceOf(acc.id, 'PRACTICE');
  });
  return out;
}

// ---------- 账户 ----------

function createIfMissing(userId) {
  var id = String(userId);
  if (isSystem(id)) {
    // 系统账户由账本按需创建；旧代码里的 @system:* 统一落到 clearing / escrow
    ledger.systemAccount('clearing');
    return;
  }
  ledger.openUser(id);
}

function getAccount(userId) {
  ensureSchema();
  var id = String(userId || '');
  if (!isValidUserId(id)) throw new Error('用户标识非法');

  if (isSystem(id)) {
    // 系统账户：clearing 的负值就是「已发行净额」
    var sb = systemBalances(id);
    var st = sb.CASH + sb.GRANT + sb.PRACTICE;
    return {
      user_id: id, exists: true, balance: st, frozen: 0, available: st,
      cash_balance: sb.CASH, grant_balance: sb.GRANT, practice_balance: sb.PRACTICE,
      frozen_cash: 0, frozen_grant: 0, frozen_practice: 0,
      available_cash: sb.CASH, available_grant: sb.GRANT, available_practice: sb.PRACTICE,
      withdrawable: 0, status: 'system', opened_at: 0
    };
  }

  var acc = ledger.findAccount('user', id);
  if (!acc) {
    return {
      user_id: id, exists: false, balance: 0, frozen: 0, available: 0,
      cash_balance: 0, grant_balance: 0, practice_balance: 0,
      frozen_cash: 0, frozen_grant: 0, frozen_practice: 0,
      available_cash: 0, available_grant: 0, available_practice: 0,
      withdrawable: 0, status: 'none', opened_at: 0
    };
  }

  var b = ledger.userBalances(id);   // 账户上的钱（已扣掉托管）
  var f = frozenOf(id);              // 托管:hold:<学号> + 托管:trading:<学号>

  // 对外口径必须和旧账本一致：*_balance 是「总额（含冻结）」，available_* 是「能动的」。
  // 否则「发红包后余额显示变少」会被当成扣钱，前端所有「余额 / 可用」两行都会错位。
  var cashTotal = b.CASH + f.cash;
  var grantTotal = b.GRANT + f.grant;
  var practiceTotal = b.PRACTICE + f.practice;
  return {
    user_id: id,
    exists: true,
    balance: cashTotal + grantTotal,
    frozen: f.cash + f.grant,
    available: b.CASH + b.GRANT,
    cash_balance: cashTotal,
    grant_balance: grantTotal,
    practice_balance: practiceTotal,
    frozen_cash: f.cash,
    frozen_grant: f.grant,
    frozen_practice: f.practice,
    available_cash: b.CASH,
    available_grant: b.GRANT,
    available_practice: b.PRACTICE,
    withdrawable: 0,
    status: acc.status,
    opened_at: msOf(acc.created_at)
  };
}

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
    cash_cent: a.cash_balance,
    cash: fromCent(a.cash_balance),
    available_cash_cent: a.available_cash,
    available_cash: fromCent(a.available_cash),
    frozen_cash_cent: a.frozen_cash,
    frozen_cash: fromCent(a.frozen_cash),
    grant_cent: a.grant_balance,
    grant: fromCent(a.grant_balance),
    available_grant_cent: a.available_grant,
    available_grant: fromCent(a.available_grant),
    frozen_grant_cent: a.frozen_grant,
    frozen_grant: fromCent(a.frozen_grant),
    practice_cent: a.practice_balance,
    practice: fromCent(a.practice_balance),
    available_practice_cent: a.available_practice,
    available_practice: fromCent(a.available_practice),
    frozen_practice_cent: a.frozen_practice,
    frozen_practice: fromCent(a.frozen_practice),
    withdrawable_cent: withdrawable,
    withdrawable: fromCent(withdrawable),
    yuan_rate: yuanRate(),
    status: a.status,
    opened_at: a.opened_at
  };
}

// 开户 + 一次性赠金。
// ⚠️ 只对「本次真正新建的账户」发 welcome。
// 期初导入已经把老账户建好了，如果按 ref 判断，那些账户会因为新库里没有
// welcome:<uid> 而**再领一次** 10 元 —— 那等于凭空多发一轮。
function ensureAccount(userId) {
  ensureSchema();
  var id = String(userId || '');
  if (!isValidUserId(id)) throw new Error('用户标识非法');
  if (isSystem(id)) throw new Error('系统账户不可开户');

  var existed = !!ledger.findAccount('user', id);
  createIfMissing(id);

  var granted = false;
  if (!existed && WELCOME_CENT > 0) {
    var r = mint({
      to: id,
      amountCent: WELCOME_CENT,
      kind: 'welcome',
      pool: POOL.GRANT,
      ref: 'welcome:' + id,
      memo: '学元账户开户赠金（赠送学元，可支付不可提现）'
    });
    granted = !r.duplicate;
  }

  return { created: !existed, welcome_granted: granted, account: viewAccount(id) };
}

function withdrawableCent(userId) {
  var a = getAccount(userId);
  if (!a.exists || isSystem(userId)) return 0;
  // 两道都留着，各自挡不同的洞：
  //   available_cash 挡「钱被提现单/红包冻着」
  //   netRecharge    挡「同学转进来的钱被直接提现」
  // 第二条不是重复校验：转进来的充值学元确实有真金背书，但那是**别人**交的钱，
  // 让收款方直接兑成现金，等于把学校变成无手续费提款机。
  var net = Math.max(0, netRechargeCent(userId));
  return Math.min(a.available_cash, net);
}

// 累计净充值（分）= 充值 - 提现 - 撤回充值。
// 从账本按分录聚合，不读 xy_recharge：那张表里留着归位前按错 rate 记的脏数据，
// 而账本里的 recharge/withdraw/recharge_revoke 是真实发生过的资金流。
function netRechargeCent(userId) {
  ensureSchema();
  var acc = ledger.findAccount('user', String(userId));
  if (!acc) return 0;
  var row = db.prepare([
    'SELECT COALESCE(SUM(e.direction * e.amount_cent), 0) AS s',
    'FROM xy_ledger_entries e',
    'JOIN xy_ledger_transactions t ON t.id = e.tx_id',
    "WHERE e.account_id = ? AND e.asset = 'CASH'",
    "  AND t.kind IN ('recharge', 'withdraw', 'recharge_revoke')"
  ].join('\n')).get(acc.id);
  return Number(row.s) || 0;
}

// ---------- 记账内核 ----------

// post：唯一写账入口。
// opts: { entries: [{user_id, delta, pool}], kind, ref, app, operator, memo, meta, at }
function post(opts) {
  ensureSchema();
  var o = opts || {};
  var kind = String(o.kind || '');

  if (!isValidKind(kind)) throw new Error('未知的业务类型: ' + kind);

  var raw = Array.isArray(o.entries) ? o.entries : [];
  if (raw.length < 2) throw new Error('一笔交易至少需要两条分录（复式记账）');

  var sum = 0;
  var touched = {};
  var lines = [];
  var userAssets = {};

  for (var i = 0; i < raw.length; i++) {
    var e = raw[i] || {};
    var uid = String(e.user_id || '');
    var delta = e.delta;
    if (!isValidUserId(uid)) throw new Error('分录中的用户标识非法: ' + uid);
    if (typeof delta !== 'number' || !isFinite(delta) || Math.floor(delta) !== delta) {
      throw new Error('分录金额必须是整数分');
    }
    if (delta === 0) throw new Error('分录金额不能为 0');

    var pool = normalizePool(e.pool, delta, uid);
    var sys = isSystem(uid);

    var key = uid + '|' + pool;
    if (touched[key]) throw new Error('同一交易中重复出现账户: ' + uid);
    touched[key] = true;

    sum += delta;
    lines.push({ uid: uid, delta: delta, pool: pool, sys: sys });
    if (!sys) userAssets[assetOf(pool)] = true;
  }

  if (sum !== 0) throw new Error('分录不平衡（SUM=' + sum + ' 分），拒绝记账');

  var assetsInvolved = Object.keys(userAssets);
  if (!assetsInvolved.length) throw new Error('交易里没有任何用户账户');

  var amount = 0;
  for (var k = 0; k < lines.length; k++) {
    if (lines[k].delta > 0) amount += lines[k].delta;
  }
  if (amount > MAX_TX_CENT) throw new Error('单笔金额超过上限');

  // 余额上限：只查入账方，出账方由账本的「不允许负余额」兜住
  for (var m = 0; m < lines.length; m++) {
    var ln = lines[m];
    if (ln.sys || ln.delta < 0) continue;
    var cur = getAccount(ln.uid);
    if (ln.pool === POOL.PRACTICE) continue;
    if (cur.exists && cur.balance + ln.delta > MAX_BALANCE_CENT) {
      throw new Error('账户余额超过上限');
    }
  }

  // 系统腿的资产：跟随同一笔里唯一的用户资产。
  // 旧代码用 pool='system' 表示「系统对手方」，它本身不带资产语义；
  // 强行给 CASH 会让 GRANT 的发行变成「CASH 减、GRANT 加」，被分组守恒直接拒掉。
  if (assetsInvolved.length > 1) {
    for (var s = 0; s < lines.length; s++) {
      if (lines[s].sys) throw new Error('系统账户不能与多个资产混记');
    }
  }
  var systemAsset = assetsInvolved[0];

  var entries = lines.map(function (ln) {
    return {
      account: ln.sys ? resolveSystem(ln.uid) : { kind: 'user', owner: ln.uid },
      asset: ln.sys ? systemAsset : assetOf(ln.pool),
      direction: ln.delta > 0 ? 1 : -1,
      amount_cent: Math.abs(ln.delta)
    };
  });

  var ref = o.ref ? String(o.ref) : genRef(kind);

  var r = ledger.post({
    ref: ref,
    kind: kind,
    initiator: o.operator ? String(o.operator) : (o.app ? String(o.app) : null),
    memo: o.memo ? String(o.memo) : '',
    payload: o.meta || null,
    at: o.at ? isoOf(o.at) : undefined,
    entries: entries
  });

  return {
    tx_id: r.tx_id,
    duplicate: !!r.duplicate,
    entries: r.duplicate ? [] : lines.map(function (ln) {
      return { user_id: ln.uid, delta: ln.delta, pool: ln.pool };
    }),
    amount: r.duplicate ? 0 : amount
  };
}

// 铸币：对手方固定为 clearing（负值即已发行净额）。
function mint(opts) {
  var o = opts || {};
  var to = String(o.to || '');
  var amountCent = o.amountCent;
  var pool = o.pool === POOL.CASH ? POOL.CASH
    : (o.pool === POOL.PRACTICE ? POOL.PRACTICE : POOL.GRANT);
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

// 回收：从账户销毁学元（对手方仍是发行账户，方向相反）
function burn(opts) {
  var o = opts || {};
  var from = String(o.from || '');
  var amountCent = o.amountCent;
  var pool = o.pool === POOL.CASH ? POOL.CASH
    : (o.pool === POOL.PRACTICE ? POOL.PRACTICE : POOL.GRANT);
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

// 教师发放：单次上限 + 每人每日累计上限。唯一带「财政纪律」的发行口。
function grant(opts) {
  var o = opts || {};
  var to = String(o.to || '');
  var amountCent = o.amountCent;
  if (!isValidUserId(to) || isSystem(to)) throw new Error('发放账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('发放金额必须是正整数分');
  }

  // 幂等优先：同一个 ref 重放时直接交给 mint 的重复分支，
  // 否则重试会被下面两条配额判成「超限」，客户端永远收不到 duplicate 响应。
  if (o.ref && ledger.findTxByRef(String(o.ref))) {
    return mint({
      to: to, amountCent: amountCent, kind: 'admin_grant', pool: POOL.GRANT,
      ref: o.ref, app: o.app, operator: o.operator, memo: o.memo, meta: o.meta, at: o.at
    });
  }

  if (amountCent > MAX_GRANT_CENT) {
    throw new Error('单人单次发放不能超过 ' + fromCent(MAX_GRANT_CENT) + ' 学元');
  }
  var used = grantedTodayCent(to);
  if (used + amountCent > GRANT_DAILY_CAP_CENT) {
    throw new Error('超过每人每日发放上限：今天已发 ' + fromCent(used) +
      ' 学元，上限 ' + fromCent(GRANT_DAILY_CAP_CENT) + ' 学元');
  }

  return mint({
    to: to, amountCent: amountCent, kind: 'admin_grant', pool: POOL.GRANT,
    ref: o.ref, app: o.app, operator: o.operator, memo: o.memo, meta: o.meta, at: o.at
  });
}

// 退款：把钱从**真实来源账户**退回给学生，不允许系统账户垫付（那等于印钱）。
function refund(opts) {
  ensureSchema();
  var o = opts || {};
  var to = String(o.to || '');
  var from = String(o.from || '');
  var amountCent = requireAmountCent(o, '退款金额');
  var pool = o.pool === POOL.GRANT ? POOL.GRANT : POOL.CASH;
  var operator = String(o.operator || '');
  var reason = String(o.reason || '').trim();

  if (!isValidUserId(to) || isSystem(to)) throw new Error('退款账户非法');
  if (!isValidUserId(operator) || isSystem(operator)) throw new Error('操作人非法');
  if (amountCent > MAX_TX_CENT) throw new Error('单笔退款超过上限');
  if (!reason) throw new Error('请填写退款原因');
  if (!isValidUserId(from)) throw new Error('请填写退款方账户');
  if (from === to) throw new Error('退款方不能是收款人自己');
  if (/^@system:/.test(from)) {
    throw new Error('不能用系统账户退款：那等于凭空印钱。现金退款请用「撤回充值」，奖励请用「教师发放」');
  }
  if (!ledger.findAccount('user', to)) throw new Error('该同学尚未开通学元账户');
  if (!ledger.findAccount('user', from)) throw new Error('退款方账户不存在');

  var src = getAccount(from);
  var avail = pool === POOL.CASH ? src.cash_balance : src.grant_balance;
  if (avail < amountCent) {
    throw new Error('退款方余额不足：可用 ' + fromCent(Math.max(0, avail)) + ' 学元，本次要退 ' + fromCent(amountCent) + ' 学元');
  }

  var r = post({
    entries: [
      { user_id: from, delta: -amountCent, pool: pool },
      { user_id: to, delta: amountCent, pool: pool }
    ],
    kind: 'refund',
    ref: o.ref ? String(o.ref) : null,
    app: o.app,
    operator: operator,
    memo: '退款：' + reason.slice(0, 60),
    meta: { reason: reason, from: from }
  });

  return {
    duplicate: !!r.duplicate,
    tx_id: r.tx_id,
    amount: fromCent(amountCent),
    pool: pool,
    from: from,
    account: viewAccount(to)
  };
}

// ---------- 配额（护栏） ----------

// 本学期累计充值（分）。归位之后「真金 = CASH 余额」，所以从账本按 CASH 分录统计，
// 不再读 xy_recharge —— 那张表里留着归位前按错 rate 记的 10 倍脏数据。
// 撤回必须冲减：否则录错一笔就永久占住孩子的学期配额。
function rechargedInSemesterCent(userId, ts) {
  ensureSchema();
  var acc = ledger.findAccount('user', String(userId));
  if (!acc) return 0;
  var r = semesterRange(ts);
  var row = db.prepare([
    'SELECT COALESCE(SUM(e.direction * e.amount_cent), 0) AS s',
    'FROM xy_ledger_entries e',
    'JOIN xy_ledger_transactions t ON t.id = e.tx_id',
    "WHERE e.account_id = ? AND e.asset = 'CASH'",
    "  AND t.kind IN ('recharge', 'recharge_revoke') AND t.created_at >= ?"
  ].join('\n')).get(acc.id, isoOf(r.startMs));
  return Math.max(0, Number(row.s) || 0);
}

// 今天已经收到的教师发放（分）。只统计 admin_grant，不含 reward。
function grantedTodayCent(userId, ts) {
  ensureSchema();
  var acc = ledger.findAccount('user', String(userId));
  if (!acc) return 0;
  var row = db.prepare([
    'SELECT COALESCE(SUM(e.direction * e.amount_cent), 0) AS s',
    'FROM xy_ledger_entries e',
    'JOIN xy_ledger_transactions t ON t.id = e.tx_id',
    'WHERE e.account_id = ? AND e.direction > 0',
    "  AND t.kind = 'admin_grant' AND t.created_at >= ?"
  ].join('\n')).get(acc.id, isoOf(dayStartMs(ts)));
  return Number(row.s) || 0;
}

// ---------- 分池支付 ----------

// 对外支出的扣款拆分：充值学元优先，不足由赠送学元补足。
// 新账本里 cash_balance 已经是可用额（冻结已移出账户），不需要再减 frozen。
function splitPayable(userId, amountCent) {
  var uid = String(userId);
  var a = getAccount(uid);
  if (!a.exists) throw new Error('账户不存在');
  if (a.status === 'frozen') throw new Error('账户已被冻结');

  var cashAvail = Math.max(0, a.available_cash);
  var grantAvail = Math.max(0, a.available_grant);
  var useCash = Math.min(cashAvail, amountCent);
  var useGrant = amountCent - useCash;
  if (useGrant > grantAvail) {
    throw new Error('可用学元不足（充值 ' + fromCent(cashAvail) + ' + 赠送 ' + fromCent(grantAvail) +
      ' 学元，另有 ' + fromCent(a.frozen) + ' 学元被冻结）');
  }
  return { cash: useCash, grant: useGrant };
}

// 按指定资产池拆分（转账 / 发红包共用，2026-11-07）。
// 与 splitPayable 同一口径（账本单位入、账本单位出），单位换算只在这一处发生：
//   auto  —— 充值学元优先、不足赠送补（历史行为）
//   cash  —— 只动充值学元（真金），不足报错并指路「自动」
//   grant —— 只动赠送学元（不可提现），适合帮同学凑投资本金
function splitPool(userId, amountCent, pool) {
  var sel = String(pool || 'auto').toLowerCase();
  if (['auto', 'cash', 'grant'].indexOf(sel) === -1) throw new Error('资产池只能是 auto / cash / grant');
  if (sel === 'auto') return splitPayable(userId, amountCent);
  var a = getAccount(userId);
  if (!a.exists) throw new Error('账户不存在');
  var avail = sel === 'cash' ? Math.max(0, a.available_cash) : Math.max(0, a.available_grant);
  if (avail < amountCent) {
    throw new Error((sel === 'cash' ? '充值学元不足（可用 ' : '赠送学元不足（可用 ') +
      fromCent(avail) + ' 学元）' + (sel === 'cash' ? '；想连赠送学元一起用请选「自动」' : ''));
  }
  return sel === 'cash' ? { cash: amountCent, grant: 0 } : { cash: 0, grant: amountCent };
}

// 分池扣款，但限制「赠送学元最多抵扣 amountCent × maxGrantRatio」。
// ⚠️ 已废弃（2026-11-07）：商品只能用自己充值的学元购买，赠金抵扣恒为 0，
//    路由与账本层都不再接受这个口径（见 ledger/settlement.maxGrantOffsetCent）。
//    保留仅为兼容旧引用；ratio 参数已忽略，任何调用都会得到「全额充值学元」。
function splitPayOrder(userId, amountCent) {
  var uid = String(userId);
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('支付金额必须是正整数分');
  }
  var a = getAccount(uid);
  if (!a.exists) throw new Error('账户不存在');
  if (a.status === 'frozen') throw new Error('账户已被冻结');

  // 商品只收充值学元，赠金一分不抵
  var cashAvail = Math.max(0, a.available_cash);
  if (amountCent > cashAvail) {
    throw new Error('充值学元不足：本单 ' + fromCent(amountCent) + ' 学元，只能用自己充值的学元购买' +
      (a.available_grant > 0
        ? '（你有 ' + fromCent(a.available_grant) + ' 学元赠送/投资学元，可以转账、发红包，但不能买东西）'
        : '') +
      '，还差 ' + fromCent(amountCent - cashAvail) + ' 学元');
  }
  return { cash: amountCent, grant: 0 };
}

// 同学之间转账。资产不跨池：赠送学元转手还是赠送学元，不会变成可提现的充值学元。
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
  if (!ledger.findAccount('user', to)) throw new Error('对方尚未开通学元账户');

  // 资产池选择（2026-11-07）：auto/cash/grant，统一走 splitPool（口径与护栏单一来源）
  var parts = splitPool(from, amountCent, o.pool);
  var entries = [];
  if (parts.cash > 0) {
    entries.push({ user_id: from, delta: -parts.cash, pool: POOL.CASH });
    entries.push({ user_id: to, delta: parts.cash, pool: POOL.CASH });
  }
  if (parts.grant > 0) {
    entries.push({ user_id: from, delta: -parts.grant, pool: POOL.GRANT });
    entries.push({ user_id: to, delta: parts.grant, pool: POOL.GRANT });
  }

  var out = post({
    entries: entries,
    kind: 'transfer',
    ref: o.ref,
    app: o.app,
    operator: o.operator || from,
    memo: o.memo,
    meta: o.meta,
    at: o.at
  });
  // 回传实际拆分（学元）：前端展示「本次转出：充值 X + 赠送 Y」，钱从哪来不再是一笔糊涂账
  out.split = { cash: fromCent(parts.cash), grant: fromCent(parts.grant) };
  return out;
}

function appEscrow(appName) {
  var name = String(appName || '');
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(name)) throw new Error('应用名非法');
  return '@app:' + name + ':escrow';
}

// 系统账户现在由账本按需创建，这个函数保留只为兼容旧调用点。
function ensureSystemAccount(userId) {
  if (!isSystem(userId)) throw new Error('不是系统账户');
  ledger.systemAccount('clearing');
}

// ---------- 冻结（挂单 / 红包 / 提现） ----------
// 冻结 = 一笔真实分录：用户 → escrow:hold:<学号>。
// 因为钱确实离开了账户，之后的余额检查、提现额度判断全都不需要再算 frozen。

function hold(userId, amountCent, opts) {
  ensureSchema();
  var o = opts || {};
  var id = String(userId || '');
  var mode = o.pool || 'grant_first';
  if (!isValidUserId(id) || isSystem(id)) throw new Error('账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('冻结金额必须是正整数分');
  }

  var a = getAccount(id);
  if (!a.exists) throw new Error('账户不存在');

  var useGrant = 0;
  var useCash = 0;
  var usePractice = 0;
  if (mode === 'cash') {
    useCash = amountCent;
    if (a.available_cash < useCash) throw new Error('充值学元不足，无法冻结');
  } else if (mode === 'grant') {
    useGrant = amountCent;
    if (a.available_grant < useGrant) throw new Error('赠送学元不足，无法冻结');
  } else if (mode === 'practice') {
    usePractice = amountCent;
    if (a.available_practice < usePractice) throw new Error('练习金不足，无法冻结');
  } else {
    useGrant = Math.min(Math.max(0, a.available_grant), amountCent);
    useCash = amountCent - useGrant;
    if (useCash > a.available_cash) {
      throw new Error('可用学元不足（充值 ' + fromCent(a.available_cash) + ' + 赠送 ' +
        fromCent(a.available_grant) + ' 学元）');
    }
  }

  // 直接调账本内核，所以分录要用账本格式（account/asset/direction），
  // 不能用本文件对外的 {user_id, delta, pool} 旧形状。
  var userAcc = { kind: 'user', owner: id };
  var escAcc = { kind: 'escrow', owner: 'hold:' + id };
  var entries = [];
  if (useCash > 0) {
    entries.push({ account: userAcc, asset: 'CASH', direction: -1, amount_cent: useCash });
    entries.push({ account: escAcc, asset: 'CASH', direction: 1, amount_cent: useCash });
  }
  if (useGrant > 0) {
    entries.push({ account: userAcc, asset: 'GRANT', direction: -1, amount_cent: useGrant });
    entries.push({ account: escAcc, asset: 'GRANT', direction: 1, amount_cent: useGrant });
  }
  if (usePractice > 0) {
    entries.push({ account: userAcc, asset: 'PRACTICE', direction: -1, amount_cent: usePractice });
    entries.push({ account: escAcc, asset: 'PRACTICE', direction: 1, amount_cent: usePractice });
  }

  ledger.post({
    ref: o.ref || genRef('hold'),
    // 用独立的 'hold' 而不是 'transfer'：冻结是「钱还在自己名下、只是动不了」，
    // 计入日转出额度会把同一笔钱算两次（冻结一次 + 真正转出一次）。
    kind: 'hold',
    initiator: o.operator || id,
    memo: o.memo || '冻结',
    entries: entries
  });
  return getAccount(id);
}

function release(userId, amountCent, opts) {
  ensureSchema();
  var o = opts || {};
  var id = String(userId || '');
  if (!isValidUserId(id) || isSystem(id)) throw new Error('账户非法');
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('解冻金额必须是正整数分');
  }

  var esc = ledger.findAccount('escrow', 'hold:' + id);
  if (!esc) throw new Error('没有冻结中的资金');
  var avail = {
    cash: ledger.balanceOf(esc.id, 'CASH'),
    grant: ledger.balanceOf(esc.id, 'GRANT'),
    practice: ledger.balanceOf(esc.id, 'PRACTICE')
  };

  var fromCash = 0;
  var fromGrant = 0;
  var fromPractice = 0;
  if (o.pool === POOL.CASH) {
    fromCash = amountCent;
    if (avail.cash < fromCash) throw new Error('充值学元冻结额不足');
  } else if (o.pool === POOL.GRANT) {
    fromGrant = amountCent;
    if (avail.grant < fromGrant) throw new Error('赠送学元冻结额不足');
  } else if (o.pool === POOL.PRACTICE) {
    fromPractice = amountCent;
    if (avail.practice < fromPractice) throw new Error('练习金冻结额不足');
  } else {
    // 未指定池（撤单、死单清理）：练习金 → 赠送 → 充值
    fromPractice = Math.min(avail.practice, amountCent);
    var rest = amountCent - fromPractice;
    fromGrant = Math.min(avail.grant, rest);
    fromCash = rest - fromGrant;
    if (avail.cash < fromCash) throw new Error('解冻额超过冻结总额');
  }

  var userAcc = { kind: 'user', owner: id };
  var escAcc = { kind: 'escrow', owner: 'hold:' + id };
  var entries = [];
  if (fromCash > 0) {
    entries.push({ account: escAcc, asset: 'CASH', direction: -1, amount_cent: fromCash });
    entries.push({ account: userAcc, asset: 'CASH', direction: 1, amount_cent: fromCash });
  }
  if (fromGrant > 0) {
    entries.push({ account: escAcc, asset: 'GRANT', direction: -1, amount_cent: fromGrant });
    entries.push({ account: userAcc, asset: 'GRANT', direction: 1, amount_cent: fromGrant });
  }
  if (fromPractice > 0) {
    entries.push({ account: escAcc, asset: 'PRACTICE', direction: -1, amount_cent: fromPractice });
    entries.push({ account: userAcc, asset: 'PRACTICE', direction: 1, amount_cent: fromPractice });
  }

  ledger.post({
    ref: o.ref || genRef('release'),
    kind: 'order_refund',
    initiator: o.operator || id,
    memo: o.memo || '解冻',
    entries: entries
  });
  return getAccount(id);
}

// 成交结算：冻结里的一部分真正花掉，剩余退回。
//   holdCent 下单时冻结额 / costCent 实付 / feeCent 其中费用
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

  var esc = ledger.findAccount('escrow', 'hold:' + uid);
  if (!esc) throw new Error('冻结额不足（可能已被其他委托占用）');
  var avail = {
    cash: ledger.balanceOf(esc.id, 'CASH'),
    grant: ledger.balanceOf(esc.id, 'GRANT'),
    practice: ledger.balanceOf(esc.id, 'PRACTICE')
  };
  if (avail.cash + avail.grant + avail.practice < holdCent) {
    throw new Error('冻结额不足（可能已被其他委托占用）');
  }

  // 按指定池或「练习金 → 赠送 → 充值」顺序拆出 holdCent 的来源
  var holdCash = 0;
  var holdGrant = 0;
  var holdPractice = 0;
  if (o.pool === POOL.CASH) {
    holdCash = holdCent;
    if (avail.cash < holdCash) throw new Error('充值学元冻结额不足');
  } else if (o.pool === POOL.GRANT) {
    holdGrant = holdCent;
    if (avail.grant < holdGrant) throw new Error('赠送学元冻结额不足');
  } else if (o.pool === POOL.PRACTICE) {
    holdPractice = holdCent;
    if (avail.practice < holdPractice) throw new Error('练习金冻结额不足');
  } else {
    holdPractice = Math.min(avail.practice, holdCent);
    holdGrant = Math.min(avail.grant, holdCent - holdPractice);
    holdCash = holdCent - holdPractice - holdGrant;
    if (avail.cash < holdCash) throw new Error('冻结额不足');
  }

  // 成本优先吃练习金/赠送冻结，不足再吃充值冻结
  var practiceSpend = Math.min(costCent, holdPractice);
  var grantSpend = Math.min(costCent - practiceSpend, holdGrant);
  var cashSpend = costCent - practiceSpend - grantSpend;
  var tradeCent = costCent - feeCent;
  var practiceTrade = Math.min(tradeCent, practiceSpend);
  var grantTrade = Math.min(tradeCent - practiceTrade, grantSpend);
  var cashTrade = tradeCent - practiceTrade - grantTrade;
  var practiceFee = practiceSpend - practiceTrade;
  var grantFee = grantSpend - grantTrade;
  var cashFee = feeCent - practiceFee - grantFee;

  var baseRef = o.ref || genRef('settle');
  var run = db.transaction(function () {
    // 1) 全部解冻回用户（账本格式分录）
    var userAcc = { kind: 'user', owner: uid };
    var escAcc = { kind: 'escrow', owner: 'hold:' + uid };
    var back = [];
    if (holdCash > 0) {
      back.push({ account: escAcc, asset: 'CASH', direction: -1, amount_cent: holdCash });
      back.push({ account: userAcc, asset: 'CASH', direction: 1, amount_cent: holdCash });
    }
    if (holdGrant > 0) {
      back.push({ account: escAcc, asset: 'GRANT', direction: -1, amount_cent: holdGrant });
      back.push({ account: userAcc, asset: 'GRANT', direction: 1, amount_cent: holdGrant });
    }
    if (holdPractice > 0) {
      back.push({ account: escAcc, asset: 'PRACTICE', direction: -1, amount_cent: holdPractice });
      back.push({ account: userAcc, asset: 'PRACTICE', direction: 1, amount_cent: holdPractice });
    }
    ledger.post({
      ref: baseRef + ':release',
      kind: 'order_refund',
      initiator: uid,
      memo: '结算解冻',
      entries: back
    });

    // 2) 真正花掉：成交额 + 费用，各自回收进发行账户
    [
      { cent: practiceTrade, pool: POOL.PRACTICE, tail: ':trade:practice' },
      { cent: grantTrade, pool: POOL.GRANT, tail: ':trade:grant' },
      { cent: cashTrade, pool: POOL.CASH, tail: ':trade:cash' }
    ].forEach(function (x) {
      if (x.cent <= 0) return;
      post({
        entries: [
          { user_id: uid, delta: -x.cent, pool: x.pool },
          { user_id: SYSTEM_SETTLE, delta: x.cent, pool: POOL.SYSTEM }
        ],
        kind: 'trade',
        ref: baseRef + x.tail,
        app: o.app,
        memo: o.memo,
        meta: o.meta,
        at: o.at
      });
    });
    [
      { cent: practiceFee, pool: POOL.PRACTICE, tail: ':fee:practice' },
      { cent: grantFee, pool: POOL.GRANT, tail: ':fee:grant' },
      { cent: cashFee, pool: POOL.CASH, tail: ':fee:cash' }
    ].forEach(function (x) {
      if (x.cent <= 0) return;
      post({
        entries: [
          { user_id: uid, delta: -x.cent, pool: x.pool },
          { user_id: SYSTEM_FEE, delta: x.cent, pool: POOL.SYSTEM }
        ],
        kind: 'fee',
        ref: baseRef + x.tail,
        app: o.app,
        memo: (o.memo || '') + '（费用）',
        meta: o.meta,
        at: o.at
      });
    });
  });
  run();

  var account = getAccount(uid);
  account.spent = {
    cash_cent: cashSpend,
    grant_cent: grantSpend,
    practice_cent: practiceSpend,
    cash_fee_cent: cashFee,
    grant_fee_cent: grantFee,
    practice_fee_cent: practiceFee
  };
  return account;
}

// 一般回款：发行账户 → 用户。只用于退款 / 补偿。
function credit(userId, amountCent, opts) {
  var o = opts || {};
  var pool = o.pool === POOL.GRANT ? POOL.GRANT : POOL.CASH;
  if (typeof amountCent !== 'number' || amountCent <= 0 || Math.floor(amountCent) !== amountCent) {
    throw new Error('入账金额必须为正整数分');
  }
  return post({
    entries: [
      { user_id: SYSTEM_MINT, delta: -amountCent, pool: POOL.SYSTEM },
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

// 交易回款：本金按买入时的资金来源分别回池，投资收益进练习金。
// 收益进练习金是「投资不能变成消费购买力」的最后一道墙。
function creditTrade(userId, netCent, opts) {
  var o = opts || {};
  var uid = String(userId || '');
  if (!isValidUserId(uid) || isSystem(uid)) throw new Error('账户非法');
  if (typeof netCent !== 'number' || !isFinite(netCent) || netCent <= 0 || Math.floor(netCent) !== netCent) {
    throw new Error('回款金额必须是正整数分');
  }

  var principal = Math.max(0, Math.floor(Number(o.principalCent) || 0));
  if (principal > netCent) throw new Error('本金金额非法：不能超过回款金额');

  var pPractice = Math.max(0, Math.floor(Number(o.principalPracticeCent) || 0));
  // 没显式说明本金来源时，默认全部回充值池 —— 这是「原路退回」的默认解释，
  // 也是旧调用（只传 principalCent）唯一的合理语义。
  var pCash = o.principalCashCent == null
    ? Math.max(0, principal - pPractice)
    : Math.max(0, Math.floor(Number(o.principalCashCent) || 0));
  var pGrant = principal - pCash - pPractice;
  if (pGrant < 0) {
    // 显式指定了各池金额，但加起来超过本金 —— 多出来的部分没有资金来源，
    // 放过它等于凭空补一笔钱给用户。
    throw new Error('本金资金来源拆分非法：充值 ' + fromCent(pCash) + ' + 赠送 ' + fromCent(pGrant < 0 ? 0 : pGrant) +
      ' + 练习金 ' + fromCent(pPractice) + ' 超过本金 ' + fromCent(principal) + ' 学元');
  }

  var profit = netCent - principal;
  var ref = o.ref ? String(o.ref) : genRef('credit');
  var out = { profit_cent: profit, principal_cash_cent: pCash, principal_grant_cent: pGrant, principal_practice_cent: pPractice };

  // 本金从「结算账户」退回：那笔钱本来就是学生买入时付出去、由结算账户保管的，
  // 从发行账户退等于凭空印一次（I2 会立刻报差额）。
  // 收益不同：它从来没有对应的现金，只能由发行账户出，且只进练习金（封闭池）。
  function leg(asset, cent, tail, kind, payer) {
    if (cent <= 0) return null;
    return post({
      entries: [
        { user_id: payer || SYSTEM_MINT, delta: -cent, pool: POOL.SYSTEM },
        { user_id: uid, delta: cent, pool: asset === 'CASH' ? POOL.CASH : (asset === 'GRANT' ? POOL.GRANT : POOL.PRACTICE) }
      ],
      kind: kind, ref: ref + tail,
      app: o.app, memo: o.memo, meta: o.meta, at: o.at
    });
  }

  var run = db.transaction(function () {
    out.principal_tx = leg('CASH', pCash, ':principal:cash', 'trade', SYSTEM_SETTLE);
    out.principal_grant_tx = leg('GRANT', pGrant, ':principal:grant', 'trade', SYSTEM_SETTLE);
    out.principal_practice_tx = leg('PRACTICE', pPractice, ':principal:practice', 'trade', SYSTEM_SETTLE);
    out.profit_tx = leg('PRACTICE', profit, ':profit', 'profit');
  });
  run();
  out.account = viewAccount(uid);
  return out;
}

// ---------- 线下充值 / 提现 ----------
// 这两件事的**凭证**（谁交的现金、哪张单被谁批的）留在 xy_recharge / xy_withdraw，
// 钱的变动走账本。凭证和账本分开，是为了让「业务上发生过什么」可追溯，
// 又不必让账本去存审批状态。

function mapRecharge(r) {
  if (!r) return null;
  return {
    id: r.id,
    user_id: r.user_id,
    amount_cent: r.amount_cent,
    amount: fromCent(r.amount_cent),
    yuan: Math.round((Number(r.yuan_cents) || 0)) / CENT_PER_YUAN,
    rate: r.rate,
    method: r.method,
    operator: r.operator,
    memo: r.memo,
    request_id: r.request_id,
    tx_id: r.tx_id,
    revoked: !!r.revoked_at,
    revoked_at: r.revoked_at ? msOf(r.revoked_at) || r.revoked_at : 0,
    revoked_by: r.revoked_by || '',
    revoke_reason: r.revoke_reason || '',
    revoke_tx_id: r.revoke_tx_id || 0,
    created_at: msOf(r.created_at) || r.created_at
  };
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
    created_at: msOf(r.created_at) || r.created_at,
    reviewed_at: r.reviewed_at ? (msOf(r.reviewed_at) || r.reviewed_at) : 0
  };
}

function recharge(opts) {
  ensureSchema();
  var o = opts || {};
  var uid = String(o.user || o.to || '');
  var operator = String(o.operator || '');
  if (!isValidUserId(uid) || isSystem(uid)) throw new Error('充值账户非法');
  if (!isValidUserId(operator) || isSystem(operator)) throw new Error('操作人非法');

  var rate = Number(o.rate) > 0 ? Number(o.rate) : yuanRate();
  var amountCent = requireAmountCent(o, '充值金额', rate);
  var maxCent = o.maxCent == null ? MAX_RECHARGE_CENT : Number(o.maxCent);
  if (amountCent > maxCent) {
    throw new Error('单笔充值不能超过 ' + centToYuan(maxCent, rate) + ' 元');
  }
  if (!ledger.findAccount('user', uid)) throw new Error('该同学尚未开通学元账户');

  var requestId = o.requestId ? String(o.requestId) : null;
  if (requestId) {
    var existed = db.prepare('SELECT * FROM xy_recharge WHERE request_id = ?').get(requestId);
    if (existed) {
      return { duplicate: true, recharge: mapRecharge(existed), account: viewAccount(uid) };
    }
  }

  // 学期累计配额：放在幂等判断之后，否则重放同一笔充值会被误判超限
  var usedQuota = rechargedInSemesterCent(uid);
  if (usedQuota + amountCent > RECHARGE_QUOTA_CENT) {
    throw new Error('超过本学期充值配额：已充 ' + centToYuan(usedQuota, rate) +
      ' 元，上限 ' + centToYuan(RECHARGE_QUOTA_CENT, rate) + ' 元');
  }

  var stamp = new Date();

  var run = db.transaction(function () {
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
    // 真金台账：充值让「我欠用户的钱」增加。不记这一笔，I2 立刻报
    // 「账面现金与真金台账不一致」—— 那不是误报，是真的没有对应现金。
    cashbook.record({
      tx_id: r.tx_id,
      type: 'recharge',
      amount_cent: amountCent,
      ref: (requestId ? 'recharge:' + requestId : 'recharge:' + r.tx_id) + ':cash',
      note: o.memo || '线下充值'
    });
    var info = db.prepare([
      'INSERT INTO xy_recharge (user_id, amount_cent, yuan_cents, rate, method, operator, memo, request_id, tx_id, created_at)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ].join(' ')).run(
      uid, amountCent,
      Math.round(centToYuan(amountCent, rate) * CENT_PER_YUAN),
      rate, o.method || 'cash', operator,
      o.memo ? String(o.memo) : '', requestId, r.tx_id, stamp.getTime()
    );
    return { duplicate: false, row: db.prepare('SELECT * FROM xy_recharge WHERE id = ?').get(Number(info.lastInsertRowid)) };
  });

  var result = run();
  return {
    duplicate: !!result.duplicate,
    recharge: mapRecharge(result.row),
    account: viewAccount(uid)
  };
}

// 撤回线下充值：整笔冲掉。要求「钱还在」，否则会让学生欠账。
function revokeRecharge(opts) {
  ensureSchema();
  var o = opts || {};
  var id = parseInt(o.rechargeId, 10);
  var operator = String(o.operator || '');
  if (!(id > 0)) throw new Error('充值记录 id 非法');
  if (!isValidUserId(operator) || isSystem(operator)) throw new Error('操作人非法');

  var row = db.prepare('SELECT * FROM xy_recharge WHERE id = ?').get(id);
  if (!row) throw new Error('充值记录不存在');
  // 撤回是幂等的：重复调用返回 duplicate 而不是抛错。
  // 班管在弱网下双击两次很常见，抛错会让他以为没成功、再去点第三次。
  if (row.revoked_at) {
    return { duplicate: true, recharge: mapRecharge(row), account: viewAccount(row.user_id) };
  }

  var a = getAccount(row.user_id);
  if (!a.exists) throw new Error('该同学尚未开通学元账户');
  if (a.available_cash < row.amount_cent) {
    throw new Error('该笔充值已被使用，无法撤回（可用充值学元 ' + fromCent(a.available_cash) +
      ' 学元，本次要撤回 ' + fromCent(row.amount_cent) + ' 学元）');
  }
  var pending = db.prepare("SELECT 1 FROM xy_withdraw WHERE user_id = ? AND status = 'pending'").get(row.user_id);
  if (pending) throw new Error('该同学有冻结中的提现申请，请先处理');

  var stamp = new Date();
  var reason = String(o.reason || o.memo || '').trim();
  var burnResult;
  var run = db.transaction(function () {
    burnResult = burn({
      from: row.user_id,
      amountCent: row.amount_cent,
      pool: POOL.CASH,
      kind: 'recharge_revoke',
      ref: 'recharge-revoke:' + id,
      operator: operator,
      memo: '撤回充值 #' + id + (reason ? '：' + reason : '')
    });
    // 撤回 = 现金退回家长，真金台账同步冲减
    cashbook.record({
      tx_id: burnResult.tx_id,
      type: 'refund',
      amount_cent: -row.amount_cent,
      ref: 'recharge-revoke:' + id + ':cash',
      note: '撤回充值'
    });
    db.prepare([
      'UPDATE xy_recharge SET revoked_at = ?, revoked_by = ?, revoke_reason = ?, revoke_tx_id = ?',
      'WHERE id = ? AND revoked_at = 0'
    ].join(' ')).run(stamp.getTime(), operator, reason, burnResult.tx_id, id);
  });
  run();

  return {
    duplicate: false,
    recharge: mapRecharge(db.prepare('SELECT * FROM xy_recharge WHERE id = ?').get(id)),
    account: viewAccount(row.user_id)
  };
}

function requestWithdraw(opts) {
  ensureSchema();
  var o = opts || {};
  var uid = String(o.user || '');
  // 前端输入的是「学元」，不是人民币元，也不是账本单位。
  // 以前这里只读 o.yuan，而路由传的是 body.amount —— 于是任何输入都会得到
  // yuanToCent(undefined)=NaN → 「必须是正整数分」。这是提现整条链路失效的根因。
  var amountCent = requireAmountCent(o, '提现金额');
  if (!isValidUserId(uid) || isSystem(uid)) throw new Error('提现账户非法');
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

  var stamp = new Date();
  var out;
  var run = db.transaction(function () {
    hold(uid, amountCent, { pool: POOL.CASH, ref: 'withdraw-hold:' + uid + ':' + stamp.getTime(), memo: '提现申请冻结' });
    var info = db.prepare([
      'INSERT INTO xy_withdraw (user_id, amount_cent, status, memo, request_id, created_at)',
      "VALUES (?, ?, 'pending', ?, ?, ?)"
    ].join(' ')).run(uid, amountCent, o.memo ? String(o.memo) : '', requestId, stamp.getTime());
    out = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(Number(info.lastInsertRowid));
  });
  run();
  return { duplicate: false, withdraw: mapWithdraw(out), account: viewAccount(uid) };
}

function reviewWithdraw(id, approve, opts) {
  ensureSchema();
  var o = opts || {};
  var reviewer = String(o.reviewer || '');
  if (!isValidUserId(reviewer) || isSystem(reviewer)) throw new Error('审批人非法');
  var wid = parseInt(id, 10);
  if (!(wid > 0)) throw new Error('提现单号非法');

  var stamp = new Date();
  var out;
  var run = db.transaction(function () {
    var row = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(wid);
    if (!row) throw new Error('提现单不存在');
    if (row.status !== 'pending') throw new Error('该提现单已处理');

    if (!approve) {
      release(row.user_id, row.amount_cent, { pool: POOL.CASH, ref: 'withdraw-reject:' + wid, memo: '提现驳回解冻' });
      db.prepare([
        "UPDATE xy_withdraw SET status = 'rejected', reviewer = ?, review_memo = ?,",
        "reviewed_at = ?, operator = ? WHERE id = ? AND status = 'pending'"
      ].join(' ')).run(reviewer, o.memo ? String(o.memo) : '', stamp.getTime(), reviewer, wid);
      out = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(wid);
      return;
    }

    // 通过：解冻（钱回到可用）后立刻销毁，等价于「现金已经交给学生」
    release(row.user_id, row.amount_cent, { pool: POOL.CASH, ref: 'withdraw-release:' + wid, memo: '提现通过解冻' });
    var burnResult = burn({
      from: row.user_id,
      amountCent: row.amount_cent,
      pool: POOL.CASH,
      kind: 'withdraw',
      ref: 'withdraw:' + wid,
      operator: reviewer,
      memo: '提现（线下付现）' + (o.memo ? '：' + o.memo : '')
    });
    // 提现 = 把现金还给家长，负债同步冲减
    cashbook.record({
      tx_id: burnResult.tx_id,
      type: 'refund',
      amount_cent: -row.amount_cent,
      ref: 'withdraw:' + wid + ':cash',
      note: '提现'
    });

    db.prepare([
      "UPDATE xy_withdraw SET status = 'paid', reviewer = ?, review_memo = ?,",
      "reviewed_at = ?, operator = ?, tx_id = ? WHERE id = ? AND status = 'pending'"
    ].join(' ')).run(reviewer, o.memo ? String(o.memo) : '', stamp.getTime(), reviewer, burnResult.tx_id, wid);
    out = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(wid);
  });
  run();
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
  return stmt.all.apply(stmt, args).map(mapWithdraw);
}

// 学生撤销自己待审批的提现：解冻，钱回到可用余额。
function cancelWithdraw(id, opts) {
  ensureSchema();
  var o = opts || {};
  var uid = String(o.user || '');
  if (!isValidUserId(uid) || isSystem(uid)) throw new Error('账户非法');
  var wid = parseInt(id, 10);
  if (!(wid > 0)) throw new Error('提现单号非法');

  var out;
  var run = db.transaction(function () {
    var row = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(wid);
    if (!row) throw new Error('提现单不存在');
    if (row.user_id !== uid) throw new Error('只能撤销自己的提现申请');
    if (row.status !== 'pending') throw new Error('该提现单已处理，无法撤销');

    release(row.user_id, row.amount_cent, { pool: POOL.CASH, ref: 'withdraw-cancel:' + wid, memo: '学生撤销解冻' });
    db.prepare([
      "UPDATE xy_withdraw SET status = 'cancelled', review_memo = ?, reviewed_at = ?",
      "WHERE id = ? AND status = 'pending'"
    ].join(' ')).run('学生撤销', new Date().getTime(), wid);
    out = db.prepare('SELECT * FROM xy_withdraw WHERE id = ?').get(wid);
  });
  run();
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

// ---------- 投资进出：赠金 ⇄ 练习金 ----------
// 账本的硬规则是「资产之间不能直接兑换」（每笔交易按资产分组各自守恒）。
// 所以这里不是「转一笔」，而是**两笔独立交易**：作废原资产 + 等额发行目标资产。
// 两笔各自单资产守恒，账本不会因此出现无锚的净额。
//
// ⚠️ 只允许在 GRANT（不可兑付）与 PRACTICE（封闭）之间发生。
//    CASH 永远不参与 —— 那正是 11-05 那次「赠金买股、卖出变现金」的漏洞。
//    这条线守住，学生的真钱就永远进不了股市，股市赚的钱也永远变不出现金。
//
// 为什么要开这个口子：赠金本来就是给学生的零花钱。不许它进股市、赚了又不许拿出来，
// 等于证券是个只进不出的存钱罐，学生没有参与动机。
// 投资进出只保留「门面」：金额换算、账户校验、文案都在账本层统一实现，
// 系统应用与第三方能力面共用 src/ledger/invest.js，规则不会两套漂移。
function investMove(userId, amountCent, dir, opts) {
  ensureSchema();
  var r = invest.move(userId, amountCent, dir, opts);
  return {
    direction: r.direction,
    amount: fromCent(r.amount_cent),
    amount_cent: r.amount_cent,
    account: viewAccount(String(userId))
  };
}

// 赠金 → 练习金：把零花钱放进沙盘
function investIn(userId, amountCent, opts) { return investMove(userId, amountCent, 'in', opts); }
// 练习金 → 赠金：把炒股赚的（或剩下的）拿回钱包花
function investOut(userId, amountCent, opts) { return investMove(userId, amountCent, 'out', opts); }

// ---------- 每日津贴 ----------

function claimDaily(userId) {
  var id = String(userId || '');
  if (!isValidUserId(id) || isSystem(id)) throw new Error('账户非法');
  var today = todayKey();
  var ref = 'daily:' + id + ':' + today;

  if (DAILY_CENT <= 0) throw new Error('助学津贴已关闭');

  // 连续天数：查最近一条 daily 交易的日期，是昨天就 +1，否则归 1
  var last = db.prepare([
    'SELECT created_at FROM xy_ledger_transactions',
    'WHERE ref LIKE ? ORDER BY id DESC LIMIT 1'
  ].join(' ')).get('daily:' + id + ':%');

  var streak = 1;
  if (last) {
    var lastKey = todayKey(msOf(last.created_at));
    var y = new Date(Date.now() + 8 * 3600 * 1000 - 86400000);
    var yesterday = y.getUTCFullYear() + '-' +
      ('0' + (y.getUTCMonth() + 1)).slice(-2) + '-' +
      ('0' + y.getUTCDate()).slice(-2);
    if (lastKey === yesterday) {
      var prev = ledger.findTxByRef('daily:' + id + ':' + lastKey);
      var prevStreak = 0;
      try { prevStreak = JSON.parse(prev && prev.payload || '{}').streak || 0; } catch (e) { prevStreak = 0; }
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
    memo: '第 ' + (streak || 1) + ' 天助学津贴（赠送学元，可支付不可提现）',
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

  var acc = ledger.findAccount('user', String(userId));
  if (!acc) return { list: [], next_before_id: 0 };

  var rows = db.prepare([
    'SELECT e.id, e.tx_id, e.asset, e.direction, e.amount_cent, e.created_at,',
    '       t.kind, t.initiator, t.memo, t.payload,',
    '  (SELECT COALESCE(SUM(e2.direction * e2.amount_cent), 0)',
    '     FROM xy_ledger_entries e2',
    '    WHERE e2.account_id = e.account_id AND e2.id <= e.id',
    "      AND (CASE WHEN e.asset = 'PRACTICE' THEN e2.asset = 'PRACTICE' ELSE e2.asset <> 'PRACTICE' END)",
    '  ) AS balance_after',
    'FROM xy_ledger_entries e',
    'JOIN xy_ledger_transactions t ON t.id = e.tx_id',
    'WHERE e.account_id = ? AND (? = 0 OR e.id < ?)',
    'ORDER BY e.id DESC LIMIT ?'
  ].join('\n')).all(acc.id, beforeId, beforeId, limit);

  var list = rows.map(function (r) {
    var meta = null;
    if (r.payload) { try { meta = JSON.parse(r.payload); } catch (e) { meta = null; } }
    var pool = String(r.asset).toLowerCase();
    var delta = r.direction * r.amount_cent;
    return {
      id: r.id,
      tx_id: r.tx_id,
      delta_cent: delta,
      delta: fromCent(delta),
      balance_after: fromCent(r.balance_after),
      pool: pool,
      pool_label: poolLabel(pool),
      kind: r.kind,
      kind_label: KINDS[r.kind] || r.kind,
      app: r.initiator,
      operator: r.initiator,
      memo: r.memo,
      meta: meta,
      created_at: msOf(r.created_at)
    };
  });

  return {
    list: list,
    next_before_id: list.length === limit ? list[list.length - 1].id : 0
  };
}

// 系统账户不参与榜单。榜只看可花的（CASH + GRANT），练习金不计入。
function leaderboard(opts) {
  ensureSchema();
  var o = opts || {};
  var limit = Math.min(Math.max(parseInt(o.limit, 10) || 10, 1), 50);
  var rows = db.prepare([
    'SELECT a.owner_id AS user_id, COALESCE(SUM(b.balance), 0) AS bal',
    'FROM xy_ledger_accounts a',
    "LEFT JOIN xy_ledger_balances b ON b.account_id = a.id AND b.asset IN ('CASH','GRANT')",
    "WHERE a.kind = 'user' AND a.status = 'active'",
    'GROUP BY a.owner_id ORDER BY bal DESC LIMIT ?'
  ].join('\n')).all(limit);

  var stmt = db.prepare('SELECT net_name, real_name FROM users WHERE user_id = ?');
  return rows.map(function (r, i) {
    var u = stmt.get(r.user_id) || {};
    return {
      rank: i + 1,
      user_id: r.user_id,
      net_name: u.net_name || '',
      real_name: u.real_name || '',
      balance: fromCent(r.bal),
      balance_cent: r.bal
    };
  });
}

// ---------- 统计与对账 ----------

function sumBalances(asset, kinds) {
  var kindSql = kinds && kinds.length
    ? ' AND a.kind IN (' + kinds.map(function () { return '?'; }).join(',') + ')'
    : '';
  var sql = [
    'SELECT COALESCE(SUM(b.balance), 0) AS s',
    'FROM xy_ledger_balances b JOIN xy_ledger_accounts a ON a.id = b.account_id',
    'WHERE b.asset = ?' + kindSql
  ].join('\n');
  var stmt = db.prepare(sql);
  return Number(stmt.get.apply(stmt, [asset].concat(kinds || [])).s) || 0;
}

function sumKindsSince(kinds, fromIso) {
  var ph = kinds.map(function () { return '?'; }).join(',');
  var stmt = db.prepare([
    'SELECT COALESCE(SUM(e.direction * e.amount_cent), 0) AS s',
    'FROM xy_ledger_entries e JOIN xy_ledger_transactions t ON t.id = e.tx_id',
    'JOIN xy_ledger_accounts a ON a.id = e.account_id',
    "WHERE a.kind = 'user' AND e.direction > 0 AND t.kind IN (" + ph + ') AND t.created_at >= ?'
  ].join('\n'));
  return Number(stmt.get.apply(stmt, kinds.concat([fromIso])).s) || 0;
}

function clearedIssued(asset) {
  // clearing 的负值就是「已发行净额」
  var clearing = ledger.systemAccount('clearing');
  return -ledger.balanceOf(clearing.id, asset);
}

function summary(opts) {
  ensureSchema();
  var o = opts || {};
  var dayIso = isoOf(dayStartMs());

  var accounts = db.prepare("SELECT COUNT(*) AS c FROM xy_ledger_accounts WHERE kind = 'user'").get().c;
  var cash = sumBalances('CASH', ['user']);
  var grant = sumBalances('GRANT', ['user']);
  var practice = sumBalances('PRACTICE', ['user']);
  var frozenAll = (function () {
    var rows = db.prepare([
      'SELECT COALESCE(SUM(b.balance), 0) AS s FROM xy_ledger_balances b',
      "JOIN xy_ledger_accounts a ON a.id = b.account_id WHERE a.kind = 'escrow'"
    ].join('\n')).get();
    return Number(rows.s) || 0;
  })();
  var circulation = cash + grant;

  var minted = sumKindsSince(['welcome', 'daily', 'admin_grant', 'reward'], dayIso);
  var burned = sumKindsSince(['admin_deduct', 'withdraw', 'recharge_revoke'], dayIso);
  var rechargedToday = sumKindsSince(['recharge'], dayIso);
  var withdrawnToday = sumKindsSince(['withdraw'], dayIso);
  var rechargeTotal = sumKindsSince(['recharge'], '1970');
  var withdrawTotal = sumKindsSince(['withdraw'], '1970');
  var revokeTotal = sumKindsSince(['recharge_revoke'], '1970');
  var giftIssuedTotal = sumKindsSince(['welcome', 'daily', 'admin_grant', 'reward'], '1970');
  var pendingWithdraw = db.prepare(
    "SELECT COUNT(*) AS c, COALESCE(SUM(amount_cent), 0) AS s FROM xy_withdraw WHERE status = 'pending'"
  ).get();
  var txToday = db.prepare('SELECT COUNT(*) AS c FROM xy_ledger_transactions WHERE created_at >= ?').get(dayIso).c;

  // 发行/回收：新账本里只有 clearing 一个发行对手方。
  //   - GRANT 的净发行 = 赠金 + 投资/任务等一切非现金发放 - 回收
  //   - 练习金净发行单独看（封闭池，不构成消费购买力）
  var grantIssuedNet = clearedIssued('GRANT');
  var practiceIssuedNet = clearedIssued('PRACTICE');

  return {
    accounts: accounts,
    circulation_cent: circulation,
    circulation: fromCent(circulation),
    cash_cent: cash,
    cash: fromCent(cash),
    grant_cent: grant,
    grant: fromCent(grant),
    practice_cent: practice,
    practice: fromCent(practice),
    frozen_cent: frozenAll,
    frozen: fromCent(frozenAll),
    frozen_cash: fromCent(0),
    frozen_grant: fromCent(0),
    minted_today: fromCent(minted),
    burned_today: fromCent(burned),
    recharged_today: fromCent(rechargedToday),
    withdrawn_today: fromCent(withdrawnToday),
    recharge_total: fromCent(rechargeTotal),
    withdraw_total: fromCent(withdrawTotal),
    revoke_total: fromCent(revokeTotal),
    net_recharge_total: fromCent(rechargeTotal - withdrawTotal - revokeTotal),
    pending_withdraw_count: pendingWithdraw.c,
    pending_withdraw_cent: pendingWithdraw.s,
    tx_today: txToday,
    avg_balance: accounts ? Math.round(circulation / accounts) / CENT_PER_YUAN : 0,
    // 旧面板的三个系统账户指标，在新账本里的对应口径：
    // settle_deficit 恒 0 —— 投资收益只进练习金（封闭池），
    // 不会再有「卖出回款落进消费池」造成的隐性发行。
    settle_balance_cent: practiceIssuedNet,
    settle_balance: fromCent(practiceIssuedNet),
    settle_deficit_cent: 0,
    settle_deficit: 0,
    fee_sink: 0,
    gift_issued_total: fromCent(giftIssuedTotal),
    profit_paid_total: fromCent(0),
    fee_total: fromCent(0),
    burn_total: fromCent(burned),
    net_issued_total: fromCent(grantIssuedNet),
    daily_cent: DAILY_CENT,
    welcome_cent: WELCOME_CENT,
    yuan_rate: yuanRate(),
    limits: {
      max_transfer: fromCent(MAX_TRANSFER_CENT),
      max_balance: fromCent(MAX_BALANCE_CENT),
      max_recharge: fromCent(MAX_RECHARGE_CENT),
      recharge_quota: fromCent(RECHARGE_QUOTA_CENT),
      max_grant: fromCent(MAX_GRANT_CENT),
      grant_daily_cap: fromCent(GRANT_DAILY_CAP_CENT),
      max_withdraw: fromCent(MAX_WITHDRAW_CENT),
      min_withdraw: fromCent(MIN_WITHDRAW_CENT)
    },
    recent: o.recent === false ? [] : (function () {
      var rows = db.prepare([
        'SELECT id, kind, initiator, memo, amount_cent, created_at, payload',
        'FROM xy_ledger_transactions ORDER BY id DESC LIMIT ?'
      ].join('\n')).all(Math.min(parseInt(o.recentLimit, 10) || 8, 50));
      return rows.map(function (r) {
        var meta = null;
        if (r.payload) { try { meta = JSON.parse(r.payload); } catch (e) {} }
        return {
          tx_id: r.id, kind: r.kind, kind_label: KINDS[r.kind] || r.kind,
          app: r.initiator, operator: r.initiator, memo: r.memo,
          amount: fromCent(r.amount_cent), meta: meta,
          created_at: msOf(r.created_at)
        };
      });
    })()
  };
}

// ---------- 币值健康度 ----------

function health(opts) {
  ensureSchema();
  var o = opts || {};
  var days = Math.min(Math.max(parseInt(o.days, 10) || 30, 1), 180);
  var sinceIso = isoOf(dayStartMs(now() - (days - 1) * 86400000));
  var rate = yuanRate();

  function toYuan4(cent) {
    return Math.round((Number(cent) || 0) / CENT_PER_YUAN / rate * 10000) / 10000;
  }

  var nAcc = db.prepare("SELECT COUNT(*) AS c FROM xy_ledger_accounts WHERE kind = 'user'").get().c;
  var cash = sumBalances('CASH', ['user']);
  var grant = sumBalances('GRANT', ['user']);
  var practice = sumBalances('PRACTICE', ['user']);
  var circ = cash + grant;

  var minted = sumKindsSince(['welcome', 'daily', 'admin_grant', 'reward'], sinceIso);
  var sunk = sumBalances('CASH', ['platform']); // 平台留存的手续费/毛利
  var recharged = sumKindsSince(['recharge'], sinceIso) - sumKindsSince(['recharge_revoke'], sinceIso);
  var withdrawn = sumKindsSince(['withdraw'], sinceIso);
  var withdrawable = cash; // 见 withdrawableCent：CASH 即可提现

  var pending = db.prepare(
    "SELECT COUNT(*) AS c, COALESCE(SUM(amount_cent), 0) AS s FROM xy_withdraw WHERE status = 'pending'"
  ).get();

  var mintPerDay = minted / days;
  var mintPerStudentDay = nAcc ? mintPerDay / nAcc : 0;
  var sinkRatio = minted > 0 ? sunk / minted : (sunk > 0 ? 1 : 0);
  var grantShare = circ > 0 ? grant / circ : 0;
  var avgBalance = nAcc ? circ / nAcc : 0;
  var depthDays = mintPerStudentDay > 0 ? avgBalance / mintPerStudentDay : 0;

  var warnings = [];
  function warn(level, code, text) { warnings.push({ level: level, code: code, text: text }); }

  if (nAcc > 0 && mintPerStudentDay > yuanToCent(1)) {
    warn('risk', 'mint_too_fast',
      '人均日铸币 ' + toYuan4(mintPerStudentDay) + ' 元，超过 1 元/天，等于每天白送一支笔');
  }
  if (minted > 0 && sinkRatio < 0.2) {
    warn('watch', 'weak_sink',
      '近 ' + days + ' 天回笼率仅 ' + (sinkRatio * 100).toFixed(1) + '%：只有发行没有销毁，长期会积压成「钱多货少」');
  }
  if (grantShare > 0.8 && circ > 0) {
    warn('watch', 'grant_heavy',
      '流通中 ' + Math.round(grantShare * 100) + '% 是不可提现的赠送学元：价格体系主要由发行支撑');
  }
  if (Number(pending.s) > cash) {
    warn('risk', 'pending_over_cash',
      '待审批提现 ' + fromCent(Number(pending.s)) + ' 学元，已超过账上现金学元');
  }
  if (nAcc > 0 && minted === 0 && circ > 0) {
    warn('watch', 'no_mint',
      '近 ' + days + ' 天没有任何发行：津贴可能已被关闭，学生失去了持续收入');
  }

  var level = 'ok';
  for (var k = 0; k < warnings.length; k++) {
    if (warnings[k].level === 'risk') { level = 'risk'; break; }
    level = 'watch';
  }

  var inv = invariants.check({});

  return {
    window_days: days,
    level: level,
    accounts: nAcc,
    circulation_cent: circ,
    circulation: fromCent(circ),
    circulation_yuan: centToYuan(circ, rate),
    cash_cent: cash,
    cash: fromCent(cash),
    cash_yuan: centToYuan(cash, rate),
    grant_cent: grant,
    grant: fromCent(grant),
    grant_share: Math.round(grantShare * 1000) / 1000,
    practice_cent: practice,
    practice: fromCent(practice),
    frozen_cent: 0,
    minted_window_cent: minted,
    minted_window: fromCent(minted),
    minted_per_day: fromCent(mintPerDay),
    minted_per_student_day: fromCent(mintPerStudentDay),
    sink_ratio: Math.round(sinkRatio * 1000) / 1000,
    recharged_window: fromCent(recharged),
    withdrawn_window: fromCent(withdrawn),
    withdrawable_cent: withdrawable,
    withdrawable: fromCent(withdrawable),
    reserve_coverage: withdrawable > 0 ? Math.round(cash / withdrawable * 1000) / 1000 : 1,
    pending_withdraw_count: pending.c,
    pending_withdraw_cent: Number(pending.s) || 0,
    depth_days: Math.round(depthDays * 10) / 10,
    avg_balance: fromCent(avgBalance),
    // 限额按「人民币元」透出，管理端直接展示，不在这里做二次换算
    limits: {
      max_transfer_yuan: centToYuan(MAX_TRANSFER_CENT, rate),
      max_recharge_yuan: centToYuan(MAX_RECHARGE_CENT, rate),
      recharge_quota_yuan: centToYuan(RECHARGE_QUOTA_CENT, rate),
      max_grant_yuan: centToYuan(MAX_GRANT_CENT, rate),
      grant_daily_cap_yuan: centToYuan(GRANT_DAILY_CAP_CENT, rate),
      max_withdraw_yuan: centToYuan(MAX_WITHDRAW_CENT, rate),
      min_withdraw_yuan: centToYuan(MIN_WITHDRAW_CENT, rate)
    },
    warnings: warnings,
    ledger: {
      ok: inv.ok,
      issues: inv.issues.length,
      detail: inv.issues.slice(0, 5)
    }
  };
}

// 对账：委托给账本自检（I1–I8），保持旧 {ok, issues:[{type,detail}]} 形状。
function audit() {
  var r = invariants.check({});
  return {
    ok: r.ok,
    checked: r.checked,
    issues: r.issues.map(function (i) { return { type: i.code, detail: i.detail }; }),
    totals: {
      cash_on_book_cent: invariants.cashOnBookCent(),
      cashbook_net_cent: invariants.cashbookNetCent(),
      pnl_cent: cashbook.totals().pnl_cent
    }
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
  parseAmountCent: parseAmountCent,
  requireAmountCent: requireAmountCent,
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
  grant: grant,
  refund: refund,
  transfer: transfer,
  splitPayable: splitPayable,
  splitPool: splitPool,
  splitPayOrder: splitPayOrder,
  rechargedInSemesterCent: rechargedInSemesterCent,
  grantedTodayCent: grantedTodayCent,
  semesterRange: semesterRange,
  dayStartMs: dayStartMs,
  hold: hold,
  release: release,
  settleHold: settleHold,
  credit: credit,
  creditTrade: creditTrade,
  investIn: investIn,
  investOut: investOut,
  recharge: recharge,
  revokeRecharge: revokeRecharge,
  requestWithdraw: requestWithdraw,
  reviewWithdraw: reviewWithdraw,
  cancelWithdraw: cancelWithdraw,
  listWithdrawals: listWithdrawals,
  listRecharges: listRecharges,
  claimDaily: claimDaily,
  history: history,
  leaderboard: leaderboard,
  summary: summary,
  health: health,
  audit: audit,
  LIMITS: {
    MAX_TRANSFER_CENT: MAX_TRANSFER_CENT,
    MAX_TX_CENT: MAX_TX_CENT,
    MAX_BALANCE_CENT: MAX_BALANCE_CENT,
    MAX_RECHARGE_CENT: MAX_RECHARGE_CENT,
    RECHARGE_QUOTA_CENT: RECHARGE_QUOTA_CENT,
    MAX_GRANT_CENT: MAX_GRANT_CENT,
    GRANT_DAILY_CAP_CENT: GRANT_DAILY_CAP_CENT,
    MAX_WITHDRAW_CENT: MAX_WITHDRAW_CENT,
    MIN_WITHDRAW_CENT: MIN_WITHDRAW_CENT,
    WELCOME_CENT: WELCOME_CENT,
    DAILY_CENT: DAILY_CENT,
    DAILY_BONUS_CENT: DAILY_BONUS_CENT,
    DAILY_BONUS_FROM_DAY: DAILY_BONUS_FROM_DAY
  }
};
