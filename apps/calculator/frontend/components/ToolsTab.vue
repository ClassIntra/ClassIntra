<template>
  <div class="tools-tab">
    <!-- 二级切换 -->
    <div class="tool-seg">
      <button
        v-for="t in toolDefs"
        :key="t.value"
        class="tool-seg-btn"
        :class="{ active: subTab === t.value }"
        @click="subTab = t.value"
      >
        <i :class="t.icon"></i>{{ t.label }}
      </button>
    </div>

    <div class="tool-body scrollbar-thin">
      <!-- ============ 解方程 ============ -->
      <div v-if="subTab === 'solver'" class="tool-block">
        <div class="tool-mode-row">
          <button class="tool-mode-btn" :class="{ active: solverMode === 'quadratic' }" @click="solverMode = 'quadratic'">一元二次</button>
          <button class="tool-mode-btn" :class="{ active: solverMode === 'free' }" @click="solverMode = 'free'">任意方程</button>
        </div>

        <!-- 结构化二次方程 -->
        <div v-if="solverMode === 'quadratic'" class="tool-card">
          <div class="solver-inputs">
            <div class="solver-field">
              <label>a</label>
              <input v-model="quad.a" type="text" inputmode="text" spellcheck="false" placeholder="1" />
            </div>
            <div class="solver-field">
              <label>b</label>
              <input v-model="quad.b" type="text" spellcheck="false" placeholder="-3" />
            </div>
            <div class="solver-field">
              <label>c</label>
              <input v-model="quad.c" type="text" spellcheck="false" placeholder="2" />
            </div>
          </div>
          <div class="solver-equation" v-if="quadResult.type !== 'invalid'">
            {{ quadEquationText }}
          </div>
          <div class="solver-result" v-if="quadResult && quadResult.type !== 'invalid'">
            <!-- 一元一次 -->
            <template v-if="quadResult.type === 'linear'">
              <div class="sr-badge">一元一次方程</div>
              <div class="sr-line">x = <b>{{ fmt(quadResult.root) }}</b></div>
            </template>
            <template v-else-if="quadResult.type === 'identity'">
              <div class="sr-badge">恒等式</div>
              <div class="sr-line">0 = 0，任意 x 都成立</div>
            </template>
            <template v-else-if="quadResult.type === 'none'">
              <div class="sr-badge">无解</div>
              <div class="sr-line">a = b = 0 且 c ≠ 0</div>
            </template>
            <template v-else-if="quadResult.type === 'real2'">
              <div class="sr-badge ok">Δ = {{ fmt(quadResult.delta) }} &gt; 0 · 两个不等实根</div>
              <div class="sr-line">x₁ = <b>{{ fmt(quadResult.root1) }}</b></div>
              <div class="sr-line">x₂ = <b>{{ fmt(quadResult.root2) }}</b></div>
            </template>
            <template v-else-if="quadResult.type === 'real1'">
              <div class="sr-badge">Δ = 0 · 二重实根</div>
              <div class="sr-line">x₁ = x₂ = <b>{{ fmt(quadResult.root) }}</b></div>
            </template>
            <template v-else-if="quadResult.type === 'complex'">
              <div class="sr-badge warn">Δ = {{ fmt(quadResult.delta) }} &lt; 0 · 共轭虚根</div>
              <div class="sr-line">x = <b>{{ fmt(quadResult.re) }} ± {{ fmtAbs(quadResult.im) }}i</b></div>
            </template>
            <!-- 补充信息 -->
            <template v-if="quadResult.sum !== undefined">
              <div class="sr-divider"></div>
              <div class="sr-extra">
                <span>韦达定理：x₁+x₂ = {{ fmt(quadResult.sum) }}，x₁·x₂ = {{ fmt(quadResult.product) }}</span>
                <span>顶点：( {{ fmt(quadResult.vertex.x) }}，{{ fmt(quadResult.vertex.y) }} ) · 开口{{ quadResult.opensUp ? '向上' : '向下' }}</span>
              </div>
            </template>
          </div>
        </div>

        <!-- 任意方程数值解 -->
        <div v-else class="tool-card">
          <div class="free-solver-row">
            <input
              v-model="freeEquation"
              class="free-input"
              placeholder="如 x^3-2x-5=0 或 sin(x)=0.5"
              spellcheck="false"
              @keyup.enter="solveFree"
            />
            <button class="tool-primary-btn" @click="solveFree">求解</button>
          </div>
          <div v-if="freeResult.error" class="free-error">{{ freeResult.error }}</div>
          <div v-else-if="freeResult.roots.length" class="free-roots">
            <div class="sr-badge ok">找到 {{ freeResult.roots.length }} 个实根</div>
            <div class="free-root" v-for="(r, idx) in freeResult.roots" :key="idx">
              x<sub>{{ idx + 1 }}</sub> = <b>{{ fmt(r) }}</b>
            </div>
          </div>
          <div v-else-if="freeResult.done" class="free-none">未找到实根（可能只有虚根）</div>
          <div class="tool-hint">数值解：在 [-10⁶, 10⁶] 内扫描变号点并二分逼近，可能与理论根有微小误差</div>
        </div>
      </div>

      <!-- ============ 统计 ============ -->
      <div v-else-if="subTab === 'stats'" class="tool-block">
        <div class="tool-card">
          <textarea
            v-model="statsInput"
            class="stats-input"
            rows="3"
            placeholder="输入一组数据（空格/逗号/换行分隔）：&#10;85 90 78 92 88"
          ></textarea>
          <div v-if="statsData.invalid.length" class="stats-invalid">
            无法识别：{{ statsData.invalid.join('、') }}
          </div>
        </div>
        <div v-if="stats" class="tool-card stats-grid">
          <div class="stat-item"><span class="stat-label">个数 n</span><span class="stat-value">{{ stats.n }}</span></div>
          <div class="stat-item"><span class="stat-label">总和 Σ</span><span class="stat-value">{{ fmt(stats.sum) }}</span></div>
          <div class="stat-item highlight"><span class="stat-label">平均值</span><span class="stat-value">{{ fmt(stats.mean) }}</span></div>
          <div class="stat-item"><span class="stat-label">中位数</span><span class="stat-value">{{ fmt(stats.median) }}</span></div>
          <div class="stat-item"><span class="stat-label">众数</span><span class="stat-value">{{ stats.modes.length ? stats.modes.join('、') : '无' }}</span></div>
          <div class="stat-item"><span class="stat-label">最大值</span><span class="stat-value">{{ fmt(stats.max) }}</span></div>
          <div class="stat-item"><span class="stat-label">最小值</span><span class="stat-value">{{ fmt(stats.min) }}</span></div>
          <div class="stat-item"><span class="stat-label">极差</span><span class="stat-value">{{ fmt(stats.range) }}</span></div>
          <div class="stat-item"><span class="stat-label">方差 σ²（总体）</span><span class="stat-value">{{ fmt(stats.varianceP) }}</span></div>
          <div class="stat-item"><span class="stat-label">标准差 σ（总体）</span><span class="stat-value">{{ fmt(stats.stdP) }}</span></div>
          <div class="stat-item" v-if="stats.varianceS !== null"><span class="stat-label">方差 s²（样本）</span><span class="stat-value">{{ fmt(stats.varianceS) }}</span></div>
          <div class="stat-item" v-if="stats.stdS !== null"><span class="stat-label">标准差 s（样本）</span><span class="stat-value">{{ fmt(stats.stdS) }}</span></div>
        </div>
        <div v-else class="tool-empty"><i class="fa-solid fa-chart-simple"></i><p>输入数据后自动计算</p></div>
      </div>

      <!-- ============ 日期 ============ -->
      <div v-else-if="subTab === 'date'" class="tool-block">
        <!-- 两日期差 -->
        <div class="tool-card">
          <div class="tc-title"><i class="fa-solid fa-calendar-days"></i> 两日期相差</div>
          <div class="date-pair">
            <input type="date" v-model="dateA" class="date-input" />
            <span class="date-sep">→</span>
            <input type="date" v-model="dateB" class="date-input" />
          </div>
          <div v-if="dateDiffResult" class="date-result">
            <div class="sr-line">相差 <b>{{ dateDiffResult.days }}</b> 天（{{ dateDiffResult.weeks }} 周 + {{ dateDiffResult.remainDays }} 天）</div>
            <div class="sr-extra"><span>{{ dateA }} 是{{ weekdayName(dateA) }} · {{ dateB }} 是{{ weekdayName(dateB) }}</span></div>
          </div>
        </div>
        <!-- 日期推算 -->
        <div class="tool-card">
          <div class="tc-title"><i class="fa-solid fa-calendar-plus"></i> 日期推算</div>
          <div class="date-shift-row">
            <input type="date" v-model="dateS" class="date-input" />
            <select v-model="shiftUnit" class="shift-select">
              <option value="day">天</option>
              <option value="week">周</option>
              <option value="month">月</option>
            </select>
            <input type="number" v-model="shiftAmount" class="shift-num" />
          </div>
          <div class="tool-hint">负数表示往前推（如 -7 = 7 天前）</div>
          <div v-if="shiftResult" class="date-result">
            <div class="sr-line"><b>{{ shiftResult }}</b>（{{ weekdayName(shiftResult) }}）</div>
            <div v-if="shiftLunar" class="sr-extra"><span>{{ shiftLunar }}</span></div>
          </div>
        </div>
      </div>

      <!-- ============ 进制 ============ -->
      <div v-else class="tool-block">
        <div class="tool-card">
          <div class="tc-title"><i class="fa-solid fa-binary"></i> 进制转换</div>
          <div class="base-row" v-for="b in bases" :key="b.radix">
            <span class="base-label">{{ b.label }}<sub>{{ b.radix }}</sub></span>
            <input
              v-model="b.value"
              class="base-input"
              :spellcheck="false"
              :placeholder="b.radix === 10 ? '如 255' : '如 ' + b.sample"
              @input="onBaseInput(b)"
            />
          </div>
          <div v-if="baseError" class="free-error">{{ baseError }}</div>
          <div class="tool-hint">支持小数与负数，输入任一进制，其余自动更新</div>
          <div v-if="binaryGrouped" class="binary-grouped">二进制分组：{{ binaryGrouped }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { evaluate, formatResult } from '../calc-parser.js';
import {
  solveQuadratic,
  solveEquationFree,
  parseNumberList,
  computeStats,
  parseBaseString,
  toBaseString,
  groupBinary,
  dateDiff,
  shiftDate,
  weekdayName
} from '../calc-tools.js';
import { getDateInfo } from '@/utils/lunar-helper.js';

var TOOL_DEFS = [
  { value: 'solver', label: '解方程', icon: 'fa-solid fa-square-root-variable' },
  { value: 'stats', label: '统计', icon: 'fa-solid fa-chart-simple' },
  { value: 'date', label: '日期', icon: 'fa-solid fa-calendar-days' },
  { value: 'base', label: '进制', icon: 'fa-solid fa-shuffle' }
];

// 'YYYY-MM-DD' 默认值
function todayStr(offsetDays) {
  var d = new Date();
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

export default {
  name: 'ToolsTab',
  data: function() {
    return {
      toolDefs: TOOL_DEFS,
      subTab: 'solver',
      // 解方程
      solverMode: 'quadratic',
      quad: { a: '1', b: '-3', c: '2' },
      freeEquation: '',
      freeResult: { roots: [], error: '', done: false },
      // 统计
      statsInput: '',
      // 日期
      dateA: todayStr(0),
      dateB: todayStr(30),
      dateS: todayStr(0),
      shiftUnit: 'day',
      shiftAmount: '7',
      // 进制
      bases: [
        { radix: 2, label: '二进制', value: '11111111', sample: '1011 0101' },
        { radix: 8, label: '八进制', value: '377', sample: '377' },
        { radix: 10, label: '十进制', value: '255', sample: '255' },
        { radix: 16, label: '十六进制', value: 'ff', sample: 'ff' }
      ],
      baseError: ''
    };
  },
  computed: {
    quadResult: function() {
      return solveQuadratic(this.quad.a, this.quad.b, this.quad.c);
    },
    quadEquationText: function() {
      var a = Number(this.parsedCoef(this.quad.a));
      var b = Number(this.parsedCoef(this.quad.b));
      var c = Number(this.parsedCoef(this.quad.c));
      if (isNaN(a) || isNaN(b) || isNaN(c)) return '';
      var parts = [];
      // ax²
      if (a !== 0) {
        parts.push(a === 1 ? 'x²' : (a === -1 ? '-x²' : fmtCoef(a) + 'x²'));
      }
      // bx
      if (b !== 0) {
        var bAbs = Math.abs(b);
        var bStr = (bAbs === 1) ? 'x' : fmtCoef(bAbs) + 'x';
        parts.push((b > 0 ? (parts.length ? '+ ' : '') : '- ') + bStr);
      }
      if (c !== 0 || parts.length === 0) {
        parts.push((c > 0 ? (parts.length ? '+ ' : '') : (parts.length ? '- ' : '')) + fmtCoef(Math.abs(c)));
      }
      return parts.join(' ') + ' = 0';
    },
    parsedCoef: function() {
      var self = this;
      return function(v) {
        if (v === '' || v === undefined) return 0;
        var n = Number(v);
        if (isFinite(n)) return n;
        try {
          return self._evalSafe(v);
        } catch (e) { return NaN; }
      };
    },
    statsData: function() {
      return parseNumberList(this.statsInput);
    },
    stats: function() {
      if (!this.statsData.values.length) return null;
      return computeStats(this.statsData.values);
    },
    dateDiffResult: function() {
      var r = dateDiff(this.dateA, this.dateB);
      return r || null;
    },
    shiftResult: function() {
      var r = shiftDate(this.dateS, this.shiftAmount, this.shiftUnit);
      return r || null;
    },
    shiftLunar: function() {
      if (!this.shiftResult) return '';
      var info = this._lunarInfo(this.shiftResult);
      if (!info) return '';
      return this._formatLunar(info);
    },
    binaryGrouped: function() {
      var b2 = this.bases[0];
      if (!b2.value) return '';
      return groupBinary(b2.value.replace(/\s+/g, ''));
    }
  },
  methods: {
    fmt: function(v) {
      if (typeof v !== 'number') return String(v);
      return formatResult(v);
    },
    fmtAbs: function(v) {
      if (typeof v !== 'number') return String(v);
      return formatResult(Math.abs(v));
    },
    _evalSafe: function(expr) {
      return evaluate(expr, { mode: 'RAD', variables: {} });
    },
    solveFree: function() {
      var r = solveEquationFree(this.freeEquation, { mode: 'RAD' });
      r.done = true;
      this.freeResult = r;
    },
    onBaseInput: function(item) {
      var clean = String(item.value || '').replace(/\s+/g, '');
      if (!clean) {
        this.baseError = '';
        return;
      }
      var res = parseBaseString(clean, item.radix);
      if (res.error) {
        this.baseError = item.label + '输入：' + res.error;
        return;
      }
      this.baseError = '';
      for (var i = 0; i < this.bases.length; i++) {
        var other = this.bases[i];
        if (other.radix === item.radix) continue;
        other.value = toBaseString(res.value, other.radix);
      }
    },
    _lunarInfo: function(dateStr) {
      var parts = dateStr.split('-');
      var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      try { return getDateInfo(d); } catch (e) { return null; }
    },
    _formatLunar: function(info) {
      var parts = [];
      if (info.solarFestivals && info.solarFestivals.length) parts.push(info.solarFestivals[0]);
      if (info.lunarFestivals && info.lunarFestivals.length) parts.push(info.lunarFestivals[0]);
      if (info.solarTerm) parts.push(info.solarTerm);
      if (info.lunar) parts.push('农历' + info.lunar.lunarMonthName + '月' + info.lunar.lunarDayName);
      return parts.join(' · ');
    },
    weekdayName: weekdayName
  }
};

// 系数格式化：整数不带小数点，浮点去尾零
function fmtCoef(n) {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(8)));
}
</script>

