<template>
  <div class="app-nav-bar-wrapper">
    <div class="app-nav-bar" :class="{ 'nav-bar-large-title': largeTitle && !collapsed }">
      <div class="nav-left">
        <button v-if="showBack" class="nav-btn nav-back" @click="goBack" title="返回上一页">
          <i class="fa-solid fa-chevron-left"></i>
          <span v-if="backText" class="nav-back-text">{{ backText }}</span>
        </button>
      </div>
      <div class="nav-center">
        <h1 v-if="!largeTitle || collapsed" class="nav-title">{{ title }}</h1>
      </div>
      <div class="nav-right">
        <slot name="actions"></slot>
      </div>
    </div>
    <div v-if="largeTitle && !collapsed" class="nav-large-title-area">
      <h1 class="nav-large-title">{{ title }}</h1>
      <slot name="largeTitleActions"></slot>
    </div>
  </div>
</template>

<script>
export default {
  name: 'AppNavBar',
  props: {
    title: {
      type: String,
      default: ''
    },
    largeTitle: {
      type: Boolean,
      default: false
    },
    collapsed: {
      type: Boolean,
      default: false
    },
    showBack: {
      type: Boolean,
      default: true
    },
    backText: {
      type: String,
      default: ''
    },
    // 宿主是否已接管返回导航（AppShell.goBack 会 push 桌面）。
    // true 时本组件只发 back 事件，不再自己 go(-1)，避免双重导航互相打架。
    managedBack: {
      type: Boolean,
      default: false
    }
  },
  methods: {
    goBack: function() {
      // 先通知宿主（AppShell 负责「返回桌面」、页面可借此做退出前清理）
      this.$emit('back');
      // 宿主已接管返回语义时不要重复导航：push(Desktop) 与 go(-1) 会在同一帧里
      // 互相打架，最终落在谁身上不确定 —— 现象是「点了返回却又弹回原应用」。
      if (this.managedBack) return;
      if (window.history.length > 1) {
        this.$router.go(-1);
      } else {
        this.$router.push({ name: 'Desktop' });
      }
    }
  }
};
</script>

<style scoped>
.app-nav-bar-wrapper {
  flex-shrink: 0;
}

.app-nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 var(--spacing-sm);
  background: var(--nav-bg);
  backdrop-filter: var(--glass-blur-nav);
  -webkit-backdrop-filter: var(--glass-blur-nav);
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
  /* 为后代下拉菜单的 z-index 提供层叠上下文 */
  position: relative;
  z-index: 20;
}

.nav-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 80px;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  border-radius: var(--radius-sm);
  color: var(--primary-color);
  font-size: var(--font-size-body);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: opacity var(--transition-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-emphasized);
  padding: 0;
}

.nav-btn:hover {
  opacity: 0.7;
}

.nav-btn:active {
  opacity: 0.7;
}

.nav-back-text {
  font-size: var(--font-size-body);
  margin-left: 2px;
}

.nav-center {
  flex: 1;
  text-align: left;
  padding-left: var(--spacing-sm);
  overflow: hidden;
}

.nav-title {
  font-family: var(--font-family);
  font-size: var(--font-size-subheadline);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin: 0;
  line-height: 44px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 80px;
  justify-content: flex-end;
}

/* iOS Large Title Mode */
.nav-large-title-area {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 0 var(--spacing-md) var(--spacing-xs);
  background: var(--nav-bg);
  backdrop-filter: var(--glass-blur-nav);
  -webkit-backdrop-filter: var(--glass-blur-nav);
  min-height: 52px;
}

.nav-large-title {
  font-family: var(--font-family);
  font-size: var(--font-size-largeTitle);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin: 0;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* When large title is shown, nav bar has no bottom border (border moves below large title area) */
.nav-bar-large-title {
  border-bottom: none;
}
</style>
