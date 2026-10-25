<template>
  <!--
    MarketRuntime —— 市场应用运行时容器
    职责：装载第三方应用，并用 AppShell 包裹，使其获得统一导航栏 + 令牌跟随 + 生命周期管理。
    定位见 docs/ecosystem-design.md §1.5：这是「应用」类型的运行时宿主。
  -->
  <AppShell
    :app-name="appName"
    :title="effectiveTitle"
    :show-navbar="showNavbar"
    :state="shellState"
    :error-message="error"
    @retry="retry"
    @back="onShellBack"
  >
    <div ref="container" class="market-runtime-container">
      <!-- 静态站形态（frontend.static）：iframe 加载，零适配迁入。
           同源（/market-static）→ 站内可直接读 localStorage('token') 调 /api，无需注入 -->
      <iframe
        v-if="staticUrl"
        :src="staticUrl"
        class="market-static-frame"
        :title="effectiveTitle"
        frameborder="0"
        allow="fullscreen"
      ></iframe>
    </div>
  </AppShell>
</template>

<script>
import AppShell from '@/components/AppShell.vue';
import { marketRegistry } from '@/core/market-registry';
import { getRuntimeKernel } from '@/core/runtime-kernel';
import { getTokenInjector } from '@/core/token-injector';
import { getThemeEngine } from '@/core/theme-engine';

