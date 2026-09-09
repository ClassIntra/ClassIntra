// AstrBot Relay - 机器人 WS 客户端与消息转发核心（OneBot v11 版）
//
// 链路：用户私聊"林晞" → 本插件以机器人账号登录的 CI WS 收到 private_message
//   → 作为 OneBot v11 客户端连入本机 AstrBot 的 aiocqhttp 反向 WS（/ws）
//   → 上报 message.private 事件 → AstrBot 完整管线（人设/插件/记忆）
//   ← AstrBot 下发 send_private_msg 等 action（消息段数组）
//   ← 本插件解析段（text/image/record/video/file/music），媒体落盘
//     Resources/astrbot/remote/ 后以站内 URL 发回 ClassIntra。
//
// 配置全部来自环境变量（server/.env）：
//   BOT_USER_ID / BOT_PASSWORD / BOT_NET_NAME   机器人账号
//   ASTRBOT_WS_URL     AstrBot aiocqhttp 反向 WS，默认 ws://127.0.0.1:6199/ws
//   ASTRBOT_WS_TOKEN   反向 WS 访问令牌，默认空
//   AB_MAX_SEGMENTS    单次回复最多分段数，默认 3
//   AB_ALLOWED_USERS   用户白名单，逗号分隔，空=所有人

var WebSocket = require('ws');
var axios = require('axios');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var botUser = require('./bot-user');
var db = require('../../../server/src/utils/db');

var CFG = {
  ciHttpPort: parseInt(process.env.PORT, 10) || 3000,
  ciWsPort: parseInt(process.env.WS_PORT, 10) || 10001,
  obUrl: process.env.ASTRBOT_WS_URL || 'ws://127.0.0.1:6199/ws',
  obToken: process.env.ASTRBOT_WS_TOKEN || '',
  maxSegments: parseInt(process.env.AB_MAX_SEGMENTS, 10) || 3,
  resourceDir: process.env.AB_RESOURCE_DIR || path.join(process.cwd(), 'Resources', 'cloud', 'botmedia'),
  // 站内媒体 URL 前缀：资源落在 resourceDir/remote/ 下，静态挂载为 /resources/cloud/botmedia（旧 /resources/botmedia 兼容指向同一目录，便于历史消息与转存）
  resourceUrlBase: process.env.AB_RESOURCE_URL_BASE || '/resources/cloud/botmedia/remote/',
  // &&标签&& 兜底映射源：meme_manager 表情包分类目录
  packMemesDir: process.env.ASTRBOT_PACK_MEMES_DIR || 'D:/NetWork/Integration/AstrBot/data/plugin_data/meme_manager/packs/ddzs987-semantic-001/memes',
  maxDownloadBytes: (parseInt(process.env.AB_MAX_DOWNLOAD_MB, 10) || 200) * 1024 * 1024
};

// ===== 运行状态 =====
var state = {
  started: false,
  // ClassIntra 侧
  ws: null, jwt: null, botCfg: null,
  connected: false, reconnectTimer: null, heartbeatTimer: null, lastPong: 0, reconnectAttempts: 0,
  // OneBot 侧
  obWs: null, obConnected: false, obTimer: null, obAttempts: 0,
  msgCache: {},       // message_id(int) -> 上报的 OneBot 事件（供 get_msg）
  ciToOb: {},         // CI 消息 id -> OneBot message_id（撤回事件映射）
  obToCi: {},         // OneBot message_id -> CI 消息 id（回复引用还原）
  msgSeq: Math.floor(Date.now() / 1000) % 1000000000,
  heartbeatTimer: null,
  refReplyTo: null,
  pendingMedia: [],
  pendingRecall: {},   // temp_id -> { obId, channel, target, groupId }
  sentCiByOb: {},      // OneBot message_id -> [{channel,target,ciId,groupId}]（撤回用）
  counters: { received: 0, replied: 0, failed: 0 }
};

// CI 原生 ID：self_id = 机器人 CI 账号（如 linxi_ai），user_id = CI 用户 ID 原样传递
function ciSelfId() {
  return (state.botCfg && state.botCfg.userId) || 'linxi_ai';
}

// ===== 云盘内容解析：[cloud-img|video|audio:hash.ext] → OneBot 消息段 =====

var CLOUD_TAG_RE = /\[cloud-(img|video|audio):([a-f0-9]{64}(?:\.\w+)?)\]/g;

function cloudSharedDir() {
  var resDir = process.env.RESOURCES_DIR || path.join(process.cwd(), '..', 'Resources');
  return path.resolve(process.cwd(), resDir, 'cloud', 'shared');
}

function cloudTagToSegment(kind, ident) {
  try {
    var hash = ident.split('.')[0];
    var row = db.prepare('SELECT storage_path, mime_type, size, deleted FROM cloud_files WHERE hash = ?').get(hash);
    if (!row || row.deleted) return null;
    var full = path.join(cloudSharedDir(), row.storage_path);
    if (!fs.existsSync(full)) return null;
    var mime = String(row.mime_type || '');
    var isImage = kind === 'img' || mime.indexOf('image/') === 0;
    var isAudio = kind === 'audio' || mime.indexOf('audio/') === 0;
    var isVideo = kind === 'video' || mime.indexOf('video/') === 0;
    if (isImage && row.size <= 10 * 1024 * 1024) {
      return { type: 'image', data: { file: 'base64://' + fs.readFileSync(full).toString('base64') } };
    }
    if (isAudio && row.size <= 25 * 1024 * 1024) {
      return { type: 'record', data: { file: 'base64://' + fs.readFileSync(full).toString('base64') } };
    }
    // 视频/大文件/文档：本机同盘，直接给 file:// 路径
    var uri = 'file:///' + full.replace(/\\/g, '/');
    return { type: isVideo ? 'video' : 'file', data: { file: uri, name: ident } };
  } catch (e) {
    log('云盘解析失败:', ident, e.message);
    return null;
  }
}

