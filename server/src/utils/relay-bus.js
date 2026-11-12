/**
 * relay-bus.js - 统一联动事件总线
 *
 * 设计原则：
 * 1. 注册即用：register(type, handler) 一行注册，自动加入可中继类型列表
 * 2. 统一发送：emit(type, data) 自动本地广播+中继，emitLocal(type, data) 仅本地
 * 3. 统一接收：processRelayed(payload, sourceServer) 自动分发到注册的处理器
 * 4. 处理器只关注业务逻辑，不需要关心广播/中继细节
 *
 * 使用示例：
 *   var bus = require('./relay-bus');
 *   bus.init({ db, broadcast, sendToClient, ... });
 *   bus.register('my_event', function(payload, ctx) {
 *     ctx.db.prepare('INSERT ...').run(...);
 *     ctx.broadcast({ type: 'my_event', ... });
 *   });
 *   bus.emit('my_event', { key: 'value' });
 */

// ===== 事件注册表 =====
var registry = {};

// ===== 依赖注入 =====
var deps = {
  db: null,
  broadcast: null,
  sendToClient: null,
  onlineUsers: null,
  clients: null,
  remoteOnlineUsers: null,
  relaySync: null,
  relayToPeers: null,
  handleDisconnect: null,
  emitRelayEvent: null,
  // prepared statements (from relay-sync)
  getSyncStmts: null,
  // chat-server prepared statements
  stmtInsertRelayedChatMessage: null,
  stmtInsertRelayedPrivateMessage: null,
  stmtInsertRelayedGroupMessage: null,
  stmtGetGroup: null,
  stmtInsertGroup: null,
  stmtUpdateGroupMembers: null,
  stmtUpdateGroupName: null,
  stmtUpdateGroupAnnouncement: null,
  stmtUpdateGroupCreator: null,
  stmtDeleteGroupMessages: null,
  stmtDeleteGroup: null,
  stmtRecallChatMessage: null,
  stmtRecallPrivateMessage: null,
  stmtRecallGroupMessage: null,
  parseMembersJson: null,
  obfuscatePw: null,
  deobfuscatePw: null,
  RELAY_SERVER_ID: null
};

// ===== 去重缓存 =====
var processedRelayMsgIds = {};
var MAX_PROCESSED_MSG_IDS = 5000;

// ===== 初始化 =====
function init(options) {
  for (var key in options) {
    if (deps.hasOwnProperty(key)) {
      deps[key] = options[key];
    }
  }
}

// ===== 注册事件 =====
// opts: { localOnly: false } - localOnly=true 表示不中继到其他服务器
function register(eventType, handler, opts) {
  registry[eventType] = {
    handler: handler,
    localOnly: (opts && opts.localOnly) || false
  };
}

// ===== 获取所有可中继的事件类型 =====
function getRelayableTypes() {
  var types = [];
  for (var t in registry) {
    if (!registry[t].localOnly) {
      types.push(t);
    }
  }
  return types;
}

// ===== 构建处理器上下文 =====
function createContext(sourceServer) {
  return {
    db: deps.db,
    broadcast: function(msg, excludeClientId) {
      deps.broadcast(msg, excludeClientId || null, true);
    },
    broadcastAll: function(msg, excludeClientId) {
      deps.broadcast(msg, excludeClientId || null, false);
    },
    sendToClient: deps.sendToClient,
    onlineUsers: deps.onlineUsers,
    clients: deps.clients,
    remoteOnlineUsers: deps.remoteOnlineUsers,
    relaySync: deps.relaySync,
    relayToPeers: deps.relayToPeers,
    sourceServer: sourceServer,
    ss: deps.getSyncStmts ? deps.getSyncStmts() : null,
    // 快捷访问 prepared statements
    stmts: {
      insertRelayedChatMessage: deps.stmtInsertRelayedChatMessage,
      insertRelayedPrivateMessage: deps.stmtInsertRelayedPrivateMessage,
      insertRelayedGroupMessage: deps.stmtInsertRelayedGroupMessage,
      getGroup: deps.stmtGetGroup,
      insertGroup: deps.stmtInsertGroup,
      updateGroupMembers: deps.stmtUpdateGroupMembers,
      updateGroupName: deps.stmtUpdateGroupName,
      updateGroupAnnouncement: deps.stmtUpdateGroupAnnouncement,
      updateGroupCreator: deps.stmtUpdateGroupCreator,
      deleteGroupMessages: deps.stmtDeleteGroupMessages,
      deleteGroup: deps.stmtDeleteGroup,
      recallChatMessage: deps.stmtRecallChatMessage,
      recallPrivateMessage: deps.stmtRecallPrivateMessage,
      recallGroupMessage: deps.stmtRecallGroupMessage
    },
    parseMembersJson: deps.parseMembersJson,
    serverId: deps.RELAY_SERVER_ID,
    handleDisconnect: deps.handleDisconnect,
    emitRelayEvent: deps.emitRelayEvent
  };
}

