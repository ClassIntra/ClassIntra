// 组网学元管理（xy-mesh）· 主班制
// ============================================================
// 需求（2026-11 负责人拍板）：班级组网（mesh）内指定一个「学元主班」，
// 主班班管在自家管控中心就能同时管理主班 + 从班两个班的充值与学元事务；
// 从班班管的学元管理整体隐藏并封锁（防止私自印钱 —— 参考 Cluss 的
// quota_lock 取证案例：某班管三天给自己充了 6666 元 ×2），
// 但从班班管的其他班级管理（用户/公告/资源…）完全不受影响。
//
// 架构（为什么这么做）：
//   · 学元账本绝不经中继同步（relay-sync 只同步聊天/帖子/资料），
//     每个班的钱只在本班实例上。所以「给从班学员充值」必须由从班实例
//     在自己的账本上入账 —— 主班只负责「替他操作」，不代记账。
//   · 通道复用跨班支付（cross-pay）已验证的一套：HMAC(RELAY_SECRET)
//     + 时间戳 ±5min 防重放 + ref 幂等。跨班资金一把钥匙，不新发密钥。
//   · 命令的请求/响应形状刻意与本地 /admin/* 路由同构，
//     前端只需在 URL 上分叉，业务校验（单笔上限/学期配额/镜像拦截）
//     在从班本地原样生效 —— 主班绕不过任何护栏。
//   · 配置存 app_config（app_name='xueyuan-mesh'），管理端可视化修改，
//     即时生效免重启；默认无配置 = 现状，两班独立各管各的。
//
// 安全边界：
//   · /mesh/command 只认 HMAC 签名，不吃 JWT —— 从班班管即使登录了
//     也伪造不出主班命令（没有 RELAY_SECRET 就没有写入权）。
//   · member 角色下，从班本班班管走 /admin/* 一律 403（requireTreasury 拦），
//     唯一写入口剩 mesh 签名命令这一条。
//   · 镜像用户（password_hash 为空）在任何命令里都不可入账，
//     钱进一个永远无人登录的账号等于锁死（与 cross-pay 同一条红线）。

var crypto = require('crypto');
var http = require('http');
var https = require('https');
var db = require('../utils/db');
var appConfig = require('../utils/app-config');
var constants = require('../utils/constants');

var APP_NAME = 'xueyuan-mesh';
var NET_TIMEOUT = 8000;
var SIG_WINDOW = 5 * 60 * 1000;   // 与 cross-pay 同窗：两机时钟差 5 分钟内可用

// ---------------- 配置 ----------------
// peers 形状（JSON 存单键）：[{ class: '8', base: 'http://10.0.0.8:9001' }]
//   master 视角 = 从班列表（可多个）；member 视角 = 仅一项，即主班。
// class 是两位班号（学号 YYCCNN 的 CC 段），base 是对端 9001 主实例基址。

function parsePeers(raw) {
  var out = [];
  try {
    var arr = JSON.parse(String(raw || '[]'));
    if (!Array.isArray(arr)) return out;
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i] || {};
      var cls = String(p.class || '').trim();
      var base = String(p.base || '').trim().replace(/\/+$/, '');
      if (/^\d{2}$/.test(cls) && /^https?:\/\/[A-Za-z0-9_.:\-\[\]]{3,120}$/.test(base)) {
        out.push({ class: cls, base: base });
      }
    }
  } catch (e) { /* 坏配置按空处理，绝不让学元管理整体挂掉 */ }
  return out;
}

function getConfig() {
  var vals = appConfig.readValues(APP_NAME);
  var role = String(vals.role || '').trim();
  if (role !== 'master' && role !== 'member') role = '';
  return { role: role, peers: parsePeers(vals.peers) };
}

function saveConfig(patch) {
  var cur = getConfig();
  var next = {
    role: patch.role !== undefined ? String(patch.role || '').trim() : cur.role,
    peers: patch.peers !== undefined ? JSON.stringify(parsePeers(JSON.stringify(patch.peers))) : JSON.stringify(cur.peers)
  };
  if (next.role !== 'master' && next.role !== 'member' && next.role !== '') {
    throw new Error('mesh 角色只能是 master / member / 空');
  }
  if (next.role === 'member' && parsePeers(next.peers).length !== 1) {
    throw new Error('从班（member）必须且只能配置一个主班地址');
  }
  if (next.role === 'master' && parsePeers(next.peers).length < 1) {
    throw new Error('主班（master）至少要配置一个从班地址');
  }
  appConfig.saveValues(APP_NAME, { role: next.role, peers: next.peers });
  return getConfig();
}

