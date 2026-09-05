// AstrBot Relay - 机器人 WS 客户端与消息转发核心
//
// 链路：用户私聊"林晞" → 本插件以机器人账号登录的 WS 收到 private_message
//   → POST {ASTRBOT_API}/api/chat（SSH 正向隧道）→ 解析 message_chain
//   → 以机器人身份分段发回 ClassIntra；图片等资源经 /api/astrbot/resource 代理。
//
// 配置全部来自环境变量（server/.env）：
//   ASTRBOT_API        AstrBot API 地址（隧道），默认 http://localhost:9999
//   ASTRBOT_TOKEN      共享令牌（可选，与 AstrBot 插件 api_token 一致）
//   BOT_USER_ID / BOT_PASSWORD / BOT_NET_NAME   机器人账号
//   AB_API_TIMEOUT     调用 AstrBot 超时 ms，默认 65000
//   AB_MAX_SEGMENTS    单次回复最多分段数，默认 3
//   AB_HEAVY_KEYWORDS  触发异步模式的关键词，逗号分隔
//   AB_ASYNC_ENABLED   是否启用异步模式，默认 false
//   AB_CALLBACK_BASE   Bot 服务器回调本插件的地址（反向隧道），默认 http://localhost:7000

var WebSocket = require('ws');
var axios = require('axios');
var fs = require('fs');
var path = require('path');
var botUser = require('./bot-user');

var CFG = {
  // AstrBot v4.27+ 内置 OpenAPI：网页后端通过 HTTPS 访问 WebUI 同源 API
  api: process.env.ASTRBOT_API || 'http://localhost:9999',
  token: process.env.ASTRBOT_TOKEN || '',
  apiKey: process.env.ASTRBOT_API_KEY || '',
  timeout: parseInt(process.env.AB_API_TIMEOUT, 10) || 65000,
  maxSegments: parseInt(process.env.AB_MAX_SEGMENTS, 10) || 3,
  heavyKeywords: (process.env.AB_HEAVY_KEYWORDS || '画图,画一张,生成图,生成图片,海报,写作文,写论文,长文,分析文件,总结文件,大文件').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
  asyncEnabled: process.env.AB_ASYNC_ENABLED === 'true',
  callbackBase: process.env.AB_CALLBACK_BASE || 'http://localhost:7000',
  httpPort: parseInt(process.env.PORT, 10) || 3000,
  wsPort: parseInt(process.env.WS_PORT, 10) || 10001,
  resourceDir: process.env.AB_RESOURCE_DIR || path.join(process.cwd(), 'Resources', 'astrbot'),
  resourceMaxAgeMs: 24 * 3600 * 1000,
  // AstrBot 本机数据目录，用于直读附件（同机零外网）
  astrbotDataDir: process.env.ASTRBOT_DATA_DIR || 'D:/NetWork/Integration/AstrBot/data'
};

// ===== 运行状态 =====
var state = {
  started: false,
  ws: null,
  jwt: null,
  botCfg: null,
  connected: false,
  reconnectTimer: null,
  heartbeatTimer: null,
  lastPong: 0,
  reconnectAttempts: 0,
  tasks: {},        // task_id -> { userId, createdAt }
  counters: { received: 0, replied: 0, failed: 0 }
};

var ALLOWED_RESOURCE_PREFIX = '/classintra_res/';

function log() {
  var args = Array.prototype.slice.call(arguments);
  console.log.apply(console, ['[astrbot-relay]'].concat(args));
}

// ===== 机器人账号 =====

function ensureBotAccount() {
  state.botCfg = botUser.ensureBotUser();
  return !!state.botCfg;
}

// ===== 登录与 WS 连接 =====