// 用户消息文本 → OneBot 段数组（云盘标签转图片/语音/视频/文件段）
function buildInboundSegments(text, replyTo) {
  var segments = [];
  // 引用消息 → OneBot Reply 段（AstrBot 会经 get_msg 取到被引用原文，作为 LLM 上下文）
  if (replyTo && replyTo.message_id != null) {
    var obId = state.ciToOb[String(replyTo.message_id)];
    if (obId) {
      segments.push({ type: 'reply', data: { id: obId } });
    } else if (replyTo.content_preview) {
      segments.push({ type: 'text', data: { text: '（回复 ' + (replyTo.user_name || '') + '：' + replyTo.content_preview + '）' } });
    }
  }
  CLOUD_TAG_RE.lastIndex = 0;
  var last = 0, m, found = false;
  while ((m = CLOUD_TAG_RE.exec(text)) !== null) {
    found = true;
    if (m.index > last) segments.push({ type: 'text', data: { text: text.slice(last, m.index) } });
    var seg = cloudTagToSegment(m[1], m[2]);
    segments.push(seg || { type: 'text', data: { text: '[云盘文件 ' + m[2] + ']' } });
    last = m.index + m[0].length;
  }
  if (!found) return [{ type: 'text', data: { text: text } }];
  if (last < text.length) segments.push({ type: 'text', data: { text: text.slice(last) } });
  return segments;
}

function log() {
  var args = Array.prototype.slice.call(arguments);
  console.log.apply(console, ['[astrbot-relay]'].concat(args));
}

// ===== 机器人账号（ClassIntra 侧）=====

function ensureBotAccount() {
  state.botCfg = botUser.ensureBotUser();
  return !!state.botCfg;
}

// ===== ClassIntra 登录与 WS =====

function login() {
  var cfg = state.botCfg;
  return axios.post('http://localhost:' + CFG.ciHttpPort + '/api/auth/login', {
    account: cfg.userId,
    password: cfg.password
  }, { timeout: 10000 }).then(function (resp) {
    var data = resp.data;
    if (!data || data.code !== 200 || !data.data || !data.data.token) {
      throw new Error('登录失败: ' + ((data && data.message) || '未知错误'));
    }
    state.jwt = data.data.token;
    log('机器人登录成功:', cfg.userId);
    return state.jwt;
  });
}

// ===== 论坛发帖（供 AstrBot 端 LLM 工具回调，复用机器人账号身份）=====

function postCommunityPost(payload) {
  if (!state.jwt) throw new Error('机器人尚未登录，无法发布帖子');
  return axios.post('http://localhost:' + CFG.ciHttpPort + '/api/community/posts', payload, {
    headers: { Authorization: 'Bearer ' + state.jwt },
    timeout: 15000
  }).then(function (resp) {
    var data = resp.data;
    if (!data || data.code !== 200 || !data.data) {
      throw new Error((data && data.message) || ('发帖失败 HTTP ' + resp.status));
    }
    return data.data;
  });
}

// 以机器人（林晞）账号在社区论坛发帖；JWT 失效（401/403）时重新登录后重试一次
async function publishForumPost(payload) {
  if (!state.botCfg) {
    if (!ensureBotAccount()) throw new Error('机器人账号未就绪');
  }
  if (!state.jwt) await login();
  try {
    return await postCommunityPost(payload);
  } catch (e) {
    var status = e && e.response && e.response.status;
    if (status === 401 || status === 403) {
      log('发帖鉴权失效，重新登录后重试');
      await login();
      return await postCommunityPost(payload);
    }
    throw e;
  }
}

