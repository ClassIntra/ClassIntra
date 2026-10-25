<template>
  <div class="big-text-stage" :class="stageClass" :style="[stageStyle, stageVars]">
    <div class="big-text-inner" :style="innerStyle">

      <!-- 走马灯：单行超长文本横向滚动（多行时按分隔符合并成一条） -->
      <div v-if="isScroll" class="big-text-scroll">
        <div
          class="big-text-scroll-track big-text-text"
          :class="{ 'is-centered': scrollSeconds <= 0 }"
          :style="[textStyle, textEffectStyle, scrollAnimStyle]"
        >
          <span ref="seg" class="bt-seg">{{ scrollText }}</span>
          <!-- 第二段用于无缝衔接：滚完一段时下一段已接上，不会出现空屏 -->
          <span v-if="scrollSeconds > 0" class="bt-seg" aria-hidden="true">{{ scrollText }}</span>
        </div>
      </div>

      <!-- 轮播：逐行切换，间隔由管理端设定 -->
      <div v-else-if="isCarousel" class="big-text-carousel">
        <transition name="bt-line" mode="out-in">
          <p :key="lineIndex" class="big-text-text big-text-line" :style="[textStyle, textEffectStyle]">{{ lines[lineIndex] }}</p>
        </transition>
      </div>

      <!-- 静态：整段显示（保留换行） -->
      <p v-else class="big-text-text big-text-line is-static" :style="[textStyle, textEffectStyle]">{{ fullText }}</p>

      <!-- 副内容：补充说明，比主文小一档 -->
      <p v-if="subContent" class="big-text-sub" :style="subStyle">{{ subContent }}</p>

      <!-- 署名（管理端可关闭） -->
      <p v-if="showSender && senderName" class="big-text-sender" :style="senderStyle">— {{ senderName }}</p>

      <!-- 轮播页码点：让用户知道还有几条 -->
      <div v-if="isCarousel && showDots" class="big-text-dots" aria-hidden="true">
        <span
          v-for="(line, i) in lines"
          :key="i"
          class="bt-dot"
          :class="{ active: i === lineIndex }"
          :style="dotStyle(i)"
        ></span>
      </div>
    </div>

    <!-- 倒计时进度条 + 驻留提示：原来在 BigTextOverlay 外壳里，预览因此少画一块。
         移入舞台后预览与真机逐像素同源；颜色跟随字体色（白底大字也不会看不见）。 -->
    <div class="big-text-progress" :style="{ color: chromeColor }" aria-hidden="true">
      <div class="big-text-progress-bar" :style="progressStyle"></div>
    </div>
    <div class="big-text-hint" :style="{ color: chromeColor }" aria-hidden="true">
      <template v-if="dwellElapsed">轻触关闭（{{ remainSeconds }}s）</template>
      <template v-else>请阅读（{{ remainSeconds }}s）</template>
    </div>
  </div>
</template>

<script>
/**
 * BigTextStage — 大字内容的「唯一渲染实现」
 *
 * 这个组件是全屏大字外观的唯一真相来源，被两处复用：
 *   1. `BigTextOverlay.vue`（设备端全屏遮罩，传真实视口尺寸）
 *   2. 管理端「大字广播」面板的预览框（传预览框的实际像素尺寸）
 *
 * 之前管理端预览是自己另写的一套简化 DOM，只画单行纯色文字，导致
 * 轮播/走马灯/副内容/署名/渐变/炫彩全都没有，预览和设备对不上。
 * 收敛成同一个组件后，预览里看到的就是设备上会看到的，连换行位置和
 * 溢出裁切都一致。
 *
 * ⚠️ 所有尺寸都必须从 `stageWidth` / `stageHeight` 推导，**不能读 window**：
 *    设备端 stageWidth = 视口宽，预览端 = 预览框宽，同一套公式才能等比。
 *    字号基准是 1080 宽屏幕（管理端填的就是这个基准下的 px）。
 */

var REF_WIDTH = 1080;      // 字号/速度的设计基准宽度
var MIN_DWELL_RATIO = 0.9; // 文本宽度不足屏宽 90% 时不滚动
var MIN_DWELL_MS = 5000;   // 最短驻留：与 BigTextOverlay 的关闭宽限一致
var DURATION_MIN = 3;      // 与服务端 LIMITS.durationMin 一致
var DURATION_MAX = 600;

