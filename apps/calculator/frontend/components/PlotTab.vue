<template>
  <div class="plot-tab">
    <!-- 函数列表 + 工具条 -->
    <div class="plot-toolbar">
      <div class="fn-list">
        <div
          v-for="(fn, idx) in functions"
          :key="idx"
          class="fn-row"
          :class="{ 'fn-error': fn.error, 'fn-hidden': !fn.visible }"
        >
          <span class="fn-dot" :style="{ background: fn.visible ? fn.color : 'transparent', borderColor: fn.color }" @click="toggleVisible(fn)" :title="fn.visible ? '隐藏曲线' : '显示曲线'"></span>
          <span class="fn-prefix" :style="{ color: fn.color }">f=</span>
          <input
            v-model="fn.expr"
            class="fn-input"
            placeholder="如 sin(x)、x^2-2x"
            spellcheck="false"
            @input="onExprInput(fn)"
          />
          <span v-if="fn.error" class="fn-error-tip" :title="fn.error"><i class="fa-solid fa-triangle-exclamation"></i></span>
          <button v-if="functions.length > 1" class="fn-del" @click="removeFn(idx)" aria-label="删除函数">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <button v-if="functions.length < 5" class="fn-add" @click="addFn">
          <i class="fa-solid fa-plus"></i> 添加函数
        </button>
      </div>
      <div class="plot-actions">
        <span class="mode-badge" :class="{ active: angleMode === 'DEG' }" @click="setAngle('DEG')">DEG</span>
        <span class="mode-badge" :class="{ active: angleMode === 'RAD' }" @click="setAngle('RAD')">RAD</span>
        <button class="plot-btn" :class="{ active: traceMode }" @click="traceMode = !traceMode" title="描点：按住查看曲线上点的坐标">
          <i class="fa-solid fa-crosshairs"></i> 描点
        </button>
        <button class="plot-btn icon" @click="zoomBy(1.25)" title="放大"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
        <button class="plot-btn icon" @click="zoomBy(0.8)" title="缩小"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
        <button class="plot-btn icon" @click="resetView" title="复位视图"><i class="fa-solid fa-arrows-rotate"></i></button>
      </div>
    </div>

    <!-- 画布 -->
    <div class="plot-canvas-wrap" ref="wrap">
      <canvas ref="canvas"></canvas>
      <div class="plot-empty" v-if="!hasVisibleCurve">
        <i class="fa-solid fa-chart-line"></i>
        <p>在上方输入函数开始绘图</p>
        <span>支持 sin(x)、x^2、1/x 等</span>
      </div>
    </div>
  </div>
</template>

<script>
import { evaluate } from '../calc-parser.js';

// 曲线颜色（iOS 色板循环，最多 5 条）
var FN_COLORS = ['#007AFF', '#FF3B30', '#FF9500', '#34C759', '#AF52DE'];

// 视图默认状态
var DEFAULT_SCALE = 48;          // 每单位像素
var DEFAULT_CENTER = { x: 0, y: 0 };

// 刻度取整（nice number）：1/2/5 × 10^k
function niceStep(raw) {
  if (raw <= 0 || !isFinite(raw)) return 1;
  var exp = Math.floor(Math.log10(raw));
  var base = Math.pow(10, exp);
  var frac = raw / base;
  if (frac < 1.5) return base;
  if (frac < 3.5) return 2 * base;
  if (frac < 7.5) return 5 * base;
  return 10 * base;
}

// 坐标轴标签格式化
function formatTick(v, step) {
  if (Math.abs(v) < step * 1e-6) return '0';
  var decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  if (decimals > 8) decimals = 8;
  var s = v.toFixed(decimals);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

// 曲线取值格式化（描点读数）
function formatValue(v) {
  if (!isFinite(v)) return String(v);
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0)) {
    return parseFloat(v.toExponential(6)).toString();
  }
  return String(parseFloat(v.toPrecision(8)));
}

