<template>
  <div class="login-page" :class="{ 'page-enter': entered }">
    <div class="login-card">
      <div class="login-header">
        <div class="logo-icon">C</div>
        <h1 class="login-title">ClassNet</h1>
        <p class="login-subtitle">智慧校园平台</p>
      </div>
      <form class="login-form" @submit.prevent="handleLogin">
        <div class="form-group">
          <input
            v-model="account"
            type="text"
            class="form-input"
            :class="{ 'input-error': accountError }"
            placeholder="用户名/ID/网名"
            autocomplete="username"
            aria-label="账号"
            @input="accountError = false"
          />
        </div>
        <div class="form-group" style="position: relative;">
          <input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            class="form-input"
            :class="{ 'input-error': passwordError }"
            placeholder="密码"
            autocomplete="current-password"
            aria-label="密码"
            @input="passwordError = false"
          />
          <button type="button" class="password-toggle" @click="showPassword = !showPassword" :aria-label="showPassword ? '隐藏密码' : '显示密码'">
            <i :class="showPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'"></i>
          </button>
        </div>
        <transition name="error-fade">
          <div v-if="errorMsg" class="error-message" role="alert">{{ errorMsg }}</div>
        </transition>
        <button type="submit" class="btn-primary" :disabled="loading">
          <span v-if="loading" class="btn-loading"></span>
          <span v-else>登 录</span>
        </button>
      </form>
      <div class="login-footer">
        <span class="footer-text">还没有账号？</span>
        <router-link to="/register" class="footer-link">立即注册</router-link>
        <span v-if="isLoggedIn" class="footer-divider">|</span>
        <router-link v-if="isLoggedIn" to="/" class="footer-link">返回桌面</router-link>
        <span class="footer-divider">|</span>
        <a href="javascript:void(0)" class="footer-link" @click="showQuickUpload = true">快捷上传</a>
      </div>
    </div>

    <!-- 快捷上传（登录码）弹窗 -->
    <transition name="modal-fade">
      <div v-if="showQuickUpload" class="quick-upload-overlay" @click.self="closeQuickUpload">
        <div class="quick-upload-card">
          <button class="quick-close" @click="closeQuickUpload" aria-label="关闭">
            <i class="fa-solid fa-xmark"></i>
          </button>
          <div class="quick-header">
            <i class="fa-solid fa-cloud-arrow-up quick-header-icon"></i>
            <h3 class="quick-title">快捷上传</h3>
            <p class="quick-desc">请输入已登录用户云盘页显示的上传码</p>
          </div>
          <form class="quick-form" @submit.prevent="verifyCode">
            <div class="quick-input-wrap">
              <input
                v-model="quickCode"
                type="text"
                class="quick-input"
                :class="{ 'input-error': quickError }"
                placeholder="请输入6位上传码"
                maxlength="6"
                autocomplete="off"
                @input="onCodeInput"
              />
            </div>
            <transition name="error-fade">
              <div v-if="quickError" class="quick-error" role="alert">{{ quickError }}</div>
            </transition>
            <button type="submit" class="quick-submit" :disabled="quickLoading || quickCode.length !== 6">
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
    self.$nextTick(function() {
      self.entered = true;
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
          self.$router.push({ name: 'Desktop' });
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
.login-page {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--primary-dark) 0%, var(--primary-color) 100%);
  opacity: 0;
  transform: translateY(20px);
  transition: opacity var(--duration-slow) var(--ease-standard), transform var(--duration-slow) var(--ease-standard);
}

.login-page.page-enter {
  opacity: 1;
  transform: translateY(0);
}

.login-card {
  width: 420px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  padding: 48px 40px;
  box-shadow: var(--shadow-lg);
}

.login-header {
  text-align: center;
  margin-bottom: 36px;
}

.logo-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  background: var(--primary-color);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-title1);
  font-weight: var(--font-weight-bold);
  color: var(--card-bg);
}

.login-title {
  font-size: var(--font-size-title1);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin-bottom: 4px;
}

.login-subtitle {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.form-group {
  width: 100%;
}

.form-input {
  width: 100%;
  height: 48px;
  padding: 0 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-callout);
  color: var(--text-primary);
  background: var(--bg-color);
  transition: border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
}

.form-input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.15);
}

.form-input.input-error {
  border-color: var(--danger-color);
  box-shadow: 0 0 0 3px rgba(var(--danger-rgb), 0.15);
}

