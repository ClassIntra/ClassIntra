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
var loan = require('../ledger/loan');
var units = require('../ledger/units');
var errors = require('../ledger/errors');
var treasury = require('../middleware/treasury');
var db = require('../utils/db');

// 兼容兜底：只对「非 LedgerError 的普通 Error」生效，保持既有 HTTP 判定不变。
// 新内核抛出的每个拒绝自带 code，优先按 code 定状态码，不再靠中文正则猜。
var KNOWN_MSG = /余额不足|不能|必须|不存在|非法|不合法|上限|超过|未知|不可|已存在|已领|已关闭|已返现|没有|不允许|至少|不能为空|太小|重复|封闭|尚未建表|已完成|状态|贷款|还款|逾期|核销|额度池|分期|暂停|产品|期数|调分|限额|拉黑|延期|金额|额度/;

function fail(res, err) {
  var le = errors.normalize(err);
  var msg = le.message;
  var status;
  var code;
  if (errors.isKnown(err)) {
    status = le.httpStatus;
    code = le.code;
    if (status >= 500) console.error('[ledger] 账本内部错误:', err);
  } else if (KNOWN_MSG.test(msg)) {
    status = 400;
    code = 'BUSINESS_RULE';
  } else {
    // 保持原行为：未命中的普通 Error 仍是 500，不悄悄改变既有判定
    status = 500;
    code = 'UNCLASSIFIED';
    console.error('[ledger] 未预期错误:', err);
  }
  // error_code 是新增字段，前端只读 code/message，不影响既有调用方
  return res.status(status).json({ code: status, error_code: code, message: msg });
}

function ok(res, data, message) {
  // 没有幂等键的请求在兼容期仍会生成 ref，但响应头明确告知「这次没有跨请求幂等」，
  // 探针与前端能据此发现问题，而不是以为自己已经受保护。
  if (res.req && res.req._ledgerGeneratedRef) {
    res.set('X-Ledger-Idempotency', 'generated');
  }
  return res.json({ code: 200, message: message || 'ok', data: data });
}

function genRef(prefix) {
  return prefix + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 10);
}

// 严格模式：LEDGER_REQUIRE_IDEMPOTENCY_KEY=1 时所有写操作必须自带键。
// 默认关闭 —— 现网前端尚未全量补齐，一步切成强制会把正常业务挡在门外；
// 打开前先用 X-Ledger-Idempotency 响应头巡检一轮，确认零 generated 再切。
var STRICT_IDEMPOTENCY = String(process.env.LEDGER_REQUIRE_IDEMPOTENCY_KEY || '') === '1';

function refOf(req, prefix) {
  var key = req.get('Idempotency-Key') || (req.body && req.body.ref);
  if (key) return String(key);
  if (STRICT_IDEMPOTENCY) {
    throw errors.of('MISSING_REF', '写操作必须提供 Idempotency-Key 或 body.ref（严格幂等模式）');
  }
  req._ledgerGeneratedRef = true;
  return genRef(prefix);
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
      // 事务内的失败凭证可能随回滚消失，路由层在事务外补一份，保证「失败必有痕」
      try {
        var le = errors.normalize(e);
        ledger.recordAttempt(
          String(req.get('Idempotency-Key') || (req.body && req.body.ref) || ''),
          null, le, req.user ? String(req.user.user_id) : null
        );
      } catch (ignore) { /* 留痕失败不能掩盖原错误 */ }
      return fail(res, e);
    }
  };
}

router.use(auth.requireAuth);

// 从班班管不得借「管理员身份」越权操作别人的订单 / 商品。
// 这些动作本靠 assertAccess 判归属，但 isAdmin 会放行 —— 于是 member 角色下
// 班管仍能替任何人支付 / 结算 / 退款 / 下架。这里只拦管理员：学生与卖家
// 本人直接 next，不改变任何正常业务路径。用路径模式而非逐个端点挂，
// 后续新增订单动作会自动覆盖，不会再漏一次。
router.use(function (req, res, next) {
  var mixed = /^\/orders\/[^/]+\/[a-z-]+$/.test(req.path) ||
              /^\/goods\/[^/]+\/status$/.test(req.path);
  if (!mixed) return next();
  return treasury.treasuryForAdmins(req, res, next);
});

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