<style scoped>
.tools-tab {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  overflow: hidden;
}
/* 二级切换 */
.tool-seg {
  display: flex;
  gap: 6px;
  padding: 12px 16px 8px;
  flex-shrink: 0;
}
.tool-seg-btn {
  flex: 1;
  border: 1px solid var(--separator-color);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 0;
  border-radius: var(--radius-lg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard);
}
.tool-seg-btn i { font-size: 12px; }
.tool-seg-btn.active {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
}

.tool-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 620px;
  width: 100%;
  margin: 0 auto;
}
.tool-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tool-card {
  background: var(--card-bg);
  border-radius: var(--radius-xl);
  border: 1px solid var(--separator-color);
  padding: 16px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tc-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 7px;
}
.tc-title i { color: var(--primary-color); font-size: 13px; }
.tool-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
.tool-empty {
  text-align: center;
  padding: 36px 0;
  color: var(--text-tertiary);
}
.tool-empty i { font-size: 30px; opacity: 0.4; margin-bottom: 8px; display: block; }
.tool-empty p { font-size: 13px; margin: 0; }

/* ===== 解方程 ===== */
.tool-mode-row {
  display: flex;
  gap: 6px;
}
.tool-mode-btn {
  flex: 1;
  border: none;
  background: rgba(120, 120, 128, 0.1);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 0;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}
