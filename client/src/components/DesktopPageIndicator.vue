<template>
  <div class="page-indicator" @click.stop>
    <button
      v-for="i in total"
      :key="i"
      class="page-dot"
      :class="{ 'page-dot--active': (i - 1) === current }"
      @click="onJump(i - 1)"
      :aria-label="'第 ' + i + ' 页'"
    ></button>
    <button
      v-if="total < maxPages"
      class="page-add-btn"
      @click="$emit('add-page')"
      aria-label="添加桌面页"
    >
      <i class="fa-solid fa-plus"></i>
    </button>
  </div>
</template>

<script>
export default {
  name: 'DesktopPageIndicator',
  props: {
    // 总页数
    total: { type: Number, default: 1 },
    // 当前页索引
    current: { type: Number, default: 0 },
    // 最大页数
    maxPages: { type: Number, default: 9 }
  },
  methods: {
    onJump: function(pageIndex) {
      this.$emit('jump', pageIndex);
    }
  }
};
</script>

<style scoped>
.page-indicator {
  position: absolute;
  bottom: 96px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  z-index: 50;
  -webkit-tap-highlight-color: transparent;
}

.page-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.4);
  border: none;
  padding: 0;
  cursor: pointer;
  transition: all 0.25s var(--ease-standard);
}

.page-dot--active {
  width: 18px;
  background: #fff;
}

.page-add-btn {
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.15s var(--ease-standard);
}

.page-add-btn:active {
  transform: scale(0.85);
}
</style>
