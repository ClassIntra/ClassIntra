<template>
  <div class="dev-runtime">
    <div class="dr-header">
      <h1>运行时检查器</h1>
      <div class="dr-header-actions">
        <button class="dr-btn" @click="toggleAuto">{{ autoRefresh ? '停止自动刷新' : '自动刷新' }}</button>
        <button class="dr-btn dr-btn-ghost" @click="refresh">立即刷新</button>
      </div>
    </div>

    <p class="dr-intro">
      实时查看内核与生态运行状态：启动阶段、市场应用的生命周期/资源占用、事件总线订阅归属、
      性能档位与服务端健康。排障时打开本页 + 控制台即可定位「哪个应用在泄漏计时器」。
    </p>

    <!-- ============ 启动 ============ -->
    <section class="dr-card">
      <h2>启动（Boot）</h2>
      <div class="dr-kv"><span>当前阶段</span><strong>{{ diag.bootStage || '—' }}</strong></div>
      <div class="dr-bars">
        <div v-for="(ms, stage) in bootDuration" :key="stage" class="dr-bar-row">
          <span class="dr-bar-label">{{ stage }}</span>
          <span class="dr-bar-track"><span class="dr-bar-fill" :style="{ width: barWidth(ms) }"></span></span>
          <span class="dr-bar-value">{{ ms }}ms</span>
        </div>
      </div>
      <div v-if="bootErrors.length" class="dr-warn">
        <div v-for="(e, i) in bootErrors" :key="i" class="dr-error-row">
          ⚠ {{ e.stage }}/{{ e.name }}：{{ e.message || '未知错误' }}
        </div>
      </div>
      <div v-else class="dr-ok">无降级项</div>
    </section>

    <!-- ============ 市场应用运行时 ============ -->
    <section class="dr-card">
      <h2>市场应用运行时</h2>
      <p v-if="!installedApps.length" class="dr-muted">无已安装市场应用</p>
      <div v-else class="dr-table">
        <div class="dr-tr dr-th">
          <span>应用</span><span>状态</span><span>计时器</span><span>监听器</span><span>悬浮层</span><span>版本</span>
        </div>
        <div v-for="app in appRows" :key="app.name" class="dr-tr" :class="{ 'dr-tr-bad': app.bad }">
          <span class="dr-name">{{ app.name }}</span>
          <span><i class="dr-dot" :class="'dr-dot-' + (app.state || 'none')"></i>{{ app.state || '未挂载' }}</span>
          <span :class="{ 'dr-num-bad': app.timers > 20 }">{{ app.timers }}</span>
          <span :class="{ 'dr-num-bad': app.listeners > 20 }">{{ app.listeners }}</span>
          <span>{{ app.overlay ? '有' : '—' }}</span>
          <span>{{ app.version }}</span>
        </div>
      </div>
      <p class="dr-hint">计时器/监听器为审计器实时记录的未回收数量（挂起/卸载时自动回收）；持续增长即泄漏。</p>
    </section>

    <!-- ============ 事件总线订阅归属 ============ -->
    <section class="dr-card">
      <h2>事件总线订阅归属</h2>
      <div v-if="!Object.keys(ownerStats).length" class="dr-muted">当前无带归属的订阅</div>
      <div v-else class="dr-table">
        <div class="dr-tr dr-th"><span>归属</span><span>存活订阅数</span></div>
        <div v-for="(count, owner) in ownerStats" :key="owner" class="dr-tr">
          <span class="dr-name">{{ owner }}</span>
          <span :class="{ 'dr-num-bad': count > 50 }">{{ count }}</span>
        </div>
      </div>
      <p class="dr-hint">market:* 为第三方应用订阅（context 销毁时自动整批退订）；数字持续增大说明应用在重复订阅。</p>
    </section>

    <!-- ============ 资源治理器 ============ -->
    <section class="dr-card">
      <h2>资源治理器</h2>
      <div class="dr-kv">
        <span>阈值（计时器/监听器）</span>
        <strong>{{ gov.thresholds ? (gov.thresholds.timers + ' / ' + gov.thresholds.listeners) : '—' }}</strong>
      </div>
      <div v-if="govActions.length" class="dr-table">
        <div class="dr-tr dr-th"><span>时间</span><span>应用</span><span>动作</span><span>资源</span></div>
        <div v-for="(a, i) in govActions" :key="i" class="dr-tr dr-tr-bad">
          <span>{{ formatTime(a.at) }}</span>
          <span class="dr-name">{{ a.name }}</span>
          <span>挂起</span>
          <span>timers {{ a.timers }} · listeners {{ a.listeners }}</span>
        </div>
      </div>
      <div v-else class="dr-ok">无超阈动作（一切正常）</div>
      <p class="dr-hint">治理器每 30s 巡检一次，未回收资源超阈的应用会被自动挂起并回收计时器（web 平台的资源上限机制）。</p>
    </section>

    <!-- ============ 性能 / 服务端 ============ -->
    <section class="dr-card">
      <h2>性能档位与服务端</h2>
      <div class="dr-kv"><span>本机性能档位</span><strong>{{ perfLevel || '—' }}</strong></div>
      <template v-if="serverHealth">
        <div class="dr-kv"><span>服务端运行</span><strong>{{ serverHealth.process.uptimeSec }}s · RSS {{ serverHealth.process.rssMb }}MB</strong></div>
        <div class="dr-kv"><span>数据库</span><strong>{{ serverHealth.database.sizeMb }}MB · WAL {{ serverHealth.database.walSizeMb }}MB · {{ serverHealth.database.journalMode }}</strong></div>
        <div class="dr-kv"><span>生态模块</span><strong>应用 {{ serverHealth.ecosystem.market.apps }} · 主题 {{ serverHealth.ecosystem.market.themes }} · 插件 {{ serverHealth.ecosystem.market.plugins }}</strong></div>
      </template>
      <p v-else class="dr-muted">{{ serverHealthError || '服务端健康数据加载中…' }}</p>
    </section>
  </div>
