<template>
  <div v-if="visible" class="txy" :class="{ 'txy--done': claimed, 'txy--flash': flash }" :aria-busy="loading || busy">
    <span class="txy-ico"><i class="fa-solid fa-coins"></i></span>
    <span class="txy-text">
      <b v-if="loading">{{ ready ? '正在刷新学元状态…' : '正在查看学元状态…' }}</b>
      <b v-else-if="error && !ready">{{ error }}</b>
      <b v-else-if="error && claimed">上次读取：今日已领 · 连签 {{ streak }} 天</b>
      <b v-else-if="error">上次读取：今天有 <em>+{{ fmt(amount) }}</em> 学元可领</b>
      <b v-else-if="!ready">正在看看今天有什么…</b>
      <b v-else-if="!claimed">今天有 <em>+{{ fmt(amount) }}</em> 学元可以领</b>
      <b v-else>今日已领 · 连签 {{ streak }} 天</b>
      <small v-if="error && ready" class="txy-stale">暂时无法确认最新状态，以上是上次成功读取的数据</small>
      <small v-else-if="error">稍后再试，或点钱包查看</small>
      <small v-else-if="ready && !claimed">点一下就到账，攒着能给同学发红包</small>
      <small v-else-if="ready && claimed">钱包里有 {{ fmt(balance) }} 学元，去聊天里花掉它</small>
    </span>
    <button v-if="loading" class="txy-btn ghost" disabled>
      {{ ready ? '刷新中…' : '读取中…' }}
    </button>
    <button v-else-if="error" class="txy-btn ghost" @click="load">重试</button>
    <button v-else-if="!claimed" class="txy-btn" :disabled="!canClaim()" @click="claim">
      {{ busy ? '领取中…' : '点一下领' }}
    </button>
    <button v-else class="txy-btn ghost" @click="goChat">
      去发红包 <i class="fa-solid fa-arrow-right"></i>
    </button>
    <button v-if="claimed" class="txy-close" aria-label="今天不再显示" @click="hide">
      <i class="fa-solid fa-xmark"></i>
    </button>
    <span v-if="notice" class="txy-toast" role="status" aria-live="polite">{{ notice }}</span>
  </div>
</template>

<script>
import api from '@/utils/api';
import { createDailyAllowanceController } from '@/core/daily-allowance-controller.mjs';
import {
  getDailyAllowanceHiddenKey,
  isDailyAllowanceHidden
} from '@/core/daily-allowance-visibility.mjs';

