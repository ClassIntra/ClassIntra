<template>
  <div class="cim-panel">
    <!-- 列表视图 -->
    <div v-if="!editing && !policyEditing" class="cim-list-view">
      <div class="cim-toolbar">
        <span class="cim-hint">接入任意 OpenAI 兼容模型，数量与来源不限。用户只能使用「已启用」的模型；默认模型为用户未选择时兜底。<template v-if="models.length > 0">共 {{ models.length }} 个，启用 {{ enabledCount }} 个。</template></span>
        <div class="cim-toolbar-actions">
          <button class="cim-secondary-btn" @click="startPolicyAdd"><i class="fa-solid fa-shield-halved"></i> 使用策略</button>
          <button class="cim-add-btn" @click="startAdd"><i class="fa-solid fa-plus"></i> 接入新模型</button>
        </div>
      </div>

      <div v-if="loading" class="cim-loading"><div class="cim-spinner"></div><span>加载中...</span></div>
      <div v-else-if="models.length === 0" class="cim-empty">
        <i class="fa-solid fa-cubes"></i>
        <span>暂无模型，点击「接入新模型」添加（可从厂商模板快速填充）</span>
      </div>

      <div v-for="m in models" :key="m.id" class="cim-item" :class="{ disabled: !m.enabled }">
        <span class="cim-dot" :style="{ background: m.color }"></span>
        <div class="cim-item-info">
          <div class="cim-item-label">
            <span>{{ m.label }}</span>
            <span v-if="m.is_default" class="cim-tag cim-tag-default">默认</span>
            <span v-if="m.is_free" class="cim-tag cim-tag-free">免费</span>
            <span v-if="!m.enabled" class="cim-tag cim-tag-off">已停用</span>
          </div>
          <div class="cim-item-meta">
            <span class="cim-id">{{ m.id }}</span>
            <span v-if="m.supports_thinking"><i class="fa-solid fa-lightbulb"></i> 思考</span>
            <span v-if="m.supports_search"><i class="fa-solid fa-magnifying-glass"></i> 搜索</span>
            <span v-if="m.has_key"><i class="fa-solid fa-key"></i> {{ m.key_from_env ? 'Key: env' : m.api_key_masked }}</span>
            <span v-if="m.api_url" class="cim-url">{{ m.api_url }}</span>
          </div>
        </div>
        <div class="cim-item-actions">
          <button v-if="!m.is_default" class="cim-icon-btn" :class="{ dim: !m.enabled }" :disabled="!m.enabled" @click="setDefault(m)" title="设为默认"><i class="fa-regular fa-star"></i></button>
          <button v-else class="cim-icon-btn starred" title="当前默认"><i class="fa-solid fa-star"></i></button>
          <button class="cim-icon-btn" @click="startEdit(m)" title="编辑"><i class="fa-solid fa-pen"></i></button>
          <button class="cim-icon-btn" @click="startCopy(m)" title="复制接入（单源多模型）"><i class="fa-regular fa-copy"></i></button>
          <button class="cim-icon-btn" :class="{ off: m.enabled }" @click="toggle(m)" :title="m.enabled ? '停用' : '启用'"><i :class="m.enabled ? 'fa-solid fa-toggle-on' : 'fa-solid fa-toggle-off'"></i></button>
          <button
            class="cim-icon-btn danger"
            :class="{ confirming: confirmingDelete === m.id }"
            @click="deleteClick(m)"
            :title="confirmingDelete === m.id ? '再次点击确认删除' : '删除'"
          >
            <i :class="confirmingDelete === m.id ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-trash-can'"></i>
            <span v-if="confirmingDelete === m.id" class="cim-confirm-text">确认删除?</span>
          </button>
        </div>
      </div>

      <!-- 使用策略 -->
      <div class="cim-policy-section">
        <div class="cim-policy-header">
          <h4 class="cim-section-title"><i class="fa-solid fa-shield-halved"></i> 使用策略</h4>
          <div class="cim-policy-header-actions">
            <button class="cim-secondary-btn sm" @click="startPolicyAdd"><i class="fa-solid fa-plus"></i> 新建策略</button>
          </div>
        </div>
        <p class="cim-policy-desc">策略 = 预设的模型授权方案。在「用户管理」页多选用户后，用工具栏的「AI 策略」按钮一键应用到选中用户。</p>
        <div v-if="policies.length === 0" class="cim-policy-empty">暂无策略（系统内置「全部模型」默认策略始终生效）</div>
        <div v-for="p in policies" :key="p.id" class="cim-policy-item">
          <div class="cim-policy-info">
            <div class="cim-item-label">
              <span>{{ p.label }}</span>
              <span v-if="p.is_default" class="cim-tag cim-tag-default">默认</span>
              <span class="cim-tag" :class="p.model_ids.length > 0 ? 'cim-tag-free' : 'cim-tag-off'">{{ p.model_ids.length > 0 ? p.model_ids.length + ' 个模型' : '不限' }}</span>
            </div>
            <div v-if="p.model_ids.length > 0" class="cim-policy-models">
              <span v-for="mid in p.model_ids" :key="mid" class="cim-policy-model-chip">{{ modelLabel(mid) }}</span>
            </div>
          </div>
          <div class="cim-item-actions">
            <button v-if="!p.is_default" class="cim-icon-btn" @click="setDefaultPolicy(p)" title="设为默认策略"><i class="fa-regular fa-star"></i></button>
            <button v-else class="cim-icon-btn starred" title="当前默认策略"><i class="fa-solid fa-star"></i></button>
            <button class="cim-icon-btn" @click="startPolicyEdit(p)" title="编辑"><i class="fa-solid fa-pen"></i></button>
            <button
              class="cim-icon-btn danger"
              :class="{ confirming: confirmingPolicyDelete === p.id }"
              :disabled="p.is_default"
              @click="deletePolicyClick(p)"
              :title="p.is_default ? '默认策略不可删除' : (confirmingPolicyDelete === p.id ? '再次点击确认删除' : '删除')"
            >
              <i :class="confirmingPolicyDelete === p.id ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-trash-can'"></i>
              <span v-if="confirmingPolicyDelete === p.id" class="cim-confirm-text">确认删除?</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 策略编辑视图 -->
    <div v-else-if="policyEditing" class="cim-form-view">
      <div class="cim-form-header">
        <button class="cim-back-btn" @click="cancelPolicyEdit"><i class="fa-solid fa-arrow-left"></i> 返回列表</button>
        <h3 class="cim-form-title">{{ policyEditing === 'new' ? '新建使用策略' : '编辑策略：' + policyForm.label }}</h3>
      </div>

      <div class="cim-form-row">
        <div class="cim-field">
          <label class="cim-field-label">策略名称 <span class="cim-required">*</span></label>
          <input class="cim-input" v-model="policyForm.label" placeholder="如：仅免费 / 考试模式 / 全部模型" maxlength="20" />
        </div>
        <div class="cim-field">
          <label class="cim-field-label">排序权重（小者靠前）</label>
          <input class="cim-input" type="number" v-model.number="policyForm.sort_order" min="0" max="9999" />
        </div>
      </div>

      <div class="cim-preset-row">
        <label class="cim-field-label">允许使用的模型 <span class="cim-required">*</span></label>
        <div v-if="models.length === 0" class="cim-field-hint">暂无可用模型，请先在「接入新模型」中添加</div>
        <div class="cim-policy-check-list">
          <label v-for="m in models" :key="m.id" class="cim-checkbox" :class="{ dim: !m.enabled }">
            <input type="checkbox" :value="m.id" v-model="policyForm.model_ids" />
            <span class="cim-checkbox-box"><i class="fa-solid fa-check"></i></span>
            <span class="cim-dot cim-dot-sm" :style="{ background: m.color }"></span>
            <span>{{ m.label }}</span>
            <span class="cim-policy-model-id">{{ m.id }}</span>
            <span v-if="!m.enabled" class="cim-tag cim-tag-off">已停用</span>
          </label>
        </div>
        <div class="cim-field-hint">不勾选任何模型 = 不限制（可用全部启用模型）。停用的模型即使用户勾选也不会出现在用户端。</div>
      </div>

      <div class="cim-check-row">
        <label class="cim-checkbox">
          <input type="checkbox" v-model="policyForm.is_default" />
          <span class="cim-checkbox-box"><i class="fa-solid fa-check"></i></span>
          <span>设为默认策略（未指定策略的用户生效）</span>
        </label>
      </div>

      <div class="cim-form-actions">
        <span class="cim-hint">保存后到「用户管理」tab 多选用户，用「AI 策略」按钮批量应用。</span>
        <div class="cim-form-actions-right">
          <button class="cim-cancel-btn" @click="cancelPolicyEdit">取消</button>
          <button class="cim-save-btn" @click="savePolicy">保存</button>
        </div>
      </div>
    </div>

    <!-- 编辑视图 -->
    <div v-else class="cim-form-view">
      <div class="cim-form-header">
        <button class="cim-back-btn" @click="cancelEdit"><i class="fa-solid fa-arrow-left"></i> 返回列表</button>
        <h3 class="cim-form-title">{{ editing === 'new' ? '接入新模型' : '编辑模型：' + form.id }}</h3>
      </div>

      <div v-if="editing === 'new'" class="cim-preset-row">
        <div class="cim-preset-head">
          <label class="cim-field-label">从厂商模板快速填充</label>
          <label class="cim-checkbox">
            <input type="checkbox" v-model="batchMode" />
            <span class="cim-checkbox-box"><i class="fa-solid fa-check"></i></span>
            <span>批量模式（同一源接多个模型）</span>
          </label>
        </div>
        <select class="cim-select" v-model="preset" @change="applyPreset">
          <option value="">手动填写（任意 OpenAI 兼容源）</option>
          <option v-for="p in presets" :key="p.name" :value="p.name">{{ p.name }}</option>
        </select>
        <div class="cim-field-hint">{{ batchMode ? '填一次地址与密钥，下方每行一个模型，一次全部接入。' : '模板自动填入地址 / 模型名 / 能力位，接口以厂商最新文档为准。' }}</div>
      </div>

      <div class="cim-form-row">
        <div class="cim-field">
          <label class="cim-field-label">模型名称 <span class="cim-required">*</span></label>
          <input class="cim-input" v-model="form.label" placeholder="如：智谱 GLM-4-Flash" maxlength="30" />
        </div>
        <div class="cim-field">
          <label class="cim-field-label">模型 ID</label>
          <input class="cim-input" v-model="form.id" placeholder="如 glm-4-flash（英文/数字）" maxlength="32" :disabled="editing !== 'new'" />
        </div>
      </div>
      <div class="cim-form-row">
        <div class="cim-field cim-field-full">
          <label class="cim-field-label">API 地址 <span class="cim-required" v-if="!form.builtin">*</span></label>
          <input class="cim-input" v-model="form.api_url" placeholder="https://api.example.com/v1（自动补全 /chat/completions）" @input="onUrlInput" />
          <div v-if="form.builtin" class="cim-field-hint">内置模型留空 = 使用服务器环境变量配置（.env，可在 ClassIntraOps 密钥页维护）</div>
          <div v-else-if="form.api_url && effectiveUrl !== form.api_url.replace(/\/+$/, '')" class="cim-field-hint">实际请求地址：<span class="cim-mono">{{ effectiveUrl }}</span></div>
          <div v-if="sameSourceModel" class="cim-same-source">
            <label class="cim-checkbox">
              <input type="checkbox" v-model="reuseKey" />
              <span class="cim-checkbox-box"><i class="fa-solid fa-check"></i></span>
              <span>与「{{ sameSourceModel.label }}」同源，复用其 API Key</span>
            </label>
          </div>
        </div>
      </div>
      <div class="cim-form-row">
        <div class="cim-field" v-if="!(editing === 'new' && batchMode)">
          <label class="cim-field-label">模型标识 <span class="cim-required">*</span></label>
          <input class="cim-input" v-model="form.model" placeholder="请求体中的 model 参数，如 glm-4-flash" />
        </div>
        <div class="cim-field">
          <label class="cim-field-label">API Key</label>
          <input class="cim-input" type="password" v-model="form.api_key" :placeholder="keyPlaceholder" autocomplete="new-password" />
        </div>
      </div>

      <div v-if="editing === 'new' && batchMode" class="cim-form-row">
        <div class="cim-field cim-field-full">
          <label class="cim-field-label">模型列表 <span class="cim-required">*</span>（每行一个）</label>
          <textarea
            class="cim-input cim-textarea"
            v-model="batchModelsText"
            rows="5"
            placeholder="glm-4-flash&#10;glm-4-plus&#10;glm-4.5-air&#10;支持「显示名 | 模型标识」格式：GLM Plus | glm-4-plus"
          ></textarea>
          <div class="cim-field-hint">每行一个模型标识，ID 与名称自动生成（可用「显示名 | 模型标识」自定义显示名）。模型 ID 冲突时自动加后缀。</div>
        </div>
      </div>

      <div class="cim-check-row">
        <label class="cim-checkbox">
          <input type="checkbox" v-model="form.supports_thinking" />
          <span class="cim-checkbox-box"><i class="fa-solid fa-check"></i></span>
          <span>深度思考</span>
        </label>
        <label v-if="form.supports_thinking" class="cim-checkbox cim-inline-select-wrap">
          <select class="cim-select" v-model="form.api_style">
            <option value="deepseek">思考参数：DeepSeek / GLM 风格</option>
            <option value="openai">思考参数：无（OpenAI 标准）</option>
          </select>
        </label>
      </div>
      <div class="cim-check-row">
        <label class="cim-checkbox">
          <input type="checkbox" v-model="form.supports_search" />
          <span class="cim-checkbox-box"><i class="fa-solid fa-check"></i></span>
          <span>联网搜索（需已配置 Tavily）</span>
        </label>
        <label class="cim-checkbox">
          <input type="checkbox" v-model="form.is_free" />
          <span class="cim-checkbox-box"><i class="fa-solid fa-check"></i></span>
          <span>免费标记</span>
        </label>
        <label class="cim-checkbox">
          <input type="checkbox" v-model="form.enabled" />
          <span class="cim-checkbox-box"><i class="fa-solid fa-check"></i></span>
          <span>启用（用户可见）</span>
        </label>
      </div>

      <div class="cim-form-row">
        <div class="cim-field">
          <label class="cim-field-label">徽章颜色</label>
          <div class="cim-color-row">
            <button
              v-for="c in colorChoices"
              :key="c"
              class="cim-color-dot"
              :class="{ selected: form.color === c }"
              :style="{ background: c }"
              @click="form.color = c"
            ></button>
          </div>
        </div>
        <div class="cim-field">
          <label class="cim-field-label">排序权重（小者靠前）</label>
          <input class="cim-input" type="number" v-model.number="form.sort_order" min="0" max="9999" />
        </div>
      </div>

      <div v-if="form.supports_thinking" class="cim-preset-row">
        <label class="cim-field-label">高级参数（可选，留空用默认值）</label>
        <div class="cim-form-row">
          <div class="cim-field">
            <label class="cim-field-label">上下文预算（tokens）</label>
            <input class="cim-input" type="number" v-model.number="form.max_context_tokens" min="0" max="200000" placeholder="0 = 默认 10000" />
          </div>
          <div class="cim-field">
            <label class="cim-field-label">单次输出上限（tokens）</label>
            <input class="cim-input" type="number" v-model.number="form.max_output_tokens" min="0" max="65536" placeholder="0 = 风格默认值" />
          </div>
          <div class="cim-field">
            <label class="cim-field-label">思考强度</label>
            <select class="cim-select" v-model="form.reasoning_effort">
              <option value="">不指定</option>
              <option value="low">low（快速）</option>
              <option value="medium">medium（均衡）</option>
              <option value="high">high（深度）</option>
            </select>
          </div>
        </div>
      </div>

      <div v-if="testResult" class="cim-test-result" :class="{ ok: testResult.ok }">
        <i :class="testResult.ok ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-exclamation'"></i>
        <span>{{ testResult.message }}</span>
        <span v-if="testResult.latency_ms" class="cim-test-latency">{{ testResult.latency_ms }}ms</span>
      </div>

      <div class="cim-form-actions">
        <button class="cim-test-btn" :disabled="testing" @click="test">
          <div v-if="testing" class="cim-spinner cim-spinner-xs"></div>
          <i v-else class="fa-solid fa-plug"></i>
          测试连接
        </button>
        <div class="cim-form-actions-right">
          <button class="cim-cancel-btn" @click="cancelEdit">取消</button>
          <button class="cim-save-btn" @click="save">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

