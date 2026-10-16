// Cluss 联动桥（ClassIntra 侧，**只读**）
//
// 用途：让 Cluss 能校验 ClassIntra 的账号，实现「ClassIntra 用户直接登录 Cluss」。
//
// ---- 设计约束（重要）----
// 1. 本文件对 ClassIntra 现有逻辑零改动、零侵入：不碰 auth.js，不碰用户表写入，
//    只在 app.js 里多挂一个路由前缀。
// 2. **全部是只读端点，没有任何写操作**，因此不可能出现
//    「通过本桥注册 / 改密 / 提权 / 改数据」的路径。当前四个：
//      GET  /ping             存活探测
//      POST /verify           校验账号口令（唯一会返回 password_hash 的端点）
//      GET  /class-roster     取某班名册（按 user_id 编码在 SQL 里精确限定）
//      GET  /student-profile  学生画像素材（脱敏白名单，见该端点的注释）
//    新增端点时必须保持"只读"与"逐列白名单"这两条 —— 后者尤其重要，
//    详见 /student-profile 的说明。
// 3. 认证用 X-Bridge-Secret，与 ClassIntra 既有的 RELAY_SECRET 共用同一密钥，
//    避免再多一个需要运维同步的密钥。未配置密钥时**直接拒绝服务**（不放行）。
// 4. 校验成功会返回 password_hash —— 这是 Cluss 侧离线登录所需（与既有的
//    /api/auth/relay-verify 行为一致）。风险面由「必须持有共享密钥」这一条把住；
//    除 /verify 外，其余端点不返回任何凭据类字段。

var express = require('express');
var router = express.Router();
var crypto = require('crypto');
var db = require('../utils/db');
var config = require('../config');
var pwdUtil = require('../utils/password');
var constants = require('../utils/constants');

// 时序安全的字符串比较（防止密钥被时序探测逐字节猜出）
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  var bufA = Buffer.from(a);
  var bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireBridgeSecret(req, res, next) {
  var secret = config.relay.secret || '';
  if (!secret) {
    // 与 relay-verify 同策略：密钥没配就拒绝，绝不裸奔
    return res.status(503).json({ code: 503, message: '未配置 RELAY_SECRET，联动桥不可用' });
  }
  var provided = req.headers['x-bridge-secret'] || '';
  if (!safeCompare(String(provided), secret)) {
    // 刻意用 403 且**不带 data.user**：Cluss 侧靠「有没有 data.user」区分
    // 「密钥不对」与「账号被禁用」。verify 端点已不再对禁用账号回 403，
    // 所以这里的 403 现在是**唯一**含义 —— 改了会让 Cluss 的判定重新变歧义。
    return res.status(403).json({ code: 403, message: '密钥校验失败' });
  }
  next();
}

// ============================================================
// GET /api/cluss-bridge/ping —— 存活探测（Cluss 启动时判断联动是否可用）
// ============================================================
router.get('/ping', requireBridgeSecret, function(req, res) {
  res.json({
    code: 200,
    message: 'ok',
    data: { service: 'classintra', bridge: 'cluss', time: new Date().toISOString() }
  });
});