function connectWs() {
  if (!state.jwt) { scheduleReconnect(); return; }
  var url = 'ws://localhost:' + CFG.ciWsPort + '/?token=' + encodeURIComponent(state.jwt);
  log('连接 CI WS');
  var ws = new WebSocket(url);
  state.ws = ws;

  ws.on('open', function () {
    log('CI WS 已连接，ClassIntra 机器人上线');
    state.connected = true;
    state.reconnectAttempts = 0;
    state.lastPong = Date.now();
    ws.send(JSON.stringify({ type: 'connect', user_id: state.botCfg.userId, token: state.jwt }));
    startHeartbeat();
  });

  ws.on('message', function (raw) {
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    handleCiMessage(data);
  });

  ws.on('pong', function () { state.lastPong = Date.now(); });

  ws.on('error', function (err) { log('CI WS 错误:', err.message); });

  ws.on('close', function (code, reason) {
    log('CI WS 关闭: code=' + code);
    state.connected = false;
    stopHeartbeat();
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectAttempts++;
  var delay = Math.min(30000, 3000 * state.reconnectAttempts);
  state.reconnectTimer = setTimeout(function () {
    state.reconnectTimer = null;
    login().then(connectWs).catch(function (e) {
      log('重新登录失败:', e.message);
      scheduleReconnect();
    });
  }, delay);
}

function startHeartbeat() {
  stopHeartbeat();
  state.heartbeatTimer = setInterval(function () {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - state.lastPong > 60000) {
      log('CI 心跳超时，主动重连');
      try { state.ws.terminate(); } catch (e) {}
      return;
    }
    try { state.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
  }, 25000);
}

function stopHeartbeat() {
  if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = null; }
}

function handleCiMessage(data) {
  switch (data.type) {
    case 'connected':
      log('CI 连接确认，当前在线 ' + ((data.users && data.users.length) || 0) + ' 人');
      break;
    case 'pong': state.lastPong = Date.now(); break;
    case 'private_message':
      if (data.from_user_id && data.message) onPrivateMessage(data.from_user_id, data.message);
      break;
    case 'group_message':
      if (data.group_id && data.message) onGroupMessage(data.group_id, data.message);
      break;
    case 'private_message_sent':
    case 'group_message_sent':
      if (data && data.success === false) {
        log('消息发送被服务端拒绝: ' + JSON.stringify(data));
      } else if (data && data.temp_id && state.pendingRecall[data.temp_id]) {
        var rec = state.pendingRecall[data.temp_id];
        delete state.pendingRecall[data.temp_id];
        rec.ciId = String(data.message_id || '');
        if (rec.ciId) {
          if (!state.sentCiByOb[rec.obId]) state.sentCiByOb[rec.obId] = [];
          state.sentCiByOb[rec.obId].push(rec);
          var sk = Object.keys(state.sentCiByOb);
          if (sk.length > 300) delete state.sentCiByOb[sk[0]];
        }
      }
      break;
    case 'message_recalled':
      forwardRecallNotice(data);
      break;
    case 'error': log('CI 服务端错误消息: ' + (data.message || '')); break;
    default: break;
  }
}

// CI 撤回 → OneBot recall notice（映射回 AstrBot 认识的 message_id）
function forwardRecallNotice(data) {
  if (!obReady()) return;
  var obId = state.ciToOb[String(data.message_id)];
  if (!obId) return;
  var notice = {
    time: Math.floor(Date.now() / 1000),
    self_id: ciSelfId(),
    post_type: 'notice',
    notice_type: data.message_type === 'group' ? 'group_recall' : 'friend_recall',
    user_id: data.sender_id || null,
    message_id: obId
  };
  if (data.message_type === 'group') notice.group_id = data.group_id;
  delete state.ciToOb[String(data.message_id)];
  try { state.obWs.send(JSON.stringify(notice)); log('已上报撤回 notice:', obId); } catch (e) {}
}

// ===== CI 入站 → OneBot 事件上报 =====

// 入站引用对象（{message_id(CI), user_name, content_preview}）→ Reply 段
// 通过 ciToOb 把被引用的 CI 消息映射回 OneBot message_id，AstrBot 引用解析器
// 会再调 get_msg 取原文（msgCache 有缓存）
function inboundReplySegment(message) {
  try {
    var rt = message && message.reply_to;
    if (!rt) return null;
    var ciId = typeof rt === 'object' ? rt.message_id : rt;
    if (ciId == null) return null;
    var obId = state.ciToOb[String(ciId)];
    if (!obId) return null;
    return { type: 'reply', data: { id: obId } };
  } catch (e) { return null; }
}

// 特殊类型消息 → 可读文本（music_playlist / community_forward 等）
function extractSpecialText(msgType, content) {
  try {
    var d = JSON.parse(content);
    if (msgType === 'music_playlist') return '🎵 分享了歌单：' + (d.title || d.name || '');
    if (msgType === 'community_forward') return '📮 分享了社区帖子：' + (d.title || '');
    if (d && d.content) return String(d.content);
    if (d && d.title) return String(d.title);
  } catch (e) {}
  return content || '';
}

function onPrivateMessage(fromUserId, message) {
  if (fromUserId === state.botCfg.userId || message.sender_id === state.botCfg.userId) return;
  if (!obReady()) {
    log('OneBot 未连接，忽略来自 ' + fromUserId + ' 的消息');
    return;
  }
  state.counters.received++;

  var content = message.content || '';
  var msgType = message.type || 'text';
  var userText;
  if (msgType === 'text') {
    userText = content;
  } else if (msgType === 'ai_forward') {
    try { userText = JSON.parse(content).content || ''; } catch (e) { userText = ''; }
  } else if (msgType === 'music_playlist' || msgType === 'community_forward') {
    userText = extractSpecialText(msgType, content);
  } else {
    sendPrivate(fromUserId, '这种类型我收不到啦，截图发文字给我吧～');
    return;
  }
  if (!userText || !userText.trim()) {
    sendPrivate(fromUserId, '好像没有收到文字内容呢，再发一次？');
    return;
  }

  var allowed = (process.env.AB_ALLOWED_USERS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (allowed.length > 0 && allowed.indexOf(fromUserId) === -1) {
    log('用户 ' + fromUserId + ' 不在白名单中，忽略');
    return;
  }
  forwardToOneBot(fromUserId, userText, message);
}

function forwardToOneBot(fromUserId, userText, originalMessage) {
  var msgId = ++state.msgSeq;
  var nickname = (originalMessage && (originalMessage.sender_name || originalMessage.net_name)) || fromUserId;
  var event = {
    time: Math.floor(Date.now() / 1000),
    self_id: ciSelfId(),
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    message_id: msgId,
    user_id: fromUserId,
    message: buildInboundSegments(userText, originalMessage && originalMessage.reply_to),
    raw_message: userText,
    font: 0,
    sender: { user_id: fromUserId, nickname: String(nickname), sex: 'unknown', age: 0 }
  };
  var replySeg = inboundReplySegment(originalMessage);
  if (replySeg) event.message.unshift(replySeg);
  if (originalMessage && originalMessage.id != null) {
    state.ciToOb[String(originalMessage.id)] = msgId;
    state.obToCi[msgId] = String(originalMessage.id);
    var ok = Object.keys(state.obToCi);
    if (ok.length > 400) delete state.obToCi[ok[0]];
  }
  cacheAndSendEvent(event, 'user=' + fromUserId);
}

// CI 群消息 → OneBot 群事件（群 ID / 用户 ID 均为 CI 原生值）
function onGroupMessage(groupId, message) {
  if (!obReady()) return;
  if (message.sender_id === state.botCfg.userId) return;
  var msgType = message.type || 'text';
  var text;
  if (msgType === 'text') text = message.content || '';
  else if (msgType === 'ai_forward') {
    try { text = JSON.parse(message.content).content || ''; } catch (e) { text = ''; }
  } else {
    return; // 群里非文本消息静默忽略，避免刷屏
  }
  if (!text.trim()) return;

  state.counters.received++;
  var msgId = ++state.msgSeq;
  var event = {
    time: Math.floor(Date.now() / 1000),
    self_id: ciSelfId(),
    post_type: 'message',
    message_type: 'group',
    sub_type: 'normal',
    message_id: msgId,
    group_id: groupId,
    user_id: message.sender_id,
    message: buildInboundSegments(text, message && message.reply_to),
    raw_message: text,
    font: 0,
    sender: { user_id: message.sender_id, nickname: String(message.sender_name || message.sender_id), card: String(message.sender_name || ''), role: 'member' }
  };
  var replySegG = inboundReplySegment(message);
  if (replySegG) event.message.unshift(replySegG);
  if (message.id != null) {
    state.ciToOb[String(message.id)] = msgId;
    state.obToCi[msgId] = String(message.id);
    var okg = Object.keys(state.obToCi);
    if (okg.length > 400) delete state.obToCi[okg[0]];
  }
  cacheAndSendEvent(event, 'group=' + groupId + ' user=' + message.sender_id);
}

function cacheAndSendEvent(event, tag) {
  state.msgCache[event.message_id] = event;
  var keys = Object.keys(state.msgCache);
  if (keys.length > 200) delete state.msgCache[keys[0]];
  try {
    state.obWs.send(JSON.stringify(event));
    log('已上报事件 ' + tag + ' text=' + event.raw_message.slice(0, 40));
  } catch (e) {
    log('上报 OneBot 失败:', e.message);
    sendFallback(event.sender && event.sender.user_id);
  }
}

// ===== OneBot 反向 WS 客户端 =====

function obReady() {
  return state.obWs && state.obWs.readyState === WebSocket.OPEN;
}

function obConnect() {
  log('连接 AstrBot OneBot 反向 WS:', CFG.obUrl);
  var ws = new WebSocket(CFG.obUrl, {
    headers: (function () {
      var h = { 'X-Client-Role': 'universal', 'X-Self-ID': ciSelfId() };
      if (CFG.obToken) h.Authorization = 'Bearer ' + CFG.obToken;
      return h;
    })()
  });
  state.obWs = ws;

  ws.on('open', function () {
    log('OneBot 反向 WS 已连接，AstrBot 管线接通');
    state.obConnected = true;
    state.obAttempts = 0;
    startObHeartbeat();
    // OneBot 生命周期事件
    try {
      ws.send(JSON.stringify({
        time: Math.floor(Date.now() / 1000), self_id: ciSelfId(),
        post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'connect'
      }));
    } catch (e) {}
  });

  ws.on('message', function (raw) {
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (data.action) handleObAction(data).catch(function (e) { log('action 处理异常:', e.message); });
  });

  ws.on('error', function (err) { log('OneBot WS 错误:', err.message); });

  ws.on('close', function () {
    log('OneBot WS 关闭');
    state.obConnected = false;
    stopObHeartbeat();
    scheduleObReconnect();
  });
}

function startObHeartbeat() {
  stopObHeartbeat();
  state.heartbeatTimer = setInterval(function () {
    if (!obReady()) return;
    try {
      state.obWs.send(JSON.stringify({
        time: Math.floor(Date.now() / 1000), self_id: ciSelfId(),
        post_type: 'meta_event', meta_event_type: 'heartbeat', interval: 30000
      }));
    } catch (e) {}
  }, 30000);
}

function stopObHeartbeat() {
  if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = null; }
}

function scheduleObReconnect() {
  if (state.obTimer) return;
  state.obAttempts++;
  var delay = Math.min(30000, 3000 * state.obAttempts);
  state.obTimer = setTimeout(function () {
    state.obTimer = null;
    obConnect();
  }, delay);
}

function obReply(echo, data, retcode) {
  if (!obReady()) return;
  try {
    state.obWs.send(JSON.stringify({
      status: retcode ? 'failed' : 'ok',
      retcode: retcode || 0,
      data: data || null,
      echo: echo
    }));
  } catch (e) {}
}

async function handleObAction(req) {
  var action = req.action || '';
  var p = req.params || {};
  var echo = req.echo;

  try {
    switch (action) {
      case 'send_private_msg':
      case 'send_msg':
        await handleSendPrivate(p, echo);
        return;
      case 'send_group_msg':
        await handleSendGroup(p, echo);
        return;
      case 'send_private_forward_msg':
      case 'send_group_forward_msg':
        await handleForwardMsg(p, echo);
        return;
      case 'get_msg':
        obReply(echo, state.msgCache[p.message_id] || null);
        return;
      case 'get_login_info':
        obReply(echo, { user_id: ciSelfId(), nickname: (state.botCfg && state.botCfg.netName) || '林晞' });
        return;
      case 'get_stranger_info':
        obReply(echo, obStrangerInfo(p.user_id));
        return;
      case 'get_friend_list':
        obReply(echo, []);
        return;
      case 'get_version_info':
        obReply(echo, { app_name: 'classintra-relay', app_version: '2.1.0', protocol_version: 'v11' });
        return;
      case 'get_status':
        obReply(echo, { online: true, good: true });
        return;
      case 'get_image':
      case 'get_record':
        obReply(echo, { file: p.file || '' });
        return;
      case 'can_send_image':
      case 'can_send_record':
        obReply(echo, { yes: true });
        return;
      case 'get_group_list':
        obReply(echo, obGroupList());
        return;
      case 'get_group_info':
        obReply(echo, obGroupInfo(p.group_id));
        return;
      case 'get_group_member_list':
        obReply(echo, obGroupMembers(p.group_id));
        return;
      case 'get_group_member_info':
        obReply(echo, obGroupMemberInfo(p.group_id, p.user_id));
        return;
      case 'get_group_honor_info':
        obReply(echo, {});
        return;
      case 'delete_msg':
        recallCiMessages(p.message_id);
        obReply(echo, {});
        return;
      case 'set_friend_add_request':
      case 'set_group_add_request':
      case 'set_group_ban':
      case 'set_group_whole_ban':
      case 'set_group_admin':
      case 'set_group_card':
      case 'set_group_kick':
      case 'set_group_leave':
      case 'set_group_special_title':
      case 'set_model_show':
        log('OneBot action 已受理（CI 无对应能力）:', action);
        obReply(echo, {});
        return;
      case 'upload_group_file':
      case 'upload_private_file':
      case 'get_group_file_url':
      case 'get_private_file_url':
      case 'get_group_files_by_folder':
      case 'create_group_file_folder':
        log('OneBot 文件 action 已受理（CI 聊天不支持文件直发）:', action);
        obReply(echo, {});
        return;
      case 'get_model_show':
        obReply(echo, { model_variants: [] });
        return;
      case 'send_group_sign':
      case 'send_like':
        obReply(echo, {});
        return;
      case '.handle_quick_operation':
        obReply(echo, {});
        return;
      default:
        log('未处理的 OneBot action:', action);
        obReply(echo, {});
        return;
    }
  } catch (e) {
    log('处理 OneBot action 异常:', action, e.message);
    obReply(echo, null, 1200);
  }
}

// 机器人自撤回：delete_msg(message_id=出站时返回的 OneBot id) → 撤回对应 CI 消息
function recallCiMessages(obId) {
  var list = state.sentCiByOb[String(obId)] || [];
  if (!list.length) { log('撤回请求无对应已发送消息:', obId); return; }
  for (var i = 0; i < list.length; i++) {
    var rec = list[i];
    try {
      var payload = { type: 'recall_message', message_type: rec.channel, message_id: rec.ciId };
      if (rec.channel === 'group') payload.group_id = rec.groupId;
      state.ws.send(JSON.stringify(payload));
    } catch (e) {}
  }
  log('已撤回 bot 消息 ob=' + obId + ' 共 ' + list.length + ' 条');
  delete state.sentCiByOb[String(obId)];
}

// ===== CI 数据库支撑的群/用户信息查询（QQ 协议面）=====

function obStrangerInfo(userId) {
  try {
    var row = db.prepare('SELECT user_id, net_name, real_name, gender FROM users WHERE user_id = ?').get(String(userId));
    if (row) return { user_id: row.user_id, nickname: row.net_name || row.user_id, sex: row.gender === '男' ? 'male' : row.gender === '女' ? 'female' : 'unknown', age: 0 };
  } catch (e) {}
  return { user_id: String(userId), nickname: 'user_' + userId, sex: 'unknown', age: 0 };
}

function obGroupList() {
  try {
    var rows = db.prepare('SELECT id, name, members_json FROM groups').all();
    return rows.filter(function (g) { return String(g.members_json || '').indexOf(ciSelfId()) !== -1; })
      .map(function (g) {
        var m = JSON.parse(g.members_json || '[]');
        return { group_id: g.id, group_name: g.name, member_count: m.length, max_member_count: 500 };
      });
  } catch (e) { return []; }
}

function obGroupInfo(groupId) {
  var list = obGroupList().filter(function (g) { return String(g.group_id) === String(groupId); });
  return list[0] || { group_id: String(groupId), group_name: '', member_count: 0, max_member_count: 500 };
}

function obGroupMembers(groupId) {
  try {
    var g = db.prepare('SELECT members_json, creator_id FROM groups WHERE id = ?').get(String(groupId));
    if (!g) return [];
    var ids = JSON.parse(g.members_json || '[]');
    return ids.map(function (uid) {
      var info = obStrangerInfo(uid);
      return { user_id: info.user_id, nickname: info.nickname, card: info.nickname, role: String(uid) === String(g.creator_id) ? 'owner' : 'member' };
    });
  } catch (e) { return []; }
}

function obGroupMemberInfo(groupId, userId) {
  var members = obGroupMembers(groupId);
  for (var i = 0; i < members.length; i++) {
    if (String(members[i].user_id) === String(userId)) return members[i];
  }
  return { user_id: String(userId), nickname: 'user_' + userId, card: '', role: 'member' };
}

// 段数组 → CI 文本/媒体 URL 列表（异步：http 媒体需下载落地）
async function segmentsToTexts(segments) {
  refReplyTo = null;
  var texts = [];
  if (typeof segments === 'string') {
    texts.push(mapEmojiTags(segments));
    return texts;
  }
  if (!Array.isArray(segments)) segments = [segments];
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i] || {};
    var type = seg.type || '';
    var d = seg.data || {};
    if (type === 'text') {
      if (d.text) texts.push(mapEmojiTags(String(d.text)));
    } else if (type === 'image' || type === 'record' || type === 'video' || type === 'file') {
      var url = await localizeMediaFile(type, d.file || '');
      if (url) texts.push(url);
      else texts.push('（' + type + ' 资源加载失败）');
    } else if (type === 'music') {
      // 音乐卡片：先回标题，音频后台下载后补发（避免阻塞回复）
      texts.push('🎵 ' + (d.title || '音乐分享') + (d.audio ? '' : (d.url ? ' ' + d.url : '')));
      if (d.audio && d.audio.indexOf('http') === 0) state.pendingMedia.push({ segType: 'record', url: d.audio });
    } else if (type === 'at') {
      var nick = d.qq != null ? obStrangerInfo(d.qq).nickname : '';
      texts.push('@' + (nick || d.qq || ''));
    } else if (type === 'reply') {
      // 引用段：转成 CI 原生 reply_to 对象（前端渲染引用气泡），不占文本
      var orig = state.msgCache[d.id];
      var ciId = state.obToCi[d.id];
      if (ciId) {
        refReplyTo = {
          message_id: ciId,
          user_name: (orig && orig.sender && orig.sender.nickname) || '你',
          content_preview: String((orig && orig.raw_message) || '').slice(0, 50) || '…'
        };
      }
    } else if (type === 'location') {
      texts.push('[位置] ' + (d.title || d.content || ''));
    } else if (type === 'share' || type === 'card') {
      texts.push('[分享] ' + (d.title || '') + (d.url ? ' ' + d.url : ''));
    } else if (type === 'poke') {
      texts.push('戳了戳你');
    } else if (type === 'contact') {
      texts.push('[推荐联系人/群]');
    } else if (type === 'node' || type === 'nodes') {
      var inner = type === 'nodes' ? (d.content || []) : [d];
      for (var j = 0; j < inner.length; j++) {
        var sub = inner[j] && (inner[j].content || inner[j].data && inner[j].data.content);
        if (sub) texts = texts.concat(await segmentsToTexts(sub));
      }
    } else if (type === 'face' || type === 'mface') {
      // QQ 小表情：跳过
    } else if (type === 'json' || type === 'xml') {
      try {
        var payload = JSON.parse(d.data || '{}');
        var jump = (payload.meta && (payload.meta.detail_1 || payload.meta.news)) || {};
        texts.push('🔗 ' + (jump.desc || payload.prompt || '') + (jump.qqdocurl || jump.jump || jump.url || ''));
      } catch (e) { texts.push('🔗 ' + (d.data || '').slice(0, 200)); }
    } else {
      log('跳过未知消息段类型:', type);
    }
  }
  return texts.filter(function (t) { return t && String(t).trim(); });
}

