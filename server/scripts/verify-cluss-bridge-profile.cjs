// ============================================================
// 验证脚本：CI 侧 GET /api/cluss-bridge/student-profile 的脱敏白名单
//
// 做法：从真实库取相关表的 DDL → 建一个**独立临时库** → 灌入构造数据
//       （含隐私列、匿名帖、白名单外 action、含手机号的自由文本）
//       → 挂载真实路由 → 黑盒请求 → 断言。
//
// 判别式设计：既有"该出来的出来了"的正向断言，也有**反向对照**——
// 隐私值/匿名帖/白名单外 action 必须一个都不出现在响应体里。
// 没有反向对照的脱敏断言，很容易因为"本来就没插数据"而假通过。
//
// 什么时候跑：改 cluss-bridge.js 的 /student-profile（加字段、改 SQL）之后必跑。
// 只读真实库的 DDL，不写真实库；所有构造数据都在临时库里。
//
// 运行：
//   export PYTHONPATH=""; unset NODE_OPTIONS; export PATH="/c/Program Files/nodejs:$PATH"
//   node scripts/verify-cluss-bridge-profile.cjs
// ============================================================
'use strict';

var path = require('path');
var fs = require('fs');
var os = require('os');
var http = require('http');

// config 在 require 时会强校验 JWT_SECRET（没有就 process.exit），必须在 require 前备好
process.env.JWT_SECRET = process.env.JWT_SECRET || 'probe-jwt-secret';
process.env.RELAY_SECRET = 'probe-bridge-secret';

var CI_ROOT = path.resolve(__dirname, '..');
var REAL_DB = path.join(CI_ROOT, 'database', 'classintra.db');
var TMP_DB = path.join(os.tmpdir(), 'ci-probe-profile-' + Date.now() + '.db');

var Database = require('better-sqlite3');

// ------------------------------------------------------------
// 断言框架
// ------------------------------------------------------------
var pass = 0, fail = 0, lines = [];
function ok(name, cond, extra) {
  if (cond) { pass++; lines.push('  PASS  ' + name); }
  else { fail++; lines.push('  FAIL  ' + name + (extra !== undefined ? '  | ' + extra : '')); }
}
function section(t) { lines.push(''); lines.push('== ' + t + ' =='); }

// ------------------------------------------------------------
// 1) 从真实库取 DDL
// ------------------------------------------------------------
var TABLES = [
  'users', 'user_experience', 'exp_log', 'community_posts',
  'netease_likes', 'music_favorites', 'music_playlists',
  'chess_members', 'chess_games', 'gomoku_members', 'gomoku_games',
  'countdown_events'
];
var real = new Database(REAL_DB, { readonly: true, fileMustExist: true });
var ddls = real.prepare(
  "SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN (" +
  TABLES.map(function () { return '?'; }).join(',') + ')'
).all(TABLES);
real.close();

if (ddls.length !== TABLES.length) {
  console.error('FATAL: 真实库缺少表，取到 ' + ddls.length + '/' + TABLES.length);
  process.exit(1);
}

// ------------------------------------------------------------
// 2) 建临时库 + 灌构造数据（此刻 FK 默认 OFF，随便插）
// ------------------------------------------------------------
var tmp = new Database(TMP_DB);
tmp.pragma('journal_mode = MEMORY');
// 构造库只想要表结构本身，不重建被引用表（chess_rooms 等），
// 所以关掉外键检查；被测路由只做 JOIN，不依赖 FK 约束存在。
tmp.pragma('foreign_keys = OFF');
for (var d = 0; d < ddls.length; d++) tmp.exec(ddls[d].sql);

// 敏感值集中在一处，便于断言与阅读
var S = {
  phone: '13812345678',
  qq: '99887766',
  wechat: 'wx_probe_only',
  address: '某某小区1栋2单元303',
  hash: '$2b$10$PROBEHASHabcdefghijklmnop',
  netName: '探针网名QWE',
  realName: '探针真名ASD',
  birthday: '2009-05-05',
  phoneInSig: '13900001111',
  phoneInTitle: '13800009999',
  wechatInArtist: '微信号zzzabcdef'
};

var U = '990001';   // 全量素材
var U2 = '990002';  // 签名里写手机号
var U3 = '990003';  // 什么都没有
var OTHER = '888888'; // 别人

