<template>
  <div class="login-page" :class="{ 'page-enter': entered, 'has-video-bg': !!videoSrc }">
    <!-- 壁纸层：复刻桌面壁纸，登录页即「系统锁屏」，与启动动画同语言 -->
    <div class="auth-wallpaper" :style="wallpaperStyle" aria-hidden="true">
      <video
        v-if="videoSrc"
        class="auth-wallpaper-video"
        :src="videoSrc"
        autoplay
        muted
        loop
        playsinline
        preload="auto"
        @error="videoFailed = true"
      ></video>
    </div>
    <div class="auth-scrim" aria-hidden="true"></div>

    <div class="login-card">
      <div class="login-header">
        <!-- 标识为临时占位：替换 Resources/public/brand/logo-mark-white.png
             （纯白图形 + 透明底 + 紧密裁切）即可，尺寸自适应无需改样式 -->
        <img class="login-mark" :src="brandMark" alt="" aria-hidden="true" />
        <h1 class="login-title">ClassIntra</h1>
        <p class="login-subtitle">智慧校园平台</p>
      </div>
      <form class="login-form" @submit.prevent="handleLogin">
        <div v-if="isLoggedIn && currentUserLabel" class="switch-hint">
          <i class="fa-solid fa-right-left"></i>
          <span>当前已登录：<strong>{{ currentUserLabel }}</strong>，登录其他账号将自动切换</span>
        </div>
        <div class="form-group">
          <div class="input-wrap" :class="{ 'input-error': accountError, 'input-focused': accountFocused }">
            <i class="fa-solid fa-user input-icon" aria-hidden="true"></i>
            <input
              v-model="account"
              type="text"
              class="form-input"
              placeholder="用户名 / ID / 网名"
              autocomplete="username"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              aria-label="账号"
              @input="accountError = false"
              @focus="accountFocused = true"
              @blur="accountFocused = false"
            />
          </div>
        </div>
        <div class="form-group">
          <div class="input-wrap" :class="{ 'input-error': passwordError, 'input-focused': passwordFocused }">
            <i class="fa-solid fa-lock input-icon" aria-hidden="true"></i>
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              class="form-input"
              placeholder="密码"
              autocomplete="current-password"
              enterkeyhint="go"
              aria-label="密码"
              @input="passwordError = false"
              @focus="passwordFocused = true"
              @blur="passwordFocused = false"
            />
            <button
              type="button"
              class="password-toggle"
              @click="showPassword = !showPassword"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
            >
              <i :class="showPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <transition name="error-fade">
          <div v-if="errorMsg" class="error-message" role="alert">
            <i class="fa-solid fa-circle-exclamation error-icon" aria-hidden="true"></i>
            <span class="error-text">{{ errorMsg }}</span>
          </div>
        </transition>
        <button type="submit" class="btn-primary" :disabled="loading">
          <span v-if="loading" class="btn-loading"></span>
          <span v-else>登 录</span>
        </button>
      </form>
      <div class="login-footer">
        <span class="footer-text">还没有账号？</span>
        <router-link to="/register" class="footer-link">立即注册</router-link>
        <span v-if="isLoggedIn" class="footer-divider">·</span>
        <router-link v-if="isLoggedIn" to="/" class="footer-link">返回桌面</router-link>
        <span class="footer-divider">·</span>
        <a href="javascript:void(0)" class="footer-link" @click="showQuickUpload = true">快捷上传</a>
      </div>
    </div>

    <!-- 快捷上传（登录码）弹窗：iPadOS Sheet 风格（底部滑入 + 圆角顶部） -->
    <transition name="sheet-fade">
      <div v-if="showQuickUpload" class="sheet-overlay" @click.self="closeQuickUpload">
        <div class="sheet-card">
          <div class="sheet-grabber" aria-hidden="true"></div>
          <button class="sheet-close" @click="closeQuickUpload" aria-label="关闭">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
          <div class="sheet-header">
            <div class="sheet-icon-wrap">
              <i class="fa-solid fa-cloud-arrow-up sheet-icon" aria-hidden="true"></i>
            </div>
            <h3 class="sheet-title">快捷上传</h3>
            <p class="sheet-desc">请输入已登录用户云盘页显示的上传码</p>
          </div>
          <form class="sheet-form" @submit.prevent="verifyCode">
            <div class="sheet-input-wrap">
              <input
                v-model="quickCode"
                type="text"
                class="sheet-input"
                :class="{ 'input-error': quickError }"
                placeholder="请输入6位上传码"
                maxlength="6"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                @input="onCodeInput"
              />
            </div>
            <transition name="error-fade">
              <div v-if="quickError" class="error-message" role="alert">
                <i class="fa-solid fa-circle-exclamation error-icon" aria-hidden="true"></i>
                <span class="error-text">{{ quickError }}</span>
              </div>
            </transition>
            <button type="submit" class="sheet-submit" :disabled="quickLoading || quickCode.length !== 6">
              <span v-if="quickLoading" class="btn-loading"></span>
              <span v-else>验证并上传</span>
            </button>
          </form>
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
import axios from 'axios';
import { resolveWallpaper, AUTH_BACKDROP } from '@/utils/wallpaper-bg';