// OneBot 媒体段 → 保存到本地 Resources，返回站内 URL（CI 内网可加载）
function localizeMediaFile(segType, fileVal) {
  try {
    var buf = null;
    var ext = '.bin';
    var srcPath = null;
    if (fileVal.indexOf('base64://') === 0) {
      buf = Buffer.from(fileVal.substring(9), 'base64');
    } else if (fileVal.indexOf('file://') === 0) {
      var p = decodeURIComponent(fileVal.substring(7));
      if (/^\/[A-Za-z]:/.test(p)) p = p.substring(1); // file:///D:/... → D:/...
      if (!fs.existsSync(p)) { log('媒体文件不存在:', p); return ''; }
      srcPath = p;
      ext = path.extname(p) || '.bin';
    } else if (fileVal.indexOf('http') === 0) {
      // http(s) URL：由 relay（本机有外网）下载落地，CI 设备无需外网
      log('http 媒体段请使用 downloadToLocal 异步处理:', fileVal.slice(0, 60));
      return '';
    } else if (fileVal) {
      log('未知媒体协议:', fileVal.slice(0, 40));
      return '';
    }
    if (!buf && !srcPath) return '';
    // 注意：URL 不带 __image 等标记后缀——express.static 找不到带后缀的文件名，
    // 前端 detectMediaType 依赖扩展名识别类型
    if (!ext || ext === '.bin') ext = segType === 'image' ? '.png' : segType === 'record' ? '.mp3' : '.mp4';
    var token = Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + ext;
    var dest = path.join(CFG.resourceDir, 'remote', token);
    mkdirp(path.dirname(dest));
    if (srcPath) {
      // 同盘优先硬链接（大视频零拷贝），失败再复制
      try { fs.unlinkSync(dest); } catch (e) {}
      try { fs.linkSync(srcPath, dest); } catch (e) { fs.copyFileSync(srcPath, dest); }
    } else {
      fs.writeFileSync(dest, buf);
    }
    return CFG.resourceUrlBase + token;
  } catch (e) {
    log('媒体本地化异常:', e.message);
    return '';
  }
}

