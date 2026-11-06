// 学元钱包（系统应用 apps/wallet 的 HTTP 接口）
// ============================================================
// 这是「学元」的平台级门面：账户、津贴、流水、转账、红包、榜单。
// 学元本身是基础设施（services/xueyuan.js），本文件只做面向钱包页面的聚合。
//
// 为什么不做成 market-app：
//   学元是全平台货币，钱包不该跟着某个应用一起装/卸。
//   证券应用里的钱包面板仍然保留（那里交易时顺手看一眼），但它与本应用读同一套账，
//   不存在两个余额。
//
// 接口：
//   GET  /api/wallet                账户 + 今日津贴状态 + 本周/本月收支 + 最近流水
//   GET  /api/wallet/ledger         流水分页（可按方向筛选）
//   POST /api/wallet/daily          领当日助学津贴（幂等）
//   GET  /api/wallet/search?q=      找同学（转账用，按学号/昵称/姓名）
//   POST /api/wallet/transfer       转账
//   GET  /api/wallet/packets        红包列表（可领 / 我发的 / 我领过的）
//   GET  /api/wallet/packet/:id/claims 领取记录（发送者 / 已领取者可见）
//   POST /api/wallet/packet         发红包
//   POST /api/wallet/packet/:id/claim  领红包
//   POST /api/wallet/collect        发起群收款（AA）
//   GET  /api/wallet/collect/list   我发起 / 我参与的收款单
//   GET  /api/wallet/collect/:id    收款单详情
//   POST /api/wallet/collect/:id/pay    付我那一份（支付密码 + 当日额度）
//   POST /api/wallet/collect/:id/close  结束收款单
//   GET  /api/wallet/leaderboard    学元榜
//
// 编码约定：var / function

var express = require('express');
var router = express.Router();
var auth = require('../middleware/auth');
var xy = require('../services/xueyuan');
var yuanbao = require('../services/yuanbao');
var collect = require('../services/collect');
var payPin = require('../services/pay-pin');
var payCode = require('../services/pay-code');
var crossPay = require('../services/cross-pay');
var packetCross = require('../services/packet-cross');
var peers = require('../services/peers');
var db = require('../utils/db');
var constants = require('../utils/constants');
var payGuard = require('../services/pay-guard');

var DAILY_CENT = xy.LIMITS.DAILY_CENT;
var DAILY_BONUS_CENT = xy.LIMITS.DAILY_BONUS_CENT;
var DAILY_BONUS_FROM_DAY = xy.LIMITS.DAILY_BONUS_FROM_DAY;
var OFFSET = 8 * 3600 * 1000;   // 全平台按东八区记账

// 业务错误 400 / 未预期 500，前端据此区分「余额不足」与「服务器挂了」
function fail(res, err) {
  var msg = err && err.message ? err.message : '操作失败';
  var known = /余额不足|可用学元不足|超过上限|不能超过|非法|不存在|已被冻结|至少|不能为空|尚未开通|已关闭|未知的业务类型|不平衡|重复出现|不能给自己|必须|请填写|请选择|一次最多|无法|不能|已领|过期|不够|红包|学号|支付密码|输错|锁定|未设置|额度|收款码|地址|请输入|红包码|口令|跨班|班级|连通|离线|格式|不对|发给你的|还没选|至少选/.test(msg);
  if (!known) console.error('[wallet] 未预期错误:', err);
  var body = { code: known ? 400 : 500, message: msg };
  // 支付密码/额度这类「可恢复的业务拒绝」要带结构化信息：
  // 前端据此弹「去设置密码」/「还剩几次」/「今日额度用完」，而不是一句干巴巴的错。
  if (err && err.pay_pin) body.data = { pay_pin: err.pay_pin };
  else if (err && err.quota) body.data = { quota: true };
  return res.status(known ? 400 : 500).json(body);
}

function startOfDay(ts) {
  var d = new Date(ts + OFFSET);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - OFFSET;
}

function startOfWeek(ts) {
  var d = new Date(ts + OFFSET);
  var day = d.getUTCDay();               // 0 = 周日
  var back = day === 0 ? 6 : day - 1;    // 周一为一周开始
  return startOfDay(ts) - back * 86400000;
}

function startOfMonth(ts) {
  var d = new Date(ts + OFFSET);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - OFFSET;
}

// 某段时间内的收入/支出（分）
function flowBetween(userId, from, to) {
  return db.prepare([
    'SELECT',
    '  COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS in_cent,',
    '  COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS out_cent,',
    '  COUNT(*) AS n',
    'FROM xy_entry WHERE user_id = ? AND created_at >= ? AND created_at < ?'
  ].join('\n')).get(String(userId), from, to);
}

function todayKey() {
  return xy.todayKey(Date.now());
}

