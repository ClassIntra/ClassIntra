<template>
  <div class="error-boundary-wrap">
    <div v-if="error" class="error-boundary">
      <div class="error-content">
        <i class="fa-solid fa-triangle-exclamation error-icon"></i>
        <h3 class="error-title">页面加载异常</h3>
        <p class="error-message">{{ errorMessage }}</p>
        <div class="error-actions">
          <button class="error-retry-btn" @click="handleRetry">重新加载</button>
          <button class="error-back-btn" @click="goBack">返回</button>
        </div>
        <p class="error-help">如果问题持续存在，请检查网络后再试。</p>
      </div>
    </div>
    <slot v-else></slot>
  </div>
</template>

<script>
export default {
  name: 'ErrorBoundary',
  data: function() {
    return {
      error: null
    };
  },
  computed: {
    errorMessage: function() {
      if (!this.error) return '';
      var msg = this.error.message || '未知错误';
      if (/Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module/.test(msg)) {
        return '网络连接异常，部分资源加载失败';
      }
      if (msg.length > 100) msg = msg.substring(0, 100) + '...';
      return msg;
    }
  },
  errorCaptured: function(err, vm, info) {
    this.error = err;
    console.error('ErrorBoundary caught:', err, info);
    return false;
  },
  methods: {
    handleRetry: function() {
      this.error = null;
      window.location.reload();
    },
    goBack: function() {
      this.error = null;
      if (window.history.length > 1) {
        this.$router.go(-1);
      } else {
        this.$router.push('/').catch(function() {});
      }
    }
  }
};
</script>

<style scoped>
.error-boundary-wrap {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: var(--spacing-xl);
  background: var(--bg-color);
}

.error-content {
  text-align: center;
  max-width: 320px;
}

.error-icon {
  font-size: 40px;
  color: var(--warning-color, #f59e0b);
  margin-bottom: var(--spacing-md);
}

.error-title {
  font-size: var(--font-size-lg);
  color: var(--text-primary);
  margin: 0 0 var(--spacing-sm);
}

.error-message {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin: 0 0 var(--spacing-lg);
  word-break: break-word;
}

.error-actions { display: flex; justify-content: center; gap: 8px; }
.error-help { margin: 12px 0 0; color: var(--text-tertiary, var(--text-secondary)); font-size: var(--font-size-xs); }
.error-retry-btn {
  padding: 10px 24px;
  background: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  margin-right: 8px;
}

.error-retry-btn:hover {
  background: var(--primary-hover);
}

.error-back-btn {
  padding: 10px 24px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.error-back-btn:hover {
  background: var(--bg-color);
}
</style>
