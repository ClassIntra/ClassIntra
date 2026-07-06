<template>
  <div class="register-page" :class="{ 'page-enter': entered }">
    <div class="register-card">
      <div class="register-header">
        <div class="logo-icon">C</div>
        <h1 class="register-title">注册 ClassIntra</h1>
        <p class="register-subtitle">创建你的校园账号</p>
      </div>
      <form class="register-form" @submit.prevent="handleRegister">
        <div class="form-group">
          <input
            v-model="net_name"
            type="text"
            class="form-input"
            :class="{ 'input-error': fieldErrors.net_name }"
            placeholder="网名"
            autocomplete="nickname"
            @input="clearFieldError('net_name')"
          />
        </div>
        <div class="form-group">
          <input
            v-model="real_name"
            type="text"
            class="form-input"
            :class="{ 'input-error': fieldErrors.real_name }"
            placeholder="真实姓名"
            autocomplete="name"
            @input="clearFieldError('real_name')"
          />
        </div>
        <div class="form-group">
          <input
            v-model="password"
            type="password"
            class="form-input"
            :class="{ 'input-error': fieldErrors.password }"
            placeholder="密码"
            autocomplete="new-password"
            @input="clearFieldError('password'); updatePasswordStrength()"
          />
          <div v-if="password" class="password-strength">
            <div class="strength-bar">
              <div class="strength-fill" :style="{ width: passwordStrength.percent + '%' }" :class="passwordStrength.level"></div>
            </div>
            <span class="strength-text" :class="passwordStrength.level">{{ passwordStrength.label }}</span>
          </div>
        </div>
        <div class="form-group">
          <input
            v-model="confirm_password"
            type="password"
            class="form-input"
            :class="{ 'input-error': fieldErrors.confirm_password }"
            placeholder="确认密码"
            autocomplete="new-password"
            @input="clearFieldError('confirm_password')"
          />
        </div>
        <transition name="error-fade">
          <div v-if="errorMsg" class="error-message">{{ errorMsg }}</div>
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
      entered: false
    };
  },
  mounted: function() {
    var self = this;
    self.$nextTick(function() {
      self.entered = true;
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
          self.$router.push({ name: 'Desktop' });
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
.register-page {
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

.register-page.page-enter {
  opacity: 1;
  transform: translateY(0);
}

.register-card {
  width: 420px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur-thick);
  -webkit-backdrop-filter: var(--glass-blur-thick);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  padding: 40px;
  box-shadow: var(--shadow-xl);
}

.register-header {
  text-align: center;
  margin-bottom: 28px;
}

.logo-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 12px;
  background: linear-gradient(135deg, var(--primary-dark), var(--primary-color));
  border-radius: var(--radius-xl);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-title1);
  font-weight: var(--font-weight-bold);
  color: var(--card-bg);
  box-shadow: 0 8px 24px rgba(var(--primary-rgb), 0.35);
}

.register-title {
  font-size: var(--font-size-title2);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin-bottom: 4px;
}

.register-subtitle {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.register-form {
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

.form-input::placeholder {
  color: var(--text-secondary);
}

.password-strength {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: 6px;
}

.strength-bar {
  flex: 1;
  height: 4px;
  background: var(--border-color);
  border-radius: var(--radius-pill);
  overflow: hidden;
}

.strength-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--duration-normal) var(--ease-standard), background var(--duration-normal) var(--ease-standard);
}

.strength-fill.weak {
  background: var(--danger-color);
}

.strength-fill.medium {
  background: var(--warning-color);
}

.strength-fill.strong {
  background: var(--success-color);
}

.strength-text {
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  min-width: 20px;
}

.strength-text.weak {
  color: var(--danger-color);
}

.strength-text.medium {
  color: var(--warning-color);
}

.strength-text.strong {
  color: var(--success-color);
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
  font-weight: var(--font-weight-medium);
  margin-left: var(--spacing-xs);
}

.footer-link:hover {
  text-decoration: underline;
}
</style>
