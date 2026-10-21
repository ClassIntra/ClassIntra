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

        <!-- 三种进不来的情况共用这个兜底：HTTPS 下 Cluss 服务没起（反代 502）、
             探测接口不通、或 Cluss 部署在另一台机器上而本机没有起反代。
             区别只在该不该给「重试」按钮，见下面 clussDown 的赋值处。 -->
        <div v-else class="cluss-fallback">
          <i class="fa-solid fa-plug-circle-xmark"></i>
          <p>{{ downMessage }}</p>
          <div class="cluss-fallback-btns">
            <button v-if="downRetryable" class="capsule-btn cluss-open-btn" @click="retry">重试</button>
            <!-- 最后一条路：绕过反代直接连 9003。HTTPS 页面里点它会被浏览器
                 拦（混合内容），但至少给了明确的下一步；同一台机器上 Cluss
                 通常是起着的，真正拦不住的情况是 Cluss 那台没起来。 -->
            <button class="capsule-btn cluss-open-btn" @click="openInNewWindow">直接打开 Cluss（:9003）</button>
          </div>
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
//
// 两条链路，按当前协议二选一：
//   HTTP（http://<host>:9001 访问 CI）—— iframe 直连 http://<host>:9003，
//     这是最早的形态，跨端口但同是明文，浏览器不拦。
//   HTTPS（https://<host> 访问 CI）—— iframe 指向**同源**的 /cluss-app/，
//     由服务端反代到 127.0.0.1:9003。不能用直连：HTTPS 页面里的 HTTP 子资源
//     一律被当混合内容拦掉，iframe 属 active mixed content，没有任何开关放行。
//     反代的实现与取舍见 server/src/routes/cluss-proxy.js 顶部注释。
//
// 若 ClassIntra 已登录，则把本系统签发的 JWT 经 ?token= 传给 Cluss，
// Cluss 端用共享的 CI_JWT_SECRET 验签后免登（账号联邦引入，见 Cluss server/src/middleware/auth.js）。
// Cluss 侧嵌入态顶栏的「返回 ClassIntra」按钮会 postMessage 回来，由这里退出应用。
var CLUSS_PORT = '9003';
// 必须与 server/src/routes/cluss-proxy.js 的 CLUSS_MOUNT 一致。
// 刻意不叫 /cluss：那是 CI 自己的应用壳路由（manifest route），会被 app.get('*') 兜底。
var CLUSS_MOUNT = '/cluss-app';
// 探测超时：反代在 Cluss 没起时是「连不上就回 502」，速度很快；
// 给 6 秒是留给「Cluss 在但卡住」的情况，别让学生干等。
var PROBE_TIMEOUT_MS = 6000;

export default {
  name: 'Cluss',
  data: function() {
    return {
      clussUrl: '',
      frameLoaded: false,
      // 兜底面板的话术与「要不要给重试按钮」
      downMessage: '',
      downRetryable: false
    };
  },
  created: function() {
    if (window.location.protocol === 'https:') {
      // 先探活再决定是否挂 iframe：Cluss 没起时，反代回的是一个 502 页面，
      // 而 iframe 的 load 事件对「加载成功但内容是错误页」同样会触发，
      // 学生看到的就是 Cluss 界面里嵌着一段「没有启动」的提示——不如在外面说清楚。
      this.probeAndEnter();
      return;
    }
    this.clussUrl = this.buildDirectUrl();
  },
  watch: {
    // CI 侧 token 变化（重新登录 / 换账号 / 登出）后，iframe 必须跟随新凭据重新免登，
    // 否则 Cluss 会一直沿用进入应用那一刻的旧 token。
    // CI 的 JWT 固定 7 天且没有静默刷新（store/modules/auth.js 里只有 login/logout
    // 两个变更点），所以这里只会在用户显式登录/登出/换账号时触发，
    // 不会在学生做题中途打断。
    '$store.state.auth.token': function(newToken, oldToken) {
      if (newToken === oldToken) return;
      // 降级态（探测失败）没有 iframe， token 变了也不用管；
      // 真要恢复得走重试按钮，那边会重新探活。
      if (!this.clussUrl) return;
      var url = this.buildDirectUrl();
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
    // 拼目标地址。已登录才带 token；未登录让 Cluss 自己走登录页。
    // 两条链路的 base 不同：HTTP 是绝对地址（直连 9003），HTTPS 是同源反代路径。
    buildUrl: function(base) {
      var token = (this.$store && this.$store.state.auth && this.$store.state.auth.token) || '';
      return token ? base + '?token=' + encodeURIComponent(token) : base;
    },
    buildProxiedUrl: function() {
      return this.buildUrl(CLUSS_MOUNT + '/');
    },
    buildDirectUrl: function() {
      return this.buildUrl(window.location.protocol + '//' + window.location.hostname + ':' + CLUSS_PORT + '/');
    },
    // 探活：反代能否通到 Cluss。用 health 而不是「直接塞 src 给 iframe」的
    // 原因是 iframe 的 load 事件分不清「Cluss 首页」和「反代回的 502 兜底页」，
    // 而 health 通不了就一定是后端没起来，话术能说准。
    probeAndEnter: function() {
      var self = this;
      self.downMessage = '';
      self.downRetryable = false;
      var timer = setTimeout(function() {
        self.showDown('Cluss 没有响应（本机 9003 端口上的 Cluss 服务可能没启动）。', true);
      }, PROBE_TIMEOUT_MS);
      fetch(CLUSS_MOUNT + '/api/health', { cache: 'no-store' })
        .then(function(r) {
          clearTimeout(timer);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          self.frameLoaded = false;
          self.clussUrl = self.buildProxiedUrl();
        })
        .catch(function() {
          clearTimeout(timer);
          self.showDown('连不上 Cluss（本机 9003 端口上的 Cluss 服务可能没启动）。', true);
        });
    },
    showDown: function(msg, retryable) {
      this.clussUrl = '';
      this.downMessage = msg;
      this.downRetryable = !!retryable;
    },
    retry: function() {
      if (window.location.protocol === 'https:') {
        this.probeAndEnter();
        return;
      }
      this.clussUrl = this.buildDirectUrl();
    },
    openInNewWindow: function() {
      // 带上当前 token，避免新窗口里还要再登一次
      window.open(this.buildUrl(CLUSS_MOUNT + '/'), '_blank');
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

/* 兜底面板的两个按钮横排；窄屏（竖屏平板）折成两行，避免挤成一团 */
.cluss-fallback-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
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
