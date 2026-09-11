<template>
  <transition name="modal-fade">
    <div v-if="visible" class="confirm-overlay" @click.self="cancel">
      <div class="confirm-box">
        <div v-if="icon" class="confirm-icon" :style="{ color: iconColor }">
          <i :class="icon"></i>
        </div>
        <h3 class="confirm-title">{{ title }}</h3>
        <p v-if="message && !html" class="confirm-message">{{ message }}</p>
        <!-- html 由调用方负责转义（如市场安装页的能力披露清单）。
            这里仅承载已净化的片段，非用户输入直出。 -->
        <div v-else-if="html" class="confirm-html" v-html="html"></div>
        <div class="confirm-actions">
          <button class="btn-secondary" @click="cancel">{{ cancelText }}</button>
          <button class="btn-confirm" :class="confirmClass" @click="confirm">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
export default {
  name: 'ConfirmDialog',
  props: {
    visible: { type: Boolean, default: false },
    title: { type: String, default: '确认' },
    message: { type: String, default: '' },
    // 富文本内容（HTML 字符串）。设置后优先于 message 渲染。
    // 调用方必须自行转义所有动态内容（模板中已用 escapeHtml 处理）。
    html: { type: String, default: '' },
    icon: { type: String, default: 'fa-solid fa-triangle-exclamation' },
    iconColor: { type: String, default: '#FF9500' },
    confirmText: { type: String, default: '确认' },
    cancelText: { type: String, default: '取消' },
    confirmClass: { type: String, default: 'btn-danger' }
  },
  methods: {
    confirm: function() { this.$emit('confirm'); },
    cancel: function() { this.$emit('cancel'); }
  }
};
</script>

<style scoped>
.confirm-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.45); backdrop-filter: var(--glass-blur-regular); -webkit-backdrop-filter: var(--glass-blur-regular);
  display: flex; align-items: center; justify-content: center; z-index: var(--z-modal, 10001);
}
.confirm-box {
  width: 270px;
  background: var(--surface-elevated);
  backdrop-filter: var(--glass-blur-thick);
  -webkit-backdrop-filter: var(--glass-blur-thick);
  border-radius: var(--radius-2xl);
  padding: 20px; text-align: center;
  box-shadow: var(--shadow-xl), 0 0 0 0.5px var(--glass-border);
  overflow: hidden;
}
.confirm-icon { font-size: 36px; margin-bottom: 14px; }
.confirm-title { font-size: var(--font-size-callout); font-weight: var(--font-weight-semibold); color: var(--text-primary); margin: 0 0 4px 0; }
.confirm-message { font-size: var(--font-size-footnote); color: var(--text-secondary); margin: 0 0 20px 0; line-height: var(--line-height-normal); }
.confirm-actions { display: flex; flex-direction: column; gap: 0; margin: 0 -20px -20px; }
.btn-secondary {
  display: flex; align-items: center; justify-content: center;
  padding: 0 20px; border-radius: 0; border: none;
  border-top: 0.5px solid var(--separator-color);
  background: transparent; color: var(--primary-color); font-size: var(--font-size-callout);
  cursor: pointer; transition: background var(--transition-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-emphasized);
  min-height: 44px; font-weight: var(--font-weight-regular);
}
.btn-secondary:hover { background: var(--primary-lighter); }
.btn-secondary:active { transform: scale(0.94); opacity: 0.7; }
.btn-confirm {
  display: flex; align-items: center; justify-content: center;
  padding: 0 20px; border-radius: 0; border: none;
  border-top: 0.5px solid var(--separator-color);
  font-size: var(--font-size-callout); font-weight: var(--font-weight-semibold); cursor: pointer;
  transition: background var(--transition-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-emphasized);
  min-height: 44px;
}
.btn-confirm:active { transform: scale(0.94); opacity: 0.7; }
.btn-danger { background: transparent; color: var(--danger-color); }
.btn-danger:hover { background: var(--danger-lighter, rgba(255, 59, 48, 0.08)); }
.btn-primary-confirm { background: transparent; color: var(--primary-color); }
.btn-primary-confirm:hover { background: var(--primary-lighter); }
.modal-fade-enter-active { transition: opacity var(--duration-normal) var(--ease-emphasized), transform var(--duration-normal) var(--motion-spring-snappy); }
.modal-fade-leave-active { transition: opacity var(--duration-fast) var(--ease-accelerate), transform var(--duration-fast) var(--ease-accelerate); }
.modal-fade-enter { opacity: 0; transform: scale(0.92) translateY(8px); }
.modal-fade-leave-to { opacity: 0; transform: scale(0.97) translateY(-4px); }
</style>
