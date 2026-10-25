/**
 * device-commands.js — 设备指令信箱（Device Command Outbox）
 *
 * 解决的核心问题：控制类指令（封禁/解封、大字广播、强制下线）此前只做内存实时推送，
 * 目标设备一旦在推送瞬间不在线（WS 重连窗口 / 平板息屏 / X5 内核 poll 模式未注册
 * poller），指令就被 sendToClient() 静默丢弃且永不补发 —— 表现为「有些设备收到不及时」。
 *
 * 模型：at-least-once + 端上幂等
 *   1. 指令先落库（device_commands），再尽力实时推送；
 *   2. 客户端上线 / WS 重连 / 每次长轮询时调用 pending 接口补拉所有未投递指令；
 *   3. 客户端执行完回 ACK，服务端标记 delivered_at；
 *   4. 指令带全局唯一 cmd_uid，端上据此去重，重复投递无害。
 *
 * 为什么不用自增 id 做游标：8i / 18i 是两套独立 DB，各自 AUTOINCREMENT 序列会撞号，
 * id 不可跨服务器比较。故以 cmd_uid（<serverId>-<ms>-<rand>）作为全局身份。
 */

var db = require('../utils/db');
var config = require('../config');

var SERVER_ID = config.relay.serverId || process.env.RELAY_SERVER_ID || 'local';

// 指令默认有效期：超过这个时间还没投递到设备就不再补投。
// 目的：设备睡一觉醒来不会被一堆过期大字轰炸，也不会收到早已解封的封禁令。
var DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
// 单次补拉上限，防止恶意/异常情况下单次响应过大
var FETCH_LIMIT = 50;

function nowISO() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function makeUid() {
  return SERVER_ID + '-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
}

