<template>
  <div class="market-runtime" :data-market-app="appName">
    <div v-if="error" class="market-runtime-error">
      <h2>应用暂时无法打开</h2>
      <p>{{ error }}</p>
      <button type="button" @click="retry">重试</button>
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
    return { error: '', mountedDefinition: null };
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
      if (!self.$refs.container) return;
      self.error = '';
      marketRegistry.ensureLoaded(self.appName).then(function(result) {
        var context = window.ClassIntraMarket.createContext(self.appName);
        result.definition.mount(self.$refs.container, context);
        self.mountedDefinition = result.definition;
      }).catch(function(error) {
        self.error = error && error.message ? error.message : '未知错误';
      });
    },
    unmountApp: function() {
      if (this.mountedDefinition && typeof this.mountedDefinition.unmount === 'function') {
        try { this.mountedDefinition.unmount(this.$refs.container); } catch (e) {}
      }
      this.mountedDefinition = null;
    },
    retry: function() {
      this.unmountApp();
      this.mountApp();
    }
  }
};
</script>

<style scoped>
.market-runtime,
.market-runtime-container {
  width: 100%;
  min-height: 100%;
}
.market-runtime-error {
  display: flex;
  min-height: 60vh;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
}
</style>