// 品牌标识（临时占位：替换 Resources/public/brand/logo-mark-white.png 即可，
// 要求纯白图形 + 透明底 + 紧密裁切）。运行时字符串，避免打包器解析成模块路径。
var BRAND_MARK = '/resources/public/brand/logo-mark-white.png';

export default {
  name: 'Login',
  data: function() {
    return {
      brandMark: BRAND_MARK,
      account: '',
      password: '',
      errorMsg: '',
      loading: false,
      accountError: false,
      passwordError: false,
      accountFocused: false,
      passwordFocused: false,
      entered: false,
      showPassword: false,
      // 壁纸
      videoFailed: false,
      // 快捷上传相关
      showQuickUpload: false,
      quickCode: '',
      quickError: '',
      quickLoading: false
    };
  },
  computed: {
    wallpaperResolved: function() {
      return resolveWallpaper(this.$store.state.settings.wallpaper);
    },
    // 仅当用户真正选了图片/视频壁纸时才铺壁纸；渐变预设一律走中性深色底色
    wallpaperStyle: function() {
      if (this.wallpaperResolved.type === 'image') return this.wallpaperResolved.style;
      return { background: AUTH_BACKDROP };
    },
    videoSrc: function() {
      if (this.videoFailed) return '';
      return this.wallpaperResolved.type === 'video' ? this.wallpaperResolved.src : '';
    },
    isLoggedIn: function() {
      return !!this.$store.state.auth.token;
    },
    currentUserLabel: function() {
      var u = this.$store.state.auth.user;
      if (!u) return '';
      var name = u.net_name || u.real_name || u.user_id || '';
      var cc = String(u.user_id || '').substring(2, 4);
      var classTag = /^\d{2}$/.test(cc) ? '（' + cc + '班）' : '';
      return name + classTag;
    }
  },
  mounted: function() {
    var self = this;
    // 记住上次登录账号（同设备切换账号时免重复输入）
    try {
      var last = localStorage.getItem('ci_last_account');
      if (last && !self.account) self.account = last;
    } catch (e) {}
    // 入场动画在下一帧触发，确保 CSS 过渡生效
    self.$nextTick(function() {
      requestAnimationFrame(function() {
        self.entered = true;
      });
      // 兜底：后台标签页 rAF 被节流时，定时器保证入场动画最终触发
      setTimeout(function() {
        self.entered = true;
      }, 400);
    });
  },
  methods: {
    onCodeInput: function() {
      // 自动转大写，过滤非字母数字
      this.quickCode = this.quickCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (this.quickError) this.quickError = '';
    },
    closeQuickUpload: function() {
      this.showQuickUpload = false;
      this.quickCode = '';
      this.quickError = '';
      this.quickLoading = false;
    },
    verifyCode: function() {
      var self = this;
      if (self.quickCode.length !== 6) {
        self.quickError = '请输入6位上传码';
        return;
      }
      self.quickLoading = true;
      self.quickError = '';
      // 使用独立 axios 实例，避免触发 401 拦截器
      axios.post('/api/cloud/verify-code', { code: self.quickCode }).then(function(res) {
        self.quickLoading = false;
        var data = res.data;
        if (data.code === 200 && data.data && data.data.valid) {
          // 验证通过，跳转到免登录上传页
          self.$router.push({ path: '/guest-upload', query: { code: self.quickCode } });
        } else {
          self.quickError = (data.data && data.data.message) || '上传码无效';
        }
      }).catch(function() {
        self.quickLoading = false;
        self.quickError = '验证失败，请检查网络后重试';
      });
    },
    handleLogin: function() {
      var self = this;
      self.errorMsg = '';
      self.accountError = false;
      self.passwordError = false;
      if (!self.account.trim()) {
        self.accountError = true;
        self.errorMsg = '请输入用户名';
        return;
      }
      if (!self.password) {
        self.passwordError = true;
        self.errorMsg = '请输入密码';
        return;
      }
      self.loading = true;
      self.$store
        .dispatch('auth/login', {
          account: self.account.trim(),
          password: self.password
        })
        .then(function() {
          // 记住本次登录账号（下次自动填充）
          try { localStorage.setItem('ci_last_account', self.account.trim()); } catch (e) {}
          // router.push 单独捕获，避免 NavigationDuplicated 进入登录错误处理
          return self.$router.push({ name: 'Desktop' }).catch(function(navErr) {
            if (navErr && navErr.name !== 'NavigationDuplicated' && navErr.name !== 'NavigationAborted') {
              console.warn('[Login] Navigation after login failed:', navErr);
            }
            // 登录已成功，即使导航重复也不应显示错误消息
          });
        })
        .catch(function(err) {
          var data = err.response && err.response.data;
          self.errorMsg = (data && data.message) || '登录失败，请检查用户名和密码';
          if (self.errorMsg.indexOf('用户') > -1 || self.errorMsg.indexOf('账号') > -1) {
            self.accountError = true;
          } else if (self.errorMsg.indexOf('密码') > -1) {
            self.passwordError = true;
          }
        })
        .finally(function() {
          self.loading = false;
        });
    }
  }
};
</script>

