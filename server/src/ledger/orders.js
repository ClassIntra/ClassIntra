// 学元账本 · 订单状态机
// ============================================================
// 一条交易 = 一个状态机 + 一组分录。状态与资金**同一事务**写入。
//
// 撤回/退款是**状态迁移**，不是「反做一笔流水」—— 这是 v1 撤回 bug 的根治点。
//
//   created ─pay→ paid ─fulfill→ fulfilled ─settle→ done
//      │           │                  │
//    close      refund             refund
//      ↓           ↓                  ↓
//   closed      refunded          refunded
//                  │
//               dispute → disputed ─resolve→ done | refunded
//
// 编码约定：var / function（服务端 CommonJS 风格）

var db = require('../utils/db');
var ledger = require('./ledger');
var assets = require('./assets');
var settle = require('./settlement');
var cashbook = require('./cashbook');
var units = require('./units');

// 账本内部一律整数（学元分，1 元 = 1000 分）；报错文案给人看的是「元」。
// ⚠️ 不要用 100（人民币分）——那会把 100 元说成 10 元。
function toYuan(cent) { return Math.round(Number(cent) || 0) / units.UNITS_PER_YUAN; }

var STATUS = ['created', 'paid', 'fulfilled', 'done', 'closed', 'refunding', 'refunded', 'disputed'];

var ALLOWED = {
  created:   { paid: 1, closed: 1 },
  paid:      { fulfilled: 1, refunding: 1, refunded: 1, disputed: 1 },
  fulfilled: { done: 1, refunding: 1, refunded: 1, disputed: 1 },
  refunding: { refunded: 1, paid: 1 },
  disputed:  { done: 1, refunded: 1 },
  done:      {},
  closed:    {},
  refunded:  {}
};

function nowIso() { return new Date().toISOString(); }

function q(sql) { return db.prepare(sql); }

function getOrder(orderId) {
  var row = q('SELECT * FROM xy_ledger_orders WHERE id = ?').get(orderId);
  if (!row) throw new Error('订单不存在: ' + orderId);
  return row;
}

function getByRef(ref) {
  return q('SELECT * FROM xy_ledger_orders WHERE ref = ?').get(String(ref)) || null;
}

function assertStatus(order, expected) {
  var list = Array.isArray(expected) ? expected : [expected];
  if (list.indexOf(order.status) === -1) {
    throw new Error('订单状态不允许此操作：当前 ' + order.status + '，需要 ' + list.join('/'));
  }
}

function requireTransition(order, to) {
  var allowed = ALLOWED[order.status] || {};
  if (!allowed[to]) {
    throw new Error('非法状态迁移：' + order.status + ' → ' + to);
  }
}

// 写状态迁移。纯状态迁移（无资金）txId 传 null。
function writeTransition(order, to, txId, ref) {
  q([
    'INSERT INTO xy_ledger_order_transitions (order_id, from_status, to_status, tx_id, ref, created_at)',
    'VALUES (?, ?, ?, ?, ?, ?)'
  ].join(' ')).run(order.id, order.status, to, txId == null ? null : txId, String(ref), nowIso());
}

function patchOrder(orderId, fields) {
  var keys = Object.keys(fields);
  var sets = keys.map(function (k) { return k + ' = ?'; }).join(', ');
  var vals = keys.map(function (k) { return fields[k]; });
  vals.push(orderId);
  q('UPDATE xy_ledger_orders SET ' + sets + ' WHERE id = ?').run(...vals);
}

