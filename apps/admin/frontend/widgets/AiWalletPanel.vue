<template>
  <div class="aiw-widget">
    <div v-if="!isAdmin" class="aiw-state"><i class="fa-solid fa-lock"></i><span>无权访问</span></div>
    <div v-else-if="loading && !users.length" class="aiw-state"><div class="aiw-spinner"></div></div>
    <div v-else-if="error" class="aiw-state"><i class="fa-solid fa-circle-exclamation"></i><span>加载失败</span></div>
    <div v-else class="aiw-body">
      <div class="aiw-head">
        <div class="aiw-icon"><i class="fa-solid fa-wallet"></i></div>
        <div class="aiw-info">
          <div class="aiw-title">AI 额度</div>
          <div class="aiw-sub">已用金额取自用量流水，随记账自动更新，不会漂移</div>
        </div>
        <div class="aiw-window">
          <select v-model.number="windowDays" class="aiw-window-select" title="新建额度默认生效的滚动窗口">
            <option :value="7">7天</option>
            <option :value="30">30天</option>
            <option :value="90">90天</option>
          </select>
        </div>
        <button class="aiw-refresh" :disabled="loading" @click="load"><i class="fa-solid fa-rotate" :class="{ spinning: loading }"></i></button>
      </div>

      <p class="aiw-hint">
        留空 / 0 = <b>不限额</b>（所有人默认不限额，设了才开始拦）。
        达到上限后该用户发消息会收到 402 提示。清空 = 恢复不限额。
      </p>

      <div v-if="pricedModels === 0" class="aiw-alert aiw-alert--info">
        <i class="fa-solid fa-circle-info"></i>
        还没有任何「已启用」的模型填单价（输入/输出价），记账恒为 0 —— 先去「AI 模型」里把价填了，额度才会生效。
      </div>

      <div v-if="alertCount" class="aiw-alert">
        <i class="fa-solid fa-triangle-exclamation"></i>
        {{ alertCount }} 人已用满额度，{{ nearCount }} 人已用 ≥80%
      </div>

      <div v-if="!users.length" class="aiw-state aiw-state--inline">
        <i class="fa-solid fa-inbox"></i><span>窗口内还没有人用过 AI</span>
      </div>
      <div v-else class="aiw-list scrollbar-thin">
        <div v-for="u in users" :key="u.user_id" class="aiw-row" :class="rowClass(u)">
          <div class="aiw-row-main">
            <span class="aiw-name" :title="u.user_id">{{ u.net_name }}</span>
            <span class="aiw-used">¥{{ u.used_yuan }} <i class="aiw-calls">/ {{ u.calls }} 次</i></span>
          </div>
          <div class="aiw-row-bar">
            <div class="aiw-bar">
              <div class="aiw-bar-fill" :class="barClass(u)" :style="{ width: barWidth(u) }"></div>
            </div>
            <span class="aiw-pct">{{ quotaPct(u) }}</span>
          </div>
          <div class="aiw-row-edit">
            <div class="aiw-input-wrap">
              <input
                class="aiw-input"
                type="number"
                min="0"
                step="0.5"
                placeholder="不限"
                v-model.number="drafts[u.user_id]"
                @keyup.enter="save(u)"
              />
              <span class="aiw-unit">元</span>
            </div>
            <select v-model.number="winDays[u.user_id]" class="aiw-days">
              <option :value="0">继承</option>
              <option :value="7">7天</option>
              <option :value="30">30天</option>
              <option :value="90">90天</option>
            </select>
            <button class="aiw-btn" :disabled="busy[u.user_id]" @click="save(u)">设</button>
            <button
              class="aiw-btn aiw-btn--ghost"
              :class="{ confirming: confirmingClear === u.user_id }"
              @click="clearQuota(u)"
              :title="confirmingClear === u.user_id ? '再点一次确认清空' : '清空（恢复不限额）'"
            >{{ confirmingClear === u.user_id ? '确认?' : '清' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

export default {
  name: 'AiWalletPanel',
  props: {
    config: { type: Object, default: function() { return {}; } },
    refreshKey: { type: Number, default: 0 }
  },
  data: function() {
    return {
      loading: true,
      error: false,
      users: [],
      pricedModels: -1,   // -1 = 未知；0 = 没填单价（要提示）
      drafts: {},       // user_id → 输入框里的元（初始值 = 现有额度，未设则为 ''）
      winDays: {},      // user_id → 窗口天数（0 = 继承全局默认）
      busy: {},
      confirmingClear: null,
      confirmTimer: null,
      windowDays: 30
    };
  },
  computed: {
    isAdmin: function() {
      return this.$store.getters['auth/isAdmin'];
    },
    limited: function() {
      var self = this;
      return self.users.filter(function(u) { return (u.quota_micro || 0) > 0; });
    },
    alertCount: function() {
      return this.limited.filter(function(u) { return self.pct(u) >= 100; }).length;
    },
    nearCount: function() {
      var self = this;
      return self.limited.filter(function(u) { return self.pct(u) >= 80 && self.pct(u) < 100; }).length;
    }
  },
  watch: {
    refreshKey: function() { this.load(); }
  },
  mounted: function() { this.load(); },
  activated: function() { this.load(); },
  beforeDestroy: function() { if (this.confirmTimer) clearTimeout(this.confirmTimer); },
  methods: {
    pct: function(u) {
      if (!(u.quota_micro > 0)) return 0;
      return Math.round((u.used_micro || 0) / u.quota_micro * 100);
    },
    quotaPct: function(u) {
      if (!(u.quota_micro > 0)) return '不限';
      return this.pct(u) + '%';
    },
    rowClass: function(u) {
      var p = this.pct(u);
      if (!(u.quota_micro > 0)) return '';
      if (p >= 100) return 'aiw-row--full';
      if (p >= 80) return 'aiw-row--near';
      return '';
    },
    barClass: function(u) {
      var p = this.pct(u);
      if (!(u.quota_micro > 0)) return '';
      if (p >= 100) return 'aiw-bar-fill--full';
      if (p >= 80) return 'aiw-bar-fill--near';
      return '';
    },
    barWidth: function(u) {
      if (!(u.quota_micro > 0)) return '0%';
      return Math.min(100, Math.max(2, this.pct(u))) + '%';
    },
    load: function() {
      var self = this;
      if (!self.isAdmin) { self.loading = false; return; }
      self.loading = true;
      self.error = false;
      api.get('/ai-chat/admin/wallet', { params: { days: 30 }, timeout: 20000 }).then(function(res) {
        var data = (res.data && res.data.data) || {};
        self.users = data.users || [];
        self.pricedModels = typeof data.priced_models === 'number' ? data.priced_models : -1;
        var drafts = {}, winDays = {};
        self.users.forEach(function(u) {
          drafts[u.user_id] = (u.quota_micro || 0) > 0 ? u.quota_yuan : '';
          winDays[u.user_id] = u.window_days || 0;
        });
        self.drafts = drafts;
        self.winDays = winDays;
      }).catch(function() {
        self.error = true;
      }).finally(function() {
        self.loading = false;
      });
    },
    save: function(u) {
      var self = this;
      var raw = self.drafts[u.user_id];
      var yuan = (raw === '' || raw === null || raw === undefined) ? 0 : Number(raw);
      if (!isFinite(yuan) || yuan < 0) {
        self.$store.commit('toast/SHOW_TOAST', { message: '额度要是不小于 0 的数字', type: 'warning' });
        return;
      }
      self.busy[u.user_id] = true;
      api.put('/ai-chat/admin/wallet/' + u.user_id, {
        quota_yuan: yuan,
        window_days: self.winDays[u.user_id] || 0
      }).then(function() {
        self.$store.commit('toast/SHOW_TOAST', {
          message: yuan > 0 ? (u.net_name + ' 额度设为 ¥' + yuan) : (u.net_name + ' 已设为不限额'),
          type: 'success'
        });
        self.load();
      }).catch(function(err) {
        var msg = (err && err.response && err.response.data && err.response.data.message) || '保存失败';
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      }).finally(function() {
        self.busy[u.user_id] = false;
      });
    },
    clearQuota: function(u) {
      var self = this;
      if (self.confirmingClear !== u.user_id) {
        self.confirmingClear = u.user_id;
        clearTimeout(self.confirmTimer);
        self.confirmTimer = setTimeout(function() { self.confirmingClear = null; }, 4000);
        return;
      }
      self.confirmingClear = null;
      self.busy[u.user_id] = true;
      api.delete('/ai-chat/admin/wallet/' + u.user_id).then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: u.net_name + ' 已恢复不限额', type: 'success' });
        self.load();
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '操作失败', type: 'error' });
      }).finally(function() {
        self.busy[u.user_id] = false;
      });
    }
  }
};
</script>

