<template>
  <transition name="celebration-fade">
    <div v-if="visible" class="birthday-celebration" @click="dismiss" @touchstart="dismiss">
      <!-- Canvas 粒子层：五彩纸屑 + 金色星点 -->
      <canvas ref="confettiCanvas" class="celebration-canvas"></canvas>

      <!-- CSS 气球层 -->
      <div class="balloons-layer">
        <div
          v-for="balloon in balloons"
          :key="balloon.id"
          class="balloon-wrap"
          :style="balloon.wrapStyle"
        >
          <div class="balloon-string" :style="{ height: balloon.stringLen + 'px' }"></div>
          <div
            class="balloon-body"
            :style="{ background: balloon.color, width: balloon.size + 'px', height: (balloon.size * 1.2) + 'px' }"
          >
            <div class="balloon-shine"></div>
            <div class="balloon-knot"></div>
          </div>
        </div>
      </div>

      <!-- 中央祝福卡片 -->
      <div class="greeting-card" :class="{ 'greeting-card--show': showCard }">
        <div class="greeting-glow"></div>
        <div class="greeting-inner">
          <div class="greeting-cake">
            <i class="fa-solid fa-cake-candles" aria-hidden="true"></i>
          </div>
          <div class="greeting-title">生日快乐</div>
          <div class="greeting-name">{{ userName }}</div>
          <div class="greeting-sub">愿你今天充满惊喜与欢乐</div>
        </div>
      </div>

      <!-- 底部提示 -->
      <div class="dismiss-hint" :class="{ 'dismiss-hint--show': showCard }">
        点击任意位置关闭
      </div>
    </div>
  </transition>
</template>

<script>
// ============ Confetti 粒子配置 ============
// 色盘与系统 iOS 多彩语义色对齐（global.scss 的 accent/semantic 值），
// Canvas 里读不到 CSS 变量，故用同一批硬编码色值并在此注明来源。
var CONFETTI_COLORS = [
  '#FF2D55', '#FF9500', '#FFCC00', '#34C759', '#007AFF',
  '#5856D6', '#AF52DE', '#5AC8FA', '#FF6482', '#FFB340'
];

var CONFETTI_COUNT = 120;
var STAR_COUNT = 30;

// 粒子形状
var SHAPES = ['rect', 'circle', 'triangle'];

function randomConfetti(canvasW, canvasH) {
  return {
    x: Math.random() * canvasW,
    y: -20 - Math.random() * canvasH * 0.6,
    w: 6 + Math.random() * 10,
    h: 4 + Math.random() * 8,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
    speedY: 1.5 + Math.random() * 3.5,
    speedX: -1 + Math.random() * 2,
    rotation: Math.random() * 360,
    rotSpeed: -3 + Math.random() * 6,
    sway: Math.random() * Math.PI * 2,
    swaySpeed: 0.01 + Math.random() * 0.03,
    swayAmp: 20 + Math.random() * 50,
    opacity: 0.7 + Math.random() * 0.3
  };
}

function randomStar(canvasW, canvasH) {
  return {
    x: Math.random() * canvasW,
    y: -10 - Math.random() * canvasH * 0.4,
    size: 2 + Math.random() * 4,
    speedY: 0.8 + Math.random() * 2,
    speedX: -0.5 + Math.random() * 1,
    opacity: 0.5 + Math.random() * 0.5,
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.03 + Math.random() * 0.06
  };
}

// ============ 气球生成 ============
// 气球色同样对齐 iOS 系统色盘（与 CONFETTI_COLORS 同源）
var BALLOON_COLORS = [
  'linear-gradient(135deg, #FF6482 0%, #FF2D55 100%)',
  'linear-gradient(135deg, #FFD54D 0%, #FFCC00 100%)',
  'linear-gradient(135deg, #5BD876 0%, #34C759 100%)',
  'linear-gradient(135deg, #3F9BFF 0%, #007AFF 100%)',
  'linear-gradient(135deg, #B45AFF 0%, #AF52DE 100%)',
  'linear-gradient(135deg, #FFB340 0%, #FF9500 100%)'
];

var BALLOON_COUNT = 12;

function randomBalloon(index) {
  var color = BALLOON_COLORS[index % BALLOON_COLORS.length];
  var size = 48 + Math.random() * 32;
  var left = 3 + Math.random() * 94;
  var delay = Math.random() * 1.5;
  var duration = 5 + Math.random() * 4;
  var sway = -20 + Math.random() * 40;
  var stringLen = 60 + Math.random() * 50;
  return {
    id: 'bal_' + index,
    color: color,
    size: size,
    stringLen: stringLen,
    wrapStyle: {
      left: left + '%',
      animationDelay: delay + 's',
      animationDuration: duration + 's',
      '--sway': sway + 'px'
    }
  };
}

