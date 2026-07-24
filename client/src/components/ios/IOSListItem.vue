<template>
  <div
    class="ios-list-item"
    :class="{ 'ios-list-item-clickable': clickable }"
    @click="clickable && $emit('click', $event)"
  >
    <div class="ios-list-item-icon" v-if="icon" :style="iconStyle">
      <i :class="icon"></i>
    </div>
    <div class="ios-list-item-content">
      <div class="ios-list-item-title">{{ title }}</div>
      <div class="ios-list-item-subtitle" v-if="subtitle">{{ subtitle }}</div>
    </div>
    <div class="ios-list-item-value" v-if="value">{{ value }}</div>
    <slot name="accessory"></slot>
    <i class="fa-solid fa-chevron-right ios-list-item-arrow" v-if="showArrow"></i>
  </div>
</template>

<script>
export default {
  name: 'IOSListItem',
  props: {
    icon: { type: String, default: '' },
    iconColor: { type: String, default: '' },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    value: { type: String, default: '' },
    showArrow: { type: Boolean, default: false },
    clickable: { type: Boolean, default: false }
  },
  computed: {
    iconStyle: function() {
      if (this.iconColor) {
        return { background: this.iconColor };
      }
      return {};
    }
  }
};
</script>

<style scoped>
.ios-list-item {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: var(--spacing-sm) var(--spacing-md);
  gap: var(--spacing-sm);
}

.ios-list-item-clickable {
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}

.ios-list-item-clickable:active {
  background: var(--border-color);
}

.ios-list-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 29px;
  height: 29px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-body);
  color: #FFFFFF;
  flex-shrink: 0;
}

.ios-list-item-content {
  flex: 1;
  min-width: 0;
}

.ios-list-item-title {
  font-size: var(--font-size-body);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ios-list-item-subtitle {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-top: 2px;
}

.ios-list-item-value {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  text-align: right;
}

.ios-list-item-arrow {
  font-size: 13px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
</style>