<style scoped>
.aiw-widget {
  height: 100%;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  background: var(--card-bg);
  border: 1px solid var(--separator-color);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
}
.aiw-state {
  height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; color: var(--text-tertiary); font-size: var(--font-size-caption);
}
.aiw-state--inline { padding: 18px 0; }
.aiw-state i { font-size: 20px; }
.aiw-spinner {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid var(--separator-color); border-top-color: #AF52DE;
  animation: aiw-spin 0.9s linear infinite;
}
@keyframes aiw-spin { to { transform: rotate(360deg); } }

.aiw-body {
  height: 100%; display: flex; flex-direction: column;
  padding: 10px 12px; gap: 8px; position: relative; overflow: hidden;
}
.aiw-body::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: #FF9500;
}
.aiw-head { display: flex; align-items: center; gap: 10px; }
.aiw-icon {
  width: 34px; height: 34px; border-radius: var(--radius-sm);
  background: #FF9500; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; flex-shrink: 0;
}
.aiw-info { flex: 1; min-width: 0; }
.aiw-title { font-size: var(--font-size-body); font-weight: 600; color: var(--text-primary); }
.aiw-sub { font-size: 11px; color: var(--text-tertiary); margin-top: 2px; }
.aiw-window-select, .aiw-days {
  border: 1px solid var(--separator-color); border-radius: var(--radius-sm);
  background: transparent; color: var(--text-secondary);
  font-size: 11px; padding: 3px 4px;
}
.aiw-refresh {
  width: 28px; height: 28px; border: none; border-radius: var(--radius-sm);
  background: var(--fill-quaternary, rgba(120, 120, 128, 0.12));
  color: var(--text-secondary); cursor: pointer; flex-shrink: 0;
}
.aiw-refresh:active { transform: scale(0.92); }
.aiw-refresh .spinning { animation: aiw-spin 0.9s linear infinite; display: inline-block; }

