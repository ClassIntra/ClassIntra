<template>
  <div class="convert-tab">
    <!-- 类别胶囊 -->
    <div class="category-row scrollbar-thin">
      <button
        v-for="cat in unitCategories"
        :key="cat.value"
        class="cat-pill"
        :class="{ active: converter.category === cat.value }"
        @click="switchCategory(cat.value)"
      >{{ cat.label }}</button>
    </div>

    <div class="convert-body scrollbar-thin">
      <!-- 输入卡 -->
      <div class="convert-card">
        <div class="cc-label">输入</div>
        <div class="cc-row">
          <input
            v-model="converter.value"
            type="text"
            class="cc-input"
            placeholder="数值或表达式，如 1/3"
            spellcheck="false"
            autocomplete="off"
          />
          <select v-model="converter.fromUnit" class="cc-select">
            <option v-for="u in currentUnits" :key="u.value" :value="u.value">{{ u.label }}</option>
          </select>
        </div>
        <div v-if="inputError" class="cc-error">{{ inputError }}</div>
      </div>

      <!-- 交换 -->
      <div class="convert-swap-row">
        <button class="convert-swap" @click="swapUnits" title="交换单位">
          <i class="fa-solid fa-right-left"></i>
        </button>
      </div>

      <!-- 结果卡 -->
      <div class="convert-card output">
        <div class="cc-label">结果</div>
        <div class="cc-row">
          <div class="cc-output" :class="{ 'cc-output-long': (converterResult || '').length > 14 }">{{ converterResult || '—' }}</div>
          <select v-model="converter.toUnit" class="cc-select">
            <option v-for="u in currentUnits" :key="u.value" :value="u.value">{{ u.label }}</option>
          </select>
        </div>
        <button v-if="converterResult" class="cc-copy" @click="copyResult">
          <i class="fa-regular fa-copy"></i> 复制
        </button>
      </div>

      <div v-if="convertHint" class="cc-hint">{{ convertHint }}</div>
    </div>
  </div>
</template>

<script>
import { evaluate } from '../calc-parser.js';

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
  },
  {
    value: 'angle', label: '角度',
    units: [
      { value: 'deg', label: '度 °', factor: 1 },
      { value: 'rad', label: '弧度 rad', factor: 180 / Math.PI },
      { value: 'grad', label: '梯度 gon', factor: 0.9 },
      { value: 'turn', label: '圈 turn', factor: 360 }
    ]
  },
  {
    value: 'pressure', label: '压力',
    units: [
      { value: 'Pa', label: '帕斯卡 Pa', factor: 1 },
      { value: 'kPa', label: '千帕 kPa', factor: 1000 },
      { value: 'MPa', label: '兆帕 MPa', factor: 1000000 },
      { value: 'bar', label: '巴 bar', factor: 100000 },
      { value: 'atm', label: '标准大气压 atm', factor: 101325 },
      { value: 'mmHg', label: '毫米汞柱 mmHg', factor: 133.322 },
      { value: 'psi', label: '磅/平方英寸 psi', factor: 6894.757 }
    ]
  },
  {
    value: 'energy', label: '能量',
    units: [
      { value: 'J', label: '焦耳 J', factor: 1 },
      { value: 'kJ', label: '千焦 kJ', factor: 1000 },
      { value: 'cal', label: '卡路里 cal', factor: 4.186 },
      { value: 'kcal', label: '千卡 kcal', factor: 4186 },
      { value: 'Wh', label: '瓦时 Wh', factor: 3600 },
      { value: 'kWh', label: '千瓦时 kWh', factor: 3600000 },
      { value: 'eV', label: '电子伏 eV', factor: 1.602176634e-19 }
    ]
  },
  {
    value: 'power', label: '功率',
    units: [
      { value: 'W', label: '瓦特 W', factor: 1 },
      { value: 'kW', label: '千瓦 kW', factor: 1000 },
      { value: 'MW', label: '兆瓦 MW', factor: 1000000 },
      { value: 'hp', label: '马力(公制)', factor: 735.49875 },
      { value: 'ftlb', label: '英尺·磅/秒', factor: 1.35582 }
    ]
  }
];

var CONVERT_CAT_KEY = 'classintra_calc_convert_cat';