export default {
  name: 'PlotTab',
  props: {
    angleMode: { type: String, default: 'RAD' }
  },
  data: function() {
    return {
      functions: [
        { expr: 'sin(x)', visible: true, color: FN_COLORS[0], error: '' }
      ],
      fnColors: FN_COLORS,
      cx: DEFAULT_CENTER.x,
      cy: DEFAULT_CENTER.y,
      scale: DEFAULT_SCALE,
      traceMode: false,
      // 描点状态（绘制在 canvas 上，非响应式渲染路径）
      trace: null
    };
  },
  computed: {
    // 是否有可绘制的曲线（可见 + 非空 + 无语法错误）
    hasVisibleCurve: function() {
      for (var i = 0; i < this.functions.length; i++) {
        var fn = this.functions[i];
        if (fn.visible && fn.expr && fn.expr.trim() && !fn.error) return true;
      }
      return false;
    }
  },
  watch: {
    angleMode: function() {
      this.validateAll();
      this.draw();
    }
  },
  mounted: function() {
    var self = this;
    self.validateAll();
    self._setupCanvas();
    self._bindEvents();
    self.$nextTick(function() { self.draw(); });
    // 容器尺寸变化（含页签切换后重挂载、窗口旋转）
    if (typeof ResizeObserver !== 'undefined') {
      self._ro = new ResizeObserver(function() { self._resizeAndDraw(); });
      self._ro.observe(self.$refs.wrap);
    } else {
      self._winResize = function() { self._resizeAndDraw(); };
      window.addEventListener('resize', self._winResize);
    }
  },
  beforeDestroy: function() {
    var self = this;
    if (self._ro) self._ro.disconnect();
    if (self._winResize) window.removeEventListener('resize', self._winResize);
    var canvas = self.$refs.canvas;
    if (canvas) {
      canvas.removeEventListener('touchstart', self._onTouchStart);
      canvas.removeEventListener('touchmove', self._onTouchMove);
      canvas.removeEventListener('touchend', self._onTouchEnd);
      canvas.removeEventListener('mousedown', self._onMouseDown);
      canvas.removeEventListener('mousemove', self._onMouseMove);
      window.removeEventListener('mouseup', self._onMouseUp);
      canvas.removeEventListener('wheel', self._onWheel);
    }
  },
  methods: {
    setAngle: function(mode) {
      if (this.angleMode !== mode) this.$emit('set-angle', mode);
    },
    // ===== 函数行管理 =====
    addFn: function() {
      if (this.functions.length >= 5) return;
      this.functions.push({
        expr: '',
        visible: true,
        color: FN_COLORS[this.functions.length % FN_COLORS.length],
        error: ''
      });
    },
    removeFn: function(idx) {
      this.functions.splice(idx, 1);
      this.draw();
    },
    toggleVisible: function(fn) {
      fn.visible = !fn.visible;
      this.draw();
    },
    onExprInput: function(fn) {
      fn.error = this.validateExpr(fn.expr);
      this.draw();
    },
    validateExpr: function(expr) {
      if (!expr || !expr.trim()) return '';
      try {
        evaluate(expr, { mode: this.angleMode, variables: { x: 1 } });
        return '';
      } catch (e) {
        return e.message;
      }
    },
    validateAll: function() {
      for (var i = 0; i < this.functions.length; i++) {
        this.functions[i].error = this.validateExpr(this.functions[i].expr);
      }
    },
    // ===== 画布 =====
    _setupCanvas: function() {
      var wrap = this.$refs.wrap;
      var canvas = this.$refs.canvas;
      if (!wrap || !canvas) return;
      var rect = wrap.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      this._cssW = rect.width;
      this._cssH = rect.height;
      this._dpr = dpr;
    },
    _resizeAndDraw: function() {
      this._setupCanvas();
      this.draw();
    },
    // 数学坐标 ↔ 画布坐标
    toPx: function(mx) { return this._cssW / 2 + (mx - this.cx) * this.scale; },
    toPy: function(my) { return this._cssH / 2 - (my - this.cy) * this.scale; },
    fromPx: function(px) { return this.cx + (px - this._cssW / 2) / this.scale; },
    fromPy: function(py) { return this.cy - (py - this._cssH / 2) / this.scale; },

    draw: function() {
      var canvas = this.$refs.canvas;
      if (!canvas || !this._cssW) return;
      var ctx = canvas.getContext('2d');
      var dpr = this._dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var w = this._cssW;
      var h = this._cssH;
      ctx.clearRect(0, 0, w, h);

      // 背景
      ctx.fillStyle = getComputedStyleColor('--card-bg', '#ffffff');
      ctx.fillRect(0, 0, w, h);

      this._drawGrid(ctx, w, h);
      this._drawCurves(ctx, w, h);
      if (this.trace) this._drawTrace(ctx);
    },
    _drawGrid: function(ctx, w, h) {
      var stepX = niceStep(80 / this.scale);
      var stepY = niceStep(80 / this.scale);
      var x0 = Math.ceil(this.fromPx(0) / stepX) * stepX;
      var x1 = this.fromPx(w);
      var y0 = Math.ceil(this.fromPy(h) / stepY) * stepY;
      var y1 = this.fromPy(0);

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(120, 120, 128, 0.14)';
      ctx.beginPath();
      for (var gx = x0; gx <= x1; gx += stepX) {
        var px = Math.round(this.toPx(gx)) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
      }
      for (var gy = y0; gy <= y1; gy += stepY) {
        var py = Math.round(this.toPy(gy)) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
      }
      ctx.stroke();

      // 坐标轴
      var axisX = this.toPy(0);
      var axisY = this.toPx(0);
      ctx.strokeStyle = 'rgba(60, 60, 67, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (axisX >= 0 && axisX <= h) { ctx.moveTo(0, axisX); ctx.lineTo(w, axisX); }
      if (axisY >= 0 && axisY <= w) { ctx.moveTo(axisY, 0); ctx.lineTo(axisY, h); }
      ctx.stroke();

      // 刻度标签
      ctx.fillStyle = 'rgba(60, 60, 67, 0.55)';
      ctx.font = '10px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      var labelY = Math.min(Math.max(axisX + 4, 2), h - 14);
      for (var lx = x0; lx <= x1; lx += stepX) {
        if (Math.abs(lx) < stepX * 1e-6) continue;
        ctx.fillText(formatTick(lx, stepX), this.toPx(lx), labelY);
      }
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      var labelX = Math.min(Math.max(axisY - 6, 24), w - 4);
      for (var ly = y0; ly <= y1; ly += stepY) {
        if (Math.abs(ly) < stepY * 1e-6) continue;
        ctx.fillText(formatTick(ly, stepY), labelX, this.toPy(ly));
      }
    },
    _evalFn: function(expr, x) {
      return evaluate(expr, { mode: this.angleMode, variables: { x: x } });
    },
    _drawCurves: function(ctx, w, h) {
      for (var i = 0; i < this.functions.length; i++) {
        var fn = this.functions[i];
        if (!fn.visible || !fn.expr || !fn.expr.trim() || fn.error) continue;
        ctx.strokeStyle = fn.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        var drawing = false;
        var prevPy = null;
        for (var px = 0; px <= w; px += 1) {
          var mx = this.fromPx(px);
          var y;
          try { y = this._evalFn(fn.expr, mx); } catch (e) { y = NaN; }
          if (!isFinite(y) || Math.abs(y) > 1e9) {
            drawing = false;
            prevPy = null;
            continue;
          }
          var py = this.toPy(y);
          // 相邻点跳变过大 → 渐近线断线
          if (drawing && prevPy !== null && Math.abs(py - prevPy) > h * 1.5) {
            drawing = false;
          }
          if (!drawing) {
            ctx.moveTo(px, py);
            drawing = true;
          } else {
            ctx.lineTo(px, py);
          }
          prevPy = py;
        }
        ctx.stroke();
      }
    },
    _drawTrace: function(ctx) {
      var t = this.trace;
      if (!t || !isFinite(t.py)) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(60, 60, 67, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(t.px, 0);
      ctx.lineTo(t.px, this._cssH);
      ctx.moveTo(0, t.py);
      ctx.lineTo(this._cssW, t.py);
      ctx.stroke();
      ctx.setLineDash([]);
      // 曲线上的点
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.arc(t.px, t.py, 4, 0, Math.PI * 2);
      ctx.fill();
      // 读数气泡
      var text = 'x=' + formatValue(t.mx) + '  f=' + formatValue(t.my);
      ctx.font = '12px -apple-system, system-ui, sans-serif';
      var tw = ctx.measureText(text).width;
      var bx = Math.min(Math.max(t.px + 10, 4), this._cssW - tw - 20);
      var by = Math.min(Math.max(t.py - 30, 4), this._cssH - 26);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      roundRect(ctx, bx, by, tw + 16, 22, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 8, by + 11);
      ctx.restore();
    },
    // ===== 交互 =====
    _bindEvents: function() {
      var self = this;
      var canvas = self.$refs.canvas;
      self._onTouchStart = function(e) { self._touchStart(e); };
      self._onTouchMove = function(e) { self._touchMove(e); };
      self._onTouchEnd = function(e) { self._touchEnd(e); };
      self._onMouseDown = function(e) { self._mouseDown(e); };
      self._onMouseMove = function(e) { self._mouseMove(e); };
      self._onMouseUp = function(e) { self._mouseUp(e); };
      self._onWheel = function(e) { self._wheel(e); };
      canvas.addEventListener('touchstart', self._onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', self._onTouchMove, { passive: false });
      canvas.addEventListener('touchend', self._onTouchEnd);
      canvas.addEventListener('mousedown', self._onMouseDown);
      canvas.addEventListener('mousemove', self._onMouseMove);
      window.addEventListener('mouseup', self._onMouseUp);
      canvas.addEventListener('wheel', self._onWheel, { passive: false });
    },
    _pos: function(e) {
      var rect = this.$refs.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    _touchStart: function(e) {
      if (e.touches.length === 1) {
        var p = this._pos(e.touches[0]);
        this._touchP = p;
        this._lastP = p;
        if (this.traceMode) this._updateTrace(p);
        e.preventDefault();
      } else if (e.touches.length === 2) {
        this.trace = null;
        this._lastP = null;
        this._pinch = this._pinchState(e.touches);
        e.preventDefault();
      }
    },
    _touchMove: function(e) {
      if (e.touches.length === 1 && this._touchP) {
        var p = this._pos(e.touches[0]);
        if (this.traceMode) {
          this._updateTrace(p);
        } else {
          this._pan(p);
        }
        e.preventDefault();
      } else if (e.touches.length === 2 && this._pinch) {
        this._applyPinch(this._pinchState(e.touches));
        e.preventDefault();
      }
    },
    _touchEnd: function(e) {
      if (e.touches.length === 0) {
        this._touchP = null;
        this._pinch = null;
        this._lastP = null;
        if (this.trace && !this.traceMode) { this.trace = null; this.draw(); }
      }
    },
    _pinchState: function(touches) {
      var a = this._pos(touches[0]);
      var b = this._pos(touches[1]);
      return {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      };
    },
    _applyPinch: function(state) {
      var factor = state.dist / Math.max(1, this._pinch.dist);
      this._zoomAround(this._pinch.mid, this.scale * factor);
      this._pinch = state;
    },
    _mouseDown: function(e) {
      this._mouseP = this._pos(e);
      this._lastP = this._mouseP;
      if (this.traceMode) this._updateTrace(this._mouseP);
    },
    _mouseMove: function(e) {
      if (!this._mouseP) return;
      var p = this._pos(e);
      if (this.traceMode) this._updateTrace(p);
      else this._pan(p);
    },
    _mouseUp: function() {
      this._mouseP = null;
      this._lastP = null;
      if (this.trace && !this.traceMode) { this.trace = null; this.draw(); }
    },
    _wheel: function(e) {
      e.preventDefault();
      var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this._zoomAround(this._pos(e), this.scale * factor);
    },
    _pan: function(p) {
      var last = this._lastP;
      if (!last) { this._lastP = p; return; }
      this._panBy(p.x - last.x, p.y - last.y);
      this._lastP = p;
    },
    _zoomAround: function(anchorPx, newScale) {
      newScale = Math.min(4000, Math.max(2, newScale));
      // 保持锚点的数学坐标不变
      var mx = this.fromPx(anchorPx.x);
      var my = this.fromPy(anchorPx.y);
      this.scale = newScale;
      this.cx = mx - (anchorPx.x - this._cssW / 2) / newScale;
      this.cy = my + (anchorPx.y - this._cssH / 2) / newScale;
      this.draw();
    },
    zoomBy: function(factor) {
      this._zoomAround({ x: this._cssW / 2, y: this._cssH / 2 }, this.scale * factor);
    },
    resetView: function() {
      this.cx = DEFAULT_CENTER.x;
      this.cy = DEFAULT_CENTER.y;
      this.scale = DEFAULT_SCALE;
      this.trace = null;
      this.draw();
    },
    _panBy: function(dxPx, dyPx) {
      this.cx -= dxPx / this.scale;
      this.cy += dyPx / this.scale;
      this.draw();
    },
    _updateTrace: function(p) {
      var mx = this.fromPx(p.x);
      var best = null;
      for (var i = 0; i < this.functions.length; i++) {
        var fn = this.functions[i];
        if (!fn.visible || !fn.expr || !fn.expr.trim() || fn.error) continue;
        var y;
        try { y = this._evalFn(fn.expr, mx); } catch (e) { y = NaN; }
        if (!isFinite(y)) continue;
        var py = this.toPy(y);
        var dist = Math.abs(py - p.y);
        if (!best || dist < best.dist) {
          best = { dist: dist, px: p.x, py: py, mx: mx, my: y, color: fn.color };
        }
      }
      this.trace = best;
      this.draw();
    }
  }
};

// 圆角矩形路径（旧内核兼容：不依赖 ctx.roundRect）
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// 读取 CSS 变量颜色（canvas 不继承 CSS 变量，需手动取）
function getComputedStyleColor(varName, fallback) {
  var v = getComputedStyle(document.documentElement).getPropertyValue(varName);
  v = v && v.trim();
  return v || fallback;
}
</script>

<style scoped>
.plot-tab {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  overflow: hidden;
}
.plot-toolbar {
  padding: 12px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}
.fn-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fn-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  border: 1px solid var(--separator-color);
  box-shadow: var(--shadow-xs);
}
.fn-row.fn-error { border-color: rgba(var(--danger-rgb), 0.5); }
.fn-row.fn-hidden { opacity: 0.45; }
.fn-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2.5px solid transparent;
  flex-shrink: 0;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-standard);
}
.fn-dot:hover { transform: scale(1.15); }
.fn-prefix {
  font-size: 13px;
  font-weight: 700;
  font-family: 'SF Mono', 'Menlo', monospace;
  flex-shrink: 0;
}
.fn-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 15px;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
}
.fn-error-tip {
  color: var(--danger-color);
  font-size: 12px;
  flex-shrink: 0;
}
.fn-del {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}
.fn-del:hover { background: rgba(var(--danger-rgb), 0.12); color: var(--danger-color); }
.fn-add {
  align-self: flex-start;
  border: 1px dashed var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  padding: 6px 14px;
  border-radius: var(--radius-lg);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}
