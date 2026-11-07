// 学元账本 HTTP 接口（/api/xy）
// ============================================================
// 只做参数解析、鉴权、错误映射；所有业务在 src/ledger/ 里。
// 返回格式与 wallet 一致：成功 { code: 200, message, data }，失败 { code: 400|500, message }
//
// 所有写接口都要求写操作自带幂等键：优先取 Idempotency-Key 头，其次 body.ref，
// 都没有就生成一个 —— 生成等于放弃跨请求幂等，但至少挡住双击。
//
// 编码约定：var / function

var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var svc = require('../ledger/service');
var ledger = require('../ledger/ledger');
var units = require('../ledger/units');

function fail(res, err) {
  var msg = err && err.message ? err.message : '操作失败';
  var known = /余额不足|不能|必须|不存在|非法|上限|超过|未知|不可|已存在|已领|已关闭|已返现|没有|不允许|至少|不能为空|太小|重复|封闭|尚未建表|已完成|状态/.test(msg);
  if (!known) console.error('[ledger] 未预期错误:', err);
  return res.status(known ? 400 : 500).json({ code: known ? 400 : 500, message: msg });
}

function ok(res, data, message) {
  return res.json({ code: 200, message: message || 'ok', data: data });
}

function genRef(prefix) {
  return prefix + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 10);
}

function refOf(req, prefix) {
  return String(req.get('Idempotency-Key') || (req.body && req.body.ref) || genRef(prefix));
}

function centOf(body) {
  var b = body || {};
  if (b.amount_cent != null) return Number(b.amount_cent);
  // 学元分：1 元 = 1000，不是人民币分的 100
  if (b.amount_yuan != null) return units.yuanToUnits(b.amount_yuan);
  return NaN;
}

function isAdmin(req) {
  return !!(req.user && (req.user.is_admin === 1 || req.user.is_class_admin === true));
}

// 取订单并校验归属。任何登录用户都能传别人的订单 id —— 不校验就能替别人
// 支付、关单、发起争议，等于把别人的钱当按钮按。
function orderFor(req, id, mode) {
  var d = svc.orders.detail(Number(id));
  svc.orders.assertAccess(d, String(req.user.user_id), mode, { isAdmin: isAdmin(req) });
  return d;
}

function wrap(fn) {
  return function (req, res) {
    try {
      svc.ensureReady();
      return fn(req, res);
    } catch (e) {
      return fail(res, e);
    }
  };
}

router.use(auth.requireAuth);

// ---------- 余额 ----------
router.get('/balance', wrap(function (req, res) {
  var uid = String(req.user.user_id);
  return ok(res, {
    user_id: uid,
    balances: svc.balanceOf(uid),
    assets: svc.assets.list(),
    note: 'CASH 可提现；GRANT 只能抵扣；PRACTICE 封闭不可出域'
  });
}));

// ---------- 充值 / 提现 ----------
// ---------- 学生资金动作：本接口面不再提供 ----------
// 学元体系只能有一个「花钱 / 收钱」的入口。这里曾经也提供 transfer / withdraw，
// 但它们分别绕过了两件已经做好的事：
//   · 转账没走 pay-guard → 不验支付密码、不卡当日转出额度
//   · 提现直接扣款 → 跳过班管审批，也跳过「只能提自己的净充值」这条限制
// 两个入口 = 两套风控，且总有一个是漏的。所以这里一律 410，把流量导回唯一的门。
function gone(res, to, why) {
  return res.status(410).json({ code: 410, message: why + '；请改用 ' + to });
}

router.post('/transfer', wrap(function (req, res) {
  return gone(res, 'POST /api/xueyuan/transfer 或 POST /api/wallet/transfer',
    '转账需要支付密码与当日额度校验，本接口不再提供');
}));

router.post('/withdraw', wrap(function (req, res) {
  return gone(res, 'POST /api/xueyuan/withdraw/request',
    '提现需要班管审批，本接口不再直接扣款');
}));

router.post('/recharge', auth.requireAdmin, wrap(function (req, res) {
  return gone(res, 'POST /api/xueyuan/admin/recharge',
    '充值要写充值凭证、占用学期配额并记真金台账，本接口不再提供');
}));

