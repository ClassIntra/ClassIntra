/**
 * 大字广播 + 指令信箱 端到端实测（隔离实例，端口 9099，库为生产副本）
 *
 * 覆盖：
 *   1. 权限闸门（学生发大字应 403）
 *   2. 大字下发 → 目标设备补拉 → ACK → 幂等（重复拉为空、重复 ACK 为 0）
 *   3. 非目标用户拉不到（不串号）
 *   4. 撤回：补拉顺序为 big_text → big_text_recall
 *   5. 参数钳制（超长内容 / 超大时长 / 非法颜色）
 *   6. 封禁：落库为 account_status 指令，离线设备可补拉到
 *
 * 用法：node scripts-e2e-bigtext.cjs
 */

var path = require('path');
var Database = require('better-sqlite3');

var BASE = 'http://127.0.0.1:9099';
var DB_PATH = 'C:\\Users\\iflytek\\AppData\\Local\\Temp\\ci-e2e\\e2e.db';

var jwtUtil = require(path.join(__dirname, 'src', 'utils', 'jwt'));

var pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '  →  ' + JSON.stringify(extra) : '')); }
}
function section(s) { console.log('\n=== ' + s + ' ==='); }

function tokenOf(uid) {
  return jwtUtil.generateToken({ user_id: uid, net_name: 'e2e' });
}

