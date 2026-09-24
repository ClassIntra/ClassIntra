<template>
  <div class="register-page" :class="{ 'page-enter': entered, 'has-video-bg': !!videoSrc }">
    <!-- 壁纸层：与登录页同一套「系统闸门」语言 -->
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

    <div class="register-card">
      <div class="register-header">
        <!-- 标识为临时占位：替换 Resources/public/brand/logo-mark-white.png
             （纯白图形 + 透明底 + 紧密裁切）即可，尺寸自适应无需改样式 -->
        <img class="register-mark" :src="brandMark" alt="" aria-hidden="true" />
        <h1 class="register-title">ClassIntra</h1>
        <p class="register-subtitle">创建你的校园账号</p>
      </div>
      <form class="register-form" @submit.prevent="handleRegister">
        <div class="form-group">
          <div class="input-wrap" :class="{ 'input-error': fieldErrors.net_name, 'input-focused': focused.net_name }">
            <i class="fa-solid fa-user input-icon" aria-hidden="true"></i>
            <input
              v-model="net_name"
              type="text"
              class="form-input"
              placeholder="网名"
              autocomplete="nickname"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              aria-label="网名"
              @input="clearFieldError('net_name')"
              @focus="focused.net_name = true"
              @blur="focused.net_name = false"
            />
          </div>
        </div>
        <div class="form-group">
          <div class="input-wrap" :class="{ 'input-error': fieldErrors.real_name, 'input-focused': focused.real_name }">
            <i class="fa-solid fa-id-card input-icon" aria-hidden="true"></i>
            <input
              v-model="real_name"
              type="text"
              class="form-input"
              placeholder="真实姓名"
              autocomplete="name"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              aria-label="真实姓名"
              @input="clearFieldError('real_name')"
              @focus="focused.real_name = true"
              @blur="focused.real_name = false"
            />
          </div>
        </div>
        <div class="form-group">
          <div class="input-wrap" :class="{ 'input-error': fieldErrors.password, 'input-focused': focused.password }">
            <i class="fa-solid fa-lock input-icon" aria-hidden="true"></i>
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              class="form-input"
              placeholder="密码"
              autocomplete="new-password"
              aria-label="密码"
              @input="clearFieldError('password'); updatePasswordStrength()"
              @focus="focused.password = true"
              @blur="focused.password = false"
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
          <!-- 密码强度：4 段式 segment bar -->
          <transition name="strength-fade">
            <div v-if="password" class="password-strength" :class="passwordStrength.level">
              <div class="strength-bar" aria-hidden="true">
                <span class="strength-segment"></span>
                <span class="strength-segment"></span>
                <span class="strength-segment"></span>
                <span class="strength-segment"></span>
              </div>
              <span class="strength-text">{{ passwordStrength.label }}</span>
            </div>
          </transition>
        </div>
        <div class="form-group">
          <div class="input-wrap" :class="{ 'input-error': fieldErrors.confirm_password, 'input-focused': focused.confirm_password }">
            <i class="fa-solid fa-lock-keyhole input-icon" aria-hidden="true"></i>
            <input
              v-model="confirm_password"
              :type="showConfirm ? 'text' : 'password'"
              class="form-input"
              placeholder="确认密码"
              autocomplete="new-password"
              enterkeyhint="go"
              aria-label="确认密码"
              @input="clearFieldError('confirm_password')"
              @focus="focused.confirm_password = true"
              @blur="focused.confirm_password = false"
            />
            <button
              type="button"
              class="password-toggle"
              @click="showConfirm = !showConfirm"
              :aria-label="showConfirm ? '隐藏密码' : '显示密码'"
            >
              <i :class="showConfirm ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'" aria-hidden="true"></i>
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
          <span v-else>注 册</span>
        </button>
      </form>
      <div class="register-footer">
        <span class="footer-text">已有账号？</span>
        <router-link to="/login" class="footer-link">返回登录</router-link>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';
import { resolveWallpaper, AUTH_BACKDROP } from '@/utils/wallpaper-bg';

// 品牌标识（临时占位：替换 Resources/public/brand/logo-mark-white.png 即可）。
// 运行时字符串，避免打包器把绝对路径解析成模块路径。
var BRAND_MARK = '/resources/public/brand/logo-mark-white.png';

