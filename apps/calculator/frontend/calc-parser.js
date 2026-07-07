// 高中科学计算器表达式解析器（递归下降）
// 支持：
//   - 四则运算 + - * / %（含隐式乘法，如 2π、2(3+4)）
//   - 幂运算 ^（右结合，如 2^3^2 = 2^9 = 512）
//   - 阶乘 !（后缀，如 5! = 120）
//   - 括号、逗号分隔的多参数函数
//   - 三角函数 sin/cos/tan/asin/acos/atan/sinh/cosh/tanh（DEG/RAD 自动切换）
//   - 对数 ln（自然）/ log（常用 lg）/ log2 / log_n(b,x)（任意底）
//   - 指数 exp / sqrt / cbrt / abs / floor / ceil / round / sign
//   - 排列 P(n,m) / 组合 C(n,m) / gcd / lcm / mod
//   - 常数 π（pi）/ e / φ（phi，黄金分割比）
//   - 用户变量 ans（上次结果）/ x y z

// ====== 辅助数学函数 ======
function factorial(n) {
  if (n < 0 || Math.floor(n) !== n) throw new Error('阶乘要求非负整数');
  if (n > 170) return Infinity;  // 防止溢出
  var r = 1;
  for (var i = 2; i <= n; i++) r *= i;
  return r;
}

function permutation(n, m) {
  if (n < 0 || m < 0 || Math.floor(n) !== n || Math.floor(m) !== m) {
    throw new Error('排列要求非负整数');
  }
  if (m > n) return 0;
  var r = 1;
  for (var i = n - m + 1; i <= n; i++) r *= i;
  return r;
}

function combination(n, m) {
  if (n < 0 || m < 0 || Math.floor(n) !== n || Math.floor(m) !== m) {
    throw new Error('组合要求非负整数');
  }
  if (m > n) return 0;
  m = Math.min(m, n - m);
  var r = 1;
  for (var i = 1; i <= m; i++) {
    r = r * (n - m + i) / i;
  }
  return Math.round(r);
}

function gcdFunc(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) { var t = b; b = a % b; a = t; }
  return a;
}

function lcmFunc(a, b) {
  if (a === 0 || b === 0) return 0;
  return Math.abs(Math.round(a) * Math.round(b)) / gcdFunc(a, b);
}

// 分数约分（返回 [分子, 分母] 或 null）
function reduceFraction(num, den) {
  if (Math.floor(num) !== num || Math.floor(den) !== den) return null;
  var g = gcdFunc(num, den);
  return [num / g, den / g];
}

// ====== 词法分析 ======
function tokenize(expr) {
  var tokens = [];
  var i = 0;
  var s = expr;
  while (i < s.length) {
    var ch = s[i];
    if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
    // 数字（含小数、科学计数法如 1.5e-3）
    if (ch >= '0' && ch <= '9' || ch === '.') {
      var num = '';
      var hasDot = false;
      while (i < s.length && (s[i] >= '0' && s[i] <= '9' || s[i] === '.')) {
        if (s[i] === '.') {
          if (hasDot) throw new Error('数字包含多个小数点');
          hasDot = true;
        }
        num += s[i++];
      }
      // 科学计数法：1.5e-3 / 2E5（仅当 e 后跟 +/-/数字时才视为指数）
      if (i < s.length && (s[i] === 'e' || s[i] === 'E')) {
        var nextCh = s[i + 1];
        if (nextCh !== undefined && (nextCh === '+' || nextCh === '-' || (nextCh >= '0' && nextCh <= '9'))) {
          num += s[i++];  // 'e' 或 'E'
          if (s[i] === '+' || s[i] === '-') num += s[i++];
          while (i < s.length && s[i] >= '0' && s[i] <= '9') num += s[i++];
        }
      }
      var val = parseFloat(num);
      if (isNaN(val)) throw new Error('无效数字: ' + num);
      tokens.push({ type: 'num', value: val });
      continue;
    }
    // 标识符：函数名、常量名（含希腊字母 π φ）
    if (/[a-zA-Zπφ]/.test(ch)) {
      var name = '';
      while (i < s.length && /[a-zA-Zπφ]/.test(s[i])) name += s[i++];
      tokens.push({ type: 'name', value: name });
      continue;
    }
    // 多字符操作符
    // 单字符操作符
    if ('+-*/^()!%,'.indexOf(ch) !== -1) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    // Unicode 数学符号
    if (ch === '×' || ch === '·') { tokens.push({ type: 'op', value: '*' }); i++; continue; }
    if (ch === '÷') { tokens.push({ type: 'op', value: '/' }); i++; continue; }
    if (ch === '−') { tokens.push({ type: 'op', value: '-' }); i++; continue; }  // U+2212
    if (ch === '√') { tokens.push({ type: 'name', value: 'sqrt' }); i++; continue; }
    if (ch === '∛') { tokens.push({ type: 'name', value: 'cbrt' }); i++; continue; }
    throw new Error('未知字符: ' + ch);
  }
  return tokens;
}