function login() {
  var cfg = state.botCfg;
  return axios.post('http://localhost:' + CFG.httpPort + '/api/auth/login', {
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
  if (!state.jwt) {
    scheduleReconnect();
    return;
  }
  var url = 'ws://localhost:' + CFG.wsPort + '/?token=' + encodeURIComponent(state.jwt);
  log('连接 WS:', url.replace(/token=[^&]+/, 'token=***'));
  var ws = new WebSocket(url);
  state.ws = ws;

  ws.on('open', function () {
    log('WS 已连接，ClassIntra 机器人上线');
    state.connected = true;
    state.reconnectAttempts = 0;
    state.lastPong = Date.now();
    // 显式再鉴权一次（幂等），确保 clients 表注册
    ws.send(JSON.stringify({ type: 'connect', user_id: state.botCfg.userId, token: state.jwt }));
    startHeartbeat();
  });

  ws.on('message', function (raw) {
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    handleMessage(data);
  });

  ws.on('pong', function () { state.lastPong = Date.now(); });

  ws.on('error', function (err) {
    log('WS 错误:', err.message);
  });

  ws.on('close', function (code, reason) {
    log('WS 关闭: code=' + code + (reason ? ' reason=' + reason : ''));
    state.connected = false;
    stopHeartbeat();
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectAttempts++;
  var delay = Math.min(30000, 3000 * state.reconnectAttempts);
  log(delay / 1000 + ' 秒后重连（第 ' + state.reconnectAttempts + ' 次）');
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
      log('心跳超时，主动重连');
      try { state.ws.terminate(); } catch (e) {}
      return;
    }
    try { state.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
  }, 25000);
}

function stopHeartbeat() {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

// ===== 消息处理 =====

function handleMessage(data) {
  switch (data.type) {
    case 'connected':
      log('连接确认，当前在线 ' + ((data.users && data.users.length) || 0) + ' 人');
      break;
    case 'pong':
      state.lastPong = Date.now();
      break;
    case 'private_message':
      if (data.from_user_id && data.message) {
        onPrivateMessage(data.from_user_id, data.message);
      }
      break;
    case 'private_message_sent':
      // 发送回执：成功则静默
      if (data && data.success === false) {
        log('消息发送被服务端拒绝: ' + JSON.stringify(data));
      }
      break;
    case 'error':
      log('服务端错误消息: ' + (data.message || ''));
      break;
    default:
      break;
  }
}

function onPrivateMessage(fromUserId, message) {
  // 防自触发
  if (fromUserId === state.botCfg.userId || message.sender_id === state.botCfg.userId) return;
  state.counters.received++;

  var content = message.content || '';
  var msgType = message.type || 'text';
  var userText;

  if (msgType === 'text') {
    userText = content;
  } else if (msgType === 'ai_forward') {
    // 用户从 AI 聊天页转发的内容：{content, role}
    try {
      var fwd = JSON.parse(content);
      userText = fwd.content || '';
    } catch (e) { userText = ''; }
  } else {
    sendPrivate(fromUserId, '暂不支持这种消息类型，发文字给我吧～');
    return;
  }
  if (!userText || !userText.trim()) {
    sendPrivate(fromUserId, '好像没有收到文字内容呢，再发一次？');
    return;
  }

  // 用户白名单（AB_ALLOWED_USERS，空=允许所有人）
  var allowed = (process.env.AB_ALLOWED_USERS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (allowed.length > 0 && allowed.indexOf(fromUserId) === -1) {
    log('用户 ' + fromUserId + ' 不在白名单中，忽略');
    return;
  }

  processUserMessage(fromUserId, userText, message);
}

function isHeavyTask(text) {
  if (text.length > 500) return true;
  for (var i = 0; i < CFG.heavyKeywords.length; i++) {
    if (text.indexOf(CFG.heavyKeywords[i]) !== -1) return true;
  }
  return false;
}

function processUserMessage(userId, text, originalMessage) {
  var payload = {
    message: text,
    user_id: userId,
    session_id: 'private_' + userId,
    platform: 'classintra',
    mode: 'sync',
    images: []
  };

  // 异步模式：重任务 / 反向隧道可用时
  if (CFG.asyncEnabled && isHeavyTask(text)) {
    payload.mode = 'async';
    payload.callback_url = CFG.callbackBase + '/api/astrbot/callback';
    callAstrBot(payload).then(function (result) {
      if (result && result.task_id) {
        state.tasks[result.task_id] = { userId: userId, createdAt: Date.now() };
        sendPrivate(userId, '🌿 收到！这个任务有点大，林晞先去处理了，好了叫你～');
      } else {
        sendFallback(userId, result);
      }
    }).catch(function () {
      sendFallback(userId, null);
    });
    return;
  }

  callAstrBot(payload).then(function (result) {
    sendRichMessage(userId, result);
  }).catch(function (err) {
    log('调用 AstrBot 失败:', err.message);
    sendFallback(userId, null);
  });
}

function callAstrBot(payload) {
  var headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
  // 内置 OpenAPI 使用 Authorization Bearer；旧版自定义 API 仍兼容 X-ClassIntra-Token
  if (CFG.apiKey) headers.Authorization = 'Bearer ' + CFG.apiKey;
  else if (CFG.token) headers['X-ClassIntra-Token'] = CFG.token;
  var body = {
    username: payload.user_id || 'classintra',
    session_id: payload.session_id || ('private_' + (payload.user_id || 'anonymous')),
    message: payload.message || ''
  };
  return axios.post(CFG.api + '/api/v1/chat', body, {
    timeout: CFG.timeout,
    headers: headers,
    responseType: 'text',
    transformResponse: [function (data) { return data; }]
  }).then(function (resp) {
    var raw = String(resp.data || '');
    // AstrBot v4.27 SSE：只消费 plain 事件的 data，complete/end 代表结束。
    var events = [];
    raw.split(/\r?\n/).forEach(function (line) {
      if (line.indexOf('data:') !== 0) return;
      var text = line.substring(5).trim();
      if (!text || text === '[DONE]') return;
      try { events.push(JSON.parse(text)); } catch (e) { log('忽略无效 SSE 行'); }
    });
    var reply = '';
    var lastPlain = '';
    var media = [];   // {type, filename} 来自 image/record/file/video 事件
    for (var i = 0; i < events.length; i++) {
      var ev = events[i] || {};
      if (ev.type === 'plain' && typeof ev.data === 'string') {
        var chunk = ev.data;
        // 某些代理/流式模式会重复发送同一段 plain，避免重复拼接。
        if (chunk && chunk !== lastPlain) {
          reply += chunk;
          lastPlain = chunk;
        }
      }
      if ((ev.type === 'image' || ev.type === 'record' || ev.type === 'file' || ev.type === 'video')
          && typeof ev.data === 'string') {
        var fname = ev.data.replace(/^\[(IMAGE|RECORD|FILE|VIDEO)\]/, '').split('|')[0];
        if (fname && media.indexOf(fname) === -1) media.push({ type: ev.type, filename: fname });
      }
      if (ev.type === 'error') throw new Error(typeof ev.data === 'string' ? ev.data : 'AstrBot API 返回错误');
    }
    // 媒体文件复制到 CI 本地 Resources（同机直读 AstrBot attachments 目录，零外网依赖）
    var chain = [];
    if (reply) chain.push({ type: 'plain', text: reply });
    for (var m = 0; m < media.length; m++) chain.push(localizeMedia(media[m]));
    return { mode: 'sync', status: 'success', reply: reply, message_chain: chain, resources: [], session_id: body.session_id };
  });
}

// 把 AstrBot 生成的媒体文件复制进 ClassIntra Resources，返回站内 URL 段
function localizeMedia(item) {
  var extMap = { image: '__image', record: '__audio', video: '__video', file: '' };
  try {
    var src = path.join(CFG.astrbotDataDir, 'attachments', item.filename);
    if (!fs.existsSync(src)) src = path.join(CFG.astrbotDataDir, 'webchat', 'imgs', item.filename);
    if (!fs.existsSync(src)) return { type: 'plain', text: '（' + item.type + ' 资源缺失）' };
    var token = Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + path.extname(item.filename);
    mkdirp(CFG.resourceDir + '/remote');
    fs.copyFileSync(src, path.join(CFG.resourceDir, 'remote', token));
    return { type: 'plain', text: '/resources/astrbot/remote/' + token + extMap[item.type] };
  } catch (e) {
    log('媒体本地化失败:', item.filename, e.message);
    return { type: 'plain', text: '（' + item.type + ' 资源加载失败）' };
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

// &&表情名&& → 本地表情包图片（Resources/astrbot/emoji/<名>.<ext>）
function mapEmojiTags(text) {
  return text.split('\n').map(function (line) {
    var m = line.trim().match(/^&&([^&\s]+)&&$/);
    if (!m) return line;
    var tag = m[1];
    var exts = ['.gif', '.png', '.jpg', '.jpeg', '.webp'];
    for (var i = 0; i < exts.length; i++) {
      var p = path.join(CFG.resourceDir, 'emoji', tag + exts[i]);
      if (fs.existsSync(p)) return '/resources/astrbot/emoji/' + tag + exts[i] + '__image';
    }
    return line; // 没有对应图片时保留原文本
  }).join('\n');
}

function sendFallback(userId, result) {
  var text = (result && result.error && result.error.indexOf('超时') !== -1)
    ? '💤 林晞在发呆，你再叫叫她？'
    : '😵 林晞好像生病了（Bot 服务不可达），等下再来找她吧。';
  sendPrivate(userId, text);
}

// ===== 回复发送 =====

function sendPrivate(targetUserId, content) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    log('WS 未连接，无法发送给 ' + targetUserId);
    return false;
  }
  var tempId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6);
  state.ws.send(JSON.stringify({
    type: 'private_message',
    target_user_id: targetUserId,
    content: content,
    msg_type: 'text',
    temp_id: tempId
  }));
  return true;
}

// 将 AstrBot 的 message_chain 拆成适合发送的文本段（含资源链接）
function segmentsToTexts(result) {
  var chain = (result && result.message_chain) || [];
  var resources = (result && result.resources) || [];
  var resMap = {};
  for (var i = 0; i < resources.length; i++) resMap[resources[i].path] = resources[i];

  var texts = [];
  for (var j = 0; j < chain.length; j++) {
    var seg = chain[j];
    if (seg.type === 'plain' && seg.text) {
      texts.push(seg.text);
    } else if (seg.type === 'image' || seg.type === 'record' || seg.type === 'video' || seg.type === 'file') {
      var localUrl = resourceLocalUrl(seg);
      if (localUrl) {
        texts.push(localUrl);
      } else if (seg.url) {
        texts.push(seg.url);
      } else {
        texts.push('（' + seg.type + ' 资源生成失败）');
      }
    }
  }
  if (texts.length === 0 && result && result.reply) texts.push(result.reply);
  return texts;
}

// 资源落盘到 Resources/astrbot/，返回站内 /resources/ URL（前端原生渲染图片/音频/视频）
function resourceLocalUrl(seg) {
  var rp = seg.resource_path;
  if (!rp || rp.indexOf(ALLOWED_RESOURCE_PREFIX) !== 0) return '';
  var token = rp.substring(ALLOWED_RESOURCE_PREFIX.length);
  if (!/^[0-9a-f]{16,}\.\w{1,8}$/.test(token)) return '';
  var src = path.join(CFG.resourceDir, 'remote', token);
  if (!fs.existsSync(src)) return '';
  // URL 携带 __image/__audio/__video 标记，确保前端 detectMediaType 识别
  var kind = seg.type === 'image' ? '__image' : seg.type === 'record' ? '__audio' : seg.type === 'video' ? '__video' : '';
  return '/resources/astrbot/remote/' + token + kind;
}

function sendRichMessage(userId, result) {
  if (!result || result.error) {
    sendFallback(userId, result);
    return;
  }
  var rawTexts = segmentsToTexts(result);
  var texts = [];
  for (var ti = 0; ti < rawTexts.length; ti++) {
    // &&……&& 是 AstrBot/QQ 表情包标记；本地映射表情图后独占一行
    var normalized = String(rawTexts[ti] || '').trim();
    normalized = mapEmojiTags(normalized);
    if (!normalized) continue;
    // 按中文/英文句末标点分段，保留标点；没有标点的短文本保持单段。
    var parts = normalized.match(/[^。！？!?；;\\n]+[。！？!?；;]*/g) || [normalized];
    for (var pi = 0; pi < parts.length; pi++) {
      if (parts[pi].trim()) texts.push(parts[pi].trim());
    }
  }
  if (texts.length === 0) {
    sendPrivate(userId, '（林晞好像不知道说什么…换个问法试试？）');
    return;
  }
  // 合并超出上限的段，避免触发 ClassIntra 每分钟发送限制。
  if (texts.length > CFG.maxSegments) {
    texts = texts.slice(0, CFG.maxSegments - 1).concat([texts.slice(CFG.maxSegments - 1).join('')]);
  }
  sendSegmented(userId, texts, 0);
}

function sendSegmented(userId, texts, idx) {
  if (idx >= texts.length) {
    state.counters.replied++;
    return;
  }
  sendPrivate(userId, texts[idx]);
  if (idx < texts.length - 1) {
    var delay = 300 + Math.floor(Math.random() * 500);
    setTimeout(function () { sendSegmented(userId, texts, idx + 1); }, delay);
  } else {
    state.counters.replied++;
  }
}

// ===== 资源拉取（AstrBot → 本地 Resources/astrbot/remote）=====

function fetchResource(resourcePath) {
  // resourcePath 形如 /classintra_res/<token>.png → 下载到本地供 /resources/ 静态服务
  if (!resourcePath || resourcePath.indexOf(ALLOWED_RESOURCE_PREFIX) !== 0) {
    return Promise.reject(new Error('非法资源路径'));
  }
  var token = resourcePath.substring(ALLOWED_RESOURCE_PREFIX.length);
  if (!/^[0-9a-f]{16,}\.\w{1,8}$/.test(token)) {
    return Promise.reject(new Error('非法资源标识'));
  }
  var destDir = path.join(CFG.resourceDir, 'remote');
  var dest = path.join(destDir, token);
  if (fs.existsSync(dest)) return Promise.resolve(dest);

  var headers = {};
  if (CFG.token) headers['X-ClassIntra-Token'] = CFG.token;
  return axios.get(CFG.api + resourcePath, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: headers,
    maxContentLength: 50 * 1024 * 1024
  }).then(function (resp) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, Buffer.from(resp.data));
    return dest;
  });
}