export default {
  name: 'BigTextStage',
  props: {
    // 与下发 payload 同构：content / sub_content / display_mode / effect / 各颜色与字号…
    config: {
      type: Object,
      default: function() { return {}; }
    },
    // 渲染目标宽度（px）。设备端传视口宽，预览端传预览框实际宽。
    stageWidth: {
      type: Number,
      default: 1080
    },
    stageHeight: {
      type: Number,
      default: 675
    },
    // false 时冻结动画（轮播不推进、走马灯暂停），供预览「暂停」用
    playing: {
      type: Boolean,
      default: true
    },
    showDots: {
      type: Boolean,
      default: true
    }
  },
  data: function() {
    return {
      lineIndex: 0,
      scrollSeconds: 0,
      carouselTimer: null,
      // 倒计时（进度条 + 驻留提示的唯一驱动源）。
      // ⚠️ remainMs 必须是响应式的：dwellElapsed / remainSeconds / progressStyle
      //    全靠它重算，用 Date.now() 直接算会让 computed 永远停在首次求值。
      remainMs: 0,
      startedAt: 0,
      tickTimer: null
    };
  },
  computed: {
    c: function() {
      return this.config || {};
    },

    // 相对 1080 基准的缩放系数：平板 1043 宽 → 0.97；预览框 420 宽 → 0.39
    scaleFactor: function() {
      var w = this.stageWidth || REF_WIDTH;
      return Math.min(1, w / REF_WIDTH);
    },

    lines: function() {
      var raw = String(this.c.content || '');
      var parts = raw.split(/\r?\n/);
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        var s = parts[i].replace(/^\s+|\s+$/g, '');
        if (s) out.push(s);
      }
      return out.length ? out : [raw];
    },

    fullText: function() {
      return this.lines.join('\n');
    },

    isScroll: function() {
      return this.c.display_mode === 'scroll';
    },

    // 只有多行才需要轮播；单行时退化成静态，避免无意义的定时器
    isCarousel: function() {
      return this.c.display_mode === 'carousel' && this.lines.length > 1;
    },

    scrollText: function() {
      // 多行内容在走马灯里用全角空格拼成一条，保持可读的间隔
      return this.lines.join('　　');
    },

    subContent: function() {
      return this.c.sub_content || '';
    },

    showSender: function() {
      return this.c.show_sender !== false && this.c.show_sender !== 0;
    },

    senderName: function() {
      return this.c.sender_name || '';
    },

    stageClass: function() {
      var effect = this.c.effect || 'none';
      return 'effect-' + String(effect).replace(/_/g, '-');
    },

    // ⚠️ 必须用 setProperty 能识别的 `--x` 形式；Vue 2 会走 style.setProperty
    stageVars: function() {
      return {
        '--stage-w': Math.max(1, Math.round(this.stageWidth)) + 'px',
        '--stage-h': Math.max(1, Math.round(this.stageHeight)) + 'px',
        '--bt-scale': String(this.scaleFactor)
      };
    },

    stageStyle: function() {
      var c = this.c;
      // 炫彩：CSS 动画接管背景，不用内联色
      if (c.effect === 'rainbow') {
        return { background: 'linear-gradient(120deg, #ff2d55, #ff9500, #ffcc00, #34c759, #0a84ff, #af52de, #ff2d55)' };
      }
      if (c.bg_gradient && (c.effect === 'gradient_bg' || c.effect === 'gradient_text' || c.effect === 'neon')) {
        var g = c.bg_gradient;
        return { background: 'linear-gradient(' + (g.angle || 135) + 'deg, ' + g.from + ', ' + g.to + ')' };
      }
      return { background: c.bg_color || '#101828' };
    },

    innerStyle: function() {
      return { textAlign: this.c.text_align || 'center' };
    },

    // 字号按 stageWidth 同比缩放：管理端填的是 1080 基准 px，平板实际宽度
    // 可能只有 800，直接套用会溢出；预览框更小，同一公式下等比缩小。
    textStyle: function() {
      var base = parseInt(this.c.font_size, 10) || 120;
      var size = Math.max(1, Math.round(base * this.scaleFactor));
      return {
        color: this.c.font_color || '#ffffff',
        fontFamily: this.c.font_family_css || 'inherit',
        fontSize: size + 'px',
        fontWeight: this.c.font_weight || '700',
        lineHeight: '1.25',
        textAlign: this.c.text_align || 'center'
      };
    },

    // 渐变大字：background-clip:text 后文字本身要透明，颜色交给渐变
    textEffectStyle: function() {
      var c = this.c;
      if (c.effect !== 'gradient_text') return {};
      var g = c.text_gradient || { from: c.font_color || '#ffffff', to: '#FFD166', angle: 90 };
      return {
        backgroundImage: 'linear-gradient(' + (g.angle || 90) + 'deg, ' + g.from + ', ' + g.to + ', ' + g.from + ')',
        backgroundSize: '200% auto',
        webkitBackgroundClip: 'text',
        backgroundClip: 'text',
        webkitTextFillColor: 'transparent',
        color: 'transparent'
      };
    },

    // 走马灯：匀速向左，位移 = 一整段（-50%），第二段顶上形成无缝循环。
    // scrollSeconds <= 0 表示内容本来就放得下，不滚动、居中静态显示。
    scrollAnimStyle: function() {
      if (this.scrollSeconds <= 0) return {};
      return {
        animation: 'bt-marquee ' + this.scrollSeconds + 's linear infinite',
        animationPlayState: this.playing ? 'running' : 'paused'
      };
    },

    subStyle: function() {
      var base = parseInt(this.c.font_size, 10) || 120;
      // 现在 1080 基准上钳制，再乘缩放系数 —— 这样预览里的大小比例和真机一致
      var ref = Math.max(18, Math.min(56, Math.round(base * 0.34)));
      return {
        fontSize: Math.max(1, Math.round(ref * this.scaleFactor)) + 'px',
        color: this.c.font_color || '#ffffff'
      };
    },

    // 署名：原来写的是 `font-size: 0.28em`，em 相对父级 16px 解析 → 只有 4.5px，
    // 屏幕上几乎是不可见的一粒小点（截图已实证）。改为按主字号推导。
    senderStyle: function() {
      var base = parseInt(this.c.font_size, 10) || 120;
      var ref = Math.max(13, Math.min(38, Math.round(base * 0.22)));
      return { fontSize: Math.max(1, Math.round(ref * this.scaleFactor)) + 'px' };
    },

    // ===== 倒计时（进度条 / 驻留提示）=====
    // 总时长与服务端钳制口径一致（3~600s），预览里填超界值也按设备实际行为算
    countdownTotal: function() {
      var d = parseInt(this.c.duration, 10);
      if (isNaN(d)) d = 10;
      return Math.max(DURATION_MIN, Math.min(DURATION_MAX, d)) * 1000;
    },

    remainSeconds: function() {
      return Math.max(0, Math.ceil(this.remainMs / 1000));
    },

    // 是否已过最短驻留期：决定提示文案（请阅读 → 轻触关闭）
    dwellElapsed: function() {
      if (this.remainMs <= 0) return true;
      // ⚠️ countdownTotal 是 computed（属性），不能加括号调用 —— 曾写成
      //    this.countdownTotal() 报「is not a function」，整个舞台渲染崩掉。
      return (this.countdownTotal - this.remainMs) >= MIN_DWELL_MS;
    },

    progressStyle: function() {
      var total = this.countdownTotal;
      var pct = total > 0 ? Math.max(0, Math.min(100, (this.remainMs / total) * 100)) : 0;
      return { width: pct + '%' };
    },

    // 进度条/提示跟随字体色：白字白底的大字原来用固定白，等于看不见
    chromeColor: function() {
      return this.c.font_color || '#ffffff';
    }
  },
  watch: {
    // 换内容/换模式/换样式都要重新算滚动时长并回到第一条
    config: {
      deep: true,
      handler: function(n, o) {
        this.lineIndex = 0;
        this.restart();
        // 倒计时只在「换了另一条广播」（id 变）时重启：预览里边改样式边重播
        // 会一直打回起点，反而看不出剩余时间；设备端每条广播 id 唯一，天然对齐。
        if (n && o && String(n.id) !== String(o.id)) this.startCountdown();
      }
    },
    stageWidth: function() {
      this.restart();
    },
    playing: function(v) {
      if (v) {
        this.restart();
        this.resumeCountdown();
      } else {
        this.freezeCountdown();   // 暂停=冻结倒计时，不归零
      }
    }
  },
  methods: {
    // 「重播」：轮播回到第一条，走马灯重新测宽
    restart: function() {
      var self = this;
      this.stopCarousel();
      this.lineIndex = 0;
      this.updateScrollDuration();
      this.$nextTick(function() {
        if (self.playing) self.startCarousel();
      });
    },

    // ===== 倒计时 =====
    startCountdown: function() {
      this.stopCountdown();
      this.remainMs = this.countdownTotal;
      this.startedAt = Date.now();
      this.tickCountdown();
    },

    freezeCountdown: function() {
      this.stopCountdown();     // remainMs 保持当前值，恢复时接着走
    },

    resumeCountdown: function() {
      this.stopCountdown();
      if (this.remainMs <= 0) { this.startCountdown(); return; }
      this.startedAt = Date.now() - (this.countdownTotal - this.remainMs);
      this.tickCountdown();
    },

    stopCountdown: function() {
      if (this.tickTimer) {
        clearTimeout(this.tickTimer);
        this.tickTimer = null;
      }
    },

    tickCountdown: function() {
      var self = this;
      var step = function() {
        if (!self.playing) return;    // 冻结后由 resumeCountdown 重启
        var total = self.countdownTotal;
        var elapsed = Date.now() - self.startedAt;
        self.remainMs = Math.max(0, total - elapsed);
        if (self.remainMs <= 0) {
          // 预览里到点自动循环，方便反复核对节奏；设备端到点由外层
          // BigTextOverlay 整体隐藏，看不到这一圈重启。
          self.remainMs = total;
          self.startedAt = Date.now();
        }
        self.tickTimer = window.setTimeout(step, 200);
      };
      this.tickTimer = window.setTimeout(step, 200);
    },

    startCarousel: function() {
      var self = this;
      // 先清再起：restart 是异步调度的，连续触发时不清会留下野定时器导致跳条
      this.stopCarousel();
      if (!this.isCarousel || !this.playing) return;
      var interval = Math.max(2, parseInt(this.c.switch_interval, 10) || 5) * 1000;
      this.carouselTimer = window.setInterval(function() {
        self.lineIndex = (self.lineIndex + 1) % self.lines.length;
      }, interval);
    },

    stopCarousel: function() {
      if (this.carouselTimer) {
        clearInterval(this.carouselTimer);
        this.carouselTimer = null;
      }
    },

    /**
     * 走马灯时长 = 文本在「1080 基准」上的宽度 / 速度。
     *
     * 为什么要折算回 1080 基准：preview 框只有 400 多像素宽，如果直接拿渲染
     * 后的实测宽度算，小框里的字同样速度就会几秒划完，看起来比真机快一倍，
     * 预览就失去意义。折算之后「每秒划过多少个屏宽」在所有尺寸上一致。
     */
    updateScrollDuration: function() {
      var self = this;
      if (!this.isScroll) {
        this.scrollSeconds = 0;
        return;
      }
      this.$nextTick(function() {
        var el = self.$refs.seg;
        if (!el) return;
        var scale = self.scaleFactor || 1;
        var rendered = el.getBoundingClientRect().width || 0;
        var w1080 = rendered / scale;            // 折算回 1080 基准
        if (w1080 <= REF_WIDTH * MIN_DWELL_RATIO) {
          self.scrollSeconds = 0;                // 放得下就不滚，避免无意义晃动
          return;
        }
        var speed = parseInt(self.c.scroll_speed, 10) || 60;
        // 段间距 12%（129.6px @1080）计入总距离，保证首尾拼接后节奏均匀
        self.scrollSeconds = Math.max(6, Math.round((w1080 + REF_WIDTH * 0.12) / speed));
      });
    },

    dotStyle: function(i) {
      var s = this.scaleFactor;
      return {
        width: Math.max(3, Math.round(7 * s)) + 'px',
        height: Math.max(3, Math.round(7 * s)) + 'px',
        // ⚠️ 原来用 currentColor，继承到的是默认黑色 —— 深色背景上页码点根本看不见
        background: this.c.font_color || '#ffffff'
      };
    }
  },
  mounted: function() {
    this.restart();
    this.startCountdown();
  },
  beforeDestroy: function() {
    this.stopCarousel();
    this.stopCountdown();
  }
};
</script>