export default {
  name: 'BirthdayCelebration',
  props: {
    userName: { type: String, default: '' }
  },
  data: function() {
    var balloons = [];
    for (var i = 0; i < BALLOON_COUNT; i++) {
      balloons.push(randomBalloon(i));
    }
    return {
      visible: true,
      showCard: false,
      confetti: [],
      stars: [],
      balloons: balloons,
      animFrame: null,
      canvasW: 0,
      canvasH: 0
    };
  },
  methods: {
    initConfetti: function() {
      var self = this;
      var canvas = self.$refs.confettiCanvas;
      if (!canvas) return;
      self.canvasW = window.innerWidth;
      self.canvasH = window.innerHeight;
      canvas.width = self.canvasW;
      canvas.height = self.canvasH;

      self.confetti = [];
      for (var i = 0; i < CONFETTI_COUNT; i++) {
        self.confetti.push(randomConfetti(self.canvasW, self.canvasH));
      }
      self.stars = [];
      for (var j = 0; j < STAR_COUNT; j++) {
        self.stars.push(randomStar(self.canvasW, self.canvasH));
      }
    },

    animate: function() {
      var self = this;
      if (!self.visible) return;
      var canvas = self.$refs.confettiCanvas;
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, self.canvasW, self.canvasH);

      // 绘制金色星点
      for (var s = 0; s < self.stars.length; s++) {
        var star = self.stars[s];
        star.y += star.speedY;
        star.x += star.speedX + Math.sin(star.twinkle) * 0.3;
        star.twinkle += star.twinkleSpeed;
        if (star.y > self.canvasH + 10) {
          star.y = -10;
          star.x = Math.random() * self.canvasW;
        }
        if (star.x < -10) star.x = self.canvasW + 10;
        if (star.x > self.canvasW + 10) star.x = -10;

        var alpha = star.opacity * (0.5 + 0.5 * Math.sin(star.twinkle));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#FFD700';
        ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        // 四角星形
        var cx = star.x, cy = star.y, r = star.size;
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.3, cy - r * 0.3);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx + r * 0.3, cy + r * 0.3);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r * 0.3, cy + r * 0.3);
        ctx.lineTo(cx - r, cy);
        ctx.lineTo(cx - r * 0.3, cy - r * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // 绘制纸屑
      for (var i = 0; i < self.confetti.length; i++) {
        var c = self.confetti[i];
        c.y += c.speedY;
        c.sway += c.swaySpeed;
        c.x += c.speedX + Math.sin(c.sway) * c.swayAmp * 0.02;
        c.rotation += c.rotSpeed;

        if (c.y > self.canvasH + 30) {
          c.y = -30;
          c.x = Math.random() * self.canvasW;
          c.sway = Math.random() * Math.PI * 2;
        }
        if (c.x < -50) c.x = self.canvasW + 50;
        if (c.x > self.canvasW + 50) c.x = -50;

        ctx.save();
        ctx.globalAlpha = c.opacity;
        ctx.fillStyle = c.color;
        ctx.translate(c.x, c.y);
        ctx.rotate((c.rotation * Math.PI) / 180);

        if (c.shape === 'rect') {
          ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        } else if (c.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, c.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (c.shape === 'triangle') {
          ctx.beginPath();
          ctx.moveTo(0, -c.h / 2);
          ctx.lineTo(-c.w / 2, c.h / 2);
          ctx.lineTo(c.w / 2, c.h / 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      self.animFrame = requestAnimationFrame(function() { self.animate(); });
    },

    dismiss: function() {
      var self = this;
      self.visible = false;
      if (self.animFrame) {
        cancelAnimationFrame(self.animFrame);
        self.animFrame = null;
      }
      self.$emit('dismiss');
    }
  },
  mounted: function() {
    var self = this;
    self.$nextTick(function() {
      self.initConfetti();
      self.animate();
      // 延迟显示祝福卡片
      setTimeout(function() {
        self.showCard = true;
      }, 1500);
      // 6 秒后自动关闭
      setTimeout(function() {
        if (self.visible) self.dismiss();
      }, 6500);
    });
  },
  beforeDestroy: function() {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }
};
</script>

<style scoped>
/* ========== 全屏覆盖 ========== */
.birthday-celebration {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  cursor: pointer;
  overflow: hidden;
  touch-action: manipulation;
}

/* ========== 切换过渡 ========== */
/* 庆典动效：时长节奏刻意偏慢（0.4s），但曲线走令牌；退出 0.25s < 进入 0.4s（§5.5.1 规则 3） */
.celebration-fade-enter-active {
  transition: opacity var(--duration-normal) var(--ease-decelerate);
}
.celebration-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-accelerate);
}
.celebration-fade-enter-from,
.celebration-fade-leave-to {
  opacity: 0;
}