export default {
  name: 'AiModelsPanel',
  data: function() {
    return {
      models: [],
      policies: [],
      loading: false,
      editing: null,
      form: {},
      preset: '',
      reuseKey: true,
      batchMode: false,
      batchModelsText: '',
      policyEditing: null,
      policyForm: {},
      confirmingPolicyDelete: null,
      testing: false,
      testResult: null,
      confirmingDelete: null,
      confirmingTimer: null,
      colorChoices: ['#f59e0b', '#10b981', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#06b6d4', '#84cc16'],
      presets: [
        { name: '智谱 GLM（bigmodel.cn）', api_url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash', color: '#6366f1', supports_thinking: true, api_style: 'deepseek', is_free: true, label: '智谱 GLM-4-Flash' },
        { name: 'DeepSeek 官方', api_url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', color: '#10b981', supports_thinking: true, api_style: 'deepseek', is_free: false, label: 'DeepSeek' },
        { name: '月之暗面 Kimi', api_url: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k', color: '#111827', supports_thinking: false, is_free: false, label: 'Kimi' },
        { name: '阿里 Qwen（百炼兼容模式）', api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus', color: '#8b5cf6', supports_thinking: false, is_free: false, label: 'Qwen' },
        { name: '硅基流动 SiliconFlow', api_url: 'https://api.siliconflow.cn/v1/chat/completions', model: 'deepseek-ai/DeepSeek-V3', color: '#06b6d4', supports_thinking: false, is_free: false, label: 'SiliconFlow' },
        { name: 'OpenAI 官方', api_url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', color: '#f59e0b', supports_thinking: false, is_free: false, label: 'GPT' }
      ]
    };
  },
  computed: {
    enabledCount: function() {
      var n = 0;
      for (var i = 0; i < this.models.length; i++) {
        if (this.models[i].enabled) n++;
      }
      return n;
    },
    keyPlaceholder: function() {
      if (this.form.key_from_env) return '当前来自环境变量，留空保持不变';
      if (this.form.has_key) return '已设置，留空不修改';
      if (this.sameSourceModel && this.reuseKey) return '将复用「' + this.sameSourceModel.label + '」的密钥';
      return 'sk-...（无鉴权服务可留空）';
    },
    effectiveUrl: function() {
      var u = String(this.form.api_url || '').trim().replace(/\/+$/, '');
      if (!u) return '';
      if (/\/chat\/completions$/i.test(u)) return u;
      if (/\/v\d+[a-z]*$/i.test(u)) return u + '/chat/completions';
      return u + '/v1/chat/completions';
    },
    sameSourceModel: function() {
      var self = this;
      if (self.editing !== 'new') return null;
      var url = String(self.form.api_url || '').trim().replace(/\/+$/, '');
      if (!url) return null;
      for (var i = 0; i < self.models.length; i++) {
        var mUrl = String(self.models[i].api_url || '').trim().replace(/\/+$/, '');
        if (mUrl === url && self.models[i].has_key) return self.models[i];
      }
      return null;
    }
  },
  mounted: function() {
    this.reload();
    this.loadPolicies();
  },
  beforeDestroy: function() {
    if (this.confirmingTimer) clearTimeout(this.confirmingTimer);
  },
  methods: {
    toast: function(message, type) {
      this.$store.commit('toast/SHOW_TOAST', { message: message, type: type || 'info' });
    },
    reload: function() {
      var self = this;
      self.loading = true;
      api.get('/ai-chat/admin/models').then(function(response) {
        self.models = (response.data.data && response.data.data.models) || [];
        self.loading = false;
      }).catch(function(err) {
        self.loading = false;
        self.toast((err.response && err.response.data && err.response.data.message) || '模型列表加载失败（需系统管理员/班管）', 'error');
      });
    },
    loadPolicies: function() {
      var self = this;
      api.get('/ai-chat/admin/policies').then(function(response) {
        self.policies = (response.data.data && response.data.data.policies) || [];
      }).catch(function() {
        self.policies = [];
      });
    },
    modelLabel: function(id) {
      for (var i = 0; i < this.models.length; i++) {
        if (this.models[i].id === id) return this.models[i].label;
      }
      return id;
    },
    // ======== 使用策略 ========
    startPolicyAdd: function() {
      this.policyEditing = 'new';
      this.policyForm = { label: '', model_ids: [], is_default: false, sort_order: 10 };
    },
    startPolicyEdit: function(p) {
      this.policyEditing = p.id;
      this.policyForm = {
        id: p.id,
        label: p.label,
        model_ids: (p.model_ids || []).slice(),
        is_default: !!p.is_default,
        sort_order: p.sort_order || 0
      };
    },
    cancelPolicyEdit: function() {
      this.policyEditing = null;
    },
    savePolicy: function() {
      var self = this;
      var f = self.policyForm;
      if (!f.label || !f.label.trim()) { self.toast('策略名称不能为空', 'error'); return; }
      var payload = {
        label: f.label.trim(),
        model_ids: f.model_ids,
        sort_order: f.sort_order
      };
      if (self.policyEditing === 'new') {
        api.post('/ai-chat/admin/policies', payload).then(function() {
          self.toast('策略已创建，到「用户管理」tab 批量应用', 'success');
          self.policyEditing = null;
          self.loadPolicies();
        }).catch(function(err) {
          self.toast((err.response && err.response.data && err.response.data.message) || '创建失败', 'error');
        });
      } else {
        payload.is_default = f.is_default;
        api.put('/ai-chat/admin/policies/' + f.id, payload).then(function() {
          self.toast('策略已保存', 'success');
          self.policyEditing = null;
          self.loadPolicies();
        }).catch(function(err) {
          self.toast((err.response && err.response.data && err.response.data.message) || '保存失败', 'error');
        });
      }
    },
    deletePolicyClick: function(p) {
      var self = this;
      if (p.is_default) return;
      if (self.confirmingPolicyDelete !== p.id) {
        self.confirmingPolicyDelete = p.id;
        setTimeout(function() { self.confirmingPolicyDelete = null; }, 4000);
        return;
      }
      self.confirmingPolicyDelete = null;
      api.delete('/ai-chat/admin/policies/' + p.id).then(function() {
        self.toast('策略已删除，引用它的用户已回落默认策略', 'success');
        self.loadPolicies();
      }).catch(function() {
        self.toast('删除失败', 'error');
      });
    },
    setDefaultPolicy: function(p) {
      var self = this;
      api.put('/ai-chat/admin/policies/' + p.id, { is_default: true }).then(function() {
        self.toast('「' + p.label + '」已设为默认策略', 'success');
        self.loadPolicies();
      }).catch(function() {
        self.toast('设置失败', 'error');
      });
    },
    // ======== 复制接入（单源多模型） ========
    startCopy: function(m) {
      var self = this;
      self.editing = 'new';
      self.testResult = null;
      self.preset = '';
      self.reuseKey = true;
      self.batchMode = true;
      self.batchModelsText = m.model;
      self.form = {
        id: '',
        label: m.label,
        api_url: m.api_url || '',
        api_key: '',
        model: '',
        color: m.color || '#6366f1',
        api_style: m.api_style === 'deepseek' ? 'deepseek' : 'openai',
        supports_thinking: !!m.supports_thinking,
        supports_search: !!m.supports_search,
        is_free: !!m.is_free,
        enabled: m.enabled !== false,
        sort_order: m.sort_order || 100,
        max_context_tokens: m.max_context_tokens || 0,
        max_output_tokens: m.max_output_tokens || 0,
        reasoning_effort: m.reasoning_effort || '',
        builtin: false,
        has_key: false,
        key_from_env: false,
        copy_source: m.id
      };
      self.toast('已复制「' + m.label + '」的源配置，在模型列表中追加同源模型');
    },
    startAdd: function() {
      this.editing = 'new';
      this.testResult = null;
      this.preset = '';
      this.reuseKey = true;
      this.batchMode = false;
      this.batchModelsText = '';
      this.form = {
        id: '',
        label: '',
        api_url: '',
        api_key: '',
        model: '',
        color: this.colorChoices[this.models.length % this.colorChoices.length],
        api_style: 'openai',
        supports_thinking: false,
        supports_search: false,
        is_free: false,
        enabled: true,
        sort_order: 100,
        max_context_tokens: 0,
        max_output_tokens: 0,
        reasoning_effort: '',
        builtin: false,
        has_key: false,
        key_from_env: false
      };
    },
    onUrlInput: function() {},
    applyPreset: function() {
      var self = this;
      if (!self.preset) return;
      var preset = null;
      for (var i = 0; i < self.presets.length; i++) {
        if (self.presets[i].name === self.preset) { preset = self.presets[i]; break; }
      }
      if (!preset) return;
      self.form.label = preset.label;
      self.form.api_url = preset.api_url;
      self.form.model = preset.model;
      self.form.color = preset.color;
      self.form.supports_thinking = !!preset.supports_thinking;
      self.form.api_style = preset.supports_thinking ? (preset.api_style || 'openai') : 'openai';
      self.form.is_free = !!preset.is_free;
      var slugMap = [
        ['智谱', 'glm'], ['DeepSeek', 'deepseek'], ['月之暗面', 'kimi'],
        ['阿里', 'qwen'], ['硅基流动', 'siliconflow'], ['OpenAI', 'gpt']
      ];
      var slug = 'model';
      for (var s = 0; s < slugMap.length; s++) {
        if (preset.name.indexOf(slugMap[s][0]) === 0) { slug = slugMap[s][1]; break; }
      }
      var candidate = slug;
      var n = 2;
      while (self.idTaken(candidate)) { candidate = slug + '-' + n; n++; }
      self.form.id = candidate;
      // 批量模式：把模板的模型名追加到列表（可继续手动加更多）
      if (self.batchMode) {
        var hasLine = false;
        var lines = self.batchModelsText.split('\n');
        for (var li = 0; li < lines.length; li++) {
          if (lines[li].trim() === preset.model || lines[li].indexOf('| ' + preset.model) > -1) { hasLine = true; break; }
        }
        if (!hasLine) {
          self.batchModelsText = (self.batchModelsText.trim() ? self.batchModelsText.replace(/\s*$/, '\n') : '') + preset.model + '\n';
        }
        self.toast('已按模板填充源配置，模型已加入列表，可继续追加');
      } else {
        self.toast('已按模板填充，请补充 API Key（地址与模型名以厂商文档为准）');
      }
    },
    idTaken: function(id) {
      for (var i = 0; i < this.models.length; i++) {
        if (this.models[i].id === id) return true;
      }
      return false;
    },
    startEdit: function(m) {
      this.editing = m.id;
      this.testResult = null;
      this.form = {
        id: m.id,
        label: m.label,
        api_url: m.api_url || '',
        api_key: '',
        model: m.model || '',
        color: m.color || '#6366f1',
        api_style: m.api_style === 'deepseek' ? 'deepseek' : 'openai',
        supports_thinking: !!m.supports_thinking,
        supports_search: !!m.supports_search,
        is_free: !!m.is_free,
        enabled: !!m.enabled,
        sort_order: m.sort_order || 0,
        max_context_tokens: m.max_context_tokens || 0,
        max_output_tokens: m.max_output_tokens || 0,
        reasoning_effort: m.reasoning_effort || '',
        builtin: !!m.builtin,
        has_key: !!m.has_key,
        key_from_env: !!m.key_from_env
      };
    },
    cancelEdit: function() {
      this.editing = null;
      this.testResult = null;
    },
    test: function() {
      var self = this;
      var f = self.form;
      self.testing = true;
      self.testResult = null;
      var payload;
      if (self.editing !== 'new' && f.builtin && !f.api_url && !f.model) {
        payload = { id: f.id };
      } else {
        payload = { api_url: f.api_url, model: f.model };
        if (self.editing !== 'new' && !f.api_key && f.has_key) {
          payload.id = f.id;
        } else if (f.api_key) {
          payload.api_key = f.api_key;
        }
      }
      api.post('/ai-chat/admin/models/test', payload).then(function(response) {
        self.testResult = response.data.data || { ok: false, message: '测试无结果' };
        self.testing = false;
      }).catch(function(err) {
        self.testResult = { ok: false, message: (err.response && err.response.data && err.response.data.message) || '测试请求失败' };
        self.testing = false;
      });
    },
    save: function() {
      var self = this;
      var f = self.form;
      if (!f.label || !f.label.trim()) { self.toast('模型名称不能为空', 'error'); return; }
      if (!f.builtin && (!f.api_url || !f.api_url.trim())) { self.toast('API 地址不能为空', 'error'); return; }

      // 批量模式（仅新建）：一次接入同一源的多个模型
      if (self.editing === 'new' && self.batchMode) {
        var items = [];
        var lines = self.batchModelsText.split('\n');
        for (var bi = 0; bi < lines.length; bi++) {
          var line = lines[bi].trim();
          if (!line) continue;
          var parts = line.split('|');
          var blabel = parts.length > 1 ? parts[0].trim() : '';
          var bmodel = (parts.length > 1 ? parts[1] : parts[0]).trim();
          if (bmodel) items.push({ model: bmodel, label: blabel });
        }
        if (items.length === 0) { self.toast('模型列表为空，每行填写一个模型标识', 'error'); return; }
        var batchPayload = {
          label_prefix: f.label.trim(),
          api_url: (f.api_url || '').trim(),
          color: f.color,
          api_style: f.supports_thinking ? f.api_style : 'openai',
          supports_thinking: f.supports_thinking,
          supports_search: f.supports_search,
          is_free: f.is_free,
          enabled: f.enabled,
          sort_order: f.sort_order,
          max_context_tokens: f.max_context_tokens || 0,
          max_output_tokens: f.max_output_tokens || 0,
          reasoning_effort: f.supports_thinking ? (f.reasoning_effort || '') : '',
          models: items
        };
        if (f.api_key && f.api_key.trim()) batchPayload.api_key = f.api_key.trim();
        if (f.copy_source) batchPayload.reuse_key_from = f.copy_source;
        api.post('/ai-chat/admin/models/batch', batchPayload).then(function(response) {
          var d = response.data.data || {};
          var msg = '已接入 ' + (d.created ? d.created.length : 0) + ' 个模型';
          if (d.failed && d.failed.length > 0) msg += '，失败 ' + d.failed.length + ' 个';
          self.toast(msg, d.failed && d.failed.length > 0 ? 'info' : 'success');
          self.editing = null;
          self.batchMode = false;
          self.batchModelsText = '';
          self.reload();
        }).catch(function(err) {
          self.toast((err.response && err.response.data && err.response.data.message) || '批量接入失败', 'error');
        });
        return;
      }

      if (!f.model || !f.model.trim()) { self.toast('模型标识（请求体 model 参数）不能为空', 'error'); return; }
      var payload = {
        label: f.label.trim(),
        api_url: (f.api_url || '').trim(),
        model: (f.model || '').trim(),
        color: f.color,
        api_style: f.supports_thinking ? f.api_style : 'openai',
        supports_thinking: f.supports_thinking,
        supports_search: f.supports_search,
        is_free: f.is_free,
        enabled: f.enabled,
        sort_order: f.sort_order,
        max_context_tokens: f.max_context_tokens || 0,
        max_output_tokens: f.max_output_tokens || 0,
        reasoning_effort: f.supports_thinking ? (f.reasoning_effort || '') : ''
      };
      if (f.api_key && f.api_key.trim()) payload.api_key = f.api_key.trim();
      if (self.editing === 'new' && self.sameSourceModel && self.reuseKey) payload.reuse_key_from = self.sameSourceModel.id;
      if (self.editing === 'new') {
        payload.id = (f.id || '').trim();
        api.post('/ai-chat/admin/models', payload).then(function() {
          self.toast('模型已接入', 'success');
          self.editing = null;
          self.reload();
        }).catch(function(err) {
          self.toast((err.response && err.response.data && err.response.data.message) || '接入失败', 'error');
        });
      } else {
        api.put('/ai-chat/admin/models/' + f.id, payload).then(function() {
          self.toast('模型已保存', 'success');
          self.editing = null;
          self.reload();
        }).catch(function(err) {
          self.toast((err.response && err.response.data && err.response.data.message) || '保存失败', 'error');
        });
      }
    },
    deleteClick: function(m) {
      var self = this;
      if (self.confirmingDelete !== m.id) {
        self.confirmingDelete = m.id;
        if (self.confirmingTimer) clearTimeout(self.confirmingTimer);
        self.confirmingTimer = setTimeout(function() {
          self.confirmingDelete = null;
        }, 4000);
        return;
      }
      // 二次确认：执行删除
      self.confirmingDelete = null;
      if (self.confirmingTimer) clearTimeout(self.confirmingTimer);
      api.delete('/ai-chat/admin/models/' + m.id).then(function() {
        self.toast('模型已删除（使用它的用户将自动回落到默认模型）', 'success');
        self.reload();
      }).catch(function() {
        self.toast('删除失败', 'error');
      });
    },
    toggle: function(m) {
      var self = this;
      api.put('/ai-chat/admin/models/' + m.id + '/toggle', { enabled: !m.enabled }).then(function() {
        self.reload();
        if (m.enabled) {
          self.toast('「' + m.label + '」已停用');
        } else {
          self.toast('「' + m.label + '」已启用', 'success');
        }
      }).catch(function() {
        self.toast('操作失败', 'error');
      });
    },
    setDefault: function(m) {
      var self = this;
      if (!m.enabled) {
        self.toast('请先启用该模型', 'error');
        return;
      }
      api.put('/ai-chat/admin/models/default', { id: m.id }).then(function() {
        self.toast('「' + m.label + '」已设为默认模型', 'success');
        self.reload();
      }).catch(function() {
        self.toast('设置失败', 'error');
      });
    }
  }
};
</script>

<style scoped>
.cim-panel {
  color: var(--text-primary);
}

.cim-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.cim-hint {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.cim-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.cim-secondary-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm, 8px);
  background: var(--bg-color);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color var(--duration-fast, 0.15s) var(--ease-standard, ease), color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.cim-secondary-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.cim-secondary-btn.sm {
  padding: 5px 10px;
  font-size: 12px;
}

.cim-textarea {
  resize: vertical;
  font-family: var(--font-mono, monospace);
  line-height: 1.7;
}

.cim-preset-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.cim-preset-head .cim-field-label {
  margin-bottom: 0;
}

/* 使用策略 */
.cim-policy-section {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.cim-policy-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.cim-section-title {
  font-size: 14px;
  font-weight: 500;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cim-policy-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0 0 12px;
  line-height: 1.6;
}

.cim-policy-empty {
  padding: 14px 0;
  font-size: 13px;
  color: var(--text-tertiary);
}

.cim-policy-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 8px);
  margin-bottom: 8px;
  background: var(--bg-color);
}

.cim-policy-info {
  flex: 1;
  min-width: 0;
}

.cim-policy-models {
  display: flex;
  gap: 6px;
  margin-top: 5px;
  flex-wrap: wrap;
}

.cim-policy-model-chip {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: var(--radius-pill, 999px);
  background: rgba(148, 163, 184, 0.12);
  color: var(--text-secondary);
}

.cim-policy-check-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}

.cim-policy-check-list .cim-checkbox {
  padding: 6px 8px;
  border-radius: var(--radius-sm, 8px);
  transition: background-color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.cim-policy-check-list .cim-checkbox:hover {
  background: rgba(var(--primary-rgb), 0.05);
}

.cim-policy-check-list .cim-checkbox.dim {
  opacity: 0.55;
}

.cim-policy-model-id {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text-tertiary);
}

.cim-dot-sm {
  width: 9px;
  height: 9px;
}

.cim-mono {
  font-family: var(--font-mono, monospace);
  word-break: break-all;
}

.cim-add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-sm, 8px);
  background: var(--primary-color);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: opacity var(--duration-fast, 0.15s) var(--ease-standard, ease), transform var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.cim-add-btn:active {
  transform: scale(0.97);
}

.cim-loading,
.cim-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 0;
  color: var(--text-tertiary);
  font-size: 13px;
}

.cim-empty i {
  font-size: 28px;
  opacity: 0.5;
}

.cim-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: var(--radius-pill, 999px);
  animation: cim-rotate 0.8s linear infinite;
}

.cim-spinner-xs {
  width: 12px;
  height: 12px;
}

@keyframes cim-rotate {
  to { transform: rotate(360deg); }
}

.cim-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 8px);
  margin-bottom: 10px;
  background: var(--bg-color);
}