</template>

<script>
// 运行时检查器：内核/生态状态的实时可视化（管理员）。
// 数据全部来自现成内核接口（diagnostics / auditor.getStatus / ownerStats），
// 本页零持久化、零上报——纯只读诊断视图。
import { getRuntimeKernel } from '@/core/runtime-kernel';
import { marketRegistry } from '@/core/market-registry';
import { getEventBus } from '@/core/event-bus';
import { getPerfPolicy } from '@/core/perf-policy';
import api from '@/utils/api';

export default {
  name: 'DevRuntime',
  data: function() {
    return {
      autoRefresh: false,
      diag: {},
      bootDuration: {},
      bootErrors: [],
      gov: {},
      govActions: [],
      installedApps: [],
      ownerStats: {},
      perfLevel: '',
      serverHealth: null,
      serverHealthError: '',
      _timer: null,
      _maxStageMs: 1
    };
  },
  computed: {
    appRows: function() {
      var apps = this.diag.apps || {};
      var rows = [];
      this.installedApps.forEach(function(app) {
        var st = apps[app.name] || {};
        var res = st.resources || {};
        rows.push({
          name: app.name,
          version: app.version || '0.0.0',
          overlay: !!app.overlayEntry,
          state: st.state || '',
          timers: res.pendingTimers || 0,
          listeners: res.pendingListeners || 0,
          bad: (res.pendingTimers || 0) > 40 || (res.pendingListeners || 0) > 40
        });
      });
      return rows;
    }
  },
  mounted: function() {
    this.refresh();
    this.loadServerHealth();
  },
  beforeDestroy: function() {
    if (this._timer) clearInterval(this._timer);
  },
  methods: {
    toggleAuto: function() {
      var self = this;
      self.autoRefresh = !self.autoRefresh;
      if (self.autoRefresh) {
        self._timer = setInterval(function() { self.refresh(); }, 2000);
      } else if (self._timer) {
        clearInterval(self._timer);
        self._timer = null;
      }
    },
    refresh: function() {
      try {
        this.diag = getRuntimeKernel().diagnostics();
        this.bootDuration = this.diag.bootDuration || {};
        this.bootErrors = (this.diag.bootErrors || []).map(function(e) {
          return { stage: e.stage, name: e.name, message: e.error && e.error.message };
        });
        this.gov = this.diag.governor || {};
        this.govActions = this.gov.recentActions || [];
        var maxMs = 1;
        var d = this.bootDuration;
        Object.keys(d).forEach(function(k) { if (d[k] > maxMs) maxMs = d[k]; });
        this._maxStageMs = maxMs;
      } catch (e) {}
      try { this.installedApps = marketRegistry.getInstalledApps(); } catch (e) {}
      try {
        var bus = getEventBus();
        this.ownerStats = typeof bus.ownerStats === 'function' ? bus.ownerStats() : {};
      } catch (e) {}
      try { this.perfLevel = String(getPerfPolicy().getLevel()); } catch (e) {}
    },
    loadServerHealth: function() {
      var self = this;
      api.get('/system/runtime-health').then(function(response) {
        self.serverHealth = response.data && response.data.data;
        self.serverHealthError = '';
      }).catch(function(error) {
        self.serverHealth = null;
        var status = error && error.response && error.response.status;
        self.serverHealthError = status === 403 ? '需要管理员身份查看服务端健康' : '服务端健康数据不可用';
      });
    },
    barWidth: function(ms) {
      return Math.max(2, Math.round((ms / this._maxStageMs) * 100)) + '%';
    },
    formatTime: function(at) {
      var d = new Date(at);
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    }
  }
};
</script>