function dailyState(userId) {
  var today = todayKey();
  var hit = db.prepare('SELECT 1 FROM xy_tx WHERE ref = ?').get('daily:' + userId + ':' + today);
  var last = db.prepare('SELECT created_at, meta_json FROM xy_tx WHERE ref LIKE ? ORDER BY id DESC LIMIT 1')
    .get('daily:' + userId + ':%');
  var streak = 0;
  if (last) {
    try { streak = JSON.parse(last.meta_json || '{}').streak || 0; } catch (e) { streak = 0; }
  }
  var nextDay = streak + 1;
  return {
    claimed: !!hit,
    streak: streak,
    amount: hit ? 0 : (nextDay >= DAILY_BONUS_FROM_DAY ? xy.fromCent(DAILY_BONUS_CENT) : xy.fromCent(DAILY_CENT)),
    base: xy.fromCent(DAILY_CENT),
    bonus: xy.fromCent(DAILY_BONUS_CENT),
    bonus_from: DAILY_BONUS_FROM_DAY,
    next_day: nextDay
  };
}

// 学元来源（钱包页的说明清单；数字与实现保持一致）
function sourceList() {
  var rate = xy.yuanRate();
  return [
    { icon: 'wallet', name: '线下充值', amount: '1 元 = ' + rate + ' 学元', note: '找班管交现金，录入后到账；可转账、红包、投资、提现' },
    { icon: 'gift', name: '开户赠金', amount: xy.fromCent(xy.LIMITS.WELCOME_CENT) + ' 学元', note: '首次开通学元账户自动到账，属赠送学元，可支付但不可提现' },
    { icon: 'practice', name: '投资练习金', amount: '9000 学元', note: '第一次进入「学元证券」自动发放，可投资 / 支付，但不可提现' },
    { icon: 'daily', name: '每日助学津贴', amount: xy.fromCent(xy.LIMITS.DAILY_CENT) + ' 学元（连签第 7 天起 ' + xy.fromCent(xy.LIMITS.DAILY_BONUS_CENT) + '）', note: '每天在钱包点一次，断签重新计' },
    { icon: 'medal', name: '交易成就', amount: '20–200 学元', note: '在学元证券解锁成就时发放' },
    { icon: 'trophy', name: '跨班对决奖励', amount: '100 学元', note: '每周五胜方班级的活跃同学' },
    { icon: 'teacher', name: '班管发放', amount: '不定', note: '老师奖励，属赠送学元，可支付但不可提现' },
    { icon: 'swap', name: '同学转账 / 红包', amount: '不定', note: '两种学元都能转，不产生新学元' }
  ];
}

// ---------------- 跨班入账（对端班级调用，无登录态） ----------------
// 认证靠 HMAC(RELAY_SECRET)+时间戳，而不是 JWT：对端服务器没有本班用户身份。
// 收款人只认 payload 里的收款码 token（本班签发），绝不信任请求体自报的学号。
router.post('/cross/pay', function (req, res) {
  try {
    var r = crossPay.receive(req.body || {});
    res.status(r.code === 200 ? 200 : r.code).json({ code: r.code, message: r.message, data: r.data });
  } catch (e) {
    res.status(500).json({ code: 500, message: '跨班入账失败：' + e.message });
  }
});

// ---------------- 跨班红包 / 收款号解析（对端班级调用，无登录态） ----------------
// 与 /cross/pay 一样：认证靠 HMAC(RELAY_SECRET)+时间戳，不依赖 JWT。
router.post('/cross/packet/probe', function (req, res) {
  try {
    var r = packetCross.receiveProbe(req.body || {});
    res.status(r.code === 200 ? 200 : r.code).json({ code: r.code, message: r.message, data: r.data });
  } catch (e) {
    res.status(500).json({ code: 500, message: '探测失败：' + e.message });
  }
});

router.post('/cross/packet/claim', function (req, res) {
  try {
    var r = packetCross.receiveClaim(req.body || {});
    res.status(r.code === 200 ? 200 : r.code).json({ code: r.code, message: r.message, data: r.data });
  } catch (e) {
    res.status(500).json({ code: 500, message: '跨班领取失败：' + e.message });
  }
});

// 凭短收款号找到对端的完整收款码（付款方班级调用）
router.post('/cross/pay-code', function (req, res) {
  try {
    var r = packetCross.receivePayCode(req.body || {});
    res.status(r.code === 200 ? 200 : r.code).json({ code: r.code, message: r.message, data: r.data });
  } catch (e) {
    res.status(500).json({ code: 500, message: '收款号解析失败：' + e.message });
  }
});

// 按学号问「这个人是不是本班真用户」——转账选人的跨班路由依据
router.post('/cross/whois', function (req, res) {
  try {
    var r = packetCross.receiveWhois(req.body || {});
    res.status(r.code === 200 ? 200 : r.code).json({ code: r.code, message: r.message, data: r.data });
  } catch (e) {
    res.status(500).json({ code: 500, message: 'whois 失败：' + e.message });
  }
});