.tool-mode-btn.active {
  background: var(--primary-color);
  color: #fff;
}
.solver-inputs {
  display: flex;
  gap: 10px;
}
.solver-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.solver-field label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  font-style: italic;
}
.solver-field input {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  font-size: 16px;
  color: var(--text-primary);
  background: var(--bg-color);
  outline: none;
  font-family: 'SF Mono', 'Menlo', monospace;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.solver-field input:focus { border-color: var(--primary-color); }
.solver-equation {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary);
  text-align: center;
  font-family: 'SF Mono', 'Menlo', monospace;
}
.solver-result {
  background: var(--bg-color);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sr-badge {
  align-self: flex-start;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  background: rgba(120, 120, 128, 0.12);
  color: var(--text-secondary);
}
.sr-badge.ok { background: rgba(var(--success-rgb), 0.14); color: var(--success-color); }
.sr-badge.warn { background: rgba(var(--warning-rgb), 0.14); color: var(--warning-color); }
.sr-line {
  font-size: 15px;
  color: var(--text-primary);
  font-family: 'SF Mono', 'Menlo', monospace;
}
.sr-line b { font-size: 17px; color: var(--primary-color); }
.sr-divider {
  height: 0.5px;
  background: var(--separator-color);
  margin: 4px 0;
}
.sr-extra {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* 任意方程 */
.free-solver-row {
  display: flex;
  gap: 8px;
}
.free-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  font-size: 15px;
  color: var(--text-primary);
  background: var(--bg-color);
  outline: none;
  font-family: 'SF Mono', 'Menlo', monospace;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.free-input:focus { border-color: var(--primary-color); }
.tool-primary-btn {
  border: none;
  border-radius: var(--radius-md);
  background: var(--primary-color);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  padding: 0 18px;
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}
.tool-primary-btn:hover { opacity: 0.9; }
.tool-primary-btn:active { transform: scale(0.96); }
.free-error {
  font-size: 12px;
  color: var(--danger-color);
}
.free-roots {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.free-root {
  font-size: 14px;
  font-family: 'SF Mono', 'Menlo', monospace;
  color: var(--text-primary);
}
.free-root b { color: var(--primary-color); font-size: 15px; }
.free-none {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ===== 统计 ===== */
.stats-input {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  font-size: 15px;
  color: var(--text-primary);
  background: var(--bg-color);
  outline: none;
  resize: vertical;
  font-family: 'SF Mono', 'Menlo', monospace;
  box-sizing: border-box;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.stats-input:focus { border-color: var(--primary-color); }
.stats-invalid {
  font-size: 12px;
  color: var(--warning-color);
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.stat-item {
  background: var(--bg-color);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.stat-item.highlight {
  background: rgba(var(--primary-rgb), 0.08);
}
.stat-label {
  font-size: 11px;
  color: var(--text-tertiary);
}
.stat-value {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  font-family: 'SF Mono', 'Menlo', monospace;
  word-break: break-all;
}
.stat-item.highlight .stat-value { color: var(--primary-color); }

/* ===== 日期 ===== */
.date-pair {
  display: flex;
  align-items: center;
  gap: 8px;
}
.date-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 9px 10px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-color);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.date-input:focus { border-color: var(--primary-color); }
.date-sep { color: var(--text-tertiary); font-weight: 700; }
.date-result {
  background: var(--bg-color);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.date-shift-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.shift-select {
  width: 72px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 8px 8px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-color);
  outline: none;
  cursor: pointer;
}
.shift-num {
  width: 88px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 9px 10px;
  font-size: 15px;
  color: var(--text-primary);
  background: var(--bg-color);
  outline: none;
  font-family: 'SF Mono', 'Menlo', monospace;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.shift-num:focus { border-color: var(--primary-color); }

/* ===== 进制 ===== */
.base-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.base-label {
  width: 76px;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.base-label sub { font-size: 10px; color: var(--text-tertiary); }
.base-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  font-size: 15px;
  color: var(--text-primary);
  background: var(--bg-color);
  outline: none;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.base-input:focus { border-color: var(--primary-color); }
.binary-grouped {
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: 'SF Mono', 'Menlo', monospace;
  word-break: break-all;
}

@media (max-width: 480px) {
  .tool-seg { padding: 10px 12px 6px; }
  .tool-seg-btn { font-size: 12px; }
  .tool-body { padding: 4px 12px 16px; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