<style scoped>
/* ============================================================
   登录页 = 系统锁屏
   全屏壁纸（复刻桌面）+ 暗调蒙版 + 中央玻璃卡 + 白色标识
   Chrome 80 基线：不使用 gap / inset / :is() / aspect-ratio
   ============================================================ */

.login-page {
  /* 全部色彩自持：不依赖明暗主题变量，壁纸上永远保持同一质感 */
  --auth-text: rgba(255, 255, 255, 0.97);
  --auth-text-2: rgba(255, 255, 255, 0.7);
  --auth-text-3: rgba(255, 255, 255, 0.48);
  --auth-hairline: rgba(255, 255, 255, 0.1);
  --auth-field: rgba(255, 255, 255, 0.06);
  --auth-field-strong: rgba(255, 255, 255, 0.1);
  --auth-danger: #ffb3ae;
  --auth-danger-rgb: 255, 69, 58;

  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 28px 20px;
  box-sizing: border-box;
  /* 未加载壁纸前与启动动画的纯黑衔接 */
  background: #0b0b0d;
  isolation: isolate;
}

/* ---------- 壁纸层（固定于视口，页面滚动时壁纸不动） ---------- */
.auth-wallpaper {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  background-size: cover;
  background-position: center center;
  background-repeat: no-repeat;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.7s var(--ease-standard, ease);
  will-change: opacity;
}

.login-page.page-enter .auth-wallpaper {
  opacity: 1;
}

.auth-wallpaper-video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

/* ---------- 蒙版：压暗壁纸，让面板与背景分层 ---------- */
.auth-scrim {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  pointer-events: none;
  background:
    radial-gradient(130% 100% at 50% 40%, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.5) 100%),
    rgba(0, 0, 0, 0.14);
  opacity: 0;
  transition: opacity 0.7s var(--ease-standard, ease);
}

.login-page.page-enter .auth-scrim {
  opacity: 1;
}

/* 视频壁纸：模糊开销按帧结算，降低半径以保低端设备流畅 */
.login-page.has-video-bg .login-card,
.login-page.has-video-bg .sheet-card {
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  backdrop-filter: blur(16px) saturate(140%);
}