function secret() {
  var s = process.env.RELAY_SECRET || '';
  if (!s) throw new Error('组网学元未配置共享密钥（RELAY_SECRET）');
  return s;
}

function nowMs() { return Date.now(); }
function makeRef() {
  return 'mesh:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 10);
}

// ---------------- 签名（字段顺序固定，防 JSON 键序差异） ----------------
function canonical(ts, ref, command, payloadJson) {
  return [String(ts), String(ref), String(command), String(payloadJson)].join('|');
}

function rawSign(text) {
  return crypto.createHmac('sha256', secret()).update(String(text)).digest('hex');
}

function rawVerify(text, sig) {
  var a = Buffer.from(String(sig || ''), 'utf8');
  var b = Buffer.from(rawSign(text), 'utf8');
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

// ---------------- 幂等审计表（服务层 ensure，与 xy_cross_tx 同模式） ----------------
var logReady = false;
function ensureLog() {
  if (logReady) return;
  db.exec(`
CREATE TABLE IF NOT EXISTS xy_mesh_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  command TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  operator TEXT,
  created_at INTEGER NOT NULL
);
`);
  logReady = true;
}

// ---------------- 发起端（主班 → 从班） ----------------
function postJson(base, urlPath, body, headers) {
  return new Promise(function (resolve, reject) {
    var url;
    try { url = new URL(base + urlPath); } catch (e) { return reject(new Error('对端地址不合法: ' + base)); }
    var mod = url.protocol === 'https:' ? https : http;
    var data = Buffer.from(JSON.stringify(body || {}), 'utf8');
    var req = mod.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      method: 'POST',
      timeout: NET_TIMEOUT,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }, headers || {})
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { /* 非 JSON 当原始文本 */ }
        resolve({ status: res.statusCode, body: parsed, text: text });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('对端响应超时（8 秒）')); });
    req.on('error', reject);
    req.end(data);
  });
}

// 主班把一条命令发给某个从班。失败直接抛错给管理端展示，
// 班管重试即可 —— ref 幂等保证重试不会二次入账。
function sendCommand(peer, command, payload) {
  ensureLog();
  var ts = String(nowMs());
  var ref = makeRef();
  var payloadJson = JSON.stringify(payload || {});
  var sig = rawSign(canonical(ts, ref, command, payloadJson));
  return postJson(peer.base, '/api/xueyuan/mesh/command', {
    command: command,
    payload: payload || {}
  }, {
    'X-XY-Mesh-Ts': ts,
    'X-XY-Mesh-Ref': ref,
    'X-XY-Mesh-Sig': sig
  }).then(function (r) {
    if (r.status === 200 && r.body && r.body.code === 200) return r.body.data;
    var msg = (r.body && r.body.message) || ('对端返回 ' + r.status);
    throw new Error('组网命令失败（' + peer.class + ' 班）: ' + msg);
  });
}

// ---------------- 接收端（从班校验 + 执行） ----------------
function verifyHeaders(req) {
  var ts = Number(req.headers['x-xy-mesh-ts'] || 0);
  var ref = String(req.headers['x-xy-mesh-ref'] || '');
  var sig = String(req.headers['x-xy-mesh-sig'] || '');
  if (!ts || !ref || !sig) throw new Error('缺少组网签名头');
  if (Math.abs(nowMs() - ts) > SIG_WINDOW) throw new Error('组网命令已过期（时钟差超过 5 分钟）');
  var body = req.body || {};
  var payloadJson = JSON.stringify(body.payload || {});
  if (!rawVerify(canonical(ts, ref, body.command, payloadJson), sig)) {
    throw new Error('组网签名校验失败');
  }
  return { ref: ref, command: String(body.command || ''), payload: body.payload || {} };
}

// 只读命令：连通测试与查询，不要求对端自认从班（ping 是配置排障的手段，
// 若连 ping 都要求 member，漏配的那台就永远无法被发现）。
var READ_COMMANDS = {
  ping: 1, students: 1, overview: 1, health: 1, recharges: 1, withdrawals: 1,
  goods_list: 1, orders_list: 1
};

// 写命令要求对端已把自己配置为从班。防「两端配置漂移」：
// 主班单边配好、从班忘了配时，从班班管的学元管理还开着 —— 双头收钱必出对账事故。
// 让写命令显式失败并指路，比静默双通道更安全。
function assertMemberRole(command) {
  if (READ_COMMANDS[command]) return;
  var role = getConfig().role;
  if (role !== 'member') {
    throw new Error('本班未配置为组网从班（member），无法执行主班写命令；请在本班管控中心「组网学元配置」选「学元从班」并填主班地址');
  }
}

