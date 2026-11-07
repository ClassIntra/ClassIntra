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

    <!-- 统一资产池选择（2026-11-07）：转账/发红包等所有支付场景在支付页选池，
         表单页不再各放一份 —— 一处 UI 处处生效。父级用 :pool.sync 接住。
         只有两个池、必须明选（默认充值学元）——「自动混转」按负责人要求移除，
         钱的性质要一眼可辨；后端 auto 分支仅为兼容未传参的旧调用保留。 -->
    <div v-if="showPool" class="pin-pool">
      <div class="pool-label">用哪种学元</div>
      <div class="pool-seg">
        <button type="button" class="pool-opt" :class="{ active: poolValue === 'cash' }" @click="pickPool('cash')">
          <b>充值学元</b><em>可提现真金</em>
        </button>
        <button type="button" class="pool-opt" :class="{ active: poolValue === 'grant' }" @click="pickPool('grant')">
          <b>赠送学元</b><em>不可提现</em>
        </button>
      </div>
      <div class="pool-note">{{ poolNote }}</div>
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
    canCancel: { type: Boolean, default: true },
    // 资产池（可选）：showPool 为 true 时显示二选区（默认充值学元），选中经 update:pool 回传
    pool: { type: String, default: 'cash' },
    showPool: { type: Boolean, default: false }
  },
  data: function () {
    return {
      poolValue: this.pool,
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
  computed: {
    poolNote: function () {
      if (this.poolValue === 'grant') return '只动赠送学元——领到/收到的人拿到的也是赠送学元（不可提现）';
      return '只动充值学元——对方拿到的是可提现的真金';
    }
  },
  watch: {
    error: function (v) {
      // 密码错了：清空重来（微信也是这样，不会留着错误的一串）
      if (v) this.pin = '';
    },
    pool: function (v) { this.poolValue = v; }
  },
  methods: {
    pickPool: function (v) {
      if (this.disabled) return;
      this.poolValue = v;
      this.$emit('update:pool', v);
    },
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

/* 资产池选择区（可选） */
.pin-pool {
  margin: 4px 16px 0;
  padding: 10px 12px 12px;
  border-radius: 12px;
  background: var(--card-bg);
}
.pool-label {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.pool-seg { display: flex; }
.pool-opt {
  flex: 1;
  margin: 0 4px;
  padding: 8px 2px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  text-align: center;
  cursor: pointer;
}
.pool-opt b { display: block; font-size: var(--font-size-caption); font-weight: 500; color: var(--text-primary); }
.pool-opt em { display: block; margin-top: 2px; font-style: normal; font-size: 10px; color: var(--text-tertiary); }
.pool-opt.active { border-color: var(--primary-color, #E0A020); background: rgba(224, 160, 32, 0.12); }
.pool-opt.active b { color: var(--primary-color, #E0A020); }
.pool-note {
  margin-top: 8px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-tertiary);
}

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