// ===== 处理中继消息 =====
function processRelayed(data) {
  var payload = data.payload;
  if (!payload) return;

  var sourceServer = data.source_server || '';

  // 解包 relayCustomEvent 包装的数据
  if (payload.data && typeof payload.data === 'object') {
    var unwrapped = payload.data;
    unwrapped.type = payload.type;
    payload = unwrapped;
  }

  // 密码反混淆
  if (payload._pw_obfuscated && payload.password_hash) {
    payload.password_hash = deps.deobfuscatePw(payload.password_hash);
    delete payload._pw_obfuscated;
  }

  // 去重检查（只判，不在这里置位 —— 见下方「成功后才标记」）
  var relayMsgId = data.relay_msg_id || '';
  if (relayMsgId && processedRelayMsgIds[relayMsgId]) {
    return;
  }

  // 查找注册的处理器
  var config = registry[payload.type];
  if (!config) {
    // 未知事件不记去重：对端重传 / 本端升级后仍有机会处理
    console.warn('[RelayBus] Unknown event type:', payload.type,
      'ref=' + (payload.ref || '-'));
    return;
  }

  var ctx = createContext(sourceServer);
  try {
    config.handler(payload, ctx);
  } catch (e) {
    // ⚠️ 处理失败绝不记去重。旧实现在 handler 之前就置位，抛错后重传被
    // 去重判断直接 return —— 这条消息永久丢失。这里带 ref 便于对端定位重放。
    console.error('[RelayBus] Error processing', payload.type + ':', e.message,
      'ref=' + (payload.ref || payload.id || '-') + ' relay_msg_id=' + (relayMsgId || '-'));
    return;
  }

  // 只有真正处理成功才记去重
  if (relayMsgId) {
    processedRelayMsgIds[relayMsgId] = true;
    var msgIdKeys = Object.keys(processedRelayMsgIds);
    if (msgIdKeys.length > MAX_PROCESSED_MSG_IDS) {
      delete processedRelayMsgIds[msgIdKeys[0]];
    }
  }
}

// ===== 发送事件（本地广播+中继） =====
function emit(eventType, data, excludeClientId) {
  // 本地广播：扁平格式，兼容前端，确保 type 不被 data 覆盖，移除密码哈希
  var localMsg = Object.assign({}, data, { type: eventType });
  delete localMsg.password_hash;
  delete localMsg._pw_obfuscated;
  deps.broadcast(localMsg, excludeClientId || null, true);

  // 中继到 peer 服务器：嵌套格式，密码混淆
  if (registry[eventType] && !registry[eventType].localOnly) {
    var relayData = data;
    if (data && data.password_hash) {
      relayData = Object.assign({}, data);
      relayData._pw_obfuscated = true;
      relayData.password_hash = deps.obfuscatePw(relayData.password_hash);
    }
    deps.relayToPeers({
      type: 'relay_message',
      source_server: deps.RELAY_SERVER_ID,
      payload: {
        type: eventType,
        data: relayData
      }
    });
  }
}
// 用于本地已通过 sendToClient 定向发送的场景（如私聊、群聊消息）
function relayOnly(eventType, data) {
  // 密码混淆
  if (data && data.password_hash) {
    data = Object.assign({}, data);
    data._pw_obfuscated = true;
    data.password_hash = deps.obfuscatePw(data.password_hash);
  }

  // 中继到 peer 服务器：嵌套格式，processRelayed 会解包
  if (registry[eventType] && !registry[eventType].localOnly) {
    deps.relayToPeers({
      type: 'relay_message',
      source_server: deps.RELAY_SERVER_ID,
      payload: {
        type: eventType,
        data: data
      }
    });
  }
}

// ===== 仅本地广播（不中继） =====
function emitLocal(eventType, data, excludeClientId) {
  // 扁平格式，兼容前端，确保 type 不被 data 覆盖
  var msg = Object.assign({}, data, { type: eventType });
  deps.broadcast(msg, excludeClientId || null, true);
}

// ===== 清理去重缓存 =====
function clearDedupCache() {
  processedRelayMsgIds = {};
}

module.exports = {
  init: init,
  register: register,
  getRelayableTypes: getRelayableTypes,
  processRelayed: processRelayed,
  emit: emit,
  emitLocal: emitLocal,
  relayOnly: relayOnly,
  clearDedupCache: clearDedupCache,
  registry: registry
};