// http(s) 媒体下载落地（relay 本机有外网，CI 设备不用）
function withTimeout(promise, ms, tag) {
  return Promise.race([
    promise,
    new Promise(function (res) { setTimeout(function () { log(tag + ' 硬超时'); res(''); }, ms); })
  ]);
}

async function downloadToLocal(segType, url) {
  try {
    log('开始下载媒体:', url.slice(0, 80));
    var u = new URL(url);
    var resp = await withTimeout(axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 90000,
      maxContentLength: CFG.maxDownloadBytes,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Referer': u.origin + '/'
      }
    }), 100000, '媒体下载');
    var buf = Buffer.from(resp.data);
    if (!buf.length) return '';
    var ct = String(resp.headers['content-type'] || '');
    var ext = path.extname(new URL(url).pathname) || '';
    if (!ext || ext.length > 6) ext = ct.indexOf('audio') === 0 ? '.mp3' : ct.indexOf('video') === 0 ? '.mp4' : ct.indexOf('image') === 0 ? '.jpg' : '.bin';
    var token = Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + ext;
    var dest = path.join(CFG.resourceDir, 'remote', token);
    mkdirp(path.dirname(dest));
    fs.writeFileSync(dest, buf);
    return CFG.resourceUrlBase + token;
  } catch (e) {
    log('http 媒体下载失败:', url.slice(0, 60), e.message);
    return '';
  }
}