.fn-add:hover { background: rgba(var(--primary-rgb), 0.06); color: var(--primary-color); }

.plot-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mode-badge {
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  background: rgba(120, 120, 128, 0.12);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  user-select: none;
}
.mode-badge.active { background: var(--primary-color); color: #fff; }
.plot-btn {
  border: 1px solid var(--separator-color);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 5px 12px;
  border-radius: var(--radius-lg);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}
.plot-btn:hover { background: var(--surface-elevated); color: var(--text-primary); }
.plot-btn.active {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
}
.plot-btn.icon { width: 32px; justify-content: center; padding: 0; }

.plot-canvas-wrap {
  flex: 1;
  margin: 0 16px 16px;
  border-radius: var(--radius-xl);
  overflow: hidden;
  border: 0.5px solid var(--glass-border);
  box-shadow: var(--shadow-sm);
  min-height: 0;
  touch-action: none;
  position: relative;
}
.plot-empty {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-tertiary);
  pointer-events: none;
  background: var(--card-bg);
}
.plot-empty i { font-size: 34px; opacity: 0.4; margin-bottom: 6px; }
.plot-empty p { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-secondary); }
.plot-empty span { font-size: 12px; opacity: 0.7; }
.plot-canvas-wrap canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

@media (max-width: 480px) {
  .plot-toolbar { padding: 10px 12px 6px; }
  .plot-canvas-wrap { margin: 0 12px 12px; }
}
</style>
