// 学元（XueYuan）HTTP 接口
// ============================================================
// 面向学生的：
//   GET  /api/xueyuan/me              我的账户（首次访问自动开户 + 赠金）
//   GET  /api/xueyuan/history         我的流水
//   POST /api/xueyuan/daily           领取当日助学津贴
//   POST /api/xueyuan/transfer        给同学转学元
//   GET  /api/xueyuan/leaderboard     学元榜
//   GET  /api/xueyuan/account/:userId 查某人的公开资产
//   GET  /api/xueyuan/config          规则常量（前端展示）
//
// 面向管理员（班管 / 系统管理员）：
//   GET  /api/xueyuan/admin/overview  发行概览 + 账本对账
//   POST /api/xueyuan/admin/grant     批量发放
//   POST /api/xueyuan/admin/deduct    批量扣减
//   GET  /api/xueyuan/admin/audit     仅对账
//
// 为什么单独一个路由文件而不是塞进 admin.js：
// 学元是所有第三方应用共用的基础设施，它的接口生命周期比某个管理页面长，
// 单独文件才能保证「应用被卸载/管理页重写」时这条链路不动。
//
// 编码约定：var / function

var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var xy = require('../services/xueyuan');
var db = require('../utils/db');

// 统一错误出口：服务层的业务错误都是 400（参数/余额问题），
// 未预期异常才是 500 —— 这样前端能把「余额不足」和「服务器挂了」分开。
function fail(res, err) {
  var msg = err && err.message ? err.message : '操作失败';
  var known = /余额不足|可用学元不足|可提现学元不足|充值未生效|不足|超过上限|不能超过|非法|不存在|已被冻结|至少|不能为空|尚未开通|已关闭|未知的业务类型|不平衡|重复出现|不能给自己|必须|请填写|请选择|一次最多|无法|不能|已有一笔|已处理|只能撤销/.test(msg);
  if (!known) console.error('[xueyuan] 未预期错误:', err);
  return res.status(known ? 400 : 500).json({ code: known ? 400 : 500, message: msg });
}

// 班管 / 系统管理员（不接受普通班干 —— 发钱是财政权，不是日常事务权）
function requireTreasury(req, res, next) {
  if (!req.user) return res.status(401).json({ code: 401, message: '未登录' });
  if (req.user.is_class_admin || req.user.is_admin === 1) return next();
  return res.status(403).json({ code: 403, message: '只有班管可以管理学元发行' });
}

router.use(auth.requireAuth);

// ---------------- 个人 ----------------