.aiw-hint { margin: 0; font-size: 11px; color: var(--text-tertiary); line-height: 1.5; }
.aiw-hint b { color: var(--text-secondary); }

.aiw-alert {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--danger-color, #FF3B30);
  background: rgba(255, 59, 48, 0.08);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
}
.aiw-alert--info { color: var(--info-color, #007AFF); background: rgba(0, 122, 255, 0.08); line-height: 1.5; }
.aiw-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.aiw-row {
  display: flex; flex-direction: column; gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--separator-color);
  border-radius: var(--radius-sm);
}
.aiw-row--near { border-color: rgba(255, 149, 0, 0.55); }
.aiw-row--full { border-color: rgba(255, 59, 48, 0.6); background: rgba(255, 59, 48, 0.05); }
.aiw-row-main { display: flex; align-items: baseline; gap: 8px; }
.aiw-name {
  flex: 1; min-width: 0;
  font-size: var(--font-size-caption); color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.aiw-used { font-size: var(--font-size-caption); font-weight: 600; color: var(--text-primary); flex-shrink: 0; }
.aiw-calls { font-style: normal; font-size: 10px; font-weight: 400; color: var(--text-tertiary); }
.aiw-row-bar { display: flex; align-items: center; gap: 6px; }
.aiw-bar { flex: 1; height: 4px; border-radius: 2px; background: var(--fill-quaternary, rgba(120,120,128,0.12)); overflow: hidden; }
.aiw-bar-fill { height: 100%; border-radius: 2px; background: #AF52DE; }
.aiw-bar-fill--near { background: #FF9500; }
.aiw-bar-fill--full { background: #FF3B30; }
.aiw-pct { font-size: 10px; color: var(--text-tertiary); min-width: 30px; text-align: right; }
.aiw-row-edit { display: flex; align-items: center; gap: 5px; }
.aiw-input-wrap { position: relative; flex: 1; min-width: 0; }
.aiw-input {
  width: 100%; box-sizing: border-box;
  padding: 4px 26px 4px 7px;
  border: 1px solid var(--separator-color); border-radius: var(--radius-sm);
  background: transparent; color: var(--text-primary); font-size: 12px;
}
.aiw-unit {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  font-size: 10px; color: var(--text-tertiary); pointer-events: none;
}
.aiw-btn {
  padding: 4px 9px; border-radius: var(--radius-sm);
  border: 1px solid #FF9500; background: #FF9500; color: #fff;
  font-size: 11px; cursor: pointer; flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}
.aiw-btn:disabled { opacity: 0.5; }
.aiw-btn--ghost { background: transparent; color: var(--text-secondary); border-color: var(--separator-color); }
.aiw-btn--ghost.confirming { color: var(--danger-color, #FF3B30); border-color: var(--danger-color, #FF3B30); }
</style>