.cim-item.disabled {
  opacity: 0.55;
}

.cim-dot {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-pill, 999px);
  flex-shrink: 0;
}

.cim-item-info {
  flex: 1;
  min-width: 0;
}

.cim-item-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  flex-wrap: wrap;
}

.cim-item-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
  flex-wrap: wrap;
}

.cim-item-meta i {
  font-size: 10px;
  margin-right: 3px;
}

.cim-id {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  background: rgba(148, 163, 184, 0.12);
  padding: 1px 6px;
  border-radius: var(--radius-xs, 6px);
}

.cim-url {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cim-tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: var(--radius-pill, 999px);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.6;
  flex-shrink: 0;
}

.cim-tag-default {
  background: rgba(var(--primary-rgb), 0.12);
  color: var(--primary-color);
}

.cim-tag-free {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.cim-tag-off {
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
}

.cim-item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.cim-icon-btn {
  min-width: 32px;
  height: 32px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  border-radius: var(--radius-sm, 8px);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 14px;
  cursor: pointer;
  transition: background-color var(--duration-fast, 0.15s) var(--ease-standard, ease), color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.cim-icon-btn:hover {
  background: rgba(var(--primary-rgb), 0.08);
  color: var(--primary-color);
}

.cim-icon-btn.starred {
  color: var(--warning-color);
}

.cim-icon-btn.off {
  color: var(--text-tertiary);
}

.cim-icon-btn.dim {
  opacity: 0.4;
  cursor: not-allowed;
}

.cim-icon-btn.danger:hover {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

.cim-icon-btn.confirming {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  font-size: 13px;
  min-width: auto;
  padding: 0 10px;
}

.cim-confirm-text {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

/* 编辑视图 */
.cim-form-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.cim-back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm, 8px);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: border-color var(--duration-fast, 0.15s) var(--ease-standard, ease), color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.cim-back-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.cim-form-title {
  font-size: 15px;
  font-weight: 500;
  margin: 0;
}

.cim-preset-row {
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 8px);
  margin-bottom: 16px;
  background: rgba(var(--primary-rgb), 0.03);
}

.cim-field-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.cim-required {
  color: #ef4444;
}

.cim-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm, 8px);
  background: var(--bg-color);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

.cim-field-hint {
  margin-top: 5px;
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.cim-form-row {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.cim-field {
  flex: 1;
  min-width: 0;
}

.cim-field-full {
  flex-basis: 100%;
}

.cim-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm, 8px);
  background: var(--bg-color);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  transition: border-color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.cim-input:focus {
  border-color: var(--primary-color);
}

.cim-input:disabled {
  opacity: 0.55;
  background: rgba(148, 163, 184, 0.08);
}

.cim-check-row {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.cim-checkbox {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  -webkit-user-select: none;
  user-select: none;
}

.cim-checkbox input {
  display: none;
}

.cim-checkbox-box {
  width: 17px;
  height: 17px;
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-xs, 6px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: transparent;
  transition: background-color var(--duration-fast, 0.15s) var(--ease-standard, ease), border-color var(--duration-fast, 0.15s) var(--ease-standard, ease), color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.cim-checkbox input:checked + .cim-checkbox-box {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
}

.cim-color-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.cim-color-dot {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-pill, 999px);
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.cim-color-dot.selected {
  border-color: var(--text-primary);
  transform: scale(1.12);
}

.cim-test-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--radius-sm, 8px);
  font-size: 13px;
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  margin-bottom: 14px;
  line-height: 1.5;
}

.cim-test-result.ok {
  background: rgba(16, 185, 129, 0.08);
  color: #10b981;
}

.cim-test-latency {
  margin-left: auto;
  font-family: var(--font-mono, monospace);
  opacity: 0.75;
  flex-shrink: 0;
}

.cim-form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding-top: 4px;
}

.cim-form-actions-right {
  display: flex;
  gap: 10px;
}

.cim-test-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm, 8px);
  background: var(--bg-color);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color var(--duration-fast, 0.15s) var(--ease-standard, ease), color var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.cim-test-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.cim-test-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.cim-cancel-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm, 8px);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.cim-save-btn {
  padding: 8px 20px;
  border: none;
  border-radius: var(--radius-sm, 8px);
  background: var(--primary-color);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity var(--duration-fast, 0.15s) var(--ease-standard, ease), transform var(--duration-fast, 0.15s) var(--ease-standard, ease);
}

.cim-save-btn:active {
  transform: scale(0.97);
}

@media (max-width: 768px) {
  .cim-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .cim-form-row {
    flex-direction: column;
    gap: 0;
  }
  .cim-url {
    display: none;
  }
  .cim-form-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .cim-form-actions-right {
    justify-content: flex-end;
  }
}
</style>