<style scoped>
.dev-runtime { max-width: 760px; margin: 0 auto; padding: 20px 16px 40px; }
.dr-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.dr-header h1 { font-size: 22px; margin: 0; }
.dr-header-actions { display: flex; gap: 8px; }
.dr-btn { padding: 6px 14px; border-radius: 8px; border: 1px solid var(--separator, rgba(0,0,0,0.1)); background: var(--bg-secondary, #f2f2f7); color: var(--text-primary, #000); font-size: 13px; cursor: pointer; }
.dr-btn-ghost { background: transparent; }
.dr-intro { color: var(--text-secondary, #666); font-size: 13px; line-height: 1.6; margin: 0 0 16px; }
.dr-card { background: var(--bg-secondary, #fff); border: 1px solid var(--separator, rgba(0,0,0,0.06)); border-radius: 14px; padding: 14px 16px; margin-bottom: 14px; }
.dr-card h2 { font-size: 15px; margin: 0 0 10px; }
.dr-kv { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; color: var(--text-secondary, #666); }
.dr-kv strong { color: var(--text-primary, #000); font-weight: 600; }
.dr-bars { margin: 6px 0; }
.dr-bar-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.dr-bar-label { width: 84px; font-size: 12px; color: var(--text-secondary, #666); }
.dr-bar-track { flex: 1; height: 8px; border-radius: 4px; background: var(--separator, rgba(0,0,0,0.08)); overflow: hidden; }
.dr-bar-fill { display: block; height: 100%; background: var(--primary-color, #007AFF); border-radius: 4px; }
.dr-bar-value { width: 56px; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-secondary, #666); }
.dr-warn { margin-top: 8px; }
.dr-error-row { font-size: 12px; color: #FF3B30; padding: 3px 0; }
.dr-ok { font-size: 12px; color: #34C759; margin-top: 6px; }
.dr-muted { color: var(--text-tertiary, #999); font-size: 13px; }
.dr-hint { color: var(--text-tertiary, #999); font-size: 11px; line-height: 1.6; margin: 10px 0 0; }
.dr-table { font-size: 13px; }
.dr-tr { display: flex; gap: 6px; padding: 6px 4px; border-bottom: 1px solid var(--separator, rgba(0,0,0,0.05)); align-items: center; }
.dr-tr > span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-th { color: var(--text-tertiary, #999); font-size: 12px; border-bottom: 1px solid var(--separator, rgba(0,0,0,0.1)); }
.dr-name { font-weight: 600; color: var(--text-primary, #000); }
.dr-tr-bad { background: rgba(255, 59, 48, 0.06); border-radius: 8px; }
.dr-num-bad { color: #FF3B30; font-weight: 600; }
.dr-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.dr-dot-active { background: #34C759; }
.dr-dot-suspended { background: #FF9500; }
.dr-dot-error { background: #FF3B30; }
.dr-dot-loading { background: #007AFF; }
.dr-dot-idle, .dr-dot-none { background: var(--text-tertiary, #999); }
</style>