// ===== 论坛发帖附图持久化（base64/http → botmedia/remote 站内 URL）=====

function sniffImageExt(buf) {
  if (!buf || buf.length < 3) return '.png';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png';
  if (buf.length >= 6 && buf.toString('latin1', 0, 4) === 'GIF8') return '.gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4D) return '.bmp';
  return '.png';
}

function storeImageBytes(buf) {
  if (!buf || !buf.length) throw new Error('图片内容为空');
  if (buf.length > 10 * 1024 * 1024) throw new Error('单张图片不能超过 10MB');
  var token = Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + sniffImageExt(buf);
  var dest = path.join(CFG.resourceDir, 'remote', token);
  mkdirp(path.dirname(dest));
  fs.writeFileSync(dest, buf);
  return CFG.resourceUrlBase + token;
}

function persistBase64Image(raw) {
  var s = String(raw || '').trim();
  if (s.indexOf('data:') === 0) s = (s.split(',', 2)[1] || '').trim();
  if (s.indexOf('base64://') === 0) s = s.substring(9).trim();
  if (!s) throw new Error('图片 base64 为空');
  var buf = Buffer.from(s, 'base64');
  if (!buf.length) throw new Error('图片 base64 无效');
  return storeImageBytes(buf);
}

// 单个发帖附图 → 站内 URL；item 支持 { base64 } / { url } / 纯 base64 字符串
async function persistPublishImage(item) {
  if (typeof item === 'string') return persistBase64Image(item);
  item = item || {};
  var b64 = String(item.base64 || '').trim();
  var url = String(item.url || '').trim();
  if (b64) return persistBase64Image(b64);
  if (/^https?:\/\//i.test(url)) {
    var localized = await downloadToLocal('image', url);
    if (!localized) throw new Error('网络图片下载失败: ' + url.slice(0, 60));
    return localized;
  }
  throw new Error('不支持的附图格式（需 base64 或 http(s) 图片地址）');
}