// ---------- 创建 ----------
// opts = { ref, buyer, seller: 'platform'|学号, goods_id, kind, asset,
//          face_cent, cost_cent, fee_cent, rebate_cent, initiator }
function create(opts) {
  var o = opts || {};
  var ref = String(o.ref == null ? '' : o.ref).trim();
  if (!ref) throw new Error('订单必须提供 ref');
  if (getByRef(ref)) throw new Error('订单 ref 已存在: ' + ref);

  var asset = assets.assertKnown(o.asset || 'CASH');
  if (asset.asset === 'PRACTICE') throw new Error('练习金不能用于订单（封闭资产）');

  // 有 goods_id 时价格与卖家一律以商品为准，避免调用方自己算错面值
  var goodsId = o.goods_id == null ? null : Number(o.goods_id);
  var face;
  var cost;
  var sellerAccount;

  if (goodsId != null) {
    var g = q('SELECT * FROM xy_ledger_goods WHERE id = ?').get(goodsId);
    if (!g) throw new Error('商品不存在: ' + goodsId);
    if (g.status !== 'on_shelf') throw new Error('商品已下架');
    var qty = Math.max(1, Math.floor(Number(o.qty) || 1));
    face = g.price_cent * qty;
    cost = o.cost_cent == null ? g.cost_cent * qty : Math.max(0, Math.floor(Number(o.cost_cent)));
    sellerAccount = q('SELECT * FROM xy_ledger_accounts WHERE id = ?').get(g.seller_account_id);
  } else {
    face = Number(o.face_cent);
    cost = Math.max(0, Math.floor(Number(o.cost_cent) || 0));
    sellerAccount = (o.seller && String(o.seller) !== 'platform')
      ? ledger.accountOf('user', o.seller)
      : ledger.systemAccount('platform');
  }

  if (!isFinite(face) || Math.floor(face) !== face || face <= 0) throw new Error('订单面值必须是正整数分');

  // 2026-11-07 定：商品只能用自己充值的学元购买。
  // 赠金（津贴 / 成就 / 同学转账 / 红包 / 证券撤出的投资收益）只能转账、发红包，
  // 不构成购买力。这条放在 create 而不是只放在路由，是因为服务层也可能被内部代码调用。
  // 需要「补一件商品给学生」时，走发放（grant），不要走订单。
  if (asset.asset !== 'CASH') {
    throw new Error('商品只能用充值学元购买：赠送学元（含投资收益）可以转账、发红包，但不能买东西');
  }

  var fee = Math.max(0, Math.floor(Number(o.fee_cent) || 0));
  var rebate = Math.max(0, Math.floor(Number(o.rebate_cent) || 0));
  if (fee > face) throw new Error('抽成不能超过面值');
  if (rebate > face) throw new Error('返现不能超过面值');

  var buyer = ledger.accountOf('user', o.buyer);

  var kind = String(o.kind || 'goods');
  if (['goods', 'transfer', 'fee'].indexOf(kind) === -1) throw new Error('未知订单类型: ' + kind);

  var info = q([
    'INSERT INTO xy_ledger_orders',
    '(ref, buyer_account_id, seller_account_id, goods_id, kind, status, asset,',
    ' face_cent, cost_cent, rebate_cent, fee_cent, created_at)',
    "VALUES (?, ?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?)"
  ].join(' ')).run(
    ref, buyer.id, sellerAccount.id,
    goodsId,
    kind, asset.asset, face, cost, rebate, fee, nowIso()
  );

  return getOrder(Number(info.lastInsertRowid));
}

// ---------- 支付：钱进托管 ----------
// 支付不是「调用方指定用哪个池扣」，而是按制度算出来的：
//   · 权益订单（asset=GRANT）→ 全额走 GRANT
//   · CASH 订单 → 赠金最多抵扣「本单毛利」，剩下必须真金
// 让调用方自选资产是最容易被绕过的一步：只要传 asset='GRANT'，
// 零成本发行的赠金就能买走有真实成本的实物，亏的是平台的现金。
// 支付拆池：**商品只收充值学元**，所以这里恒为「全额 CASH」。
// 之所以还留成函数：pay 与试算接口共用同一份口径，改规则只改一处。
function paySplitCent(order) {
  var face = Number(order.face_cent) || 0;
  if (String(order.asset).toUpperCase() !== 'CASH') {
    throw new Error('订单资产非法：商品订单只能是 CASH');
  }

  var buyer = settle.accountRow(order.buyer_account_id);
  var b = ledger.userBalances(buyer.owner_id);
  var cashAvail = Math.max(0, b.CASH);
  var grantAvail = Math.max(0, b.GRANT);

  // 赠金抵扣上限由 settlement.maxGrantOffsetCent 决定，现在恒为 0。
  // 留着这次乘法而不是直接写 0，是为了让「抵扣被重新打开」只能改一处、且会被 I9 抓到。
  var cap = settle.maxGrantOffsetCent(order);
  var useGrant = Math.min(grantAvail, cap, face);
  var useCash = face - useGrant;

  if (useCash > cashAvail) {
    throw new Error('充值学元不足：本单 ' + toYuan(face) + ' 元，只能用自己充值的学元购买' +
      (grantAvail > 0
        ? '（你有 ' + toYuan(grantAvail) + ' 元赠送/投资学元，可以转账、发红包，但不能买东西）'
        : '') +
      '，还差 ' + toYuan(useCash - cashAvail) + ' 元');
  }
  return { cash: useCash, grant: useGrant };
}

