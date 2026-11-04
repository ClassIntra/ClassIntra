// 计算器工具箱纯函数库
// 被 ToolsTab.vue / ConvertTab.vue / CalcTab.vue 复用；配套直测脚本 scripts/_calc-tools-test.mjs
// 涉及表达式求值的部分复用同目录 calc-parser.js（解方程 / 换算表达式输入）

import { evaluate, formatResult } from './calc-parser.js';

// ===== 通用显示工具 =====

// 千分位分组（仅显示层，不参与计算）
// 规则：科学计数法 / ∞ / NaN / 已含分隔符原样返回；整数部分按 3 位加逗号
function groupThousands(str) {
  var s = String(str);
  if (s === '' || s === '∞' || s === '-∞' || s === 'NaN' || s === '错误') return s;
  if (s.indexOf('e') !== -1 || s.indexOf('E') !== -1) return s;
  var neg = s.charAt(0) === '-';
  if (neg) s = s.substring(1);
  var parts = s.split('.');
  if (!/^\d+$/.test(parts[0])) return neg ? '-' + s : s;
  var grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  var out = parts.length > 1 ? grouped + '.' + parts[1] : grouped;
  return neg ? '-' + out : out;
}

// ===== 解方程 =====

// 一元二次 ax²+bx+c=0（a≈0 时降级为一元一次）
// 返回:
//   { type: 'linear', root }                    一元一次，root 为解
//   { type: 'real1', root, delta }              二重实根
//   { type: 'real2', root1, root2, delta }      两个不等实根（root1 > root2）
//   { type: 'complex', re, im, delta }          共轭虚根 re ± im·i
//   { type: 'identity' | 'none' }               0=0 恒成立 / 无解（a=b=0 时）
// 附带: vertex { x, y }, sum, product（韦达定理）, opensUp
function solveQuadratic(a, b, c) {
  a = toNum(a); b = toNum(b); c = toNum(c);
  if (isNaN(a) || isNaN(b) || isNaN(c)) return { type: 'invalid' };
  var EPS = 1e-12;
  // a≈0：一元一次 bx + c = 0
  if (Math.abs(a) < EPS) {
    if (Math.abs(b) < EPS) {
      return (Math.abs(c) < EPS) ? { type: 'identity' } : { type: 'none' };
    }
    return { type: 'linear', root: -c / b };
  }
  var delta = b * b - 4 * a * c;
  var result = {
    delta: delta,
    opensUp: a > 0,
    sum: -b / a,           // 韦达定理 x1+x2
    product: c / a,        // 韦达定理 x1·x2
    vertex: { x: -b / (2 * a), y: c - (b * b) / (4 * a) }
  };
  if (delta > EPS) {
    var sq = Math.sqrt(delta);
    var r1 = (-b + sq) / (2 * a);
    var r2 = (-b - sq) / (2 * a);
    result.type = 'real2';
    result.root1 = Math.max(r1, r2);
    result.root2 = Math.min(r1, r2);
  } else if (delta >= -EPS) {
    result.type = 'real1';
    result.delta = Math.max(delta, 0);
    result.root = -b / (2 * a);
  } else {
    result.type = 'complex';
    result.re = -b / (2 * a);
    result.im = Math.sqrt(-delta) / (2 * a);
  }
  return result;
}

function toNum(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v === null || v === undefined) return 0;
  // 系数允许表达式输入（如 1/3）
  try { return evaluate(String(v), { mode: 'RAD', variables: {} }); } catch (e) { return NaN; }
}

