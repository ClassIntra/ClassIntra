<template>
  <transition name="pay-page">
    <div v-if="visible" class="pay-page" :class="{ 'pay-page--tint': tint }">
      <div class="pay-nav" :class="{ 'pay-nav--light': light }">
        <button class="pay-back" @click="$emit('close')" aria-label="返回">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        <div class="pay-nav-title">
          <span>{{ title }}</span>
          <em v-if="subtitle">{{ subtitle }}</em>
        </div>
        <div class="pay-nav-right">
          <slot name="nav-right"></slot>
        </div>
      </div>
      <div class="pay-body">
        <slot></slot>
      </div>
    </div>
  </transition>
</template>

<script>
// 微信式全屏支付页容器
// ------------------------------------------------------------
// 为什么不是浮窗：支付是需要「专注」的动作。浮窗盖在聊天上、
// 周围还能看到消息，很容易点错人或看错金额；微信的转账/红包都是整屏接管。
// 这里用 fixed 全屏 + 滑入动画，返回键固定在左上角，行为与原生页面一致。
export default {
  name: 'PayPage',
  props: {
    visible: { type: Boolean, default: false },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    // light=true 用于红包那种深色/红色背景（导航文字转白）
    light: { type: Boolean, default: false },
    tint: { type: String, default: '' }
  }
};
</script>

<style scoped>
.pay-page {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 95;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  color: var(--text-primary);
}

.pay-nav {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  height: 52px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-color);
}
.pay-nav--light {
  border-bottom-color: rgba(255, 255, 255, 0.14);
  background: transparent;
  color: #fff;
}
.pay-back {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: inherit;
  font-size: 16px;
  background: transparent;
}
.pay-back:active { background: rgba(127, 127, 127, 0.14); }
.pay-nav-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.pay-nav-title span {
  font-size: var(--font-size-headline, 15px);
  font-weight: 600;
}
.pay-nav-title em {
  margin-top: 1px;
  font-size: 10px;
  font-style: normal;
  opacity: 0.6;
}
.pay-nav-right {
  min-width: 40px;
  display: flex;
  justify-content: flex-end;
}
.pay-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.pay-page-enter-active,
.pay-page-leave-active {
  transition: transform 0.24s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.18s linear;
}
.pay-page-enter,
.pay-page-leave-to {
  transform: translateX(16%);
  opacity: 0;
}
</style>
