<template>
  <div class="register-page" :class="{ 'page-enter': entered, 'has-video-bg': !!videoSrc }">
    <!-- 壁纸层：与登录页同一套「系统锁屏」语言 -->
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

    <!-- 横屏：左品牌区 + 右表单区；窄屏自动回落为居中面板 -->
    <div class="auth-layout">
      <div class="brand-pane" aria-hidden="true">
        <div class="brand-block">
          <img class="brand-mark" :src="brandMarkWhite" alt="" />
          <div class="brand-rule"></div>
          <h1 class="brand-name">ClassIntra</h1>
          <p class="brand-tagline">智慧校园平台</p>
        </div>
        <p class="brand-foot">ClassIntra WebOS</p>
      </div>

      <div class="form-pane">
        <div class="auth-panel">
          <!-- 窄屏回落：面板内小型品牌头（分屏时隐藏） -->
          <div class="panel-brand" aria-hidden="true">
            <img class="panel-brand-mark" :src="brandMarkWhite" alt="" />
          </div>
          <div class="panel-head">
            <h2 class="panel-title">创建账号</h2>
            <p class="panel-subtitle">加入你的班级，开始使用 ClassIntra</p>
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
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';
import { resolveWallpaper, AUTH_BACKDROP } from '@/utils/wallpaper-bg';

// 品牌白色标识（锁屏深色玻璃上恒用白标，不随主题切换）。
// 运行时字符串，避免打包器把绝对路径解析成模块路径。
var BRAND_MARK_WHITE = '/resources/public/brand/logo-mark-white.png';

