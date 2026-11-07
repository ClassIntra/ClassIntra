// 学元（XueYuan）HTTP 接口
// ============================================================
// 面向学生的：
//   GET  /api/xueyuan/me              我的账户（首次访问自动开户 + 赠金）
//   GET  /api/xueyuan/history         我的流水
//   POST /api/xueyuan/daily           领取当日助学津贴
//   POST /api/xueyuan/transfer        给本班同学转学元（要支付密码，与钱包共用风控）
//   GET  /api/xueyuan/leaderboard     学元榜
//   GET  /api/xueyuan/account/:userId 查某人的公开资产
//   GET  /api/xueyuan/config          规则常量（前端展示）
//
// 面向管理员（班管 / 系统管理员）：
//   GET  /api/xueyuan/admin/overview  发行概览 + 账本对账
//   GET  /api/xueyuan/admin/health    币值健康度（印钞速度 / 回笼率 / 兑付敞口）
//   POST /api/xueyuan/admin/grant     批量发放（单次 + 每日双配额）
//   POST /api/xueyuan/admin/deduct    批量扣减
//   POST /api/xueyuan/admin/recharge/:id/revoke  撤回某笔线下充值（冲销 + 留痕）
//   POST /api/xueyuan/admin/refund    退款给学生（必须写原因，幂等）
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
var payGuard = require('../services/pay-guard');
var packetCross = require('../services/packet-cross');
var db = require('../utils/db');
var ledger = require('../ledger/ledger');
var xyMesh = require('../services/xy-mesh');
var constants = require('../utils/constants');

// 统一错误出口：服务层的业务错误都是 400（参数/余额问题），
// 未预期异常才是 500 —— 这样前端能把「余额不足」和「服务器挂了」分开。
function fail(res, err) {
  var msg = err && err.message ? err.message : '操作失败';
  var known = /余额不足|可用学元不足|可提现学元不足|充值未生效|不足|超过上限|不能超过|非法|不合法|金额|不存在|已被冻结|至少|不能为空|尚未开通|已关闭|未知的业务类型|不平衡|重复出现|不能给自己|必须|请填写|请选择|一次最多|无法|不能|已有一笔|已处理|只能撤销|支付密码|输错|锁定|未设置|额度|学号|停用|跨班|外班|未生效|钱包/.test(msg);
  if (!known) console.error('[xueyuan] 未预期错误:', err);
  return res.status(known ? 400 : 500).json({ code: known ? 400 : 500, message: msg });
}

// 班管 / 系统管理员（不接受普通班干 —— 发钱是财政权，不是日常事务权）
//
// 组网封锁（xy-mesh）：本实例被配置为从班（member）时，本班班管的
// 学元管理整体移交给组网主班 —— 学元是钱，谁收钱谁管账（主班负责人）。
// 从班班管的其他班级管理不受影响；系统管理员（999999 等）保留豁免以便排障。
function requireTreasury(req, res, next) {
  if (!req.user) return res.status(401).json({ code: 401, message: '未登录' });
  if (xyMesh.blockTreasury(req.user.user_id)) {
    return res.status(403).json({ code: 403, message: '本班学元管理已移交组网主班统一管理，如有需要请联系主班班管' });
  }
  if (req.user.is_class_admin || req.user.is_admin === 1) return next();
  return res.status(403).json({ code: 403, message: '只有班管可以管理学元发行' });
}

// ---------------- 组网命令通道（xy-mesh） ----------------
// 唯一不吃 JWT 的入口：只认 HMAC(RELAY_SECRET) 签名（与跨班支付同一把钥匙）。
// 必须挂在 router.use(auth.requireAuth) 之前 —— 主班服务器是机器对机器调用，
// 没有也不该有从班的登录态。
router.post('/mesh/command', function (req, res) {
  try {
    var r = xyMesh.handleCommand(req);
    res.json(r);
  } catch (err) {
    var msg = err && err.message ? err.message : '组网命令失败';
    var known = /签名|过期|缺少|未知|余额|上限|不存在|停用|镜像|金额|学号|请|未生效|不能|已失败/.test(msg);
    if (!known) console.error('[xueyuan-mesh] 未预期错误:', err);
    res.status(known ? 400 : 500).json({ code: known ? 400 : 500, message: msg });
  }
});

router.use(auth.requireAuth);

// ---------------- 个人 ----------------

