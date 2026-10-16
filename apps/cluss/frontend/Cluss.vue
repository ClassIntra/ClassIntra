<template>
  <div class="cluss-page">
    <!-- 主内容区：内嵌 Cluss（独立部署，默认同机 9003 端口），全屏无标题栏 -->
    <div class="cluss-content">
      <iframe
        v-if="clussUrl"
        ref="clussFrame"
        :src="clussUrl"
        class="cluss-iframe"
        @load="frameLoaded = true"
      ></iframe>

      <!-- HTTPS 页面无法内嵌 HTTP 站点（混合内容拦截）：降级为新窗口打开 -->
      <div v-else class="cluss-fallback">
        <i class="fa-solid fa-lock"></i>
        <p>当前页面为 HTTPS，无法内嵌 HTTP 的 Cluss（:9003）</p>
        <button class="capsule-btn cluss-open-btn" @click="openInNewWindow">在新窗口打开 Cluss</button>
      </div>

      <!-- 首帧加载遮罩 -->
      <transition name="cluss-fade">
        <div v-if="clussUrl && !frameLoaded" class="cluss-loading">
          <i class="fa-solid fa-circle-notch fa-spin"></i>
          <span>正在打开 Cluss…</span>
        </div>
      </transition>
    </div>
  </div>
</template>

<script>
// Cluss 联动应用：把独立部署的 Cluss（引导式 AI 解题）以全屏 iframe 嵌入。
// 地址按当前访问主机名推导（同机部署时 Cluss 固定在 9003 端口）。
// 若 ClassIntra 已登录，则把本系统签发的 JWT 经 ?token= 传给 Cluss，
// Cluss 端用共享的 CI_JWT_SECRET 验签后免登（账号联邦引入，见 Cluss server/src/middleware/auth.js）。
// Cluss 侧嵌入态顶栏的「返回 ClassIntra」按钮会 postMessage 回来，由这里退出应用。
var CLUSS_PORT = '9003';

export default {
  name: 'Cluss',
  data: function() {
    return {
      clussUrl: '',
      frameLoaded: false
    };
  },
  created: function() {
    // HTTPS 下内嵌 HTTP 会被浏览器当混合内容拦截，直接走新窗口降级
    if (window.location.protocol === 'https:') {
      this.clussUrl = '';
      return;
    }
    this.clussUrl = this.buildClussUrl();
  },
  watch: {
    // CI 侧 token 变化（重新登录 / 换账号 / 登出）后，iframe 必须跟随新凭据重新免登，
    // 否则 Cluss 会一直沿用进入应用那一刻的旧 token。
    // CI 的 JWT 固定 7 天且没有静默刷新（store/modules/auth.js 里只有 login/logout
    // 两个变更点），所以这里只会在用户显式登录/登出/换账号时触发，
    // 不会在学生做题中途打断。
    '$store.state.auth.token': function(newToken, oldToken) {
      if (newToken === oldToken) return;
      if (window.location.protocol === 'https:') return; // 降级态没有 iframe
      var url = this.buildClussUrl();
      if (url === this.clussUrl) return;
      this.frameLoaded = false; // 重新出现加载遮罩
      this.clussUrl = url;      // 换 src 即整页重载 iframe → Cluss 用新 token 重新免登
    }
  },
  mounted: function() {
    var self = this;
    self._onClussMessage = function(event) {
      if (event && event.data && event.data.type === 'cluss:navigate-back') {
        self.$router.push({ name: 'Desktop' }).catch(function() {});
      }
    };
    window.addEventListener('message', self._onClussMessage);
  },
  beforeDestroy: function() {
    if (this._onClussMessage) {
      window.removeEventListener('message', this._onClussMessage);
      this._onClussMessage = null;
    }
  },
  methods: {
    buildClussUrl: function() {
      var url = window.location.protocol + '//' + window.location.hostname + ':' + CLUSS_PORT + '/';
      // 已登录才带 token；未登录让 Cluss 自己走登录页
      var token = (this.$store && this.$store.state.auth && this.$store.state.auth.token) || '';
      if (token) url += '?token=' + encodeURIComponent(token);
      return url;
    },
    openInNewWindow: function() {
      // HTTPS 降级场景同样带上当前 token，避免新窗口里还要再登一次
      window.open(this.buildClussUrl(), '_blank');
    }
  }
};
</script>

<style scoped>
.cluss-page {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  flex-direction: column;
  background: var(--card-bg);
  z-index: 9999;
}

.cluss-content {
  flex: 1;
  display: flex;
  position: relative;
  overflow: hidden;
}

.cluss-iframe {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--card-bg);
  /* 隔离渲染层：内嵌页面重排不牵连外壳（同 Browser.vue 的性能口径） */
  contain: strict;
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
  will-change: transform;
}

.cluss-fallback {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  color: var(--text-tertiary);
  font-size: 14px;
  text-align: center;
}
.cluss-fallback i {
  font-size: 40px;
  opacity: 0.35;
}

.cluss-open-btn {
  height: 40px;
  padding: 0 20px;
}

.cluss-loading {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--card-bg);
  color: var(--text-tertiary);
  font-size: 14px;
  z-index: 2;
}
.cluss-loading i {
  font-size: 28px;
  color: var(--primary-color);
}

.cluss-fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-decelerate);
}
.cluss-fade-leave-to {
  opacity: 0;
}
</style>