// 自由方程数值求根：'x^3-2x-5=0' / 'sin(x)=0.5'
// 左右两侧分别以 x 求值，f(x)=L-R，多尺度扫描变号区间 + 二分，另捕捉切于 x 轴的偶数重根
// options: { mode: 'RAD'|'DEG', maxRoots: 8 }
// 返回 { roots: [...], error: '' } 或 { roots: [], error: '原因' }
function solveEquationFree(input, options) {
  var opts = options || {};
  var mode = opts.mode || 'RAD';
  var maxRoots = opts.maxRoots || 8;
  var text = String(input || '').replace(/＝/g, '=').replace(/\s+/g, '');
  if (!text) return { roots: [], error: '请输入方程' };
  var eqIdx = text.indexOf('=');
  if (eqIdx === -1) return { roots: [], error: '缺少等号「=」' };
  if (text.indexOf('=', eqIdx + 1) !== -1) return { roots: [], error: '只能有一个等号' };
  var lhs = text.substring(0, eqIdx);
  var rhs = text.substring(eqIdx + 1);
  if (!lhs || !rhs) return { roots: [], error: '等号两侧都需要表达式' };

  function f(x) {
    return evaluate(lhs, { mode: mode, variables: { x: x } }) -
           evaluate(rhs, { mode: mode, variables: { x: x } });
  }
  // 语法预检
  try { f(1); } catch (e) { return { roots: [], error: '表达式错误：' + e.message }; }

  var roots = [];
  var scales = [100, 1e4, 1e6];
  for (var s = 0; s < scales.length && roots.length < maxRoots; s++) {
    scanRange(f, -scales[s], scales[s], 4000, roots);
  }
  roots = dedupeRoots(roots);
  // 周期方程可能扫出海量根：优先保留离原点最近的，再按大小排列展示
  roots.sort(function(a, b) { return Math.abs(a) - Math.abs(b); });
  if (roots.length > maxRoots) roots = roots.slice(0, maxRoots);
  roots.sort(function(a, b) { return a - b; });
  return { roots: roots, error: '' };
}

// 在 [lo, hi] 等距扫描：变号 → 二分；近零极小（|f|<1e-9 且两侧同号）→ 也要（偶数重根）
function scanRange(f, lo, hi, steps, out) {
  var prevX = lo;
  var prevY;
  try { prevY = f(lo); } catch (e) { prevY = NaN; }
  for (var i = 1; i <= steps; i++) {
    var x = lo + (hi - lo) * i / steps;
    var y;
    try { y = f(x); } catch (e) { y = NaN; }
    if (isFinite(prevY) && isFinite(y)) {
      if (prevY === 0) pushRoot(out, prevX);
      else if (prevY * y < 0) {
        var r = bisect(f, prevX, x);
        if (r !== null) pushRoot(out, r);
      } else if (Math.abs(y) < 1e-9) {
        // 疑似偶数重根（如 (x-1)²）：极小值切 x 轴
        pushRoot(out, x);
      }
    }
    prevX = x; prevY = y;
  }
}

function bisect(f, lo, hi) {
  var fLo, fHi;
  try { fLo = f(lo); fHi = f(hi); } catch (e) { return null; }
  if (!isFinite(fLo) || !isFinite(fHi) || fLo * fHi > 0) return null;
  // 极小值情形：端点同号但 |f| 极小，直接取中点附近
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  for (var i = 0; i < 100; i++) {
    var mid = (lo + hi) / 2;
    var fMid;
    try { fMid = f(mid); } catch (e) { return null; }
    if (!isFinite(fMid)) return null;
    if (fMid === 0) return mid;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; }
    else { lo = mid; fLo = fMid; }
    if (hi - lo < 1e-13 * Math.max(1, Math.abs(lo))) break;
  }
  return (lo + hi) / 2;
}

function pushRoot(out, r) {
  if (isFinite(r)) out.push(r);
}

function dedupeRoots(roots) {
  var result = [];
  for (var i = 0; i < roots.length; i++) {
    var dup = false;
    for (var j = 0; j < result.length; j++) {
      if (Math.abs(result[j] - roots[i]) <= 1e-6 * Math.max(1, Math.abs(roots[i]))) { dup = true; break; }
    }
    if (!dup) result.push(roots[i]);
  }
  return result;
}

// ===== 统计计算 =====

// 解析数据列表：按空格/中英文逗号/分号/换行分隔，返回 { values, invalid }
function parseNumberList(text) {
  var tokens = String(text || '').split(/[\s,，;；]+/);
  var values = [];
  var invalid = [];
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (!t) continue;
    var n = Number(t);
    if (isFinite(n)) values.push(n);
    else invalid.push(t);
  }
  return { values: values, invalid: invalid };
}