// ---------- 发放（班管） ----------
router.post('/issue', auth.requireAdmin, wrap(function (req, res) {
  var r = svc.issue({
    to: String(req.body && req.body.to),
    asset: (req.body && req.body.asset) || 'GRANT',
    amount_cent: centOf(req.body),
    ref: refOf(req, 'issue'),
    operator: String(req.user.user_id),
    memo: req.body && req.body.memo,
    maxCent: req.body && req.body.max_cent,
    dailyCapCent: req.body && req.body.daily_cap_cent
  });
  return ok(res, r, '发放成功');
}));

// ---------- 商品 ----------
router.get('/goods', wrap(function (req, res) {
  return ok(res, svc.goods.list({ status: req.query.status || 'on_shelf', limit: req.query.limit }));
}));

router.post('/goods', auth.requireAdmin, wrap(function (req, res) {
  var b = req.body || {};
  var r = svc.goods.create({
    name: b.name,
    price_cent: Number(b.price_cent),
    cost_cent: Number(b.cost_cent || 0),
    kind: b.kind || 'digital',
    seller: b.seller || 'platform',
    allowLoss: !!b.allow_loss
  });
  return ok(res, r, '商品已上架');
}));

router.post('/goods/:id/status', auth.requireAdmin, wrap(function (req, res) {
  return ok(res, svc.goods.setStatus(Number(req.params.id), req.body && req.body.status));
}));

// ---------- 订单 ----------
// 支付试算：告诉前端「这单要多少充值学元、够不够」。
// 必须由服务端算，而且**不能抛错** —— 钱不够是要展示的信息，不是失败。
router.get('/orders/quote', wrap(function (req, res) {
  var goodsId = Number(req.query.goods_id);
  if (!(goodsId > 0)) throw new Error('缺少商品参数');
  var qty = Math.max(1, Math.floor(Number(req.query.qty) || 1));
  var g = svc.goods.get(goodsId);
  if (g.status !== 'on_shelf') throw new Error('商品已下架');

  var uid = String(req.user.user_id);
  var buyerAcc = svc.ledger.openUser(uid);
  var bal = svc.ledger.userBalances(uid);
  var draft = {
    face_cent: g.price_cent * qty,
    cost_cent: g.cost_cent * qty,
    asset: 'CASH',
    seller_account_id: g.seller_account_id,
    fee_cent: 0,
    buyer_account_id: buyerAcc.id
  };

  var parts;
  try {
    parts = svc.orders.paySplitCent(draft);
  } catch (e) {
    parts = { cash: draft.face_cent, grant: 0 };
  }
  var shortCent = Math.max(0, parts.cash - Math.max(0, bal.CASH));

  return ok(res, {
    goods_id: g.id,
    name: g.name,
    qty: qty,
    face_cent: draft.face_cent,
    cash_cent: parts.cash,
    grant_cent: parts.grant,            // 恒为 0：赠金不能买东西
    max_grant_cent: svc.settlement.maxGrantOffsetCent(draft),
    cash_only: true,
    balance_cash_cent: Math.max(0, bal.CASH),
    balance_grant_cent: Math.max(0, bal.GRANT),
    short_cent: shortCent,
    enough: shortCent === 0
  });
}));

router.post('/orders', wrap(function (req, res) {
  var b = req.body || {};
  var uid = String(req.user.user_id);
  // 懒开户：第一次进来就能下单，不用先「激活钱包」
  svc.ledger.openUser(uid);
  var payload = {
    ref: refOf(req, 'order'),
    buyer: uid,
    // 固定 CASH：**不接受调用方指定资产**。
    // 允许传 asset='GRANT' 等于给了「用赚来的学元白拿商品」的后门，
    // 而这正是本轮制度要关掉的东西（赠送/投资收益只能转账、发红包）。
    asset: 'CASH',
    kind: b.kind || 'goods',
    fee_cent: Number(b.fee_cent || 0),
    rebate_cent: Number(b.rebate_cent || 0)
  };

  if (b.goods_id != null) {
    var g = svc.goods.get(Number(b.goods_id));
    if (g.status !== 'on_shelf') throw new Error('商品已下架');
    var qty = Math.max(1, Number(b.qty) || 1);
    payload.goods_id = g.id;
    payload.face_cent = g.price_cent * qty;
    payload.cost_cent = g.cost_cent * qty;
    payload.seller = g.seller_kind === 'platform' ? 'platform' : g.seller_owner;
  } else {
    payload.face_cent = centOf(b);
    payload.cost_cent = Number(b.cost_cent || 0);
    payload.seller = b.seller || 'platform';
  }

  return ok(res, svc.orders.create(payload), '订单已创建');
}));

