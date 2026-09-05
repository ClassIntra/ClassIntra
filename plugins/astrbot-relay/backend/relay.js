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

var CFG = {
  ciHttpPort: parseInt(process.env.PORT, 10) || 3000,
  ciWsPort: parseInt(process.env.WS_PORT, 10) || 10001,
  obUrl: process.env.ASTRBOT_WS_URL || 'ws://127.0.0.1:6199/ws',
  obToken: process.env.ASTRBOT_WS_TOKEN || '',
  selfId: parseInt(process.env.ASTRBOT_SELF_ID, 10) || 10000,
  maxSegments: parseInt(process.env.AB_MAX_SEGMENTS, 10) || 3,
  resourceDir: process.env.AB_RESOURCE_DIR || path.join(process.cwd(), 'Resources', 'astrbot')
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
  msgSeq: Math.floor(Date.now() / 1000) % 1000000000,
  idMap: {},          // 数字 user_id -> ClassIntra 原始 user_id（非数字 id 兜底）
  counters: { received: 0, replied: 0, failed: 0 }
};

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
    case 'private_message_sent':
      if (data && data.success === false) log('消息发送被服务端拒绝: ' + JSON.stringify(data));
      break;
    case 'error': log('CI 服务端错误消息: ' + (data.message || '')); break;
    default: break;
  }
}

// ===== CI 入站 → OneBot 事件上报 =====

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
  } else {
    sendPrivate(fromUserId, '暂不支持这种消息类型，发文字给我吧～');
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

function ciIdToNum(userId) {
  var n = parseInt(userId, 10);
  if (!isNaN(n) && String(n) === String(userId)) return n;
  // 非数字 id：哈希成稳定正整数并记录映射
  var h = crypto.createHash('md5').update(String(userId)).digest();
  n = h.readUInt32LE(0) % 2000000000 + 1;
  state.idMap[n] = String(userId);
  return n;
}

function numToCiId(n) {
  if (state.idMap[n]) return state.idMap[n];
  return String(n);
}

function forwardToOneBot(fromUserId, userText, originalMessage) {
  var msgId = ++state.msgSeq;
  var nickname = (originalMessage && (originalMessage.sender_name || originalMessage.net_name)) || fromUserId;
  var event = {
    time: Math.floor(Date.now() / 1000),
    self_id: CFG.selfId,
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    message_id: msgId,
    user_id: ciIdToNum(fromUserId),
    message: [{ type: 'text', data: { text: userText } }],
    raw_message: userText,
    font: 0,
    sender: { user_id: ciIdToNum(fromUserId), nickname: String(nickname), sex: 'unknown', age: 0 }
  };
  state.msgCache[msgId] = event;
  var keys = Object.keys(state.msgCache);
  if (keys.length > 200) delete state.msgCache[keys[0]];
  try {
    state.obWs.send(JSON.stringify(event));
    log('已上报私聊事件 user=' + fromUserId + ' text=' + userText.slice(0, 40));
  } catch (e) {
    log('上报 OneBot 失败:', e.message);
    sendFallback(fromUserId);
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
      var h = { 'X-Client-Role': 'universal', 'X-Self-ID': String(CFG.selfId) };
      if (CFG.obToken) h.Authorization = 'Bearer ' + CFG.obToken;
      return h;
    })()
  });
  state.obWs = ws;

  ws.on('open', function () {
    log('OneBot 反向 WS 已连接，AstrBot 管线接通');
    state.obConnected = true;
    state.obAttempts = 0;
  });

  ws.on('message', function (raw) {
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (data.action) handleObAction(data);
  });

  ws.on('error', function (err) { log('OneBot WS 错误:', err.message); });

  ws.on('close', function () {
    log('OneBot WS 关闭');
    state.obConnected = false;
    scheduleObReconnect();
  });
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