// 统计量（总体/样本双口径）
// 返回 { n, sum, sumSq, mean, median, modes, max, min, range,
//        varianceP, stdP, varianceS, stdS }（varianceS/stdS 在 n<2 时为 null）
function computeStats(values) {
  var n = values.length;
  if (n === 0) return null;
  var sum = 0;
  var sumSq = 0;
  var max = values[0];
  var min = values[0];
  for (var i = 0; i < n; i++) {
    var v = values[i];
    sum += v;
    sumSq += v * v;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  var mean = sum / n;
  var varianceP = (sumSq - n * mean * mean) / n;
  if (varianceP < 0 && varianceP > -1e-10) varianceP = 0;  // 浮点误差兜底
  var sorted = values.slice().sort(function(a, b) { return a - b; });
  var median = (n % 2 === 1) ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  // 众数：出现次数最多且 > 1 次；全并列时视为无众数
  var counts = {};
  var maxCount = 0;
  for (var j = 0; j < n; j++) {
    var key = String(values[j]);
    counts[key] = (counts[key] || 0) + 1;
    if (counts[key] > maxCount) maxCount = counts[key];
  }
  var modes = [];
  for (var k in counts) {
    if (counts[k] === maxCount && maxCount > 1) modes.push(Number(k));
  }
  if (modes.length === n) modes = [];  // 每个值都一样多 → 无众数
  modes.sort(function(a, b) { return a - b; });
  var result = {
    n: n,
    sum: sum,
    sumSq: sumSq,
    mean: mean,
    median: median,
    modes: modes,
    max: max,
    min: min,
    range: max - min,
    varianceP: varianceP,
    stdP: Math.sqrt(varianceP)
  };
  if (n >= 2) {
    // 样本方差：Σ(x-mean)²/(n-1)
    var ss = 0;
    for (var m = 0; m < n; m++) ss += (values[m] - mean) * (values[m] - mean);
    var varianceS = ss / (n - 1);
    result.varianceS = varianceS;
    result.stdS = Math.sqrt(varianceS);
  } else {
    result.varianceS = null;
    result.stdS = null;
  }
  return result;
}

// ===== 进制转换 =====

// 解析 radix 进制字符串（含小数/负数）→ 十进制数
// 返回 { value, error: '' } 或 { value: NaN, error: '原因' }
// radix: 2-36
function parseBaseString(str, radix) {
  var s = String(str || '').trim().toLowerCase();
  if (!s) return { value: NaN, error: '请输入数值' };
  if (radix < 2 || radix > 36) return { value: NaN, error: '进制无效' };
  var neg = false;
  if (s.charAt(0) === '+' || s.charAt(0) === '-') {
    neg = (s.charAt(0) === '-');
    s = s.substring(1);
  }
  if (!s) return { value: NaN, error: '请输入数值' };
  var parts = s.split('.');
  if (parts.length > 2) return { value: NaN, error: '小数点过多' };
  var intPart = parts[0];
  var fracPart = parts.length === 2 ? parts[1] : '';
  // 逐字符校验
  var digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  var i, ch, d;
  for (i = 0; i < intPart.length; i++) {
    ch = intPart.charAt(i);
    d = digits.indexOf(ch);
    if (d === -1 || d >= radix) return { value: NaN, error: '「' + ch + '」不是 ' + radix + ' 进制数字' };
  }
  for (i = 0; i < fracPart.length; i++) {
    ch = fracPart.charAt(i);
    d = digits.indexOf(ch);
    if (d === -1 || d >= radix) return { value: NaN, error: '「' + ch + '」不是 ' + radix + ' 进制数字' };
  }
  if (!intPart.length && !fracPart.length) return { value: NaN, error: '请输入数值' };
  // 整数部分：避免超大数精度问题，逐位累加（仍在 double 精度内）
  var intVal = 0;
  for (i = 0; i < intPart.length; i++) {
    intVal = intVal * radix + digits.indexOf(intPart.charAt(i));
  }
  // 小数部分：逐位累加
  var fracVal = 0;
  var scale = 1 / radix;
  for (i = 0; i < fracPart.length; i++) {
    fracVal += digits.indexOf(fracPart.charAt(i)) * scale;
    scale /= radix;
  }
  var value = intVal + fracVal;
  return { value: neg ? -value : value, error: '' };
}

// 十进制数 → radix 进制字符串（含小数/负数）
// fracDigits: 小数最多位数（默认 12），超出截断并去除尾零
function toBaseString(value, radix, fracDigits) {
  if (!isFinite(value)) return '';
  if (radix < 2 || radix > 36) return '';
  var maxFrac = (fracDigits === undefined) ? 12 : fracDigits;
  var neg = value < 0;
  var v = Math.abs(value);
  var intPart = Math.floor(v);
  var frac = v - intPart;
  var digits = '0123456789abcdefghijklmnopqrstuvwxyz';
  // 整数部分
  var intStr = (intPart === 0) ? '0' : intPart.toString(radix);
  // 小数部分：逐位乘 radix
  var fracStr = '';
  var guard = 0;
  while (frac > 0 && fracStr.length < maxFrac && guard < 100) {
    frac *= radix;
    var d = Math.floor(frac);
    fracStr += digits.charAt(d);
    frac -= d;
    guard++;
  }
  fracStr = fracStr.replace(/0+$/, '');
  var out = fracStr ? intStr + '.' + fracStr : intStr;
  return neg ? '-' + out : out;
}

// 二进制按 4 位分组显示（小数部分从左起每 4 位分组）
function groupBinary(str) {
  var s = String(str || '');
  if (!s) return s;
  var neg = s.charAt(0) === '-';
  if (neg) s = s.substring(1);
  var parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{4})+(?!\d))/g, ' ');
  if (parts.length === 2) {
    parts[1] = parts[1].replace(/(.{4})(?=.)/g, '$1 ');
  }
  var out = parts.join('.');
  return neg ? '-' + out : out;
}