<style scoped>
/* ========== 舞台 ========== */
/* 铺满父容器（设备端 = 视口，预览端 = 预览框），背景与特效都挂在这一层 */
.big-text-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.big-text-inner {
  width: 100%;
  max-width: calc(var(--stage-w, 1080px) * 0.92);
  max-height: calc(var(--stage-h, 675px) * 0.86);
  padding: 0 calc(var(--stage-w, 1080px) * 0.022);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* ========== 主文 ========== */
.big-text-text {
  margin: 0;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  word-break: break-word;
}

.big-text-line {
  width: 100%;
}

/* 静态多行：保留换行，紧凑行距 */
.big-text-line.is-static {
  white-space: pre-line;
}

/* 轮播：单帧占位，避免切换时高度跳动 */
.big-text-carousel {
  width: 100%;
  min-height: 1.3em;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ========== 走马灯 ========== */
.big-text-scroll {
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
}

/* 两段拼接的无缝轨道：位移 -50% 正好等于一段，滚完立刻接上第二段 */
.big-text-scroll-track {
  display: inline-flex;
  white-space: nowrap;
  will-change: transform;
}

/* 内容本来就放得下：不滚，居中静态显示 */
.big-text-scroll-track.is-centered {
  display: flex;
  width: 100%;
  justify-content: center;
}

.bt-seg {
  padding-right: calc(var(--stage-w, 1080px) * 0.12);
}

.big-text-scroll-track.is-centered .bt-seg {
  padding-right: 0;
}

@keyframes bt-marquee {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

/* ========== 副内容 / 署名 / 圆点 ========== */
.big-text-sub {
  margin: calc(0.7em) 0 0;
  opacity: 0.88;
  line-height: 1.45;
  max-width: calc(var(--stage-w, 1080px) * 0.88);
  word-break: break-word;
}

/* 字号由 senderStyle 按主字号推导后内联，这里只管排版 */
.big-text-sender {
  margin: calc(14px * var(--bt-scale, 1)) 0 0;
  opacity: 0.62;
  letter-spacing: 0.04em;
}

.big-text-dots {
  display: flex;
  gap: calc(8px * var(--bt-scale, 1));
  margin-top: calc(18px * var(--bt-scale, 1));
}

/* 尺寸与颜色由 dotStyle() 内联，避免 currentColor 继承成黑色 */
.bt-dot {
  border-radius: 50%;
  opacity: 0.26;
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.bt-dot.active {
  opacity: 0.9;
  transform: scale(1.25);
}

/* ========== 倒计时进度条与驻留提示（原 overlay 外壳 chrome） ========== */
/* 颜色走内联 currentColor（= 字体色），这里只定形态；尺寸随舞台等比 */
.big-text-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: calc(4px * var(--bt-scale, 1));
  background: currentColor;
  opacity: 0.16;
}

.big-text-progress-bar {
  height: 100%;
  background: currentColor;
  opacity: 1;
}

.big-text-hint {
  position: absolute;
  right: calc(22px * var(--bt-scale, 1));
  bottom: calc(18px * var(--bt-scale, 1));
  font-size: calc(12px * var(--bt-scale, 1));
  letter-spacing: 0.05em;
  opacity: 0.55;
  white-space: nowrap;
}

/* ========== 轮播切换动画 ========== */
.bt-line-enter-active,
.bt-line-leave-active {
  transition: opacity 0.32s ease, transform 0.32s ease;
}

.bt-line-enter {
  opacity: 0;
  transform: translateY(18px);
}

.bt-line-leave-to {
  opacity: 0;
  transform: translateY(-18px);
}

/* ========== 特效 ========== */

/* 炫彩背景：整屏流光 */
.effect-rainbow {
  background-size: 400% 400% !important;
  animation: bt-rainbow 8s linear infinite;
}

@keyframes bt-rainbow {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* 渐变背景：缓慢呼吸，比炫彩克制 */
.effect-gradient-bg {
  background-size: 200% 200% !important;
  animation: bt-breathe 7s ease-in-out infinite;
}

@keyframes bt-breathe {
  0%   { background-position: 0% 0%; }
  50%  { background-position: 100% 100%; }
  100% { background-position: 0% 0%; }
}

/* 渐变大字：渐变本身在流动 */
.effect-gradient-text .big-text-text {
  animation: bt-shine 4.5s linear infinite;
}

@keyframes bt-shine {
  0%   { background-position: 0% center; }
  100% { background-position: -200% center; }
}

/* 霓虹发光 */
.effect-neon .big-text-text {
  text-shadow:
    0 0 10px currentColor,
    0 0 28px currentColor,
    0 0 56px rgba(255, 255, 255, 0.35);
}
</style>