router.use(auth.requireAuth);

// 懒开户：第一次打开钱包就应有账户与开户赠金。
// viewAccount 只读不建户，所以必须在入口显式 ensureAccount —— 否则新用户
// 看到的余额是 0，还会以为钱丢了。失败不影响读接口（服务层会再兜底）。
router.use(function (req, res, next) {
  try { xy.ensureAccount(String(req.user.user_id)); } catch (e) { /* 交给各接口报错 */ }
  // 客户端访问用的地址，就是外班能访问到我们的地址 —— 记下来，跨班请求要回填
  try {
    if (!peers.localBaseHint()) peers.learnLocalBase(req.protocol + '://' + req.get('host'));
  } catch (e) { /* 忽略 */ }
  next();
});

// ---------------- 支付密码 ----------------
router.get('/pay-pin', function (req, res) {
  try {
    res.json({ code: 200, message: 'ok', data: payPin.state(String(req.user.user_id)) });
  } catch (err) {
    fail(res, err);
  }
});

// 首次设置（要登录密码）—— 防止别人拿到没锁屏的平板直接设一个支付密码
router.post('/pay-pin', function (req, res) {
  try {
    var b = req.body || {};
    var r = payPin.setup(String(req.user.user_id), b.pin, b.password);
    res.json({ code: 200, message: '支付密码已设置', data: r });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/pay-pin/change', function (req, res) {
  try {
    var b = req.body || {};
    var r = payPin.change(String(req.user.user_id), b.old_pin, b.new_pin);
    res.json({ code: 200, message: '支付密码已修改', data: r });
  } catch (err) {
    fail(res, err);
  }
});

// 忘记密码：登录密码验证通过即可重设（校园场景没有短信）
router.post('/pay-pin/reset', function (req, res) {
  try {
    var b = req.body || {};
    var r = payPin.reset(String(req.user.user_id), b.password, b.new_pin);
    res.json({ code: 200, message: '支付密码已重设', data: r });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 收款码 ----------------
// base 由前端传 location.origin：跨班对端拿到的是「客户端实际能访问的地址」，
// 而不是服务器自己猜的内网 IP。
router.get('/pay-code', function (req, res) {
  try {
    var uid = String(req.user.user_id);
    var base = req.query.base || (req.protocol + '://' + req.get('host'));
    peers.learnLocalBase(base);
    var d = payCode.issue(uid, base);
    d.local_base = peers.localBaseHint();
    res.json({ code: 200, message: 'ok', data: d });
  } catch (err) {
    fail(res, err);
  }
});

// 收款号查询：平板没有摄像头，扫码不现实。收款码页展示 8 位「收款号」，
// 付款方在转账页输入这 8 位，这里按 token 前缀反查，等价于「扫了对方的码」。
router.get('/pay-code/find', function (req, res) {
  var short = String(req.query.short || '').trim().toLowerCase();
  if (!/^[a-f0-9]{6,40}$/.test(short)) return fail(res, new Error('收款号格式不对'));

  // 先查本班
  var row = db.prepare([
    'SELECT * FROM xy_pay_code WHERE token LIKE ? AND expires_at > ?',
    'ORDER BY created_at DESC LIMIT 1'
  ].join(' ')).get(short + '%', Date.now());
  if (row) {
    var u = db.prepare('SELECT net_name, real_name FROM users WHERE user_id = ?').get(row.user_id);
    var full = payCode.issue(row.user_id, row.base_url);
    return res.json({
      code: 200,
      message: 'ok',
      data: {
        user_id: row.user_id,
        name: (u && (u.net_name || u.real_name)) || row.user_id,
        short: row.token.slice(0, 8),
        base_url: row.base_url,
        server_id: peers.serverId(),
        code: full.code,
        cross: false
      }
    });
  }

  // 本班没有 → 问登记表里的其他班。平板没有摄像头，这是「扫外班码」的唯一办法。
  var list = peers.list();
  if (!list.length) {
    return fail(res, new Error('收款号不存在；如果是外班同学，需要先把两个班连通'));
  }
  var pending = list.length;
  var answered = false;
  function giveUp(msg) {
    if (answered) return;
    answered = true;
    fail(res, new Error(msg));
  }
  function done() {
    pending--;
    if (pending === 0) giveUp('收款号不存在，或对方班级当前离线');
  }
  list.forEach(function (pr) {
    var body = {
      ts: Date.now(), kind: 'paycode', ref: '', code: short, claimer: '',
      from_server: peers.serverId(), from_base: peers.localBaseHint() || ''
    };
    body.sig = packetCross.sign(body);
    crossPay.postJson(pr.base_url, '/api/wallet/cross/pay-code', body).then(function (r) {
      if (answered) return;
      if (r.status === 200 && r.body && r.body.code === 200 && r.body.data) {
        answered = true;
        var d = r.body.data;
        peers.upsert(d.server_id, pr.base_url, '', 'paycode');
        return res.json({
          code: 200,
          message: 'ok',
          data: {
            user_id: d.user_id,
            name: d.name || d.user_id,
            short: d.short,
            base_url: pr.base_url,
            server_id: d.server_id,
            code: d.code,
            cross: true
          }
        });
      }
      done();
    }).catch(function () { done(); });
  });
});

// 扫本班收款码付款（token 属于本班，直接内部转账；跨班走 /cross/send）
router.post('/pay-code/pay', function (req, res) {
  var uid = String(req.user.user_id);
  var b = req.body || {};
  var info;
  try {
    info = payCode.decode(b.code);
  } catch (err) {
    return fail(res, err);
  }
  var amountCent = xy.toCent(b.amount);
  if (!(amountCent > 0)) return fail(res, new Error('金额至少 0.01 学元'));
  if (String(info.user_id) === uid) return fail(res, new Error('不能给自己转账'));

  // 本班码：直接内部转账；外班码（token 不在本班库）：走两阶段跨班
  var localRow = null;
  try { localRow = payCode.verify(info.token, info.user_id); } catch (e) { localRow = null; }

  if (!localRow) {
    try {
      payGuard.guardPay(uid, b.pin, amountCent);
    } catch (err) {
      return fail(res, err);
    }
    var meRow = db.prepare('SELECT net_name, real_name FROM users WHERE user_id = ?').get(uid);
    return crossPay.pay({
      userId: uid,
      to: info.user_id,
      token: info.token,
      base: info.base_url,
      fromBase: peers.localBaseHint(),
      amountCent: amountCent,
      memo: String(b.memo || '扫码付款').slice(0, 40),
      fromName: (meRow && (meRow.net_name || meRow.real_name)) || uid
    }).then(function (tx) {
      res.json({
        code: 200,
        message: tx.status === 'paid' ? '付款成功，对方班级已入账'
          : (tx.status === 'pending' ? '对方班级暂时没有响应，稍后自动重试' : ('付款未完成：' + (tx.error || ''))),
        data: {
          cross: true,
          to: info.user_id,
          to_name: info.name || info.user_id,
          amount: amountCent / 100,
          status: tx.status,
          tx: tx,
          account: xy.viewAccount(uid)
        }
      });
    }).catch(function (err) { fail(res, err); });
  }

  var row = localRow;
  try {
    payGuard.guardPay(uid, b.pin, amountCent);

    var peer = db.prepare('SELECT net_name, real_name FROM users WHERE user_id = ?').get(String(row.user_id));
    var r = xy.transfer({
      from: uid,
      to: String(row.user_id),
      amountCent: amountCent,
      ref: 'qr:' + uid + ':' + String(b.request_id || Date.now()),
      app: 'wallet',
      memo: String(b.memo || '扫码付款').slice(0, 40)
    });
    payCode.touch(info.token);

    res.json({
      code: 200,
      message: r && r.duplicate ? '这笔付款已经处理过了' : '付款成功',
      data: {
        duplicate: !!(r && r.duplicate),
        to: row.user_id,
        to_name: (peer && (peer.net_name || peer.real_name)) || info.name || row.user_id,
        amount: amountCent / 100,
        account: xy.viewAccount(uid)
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 跨班支付 ----------------
// 发起方向对端班级入账；本班先冻结，成功后结算，失败退回。
router.post('/cross/send', function (req, res) {
  var b = req.body || {};
  var uid = String(req.user.user_id);
  try {
    payCode.decode(b.code);
    var amountCent = xy.toCent(b.amount);
    if (!(amountCent > 0)) throw new Error('金额至少 0.01 学元');
    payGuard.guardPay(uid, b.pin, amountCent);
  } catch (err) {
    return fail(res, err);
  }

  var info = payCode.decode(b.code);
  var me = db.prepare('SELECT net_name, real_name FROM users WHERE user_id = ?').get(uid);

  crossPay.pay({
    userId: uid,
    to: info.user_id,
    token: info.token,
    base: info.base_url,
    fromBase: peers.localBaseHint(),
    amountCent: xy.toCent(b.amount),
    memo: String(b.memo || '').slice(0, 40),
    fromName: (me && (me.net_name || me.real_name)) || uid
  }).then(function (tx) {
    res.json({
      code: 200,
      message: tx.status === 'paid' ? '已转出，对方班级已入账'
        : (tx.status === 'pending' ? '对方班级暂时没有响应，稍后自动重试' : '转账未完成：' + (tx.error || '')),
      data: { tx: tx, account: xy.viewAccount(uid) }
    });
  }).catch(function (err) {
    fail(res, err);
  });
});

router.get('/cross/tx', function (req, res) {
  try {
    var uid = String(req.user.user_id);
    res.json({ code: 200, message: 'ok', data: { list: crossPay.list(uid, req.query.limit) } });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 概览 ----------------
router.get('/', function (req, res) {
  try {
    var uid = String(req.user.user_id);
    var account = xy.viewAccount(uid);   // getAccount 内部会懒开户 + 赠金
    var now = Date.now();

    try { yuanbao.sweepExpired(); } catch (e) { /* 懒清理失败不影响读 */ }

    var week = flowBetween(uid, startOfWeek(now), now + 1);
    var month = flowBetween(uid, startOfMonth(now), now + 1);
    var recent = xy.history(uid, { limit: 5 });
    var packets = yuanbao.list(uid);

    res.json({
      code: 200,
      message: 'ok',
      data: {
        account: account,
        daily: dailyState(uid),
        week: { in: week.in_cent / 100, out: week.out_cent / 100, count: week.n },
        month: { in: month.in_cent / 100, out: month.out_cent / 100, count: month.n },
        recent: recent.list,
        packets: {
          available: packets.available.length,
          mine_open: packets.mine.filter(function (p) { return p.status === 'open'; }).length
        },
        pay_pin: payPin.state(uid),
        sources: sourceList(),
        // 可提现额度：只有「累计线下充值 - 累计已提现」以内的充值学元能提，
        // 防止「赠金投资赚钱 → 卖出 → 提现」把系统赠金套成现金。
        withdrawable: xy.fromCent(xy.withdrawableCent(uid)),
        yuan_rate: xy.yuanRate(),
        limits: {
          transfer: xy.fromCent(xy.LIMITS.MAX_TRANSFER_CENT),
          recharge: xy.fromCent(xy.LIMITS.MAX_RECHARGE_CENT),
          // 学期剩余额度：让「为什么充不进去」在学生点之前就看得见
          recharge_quota: xy.fromCent(xy.LIMITS.RECHARGE_QUOTA_CENT),
          recharge_left: xy.fromCent(Math.max(0,
            xy.LIMITS.RECHARGE_QUOTA_CENT - xy.rechargedInSemesterCent(uid))),
          withdraw: xy.fromCent(xy.LIMITS.MAX_WITHDRAW_CENT),
          withdraw_min: xy.fromCent(xy.LIMITS.MIN_WITHDRAW_CENT),
          packet_total: xy.fromCent(yuanbao.MAX_TOTAL_CENT),
          packet_count: yuanbao.MAX_COUNT,
          cross: xy.fromCent(crossPay.MAX_CROSS_CENT),
          daily_out: xy.fromCent(payGuard.MAX_DAILY_OUT_CENT),
          daily_left: xy.fromCent(Math.max(0, payGuard.MAX_DAILY_OUT_CENT - payGuard.dailyOutCent(uid)))
        }
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 流水 ----------------
router.get('/ledger', function (req, res) {
  try {
    var uid = String(req.user.user_id);
    var limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    var beforeId = parseInt(req.query.beforeId, 10) || 0;
    var dir = String(req.query.direction || '');
    var cond = dir === 'in' ? 'AND e.delta > 0' : (dir === 'out' ? 'AND e.delta < 0' : '');

    var rows = db.prepare([
      'SELECT e.id, e.tx_id, e.delta, e.balance_after, e.pool, e.created_at,',
      '       t.kind, t.app_name, t.operator, t.memo',
      'FROM xy_entry e JOIN xy_tx t ON t.id = e.tx_id',
      'WHERE e.user_id = ? AND (? = 0 OR e.id < ?) ' + cond,
      'ORDER BY e.id DESC LIMIT ?'
    ].join('\n')).all(uid, beforeId, beforeId, limit);

    var list = rows.map(function (r) {
      return {
        id: r.id,
        delta: xy.fromCent(r.delta),
        delta_cent: r.delta,
        balance_after: xy.fromCent(r.balance_after),
        pool: r.pool || '',
        pool_label: r.pool === 'cash' ? '充值学元' : (r.pool === 'grant' ? '赠送学元' : ''),
        kind: r.kind,
        kind_label: xy.KINDS[r.kind] || r.kind,
        app: r.app_name,
        operator: r.operator,
        memo: r.memo,
        created_at: r.created_at
      };
    });

    res.json({
      code: 200,
      message: 'ok',
      data: {
        list: list,
        next_before_id: list.length === limit ? list[list.length - 1].id : 0
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 津贴 ----------------
router.post('/daily', function (req, res) {
  try {
    var r = xy.claimDaily(String(req.user.user_id));
    res.json({
      code: 200,
      message: r.duplicate ? '今天已经领过了' : '津贴已到账',
      data: {
        duplicate: !!r.duplicate,
        amount: r.amount,
        streak: r.streak,
        account: r.account,
        daily: dailyState(String(req.user.user_id))
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 找同学 ----------------
router.get('/search', function (req, res) {
  try {
    var uid = String(req.user.user_id);
    var q = String(req.query.q || '').trim();
    if (!q) return res.json({ code: 200, message: 'ok', data: { list: [] } });
    var like = '%' + q + '%';
    var rows = db.prepare([
      'SELECT user_id, net_name, real_name, password_hash FROM users',
      // 只有「停用」才排除。历史脏值（admin_promoted 等）不该让一个正常同学搜不到，
      // 见 migrations/031。
      "WHERE status <> 'disabled' AND user_id <> ? AND (user_id LIKE ? OR net_name LIKE ? OR real_name LIKE ?)",
      'ORDER BY user_id LIMIT 8'
    ].join('\n')).all(uid, like, like, like);

    res.json({
      code: 200,
      message: 'ok',
      data: {
        list: rows.map(function (r) {
          // password_hash 为空 = 跨班镜像用户（钱要走跨班通道，不能直接进账）
          return {
            user_id: r.user_id,
            name: r.net_name || r.real_name || r.user_id,
            remote: !r.password_hash,
            class_admin: constants.isClassAdmin(r.user_id)
          };
        })
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 转账 ----------------
// 选人列表：全班（含跨班镜像用户，标 remote）。转账 / 指定红包共用这一个接口。
router.get('/people', function (req, res) {
  try {
    var uid = String(req.user.user_id);
    var q = String(req.query.q || '').trim();
    var limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 120);
    var params = [uid];
    var cond = '';
    if (q) {
      cond = ' AND (user_id LIKE ? OR net_name LIKE ? OR real_name LIKE ?)';
      var like = '%' + q + '%';
      params.push(like, like, like);
    }
    var stmt = db.prepare([
      'SELECT user_id, net_name, real_name, password_hash FROM users',
      // 同上：只排除停用账号，别把历史脏值状态的同学藏起来
      "WHERE status <> 'disabled' AND user_id <> ?" + cond,
      'ORDER BY (password_hash IS NULL OR password_hash = \'\') ASC, user_id LIMIT ?'
    ].join('\n'));
    var rows = stmt.all.apply(stmt, params.concat([limit]));

    res.json({
      code: 200,
      message: 'ok',
      data: {
        list: rows.map(function (r) {
          return {
            user_id: r.user_id,
            name: r.net_name || r.real_name || r.user_id,
            remote: !r.password_hash,
            class_admin: constants.isClassAdmin(r.user_id)
          };
        })
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/transfer', function (req, res) {
  var body0 = req.body || {};
  var toUser = String(body0.to || '').trim();

  // 停用账号先拦掉：它不满足 isLocalUser，会被当成「外班镜像用户」去走跨班通道，
  // 最后报「没找到这位同学所在的班级」——对用户来说等于没说。
  if (toUser) {
    var localPeer = db.prepare('SELECT status FROM users WHERE user_id = ?').get(toUser);
    if (localPeer && localPeer.status === 'disabled') {
      return fail(res, new Error('这个学号已被停用，暂时收不了钱'));
    }
  }

  // 外班同学（镜像用户）：钱必须走「本班回收 → 对班入账」的跨班通道，
  // 绝不能直接 transfer 进镜像账户（那个人永远不会在本班登录，钱就锁死了）。
  if (toUser && !packetCross.isLocalUser(toUser)) {
    try {
      payGuard.guardPay(String(req.user.user_id), body0.pin, xy.toCent(body0.amount));
    } catch (err) {
      return fail(res, err);
    }
    return packetCross.payByUser({
      userId: String(req.user.user_id),
      to: toUser,
      amountCent: xy.toCent(body0.amount),
      memo: String(body0.memo || '').slice(0, 40)
    }).then(function (tx) {
      res.json({
        code: 200,
        message: tx.status === 'paid' ? '已转出，对方班级已入账'
          : (tx.status === 'pending' ? '对方班级暂时没有响应，稍后自动重试' : ('转账未完成：' + (tx.error || ''))),
        data: {
          cross: true,
          to: toUser,
          to_name: '',
          amount: xy.toCent(body0.amount) / 100,
          status: tx.status,
          tx: tx,
          account: xy.viewAccount(String(req.user.user_id))
        }
      });
    }).catch(function (err) { fail(res, err); });
  }

  try {
    var body = req.body || {};
    var uid = String(req.user.user_id);
    var to = String(body.to || '').trim();
    var amountCent = xy.toCent(body.amount);
    var memo = String(body.memo || body.note || '').slice(0, 60);

    if (!/^\d{4,12}$/.test(to)) throw new Error('学号格式不对');
    if (!(amountCent > 0)) throw new Error('金额至少 0.01 学元');

    // 支付密码 + 当日额度（微信式：先验证再动钱）
    payGuard.guardPay(uid, body.pin, amountCent);

    var peer = db.prepare('SELECT net_name, real_name, status FROM users WHERE user_id = ?').get(to);
    if (!peer) throw new Error('没找到这个学号');
    // 只拦「停用」；历史脏值状态不是封禁，不能让正常同学收不了钱（见 migrations/031）
    if (peer.status === 'disabled') throw new Error('这个学号已被停用，暂时收不了钱');

    // 收款方没打开过钱包也要能收钱：这里替他懒开户（一次性赠金由服务层幂等保证）。
    // 否则会出现「转账失败：对方尚未开通学元账户」——对付款方来说毫无道理。
    try { xy.ensureAccount(to); } catch (e) { /* 交给下面的 transfer 报具体原因 */ }

    var requestId = String(body.request_id || '').slice(0, 60);
    var ref = requestId ? ('wallet-transfer:' + uid + ':' + requestId) : undefined;

    var r = xy.transfer({
      from: uid,
      to: to,
      amountCent: amountCent,
      ref: ref,
      app: 'wallet',
      memo: memo || '同学转账'
    });

    res.json({
      code: 200,
      message: r && r.duplicate ? '这笔转账已经处理过了' : '转账成功',
      data: {
        duplicate: !!(r && r.duplicate),
        to: to,
        to_name: peer.net_name || peer.real_name || to,
        amount: amountCent / 100,
        account: xy.viewAccount(uid)
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 红包 ----------------
router.get('/packets', function (req, res) {
  try {
    var uid = String(req.user.user_id);
    try { yuanbao.sweepExpired(); } catch (e) { /* ignore */ }
    var data = yuanbao.list(uid);
    // 跨班领到的钱不在本班 xy_packet_claim 里，需要合并
    try {
      var remote = packetCross.list(uid, 10);
      if (remote.length) data.claimed = data.claimed.concat(remote);
      data.claimed.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      data.claimed = data.claimed.slice(0, 15);
    } catch (e) { /* 跨班表没建好也不影响本班红包 */ }
    res.json({ code: 200, message: 'ok', data: data });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/packet', function (req, res) {
  try {
    var body = req.body || {};
    var uid = String(req.user.user_id);
    var totalCent = xy.toCent(body.total || body.amount);
    var count = parseInt(body.count, 10) || 0;
    var note = String(body.note || '').slice(0, 40);

    if (!(totalCent > 0)) throw new Error('总金额至少 0.01 学元');
    payGuard.guardPay(uid, body.pin, totalCent);

    var scope = body.scope === 'cross' ? 'cross' : 'local';
    var kind = ['normal', 'designated', 'phrase'].indexOf(body.kind) >= 0 ? body.kind : 'normal';
    var targets = Array.isArray(body.targets) ? body.targets : [];
    // 指定红包里只要有外班同学，就自动升为跨班（红包码 + 跨班通道都要）
    if (kind === 'designated') {
      for (var ti = 0; ti < targets.length; ti++) {
        if (!packetCross.isLocalUser(String(targets[ti]))) { scope = 'cross'; break; }
      }
    }
    var r = yuanbao.create(uid, totalCent, count, note, 'wallet', {
      scope: scope, kind: kind, passphrase: body.passphrase, targets: targets
    });
    var msg = '红包已发出';
    if (kind === 'designated') msg = '专属红包已发出，只有选中的同学能领';
    else if (kind === 'phrase') msg = '口令红包已发出，领的时候要输入「' + (r.passphrase || note) + '」';
    else if (scope === 'cross') msg = '跨班红包已发出，把红包码发给同学';
    res.json({
      code: 200,
      message: msg,
      data: r,
      account: xy.viewAccount(uid)
    });
  } catch (err) {
    fail(res, err);
  }
});

// 凭 红包码 / 口令 / pid 领取（本班 / 外班都走这里）
router.post('/packet/claim-code', function (req, res) {
  var uid = String(req.user.user_id);
  var b = req.body || {};
  packetCross.claimRemote({
    userId: uid,
    code: b.code,
    phrase: b.phrase,
    packetId: b.packet_id,
    baseHint: b.base || ''
  }).then(function (r) {
    if (r && r.pending) {
      return res.json({
        code: 200,
        message: r.message || '红包正在自动到账',
        data: { pending: true, amount: 0 },
        account: xy.viewAccount(uid)
      });
    }
    res.json({
      code: 200,
      message: r.duplicate ? '这个红包你已经领过了' : ('抢到 ' + Number(r.amount || 0).toFixed(2) + ' 学元'),
      data: r,
      account: xy.viewAccount(uid)
    });
  }).catch(function (err) {
    fail(res, err);
  });
});

// 口令预览：领取前先看到「谁发的、还剩几个」
router.get('/packet/info', function (req, res) {
  var uid = String(req.user.user_id);
  var code = String(req.query.code || '').trim().toUpperCase();
  var phrase = String(req.query.phrase || '').trim();
  if (!code && !phrase) return fail(res, new Error('缺少红包码或口令'));

  var local = code ? yuanbao.findByCode(code) : null;
  if (!local && phrase) local = yuanbao.findByPhrase(phrase);
  if (!local && !phrase && code) {
    return fail(res, new Error('红包码不存在、已过期，或对方班级当前离线'));
  }
  if (local) {
    var pv = yuanbao.preview(local, uid);
    pv.cross = false;
    return res.json({ code: 200, message: 'ok', data: pv });
  }
  packetCross.resolveOwner(phrase || code, req.query.base || '').then(function (owner) {
    if (!owner) return fail(res, new Error('红包码不存在、已过期，或对方班级当前离线'));
    var p = owner.packet || {};
    p.cross = true;
    p.server_id = owner.server_id || p.server_id || '';
    p.base_url = owner.base_url;
    res.json({ code: 200, message: 'ok', data: p });
  }).catch(function (err) {
    fail(res, err);
  });
});

// 领取记录：谁领了、各领多少。聊天里点红包即可打开。
router.get('/packet/:id/claims', function (req, res) {
  try {
    var uid = String(req.user.user_id);
    var id = parseInt(req.params.id, 10);
    if (!(id > 0)) throw new Error('红包不存在');
    res.json({ code: 200, message: 'ok', data: yuanbao.claims(id, uid) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/packet/:id/claim', function (req, res) {
  try {
    var uid = String(req.user.user_id);
    var id = parseInt(req.params.id, 10);
    if (!(id > 0)) throw new Error('红包不存在');
    var r = yuanbao.claim(id, uid, 'wallet', { phrase: (req.body || {}).phrase });
    res.json({
      code: 200,
      message: r.duplicate ? '你已经领过这个红包' : ('抢到 ' + r.amount.toFixed(2) + ' 学元'),
      data: r,
      account: xy.viewAccount(uid)
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---------------- 榜单 ----------------
// ---------------- 群收款（AA） ----------------
// 钱的走法是 N 笔同学转账（见 services/collect.js），不另造资金流，
// 所以支付密码、当日额度、幂等这些约束自动生效。

router.get('/collect/list', function (req, res) {
  try {
    res.json({
      code: 200,
      message: 'ok',
      data: collect.list(String(req.user.user_id), { limit: req.query.limit })
    });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/collect', function (req, res) {
  try {
    var body = req.body || {};
    var perCent = xy.yuanToCent(body.perYuan);
    if (perCent === null) throw new Error('每人金额不合法');
    var r = collect.create({
      creator: String(req.user.user_id),
      title: body.title,
      members: body.members,
      perCent: perCent,
      expiresHours: body.expiresHours,
      requestId: body.requestId
    });
    res.json({
      code: 200,
      message: r.duplicate ? '这张收款单已经建过' : '收款单已发出',
      data: r.collect
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/collect/:id', function (req, res) {
  try {
    res.json({
      code: 200,
      message: 'ok',
      data: collect.detail(req.params.id, String(req.user.user_id))
    });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/collect/:id/pay', function (req, res) {
  try {
    var uid = String(req.user.user_id);
    var body = req.body || {};
    // 先把单子读出来拿金额，再走风控 —— 顺序反了就是「先扣钱后验密码」
    var d = collect.detail(req.params.id, uid);
    payGuard.guardPay(uid, body.pin, d.per_cent);
    var r = collect.pay(req.params.id, uid);
    res.json({
      code: 200,
      message: r.duplicate ? '你已经付过这一份了' : ('已付 ' + d.per + ' 学元'),
      data: r.collect
    });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/collect/:id/close', function (req, res) {
  try {
    var r = collect.close(req.params.id, String(req.user.user_id), {
      force: !!(req.user.is_class_admin || req.user.is_admin === 1)
    });
    res.json({
      code: 200,
      message: r.duplicate ? '这张收款单已经结束' : '已结束收款',
      data: r.collect
    });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/leaderboard', function (req, res) {
  try {
    var uid = String(req.user.user_id);
    var limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    var rows = xy.leaderboard({ limit: limit });
    var me = null;
    for (var i = 0; i < rows.length; i++) {
      rows[i].is_me = String(rows[i].user_id) === uid;
      if (rows[i].is_me) me = rows[i];
    }
    res.json({
      code: 200,
      message: 'ok',
      data: {
        list: rows,
        me: me,
        account: xy.viewAccount(uid)
      }
    });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
