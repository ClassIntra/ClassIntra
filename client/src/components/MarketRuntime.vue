<template>
  <div class="market-runtime" :data-market-app="appName">
    <div v-if="loading" class="market-runtime-state">
      <div class="runtime-spinner"></div>
      <h2>正在打开应用</h2>
      <p>正在准备应用界面，请稍候</p>
    </div>
    <div v-else-if="error" class="market-runtime-state">
      <i class="fa-solid fa-circle-exclamation runtime-error-icon"></i>
      <h2>应用暂时无法打开</h2>
      <p>{{ error }}</p>
      <div class="runtime-actions">
        <button type="button" @click="retry">重试</button>
        <button type="button" class="runtime-secondary" @click="goDesktop">返回桌面</button>
      </div>
    </div>
    <div v-else ref="container" class="market-runtime-container"></div>
  </div>
</template>

<script>
import { marketRegistry } from '@/core/market-registry';

export default {
  name: 'MarketRuntime',
  props: {
    appName: { type: String, required: true }
  },
  data: function() {
    return { error: '', loading: false, mountedDefinition: null, mountToken: 0 };
  },
  mounted: function() {
    this.mountApp();
  },
  beforeDestroy: function() {
    this.unmountApp();
  },
  watch: {
    appName: function() {
      this.unmountApp();
      this.mountApp();
    }
  },
  methods: {
    mountApp: function() {
      var self = this;
      var token = ++self.mountToken;
      var appName = self.appName;
      if (!self.$refs.container) return;
      self.error = '';
      self.loading = true;
      marketRegistry.ensureLoaded(appName).then(function(result) {
        if (token !== self.mountToken || self._isDestroyed || self.appName !== appName) return;
        self.loading = false;
        self.$nextTick(function() {
          if (token !== self.mountToken || self._isDestroyed || self.appName !== appName) return;
          try {
            if (marketRegistry.mount(appName, self.$refs.container, result.definition)) {
              self.mountedDefinition = result.definition;
            } else {
              self.error = '应用运行时不可用，请重试。';
            }
          } catch (error) {
            self.error = '应用运行时启动失败，请重试。';
          }
        });
      }).catch(function(error) {
        if (token !== self.mountToken || self._isDestroyed) return;
        self.loading = false;
        self.error = error && error.message === '应用已卸载' ? '应用已被移除，请返回桌面。' : '应用暂时无法打开，请重试。';
      });
    },
    unmountApp: function() {
      this.mountToken++;
      marketRegistry.unmount(this.appName, this.$refs.container);
      this.mountedDefinition = null;
    },
    retry: function() {
      this.unmountApp();
      this.mountApp();
    },
    goDesktop: function() {
      this.$router.push({ name: 'Desktop' });
    }
  }
};
</script>

<style scoped>
.market-runtime,
.market-runtime-container {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.market-runtime-container > * {
  height: 100%;
  min-height: 0;
}
.market-runtime-state {
  display: flex;
  min-height: 60vh;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  color: var(--text-secondary);
}
.market-runtime-state h2 { color: var(--text-primary); }
.market-runtime-state p { margin: 0; }
.runtime-error-icon { color: #ff3b30; font-size: 28px; }
.runtime-actions { display: flex; gap: 10px; margin-top: 8px; }
.runtime-actions button { border: 0; border-radius: 10px; padding: 10px 16px; color: #fff; background: var(--primary-color); cursor: pointer; }
.runtime-actions .runtime-secondary { color: var(--text-primary); background: var(--secondary-bg); }
.runtime-spinner { width: 30px; height: 30px; border: 3px solid var(--separator-color); border-top-color: var(--primary-color); border-radius: 50%; animation: runtime-spin .8s linear infinite; }
@keyframes runtime-spin { to { transform: rotate(360deg); } }
</style>
