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
        <span v-if="queueCount > 0" class="notif-queue" :style="queueBadgeStyle">+{{ queueCount }}</span>
      </div>
    </div>
    <div class="notif-progress" :style="progressBarStyle"></div>
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
    progressWidth: { type: Number, default: 100 }
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
    queueBadgeStyle: function() {
      var color = '#3b82f6';
      if (this.notification) {
        if (this.notification.type === 'group_event') color = '#f59e0b';
        else if (this.notification.type === 'online') color = '#22c55e';
      }
      return { background: color };
    },
    progressBarStyle: function() {
      var color = '#3b82f6';
      if (this.notification) {
        if (this.notification.type === 'group_event') color = '#f59e0b';
        else if (this.notification.type === 'online') color = '#22c55e';
      }
      if (this.priority === 'urgent') color = '#ef4444';
      else if (this.priority === 'low') color = '#9ca3af';
      return { transform: 'scaleX(' + (this.progressWidth / 100) + ')', background: color };
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
  transition: background 0.3s, transform 0.3s;
}

.notif-icon-pulse {
  animation: notif-icon-pop 0.5s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}

@keyframes notif-icon-pop {
  0% { transform: scale(0.6); }
  60% { transform: scale(1.2); }
  80% { transform: scale(0.95); }
  100% { transform: scale(1); }
}

.notif-icon-urgent {
  background: rgba(239, 68, 68, 0.2) !important;
  animation: notif-icon-urgent-pulse 1.2s ease-in-out infinite;
}

@keyframes notif-icon-urgent-pulse {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
  50% { transform: scale(1.1); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
}

.notif-icon .fa-comment { color: #3b82f6; }
.notif-icon .fa-users { color: #3b82f6; }
.notif-icon .fa-globe { color: #3b82f6; }
.notif-icon .fa-user-plus { color: #f59e0b; }
.notif-icon .fa-circle-exclamation { color: #f59e0b; }
.notif-icon .fa-right-left { color: #f59e0b; }
.notif-icon .fa-bell { color: #f59e0b; }
.notif-icon .fa-circle-dot { color: #22c55e; }
.notif-icon .fa-utensils { color: #10b981; }
.notif-icon .fa-fire { color: #f59e0b; }
.notif-icon .fa-newspaper { color: #6366f1; }

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

.notif-queue {
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.4;
  white-space: nowrap;
}

.notif-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 2px;
  border-radius: 0 0 28px 28px;
  transform-origin: left center;
  transform: scaleX(0);
  transition: transform 30ms var(--ease-standard);
}

.ptag {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 0 5px;
  border-radius: 4px;
  line-height: 1.5;
  margin-right: 4px;
  vertical-align: middle;
}

.ptag-urgent {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.ptag-low {
  background: rgba(156, 163, 175, 0.15);
  color: #9ca3af;
}

@media (prefers-reduced-motion: reduce) {
  .notif-icon-pulse { animation: none !important; }
  .notif-icon-urgent { animation: none !important; }
}
</style>