function pay(orderId, opts) {
  var o = opts || {};
  var order = getOrder(orderId);
  assertStatus(order, 'created');
  var ref = String(o.ref || (order.ref + ':pay'));

  var run = db.transaction(function () {
    var parts = paySplitCent(order, o);
    var entries = [];
    if (parts.grant > 0) {
      entries.push({ account_id: order.buyer_account_id, asset: 'GRANT', direction: -1, amount_cent: parts.grant });
      entries.push({ account_id: settle.escrowId(), asset: 'GRANT', direction: 1, amount_cent: parts.grant });
    }
    if (parts.cash > 0) {
      entries.push({ account_id: order.buyer_account_id, asset: 'CASH', direction: -1, amount_cent: parts.cash });
      entries.push({ account_id: settle.escrowId(), asset: 'CASH', direction: 1, amount_cent: parts.cash });
    }
    if (!entries.length) throw new Error('订单金额为 0，无需支付');

    var tx = ledger.post({
      ref: ref,
      kind: 'order_pay',
      initiator: o.initiator,
      memo: '订单支付 #' + order.id,
      entries: entries
    });

    if (!tx.duplicate) {
      var ins = q([
        'INSERT INTO xy_ledger_holds (order_id, buyer_account_id, seller_account_id, asset, amount_cent, state)',
        "VALUES (?, ?, ?, ?, ?, 'held')"
      ].join(' '));
      if (parts.grant > 0) ins.run(order.id, order.buyer_account_id, order.seller_account_id, 'GRANT', parts.grant);
      if (parts.cash > 0) ins.run(order.id, order.buyer_account_id, order.seller_account_id, 'CASH', parts.cash);

      writeTransition(order, 'paid', tx.tx_id, ref);
      patchOrder(order.id, { status: 'paid', paid_at: nowIso() });
    }
    var out = getOrder(order.id);
    out.paid_grant_cent = parts.grant;
    out.paid_cash_cent = parts.cash;
    return out;
  });

  return run();
}

// ---------- 履约：无资金动作 ----------
function fulfill(orderId, opts) {
  var o = opts || {};
  var order = getOrder(orderId);
  assertStatus(order, 'paid');
  var ref = String(o.ref || (order.ref + ':fulfill'));

  var run = db.transaction(function () {
    requireTransition(order, 'fulfilled');
    writeTransition(order, 'fulfilled', null, ref);
    patchOrder(order.id, { status: 'fulfilled', fulfilled_at: nowIso() });
    return getOrder(order.id);
  });

  return run();
}

// ---------- 结算：托管 → 卖家 / 平台 ----------
function settleOrder(orderId, opts) {
  var o = opts || {};
  var order = getOrder(orderId);
  assertStatus(order, ['fulfilled', 'disputed']);
  var ref = String(o.ref || (order.ref + ':settle'));

  var run = db.transaction(function () {
    requireTransition(order, 'done');
    var tx = ledger.post({
      ref: ref,
      kind: 'order_settle',
      initiator: o.initiator,
      memo: '订单结算 #' + order.id,
      entries: settle.settleEntries(order)
    });

    var cost = settle.realCostCent(order);
    if (cost > 0) {
      cashbook.record({
        tx_id: tx.tx_id,
        type: 'goods_cost',
        amount_cent: -cost,
        ref: ref + ':cost',
        note: '订单真实成本 #' + order.id
      });
    }

    q("UPDATE xy_ledger_holds SET state = 'settled' WHERE order_id = ? AND state = 'held'").run(order.id);
    writeTransition(order, 'done', tx.tx_id, ref);
    patchOrder(order.id, { status: 'done', closed_at: nowIso() });
    return getOrder(order.id);
  });

  return run();
}

