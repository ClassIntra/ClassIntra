<template>
  <div class="calc-page">
    <AppNavBar title="计算器">
      <button class="nav-action" @click="showConverter = !showConverter" :aria-label="showConverter ? '关闭转换' : '单位转换'" title="单位转换">
        <i class="fa-solid fa-ruler-combined"></i>
      </button>
      <button class="nav-action" @click="showHistory = !showHistory" :aria-label="showHistory ? '隐藏历史' : '显示历史'" title="历史记录">
        <i class="fa-solid fa-clock-rotate-left"></i>
      </button>
    </AppNavBar>

    <div class="calc-container" :class="{ 'history-open': showHistory }">
      <!-- 主计算区 -->
      <div class="calc-main">
        <!-- 显示屏 -->
        <div class="calc-display" :class="{ 'display-error': isError }">
          <div class="display-mode-row">
            <span class="mode-badge" :class="{ active: angleMode === 'DEG' }" @click="toggleAngle">DEG</span>
            <span class="mode-badge" :class="{ active: angleMode === 'RAD' }" @click="toggleAngle">RAD</span>
            <span class="mode-badge" :class="{ active: secondMode }" @click="toggle2nd">2nd</span>
            <span v-if="memory !== 0" class="memory-indicator">M</span>
          </div>
          <div class="display-expr" v-if="displayExpr">{{ displayExpr }}</div>
          <div class="display-result" :class="{ 'result-large': !displayExpr, 'result-small': displayExpr }">
            {{ displayResult || '0' }}
          </div>
        </div>

        <!-- 按钮网格：左侧科学功能 + 右侧数字运算 -->
        <div class="calc-keypad">
          <div class="keypad-section keypad-scientific">
            <button
              v-for="btn in currentScientificKeys"
              :key="'s-' + btn.label + (btn.secondaryLabel || '')"
              class="calc-key"
              :class="['key-' + btn.type, { 'key-wide': btn.wide, 'key-active': btn.active }]"
              @click="onKey(btn)"
              :aria-label="btn.label"
            >
              <span class="key-label">{{ btn.label }}</span>
            </button>
          </div>
          <div class="keypad-section keypad-basic">
            <button
              v-for="btn in currentBasicKeys"
              :key="'b-' + btn.label + (btn.secondaryLabel || '')"
              class="calc-key"
              :class="['key-' + btn.type, { 'key-wide': btn.wide, 'key-active': btn.active }]"
              @click="onKey(btn)"
              :aria-label="btn.label"
            >
              <span class="key-label">{{ btn.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 历史记录抽屉 -->
      <transition name="history-slide">
        <aside v-if="showHistory" class="calc-history">
          <div class="history-header">
            <h3>历史记录</h3>
            <div class="history-actions">
              <button class="history-action" @click="clearHistory" aria-label="清空历史">
                <i class="fa-solid fa-trash"></i>
              </button>
              <button class="history-action" @click="showHistory = false" aria-label="关闭历史">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>
          <div class="history-list scrollbar-thin">
            <div v-if="history.length === 0" class="history-empty">
              <i class="fa-solid fa-calculator"></i>
              <p>暂无历史记录</p>
            </div>
            <div
              v-for="(item, idx) in history"
              :key="idx"
              class="history-item"
              @click="recallHistory(item)"
            >
              <div class="history-expr">{{ item.expr }}</div>
              <div class="history-result">= {{ item.result }}</div>
            </div>
          </div>
        </aside>
      </transition>
    </div>

    <!-- 单位转换面板 -->
    <transition name="converter-fade">
      <div v-if="showConverter" class="converter-mask" @click.self="showConverter = false">
        <div class="converter-panel" @click.stop>
          <div class="converter-header">
            <span class="converter-title">单位转换</span>
            <button class="converter-close" @click="showConverter = false" aria-label="关闭">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="converter-body scrollbar-thin">
            <!-- 类别选择 -->
            <div class="converter-category-row">
              <button
                v-for="cat in unitCategories"
                :key="cat.value"
                class="converter-cat-btn"
                :class="{ active: converter.category === cat.value }"
                @click="switchCategory(cat.value)"
              >{{ cat.label }}</button>
            </div>
            <!-- 输入区 -->
            <div class="converter-field">
              <input v-model="converter.value" type="number" class="converter-input" placeholder="输入数值" @input="calcConvert" />
              <select v-model="converter.fromUnit" class="converter-select" @change="calcConvert">
                <option v-for="u in currentUnits" :key="u.value" :value="u.value">{{ u.label }}</option>
              </select>
            </div>
            <div class="converter-arrow">
              <button class="converter-swap" @click="swapUnits" title="交换单位">
                <i class="fa-solid fa-right-left"></i>
              </button>
            </div>
            <!-- 结果区 -->
            <div class="converter-field">
              <input :value="converterResult" readonly class="converter-input converter-output" />
              <select v-model="converter.toUnit" class="converter-select" @change="calcConvert">
                <option v-for="u in currentUnits" :key="u.value" :value="u.value">{{ u.label }}</option>
              </select>
            </div>
            <!-- 换算关系说明 -->
            <div v-if="convertHint" class="converter-hint">{{ convertHint }}</div>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
import AppNavBar from '@/components/AppNavBar.vue';
import { evaluate, formatResult } from './calc-parser.js';

// 按钮定义：分为科学功能组（5列×5行）和数字运算组（5列×5行）
// type: digit / operator / function / memory / clear / mode
// action: insert / equals / backspace / allClear / clear / toggle2nd / toggleAngle / toggleHistory
//         mc / mr / mplus / mminus / negate / recallHistory
// secondaryLabel: 2nd 模式下显示的替代标签
// secondaryValue: 2nd 模式下插入的替代值
// dynamicLabel: 是否为动态标签（如 DEG/RAD）
var SCIENTIFIC_KEYS = [
  // 行1: 模式与记忆
  { label: '2nd', type: 'mode', action: 'toggle2nd', active: false },
  { label: 'DEG', type: 'mode', action: 'toggleAngle', dynamicLabel: true },
  { label: 'HIST', type: 'mode', action: 'toggleHistory' },
  { label: 'MC', type: 'memory', action: 'mc' },
  { label: 'MR', type: 'memory', action: 'mr' },
  // 行2: 幂与根
  { label: 'x²', type: 'function', action: 'insert', value: '^2', secondaryLabel: 'x³', secondaryValue: '^3' },
  { label: '√', type: 'function', action: 'insert', value: '√(', secondaryLabel: '∛', secondaryValue: '∛(' },
  { label: 'xʸ', type: 'function', action: 'insert', value: '^', secondaryLabel: 'ⁿ√', secondaryValue: 'root(' },
  { label: 'π', type: 'function', action: 'insert', value: 'π', secondaryLabel: 'e', secondaryValue: 'e' },
  { label: 'n!', type: 'function', action: 'insert', value: '!', secondaryLabel: '1/x', secondaryValue: '^(-1)' },
  // 行3: 三角函数（2nd → 反三角 / 双曲）
  { label: 'sin', type: 'function', action: 'insert', value: 'sin(', secondaryLabel: 'sin⁻¹', secondaryValue: 'asin(' },
  { label: 'cos', type: 'function', action: 'insert', value: 'cos(', secondaryLabel: 'cos⁻¹', secondaryValue: 'acos(' },
  { label: 'tan', type: 'function', action: 'insert', value: 'tan(', secondaryLabel: 'tan⁻¹', secondaryValue: 'atan(' },
  { label: 'sinh', type: 'function', action: 'insert', value: 'sinh(', secondaryLabel: 'sinh⁻¹', secondaryValue: 'asinh(' },
  { label: 'cosh', type: 'function', action: 'insert', value: 'cosh(', secondaryLabel: 'cosh⁻¹', secondaryValue: 'acosh(' },
  // 行4: 对数与取整
  { label: 'ln', type: 'function', action: 'insert', value: 'ln(', secondaryLabel: 'eˣ', secondaryValue: 'exp(' },
  { label: 'log', type: 'function', action: 'insert', value: 'log(', secondaryLabel: '10ˣ', secondaryValue: '10^(' },
  { label: 'tanh', type: 'function', action: 'insert', value: 'tanh(', secondaryLabel: 'tanh⁻¹', secondaryValue: 'atanh(' },
  { label: '|x|', type: 'function', action: 'insert', value: 'abs(', secondaryLabel: '⌊x⌋', secondaryValue: 'floor(' },
  { label: 'mod', type: 'function', action: 'insert', value: 'mod(', secondaryLabel: '⌈x⌉', secondaryValue: 'ceil(' },
  // 行5: 括号、排列组合、常数
  { label: '(', type: 'function', action: 'insert', value: '(' },
  { label: ')', type: 'function', action: 'insert', value: ')' },
  { label: 'P', type: 'function', action: 'insert', value: 'P(', secondaryLabel: 'C', secondaryValue: 'C(' },
  { label: 'φ', type: 'function', action: 'insert', value: 'φ', secondaryLabel: 'γ', secondaryValue: '0.5772' },
  { label: ',', type: 'function', action: 'insert', value: ',' }
];

var BASIC_KEYS = [
  // 行1: 清除与基本运算
  { label: 'AC', type: 'clear', action: 'allClear' },
  { label: 'C', type: 'clear', action: 'clear' },
  { label: '⌫', type: 'clear', action: 'backspace' },
  { label: '÷', type: 'operator', action: 'insert', value: '÷' },
  { label: '×', type: 'operator', action: 'insert', value: '×' },
  // 行2: 7 8 9 − M+
  { label: '7', type: 'digit', action: 'insert', value: '7' },
  { label: '8', type: 'digit', action: 'insert', value: '8' },
  { label: '9', type: 'digit', action: 'insert', value: '9' },
  { label: '−', type: 'operator', action: 'insert', value: '−' },
  { label: 'M+', type: 'memory', action: 'mplus' },
  // 行3: 4 5 6 + M−
  { label: '4', type: 'digit', action: 'insert', value: '4' },
  { label: '5', type: 'digit', action: 'insert', value: '5' },
  { label: '6', type: 'digit', action: 'insert', value: '6' },
  { label: '+', type: 'operator', action: 'insert', value: '+' },
  { label: 'M−', type: 'memory', action: 'mminus' },
  // 行4: 1 2 3 % =
  { label: '1', type: 'digit', action: 'insert', value: '1' },
  { label: '2', type: 'digit', action: 'insert', value: '2' },
  { label: '3', type: 'digit', action: 'insert', value: '3' },
  { label: '%', type: 'function', action: 'insert', value: '÷100' },
  { label: '=', type: 'operator', action: 'equals' },
  // 行5: 0 . ± EXP Ans
  { label: '0', type: 'digit', action: 'insert', value: '0' },
  { label: '.', type: 'digit', action: 'insert', value: '.' },
  { label: '±', type: 'function', action: 'negate' },
  { label: 'EXP', type: 'function', action: 'insert', value: '×10^' },
  { label: 'Ans', type: 'function', action: 'insert', value: 'ans' }
];

var HISTORY_KEY = 'classintra_calc_history';
var MAX_HISTORY = 50;

// 单位转换类别定义
// factor 为相对于该类别基准单位的换算系数（值 × factor = 基准单位值）
// 温度为非线性换算，标记 special: true，由 _convertTemp 单独处理
var UNIT_CATEGORIES = [
  {
    value: 'length', label: '长度',
    units: [
      { value: 'km', label: '千米', factor: 1000 },
      { value: 'm', label: '米', factor: 1 },
      { value: 'dm', label: '分米', factor: 0.1 },
      { value: 'cm', label: '厘米', factor: 0.01 },
      { value: 'mm', label: '毫米', factor: 0.001 },
      { value: 'um', label: '微米', factor: 0.000001 },
      { value: 'nm', label: '纳米', factor: 0.000000001 },
      { value: 'mile', label: '英里', factor: 1609.344 },
      { value: 'yd', label: '码', factor: 0.9144 },
      { value: 'ft', label: '英尺', factor: 0.3048 },
      { value: 'in', label: '英寸', factor: 0.0254 },
      { value: 'nmi', label: '海里', factor: 1852 }
    ]
  },
  {
    value: 'weight', label: '重量',
    units: [
      { value: 't', label: '吨', factor: 1000000 },
      { value: 'kg', label: '千克', factor: 1000 },
      { value: 'g', label: '克', factor: 1 },
      { value: 'mg', label: '毫克', factor: 0.001 },
      { value: 'lb', label: '磅', factor: 453.592 },
      { value: 'oz', label: '盎司', factor: 28.3495 },
      { value: 'jin', label: '斤', factor: 500 },
      { value: 'liang', label: '两', factor: 50 }
    ]
  },
  {
    value: 'temperature', label: '温度', special: true,
    units: [
      { value: 'C', label: '摄氏度 °C' },
      { value: 'F', label: '华氏度 °F' },
      { value: 'K', label: '开尔文 K' }
    ]
  },
  {
    value: 'area', label: '面积',
    units: [
      { value: 'km2', label: '平方千米', factor: 1000000 },
      { value: 'hm2', label: '公顷', factor: 10000 },
      { value: 'mu', label: '亩', factor: 666.6667 },
      { value: 'm2', label: '平方米', factor: 1 },
      { value: 'dm2', label: '平方分米', factor: 0.01 },
      { value: 'cm2', label: '平方厘米', factor: 0.0001 },
      { value: 'mm2', label: '平方毫米', factor: 0.000001 },
      { value: 'ft2', label: '平方英尺', factor: 0.092903 },
      { value: 'ac', label: '英亩', factor: 4046.86 }
    ]
  },
  {
    value: 'volume', label: '体积',
    units: [
      { value: 'L', label: '升', factor: 1 },
      { value: 'mL', label: '毫升', factor: 0.001 },
      { value: 'm3', label: '立方米', factor: 1000 },
      { value: 'cm3', label: '立方厘米', factor: 0.001 },
      { value: 'gal_us', label: '加仑(美)', factor: 3.78541 },
      { value: 'gal_uk', label: '加仑(英)', factor: 4.54609 },
      { value: 'pt', label: '品脱', factor: 0.473176 },
      { value: 'qt', label: '夸脱', factor: 0.946353 }
    ]
  },
  {
    value: 'time', label: '时间',
    units: [
      { value: 'y', label: '年', factor: 31536000 },
      { value: 'd', label: '天', factor: 86400 },
      { value: 'h', label: '小时', factor: 3600 },
      { value: 'min', label: '分钟', factor: 60 },
      { value: 's', label: '秒', factor: 1 },
      { value: 'ms', label: '毫秒', factor: 0.001 },
      { value: 'us', label: '微秒', factor: 0.000001 }
    ]
  },
  {
    value: 'speed', label: '速度',
    units: [
      { value: 'mps', label: '米/秒', factor: 1 },
      { value: 'kmh', label: '千米/时', factor: 0.277778 },
      { value: 'mph', label: '英里/时', factor: 0.44704 },
      { value: 'kn', label: '节', factor: 0.514444 },
      { value: 'fts', label: '英尺/秒', factor: 0.3048 },
      { value: 'mach', label: '马赫', factor: 343 }
    ]
  },
  {
    value: 'data', label: '数据',
    units: [
      { value: 'B', label: '字节 B', factor: 1 },
      { value: 'KB', label: '千字节 KB', factor: 1024 },
      { value: 'MB', label: '兆字节 MB', factor: 1048576 },
      { value: 'GB', label: '吉字节 GB', factor: 1073741824 },
      { value: 'TB', label: '太字节 TB', factor: 1099511627776 },
      { value: 'bit', label: '比特 bit', factor: 0.125 },
      { value: 'Kb', label: '千比特 Kb', factor: 128 },
      { value: 'Mb', label: '兆比特 Mb', factor: 131072 }
    ]
  }
];

export default {
  name: 'Calculator',
  components: { AppNavBar: AppNavBar },
  data: function() {
    return {
      expr: '',           // 当前表达式（用户输入）
      result: '0',        // 当前结果（实时预览）
      lastResult: 0,      // 上次计算结果（Ans 用）
      isError: false,     // 是否出错
      angleMode: 'DEG',   // 'DEG' 或 'RAD'
      secondMode: false,  // 2nd 模式
      memory: 0,          // 记忆值
      showHistory: false, // 显示历史抽屉
      history: [],        // 历史记录数组
      scientificKeys: SCIENTIFIC_KEYS,
      basicKeys: BASIC_KEYS,
      unitCategories: UNIT_CATEGORIES,
      justCalculated: false, // 刚算完结果，下次输入数字时清空
      showConverter: false,  // 显示单位转换面板
      converter: {           // 单位转换状态
        category: 'length',
        value: '1',
        fromUnit: 'm',
        toUnit: 'cm'
      }
    };
  },
  computed: {
    // 显示的表达式（空则不显示）
    displayExpr: function() {
      return this.expr;
    },
    // 显示的结果
    displayResult: function() {
      return this.result;
    },
    // 当前科学按钮列表（根据 2nd 模式动态计算 label）
    currentScientificKeys: function() {
      var self = this;
      return this.scientificKeys.map(function(btn) {
        return self._applyDynamic(btn);
      });
    },
    // 当前数字按钮列表（同上）
    currentBasicKeys: function() {
      var self = this;
      return this.basicKeys.map(function(btn) {
        return self._applyDynamic(btn);
      });
    },
    // 当前类别的单位列表
    currentUnits: function() {
      var cats = this.unitCategories;
      for (var i = 0; i < cats.length; i++) {
        if (cats[i].value === this.converter.category) return cats[i].units;
      }
      return [];
    },
    // 单位转换结果（实时计算）
    converterResult: function() {
      return this._doConvert();
    },
    // 换算关系提示
    convertHint: function() {
      var from = this._findUnit(this.converter.fromUnit);
      var to = this._findUnit(this.converter.toUnit);
      if (!from || !to) return '';
      if (this.converter.category === 'temperature') {
        return '温度换算：°F = °C × 9/5 + 32；K = °C + 273.15';
      }
      if (!from.factor || !to.factor) return '';
      var ratio = from.factor / to.factor;
      return '1 ' + from.label + ' = ' + this._formatConvertResult(ratio) + ' ' + to.label;
    }
  },
  watch: {
    expr: function() {
      this.previewResult();
    },
    angleMode: function() {
      this.previewResult();
    }
  },
  mounted: function() {
    var self = this;
    // 加载历史记录
    self.loadHistory();
    // 键盘支持
    self._keyHandler = function(e) { self.onKeyboard(e); };
    window.addEventListener('keydown', self._keyHandler);
  },
  beforeDestroy: function() {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
    }
  },
  methods: {
    // ===== 按钮动态标签计算（2nd 模式 + DEG/RAD 切换 + active 状态） =====
    _applyDynamic: function(btn) {
      var newBtn = Object.assign({}, btn);
      // 2nd 模式切换标签
      if (this.secondMode && btn.secondaryLabel) {
        newBtn.label = btn.secondaryLabel;
      }
      // DEG/RAD 动态标签
      if (btn.dynamicLabel && btn.action === 'toggleAngle') {
        newBtn.label = this.angleMode;
      }
      // 2nd 模式激活样式
      if (btn.action === 'toggle2nd') {
        newBtn.active = this.secondMode;
      }
      // 角度模式激活样式
      if (btn.action === 'toggleAngle') {
        newBtn.active = true;
      }
      return newBtn;
    },
    // ===== 按键处理 =====
    onKey: function(btn) {
      var action = btn.action;
      // 2nd 模式下使用 secondaryValue
      var value = (this.secondMode && btn.secondaryValue !== undefined) ? btn.secondaryValue : btn.value;
      switch (action) {
        case 'insert': this.insert(value); break;
        case 'equals': this.calculate(); break;
        case 'backspace': this.backspace(); break;
        case 'allClear': this.allClear(); break;
        case 'clear': this.clear(); break;
        case 'toggle2nd': this.toggle2nd(); break;
        case 'toggleAngle': this.toggleAngle(); break;
        case 'toggleHistory': this.showHistory = !this.showHistory; break;
        case 'mc': this.memoryClear(); break;
        case 'mr': this.memoryRecall(); break;
        case 'mplus': this.memoryAdd(); break;
        case 'mminus': this.memorySubtract(); break;
        case 'negate': this.negate(); break;
      }
    },
    // ===== 表达式操作 =====
    insert: function(value) {
      // 出错后输入新内容，清空重新开始
      if (this.isError) {
        this.expr = '';
        this.isError = false;
        this.justCalculated = false;
      } else if (this.justCalculated) {
        // 刚算完结果，且输入的是运算符（+ - × ÷ ^ 等），则继续用上次结果
        if (this.isOperatorStart(value)) {
          this.expr = String(this.lastResult);
        } else {
          this.expr = '';
        }
        this.justCalculated = false;
      }
      this.expr += value;
    },
    isOperatorStart: function(value) {
      // 判断输入是否为运算符（用于计算后继续运算）
      return ['+', '−', '-', '×', '*', '÷', '/', '^', '%'].indexOf(value) !== -1;
    },
    backspace: function() {
      if (this.justCalculated || this.isError) {
        this.allClear();
        return;
      }
      // 智能删除：删除整个函数名（如 sin( → 删除 4 个字符）
      var multiCharTokens = [
        'asinh(', 'acosh(', 'atanh(', 'asin(', 'acos(', 'atan(',
        'sinh(', 'cosh(', 'tanh(', 'sin(', 'cos(', 'tan(',
        'ln(', 'log(', 'log2(', 'log10(', 'logn(', 'logb(',
        'sqrt(', 'cbrt(', 'exp(', 'inv(', 'abs(', 'floor(', 'ceil(',
        'mod(', 'P(', 'C(', 'root(', 'pow(', 'gcd(', 'lcm(',
        'max(', 'min(', 'hypot(', 'atan2(', 'randint(',
        'fact(', 'trunc(', 'sign(', 'round(', 'deg(', 'rad(',
        '10^(', '^(-1)', '÷100', '×10^', '(-'
      ];
      var deleted = false;
      for (var i = 0; i < multiCharTokens.length; i++) {
        var token = multiCharTokens[i];
        if (this.expr.endsWith(token)) {
          this.expr = this.expr.slice(0, this.expr.length - token.length);
          deleted = true;
          break;
        }
      }
      if (!deleted) {
        // 删除单个字符（含 √ ∛ π φ × ÷ − 等 Unicode 字符）
        this.expr = this.expr.slice(0, -1);
      }
    },
    clear: function() {
      this.expr = '';
      this.result = '0';
      this.isError = false;
      this.justCalculated = false;
    },
    allClear: function() {
      this.expr = '';
      this.result = '0';
      this.lastResult = 0;
      this.isError = false;
      this.justCalculated = false;
    },
    negate: function() {
      if (this.justCalculated) {
        // 对上次结果取反
        this.lastResult = -this.lastResult;
        this.expr = String(this.lastResult);
        this.result = formatResult(this.lastResult);
        this.justCalculated = false;
        return;
      }
      // 在表达式末尾取反：用 (-...) 包裹
      // 简化：直接插入 -(
      this.insert('(-');
    },
    // ===== 计算 =====
    previewResult: function() {
      if (!this.expr || this.isError) {
        // 刚算完结果时保留结果显示（calculate 会清空 expr 触发本 watcher），
        // 否则结果会被重置为 '0'，造成“按等于后归零”的 bug
        if (!this.justCalculated) {
          this.result = '0';
        }
        return;
      }
      try {
        var val = evaluate(this.expr, {
          mode: this.angleMode,
          variables: { ans: this.lastResult }
        });
        this.result = formatResult(val);
      } catch (e) {
        // 实时预览不显示错误，只在按 = 时显示
        this.result = '...';
      }
    },
    calculate: function() {
      if (!this.expr) return;
      try {
        var val = evaluate(this.expr, {
          mode: this.angleMode,
          variables: { ans: this.lastResult }
        });
        var formatted = formatResult(val);
        // 添加到历史记录
        this.addHistory(this.expr, formatted);
        this.lastResult = val;
        this.result = formatted;
        this.expr = '';
        this.isError = false;
        this.justCalculated = true;
      } catch (e) {
        this.result = '错误';
        this.isError = true;
        this.justCalculated = false;
      }
    },
    // ===== 单位转换 =====
    switchCategory: function(cat) {
      this.converter.category = cat;
      var units = this.currentUnits;
      if (units.length >= 2) {
        this.converter.fromUnit = units[0].value;
        this.converter.toUnit = units[1].value;
      }
    },
    swapUnits: function() {
      var tmp = this.converter.fromUnit;
      this.converter.fromUnit = this.converter.toUnit;
      this.converter.toUnit = tmp;
    },
    calcConvert: function() {
      // v-model 已更新 converter.value，computed 自动重算；此方法仅作事件占位
    },
    _findUnit: function(unitValue) {
      var units = this.currentUnits;
      for (var i = 0; i < units.length; i++) {
        if (units[i].value === unitValue) return units[i];
      }
      return null;
    },
    _doConvert: function() {
      var val = parseFloat(this.converter.value);
      if (isNaN(val)) return '';
      var from = this._findUnit(this.converter.fromUnit);
      var to = this._findUnit(this.converter.toUnit);
      if (!from || !to) return '';
      // 温度非线性换算
      if (this.converter.category === 'temperature') {
        return this._convertTemp(val, from.value, to.value);
      }
      // 通用因子换算：值 × from.factor = 基准值；基准值 / to.factor = 目标值
      var baseVal = val * from.factor;
      var result = baseVal / to.factor;
      return this._formatConvertResult(result);
    },
    _convertTemp: function(val, from, to) {
      // 先统一转摄氏度
      var c;
      if (from === 'C') c = val;
      else if (from === 'F') c = (val - 32) * 5 / 9;
      else if (from === 'K') c = val - 273.15;
      else return '';
      // 再从摄氏度转到目标
      var result;
      if (to === 'C') result = c;
      else if (to === 'F') result = c * 9 / 5 + 32;
      else if (to === 'K') result = c + 273.15;
      else return '';
      return this._formatConvertResult(result);
    },
    _formatConvertResult: function(result) {
      if (!isFinite(result)) return '';
      // 保留 10 位有效数字，去除末尾多余的 0
      var str = parseFloat(result.toPrecision(12)).toString();
      return str;
    },
    // ===== 模式切换 =====
    toggle2nd: function() {
      this.secondMode = !this.secondMode;
    },
    toggleAngle: function() {
      this.angleMode = (this.angleMode === 'DEG') ? 'RAD' : 'DEG';
    },
    // ===== 记忆功能 =====
    memoryClear: function() {
      this.memory = 0;
    },
    memoryRecall: function() {
      this.insert(formatResult(this.memory));
    },
    memoryAdd: function() {
      // 将当前结果加入记忆
      var val = this.getCurrentValue();
      if (val !== null) {
        this.memory += val;
      }
    },
    memorySubtract: function() {
      var val = this.getCurrentValue();
      if (val !== null) {
        this.memory -= val;
      }
    },
    getCurrentValue: function() {
      // 优先使用刚算完的结果
      if (this.justCalculated) return this.lastResult;
      // 否则尝试计算当前表达式
      if (!this.expr) return null;
      try {
        return evaluate(this.expr, {
          mode: this.angleMode,
          variables: { ans: this.lastResult }
        });
      } catch (e) {
        return null;
      }
    },
    // ===== 历史记录 =====
    loadHistory: function() {
      try {
        var stored = localStorage.getItem(HISTORY_KEY);
        if (stored) {
          this.history = JSON.parse(stored) || [];
        }
      } catch (e) {
        this.history = [];
      }
    },
    saveHistory: function() {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
      } catch (e) {}
    },
    addHistory: function(expr, result) {
      this.history.unshift({ expr: expr, result: result, time: Date.now() });
      if (this.history.length > MAX_HISTORY) {
        this.history = this.history.slice(0, MAX_HISTORY);
      }
      this.saveHistory();
    },
    clearHistory: function() {
      this.history = [];
      this.saveHistory();
    },
    recallHistory: function(item) {
      // 把历史表达式填入当前表达式
      this.expr = item.expr;
      this.justCalculated = false;
      this.isError = false;
      this.showHistory = false;
    },
    // ===== 键盘支持 =====
    onKeyboard: function(e) {
      // 忽略输入框中的键盘事件
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      var key = e.key;
      // 数字
      if (key >= '0' && key <= '9') {
        e.preventDefault();
        this.insert(key);
        return;
      }
      // 小数点
      if (key === '.') {
        e.preventDefault();
        this.insert('.');
        return;
      }
      // 运算符
      if (key === '+') { e.preventDefault(); this.insert('+'); return; }
      if (key === '-') { e.preventDefault(); this.insert('−'); return; }
      if (key === '*') { e.preventDefault(); this.insert('×'); return; }
      if (key === '/') { e.preventDefault(); this.insert('÷'); return; }
      if (key === '^') { e.preventDefault(); this.insert('^'); return; }
      if (key === '%') { e.preventDefault(); this.insert('÷100'); return; }
      if (key === '(' || key === ')') { e.preventDefault(); this.insert(key); return; }
      if (key === '!') { e.preventDefault(); this.insert('!'); return; }
      if (key === ',') { e.preventDefault(); this.insert(','); return; }
      // Enter 或 = 计算
      if (key === 'Enter' || key === '=') {
        e.preventDefault();
        this.calculate();
        return;
      }
      // Backspace 删除
      if (key === 'Backspace') {
        e.preventDefault();
        this.backspace();
        return;
      }
      // Escape 清除
      if (key === 'Escape') {
        e.preventDefault();
        this.allClear();
        return;
      }
      // π (Ctrl+P 或 Alt+p)
      if (key === 'p' || key === 'P') {
        if (e.ctrlKey || e.altKey) {
          e.preventDefault();
          this.insert('π');
        }
      }
      // e (Ctrl+E)
      if (key === 'e' || key === 'E') {
        if (e.ctrlKey) {
          e.preventDefault();
          this.insert('e');
        }
      }
    }
  }
};
</script>

