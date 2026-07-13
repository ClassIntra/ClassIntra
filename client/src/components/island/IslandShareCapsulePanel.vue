<template>
  <div class="island-body">
    <div class="panel-head">
      <span class="panel-title">分享到</span>
      <button class="panel-close" @click.stop="$emit('cancel')" title="取消">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="share-target-info">
      <i class="fa-solid fa-video share-target-icon"></i>
      <div class="share-target-text">
        <div class="share-target-title" :title="title">{{ title }}</div>
        <div class="share-target-url" :title="url">{{ displayUrl }}</div>
      </div>
    </div>
    <div class="action-grid" style="grid-template-columns: repeat(2, 1fr)">
      <button class="action-btn action-btn-stagger" style="--stagger-index:0" @click.stop="$emit('share-to-chat')">
        <div class="action-icon" style="background:rgba(59,130,246,0.15)">
          <i class="fa-solid fa-comment-dots" style="color:#3b82f6"></i>
        </div>
        <span class="action-label">分享到聊天</span>
      </button>
      <button class="action-btn action-btn-stagger" style="--stagger-index:1" @click.stop="$emit('share-to-community')">
        <div class="action-icon" style="background:rgba(16,185,129,0.15)">
          <i class="fa-solid fa-users" style="color:#10b981"></i>
        </div>
        <span class="action-label">分享到社区</span>
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: 'IslandShareCapsulePanel',
  props: {
    url: { type: String, default: '' },
    title: { type: String, default: '' }
  },
  computed: {
    displayUrl: function() {
      var u = this.url || '';
      // 显示时去掉协议前缀以节省空间
      return u.replace(/^https?:\/\//i, '');
    }
  }
};
</script>

<style scoped>
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--island-text);
}

.panel-close {
  width: 22px;
  height: 22px;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-sm);
  color: var(--island-text);
  opacity: 0.7;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, opacity 0.15s;
}

.panel-close:hover {
  background: rgba(255, 255, 255, 0.16);
  opacity: 1;
}

.share-target-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: var(--radius-md);
  margin-bottom: 12px;
  max-width: 280px;
}

.share-target-icon {
  font-size: 18px;
  color: #f43f5e;
  flex-shrink: 0;
}

.share-target-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.share-target-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--island-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.share-target-url {
  font-size: 11px;
  color: var(--island-text);
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
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
  transition: background 0.15s, transform 0.15s cubic-bezier(0.32, 0.72, 0, 1);
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.action-btn:active {
  transform: scale(0.92);
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