/* ---------- 登录面板：克制的深色实体面，靠描边与投影分层 ---------- */
.login-card {
  position: relative;
  z-index: 2;
  /* margin:auto 居中：内容超高时不会被 flex 居中裁掉顶部 */
  margin: auto;
  width: 424px;
  max-width: 100%;
  padding: 38px 40px 30px;
  box-sizing: border-box;
  background: rgba(22, 22, 26, 0.9);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 22px;
  box-shadow:
    0 20px 50px rgba(0, 0, 0, 0.46),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  color: var(--auth-text);
  /* 入场：从下方微升 + 微缩放（不从不透明度 0 的 scale(0) 起步） */
  opacity: 0;
  transform: translateY(18px) scale(0.97);
  transition: opacity 0.5s var(--ease-decelerate, ease),
              transform 0.62s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}

.login-page.page-enter .login-card {
  opacity: 1;
  transform: translateY(0) scale(1);
}

/* ---------- 品牌区 ---------- */
.login-header {
  text-align: center;
  margin-bottom: 26px;
}

.login-mark {
  display: block;
  width: 72px;
  height: 58px;
  margin: 0 auto 12px;
  object-fit: contain;
}

.login-title {
  margin: 0;
  font-size: 25px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.4px;
  color: var(--auth-text);
}

.login-subtitle {
  margin: 7px 0 0;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 3px;
  text-indent: 3px;
  color: var(--auth-text-3);
}

/* ---------- 切换账号提示 ---------- */
.switch-hint {
  display: flex;
  align-items: center;
  padding: 9px 12px;
  margin-bottom: 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--auth-hairline);
  color: rgba(255, 255, 255, 0.86);
  font-size: 12px;
  line-height: 1.5;
}

.switch-hint i {
  flex-shrink: 0;
  margin-right: 8px;
  font-size: 12px;
  opacity: 0.9;
}

.switch-hint strong {
  font-weight: 500;
  color: #fff;
}

/* ---------- 表单 ---------- */
.login-form {
  display: flex;
  flex-direction: column;
}

.form-group {
  width: 100%;
}

.form-group + .form-group {
  margin-top: 12px;
}

/* 输入框：玻璃内嵌，聚焦时描边提亮 */
.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  height: 54px;
  box-sizing: border-box;
  background: var(--auth-field);
  border: 1px solid var(--auth-hairline);
  border-radius: 14px;
  transition: border-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              background-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              box-shadow var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.input-wrap.input-focused {
  border-color: rgba(255, 255, 255, 0.42);
  background: var(--auth-field-strong);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08);
}

.input-wrap.input-error {
  border-color: rgba(var(--auth-danger-rgb), 0.7);
  background: rgba(var(--auth-danger-rgb), 0.12);
  box-shadow: 0 0 0 3.5px rgba(var(--auth-danger-rgb), 0.14);
}

.input-icon {
  flex-shrink: 0;
  width: 22px;
  margin-left: 15px;
  font-size: 15px;
  text-align: center;
  color: var(--auth-text-3);
  transition: color var(--duration-fast, 0.15s) var(--ease-standard, ease);
  pointer-events: none;
}

.input-wrap.input-focused .input-icon {
  color: rgba(255, 255, 255, 0.9);
}

.input-wrap.input-error .input-icon {
  color: var(--auth-danger);
}

.form-input {
  flex: 1;
  width: 100%;
  height: 100%;
  padding: 0 12px;
  border: none;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
  font-size: 15px;
  color: var(--auth-text);
  /* 移动端浏览器默认会给输入框加内阴影，这里统一压掉 */
  -webkit-appearance: none;
}

.form-input:focus {
  outline: none;
  border-color: transparent;
  box-shadow: none;
}

.form-input::placeholder {
  color: var(--auth-text-3);
  opacity: 1;
}

/* 浏览器自动填充时不要变成白底黑字 */
.form-input:-webkit-autofill,
.form-input:-webkit-autofill:focus {
  -webkit-text-fill-color: var(--auth-text);
  -webkit-box-shadow: 0 0 0 40px #2a2a30 inset;
  transition: background-color 9999s ease-out 0s;
}

.password-toggle {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  margin-right: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--auth-text-2);
  background: transparent;
  border: none;
  border-radius: 12px;
  transition: background-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.password-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

/* ---------- 错误提示 ---------- */
.error-message {
  display: flex;
  align-items: center;
  margin-top: 12px;
  padding: 10px 13px;
  background: rgba(var(--auth-danger-rgb), 0.16);
  border: 1px solid rgba(var(--auth-danger-rgb), 0.3);
  color: var(--auth-danger);
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.45;
}

