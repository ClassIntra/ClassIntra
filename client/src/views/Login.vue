<template>
  <div class="login-page" :class="{ 'page-enter': entered }">
    <!-- 装饰光晕：模拟 iPadOS 壁纸的层次感 -->
    <div class="login-aurora" aria-hidden="true">
      <div class="aurora-blob aurora-blob-1"></div>
      <div class="aurora-blob aurora-blob-2"></div>
      <div class="aurora-blob aurora-blob-3"></div>
    </div>

    <div class="login-card">
      <div class="login-header">
        <div class="logo-icon">
          <span class="logo-letter">C</span>
        </div>
        <h1 class="login-title">ClassIntra</h1>
        <p class="login-subtitle">智慧校园平台</p>
      </div>
      <form class="login-form" @submit.prevent="handleLogin">
        <div class="form-group">
          <div class="input-wrap" :class="{ 'input-error': accountError, 'input-focused': accountFocused }">
            <i class="fa-solid fa-user input-icon" aria-hidden="true"></i>
            <input
              v-model="account"
              type="text"
              class="form-input"
              placeholder="用户名 / ID / 网名"
              autocomplete="username"
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

export default {
  name: 'Login',
  data: function() {
    return {
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
      // 快捷上传相关
      showQuickUpload: false,
      quickCode: '',
      quickError: '',
      quickLoading: false
    };
  },
  computed: {
    isLoggedIn: function() {
      return !!this.$store.state.auth.token;
    }
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
/* ========== 页面容器：iPadOS 锁屏风格多层背景 ========== */
.login-page {
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

/* 装饰光晕：模拟 iPadOS 壁纸的层次感（不影响交互） */
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

/* ========== 登录卡片：真毛玻璃材质 ========== */
.login-card {
  position: relative;
  z-index: 1;
  width: 420px;
  max-width: calc(100vw - 32px);
  background: var(--surface-elevated);
  -webkit-backdrop-filter: var(--glass-blur-thick);
  backdrop-filter: var(--glass-blur-thick);
  border: 0.5px solid var(--glass-border);
  border-radius: var(--radius-3xl);
  padding: 48px 40px;
  box-shadow: var(--shadow-xl), inset 0 0 0 0.5px rgba(255, 255, 255, 0.18);
  /* 入场：scale(0.95)+opacity（emil-design：never animate from scale(0)） */
  opacity: 0;
  transform: scale(0.95) translateY(12px);
  transition: opacity 0.5s var(--ease-decelerate, cubic-bezier(0, 0, 0.2, 1)),
              transform 0.6s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}

.login-page.page-enter .login-card {
  opacity: 1;
  transform: scale(1) translateY(0);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 16px;
  background: linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%);
  border-radius: var(--radius-xl);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12px 28px rgba(0, 122, 255, 0.45),
              inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.logo-letter {
  font-size: 36px;
  font-weight: var(--font-weight-bold);
  color: #fff;
  letter-spacing: -0.5px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

.login-title {
  font-size: var(--font-size-largeTitle);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin-bottom: 4px;
  letter-spacing: -0.5px;
}

.login-subtitle {
  font-size: var(--font-size-callout);
  color: var(--text-secondary);
  font-weight: var(--font-weight-medium);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.form-group {
  width: 100%;
}

/* ========== 输入框：iPadOS 大型风格（含内嵌图标） ========== */
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

/* 密码可见性切换：iPadOS 风格的图标按钮（44x44 触摸目标） */
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

/* ========== 错误消息：iPadOS 风格 inline alert ========== */
.error-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
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

/* 错误消息过渡：从左滑入 + 淡入（spatial consistency） */
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

/* ========== 主按钮：胶囊形 + scale(0.97) 按下反馈 ========== */
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

/* 按下反馈：scale(0.97)（emil-design：buttons must feel responsive to press） */
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

/* ========== Footer：链接区 ========== */
.login-footer {
  text-align: center;
  margin-top: 24px;
  font-size: var(--font-size-footnote);
}

.footer-text {
  color: var(--text-secondary);
}

.footer-divider {
  color: var(--text-tertiary);
  margin: 0 6px;
}

.footer-link {
  color: var(--primary-color);
  font-weight: var(--font-weight-semibold);
}

.footer-link:hover {
  color: var(--primary-hover);
  text-decoration: underline;
}

/* ========== 快捷上传 Sheet：iPadOS 风格底部弹窗 ========== */
.sheet-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
  z-index: 10000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
}

@media (min-width: 600px) {
  .sheet-overlay {
    align-items: center;
    padding: 20px;
  }
}

.sheet-card {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: var(--card-bg, #fff);
  border-radius: var(--radius-3xl, 28px) var(--radius-3xl, 28px) 0 0;
  padding: 12px var(--spacing-xl) var(--spacing-xl);
  box-shadow: var(--shadow-xl, 0 24px 80px rgba(0,0,0,0.4));
  /* 入场：scale(0.95)+translateY（origin-aware：从底部弹出） */
  transform-origin: bottom center;
}

@media (min-width: 600px) {
  .sheet-card {
    border-radius: var(--radius-3xl, 28px);
    transform-origin: center;
  }
}

/* Sheet 顶部小抓手（iPadOS Sheet 标识） */
.sheet-grabber {
  width: 36px;
  height: 5px;
  background: var(--text-tertiary, rgba(60, 60, 67, 0.3));
  border-radius: var(--radius-pill, 9999px);
  margin: 0 auto 12px;
  opacity: 0.6;
}

.sheet-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-secondary, #999);
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s var(--ease-standard, ease),
              transform 0.15s var(--ease-standard, ease);
}
[data-theme="dark"] .sheet-close {
  background: rgba(255, 255, 255, 0.1);
}
.sheet-close:hover {
  background: rgba(0, 0, 0, 0.1);
}
[data-theme="dark"] .sheet-close:hover {
  background: rgba(255, 255, 255, 0.15);
}
.sheet-close:active {
  transform: scale(0.94);
  opacity: 0.7;
}

.sheet-header {
  text-align: center;
  margin-bottom: 24px;
  padding: 0 20px;
}

.sheet-icon-wrap {
  width: 64px;
  height: 64px;
  margin: 0 auto 12px;
  background: linear-gradient(135deg, var(--primary-color, #007AFF) 0%, rgba(var(--primary-rgb, 0, 122, 255), 0.7) 100%);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 20px rgba(var(--primary-rgb, 0, 122, 255), 0.35);
}

.sheet-icon {
  font-size: 28px;
  color: #fff;
}

.sheet-title {
  font-size: var(--font-size-title2, 22px);
  font-weight: var(--font-weight-bold, 700);
  color: var(--text-primary, #000);
  margin: 0 0 6px 0;
}

.sheet-desc {
  font-size: var(--font-size-sm, 13px);
  color: var(--text-secondary, #999);
  margin: 0;
}

.sheet-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sheet-input-wrap {
  width: 100%;
}

.sheet-input {
  width: 100%;
  height: 56px;
  padding: 0 16px;
  border: 1.5px solid var(--border-color, #e5e5ea);
  border-radius: var(--radius-lg, 16px);
  font-size: 24px;
  font-weight: var(--font-weight-semibold, 600);
  letter-spacing: 8px;
  text-align: center;
  text-transform: uppercase;
  color: var(--text-primary, #000);
  background: rgba(0, 0, 0, 0.03);
  transition: border-color 0.18s var(--ease-standard, ease),
              box-shadow 0.18s var(--ease-standard, ease),
              background-color 0.18s var(--ease-standard, ease);
}
[data-theme="dark"] .sheet-input {
  background: rgba(255, 255, 255, 0.05);
}
.sheet-input:focus {
  border-color: var(--primary-color, #007aff);
  background: var(--card-bg, #fff);
  box-shadow: 0 0 0 4px rgba(var(--primary-rgb, 0, 122, 255), 0.12);
  outline: none;
}
.sheet-input.input-error {
  border-color: var(--danger-color, #ff3b30);
  background: rgba(var(--danger-rgb, 255, 59, 48), 0.06);
  box-shadow: 0 0 0 4px rgba(var(--danger-rgb, 255, 59, 48), 0.12);
}

.sheet-submit {
  width: 100%;
  height: 52px;
  background: var(--primary-color, #007aff);
  color: #fff;
  border: none;
  border-radius: var(--radius-pill, 9999px);
  font-size: var(--font-size-subheadline, 17px);
  font-weight: var(--font-weight-semibold, 600);
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 16px rgba(var(--primary-rgb, 0, 122, 255), 0.4),
              inset 0 1px 0 rgba(255, 255, 255, 0.25);
  transition: background-color 0.15s var(--ease-standard, ease),
              transform 0.15s var(--ease-standard, ease),
              box-shadow 0.15s var(--ease-standard, ease);
}
.sheet-submit:hover {
  background: var(--primary-hover, #0066cc);
}
.sheet-submit:active {
  transform: scale(0.97);
  background: var(--primary-pressed, #004e99);
}
.sheet-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 2px 6px rgba(var(--primary-rgb, 0, 122, 255), 0.2);
}

/* ========== Sheet 过渡：从底部滑入 + scale(0.95) ========== */
.sheet-fade-enter-active {
  transition: opacity 0.25s var(--ease-decelerate, ease-out);
}
.sheet-fade-leave-active {
  transition: opacity 0.2s var(--ease-accelerate, ease-in);
}
.sheet-fade-enter-active .sheet-card {
  transition: transform 0.4s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)),
              opacity 0.3s var(--ease-decelerate, ease-out);
}
.sheet-fade-leave-active .sheet-card {
  transition: transform 0.2s var(--ease-accelerate, ease-in),
              opacity 0.2s var(--ease-accelerate, ease-in);
}
.sheet-fade-enter,
.sheet-fade-leave-to {
  opacity: 0;
}
.sheet-fade-enter .sheet-card {
  opacity: 0;
  transform: scale(0.95) translateY(100%);
}
.sheet-fade-leave-to .sheet-card {
  opacity: 0;
  transform: scale(0.97) translateY(40%);
}

@media (min-width: 600px) {
  .sheet-fade-enter .sheet-card {
    transform: scale(0.95) translateY(20px);
  }
  .sheet-fade-leave-to .sheet-card {
    transform: scale(0.97) translateY(-8px);
  }
}

/* ========== 响应式：横屏 1024px+ 适配 ========== */
@media (min-width: 1024px) and (orientation: landscape) {
  .login-card {
    padding: 40px 36px;
  }
  .logo-icon {
    width: 64px;
    height: 64px;
    border-radius: var(--radius-lg);
  }
  .logo-letter {
    font-size: 32px;
  }
  .login-title {
    font-size: var(--font-size-title1, 28px);
  }
  .input-wrap,
  .sheet-input {
    height: 52px;
  }
  .btn-primary,
  .sheet-submit {
    height: 48px;
  }
}

/* ========== Reduced motion：减弱动画但仍提供反馈 ========== */
@media (prefers-reduced-motion: reduce) {
  .aurora-blob {
    animation: none !important;
  }
  .login-card {
    transition: opacity 0.2s ease !important;
    transform: none !important;
  }
  .sheet-fade-enter-active .sheet-card,
  .sheet-fade-leave-active .sheet-card {
    transition-duration: 0.15s !important;
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
