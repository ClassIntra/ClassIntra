<template>
  <div class="loading-skeleton" :class="{ 'skeleton-inline': inline }">
    <div v-if="type === 'card'" class="skeleton-card">
      <div class="skeleton-avatar"></div>
      <div class="skeleton-lines">
        <div class="skeleton-line skeleton-line-title"></div>
        <div class="skeleton-line skeleton-line-text"></div>
        <div class="skeleton-line skeleton-line-short"></div>
      </div>
    </div>
    <div v-else-if="type === 'list'" class="skeleton-list">
      <div v-for="i in count" :key="i" class="skeleton-list-item">
        <div class="skeleton-avatar skeleton-avatar-sm"></div>
        <div class="skeleton-lines">
          <div class="skeleton-line skeleton-line-title"></div>
          <div class="skeleton-line skeleton-line-short"></div>
        </div>
      </div>
    </div>
    <div v-else-if="type === 'text'" class="skeleton-text">
      <div v-for="i in count" :key="i" class="skeleton-line" :style="{ width: i === count ? '60%' : '100%' }"></div>
    </div>
    <div v-else class="skeleton-default">
      <div class="skeleton-line" :style="{ width: width }"></div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'LoadingSkeleton',
  props: {
    type: { type: String, default: 'text' },
    count: { type: Number, default: 3 },
    width: { type: String, default: '100%' },
    inline: { type: Boolean, default: false }
  }
};
</script>

<style scoped>
.loading-skeleton {
  padding: var(--spacing-sm);
}

.skeleton-card,
.skeleton-list-item {
  display: flex;
  align-items: flex-start;
  padding: var(--spacing-md);
  gap: var(--spacing-md);
}

.skeleton-list-item + .skeleton-list-item {
  margin-top: var(--spacing-sm);
}

.skeleton-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(90deg, var(--border-color) 25%, var(--bg-color) 50%, var(--border-color) 75%);
  background-size: 200% 100%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  flex-shrink: 0;
}

.skeleton-avatar-sm {
  width: 32px;
  height: 32px;
}

.skeleton-lines {
  flex: 1;
  min-width: 0;
}

.skeleton-line {
  height: 14px;
  border-radius: var(--radius-xs);
  background: linear-gradient(90deg, var(--border-color) 25%, var(--bg-color) 50%, var(--border-color) 75%);
  background-size: 200% 100%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  margin-bottom: 8px;
}

.skeleton-line:last-child {
  margin-bottom: 0;
}

.skeleton-line-title {
  width: 60%;
  height: 16px;
}

.skeleton-line-text {
  width: 100%;
}

.skeleton-line-short {
  width: 40%;
}

@keyframes skeleton-pulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skeleton-inline {
  display: inline-block;
  padding: 0;
}
</style>