// &&标签&& 兜底映射：meme_manager 未转换时，从表情包分类里取真图发站内 URL
var emojiDirCache = {};
function mapEmojiTags(text) {
  if (text.indexOf('&&') === -1) return text;
  return text.split('\n').map(function (line) {
    var m = line.trim().match(/^&&([^&\s]{1,24})&&$/);
    if (!m) return line;
    var tag = m[1];
    try {
      if (!emojiDirCache[tag]) {
        var dir = path.join(CFG.packMemesDir, tag);
        emojiDirCache[tag] = fs.existsSync(dir) ? fs.readdirSync(dir).filter(function (f) { return /\.(png|gif|jpe?g|webp|bmp)$/i.test(f); }) : [];
      }
      var files = emojiDirCache[tag];
      if (!files || !files.length) return line; // 没有对应分类，保留原文本
      var pick = files[Math.floor(Math.random() * files.length)];
      var src = path.join(CFG.packMemesDir, tag, pick);
      var token = 'e' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + path.extname(pick);
      var dest = path.join(CFG.resourceDir, 'remote', token);
      mkdirp(path.dirname(dest));
      try { fs.linkSync(src, dest); } catch (e) { fs.copyFileSync(src, dest); }
      return CFG.resourceUrlBase + token;
    } catch (e) {
      log('表情兜底映射失败:', tag, e.message);
      return line;
    }
  }).join('\n');
}

function mkdirp(dir) {
  var parts = path.resolve(dir).split(path.sep);
  var cur = parts[0];
  for (var i = 1; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    if (!fs.existsSync(cur)) fs.mkdirSync(cur);
  }
}

async function handleSendPrivate(p, echo) {
  var userId = p.user_id != null ? String(p.user_id) : '';
  var segTypes = (Array.isArray(p.message) ? p.message : []).map(function (x) { return x.type; }).join(',') || typeof p.message;
  log('出站 send_private user=' + userId + ' 段=[' + segTypes + ']');
  var texts = await segmentsToTexts(p.message);
  if (!userId || !texts.length) { obReply(echo, { message_id: 0 }); return; }
  var obId = ++state.msgSeq;
  obReply(echo, { message_id: obId, reserver: null });
  deliverTexts(userId, texts, 'private', state.refReplyTo, obId);
  flushPendingMedia(userId, 'private');
}

async function handleSendGroup(p, echo) {
  var groupId = p.group_id != null ? String(p.group_id) : '';
  log('出站 send_group group=' + groupId);
  var texts = await segmentsToTexts(p.message);
  if (!groupId || !texts.length) { obReply(echo, { message_id: 0 }); return; }
  var obIdG = ++state.msgSeq;
  obReply(echo, { message_id: obIdG, reserver: null });
  deliverTexts(groupId, texts, 'group', state.refReplyTo, obIdG);
  flushPendingMedia(groupId, 'group', obIdG);
}