// 命令分发。返回值形状与本地 /admin/* 路由的 data 字段同构。
function dispatch(command, payload) {
  var xy = require('./xueyuan');      // 惰性 require，避免服务层循环依赖
  var svc = require('../ledger/service');
  var dbx = require('../utils/db');

  switch (command) {
    case 'ping':
      return { pong: true, server_id: require('./peers').serverId(), time: nowMs() };

    // 从班学员账号（学元视角）：只回真用户（password_hash 非空）。
    // 镜像用户不回传，主班自然没法给「永远不会有人登录的账号」充值。
    case 'students': {
      var rows = dbx.prepare(
        "SELECT user_id, net_name, real_name, status FROM users WHERE password_hash != '' ORDER BY user_id ASC"
      ).all();
      var list = [];
      for (var i = 0; i < rows.length; i++) {
        var u = rows[i];
        var bal = { cash: 0, grant: 0 };
        try {
          var b = svc.balanceOf(u.user_id);
          bal.cash = b.CASH || 0;
          bal.grant = b.GRANT || 0;
        } catch (e) { /* 未开户按 0 展示 */ }
        list.push({
          user_id: u.user_id,
          net_name: u.net_name,
          real_name: u.real_name,
          status: u.status,
          cash: bal.cash,
          grant: bal.grant
        });
      }
      return { list: list };
    }

    case 'overview':
      return { summary: xy.summary({ recentLimit: payload.recentLimit || 10 }), audit: xy.audit() };

    case 'health':
      return xy.health({ days: payload.days || 30 });

    case 'recharges':
      return { list: xy.listRecharges({ user: payload.user, limit: payload.limit || 30 }) };

    case 'withdrawals':
      return {
        list: xy.listWithdrawals({ status: payload.status, user: payload.user, limit: payload.limit || 30 }),
        pending: xy.listWithdrawals({ status: 'pending', limit: 100 })
      };

    // —— 交易体系（班级小铺）：与 /api/xy 的 goods/orders 管理面同构 ——
    // 主班班管可跨班上架/下架商品、处理从班订单（履约/结算/退款）。
    // 资金动作全部落在从班本地账本（svc.orders 内部走 post() 唯一写入口），
    // 状态机天然防重（settled 订单再结算会被拒），mesh 层只做鉴权与转发。

    case 'goods_list':
      return svc.goods.list({ status: payload.status || 'on_shelf', limit: payload.limit || 50 });

    case 'goods_create':
      return svc.goods.create({
        name: String(payload.name || '').trim(),
        price_cent: Number(payload.price_cent),
        cost_cent: Number(payload.cost_cent || 0),
        kind: payload.kind || 'digital',
        seller: payload.seller || 'platform',
        allowLoss: !!payload.allow_loss
      });

    case 'goods_status':
      return svc.goods.setStatus(Number(payload.id), payload.status);

    case 'orders_list':
      // mesh 命令等价班管视角：看全班全部状态的订单
      return svc.orders.list({
        buyer: null,
        status: payload.status || null,
        limit: payload.limit || 30
      });

    case 'order_fulfill':
      return svc.orders.fulfill(Number(payload.id), {
        ref: String(payload.ref || makeRef()),
        initiator: String(payload.operator || 'mesh')
      });

    case 'order_settle':
      return svc.orders.settle(Number(payload.id), {
        ref: String(payload.ref || makeRef()),
        initiator: String(payload.operator || 'mesh')
      });

    case 'order_refund':
      return svc.orders.refund(Number(payload.id), {
        ref: String(payload.ref || makeRef()),
        initiator: String(payload.operator || 'mesh'),
        reason: payload.reason
      });

    // —— 以下为写操作。形状与本地 admin 路由一致，护栏全部本地生效 ——。

    case 'recharge': {
      var ids = Array.isArray(payload.userIds) ? payload.userIds : [];
      if (!ids.length) throw new Error('请选择要充值的账号');
      if (ids.length > 50) throw new Error('一次最多为 50 个账号充值');
      // 与本地路由同构：优先收人民币元（yuan），兼容学元分（amountCent）
      var amountCent;
      if (payload.yuan !== undefined && payload.yuan !== null && payload.yuan !== '') {
        amountCent = xy.yuanToCent(payload.yuan);
        if (amountCent === null) throw new Error('人民币金额不合法');
      } else {
        amountCent = Number(payload.amountCent);
      }
      if (!(amountCent > 0)) throw new Error('充值金额必须大于 0');
      if (amountCent > xy.LIMITS.MAX_RECHARGE_CENT) {
        throw new Error('单人单次充值不能超过 ' + xy.centToYuan(xy.LIMITS.MAX_RECHARGE_CENT) + ' 元');
      }
      var reqId = String(payload.requestId || '').slice(0, 40) ||
        (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      var done = [];
      var skipped = [];
      for (var k = 0; k < ids.length; k++) {
        var uid = String(ids[k] || '').trim();
        try {
          var u = dbx.prepare('SELECT user_id, net_name, status, password_hash FROM users WHERE user_id = ?').get(uid);
          if (!u) { skipped.push({ user_id: uid, reason: '账号不存在' }); continue; }
          if (!u.password_hash) { skipped.push({ user_id: uid, reason: '外班镜像账号不能充值' }); continue; }
          if (u.status === 'disabled') { skipped.push({ user_id: uid, reason: '账号已停用，不能充值' }); continue; }
          var r = xy.recharge({
            user: uid,
            amountCent: amountCent,
            operator: String(payload.operator || 'mesh'),
            method: String(payload.method || 'cash').slice(0, 20),
            memo: String(payload.memo || '').slice(0, 80) || '组网主班代充',
            requestId: reqId + ':' + uid
          });
          done.push({ user_id: uid, net_name: u.net_name, amount: xy.fromCent(amountCent), yuan: xy.centToYuan(amountCent), duplicate: !!r.duplicate });
        } catch (e) {
          skipped.push({ user_id: uid, reason: e.message });
        }
      }
      if (!done.length && skipped.length) {
        throw new Error('充值未生效：' + skipped[0].reason + '（' + skipped[0].user_id + '）');
      }
      return { done: done, skipped: skipped, request_id: reqId, rate: xy.yuanRate() };
    }

    case 'recharge_revoke':
      return xy.revokeRecharge({
        rechargeId: String(payload.rechargeId || ''),
        operator: String(payload.operator || 'mesh'),
        reason: String(payload.reason || '')
      });

    case 'withdraw_review':
      return xy.reviewWithdraw(String(payload.id || ''), payload.approve !== false, {
        reviewer: String(payload.reviewer || 'mesh'),
        memo: String(payload.memo || '').slice(0, 80)
      });

    // 批量发放/扣减：形状与本地 /admin/grant /admin/deduct 同构
    //（{ userIds, amountCent, memo, requestId, operator } → { done, skipped }），
    // 前端从班视角复用同一套提交逻辑，只在 URL 上分叉。
    case 'grant':
    case 'deduct': {
      var gids = Array.isArray(payload.userIds) ? payload.userIds : [];
      if (!gids.length) throw new Error('请选择要操作的账号');
      if (gids.length > 200) throw new Error('一次最多处理 200 个账号');
      var gAmt = (payload.amount !== undefined && payload.amount !== null && payload.amount !== '')
        ? xy.toCent(payload.amount)   // 与本地路由同构：收学元数
        : Number(payload.amountCent);
      if (!(gAmt > 0)) throw new Error('金额不合法');
      if (gAmt > xy.LIMITS.MAX_GRANT_CENT) {
        throw new Error('单人单次发放不能超过 ' + xy.fromCent(xy.LIMITS.MAX_GRANT_CENT) + ' 学元');
      }
      var gReq = String(payload.requestId || '').slice(0, 40) ||
        (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      var gOp = String(payload.operator || 'mesh');
      var gMemo = String(payload.memo || '').slice(0, 80) || (command === 'grant' ? '组网教师发放' : '组网教师扣减');
      var gDone = [];
      var gSkipped = [];
      for (var gi = 0; gi < gids.length; gi++) {
        var guid = String(gids[gi] || '').trim();
        try {
          var gu = dbx.prepare('SELECT user_id, net_name, status, password_hash FROM users WHERE user_id = ?').get(guid);
          if (!gu) { gSkipped.push({ user_id: guid, reason: '账号不存在' }); continue; }
          if (!gu.password_hash) { gSkipped.push({ user_id: guid, reason: '外班镜像账号不能操作' }); continue; }
          if (command === 'grant') {
            if (gu.status === 'disabled') { gSkipped.push({ user_id: guid, reason: '账号已停用，不能发放' }); continue; }
            xy.ensureAccount(guid);
            var gg = xy.grant({
              to: guid,
              amountCent: gAmt,
              ref: 'grant:' + gReq + ':' + guid,
              operator: gOp,
              memo: gMemo,
              meta: { request_id: gReq }
            });
            gDone.push({ user_id: guid, net_name: gu.net_name, amount: xy.fromCent(gAmt), duplicate: !!gg.duplicate });
          } else {
            var gb = xy.burn({
              from: guid,
              amountCent: gAmt,
              kind: 'admin_deduct',
              ref: 'deduct:' + gReq + ':' + guid,
              operator: gOp,
              memo: gMemo,
              meta: { request_id: gReq }
            });
            gDone.push({ user_id: guid, net_name: gu.net_name, amount: -xy.fromCent(gAmt), duplicate: !!gb.duplicate });
          }
        } catch (ge) {
          gSkipped.push({ user_id: guid, reason: ge.message });
        }
      }
      if (!gDone.length && gSkipped.length) {
        throw new Error((command === 'grant' ? '发放' : '扣减') + '未生效：' + gSkipped[0].reason + '（' + gSkipped[0].user_id + '）');
      }
      return { done: gDone, skipped: gSkipped, request_id: gReq };
    }

    case 'refund': {
      var toUid = String(payload.userId || '').trim();
      var fromUid = String(payload.from || '').trim();
      if (!toUid || !fromUid) throw new Error('请填写收款人与退款方学号');
      // 与本地路由同构：优先人民币元，兼容学元分
      var rAmt;
      if (payload.yuan !== undefined && payload.yuan !== null && payload.yuan !== '') {
        rAmt = xy.yuanToCent(payload.yuan);
      } else {
        rAmt = Number(payload.amountCent);
      }
      if (!(rAmt > 0)) throw new Error('退款金额不合法');
      return xy.refund({
        to: toUid,
        from: fromUid,
        amountCent: rAmt,
        pool: payload.pool === 'grant' ? 'grant' : 'cash',
        reason: payload.reason,
        operator: String(payload.operator || 'mesh'),
        ref: 'refund:' + String(payload.requestId || makeRef()),
        app: 'wallet'
      });
    }

    default:
      throw new Error('未知的组网命令: ' + command);
  }
}

// HTTP 入口：验签 → ref 幂等 → 执行 → 审计落库。
// 幂等命中时回放首次结果（管理端超时重试不会二次入账）。
function handleCommand(req) {
  ensureLog();
  var v = verifyHeaders(req);
  assertMemberRole(v.command);
  var seen = db.prepare('SELECT status, result_json, error FROM xy_mesh_log WHERE ref = ?').get(v.ref);
  if (seen) {
    if (seen.status === 'ok') return { code: 200, message: 'ok', data: JSON.parse(seen.result_json || 'null') };
    throw new Error('该命令此前已失败（' + (seen.error || '未知') + '），请换新请求重试');
  }
  var operator = String((v.payload && v.payload.operator) || '');
  try {
    var data = dispatch(v.command, v.payload);
    db.prepare('INSERT INTO xy_mesh_log (ref, command, payload_json, status, result_json, operator, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(v.ref, v.command, JSON.stringify(v.payload).slice(0, 4000), 'ok', JSON.stringify(data).slice(0, 8000), operator, nowMs());
    return { code: 200, message: 'ok', data: data };
  } catch (err) {
    db.prepare('INSERT INTO xy_mesh_log (ref, command, payload_json, status, error, operator, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(v.ref, v.command, JSON.stringify(v.payload).slice(0, 4000), 'err', String(err.message || err).slice(0, 500), operator, nowMs());
    throw err;
  }
}

// 管理端连通性测试（系统管理员保存配置前先 ping 对端）
function testPeer(base) {
  return sendCommand({ base: String(base || '').trim().replace(/\/+$/, ''), class: '?' }, 'ping', {});
}

// 从班封锁判定：member 角色下本班班管不得触碰学元管理。
// 独立成纯函数方便契约测试；系统管理员豁免（排障需要）。
function blockTreasury(userId) {
  if (constants.isSystemAdmin(userId)) return false;
  try {
    return getConfig().role === 'member';
  } catch (e) {
    return false;   // 配置读取失败按未组网处理，不放大故障
  }
}

// 最近组网命令审计（系统管理员的配置卡展示用）：只给排障要看的几列
function listLog(limit) {
  ensureLog();
  var n = Math.max(1, Math.min(100, Number(limit) || 20));
  return db.prepare(
    'SELECT ref, command, status, operator, error, created_at FROM xy_mesh_log ORDER BY id DESC LIMIT ?'
  ).all(n);
}

module.exports = {
  APP_NAME: APP_NAME,
  getConfig: getConfig,
  saveConfig: saveConfig,
  sendCommand: sendCommand,
  handleCommand: handleCommand,
  testPeer: testPeer,
  blockTreasury: blockTreasury,
  listLog: listLog,
  isSystemAdmin: constants.isSystemAdmin
};