// 插入隐式乘法：在相邻 token 间自动补 *
// 规则：
//   前是 num/)/!  后是 (  → 插入 *
//   前是 num/)    后是 name → 插入 *（如 2π、2sin(...)）
//   前是 !        后是 name → 插入 *（如 3!sin(...)）
//   前是 )        后是 num  → 插入 *（如 (2)3 = 6）
//   前是 num      后是 num  → 不插入（让 parser 报错，避免 12 34 这种被解析为 12*34）
function insertImplicitMul(tokens) {
  var result = [];
  for (var i = 0; i < tokens.length; i++) {
    result.push(tokens[i]);
    if (i + 1 < tokens.length) {
      var cur = tokens[i];
      var next = tokens[i + 1];
      var curEndsExpr = (cur.type === 'num') ||
        (cur.type === 'op' && (cur.value === ')' || cur.value === '!'));
      var nextStartsExpr = (next.type === 'op' && next.value === '(') || next.type === 'name';
      var nextIsNum = next.type === 'num';
      // 不处理 num→num（应报错）
      if (curEndsExpr && nextStartsExpr && !(cur.type === 'num' && nextIsNum)) {
        result.push({ type: 'op', value: '*' });
      } else if (curEndsExpr && nextIsNum && cur.type === 'op' && cur.value === ')') {
        // (2)3 = 2*3
        result.push({ type: 'op', value: '*' });
      }
    }
  }
  return result;
}

// ====== 解析器 ======
function CalculatorParser(options) {
  this.tokens = [];
  this.pos = 0;
  this.mode = (options && options.mode) || 'RAD';  // 'RAD' 或 'DEG'
  this.variables = (options && options.variables) || {};
  this.angleConvert = (options && options.angleConvert) || null;  // 角度单位转换辅助
}

