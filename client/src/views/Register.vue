<template>
  <div class="register-page" :class="{ 'page-enter': entered }">
    <!-- 装饰光晕：与 Login 一致，保证视觉连续性 -->
    <div class="login-aurora" aria-hidden="true">
      <div class="aurora-blob aurora-blob-1"></div>
      <div class="aurora-blob aurora-blob-2"></div>
      <div class="aurora-blob aurora-blob-3"></div>
    </div>

    <div class="register-card">
      <div class="register-header">
        <div class="logo-icon">
          <span class="logo-letter">C</span>
        </div>
        <h1 class="register-title">注册 ClassIntra</h1>
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
          <!-- 密码强度：iPadOS 风格的 4 段式 segment bar -->
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

export default {
  name: 'Register',
  data: function() {
    return {
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
      focused: {
        net_name: false,
        real_name: false,
        password: false,
        confirm_password: false
      }
    };
  },
  mounted: function() {
    var self = this;
    // 入场动画在下一帧触发，确保 CSS 过渡生效
    self.$nextTick(function() {
      requestAnimationFrame(function() {
        self.entered = true;
      });
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
/* ========== 页面容器：与 Login 完全一致的多层背景 ========== */
.register-page {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: linear-gradient(135deg, #1a3a6c 0%, #007AFF 45%, #5AC8FA 100%);
  isolation: isolate;
}

/* 装饰光晕（与 Login 共用，保持视觉一致） */
.login-aurora {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}
.aurora-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.6;
  will-change: transform;
}
.aurora-blob-1 {
  width: 520px;
  height: 520px;
  left: -120px;
  top: -140px;
  background: radial-gradient(circle, rgba(90, 200, 250, 0.85), transparent 70%);
  animation: aurora-drift-1 18s ease-in-out infinite alternate;
}
.aurora-blob-2 {
  width: 460px;
  height: 460px;
  right: -100px;
  bottom: -120px;
  background: radial-gradient(circle, rgba(255, 149, 0, 0.45), transparent 70%);
  animation: aurora-drift-2 22s ease-in-out infinite alternate;
}
.aurora-blob-3 {
  width: 380px;
  height: 380px;
  left: 40%;
  bottom: 10%;
  background: radial-gradient(circle, rgba(175, 82, 222, 0.45), transparent 70%);
  animation: aurora-drift-3 26s ease-in-out infinite alternate;
}

@keyframes aurora-drift-1 {
  from { transform: translate(0, 0) scale(1); }
  to   { transform: translate(60px, 80px) scale(1.1); }
}
@keyframes aurora-drift-2 {
  from { transform: translate(0, 0) scale(1); }
  to   { transform: translate(-80px, -60px) scale(1.05); }
}
@keyframes aurora-drift-3 {
  from { transform: translate(0, 0) scale(0.95); }
  to   { transform: translate(-40px, 50px) scale(1.1); }
}

/* ========== 注册卡片：与 Login 一致的真毛玻璃 ========== */
.register-card {
  position: relative;
  z-index: 1;
  width: 420px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  background: var(--surface-elevated);
  -webkit-backdrop-filter: var(--glass-blur-thick);
  backdrop-filter: var(--glass-blur-thick);
  border: 0.5px solid var(--glass-border);
  border-radius: var(--radius-3xl);
  padding: 40px;
  box-shadow: var(--shadow-xl), inset 0 0 0 0.5px rgba(255, 255, 255, 0.18);
  /* 入场：scale(0.95)+opacity（emil-design：never animate from scale(0)） */
  opacity: 0;
  transform: scale(0.95) translateY(12px);
  transition: opacity 0.5s var(--ease-decelerate, cubic-bezier(0, 0, 0.2, 1)),
              transform 0.6s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
  scrollbar-width: thin;
}

.register-page.page-enter .register-card {
  opacity: 1;
  transform: scale(1) translateY(0);
}

.register-header {
  text-align: center;
  margin-bottom: 24px;
}

.logo-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 12px;
  background: linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 24px rgba(0, 122, 255, 0.4),
              inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.logo-letter {
  font-size: 32px;
  font-weight: var(--font-weight-bold);
  color: #fff;
  letter-spacing: -0.5px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

.register-title {
  font-size: var(--font-size-title1);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin-bottom: 4px;
  letter-spacing: -0.5px;
}

.register-subtitle {
  font-size: var(--font-size-callout);
  color: var(--text-secondary);
  font-weight: var(--font-weight-medium);
}

.register-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.form-group {
  width: 100%;
}

/* ========== 输入框：与 Login 完全一致 ========== */
.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  height: 56px;
  background: rgba(255, 255, 255, 0.65);
  border: 1.5px solid rgba(0, 0, 0, 0.06);
  border-radius: var(--radius-lg);
  transition: border-color 0.18s var(--ease-standard, ease),
              box-shadow 0.18s var(--ease-standard, ease),
              background-color 0.18s var(--ease-standard, ease);
}

[data-theme="dark"] .input-wrap {
  background: rgba(28, 28, 30, 0.55);
  border-color: rgba(255, 255, 255, 0.08);
}

.input-wrap.input-focused {
  border-color: var(--primary-color);
  background: var(--card-bg);
  box-shadow: 0 0 0 4px rgba(var(--primary-rgb), 0.12);
}

.input-wrap.input-error {
  border-color: var(--danger-color);
  background: rgba(var(--danger-rgb), 0.06);
  box-shadow: 0 0 0 4px rgba(var(--danger-rgb), 0.12);
}

.input-icon {
  flex-shrink: 0;
  width: 24px;
  margin-left: 16px;
  font-size: 16px;
  color: var(--text-tertiary);
  transition: color 0.18s var(--ease-standard, ease);
  pointer-events: none;
}

.input-wrap.input-focused .input-icon {
  color: var(--primary-color);
}

.input-wrap.input-error .input-icon {
  color: var(--danger-color);
}

.form-input {
  flex: 1;
  height: 100%;
  padding: 0 12px;
  border: none;
  background: transparent;
  font-size: var(--font-size-body);
  color: var(--text-primary);
  box-shadow: none;
  border-radius: 0;
}

.form-input:focus {
  box-shadow: none;
  border-color: transparent;
}

.form-input::placeholder {
  color: var(--text-tertiary);
  opacity: 1;
}

/* 密码可见性切换（与 Login 一致） */
.password-toggle {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  margin-right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  background: transparent;
  border-radius: var(--radius-md);
  transition: background-color 0.15s var(--ease-standard, ease),
              transform 0.15s var(--ease-standard, ease),
              color 0.15s var(--ease-standard, ease);
}
.password-toggle:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-primary);
}
[data-theme="dark"] .password-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
}
.password-toggle:active {
  transform: scale(0.94);
  opacity: 0.7;
}

/* ========== 密码强度：iPadOS 风格 4 段式 segment bar ========== */
.password-strength {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: 8px;
  padding: 0 4px;
}

.strength-bar {
  flex: 1;
  display: flex;
  gap: 4px;
  height: 4px;
}

.strength-segment {
  flex: 1;
  background: var(--separator-color, rgba(60, 60, 67, 0.18));
  border-radius: var(--radius-pill, 9999px);
  transition: background-color 0.25s var(--ease-decelerate, ease-out);
}

/* 根据强度点亮对应数量的 segment */
.password-strength.weak .strength-segment:nth-child(1) {
  background: var(--danger-color, #FF3B30);
}
.password-strength.medium .strength-segment:nth-child(-n+2) {
  background: var(--warning-color, #FF9500);
}
.password-strength.strong .strength-segment:nth-child(-n+4) {
  background: var(--success-color, #34C759);
}

.strength-text {
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  min-width: 20px;
  text-align: right;
}
.password-strength.weak .strength-text {
  color: var(--danger-color);
}
.password-strength.medium .strength-text {
  color: var(--warning-color);
}
.password-strength.strong .strength-text {
  color: var(--success-color);
}

/* 强度条出现/消失过渡 */
.strength-fade-enter-active {
  transition: opacity 0.2s var(--ease-decelerate, ease-out);
}
.strength-fade-leave-active {
  transition: opacity 0.15s var(--ease-accelerate, ease-in);
}
.strength-fade-enter, .strength-fade-leave-to {
  opacity: 0;
}

/* ========== 错误消息：inline alert（与 Login 一致） ========== */
.error-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--spacing-sm) var(--spacing-md);
  background: rgba(var(--danger-rgb), 0.12);
  border: 0.5px solid rgba(var(--danger-rgb), 0.2);
  color: var(--danger-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.error-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.error-text {
  flex: 1;
}

/* 错误过渡：与 Login 一致 */
.error-fade-enter-active {
  transition: opacity 0.2s var(--ease-decelerate, ease-out),
              transform 0.2s var(--ease-decelerate, ease-out);
}
.error-fade-leave-active {
  transition: opacity 0.15s var(--ease-accelerate, ease-in),
              transform 0.15s var(--ease-accelerate, ease-in);
}
.error-fade-enter {
  opacity: 0;
  transform: translateX(-8px);
}
.error-fade-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

/* ========== 主按钮：与 Login 完全一致 ========== */
.btn-primary {
  width: 100%;
  height: 52px;
  margin-top: 4px;
  background: var(--primary-color);
  color: #fff;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-subheadline);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 16px rgba(var(--primary-rgb), 0.4),
              inset 0 1px 0 rgba(255, 255, 255, 0.25);
  transition: background-color 0.15s var(--ease-standard, ease),
              transform 0.15s var(--ease-standard, ease),
              box-shadow 0.15s var(--ease-standard, ease);
}

.btn-primary:hover {
  background: var(--primary-hover);
  box-shadow: 0 8px 20px rgba(var(--primary-rgb), 0.5),
              inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.btn-primary:active {
  transform: scale(0.97);
  background: var(--primary-pressed);
  box-shadow: 0 2px 6px rgba(var(--primary-rgb), 0.3),
              inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 2px 6px rgba(var(--primary-rgb), 0.2);
}

.btn-loading {
  width: 22px;
  height: 22px;
  border: 2.5px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ========== Footer ========== */
.register-footer {
  text-align: center;
  margin-top: 20px;
  font-size: var(--font-size-footnote);
}

.footer-text {
  color: var(--text-secondary);
}

.footer-link {
  color: var(--primary-color);
  font-weight: var(--font-weight-semibold);
  margin-left: var(--spacing-xs);
}

.footer-link:hover {
  color: var(--primary-hover);
  text-decoration: underline;
}

/* ========== 响应式：横屏适配 ========== */
@media (max-height: 760px) {
  .register-card {
    padding: var(--spacing-lg) var(--spacing-xl);
  }
  .register-header {
    margin-bottom: 16px;
  }
  .logo-icon {
    width: 56px;
    height: 56px;
  }
  .logo-letter {
    font-size: 28px;
  }
}

/* ========== Reduced motion：尊重用户偏好 ========== */
@media (prefers-reduced-motion: reduce) {
  .aurora-blob {
    animation: none;
  }
  .register-card {
    transition: opacity 0.2s ease;
    transform: none;
  }
  .register-page.page-enter .register-card {
    transform: none;
  }
  .btn-primary:active,
  .password-toggle:active {
    transform: none;
  }
}
</style>