async function handleForwardMsg(p, echo) {
  var target = (p.user_id || p.group_id) != null ? String(p.user_id || p.group_id) : '';
  var isGroup = p.user_id == null && p.group_id != null;
  var nodes = (p.params && p.params.messages) || p.messages || p.nodes || [];
  var texts = [];
  for (var i = 0; i < nodes.length; i++) {
    var content = nodes[i] && (nodes[i].content || nodes[i].data && nodes[i].data.content);
    if (content) texts = texts.concat(await segmentsToTexts(content));
  }
  obReply(echo, { message_id: ++state.msgSeq, reserver: null });
  if (target && texts.length) deliverTexts(target, texts, isGroup ? 'group' : 'private');
}

// 后台补发已落地的媒体（如点歌音频）
function flushPendingMedia(targetId, channel) {
  if (!state.pendingMedia.length) return;
  var items = state.pendingMedia.splice(0);
  items.forEach(function (item) {
    downloadToLocal(item.segType, item.url).then(function (url) {
      if (url) {
        log('媒体后台补发:', url);
        if (channel === 'group') sendGroupMessage(targetId, url);
        else sendPrivate(targetId, url);
      } else {
        if (channel === 'group') sendGroupMessage(targetId, '（音乐加载失败，换首试试？）');
        else sendPrivate(targetId, '（音乐加载失败，换首试试？）');
      }
    });
  });
}

// ===== 回复发送（ClassIntra 侧）=====

function deliverTexts(targetId, texts, channel, replyToCiId, obId, groupId) {
  // 合并超出上限的段，避免触发发送限流
  if (texts.length > CFG.maxSegments) {
    texts = texts.slice(0, CFG.maxSegments - 1).concat([texts.slice(CFG.maxSegments - 1).join('')]);
  }
  sendSegmented(targetId, texts, 0, channel || 'private', replyToCiId || null, obId || null, groupId || null);
}

function sendSegmented(targetId, texts, idx, channel, replyToCiId, obId, groupId) {
  if (idx >= texts.length) { state.counters.replied++; return; }
  // CI 原生引用：只挂在第一段上；temp_id 关联 obId 供撤回
  var tempId = obId ? 'ob' + obId + '_' + idx + '_' + crypto.randomBytes(2).toString('hex') : null;
  if (tempId && channel === 'group') state.pendingRecall[tempId] = { obId: obId, channel: 'group', target: targetId, groupId: groupId };
  else if (tempId) state.pendingRecall[tempId] = { obId: obId, channel: 'private', target: targetId };
  var ok = channel === 'group'
    ? sendGroupMessage(targetId, texts[idx], idx === 0 ? replyToCiId : null, tempId)
    : sendPrivate(targetId, texts[idx], idx === 0 ? replyToCiId : null, tempId);
  if (!ok) { state.counters.failed++; return; }
  if (idx < texts.length - 1) {
    var delay = 300 + Math.floor(Math.random() * 500);
    setTimeout(function () { sendSegmented(targetId, texts, idx + 1, channel, replyToCiId, obId, groupId); }, delay);
  } else {
    state.counters.replied++;
  }
}

function sendPrivate(targetUserId, content, replyToCiId, tempId) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    log('CI WS 未连接，无法发送给 ' + targetUserId);
    return false;
  }
  tempId = tempId || Date.now().toString() + '_' + crypto.randomBytes(3).toString('hex');
  var payload = {
    type: 'private_message',
    target_user_id: targetUserId,
    content: content,
    msg_type: 'text',
    temp_id: tempId
  };
  if (replyToCiId) payload.reply_to = replyToCiId;
  state.ws.send(JSON.stringify(payload));
  return true;
}

function sendGroupMessage(groupId, content, replyToCiId, tempId) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    log('CI WS 未连接，无法发送到群 ' + groupId);
    return false;
  }
  tempId = tempId || Date.now().toString() + '_' + crypto.randomBytes(3).toString('hex');
  var payload = {
    type: 'group_message',
    group_id: groupId,
    content: content,
    msg_type: 'text',
    temp_id: tempId
  };
  if (replyToCiId) payload.reply_to = replyToCiId;
  state.ws.send(JSON.stringify(payload));
  return true;
}

function sendFallback(userId) {
  state.counters.failed++;
  sendPrivate(userId, '😵 林晞好像生病了（Bot 服务不可达），等下再来找她吧。');
}

// ===== 生命周期 =====

function start() {
  if (state.started) return;
  state.started = true;
  if (!ensureBotAccount()) {
    log('机器人账号创建失败，3 秒后重试');
    setTimeout(start, 3000);
    return;
  }
  login().then(connectWs).catch(function (e) {
    log('首次登录失败:', e.message);
    scheduleReconnect();
  });
  obConnect();
}

function getStatus() {
  return {
    connected: state.connected,
    onebot: { connected: state.obConnected, url: CFG.obUrl, selfId: ciSelfId() },
    bot: state.botCfg ? state.botCfg.userId : null,
    netName: state.botCfg ? state.botCfg.netName : null,
    asyncEnabled: false,
    pendingTasks: 0,
    counters: state.counters
  };
}

module.exports = {
  start: start,
  getStatus: getStatus,
  sendPrivate: sendPrivate,
  publishForumPost: publishForumPost,
  persistPublishImage: persistPublishImage,
  CFG: CFG
};
