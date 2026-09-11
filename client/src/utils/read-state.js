/**
 * 已读状态工具（本地已读）
 *
 * 背景：
 *   系统里的「通知」实际有多个来源，各自为政，导致「看过了还提示」：
 *     - announcements（公告/作业）  → /assets/announcements
 *     - broadcasts（快讯广播）      → /assets/broadcasts
 *     - chat（聊天未读）            → store/modules/chat.js 的 state.unread
 *   此前只有 announcements 有本已读记录，且只在桌面浮窗的「已读」按钮里写，
 *   公告中心（Announcements.vue）看完不写任何记录 —— 这就是「明明看了还提示」的根因。
 *
 * 方案（用户选定的「本地已读」）：
 *   用 localStorage 记录已读的 ID 列表，纯前端、离线可用、不涉及后端改表。
 *   代价：换设备或清缓存后会重新显示，这是本地已读的固有边界，可接受。
 *
 * 设计约束：
 *   - 平台基线 Chrome 80：只用 var / function，禁用 const/let/箭头函数/模板字符串/?. / ??
 *   - 存储可能不可用（隐私模式 / 配额满），所有读写都必须 try/catch 兜底，
 *     失败时退化为「本次会话内存已读」，不能让异常冒泡到业务代码。
 *   - ID 统一转成 String 比较：id 可能来自 sqlite 的 INTEGER，也可能是带前缀的字符串
 *
 * 命名约定（沿用项目既有风格 classintra_*）：
 *   classintra_read_announcements  公告已读（历史遗留键名，保持兼容）
 *   classintra_read_broadcasts     快讯已读（本次新增）
 */

// 存储键名 -> 内存回退缓存
var STORAGE_KEYS = {
  announcement: 'classintra_read_announcements',
  broadcast: 'classintra_read_broadcasts'
};

// 内存回退：localStorage 不可用时，至少保证当前会话内已读生效
var memoryFallback = {};

// 上限保护：已读记录无限增长会撑爆 localStorage（5MB 配额），
// 保留最近 500 条足够覆盖任何合理的未读回溯范围。
var MAX_READ_IDS = 500;

function keyOf(scope) {
  return STORAGE_KEYS[scope] || STORAGE_KEYS.announcement;
}

/**
 * 读取某个 scope 下的全部已读 ID（字符串数组）。
 * 永不打抛：解析失败一律返回空数组。
 */
export function getReadIds(scope) {
  var key = keyOf(scope);
  try {
    var stored = localStorage.getItem(key);
    if (!stored) return memoryFallback[key] ? memoryFallback[key].slice() : [];
    var parsed = JSON.parse(stored);
    if (!parsed || !parsed.length) return [];
    return parsed;
  } catch (e) {
    // storage 不可用或数据损坏 -> 用内存回退，并顺手清掉损坏数据
    try { localStorage.removeItem(key); } catch (e2) {}
    return memoryFallback[key] ? memoryFallback[key].slice() : [];
  }
}

function persist(scope, ids) {
  var key = keyOf(scope);
  var trimmed = ids.length > MAX_READ_IDS ? ids.slice(ids.length - MAX_READ_IDS) : ids;
  memoryFallback[key] = trimmed.slice();
  try {
    localStorage.setItem(key, JSON.stringify(trimmed));
    return true;
  } catch (e) {
    // 写入失败（隐私模式/配额满）：内存回退已生效，本次会话内仍正确
    return false;
  }
}

/**
 * 判断单个 ID 是否已读。
 */
export function isRead(scope, id) {
  if (id === undefined || id === null) return false;
  var ids = getReadIds(scope);
  var target = String(id);
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i]) === target) return true;
  }
  return false;
}

/**
 * 标记一个 ID 为已读。已存在则不再重复追加（幂等）。
 * 返回是否发生了新写入。
 */
export function markRead(scope, id) {
  if (id === undefined || id === null) return false;
  var ids = getReadIds(scope);
  var target = String(id);
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i]) === target) return false;
  }
  ids.push(target);
  persist(scope, ids);
  return true;
}

/**
 * 批量标记已读（一次写入，避免 N 次 localStorage 往返）。
 * 返回本次新增的条数。
 */
export function markManyRead(scope, idList) {
  if (!idList || !idList.length) return 0;
  var ids = getReadIds(scope);
  var seen = {};
  for (var i = 0; i < ids.length; i++) seen[String(ids[i])] = true;
  var added = 0;
  for (var j = 0; j < idList.length; j++) {
    var target = String(idList[j]);
    if (target === 'undefined' || target === 'null') continue;
    if (seen[target]) continue;
    seen[target] = true;
    ids.push(target);
    added++;
  }
  if (added > 0) persist(scope, ids);
  return added;
}

/**
 * 从列表中筛出未读项。
 * itemId 取不到时视为未读（宁可多提示，不可漏提示）。
 */
export function filterUnread(scope, list, itemIdField) {
  if (!list || !list.length) return [];
  var field = itemIdField || 'id';
  var ids = getReadIds(scope);
  var seen = {};
  for (var i = 0; i < ids.length; i++) seen[String(ids[i])] = true;
  var result = [];
  for (var j = 0; j < list.length; j++) {
    var item = list[j];
    var id = item ? item[field] : null;
    if (id === undefined || id === null) {
      result.push(item);
      continue;
    }
    if (!seen[String(id)]) result.push(item);
  }
  return result;
}

/**
 * 统计未读数。
 */
export function countUnread(scope, list, itemIdField) {
  return filterUnread(scope, list, itemIdField).length;
}

/**
 * 清空某个 scope 的已读记录（用于调试或「恢复未读」场景）。
 */
export function clearRead(scope) {
  var key = keyOf(scope);
  memoryFallback[key] = [];
  try { localStorage.removeItem(key); } catch (e) {}
}

export default {
  getReadIds: getReadIds,
  isRead: isRead,
  markRead: markRead,
  markManyRead: markManyRead,
  filterUnread: filterUnread,
  countUnread: countUnread,
  clearRead: clearRead
};