function todayKey() {
  var d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function fmt(n) {
  var v = Number(n || 0);
  if (!isFinite(v)) v = 0;
  var parts = v.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

export default {
  name: 'TodayXueyuanBar',
  data: function () {
    return {
      visible: true,
      ready: false,
      loading: false,
      error: '',
      claimed: false,
      amount: 0,
      streak: 0,
      balance: 0,
      busy: false,
      flash: false,
      notice: ''
    };
  },
  created: function () {
    // 未领时不允许被收起：这是首屏唯一的「今天为什么回来」钩子
    if (this.isHidden()) this.visible = false;
    this.allowanceController = createDailyAllowanceController(api, this.$data);
    this.load();
  },
  methods: {
    fmt: fmt,
    canClaim: function () {
      return this.allowanceController.canClaim();
    },
    currentUser: function () {
      try {
        if (this.$store && this.$store.getters && this.$store.getters['auth/user']) {
          return this.$store.getters['auth/user'];
        }
        return JSON.parse(localStorage.getItem('user') || 'null');
      } catch (e) { return null; }
    },
    hideKey: function () { return getDailyAllowanceHiddenKey(todayKey(), this.currentUser()); },
    isHidden: function () {
      try { return isDailyAllowanceHidden(localStorage, todayKey(), this.currentUser()); } catch (e) { return false; }
    },
    load: function () {
      var self = this;
      return this.allowanceController.load().then(function (result) {
        // 每个账号独立记忆收起状态；切换账号后重新决定是否展示
        if (result.status === 'loaded') self.visible = !self.isHidden();
        return result;
      });
    },
    claim: function () {
      var self = this;
      var amount = self.amount;
      self.notice = '';
      return this.allowanceController.claim().then(function (result) {
        if (result.status === 'claimed' || result.status === 'duplicate') {
          self.notice = result.status === 'duplicate'
            ? '今天已经领过啦'
            : ('+' + fmt(amount) + ' 学元已到账');
          self.flash = true;
          setTimeout(function () { self.flash = false; }, 900);
          // 通知其它页面（钱包/聊天）刷新，不必等下次进入
          try { window.dispatchEvent(new CustomEvent('ci:xueyuan-changed')); } catch (e) {}
        } else if (result.status === 'failed') {
          self.notice = result.message || '领取失败，稍后再试';
        }
        if (self.notice) setTimeout(function () { self.notice = ''; }, 2600);
        return result;
      });
    },
    goChat: function () {
      var self = this;
      try {
        if (self.$router) {
          self.$router.push('/chat').catch(function () { window.location.href = '/chat'; });
          return;
        }
      } catch (e) {}
      window.location.href = '/chat';
    },
    hide: function () {
      try { localStorage.setItem(this.hideKey(), '1'); } catch (e) {}
      this.visible = false;
    }
  }
};
</script>

<style scoped>
/* Chrome 80：不用 flex gap / inset / min()；颜色走全局变量以适配明暗双主题 */
.txy {
  position: fixed;
  left: 50%;
  bottom: 86px;
  transform: translateX(-50%);
  z-index: 62;
  display: flex;
  align-items: center;
  width: 520px;
  max-width: 92vw;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(224, 160, 32, .38);
  background: var(--card-bg, rgba(38, 32, 22, .94));
  box-shadow: 0 8px 28px rgba(0, 0, 0, .28);
  box-sizing: border-box;
  color: var(--text-primary, inherit);
}
.txy--flash { animation: txy-pop .8s ease; }
@keyframes txy-pop {
  0% { transform: translateX(-50%) scale(1); }
  35% { transform: translateX(-50%) scale(1.035); }
  100% { transform: translateX(-50%) scale(1); }
}
.txy-ico {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  line-height: 34px;
  text-align: center;
  border-radius: 10px;
  margin-right: 10px;
  background: rgba(224, 160, 32, .18);
  color: #E0A020;
  font-size: 17px;
}
.txy--done .txy-ico { background: rgba(46, 158, 107, .16); color: #2e9e6b; }
.txy-text { flex: 1 1 auto; min-width: 0; }
.txy-text b {
  display: block;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.txy-text b em { font-style: normal; color: #E0A020; font-size: 15px; }
.txy-text small {
  display: block;
  font-size: 11px;
  line-height: 1.4;
  margin-top: 2px;
  color: var(--text-secondary, rgba(140, 140, 140, .95));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.txy-btn {
  flex: 0 0 auto;
  margin-left: 10px;
  min-height: 40px;
  padding: 8px 14px;
  border: 0;
  border-radius: 9px;
  background: #E0A020;
  color: #241c08;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.txy-btn.ghost {
  background: transparent;
  color: var(--text-primary, inherit);
  border: 1px solid var(--border-color, rgba(128, 128, 128, .4));
  font-weight: 600;
}
.txy-btn:disabled { opacity: .55; cursor: not-allowed; }
.txy-close {
  flex: 0 0 auto;
  margin-left: 6px;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, rgba(140, 140, 140, .95));
  cursor: pointer;
  font-size: 12px;
}
.txy-toast {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(30, 30, 30, .92);
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
}
@media (max-width: 560px) {
  .txy { bottom: 76px; padding: 8px 10px; }
  .txy-text b { font-size: 12px; }
  .txy-text small { display: none; }
  .txy-text .txy-stale { display: block; white-space: normal; }
  .txy-btn { min-height: 40px; padding: 7px 10px; font-size: 12px; }
}
</style>