export default {
  name: 'ConvertTab',
  data: function() {
    var savedCat = '';
    try { savedCat = localStorage.getItem(CONVERT_CAT_KEY) || ''; } catch (e) {}
    var category = 'length';
    for (var i = 0; i < UNIT_CATEGORIES.length; i++) {
      if (UNIT_CATEGORIES[i].value === savedCat) { category = savedCat; break; }
    }
    return {
      unitCategories: UNIT_CATEGORIES,
      converter: {
        category: category,
        value: '1',
        fromUnit: '',
        toUnit: ''
      }
    };
  },
  computed: {
    currentUnits: function() {
      var cats = this.unitCategories;
      for (var i = 0; i < cats.length; i++) {
        if (cats[i].value === this.converter.category) return cats[i].units;
      }
      return [];
    },
    // 输入支持表达式（如 1/3、2^10）
    parsedValue: function() {
      var raw = String(this.converter.value || '').trim();
      if (!raw) return NaN;
      var n = Number(raw);
      if (isFinite(n)) return n;
      try {
        var v = evaluate(raw, { mode: 'RAD', variables: {} });
        return isFinite(v) ? v : NaN;
      } catch (e) {
        return NaN;
      }
    },
    inputError: function() {
      var raw = String(this.converter.value || '').trim();
      if (!raw) return '';
      return isNaN(this.parsedValue) ? '无法识别的表达式' : '';
    },
    converterResult: function() {
      return this._doConvert();
    },
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
  mounted: function() {
    // 类别切换后确保 from/to 落在合法单位上
    var units = this.currentUnits;
    var fromOk = false;
    var toOk = false;
    for (var i = 0; i < units.length; i++) {
      if (units[i].value === this.converter.fromUnit) fromOk = true;
      if (units[i].value === this.converter.toUnit) toOk = true;
    }
    if (!fromOk || !toOk) {
      this.converter.fromUnit = units[0] ? units[0].value : '';
      this.converter.toUnit = units[1] ? units[1].value : '';
    }
  },
  methods: {
    switchCategory: function(cat) {
      this.converter.category = cat;
      try { localStorage.setItem(CONVERT_CAT_KEY, cat); } catch (e) {}
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
    copyResult: function() {
      var self = this;
      var text = this.converterResult;
      if (!text) return;
      var done = function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '已复制', type: 'success' });
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function() { self._copyFallback(text, done); });
      } else {
        this._copyFallback(text, done);
      }
    },
    _copyFallback: function(text, done) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) {}
    },
    _findUnit: function(unitValue) {
      var units = this.currentUnits;
      for (var i = 0; i < units.length; i++) {
        if (units[i].value === unitValue) return units[i];
      }
      return null;
    },
    _doConvert: function() {
      var val = this.parsedValue;
      if (isNaN(val)) return '';
      var from = this._findUnit(this.converter.fromUnit);
      var to = this._findUnit(this.converter.toUnit);
      if (!from || !to) return '';
      if (this.converter.category === 'temperature') {
        return this._convertTemp(val, from.value, to.value);
      }
      var baseVal = val * from.factor;
      var result = baseVal / to.factor;
      return this._formatConvertResult(result);
    },
    _convertTemp: function(val, from, to) {
      var c;
      if (from === 'C') c = val;
      else if (from === 'F') c = (val - 32) * 5 / 9;
      else if (from === 'K') c = val - 273.15;
      else return '';
      var result;
      if (to === 'C') result = c;
      else if (to === 'F') result = c * 9 / 5 + 32;
      else if (to === 'K') result = c + 273.15;
      else return '';
      return this._formatConvertResult(result);
    },
    _formatConvertResult: function(result) {
      if (!isFinite(result)) return '';
      var str = parseFloat(result.toPrecision(12)).toString();
      return str;
    }
  }
};
</script>

<style scoped>
.convert-tab {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  overflow: hidden;
}
.category-row {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 12px 16px 8px;
  flex-shrink: 0;
}
.cat-pill {
  flex-shrink: 0;
  padding: 6px 16px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}
.cat-pill:hover { background: var(--surface-elevated); }
.cat-pill.active {
  background: var(--primary-color);
  color: #fff;
  border-color: var(--primary-color);
}

.convert-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 560px;
  width: 100%;
  margin: 0 auto;
}
.convert-card {
  background: var(--card-bg);
  border-radius: var(--radius-xl);
  border: 1px solid var(--separator-color);
  padding: 14px 16px;
  box-shadow: var(--shadow-sm);
}
.convert-card.output {
  background: var(--primary-light, rgba(var(--primary-rgb), 0.06));
  border-color: rgba(var(--primary-rgb), 0.2);
}
.cc-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}
.cc-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
}
.cc-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-color);
  outline: none;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.cc-input:focus { border-color: var(--primary-color); }
.cc-output {
  flex: 1;
  min-width: 0;
  padding: 12px 14px;
  font-size: 20px;
  font-weight: 600;
  color: var(--primary-color);
  word-break: break-all;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  display: flex;
  align-items: center;
}
.cc-output-long { font-size: 15px; }
.cc-select {
  width: 128px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0 10px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-color);
  outline: none;
  cursor: pointer;
}
.cc-error {
  margin-top: 8px;
  font-size: 12px;
  color: var(--danger-color);
}
.cc-copy {
  margin-top: 10px;
  border: none;
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--primary-color);
  font-size: 12px;
  padding: 5px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background var(--duration-fast) var(--ease-standard);
}
.cc-copy:hover { background: rgba(var(--primary-rgb), 0.18); }

.convert-swap-row {
  display: flex;
  justify-content: center;
}
.convert-swap {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--primary-light, rgba(var(--primary-rgb), 0.12));
  color: var(--primary-color);
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--duration-normal) var(--ease-standard), background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}
.convert-swap:hover { transform: rotate(180deg); background: var(--primary-color); color: #fff; }

.cc-hint {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: var(--card-bg);
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
}
</style>
