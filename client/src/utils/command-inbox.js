/**
 * command-inbox.js — 设备指令信箱（客户端）
 *
 * 配套服务端的 device_commands 表，解决「控制指令发后不管、设备离线就永久丢失」的问题
 * （表现即为：封禁时有些设备收到不及时，甚至一直收不到）。
 *
 * 三条接收路径（任一命中即生效）：
 *   1. WS / 长轮询实时推送的 device_command 消息（在线设备秒级）
 *   2. WS 连接建立或重连成功时立刻补拉一次
 *   3. 定时兜底补拉（默认 15s），覆盖实时推送丢失、服务端重启丢队列等场景
 *
 * 幂等：指令以全局唯一 cmd_uid 标识，本地维护已执行 uid 集合（localStorage 持久化，
 * 300 条滑动窗口）。同一条指令被推送两次、或跨服务器投两份，都只会执行一次。
 *
 * 用法：
 *   import commandInbox from '@/utils/command-inbox';
 *   commandInbox.registerHandler('big_text', function(payload, cmd) { ... });
 *   commandInbox.start();
 */

import api from './api';
import wsManager from './websocket';

var SEEN_KEY = 'classintra_cmd_seen';
var SEEN_MAX = 300;
var SYNC_INTERVAL_MS = 15000;   // 定时兜底补拉
var RETRY_MIN_MS = 3000;
var RETRY_MAX_MS = 60000;

var handlers = {};              // cmd_type -> function(payload, cmd)
var seen = [];                  // 已执行的 uid（有序，最旧在前）
var syncTimer = null;
var retryTimer = null;
var retryDelay = RETRY_MIN_MS;
var running = false;
var inFlight = false;
var started = false;
var boundHandlers = null;

// ===== 已执行 uid 集合（持久化滑动窗口） =====

function loadSeen() {
  try {
    var raw = localStorage.getItem(SEEN_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    seen = Array.isArray(arr) ? arr : [];
  } catch (e) {
    seen = [];
  }
  if (seen.length > SEEN_MAX) seen = seen.slice(seen.length - SEEN_MAX);
}

function persistSeen() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch (e) {
    // 隐私模式下写入失败不影响运行，内存集合仍然有效
  }
}

function markSeen(uid) {
  if (!uid) return;
  if (seen.indexOf(uid) !== -1) return;
  seen.push(uid);
  if (seen.length > SEEN_MAX) seen = seen.slice(seen.length - SEEN_MAX);
  persistSeen();
}

function isSeen(uid) {
  return !!uid && seen.indexOf(uid) !== -1;
}

// ===== 指令执行 =====

/**
 * 执行一条指令。返回 true 表示本次真正处理（此前未处理过）。
 * 未注册的 cmd_type 也会被标记为已执行并 ACK，避免服务端反复重投。
 */
function execute(cmd) {
  if (!cmd || !cmd.uid) return false;
  if (isSeen(cmd.uid)) return false;    // 幂等：重复投递直接忽略

  markSeen(cmd.uid);

  var fn = handlers[cmd.cmd_type];
  if (typeof fn === 'function') {
    try {
      fn(cmd.payload || {}, cmd);
    } catch (e) {
      console.error('[CommandInbox] handler error for ' + cmd.cmd_type + ':', e && e.message);
    }
  } else {
    console.warn('[CommandInbox] 未注册的指令类型，已忽略:', cmd.cmd_type);
  }
  return true;
}

/**
 * 处理一批指令（实时推送或补拉结果），并 ACK 已执行的 uid。
 * @returns {string[]} 本次真正执行的 uid 列表
 */
function ingest(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  var executed = [];
  for (var i = 0; i < list.length; i++) {
    var cmd = list[i];
    if (!cmd || !cmd.uid) continue;
    if (execute(cmd)) executed.push(cmd.uid);
  }
  if (executed.length > 0) sendAck(executed);
  return executed;
}

function sendAck(uids) {
  if (!uids || uids.length === 0) return;
  api.post('/device-commands/ack', { uids: uids }).catch(function(e) {
    // ACK 失败不重试指令本身：服务端下次 pending 仍会返回，
    // 客户端靠 uid 幂等去重，重复执行无害。
    console.warn('[CommandInbox] ack failed:', e && e.message);
  });
}

// ===== 补拉 =====

function sync() {
  if (!running || inFlight) return;
  inFlight = true;
  var ok = false;
  api.get('/device-commands/pending').then(function(res) {
    var data = (res && res.data && res.data.data) || {};
    var commands = data.commands || [];
    ingest(commands);
    ok = true;
  }).catch(function(e) {
    console.warn('[CommandInbox] pending failed:', e && e.message);
  }).then(function() {
    inFlight = false;
    if (ok) {
      retryDelay = RETRY_MIN_MS;
    } else {
      // 失败退避重试，不影响下一个正常周期
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(function() {
        retryTimer = null;
        sync();
      }, retryDelay);
    }
  });
}

// ===== WS 绑定 =====

function bindWs() {
  if (!wsManager || typeof wsManager.on !== 'function' || boundHandlers) return;

  var onCommand = function(data) {
    if (!data || !data.uid) return;
    ingest([{
      uid: data.uid,
      cmd_type: data.cmd_type,
      payload: data.payload || {},
      created_at: data.created_at
    }]);
  };

  // 连接建立 / 重连成功 → 立刻补拉（这是修复「不及时」的关键一环）
  // 注意：WS 传输走 _wsOpen，X5 内核强制降级的 poll 传输只发 _connectionStateChange，
  // 两条都监听才能覆盖全部设备形态（poll 模式恰恰是历史上漏投最严重的）。
  var onOpen = function() {
    sync();
  };
  var onStateChange = function(s) {
    if (s && s.state === 'connected') sync();
  };

  wsManager.on('device_command', onCommand);
  wsManager.on('_wsOpen', onOpen);
  wsManager.on('_connectionStateChange', onStateChange);
  boundHandlers = { onCommand: onCommand, onOpen: onOpen, onStateChange: onStateChange };
}

function unbindWs() {
  if (!boundHandlers || typeof wsManager.off !== 'function') return;
  try { wsManager.off('device_command', boundHandlers.onCommand); } catch (e) {}
  try { wsManager.off('_wsOpen', boundHandlers.onOpen); } catch (e) {}
  try { wsManager.off('_connectionStateChange', boundHandlers.onStateChange); } catch (e) {}
  boundHandlers = null;
}

var commandInbox = {
  /**
   * 注册某类指令的处理函数
   * @param {string} cmdType 'big_text' | 'big_text_recall' | 'account_status'
   * @param {function} fn (payload, cmd) => void
   */
  registerHandler: function(cmdType, fn) {
    handlers[cmdType] = fn;
  },

  /** 启动信箱：绑定 WS、立刻补拉一次、开启定时兜底 */
  start: function() {
    if (started) return;
    started = true;
    running = true;
    loadSeen();
    bindWs();
    sync();
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(sync, SYNC_INTERVAL_MS);
  },

  stop: function() {
    running = false;
    started = false;
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    unbindWs();
  },

  /** 手动触发一次补拉（例如从后台切回前台） */
  syncNow: sync,

  /** 供调试：查看已处理 uid 数量 */
  seenCount: function() { return seen.length; },

  /** 供测试：清空本地去重集合 */
  _reset: function() {
    seen = [];
    try { localStorage.removeItem(SEEN_KEY); } catch (e) {}
  },

  /** 内部方法暴露，便于单测 */
  _ingest: ingest,
  _execute: execute,
  _isSeen: isSeen
};

export default commandInbox;
