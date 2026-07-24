<template>
  <button
    class="ios-btn"
    :class="['ios-btn-' + variant, 'ios-btn-' + size, { 'ios-btn-full': fullWidth }]"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot></slot>
  </button>
</template>

<script>
export default {
  name: 'IOSButton',
  props: {
    variant: {
      type: String,
      default: 'filled',
      validator: function(v) {
        return ['filled', 'tinted', 'plain', 'danger'].indexOf(v) !== -1;
      }
    },
    size: {
      type: String,
      default: 'md',
      validator: function(v) {
        return ['sm', 'md', 'lg'].indexOf(v) !== -1;
      }
    },
    disabled: {
      type: Boolean,
      default: false
    },
    fullWidth: {
      type: Boolean,
      default: false
    }
  }
};
</script>

<style scoped>
.ios-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  border: none;
  cursor: pointer;
  font-family: var(--font-family);
  font-weight: var(--font-weight-semibold);
  border-radius: var(--radius-pill);
  transition: transform var(--duration-fast) var(--ease-standard),
              opacity var(--duration-fast) var(--ease-standard),
              background var(--duration-fast) var(--ease-standard);
  -webkit-tap-highlight-color: transparent;
  -webkit-user-select: none;
  user-select: none;
}

.ios-btn:active {
  transform: scale(0.94);
  opacity: 0.7;
}

.ios-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
}

.ios-btn-sm {
  padding: 6px 16px;
  font-size: var(--font-size-caption);
  min-height: 32px;
}
.ios-btn-md {
  padding: 10px 20px;
  font-size: var(--font-size-body);
  min-height: 44px;
}
.ios-btn-lg {
  padding: 14px 28px;
  font-size: var(--font-size-callout);
  min-height: 50px;
}

.ios-btn-filled {
  background: var(--primary-color);
  color: #FFFFFF;
}
.ios-btn-filled:active {
  background: var(--primary-pressed);
}

.ios-btn-tinted {
  background: var(--primary-light);
  color: var(--primary-color);
}

.ios-btn-plain {
  background: transparent;
  color: var(--primary-color);
}

.ios-btn-danger {
  background: var(--danger-color);
  color: #FFFFFF;
}

.ios-btn-full {
  width: 100%;
}
</style>