router.get('/me', function (req, res) {
  try {
    var userId = String(req.user.user_id);
    // 懒开户：第一次打开任何学元页面就有一笔启动资金，不需要先「注册钱包」
    var opened = xy.ensureAccount(userId);

    var today = xy.todayKey();
    var claimedToday = !!ledger.findTxByRef('daily:' + userId + ':' + today);

    var acc = ledger.findAccount('user', userId);
    var txToday = acc ? db.prepare(
      'SELECT COUNT(*) AS c FROM xy_ledger_entries WHERE account_id = ? AND created_at >= ?'
    ).get(acc.id, new Date(todayStartMs()).toISOString()).c : 0;

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
      // 与现实货币比率：1 元 = N 学元。默认 1:1000，充值/提现都按这个换算。
      yuan_rate: xy.yuanRate(),
      welcome: xy.fromCent(xy.LIMITS.WELCOME_CENT),
      daily: xy.fromCent(xy.LIMITS.DAILY_CENT),
      daily_bonus: xy.fromCent(xy.LIMITS.DAILY_BONUS_CENT || 0),
      daily_bonus_from_day: xy.LIMITS.DAILY_BONUS_FROM_DAY || 7,
      max_transfer: xy.fromCent(xy.LIMITS.MAX_TRANSFER_CENT),
      max_recharge: xy.fromCent(xy.LIMITS.MAX_RECHARGE_CENT),
      recharge_quota: xy.fromCent(xy.LIMITS.RECHARGE_QUOTA_CENT),
      max_grant: xy.fromCent(xy.LIMITS.MAX_GRANT_CENT),
      grant_daily_cap: xy.fromCent(xy.LIMITS.GRANT_DAILY_CAP_CENT),
      max_withdraw: xy.fromCent(xy.LIMITS.MAX_WITHDRAW_CENT),
      min_withdraw: xy.fromCent(xy.LIMITS.MIN_WITHDRAW_CENT),
      pools: {
        cash: '充值学元：可买东西、转账、发红包、跨班、投资，也可申请提现',
        grant: '赠送学元：可转账、发红包、跨班、投资；买不了东西，也不可提现',
        practice: '练习金：学元证券沙盘专用，只能在证券里买卖，不能提现或买东西'
      },
      kinds: xy.KINDS,
      // 组网角色透出：从班学员的钱包充值说明要提示「找主班班管」，
      // 从班班管的管控中心要据此隐藏学元管理 tab。不暴露对端地址。
      mesh: (function () {
        try {
          var m = xyMesh.getConfig();
          return {
            role: m.role,
            master_class: (m.role === 'member' && m.peers[0]) ? m.peers[0].class : ''
          };
        } catch (e) { return { role: '', master_class: '' }; }
      })()
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
    if (to === String(req.user.user_id)) throw new Error('不能给自己转账');

    // 镜像用户（外班同步过来的）绝不能直接入账：那个账户在本班永远不会有人登录，
    // 钱等于锁死。跨班必须走 /api/wallet 的跨班通道。
    if (!packetCross.isLocalUser(to)) {
      throw new Error('这个学号不在本班，请到「学元钱包」用跨班转账');
    }

    var target = db.prepare('SELECT user_id, net_name, status FROM users WHERE user_id = ?').get(to);
    if (!target) throw new Error('收款账号不存在');
    if (target.status === 'disabled') throw new Error('这个学号已被停用，暂时收不了钱');

    // 支付密码 + 当日额度：换个接口也不能把风控绕过去（与钱包共用 pay-guard）
    payGuard.guardPay(String(req.user.user_id), body.pin, amountCent);

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

// ---------------- 投资进出（赠金 ⇄ 练习金） ----------------
// 学生把零花钱放进证券沙盘，或把炒股的钱拿回钱包花。
// 不需要支付密码：钱始终在本人名下，没有第三方收款方，也不是对外支付。
// 真钱 CASH 不在这条通道里 —— 它只能充值/提现，进不了股市。
router.post('/invest', function (req, res) {
  try {
    var body = req.body || {};
    var dir = String(body.direction || 'in');
    if (dir !== 'in' && dir !== 'out') throw new Error('direction 只能是 in 或 out');
    var amountCent = xy.toCent(body.amount);
    if (amountCent === null || amountCent <= 0) throw new Error('金额不合法');

    var uid = String(req.user.user_id);
    var ref = body.ref ? String(body.ref) : ('invest:' + uid + ':' + Date.now());
    var r = dir === 'in'
      ? xy.investIn(uid, amountCent, { ref: ref })
      : xy.investOut(uid, amountCent, { ref: ref });

    res.json({
      code: 200,
      message: dir === 'in' ? '已转入投资' : '已撤出到钱包',
      data: {
        direction: r.direction,
        amount: r.amount,
        account: r.account
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
      // 前端输入框单位是「学元」；显式在路由边界换算成账本单位，
      // 服务层只认 amountCent，避免再出现「路由传 A、服务读 B」的静默失败。
      amountCent: xy.requireAmountCent({ amount: body.amount }, '提现金额'),
      memo: String(body.memo || '').slice(0, 60),
      requestId: String(body.requestId || '').slice(0, 40) || null
    });
    // 从班学员申请提现后，付现金的是组网主班班管 —— 提示要指向对的人
    var withdrawMsg = '已提交，请找班管线下提现';
    try {
      var meshCfg = xyMesh.getConfig();
      if (meshCfg.role === 'member' && meshCfg.peers[0]) {
        withdrawMsg = '已提交，请找 ' + meshCfg.peers[0].class + ' 班班管线下来取现金';
      }
    } catch (e) { /* 未组网用默认文案 */ }
    res.json({
      code: 200,
      message: r.duplicate ? '申请已存在' : withdrawMsg,
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
    res.json({ code: 200, message: 'ok', data: { list: list, withdrawable: xy.fromCent(xy.withdrawableCent(String(req.user.user_id))) } });
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

// 币值健康度：只读，供班管面板展示「印钞速度 / 回笼率 / 兑付敞口」。
// days 为统计窗口（默认 30 天），只影响流量类指标，不影响存量。
router.get('/admin/health', requireTreasury, function (req, res) {
  try {
    res.json({ code: 200, message: 'ok', data: xy.health({ days: req.query.days }) });
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
    if (amountCent > xy.LIMITS.MAX_GRANT_CENT) {
      throw new Error('单人单次发放不能超过 ' + xy.fromCent(xy.LIMITS.MAX_GRANT_CENT) + ' 学元');
    }

    var reqId = String(body.requestId || '').slice(0, 40) ||
      (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

    var done = [];
    var skipped = [];

    for (var i = 0; i < ids.length; i++) {
      var uid = String(ids[i] || '').trim();
      try {
        var u = db.prepare('SELECT user_id, net_name, status, password_hash FROM users WHERE user_id = ?').get(uid);
        if (!u) { skipped.push({ user_id: uid, reason: '账号不存在' }); continue; }

        // 外班镜像账号（password_hash 为空）在本班永远无人登录，发放/扣减都等于动死钱
        if (!u.password_hash) {
          skipped.push({ user_id: uid, reason: '外班同学，请到他本班的学元管理里操作' });
          continue;
        }
        // 停用账号可以扣减（回收余额），但不能发放
        if (direction > 0 && u.status === 'disabled') {
          skipped.push({ user_id: uid, reason: '账号已停用，不能发放' });
          continue;
        }

        if (direction > 0) {
          xy.ensureAccount(uid);
          // 走 xy.grant 而不是 mint：发放要过「单次上限 + 每日累计上限」两道配额。
          var r = xy.grant({
            to: uid,
            amountCent: amountCent,
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

    // 一个人都没操作成功时必须报错，不能返回 200 让班管误以为已生效
    if (!done.length && skipped.length) {
      throw new Error((direction > 0 ? '发放' : '扣减') + '未生效：' +
        skipped[0].reason + '（' + skipped[0].user_id + '）');
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
        var u = db.prepare('SELECT user_id, net_name, status, password_hash FROM users WHERE user_id = ?').get(uid);
        if (!u) { skipped.push({ user_id: uid, reason: '账号不存在' }); continue; }

        // 外班镜像账号收不到现金充值（钱会锁死在本班无人登录的账户里）；停用账号也不收
        if (!u.password_hash) {
          skipped.push({ user_id: uid, reason: '外班同学，充值请在他本班录入' });
          continue;
        }
        if (u.status === 'disabled') {
          skipped.push({ user_id: uid, reason: '账号已停用，不能充值' });
          continue;
        }

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

// 撤回一笔线下充值：录错了、家长要退、学生转班 —— 都走这里。
// 只允许撤回未被使用的金额；有冻结中的提现时不受理。
router.post('/admin/recharge/:id/revoke', requireTreasury, function (req, res) {
  try {
    var r = xy.revokeRecharge({
      rechargeId: req.params.id,
      operator: String(req.user.user_id),
      reason: (req.body && req.body.reason) || ''
    });
    res.json({
      code: 200,
      message: r.duplicate ? '这笔充值此前已撤回' : '已撤回，学元已冲销',
      data: r
    });
  } catch (err) {
    fail(res, err);
  }
});

// 退款：把钱从**真实来源账户**退回给学生（谁收的钱谁退）。
// body: { userId, from, yuan | amount, pool?: 'cash' | 'grant', reason, requestId? }
router.post('/admin/refund', requireTreasury, function (req, res) {
  try {
    var body = req.body || {};
    var uid = String(body.userId || '').trim();
    if (!uid) throw new Error('请填写要退款的学号');
    var from = String(body.from || '').trim();
    if (!from) throw new Error('请填写退款方学号（谁收的钱谁退）');

    var amountCent;
    if (body.yuan !== undefined && body.yuan !== null && body.yuan !== '') {
      amountCent = xy.yuanToCent(body.yuan);
      if (amountCent === null) throw new Error('人民币金额不合法');
    } else {
      amountCent = xy.toCent(body.amount);
      if (amountCent === null) throw new Error('学元金额不合法');
    }

    var reqId = String(body.requestId || '').slice(0, 40) ||
      (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

    var r = xy.refund({
      to: uid,
      from: from,
      amountCent: amountCent,
      pool: body.pool === 'grant' ? 'grant' : 'cash',
      reason: body.reason,
      operator: String(req.user.user_id),
      ref: 'refund:' + reqId,
      app: 'wallet'
    });

    res.json({
      code: 200,
      message: r.duplicate ? '这笔退款此前已入账' : ('已退款 ' + r.amount + ' 学元'),
      data: r
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

// ---------------- 组网管理端（xy-mesh 代理 / 配置） ----------------

// 主班视角：从班列表（前端学元 tab 的「班级视角」切换用）
router.get('/admin/mesh/peers', requireTreasury, function (req, res) {
  try {
    var m = xyMesh.getConfig();
    res.json({
      code: 200,
      message: 'ok',
      data: {
        role: m.role,
        peers: m.role === 'master' ? m.peers : [],
        master: m.role === 'member' && m.peers[0] ? m.peers[0] : null
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

// 主班 → 从班的统一代理：前端永远只跟本班服务器说话（平板网络环境复杂，
// 不让浏览器直连对端），服务端注入 operator（谁在操作）后签名转发。
// 响应形状 = 从班本地 /admin/* 路由的 data 字段，前端业务逻辑零分叉。
router.post('/admin/mesh/command', requireTreasury, function (req, res) {
  try {
    var m = xyMesh.getConfig();
    if (m.role !== 'master') throw new Error('本班不是组网主班，不能管理其他班的学元');
    var body = req.body || {};
    var peerClass = String(body.peerClass || '').trim();
    var peer = null;
    for (var i = 0; i < m.peers.length; i++) {
      if (m.peers[i].class === peerClass) { peer = m.peers[i]; break; }
    }
    if (!peer) throw new Error('未配置 ' + (peerClass || '(空)') + ' 班的组网地址');
    var payload = Object.assign({}, body.payload || {});
    payload.operator = String(req.user.user_id);   // 操作者以登录态为准，不信任请求体
    xyMesh.sendCommand(peer, String(body.command || ''), payload).then(function (data) {
      res.json({ code: 200, message: 'ok', data: data });
    }).catch(function (err) {
      fail(res, err);
    });
  } catch (err) {
    fail(res, err);
  }
});

// 组网配置（仅系统管理员）：管理端可视化配置，存 app_config 即时生效
function requireSystemAdmin(req, res, next) {
  if (req.user && constants.isSystemAdmin(req.user.user_id)) return next();
  return res.status(403).json({ code: 403, message: '只有系统管理员可以修改组网配置' });
}

router.get('/admin/mesh-config', requireSystemAdmin, function (req, res) {
  try {
    var m = xyMesh.getConfig();
    res.json({
      code: 200,
      message: 'ok',
      data: {
        role: m.role,
        peers: m.peers,
        secret_ready: !!(process.env.RELAY_SECRET || '')
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/admin/mesh-config', requireSystemAdmin, function (req, res) {
  try {
    var body = req.body || {};
    var m = xyMesh.saveConfig({ role: body.role, peers: body.peers });
    res.json({ code: 200, message: '组网配置已保存，即时生效', data: { role: m.role, peers: m.peers } });
  } catch (err) {
    fail(res, err);
  }
});

// 组网命令审计：最近 N 条（系统管理员排障用，配置卡下方展示）
router.get('/admin/mesh/log', requireSystemAdmin, function (req, res) {
  try {
    res.json({
      code: 200,
      message: 'ok',
      data: { list: xyMesh.listLog(req.query.limit) }
    });
  } catch (err) {
    fail(res, err);
  }
});

// 保存前先 ping 对端：地址写错宁可当场发现，别等班管充值时才发现
router.post('/admin/mesh-config/test', requireSystemAdmin, function (req, res) {
  try {
    xyMesh.testPeer((req.body || {}).base).then(function (data) {
      res.json({ code: 200, message: '对端连通，签名校验通过', data: data });
    }).catch(function (err) {
      res.status(400).json({ code: 400, message: (err && err.message) || '对端不可达' });
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