.password-toggle {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: var(--font-size-sm);
  transition: color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}
.password-toggle:hover {
  color: var(--text-secondary);
}
.password-toggle:active {
  transform: translateY(-50%) scale(0.92);
  opacity: 0.7;
}

.form-input::placeholder {
  color: var(--text-secondary);
}

.error-message {
  padding: 10px 14px;
  background: rgba(var(--danger-rgb), 0.1);
  color: var(--danger-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  text-align: center;
}

.error-fade-enter-active,
.error-fade-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}

.error-fade-enter,
.error-fade-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}

.btn-primary {
  width: 100%;
  height: 50px;
  background: var(--primary-color);
  color: var(--card-bg);
  border-radius: var(--radius-md);
  font-size: var(--font-size-subheadline);
  font-weight: var(--font-weight-semibold);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-primary:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-loading {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s var(--ease-standard) infinite;
}

.login-footer {
  text-align: center;
  margin-top: 24px;
  font-size: var(--font-size-footnote);
}

.footer-text {
  color: var(--text-secondary);
}

.footer-divider {
  color: var(--text-secondary);
  margin: 0 var(--spacing-sm);
}

.footer-link {
  color: var(--primary-color);
  font-weight: var(--font-weight-medium);
  margin-left: var(--spacing-xs);
}

.footer-link:hover {
  text-decoration: underline;
}

/* 快捷上传弹窗 */
.quick-upload-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.quick-upload-card {
  position: relative;
  width: 100%;
  max-width: 380px;
  background: var(--card-bg, #fff);
  border-radius: var(--radius-xl, 20px);
  padding: 32px 28px 28px;
  box-shadow: var(--shadow-lg, 0 10px 40px rgba(0,0,0,0.2));
}
.quick-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: var(--text-secondary, #999);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.quick-close:active { transform: scale(0.92); opacity: 0.7; }
.quick-header {
  text-align: center;
  margin-bottom: 24px;
}
.quick-header-icon {
  font-size: 48px;
  color: var(--primary-color, #007aff);
  margin-bottom: 12px;
}
.quick-title {
  font-size: var(--font-size-title3, 20px);
  font-weight: 600;
  color: var(--text-primary, #000);
  margin: 0 0 6px 0;
}
.quick-desc {
  font-size: var(--font-size-sm, 13px);
  color: var(--text-secondary, #999);
  margin: 0;
}
.quick-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.quick-input-wrap {
  width: 100%;
}
.quick-input {
  width: 100%;
  height: 52px;
  padding: 0 16px;
  border: 1px solid var(--border-color, #e5e5ea);
  border-radius: var(--radius-md, 12px);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 8px;
  text-align: center;
  text-transform: uppercase;
  color: var(--text-primary, #000);
  background: var(--bg-color, #fff);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.quick-input:focus {
  border-color: var(--primary-color, #007aff);
  box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
  outline: none;
}
.quick-input.input-error {
  border-color: var(--danger-color, #ff3b30);
  box-shadow: 0 0 0 3px rgba(255, 59, 48, 0.15);
}
.quick-error {
  padding: 10px 14px;
  background: rgba(255, 59, 48, 0.1);
  color: var(--danger-color, #ff3b30);
  border-radius: var(--radius-md, 12px);
  font-size: var(--font-size-sm, 13px);
  text-align: center;
}
.quick-submit {
  width: 100%;
  height: 50px;
  background: var(--primary-color, #007aff);
  color: #fff;
  border: none;
  border-radius: var(--radius-md, 12px);
  font-size: var(--font-size-subheadline, 15px);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}
.quick-submit:active { transform: scale(0.92); opacity: 0.7; }
.quick-submit:disabled { opacity: 0.5; cursor: not-allowed; }

/* 弹窗动画 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.25s;
}
.modal-fade-enter,
.modal-fade-leave-to {
  opacity: 0;
}
.modal-fade-enter-active .quick-upload-card,
.modal-fade-leave-active .quick-upload-card {
  transition: transform 0.25s var(--ease-standard, ease), opacity 0.25s;
}
.modal-fade-enter .quick-upload-card {
  transform: scale(0.92) translateY(8px);
  opacity: 0;
}
.modal-fade-leave-to .quick-upload-card {
  transform: scale(0.97) translateY(-4px);
  opacity: 0;
}
</style>
