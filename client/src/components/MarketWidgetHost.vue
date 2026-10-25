<template>
  <div class="market-widget-host" ref="host"></div>
</template>
<script>
// 市场应用小组件的通用宿主
// 按 definition.widgets[<widgetId>] 契约挂载/卸载渲染入口
//（契约见 docs/market-dev-guide.md）。外层经 widget-aggregator 的
// functional 包装组件接入桌面网格，config 变更时重新挂载。
import { marketRegistry } from '@/core/market-registry';

export default {
  name: 'MarketWidgetHost',
  props: {
    appName: { type: String, required: true },
    widgetId: { type: String, required: true },
    config: { type: Object, default: function() { return {}; } }
  },
  watch: {
    config: {
      deep: true,
      handler: function() {
        // 配置变更（桌面 widget 配置弹窗保存后）：重挂载让应用拿到新 config
        this.teardown();
        this._tornDown = false;
        this.renderWidget();
      }
    }
  },
  mounted: function() {
    this.renderWidget();
  },
  beforeDestroy: function() {
    this.teardown();
  },
  methods: {
    renderWidget: function() {
      var self = this;
      marketRegistry.ensureLoaded(self.appName).then(function(loaded) {
        if (self._tornDown) return;
        var def = loaded && loaded.definition;
        var widget = def && def.widgets && def.widgets[self.widgetId];
        if (!widget || typeof widget.mount !== 'function') {
          console.warn('[market-widget] 应用未提供 widget 渲染入口:', self.appName, self.widgetId);
          return;
        }
        var context = null;
        try {
          if (window.ClassIntraMarket && typeof window.ClassIntraMarket.createContext === 'function') {
            context = window.ClassIntraMarket.createContext(self.appName, loaded.app);
          }
        } catch (e) {}
        self._context = context;
        self._widget = widget;
        self._el = self.$refs.host;
        try {
          widget.mount(self._el, self.config || {}, context);
        } catch (error) {
          console.error('[market-widget] 挂载失败:', self.appName, self.widgetId, error);
          self._releaseContext();
        }
      }).catch(function(err) {
        console.error('[market-widget] 应用加载失败:', self.appName, self.widgetId, err && err.message);
      });
    },
    teardown: function() {
      this._tornDown = true;
      try {
        if (this._widget && typeof this._widget.unmount === 'function' && this._el) {
          this._widget.unmount(this._el);
        }
      } catch (e) {}
      this._releaseContext();
      this._widget = null;
      this._el = null;
    },
    // 只释放本宿主创建的 context（同名应用的页面/悬浮层 context 不受影响；
    // 应用整体卸载时由 market-registry 走 disposeContext 统一兜底）
    _releaseContext: function() {
      var ctx = this._context;
      this._context = null;
      if (!ctx) return;
      try {
        if (ctx.__internal && typeof ctx.__internal.dispose === 'function') ctx.__internal.dispose();
      } catch (e) {}
    }
  }
};
</script>
<style scoped>
.market-widget-host {
  width: 100%;
  height: 100%;
}
</style>