.error-icon {
  flex-shrink: 0;
  margin-right: 8px;
  font-size: 14px;
}

.error-text {
  flex: 1;
}

/* ---------- 主按钮：白色实心，壁纸上最亮的一点 ---------- */
.btn-primary {
  width: 100%;
  height: 52px;
  margin-top: 18px;
  border: none;
  border-radius: 14px;
  background: #fff;
  color: #101014;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
  transition: background-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              transform var(--duration-fast, 0.15s) var(--ease-standard, ease),
              box-shadow var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.btn-primary:hover {
  background: #f2f2f5;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.32);
}

.btn-primary:active {
  transform: scale(0.98);
  background: #e6e6ea;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24);
}

.btn-primary:disabled {
  opacity: 0.62;
  transform: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.btn-loading {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(16, 16, 20, 0.25);
  border-top-color: #101014;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ---------- 页脚 ---------- */
.login-footer {
  margin-top: 22px;
  text-align: center;
  font-size: 13px;
  line-height: 1.9;
}

.footer-text {
  color: var(--auth-text-3);
}

.footer-divider {
  margin: 0 7px;
  color: rgba(255, 255, 255, 0.28);
}

/* 页脚链接刻意压低一档亮度：让白色主按钮始终是画面中最亮的一点 */
.footer-link {
  color: rgba(255, 255, 255, 0.82);
  font-weight: 500;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.22);
  padding-bottom: 1px;
  transition: border-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.footer-link:hover {
  color: #fff;
  border-bottom-color: rgba(255, 255, 255, 0.62);
}

/* 键盘可达性：独立规则，避免与逗号选择器列表在同一规则里（Chrome 80 不识别 :focus-visible 会整条失效） */
.login-page button:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.85);
  outline-offset: 2px;
}

/* ---------- 错误条过渡：从左滑入 + 淡入 ---------- */
.error-fade-enter-active {
  transition: opacity var(--duration-fast, 0.15s) var(--ease-decelerate, ease),
              transform var(--duration-fast, 0.15s) var(--ease-decelerate, ease);
}

.error-fade-leave-active {
  transition: opacity var(--duration-fast, 0.15s) var(--ease-accelerate, ease),
              transform var(--duration-fast, 0.15s) var(--ease-accelerate, ease);
}

.error-fade-enter {
  opacity: 0;
  transform: translateX(-8px);
}

.error-fade-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

/* ============================================================
   快捷上传 Sheet：与登录卡同一套玻璃语言
   ============================================================ */
.sheet-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 10000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.sheet-card {
  position: relative;
  width: 100%;
  max-width: 420px;
  padding: 12px 26px 26px;
  box-sizing: border-box;
  background: rgba(24, 24, 28, 0.94);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: none;
  border-radius: 22px 22px 0 0;
  box-shadow: 0 -18px 60px rgba(0, 0, 0, 0.5);
  color: var(--auth-text);
  transform-origin: bottom center;
}

@media (min-width: 600px) {
  .sheet-overlay {
    align-items: center;
    padding: 20px;
  }
  .sheet-card {
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 22px;
    transform-origin: center;
  }
}

.sheet-grabber {
  width: 36px;
  height: 5px;
  margin: 0 auto 12px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.24);
}

.sheet-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: var(--auth-text-2);
  font-size: 14px;
  transition: background-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.sheet-close:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}

.sheet-header {
  text-align: center;
  margin-bottom: 22px;
  padding: 0 20px;
}

.sheet-icon-wrap {
  width: 60px;
  height: 60px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.sheet-icon {
  font-size: 26px;
  color: #fff;
}

.sheet-title {
  margin: 0 0 6px 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--auth-text);
}

.sheet-desc {
  margin: 0;
  font-size: 13px;
  color: var(--auth-text-3);
}

.sheet-form {
  display: flex;
  flex-direction: column;
}

.sheet-input-wrap {
  width: 100%;
}

.sheet-input {
  width: 100%;
  height: 56px;
  padding: 0 16px;
  box-sizing: border-box;
  border: 1px solid var(--auth-hairline);
  border-radius: 14px;
  background: var(--auth-field);
  color: #fff;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 8px;
  text-align: center;
  text-transform: uppercase;
  -webkit-appearance: none;
  transition: border-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              background-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              box-shadow var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.sheet-input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.42);
  background: var(--auth-field-strong);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08);
}

