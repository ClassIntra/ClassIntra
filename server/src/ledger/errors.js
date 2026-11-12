// 学元账本 · 结构化错误
// ============================================================
// 为什么要有这一层：原先 routes/ledger.js 用一条 60+ 中文词的正则去猜
// 「这是业务拒绝还是系统故障」，每加一种拒绝都要改正则，且真正未预期的
// 异常只要 message 里恰好带个「不能」就会被当成 400 静默吞掉。
//
// 现在：写入内核抛出来的每个拒绝都自带稳定 code，HTTP 层只做映射。
// ⚠️ message 一律保留原中文文案 —— 15 个测试脚本用中文正则断言错误信息，
//    改文案等于让整套回归失效。code 是新增维度，不替换文案。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var CODES = {
  // ---- 请求形状 ----
  MISSING_REF:              { status: 400, label: '缺少幂等键' },
  MISSING_KIND:             { status: 400, label: '缺少业务类型' },
  UNKNOWN_KIND:             { status: 400, label: '未知业务类型' },
  TOO_FEW_ENTRIES:          { status: 400, label: '分录不足' },
  UNKNOWN_ASSET:            { status: 400, label: '未知资产' },
  BAD_DIRECTION:            { status: 400, label: '分录方向非法' },
  BAD_AMOUNT:               { status: 400, label: '分录金额非法' },
  UNBALANCED:               { status: 400, label: '分录不守恒' },
  TX_TOO_LARGE:             { status: 400, label: '单笔超限' },
  // ---- 幂等 / 并发 ----
  IDEMPOTENCY_CONFLICT:     { status: 409, label: '幂等键冲突' },
  VERSION_CONFLICT:         { status: 409, label: '余额版本冲突' },
  // ---- 账户 / 余额 ----
  ACCOUNT_MISSING:          { status: 400, label: '账户不存在' },
  ACCOUNT_INACTIVE:         { status: 400, label: '账户不可用' },
  INSUFFICIENT_BALANCE:     { status: 400, label: '余额不足' },
  UNKNOWN_ACCOUNT_KIND:     { status: 400, label: '未知账户类型' },
  // ---- 制度护栏 ----
  SUPPLY_CAP_EXCEEDED:      { status: 400, label: '供给上限' },
  EXTERNAL_COST_FORBIDDEN:  { status: 400, label: '外部成本门禁' },
  REDEEMABLE_ISSUE:         { status: 400, label: '可兑付资产禁发' },
  // ---- 兼容 ----
  BUSINESS_RULE:            { status: 400, label: '业务规则拒绝' },
  UNCLASSIFIED:             { status: 500, label: '未分类错误' },
  UNEXPECTED:               { status: 500, label: '系统异常' }
};

function LedgerError(code, message, detail) {
  this.name = 'LedgerError';
  this.code = CODES[code] ? code : 'UNEXPECTED';
  this.httpStatus = statusOf(this.code);
  this.message = String(message == null ? CODES[this.code].label : message);
  this.detail = detail || null;
  this.isLedgerError = true;
  this.stack = (new Error(this.message)).stack;
}
LedgerError.prototype = Object.create(Error.prototype);
LedgerError.prototype.constructor = LedgerError;

function statusOf(code) {
  var c = CODES[code];
  return c ? c.status : 500;
}

function of(code, message, detail) {
  return new LedgerError(code, message, detail);
}

function isKnown(e) {
  return !!(e && e.isLedgerError === true && CODES[e.code]);
}

// 把普通 Error 翻译成 LedgerError。
// 系统级异常（TypeError / SQLITE_* / 建表缺失）必须保持 500，不能被当成业务拒绝。
function normalize(e) {
  if (isKnown(e)) return e;
  var msg = e && e.message ? String(e.message) : '未知错误';
  var name = e && e.name ? String(e.name) : '';
  var looksSystem = /^(TypeError|ReferenceError|RangeError|SyntaxError|SqliteError)$/.test(name) ||
    /SQLITE_|no such table|no such column|database is locked|UNIQUE constraint|Cannot read/.test(msg);
  return new LedgerError(looksSystem ? 'UNEXPECTED' : 'BUSINESS_RULE', msg);
}

module.exports = {
  CODES: CODES,
  LedgerError: LedgerError,
  of: of,
  statusOf: statusOf,
  isKnown: isKnown,
  normalize: normalize
};
