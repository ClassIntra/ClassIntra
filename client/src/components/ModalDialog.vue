<template>
  <transition name="modal-fade">
    <div v-if="visible" class="modal-overlay" @click.self="handleOverlayClick">
      <div class="modal-container" :class="modalClass">
        <div v-if="title" class="modal-header">
          <h3 class="modal-title">{{ title }}</h3>
        </div>
        <div class="modal-body">
          <p v-if="message" class="modal-message">{{ message }}</p>
          <div v-if="type === 'prompt'" class="modal-input-wrapper">
            <input
              ref="promptInput"
              v-model="inputValue"
              class="modal-input"
              :placeholder="placeholder"
              @keydown.enter="handleConfirm"
            />
          </div>
        </div>
        <div class="modal-footer">
          <button
            v-if="type !== 'alert'"
            class="modal-btn modal-btn-cancel"
            @click="handleCancel"
          >
            {{ cancelText }}
          </button>
          <button
            class="modal-btn modal-btn-confirm"
            :class="'modal-btn-' + type"
            @click="handleConfirm"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
export default {
  name: 'ModalDialog',
  data: function() {
    return {
      visible: false,
      type: 'alert',
      title: '',
      message: '',
      inputValue: '',
      placeholder: '',
      confirmText: '确定',
      cancelText: '取消',
      closeOnOverlay: false,
      _resolve: null,
      _reject: null
    };
  },
  computed: {
    modalClass: function() {
      return 'modal-type-' + this.type;
    }
  },
  watch: {
    visible: function(val) {
      if (val && this.type === 'prompt') {
        var self = this;
        this.$nextTick(function() {
          if (self.$refs.promptInput) {
            self.$refs.promptInput.focus();
          }
        });
      }
    }
  },
  methods: {
    alert: function(options) {
      var self = this;
      var opts = typeof options === 'string' ? { message: options } : (options || {});
      self.type = 'alert';
      self.title = opts.title || '提示';
      self.message = opts.message || '';
      self.confirmText = opts.confirmText || '确定';
      self.closeOnOverlay = opts.closeOnOverlay !== false;
      self.visible = true;
      return new Promise(function(resolve) {
        self._resolve = resolve;
        self._reject = null;
      });
    },
    confirm: function(options) {
      var self = this;
      var opts = typeof options === 'string' ? { message: options } : (options || {});
      self.type = 'confirm';
      self.title = opts.title || '确认';
      self.message = opts.message || '';
      self.confirmText = opts.confirmText || '确定';
      self.cancelText = opts.cancelText || '取消';
      self.closeOnOverlay = false;
      self.visible = true;
      return new Promise(function(resolve, reject) {
        self._resolve = resolve;
        self._reject = reject;
      });
    },
    prompt: function(options) {
      var self = this;
      var opts = typeof options === 'string' ? { message: options } : (options || {});
      self.type = 'prompt';
      self.title = opts.title || '输入';
      self.message = opts.message || '';
      self.placeholder = opts.placeholder || '';
      self.inputValue = opts.defaultValue || '';
      self.confirmText = opts.confirmText || '确定';
      self.cancelText = opts.cancelText || '取消';
      self.closeOnOverlay = false;
      self.visible = true;
      return new Promise(function(resolve, reject) {
        self._resolve = resolve;
        self._reject = reject;
      });
    },
    handleConfirm: function() {
      var result;
      if (this.type === 'prompt') {
        result = this.inputValue;
      } else if (this.type === 'confirm') {
        result = true;
      } else {
        result = true;
      }
      this.visible = false;
      if (this._resolve) {
        this._resolve(result);
        this._resolve = null;
        this._reject = null;
      }
    },
    handleCancel: function() {
      this.visible = false;
      if (this.type === 'prompt') {
        if (this._reject) {
          this._reject(null);
        } else if (this._resolve) {
          this._resolve(null);
        }
      } else {
        if (this._resolve) {
          this._resolve(false);
        }
      }
      this._resolve = null;
      this._reject = null;
    },
    handleOverlayClick: function() {
      if (this.closeOnOverlay) {
        this.handleCancel();
      }
    }
  }
};
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal, 10001);
  backdrop-filter: var(--glass-blur-regular);
  -webkit-backdrop-filter: var(--glass-blur-regular);
}

.modal-container {
  background: var(--surface-elevated);
  backdrop-filter: var(--glass-blur-thick);
  -webkit-backdrop-filter: var(--glass-blur-thick);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-xl), 0 0 0 0.5px var(--glass-border);
  min-width: 320px;
  max-width: 440px;
  width: 90%;
  overflow: hidden;
  animation: modal-enter 0.4s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}

@keyframes modal-enter {
  0% {
    opacity: 0;
    transform: scale(0.85) translateY(16px);
  }
  50% {
    opacity: 1;
    transform: scale(1.03) translateY(-2px);
  }
  75% {
    transform: scale(0.99) translateY(1px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.modal-header {
  padding: 20px 24px 0;
}

.modal-title {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin: 0;
}

.modal-body {
  padding: 16px 24px;
}

.modal-message {
  font-size: var(--font-size-base);
  color: var(--text-secondary);
  line-height: var(--line-height-relaxed);
  margin: 0;
  word-break: break-word;
}

.modal-input-wrapper {
  margin-top: 12px;
}

.modal-input {
  width: 100%;
  padding: 10px 14px;
  border: 0.5px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  color: var(--text-primary);
  background: var(--bg-color);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  box-sizing: border-box;
}

.modal-input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light);
  outline: none;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 24px 20px;
}

.modal-btn + .modal-btn {
  margin-left: 10px;
}

.modal-btn {
  padding: 9px 22px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  border: none;
  transition: background var(--transition-fast), transform var(--transition-fast);
  min-width: 72px;
  text-align: center;
}

.modal-btn:active {
  transform: scale(0.94);
  opacity: 0.7;
}

.modal-btn-cancel {
  background: var(--primary-light);
  color: var(--primary-color);
}

.modal-btn-cancel:hover {
  background: rgba(var(--primary-rgb), 0.18);
}

[data-theme="dark"] .modal-btn-cancel:hover {
  background: rgba(255, 255, 255, 0.08);
}

.modal-btn-confirm {
  color: #fff;
}

.modal-btn-alert {
  background: var(--primary-color);
}

.modal-btn-alert:hover {
  background: var(--primary-hover);
}

.modal-btn-confirm.modal-btn-confirm {
  background: var(--primary-color);
}

.modal-btn-confirm.modal-btn-confirm:hover {
  background: var(--primary-hover);
}

.modal-btn-danger {
  background: var(--danger-color);
}

.modal-btn-danger:hover {
  background: var(--danger-pressed);
}

@media (min-width: 1024px) and (orientation: landscape) {
  .modal-container {
    min-width: 360px;
    max-width: 480px;
  }
}
</style>
