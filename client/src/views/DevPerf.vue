<template>
  <div class="dev-perf">
    <div class="dp-header">
      <h1>性能诊断</h1>
      <div class="dp-header-actions">
        <button class="dp-btn" @click="toggleRunning">{{ running ? '暂停采样' : '开始采样' }}</button>
        <button class="dp-btn dp-btn-ghost" @click="copyReport">复制报告</button>
      </div>
    </div>

    <p class="dp-intro">
      本页用于在真实设备上定位卡顿来源。采样基于 <code>requestAnimationFrame</code> 与
      Long Task 观察器，全部在本页内进行，不上报任何数据。
    </p>

    <!-- ============ 概览 ============ -->
    <section class="dp-card">
      <h2>概览</h2>
      <div class="dp-grid">
        <div class="dp-stat">
          <span class="dp-stat-value" :class="fpsClass">{{ fps }}</span>
          <span class="dp-stat-label">当前 FPS</span>
        </div>
        <div class="dp-stat">
          <span class="dp-stat-value">{{ fpsMin === null ? '—' : fpsMin }}</span>
          <span class="dp-stat-label">最低 FPS</span>
        </div>
        <div class="dp-stat">
          <span class="dp-stat-value">{{ frameAvg }}</span>
          <span class="dp-stat-label">平均帧时间 (ms)</span>
        </div>
        <div class="dp-stat">
          <span class="dp-stat-value">{{ longTasks.length }}</span>
          <span class="dp-stat-label">长任务次数</span>
        </div>
        <div class="dp-stat">
          <span class="dp-stat-value">{{ longTaskTotal }}</span>
          <span class="dp-stat-label">长任务累计 (ms)</span>
        </div>
        <div class="dp-stat">
          <span class="dp-stat-value">{{ sampleSeconds }}</span>
          <span class="dp-stat-label">已采样 (s)</span>
        </div>
      </div>

      <div class="dp-fps-bar">
        <div
          v-for="(v, i) in fpsHistory"
          :key="i"
          class="dp-fps-tick"
          :style="{ transform: 'scaleY(' + Math.max(0.05, v / 60) + ')', background: tickColor(v) }"
        ></div>
      </div>
      <p class="dp-hint">每格为一次采样（1 秒）；绿 ≥55、黄 ≥40、红 &lt;40。</p>
    </section>

    <!-- ============ 性能策略 ============ -->
    <section class="dp-card">
      <h2>性能策略 <span class="dp-tag">{{ perfStatus.level === 'low' ? '已降级' : '正常' }}</span></h2>
      <dl class="dp-list">
        <dt>降级等级</dt>
        <dd>{{ perfStatus.level }}</dd>
        <dt>判定原因</dt>
        <dd>{{ perfStatus.reasons.length ? perfStatus.reasons.join('、') : '设备能力充足' }}</dd>
        <dt>滚动降级中</dt>
        <dd>{{ perfStatus.scrolling ? '是' : '否' }}</dd>
        <dt>X5 / TBS 内核</dt>
        <dd>{{ perfStatus.x5 ? '是（毛玻璃代价较高）' : '否' }}</dd>
        <dt>data-perf</dt>
        <dd><code>{{ attrPerf || '（未设置）' }}</code></dd>
        <dt>data-scrolling</dt>
        <dd><code>{{ attrScrolling || '（未设置）' }}</code></dd>
        <dt>data-glass</dt>
        <dd><code>{{ attrGlass || '（未设置）' }}</code></dd>
        <dt>data-engine</dt>
        <dd><code>{{ attrEngine || '（未设置）' }}</code></dd>
      </dl>
      <div class="dp-row">
        <button class="dp-btn dp-btn-sm" @click="forceLevel('high')">强制高性能</button>
        <button class="dp-btn dp-btn-sm" @click="forceLevel('low')">强制降级</button>
        <button class="dp-btn dp-btn-sm dp-btn-ghost" @click="forceLevel('auto')">恢复自动</button>
      </div>
    </section>

    <!-- ============ 设备信息 ============ -->
    <section class="dp-card">
      <h2>设备信息</h2>
      <dl class="dp-list">
        <dt>CPU 核心</dt>
        <dd>{{ device.cores === null ? '未知' : device.cores }}</dd>
        <dt>内存 (deviceMemory)</dt>
        <dd>{{ device.memory === null ? '未知' : device.memory + ' GB' }}</dd>
        <dt>设备像素比</dt>
        <dd>{{ device.dpr }}</dd>
        <dt>视口</dt>
        <dd>{{ device.viewport }}</dd>
        <dt>节省数据模式</dt>
        <dd>{{ device.saveData ? '开启' : '关闭' }}</dd>
        <dt>动效开关</dt>
        <dd>{{ attrNoMotion === 'true' ? '已关闭（动画与毛玻璃同时降级）' : '开启' }}</dd>
        <dt>User Agent</dt>
        <dd class="dp-ua">{{ device.ua }}</dd>
      </dl>
    </section>

    <!-- ============ 令牌注入打点 ============ -->
    <section class="dp-card">
      <h2>令牌注入 <span class="dp-tag">{{ tokenCheck.ok ? '一致' : '异常' }}</span></h2>
      <p class="dp-hint">
        抽查关键令牌的实际计算值。若某行为「未注入」或与预期不符，说明
        <code>token-injector.js</code> 白名单或主题定义有缺漏。
      </p>
      <table class="dp-table">
        <thead>
          <tr><th>令牌</th><th>实际值</th><th>判定</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in tokenCheck.rows" :key="t.name">
            <td><code>{{ t.name }}</code></td>
            <td><code>{{ t.value || '（未注入）' }}</code></td>
            <td>
              <span :class="t.value ? 'dp-ok' : 'dp-bad'">{{ t.value ? '已注入' : '缺失' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ============ 毛玻璃统计 ============ -->
    <section class="dp-card">
      <h2>毛玻璃扫描</h2>
      <p class="dp-hint">
        统计当前 DOM 中处于可见状态、且实际应用了 <code>backdrop-filter</code> 的元素数量。
        数量过多是低端设备掉帧的常见原因。
      </p>
      <div class="dp-row dp-row-tight">
        <div class="dp-stat dp-stat-sm">
          <span class="dp-stat-value">{{ glass.count }}</span>
          <span class="dp-stat-label">含 backdrop-filter 的元素</span>
        </div>
        <div class="dp-stat dp-stat-sm">
          <span class="dp-stat-value">{{ glass.visible }}</span>
          <span class="dp-stat-label">其中可见</span>
        </div>
        <div class="dp-stat dp-stat-sm">
          <span class="dp-stat-value">{{ glass.blurMax || '—' }}</span>
          <span class="dp-stat-label">最大 blur 半径</span>
        </div>
      </div>
      <div class="dp-row">
        <button class="dp-btn dp-btn-sm" @click="scanGlass">重新扫描</button>
        <label class="dp-inline-check">
          <input type="checkbox" v-model="highlightGlass" @change="applyHighlight" />
          高亮可见毛玻璃元素
        </label>
      </div>
      <p v-if="glass.sample.length" class="dp-hint">
        样本（前 {{ glass.sample.length }} 个）：
        <code v-for="(s, i) in glass.sample" :key="i" class="dp-chip">{{ s }}</code>
      </p>
    </section>

    <!-- ============ 长任务明细 ============ -->
    <section class="dp-card">
      <h2>长任务明细</h2>
      <p class="dp-hint">
        长任务 = 阻塞主线程超过 50ms 的任务。它们是「点了没反应」的直接原因。
        需要 Chrome 58+（<code>PerformanceObserver</code> + <code>longtask</code>）。
      </p>
      <p v-if="!longTaskSupported" class="dp-warn">
        当前内核不支持 Long Task 观察器，此区块无数据。
      </p>
      <table v-else class="dp-table">
        <thead>
          <tr><th>#</th><th>开始 (s)</th><th>时长 (ms)</th><th>归因</th></tr>
        </thead>
        <tbody>
          <tr v-for="(t, i) in longTasks" :key="i">
            <td>{{ i + 1 }}</td>
            <td>{{ (t.start / 1000).toFixed(2) }}</td>
            <td :class="t.duration > 200 ? 'dp-bad' : ''">{{ Math.round(t.duration) }}</td>
            <td><code>{{ t.attr }}</code></td>
          </tr>
          <tr v-if="!longTasks.length">
            <td colspan="4" class="dp-empty">暂无长任务。滚动页面或切换应用以产生负载。</td>
          </tr>
        </tbody>
      </table>
      <div v-if="longTasks.length" class="dp-row">
        <button class="dp-btn dp-btn-sm dp-btn-ghost" @click="longTasks = []">清空</button>
      </div>
    </section>

    <!-- ============ 已加载模块 ============ -->
    <section class="dp-card">
      <h2>运行时</h2>
      <dl class="dp-list">
        <dt>已注册应用数</dt>
        <dd>{{ runtime.appCount }}</dd>
        <dt>已加载市场应用</dt>
        <dd>{{ runtime.marketCount }}</dd>
        <dt>DOM 节点总数</dt>
        <dd>
          {{ runtime.domNodes }}
          <span v-if="runtime.domNodes > 3000" class="dp-warn-inline">（偏多，建议检查是否有应用未回收）</span>
        </dd>
        <dt>活跃计时器（估算）</dt>
        <dd>{{ runtime.timers }}</dd>
      </dl>
      <div class="dp-row">
        <button class="dp-btn dp-btn-sm" @click="refreshRuntime">重新统计</button>
        <button class="dp-btn dp-btn-sm dp-btn-ghost" @click="auditLeaks">执行回收审计</button>
      </div>
      <p v-if="runtime.audit" class="dp-hint">{{ runtime.audit }}</p>
    </section>
  </div>
</template>

<script>
import { getPerfPolicy } from '@/core/perf-policy';
import { getServiceRegistry } from '@/core/service-registry';

/* 令牌抽查清单：覆盖颜色 / 圆角 / 动效三类，验证三处同步是否完整 */
var TOKEN_PROBE = [
  '--ci-color-primary',
  '--ci-color-bg-elevated',
  '--ci-shape-sm',
  '--ci-shape-lg',
  '--ci-shape-pill',
  '--ci-motion-spring-snappy',
  '--ci-motion-spring-bouncy',
  '--ci-motion-spring-smooth',
  '--ci-motion-spring-interactive',
  '--ci-motion-duration-stagger'
];

export default {
  name: 'DevPerf',

  data: function () {
    return {
      running: true,
      fps: 0,
      fpsMin: null,
      fpsHistory: [],
      frameTimes: [],
      frames: 0,
      sampleStart: 0,
      sampleSeconds: 0,

      longTasks: [],
      longTaskSupported: typeof window !== 'undefined' &&
        typeof window.PerformanceObserver === 'function',

      perfStatus: { level: 'high', reasons: [], scrolling: false, x5: false },

      attrPerf: '',
      attrScrolling: '',
      attrGlass: '',
      attrEngine: '',
      attrNoMotion: '',

      device: {
        cores: null,
        memory: null,
        dpr: 1,
        viewport: '',
        saveData: false,
        ua: ''
      },

      tokenCheck: { ok: true, rows: [] },
      glass: { count: 0, visible: 0, blurMax: 0, sample: [] },
      highlightGlass: false,
      highlightedEls: [],

      runtime: { appCount: 0, marketCount: 0, domNodes: 0, timers: 0, audit: '' },

      /* 内部句柄 */
      _rafId: null,
      _secondTimer: null,
      _fpsWindow: [],
      _observer: null
    };
  },

  computed: {
    frameAvg: function () {
      if (!this.frameTimes.length) return '—';
      var sum = 0;
      for (var i = 0; i < this.frameTimes.length; i++) sum += this.frameTimes[i];
      return (sum / this.frameTimes.length).toFixed(1);
    },
    longTaskTotal: function () {
      var sum = 0;
      for (var i = 0; i < this.longTasks.length; i++) sum += this.longTasks[i].duration;
      return Math.round(sum);
    },
    fpsClass: function () {
      if (this.fps >= 55) return 'dp-good';
      if (this.fps >= 40) return 'dp-mid';
      return 'dp-bad';
    }
  },

  mounted: function () {
    this.readAttrs();
    this.readDevice();
    this.checkTokens();
    this.refreshRuntime();
    this.scanGlass();
    this.startSampling();
    this.attachLongTaskObserver();

    /* 属性由 PerfPolicy 在 documentElement 上驱动，轮询读取即可 */
    var self = this;
    this._attrTimer = setInterval(function () {
      self.readAttrs();
      self.perfStatus = getPerfPolicy().getStatus();
    }, 500);
  },

  beforeDestroy: function () {
    this.stopSampling();
    if (this._observer) {
      try { this._observer.disconnect(); } catch (e) {}
      this._observer = null;
    }
    if (this._attrTimer) clearInterval(this._attrTimer);
    if (this._secondTimer) clearInterval(this._secondTimer);
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.removeHighlight();
  },

  methods: {
    /* ---------- 帧率采样 ---------- */
    startSampling: function () {
      this.running = true;
      this.frames = 0;
      this.frameTimes = [];
      this.fpsHistory = [];
      this.sampleStart = Date.now();
      this.sampleSeconds = 0;

      var self = this;
      var last = performance.now();

      function tick(now) {
        var delta = now - last;
        last = now;
        self.frames += 1;
        self.frameTimes.push(delta);
        if (self.frameTimes.length > 300) self.frameTimes.shift();
        self._rafId = requestAnimationFrame(tick);
      }
      this._rafId = requestAnimationFrame(tick);

      /* 每秒结算一次 FPS */
      this._secondTimer = setInterval(function () {
        var f = self.frames;
        self.frames = 0;
        self.fps = Math.min(60, f);
        self.fpsHistory.push(self.fps);
        if (self.fpsHistory.length > 60) self.fpsHistory.shift();
        if (self.fpsMin === null || self.fps < self.fpsMin) self.fpsMin = self.fps;
        self.sampleSeconds = Math.round((Date.now() - self.sampleStart) / 1000);
      }, 1000);
    },

    stopSampling: function () {
      this.running = false;
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._rafId = null;
      if (this._secondTimer) clearInterval(this._secondTimer);
      this._secondTimer = null;
    },

    toggleRunning: function () {
      if (this.running) this.stopSampling();
      else this.startSampling();
    },

    tickColor: function (v) {
      if (v >= 55) return '#34C759';
      if (v >= 40) return '#FF9500';
      return '#FF3B30';
    },

    /* ---------- 长任务 ---------- */
    attachLongTaskObserver: function () {
      if (!this.longTaskSupported) return;
      var self = this;
      try {
        this._observer = new PerformanceObserver(function (list) {
          var entries = list.getEntries();
          for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            self.longTasks.push({
              start: e.startTime,
              duration: e.duration,
              attr: self.attribute(e)
            });
            if (self.longTasks.length > 50) self.longTasks.shift();
          }
        });
        this._observer.observe({ entryTypes: ['longtask'] });
      } catch (e) {
        this.longTaskSupported = false;
      }
    },

    /* 尝试把长任务归因到具体容器或应用 */
    attribute: function (entry) {
      try {
        if (entry.attribution && entry.attribution.length) {
          var a = entry.attribution[0];
          var parts = [];
          if (a.name) parts.push(a.name);
          if (a.containerType) parts.push(a.containerType);
          if (a.containerSrc) parts.push(a.containerSrc.split('/').pop());
          if (parts.length) return parts.join(' / ');
        }
      } catch (e) {}
      return '（未归因）';
    },

    /* ---------- 属性读取 ---------- */
    readAttrs: function () {
      var root = document.documentElement;
      this.attrPerf = root.getAttribute('data-perf') || '';
      this.attrScrolling = root.getAttribute('data-scrolling') || '';
      this.attrGlass = root.getAttribute('data-glass') || '';
      this.attrEngine = root.getAttribute('data-engine') || '';
      this.attrNoMotion = root.getAttribute('data-no-motion') || '';
    },

    readDevice: function () {
      var nav = navigator || {};
      this.device.cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null;
      this.device.memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
      this.device.dpr = window.devicePixelRatio || 1;
      this.device.viewport = window.innerWidth + ' × ' + window.innerHeight;
      this.device.saveData = !!(nav.connection && nav.connection.saveData);
      this.device.ua = nav.userAgent || '';
      this.perfStatus = getPerfPolicy().getStatus();
    },

    /* ---------- 令牌抽查 ---------- */
    checkTokens: function () {
      var cs = getComputedStyle(document.documentElement);
      var rows = [];
      var ok = true;
      for (var i = 0; i < TOKEN_PROBE.length; i++) {
        var name = TOKEN_PROBE[i];
        var value = cs.getPropertyValue(name).trim();
        if (!value) ok = false;
        rows.push({ name: name, value: value });
      }
      this.tokenCheck = { ok: ok, rows: rows };
    },

    /* ---------- 毛玻璃扫描 ---------- */
    scanGlass: function () {
      var all = document.querySelectorAll('*');
      var count = 0;
      var visible = 0;
      var blurMax = 0;
      var sample = [];

      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var cs = getComputedStyle(el);
        var bf = cs.backdropFilter || cs.webkitBackdropFilter || '';
        if (!bf || bf === 'none') continue;
        count += 1;

        var m = /blur\(\s*([0-9.]+)px/.exec(bf);
        if (m) {
          var b = parseFloat(m[1]);
          if (b > blurMax) blurMax = b;
        }

        var rect = el.getBoundingClientRect();
        var isVisible = rect.width > 0 && rect.height > 0 &&
          cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
        if (isVisible) {
          visible += 1;
          if (sample.length < 6) {
            sample.push(el.className ? '.' + String(el.className).split(' ')[0] : el.tagName.toLowerCase());
          }
        }
      }

      this.glass = {
        count: count,
        visible: visible,
        blurMax: blurMax,
        sample: sample
      };
    },

    applyHighlight: function () {
      this.removeHighlight();
      if (!this.highlightGlass) return;

      var all = document.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var cs = getComputedStyle(el);
        var bf = cs.backdropFilter || cs.webkitBackdropFilter || '';
        if (!bf || bf === 'none') continue;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        el.style.outline = '2px solid #FF3B30';
        el.style.outlineOffset = '-2px';
        this.highlightedEls.push(el);
      }
    },

    removeHighlight: function () {
      for (var i = 0; i < this.highlightedEls.length; i++) {
        try {
          this.highlightedEls[i].style.outline = '';
          this.highlightedEls[i].style.outlineOffset = '';
        } catch (e) {}
      }
      this.highlightedEls = [];
    },

    /* ---------- 运行时 ---------- */
    refreshRuntime: function () {
      var appCount = 0;
      var marketCount = 0;
      try {
        var registry = getServiceRegistry();
        var loader = registry.resolve('manifestLoader');
        if (loader && typeof loader.loadManifests === 'function') {
          var list = loader.loadManifests();
          appCount = list.length;
          for (var i = 0; i < list.length; i++) {
            if (list[i]._sourceType === 'market') marketCount += 1;
          }
        }
      } catch (e) {}

      /* 计数：全局 setTimeout / setInterval 的活跃句柄无法直接枚举，
         这里给出的是「本页可统计到的」近似值 */
      var timers = 0;
      try {
        if (window.__ciTimerCount) timers = window.__ciTimerCount;
      } catch (e) {}

      this.runtime = {
        appCount: appCount,
        marketCount: marketCount,
        domNodes: document.getElementsByTagName('*').length,
        timers: timers,
        audit: this.runtime.audit
      };
    },

    auditLeaks: function () {
      /* 粗粒度回收审计：与卸载前快照对比需要入口配合，
         此处给出当前时刻的可观测异常项 */
      var notes = [];
      var nodes = document.getElementsByTagName('*').length;
      if (nodes > 3000) notes.push('DOM 节点 ' + nodes + ' 个，偏多');

      var glassN = this.glass.visible;
      if (glassN > 20) notes.push('可见毛玻璃 ' + glassN + ' 个，低端设备可能掉帧');

      var unattributed = 0;
      for (var i = 0; i < this.longTasks.length; i++) {
        if (this.longTasks[i].attr === '（未归因）') unattributed += 1;
      }
      if (unattributed > 3) notes.push('长任务 ' + unattributed + ' 次未能归因，可能来自无标记的第三方代码');

      this.runtime.audit = notes.length
        ? '审计提示：' + notes.join('；')
        : '审计通过：未发现明显异常。';
      this.runtime = Object.assign({}, this.runtime);
    },

    /* ---------- 强制等级 ---------- */
    forceLevel: function (mode) {
      var policy = getPerfPolicy();
      if (mode === 'auto') {
        policy.destroy();
        policy.init();
      } else {
        policy.setLevel(mode);
      }
      this.readAttrs();
      this.perfStatus = policy.getStatus();
    },

    /* ---------- 导出 ---------- */
    copyReport: function () {
      var lines = [];
      lines.push('=== ClassIntra 性能诊断报告 ===');
      lines.push('时间: ' + new Date().toLocaleString());
      lines.push('');
      lines.push('[帧率]');
      lines.push('当前 FPS: ' + this.fps);
      lines.push('最低 FPS: ' + (this.fpsMin === null ? '—' : this.fpsMin));
      lines.push('平均帧时间: ' + this.frameAvg + ' ms');
      lines.push('已采样: ' + this.sampleSeconds + ' s');
      lines.push('FPS 历史: ' + this.fpsHistory.join(', '));
      lines.push('');
      lines.push('[性能策略]');
      lines.push('等级: ' + this.perfStatus.level);
      lines.push('原因: ' + (this.perfStatus.reasons.join('、') || '无'));
      lines.push('X5/TBS: ' + (this.perfStatus.x5 ? '是' : '否'));
      lines.push('data-perf=' + (this.attrPerf || '-') +
        ' data-scrolling=' + (this.attrScrolling || '-') +
        ' data-glass=' + (this.attrGlass || '-') +
        ' data-engine=' + (this.attrEngine || '-'));
      lines.push('');
      lines.push('[设备]');
      lines.push('核心数: ' + (this.device.cores === null ? '未知' : this.device.cores));
      lines.push('内存: ' + (this.device.memory === null ? '未知' : this.device.memory + 'GB'));
      lines.push('DPR: ' + this.device.dpr);
      lines.push('视口: ' + this.device.viewport);
      lines.push('UA: ' + this.device.ua);
      lines.push('');
      lines.push('[令牌注入]');
      for (var i = 0; i < this.tokenCheck.rows.length; i++) {
        var r = this.tokenCheck.rows[i];
        lines.push('  ' + r.name + ' = ' + (r.value || '（未注入）'));
      }
      lines.push('');
      lines.push('[毛玻璃]');
      lines.push('含 backdrop-filter: ' + this.glass.count + ' 个');
      lines.push('其中可见: ' + this.glass.visible + ' 个');
      lines.push('最大 blur: ' + this.glass.blurMax + 'px');
      lines.push('');
      lines.push('[长任务] ' + this.longTasks.length + ' 次，累计 ' + this.longTaskTotal + ' ms');
      for (var j = 0; j < Math.min(this.longTasks.length, 20); j++) {
        var t = this.longTasks[j];
        lines.push('  #' + (j + 1) + ' ' + Math.round(t.duration) + 'ms @' +
          (t.start / 1000).toFixed(2) + 's  ' + t.attr);
      }
      lines.push('');
      lines.push('[运行时]');
      lines.push('应用数: ' + this.runtime.appCount + '（市场 ' + this.runtime.marketCount + '）');
      lines.push('DOM 节点: ' + this.runtime.domNodes);

      var text = lines.join('\n');

      var self = this;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          window.alert('报告已复制到剪贴板');
        }).catch(function () {
          self.fallbackCopy(text);
        });
      } else {
        this.fallbackCopy(text);
      }
    },

    fallbackCopy: function (text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); window.alert('报告已复制到剪贴板'); }
      catch (e) { window.alert('复制失败，请手动从控制台取用'); console.log(text); }
      document.body.removeChild(ta);
    }
  }
};
</script>