function safeParse(str, fallback) {
  try {
    var v = JSON.parse(str || '');
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

// ===== 写入 =====

/**
 * 批量入队（只落库，不推送）
 * @param {string[]} targetUserIds
 * @param {string} cmdType
 * @param {object} payload
 * @param {object} opts { createdBy, ttlMs, uid, expiresAt }
 * @returns {Array<{uid:string,target_user_id:string}>}
 */
function enqueue(targetUserIds, cmdType, payload, opts) {
  opts = opts || {};
  var ids = Array.isArray(targetUserIds) ? targetUserIds : [targetUserIds];
  var uid = opts.uid || makeUid();
  var ttl = typeof opts.ttlMs === 'number' ? opts.ttlMs : DEFAULT_TTL_MS;
  var expiresAt = opts.expiresAt || new Date(Date.now() + ttl).toISOString().replace('T', ' ').substring(0, 19);
  var payloadStr = JSON.stringify(payload || {});
  var createdAt = nowISO();
  var createdBy = opts.createdBy || '';

  var stmt = db.prepare(
    'INSERT OR IGNORE INTO device_commands ' +
    '(cmd_uid, target_user_id, cmd_type, payload, created_at, expires_at, delivered_at, created_by, server_id) ' +
    'VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)'
  );

  var out = [];
  var tx = db.transaction(function() {
    for (var i = 0; i < ids.length; i++) {
      var target = String(ids[i] || '').trim();
      if (!target) continue;
      // 同一 uid 对同一目标只插一次（跨服务器 relay 回来的同源指令靠 OR IGNORE 去重）
      stmt.run(uid, target, cmdType, payloadStr, createdAt, expiresAt, createdBy, SERVER_ID);
      out.push({ uid: uid, target_user_id: target });
    }
  });
  try {
    tx();
  } catch (e) {
    console.error('[DeviceCmd] enqueue failed:', e.message);
    return [];
  }
  return out;
}

/**
 * 入队 + 尽力实时推送 + 中继到对端服务器
 * @returns {Array<{uid, target_user_id, live:boolean}>}
 */
function dispatch(targetUserIds, cmdType, payload, opts) {
  opts = opts || {};
  var uid = opts.uid || makeUid();
  opts.uid = uid;

  var rows = enqueue(targetUserIds, cmdType, payload, opts);
  if (rows.length === 0) return [];

  var message = {
    type: 'device_command',
    uid: uid,
    cmd_type: cmdType,
    payload: payload || {},
    created_at: nowISO()
  };

  // 实时推送（有 WS 发 WS，有长轮询队列就入队；都没有就靠后续补拉，不会丢）
  var chatServer = null;
  try { chatServer = require('../ws/chat-server'); } catch (e) {}
  for (var i = 0; i < rows.length; i++) {
    var live = false;
    if (chatServer && typeof chatServer.sendToClient === 'function') {
      try { live = !!chatServer.sendToClient(rows[i].target_user_id, message); } catch (e) {}
    }
    rows[i].live = live;
  }

  // 中继到对端服务器：让对端也能在自己的库里落一份，
  // 这样漫游到对端的用户连上后也能补拉到（对端会用同一个 uid，端上幂等去重）。
  try {
    var relayBus = require('../utils/relay-bus');
    relayBus.relayOnly('device_command', {
      uid: uid,
      cmd_type: cmdType,
      payload: payload || {},
      targets: rows.map(function(r) { return r.target_user_id; }),
      expires_at: opts.expiresAt || null,
      created_by: opts.createdBy || ''
    });
  } catch (e) {
    // relay 不可用（单机部署）时静默跳过，本地库已落盘即可保证必达
  }

  return rows;
}

// ===== 读取与确认 =====

/**
 * 拉取某用户所有「未投递且未过期」的指令
 */
function fetchPending(userId, limit) {
  if (!userId) return [];
  var cap = typeof limit === 'number' && limit > 0 ? Math.min(limit, FETCH_LIMIT) : FETCH_LIMIT;
  var rows = db.prepare(
    'SELECT id, cmd_uid, cmd_type, payload, created_at, expires_at, created_by ' +
    'FROM device_commands ' +
    'WHERE target_user_id = ? AND delivered_at IS NULL ' +
    "AND (expires_at IS NULL OR expires_at > datetime('now')) " +
    'ORDER BY id ASC LIMIT ?'
  ).all(String(userId), cap);

  return rows.map(function(r) {
    return {
      uid: r.cmd_uid,
      cmd_type: r.cmd_type,
      payload: safeParse(r.payload, {}),
      created_at: r.created_at,
      expires_at: r.expires_at,
      created_by: r.created_by
    };
  });
}

/**
 * 客户端确认已执行。返回实际标记的行数。
 * uid 为全局唯一，跨服务器同源指令共享。
 */
function ack(userId, uids) {
  if (!userId || !Array.isArray(uids) || uids.length === 0) return 0;
  var valid = [];
  for (var i = 0; i < uids.length; i++) {
    var u = String(uids[i] || '').trim();
    // 只允许本服务器生成的 uid 形态，避免被拿来乱标记
    if (u && u.length <= 80 && valid.indexOf(u) === -1) valid.push(u);
  }
  if (valid.length === 0) return 0;

  var stmt = db.prepare(
    "UPDATE device_commands SET delivered_at = datetime('now') " +
    'WHERE target_user_id = ? AND cmd_uid = ? AND delivered_at IS NULL'
  );
  var n = 0;
  var tx = db.transaction(function() {
    for (var i = 0; i < valid.length; i++) {
      n += stmt.run(String(userId), valid[i]).changes;
    }
  });
  try {
    tx();
  } catch (e) {
    console.error('[DeviceCmd] ack failed:', e.message);
    return 0;
  }
  return n;
}

/**
 * 注销「尚未投递」的指定指令（按 cmd_type + payload 字段精确匹配）。
 *
 * 典型场景：大字发送后立刻撤回。已弹出的设备由 big_text_recall 指令收起，
 * 但还没投递的 big_text 指令必须在这里掐掉 —— 否则离线设备上线后会
 * 「先弹出来、再被 recall 收起」，学生看到一次闪烁的误扰。
 * 封禁场景同理：封了又秒解，补拉时不该再执行那条作废的封禁。
 *
 * 实现注意：
 *   - 匹配在 JS 里 parse payload 后精确比对，**不用 SQL LIKE**：
 *     '"id":1' 是 '"id":12' 的子串，LIKE 会误杀隔壁广播。
 *   - 只动 delivered_at IS NULL 的行；已投递的不碰（由 recall 指令负责收起）。
 *   - 跨服务器场景由调用方额外发 device_command_cancel 中继，对端落同样的注销。
 *
 * @returns {number} 实际注销的行数
 */
function cancelPending(userIds, cmdType, matchField, matchValue) {
  var ids = Array.isArray(userIds) ? userIds : [userIds];
  if (ids.length === 0) return 0;
  var select = db.prepare(
    'SELECT id, payload FROM device_commands ' +
    'WHERE target_user_id = ? AND cmd_type = ? AND delivered_at IS NULL'
  );
  var mark = db.prepare(
    "UPDATE device_commands SET delivered_at = datetime('now') WHERE id = ? AND delivered_at IS NULL"
  );
  var n = 0;
  var tx = db.transaction(function() {
    for (var i = 0; i < ids.length; i++) {
      var target = String(ids[i] || '').trim();
      if (!target) continue;
      var rows = select.all(target, cmdType);
      for (var j = 0; j < rows.length; j++) {
        var p = safeParse(rows[j].payload, null);
        if (!p || String(p[matchField]) !== String(matchValue)) continue;
        n += mark.run(rows[j].id).changes;
      }
    }
  });
  try {
    tx();
  } catch (e) {
    console.error('[DeviceCmd] cancelPending failed:', e.message);
    return 0;
  }
  return n;
}

// ===== 清理 =====

/**
 * 清理已过期或已投递的历史指令，避免表无限增长。
 * - 过期指令：无论是否已投递，过期即无意义
 * - 已投递指令：保留 3 天后清除（留作审计窗口）
 */
function purge() {
  try {
    var expired = db.prepare(
      "DELETE FROM device_commands WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')"
    ).run().changes;
    var done = db.prepare(
      "DELETE FROM device_commands WHERE delivered_at IS NOT NULL AND delivered_at <= datetime('now', '-3 days')"
    ).run().changes;
    if (expired || done) {
      console.log('[DeviceCmd] purge: expired=' + expired + ' delivered=' + done);
    }
    return expired + done;
  } catch (e) {
    console.error('[DeviceCmd] purge failed:', e.message);
    return 0;
  }
}

var purgeTimer = null;
function start() {
  if (purgeTimer) return;
  purge();
  // 每小时清理一次
  purgeTimer = setInterval(purge, 60 * 60 * 1000);
  if (purgeTimer.unref) purgeTimer.unref();
}

function stop() {
  if (purgeTimer) {
    clearInterval(purgeTimer);
    purgeTimer = null;
  }
}

module.exports = {
  SERVER_ID: SERVER_ID,
  enqueue: enqueue,
  dispatch: dispatch,
  cancelPending: cancelPending,
  fetchPending: fetchPending,
  ack: ack,
  purge: purge,
  start: start,
  stop: stop
};
