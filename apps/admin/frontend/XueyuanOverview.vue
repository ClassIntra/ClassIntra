<template>
  <div class="xy-ov">
    <!-- 加载失败 / 服务端未升级：绝不渲染成「一切正常」的空态，保留上一次数据并明示 -->
    <div v-if="error" class="xy-ov-alert">
      <i class="fa-solid fa-plug-circle-xmark"></i>
      <span>{{ error }}</span>
      <button class="xy-ov-link" @click="refresh">重试</button>
    </div>

    <div v-if="!data && !error && loading" class="xy-ov-loading">
      <i class="fa-solid fa-rotate fa-spin"></i> 正在读取账本状态…
    </div>

    <div v-if="data" class="xy-ov-card">
      <div class="xy-ov-head">
        <div class="xy-ov-badge" :class="'is-' + statusKey">
          <i :class="badgeIcon"></i>
          <span>{{ badgeText }}</span>
        </div>
        <div class="xy-ov-headtext">
          <div class="xy-ov-title">{{ headline }}</div>
          <div class="xy-ov-sub">{{ subline }}</div>
        </div>
        <div class="xy-ov-actions">
          <button class="xy-ov-btn" :disabled="loading" @click="refresh">{{ loading ? '检查中…' : '刷新' }}</button>
          <button class="xy-ov-btn ghost" :disabled="reconcileBusy" @click="runReconcile">
            {{ reconcileBusy ? '对账中…' : '重新对账' }}
          </button>
          <button class="xy-ov-btn ghost" @click="showDetail = !showDetail">
            {{ showDetail ? '收起详情' : '查看详情' }}
          </button>
        </div>
      </div>

      <div class="xy-ov-metrics">
        <div class="xy-ov-metric">
          <span>账面现金</span><b>{{ fmt(data.money.cash_on_book) }}</b><em>学元</em>
        </div>
        <div class="xy-ov-metric">
          <span>可兑付敞口</span><b>{{ fmt(data.money.cash_liability) }}</b><em>学元</em>
        </div>
        <div class="xy-ov-metric">
          <span>真金台账</span><b>{{ fmt(data.money.cashbook_liability) }}</b><em>学元</em>
        </div>
        <div class="xy-ov-metric">
          <span>已实现毛利</span><b>{{ fmt(data.money.gross) }}</b><em>学元</em>
        </div>
      </div>

      <div v-if="data.advice && data.advice.length" class="xy-ov-advice">
        <div v-for="(a, i) in data.advice" :key="i" class="xy-ov-advice-row">{{ a }}</div>
      </div>

      <div v-if="showDetail" class="xy-ov-detail">
        <div class="xy-ov-detail-title">检查明细</div>
        <div class="xy-ov-layer" v-for="(row, i) in layerRows" :key="i">
          <span class="xy-ov-dot" :class="row.ok === null ? 'is-unknown' : (row.ok ? 'is-ok' : 'is-bad')"></span>
          <b>{{ row.name }}</b>
          <span class="xy-ov-layer-note">{{ row.note }}</span>
        </div>
        <div v-if="data.issues && data.issues.length" class="xy-ov-issues">
          <div class="xy-ov-detail-title">问题清单</div>
          <div v-for="(it, i) in data.issues" :key="i" class="xy-ov-issue">
            <em>{{ it.code }}</em> {{ it.detail }}
          </div>
        </div>
        <div v-if="data.layers.reconcile.diffs && data.layers.reconcile.diffs.length" class="xy-ov-issues">
          <div class="xy-ov-detail-title">最近对账差异</div>
          <div v-for="(d, i) in data.layers.reconcile.diffs" :key="i" class="xy-ov-issue">
            <em>{{ d.code }}</em> {{ d.scope }}/{{ d.key }} — {{ d.detail }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

function fmt(n) {
  var v = Number(n || 0);
  if (!isFinite(v)) v = 0;
  var parts = v.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
function timeText(s) {
  if (!s) return '-';
  var d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

export default {
  name: 'XueyuanOverview',
  data: function() {
    return {
      data: null,
      error: '',
      loading: false,
      reconcileBusy: false,
      showDetail: false
    };
  },
  computed: {
    statusKey: function() {
      if (!this.data) return 'unknown';
      return this.data.status || 'unknown';
    },
    badgeText: function() {
      if (!this.data) return '暂不可用';
      var m = { ok: '正常', attention: '留意', error: '异常' };
      return m[this.data.status] || '未知';
    },
    badgeIcon: function() {
      if (!this.data) return 'fa-solid fa-circle-question';
      var m = {
        ok: 'fa-solid fa-circle-check',
        attention: 'fa-solid fa-circle-exclamation',
        error: 'fa-solid fa-triangle-exclamation'
      };
      return m[this.data.status] || 'fa-solid fa-circle-question';
    },
    headline: function() {
      if (!this.data) return '状态检查暂不可用';
      return this.data.headline || '';
    },
    subline: function() {
      if (!this.data) return '';
      var c = this.data.counts || {};
      return '检查于 ' + timeText(this.data.checked_at) +
        ' · ' + (c.tx || 0) + ' 笔交易 / ' + (c.entries || 0) + ' 条分录' +
        ' · 金额单位：学元（1 元 = 1000 学元）';
    },
    layerRows: function() {
      if (!this.data) return [];
      var L = this.data.layers || {};
      var p = L.proof || {};
      var r = L.reconcile || {};
      var s = L.supply || {};
      var a = L.attempts || {};
      return [
        {
          name: '账本不变量',
          ok: L.ledger ? L.ledger.ok : null,
          note: 'I1–I10 · ' + (L.ledger ? L.ledger.issue_count : 0) + ' 项问题'
        },
        {
          name: '分录哈希链',
          ok: p.skipped ? null : p.ok,
          note: p.skipped ? '未就绪（待迁移 046）'
            : ('新段 ' + (p.checked || 0) + ' 笔 / 历史 ' + (p.legacy_checked || 0) + ' 笔')
        },
        {
          name: '日终对账',
          ok: r.ok === null || r.ok === undefined ? null : r.ok,
          note: r.last_at ? ('上次 ' + timeText(r.last_at) + ' · ' + (r.issue_count || 0) + ' 项差异') : '尚未运行'
        },
        {
          name: '发行计数器',
          ok: s.ok === undefined ? null : s.ok,
          note: (s.caps || []).map(function(x) { return x.asset + ' ' + fmt(x.issued_xy); }).join(' / ') || '未就绪'
        },
        {
          name: '被拒写入',
          ok: (a.last_24h || 0) < 50,
          note: '近 24 小时 ' + (a.last_24h || 0) + ' 次'
        }
      ];
    }
  },
  created: function() {
    this.refresh();
  },
  methods: {
    fmt: fmt,
    refresh: function() {
      var self = this;
      self.loading = true;
      return api.get('/xy/admin/overview').then(function(res) {
        var d = res && res.data && res.data.data;
        if (!d) {
          self.error = '状态数据格式异常，请稍后重试';
          return;
        }
        self.data = d;
        self.error = '';
      }).catch(function(err) {
        var st = err && err.response && err.response.status;
        // 旧服务端没有这个端点：明确说「没升级」，不要伪装成账本正常
        self.error = st === 404
          ? '状态检查暂不可用：服务端尚未升级到 v2（现有功能不受影响）'
          : '状态数据加载失败，保留上次结果，请检查网络或重试';
        // 红线：拉不到 ≠ 没有。self.data 保留上一次成功的值，不置空。
      }).then(function() {
        self.loading = false;
      });
    },
    runReconcile: function() {
      var self = this;
      self.reconcileBusy = true;
      return api.post('/xy/admin/reconcile').then(function() {
        self.error = '';
        return self.refresh();
      }).catch(function(err) {
        var msg = err && err.response && err.response.data && err.response.data.message;
        self.error = '对账触发失败：' + (msg || '请稍后重试');
      }).then(function() {
        self.reconcileBusy = false;
      });
    }
  }
};
</script>

<style scoped>
.xy-ov { margin: 0 0 16px; }
.xy-ov-card {
  background: var(--card-bg, rgba(128,128,128,.08));
  border: 1px solid var(--border-color, rgba(128,128,128,.24));
  border-radius: 10px;
  padding: 14px 16px;
}
.xy-ov-head { display: flex; align-items: center; flex-wrap: wrap; }
/* Chrome 80 不支持 flex gap（会静默失效），一律用 margin 控制间距 */
.xy-ov-badge {
  display: inline-block;
  padding: 5px 11px; border-radius: 999px; font-size: 13px; font-weight: 600;
  color: #fff; background: #8a8f98; margin-right: 12px; white-space: nowrap;
}
.xy-ov-badge i { margin-right: 5px; }
.xy-ov-badge.is-ok { background: #2e9e6b; }
.xy-ov-badge.is-attention { background: #d98a20; }
.xy-ov-badge.is-error { background: #d8524a; }
.xy-ov-headtext { flex: 1 1 260px; min-width: 0; }
.xy-ov-title {
  font-size: 15px; font-weight: 600;
  color: var(--text-primary, inherit); line-height: 1.4;
}
.xy-ov-sub {
  font-size: 12px; margin-top: 3px;
  color: var(--text-secondary, rgba(128,128,128,.9)); line-height: 1.4;
}
.xy-ov-actions { display: flex; align-items: center; margin-left: auto; }
.xy-ov-btn {
  border: 0; border-radius: 6px; padding: 7px 12px; margin-left: 8px;
  font-size: 12px; cursor: pointer; background: #3b7ddd; color: #fff;
}
.xy-ov-btn.ghost {
  background: transparent; color: var(--text-primary, inherit);
  border: 1px solid var(--border-color, rgba(128,128,128,.32));
}
.xy-ov-btn:disabled { opacity: .55; cursor: not-allowed; }
.xy-ov-metrics { display: flex; flex-wrap: wrap; margin-top: 14px; }
.xy-ov-metric {
  flex: 1 1 150px; min-width: 130px;
  border-right: 1px solid var(--border-color, rgba(128,128,128,.18));
  padding: 2px 12px; margin-bottom: 8px;
}
.xy-ov-metric:last-child { border-right: 0; }
.xy-ov-metric span {
  display: block; font-size: 12px;
  color: var(--text-secondary, rgba(128,128,128,.9));
}
.xy-ov-metric b {
  display: inline-block; font-size: 19px; margin-top: 3px;
  color: var(--text-primary, inherit); font-variant-numeric: tabular-nums;
}
.xy-ov-metric em { font-size: 11px; font-style: normal; margin-left: 4px; color: var(--text-secondary, rgba(128,128,128,.9)); }
.xy-ov-advice {
  margin-top: 10px; padding: 9px 12px; border-radius: 7px;
  background: rgba(59,125,221,.09); font-size: 12px; line-height: 1.7;
  color: var(--text-primary, inherit);
}
.xy-ov-advice-row + .xy-ov-advice-row { margin-top: 2px; }
.xy-ov-detail {
  margin-top: 12px; padding-top: 12px;
  border-top: 1px solid var(--border-color, rgba(128,128,128,.2));
}
.xy-ov-detail-title {
  font-size: 12px; font-weight: 600; margin-bottom: 8px;
  color: var(--text-secondary, rgba(128,128,128,.9));
}
.xy-ov-layer { display: flex; align-items: center; font-size: 12px; padding: 4px 0; }
.xy-ov-layer b { font-weight: 600; width: 100px; color: var(--text-primary, inherit); }
.xy-ov-layer-note { color: var(--text-secondary, rgba(128,128,128,.9)); }
.xy-ov-dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; background: #8a8f98; }
.xy-ov-dot.is-ok { background: #2e9e6b; }
.xy-ov-dot.is-bad { background: #d8524a; }
.xy-ov-dot.is-unknown { background: #b0b4bb; }
.xy-ov-issues { margin-top: 10px; }
.xy-ov-issue { font-size: 12px; line-height: 1.7; color: var(--text-primary, inherit); }
.xy-ov-issue em {
  font-style: normal; font-size: 11px; padding: 1px 5px; border-radius: 4px;
  background: rgba(216,82,74,.14); color: #d8524a; margin-right: 6px;
}
.xy-ov-alert {
  display: flex; align-items: center; margin-bottom: 10px;
  padding: 9px 12px; border-radius: 7px; font-size: 12px;
  background: rgba(217,138,32,.12); color: #d98a20;
}
.xy-ov-alert span { flex: 1; margin-left: 8px; }
.xy-ov-link { border: 0; background: transparent; color: inherit; text-decoration: underline; cursor: pointer; font-size: 12px; }
.xy-ov-loading { font-size: 13px; padding: 14px 0; color: var(--text-secondary, rgba(128,128,128,.9)); }
@media (max-width: 720px) {
  .xy-ov-actions { margin-left: 0; margin-top: 10px; width: 100%; }
  .xy-ov-btn { margin-left: 0; margin-right: 8px; }
  .xy-ov-metric { flex: 1 1 45%; }
}
</style>