CalculatorParser.prototype = {
  constructor: CalculatorParser,

  peek: function() { return this.tokens[this.pos]; },
  next: function() { return this.tokens[this.pos++]; },
  eof: function() { return this.pos >= this.tokens.length; },

  parse: function(expr) {
    this.tokens = insertImplicitMul(tokenize(expr));
    this.pos = 0;
    var result = this.parseExpr();
    if (!this.eof()) {
      var t = this.peek();
      throw new Error('语法错误：意外的 "' + (t.value !== undefined ? t.value : t.type) + '"');
    }
    return result;
  },

  // 表达式：term (('+' | '-') term)*
  parseExpr: function() {
    var left = this.parseTerm();
    while (!this.eof()) {
      var t = this.peek();
      if (t.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.next();
        var right = this.parseTerm();
        left = (t.value === '+') ? left + right : left - right;
      } else break;
    }
    return left;
  },

  // term: factor (('*' | '/' | '%') factor)*
  //   注：隐式乘法已由 insertImplicitMul 转为显式 *
  parseTerm: function() {
    var left = this.parseFactor();
    while (!this.eof()) {
      var t = this.peek();
      if (t.type === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        this.next();
        var right = this.parseFactor();
        if (t.value === '*') left = left * right;
        else if (t.value === '/') {
          if (right === 0) throw new Error('除零错误');
          left = left / right;
        } else {
          left = left % right;
        }
      } else break;
    }
    return left;
  },

  // factor: unary ('^' factor)?  幂运算右结合
  parseFactor: function() {
    var base = this.parseUnary();
    if (!this.eof() && this.peek().type === 'op' && this.peek().value === '^') {
      this.next();
      var exp = this.parseFactor();  // 右结合：2^3^2 = 2^(3^2)
      return Math.pow(base, exp);
    }
    return base;
  },

  // unary: ('-' | '+') unary | postfix
  parseUnary: function() {
    if (!this.eof() && this.peek().type === 'op' && (this.peek().value === '-' || this.peek().value === '+')) {
      var op = this.next().value;
      var val = this.parseUnary();
      return (op === '-') ? -val : +val;
    }
    return this.parsePostfix();
  },

  // postfix: primary ('!')*
  parsePostfix: function() {
    var val = this.parsePrimary();
    while (!this.eof() && this.peek().type === 'op' && this.peek().value === '!') {
      this.next();
      val = factorial(val);
    }
    return val;
  },

  // primary: num | name | name '(' args ')' | '(' expr ')'
  parsePrimary: function() {
    var t = this.peek();
    if (!t) throw new Error('表达式不完整');
    if (t.type === 'num') {
      this.next();
      return t.value;
    }
    if (t.type === 'op' && t.value === '(') {
      this.next();
      var val = this.parseExpr();
      if (this.eof() || this.peek().value !== ')') throw new Error('缺少右括号 ")"');
      this.next();
      return val;
    }
    if (t.type === 'name') {
      this.next();
      // 函数调用
      if (!this.eof() && this.peek().type === 'op' && this.peek().value === '(') {
        this.next();
        var args = [];
        if (!this.eof() && !(this.peek().type === 'op' && this.peek().value === ')')) {
          args.push(this.parseExpr());
          while (!this.eof() && this.peek().type === 'op' && this.peek().value === ',') {
            this.next();
            args.push(this.parseExpr());
          }
        }
        if (this.eof() || this.peek().value !== ')') throw new Error('函数缺少右括号');
        this.next();
        return this.callFunction(t.value, args);
      }
      // 常量 / 变量
      return this.getConstant(t.value);
    }
    throw new Error('意外的 token: "' + (t.value !== undefined ? t.value : t.type) + '"');
  },

  callFunction: function(name, args) {
    var isDeg = this.mode === 'DEG';
    var toRad = function(d) { return d * Math.PI / 180; };
    var fromRad = function(r) { return r * 180 / Math.PI; };

    // 三角函数（DEG/RAD 自动切换）
    var trig = {
      'sin': function(x) { return Math.sin(isDeg ? toRad(x) : x); },
      'cos': function(x) { return Math.cos(isDeg ? toRad(x) : x); },
      'tan': function(x) { return Math.tan(isDeg ? toRad(x) : x); },
      'asin': function(x) { var r = Math.asin(x); return isDeg ? fromRad(r) : r; },
      'acos': function(x) { var r = Math.acos(x); return isDeg ? fromRad(r) : r; },
      'atan': function(x) { var r = Math.atan(x); return isDeg ? fromRad(r) : r; },
      'arcsin': function(x) { var r = Math.asin(x); return isDeg ? fromRad(r) : r; },
      'arccos': function(x) { var r = Math.acos(x); return isDeg ? fromRad(r) : r; },
      'arctan': function(x) { var r = Math.atan(x); return isDeg ? fromRad(r) : r; },
      'sinh': function(x) { return Math.sinh(x); },
      'cosh': function(x) { return Math.cosh(x); },
      'tanh': function(x) { return Math.tanh(x); },
      'asinh': function(x) { return Math.asinh(x); },
      'acosh': function(x) { return Math.acosh(x); },
      'atanh': function(x) { return Math.atanh(x); },
      'arsinh': function(x) { return Math.asinh(x); },
      'arcosh': function(x) { return Math.acosh(x); },
      'artanh': function(x) { return Math.atanh(x); }
    };

    // 单参数函数
    var oneArg = {
      'sqrt': Math.sqrt,
      'cbrt': Math.cbrt,
      'abs': Math.abs,
      'ln': Math.log,
      'log': function(x) { return Math.log(x) / Math.LN10; },  // log = lg = log10
      'lg': function(x) { return Math.log(x) / Math.LN10; },
      'log10': function(x) { return Math.log(x) / Math.LN10; },
      'log2': function(x) { return Math.log(x) / Math.LN2; },
      'exp': Math.exp,
      'floor': Math.floor,
      'ceil': Math.ceil,
      'round': Math.round,
      'sign': Math.sign,
      'inv': function(x) {  // 倒数 1/x
        if (x === 0) throw new Error('除零错误');
        return 1 / x;
      }
    };

    // 双参数函数
    var twoArg = {
      'pow': Math.pow,
      'log_': function(b, x) {  // log_b(x)，任意底
        if (b <= 0 || b === 1) throw new Error('对数底数无效');
        return Math.log(x) / Math.log(b);
      },
      'C': combination,
      'nCr': combination,
      'comb': combination,
      'P': permutation,
      'nPr': permutation,
      'perm': permutation,
      'mod': function(a, b) {
        if (b === 0) throw new Error('模数不能为 0');
        return a % b;
      },
      'gcd': gcdFunc,
      'lcm': lcmFunc,
      'root': function(n, x) {  // n 次方根
        if (n === 0) throw new Error('根指数不能为 0');
        if (x < 0 && n % 2 === 0) throw new Error('负数无偶次实根');
        return x < 0 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n);
      }
    };

    if (trig[name] && args.length === 1) return trig[name](args[0]);
    if (oneArg[name] && args.length === 1) return oneArg[name](args[0]);
    if (twoArg[name] && args.length === 2) return twoArg[name](args[0], args[1]);

    // 三角函数传错参数个数
    if (trig[name]) throw new Error(name + '() 需要 1 个参数');
    if (oneArg[name]) throw new Error(name + '() 需要 1 个参数');
    if (twoArg[name]) throw new Error(name + '() 需要 2 个参数');

    throw new Error('未知函数: ' + name);
  },

  getConstant: function(name) {
    var constants = {
      'pi': Math.PI,
      'PI': Math.PI,
      'π': Math.PI,
      'e': Math.E,
      'E': Math.E,
      'phi': (1 + Math.sqrt(5)) / 2,
      'PHI': (1 + Math.sqrt(5)) / 2,
      'φ': (1 + Math.sqrt(5)) / 2
    };
    if (constants[name] !== undefined) return constants[name];
    // 用户变量（如 ans / x / y）
    if (this.variables && this.variables[name] !== undefined) return this.variables[name];
    throw new Error('未知常量或变量: ' + name);
  }
};

