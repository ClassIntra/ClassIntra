<template>
  <div class="island-body">
    <div class="browser-row">
      <i class="fa-solid fa-globe browser-globe"></i>
      <input
        ref="input"
        :value="url"
        class="browser-input"
        placeholder="输入网址..."
        @input="$emit('update:url', $event.target.value)"
        @keydown.enter="$emit('submit')"
        @keydown.escape="$emit('cancel')"
      />
      <button class="browser-go" :disabled="!url.trim()" @click.stop="$emit('submit')">
        <i class="fa-solid fa-arrow-right"></i>
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'IslandBrowserPanel',
  props: {
    url: { type: String, default: '' }
  },
  methods: {
    focus: function() {
      if (this.$refs.input) this.$refs.input.focus();
    }
  }
};
</script>

<style scoped>
.browser-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 50px;
}

.browser-globe {
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
  flex-shrink: 0;
  transition: color var(--duration-fast) var(--ease-standard);
}

.browser-row:focus-within .browser-globe {
  color: rgba(255, 255, 255, 0.7);
}

.browser-input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 0;
  font-size: 13px;
  color: #fff;
  outline: none;
  min-width: 0;
  caret-color: #fff;
}

.browser-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.browser-go {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
  cursor: pointer;
  border: none;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}

.browser-go:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.22);
  transform: scale(1.06);
}

.browser-go:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