<style scoped>
.dev-perf {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
  color: var(--ci-color-text-primary, #000000);
}

.dp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.dp-header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.dp-header-actions { display: flex; align-items: center; }
.dp-header-actions > *:not(:last-child) { margin-right: 8px; }

.dp-intro {
  margin: 0 0 20px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ci-color-text-secondary, #6B7280);
}

.dp-intro code { font-size: 12px; }

.dp-card {
  background: var(--ci-color-bg-elevated, #FFFFFF);
  border-radius: var(--ci-shape-lg, 16px);
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.dp-card h2 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
}

.dp-tag {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--ci-shape-pill, 9999px);
  background: var(--ci-color-bg-subtle, #F3F4F6);
  color: var(--ci-color-text-secondary, #6B7280);
}

.dp-grid {
  display: flex;
  flex-wrap: wrap;
}

.dp-stat {
  flex: 0 0 30%;
  box-sizing: border-box;
  padding: 12px 8px;
  text-align: center;
}

.dp-stat-sm { flex: 0 0 33.333%; }

.dp-stat-value {
  display: block;
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.dp-stat-label {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--ci-color-text-secondary, #6B7280);
}

.dp-good { color: #34C759; }
.dp-mid { color: #FF9500; }
.dp-bad { color: #FF3B30; }

.dp-fps-bar {
  display: flex;
  align-items: flex-end;
  height: 44px;
  margin-top: 16px;
  padding: 0 2px;
  border-radius: var(--ci-shape-sm, 8px);
  background: var(--ci-color-bg-subtle, #F3F4F6);
  overflow: hidden;
}

/* 柱高用 transform: scaleY 而非 height —— 避免每帧触发布局回流。
   底部对齐：transform-origin: bottom；柱体固定 40px 高，缩放比例即百分比。 */
.dp-fps-tick {
  flex: 1 1 0;
  min-width: 1px;
  height: 100%;
  margin-right: 1px;
  border-radius: var(--ci-shape-xs, 4px);
  transform-origin: bottom center;
  transition: transform var(--ci-motion-duration-normal) var(--ci-motion-spring-smooth);
}

.dp-fps-tick:last-child { margin-right: 0; }

.dp-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ci-color-text-tertiary, #9CA3AF);
}

.dp-warn {
  margin: 0;
  font-size: 13px;
  color: #FF9500;
}

.dp-warn-inline {
  font-size: 12px;
  color: #FF9500;
}

.dp-list {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
}

.dp-list dt {
  flex: 0 0 160px;
  box-sizing: border-box;
  padding: 6px 0;
  font-size: 13px;
  color: var(--ci-color-text-secondary, #6B7280);
}

.dp-list dd {
  flex: 1 1 0;
  min-width: 0;
  margin: 0;
  padding: 6px 0;
  font-size: 13px;
  word-break: break-all;
}

.dp-ua { font-size: 11px; line-height: 1.5; color: var(--ci-color-text-tertiary, #9CA3AF); }

.dp-row { display: flex; flex-wrap: wrap; align-items: center; margin-top: 12px; }
.dp-row > *:not(:last-child) { margin-right: 8px; }
.dp-row-tight { margin-top: 0; }

.dp-inline-check {
  display: flex;
  align-items: center;
  font-size: 13px;
  cursor: pointer;
}

.dp-inline-check input { margin-right: 6px; }

.dp-btn {
  padding: 8px 16px;
  border: none;
  border-radius: var(--ci-shape-pill, 9999px);
  background: var(--ci-color-primary, #007AFF);
  color: #FFFFFF;
  font-size: 13px;
  cursor: pointer;
  transition: transform var(--ci-motion-duration-fast) var(--ci-motion-spring-interactive);
}

.dp-btn:active { transform: scale(0.96); }

.dp-btn-sm { padding: 6px 14px; font-size: 12px; }

.dp-btn-ghost {
  background: var(--ci-color-bg-subtle, #F3F4F6);
  color: var(--ci-color-text-primary, #000000);
}

.dp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.dp-table th {
  text-align: left;
  padding: 8px 6px;
  font-weight: 600;
  color: var(--ci-color-text-secondary, #6B7280);
  border-bottom: 1px solid var(--ci-color-border, rgba(0, 0, 0, 0.08));
}

.dp-table td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--ci-color-border, rgba(0, 0, 0, 0.05));
  word-break: break-all;
}

.dp-empty {
  text-align: center;
  color: var(--ci-color-text-tertiary, #9CA3AF);
  padding: 20px 0;
}

.dp-ok { color: #34C759; }
.dp-bad { color: #FF3B30; }

.dp-chip {
  display: inline-block;
  margin: 2px 4px 2px 0;
  padding: 2px 6px;
  border-radius: var(--ci-shape-xs, 4px);
  background: var(--ci-color-bg-subtle, #F3F4F6);
  font-size: 11px;
}
</style>