router.post('/recharge', treasury.requireTreasury, wrap(function (req, res) {
  return gone(res, 'POST /api/xueyuan/admin/recharge',
    '充值要写充值凭证、占用学期配额并记真金台账，本接口不再提供');
}));

// ---------- 发放（班管） ----------
router.post('/issue', treasury.requireTreasury, wrap(function (req, res) {
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
  return ok(res, svc.goods.list({
    status: req.query.status || 'on_shelf',
    limit: req.query.limit,
    q: req.query.q || '',
    // C2C 市集：卖家查自己的商品（我的小铺）
    seller: req.query.seller || null
  }));
}));

router.post('/goods', treasury.requireTreasury, wrap(function (req, res) {
  var b = req.body || {};
  var r = svc.goods.create({
    name: b.name,
    description: b.description || '',
    cover: b.cover || '',
    price_cent: Number(b.price_cent),
    cost_cent: Number(b.cost_cent || 0),
    kind: b.kind || 'digital',
    stock_qty: b.stock_qty == null ? -1 : Number(b.stock_qty),
    seller: b.seller || 'platform',
    allowLoss: !!b.allow_loss
  });
  return ok(res, r, '商品已上架');
}));

// 学生开店（C2C 市集）：任何人都可以上架以自己为卖家的商品。
// 卖家收款走本人 user 账户（orders 结算时按 seller_account_id 分账），
// 平台成本/毛利口径只对自营生效 —— 同学之间交易不给平台记一分「利润」。
// 上限沿用班管同款校验（svc.goods.create 内部），越权内容班管可在管理端下架。
router.post('/market/goods', wrap(function (req, res) {
  var b = req.body || {};
  var r = svc.goods.create({
    name: b.name,
    description: b.description || '',
    cover: b.cover || '',
    price_cent: Number(b.price_cent),
    cost_cent: 0,                        // 成本是平台自营口径，同学商品没有
    kind: b.kind === 'physical' ? 'physical' : (b.kind === 'service' ? 'service' : 'digital'),
    stock_qty: b.stock_qty == null ? -1 : Number(b.stock_qty),
    seller: String(req.user.user_id),    // 卖家强制本人，不可自报
    allowLoss: false
  });
  return ok(res, r, '你的商品已上架');
}));

// 下架/重新上架：班管任意商品都可管；同学卖家只能动自己的商品
router.post('/goods/:id/status', wrap(function (req, res) {
  var g = svc.goods.get(Number(req.params.id));
  var isOwner = g && g.seller_kind === 'user' && String(g.seller_owner) === String(req.user.user_id);
  if (!isAdmin(req) && !isOwner) {
    return res.status(403).json({ code: 403, message: '只有班管或商品主人可以操作' });
  }
  return ok(res, svc.goods.setStatus(Number(req.params.id), req.body && req.body.status));
}));