export default {
  name: 'MarketRuntime',
  components: { AppShell },
  props: {
    appName: { type: String, required: true }
  },
  data: function() {
    return {
      error: '',
      loading: false,
      mountedDefinition: null,
      mountToken: 0,
      // 应用 manifest 提供的标题（用于导航栏）
      appTitle: '',
      // 应用是否隐藏系统导航栏（默认显示，保障「出得去」）
      hideNavbar: false,
      // 当前生命周期的对外投影（供 AppShell 展示状态页）
      lifecycleState: 'idle'
    };
  },
  computed: {
    // 传给 AppShell 的状态：loading / error / active
    shellState: function() {
      if (this.loading) return 'loading';
      if (this.error) return 'error';
      return 'active';
    },
    effectiveTitle: function() {
      return this.appTitle || this.appName;
    },
    showNavbar: function() {
      return !this.hideNavbar;
    },
    // 静态站形态的 iframe 地址（manifest frontend.static 透传为 frontendStatic）
    staticUrl: function() {
      var app = marketRegistry.getInstalled(this.appName) || {};
      if (!app.frontendStatic) return '';
      return '/market-static/' + this.appName + '/' +
        String(app.frontendStatic).replace(/^\.\//, '') + '?v=' + encodeURIComponent(app.version || '');
    }
  },
  mounted: function() {
    this.mountApp();
    // 静态站 RPC 桥：iframe 内 <script src="/ci-adapter.js"> 的调用代理到系统
    //（校验来源：只信自己 iframe 的 contentWindow）
    this._onFrameMessage = this.handleFrameMessage.bind(this);
    window.addEventListener('message', this._onFrameMessage);
    // 页面可见性变化时挂起/恢复（平板省电的关键）
    this._onVisibilityChange = this.handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  },
  beforeDestroy: function() {
    window.removeEventListener('message', this._onFrameMessage);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    this.unmountApp();
  },
  watch: {
    appName: function() {
      this.unmountApp();
      this.mountApp();
    }
  },
  methods: {
    // 读取应用 manifest 中的外观配置
    readLayout: function() {
      var self = this;
      var def = self.mountedDefinition;
      // manifest 来源优先级：应用注册时自带 → registry 已安装对象（server 从 manifest 透传的字段子集，含 layout）
      var manifest = (def && def.manifest) || marketRegistry.getInstalled(self.appName) || {};
      // 标题：优先 manifest.label / name
      self.appTitle = manifest.label || manifest.title || manifest.name || self.appName;
      // 导航栏：manifest.layout.navbar === 'custom' 时隐藏系统导航栏
      var layout = manifest.layout || {};
      self.hideNavbar = layout.navbar === 'custom';
    },

    mountApp: function() {
      var self = this;
      var token = ++self.mountToken;
      var appName = self.appName;
      if (!self.$refs.container) return;
      self.error = '';
      self.loading = true;

      // 静态站形态：iframe 渲染（不走 entry.js/生命周期装载，AppShell 照常提供导航）
      if (self.staticUrl) {
        self.loading = false;
        self.lifecycleState = 'active';
        self.appTitle = appName;
        try {
          var installed = marketRegistry.getInstalled(appName) || {};
          self.appTitle = installed.label || appName;
        } catch (e) {}
        // 主题变化推送给 iframe（CI.onTheme 订阅方接收）
        try {
          var engine = getThemeEngine();
          self._offTheme = engine.subscribe(function() {
            var frame = self._frameEl();
            if (!frame) return;
            try {
              var id2 = engine.getCurrentTheme ? engine.getCurrentTheme() : '';
              var t = engine.getTheme(id2);
              frame.contentWindow.postMessage({ __ci: 1, event: 'theme-changed', data: { id: id2, tokens: (t && t.tokens) || null } }, '*');
            } catch (e2) {}
          });
        } catch (e) {}
        return;
      }

      // 通过内核创建生命周期机（含资源审计）
      var kernel = getRuntimeKernel();
      var lc = kernel.attachLifecycle(appName, {
        onUnmount: function() {
          // 真正卸载时需要把定义里的 unmount 也调起来
          try {
            marketRegistry.unmount(appName, self.$refs.container);
          } catch (e) {}
        }
      });
      self._machine = lc.machine;
      self._auditor = lc.auditor;

      marketRegistry.ensureLoaded(appName).then(function(result) {
        if (token !== self.mountToken || self._isDestroyed || self.appName !== appName) return;
        self.loading = false;
        self.$nextTick(function() {
          if (token !== self.mountToken || self._isDestroyed || self.appName !== appName) return;
          var el = self.$refs.container;
          if (!el) return;

          // 1. 先注入令牌（在内容渲染前，避免闪烁）
          try {
            getTokenInjector().inject(el);
          } catch (e) {
            // 注入失败不阻断装载（降级：仍可显示，只是不跟随主题）
          }

          // 2. 记录 manifest 外观配置（用于 AppShell 的导航栏）
          self.mountedDefinition = result.definition;
          self.readLayout();

          // 3. 装载应用定义
          self.$nextTick(function() {
            if (token !== self.mountToken || self._isDestroyed) return;
            try {
              var ok = marketRegistry.mount(appName, el, result.definition);
              if (!ok) {
                self.error = '应用运行时不可用，请重试。';
                return;
              }
              // 进入 active 态
              self._machine.mount({ appName: appName }).then(function() {
                self.lifecycleState = self._machine.getState();
              }).catch(function() {
                self.lifecycleState = 'error';
              });
            } catch (error) {
              self.error = '应用运行时启动失败，请重试。';
            }
          });
        });
      }).catch(function(error) {
        if (token !== self.mountToken || self._isDestroyed) return;
        self.loading = false;
        self.error = error && error.message === '应用已卸载' ? '应用已被移除，请返回桌面。' : '应用暂时无法打开，请重试。';
      });
    },

    unmountApp: function() {
      this.mountToken++;
      var self = this;
      if (self._offTheme) {
        try { self._offTheme(); } catch (e) {}
        self._offTheme = null;
      }
      if (self._machine) {
        try { self._machine.unmount(); } catch (e) {}
        self.lifecycleState = 'idle';
      }
      marketRegistry.unmount(this.appName, this.$refs.container);
      // 清理注入的令牌
      try {
        if (this.$refs.container) getTokenInjector().clean(this.$refs.container);
      } catch (e) {}
      this.mountedDefinition = null;
    },

    // ===== 静态站 RPC 桥（协议见 client/public/ci-adapter.js）=====
    _frameEl: function() {
      var el = this.$refs.container;
      return el ? el.querySelector('iframe.market-static-frame') : null;
    },
    handleFrameMessage: function(e) {
      var d = e.data;
      if (!d || d.__ci !== 1 || !d.method) return;
      var frame = this._frameEl();
      if (!frame || e.source !== frame.contentWindow) return; // 只信自己的 iframe
      var self = this;
      var reply = function(ok, result) {
        try {
          frame.contentWindow.postMessage({ __ci: 1, id: d.id, ok: !!ok, result: result }, '*');
        } catch (err) {}
      };
      switch (d.method) {
        case 'user': {
          var u = (self.$store && self.$store.state.auth && self.$store.state.auth.user) || null;
          if (!u) { reply(false, '未登录'); return; }
          reply(true, {
            user_id: u.user_id, net_name: u.net_name, real_name: u.real_name,
            role: u.role, is_admin: u.is_admin, is_class_admin: u.is_class_admin
          });
          return;
        }
        case 'theme': {
          try {
            var engine = getThemeEngine();
            var currentId = engine.getCurrentTheme ? engine.getCurrentTheme() : '';
            var cur = engine.getTheme(currentId);
            reply(true, { id: currentId, tokens: (cur && cur.tokens) || null });
          } catch (err) { reply(false, '主题不可用'); }
          return;
        }
        case 'back':
          self.onShellBack();
          self.goDesktop();
          reply(true, true);
          return;
        case 'toast': {
          var p = d.params || {};
          self.$store.commit('toast/SHOW_TOAST', { message: String(p.message || ''), type: p.type || 'info' });
          reply(true, true);
          return;
        }
        default:
          reply(false, '未知方法: ' + d.method);
      }
    },
    handleVisibilityChange: function() {
      var self = this;
      if (!self._machine || self.lifecycleState !== 'active') return;
      var kernel = getRuntimeKernel();
      if (document.hidden) {
        try {
          var r = kernel.suspend(self.appName);
          if (r) self.lifecycleState = r.state;
        } catch (e) {}
      } else if (self.lifecycleState === 'suspended') {
        try {
          kernel.resume(self.appName);
          self.lifecycleState = 'active';
        } catch (e) {}
      }
    },

    retry: function() {
      this.unmountApp();
      this.mountApp();
    },

    onShellBack: function() {
      // 允许应用拦截返回（如棋盘未保存时的二次确认）
      var def = this.mountedDefinition;
      if (def && typeof def.onBack === 'function') {
        try {
          if (def.onBack() === false) return; // 应用返回 false 表示「已拦截」
        } catch (e) {}
      }
    },

    goDesktop: function() {
      this.$router.push({ name: 'Desktop' });
    }
  }
};
</script>

<style scoped>
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
.market-static-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  background: var(--bg-color, #fff);
}
</style>