router.get('/me', function (req, res) {
  try {
    var userId = String(req.user.user_id);
    // 懒开户：第一次打开任何学元页面就有一笔启动资金，不需要先「注册钱包」
    var opened = xy.ensureAccount(userId);

    var today = xy.todayKey();
    var claimedToday = !!db.prepare('SELECT 1 FROM xy_tx WHERE ref = ?').get('daily:' + userId + ':' + today);

    var txToday = db.prepare(
      "SELECT COUNT(*) AS c FROM xy_entry WHERE user_id = ? AND created_at >= ?"
    ).get(userId, todayStartMs()).c;

    res.json({
      code: 200,
      message: 'ok',
      data: {
        account: opened.account,
        is_new: opened.created,
        welcome_granted: opened.welcome_granted,
        daily: {
          claimed: claimedToday,
          can_claim: !claimedToday && xy.LIMITS.DAILY_CENT > 0,
          base: xy.fromCent(xy.LIMITS.DAILY_CENT)
        },
        tx_today: txToday
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/config', function (req, res) {
  res.json({
    code: 200,
    message: 'ok',
    data: {
      name: '学元',
      code: 'XY',
      cent_per_yuan: xy.CENT_PER_YUAN,
      // 与现实货币比率：1 元 = N 学元。默认 1:100，充值/提现都按这个换算。
      yuan_rate: xy.yuanRate(),
      welcome: xy.fromCent(xy.LIMITS.WELCOME_CENT),
      daily: xy.fromCent(xy.LIMITS.DAILY_CENT),
      daily_bonus: xy.fromCent(xy.LIMITS.DAILY_BONUS_CENT || 0),
      daily_bonus_from_day: xy.LIMITS.DAILY_BONUS_FROM_DAY || 7,
      max_transfer: xy.fromCent(xy.LIMITS.MAX_TRANSFER_CENT),
      max_recharge: xy.fromCent(xy.LIMITS.MAX_RECHARGE_CENT),
      max_withdraw: xy.fromCent(xy.LIMITS.MAX_WITHDRAW_CENT),
      min_withdraw: xy.fromCent(xy.LIMITS.MIN_WITHDRAW_CENT),
      pools: {
        cash: '充值学元：可转账、发红包、投资、提现',
        grant: '赠送学元：仅可用于投资，不可提现'
      },
      kinds: xy.KINDS
    }
  });
});

router.get('/history', function (req, res) {
  try {
    var data = xy.history(String(req.user.user_id), {
      limit: req.query.limit,
      beforeId: req.query.beforeId
    });
    res.json({ code: 200, message: 'ok', data: data });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/daily', function (req, res) {
  try {
    var r = xy.claimDaily(String(req.user.user_id));
    res.json({
      code: 200,
      message: r.duplicate ? '今天已经领过了' : '津贴已到账',
      data: r
    });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/transfer', function (req, res) {
  try {
    var body = req.body || {};
    var to = String(body.to || body.userId || '').trim();
    var amountCent = xy.toCent(body.amount);
    var memo = String(body.memo || '').slice(0, 60);

    if (!to) throw new Error('请填写收款人学号');
    if (amountCent === null || amountCent <= 0) throw new Error('转账金额不合法');

    var target = db.prepare('SELECT user_id, net_name FROM users WHERE user_id = ?').get(to);
    if (!target) throw new Error('收款账号不存在');

    var from = String(req.user.user_id);
    xy.ensureAccount(from);
    xy.ensureAccount(to);

    var r = xy.transfer({
      from: from,
      to: to,
      amountCent: amountCent,
      memo: memo || '同学转账',
      ref: 'tr:' + from + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8)
    });

    res.json({
      code: 200,
      message: '已转给 ' + (target.net_name || to),
      data: {
        tx_id: r.tx_id,
        to: { user_id: target.user_id, net_name: target.net_name },
        amount: xy.fromCent(amountCent),
        account: xy.viewAccount(from)
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 提现（学生申请 / 班管线下付现） ----------------
// 只有充值学元能提现；赠送学元在记账层就被隔离，走不到这里。

router.post('/withdraw/request', function (req, res) {
  try {
    var body = req.body || {};
    var userId = String(req.user.user_id);
    xy.ensureAccount(userId);
    var r = xy.requestWithdraw({
      user: userId,
      amount: body.amount,
      memo: String(body.memo || '').slice(0, 60),
      requestId: String(body.requestId || '').slice(0, 40) || null
    });
    res.json({
      code: 200,
      message: r.duplicate ? '申请已存在' : '已提交，请找班管线下提现',
      data: { withdraw: r.withdraw, account: r.account }
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/withdraw/list', function (req, res) {
  try {
    var list = xy.listWithdrawals({
      user: String(req.user.user_id),
      status: req.query.status,
      limit: req.query.limit
    });
    res.json({ code: 200, message: 'ok', data: { list: list, withdrawable: xy.withdrawableCent(String(req.user.user_id)) / xy.CENT_PER_YUAN } });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/withdraw/cancel/:id', function (req, res) {
  try {
    var r = xy.cancelWithdraw(req.params.id, { user: String(req.user.user_id) });
    res.json({ code: 200, message: '已撤销，学元已退回', data: r });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/leaderboard', function (req, res) {
  try {
    res.json({
      code: 200,
      message: 'ok',
      data: { list: xy.leaderboard({ limit: req.query.limit }) }
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/account/:userId', function (req, res) {
  try {
    var userId = String(req.params.userId || '').trim();
    var u = db.prepare('SELECT user_id, net_name, real_name FROM users WHERE user_id = ?').get(userId);
    if (!u) return res.status(404).json({ code: 404, message: '账号不存在' });
    var acc = xy.viewAccount(userId);
    res.json({
      code: 200,
      message: 'ok',
      data: {
        user_id: u.user_id,
        net_name: u.net_name,
        // 余额是公开信息（排行榜本来就公开），但不提供别人的流水
        balance: acc.balance,
        balance_cent: acc.balance_cent,
        exists: acc.exists
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 管理端 ----------------

router.get('/admin/overview', requireTreasury, function (req, res) {
  try {
    res.json({
      code: 200,
      message: 'ok',
      data: {
        summary: xy.summary({ recentLimit: req.query.recentLimit }),
        audit: xy.audit()
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/admin/audit', requireTreasury, function (req, res) {
  try {
    res.json({ code: 200, message: 'ok', data: xy.audit() });
  } catch (err) {
    fail(res, err);
  }
});

// 批量发放 / 扣减
// body: { userIds: [], amount: 每人学元, memo, requestId }
router.post('/admin/grant', requireTreasury, function (req, res) {
  handleBatch(req, res, 1);
});
router.post('/admin/deduct', requireTreasury, function (req, res) {
  handleBatch(req, res, -1);
});

function handleBatch(req, res, direction) {
  try {
    var body = req.body || {};
    var ids = Array.isArray(body.userIds) ? body.userIds : [];
    var amountCent = xy.toCent(body.amount);
    var memo = String(body.memo || '').slice(0, 80);

    if (!ids.length) throw new Error('请选择要操作的账号');
    if (ids.length > 200) throw new Error('一次最多处理 200 个账号');
    if (amountCent === null || amountCent <= 0) throw new Error('金额不合法');
    if (amountCent > 1000000) throw new Error('单人单次不能超过 10000 学元');

    var reqId = String(body.requestId || '').slice(0, 40) ||
      (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

    var done = [];
    var skipped = [];

    for (var i = 0; i < ids.length; i++) {
      var uid = String(ids[i] || '').trim();
      try {
        var u = db.prepare('SELECT user_id, net_name FROM users WHERE user_id = ?').get(uid);
        if (!u) { skipped.push({ user_id: uid, reason: '账号不存在' }); continue; }

        if (direction > 0) {
          xy.ensureAccount(uid);
          var r = xy.mint({
            to: uid,
            amountCent: amountCent,
            kind: 'admin_grant',
            ref: 'grant:' + reqId + ':' + uid,
            operator: String(req.user.user_id),
            memo: memo || '教师发放',
            meta: { request_id: reqId }
          });
          done.push({ user_id: uid, net_name: u.net_name, amount: xy.fromCent(amountCent), duplicate: !!r.duplicate });
        } else {
          var b = xy.burn({
            from: uid,
            amountCent: amountCent,
            kind: 'admin_deduct',
            ref: 'deduct:' + reqId + ':' + uid,
            operator: String(req.user.user_id),
            memo: memo || '教师扣减',
            meta: { request_id: reqId }
          });
          done.push({ user_id: uid, net_name: u.net_name, amount: -xy.fromCent(amountCent), duplicate: !!b.duplicate });
        }
      } catch (e) {
        skipped.push({ user_id: uid, reason: e.message });
      }
    }

    res.json({
      code: 200,
      message: (direction > 0 ? '已发放 ' : '已扣减 ') + done.length + ' 人' +
        (skipped.length ? '，' + skipped.length + ' 人跳过' : ''),
      data: { done: done, skipped: skipped, request_id: reqId }
    });
  } catch (err) {
    fail(res, err);
  }
}

// ---------------- 线下充值（班管收现金后录入） ----------------
// 充值学元进入 cash 池，可转账、红包、投资、提现；与「教师发放」的赠送学元严格区分。
// body: { userId | userIds: [], yuan: 每人实收人民币, amount: 每人学元(兼容), method, memo, requestId }

router.post('/admin/recharge', requireTreasury, function (req, res) {
  try {
    var body = req.body || {};
    var ids = Array.isArray(body.userIds) ? body.userIds.slice() : [];
    if (body.userId) ids.push(body.userId);
    var memo = String(body.memo || '').slice(0, 80);
    var method = String(body.method || 'cash').slice(0, 20);

    if (!ids.length) throw new Error('请选择要充值的账号');
    if (ids.length > 50) throw new Error('一次最多为 50 个账号充值');

    var amountCent;
    if (body.yuan !== undefined && body.yuan !== null && body.yuan !== '') {
      amountCent = xy.yuanToCent(body.yuan);
      if (amountCent === null) throw new Error('人民币金额不合法');
    } else {
      amountCent = xy.toCent(body.amount);
      if (amountCent === null) throw new Error('学元金额不合法');
    }
    if (!(amountCent > 0)) throw new Error('充值金额必须大于 0');
    if (amountCent > xy.LIMITS.MAX_RECHARGE_CENT) {
      throw new Error('单人单次充值不能超过 ' + xy.centToYuan(xy.LIMITS.MAX_RECHARGE_CENT) + ' 元');
    }

    var reqId = String(body.requestId || '').slice(0, 40) ||
      (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

    var done = [];
    var skipped = [];

    for (var i = 0; i < ids.length; i++) {
      var uid = String(ids[i] || '').trim();
      try {
        var u = db.prepare('SELECT user_id, net_name FROM users WHERE user_id = ?').get(uid);
        if (!u) { skipped.push({ user_id: uid, reason: '账号不存在' }); continue; }

        var r = xy.recharge({
          user: uid,
          amountCent: amountCent,
          operator: String(req.user.user_id),
          method: method,
          memo: memo || '线下充值',
          requestId: reqId + ':' + uid
        });
        done.push({
          user_id: uid,
          net_name: u.net_name,
          amount: xy.fromCent(amountCent),
          yuan: xy.centToYuan(amountCent),
          duplicate: !!r.duplicate
        });
      } catch (e) {
        skipped.push({ user_id: uid, reason: e.message });
      }
    }

    // 一个人都没充上时必须报错，不能返回 200 让班管误以为已到账
    if (!done.length && skipped.length) {
      throw new Error('充值未生效：' + skipped[0].reason + '（' + skipped[0].user_id + '）');
    }

    res.json({
      code: 200,
      message: '已为 ' + done.length + ' 人录入充值' + (skipped.length ? '，' + skipped.length + ' 人跳过' : ''),
      data: { done: done, skipped: skipped, request_id: reqId, rate: xy.yuanRate() }
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/admin/recharges', requireTreasury, function (req, res) {
  try {
    res.json({
      code: 200,
      message: 'ok',
      data: { list: xy.listRecharges({ user: req.query.user, limit: req.query.limit }) }
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 提现审批 ----------------

router.get('/admin/withdrawals', requireTreasury, function (req, res) {
  try {
    res.json({
      code: 200,
      message: 'ok',
      data: {
        list: xy.listWithdrawals({ status: req.query.status, user: req.query.user, limit: req.query.limit }),
        pending: xy.listWithdrawals({ status: 'pending', limit: 100 })
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

// body: { approve: true/false, memo, requestId }
router.post('/admin/withdrawals/:id/review', requireTreasury, function (req, res) {
  try {
    var body = req.body || {};
    var r = xy.reviewWithdraw(req.params.id, body.approve !== false, {
      reviewer: String(req.user.user_id),
      memo: String(body.memo || '').slice(0, 80)
    });
    res.json({
      code: 200,
      message: body.approve !== false ? '已通过，请当面交付现金' : '已驳回，学元已退回',
      data: r
    });
  } catch (err) {
    fail(res, err);
  }
});

// 当日 0 点（东八区）的毫秒时间戳
function todayStartMs() {
  var d = new Date(Date.now() + 8 * 3600 * 1000);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - 8 * 3600 * 1000;
}

module.exports = router;
