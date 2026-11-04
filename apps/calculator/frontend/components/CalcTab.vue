<template>
  <div class="calc-tab">
    <div class="calc-container">
      <div class="calc-main">
        <!-- 显示卡 -->
        <div class="calc-display" :class="{ 'display-error': isError }">
          <div class="display-mode-row">
            <span class="mode-badge" :class="{ active: angleMode === 'DEG' }" @click="setAngle('DEG')">DEG</span>
            <span class="mode-badge" :class="{ active: angleMode === 'RAD' }" @click="setAngle('RAD')">RAD</span>
            <span class="mode-badge" :class="{ active: sciMode }" @click="$emit('set-sci', !sciMode)">科学</span>
            <button class="display-history-btn" @click="showHistory = !showHistory" aria-label="历史记录" title="历史记录">
              <i class="fa-solid fa-clock-rotate-left"></i>
            </button>
          </div>
          <div class="display-expr" ref="exprEl" v-if="displayExpr">{{ displayExpr }}</div>
          <div class="display-result" :class="resultSizeClass">
            {{ displayResultText }}
          </div>
          <div class="display-memory-row">
            <span v-if="memory !== 0" class="memory-indicator" :title="'记忆值 ' + memory">M</span>
            <div class="memory-chips">
              <button class="memory-chip" :class="{ 'chip-dim': memory === 0 }" @click="memoryClear" title="清除记忆">MC</button>
              <button class="memory-chip" :class="{ 'chip-dim': memory === 0 }" @click="memoryRecall" title="读出记忆">MR</button>
              <button class="memory-chip" @click="memoryAdd" title="加到记忆">M+</button>
              <button class="memory-chip" @click="memorySubtract" title="从记忆减去">M−</button>
            </div>
          </div>
        </div>

        <!-- 键盘：科学盘（可关）+ 基础盘 -->
        <div class="calc-keypad" :class="{ 'sci-on': sciMode }">
          <div v-if="sciMode" class="keypad-section keypad-scientific">
            <button
              v-for="btn in currentScientificKeys"
              :key="'s-' + btn.label + (btn.secondaryLabel || '')"
              class="calc-key"
              :class="['key-' + btn.type, { 'key-active': btn.active }]"
              @click="onKey(btn)"
              :aria-label="btn.label"
            >
              <span class="key-label">{{ btn.label }}</span>
            </button>
          </div>
          <div class="keypad-section keypad-basic">
            <button
              v-for="btn in currentBasicKeys"
              :key="'b-' + btn.label"
              class="calc-key"
              :class="['key-' + btn.type]"
              @click="onKey(btn)"
              :aria-label="btn.label"
            >
              <span class="key-label">{{ btn.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 历史浮层（带遮罩，不挤压按键区） -->
      <transition name="history-fade">
        <div v-if="showHistory" class="history-mask" @click.self="showHistory = false">
          <aside class="calc-history">
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
              <div v-for="(item, idx) in history" :key="idx" class="history-item">
                <div class="hi-top">
                  <span class="hi-time">{{ formatTime(item.time) }}</span>
                  <button class="hi-del" @click="deleteHistory(idx)" aria-label="删除该条">
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                </div>
                <div class="history-expr" @click="recallExpr(item)" title="点击回填表达式">{{ item.expr }}</div>
                <div class="history-result" @click="recallResult(item)" title="点击回填结果">= {{ groupThousands(item.result) }}</div>
              </div>
            </div>
            <div class="history-tip">点表达式回填算式 · 点结果回填数值</div>
          </aside>
        </div>
      </transition>
    </div>
  </div>
</template>

<script>
import { evaluate, formatResult } from '../calc-parser.js';
import { groupThousands } from '../calc-tools.js';

// ===== 按键定义 =====
// 基础盘：4列×5行，iOS 风格（运算符右列，数字大键）
var BASIC_KEYS = [
  { label: 'AC', type: 'clear-danger', action: 'allClear' },
  { label: '⌫', type: 'clear', action: 'backspace' },
  { label: '%', type: 'function', action: 'insert', value: '÷100' },
  { label: '÷', type: 'operator', action: 'insert', value: '÷' },

  { label: '7', type: 'digit', action: 'insert', value: '7' },
  { label: '8', type: 'digit', action: 'insert', value: '8' },
  { label: '9', type: 'digit', action: 'insert', value: '9' },
  { label: '×', type: 'operator', action: 'insert', value: '×' },

  { label: '4', type: 'digit', action: 'insert', value: '4' },
  { label: '5', type: 'digit', action: 'insert', value: '5' },
  { label: '6', type: 'digit', action: 'insert', value: '6' },
  { label: '−', type: 'operator', action: 'insert', value: '−' },

  { label: '1', type: 'digit', action: 'insert', value: '1' },
  { label: '2', type: 'digit', action: 'insert', value: '2' },
  { label: '3', type: 'digit', action: 'insert', value: '3' },
  { label: '+', type: 'operator', action: 'insert', value: '+' },

  { label: '±', type: 'function', action: 'negate' },
  { label: '0', type: 'digit', action: 'insert', value: '0' },
  { label: '.', type: 'digit', action: 'insert', value: '.' },
  { label: '=', type: 'operator', action: 'equals' }
];

// 科学盘：4列×5行，仅科学模式显示；secondaryXxx 为 2nd 模式的替代键
var SCIENTIFIC_KEYS = [
  // 行1: 模式与括号
  { label: '2nd', type: 'mode', action: 'toggle2nd' },
  { label: '(', type: 'function', action: 'insert', value: '(' },
  { label: ')', type: 'function', action: 'insert', value: ')' },
  { label: 'Ans', type: 'function', action: 'insert', value: 'ans', secondaryLabel: 'EXP', secondaryValue: '×10^' },
  // 行2: 幂与根
  { label: 'x²', type: 'function', action: 'insert', value: '^2', secondaryLabel: 'x³', secondaryValue: '^3' },
  { label: 'xʸ', type: 'function', action: 'insert', value: '^', secondaryLabel: 'ⁿ√', secondaryValue: 'root(' },
  { label: '√', type: 'function', action: 'insert', value: '√(', secondaryLabel: '10ˣ', secondaryValue: '10^(' },
  { label: '∛', type: 'function', action: 'insert', value: '∛(', secondaryLabel: 'eˣ', secondaryValue: 'exp(' },
  // 行3: 三角（2nd → 反三角）
  { label: 'sin', type: 'function', action: 'insert', value: 'sin(', secondaryLabel: 'sin⁻¹', secondaryValue: 'asin(' },
  { label: 'cos', type: 'function', action: 'insert', value: 'cos(', secondaryLabel: 'cos⁻¹', secondaryValue: 'acos(' },
  { label: 'tan', type: 'function', action: 'insert', value: 'tan(', secondaryLabel: 'tan⁻¹', secondaryValue: 'atan(' },
  { label: 'π', type: 'function', action: 'insert', value: 'π', secondaryLabel: 'φ', secondaryValue: 'φ' },
  // 行4: 对数指数（2nd → 双曲）
  { label: 'ln', type: 'function', action: 'insert', value: 'ln(', secondaryLabel: 'sinh', secondaryValue: 'sinh(' },
  { label: 'log', type: 'function', action: 'insert', value: 'log(', secondaryLabel: 'cosh', secondaryValue: 'cosh(' },
  { label: 'e', type: 'function', action: 'insert', value: 'e', secondaryLabel: 'tanh', secondaryValue: 'tanh(' },
  { label: 'n!', type: 'function', action: 'insert', value: '!', secondaryLabel: 'log₂', secondaryValue: 'log2(' },
  // 行5: 倒数/取整/排列组合
  { label: '1/x', type: 'function', action: 'insert', value: '^(-1)', secondaryLabel: '|x|', secondaryValue: 'abs(' },
  { label: 'mod', type: 'function', action: 'insert', value: 'mod(', secondaryLabel: '⌊x⌋', secondaryValue: 'floor(' },
  { label: 'P', type: 'function', action: 'insert', value: 'P(', secondaryLabel: 'C', secondaryValue: 'C(' },
  { label: ',', type: 'function', action: 'insert', value: ',', secondaryLabel: '⌈x⌉', secondaryValue: 'ceil(' }
];

// 退格时整块删除的函数名（与 calc-parser 支持的函数对齐）
var MULTI_CHAR_TOKENS = [
  'asinh(', 'acosh(', 'atanh(', 'asin(', 'acos(', 'atan(',
  'sinh(', 'cosh(', 'tanh(', 'sin(', 'cos(', 'tan(',
  'ln(', 'log(', 'log2(', 'log10(', 'logn(', 'logb(',
  'sqrt(', 'cbrt(', 'exp(', 'inv(', 'abs(', 'floor(', 'ceil(',
  'mod(', 'P(', 'C(', 'root(', 'pow(', 'gcd(', 'lcm(',
  'max(', 'min(', 'hypot(', 'atan2(', 'randint(',
  'fact(', 'trunc(', 'sign(', 'round(', 'deg(', 'rad(',
  '10^(', '^(-1)', '÷100', '×10^', '(-'
];

var HISTORY_KEY = 'classintra_calc_history';
var MAX_HISTORY = 50;

export default {
  name: 'CalcTab',
  props: {
    angleMode: { type: String, default: 'DEG' },
    sciMode: { type: Boolean, default: true },
    // 页签是否处于激活态（非激活时忽略全局键盘事件）
    active: { type: Boolean, default: true }
  },
  data: function() {
    return {
      expr: '',
      result: '0',
      lastResult: 0,
      isError: false,
      secondMode: false,
      memory: 0,
      showHistory: false,
      history: [],
      scientificKeys: SCIENTIFIC_KEYS,
      basicKeys: BASIC_KEYS,
      justCalculated: false
    };
  },
  computed: {
    displayExpr: function() {
      return this.expr;
    },
    displayResult: function() {
      return this.result;
    },
    // 结果显示：千分位分组（仅显示层）
    displayResultText: function() {
      return this.result === '0' ? '0' : groupThousands(this.result);
    },
    // 结果字号自适应：位数越多字号越小，避免长结果溢出
    resultSizeClass: function() {
      var len = this.result.length;
      if (!this.displayExpr) {
        if (len <= 9) return 'result-large';
        if (len <= 13) return 'result-medium';
        return 'result-small';
      }
      if (len <= 11) return 'result-small';
      return 'result-xs';
    },
    currentScientificKeys: function() {
      var self = this;
      return this.scientificKeys.map(function(btn) {
        return self._applyDynamic(btn);
      });
    },
    currentBasicKeys: function() {
      return this.basicKeys;
    }
  },
  watch: {
    expr: function() {
      this.previewResult();
      this._scrollExprToEnd();
    },
    angleMode: function() {
      this.previewResult();
    }
  },
  mounted: function() {
    var self = this;
    self.loadHistory();
    self._keyHandler = function(e) { self.onKeyboard(e); };
    window.addEventListener('keydown', self._keyHandler);
  },
  beforeDestroy: function() {
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler);
    }
  },
  methods: {
    groupThousands: groupThousands,
    formatTime: function(ts) {
      if (!ts) return '';
      var d = new Date(ts);
      var h = d.getHours();
      var m = d.getMinutes();
      return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
    },
    setAngle: function(mode) {
      if (this.angleMode !== mode) {
        this.$emit('set-angle', mode);
      }
    },
    _applyDynamic: function(btn) {
      var newBtn = Object.assign({}, btn);
      if (this.secondMode && btn.secondaryLabel) {
        newBtn.label = btn.secondaryLabel;
      }
      if (btn.action === 'toggle2nd') {
        newBtn.active = this.secondMode;
      }
      return newBtn;
    },
    _scrollExprToEnd: function() {
      var self = this;
      this.$nextTick(function() {
        var el = self.$refs.exprEl;
        if (el) el.scrollLeft = el.scrollWidth;
      });
    },
    // ===== 按键处理 =====
    onKey: function(btn) {
      var action = btn.action;
      var value = (this.secondMode && btn.secondaryValue !== undefined) ? btn.secondaryValue : btn.value;
      switch (action) {
        case 'insert': this.insert(value); break;
        case 'equals': this.calculate(); break;
        case 'backspace': this.backspace(); break;
        case 'allClear': this.allClear(); break;
        case 'toggle2nd': this.secondMode = !this.secondMode; break;
        case 'negate': this.negate(); break;
      }
    },
    insert: function(value) {
      if (this.isError) {
        this.expr = '';
        this.isError = false;
        this.justCalculated = false;
      } else if (this.justCalculated) {
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
      return ['+', '−', '-', '×', '*', '÷', '/', '^', '%'].indexOf(value) !== -1;
    },
    backspace: function() {
      if (this.justCalculated || this.isError) {
        this.allClear();
        return;
      }
      var deleted = false;
      for (var i = 0; i < MULTI_CHAR_TOKENS.length; i++) {
        var token = MULTI_CHAR_TOKENS[i];
        if (this.expr.endsWith(token)) {
          this.expr = this.expr.slice(0, this.expr.length - token.length);
          deleted = true;
          break;
        }
      }
      if (!deleted) {
        this.expr = this.expr.slice(0, -1);
      }
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
        this.lastResult = -this.lastResult;
        this.expr = String(this.lastResult);
        this.result = formatResult(this.lastResult);
        this.justCalculated = false;
        return;
      }
      this.insert('(-');
    },
    // ===== 计算 =====
    previewResult: function() {
      if (!this.expr || this.isError) {
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
    // ===== 记忆 =====
    memoryClear: function() {
      this.memory = 0;
    },
    memoryRecall: function() {
      this.insert(formatResult(this.memory));
    },
    memoryAdd: function() {
      var val = this.getCurrentValue();
      if (val !== null) this.memory += val;
    },
    memorySubtract: function() {
      var val = this.getCurrentValue();
      if (val !== null) this.memory -= val;
    },
    getCurrentValue: function() {
      if (this.justCalculated) return this.lastResult;
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
    deleteHistory: function(idx) {
      this.history.splice(idx, 1);
      this.saveHistory();
    },
    clearHistory: function() {
      this.history = [];
      this.saveHistory();
    },
    recallExpr: function(item) {
      this.expr = item.expr;
      this.justCalculated = false;
      this.isError = false;
      this.showHistory = false;
    },
    recallResult: function(item) {
      var num = Number(item.result);
      if (!isFinite(num)) {
        this.$store.commit('toast/SHOW_TOAST', { message: '该结果无法回填', type: 'info' });
        return;
      }
      // 负数结果用括号包裹，避免 5--3 这类歧义
      var value = (num < 0) ? '(' + item.result + ')' : item.result;
      if (this.justCalculated || this.isError) {
        this.expr = '';
        this.justCalculated = false;
        this.isError = false;
      }
      this.expr += value;
      this.showHistory = false;
    },
    // ===== 键盘支持 =====
    onKeyboard: function(e) {
      if (!this.active) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      var key = e.key;
      if (key >= '0' && key <= '9') { e.preventDefault(); this.insert(key); return; }
      if (key === '.') { e.preventDefault(); this.insert('.'); return; }
      if (key === '+') { e.preventDefault(); this.insert('+'); return; }
      if (key === '-') { e.preventDefault(); this.insert('−'); return; }
      if (key === '*') { e.preventDefault(); this.insert('×'); return; }
      if (key === '/') { e.preventDefault(); this.insert('÷'); return; }
      if (key === '^') { e.preventDefault(); this.insert('^'); return; }
      if (key === '%') { e.preventDefault(); this.insert('÷100'); return; }
      if (key === '(' || key === ')') { e.preventDefault(); this.insert(key); return; }
      if (key === '!') { e.preventDefault(); this.insert('!'); return; }
      if (key === ',') { e.preventDefault(); this.insert(','); return; }
      if (key === 'Enter' || key === '=') { e.preventDefault(); this.calculate(); return; }
      if (key === 'Backspace') { e.preventDefault(); this.backspace(); return; }
      if (key === 'Escape') { e.preventDefault(); this.allClear(); return; }
      if (key === 'p' || key === 'P') {
        if (e.ctrlKey || e.altKey) { e.preventDefault(); this.insert('π'); }
      }
      if (key === 'e' || key === 'E') {
        if (e.ctrlKey) { e.preventDefault(); this.insert('e'); }
      }
    }
  }
};
</script>

<style scoped>
.calc-tab {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}
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
  padding: 12px 16px 16px;
  gap: 12px;
}

/* ===== 显示卡 ===== */
.calc-display {
  background: var(--surface-elevated);
  backdrop-filter: var(--glass-blur-thick);
  -webkit-backdrop-filter: var(--glass-blur-thick);
  border: 0.5px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 14px 20px 12px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
  flex-shrink: 0;
}
.calc-display.display-error {
  background: rgba(var(--danger-rgb), 0.08);
  border-color: var(--danger-color);
}
.display-mode-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  margin-bottom: 4px;
}
.mode-badge {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: rgba(120, 120, 128, 0.12);
  color: var(--text-secondary);
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  user-select: none;
}
.mode-badge:hover { background: rgba(120, 120, 128, 0.2); }
.mode-badge.active {
  background: var(--primary-color);
  color: #fff;
}
.display-history-btn {
  margin-left: auto;
  width: 28px;
  height: 24px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}
.display-history-btn:hover { background: rgba(120, 120, 128, 0.14); color: var(--text-primary); }

.display-expr {
  font-size: 15px;
  color: var(--text-secondary);
  text-align: right;
  white-space: nowrap;
  overflow-x: auto;
  min-height: 22px;
  margin-bottom: 2px;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  scrollbar-width: none;
}
.display-expr::-webkit-scrollbar { display: none; }

.display-result {
  text-align: right;
  word-break: break-all;
  color: var(--text-primary);
  font-weight: 600;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  letter-spacing: -0.5px;
}
.display-result.result-large { font-size: 44px; line-height: 1.15; }
.display-result.result-medium { font-size: 36px; line-height: 1.15; }
.display-result.result-small { font-size: 30px; line-height: 1.15; }
.display-result.result-xs { font-size: 22px; line-height: 1.2; letter-spacing: 0; }
.calc-display.display-error .display-result {
  color: var(--danger-color);
  font-size: 28px;
}

/* 记忆行：指示器 + 芯片 */
.display-memory-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.memory-indicator {
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: rgba(var(--warning-rgb), 0.18);
  color: var(--warning-color);
  font-weight: 700;
  font-size: 11px;
}
.memory-chips {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.memory-chip {
  border: none;
  border-radius: var(--radius-md);
  background: rgba(var(--warning-rgb), 0.1);
  color: var(--warning-color);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  cursor: pointer;
  min-height: 24px;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}
.memory-chip:hover { background: rgba(var(--warning-rgb), 0.2); }
.memory-chip:active { transform: scale(0.92); }
.memory-chip.chip-dim { opacity: 0.45; }

/* ===== 键盘 ===== */
.calc-keypad {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.keypad-section {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: minmax(44px, 1fr);
  gap: 8px;
  min-height: 0;
}
.keypad-scientific {
  flex: 4;
  grid-auto-rows: minmax(36px, 1fr);
}
.keypad-basic {
  flex: 5;
}

.calc-key {
  border: none;
  border-radius: var(--radius-lg);
  font-size: 20px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  font-family: -apple-system, 'SF Pro Display', system-ui, sans-serif;
  min-height: 44px;
  background: var(--surface-elevated, rgba(255, 255, 255, 0.8));
  color: var(--text-primary, #000);
  box-shadow: var(--shadow-xs, 0 1px 2px rgba(0, 0, 0, 0.08));
}
.calc-key:active { transform: scale(0.94); }

.key-digit {
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: var(--shadow-xs);
}
.key-digit:hover { background: var(--card-bg); }

.key-operator {
  background: var(--primary-color);
  color: #fff;
  font-size: 24px;
  box-shadow: var(--shadow-sm);
}
.key-operator:hover { background: var(--primary-hover); }

.key-function {
  background: var(--surface-secondary, rgba(120, 120, 128, 0.08));
  color: var(--text-primary);
  font-size: 17px;
}
.key-function:hover { background: rgba(120, 120, 128, 0.16); }

.key-clear {
  background: rgba(120, 120, 128, 0.12);
  color: var(--text-primary);
  font-weight: 600;
  font-size: 18px;
}
.key-clear:hover { background: rgba(120, 120, 128, 0.2); }

.key-clear-danger {
  background: rgba(var(--danger-rgb), 0.1);
  color: var(--danger-color);
  font-weight: 600;
  font-size: 18px;
}
.key-clear-danger:hover { background: rgba(var(--danger-rgb), 0.18); }

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

/* ===== 历史浮层 ===== */
.history-mask {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.28);
  z-index: 20;
  display: flex;
  justify-content: flex-end;
  animation: historyMaskIn var(--duration-fast) var(--ease-standard);
}
@keyframes historyMaskIn { from { opacity: 0; } to { opacity: 1; } }
.calc-history {
  width: 340px;
  max-width: 86vw;
  height: 100%;
  background: var(--surface-elevated);
  backdrop-filter: var(--glass-blur-regular);
  -webkit-backdrop-filter: var(--glass-blur-regular);
  border-left: 0.5px solid var(--glass-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);
}
.history-header {
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 0.5px solid var(--border-color);
  flex-shrink: 0;
}
.history-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}
.history-actions { display: flex; gap: 6px; }
.history-action {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 15px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
  min-width: 34px;
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.history-action:hover { background: rgba(120, 120, 128, 0.12); color: var(--text-primary); }
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
.history-empty i { font-size: 38px; margin-bottom: 12px; display: block; opacity: 0.4; }
.history-empty p { margin: 0; font-size: 14px; }
.history-item {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
  margin-bottom: 4px;
}
.history-item:hover { background: rgba(120, 120, 128, 0.08); }
.hi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hi-time {
  font-size: 11px;
  color: var(--text-quaternary, var(--text-tertiary));
}
.hi-del {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}
.hi-del:hover { background: rgba(var(--danger-rgb), 0.12); color: var(--danger-color); }
.history-expr {
  font-size: 13px;
  color: var(--text-secondary);
  font-family: 'SF Mono', 'Menlo', monospace;
  word-break: break-all;
  margin-top: 2px;
}
.history-item:hover .history-expr { text-decoration: underline dotted; }
.history-result {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: 'SF Mono', 'Menlo', monospace;
  word-break: break-all;
}
.history-item:hover .history-result { text-decoration: underline dotted; }
.history-tip {
  padding: 8px 16px;
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: center;
  border-top: 0.5px solid var(--border-color);
  flex-shrink: 0;
}
.history-fade-enter-active { transition: opacity var(--duration-fast) var(--ease-standard); }
.history-fade-leave-active { transition: opacity var(--duration-fast) var(--ease-standard); }
.history-fade-enter, .history-fade-leave-to { opacity: 0; }

/* ===== 响应式：横屏科学盘移到基础盘左侧 ===== */
@media (orientation: landscape) and (min-width: 768px) {
  .calc-main {
    padding: 16px 24px 20px;
    gap: 14px;
  }
  .calc-keypad {
    flex-direction: row;
    gap: 12px;
  }
  .keypad-scientific, .keypad-basic {
    flex: 1;
  }
  .calc-key { font-size: 18px; }
  .key-function { font-size: 15px; }
  .key-operator { font-size: 22px; }
}

/* 小屏适配 */
@media (max-width: 480px) {
  .calc-main { padding: 10px 12px 12px; gap: 10px; }
  .display-result.result-large { font-size: 34px; }
  .display-result.result-medium { font-size: 29px; }
  .display-result.result-small { font-size: 25px; }
  .display-result.result-xs { font-size: 18px; }
  .calc-key { font-size: 18px; min-height: 40px; }
  .key-function { font-size: 15px; }
  .calc-history {
    width: 100%;
    max-width: 100%;
  }
}
@media (max-width: 360px) {
  .calc-key { font-size: 16px; min-height: 36px; }
  .key-function { font-size: 13px; }
}
</style>
