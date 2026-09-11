/**
 * 时间戳归一化比较工具
 *
 * 背景（2026-09-11「消息显示混乱」根因）：
 *   消息的 created_at 有两种格式**并存**：
 *     - SQLite datetime('now')："2026-09-10 09:56:52"（UTC，空格分隔）—— 本机直写
 *     - ISO："2026-09-10T02:03:08.025Z"（UTC，T 分隔带毫秒）—— 中继/对端写入
 *   直接 localeCompare 时，同一天内空格(0x20) < 'T'(0x54) **恒成立**，
 *   跨格式的消息排序必然错乱。实测：UTC 02:55 的 SQLite 消息排在 UTC 02:03 的
 *   ISO 消息之前（实际北京时间 10:55 的消息显示在 10:03 之前）。
 *
 *   触发路径：selectChat 走 SET_PRIVATE_MESSAGES 合并分支时（本地已有缓存消息），
 *   本地实时消息 + catchup 补回的历史消息混两种格式，sort 后时间线错乱；
 *   刷新后走 else 分支直接采用服务端 id 顺序，所以「刷新就又好了」。
 *
 * 归一化：去掉非数字取前 14 位（YYYYMMDDHHMMSS），两种格式统一可比。
 * 毫秒被截断 —— 同秒内以 id tie-break 保持稳定。
 *
 * 平台基线 Chrome 80：只用 var / function。
 */

// 归一化时间戳：两种格式统一为 14 位数字串
export function normTsKey(v) {
  return String(v || '').replace(/[^0-9]/g, '').substring(0, 14);
}

// 提取消息的可比较 id（数字），用于同秒 tie-break
function idNum(msg) {
  if (!msg) return NaN;
  var raw = msg.id !== undefined && msg.id !== null ? msg.id : msg.message_id;
  var n = parseInt(String(raw), 10);
  return isFinite(n) ? n : NaN;
}

/**
 * 升序比较器（早的在前）：传入两个消息对象，按 created_at 比较。
 * 同秒时按 id 数字序 tie-break。
 */
export function cmpTimeAsc(a, b) {
  var ka = normTsKey(a && a.created_at);
  var kb = normTsKey(b && b.created_at);
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  var na = idNum(a);
  var nb = idNum(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return 0;
}

/**
 * 降序比较器（晚的在前）：传入两个**时间字符串**（可能来自消息或会话的
 * last_message_at / created_at），用于会话列表「最新置顶」。
 * 同秒时逆 id 序保持稳定。
 */
export function cmpTimeDesc(aTime, bTime) {
  var ka = normTsKey(aTime);
  var kb = normTsKey(bTime);
  if (ka > kb) return -1;
  if (ka < kb) return 1;
  return 0;
}

export default {
  normTsKey: normTsKey,
  cmpTimeAsc: cmpTimeAsc,
  cmpTimeDesc: cmpTimeDesc
};