router.get('/orders', wrap(function (req, res) {
  var admin = isAdmin(req);
  return ok(res, svc.orders.list({
    // 非管理员只能看自己的单；管理员可看全部或指定买家
    buyer: admin ? (req.query.buyer || null) : String(req.user.user_id),
    status: req.query.status || null,
    openOnly: req.query.open === '1',
    asset: req.query.asset,
    goodsId: req.query.goods_id,
    beforeId: req.query.beforeId,
    limit: req.query.limit
  }));
}));

router.get('/orders/:id', wrap(function (req, res) {
  return ok(res, orderFor(req, req.params.id, 'party'));
}));

router.post('/orders/:id/pay', wrap(function (req, res) {
  var id = Number(req.params.id);
  orderFor(req, id, 'buyer');
  return ok(res, svc.orders.pay(id, {
    ref: refOf(req, 'pay'),
    initiator: String(req.user.user_id)
  }), '支付成功');
}));

router.post('/orders/:id/fulfill', wrap(function (req, res) {
  var id = Number(req.params.id);
  orderFor(req, id, 'seller');
  return ok(res, svc.orders.fulfill(id, { ref: refOf(req, 'fulfill') }), '已标记履约');
}));

router.post('/orders/:id/settle', auth.requireAdmin, wrap(function (req, res) {
  return ok(res, svc.orders.settle(Number(req.params.id), {
    ref: refOf(req, 'settle'),
    initiator: String(req.user.user_id)
  }), '已结算');
}));

router.post('/orders/:id/refund', auth.requireAdmin, wrap(function (req, res) {
  return ok(res, svc.orders.refund(Number(req.params.id), {
    ref: refOf(req, 'refund'),
    initiator: String(req.user.user_id),
    reason: req.body && req.body.reason
  }), '已退款');
}));

router.post('/orders/:id/refund-request', wrap(function (req, res) {
  var id = Number(req.params.id);
  orderFor(req, id, 'buyer');
  return ok(res, svc.orders.requestRefund(id, { ref: refOf(req, 'refunding') }), '已发起退款');
}));

router.post('/orders/:id/close', wrap(function (req, res) {
  var id = Number(req.params.id);
  orderFor(req, id, 'buyer');
  return ok(res, svc.orders.close(id, { ref: refOf(req, 'close') }), '已关单');
}));

router.post('/orders/:id/dispute', wrap(function (req, res) {
  var id = Number(req.params.id);
  orderFor(req, id, 'buyer');
  return ok(res, svc.orders.dispute(id, { ref: refOf(req, 'dispute') }), '已发起争议');
}));

// ---------- 返现 ----------
router.get('/orders/:id/rebate', wrap(function (req, res) {
  orderFor(req, req.params.id, 'party');
  return ok(res, svc.rebate.preview(Number(req.params.id)));
}));

router.post('/orders/:id/rebate', auth.requireAdmin, wrap(function (req, res) {
  var b = req.body || {};
  return ok(res, svc.rebate.give({
    orderId: Number(req.params.id),
    amount_cent: centOf(b),
    asset: b.asset || 'GRANT'
  }), '返现已发放');
}));

// ---------- 红包（本路由面不提供） ----------
// 红包唯一实现在 services/yuanbao.js（/api/wallet），统一过 payGuard 风控。
// 这里曾并存一套 ledger 红包（前端零调用、不走统一风控，「两个入口=两套风控」），
// 2026-11-07 随 v1.7.0 发布收敛移除；回归绊线见 scripts-test-ledger-routes.cjs 第 6 节。

// ---------- 健康度（班管） ----------
router.get('/admin/health', auth.requireAdmin, wrap(function (req, res) {
  // 未显式传储备时，用「真金台账净额」当在手现金：这才是真实的兑付能力
  var reserve = req.query.reserve_cent != null
    ? Number(req.query.reserve_cent)
    : svc.invariants.cashbookNetCent();
  return ok(res, svc.invariants.health({ reserveCent: reserve }));
}));

router.get('/admin/ledger/:txId', auth.requireAdmin, wrap(function (req, res) {
  var tx = ledger.getTx(Number(req.params.txId));
  if (!tx) throw new Error('交易不存在');
  return ok(res, tx);
}));

module.exports = router;