// ---------- 退款：托管原路退回（撤回也走这里） ----------
function refund(orderId, opts) {
  var o = opts || {};
  var order = getOrder(orderId);
  assertStatus(order, ['paid', 'fulfilled', 'refunding', 'disputed']);
  var ref = String(o.ref || (order.ref + ':refund'));

  var run = db.transaction(function () {
    requireTransition(order, 'refunded');
    var tx = ledger.post({
      ref: ref,
      kind: 'order_refund',
      initiator: o.initiator,
      memo: '订单退款 #' + order.id + (o.reason ? '：' + o.reason : ''),
      entries: settle.refundEntries(order)
    });

    q("UPDATE xy_ledger_holds SET state = 'released' WHERE order_id = ? AND state = 'held'").run(order.id);
    writeTransition(order, 'refunded', tx.tx_id, ref);
    patchOrder(order.id, { status: 'refunded', closed_at: nowIso() });
    return getOrder(order.id);
  });

  return run();
}

// 先发起退款（待确认），可再 refund 完成
function requestRefund(orderId, opts) {
  var o = opts || {};
  var order = getOrder(orderId);
  assertStatus(order, ['paid', 'fulfilled']);
  var ref = String(o.ref || (order.ref + ':refunding'));

  var run = db.transaction(function () {
    requireTransition(order, 'refunding');
    writeTransition(order, 'refunding', null, ref);
    patchOrder(order.id, { status: 'refunding' });
    return getOrder(order.id);
  });

  return run();
}

// ---------- 关单（未支付） ----------
function close(orderId, opts) {
  var o = opts || {};
  var order = getOrder(orderId);
  assertStatus(order, 'created');
  var ref = String(o.ref || (order.ref + ':close'));

  var run = db.transaction(function () {
    requireTransition(order, 'closed');
    writeTransition(order, 'closed', null, ref);
    patchOrder(order.id, { status: 'closed', closed_at: nowIso() });
    return getOrder(order.id);
  });

  return run();
}

// ---------- 争议 ----------
function dispute(orderId, opts) {
  var o = opts || {};
  var order = getOrder(orderId);
  assertStatus(order, ['paid', 'fulfilled']);
  var ref = String(o.ref || (order.ref + ':dispute'));

  var run = db.transaction(function () {
    requireTransition(order, 'disputed');
    writeTransition(order, 'disputed', null, ref);
    patchOrder(order.id, { status: 'disputed' });
    return getOrder(order.id);
  });

  return run();
}

// ---------- 超时关单 ----------
// 未支付的订单压着列表、也让学生以为「我买了」。没有定时任务，就懒清理：
// 拉列表时顺手把超过 30 分钟的 created 关掉。全部关单，无资金动作。
function sweepUnpaid(maxAgeMs, opts) {
  var o = opts || {};
  var age = Math.max(60000, Number(maxAgeMs) || 30 * 60 * 1000);
  var cutoff = new Date(Date.now() - age).toISOString();
  var rows = q("SELECT id FROM xy_ledger_orders WHERE status = 'created' AND created_at <= ?").all(cutoff);
  var n = 0;
  rows.forEach(function (r) {
    try {
      close(r.id, { ref: 'auto-close:' + r.id, reason: o.reason || '超时未支付' });
      n++;
    } catch (e) { /* 下一轮再试 */ }
  });
  return n;
}