<style scoped>
.calc-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}

.nav-action {
  background: transparent;
  border: none;
  color: var(--primary-color);
  font-size: 18px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-action:hover { background: rgba(var(--primary-rgb), 0.08); }
.nav-action:active { transform: scale(0.92); }

/* 主容器：左侧计算区 + 右侧历史抽屉 */
.calc-container {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

.calc-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 16px;
  gap: 16px;
}

/* ===== 显示屏 ===== */
.calc-display {
  background: var(--surface-elevated);
  backdrop-filter: var(--glass-blur-thick);
  -webkit-backdrop-filter: var(--glass-blur-thick);
  border: 0.5px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 20px 24px;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
}
.calc-display.display-error {
  background: rgba(var(--danger-rgb), 0.08);
  border-color: var(--danger-color);
}

.display-mode-row {
  position: absolute;
  top: 12px;
  right: 16px;
  left: 16px;
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}
.mode-badge {
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: rgba(120, 120, 128, 0.12);
  color: var(--text-secondary);
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
  min-height: 22px;
  display: inline-flex;
  align-items: center;
}
.mode-badge:hover { background: rgba(120, 120, 128, 0.2); }
.mode-badge.active {
  background: var(--primary-color);
  color: #fff;
}
.memory-indicator {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: rgba(var(--warning-rgb), 0.18);
  color: var(--warning-color);
  font-weight: 700;
}

.display-expr {
  font-size: 15px;
  color: var(--text-secondary);
  text-align: right;
  word-break: break-all;
  min-height: 20px;
  margin-bottom: 4px;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  max-height: 60px;
  overflow-y: auto;
}

.display-result {
  text-align: right;
  word-break: break-all;
  color: var(--text-primary);
  font-weight: 600;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  letter-spacing: -0.5px;
}
.display-result.result-large {
  font-size: 48px;
  line-height: 1.1;
}
.display-result.result-small {
  font-size: 36px;
  line-height: 1.15;
}
.calc-display.display-error .display-result {
  color: var(--danger-color);
  font-size: 32px;
}

/* ===== 按键网格：竖屏上下叠放 / 横屏左右两栏 ===== */
.calc-keypad {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.keypad-section {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-auto-rows: 1fr;
  gap: 8px;
  min-height: 0;
}
/* 科学功能区比数字区稍矮 */
.keypad-scientific {
  flex: 4;
}
.keypad-basic {
  flex: 5;
}

.calc-key {
  border: none;
  border-radius: var(--radius-lg);
  font-size: 18px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  font-family: -apple-system, 'SF Pro Display', system-ui, sans-serif;
  position: relative;
  overflow: hidden;
  min-height: 44px;
  /* 默认背景兜底：避免某类型按钮缺样式时透明不可见 */
  background: var(--surface-elevated, rgba(255, 255, 255, 0.8));
  color: var(--text-primary, #000);
  box-shadow: var(--shadow-xs, 0 1px 2px rgba(0, 0, 0, 0.08));
}
.calc-key:active {
  transform: scale(0.94);
}

/* 按键颜色 */
.key-digit {
  background: var(--surface-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-xs);
}
.key-digit:hover { background: var(--card-bg); }

.key-operator {
  background: var(--primary-color);
  color: #fff;
  box-shadow: var(--shadow-sm);
}
.key-operator:hover { background: var(--primary-hover); }

.key-function {
  background: var(--surface-secondary, rgba(120, 120, 128, 0.08));
  color: var(--text-primary);
  font-size: 16px;
}
.key-function:hover { background: rgba(120, 120, 128, 0.16); }

.key-memory {
  background: rgba(var(--warning-rgb), 0.12);
  color: var(--warning-color);
  font-size: 15px;
  font-weight: 600;
}
.key-memory:hover { background: rgba(var(--warning-rgb), 0.2); }

.key-clear {
  background: rgba(var(--danger-rgb), 0.1);
  color: var(--danger-color);
  font-weight: 600;
}
.key-clear:hover { background: rgba(var(--danger-rgb), 0.18); }

.key-mode {
  background: rgba(120, 120, 128, 0.1);
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
}
.key-mode:hover { background: rgba(120, 120, 128, 0.18); }
.key-mode.key-active {
  background: var(--primary-color);
  color: #fff;
}

/* ===== 历史抽屉 ===== */
.calc-history {
  width: 320px;
  max-width: 80vw;
  background: var(--surface-elevated);
  backdrop-filter: var(--glass-blur-regular);
  -webkit-backdrop-filter: var(--glass-blur-regular);
  border-left: 0.5px solid var(--glass-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.history-header {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 0.5px solid var(--border-color);
}
.history-header h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}
.history-actions {
  display: flex;
  gap: 8px;
}
.history-action {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
  min-width: 36px;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.history-action:hover {
  background: rgba(120, 120, 128, 0.12);
  color: var(--text-primary);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}

.history-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-tertiary);
}
.history-empty i {
  font-size: 40px;
  margin-bottom: 12px;
  display: block;
  opacity: 0.4;
}
.history-empty p {
  margin: 0;
  font-size: 14px;
}

.history-item {
  padding: 12px 14px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
  margin-bottom: 4px;
}
.history-item:hover {
  background: rgba(120, 120, 128, 0.08);
}
.history-expr {
  font-size: 13px;
  color: var(--text-secondary);
  font-family: 'SF Mono', 'Menlo', monospace;
  word-break: break-all;
  margin-bottom: 4px;
}
.history-result {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: 'SF Mono', 'Menlo', monospace;
  word-break: break-all;
}

/* 历史抽屉滑入动画 */
.history-slide-enter-active,
.history-slide-leave-active {
  transition: transform var(--duration-normal) var(--ease-standard), opacity var(--duration-normal) var(--ease-standard);
}
.history-slide-enter,
.history-slide-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

/* ===== 响应式：横屏左右两栏布局 ===== */
@media (orientation: landscape) and (min-width: 768px) {
  .calc-main {
    padding: 20px 24px;
    gap: 20px;
  }
  .calc-display {
    min-height: 110px;
    padding: 18px 24px;
  }
  .display-result.result-large { font-size: 48px; }
  .display-result.result-small { font-size: 36px; }
  /* 横屏：左右两栏并排显示 */
  .calc-keypad {
    flex-direction: row;
    gap: 12px;
  }
  .keypad-scientific,
  .keypad-basic {
    flex: 1;
  }
  .calc-key {
    font-size: 16px;
  }
  .key-function { font-size: 14px; }
}

/* 小屏适配 */
@media (max-width: 480px) {
  .calc-main {
    padding: 12px;
    gap: 12px;
  }
  .calc-display {
    padding: 16px 18px;
    min-height: 110px;
  }
  .display-result.result-large { font-size: 36px; }
  .display-result.result-small { font-size: 28px; }
  .calc-key {
    font-size: 16px;
    min-height: 40px;
  }
  .key-function { font-size: 14px; }
  .calc-history {
    width: 100%;
    max-width: 100%;
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 10;
  }
}

/* 超小屏 */
@media (max-width: 360px) {
  .calc-key {
    font-size: 14px;
    min-height: 36px;
  }
  .key-function { font-size: 12px; }
}

/* ========== 单位转换面板 ========== */
.converter-mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.converter-panel {
  width: 90%;
  max-width: 420px;
  max-height: 80vh;
  background: var(--card-bg);
  border-radius: var(--radius-xl);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.converter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
}
.converter-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}
.converter-close {
  width: 32px; height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.converter-close:hover { background: var(--bg-color); color: var(--text-primary); }
.converter-body {
  padding: 16px 20px 20px;
  overflow-y: auto;
}
/* 类别选择 */
.converter-category-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
.converter-cat-btn {
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.converter-cat-btn:hover { background: var(--bg-color); }
.converter-cat-btn.active {
  background: var(--primary-color);
  color: #fff;
  border-color: var(--primary-color);
}
/* 输入/输出区 */
.converter-field {
  display: flex;
  gap: 10px;
  align-items: stretch;
}
.converter-input {
  flex: 1;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  font-size: 18px;
  color: var(--text-primary);
  background: var(--bg-color);
  outline: none;
  min-width: 0;
  transition: border-color 0.15s;
}
.converter-input:focus { border-color: var(--primary-color); }
.converter-output {
  background: var(--primary-light);
  color: var(--primary-color);
  font-weight: 600;
}
.converter-select {
  width: 110px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0 10px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-color);
  outline: none;
  cursor: pointer;
}
/* 交换按钮 */
.converter-arrow {
  display: flex;
  justify-content: center;
  padding: 10px 0;
}
.converter-swap {
  width: 40px; height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--primary-light);
  color: var(--primary-color);
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.25s, background 0.15s, color 0.15s;
}
.converter-swap:hover { transform: rotate(180deg); background: var(--primary-color); color: #fff; }
/* 换算提示 */
.converter-hint {
  margin-top: 16px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: var(--bg-color);
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
}
/* 入场动画 */
.converter-fade-enter-active, .converter-fade-leave-active {
  transition: opacity 0.2s;
}
.converter-fade-enter-active .converter-panel,
.converter-fade-leave-active .converter-panel {
  transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}
.converter-fade-enter, .converter-fade-leave-to {
  opacity: 0;
}
.converter-fade-enter .converter-panel,
.converter-fade-leave-to .converter-panel {
  transform: scale(0.92);
}
</style>