// 对外接口：求值
function evaluate(expr, options) {
  var parser = new CalculatorParser(options || {});
  return parser.parse(expr);
}

// 格式化数字结果（去除浮点误差，限制位数）
function formatResult(num) {
  if (!isFinite(num)) {
    if (num > 0) return '∞';
    if (num < 0) return '-∞';
    return 'NaN';
  }
  if (isNaN(num)) return '错误';
  // 整数直接返回
  if (Number.isInteger(num)) {
    // 大整数转科学计数法（避免精度丢失）
    if (Math.abs(num) >= 1e15) return num.toExponential(10);
    return String(num);
  }
  // 处理浮点误差：如 0.1+0.2=0.30000000000000004
  var str = num.toString();
  // 如果是科学计数法
  if (str.indexOf('e') !== -1 || str.indexOf('E') !== -1) {
    return num.toPrecision(12).replace(/\.?0+$/, '');
  }
  // 限制小数位数 12 位，去除末尾 0
  var fixed = num.toFixed(12);
  // 去除末尾 0
  fixed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  // 如果小数位数过多，转科学计数法
  if (fixed.indexOf('.') !== -1 && fixed.split('.')[1].length > 12) {
    return num.toExponential(10).replace(/\.?0+e/, 'e');
  }
  return fixed;
}

export {
  evaluate,
  formatResult,
  tokenize,
  insertImplicitMul,
  CalculatorParser,
  factorial,
  permutation,
  combination,
  gcdFunc as gcd,
  lcmFunc as lcm,
  reduceFraction
};