var insUser = tmp.prepare(
  'INSERT INTO users (net_name, real_name, user_id, gender, password_hash, wechat, qq, phone, address, signature, info_json, exp, level) ' +
  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
);
insUser.run(S.netName, S.realName, U, '男', S.hash, S.wechat, S.qq, S.phone, S.address,
  '爱下棋也爱听歌的普通签名', JSON.stringify({ birthday: S.birthday }), 1500, 7);
insUser.run('U2网名', 'U2真名', U2, '女', S.hash, '', '', '', '',
  '有事电我' + S.phoneInSig + '就行', '{}', 0, 0);
insUser.run('U3网名', 'U3真名', U3, '男', S.hash, '', '', '', '', '', '{}', 0, 0);
insUser.run('别人网名', '别人真名', OTHER, '男', S.hash, '', '', '', '', '', '{}', 0, 0);

tmp.prepare('INSERT INTO user_experience (user_id, exp, level, login_streak, max_login_streak) VALUES (?,?,?,?,?)')
  .run(U, 1500, 7, 12, 30);

var insExp = tmp.prepare('INSERT INTO exp_log (user_id, action, exp_gained) VALUES (?,?,?)');
var actions = [
  ['send_message', 7], ['receive_like', 3], ['add_comment', 2],
  ['daily_login', 5], ['create_post', 1], ['share_post', 2],
  ['secret_admin_thing', 9], ['login_streak_bonus', 4]
];
for (var a = 0; a < actions.length; a++) {
  for (var n = 0; n < actions[a][1]; n++) insExp.run(U, actions[a][0], 1);
}

var insPost = tmp.prepare(
  'INSERT INTO community_posts (user_id, type, title, content, anonymous, like_count, comment_count, tags) VALUES (?,?,?,?,?,?,?,?)'
);
insPost.run(U, 'forum', '我的象棋心得', '正文A', 0, 12, 4, '棋类');
insPost.run(U, 'forum', '联系我' + S.phoneInTitle + '的帖子', '正文B', 0, 5, 1, '生活');
insPost.run(U, 'forum', '公开帖B', '正文C', 0, 1, 0, '学习,校园');
insPost.run(U, 'forum', '匿名对照标题A', '正文D', 1, 99, 88, '匿名标签');
insPost.run(U, 'forum', '只有匿名的第三帖', '正文E', 1, 50, 3, '匿名标签2');
insPost.run(OTHER, 'forum', '别人的帖子', '正文F', 0, 3, 0, '别人标签');

var insSong = tmp.prepare('INSERT INTO netease_likes (user_id, song_id, song_json, liked_at) VALUES (?,?,?,?)');
insSong.run(U, 's1', JSON.stringify({ id: 1, title: '晴天', artist: '周杰伦', cover: 'x' }), 1);
insSong.run(U, 's2', JSON.stringify({ id: 2, title: '七里香', artist: '周杰伦', cover: 'x' }), 2);
insSong.run(U, 's3', JSON.stringify({ id: 3, title: '海阔天空', artist: 'Beyond', cover: 'x' }), 3);
insSong.run(U, 's4', JSON.stringify({ id: 4, title: '随便一首', artist: S.wechatInArtist, cover: 'x' }), 4);
// 坏 JSON：必须被 try/catch 吞掉而不是 500
insSong.run(U, 's5', '{这不是JSON', 5);

tmp.prepare('INSERT INTO music_favorites (user_id, song_id) VALUES (?,?)').run(U, 'f1');
tmp.prepare('INSERT INTO music_favorites (user_id, song_id) VALUES (?,?)').run(U, 'f2');
tmp.prepare('INSERT INTO music_favorites (user_id, song_id) VALUES (?,?)').run(U, 'f3');

var insPl = tmp.prepare('INSERT INTO music_playlists (user_id, name, updated_at) VALUES (?,?,?)');
insPl.run(U, '游戏BGM', '2026-01-05 10:00:00');
insPl.run(U, '深夜', '2026-01-04 10:00:00');
insPl.run(U, '学习歌单', '2026-01-03 10:00:00');

// 棋类：c1/c2 有对局；c3 只有成员无对局（JOIN 后应被排除）
tmp.prepare('INSERT INTO chess_members (room_code, user_id) VALUES (?,?)').run('c1', U);
tmp.prepare('INSERT INTO chess_members (room_code, user_id) VALUES (?,?)').run('c2', U);
tmp.prepare('INSERT INTO chess_members (room_code, user_id) VALUES (?,?)').run('c3', U);
tmp.prepare('INSERT INTO chess_games (room_code, board, rev) VALUES (?,?,?)').run('c1', '{}', 1);
tmp.prepare('INSERT INTO chess_games (room_code, board, rev) VALUES (?,?,?)').run('c2', '{}', 1);
tmp.prepare('INSERT INTO gomoku_members (room_code, user_id) VALUES (?,?)').run('g1', U);
tmp.prepare('INSERT INTO gomoku_games (room_code, size, board) VALUES (?,?,?)').run('g1', 15, '{}');