export default {
  name: 'Register',
  data: function() {
    return {
      brandMarkWhite: BRAND_MARK_WHITE,
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
    // 与登录页/桌面同一张壁纸：渐变预设直接用系统壁纸渐变，
    // 仅视频壁纸未出画时用系统底色兜底
    wallpaperStyle: function() {
      return this.wallpaperResolved.style || { background: AUTH_BACKDROP };
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
          self.$store.commit('toast/SHOW_TOAST', { message: '注册成功', type: 'success' });
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
   注册页：与登录页共用「系统锁屏」语言
   全屏系统壁纸 + 影院级压暗蒙版 + 锁屏深色玻璃面板 + 白色品牌区
   Chrome 80 基线：不使用 gap / inset / :is() / aspect-ratio
   ============================================================ */

.register-page {
  /* 锁屏深色玻璃的固定色板（与登录页完全一致，不随主题切换） */
  --auth-text: #FFFFFF;
  --auth-text-2: rgba(255, 255, 255, 0.72);
  --auth-text-3: rgba(255, 255, 255, 0.48);
  --auth-hairline: rgba(255, 255, 255, 0.16);
  --auth-panel: rgba(16, 22, 38, 0.44);
  --auth-panel-strong: rgba(18, 24, 40, 0.62);
  --auth-field: rgba(255, 255, 255, 0.1);
  --auth-field-strong: rgba(255, 255, 255, 0.16);
  --auth-danger-rgb: var(--danger-rgb);
  --auth-danger-text: #FF938C;

  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  /* 壁纸未就绪时的兜底：深色底，避免闪白 */
  background: #0B1220;
  isolation: isolate;
}

/* ---------- 壁纸层 + 蒙版（与登录页一致） ---------- */
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
  background: linear-gradient(100deg, rgba(6, 10, 22, 0.52) 0%, rgba(6, 10, 22, 0.3) 48%, rgba(6, 10, 22, 0.46) 100%);
  opacity: 0;
  transition: opacity 0.7s var(--ease-standard, ease);
}

.register-page.page-enter .auth-scrim {
  opacity: 1;
}

/* 视频壁纸：模糊开销按帧结算，降一档到系统 --glass-blur-regular 以保低端设备流畅 */
.register-page.has-video-bg .auth-panel {
  -webkit-backdrop-filter: var(--glass-blur-regular);
  backdrop-filter: var(--glass-blur-regular);
}

/* ---------- 布局骨架（与登录页一致） ---------- */
.auth-layout {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: stretch;
  justify-content: center;
  box-sizing: border-box;
}

.brand-pane {
  display: none;
}

.form-pane {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 20px;
  box-sizing: border-box;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* ---------- 表单面板：锁屏深色玻璃 ---------- */
.auth-panel {
  width: 400px;
  max-width: 100%;
  padding: 24px 32px 20px;
  box-sizing: border-box;
  background: var(--auth-panel);
  -webkit-backdrop-filter: var(--glass-blur-thick);
  backdrop-filter: var(--glass-blur-thick);
  border: 1px solid var(--auth-hairline);
  border-radius: var(--radius-2xl);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
  color: var(--auth-text);
  opacity: 0;
  transform: translateY(18px) scale(0.97);
  transition: opacity 0.5s var(--ease-decelerate, ease),
              transform 0.62s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) 0.12s;
}

.register-page.page-enter .auth-panel {
  opacity: 1;
  transform: translateY(0) scale(1);
}

/* ---------- 面板内小型品牌头（仅窄屏显示） ---------- */
.panel-brand {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}

.panel-brand-mark {
  width: 56px;
  height: 46px;
  object-fit: contain;
  filter: drop-shadow(0 4px 18px rgba(0, 0, 0, 0.3));
}

/* ---------- 面板标题区 ---------- */
.panel-head {
  text-align: center;
  margin-bottom: 16px;
}

.panel-title {
  margin: 0;
  font-size: 23px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: 0.2px;
  color: var(--auth-text);
}

.panel-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  font-weight: 400;
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
  height: 50px;
  box-sizing: border-box;
  background: var(--auth-field);
  border: 1px solid var(--auth-hairline);
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              background-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              box-shadow var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.input-wrap.input-focused {
  border-color: rgba(255, 255, 255, 0.32);
  background: var(--auth-field-strong);
  box-shadow: 0 0 0 3.5px rgba(var(--primary-rgb), 0.35);
}

.input-wrap.input-error {
  border-color: rgba(var(--auth-danger-rgb), 0.55);
  background: rgba(var(--auth-danger-rgb), 0.14);
  box-shadow: 0 0 0 3.5px rgba(var(--auth-danger-rgb), 0.2);
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
  color: var(--auth-text-2);
}

.input-wrap.input-error .input-icon {
  color: var(--auth-danger-text);
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

/* 浏览器自动填充时压掉系统白底（锁屏深玻璃上尤其刺眼） */
.form-input:-webkit-autofill,
.form-input:-webkit-autofill:focus {
  -webkit-text-fill-color: var(--auth-text);
  -webkit-box-shadow: 0 0 0 40px #1D2438 inset;
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
  border-radius: var(--radius-md);
  transition: background-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.password-toggle:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--auth-text);
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
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.18);
  transition: background-color var(--duration-normal, 0.22s) var(--ease-decelerate, ease);
}

.strength-segment:last-child {
  margin-right: 0;
}

/* 强度色：深底上用提亮过的语义色（系统语义色在深底偏暗） */
.password-strength.weak .strength-segment:nth-child(1) {
  background: #FF6961;
}
.password-strength.medium .strength-segment:nth-child(-n+2) {
  background: #FFB340;
}
.password-strength.strong .strength-segment:nth-child(-n+4) {
  background: #4CD964;
}

.strength-text {
  min-width: 18px;
  margin-left: 10px;
  font-size: 12px;
  font-weight: 500;
  text-align: right;
  color: var(--auth-text-2);
}

.password-strength.weak .strength-text {
  color: #FF938C;
}
.password-strength.medium .strength-text {
  color: #FFC46E;
}
.password-strength.strong .strength-text {
  color: #7DE89B;
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
  border: 1px solid rgba(var(--auth-danger-rgb), 0.4);
  color: var(--auth-danger-text);
  border-radius: var(--radius-md);
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

/* ---------- 主按钮：系统主色配方（与登录页一致） ---------- */
.btn-primary {
  width: 100%;
  height: 50px;
  margin-top: 16px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--primary-color);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px rgba(var(--primary-rgb), 0.35);
  transition: background-color var(--duration-fast, 0.15s) var(--ease-standard, ease),
              transform var(--duration-fast, 0.15s) var(--ease-standard, ease),
              box-shadow var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.btn-primary:hover {
  background: var(--primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 10px 28px rgba(var(--primary-rgb), 0.42);
}

.btn-primary:active {
  transform: scale(0.97);
  opacity: 0.92;
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.3);
}

.btn-primary:disabled {
  opacity: 0.45;
  transform: none;
  box-shadow: none;
}

/* 加载指示器：主色按钮上的白色 spinner，深浅主题一致 */
.btn-loading {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ---------- 页脚 ---------- */
.register-footer {
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
}

.footer-text {
  color: var(--auth-text-3);
}

/* 锁屏语言下链接用白（与登录页一致） */
.footer-link {
  margin-left: 6px;
  color: var(--auth-text-2);
  font-weight: 500;
  text-decoration: none;
  transition: color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.footer-link:hover {
  color: var(--auth-text);
}

.footer-link:active {
  opacity: 0.6;
}

/* 键盘可达性：独立规则，避免与逗号选择器列表同规则（Chrome 80 不识别 :focus-visible 会整条失效） */
.register-page button:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.7);
  outline-offset: 2px;
}

/* ============================================================
   分屏布局：横屏且宽度足够时启用（与登录页一致）
   ============================================================ */
@media (min-width: 880px) and (orientation: landscape) {
  .brand-pane {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    flex: 1.15;
    min-width: 0;
    padding: 40px 24px 40px 7vw;
    box-sizing: border-box;
  }

  .brand-block {
    max-width: 420px;
  }

  /* 品牌元素入场编舞：依次从左侧轻微滑入（与登录页同节奏） */
  .brand-mark,
  .brand-rule,
  .brand-name,
  .brand-tagline {
    opacity: 0;
    transform: translateX(-18px);
    transition: opacity 0.55s var(--ease-decelerate, ease),
                transform 0.62s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
  }

  .brand-mark { transition-delay: 0.08s; }
  .brand-rule { transition-delay: 0.18s; }
  .brand-name { transition-delay: 0.26s; }
  .brand-tagline { transition-delay: 0.34s; }

  .register-page.page-enter .brand-mark,
  .register-page.page-enter .brand-rule,
  .register-page.page-enter .brand-name,
  .register-page.page-enter .brand-tagline {
    opacity: 1;
    transform: translateX(0);
  }

  .brand-mark {
    /* 品牌标识为横向构图（约 1.25:1），此处按新宽高比给足宽度，避免 contain 缩水 */
    width: 130px;
    height: 104px;
    object-fit: contain;
    filter: drop-shadow(0 0 28px rgba(255, 255, 255, 0.16)) drop-shadow(0 10px 32px rgba(0, 0, 0, 0.35));
  }

  .brand-rule {
    width: 40px;
    height: 3px;
    margin: 22px 0 20px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.4);
  }

  .brand-name {
    margin: 0;
    font-size: 40px;
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: 0.2px;
    color: var(--auth-text);
    text-shadow: 0 2px 24px rgba(0, 0, 0, 0.35);
  }

  .brand-tagline {
    margin: 10px 0 0;
    font-size: 14px;
    font-weight: 400;
    letter-spacing: 7px;
    color: var(--auth-text-2);
  }

  .brand-foot {
    position: absolute;
    bottom: 22px;
    left: 7vw;
    margin: 0;
    font-size: 11px;
    letter-spacing: 1.5px;
    color: rgba(255, 255, 255, 0.34);
  }

  .form-pane {
    flex: 1;
    padding: 24px 5vw 24px 20px;
  }

  .panel-brand {
    display: none;
  }

  .auth-panel {
    width: 408px;
  }

  .panel-head {
    text-align: left;
    margin-bottom: 14px;
  }
}

/* ============================================================
   矮屏横屏（1024×600 级别）：4 个输入框 + 强度条，必须整体收紧
   ============================================================ */
@media (orientation: landscape) and (max-height: 700px) {
  .form-pane {
    padding: 12px 20px;
  }
  .auth-panel {
    width: 396px;
    padding: 16px 28px 14px;
    border-radius: var(--radius-xl);
  }
  .panel-brand {
    margin-bottom: 8px;
  }
  .panel-brand-mark {
    width: 45px;
    height: 37px;
  }
  .panel-head {
    margin-bottom: 10px;
  }
  .panel-title {
    font-size: 20px;
  }
  .panel-subtitle {
    margin-top: 3px;
    font-size: 12px;
  }
  .form-group + .form-group {
    margin-top: 8px;
  }
  .input-wrap {
    height: 44px;
  }
  .btn-primary {
    height: 44px;
    margin-top: 11px;
  }
  .register-footer {
    margin-top: 10px;
    font-size: 12px;
  }
}

@media (orientation: landscape) and (max-height: 560px) {
  .auth-panel {
    padding: 12px 24px 11px;
  }
  .panel-brand {
    display: none;
  }
  .panel-head {
    margin-bottom: 8px;
  }
  .panel-subtitle {
    display: none;
  }
  .input-wrap {
    height: 40px;
  }
  .form-group + .form-group {
    margin-top: 7px;
  }
  .btn-primary {
    height: 41px;
    margin-top: 9px;
  }
  .register-footer {
    margin-top: 7px;
  }
}

/* ============================================================
   低性能设备：实时模糊关闭，面板提到更实的深色表面
   ============================================================ */
[data-perf="low"] .auth-panel {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  background: var(--auth-panel-strong);
}

/* ============================================================
   触屏设备（无 hover）：按下态反馈代替会「粘住」的 hover 态
   ============================================================ */
@media (hover: none) {
  .btn-primary:hover {
    background: var(--primary-color);
    transform: none;
    box-shadow: 0 8px 24px rgba(var(--primary-rgb), 0.35);
  }
  .footer-link:hover {
    color: var(--auth-text-2);
  }
  .password-toggle:hover {
    background: transparent;
    color: var(--auth-text-2);
  }
  .password-toggle:active {
    background: rgba(255, 255, 255, 0.12);
  }
}

/* ============================================================
   减弱动画
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  .auth-panel {
    transition: opacity var(--duration-fast, 0.15s) ease;
    transform: none !important;
  }
  .brand-mark,
  .brand-rule,
  .brand-name,
  .brand-tagline {
    transition: opacity 0.2s linear;
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
