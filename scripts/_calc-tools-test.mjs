// calc-tools.js 纯函数直测：node scripts/_calc-tools-test.mjs
import { evaluate } from '../apps/calculator/frontend/calc-parser.js';

var tools = await import(new URL('../apps/calculator/frontend/calc-tools.js', import.meta.url).href);

var passed = 0;
var failed = 0;

function assert(name, actual, expected) {
  var ok;
  if (typeof expected === 'number' && typeof actual === 'number') {
    ok = Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
  } else {
    ok = actual === expected;
  }
  if (ok) { passed++; }
  else {
    failed++;
    console.error('FAIL ' + name + ': actual=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
  }
}

function assertNear(name, actual, expected, tol) {
  var ok = Math.abs(actual - expected) <= tol;
  if (ok) { passed++; }
  else {
    failed++;
    console.error('FAIL ' + name + ': actual=' + actual + ' expected=' + expected + ' (tol=' + tol + ')');
  }
}

// ===== groupThousands =====
assert('groupThousands 整数', tools.groupThousands('1234567'), '1,234,567');
assert('groupThousands 小数', tools.groupThousands('1234567.891'), '1,234,567.891');
assert('groupThousands 负数', tools.groupThousands('-9876543.21'), '-9,876,543.21');
assert('groupThousands 千以内', tools.groupThousands('999'), '999');
assert('groupThousands 科学计数法跳过', tools.groupThousands('1.5e10'), '1.5e10');
assert('groupThousands ∞', tools.groupThousands('∞'), '∞');
assert('groupThousands 纯小数', tools.groupThousands('0.123'), '0.123');

// ===== solveQuadratic =====
var q1 = tools.solveQuadratic(1, -3, 2);
assert('quadratic real2 type', q1.type, 'real2');
assert('quadratic root1', q1.root1, 2);
assert('quadratic root2', q1.root2, 1);
assert('quadratic delta', q1.delta, 1);
assert('quadratic sum', q1.sum, 3);
assert('quadratic product', q1.product, 2);
assert('quadratic vertex.x', q1.vertex.x, 1.5);
assert('quadratic vertex.y', q1.vertex.y, -0.25);
assert('quadratic opensUp', q1.opensUp, true);

var q2 = tools.solveQuadratic(1, 2, 1);
assert('quadratic 重根 type', q2.type, 'real1');
assert('quadratic 重根 root', q2.root, -1);

var q3 = tools.solveQuadratic(1, 0, 1);
assert('quadratic 虚根 type', q3.type, 'complex');
assert('quadratic 虚根 re', q3.re, 0);
assert('quadratic 虚根 im', q3.im, 1);

var q4 = tools.solveQuadratic(0, 2, -4);
assert('quadratic 降级一次 type', q4.type, 'linear');
assert('quadratic 降级一次 root', q4.root, 2);

assert('quadratic 恒等', tools.solveQuadratic(0, 0, 0).type, 'identity');
assert('quadratic 无解', tools.solveQuadratic(0, 0, 5).type, 'none');
var q5 = tools.solveQuadratic('1/2', '1', '0');
assert('quadratic 表达式系数 type', q5.type, 'real2');
assert('quadratic 表达式系数 delta', q5.delta, 1);
assert('quadratic 表达式系数 root1', q5.root1, 0);
assert('quadratic 表达式系数 root2', q5.root2, -2);
assert('quadratic 无效输入', tools.solveQuadratic('abc', 1, 2).type, 'invalid');

// ===== solveEquationFree =====
var e1 = tools.solveEquationFree('x^3-2x-5=0');
assert('free 无错误', e1.error, '');
// 塑料数 x³-2x-5 的实根 ≈ 2.0945514815423265
var hasPlastic = e1.roots.some(function(r) { return Math.abs(r - 2.0945514815) < 1e-6; });
assert('free 三次方程塑料数根', hasPlastic, true);

var e2 = tools.solveEquationFree('x^2-2x+1=0');
assert('free 二重根', e2.roots.length >= 1 && Math.abs(e2.roots[0] - 1) < 1e-6, true);

var e3 = tools.solveEquationFree('2x+3=7');
assert('free 一次方程', e3.roots.length, 1);
assertNear('free 一次方程值', e3.roots[0], 2, 1e-9);

var e4 = tools.solveEquationFree('(x-1)(x-2)(x-3)(x-4)(x-5)=0');
assert('free 五个根', e4.roots.length, 5);
assertNear('free 根 x=3', e4.roots[2], 3, 1e-6);

var e5 = tools.solveEquationFree('x^2+1=0');
assert('free 无实根', e5.roots.length, 0);
assert('free 无实根无错误', e5.error, '');

var e6 = tools.solveEquationFree('sin(x)=0.5');
var hasPi6 = e6.roots.some(function(r) { return Math.abs(r - Math.PI / 6) < 1e-5; });
assert('free 三角方程含 π/6', hasPi6, true);

var e7 = tools.solveEquationFree('x^2=4');
assert('free x²=4 两根', e7.roots.length, 2);
assertNear('free x²=4 根-2', e7.roots[0], -2, 1e-6);
assertNear('free x²=4 根2', e7.roots[1], 2, 1e-6);

assert('free 缺等号', tools.solveEquationFree('x+1').error.indexOf('等号') !== -1, true);
assert('free 双等号', tools.solveEquationFree('1=2=3').error.indexOf('等号') !== -1, true);
assert('free 语法错误', tools.solveEquationFree('x++=1').error !== '', true);
// 全角等号
var e8 = tools.solveEquationFree('x×2＝8');
assert('free 全角等号', e8.roots.length, 1);
assertNear('free 全角等号值', e8.roots[0], 4, 1e-9);

// ===== parseNumberList / computeStats =====
var list1 = tools.parseNumberList('1, 2，3;4 5\n6');
assert('numberList 混合分隔', list1.values.length, 6);
assert('numberList 无无效', list1.invalid.length, 0);
var list2 = tools.parseNumberList('1 abc 2.5');
assert('numberList 无效收集', list2.invalid.join(','), 'abc');

var stats1 = tools.computeStats([2, 4, 4, 4, 5, 5, 7, 9]);
assert('stats n', stats1.n, 8);
assert('stats sum', stats1.sum, 40);
assert('stats mean', stats1.mean, 5);
assert('stats median', stats1.median, 4.5);
assert('stats 方差总体', stats1.varianceP, 4);
assert('stats 标准差总体', stats1.stdP, 2);
assertNear('stats 方差样本', stats1.varianceS, 32 / 7, 1e-9);
assert('stats max', stats1.max, 9);
assert('stats min', stats1.min, 2);
assert('stats range', stats1.range, 7);
assert('stats 众数', JSON.stringify(stats1.modes), JSON.stringify([4]));

var stats2 = tools.computeStats([1, 2, 3]);
assert('stats 无众数', stats2.modes.length, 0);
assert('stats 单值样本方差 null', tools.computeStats([5]).varianceS, null);
var stats3 = tools.computeStats([3, 1, 2]);
assert('stats 中位数奇数', stats3.median, 2);

// ===== 进制 =====
assert('parseBase hex ff', tools.parseBaseString('ff', 16).value, 255);
assert('parseBase hex FF', tools.parseBaseString('FF', 16).value, 255);
assert('parseBase 负二进制小数', tools.parseBaseString('-10.1', 2).value, -2.5);
assert('parseBase octal', tools.parseBaseString('777', 8).value, 511);
assert('parseBase 36进制', tools.parseBaseString('z', 36).value, 35);
assert('parseBase 非法数字', tools.parseBaseString('2', 2).error !== '', true);
assert('parseBase 双小数点', tools.parseBaseString('1.0.0', 10).error !== '', true);
assert('parseBase 空', tools.parseBaseString('', 10).error !== '', true);

assert('toBase 255 hex', tools.toBaseString(255, 16), 'ff');
assert('toBase 0.5 bin', tools.toBaseString(0.5, 2), '0.1');
assert('toBase -2.5 bin', tools.toBaseString(-2.5, 2), '-10.1');
assert('toBase 511 oct', tools.toBaseString(511, 8), '777');
assert('toBase 35 base36', tools.toBaseString(35, 36), 'z');
assert('toBase 0', tools.toBaseString(0, 2), '0');
// 0.1 → 12 位截断 + 去尾零
var bin01 = tools.toBaseString(0.1, 2);
assert('toBase 0.1 位数上限', bin01.length <= '0.'.length + 12, true);
assertNear('toBase 0.1 roundtrip', tools.parseBaseString(bin01, 2).value, 0.1, 1e-3);

assert('groupBinary 整数分组', tools.groupBinary('10110101'), '1011 0101');
assert('groupBinary 小数分组', tools.groupBinary('10110101.110011'), '1011 0101.1100 11');
assert('groupBinary 负数', tools.groupBinary('-11111'), '-1 1111');

// ===== 日期 =====
var dd1 = tools.dateDiff('2026-01-01', '2026-03-01');
assert('dateDiff days', dd1.days, 59);
assert('dateDiff weeks', dd1.weeks, 8);
assert('dateDiff remain', dd1.remainDays, 3);
assert('dateDiff 负向', tools.dateDiff('2026-03-01', '2026-01-01').days, -59);
assert('dateDiff 非法', tools.dateDiff('bad', '2026-01-01'), null);

assert('shiftDate 月末钳制平年', tools.shiftDate('2026-01-31', 1, 'month'), '2026-02-28');
assert('shiftDate 月末钳制闰年', tools.shiftDate('2024-01-31', 1, 'month'), '2024-02-29');
assert('shiftDate 跨年', tools.shiftDate('2026-12-31', 1, 'day'), '2027-01-01');
assert('shiftDate 周推算', tools.shiftDate('2026-10-31', 1, 'week'), '2026-11-07');
assert('shiftDate 负数', tools.shiftDate('2026-10-31', -7, 'day'), '2026-10-24');
assert('shiftDate 月末缩小后加大月', tools.shiftDate('2026-02-28', 1, 'month'), '2026-03-28');

assert('weekdayName', tools.weekdayName('2026-10-31'), '周六');
assert('weekdayName 非法', tools.weekdayName('x'), '');

console.log('');
console.log('passed=' + passed + ' failed=' + failed);
if (failed > 0) process.exit(1);
