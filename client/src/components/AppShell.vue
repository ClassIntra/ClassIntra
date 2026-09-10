<template>
  <!--
    AppShell —— 应用统一容器
    ============================================================
    职责（对应 docs/ecosystem-design.md §3.1、§2 原则 1）：
      1. 令牌注入：把 :root 上生效的 --ci-* 令牌复制到本容器根节点，
         使第三方应用「零代码」获得主题跟随（含深色模式）
      2. 导航栏：为应用提供统一的 iOS 导航栏（可配置隐藏）
      3. 生命周期：挂载/卸载/挂起/恢复，配合 ResourceAuditor 回收资源
      4. 异常边界：渲染异常降级为「错误页 + 返回桌面」，避免整页白屏

    用法（第三方应用无需关心，由 MarketRuntime 内部使用）：
      <AppShell :app-name="name" :title="title" :show-navbar="true">
        <div ref="host"></div>
      </AppShell>
  -->
  <div class="app-shell" :data-app-name="appName" :data-shell-mode="shellMode">
    <!-- 统一导航栏（可隐藏） -->
    <div v-if="showNavbar" class="app-shell-nav">
      <div class="app-shell-nav-main">
        <div class="app-shell-nav-left">
          <button type="button" class="app-shell-back" @click="goBack">
            <i class="fa-solid fa-chevron-left"></i>
            <span class="app-shell-back-text">返回</span>
          </button>
        </div>
        <div class="app-shell-nav-center">
          <h1 class="app-shell-title">{{ title }}</h1>
        </div>
        <div class="app-shell-nav-right">
          <slot name="nav-right"></slot>
        </div>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="app-shell-body">
      <!-- 装载中 -->
      <div v-if="state === 'loading'" class="app-shell-state">
        <div class="app-shell-spinner"></div>
        <h2>正在打开应用</h2>
        <p>正在准备应用界面，请稍候</p>
      </div>

      <!-- 错误态 -->
      <div v-else-if="state === 'error'" class="app-shell-state">
        <i class="fa-solid fa-circle-exclamation app-shell-error-icon"></i>
        <h2>应用暂时无法打开</h2>
        <p>{{ errorMessage }}</p>
        <div class="app-shell-actions">
          <button type="button" @click="$emit('retry')">重试</button>
          <button type="button" class="app-shell-secondary" @click="goDesktop">返回桌面</button>
        </div>
      </div>

      <!-- 正常：应用宿主节点 -->
      <div
        v-show="state !== 'loading' && state !== 'error'"
        class="app-shell-host"
      >
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<script>
import { getTokenInjector } from '@/core/token-injector';

