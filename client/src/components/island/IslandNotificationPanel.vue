<template>
  <div class="island-body">
    <div class="notif-row">
      <div class="notif-icon" :class="iconClasses" :style="iconStyle">
        <i :class="notification.icon || 'fa-solid fa-comment'"></i>
      </div>
      <div class="notif-body">
        <div class="notif-title">
          <span v-if="priority === 'urgent'" class="ptag ptag-urgent">紧急</span>
          <span v-if="priority === 'low'" class="ptag ptag-low">低</span>
          {{ notification.title }}
        </div>
        <div class="notif-text">{{ notification.text }}</div>
      </div>
      <div class="notif-meta">
        <span v-if="timestamp" class="notif-time">{{ timestamp }}</span>
        <span v-if="queueCount > 0" class="notif-queue" :class="queueClass">{{ queueCount > 99 ? '99+' : '+' + queueCount }}</span>
      </div>
    </div>
    <div class="notif-progress" :class="progressClass" :style="progressStyle"></div>
  </div>
</template>

<script>
export default {
  name: 'IslandNotificationPanel',
  props: {
    notification: { type: Object, required: true },
    priority: { type: String, default: 'normal' },
    timestamp: { type: String, default: '' },
    queueCount: { type: Number, default: 0 },
    isBouncing: { type: Boolean, default: false },
    /**
     * 通知展示时长（ms）—— 由 SuperIsland 的 notificationDuration 统一推入
     * （collapseTimer 与进度条共用同一真相源，见 island-notifications.js）。
     * 进度条是 CSS animation：duration 走自定义属性注入，零 JS tick。
     */
    notifDuration: { type: Number, default: 3000 }
  },
  computed: {
    iconStyle: function() {
      if (!this.notification || !this.notification.color) return {};
      return { background: this.notification.color };
    },
    iconClasses: function() {
      return {
        'notif-icon-urgent': this.priority === 'urgent',
        'notif-icon-pulse': this.isBouncing
      };
    },
    // 进度条颜色：与图标语义一致（群事件=琥珀、上线=绿、紧急=红、低=灰，默认主色）
    progressClass: function() {
      if (this.priority === 'urgent') return 'notif-progress--urgent';
      if (this.priority === 'low') return 'notif-progress--low';
      if (this.notification && this.notification.type === 'group_event') return 'notif-progress--group';
      if (this.notification && this.notification.type === 'online') return 'notif-progress--online';
      return '';
    },
    queueClass: function() {
      if (this.notification && this.notification.type === 'group_event') return 'notif-queue--group';
      if (this.notification && this.notification.type === 'online') return 'notif-queue--online';
      return '';
    },
    progressStyle: function() {
      return { '--notif-duration': this.notifDuration + 'ms' };
    }
  }
};
</script>

<style scoped>
.notif-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 72px;
}

.notif-icon {
  font-size: 16px;
  flex-shrink: 0;
  color: var(--island-text);
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-normal) var(--ease-standard), transform var(--duration-normal) var(--ease-standard);
}

.notif-icon-pulse {
  /* 通知图标抽出：庆祝语义（新通知到达是正向事件）→ iOS .bouncy */
  animation: notif-icon-pop 0.5s var(--motion-spring-bouncy);
}

@keyframes notif-icon-pop {
  0% { transform: scale(0.6); }
  60% { transform: scale(1.2); }
  80% { transform: scale(0.95); }
  100% { transform: scale(1); }
}

/* 紧急图标呼吸：只动 transform/opacity（合成层）。
   原实现扩散 box-shadow 光环——每帧重绘模糊阴影，且是 ease-in-out 关键字曲线
   （项目红线禁关键字），2026-10-24 改为缩放+透明度呼吸，语义不变、零重绘。 */
.notif-icon-urgent {
  background: rgba(var(--danger-rgb), 0.2) !important;
  animation: notif-icon-urgent-pulse 1.2s var(--ease-standard) infinite;
}

@keyframes notif-icon-urgent-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.82; }
}

/* 通知图标色统一走系统令牌（此前是 Tailwind 越界色值泄漏） */
.notif-icon .fa-comment { color: var(--primary-color); }
.notif-icon .fa-users { color: var(--primary-color); }
.notif-icon .fa-globe { color: var(--primary-color); }
.notif-icon .fa-user-plus { color: var(--warning-color); }
.notif-icon .fa-circle-exclamation { color: var(--warning-color); }
.notif-icon .fa-right-left { color: var(--warning-color); }
.notif-icon .fa-bell { color: var(--warning-color); }
.notif-icon .fa-circle-dot { color: var(--success-color); }
.notif-icon .fa-utensils { color: var(--success-color); }
.notif-icon .fa-fire { color: var(--warning-color); }
.notif-icon .fa-newspaper { color: var(--accent-resource); }

.notif-body {
  flex: 1;
  min-width: 0;
}

.notif-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notif-text {
  font-size: 12px;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notif-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
  gap: 4px;
}

.notif-time {
  font-size: 10px;
  opacity: 0.5;
  white-space: nowrap;
}

/* 排队徽章：出现时弹一下（0.4 起步，E8 禁 scale(0)），只动 transform/opacity */
.notif-queue {
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  padding: 1px 6px;
  border-radius: var(--radius-md);
  line-height: 1.4;
  white-space: nowrap;
  background: var(--primary-color);
  animation: notif-queue-pop 0.32s var(--motion-spring-bouncy) both;
}

.notif-queue--group { background: var(--warning-color); }
.notif-queue--online { background: var(--success-color); }

@keyframes notif-queue-pop {
  0% { transform: scale(0.4); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

/**
 * 倒计时进度条：CSS animation 驱动（scaleX 1→0，合成层）。
 * 原实现是 JS 每 30ms 改一次 progressWidth → Vue 重渲染整条通知生命周期，
 * 且 30ms transition 比 tick 还短、等于没平滑。duration 经内联
 * --notif-duration 注入（= collapseTimer 同一真相源，island-notifications.js）。
 * 面板由 :key（含 notificationAppearTime）重挂载 → 每条新通知动画自然重启。
 */
.notif-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 2px;
  border-radius: 0 0 var(--radius-3xl) var(--radius-3xl);
  transform-origin: left center;
  background: var(--primary-color);
  animation: notif-progress-shrink var(--notif-duration, 3000ms) linear forwards;
}

.notif-progress--group { background: var(--warning-color); }
.notif-progress--online { background: var(--success-color); }
.notif-progress--urgent { background: var(--danger-color); }
.notif-progress--low { background: var(--text-tertiary); }

@keyframes notif-progress-shrink {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}

.ptag {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 0 5px;
  border-radius: var(--radius-xs);
  line-height: 1.5;
  margin-right: 4px;
  vertical-align: middle;
}

.ptag-urgent {
  background: rgba(var(--danger-rgb), 0.15);
  color: var(--danger-color);
}

.ptag-low {
  background: rgba(156, 163, 175, 0.15);
  color: var(--text-tertiary);
}

@media (prefers-reduced-motion: reduce) {
  .notif-icon-pulse { animation: none !important; }
  .notif-icon-urgent { animation: none !important; }
  .notif-queue { animation: none !important; }
  /* reduce 模式下进度条不缩（静止满条，信息不减） */
  .notif-progress { animation: none !important; transform: scaleX(1) !important; }
}
</style>