export default {
  name: 'Register',
  data: function() {
    return {
      brandMark: BRAND_MARK,
      net_name: '',
      real_name: '',
      password: '',
      confirm_password: '',
      errorMsg: '',
      loading: false,
      fieldErrors: {
        net_name: false,
        real_name: false,
        password: false,
        confirm_password: false
      },
      passwordStrength: {
        percent: 0,
        level: '',
        label: ''
      },
      entered: false,
      showPassword: false,
      showConfirm: false,
      // 壁纸
      videoFailed: false,
      focused: {
        net_name: false,
        real_name: false,
        password: false,
        confirm_password: false
      }
    };
  },
  computed: {
    wallpaperResolved: function() {
      return resolveWallpaper(this.$store.state.settings.wallpaper);
    },
    // 与登录页一致：仅图片壁纸铺底，渐变预设走中性深色底色
    wallpaperStyle: function() {
      if (this.wallpaperResolved.type === 'image') return this.wallpaperResolved.style;
      return { background: AUTH_BACKDROP };
    },
    videoSrc: function() {
      if (this.videoFailed) return '';
      return this.wallpaperResolved.type === 'video' ? this.wallpaperResolved.src : '';
    }
  },
  mounted: function() {
    var self = this;
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
    clearFieldError: function(field) {
      this.fieldErrors[field] = false;
    },
    updatePasswordStrength: function() {
      var pwd = this.password;
      var score = 0;
      if (pwd.length >= 6) score += 20;
      if (pwd.length >= 8) score += 10;
      if (pwd.length >= 12) score += 10;
      if (/[a-z]/.test(pwd)) score += 15;
      if (/[A-Z]/.test(pwd)) score += 15;
      if (/[0-9]/.test(pwd)) score += 15;
      if (/[^a-zA-Z0-9]/.test(pwd)) score += 15;
      if (score > 100) score = 100;
      var level = 'weak';
      var label = '弱';
      if (score >= 70) {
        level = 'strong';
        label = '强';
      } else if (score >= 40) {
        level = 'medium';
        label = '中';
      }
      this.passwordStrength = { percent: score, level: level, label: label };
    },
    handleRegister: function() {
      var self = this;
      self.errorMsg = '';
      self.fieldErrors = { net_name: false, real_name: false, password: false, confirm_password: false };
      if (!self.net_name.trim()) {
        self.fieldErrors.net_name = true;
        self.errorMsg = '请输入网名';
        return;
      }
      if (!self.real_name.trim()) {
        self.fieldErrors.real_name = true;
        self.errorMsg = '请输入真实姓名';
        return;
      }
      if (!self.password) {
        self.fieldErrors.password = true;
        self.errorMsg = '请输入密码';
        return;
      }
      if (self.password.length < 6) {
        self.fieldErrors.password = true;
        self.errorMsg = '密码至少6位';
        return;
      }
      if (self.password !== self.confirm_password) {
        self.fieldErrors.confirm_password = true;
        self.errorMsg = '两次密码不一致';
        return;
      }
      self.loading = true;
      api
        .post('/auth/register', {
          net_name: self.net_name.trim(),
          real_name: self.real_name.trim(),
          password: self.password,
          confirm_password: self.confirm_password
        })
        .then(function(response) {
          if (response.data.code !== 200) {
            self.errorMsg = response.data.message || '注册失败，请稍后重试';
            return;
          }
          var data = response.data.data;
          self.$store.commit('auth/SET_TOKEN', data.token);
          self.$store.commit('auth/SET_USER', data.user_info);
          self.$store.commit('toast/SHOW_TOAST', { message: '注册成功！', type: 'success' });
          // router.push 单独捕获，避免 NavigationDuplicated 进入错误处理
          return self.$router.push({ name: 'Desktop' }).catch(function(navErr) {
            if (navErr && navErr.name !== 'NavigationDuplicated' && navErr.name !== 'NavigationAborted') {
              console.warn('[Register] Navigation after register failed:', navErr);
            }
          });
        })
        .catch(function(err) {
          var resp = err.response && err.response.data;
          self.errorMsg = (resp && resp.message) || '注册失败，请稍后重试';
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
   注册页：与登录页共用一套「系统闸门」视觉
   深色实体面板 + 白色标识 + 单一强调（白色主按钮）
   Chrome 80 基线：不使用 gap / inset / :is() / aspect-ratio
   ============================================================ */

.register-page {
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
  padding: 24px 20px;
  box-sizing: border-box;
  background: #0b0b0d;
  isolation: isolate;
}

/* ---------- 壁纸层 + 蒙版 ---------- */
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

.register-page.page-enter .auth-wallpaper {
  opacity: 1;
}

.auth-wallpaper-video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

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

.register-page.page-enter .auth-scrim {
  opacity: 1;
}

.register-page.has-video-bg .register-card {
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  backdrop-filter: blur(16px) saturate(140%);
}

/* ---------- 面板 ---------- */
.register-card {
  position: relative;
  z-index: 2;
  margin: auto;
  width: 424px;
  max-width: 100%;
  padding: 34px 40px 26px;
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
  opacity: 0;
  transform: translateY(18px) scale(0.97);
  transition: opacity 0.5s var(--ease-decelerate, ease),
              transform 0.62s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}

.register-page.page-enter .register-card {
  opacity: 1;
  transform: translateY(0) scale(1);
}

/* ---------- 品牌区 ---------- */
.register-header {
  text-align: center;
  margin-bottom: 22px;
}

.register-mark {
  display: block;
  width: 66px;
  height: 53px;
  margin: 0 auto 10px;
  object-fit: contain;
}

.register-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.4px;
  color: var(--auth-text);
}

.register-subtitle {
  margin: 6px 0 0;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.6px;
  color: var(--auth-text-3);
}

/* ---------- 表单 ---------- */
.register-form {
  display: flex;
  flex-direction: column;
}

.form-group {
  width: 100%;
}

.form-group + .form-group {
  margin-top: 11px;
}

.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  height: 52px;
  box-sizing: border-box;
  background: var(--auth-field);
  border: 1px solid var(--auth-hairline);
  border-radius: 13px;
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
  box-shadow: 0 0 0 3px rgba(var(--auth-danger-rgb), 0.14);
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
  width: 42px;
  height: 42px;
  margin-right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--auth-text-2);
  background: transparent;
  border: none;
  border-radius: 11px;
  transition: background-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.password-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

/* ---------- 密码强度 ---------- */
.password-strength {
  display: flex;
  align-items: center;
  margin-top: 7px;
  padding: 0 2px;
}

.strength-bar {
  flex: 1;
  display: flex;
  height: 3px;
}

.strength-segment {
  flex: 1;
  margin-right: 4px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.12);
  transition: background-color var(--duration-normal, 0.22s) var(--ease-decelerate, ease);
}

.strength-segment:last-child {
  margin-right: 0;
}

.password-strength.weak .strength-segment:nth-child(1) {
  background: #ff6b61;
}
.password-strength.medium .strength-segment:nth-child(-n+2) {
  background: #ffb340;
}
.password-strength.strong .strength-segment:nth-child(-n+4) {
  background: #4cd964;
}

.strength-text {
  min-width: 18px;
  margin-left: 10px;
  font-size: 12px;
  font-weight: 500;
  text-align: right;
}

.password-strength.weak .strength-text {
  color: #ff8a80;
}
.password-strength.medium .strength-text {
  color: #ffc266;
}
.password-strength.strong .strength-text {
  color: #6fe08a;
}

.strength-fade-enter-active {
  transition: opacity var(--duration-fast, 0.15s) var(--ease-decelerate, ease);
}
.strength-fade-leave-active {
  transition: opacity var(--duration-fast, 0.15s) var(--ease-accelerate, ease);
}
.strength-fade-enter,
.strength-fade-leave-to {
  opacity: 0;
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

/* ---------- 主按钮 ---------- */
.btn-primary {
  width: 100%;
  height: 50px;
  margin-top: 18px;
  border: none;
  border-radius: 13px;
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
.register-footer {
  margin-top: 18px;
  text-align: center;
  font-size: 13px;
}

.footer-text {
  color: var(--auth-text-3);
}

/* 页脚链接刻意压低一档亮度：让白色主按钮始终是画面中最亮的一点 */
.footer-link {
  margin-left: 6px;
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

/* 键盘可达性：独立规则，避免与逗号选择器列表同规则（Chrome 80 不识别 :focus-visible 会整条失效） */
.register-page button:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.85);
  outline-offset: 2px;
}

/* ============================================================
   横屏平板适配：4 个输入框 + 强度条，必须整体收紧
   ============================================================ */
@media (orientation: landscape) and (max-height: 700px) {
  .register-page {
    padding: 16px 20px;
  }
  .register-card {
    width: 400px;
    padding: 22px 32px 18px;
    border-radius: 18px;
  }
  .register-header {
    margin-bottom: 14px;
  }
  .register-mark {
    width: 54px;
    height: 44px;
    margin-bottom: 8px;
  }
  .register-title {
    font-size: 21px;
  }
  .form-group + .form-group {
    margin-top: 9px;
  }
  .input-wrap {
    height: 46px;
  }
  .btn-primary {
    height: 46px;
    margin-top: 14px;
  }
  .register-footer {
    margin-top: 12px;
    font-size: 12px;
  }
}

@media (orientation: landscape) and (max-height: 560px) {
  .register-card {
    padding: 18px 28px 14px;
  }
  .register-header {
    margin-bottom: 10px;
  }
  .register-mark {
    display: none;
  }
  .register-subtitle {
    display: none;
  }
  .input-wrap {
    height: 42px;
  }
  .form-group + .form-group {
    margin-top: 8px;
  }
  .btn-primary {
    height: 42px;
    margin-top: 12px;
  }
}

/* ============================================================
   减弱动画
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .register-card {
    transition: opacity var(--duration-fast, 0.15s) ease;
    transform: none !important;
  }
  .auth-wallpaper,
  .auth-scrim {
    transition: opacity 0.2s linear;
  }
  .btn-primary:active,
  .password-toggle:active {
    transform: none !important;
  }
}
</style>