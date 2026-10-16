<template>
  <div class="ai-pricing-panel">
    <!-- 试算器 -->
    <div class="app-card">
      <div class="app-card-head">
        <h3 class="app-card-title"><i class="fa-solid fa-calculator"></i> 价格试算</h3>
        <span class="app-card-sub">选模型与时刻，看命中哪条规则、单价多少</span>
      </div>

      <div class="appp-row">
        <label class="appp-field">
          <span class="appp-label">模型</span>
          <select class="appp-input" v-model="previewModel">
            <option value="">请选择模型</option>
            <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}（{{ m.id }}）</option>
          </select>
        </label>
        <label class="appp-field">
          <span class="appp-label">日期</span>
          <input class="appp-input" type="date" v-model="previewDate" />
        </label>
        <label class="appp-field">
          <span class="appp-label">时刻</span>
          <input class="appp-input" type="time" v-model="previewTime" />
        </label>
      </div>

      <div class="appp-row">
        <label class="appp-field">
          <span class="appp-label">输入 tokens</span>
          <input class="appp-input" type="number" min="0" v-model.number="sample.prompt" />
        </label>
        <label class="appp-field">
          <span class="appp-label">输出 tokens</span>
          <input class="appp-input" type="number" min="0" v-model.number="sample.completion" />
        </label>
        <label class="appp-field">
          <span class="appp-label">其中缓存命中 tokens</span>
          <input class="appp-input" type="number" min="0" v-model.number="sample.cacheHit" />
        </label>
      </div>

      <div class="appp-row appp-row--tz">
        <span class="appp-label">时段时区</span>
        <div class="appp-chips">
          <button
            v-for="t in tzPresets"
            :key="t.value"
            class="appp-chip"
            :class="{ active: tzOffset === t.value }"
            @click="setTz(t.value)"
          >{{ t.label }}</button>
        </div>
        <span class="appp-hint">峰谷价按厂商时区算（DeepSeek 闲时用 UTC）</span>
      </div>

      <div class="appp-row">
        <button class="appp-btn appp-btn--primary" :disabled="previewing || !previewModel" @click="runPreview">
          <i class="fa-solid fa-play"></i> 试算
        </button>
      </div>

      <div v-if="previewError" class="appp-error">{{ previewError }}</div>

      <div v-if="preview" class="appp-result">
        <div class="appp-result-line">
          <span class="appp-badge" :class="currentBadgeClass">{{ currentRuleText }}</span>
          <span class="appp-money">{{ fmtYuan(preview.current.cost_micro) }}</span>
          <span class="appp-dim">该次示例调用</span>
        </div>
        <div class="appp-result-detail">
          输入 {{ fmtPrice(preview.current.price_in) }} ·
          输出 {{ fmtPrice(preview.current.price_out) }} ·
          缓存命中 {{ fmtPrice(preview.current.price_cache_hit) }}
          <span class="appp-dim">（元 / 百万 token）</span>
        </div>
        <div class="appp-result-detail">
          基准价：输入 {{ fmtPrice(preview.base.price_in) }} · 输出 {{ fmtPrice(preview.base.price_out) }}
          <span v-if="preview.model_is_free" class="appp-badge appp-badge--free">模型标记免费</span>
        </div>

        <div class="appp-curve">
          <div class="appp-curve-head">
            <span>当天 24 小时价格曲线（{{ tzLabel }}）</span>
            <span class="appp-legend">
              <i class="appp-dot appp-dot--base"></i>基准价
              <i class="appp-dot appp-dot--rule"></i>规则价
              <i class="appp-dot appp-dot--free"></i>免费
            </span>
          </div>
          <div class="appp-bars">
            <div
              v-for="h in preview.hours"
              :key="h.hour"
              class="appp-bar-wrap"
              :title="h.hour + ':00 ' + (h.free ? '免费' : (h.is_base ? '基准价 ' : h.rule_label + ' ') + fmtYuan(h.cost_micro))"
            >
              <div
                class="appp-bar"
                :class="h.free ? 'appp-bar--free' : (h.is_base ? 'appp-bar--base' : 'appp-bar--rule')"
                :style="{ height: barHeight(h.cost_micro) }"
              ></div>
              <span class="appp-bar-label" v-if="h.hour % 6 === 0">{{ h.hour }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 规则列表 -->
    <div class="app-card">
      <div class="app-card-head">
        <h3 class="app-card-title"><i class="fa-solid fa-tags"></i> 价格规则</h3>
        <span class="app-card-sub">{{ rules.length }} 条 · 命中中 {{ matchedCount }} 条</span>
        <button class="appp-btn" @click="startAdd"><i class="fa-solid fa-plus"></i> 新建规则</button>
      </div>

      <div v-if="rulesLoading" class="appp-dim">加载中…</div>
      <div v-else-if="!rules.length" class="appp-empty">
        还没有规则。基准价在各模型的编辑面板里配置；这里放峰谷价、限时折扣与限免。
      </div>
      <div v-else class="appp-list">
        <div v-for="r in rules" :key="r.id" class="appp-item" :class="{ 'is-off': !r.enabled }">
          <div class="appp-item-main">
            <span class="appp-item-name">{{ r.label }}</span>
            <span class="appp-badge" :class="kindClass(r.kind)">{{ kindText(r.kind) }}</span>
            <span class="appp-badge appp-badge--ghost">{{ r.model_id ? modelLabel(r.model_id) : '全部模型' }}</span>
            <span v-if="r.matched_now" class="appp-badge appp-badge--on">此刻命中</span>
            <span v-if="!r.enabled" class="appp-badge appp-badge--off">已停用</span>
          </div>
          <div class="appp-item-meta">
            <span class="appp-dim">{{ priceText(r) }}</span>
            <span class="appp-dim">· {{ timeText(r) }}</span>
            <span v-if="dateRangeText(r)" class="appp-dim">· {{ dateRangeText(r) }}</span>
            <span class="appp-dim">· 优先级 {{ r.priority }}</span>
            <span v-if="r.note" class="appp-dim">· {{ r.note }}</span>
          </div>
          <div class="appp-item-actions">
            <button class="appp-icon" :title="r.enabled ? '停用' : '启用'" @click="toggleRule(r)">
              <i :class="r.enabled ? 'fa-solid fa-toggle-on' : 'fa-solid fa-toggle-off'"></i>
            </button>
            <button class="appp-icon" title="编辑" @click="startEdit(r)"><i class="fa-solid fa-pen"></i></button>
            <button
              class="appp-icon appp-icon--danger"
              :title="confirmingDelete === r.id ? '再次点击确认删除' : '删除'"
              @click="removeRule(r)"
            ><i class="fa-solid fa-trash"></i></button>
            <span v-if="confirmingDelete === r.id" class="appp-confirm-text">确认删除?</span>
          </div>
        </div>
      </div>

      <!-- 编辑表单 -->
      <div v-if="editing" class="appp-form">
        <h4 class="appp-form-title">{{ editing === 'new' ? '新建价格规则' : '编辑：' + form.label }}</h4>

        <div class="appp-row">
          <label class="appp-field">
            <span class="appp-label">规则名称 <b class="appp-req">*</b></span>
            <input class="appp-input" v-model="form.label" maxlength="30" placeholder="如：闲时价 / 双十一五折 / 限免" />
          </label>
          <label class="appp-field">
            <span class="appp-label">适用模型</span>
            <select class="appp-input" v-model="form.model_id">
              <option value="">全部模型（全局）</option>
              <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}（{{ m.id }}）</option>
            </select>
          </label>
          <label class="appp-field">
            <span class="appp-label">计价方式</span>
            <select class="appp-input" v-model="form.kind">
              <option value="price">绝对单价（峰谷价 / 改价）</option>
              <option value="discount">按基准价打折</option>
              <option value="free">限免（记 0 成本）</option>
            </select>
          </label>
        </div>

        <div v-if="form.kind === 'price'" class="appp-row">
          <label class="appp-field">
            <span class="appp-label">输入价（元/百万 token）</span>
            <input class="appp-input" type="number" step="0.01" min="0" v-model.number="form.price_in" />
          </label>
          <label class="appp-field">
            <span class="appp-label">输出价（元/百万 token）</span>
            <input class="appp-input" type="number" step="0.01" min="0" v-model.number="form.price_out" />
          </label>
          <label class="appp-field">
            <span class="appp-label">缓存命中价（元/百万 token）</span>
            <input class="appp-input" type="number" step="0.01" min="0" v-model.number="form.price_cache_hit" />
          </label>
        </div>
        <div v-else-if="form.kind === 'discount'" class="appp-row">
          <label class="appp-field">
            <span class="appp-label">折扣（占基准价百分比，50 = 五折）</span>
            <input class="appp-input" type="number" min="0" max="1000" v-model.number="form.discount_percent" />
          </label>
        </div>
        <div v-else class="appp-note">
          该规则命中时计 0 成本，token 仍照记 —— 用于限时免费/活动赠送，事后看用量不受影响。
        </div>

        <div class="appp-row appp-row--days">
          <span class="appp-label">生效星期</span>
          <div class="appp-chips">
            <button
              v-for="d in dayOptions"
              :key="d.value"
              class="appp-chip"
              :class="{ active: form.days.indexOf(d.value) >= 0 }"
              @click="toggleDay(d.value)"
            >{{ d.label }}</button>
            <button class="appp-chip" :class="{ active: form.days_of_week === '*' }" @click="form.days = []; form.days_of_week = '*'">不限</button>
          </div>
        </div>

        <div class="appp-row">
          <label class="appp-field">
            <span class="appp-label">时段起（HH:MM）</span>
            <input class="appp-input" type="time" v-model="form.start_time" />
          </label>
          <label class="appp-field">
            <span class="appp-label">时段止（HH:MM）</span>
            <input class="appp-input" type="time" v-model="form.end_time" />
          </label>
          <label class="appp-field">
            <span class="appp-label">时区</span>
            <select class="appp-input" v-model.number="form.timezone_offset">
              <option v-for="t in tzPresets" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </label>
        </div>
        <div class="appp-note">起 &gt; 止 视为跨零点（如 16:30 → 00:30）；两端留空 = 全天。</div>

        <div class="appp-row">
          <label class="appp-field">
            <span class="appp-label">生效开始日期（留空 = 不限）</span>
            <input class="appp-input" type="date" v-model="form.valid_from" />
          </label>
          <label class="appp-field">
            <span class="appp-label">生效结束日期（留空 = 不限）</span>
            <input class="appp-input" type="date" v-model="form.valid_until" />
          </label>
          <label class="appp-field">
            <span class="appp-label">优先级（小者优先）</span>
            <input class="appp-input" type="number" min="0" max="9999" v-model.number="form.priority" />
          </label>
        </div>

        <div class="appp-row">
          <label class="appp-field appp-field--wide">
            <span class="appp-label">备注</span>
            <input class="appp-input" v-model="form.note" maxlength="200" placeholder="如：DeepSeek 官方闲时价，UTC 16:30 起" />
          </label>
          <label class="appp-toggle">
            <input type="checkbox" v-model="form.enabled" />
            <span>启用</span>
          </label>
        </div>

        <div v-if="formError" class="appp-error">{{ formError }}</div>

        <div class="appp-form-actions">
          <button class="appp-btn" @click="editing = null">取消</button>
          <button class="appp-btn appp-btn--primary" :disabled="saving" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