function cleanupResources() {
  var dir = path.join(CFG.resourceDir, 'remote');
  if (!fs.existsSync(dir)) return;
  var now = Date.now();
  try {
    var files = fs.readdirSync(dir);
    for (var i = 0; i < files.length; i++) {
      var p = path.join(dir, files[i]);
      try {
        var st = fs.statSync(p);
        if (now - st.mtimeMs > CFG.resourceMaxAgeMs) fs.unlinkSync(p);
      } catch (e) {}
    }
  } catch (e) {}
}

// ===== 异步任务表清理 =====

function cleanupTasks() {
  var now = Date.now();
  var expired = [];
  for (var tid in state.tasks) {
    if (now - state.tasks[tid].createdAt > 5 * 60 * 1000) expired.push(tid);
  }
  for (var i = 0; i < expired.length; i++) {
    var t = state.tasks[expired[i]];
    log('异步任务超时未回调: ' + expired[i]);
    sendPrivate(t.userId, '🐢 林晞做这个花了好久…要不你再说一遍要求？');
    delete state.tasks[expired[i]];
  }
}

// ===== 启动入口 =====

function start() {
  if (state.started) return;
  state.started = true;
  log('启动中。AstrBot API: ' + CFG.api + '，异步模式: ' + (CFG.asyncEnabled ? '开' : '关'));
  if (!ensureBotAccount()) {
    log('机器人账号不可用，插件未启动（请配置 BOT_PASSWORD）');
    return;
  }
  login().then(connectWs).catch(function (e) {
    log('首次登录失败:', e.message);
    scheduleReconnect();
  });
  setInterval(cleanupResources, 3600 * 1000).unref();
  setInterval(cleanupTasks, 60 * 1000).unref();
}

function getStatus() {
  return {
    connected: state.connected,
    bot: state.botCfg ? state.botCfg.userId : null,
    netName: state.botCfg ? state.botCfg.netName : null,
    api: CFG.api,
    asyncEnabled: CFG.asyncEnabled,
    pendingTasks: Object.keys(state.tasks).length,
    counters: state.counters
  };
}

function completeTask(taskId) {
  var t = state.tasks[taskId];
  if (!t) return null;
  delete state.tasks[taskId];
  return t;
}

module.exports = {
  start: start,
  getStatus: getStatus,
  sendPrivate: sendPrivate,
  sendRichMessage: sendRichMessage,
  fetchResource: fetchResource,
  completeTask: completeTask,
  CFG: CFG,
  ALLOWED_RESOURCE_PREFIX: ALLOWED_RESOURCE_PREFIX
};