.sheet-input::placeholder {
  color: rgba(255, 255, 255, 0.32);
  font-size: 15px;
  font-weight: 400;
  letter-spacing: 1px;
}

.sheet-input.input-error {
  border-color: rgba(var(--auth-danger-rgb), 0.7);
  background: rgba(var(--auth-danger-rgb), 0.12);
  box-shadow: 0 0 0 3.5px rgba(var(--auth-danger-rgb), 0.14);
}

.sheet-submit {
  width: 100%;
  height: 52px;
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 14px;
  background: #fff;
  color: #101014;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.5px;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
  transition: background-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              transform var(--duration-fast, 0.15s) var(--ease-standard, ease),
              box-shadow var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.sheet-submit:hover {
  background: #f2f2f5;
}

.sheet-submit:active {
  transform: scale(0.98);
  background: #e6e6ea;
}

.sheet-submit:disabled {
  opacity: 0.5;
  transform: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

/* ---------- Sheet 过渡：从底部滑入 ---------- */
.sheet-fade-enter-active {
  transition: opacity var(--duration-normal, 0.22s) var(--ease-decelerate, ease);
}

.sheet-fade-leave-active {
  transition: opacity var(--duration-fast, 0.15s) var(--ease-accelerate, ease);
}

.sheet-fade-enter-active .sheet-card {
  transition: transform var(--duration-normal, 0.22s) var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)),
              opacity var(--duration-normal, 0.22s) var(--ease-decelerate, ease);
}

.sheet-fade-leave-active .sheet-card {
  transition: transform var(--duration-fast, 0.15s) var(--ease-accelerate, ease),
              opacity var(--duration-fast, 0.15s) var(--ease-accelerate, ease);
}

.sheet-fade-enter,
.sheet-fade-leave-to {
  opacity: 0;
}

.sheet-fade-enter .sheet-card {
  opacity: 0;
  transform: translateY(100%);
}

.sheet-fade-leave-to .sheet-card {
  opacity: 0;
  transform: translateY(40%);
}

@media (min-width: 600px) {
  .sheet-fade-enter .sheet-card {
    transform: translateY(20px) scale(0.97);
  }
  .sheet-fade-leave-to .sheet-card {
    transform: translateY(-8px) scale(0.98);
  }
}

/* ============================================================
   横屏平板适配：1024x600 这类矮屏必须整体收紧
   ============================================================ */
@media (orientation: landscape) and (max-height: 700px) {
  .login-page {
    padding: 18px 20px;
  }
  .login-card {
    width: 400px;
    padding: 26px 32px 22px;
    border-radius: 18px;
  }
  .login-header {
    margin-bottom: 18px;
  }
  .login-mark {
    width: 60px;
    height: 48px;
    margin-bottom: 9px;
  }
  .login-title {
    font-size: 22px;
  }
  .input-wrap {
    height: 48px;
  }
  .btn-primary {
    height: 48px;
    margin-top: 14px;
  }
  .login-footer {
    margin-top: 16px;
    font-size: 12px;
  }
}

@media (orientation: landscape) and (max-height: 560px) {
  .login-card {
    padding: 20px 28px 16px;
  }
  .login-header {
    margin-bottom: 14px;
  }
  .login-mark {
    width: 50px;
    height: 40px;
    margin-bottom: 7px;
  }
  .login-subtitle {
    display: none;
  }
  .input-wrap {
    height: 44px;
  }
  .form-group + .form-group {
    margin-top: 10px;
  }
  .btn-primary {
    height: 44px;
    margin-top: 12px;
  }
  .login-footer {
    margin-top: 12px;
  }
}

/* ============================================================
   减弱动画：保留静态呈现，去掉运动
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .login-card {
    transition: opacity var(--duration-fast, 0.15s) ease;
    transform: none !important;
  }
  .auth-wallpaper,
  .auth-scrim {
    transition: opacity 0.2s linear;
  }
  .sheet-fade-enter-active .sheet-card,
  .sheet-fade-leave-active .sheet-card {
    transition-duration: var(--duration-fast, 0.15s);
    transform: none !important;
  }
  .btn-primary:active,
  .sheet-submit:active,
  .password-toggle:active,
  .sheet-close:active {
    transform: none !important;
  }
}
</style>