/* ========== Canvas ========== */
.celebration-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* ========== 气球层 ========== */
.balloons-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
}

.balloon-wrap {
  position: absolute;
  bottom: -180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: balloon-rise var(--duration, 7s) ease-in forwards;
  animation-delay: var(--delay, 0s);
}

@keyframes balloon-rise {
  0% {
    transform: translateY(0) translateX(0) rotate(0deg);
    opacity: 0;
  }
  5% {
    opacity: 1;
  }
  25% {
    transform: translateY(-25vh) translateX(var(--sway, 20px)) rotate(3deg);
  }
  50% {
    transform: translateY(-55vh) translateX(calc(var(--sway, 20px) * -1)) rotate(-2deg);
  }
  75% {
    transform: translateY(-85vh) translateX(var(--sway, 20px)) rotate(4deg);
  }
  95% {
    opacity: 0.8;
  }
  100% {
    transform: translateY(-120vh) translateX(calc(var(--sway, 20px) * -0.5)) rotate(-3deg);
    opacity: 0;
  }
}

.balloon-string {
  width: 1.5px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-pill);
}

.balloon-body {
  position: relative;
  border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%; /* 规范例外：气球异形圆角，非令牌可表达的形状 */
  box-shadow:
    inset -4px -6px 12px rgba(0, 0, 0, 0.12),
    inset 3px 3px 8px rgba(255, 255, 255, 0.35),
    0 4px 20px rgba(0, 0, 0, 0.15);
}

.balloon-shine {
  position: absolute;
  top: 12%;
  left: 22%;
  width: 30%;
  height: 25%;
  background: radial-gradient(ellipse, rgba(255,255,255,0.55) 0%, transparent 70%);
  border-radius: 50%;
}

.balloon-knot {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 10px;
  height: 8px;
  background: inherit;
  border-radius: 0 0 var(--radius-xs) var(--radius-xs);
  clip-path: polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%);
}

/* ========== 祝福卡片 ========== */
.greeting-card {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.5);
  opacity: 0;
  /* 庆祝弹跳（iOS .bouncy，response 0.5 / damping 0.7）：生日祝福是
     最典型的「值得回弹」场景，用 bouncy 档位而非通用 spring。 */
  transition: transform var(--duration-slow) var(--motion-spring-bouncy),
              opacity var(--duration-slow) var(--motion-spring-bouncy);
  pointer-events: none;
}

.greeting-card--show {
  transform: translate(-50%, -50%) scale(1);
  opacity: 1;
}

.greeting-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: radial-gradient(circle,
    rgba(255, 215, 0, 0.25) 0%,
    rgba(255, 182, 48, 0.12) 35%,
    rgba(255, 107, 107, 0.06) 60%,
    transparent 75%
  );
  animation: glow-pulse 2s ease-in-out infinite;
}

@keyframes glow-pulse {
  0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.7; }
  50% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
}

.greeting-inner {
  position: relative;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: var(--radius-2xl);
  padding: 32px 40px;
  text-align: center;
  box-shadow:
    0 8px 40px rgba(0, 0, 0, 0.12),
    0 2px 8px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

/* 蛋糕图标：暖橙色 + 底部衬一层淡金光斑，替代原来的 emoji 主视觉 */
.greeting-cake {
  width: 72px;
  height: 72px;
  margin: 0 auto 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 38%, rgba(255, 204, 0, 0.22) 0%, rgba(255, 204, 0, 0) 72%);
  animation: cake-bounce 0.8s ease-in-out infinite;
}

.greeting-cake i {
  font-size: 40px;
  color: var(--warning-color, #FF9500);
  filter: drop-shadow(0 4px 10px rgba(255, 149, 0, 0.3));
}

@keyframes cake-bounce {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-6px) rotate(-3deg); }
  75% { transform: translateY(-6px) rotate(3deg); }
}

.greeting-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
  letter-spacing: 1px;
}

.greeting-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--accent-music, #FF2D55);
  margin-bottom: 8px;
}

.greeting-sub {
  font-size: 14px;
  color: var(--text-secondary);
  font-weight: 400;
}

/* ========== 关闭提示 ========== */
.dismiss-hint {
  position: absolute;
  bottom: 36px;
  left: 50%;
  transform: translateX(-50%) translateY(10px);
  opacity: 0;
  /* 延时出现（节奏参数，保留）；曲线走令牌 */
  transition: transform var(--duration-normal) var(--ease-decelerate) 0.5s,
              opacity 0.5s var(--ease-decelerate) 0.5s;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  pointer-events: none;
}

.dismiss-hint--show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
</style>