// ---------- 查询 ----------
function list(opts) {
  var o = opts || {};
  if (o.sweep !== false) sweepUnpaid(o.maxAgeMs);

  var where = [];
  var args = [];
  var buyer = ledger.findAccount('user', o.buyer);
  var sellerId = o.seller && String(o.seller) !== 'platform' ? ledger.findAccount('user', o.seller) : null;

  if (buyer) { where.push('o.buyer_account_id = ?'); args.push(buyer.id); }
  if (sellerId) { where.push('o.seller_account_id = ?'); args.push(sellerId.id); }
  if (o.status) {
    var sts = Array.isArray(o.status) ? o.status : String(o.status).split(',');
    sts = sts.filter(Boolean);
    if (sts.length) {
      where.push('o.status IN (' + sts.map(function () { return '?'; }).join(',') + ')');
      sts.forEach(function (s) { args.push(String(s)); });
    }
  }
  // 「进行中」：所有还没落定的单（学生视角最关心的那一栏）
  if (o.openOnly) where.push("o.status IN ('created','paid','fulfilled','refunding','disputed')");
  if (o.asset) { where.push('o.asset = ?'); args.push(String(o.asset).toUpperCase()); }
  if (o.goodsId) { where.push('o.goods_id = ?'); args.push(Number(o.goodsId)); }

  var beforeId = parseInt(o.beforeId, 10) || 0;
  if (beforeId > 0) { where.push('o.id < ?'); args.push(beforeId); }

  var limit = Math.min(Math.max(parseInt(o.limit, 10) || 30, 1), 200);
  args.push(limit);

  var sql = [
    'SELECT o.*, g.name AS goods_name, g.kind AS goods_kind,',
    '  a.owner_id AS buyer_id, s.owner_id AS seller_id',
    'FROM xy_ledger_orders o',
    'LEFT JOIN xy_ledger_goods g ON g.id = o.goods_id',
    'LEFT JOIN xy_ledger_accounts a ON a.id = o.buyer_account_id',
    'LEFT JOIN xy_ledger_accounts s ON s.id = o.seller_account_id',
    where.length ? 'WHERE ' + where.join(' AND ') : '',
    'ORDER BY o.id DESC LIMIT ?'
  ].filter(Boolean).join('\n');
  return q(sql).all(...args);
}

function detail(orderId) {
  var order = getOrder(orderId);
  order.holds = q('SELECT * FROM xy_ledger_holds WHERE order_id = ? ORDER BY id').all(order.id);
  order.transitions = q('SELECT * FROM xy_ledger_order_transitions WHERE order_id = ? ORDER BY id').all(order.id);

  // 越权校验需要「账号」而不是内部 account_id；把 owner 一起带出来
  var b = q('SELECT kind, owner_id FROM xy_ledger_accounts WHERE id = ?').get(order.buyer_account_id);
  var s = q('SELECT kind, owner_id FROM xy_ledger_accounts WHERE id = ?').get(order.seller_account_id);
  order.buyer_owner = b ? String(b.owner_id || '') : '';
  order.seller_owner = s ? String(s.owner_id || '') : '';
  order.buyer_kind = b ? b.kind : '';
  order.seller_kind = s ? s.kind : '';
  return order;
}

// 订单归属校验（纯函数，便于单测）。
// 平台自营时 seller_owner 为空串，所以「履约」这类卖家动作只有班管能做。
// mode: buyer | seller | party
// opts.isAdmin 为 true 时班管放行。
function assertAccess(d, actor, mode, opts) {
  var o = opts || {};
  if (o.isAdmin) return true;
  var uid = String(actor == null ? '' : actor);
  if (!uid) throw new Error('无权操作此订单');
  var m = mode || 'buyer';
  var isBuyer = String(d.buyer_owner || '') === uid;
  var isSeller = String(d.seller_owner || '') === uid;
  if (m === 'buyer' && isBuyer) return true;
  if (m === 'seller' && isSeller) return true;
  if (m === 'party' && (isBuyer || isSeller)) return true;
  throw new Error('无权操作此订单');
}

module.exports = {
  STATUS: STATUS,
  ALLOWED: ALLOWED,
  create: create,
  pay: pay,
  paySplitCent: paySplitCent,
  fulfill: fulfill,
  settle: settleOrder,
  refund: refund,
  requestRefund: requestRefund,
  close: close,
  sweepUnpaid: sweepUnpaid,
  dispute: dispute,
  get: getOrder,
  getByRef: getByRef,
  list: list,
  detail: detail,
  assertAccess: assertAccess
};