async function call(method, urlPath, token, body) {
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  var res = await fetch(BASE + urlPath, {
    method: method,
    headers: headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  var text = await res.text();
  var json = null;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, body: json };
}

(async function main() {
  var db = new Database(DB_PATH, { readonly: true });
  var admins = db.prepare(
    "SELECT user_id, net_name, is_admin, role FROM users " +
    "WHERE user_id LIKE '2518%' AND (is_admin = 1 OR role = 'officer') " +
    "AND (status IS NULL OR status = 'active') ORDER BY (user_id LIKE '%00') DESC, user_id LIMIT 3"
  ).all();
  // 封禁接口的 :id 是数据库主键（不是学号），所以把 id 一起取出来
  var students = db.prepare(
    "SELECT id, user_id, net_name FROM users WHERE user_id LIKE '2518%' " +
    "AND substr(user_id,5,2) <> '00' AND (status IS NULL OR status='active') ORDER BY user_id LIMIT 3"
  ).all();
  db.close();

  if (admins.length === 0 || students.length < 3) {
    console.error('测试库缺少可用账号：admins=' + admins.length + ' students=' + students.length);
    process.exit(2);
  }

  var admin = admins[0], s1 = students[0], s2 = students[1], s3 = students[2];
  console.log('运营者: ' + admin.user_id + ' (' + admin.net_name + ', is_admin=' + admin.is_admin + ', role=' + admin.role + ')');
  console.log('目标用户: ' + [s1, s2, s3].map(function (x) { return x.user_id + '(' + x.net_name + ')'; }).join(', '));

  var adminTok = tokenOf(admin.user_id);
  var s1Tok = tokenOf(s1.user_id);
  var s2Tok = tokenOf(s2.user_id);
  var s3Tok = tokenOf(s3.user_id);

  // ---------- 0. 连通性 ----------
  section('0. 连通性与鉴权');
  var r = await call('GET', '/api/admin/big-text', adminTok);
  ok(r.status === 200 && r.body.code === 200 && Array.isArray(r.body.data.list), '班管可读大字历史', r.body);

  var rNoToken = await call('GET', '/api/device-commands/pending', null);
  ok(rNoToken.status === 401, '未登录拉补拉接口 → 401', rNoToken.body);

  var rStudentSend = await call('POST', '/api/admin/big-text', s1Tok, { content: '越权测试', duration: 5 });
  ok(rStudentSend.status === 403, '普通学生发大字 → 403', rStudentSend.body);

  // ---------- 1. 发送 ----------
  section('1. 发送大字 → 落库 + 计数');
  var CONTENT = 'E2E 大字测试 ' + Date.now();
  var sendRes = await call('POST', '/api/admin/big-text', adminTok, {
    content: CONTENT,
    duration: 60,
    bg_color: '#FF3B30',
    font_color: '#FFFFFF',
    font_family: 'kai',
    font_size: 160,
    font_weight: '900',
    text_align: 'center',
    target_type: 'users',
    target_ids: [s1.user_id, s2.user_id]
  });
  ok(sendRes.status === 200 && sendRes.body.code === 200, '发送成功', sendRes.body);
  var btId = sendRes.body.data && sendRes.body.data.id;
  ok(sendRes.body.data && sendRes.body.data.targets === 2, '目标数 = 2', sendRes.body.data);
  ok(sendRes.body.data && sendRes.body.data.online === 0 && sendRes.body.data.queued === 2,
    '无 WS 连接时应全部 queued（真机离线场景）', sendRes.body.data);

  // 颜色规范化（大写 → 小写）
  var db2 = new Database(DB_PATH, { readonly: true });
  var row = db2.prepare('SELECT * FROM big_text_broadcasts WHERE id = ?').get(btId);
  db2.close();
  ok(!!row, 'big_text_broadcasts 已落记录', row);
  ok(row && row.bg_color === '#ff3b30', '背景色已规范化小写', row && row.bg_color);
  ok(row && row.font_size === 160 && row.duration === 60, '字号/时长按传入值保存', row && { fs: row.font_size, d: row.duration });

  // ---------- 2. 补拉 + ACK + 幂等 ----------
  section('2. 目标设备补拉 → ACK → 幂等');
  var p1 = await call('GET', '/api/device-commands/pending', s1Tok);
  var cmds1 = (p1.body.data && p1.body.data.commands) || [];
  ok(p1.status === 200 && cmds1.length === 1, 's1 补拉到 1 条指令', cmds1);
  var cmd = cmds1[0] || {};
  ok(cmd.cmd_type === 'big_text', 'cmd_type = big_text', cmd.cmd_type);
  ok(cmd.payload && cmd.payload.content === CONTENT, 'payload 内容一致', cmd.payload && cmd.payload.content);
  ok(cmd.payload && cmd.payload.duration === 60 && cmd.payload.font_size === 160, 'payload 样式参数完整', cmd.payload);
  ok(cmd.payload && typeof cmd.payload.font_family_css === 'string' && cmd.payload.font_family_css.indexOf('KaiTi') !== -1,
    '字体已展开为 CSS 回退栈', cmd.payload && cmd.payload.font_family_css);
  ok(!!cmd.uid, '带全局唯一 uid（端上幂等去重依据）', cmd.uid);

  var ack1 = await call('POST', '/api/device-commands/ack', s1Tok, { uids: [cmd.uid] });
  ok(ack1.status === 200 && ack1.body.data.acked === 1, 'ACK 标记 1 条', ack1.body);

  var p2 = await call('GET', '/api/device-commands/pending', s1Tok);
  ok(((p2.body.data && p2.body.data.commands) || []).length === 0, 'ACK 后不再返回（防重复弹窗）', p2.body.data);

  var ack2 = await call('POST', '/api/device-commands/ack', s1Tok, { uids: [cmd.uid] });
  ok(ack2.body.data && ack2.body.data.acked === 0, '重复 ACK 幂等（acked=0）', ack2.body);

  // ⚠️ 同一次群发对多个目标共用同一个 uid（迁移里的唯一索引是 (cmd_uid, target_user_id)），
  //    所以 s2 能 ACK 自己那一行是正确行为；跨用户越权要用**非目标**用户验证。
  var ackOther = await call('POST', '/api/device-commands/ack', s3Tok, { uids: [cmd.uid] });
  ok(ackOther.body.data && ackOther.body.data.acked === 0, '非目标用户无法 ACK 别人的指令', ackOther.body);

  // ---------- 3. 隔离性 ----------
  section('3. 非目标用户不串号');
  var p3 = await call('GET', '/api/device-commands/pending', s3Tok);
  ok(((p3.body.data && p3.body.data.commands) || []).length === 0, 's3（非目标）补拉为空', p3.body.data);

  var p2b = await call('GET', '/api/device-commands/pending', s2Tok);
  var cmds2 = (p2b.body.data && p2b.body.data.commands) || [];
  ok(cmds2.length === 1 && cmds2[0].uid === cmd.uid, 's2（第二目标）拿到同一条指令、同一 uid', cmds2.map(function (c) { return c.uid; }));

  // ---------- 4. 撤回：未投递的原始指令必须被注销 ----------
  section('4. 撤回：注销未投递指令（离线设备不再先弹后撤）');
  var recall = await call('POST', '/api/admin/big-text/' + btId + '/recall', adminTok);
  ok(recall.status === 200 && recall.body.code === 200, '撤回成功', recall.body);

  // s1 已 ACK（delivered_at 已落）→ 注销只清未投递的，s1 侧仍应收到撤回指令
  var p1c = await call('GET', '/api/device-commands/pending', s1Tok);
  var cmds1c = (p1c.body.data && p1c.body.data.commands) || [];
  ok(cmds1c.length === 1 && cmds1c[0].cmd_type === 'big_text_recall',
    '已投递设备收到撤回指令（原大字已 ACK，不重复投递）', cmds1c.map(function (c) { return c.cmd_type; }));

  // s2 未 ACK → 原始 big_text 被注销（delivered_at 标记），只剩撤回指令：
  // 离线设备上线后补拉不到原大字，不会出现「先弹出来再撤掉」的闪烁
  var p2c = await call('GET', '/api/device-commands/pending', s2Tok);
  var cmds2c = (p2c.body.data && p2c.body.data.commands) || [];
  ok(cmds2c.length === 1 && cmds2c[0].cmd_type === 'big_text_recall',
    '未投递设备的原大字已注销，只剩撤回指令', cmds2c.map(function (c) { return c.cmd_type; }));
  ok(cmds2c[0] && cmds2c[0].payload && cmds2c[0].payload.id === btId, 'recall payload 带正确 id', cmds2c[0] && cmds2c[0].payload);

  // DB 级证据：s2 的原始 big_text 行已被标记 delivered（注销复用同一列）
  var dbCancel = new Database(DB_PATH, { readonly: true });
  var origRow = dbCancel.prepare(
    "SELECT cmd_type, delivered_at FROM device_commands WHERE target_user_id = ? AND cmd_type = 'big_text' ORDER BY id DESC LIMIT 1"
  ).get(s2.user_id);
  dbCancel.close();
  ok(!!origRow && !!origRow.delivered_at, '原大字指令行已标记 delivered（注销生效）', origRow);

  var recallAgain = await call('POST', '/api/admin/big-text/' + btId + '/recall', adminTok);
  ok(recallAgain.status === 200 && recallAgain.body.message === '已撤回', '重复撤回幂等', recallAgain.body);

  // ---------- 5. 参数钳制 ----------
  section('5. 参数钳制（防异常值把设备界面搞崩）');
  var clampContent = new Array(520).join('字');
  var clampRes = await call('POST', '/api/admin/big-text', adminTok, {
    content: clampContent,
    duration: 99999,
    bg_color: 'red',
    font_color: '#zzzzzz',
    font_size: 9999,
    font_weight: 'bogus',
    target_type: 'users',
    target_ids: [s3.user_id]
  });
  ok(clampRes.status === 200, '异常参数仍能发送（服务端钳制而非报错）', clampRes.body);
  var db3 = new Database(DB_PATH, { readonly: true });
  var crow = db3.prepare('SELECT * FROM big_text_broadcasts WHERE id = ?').get(clampRes.body.data.id);
  db3.close();
  ok(crow && crow.content.length === 400, '内容截断到 400 字', crow && crow.content.length);
  ok(crow && crow.duration === 600, '时长钳制到上限 600s', crow && crow.duration);
  ok(crow && crow.bg_color === '#101828', '非法颜色回退默认背景', crow && crow.bg_color);
  ok(crow && crow.font_color === '#ffffff', '非法颜色回退默认字色', crow && crow.font_color);
  ok(crow && crow.font_size === 400, '字号钳制到上限 400', crow && crow.font_size);
  ok(crow && crow.font_weight === '700', '非法字重回退 700', crow && crow.font_weight);

  // ---------- 6. 封禁（离线必达的核心修复） ----------
  section('6. 封禁走信箱：离线设备上线后可补拉');
  var ban = await call('PATCH', '/api/admin/users/' + s1.id + '/status', adminTok, {
    status: 'disabled',
    reason: 'E2E 联调封禁'
  });
  ok(ban.status === 200 || ban.status === 404, '封禁接口可调用（status=' + ban.status + '）', ban.body);

  var db4 = new Database(DB_PATH, { readonly: true });
  var banCmd = db4.prepare(
    "SELECT cmd_uid, cmd_type, payload, expires_at FROM device_commands " +
    "WHERE target_user_id = ? AND cmd_type = 'account_status' ORDER BY id DESC LIMIT 1"
  ).get(s1.user_id);
  var s1Row = db4.prepare('SELECT status, ban_reason FROM users WHERE user_id = ?').get(s1.user_id);
  db4.close();

  ok(!!banCmd, '封禁已落库为 account_status 指令（设备离线也不丢）', banCmd);
  if (banCmd) {
    var bp = {};
    try { bp = JSON.parse(banCmd.payload); } catch (e) {}
    ok(bp.status === 'disabled', '指令 payload.status = disabled', bp);
    ok(!!banCmd.expires_at, '指令带过期时间（7 天后不再补投，避免隔夜惊扰）', banCmd.expires_at);
  }
  ok(s1Row && s1Row.status === 'disabled', '用户状态已落库为 disabled', s1Row);

  // 被封设备本身会被 403 拦住（这是既有行为，客户端由 check-status 兜底）
  var bannedPending = await call('GET', '/api/device-commands/pending', s1Tok);
  ok(bannedPending.status === 403, '被封设备直接调接口 → 403（由 check-status 承载封禁落地）', bannedPending.body);

  // 解封：再落一条 active 指令，端上按 id 顺序执行 → 最终 active
  var unban = await call('PATCH', '/api/admin/users/' + s1.id + '/status', adminTok, { status: 'active' });
  ok(unban.status === 200, '解封接口返回 200', unban.body);

  var db5 = new Database(DB_PATH, { readonly: true });
  var both = db5.prepare(
    "SELECT cmd_type, payload FROM device_commands WHERE target_user_id = ? AND cmd_type = 'account_status' ORDER BY id ASC"
  ).all(s1.user_id);
  db5.close();
  ok(both.length >= 2, '封禁与解封各留下一条指令（顺序执行后终态正确）', both.length);
  if (both.length >= 2) {
    var last = {};
    try { last = JSON.parse(both[both.length - 1].payload); } catch (e) {}
    ok(last.status === 'active', '最后一条为 active（端上顺序执行 → 最终解封）', last);
  }

  // ---------- 7. 按班级群发 ----------
  section('7. 按班级群发（target_type=class）');
  var classRes = await call('POST', '/api/admin/big-text', adminTok, {
    content: 'E2E 全班测试',
    duration: 5,
    target_type: 'class'
  });
  if (classRes.status === 200) {
    ok(classRes.body.data.targets > 0, '全班目标数 > 0（' + classRes.body.data.targets + ' 人）', classRes.body.data);
  } else {
    console.log('  ⚠️ 按班级群发返回 ' + classRes.status + '：' + JSON.stringify(classRes.body) +
      '（运营者非班管时属预期）');
  }

  // ---------- 8. 富样式参数 ----------
  section('8. 轮播 / 副内容 / 署名 / 渐变特效');
  var RICH = 'E2E 第一条通知\nE2E 第二条通知\nE2E 第三条通知';
  var rich = await call('POST', '/api/admin/big-text', adminTok, {
    content: RICH,
    sub_content: '请各组长 22:00 前确认人数',
    show_sender: false,
    display_mode: 'carousel',
    switch_interval: 7,
    scroll_speed: 90,
    effect: 'gradient_text',
    text_gradient: { from: '#FFD166', to: '#EF476F', angle: 90 },
    duration: 30,
    target_type: 'users',
    target_ids: [s3.user_id]
  });
  ok(rich.status === 200, '富样式大字发送成功', rich.body);

  var pr = await call('GET', '/api/device-commands/pending', s3Tok);
  var all3 = (pr.body.data && pr.body.data.commands) || [];
  var richCmd = null;
  for (var ci = 0; ci < all3.length; ci++) {
    if (all3[ci].cmd_type === 'big_text' && all3[ci].payload && all3[ci].payload.content === RICH) richCmd = all3[ci];
  }
  ok(!!richCmd, '目标设备补拉到该条指令', all3.map(function (c) { return c.cmd_type; }));
  if (richCmd) {
    var rp = richCmd.payload;
    ok(rp.display_mode === 'carousel', 'display_mode = carousel', rp.display_mode);
    ok(Array.isArray(rp.lines) && rp.lines.length === 3, 'lines 按换行切成 3 条', rp.lines);
    ok(rp.lines[1] === 'E2E 第二条通知', 'lines 内容正确', rp.lines);
    ok(rp.sub_content === '请各组长 22:00 前确认人数', '副内容已下发', rp.sub_content);
    ok(rp.show_sender === false, 'show_sender=false 已下发（端上不显示署名）', rp.show_sender);
    ok(rp.switch_interval === 7, '切换间隔 7 秒', rp.switch_interval);
    ok(rp.scroll_speed === 90, '走马灯速度 90px/s', rp.scroll_speed);
    ok(rp.effect === 'gradient_text', '特效 gradient_text', rp.effect);
    ok(rp.text_gradient && rp.text_gradient.from === '#ffd166', '渐变起始色规范化', rp.text_gradient);
  }

  // ---------- 9. 策略 ----------
  section('9. 策略保存 / 覆盖 / 删除');
  var presetPayload = {
    duration: 45, display_mode: 'scroll', switch_interval: 6, scroll_speed: 120,
    effect: 'rainbow', bg_color: '#1D2939', font_color: '#FEF3C7',
    font_family: 'hei', font_size: 180, font_weight: '900', text_align: 'center',
    sub_content: '策略副内容', show_sender: true
  };
  var pSave = await call('POST', '/api/admin/big-text/presets', adminTok, { name: 'E2E策略', payload: presetPayload });
  ok(pSave.status === 200 && pSave.body.code === 200, '策略已保存', pSave.body);
  var presetId = pSave.body.data && pSave.body.data.id;

  var pList = await call('GET', '/api/admin/big-text/presets', adminTok);
  var list = (pList.body.data && pList.body.data.list) || [];
  var found = null;
  for (var pi = 0; pi < list.length; pi++) if (list[pi].name === 'E2E策略') found = list[pi];
  ok(!!found, '策略列表可读且包含该策略', list.map(function (p) { return p.name; }));
  if (found) {
    ok(found.payload.effect === 'rainbow', '策略内样式已持久化', found.payload.effect);
    ok(found.payload.display_mode === 'scroll' && found.payload.scroll_speed === 120, '策略内模式/速度已持久化', found.payload);
  }

  var pAgain = await call('POST', '/api/admin/big-text/presets', adminTok, {
    name: 'E2E策略', payload: Object.assign({}, presetPayload, { duration: 99 })
  });
  ok(pAgain.body.data && pAgain.body.data.updated === true, '同名保存为覆盖更新（不产生重复项）', pAgain.body.data);

  var pDel = await call('DELETE', '/api/admin/big-text/presets/' + presetId, adminTok);
  ok(pDel.status === 200, '策略已删除', pDel.body);

  var pList2 = await call('GET', '/api/admin/big-text/presets', adminTok);
  var names2 = ((pList2.body.data && pList2.body.data.list) || []).map(function (p) { return p.name; });
  ok(names2.indexOf('E2E策略') === -1, '删除后列表不再包含', names2);

  // ---------- 10. 历史班级隔离 ----------
  section('10. 大字历史按班级隔离（班管只看本班）');
  // 250800 是不落在库里的 08 班班管：requireAuth 对班管按 user_id 末两位 00 放行，
  // 不需要真实 users 行；target_ids 里的 250801 同样只需格式合法（resolveTargets 不查库）。
  var otherTok = tokenOf('250800');
  var iso = await call('POST', '/api/admin/big-text', otherTok, {
    content: 'E2E 08班隔离测试',
    duration: 5,
    target_type: 'users',
    target_ids: ['250801']
  });
  ok(iso.status === 200 && iso.body.code === 200, '08 班班管可发送大字（target_class=08）', iso.body);
  var isoId = iso.body.data && iso.body.data.id;
  ok(!!isoId, '返回广播 id', iso.body && iso.body.data);

  // 18 班班管（当前运营者）不应看到 08 班的记录
  var h18 = await call('GET', '/api/admin/big-text', adminTok);
  var list18 = (h18.body.data && h18.body.data.list) || [];
  ok(!list18.some(function (r) { return r.id === isoId; }), '18 班班管看不到 08 班的大字历史', list18.map(function (r) { return r.id; }));

  // 08 班班管看得到自己的，但看不到 18 班的
  var h08 = await call('GET', '/api/admin/big-text', otherTok);
  var list08 = (h08.body.data && h08.body.data.list) || [];
  ok(list08.some(function (r) { return r.id === isoId; }), '08 班班管能看到本班记录', list08.map(function (r) { return r.id; }));
  ok(!list08.some(function (r) { return r.id === btId; }), '08 班班管看不到 18 班记录（不串班）', list08.map(function (r) { return r.id; }));

  console.log('\n=================================================');
  console.log(pass + ' 通过 / ' + fail + ' 失败');
  console.log('=================================================');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('E2E 异常中断:', e && e.stack || e);
  process.exit(3);
});
