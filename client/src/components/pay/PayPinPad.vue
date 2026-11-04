<template>
  <div class="pin-pad">
    <div class="pin-head">
      <div class="pin-title">{{ title }}</div>
      <div v-if="subtitle" class="pin-sub">{{ subtitle }}</div>
      <div class="pin-dots">
        <span v-for="i in 6" :key="i" class="pin-dot" :class="{ filled: pin.length >= i }"></span>
      </div>
      <div class="pin-msg" :class="{ error: !!error }">{{ error || hint }}</div>
    </div>

    <div class="pin-keys">
      <button
        v-for="k in keys"
        :key="k.v"
        class="pin-key"
        :class="{ 'pin-key--fn': k.fn, 'pin-key--blank': k.blank }"
        :disabled="disabled || k.blank"
        @click="press(k.v)"
      >{{ k.label }}</button>
    </div>

    <div class="pin-foot">
      <button class="pin-link" @click="$emit('forgot')">忘记支付密码？</button>
      <button v-if="canCancel" class="pin-link" @click="cancel">取消</button>
    </div>
  </div>
</template>

<script>
// 6 位支付密码键盘
// ------------------------------------------------------------
// 为什么自绘键盘而不是 input：平板上系统键盘会遮住半个屏幕，
// 且数字键盘布局不固定；自绘的与微信一致，永远是 3×4，位置不会跳。
export default {
  name: 'PayPinPad',
  props: {
    title: { type: String, default: '请输入支付密码' },
    subtitle: { type: String, default: '' },
    hint: { type: String, default: '' },
    error: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
    canCancel: { type: Boolean, default: true }
  },
  data: function () {
    return {
      pin: '',
      keys: [
        { v: '1', label: '1' }, { v: '2', label: '2' }, { v: '3', label: '3' },
        { v: '4', label: '4' }, { v: '5', label: '5' }, { v: '6', label: '6' },
        { v: '7', label: '7' }, { v: '8', label: '8' }, { v: '9', label: '9' },
        { v: '', label: '', blank: true }, { v: '0', label: '0' },
        { v: 'del', label: '⌫', fn: true }
      ]
    };
  },
  watch: {
    error: function (v) {
      // 密码错了：清空重来（微信也是这样，不会留着错误的一串）
      if (v) this.pin = '';
    }
  },
  methods: {
    press: function (v) {
      if (this.disabled || !v) return;
      if (v === 'del') {
        this.pin = this.pin.slice(0, -1);
        return;
      }
      if (this.pin.length >= 6) return;
      this.pin += v;
      if (this.pin.length === 6) {
        var p = this.pin;
        this.$emit('submit', p);
      }
    },
    clear: function () { this.pin = ''; },
    cancel: function () {
      this.pin = '';
      this.$emit('cancel');
    }
  }
};
</script>

<style scoped>
.pin-pad {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-color);
}

.pin-head {
  padding: 26px 24px 10px;
  text-align: center;
}
.pin-title {
  font-size: var(--font-size-headline, 16px);
  font-weight: 600;
  color: var(--text-primary);
}
.pin-sub {
  margin-top: 6px;
  font-size: var(--font-size-footnote);
  color: var(--text-secondary);
}
.pin-dots {
  display: flex;
  justify-content: center;
  margin: 22px 0 10px;
}
.pin-dot {
  width: 38px;
  height: 44px;
  margin: 0 4px;
  border-radius: 8px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  position: relative;
}
.pin-dot.filled::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 50%;
  background: var(--text-primary);
}
.pin-msg {
  min-height: 18px;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}
.pin-msg.error { color: #E4574F; }

.pin-keys {
  margin-top: auto;
  display: flex;
  flex-wrap: wrap;
  padding: 6px 8px 0;
  background: var(--card-bg);
  border-top: 1px solid var(--border-color);
}
.pin-key {
  width: calc(33.333% - 8px);
  height: 52px;
  margin: 4px;
  border-radius: 10px;
  background: var(--bg-color);
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 500;
}
.pin-key:active { background: rgba(127, 127, 127, 0.16); }
.pin-key--fn { font-size: 18px; }
.pin-key--blank { background: transparent; }
.pin-key:disabled { opacity: 0.35; }

.pin-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 20px 16px;
  background: var(--card-bg);
}
.pin-link {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  padding: 6px 4px;
}
</style>