function handleObAction(req) {
  var action = req.action || '';
  var p = req.params || {};
  var echo = req.echo;

  try {
    switch (action) {
      case 'send_private_msg':
      case 'send_msg':
        handleSendPrivate(p, echo);
        return;
      case 'send_group_msg':
        log('忽略群消息发送（CI 无群聊对接）');
        obReply(echo, { message_id: 0 });
        return;
      case 'send_private_forward_msg':
      case 'send_group_forward_msg':
        handleForwardMsg(p, echo);
        return;
      case 'get_msg':
        obReply(echo, state.msgCache[p.message_id] || null);
        return;
      case 'get_login_info':
        obReply(echo, { user_id: CFG.selfId, nickname: (state.botCfg && state.botCfg.netName) || '林晞' });
        return;
      case 'get_stranger_info':
        obReply(echo, { user_id: p.user_id, nickname: 'user_' + p.user_id, sex: 'unknown', age: 0 });
        return;
      case 'get_friend_list':
        obReply(echo, []);
        return;
      case 'get_version_info':
        obReply(echo, { app_name: 'classintra-relay', app_version: '2.0.0', protocol_version: 'v11' });
        return;
      case 'get_image':
      case 'get_record':
        obReply(echo, { file: p.file || '' });
        return;
      case 'can_send_image':
      case 'can_send_record':
        obReply(echo, { yes: true });
        return;
      case 'delete_msg':
      case 'set_group_ban':
      case 'set_group_kick':
      case 'set_group_leave':
      case 'set_friend_add_request':
      case 'set_group_add_request':
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

// 段数组 → CI 文本/媒体 URL 列表
function segmentsToTexts(segments) {
  var texts = [];
  if (typeof segments === 'string') {
    texts.push(segments);
    return texts;
  }
  if (!Array.isArray(segments)) segments = [segments];
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i] || {};
    var type = seg.type || '';
    var d = seg.data || {};
    if (type === 'text') {
      if (d.text) texts.push(String(d.text));
    } else if (type === 'image' || type === 'record' || type === 'video' || type === 'file') {
      var url = localizeMediaFile(type, d.file || '');
      if (url) texts.push(url);
      else texts.push('（' + type + ' 资源加载失败）');
    } else if (type === 'music') {
      texts.push('🎵 ' + (d.title || '音乐分享') + (d.url ? ' ' + d.url : ''));
    } else if (type === 'at') {
      texts.push('@' + (d.qq || ''));
    } else if (type === 'reply') {
      // 引用：忽略（引用目标文本已在上文）
    } else if (type === 'node' || type === 'nodes') {
      var inner = type === 'nodes' ? (d.content || []) : [d];
      for (var j = 0; j < inner.length; j++) {
        var sub = inner[j] && (inner[j].content || inner[j].data && inner[j].data.content);
        if (sub) texts = texts.concat(segmentsToTexts(sub));
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
    if (fileVal.indexOf('base64://') === 0) {
      buf = Buffer.from(fileVal.substring(9), 'base64');
    } else if (fileVal.indexOf('file://') === 0) {
      var p = decodeURIComponent(fileVal.substring(7));
      if (/^\/[A-Za-z]:/.test(p)) p = p.substring(1); // file:///D:/... → D:/...
      if (!fs.existsSync(p)) { log('媒体文件不存在:', p); return ''; }
      buf = fs.readFileSync(p);
      ext = path.extname(p) || '.bin';
    } else if (fileVal.indexOf('http') === 0) {
      // http URL：AstrBot 在本机可直接下载
      return ''; // 极少出现；先跳过，避免阻塞
    } else if (fileVal) {
      log('未知媒体协议:', fileVal.slice(0, 40));
      return '';
    }
    if (!buf || !buf.length) return '';
    var kindMark = segType === 'image' ? '__image' : segType === 'record' ? '__audio' : segType === 'video' ? '__video' : '';
    if (!ext || ext === '.bin') ext = segType === 'image' ? '.png' : segType === 'record' ? '.mp3' : '.mp4';
    var token = Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + ext;
    mkdirp(path.join(CFG.resourceDir, 'remote'));
    fs.writeFileSync(path.join(CFG.resourceDir, 'remote', token), buf);
    return '/resources/astrbot/remote/' + token + kindMark;
  } catch (e) {
    log('媒体本地化异常:', e.message);
    return '';
  }
}

function mkdirp(dir) {
  var parts = path.resolve(dir).split(path.sep);
  var cur = parts[0];
  for (var i = 1; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    if (!fs.existsSync(cur)) fs.mkdirSync(cur);
  }
}

function handleSendPrivate(p, echo) {
  var numId = p.user_id;
  var userId = numToCiId(numId);
  var texts = segmentsToTexts(p.message);
  if (!texts.length) { obReply(echo, { message_id: 0 }); return; }
  obReply(echo, { message_id: ++state.msgSeq, reserver: null });
  deliverTexts(userId, texts);
}

function handleForwardMsg(p, echo) {
  var numId = p.user_id || p.group_id;
  var userId = numToCiId(numId);
  var nodes = (p.params && p.params.messages) || p.messages || p.nodes || [];
  var texts = [];
  for (var i = 0; i < nodes.length; i++) {
    var content = nodes[i] && (nodes[i].content || nodes[i].data && nodes[i].data.content);
    if (content) texts = texts.concat(segmentsToTexts(content));
  }
  obReply(echo, { message_id: ++state.msgSeq, reserver: null });
  if (texts.length) deliverTexts(userId, texts);
}

// ===== 回复发送（ClassIntra 侧）=====

function deliverTexts(userId, texts) {
  // 合并超出上限的段，避免触发发送限流
  if (texts.length > CFG.maxSegments) {
    texts = texts.slice(0, CFG.maxSegments - 1).concat([texts.slice(CFG.maxSegments - 1).join('')]);
  }
  sendSegmented(userId, texts, 0);
}

function sendSegmented(userId, texts, idx) {
  if (idx >= texts.length) { state.counters.replied++; return; }
  var ok = sendPrivate(userId, texts[idx]);
  if (!ok) { state.counters.failed++; return; }
  if (idx < texts.length - 1) {
    var delay = 300 + Math.floor(Math.random() * 500);
    setTimeout(function () { sendSegmented(userId, texts, idx + 1); }, delay);
  } else {
    state.counters.replied++;
  }
}

function sendPrivate(targetUserId, content) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    log('CI WS 未连接，无法发送给 ' + targetUserId);
    return false;
  }
  var tempId = Date.now().toString() + '_' + crypto.randomBytes(3).toString('hex');
  state.ws.send(JSON.stringify({
    type: 'private_message',
    target_user_id: targetUserId,
    content: content,
    msg_type: 'text',
    temp_id: tempId
  }));
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
    onebot: { connected: state.obConnected, url: CFG.obUrl, selfId: CFG.selfId },
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
  CFG: CFG
};