// ---------- 订单 ----------
// 支付试算：告诉前端「这单要多少充值学元、够不够」。
// 必须由服务端算，而且**不能抛错** —— 钱不够是要展示的信息，不是失败。
router.get('/orders/quote', wrap(function (req, res) {
  var goodsId = Number(req.query.goods_id);
  if (!(goodsId > 0)) throw new Error('缺少商品参数');
  var qty = Math.max(1, Math.floor(Number(req.query.qty) || 1));
  if (qty > 999) throw new Error('单笔最多购买 999 件');
  var g = svc.goods.get(goodsId);
  if (g.status !== 'on_shelf') throw new Error('商品已下架');
  if (Number(g.stock_qty) >= 0 && qty > Number(g.stock_qty)) {
    throw new Error('库存不足：只剩 ' + Number(g.stock_qty) + ' 件');
  }

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
    description: g.description || '',
    cover: g.cover || '',
    qty: qty,
    unit_price_cent: g.price_cent,
    stock_qty: Number(g.stock_qty),
    sold_qty: Number(g.sold_qty) || 0,
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
    note: b.note || '',
    fee_cent: Number(b.fee_cent || 0),
    rebate_cent: Number(b.rebate_cent || 0)
  };

  if (b.goods_id != null) {
    var g = svc.goods.get(Number(b.goods_id));
    if (g.status !== 'on_shelf') throw new Error('商品已下架');
    var qty = Math.max(1, Math.floor(Number(b.qty) || 1));
    payload.goods_id = g.id;
    payload.qty = qty;
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
    // 非管理员只能看自己的单；管理员可看全部或指定买家/卖家
    buyer: admin ? (req.query.buyer || null) : String(req.user.user_id),
    // C2C 市集：卖家查「我卖出的」订单。同学查别人卖的单没有意义，只允许查自己卖的
    seller: (admin || !req.query.seller || req.query.seller === String(req.user.user_id))
      ? (req.query.seller || null)
      : String(req.user.user_id),
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

// 结算：确认交付、解冻托管给卖家。班管可结任何单；
// C2C 市集里**卖家本人**也可以结自己的单（不然同学开店每单都得找班管）。
router.post('/orders/:id/settle', wrap(function (req, res) {
  orderFor(req, Number(req.params.id), 'seller');
  return ok(res, svc.orders.settle(Number(req.params.id), {
    ref: refOf(req, 'settle'),
    initiator: String(req.user.user_id)
  }), '已结算');
}));

// 买家确认收货：卖家标记履约后，由买家放款给卖家（比卖家自己点收钱更符合真实交易）
router.post('/orders/:id/confirm', wrap(function (req, res) {
  var id = Number(req.params.id);
  orderFor(req, id, 'buyer');
  return ok(res, svc.orders.confirm(id, {
    ref: refOf(req, 'confirm'),
    initiator: String(req.user.user_id)
  }), '已确认收货，货款已结算给卖家');
}));

// 退款（同意退款）：班管或卖家本人。托管原路退回买家，卖家拿不到已退的钱。
router.post('/orders/:id/refund', wrap(function (req, res) {
  orderFor(req, Number(req.params.id), 'seller');
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

router.post('/orders/:id/rebate', treasury.requireTreasury, wrap(function (req, res) {
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

// ---------- 学元贷款（班管） ----------
// 贷款只借 GRANT，不改变兑付敞口；这里只做班管视图与坏账核销。
// 从班班管也可管理本班贷款：贷款是本班学生与本地账本的约定，
// 不等同于组网统一的充值/发放财政权。
router.get('/admin/loans', treasury.requireTreasury, wrap(function (req, res) {
  var list = loan.adminList({
    status: req.query.status,
    limit: req.query.limit
  });
  return ok(res, { list: list, stats: loan.stats() });
}));

router.post('/admin/loan/:id/write-off', treasury.requireTreasury, wrap(function (req, res) {
  var r = loan.writeOff(Number(req.params.id), {
    operator: String(req.user.user_id),
    reason: req.body && req.body.reason
  });
  return ok(res, {
    duplicate: !!r.duplicate,
    loan: r.loan,
    stats: loan.stats()
  }, r.duplicate ? '这笔贷款已经核销' : '已核销');
}));

// ---------- 信用档案与班管控制 ----------
router.get('/admin/credit/:userId', treasury.requireTreasury, wrap(function (req, res) {
  return ok(res, loan.adminCredit(String(req.params.userId)));
}));

router.post('/admin/loan/:id/extend', treasury.requireTreasury, wrap(function (req, res) {
  var b = req.body || {};
  var r = loan.extend(Number(req.params.id), b.days, {
    operator: String(req.user.user_id),
    reason: b.reason
  });
  return ok(res, { loan: r.loan, days: r.days, stats: loan.stats() }, '已延期 ' + r.days + ' 天');
}));

router.post('/admin/credit/:userId/limit', treasury.requireTreasury, wrap(function (req, res) {
  var b = req.body || {};
  var cent = b.limit_cent != null ? Number(b.limit_cent) : units.xueyuanToUnits(b.amount);
  var r = loan.setLimit(String(req.params.userId), cent, {
    operator: String(req.user.user_id),
    reason: b.reason
  });
  return ok(res, r, r.limit_override_cent === 0 ? '已恢复规则额度' : '已调整限额');
}));

router.post('/admin/credit/:userId/score', treasury.requireTreasury, wrap(function (req, res) {
  var b = req.body || {};
  var r = loan.adjustScore(String(req.params.userId), b.delta, {
    operator: String(req.user.user_id),
    reason: b.reason,
    ref: refOf(req, 'score')
  });
  return ok(res, r, r.duplicate ? '这条调分已处理' : '已调整信用分');
}));

router.post('/admin/credit/:userId/blacklist', treasury.requireTreasury, wrap(function (req, res) {
  var b = req.body || {};
  var r = loan.setBlacklist(String(req.params.userId), b.until, {
    operator: String(req.user.user_id),
    reason: b.reason
  });
  return ok(res, r, b.until ? '已暂停借款' : '已解除借款限制');
}));

// ---------- 健康度（班管） ----------
router.get('/admin/health', treasury.requireTreasury, wrap(function (req, res) {
  // 未显式传储备时，用「真金台账净额」当在手现金：这才是真实的兑付能力
  var reserve = req.query.reserve_cent != null
    ? Number(req.query.reserve_cent)
    : svc.invariants.cashbookNetCent();
  var data = svc.invariants.health({ reserveCent: reserve });
  // 贷款只借 GRANT，不改变兑付敞口；单独一栏是给学生账务排障用的。
  data.loans = loan.stats();
  return ok(res, data);
}));

router.get('/admin/ledger/:txId', treasury.requireTreasury, wrap(function (req, res) {
  var tx = ledger.getTx(Number(req.params.txId));
  if (!tx) throw new Error('交易不存在');
  return ok(res, tx);
}));

// ============================================================
// v2 可证明性（班管只读 + 一次显式触发）
// 这些端点一个字都不动资金，只把「账本能不能自证清白」摆到管理端一屏里。
// ============================================================

// ★ 唯一推荐给管理端的入口：把六套自检收成一个 status + 一句人话。
// 下面那些 /admin/* 是给排障看的「详情」，班管日常只看 overview 就够。
router.get('/admin/overview', treasury.requireTreasury, wrap(function (req, res) {
  return ok(res, svc.overview.build());
}));

// 独立校验器：重算历史 digest + 新段逐笔哈希，任何篡改都在这里断链。
router.get('/admin/proof', treasury.requireTreasury, wrap(function (req, res) {
  return ok(res, svc.proof.verify());
}));

// 日终对账用 POST 触发（会写 runs/diffs，不该由 GET 产生副作用）。
// 默认按天去重，force=1 才重跑同一天。
router.post('/admin/reconcile', treasury.requireTreasury, wrap(function (req, res) {
  return ok(res, svc.reconcile.run(null, { force: req.query.force === '1' }));
}));

router.get('/admin/reconcile/latest', treasury.requireTreasury, wrap(function (req, res) {
  return ok(res, {
    latest: svc.reconcile.latest(),
    history: svc.reconcile.history(null, 10)
  });
}));

// 最近被拒绝的写入（失败留痕）。老库没跑 046 时返回空列表而不是 500。
router.get('/admin/attempts', treasury.requireTreasury, wrap(function (req, res) {
  var has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xy_ledger_post_attempts'").get();
  if (!has) return ok(res, { list: [], note: '尚未跑迁移 046' });
  var limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 200);
  return ok(res, {
    list: db.prepare('SELECT * FROM xy_ledger_post_attempts ORDER BY id DESC LIMIT ?').all(limit),
    limit: limit
  });
}));

// 累计发行计数器与各资产上限（0 = 不限）。
router.get('/admin/supply', treasury.requireTreasury, wrap(function (req, res) {
  return ok(res, {
    state: svc.supply.all(),
    assets: svc.assets.loadFromDb(db)
  });
}));

module.exports = router;
