<template>
  <transition name="bigtext-fade">
    <div
      v-if="visible"
      class="big-text-overlay"
      :aria-label="'全屏通知：' + current.content"
      role="alertdialog"
      aria-modal="true"
      @click="onTap"
      @touchstart.passive="onTouchStart"
    >
      <!-- 内容、倒计时进度条与驻留提示全部由 BigTextStage 渲染 ——
           设备端与管理端预览共用同一实现，预览即真机 -->
      <BigTextStage
        :config="current"
        :stage-width="viewportW"
        :stage-height="viewportH"
        :playing="true"
      />
    </div>
  </transition>
</template>

<script>
/**
 * BigTextOverlay — 全屏大字外壳（强提示广播）
 *
 * 由指令信箱驱动：班管/班干发送大字后，设备全屏显示，到时长自动消失，也可轻触关闭。
 * 层级取 50000：高于超能岛(10000)、低于锁屏(99999)，不会盖住锁屏界面。
 *
 * 职责边界：本组件只管「壳」—— 全屏遮罩、到点自动收起、关闭手势、旋转适配。
 * 文字排版、视觉特效、倒计时进度条与驻留提示全部在 `BigTextStage.vue`，
 * 管理端预览复用同一个组件，因此预览与实际显示不会再有偏差。
 *
 * 对外方法（父组件通过 ref 调用）：
 *   show(payload)   显示一条大字
 *   hide(id)        收起指定 id（撤回用）；不传 id 则收起当前
 */
import BigTextStage from './BigTextStage.vue';

// 最短驻留：这段时间内忽略一切关闭手势，防止「强制全屏」被一划就没
var MIN_DWELL_MS = 5000;

export default {
  name: 'BigTextOverlay',
  components: {
    BigTextStage: BigTextStage
  },
  data: function() {
    return {
      visible: false,
      current: {
        id: 0,
        content: '',
        sub_content: '',
        show_sender: true,
        display_mode: 'static',
        switch_interval: 5,
        scroll_speed: 60,
        effect: 'none',
        bg_color: '#101828',
        bg_gradient: null,
        font_color: '#ffffff',
        text_gradient: null,
        font_family_css: '',
        font_size: 120,
        font_weight: '700',
        text_align: 'center',
        duration: 10,
        sender_name: ''
      },
      // 传给 stage 的尺寸基准：旋转屏幕后要重算，否则字号不跟着变
      viewportW: (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1080,
      viewportH: (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 675,
      startedAt: 0,
      timer: null
    };
  },
  methods: {
    /**
     * 显示一条大字。若已有正在显示的，新的直接顶掉（大字本质是即时强提示）。
     */
    show: function(payload) {
      if (!payload || !payload.content) return;
      this.clearTimer();
      this.current = {
        id: payload.id || 0,
        content: String(payload.content),
        sub_content: payload.sub_content || '',
        show_sender: payload.show_sender === undefined ? true : !!payload.show_sender,
        display_mode: payload.display_mode || 'static',
        switch_interval: Math.max(2, Math.min(60, parseInt(payload.switch_interval, 10) || 5)),
        scroll_speed: Math.max(20, Math.min(200, parseInt(payload.scroll_speed, 10) || 60)),
        effect: payload.effect || 'none',
        bg_color: payload.bg_color || '#101828',
        bg_gradient: payload.bg_gradient || null,
        font_color: payload.font_color || '#ffffff',
        text_gradient: payload.text_gradient || null,
        font_family_css: payload.font_family_css || '',
        font_size: parseInt(payload.font_size, 10) || 120,
        font_weight: payload.font_weight || '700',
        text_align: payload.text_align || 'center',
        duration: Math.max(3, Math.min(600, parseInt(payload.duration, 10) || 10)),
        sender_name: payload.sender_name || ''
      };
      this.syncViewport();
      this.startedAt = Date.now();
      this.visible = true;
      // 到点自动收起（进度条与提示文案在 BigTextStage 内部自行倒计时，
      // 这里只管「什么时候把整块收走」，两处总时长同源同公式）
      var self = this;
      this.timer = window.setTimeout(function() {
        self.visible = false;
        self.timer = null;
      }, this.current.duration * 1000);
    },

    /**
     * 收起。传 id 时只有 id 匹配才收（撤回场景），避免误关掉后来的一条。
     */
    hide: function(id) {
      if (id && this.current.id && Number(id) !== Number(this.current.id)) return;
      this.clearTimer();
      this.visible = false;
    },

    syncViewport: function() {
      if (typeof window === 'undefined') return;
      this.viewportW = window.innerWidth || 1080;
      this.viewportH = window.innerHeight || 675;
    },

    clearTimer: function() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    },

    onTap: function() {
      this.dismissIfAllowed();
    },

    onTouchStart: function() {
      // 触摸设备点击响应更快，与 click 行为一致（click 仍保留兜底）
      this.dismissIfAllowed();
    },

    /**
     * 最短驻留保护：前 MIN_DWELL_MS 内忽略一切关闭手势。
     * 否则「强制全屏」会被一弹就划掉，失去管控意义；
     * 保留逃生口是怕发错内容把设备锁死，故设 5s 宽限后放行。
     */
    dismissIfAllowed: function() {
      if (Date.now() - this.startedAt < MIN_DWELL_MS) return;
      this.hide(this.current.id);
    }
  },
  mounted: function() {
    // 平板横竖屏切换后字号基准要跟着变
    this._onResize = this.syncViewport;
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
  },
  beforeDestroy: function() {
    this.clearTimer();
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('orientationchange', this._onResize);
      this._onResize = null;
    }
  }
};
</script>

<style scoped>
/* ========== 全屏覆盖 ========== */
/* 层级 50000：高于超能岛 10000，低于锁屏 99999 —— 不盖住锁屏 */
.big-text-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

/* ========== 进出场 ========== */
.bigtext-fade-enter-active,
.bigtext-fade-leave-active {
  transition: opacity 0.22s ease;
}

.bigtext-fade-enter,
.bigtext-fade-leave-to {
  opacity: 0;
}
</style>