// ============================================================
// POST /api/cluss-bridge/verify —— 校验账号口令
// body: { account, password }
//
// 命中规则与 ClassIntra 登录一致：学号 / 网名 / 姓名三选一
// 注意：**不校验 pre_records 名单**——能走到这里说明该账号本就已在 ClassIntra 的
// users 表里（即当初就是通过名单注册进来的），名单闸门在注册时已经生效过。
//
// 返回约定（Cluss 侧按这个判定，改动务必同步改 Cluss 的 ci-bridge.js）：
//   200 + data.user   口令正确。data.disabled 仅为提示，**不表示要拒绝**
//   401               口令不对
//   404               账号不存在
//   403（无 data.user）桥密钥不对 —— 配置问题，不是账号问题
// ============================================================
router.post('/verify', requireBridgeSecret, function(req, res) {
  try {
    var account = String(req.body.account || '').trim();
    var password = req.body.password;

    if (!account || !password) {
      return res.status(400).json({ code: 400, message: '缺少账号或密码' });
    }

    // 与 auth.js 的登录同款候选排序：学号精确 > 有本地密码 > 建号顺序
    var candidates = db.prepare(
      'SELECT * FROM users WHERE user_id = ? OR net_name = ? OR real_name = ?'
    ).all(account, account, account);

    if (!candidates.length) {
      return res.status(404).json({ code: 404, message: '账号不存在' });
    }

    candidates.sort(function(a, b) {
      var aExact = a.user_id === account ? 0 : 1;
      var bExact = b.user_id === account ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      var aHasPwd = a.password_hash ? 0 : 1;
      var bHasPwd = b.password_hash ? 0 : 1;
      if (aHasPwd !== bHasPwd) return aHasPwd - bHasPwd;
      return (a.id || 0) - (b.id || 0);
    });

    var matched = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c.password_hash) continue;   // 跨班同步行没有本地密码，无法在此校验
      var ok = false;
      try {
        ok = pwdUtil.verifyPassword(password, c.password_hash);
      } catch (e) {
        console.warn('[ClussBridge] 密码校验异常，跳过: user_id=' + c.user_id + ' err=' + e.message);
        continue;
      }
      if (ok) { matched = c; break; }
    }

    if (!matched) {
      return res.status(401).json({ code: 401, message: '账号或密码错误' });
    }

    // ---- 关于「禁用」账号（2026-10-09 改）----
    //
    // 以前这里对 disabled 账号回 403。问题在于**同一个 403 和上面
    // requireBridgeSecret 的「密钥校验失败」撞了**：Cluss 侧收到 403 时
    // 分不清「密码正确、只是被禁用」和「根本没配好密钥」，于是只能一律拒绝 ——
    // 结果就是 Cluss 想采纳「CI 的禁用不影响 Cluss」也采纳不了。
    //
    // 现在改成：**密码已经校验通过就照常回 200**，额外带一个 disabled 标记。
    //   · 200 + data.user     = 口令正确，Cluss 可以放行（要不要认 disabled 由 Cluss 决定）
    //   · 403（无 data.user） = 只剩「密钥不对」这一种含义，Cluss 侧据此 fail closed
    // 这样两个含义在协议上彻底分开，Cluss 才可能安全地「认密码、不认禁用」。
    // CI 自身的登录闸门不受影响 —— 本文件只服务 Cluss 的委托校验。
    var ciDisabled = matched.status === 'disabled';

    // user_id 编码 YYCCNN：YY=年份后两位，NN=班级，CC=班内编号
    var userId = String(matched.user_id);
    var enrollmentYear = '';
    var classNo = '';
    if (/^\d{6}$/.test(userId)) {
      enrollmentYear = '20' + userId.slice(0, 2);
      classNo = userId.slice(2, 4);
    }

    console.log('[ClussBridge] 联动校验通过: %s (%s)%s', matched.user_id, matched.real_name,
      ciDisabled ? ' —— 该账号在 CI 侧已禁用，已按口令正确放行并附 disabled 标记' : '');

    return res.json({
      code: 200,
      message: 'ok',
      data: {
        // CI 侧自己的启用状态。Cluss 已明确「不跟随 CI 的禁用」，所以它只用于
        // 记日志与排查，不参与 Cluss 的账号状态判定。
        disabled: ciDisabled,
        user: {
          user_id: matched.user_id,
          net_name: matched.net_name,
          real_name: matched.real_name,
          gender: matched.gender || '',
          status: matched.status,
          // 必须返回：Cluss 侧落库时用于离线登录校验（同 relay-verify 的既有约定）
          password_hash: matched.password_hash,
          // 班管 / 系统管理员标记：Cluss 侧据此授管理权（班管才是实际管理者）
          is_class_admin: constants.isClassAdmin(matched.user_id),
          is_admin: matched.is_admin === 1,
          enrollment_year: enrollmentYear,
          class_no: classNo
        }
      }
    });
  } catch (err) {
    console.error('[ClussBridge] verify error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// GET /api/cluss-bridge/class-roster —— 取「某班」的完整名册（只读）
// query: { year, classNo }  year 四位（2025）或两位（25），classNo 两位（18）
//
// 用途：Cluss 是「一班一节点」的应用，名册就是它的世界边界 ——
// 联动时把本班账号全量纳入，班管才能提前批量给额度；非本班的一律不收。
//
// 过滤在 SQL 里做（不是取回来再用 JS 筛）：ClassIntra 的 user_id 编码 YYCCNN，
// 用 substr 精确锁定 YY + CC 两段，**结构上不可能**把别的班带出去。
// 只返回在册（已注册）学生——名单里没注册的人登不进任何一侧，纳入 Cluss 也没有意义。
// ============================================================
router.get('/class-roster', requireBridgeSecret, function(req, res) {
  try {
    var yearRaw = String(req.query.year || '').trim();
    var classNoRaw = String(req.query.classNo || '').trim();

    // 归一化入学年份：接受 2025 / 25
    var yy = '';
    if (/^\d{4}$/.test(yearRaw)) yy = yearRaw.slice(2);
    else if (/^\d{2}$/.test(yearRaw)) yy = yearRaw;
    if (!/^\d{2}$/.test(yy)) {
      return res.status(400).json({ code: 400, message: '入学年份不合法（应为 2025 或 25）' });
    }

    // 归一化班级号：接受 18 / 8
    var n = /^\d{1,2}$/.test(classNoRaw) ? parseInt(classNoRaw, 10) : 0;
    if (!(n >= 1 && n <= 99)) {
      return res.status(400).json({ code: 400, message: '班级不合法（1 ~ 99）' });
    }
    var cc = n < 10 ? '0' + n : String(n);

    var rows = db.prepare([
      "SELECT user_id, net_name, real_name, gender, status, is_admin, role",
      "FROM users",
      "WHERE length(user_id) = 6 AND substr(user_id, 1, 2) = ? AND substr(user_id, 3, 2) = ?",
      "ORDER BY user_id"
    ].join('\n')).all(yy, cc);

    var students = rows.map(function(r) {
      return {
        user_id: r.user_id,
        net_name: r.net_name,
        real_name: r.real_name,
        gender: r.gender || '',
        status: r.status,
        // 班管 / 系统管理员：Cluss 侧据此授管理权（同 verify 的口径）
        is_class_admin: constants.isClassAdmin(r.user_id),
        is_admin: r.is_admin === 1
      };
    });

    console.log('[ClussBridge] 名册请求: 20%s 届 %s 班 → %d 人', yy, cc, students.length);

    return res.json({
      code: 200,
      message: 'ok',
      data: {
        enrollment_year: '20' + yy,
        class_no: cc,
        total: students.length,
        students: students
      }
    });
  } catch (err) {
    console.error('[ClussBridge] class-roster error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// ============================================================
// GET /api/cluss-bridge/student-profile —— 学生画像素材（只读 · 脱敏白名单）
// query: { userId }  6 位学号（YYCCNN）
//
// 用途：Cluss 想让 AI「更懂这个学生」，但它自己的库里只有错题 / 笔记 / 会话这些
// 单一维度的痕迹。ClassIntra 这边有更丰富的活动事实（社区发帖与标签、音乐口味、
// 棋类对局、等级与连续登录），这个端点把它们整理成**素材**交给 Cluss，
// 由 Cluss 侧的模型判断哪些值得沉淀成长期记忆。
//
// ---- 脱敏原则（本端点的核心约束，改动前务必读完）----
// 1. **显式白名单列**：所有 SELECT 都逐个列名写出，绝不用 SELECT *。
//    用 * 的话，将来 users 表新增一个「手机号」列就会被自动带出去 ——
//    白名单必须靠显式列举成立，靠自觉不成立。
// 2. **绝对不外传**：phone / qq / wechat / address / password_hash /
//    privacy_settings / info_json（含生日）在任何情况下都不出现在响应里，
//    哪怕学生自己填过。这是产品红线，不是可配置项。
// 3. **不带走他人的内容**：只返回学生**自己**发布过的内容标题；
//    别人的帖子与评论正文、私信一律不出村。
// 4. **匿名帖视为「他不想被关联」**：anonymous=1 的帖子不计标题、也不计数。
// 5. **个人日期不外传**：倒计时只取 category='exam'（学业相关）；
//    生日 / 纪念日属于私人日程，不取。
// 6. **长度与条数双封顶**：任何文本截断、任何列表限条数 ——
//    这是"素材"不是"档案"，也防止一次响应撑爆 Cluss 的上下文预算。
// 7. **敏感串兜底**：自由文本（签名 / 帖子标题）再过一道联系方式正则，
//    命中就整条丢弃（学生完全可能在签名里写手机号）。
// 8. **单账号精确查询**：只接受一个 6 位学号做精确匹配，结构上无法用它枚举名册。
// ============================================================

// 与 Cluss 侧 memory-extractor 同源的一套正则。刻意在两处各写一份：
// 这是"防漏网"的两道独立闸门，共用一个常量会让一次误改同时失效。
var PROFILE_SENSITIVE_RES = [
  /1[3-9]\d{9}/,                                            // 手机号
  /0\d{2,3}-?\d{7,8}/,                                      // 固话
  /[\w.+-]+@[\w-]+\.[\w.-]+/,                               // 邮箱
  /\d{17}[\dXx]/,                                           // 身份证
  /(微信号?|qq号?|wechat|weixin|vx)\s*[:：]?\s*[a-z0-9_-]{5,}/i
];

// 自由文本脱敏：命中疑似联系方式 → 返回 ''（整条丢弃）；否则规范化并截断
function cleanProfileText(v, max) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  for (var i = 0; i < PROFILE_SENSITIVE_RES.length; i++) {
    if (PROFILE_SENSITIVE_RES[i].test(s)) return '';
  }
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// 去重 + 去空 + 封顶
function uniqCap(list, cap) {
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var v = String(list[i] == null ? '' : list[i]).trim();
    if (!v || seen[v]) continue;
    seen[v] = 1;
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

// exp_log.action → 对外字段名（白名单映射）。
// 为什么不把 action 原样透出：那是内部埋点代号，改成别的名字 Cluss 就读不到了；
// 映射一次，两边协议就稳定在"人话字段名"上。
var PROFILE_ACTIONS = {
  send_message: 'messages',
  receive_like: 'likes_received',
  add_comment: 'comments',
  daily_login: 'daily_logins',
  create_post: 'posts_posted',
  share_post: 'shares'
};

router.get('/student-profile', requireBridgeSecret, function(req, res) {
  try {
    var userId = String(req.query.userId || '').trim();
    if (!/^\d{6}$/.test(userId)) {
      return res.status(400).json({ code: 400, message: 'userId 不合法（应为 6 位学号）' });
    }

    // ---- 基础身份与等级（逐列写名，见文件头第 1 条）----
    var user = db.prepare([
      'SELECT user_id, gender, signature, exp, level',
      'FROM users WHERE user_id = ? AND length(user_id) = 6'
    ].join('\n')).get(userId);

    if (!user) {
      return res.status(404).json({ code: 404, message: '账号不存在' });
    }

    // ---- 连续登录（user_experience；缺失即视为无记录，不是错误）----
    var xp = db.prepare([
      'SELECT login_streak, max_login_streak FROM user_experience WHERE user_id = ?'
    ].join('\n')).get(userId) || {};

    // ---- 行为活跃度：一次 GROUP BY 拿全（比逐项 COUNT 便宜得多）----
    var activity = {};
    var actRows = db.prepare([
      'SELECT action, COUNT(*) AS n FROM exp_log WHERE user_id = ? GROUP BY action'
    ].join('\n')).all(userId);
    for (var a = 0; a < actRows.length; a++) {
      var field = PROFILE_ACTIONS[actRows[a].action];
      // 白名单外的 action 直接忽略 —— 不认识的埋点不外传，免得以后新增的
      // 敏感行为被自动带出去
      if (field) activity[field] = actRows[a].n;
    }

    // ---- 社区：只统计**非匿名**帖；只取标题与标签 ----
    var postAgg = db.prepare([
      'SELECT COUNT(*) AS n, COALESCE(SUM(like_count), 0) AS likes, COALESCE(SUM(comment_count), 0) AS comments',
      'FROM community_posts WHERE user_id = ? AND COALESCE(anonymous, 0) = 0'
    ].join('\n')).get(userId);

    var typeRows = db.prepare([
      'SELECT type, COUNT(*) AS n FROM community_posts',
      'WHERE user_id = ? AND COALESCE(anonymous, 0) = 0',
      'GROUP BY type ORDER BY n DESC'
    ].join('\n')).all(userId);
    var postTypes = {};
    for (var t = 0; t < typeRows.length; t++) {
      postTypes[String(typeRows[t].type || 'other')] = typeRows[t].n;
    }

    var tagRows = db.prepare([
      'SELECT tags FROM community_posts',
      "WHERE user_id = ? AND COALESCE(anonymous, 0) = 0 AND tags IS NOT NULL AND tags <> ''",
      'ORDER BY created_at DESC LIMIT 60'
    ].join('\n')).all(userId);
    var postTags = [];
    for (var g = 0; g < tagRows.length; g++) {
      // tags 实测是单个短标签（不是逗号分隔的多标签），照样按逗号/空格兜底切一次
      var parts = String(tagRows[g].tags || '').split(/[,，\s]+/);
      for (var p = 0; p < parts.length; p++) {
        var tag = cleanProfileText(parts[p], 12);
        if (tag) postTags.push(tag);
      }
    }

    // 收到赞最多的几篇**自己的**公开帖标题：能反映他在意什么
    var titleRows = db.prepare([
      'SELECT title FROM community_posts',
      'WHERE user_id = ? AND COALESCE(anonymous, 0) = 0 AND title IS NOT NULL AND title <> \'\'',
      'ORDER BY like_count DESC, id DESC LIMIT 12'
    ].join('\n')).all(userId);
    var postTitles = [];
    for (var q = 0; q < titleRows.length; q++) {
      var cleanTitle = cleanProfileText(titleRows[q].title, 48);
      if (cleanTitle) postTitles.push(cleanTitle);
    }

    // ---- 音乐口味：netease_likes 的 song_json 里有 title/artist ----
    // 逐条 JSON.parse 是必须的（库里存的是整包 JSON）；封顶 200 条避免超大账号拖慢。
    var songRows = db.prepare([
      'SELECT song_json FROM netease_likes',
      "WHERE user_id = ? AND song_json IS NOT NULL AND song_json <> ''",
      'ORDER BY liked_at DESC LIMIT 200'
    ].join('\n')).all(userId);
    var artistTally = {};
    var songTitles = [];
    for (var s = 0; s < songRows.length; s++) {
      var song = null;
      try { song = JSON.parse(songRows[s].song_json); } catch (e) { song = null; }
      if (!song) continue;
      var artist = cleanProfileText(song.artist, 24);
      if (artist) artistTally[artist] = (artistTally[artist] || 0) + 1;
      var st = cleanProfileText(song.title, 32);
      if (st) songTitles.push(st);
    }
    // 按出现次数排序（最多出现的歌手 = 他的主要口味）
    var topArtists = Object.keys(artistTally).map(function(k) {
      return { name: k, count: artistTally[k] };
    }).sort(function(x, y) { return y.count - x.count; }).slice(0, 6);

    var favCount = db.prepare('SELECT COUNT(*) AS n FROM music_favorites WHERE user_id = ?').get(userId).n;

    var plRows = db.prepare([
      'SELECT name FROM music_playlists',
      "WHERE user_id = ? AND name IS NOT NULL AND name <> '' ORDER BY updated_at DESC LIMIT 8"
    ].join('\n')).all(userId);
    var playlistNames = [];
    for (var pl = 0; pl < plRows.length; pl++) {
      var pn = cleanProfileText(plRows[pl].name, 24);
      if (pn) playlistNames.push(pn);
    }

    // ---- 棋类对局数（棋谱表本身不带 user_id，归属在 members 表里）----
    var chessGames = db.prepare([
      'SELECT COUNT(DISTINCT m.room_code) AS n',
      'FROM chess_members m JOIN chess_games g ON g.room_code = m.room_code',
      'WHERE m.user_id = ?'
    ].join('\n')).get(userId).n;
    var gomokuGames = db.prepare([
      'SELECT COUNT(DISTINCT m.room_code) AS n',
      'FROM gomoku_members m JOIN gomoku_games g ON g.room_code = m.room_code',
      'WHERE m.user_id = ?'
    ].join('\n')).get(userId).n;

    // ---- 学业倒计时（**只**取 exam；生日/纪念日不取）----
    var examRows = db.prepare([
      "SELECT title, target_date FROM countdown_events",
      "WHERE user_id = ? AND category = 'exam' AND title IS NOT NULL AND title <> ''",
      'ORDER BY pinned DESC, target_date ASC LIMIT 5'
    ].join('\n')).all(userId);
    var exams = [];
    for (var e = 0; e < examRows.length; e++) {
      var et = cleanProfileText(examRows[e].title, 32);
      if (et) exams.push({ title: et, target_date: String(examRows[e].target_date || '') });
    }

    // 一条汇总日志：排障要看"给过什么量级"，但不该把内容写进日志
    console.log('[ClussBridge] 画像素材: %s → 帖 %d / 标签 %d / 歌 %d / 棋 %d / 考试 %d',
      userId, postAgg.n || 0, postTags.length, songRows.length, chessGames + gomokuGames, exams.length);

    return res.json({
      code: 200,
      message: 'ok',
      data: {
        user_id: user.user_id,
        generated_at: new Date().toISOString(),
        // 签名：学生自己写的一句话自我介绍，经脱敏；空串表示没写或含敏感内容
        signature: cleanProfileText(user.signature, 80),
        gender: String(user.gender || ''),
        level: { exp: Number(user.exp || 0), level: Number(user.level || 0) },
        login: {
          streak: Number(xp.login_streak || 0),
          max_streak: Number(xp.max_login_streak || 0)
        },
        activity: {
          messages: activity.messages || 0,
          comments: activity.comments || 0,
          posts_posted: activity.posts_posted || 0,
          shares: activity.shares || 0,
          daily_logins: activity.daily_logins || 0,
          likes_received: activity.likes_received || 0
        },
        community: {
          post_count: postAgg.n || 0,
          likes_received: postAgg.likes || 0,
          comments_received: postAgg.comments || 0,
          post_types: postTypes,
          post_tags: uniqCap(postTags, 12),
          post_titles: uniqCap(postTitles, 6)
        },
        music: {
          liked_count: songRows.length,
          favorite_count: favCount,
          top_artists: topArtists,
          sample_titles: uniqCap(songTitles, 8),
          playlists: uniqCap(playlistNames, 5)
        },
        games: { chess: chessGames, gomoku: gomokuGames },
        exams: exams
      }
    });
  } catch (err) {
    console.error('[ClussBridge] student-profile error:', err);
    return res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;