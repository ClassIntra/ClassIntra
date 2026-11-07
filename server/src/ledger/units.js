// 学元账本 · 计量单位换算（唯一真相源）
// ============================================================
// 账本里所有 *_cent / amount_cent / balance 都是**整数账本单位**，没有浮点。
// 全平台只允许存在下面这一条换算链，任何业务代码不得再写 /100、*1000 等魔法数字：
//
//   1 学元          = UNITS_PER_XUEYUAN (100) 账本单位   ← 前端显示保留两位小数
//   1 人民币元      = XUEYUAN_PER_YUAN (1000) 学元        ← 汇率冻结，永不改写
//   ⇒ 1 人民币元    = 100000 账本单位
//
// ---- 2026-11-07 归位说明 ----
// 之前这里写死 UNITS_PER_YUAN = 1000，理由是「1 元 = 1000 学元」。
// 但 1000 是**汇率**（学元/元），不是账本单位/元：账本单位比学元还小 100 倍。
// 于是同一个库里出现两套口径：
//   · 钱包 / 充值 / 红包 / 限额：1 元 = 1000 学元 × 100 = 100000 单位（真实落库值）
//   · /api/xy 的 amount_yuan、orders 的 ¥ 展示、cashbook 的 ¥ 报表：1 元 = 1000 单位
// 后者把每一笔真实金额都小算 100 倍，而且**不报错**：/api/xy 充值 1 元只到账
// 0.01 元、订单面值显示 100 元其实是 1 元、单笔充值上限被悄悄收紧 100 倍。
//
// 归位方式：把 UNITS_PER_YUAN 改成由上面两个常量推导（100000）。
// **不重估任何余额、不改任何前端显示数字、不动冻结汇率**，只是让换算函数
// 与库里真实存在的数字对齐。scaleAudit() 是防止它再漂移回去的绊线。
//
// 编码约定：var / function（服务端 CommonJS 风格）

var UNITS_PER_XUEYUAN = 100;      // 1 学元 = 100 账本单位
var XUEYUAN_PER_YUAN = 1000;      // 冻结汇率：1 元 = 1000 学元
var UNITS_PER_YUAN = UNITS_PER_XUEYUAN * XUEYUAN_PER_YUAN;   // 100000

function yuanToUnits(yuan) {
  var n = Number(yuan);
  if (!isFinite(n)) return NaN;
  return Math.round(n * UNITS_PER_YUAN);
}

function unitsToYuan(units) {
  var n = Number(units);
  if (!isFinite(n)) return 0;
  return n / UNITS_PER_YUAN;
}

// 账本单位 ⇄ 学元（前端展示）
function xueyuanToUnits(xueyuan) {
  if (xueyuan === null || xueyuan === undefined || xueyuan === '') return null;
  var n = typeof xueyuan === 'number' ? xueyuan : Number(String(xueyuan).trim());
  if (!isFinite(n)) return null;
  var u = Math.round(n * UNITS_PER_XUEYUAN);
  return isFinite(u) ? u : null;
}

function unitsToXueyuan(units) {
  var n = Number(units);
  if (!isFinite(n)) return 0;
  return Math.round(n) / UNITS_PER_XUEYUAN;
}

// 人民币元 → 账本单位（rate 可传，默认用冻结汇率）
function yuanToWalletUnits(yuan, rate) {
  var r = Number(rate) > 0 ? Number(rate) : XUEYUAN_PER_YUAN;
  var n = Number(yuan);
  if (!isFinite(n)) return null;
  return Math.round(n * r * UNITS_PER_XUEYUAN);
}

function walletUnitsToYuan(units, rate) {
  var r = Number(rate) > 0 ? Number(rate) : XUEYUAN_PER_YUAN;
  var n = Number(units);
  if (!isFinite(n)) return 0;
  return Math.round(n / UNITS_PER_XUEYUAN / r * 100) / 100;
}

// 口径一致性绊线：任何一侧被单独改回去，测试立刻红。
function scaleAudit() {
  var derived = XUEYUAN_PER_YUAN * UNITS_PER_XUEYUAN;
  return {
    ledgerUnitsPerYuan: UNITS_PER_YUAN,
    walletUnitsPerYuan: derived,
    split: derived / UNITS_PER_YUAN,
    unified: derived === UNITS_PER_YUAN,
    xueyuanPerYuan: XUEYUAN_PER_YUAN,
    unitsPerXueyuan: UNITS_PER_XUEYUAN
  };
}

module.exports = {
  UNITS_PER_YUAN: UNITS_PER_YUAN,
  UNITS_PER_XUEYUAN: UNITS_PER_XUEYUAN,
  XUEYUAN_PER_YUAN: XUEYUAN_PER_YUAN,
  yuanToUnits: yuanToUnits,
  unitsToYuan: unitsToYuan,
  xueyuanToUnits: xueyuanToUnits,
  unitsToXueyuan: unitsToXueyuan,
  yuanToWalletUnits: yuanToWalletUnits,
  walletUnitsToYuan: walletUnitsToYuan,
  scaleAudit: scaleAudit
};