// ===== 日期计算 =====

// 'YYYY-MM-DD' → 本地时区 Date（避免 toISOString 时区坑）
function parseDateStr(s) {
  var parts = String(s || '').split('-');
  if (parts.length !== 3) return null;
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  var date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

// Date → 'YYYY-MM-DD'
function toDateStr(date) {
  var y = date.getFullYear();
  var m = date.getMonth() + 1;
  var d = date.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
}

var WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 两日期差：{ days, weeks, remainDays }（d2 - d1，负数表示 d2 在前）
function dateDiff(d1, d2) {
  var a = parseDateStr(d1);
  var b = parseDateStr(d2);
  if (!a || !b) return null;
  var days = Math.round((b - a) / 86400000);
  var weeks = Math.trunc(days / 7);
  return { days: days, weeks: weeks, remainDays: days - weeks * 7 };
}

// 日期推算：dateStr ± n 个 unit（'day'|'week'|'month'）
// 月末钳制：1月31日 + 1月 = 2月28/29日
function shiftDate(dateStr, n, unit) {
  var date = parseDateStr(dateStr);
  if (!date) return null;
  n = parseInt(n, 10) || 0;
  var result;
  if (unit === 'month') {
    var day = date.getDate();
    result = new Date(date.getFullYear(), date.getMonth() + n, 1);
    var daysInTarget = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, daysInTarget));
  } else if (unit === 'week') {
    result = new Date(date.getFullYear(), date.getMonth(), date.getDate() + n * 7);
  } else {
    result = new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }
  return toDateStr(result);
}

// 星期几名称
function weekdayName(dateStr) {
  var date = parseDateStr(dateStr);
  if (!date) return '';
  return WEEKDAY_NAMES[date.getDay()];
}

// 格式化结果复用 parser 的 formatResult（外部直测也用到）
export {
  groupThousands,
  solveQuadratic,
  solveEquationFree,
  parseNumberList,
  computeStats,
  parseBaseString,
  toBaseString,
  groupBinary,
  parseDateStr,
  toDateStr,
  dateDiff,
  shiftDate,
  weekdayName,
  formatResult
};