export default {
  name: 'AppShell',
  props: {
    // 应用名（用于数据属性与 storage 命名空间）
    appName: { type: String, required: true },
    // 导航栏标题
    title: { type: String, default: '' },
    // 是否显示系统导航栏（第三方可用 manifest.layout.navbar 控制）
    showNavbar: { type: Boolean, default: true },
    // 容器模式：'fullscreen' 全屏 | 'inset' 内嵌留边
    shellMode: { type: String, default: 'fullscreen' },
    // 当前状态：'loading' | 'active' | 'error'
    state: { type: String, default: 'active' },
    // 错误信息
    errorMessage: { type: String, default: '应用启动失败，请重试。' }
  },
  data: function() {
    return {
      _injector: null,
      _unsubscribeTheme: null
    };
  },
  mounted: function() {
    this.initTokenInjection();
  },
  beforeDestroy: function() {
    this.destroyTokenInjection();
  },
  watch: {
    // 应用切换时重新注入（不同应用可能有不同的 layout 覆盖）
    appName: function() {
      this.destroyTokenInjection();
      this.initTokenInjection();
    }
  },
  methods: {
    // 初始化令牌注入：这是第三方「零代码主题跟随」的实现点
    initTokenInjection: function() {
      var self = this;
      var el = self.$el;
      if (!el) return;

      var injector = getTokenInjector();
      self._injector = injector;

      // 1. 立即注入一次（同步，避免闪烁：先注令牌再渲染内容）
      injector.inject(el);

      // 2. 订阅主题变化，主题切换时重新注入
      var themeEngine = self.$root && self.$root.$themeEngine;
      if (!themeEngine && typeof window !== 'undefined' && window.__getThemeEngine) {
        try { themeEngine = window.__getThemeEngine(); } catch (e) { themeEngine = null; }
      }
      if (themeEngine && typeof themeEngine.subscribe === 'function') {
        self._unsubscribeTheme = themeEngine.subscribe(function() {
          // 主题变化时，等下一帧再注入（此时 :root 已更新）
          self.$nextTick(function() {
            if (self._injector && self.$el && !self._isDestroyed) {
              self._injector.inject(self.$el);
            }
          });
        });
      }
    },

    destroyTokenInjection: function() {
      if (typeof this._unsubscribeTheme === 'function') {
        try { this._unsubscribeTheme(); } catch (e) {}
        this._unsubscribeTheme = null;
      }
      // 清理注入到本容器的内联令牌，避免残留影响后续应用
      if (this._injector && this.$el) {
        this._injector.clean(this.$el);
      }
    },

    goBack: function() {
      this.$emit('back');
      if (window.history.length > 1) {
        this.$router.go(-1);
      } else {
        this.$router.push({ name: 'Desktop' });
      }
    },

    goDesktop: function() {
      this.$router.push({ name: 'Desktop' });
    }
  }
};
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  /* 容器背景使用令牌，随主题变化 */
  background: var(--background-color, #f2f2f7);
  color: var(--text-primary, #000);
  font-family: var(--font-family);
}

/* 导航栏（与 ios/IOSNavBar 视觉一致，此处内联避免跨模块依赖） */
.app-shell-nav {
  flex-shrink: 0;
}

.app-shell-nav-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 var(--spacing-sm, 8px);
  background: var(--nav-bg, rgba(255, 255, 255, 0.8));
  backdrop-filter: var(--glass-blur-container, blur(20px));
  -webkit-backdrop-filter: var(--glass-blur-container, blur(20px));
  border-bottom: 0.5px solid var(--separator-color, rgba(0, 0, 0, 0.1));
}

.app-shell-nav-left {
  display: flex;
  align-items: center;
  min-width: 70px;
}

.app-shell-back {
  display: flex;
  align-items: center;
  gap: 2px;
  border: none;
  background: transparent;
  color: var(--primary-color, #007aff);
  font-size: var(--font-size-body, 17px);
  font-family: var(--font-family);
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--radius-sm, 8px);
  transition: opacity var(--duration-fast, 0.15s) var(--ease-standard, ease);
  -webkit-tap-highlight-color: transparent;
}

.app-shell-back:active {
  opacity: 0.7;
}

.app-shell-back-text {
  font-size: var(--font-size-body, 17px);
}

.app-shell-nav-center {
  flex: 1;
  text-align: center;
  overflow: hidden;
}

.app-shell-title {
  font-size: var(--font-size-subheadline, 15px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--text-primary, #000);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-shell-nav-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 70px;
  gap: var(--spacing-xs, 4px);
}

/* 内容区 */
.app-shell-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.app-shell-host {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.app-shell-host > * {
  height: 100%;
  min-height: 0;
}

/* 状态页 */
.app-shell-state {
  display: flex;
  min-height: 60vh;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  color: var(--text-secondary, #8e8e93);
}

.app-shell-state h2 {
  color: var(--text-primary, #000);
  font-size: var(--font-size-title3, 20px);
  margin: 0;
}

.app-shell-state p {
  margin: 0;
  font-size: var(--font-size-body, 17px);
}

.app-shell-error-icon {
  color: #ff3b30;
  font-size: 28px;
}

.app-shell-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

.app-shell-actions button {
  border: 0;
  border-radius: var(--radius-sm, 10px);
  padding: 10px 16px;
  color: #fff;
  background: var(--primary-color, #007aff);
  cursor: pointer;
  font-family: var(--font-family);
  font-size: var(--font-size-body, 17px);
}

.app-shell-actions .app-shell-secondary {
  color: var(--text-primary, #000);
  background: var(--secondary-bg, rgba(120, 120, 128, 0.12));
}

.app-shell-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid var(--separator-color, rgba(0, 0, 0, 0.1));
  border-top-color: var(--primary-color, #007aff);
  border-radius: 50%;
  animation: app-shell-spin 0.8s linear infinite;
}

@keyframes app-shell-spin {
  to { transform: rotate(360deg); }
}
</style>