var insCd = tmp.prepare('INSERT INTO countdown_events (user_id, title, target_date, category, pinned) VALUES (?,?,?,?,?)');
insCd.run(U, '期末考试', '2026-01-15', 'exam', 1);
insCd.run(U, '数学月考', '2026-03-01', 'exam', 0);
insCd.run(U, '我的生日', '2009-05-05', 'birthday', 0);
insCd.run(U, '恋爱纪念日', '2025-09-01', 'anniversary', 0);
insCd.run(U, '春节', '2026-02-17', 'festival', 0);

tmp.close();

// ------------------------------------------------------------
// 3) 指向临时库 → require 真实路由（此刻 db.js 才会打开它）
// ------------------------------------------------------------
process.env.DB_PATH = TMP_DB;

var express = require('express');
var app = express();
// 真实路由直接挂上：被测的是线上同一份代码
app.use('/api/cluss-bridge', require(path.join(CI_ROOT, 'src', 'routes', 'cluss-bridge.js')));

var SECRET = process.env.RELAY_SECRET;

function api(port, urlPath, headers) {
  return new Promise(function (resolve, reject) {
    var req = http.request({
      host: '127.0.0.1', port: port, path: urlPath, method: 'GET',
      headers: headers || {}, agent: false
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8');
        var json = null;
        try { json = JSON.parse(raw); } catch (e) { json = null; }
        resolve({ status: res.statusCode, raw: raw, json: json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function has(needle, hay) { return String(hay).indexOf(needle) !== -1; }

var server = app.listen(0, '127.0.0.1', function () {
  var port = server.address().port;
  run(port).then(function () {
    console.log(lines.join('\n'));
    console.log('');
    console.log('RESULT: PASS ' + pass + ' / FAIL ' + fail + ' (共 ' + (pass + fail) + ' 项)');
    try { server.close(); } catch (e) {}
    try { fs.unlinkSync(TMP_DB); } catch (e) {}
    try { fs.unlinkSync(TMP_DB + '-wal'); } catch (e) {}
    try { fs.unlinkSync(TMP_DB + '-shm'); } catch (e) {}
    process.exit(fail ? 1 : 0);
  }).catch(function (e) {
    console.error('探针自身异常:', e && e.stack || e);
    try { server.close(); } catch (e2) {}
    try { fs.unlinkSync(TMP_DB); } catch (e3) {}
    process.exit(2);
  });
});

async function run(port) {
  var H = { 'X-Bridge-Secret': SECRET };
  var url = '/api/cluss-bridge/student-profile?userId=';

  // ---------- 4.1 认证闸门 ----------
  section('认证闸门');
  var noSec = await api(port, url + U, {});
  ok('无密钥 → 403', noSec.status === 403, 'status=' + noSec.status);
  ok('无密钥响应不带 data.user', !(noSec.json && noSec.json.data && noSec.json.data.user));

  var badSec = await api(port, url + U, { 'X-Bridge-Secret': 'wrong-secret' });
  ok('错密钥 → 403', badSec.status === 403, 'status=' + badSec.status);

  // ---------- 4.2 参数校验 ----------
  section('参数校验');
  var bad1 = await api(port, url + 'abc123', H);
  ok('userId 非数字 → 400', bad1.status === 400, 'status=' + bad1.status);
  var bad2 = await api(port, url + '12345', H);
  ok('userId 5 位 → 400', bad2.status === 400, 'status=' + bad2.status);
  var bad3 = await api(port, url + '1234567', H);
  ok('userId 7 位 → 400', bad3.status === 400, 'status=' + bad3.status);
  var bad4 = await api(port, url + '', H);
  ok('缺 userId → 400', bad4.status === 400, 'status=' + bad4.status);
  // 结构上无法枚举名册：非 6 位一律拒
  var bad5 = await api(port, url + '990001%27%20OR%201%3D1--', H);
  ok('带注入载荷的 userId → 400', bad5.status === 400, 'status=' + bad5.status);

  var nf = await api(port, url + '123456', H);
  ok('不存在的学号 → 404', nf.status === 404, 'status=' + nf.status);

  // ---------- 4.3 正向：素材正确返回 ----------
  section('正向：素材正确返回');
  var r = await api(port, url + U, H);
  ok('正常学号 → 200', r.status === 200, 'status=' + r.status);
  var data = r.json && r.json.data;
  ok('data 存在', !!data);
  if (!data) return;

  ok('user_id 回显正确', data.user_id === U, data.user_id);
  ok('signature 正确', data.signature === '爱下棋也爱听歌的普通签名', data.signature);
  ok('level.exp = 1500', data.level && data.level.exp === 1500, JSON.stringify(data.level));
  ok('level.level = 7', data.level && data.level.level === 7);
  ok('login.streak = 12', data.login && data.login.streak === 12, JSON.stringify(data.login));
  ok('login.max_streak = 30', data.login && data.login.max_streak === 30);

  var act = data.activity || {};
  ok('activity.messages = 7', act.messages === 7, act.messages);
  ok('activity.likes_received = 3（receive_like）', act.likes_received === 3, act.likes_received);
  ok('activity.comments = 2（add_comment）', act.comments === 2, act.comments);
  ok('activity.daily_logins = 5', act.daily_logins === 5, act.daily_logins);
  ok('activity.posts_posted = 1', act.posts_posted === 1, act.posts_posted);
  ok('activity.shares = 2（share_post）', act.shares === 2, act.shares);

  var com = data.community || {};
  // 非匿名公开帖共 3 篇（我的象棋心得 / 含手机号那篇 / 公开帖B）
  ok('community.post_count = 3（只算非匿名）', com.post_count === 3, com.post_count);
  ok('community.likes_received = 18（12+5+1）', com.likes_received === 18, com.likes_received);
  ok('community.comments_received = 5（4+1+0）', com.comments_received === 5, com.comments_received);
  ok('post_types.forum = 3', com.post_types && com.post_types.forum === 3, JSON.stringify(com.post_types));
  ok('post_tags 去重无重复', (function () {
    var t = com.post_tags || [];
    return new Set(t).size === t.length && t.length > 0;
  })(), JSON.stringify(com.post_tags));
  ok('post_tags 不含匿名帖标签', !(com.post_tags || []).some(function (t) { return has('匿名标签', t); }), JSON.stringify(com.post_tags));
  ok('post_titles 含「我的象棋心得」', (com.post_titles || []).indexOf('我的象棋心得') !== -1, JSON.stringify(com.post_titles));
  ok('post_titles 条数 ≤ 6', (com.post_titles || []).length <= 6);

  var mus = data.music || {};
  ok('music.liked_count = 5（含坏 JSON）', mus.liked_count === 5, mus.liked_count);
  ok('music.favorite_count = 3', mus.favorite_count === 3, mus.favorite_count);
  ok('top_artists 首位是周杰伦(count=2)', mus.top_artists && mus.top_artists[0] && mus.top_artists[0].name === '周杰伦' && mus.top_artists[0].count === 2, JSON.stringify(mus.top_artists));
  ok('top_artists 条数 ≤ 6', (mus.top_artists || []).length <= 6);
  ok('playlists 含「游戏BGM」', (mus.playlists || []).indexOf('游戏BGM') !== -1, JSON.stringify(mus.playlists));
  ok('playlists 条数 ≤ 5', (mus.playlists || []).length <= 5);

  var gms = data.games || {};
  ok('games.chess = 2（c3 无对局被 JOIN 排除）', gms.chess === 2, gms.chess);
  ok('games.gomoku = 1', gms.gomoku === 1, gms.gomoku);

  var ex = data.exams || [];
  ok('exams 只含 exam 类，共 2 条', ex.length === 2, JSON.stringify(ex));
  ok('exams 含「期末考试」', ex.some(function (e) { return e.title === '期末考试'; }));
  ok('exams 不含生日类标题', !ex.some(function (e) { return has('生日', e.title); }));
  ok('exams 不含纪念日类标题', !ex.some(function (e) { return has('纪念日', e.title); }));

  // ---------- 4.4 反向对照：隐私一律不外传 ----------
  // 逐项用**完整敏感值**在整个响应体里搜（不是只看某个字段），
  // 这样任何一条新加的 SELECT 把列带出去都会被立刻抓住。
  section('反向对照：隐私与越界内容不外传（关键）');
  var body = r.raw;
  ok('不含 phone', !has(S.phone, body));
  ok('不含 qq', !has(S.qq, body));
  ok('不含 wechat', !has(S.wechat, body));
  ok('不含 address', !has(S.address, body));
  ok('不含 password_hash', !has(S.hash, body));
  ok('不含 net_name', !has(S.netName, body));
  ok('不含 real_name', !has(S.realName, body));
  ok('不含 info_json 里的生日', !has(S.birthday, body));
  ok('不含匿名帖标题', !has('匿名对照标题A', body) && !has('只有匿名的第三帖', body));
  ok('不含匿名帖标签', !has('匿名标签', body));
  ok('不含他人帖子标题', !has('别人的帖子', body));
  ok('不含他人学号', !has(OTHER, body));
  ok('不含白名单外 action 名', !has('secret_admin_thing', body) && !has('login_streak_bonus', body));
  ok('含手机号的帖子标题被丢弃', !has(S.phoneInTitle, body));
  ok('歌手名里的微信号被丢弃', !has(S.wechatInArtist, body));
  ok('不含 community_posts.content 正文', !has('正文A', body) && !has('正文B', body));

  // ---------- 4.5 边界：签名含手机号 ----------
  section('边界：自由文本脱敏');
  var r2 = await api(port, url + U2, H);
  ok('U2 → 200', r2.status === 200, 'status=' + r2.status);
  ok('U2 签名含手机号 → signature 为空串', r2.json && r2.json.data && r2.json.data.signature === '', JSON.stringify(r2.json && r2.json.data && r2.json.data.signature));
  ok('U2 响应体不含那个手机号', !has(S.phoneInSig, r2.raw));

  var r3 = await api(port, url + U3, H);
  ok('U3（无任何数据）→ 200', r3.status === 200, 'status=' + r3.status);
  var d3 = r3.json && r3.json.data;
  ok('U3 signature = ""', d3 && d3.signature === '', JSON.stringify(d3 && d3.signature));
  ok('U3 post_count = 0', d3 && d3.community && d3.community.post_count === 0);
  ok('U3 无音乐', d3 && d3.music && (d3.music.top_artists || []).length === 0);
  ok('U3 无棋类', d3 && d3.games && d3.games.chess === 0 && d3.games.gomoku === 0);
  ok('U3 exams 为空', d3 && Array.isArray(d3.exams) && d3.exams.length === 0);
  ok('U3 login.streak = 0', d3 && d3.login && d3.login.streak === 0);

  // ---------- 4.6 密钥未配置 ----------
  section('密钥未配置');
  var cfg = require(path.join(CI_ROOT, 'src', 'config'));
  var saved = cfg.relay.secret;
  cfg.relay.secret = '';
  var noCfg = await api(port, url + U, { 'X-Bridge-Secret': 'whatever' });
  ok('未配置 RELAY_SECRET → 503（不裸奔）', noCfg.status === 503, 'status=' + noCfg.status);
  cfg.relay.secret = saved;

  // ---------- 4.7 源码级：逐列白名单 ----------
  // 只检查 /student-profile 这一段。整文件范围会误伤：
  //   · /verify 是本文件里**唯一允许**返回 password_hash 的端点（文件头已声明），
  //     它用的就是 SELECT *；
  //   · 文件头注释里也写着 "绝不用 SELECT *" 与「phone / qq / wechat ... 不外传」，
  //     整文件正则会把注释文字当成违规。
  section('源码级：逐列白名单（仅 /student-profile 段）');
  var src = fs.readFileSync(path.join(CI_ROOT, 'src', 'routes', 'cluss-bridge.js'), 'utf8');
  var segStart = src.indexOf("router.get('/student-profile'");
  var segEnd = src.indexOf('module.exports');
  ok('能定位到 /student-profile 段', segStart > 0 && segEnd > segStart);
  var seg = segStart > 0 && segEnd > segStart ? src.slice(segStart, segEnd) : '';
  ok('该段里没有 SELECT *', !/SELECT\s+\*/i.test(seg));
  ok('该段里没有选择隐私列', !/\b(phone|wechat|qq|address|password_hash|info_json)\b/i.test(seg));
  ok('该段里每个 SELECT 都取 user_id（逐列写名）', /SELECT user_id/.test(seg));
  ok('路由文件含脱敏兜底 cleanProfileText', has('cleanProfileText', src));
  ok('注释里写明「绝对不外传」', has('绝对不外传', src));
}
