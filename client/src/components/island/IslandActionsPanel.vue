<template>
  <div class="island-body">
    <div class="panel-head">
      <span class="panel-title">快捷操作</span>
    </div>
    <div class="action-grid" style="grid-template-columns: repeat(2, 1fr)">
      <button class="action-btn action-btn-stagger" style="--stagger-index:0" @click.stop="$emit('navigate', '/announcements')">
        <div class="action-icon" style="background:rgba(234,179,8,0.15)"><i class="fa-solid fa-bullhorn" style="color:#eab308"></i></div>
        <span class="action-label">公告页</span>
      </button>
      <button class="action-btn action-btn-stagger" style="--stagger-index:1" @click.stop="$emit('open-browser')">
        <div class="action-icon" style="background:rgba(6,182,212,0.15)"><i class="fa-solid fa-globe" style="color:#06b6d4"></i></div>
        <span class="action-label">浏览器</span>
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'IslandActionsPanel'
};
</script>

<style scoped>
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--island-text);
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.action-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 4px;
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s, transform 0.15s var(--ease-emphasized);
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.action-btn:active {
  transform: scale(0.94);
  opacity: 0.7;
  background: rgba(255, 255, 255, 0.12);
}

.action-btn-stagger {
  animation: action-stagger-in 0.35s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
  animation-delay: calc(var(--stagger-index, 0) * 0.06s);
}

@keyframes action-stagger-in {
  0% {
    opacity: 0;
    transform: scale(0.5) translateY(10px);
  }
  70% {
    opacity: 1;
    transform: scale(1.08) translateY(-2px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.action-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  margin-bottom: 6px;
}

.action-label {
  font-size: 11px;
  color: var(--island-text);
  opacity: 0.7;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .action-btn-stagger { animation: none !important; }
}
</style>