function toYuan(micro) {
  var yuan = (micro || 0) / 1000000;
  if (yuan === 0) return '¥0';
  if (yuan >= 1) return '¥' + yuan.toFixed(2);
  if (yuan >= 0.01) return '¥' + yuan.toFixed(4);
  return '¥' + yuan.toFixed(6);
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function localToday() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function localNow() {
  var d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export default {
  name: 'AiPricingPanel',
  props: {
    config: { type: Object, default: function() { return {}; } },
    refreshKey: { type: Number, default: 0 }
  },
  data: function() {
    return {
      rules: [],
      rulesLoading: true,
      models: [],
      editing: null,
      saving: false,
      formError: '',
      confirmingDelete: '',
      _confirmTimer: null,
      form: this.blankForm(),
      tzPresets: [
        { label: 'UTC', value: 0 },
        { label: 'UTC+8（北京）', value: 480 },
        { label: 'UTC+9（东京）', value: 540 },
        { label: 'UTC-8（美西）', value: -480 }
      ],
      dayOptions: [
        { label: '一', value: 1 }, { label: '二', value: 2 }, { label: '三', value: 3 },
        { label: '四', value: 4 }, { label: '五', value: 5 }, { label: '六', value: 6 }, { label: '日', value: 7 }
      ],
      previewModel: '',
      previewDate: localToday(),
      previewTime: localNow(),
      tzOffset: 480,
      sample: { prompt: 1000, completion: 200, cacheHit: 0 },
      preview: null,
      previewError: '',
      previewing: false
    };
  },
  computed: {
    matchedCount: function() {
      var n = 0;
      for (var i = 0; i < this.rules.length; i++) {
        if (this.rules[i].matched_now && this.rules[i].enabled) n++;
      }
      return n;
    },
    currentRuleText: function() {
      if (!this.preview) return '';
      var c = this.preview.current;
      if (c.free) return (c.rule_label || '规则') + '：限免';
      if (c.is_base) return '未命中规则 · 走基准价';
      return '命中「' + (c.rule_label || c.rule_id) + '」';
    },
    currentBadgeClass: function() {
      if (!this.preview) return '';
      var c = this.preview.current;
      if (c.free) return 'appp-badge--free';
      return c.is_base ? 'appp-badge--ghost' : 'appp-badge--rule';
    },
    tzLabel: function() {
      var t = '';
      for (var i = 0; i < this.tzPresets.length; i++) {
        if (this.tzPresets[i].value === this.tzOffset) t = this.tzPresets[i].label;
      }
      return t || ('UTC' + (this.tzOffset >= 0 ? '+' : '') + (this.tzOffset / 60));
    }
  },
  watch: {
    refreshKey: function() {
      this.loadRules();
    }
  },
  mounted: function() {
    this.loadRules();
    this.loadModels();
  },
  activated: function() {
    this.loadRules();
    this.loadModels();
  },
  methods: {
    fmtYuan: toYuan,
    blankForm: function() {
      return {
        id: '', label: '', model_id: '', kind: 'price',
        price_in: 0, price_out: 0, price_cache_hit: 0, discount_percent: 100,
        days: [], days_of_week: '*', start_time: '', end_time: '', timezone_offset: 0,
        valid_from: '', valid_until: '', priority: 100, enabled: true, note: ''
      };
    },
    toast: function(msg, type) {
      this.$store.commit('toast/SHOW_TOAST', { message: msg, type: type || 'info' });
    },
    fmtPrice: function(v) {
      var n = Number(v) || 0;
      if (n === 0) return '0';
      return String(Math.round(n * 10000) / 10000);
    },
    loadRules: function() {
      var self = this;
      self.rulesLoading = true;
      api.get('/ai-chat/admin/pricing/rules').then(function(res) {
        var data = (res.data && res.data.data) || {};
        self.rules = data.rules || [];
      }).catch(function() {
        self.rules = [];
      }).finally(function() {
        self.rulesLoading = false;
      });
    },
    loadModels: function() {
      var self = this;
      api.get('/ai-chat/admin/models').then(function(res) {
        var data = (res.data && res.data.data) || {};
        self.models = data.models || [];
        if (!self.previewModel && self.models.length) self.previewModel = self.models[0].id;
      }).catch(function() {});
    },
    modelLabel: function(id) {
      for (var i = 0; i < this.models.length; i++) {
        if (this.models[i].id === id) return this.models[i].label;
      }
      return id;
    },
    kindText: function(kind) {
      if (kind === 'free') return '限免';
      if (kind === 'discount') return '折扣';
      return '绝对价';
    },
    kindClass: function(kind) {
      if (kind === 'free') return 'appp-badge--free';
      if (kind === 'discount') return 'appp-badge--discount';
      return 'appp-badge--rule';
    },
    priceText: function(r) {
      if (r.kind === 'free') return '计 0 成本';
      if (r.kind === 'discount') return '基准价 × ' + r.discount_percent + '%';
      return '输入 ' + this.fmtPrice(r.price_in) + ' / 输出 ' + this.fmtPrice(r.price_out) + ' 元/百万';
    },
    timeText: function(r) {
      var days = r.days_of_week === '*' || !r.days_of_week ? '每天' : '周' + r.days_of_week;
      var span = (!r.start_time && !r.end_time) ? '全天' : (r.start_time + '–' + r.end_time);
      var tz = r.timezone_offset === 0 ? 'UTC' : 'UTC' + (r.timezone_offset > 0 ? '+' : '') + (r.timezone_offset / 60);
      return days + ' ' + span + '（' + tz + '）';
    },
    dateRangeText: function(r) {
      if (!r.valid_from && !r.valid_until) return '';
      return (r.valid_from || '不限') + ' → ' + (r.valid_until || '不限');
    },
    barHeight: function(cost) {
      var max = 0;
      if (!this.preview) return '2px';
      for (var i = 0; i < this.preview.hours.length; i++) {
        if (this.preview.hours[i].cost_micro > max) max = this.preview.hours[i].cost_micro;
      }
      if (!max || !cost) return '2px';
      return Math.max(3, Math.round(cost / max * 54)) + 'px';
    },
    setTz: function(v) {
      this.tzOffset = v;
      this.form.timezone_offset = v;
    },
    toggleDay: function(v) {
      var idx = this.form.days.indexOf(v);
      if (idx >= 0) this.form.days.splice(idx, 1);
      else this.form.days.push(v);
      this.form.days = this.form.days.slice().sort();
      this.form.days_of_week = this.form.days.length ? this.form.days.join(',') : '*';
    },
    runPreview: function() {
      var self = this;
      if (!self.previewModel) return;
      self.previewing = true;
      self.previewError = '';
      api.post('/ai-chat/admin/pricing/preview', {
        model_id: self.previewModel,
        at: (self.previewDate || localToday()) + ' ' + (self.previewTime || localNow()),
        tz_offset: self.tzOffset,
        prompt_tokens: self.sample.prompt || 0,
        completion_tokens: self.sample.completion || 0,
        cache_hit_tokens: self.sample.cacheHit || 0
      }).then(function(res) {
        self.preview = (res.data && res.data.data) || null;
      }).catch(function(err) {
        self.preview = null;
        self.previewError = (err && err.response && err.response.data && err.response.data.message) || '试算失败';
      }).finally(function() {
        self.previewing = false;
      });
    },
    startAdd: function() {
      this.form = this.blankForm();
      this.form.timezone_offset = this.tzOffset;
      this.formError = '';
      this.editing = 'new';
    },
    startEdit: function(r) {
      this.form = {
        id: r.id,
        label: r.label,
        model_id: r.model_id || '',
        kind: r.kind,
        price_in: r.price_in,
        price_out: r.price_out,
        price_cache_hit: r.price_cache_hit,
        discount_percent: r.discount_percent,
        days: (r.days_of_week && r.days_of_week !== '*') ? String(r.days_of_week).split(',').map(function(s) { return parseInt(s, 10); }) : [],
        days_of_week: r.days_of_week || '*',
        start_time: r.start_time || '',
        end_time: r.end_time || '',
        timezone_offset: r.timezone_offset || 0,
        valid_from: r.valid_from || '',
        valid_until: r.valid_until || '',
        priority: r.priority,
        enabled: r.enabled,
        note: r.note || ''
      };
      this.formError = '';
      this.editing = r.id;
    },
    save: function() {
      var self = this;
      if (!self.form.label || !self.form.label.trim()) {
        self.formError = '规则名称不能为空';
        return;
      }
      var payload = {
        label: self.form.label.trim(),
        model_id: self.form.model_id || '',
        kind: self.form.kind,
        price_in: self.form.price_in || 0,
        price_out: self.form.price_out || 0,
        price_cache_hit: self.form.price_cache_hit || 0,
        discount_percent: self.form.discount_percent === undefined ? 100 : self.form.discount_percent,
        days_of_week: self.form.days.length ? self.form.days.join(',') : '*',
        start_time: self.form.start_time || '',
        end_time: self.form.end_time || '',
        timezone_offset: self.form.timezone_offset || 0,
        valid_from: self.form.valid_from || '',
        valid_until: self.form.valid_until || '',
        priority: self.form.priority,
        enabled: self.form.enabled,
        note: self.form.note || ''
      };
      self.saving = true;
      var req = self.editing === 'new'
        ? api.post('/ai-chat/admin/pricing/rules', payload)
        : api.put('/ai-chat/admin/pricing/rules/' + self.form.id, payload);
      req.then(function() {
        self.toast('规则已保存', 'success');
        self.editing = null;
        self.loadRules();
        return self.runPreview();
      }).catch(function(err) {
        self.formError = (err && err.response && err.response.data && err.response.data.message) || '保存失败';
      }).finally(function() {
        self.saving = false;
      });
    },
    toggleRule: function(r) {
      var self = this;
      api.put('/ai-chat/admin/pricing/rules/' + r.id + '/toggle', { enabled: !r.enabled }).then(function() {
        r.enabled = !r.enabled;
        self.toast(r.enabled ? '已启用' : '已停用', 'success');
      }).catch(function() {
        self.toast('操作失败', 'error');
      });
    },
    removeRule: function(r) {
      var self = this;
      // 与 AiModelsPanel 一致的两段式确认（不用 window.confirm，平板体验更好）
      if (self.confirmingDelete !== r.id) {
        self.confirmingDelete = r.id;
        clearTimeout(self._confirmTimer);
        self._confirmTimer = setTimeout(function() {
          if (self.confirmingDelete === r.id) self.confirmingDelete = '';
        }, 4000);
        return;
      }
      self.confirmingDelete = '';
      api.delete('/ai-chat/admin/pricing/rules/' + r.id).then(function() {
        self.toast('已删除（历史账不受影响，流水已存单价快照）', 'success');
        self.loadRules();
        return self.runPreview();
      }).catch(function() {
        self.toast('删除失败', 'error');
      });
    }
  }
};
</script>

<style scoped>
.ai-pricing-panel { display: flex; flex-direction: column; gap: 16px; }

.app-card {
  background: var(--card-bg);
  border: 1px solid var(--separator-color);
  border-radius: var(--radius-lg);
  padding: 16px;
  box-shadow: var(--shadow-sm);
}
.app-card-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 12px;
}
.app-card-title {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  display: flex; align-items: center; gap: 6px;
}
.app-card-sub { font-size: var(--font-size-caption); color: var(--text-secondary); }
.app-card-head .appp-btn { margin-left: auto; }

.appp-row { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.appp-row--tz { align-items: center; }
.appp-row--days { align-items: center; }
.appp-field { display: flex; flex-direction: column; gap: 4px; min-width: 150px; flex: 1; }
.appp-field--wide { flex: 3; }
.appp-label { font-size: var(--font-size-caption); color: var(--text-secondary); }
.appp-req { color: var(--danger-color); }
.appp-input {
  padding: 7px 10px;
  border: 1px solid var(--separator-color);
  border-radius: var(--radius-sm);
  background: var(--input-bg, var(--card-bg));
  color: var(--text-primary);
  font-size: var(--font-size-caption);
  outline: none;
  min-width: 0;
}
.appp-input:focus { border-color: var(--accent-ai); }
.appp-hint { font-size: 11px; color: var(--text-tertiary); }
.appp-note {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  background: var(--fill-quaternary, rgba(120, 120, 128, 0.08));
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  margin-bottom: 10px;
}

.appp-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.appp-chip {
  padding: 4px 10px;
  border: 1px solid var(--separator-color);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.appp-chip.active { background: var(--accent-ai-fade, rgba(0, 122, 255, 0.12)); border-color: var(--accent-ai); color: var(--accent-ai); }

.appp-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--separator-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-caption);
  cursor: pointer;
}
.appp-btn:active { transform: scale(0.97); }
.appp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.appp-btn--primary { background: var(--accent-ai); border-color: var(--accent-ai); color: #fff; }

.appp-error {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--danger-color-fade, rgba(255, 59, 48, 0.12));
  color: var(--danger-color);
  font-size: var(--font-size-caption);
  margin-bottom: 10px;
}
.appp-dim { font-size: var(--font-size-caption); color: var(--text-tertiary); }
.appp-empty { font-size: var(--font-size-caption); color: var(--text-tertiary); padding: 12px 0; }

.appp-result {
  border-top: 1px solid var(--separator-color);
  padding-top: 10px;
  display: flex; flex-direction: column; gap: 6px;
}
.appp-result-line { display: flex; align-items: center; gap: 10px; }
.appp-money { font-size: var(--font-size-title, 18px); font-weight: 600; color: var(--text-primary); }
.appp-result-detail { font-size: var(--font-size-caption); color: var(--text-secondary); }

.appp-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.6;
}
.appp-badge--rule { background: rgba(0, 122, 255, 0.14); color: var(--accent-ai); }
.appp-badge--free { background: rgba(52, 199, 89, 0.16); color: var(--success-color); }
.appp-badge--discount { background: rgba(255, 149, 0, 0.16); color: var(--warning-color); }
.appp-badge--ghost { background: var(--fill-quaternary, rgba(120, 120, 128, 0.12)); color: var(--text-secondary); }
.appp-badge--on { background: rgba(52, 199, 89, 0.16); color: var(--success-color); }
.appp-badge--off { background: var(--fill-quaternary, rgba(120, 120, 128, 0.12)); color: var(--text-tertiary); }

.appp-curve { margin-top: 8px; }
.appp-curve-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: var(--font-size-caption); color: var(--text-secondary);
  margin-bottom: 6px;
}
.appp-legend { display: flex; align-items: center; gap: 4px; color: var(--text-tertiary); }
.appp-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; margin-left: 6px; }
.appp-dot--base { background: var(--text-tertiary); }
.appp-dot--rule { background: var(--accent-ai); }
.appp-dot--free { background: var(--success-color); }
.appp-bars {
  display: flex; align-items: flex-end; gap: 3px;
  height: 70px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--separator-color);
}
.appp-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; position: relative; }
.appp-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; }
.appp-bar--base { background: var(--text-tertiary); }
.appp-bar--rule { background: var(--accent-ai); }
.appp-bar--free { background: var(--success-color); }
.appp-bar-label { position: absolute; bottom: -14px; font-size: 10px; color: var(--text-tertiary); }

.appp-list { display: flex; flex-direction: column; gap: 8px; }
.appp-item {
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--separator-color);
  border-radius: var(--radius-md);
  background: var(--fill-quaternary, rgba(120, 120, 128, 0.04));
}
.appp-item.is-off { opacity: 0.55; }
.appp-item-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.appp-item-name { font-size: var(--font-size-body); font-weight: 600; color: var(--text-primary); }
.appp-item-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.appp-item-actions { display: flex; gap: 6px; justify-content: flex-end; }
.appp-icon {
  width: 30px; height: 30px;
  border: 1px solid var(--separator-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.appp-icon:active { transform: scale(0.94); }
.appp-icon--danger { color: var(--danger-color); }
.appp-confirm-text { font-size: var(--font-size-caption); color: var(--danger-color); align-self: center; }

.appp-form {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid var(--accent-ai);
  border-radius: var(--radius-md);
  background: var(--fill-quaternary, rgba(120, 120, 128, 0.04));
}
.appp-form-title { margin: 0 0 12px; font-size: var(--font-size-body); font-weight: 600; color: var(--text-primary); }
.appp-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.appp-toggle { display: flex; align-items: center; gap: 6px; font-size: var(--font-size-caption); color: var(--text-secondary); }
</style>
