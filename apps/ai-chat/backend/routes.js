var express = require('express');
var router = express.Router();
var db = require('../../../server/src/utils/db');
var auth = require('../../../server/src/middleware/auth');
var aiService = require('../../../server/src/services/ai-chat');
var tavilyService = require('../../../server/src/services/tavily');
var axios = require('axios');
var uuid = require('uuid');
var time = require('../../../server/src/utils/time');
var config = require('../../../server/src/config');

var SYSTEM_PROMPT_PREFIX = '你是小深，专业且温暖的AI助手。规则：1.每段对话独立，绝不引用其他对话内容；2.不确定时坦诚说明；3.回答准确有条理，善用结构化表达；4.用中文；5.用户消息开头的[当前时间]为真实时间，回答时间/日期问题时直接自然地说出，绝不提及"根据您提供的信息""根据消息"等来源表述，就像你自己知道一样；你的知识截止于2025年中。仅在用户明确要求查最新新闻/实时数据时才调用web_search，其余一律直接回答。';
var DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPT_PREFIX + '风格：专业严谨，擅长学术、编程、数学、深度分析与高质量写作，回答详尽有深度。';
var MAX_CONTEXT_TOKENS = 10000;
var SUMMARY_TRIGGER_COUNT = 16;
var SUMMARY_KEEP_RECENT = 4;

var SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '搜索互联网获取最新信息。仅在用户明确要求查询最新新闻、今日事件、实时数据等自身知识绝对无法覆盖的场景时调用。普通知识问题、历史事件、学术概念、编程问题等一律直接回答，不要搜索。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，用简洁精准的中文或英文表述'
        },
        topic: {
          type: 'string',
          enum: ['general', 'news'],
          description: '搜索类别：查新闻/今日事件/时事用news，其余用general'
        }
      },
      required: ['query']
    }
  }
};

function shouldEnableSearch(mc) {
  return !!mc && !!mc.supportsSearch && !!config.tavily && !!config.tavily.apiKey;
}

async function executeSearchTool(toolCall) {
  var args = {};
  try { args = JSON.parse(toolCall.function.arguments); } catch (e) { args = { query: toolCall.function.arguments }; }
  var query = args.query || '';
  if (!query.trim()) return JSON.stringify({ error: '搜索关键词不能为空' });

  try {
    var topic = args.topic || 'general';
    var searchOpts = { topic: topic };
    // News queries need fresh results
    if (topic === 'news') searchOpts.timeRange = 'day';
    var result = await tavilyService.search(query, searchOpts);
    var searchInfo = { _instruction: '严格基于下方搜索结果回答，仅陈述结果中明确提及的信息，不要编造、推断或补充结果中未提及的内容。如结果不足以回答，坦诚说明。', answer: result.answer, sources: result.results.map(function(r) { return { title: r.title, url: r.url, content: r.content }; }) };
    console.log('[Tavily] query="%s" topic=%s credits=%d', query, topic, result.credits);
    return JSON.stringify(searchInfo);
  } catch (err) {
    console.error('[Tavily] search error:', err.message);
    return JSON.stringify({ error: '搜索暂时不可用，请基于自身知识回答' });
  }
}

function estimateTokens(text) {
  if (!text) return 0;
  var cjk = 0;
  var ascii = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code > 0x7F) cjk++;
    else ascii++;
  }
  return Math.ceil(cjk / 1.5 + ascii / 4);
}

// Translate API body errors (from ApiBodyError) into user-friendly Chinese messages
function translateApiError(msg, code, modelLabel) {
  var m = (msg || '').toLowerCase();
  var c = (code || '').toLowerCase();
  var label = modelLabel || 'AI';

  if (m.indexOf('quota') > -1 || m.indexOf('insufficient') > -1 || c.indexOf('insufficient_quota') > -1) {
    return label + ' 模型额度已用完，请切换其他模型后重试';
  }
  if (m.indexOf('rate') > -1 || m.indexOf('429') > -1) return '请求过于频繁，请稍后再试';
  if (m.indexOf('invalid') > -1 || m.indexOf('token') > -1 || m.indexOf('key') > -1 || m.indexOf('auth') > -1) {
    return label + ' API 密钥无效，请联系管理员';
  }
  if (m.indexOf('invalid_response') > -1 || m.indexOf('stream_expected') > -1) {
    return label + ' 服务返回异常，请切换其他模型或稍后重试';
  }
  // Fallback: use the original message if it's short enough, otherwise generic
  if (msg && msg.length < 100) return 'AI 服务错误：' + msg;
  return 'AI 服务暂时不可用，请稍后重试';
}

// Extract the best error message from various error shapes:
// - ApiBodyError (our custom error from checkApiResponseBody)
// - AxiosError with response body containing error object (common with API proxies)
// - Plain Error with message
function extractApiError(err) {
  // 1. Our custom ApiBodyError
  if (err.apiError) {
    return { message: err.message, code: err.code || '', isApiError: true };
  }
  // 2. Axios HTTP error with JSON error body
  if (err.response && err.response.data) {
    var data = err.response.data;
    if (data.error) {
      var msg = '';
      var code = '';
      if (typeof data.error === 'object') {
        msg = data.error.message || JSON.stringify(data.error);
        code = data.error.code || data.error.type || '';
      } else if (typeof data.error === 'string') {
        msg = data.error;
      }
      if (msg) return { message: msg, code: code, isApiError: true };
    }
    if (data.message) return { message: data.message, code: '', isApiError: false };
  }
  // 3. Plain error
  return { message: err.message || '', code: err.code || '', isApiError: false };
}

// ============================================================
// 用户设置（user_settings.ai_settings_json）
// model 字段存 ai_models.id（'default' / 'deepseek' / 自定义 id）
// ============================================================

function getUserAiSettings(userId) {
  var row = db.prepare('SELECT ai_settings_json, deepseek_enabled FROM user_settings WHERE user_id = ?').get(userId);
  var settings = { system_prompt: '', pinned_conversations: [], model: '', policy_id: '' };
  if (row && row.ai_settings_json) {
    try {
      var parsed = JSON.parse(row.ai_settings_json);
      settings.system_prompt = parsed.system_prompt || '';
      settings.pinned_conversations = parsed.pinned_conversations || [];
      settings.model = parsed.model || '';
      settings.policy_id = parsed.policy_id || '';
      // 兼容旧字段：直接写过的 allowed_models 视为自定义策略前的过渡数据，忽略
    } catch (e) {}
  }
  settings.deepseek_enabled = row && row.deepseek_enabled === 1;
  return settings;
}

// ============================================================
// 使用策略（ai_policies）：预设模型授权方案，多选用户批量应用
// model_ids 空数组 = 不限制；策略被删时用户回落默认策略
// ============================================================

function getAllPolicies() {
  try {
    return db.prepare('SELECT * FROM ai_policies ORDER BY sort_order ASC, id ASC').all();
  } catch (e) {
    return null;
  }
}

function getPolicyRow(id) {
  if (!id) return null;
  try {
    return db.prepare('SELECT * FROM ai_policies WHERE id = ?').get(String(id));
  } catch (e) {
    return null;
  }
}

function getDefaultPolicyRow() {
  try {
    var row = db.prepare('SELECT * FROM ai_policies WHERE is_default = 1 LIMIT 1').get();
    if (row) return row;
  } catch (e) {}
  return null;
}

// 解析用户生效策略的允许模型集合；'' = 默认策略
// 返回 null = 不限制；空数组策略同样视为不限制（如内置「全部模型」策略）
function getPolicyAllowedIds(policyId) {
  var row = policyId ? getPolicyRow(policyId) : getDefaultPolicyRow();
  if (!row) return null; // 无策略体系（表不存在）→ 不限制
  try {
    var arr = JSON.parse(row.model_ids || '[]');
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr;
  } catch (e) {
    return null;
  }
}

function saveUserAiSettings(userId, settings) {
  var existing = db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(userId);
  var jsonStr = JSON.stringify({
    system_prompt: settings.system_prompt || '',
    pinned_conversations: settings.pinned_conversations || [],
    model: settings.model || '',
    policy_id: settings.policy_id || ''
  });
  if (existing) {
    db.prepare("UPDATE user_settings SET ai_settings_json = ?, updated_at = datetime('now') WHERE user_id = ?")
      .run(jsonStr, userId);
  } else {
    // 注意：user_settings 表无 created_at 列（见 migration 000 baseline），新用户首存走此分支
    db.prepare("INSERT INTO user_settings (user_id, ai_settings_json, updated_at) VALUES (?, ?, datetime('now'))")
      .run(userId, jsonStr);
  }
}

// ============================================================
// 模型解析（统一入口）
// ============================================================

// 用户可见的模型行（表不存在时回退 env 双 provider，兼容未迁移的库）
function getUserVisibleModels() {
  var list = aiService.getEnabledModels();
  if (list === null) {
    list = [{ id: 'default', label: 'GPT', color: '#f59e0b', supports_thinking: 0, supports_search: 0, is_free: 1 }];
    if (config.deepseek.apiKey) {
      list.push({ id: 'deepseek', label: 'DeepSeek', color: '#10b981', supports_thinking: 1, supports_search: 1, is_free: 0 });
    }
  }
  return list || [];
}

// 为用户解析实际使用的模型：
// 请求模型 > 用户保存的偏好 > 全局默认 > 第一个可用模型
// 全程受策略约束：不在策略允许集合内的模型视为不可用
function resolveUserModel(userId, requestedModel) {
  var visible = getUserVisibleModels();
  if (visible.length === 0) return null;

  var settings = getUserAiSettings(userId);
  var allowed = getPolicyAllowedIds(settings.policy_id); // null = 不限制

  function usable(id) {
    for (var i = 0; i < visible.length; i++) {
      if (visible[i].id !== id) continue;
      if (allowed !== null && allowed.indexOf(id) < 0) return false;
      return true;
    }
    return false;
  }

  var candidates = [];
  if (requestedModel) candidates.push(requestedModel);
  if (settings.model) candidates.push(settings.model);
  candidates.push(aiService.getDefaultModelId());

  for (var i = 0; i < candidates.length; i++) {
    if (usable(candidates[i])) {
      return aiService.resolveModel(candidates[i]);
    }
  }

  // 全部候选被策略排除 → 取策略允许的第一个可用模型
  for (var j = 0; j < visible.length; j++) {
    if (allowed === null || allowed.indexOf(visible[j].id) >= 0) {
      return aiService.resolveModel(visible[j].id);
    }
  }
  // 策略排除了全部启用模型 → 策略形同虚设，取第一个可用（宁可多给不可全禁）
  return aiService.resolveModel(visible[0].id);
}

// 主模型失败后的替代模型：全局默认（若不同）> 其他可用模型
// 与主选择同样受用户策略约束（故障回落不能绕过授权）
function getFallbackModel(primaryId, allowed) {
  function usable(id) {
    return allowed === null || allowed.indexOf(id) >= 0;
  }
  var defaultId = aiService.getDefaultModelId();
  if (defaultId && defaultId !== primaryId && usable(defaultId)) {
    var defMc = aiService.resolveModel(defaultId);
    if (defMc.enabled && defMc.apiUrl) return defMc;
  }
  var visible = getUserVisibleModels();
  for (var i = 0; i < visible.length; i++) {
    if (visible[i].id !== primaryId && usable(visible[i].id)) {
      var mc = aiService.resolveModel(visible[i].id);
      if (mc.enabled && mc.apiUrl) return mc;
    }
  }
  return null;
}

function getEffectiveSystemPrompt(convPersona, userSystemPrompt) {
  if (convPersona && convPersona.trim()) return convPersona.trim();
  if (userSystemPrompt && userSystemPrompt.trim()) return userSystemPrompt.trim();
  return DEFAULT_SYSTEM_PROMPT;
}

function buildAiMessages(messages, summary, systemPrompt, userMessage, enableThinking, maxContextTokens) {
  // Cache optimization: Use SYSTEM_PROMPT_PREFIX as immutable first message.
  // This prefix never changes across any request/conversation/user,
  // maximizing DeepSeek KV cache prefix hits (prompt_cache_hit_tokens).
  var aiMessages = [];

  // Layer 1: Immutable system prefix - always identical, maximizes cache hit
  aiMessages.push({ role: 'system', content: SYSTEM_PROMPT_PREFIX });

  // Layer 2: Variable persona suffix - only if different from immutable prefix
  var effectivePrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
  if (effectivePrompt !== SYSTEM_PROMPT_PREFIX) {
    aiMessages.push({ role: 'system', content: effectivePrompt });
  }

  // Layer 3: Historical messages - keep from the beginning for prefix stability
  // 预算上限：模型行配置（>0）优先于全局默认
  var contextBudget = maxContextTokens > 0 ? maxContextTokens : MAX_CONTEXT_TOKENS;
  var tokenBudget = contextBudget - estimateTokens(SYSTEM_PROMPT_PREFIX) - estimateTokens(userMessage);
  if (effectivePrompt !== SYSTEM_PROMPT_PREFIX) {
    tokenBudget -= estimateTokens(effectivePrompt);
  }
  if (summary) {
    tokenBudget -= estimateTokens(summary) + 50;
  }
  if (tokenBudget < 500) tokenBudget = 500;

  // Strategy: Keep early messages (stable prefix) + recent messages.
  // Per DeepSeek KV Cache docs, cache prefix must be fully matched to hit.
  // Budget split: 30% early (prefix-stable) + 70% recent (context-relevant).
  // Skip tool messages and assistant messages with tool_calls (intermediate search state)
  var visibleMessages = [];
  for (var vi = 0; vi < messages.length; vi++) {
    if (messages[vi].role === 'tool') continue;
    if (messages[vi].role === 'assistant' && messages[vi].tool_calls) continue;
    visibleMessages.push(messages[vi]);
  }

  var earlyMsgs = [];
  var earlyTokens = 0;
  var EARLY_BUDGET_RATIO = 0.3;
  var earlyBudget = Math.floor(tokenBudget * EARLY_BUDGET_RATIO);
  for (var i = 0; i < visibleMessages.length; i++) {
    var msgTokens = estimateTokens(visibleMessages[i].content || '') + 4;
    if (earlyTokens + msgTokens > earlyBudget) break;
    earlyMsgs.push(formatMessageForApi(visibleMessages[i], enableThinking));
    earlyTokens += msgTokens;
  }

  var recentMsgs = [];
  var recentTokens = 0;
  var recentBudget = tokenBudget - earlyTokens;
  for (var j = visibleMessages.length - 1; j >= earlyMsgs.length; j--) {
    var rMsgTokens = estimateTokens(visibleMessages[j].content || '') + 4;
    if (recentTokens + rMsgTokens > recentBudget) break;
    recentMsgs.unshift(formatMessageForApi(visibleMessages[j], enableThinking));
    recentTokens += rMsgTokens;
  }

  for (var k = 0; k < earlyMsgs.length; k++) {
    aiMessages.push(earlyMsgs[k]);
  }

  // Layer 4: Summary - only include if messages were truncated
  var messagesTruncated = earlyMsgs.length + recentMsgs.length < visibleMessages.length;
  if (summary && messagesTruncated) {
    aiMessages.push({
      role: 'system',
      content: '[历史摘要]\n' + summary + '\n[以上为历史摘要]'
    });
  }

  for (var l = 0; l < recentMsgs.length; l++) {
    aiMessages.push(recentMsgs[l]);
  }

  // Layer 5: User message with time context prepended
  // Time is injected into the user message to preserve KV cache prefix stability
  // (system messages remain identical across requests → cache hits)
  var now = new Date();
  var weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  var timePrefix = '[当前时间：' + now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + weekDays[now.getDay()] + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + '] ';
  aiMessages.push({ role: 'user', content: timePrefix + userMessage });
  return aiMessages;
}

// Format a stored message for the DeepSeek/OpenAI API.
// Per DeepSeek docs on thinking mode:
// - If the assistant made tool_calls, reasoning_content MUST be included (API returns 400 otherwise)
// - If no tool_calls, reasoning_content is optional (API ignores it)
// - tool messages must include tool_call_id
function formatMessageForApi(msg, enableThinking) {
  var formatted = { role: msg.role };

  if (msg.role === 'assistant') {
    formatted.content = msg.content || '';
    // Include reasoning_content when thinking mode is enabled
    // Per DeepSeek docs: always include it if present (safe to include, ignored when no tool_calls)
    if (enableThinking && msg.reasoning) {
      formatted.reasoning_content = msg.reasoning;
    }
    // Include tool_calls if present (for multi-turn tool call conversations)
    if (msg.tool_calls) {
      formatted.tool_calls = msg.tool_calls;
    }
  } else if (msg.role === 'tool') {
    formatted.content = msg.content || '';
    if (msg.tool_call_id) {
      formatted.tool_call_id = msg.tool_call_id;
    }
  } else {
    formatted.content = msg.content || '';
  }

  return formatted;
}

function appendMessageAtomic(conversationId, message) {
  var current = db.prepare('SELECT messages_json FROM conversations WHERE id = ?').get(conversationId);
  if (!current) return null;
  var messages = JSON.parse(current.messages_json || '[]');
  messages.push(message);
  db.prepare("UPDATE conversations SET messages_json = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(messages), conversationId);
  return messages;
}

function shouldGenerateSummary(messages, existingSummary) {
  if (messages.length < SUMMARY_TRIGGER_COUNT) return false;
  return true;
}

function generateSummaryAsync(conversationId, messages, existingSummary) {
  var summaryEnd = messages.length - SUMMARY_KEEP_RECENT;
  if (summaryEnd <= 0) return;

  var toSummarize = messages.slice(0, summaryEnd);
  if (toSummarize.length < 4) return;

  // Fixed system prompt for summary requests - maximizes cache hit across summary calls
  var summarySystemPrompt = '总结对话的关键信息、主题和用户情感倾向，只输出摘要，不含其他内容。';

  var summaryPrompt = [
    { role: 'system', content: summarySystemPrompt }
  ];

  var conversationText = '';
  if (existingSummary) {
    conversationText += '[之前的摘要]\n' + existingSummary + '\n\n[后续对话]\n';
  }
  for (var i = 0; i < toSummarize.length; i++) {
    conversationText += (toSummarize[i].role === 'user' ? '用户' : 'AI') + ': ' + toSummarize[i].content + '\n';
  }

  summaryPrompt.push({ role: 'user', content: conversationText });

  // Use default model for summary to save costs, fallback to any other enabled model
  var defaultId = aiService.getDefaultModelId();
  aiService.chatWithAI(summaryPrompt, { maxTokens: 200, temperature: 0.3, modelId: defaultId, userId: 'system-summary' }).catch(function() {
    var list = aiService.getEnabledModels() || [];
    for (var fi = 0; fi < list.length; fi++) {
      if (list[fi].id === defaultId) continue;
      return aiService.chatWithAI(summaryPrompt, { maxTokens: 200, temperature: 0.3, modelId: list[fi].id, userId: 'system-summary' });
    }
    throw new Error('no available model for summary');
  }).then(function(data) {
    var summary = '';
    if (data.choices && data.choices[0] && data.choices[0].message) {
      summary = data.choices[0].message.content || '';
    }
    if (summary) {
      db.prepare("UPDATE conversations SET summary = ?, summary_at = datetime('now') WHERE id = ?")
        .run(summary, conversationId);
    }
  }).catch(function(err) {
    console.error('Summary generation error:', err.message);
  });
}

router.use(auth.requireAuth);

// ============================================================
// 对话 CRUD（不变）
// ============================================================

router.get('/conversations', function(req, res) {
  var stmt = db.prepare('SELECT id, user_id, title, summary, persona, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC');
  var conversations = stmt.all(req.user.user_id);
  for (var i = 0; i < conversations.length; i++) {
    if (conversations[i].created_at) conversations[i].created_at = time.toISOString(conversations[i].created_at);
    if (conversations[i].updated_at) conversations[i].updated_at = time.toISOString(conversations[i].updated_at);
  }
  res.json({ code: 200, message: 'ok', data: conversations });
});

router.post('/conversations', function(req, res) {
  var id = uuid.v4();
  var title = req.body.title || '新对话';
  var stmt = db.prepare("INSERT INTO conversations (id, user_id, title, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))");
  stmt.run(id, req.user.user_id, title, '[]');
  res.json({ code: 200, message: 'ok', data: { id: id, title: title, created_at: time.nowISO(), updated_at: time.nowISO() } });
});

router.get('/conversations/:id', function(req, res) {
  var stmt = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?');
  var conv = stmt.get(req.params.id, req.user.user_id);
  if (!conv) {
    return res.status(404).json({ code: 404, message: '对话不存在' });
  }
  conv.messages = JSON.parse(conv.messages_json || '[]');
  delete conv.messages_json;
  if (conv.created_at) conv.created_at = time.toISOString(conv.created_at);
  if (conv.updated_at) conv.updated_at = time.toISOString(conv.updated_at);
  res.json({ code: 200, message: 'ok', data: conv });
});

router.patch('/conversations/:id', function(req, res) {
  var convStmt = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?');
  var existing = convStmt.get(req.params.id, req.user.user_id);
  if (!existing) {
    return res.status(404).json({ code: 404, message: '对话不存在' });
  }

  if (req.body.clear_messages) {
    var clearStmt = db.prepare("UPDATE conversations SET messages_json = '[]', summary = '', summary_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?");
    clearStmt.run(req.params.id, req.user.user_id);
  } else if (req.body.title !== undefined && req.body.persona !== undefined) {
    db.prepare("UPDATE conversations SET title = ?, persona = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(req.body.title, req.body.persona, req.params.id, req.user.user_id);
  } else if (req.body.title !== undefined) {
    var titleStmt = db.prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?");
    titleStmt.run(req.body.title, req.params.id, req.user.user_id);
  } else if (req.body.persona !== undefined) {
    db.prepare("UPDATE conversations SET persona = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(req.body.persona, req.params.id, req.user.user_id);
  }

  res.json({ code: 200, message: 'ok' });
});

router.delete('/conversations/:id', function(req, res) {
  var stmt = db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?');
  stmt.run(req.params.id, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
});

router.put('/conversations/:id/messages', function(req, res) {
  var convStmt = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?');
  var existing = convStmt.get(req.params.id, req.user.user_id);
  if (!existing) {
    return res.status(404).json({ code: 404, message: '对话不存在' });
  }
  var msgs = req.body.messages || [];
  db.prepare("UPDATE conversations SET messages_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(JSON.stringify(msgs), req.params.id, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
});

// ============================================================
// 模型 API（用户端）
// ============================================================

router.get('/models', function(req, res) {
  var visible = getUserVisibleModels();
  var defaultId = aiService.getDefaultModelId();
  var models = visible.map(function(row) {
    return {
      id: row.id,
      label: row.label,
      color: row.color || '#6366f1',
      is_free: !!row.is_free,
      supports_thinking: !!row.supports_thinking,
      supports_search: !!row.supports_search,
      is_default: row.id === defaultId
    };
  });
  var settings = getUserAiSettings(req.user.user_id);
  res.json({
    code: 200,
    message: 'ok',
    data: {
      models: models,
      default_model: defaultId,
      user_model: settings.model || '',
      // 服务端权威判定（班管经 requireAuth 动态提升），前端管理入口以此为准
      can_manage: req.user.is_admin === 1
    }
  });
});

// ============================================================
// 用户设置 API
// ============================================================

router.get('/settings', function(req, res) {
  var settings = getUserAiSettings(req.user.user_id);
  // deepseek_enabled：旧前端兼容字段（新版以 /models 为准）
  var visible = getUserVisibleModels();
  for (var i = 0; i < visible.length; i++) {
    if (visible[i].id === 'deepseek') { settings.deepseek_enabled = true; break; }
  }
  res.json({ code: 200, message: 'ok', data: settings });
});

router.put('/settings', function(req, res) {
  var current = getUserAiSettings(req.user.user_id);
  if (req.body.system_prompt !== undefined) {
    current.system_prompt = req.body.system_prompt;
  }
  if (req.body.pinned_conversations !== undefined) {
    current.pinned_conversations = req.body.pinned_conversations;
  }
  if (req.body.model !== undefined) {
    var visible = getUserVisibleModels();
    var found = false;
    for (var i = 0; i < visible.length; i++) {
      if (visible[i].id === req.body.model) { found = true; break; }
    }
    if (!found) {
      return res.status(400).json({ code: 400, message: '该模型不可用' });
    }
    current.model = req.body.model;
  }
  saveUserAiSettings(req.user.user_id, current);
  res.json({ code: 200, message: 'ok', data: current });
});

// ============================================================
// 管理端：AI 模型管理（仅 is_admin=1，班干不可用 —— 涉及 API Key）
// ============================================================

var adminGate = function(req, res, next) {
  if (req.user && req.user.is_admin === 1) return next();
  return res.status(403).json({ code: 403, message: '仅系统管理员可管理 AI 模型' });
};
router.use('/admin', adminGate);

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

// 管理端校验并规范化模型字段；errText 非空表示校验失败
function validateModelInput(body, isCreate) {
  var out = {};
  if (isCreate || body.label !== undefined) {
    var label = String(body.label || '').trim();
    if (!label) return { error: '模型名称不能为空' };
    if (label.length > 30) return { error: '模型名称过长（最多 30 字）' };
    out.label = label;
  }
  if (isCreate || body.api_url !== undefined) {
    var url = String(body.api_url || '').trim();
    if (isCreate && !url) return { error: 'API 地址不能为空（内置模型可留空以使用环境变量配置）' };
    if (url && !/^https?:\/\//i.test(url)) return { error: 'API 地址必须以 http:// 或 https:// 开头' };
    out.api_url = url;
  }
  if (isCreate || body.model !== undefined) {
    var model = String(body.model || '').trim();
    if (!model && isCreate) return { error: '模型标识（请求体 model 参数）不能为空' };
    out.model = model;
  }
  if (isCreate || body.api_key !== undefined) {
    out.api_key = String(body.api_key || '').trim();
  }
  if (body.color !== undefined) {
    var color = String(body.color || '').trim();
    out.color = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1';
  }
  if (body.api_style !== undefined) {
    out.api_style = body.api_style === 'deepseek' ? 'deepseek' : 'openai';
  }
  if (body.supports_thinking !== undefined) out.supports_thinking = body.supports_thinking ? 1 : 0;
  if (body.supports_search !== undefined) out.supports_search = body.supports_search ? 1 : 0;
  if (body.is_free !== undefined) out.is_free = body.is_free ? 1 : 0;
  if (body.enabled !== undefined) out.enabled = body.enabled ? 1 : 0;
  if (body.sort_order !== undefined) {
    var so = parseInt(body.sort_order, 10);
    out.sort_order = isNaN(so) ? 0 : Math.max(0, Math.min(9999, so));
  }
  if (body.max_context_tokens !== undefined) {
    var mct = parseInt(body.max_context_tokens, 10);
    out.max_context_tokens = isNaN(mct) ? 0 : Math.max(0, Math.min(200000, mct));
  }
  if (body.max_output_tokens !== undefined) {
    var mot = parseInt(body.max_output_tokens, 10);
    out.max_output_tokens = isNaN(mot) ? 0 : Math.max(0, Math.min(65536, mot));
  }
  if (body.reasoning_effort !== undefined) {
    var eff = String(body.reasoning_effort || '');
    out.reasoning_effort = ['low', 'medium', 'high'].indexOf(eff) >= 0 ? eff : '';
  }
  return { value: out };
}

// 全局默认迁移：defaultId 为新的默认模型（需 enabled），无可用模型则清空默认
function setDefaultModelId(newId) {
  db.prepare('UPDATE ai_models SET is_default = 0 WHERE is_default = 1').run();
  if (!newId) return;
  var row = db.prepare('SELECT enabled FROM ai_models WHERE id = ?').get(newId);
  if (row && row.enabled) {
    db.prepare('UPDATE ai_models SET is_default = 1, updated_at = datetime(\'now\') WHERE id = ?').run(newId);
  }
}

router.get('/admin/models', function(req, res) {
  var rows = aiService.getAllModels();
  if (rows === null) rows = [];
  var defaultId = aiService.getDefaultModelId();
  var data = rows.map(function(row) {
    var keyFromEnv = !row.api_key && (row.id === 'default' ? !!config.ai.apiKey : row.id === 'deepseek' ? !!config.deepseek.apiKey : false);
    var mc = aiService.resolveModel(row.id);
    return {
      id: row.id,
      label: row.label,
      api_url: row.api_url,
      effective_url: mc.apiUrl,
      api_key_masked: row.api_key ? maskKey(row.api_key) : (keyFromEnv ? '（来自环境变量）' : ''),
      has_key: !!row.api_key || keyFromEnv,
      key_from_env: keyFromEnv,
      model: row.model,
      color: row.color,
      api_style: row.api_style,
      supports_thinking: !!row.supports_thinking,
      supports_search: !!row.supports_search,
      is_free: !!row.is_free,
      enabled: !!row.enabled,
      is_default: row.id === defaultId,
      builtin: !!row.builtin,
      sort_order: row.sort_order,
      max_context_tokens: row.max_context_tokens || 0,
      max_output_tokens: row.max_output_tokens || 0,
      reasoning_effort: row.reasoning_effort || ''
    };
  });
  res.json({ code: 200, message: 'ok', data: { models: data, default_model: defaultId } });
});

router.post('/admin/models', function(req, res) {
  var id = String(req.body.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!id) {
    // 从 label 生成 id 兜底
    id = 'model-' + Date.now().toString(36);
  }
  if (id.length > 32) id = id.substring(0, 32);
  if (db.prepare('SELECT id FROM ai_models WHERE id = ?').get(id)) {
    return res.status(400).json({ code: 400, message: '模型 ID「' + id + '」已存在，请换一个' });
  }
  var check = validateModelInput(req.body, true);
  if (check.error) return res.status(400).json({ code: 400, message: check.error });
  var v = check.value;

  db.prepare([
    'INSERT INTO ai_models (id, label, api_url, api_key, model, color, api_style, supports_thinking, supports_search, is_free, enabled, is_default, builtin, sort_order)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)'
  ].join('\n')).run(
    id, v.label, v.api_url || '', v.api_key || '', v.model || '',
    v.color || '#6366f1', v.api_style || 'openai',
    v.supports_thinking || 0, v.supports_search || 0,
    v.is_free || 0, v.enabled === undefined ? 1 : v.enabled, v.sort_order || 100
  );

  // 单源多模型：从同源已有模型复制密钥（明文不出后端）
  if (!v.api_key && req.body.reuse_key_from) {
    var src = aiService.getModelRow(req.body.reuse_key_from);
    if (src && src.api_key) {
      db.prepare("UPDATE ai_models SET api_key = ? WHERE id = ?").run(src.api_key, id);
    }
  }

  if (req.body.is_default) setDefaultModelId(id);
  console.log('[AI-Admin] model created: %s (%s) by %s', id, v.label, req.user.user_id);
  res.json({ code: 200, message: 'ok', data: { id: id } });
});

// 注意：必须定义在 PUT /admin/models/:id 之前，否则 "default" 会被当作 :id 捕获
router.put('/admin/models/default', function(req, res) {
  var id = String(req.body.id || '');
  var row = aiService.getModelRow(id);
  if (!row) return res.status(404).json({ code: 404, message: '模型不存在' });
  if (!row.enabled) return res.status(400).json({ code: 400, message: '该模型已停用，请先启用' });
  setDefaultModelId(id);
  console.log('[AI-Admin] default model set: %s by %s', id, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
});

router.put('/admin/models/:id', function(req, res) {
  var row = aiService.getModelRow(req.params.id);
  if (!row) return res.status(404).json({ code: 404, message: '模型不存在' });

  var check = validateModelInput(req.body, false);
  if (check.error) return res.status(400).json({ code: 400, message: check.error });
  var v = check.value;

  var sets = [];
  var params = [];
  var allowed = ['label', 'api_url', 'model', 'color', 'api_style', 'supports_thinking', 'supports_search', 'is_free', 'enabled', 'sort_order', 'max_context_tokens', 'max_output_tokens', 'reasoning_effort'];
  for (var i = 0; i < allowed.length; i++) {
    var field = allowed[i];
    if (v[field] !== undefined) {
      sets.push(field + ' = ?');
      params.push(v[field]);
    }
  }
  // api_key：非空才更新（留空 = 不修改，避免管理面板误清空）
  if (v.api_key) {
    sets.push('api_key = ?');
    params.push(v.api_key);
  }
  // 自定义模型 api_url 不能清空
  if (v.api_url === '' && !row.builtin) {
    return res.status(400).json({ code: 400, message: '自定义模型的 API 地址不能为空' });
  }
  if (sets.length > 0) {
    params.push(row.id);
    // better-sqlite3 铁律：stmt 方法必须 apply(stmt, ...) 绑定 this，否则 Illegal invocation
    var stmt = db.prepare("UPDATE ai_models SET " + sets.join(', ') + ", updated_at = datetime('now') WHERE id = ?");
    stmt.run.apply(stmt, params);
  }

  if (req.body.is_default === true) setDefaultModelId(row.id);
  console.log('[AI-Admin] model updated: %s by %s', row.id, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
});

router.delete('/admin/models/:id', function(req, res) {
  var row = aiService.getModelRow(req.params.id);
  if (!row) return res.status(404).json({ code: 404, message: '模型不存在' });

  db.prepare('DELETE FROM ai_models WHERE id = ?').run(row.id);
  // 被删模型若是全局默认 → 迁移到剩余可用模型
  var remaining = aiService.getEnabledModels() || [];
  setDefaultModelId(remaining.length > 0 ? remaining[0].id : null);
  console.log('[AI-Admin] model deleted: %s by %s', row.id, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
});

router.put('/admin/models/:id/toggle', function(req, res) {
  var row = aiService.getModelRow(req.params.id);
  if (!row) return res.status(404).json({ code: 404, message: '模型不存在' });

  var enabled = req.body.enabled ? 1 : 0;
  db.prepare("UPDATE ai_models SET enabled = ?, updated_at = datetime('now') WHERE id = ?").run(enabled, row.id);
  // 禁用了默认模型 → 默认迁移
  if (!enabled && row.is_default) {
    var remaining = aiService.getEnabledModels() || [];
    setDefaultModelId(remaining.length > 0 ? remaining[0].id : null);
  }
  console.log('[AI-Admin] model %s: %s by %s', enabled ? 'enabled' : 'disabled', row.id, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
});

// ============================================================
// 使用策略（ai_policies）：预设模型授权方案，多选用户批量应用
// ============================================================

function validatePolicyInput(body, isCreate) {
  var out = {};
  if (isCreate || body.label !== undefined) {
    var label = String(body.label || '').trim();
    if (!label) return { error: '策略名称不能为空' };
    if (label.length > 20) return { error: '策略名称过长（最多 20 字）' };
    out.label = label;
  }
  if (isCreate || body.model_ids !== undefined) {
    var ids = Array.isArray(body.model_ids) ? body.model_ids : [];
    var clean = [];
    for (var i = 0; i < ids.length; i++) {
      var sid = String(ids[i] || '').trim();
      if (sid && clean.indexOf(sid) < 0) clean.push(sid);
    }
    out.model_ids = JSON.stringify(clean);
  }
  if (body.sort_order !== undefined) {
    var so = parseInt(body.sort_order, 10);
    out.sort_order = isNaN(so) ? 0 : Math.max(0, Math.min(9999, so));
  }
  return { value: out };
}

router.get('/admin/policies', function(req, res) {
  var rows = getAllPolicies() || [];
  var defRow = getDefaultPolicyRow();
  var defaultId = defRow ? defRow.id : '';
  var data = rows.map(function(row) {
    var ids = [];
    try { ids = JSON.parse(row.model_ids || '[]'); } catch (e) {}
    return {
      id: row.id,
      label: row.label,
      model_ids: ids,
      is_default: row.id === defaultId,
      sort_order: row.sort_order
    };
  });
  res.json({ code: 200, message: 'ok', data: { policies: data, default_policy: defaultId } });
});

router.post('/admin/policies', function(req, res) {
  var id = String(req.body.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!id) id = 'policy-' + Date.now().toString(36);
  if (id.length > 32) id = id.substring(0, 32);
  if (db.prepare('SELECT id FROM ai_policies WHERE id = ?').get(id)) {
    return res.status(400).json({ code: 400, message: '策略 ID「' + id + '」已存在' });
  }
  var check = validatePolicyInput(req.body, true);
  if (check.error) return res.status(400).json({ code: 400, message: check.error });
  var v = check.value;
  db.prepare('INSERT INTO ai_policies (id, label, model_ids, is_default, sort_order) VALUES (?, ?, ?, 0, ?)')
    .run(id, v.label, v.model_ids, v.sort_order || 10);
  if (req.body.is_default) {
    db.prepare('UPDATE ai_policies SET is_default = 0 WHERE is_default = 1').run();
    db.prepare("UPDATE ai_policies SET is_default = 1, updated_at = datetime('now') WHERE id = ?").run(id);
  }
  console.log('[AI-Admin] policy created: %s (%s) by %s', id, v.label, req.user.user_id);
  res.json({ code: 200, message: 'ok', data: { id: id } });
});

router.put('/admin/policies/:id', function(req, res) {
  var row = getPolicyRow(req.params.id);
  if (!row) return res.status(404).json({ code: 404, message: '策略不存在' });
  var check = validatePolicyInput(req.body, false);
  if (check.error) return res.status(400).json({ code: 400, message: check.error });
  var v = check.value;
  var sets = [];
  var params = [];
  if (v.label !== undefined) { sets.push('label = ?'); params.push(v.label); }
  if (v.model_ids !== undefined) { sets.push('model_ids = ?'); params.push(v.model_ids); }
  if (v.sort_order !== undefined) { sets.push('sort_order = ?'); params.push(v.sort_order); }
  if (sets.length > 0) {
    params.push(row.id);
    var stmt = db.prepare("UPDATE ai_policies SET " + sets.join(', ') + ", updated_at = datetime('now') WHERE id = ?");
    stmt.run.apply(stmt, params);
  }
  if (req.body.is_default === true) {
    db.prepare('UPDATE ai_policies SET is_default = 0 WHERE is_default = 1').run();
    db.prepare("UPDATE ai_policies SET is_default = 1, updated_at = datetime('now') WHERE id = ?").run(row.id);
  }
  console.log('[AI-Admin] policy updated: %s by %s', row.id, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
});

router.delete('/admin/policies/:id', function(req, res) {
  var row = getPolicyRow(req.params.id);
  if (!row) return res.status(404).json({ code: 404, message: '策略不存在' });
  if (row.is_default) return res.status(400).json({ code: 400, message: '默认策略不可删除' });
  db.prepare('DELETE FROM ai_policies WHERE id = ?').run(row.id);
  // 引用该策略的用户回落默认策略
  var users = db.prepare('SELECT user_id, ai_settings_json FROM user_settings WHERE ai_settings_json LIKE ?').all('%"policy_id":"' + row.id + '"%');
  for (var i = 0; i < users.length; i++) {
    try {
      var parsed = JSON.parse(users[i].ai_settings_json || '{}');
      if (parsed.policy_id === row.id) {
        parsed.policy_id = '';
        db.prepare("UPDATE user_settings SET ai_settings_json = ?, updated_at = datetime('now') WHERE user_id = ?")
          .run(JSON.stringify(parsed), users[i].user_id);
      }
    } catch (e) {}
  }
  console.log('[AI-Admin] policy deleted: %s (%d users reset) by %s', row.id, users.length, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
});

// 多选用户一次性应用策略（用户管理批量操作）
router.post('/admin/apply-policy', function(req, res) {
  var policyId = String(req.body.policy_id || '');
  var userIds = Array.isArray(req.body.user_ids) ? req.body.user_ids : [];
  if (userIds.length === 0) return res.status(400).json({ code: 400, message: '未选择用户' });
  if (userIds.length > 200) return res.status(400).json({ code: 400, message: '单次最多操作 200 个用户' });

  var policy = policyId ? getPolicyRow(policyId) : null;
  if (policyId && !policy) return res.status(404).json({ code: 404, message: '策略不存在' });
  var targetPolicyId = policyId; // 空串 = 解除限制（回落默认策略）

  var applied = 0;
  var insertRun = db.prepare("INSERT OR IGNORE INTO user_settings (user_id, ai_settings_json, updated_at) VALUES (?, ?, datetime('now'))");
  var updateStmt = db.prepare("UPDATE user_settings SET ai_settings_json = ?, updated_at = datetime('now') WHERE user_id = ?");
  for (var i = 0; i < userIds.length; i++) {
    var uid = String(userIds[i] || '').trim();
    if (!uid) continue;
    var row = db.prepare('SELECT ai_settings_json FROM user_settings WHERE user_id = ?').get(uid);
    var parsed = {};
    try { parsed = JSON.parse((row && row.ai_settings_json) || '{}'); } catch (e) {}
    parsed.policy_id = targetPolicyId;
    var jsonStr = JSON.stringify({
      system_prompt: parsed.system_prompt || '',
      pinned_conversations: parsed.pinned_conversations || [],
      model: parsed.model || '',
      policy_id: parsed.policy_id
    });
    if (row) {
      updateStmt.run(jsonStr, uid);
    } else {
      insertRun.run(uid, jsonStr);
    }
    applied++;
  }
  console.log('[AI-Admin] policy %s applied to %d users by %s', targetPolicyId || '(default)', applied, req.user.user_id);
  res.json({ code: 200, message: 'ok', data: { applied: applied, policy_id: targetPolicyId } });
});

// 用户策略绑定清单（用户管理列表展示用）：user_id -> policy_id 映射
router.get('/admin/user-policies', function(req, res) {
  var rows = db.prepare('SELECT user_id, ai_settings_json FROM user_settings').all();
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    try {
      var parsed = JSON.parse(rows[i].ai_settings_json || '{}');
      if (parsed.policy_id) map[rows[i].user_id] = parsed.policy_id;
    } catch (e) {}
  }
  res.json({ code: 200, message: 'ok', data: { map: map } });
});

// 测试连接：body 可带 { id }（测已保存配置）或完整配置（测未保存的新模型）
router.post('/admin/models/test', function(req, res) {
  var apiUrl, apiKey, modelName;
  if (req.body.id) {
    var row = aiService.getModelRow(req.body.id);
    if (!row) return res.status(404).json({ code: 404, message: '模型不存在' });
    var mc = aiService.resolveModel(row.id);
    apiUrl = mc.apiUrl; apiKey = mc.apiKey; modelName = mc.model;
  } else {
    apiUrl = String(req.body.api_url || '').trim();
    apiKey = String(req.body.api_key || '').trim();
    modelName = String(req.body.model || '').trim();
  }
  if (!apiUrl) return res.status(400).json({ code: 400, message: 'API 地址不能为空' });
  if (!modelName) return res.status(400).json({ code: 400, message: '模型标识不能为空' });

  var startedAt = Date.now();
  axios.post(apiUrl, {
    model: modelName,
    messages: [{ role: 'user', content: '你好，请回复"连接正常"四个字' }],
    max_tokens: 20,
    stream: false
  }, {
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    timeout: 15000
  }).then(function(response) {
    var latency = Date.now() - startedAt;
    var data = response.data || {};
    var reply = '';
    if (data.choices && data.choices[0] && data.choices[0].message) reply = (data.choices[0].message.content || '').trim();
    if (data.error) {
      var errMsg = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : String(data.error);
      return res.json({ code: 200, message: 'ok', data: { ok: false, message: 'API 返回错误：' + errMsg, latency_ms: latency } });
    }
    res.json({ code: 200, message: 'ok', data: { ok: true, message: '连接成功' + (reply ? '，模型回复：' + reply.substring(0, 50) : ''), latency_ms: latency } });
  }).catch(function(err) {
    var latency = Date.now() - startedAt;
    var message = '连接失败';
    if (err.code === 'ECONNABORTED') message = '连接超时（15 秒无响应）';
    else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') message = '无法连接到该地址，请检查 URL';
    else if (err.response) {
      var status = err.response.status;
      var detail = '';
      var bodyData = err.response.data;
      if (bodyData && bodyData.error) detail = typeof bodyData.error === 'object' ? (bodyData.error.message || '') : String(bodyData.error);
      if (status === 401) message = 'API 密钥无效（401）' + (detail ? '：' + detail : '');
      else if (status === 404) message = '接口或模型不存在（404）' + (detail ? '：' + detail : '');
      else if (status === 402) message = '余额不足（402）' + (detail ? '：' + detail : '');
      else message = 'HTTP ' + status + (detail ? '：' + detail : '');
    }
    res.json({ code: 200, message: 'ok', data: { ok: false, message: message, latency_ms: latency } });
  });
});

// ============================================================
// 聊天（/chat 与 /chat/stream）
// ============================================================

// 构造调用 aiService 的选项（统一 modelId 语义）
function buildAiOptions(mc, userId, thinking) {
  var opts = { modelId: mc.id, userId: userId };
  if (thinking && mc.supportsThinking) opts.thinking = true;
  return opts;
}

router.post('/chat', function(req, res) {
  var conversationId = req.body.conversation_id;
  var userMessage = req.body.message;
  var userSystemPrompt = req.body.system_prompt;
  var requestedModel = req.body.model;

  if (!userMessage) return res.status(400).json({ code: 400, message: '消息不能为空' });
  if (!conversationId) return res.status(400).json({ code: 400, message: '对话ID不能为空' });

  var conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, req.user.user_id);
  if (!conv) return res.status(404).json({ code: 404, message: '对话不存在' });

  var aiSettings = getUserAiSettings(req.user.user_id);
  var mc = resolveUserModel(req.user.user_id, requestedModel);
  if (!mc) return res.status(503).json({ code: 503, message: '暂无可用模型，请联系管理员启用' });

  var thinking = !!req.body.thinking && mc.supportsThinking;

  var systemPrompt = getEffectiveSystemPrompt(conv.persona, userSystemPrompt || aiSettings.system_prompt);
  var messages = JSON.parse(conv.messages_json || '[]');
  var summary = conv.summary || '';

  var aiMessages = buildAiMessages(messages, summary, systemPrompt, userMessage, thinking, mc.maxContextTokens);
  var isFirstMessage = messages.length === 0;

  appendMessageAtomic(conversationId, {
    role: 'user',
    content: userMessage,
    timestamp: new Date().toISOString()
  });

  var aiOptions = buildAiOptions(mc, req.user.user_id, thinking);
  if (shouldEnableSearch(mc)) {
    aiOptions.tools = [SEARCH_TOOL];
  }

  aiService.chatWithAI(aiMessages, aiOptions).then(async function(data) {
    // Handle tool calls loop (search)
    var maxToolRounds = 2;
    for (var round = 0; round < maxToolRounds; round++) {
      var choice = data.choices && data.choices[0];
      if (!choice || !choice.message || !choice.message.tool_calls || choice.message.tool_calls.length === 0) break;

      var toolCalls = choice.message.tool_calls;
      aiMessages.push(choice.message);

      for (var t = 0; t < toolCalls.length; t++) {
        var tc = toolCalls[t];
        var toolResult = await executeSearchTool(tc);
        aiMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
      }

      // Call AI again with tool results (no tools in follow-up to prevent infinite loops)
      var followUpOptions = Object.assign({}, aiOptions);
      delete followUpOptions.tools;
      delete followUpOptions.toolChoice;
      data = await aiService.chatWithAI(aiMessages, followUpOptions);
    }

    var aiContent = '';
    var reasoningContent = '';
    if (data.choices && data.choices[0] && data.choices[0].message) {
      aiContent = data.choices[0].message.content || '';
      if (thinking) {
        reasoningContent = data.choices[0].message.reasoning_content || '';
      }
    }

    var finalMessages = finishAssistantReply(conversationId, {
      content: aiContent,
      reasoning: reasoningContent,
      isFirstMessage: isFirstMessage,
      userMessage: userMessage,
      summary: summary,
      usedModelId: mc.id,
      usage: data.usage || null
    });

    var responseData = {
      content: aiContent,
      title: isFirstMessage ? userMessage.substring(0, 30) : null,
      model: mc.id,
      model_label: mc.label
    };
    if (reasoningContent) responseData.reasoning = reasoningContent;
    if (finalMessages && shouldGenerateSummary(finalMessages, summary)) {
      generateSummaryAsync(conversationId, finalMessages, summary);
    }
    res.json({ code: 200, message: 'ok', data: responseData });
  }).catch(function(err) {
    // 主模型失败 → 尝试替代模型（全局默认或其他可用模型）
    var fbMc = getFallbackModel(mc.id, getPolicyAllowedIds(aiSettings.policy_id));
    if (fbMc) {
      console.log('[Fallback] %s failed (%s), retrying with %s...', mc.id, err.message, fbMc.id);
      var fbThinking = thinking && fbMc.supportsThinking;
      var fbOptions = buildAiOptions(fbMc, req.user.user_id, fbThinking);
      return aiService.chatWithAI(aiMessages, fbOptions).then(function(data) {
        var aiContent = '';
        var reasoningContent = '';
        if (data.choices && data.choices[0] && data.choices[0].message) {
          aiContent = data.choices[0].message.content || '';
          if (fbThinking) {
            reasoningContent = data.choices[0].message.reasoning_content || '';
          }
        }
        var finalMessages = finishAssistantReply(conversationId, {
          content: aiContent,
          reasoning: reasoningContent,
          isFirstMessage: isFirstMessage,
          userMessage: userMessage,
          summary: summary,
          usedModelId: fbMc.id,
          usage: data.usage || null
        });
        var responseData = { content: aiContent, title: isFirstMessage ? userMessage.substring(0, 30) : null, model: fbMc.id, model_label: fbMc.label, fallback: true };
        if (reasoningContent) responseData.reasoning = reasoningContent;
        if (finalMessages && shouldGenerateSummary(finalMessages, summary)) {
          generateSummaryAsync(conversationId, finalMessages, summary);
        }
        res.json({ code: 200, message: 'ok', data: responseData });
      }).catch(function(fallbackErr) {
        console.error('AI chat fallback error:', fallbackErr.message);
        var fbApiErr = extractApiError(fallbackErr);
        var errorMsg = fbApiErr.isApiError
          ? translateApiError(fbApiErr.message, fbApiErr.code, fbMc.label)
          : mapNetworkError(fallbackErr);
        res.status(502).json({ code: 502, message: errorMsg });
      });
    }
    console.error('AI chat error:', err.message);
    var apiErr = extractApiError(err);
    var errorMsg = apiErr.isApiError
      ? translateApiError(apiErr.message, apiErr.code, mc.label)
      : mapNetworkError(err);
    res.status(502).json({ code: 502, message: errorMsg });
  });
});

// 网络层错误 → 用户可读文案
function mapNetworkError(err) {
  if (err.code === 'ECONNABORTED') return 'AI 响应超时，请稍后重试';
  if (err.code === 'ECONNREFUSED' || err.code === 'ERR_NETWORK' || err.code === 'ENOTFOUND') return '无法连接到 AI 服务，请检查网络';
  if (err.response) {
    var status = err.response.status;
    if (status === 401) return 'API 密钥无效，请联系管理员更新配置';
    if (status === 402) return 'AI 服务余额不足，请联系管理员';
    if (status === 403) return 'AI 服务访问被拒绝，请切换其他模型后重试';
    if (status === 429) return '请求过于频繁，请稍后再试';
    if (status === 422) return '请求参数错误';
    if (status >= 500) return 'AI 服务内部错误，请稍后重试';
    return 'AI 服务错误（' + status + '），请稍后重试';
  }
  return 'AI 服务暂时不可用，请稍后重试';
}

// 落库助手回复 + 首条消息命名 + usage 日志（chat 与 fallback 共用）
function finishAssistantReply(conversationId, p) {
  if (!p.content) {
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);
    return null;
  }
  var msgData = { role: 'assistant', content: p.content, timestamp: new Date().toISOString() };
  if (p.reasoning) msgData.reasoning = p.reasoning;
  var finalMessages = appendMessageAtomic(conversationId, msgData);
  if (p.isFirstMessage) {
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(p.userMessage.substring(0, 30), conversationId);
  }
  if (p.usage) {
    var hitRate = p.usage.prompt_tokens > 0
      ? Math.round((p.usage.prompt_cache_hit_tokens || 0) / p.usage.prompt_tokens * 100)
      : 0;
    console.log('[Cache] conv=%s model=%s hit=%d miss=%d rate=%d%%',
      conversationId.substring(0, 8), p.usedModelId,
      p.usage.prompt_cache_hit_tokens || 0,
      p.usage.prompt_cache_miss_tokens || 0, hitRate);
  }
  return finalMessages;
}

router.post('/chat/stream', function(req, res) {
  var conversationId = req.body.conversation_id;
  var userMessage = req.body.message;
  var userSystemPrompt = req.body.system_prompt;
  var requestedModel = req.body.model;

  if (!userMessage) return res.status(400).json({ code: 400, message: '消息不能为空' });
  if (!conversationId) return res.status(400).json({ code: 400, message: '对话ID不能为空' });

  var conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, req.user.user_id);
  if (!conv) return res.status(404).json({ code: 404, message: '对话不存在' });

  var aiSettings = getUserAiSettings(req.user.user_id);
  var mc = resolveUserModel(req.user.user_id, requestedModel);
  if (!mc) return res.status(503).json({ code: 503, message: '暂无可用模型，请联系管理员启用' });

  var thinking = !!req.body.thinking && mc.supportsThinking;

  var systemPrompt = getEffectiveSystemPrompt(conv.persona, userSystemPrompt || aiSettings.system_prompt);
  var messages = JSON.parse(conv.messages_json || '[]');
  var summary = conv.summary || '';

  var aiMessages = buildAiMessages(messages, summary, systemPrompt, userMessage, thinking, mc.maxContextTokens);
  var isFirstMessage = messages.length === 0;

  appendMessageAtomic(conversationId, {
    role: 'user',
    content: userMessage,
    timestamp: new Date().toISOString()
  });

  var fullContent = '';
  var fullReasoning = '';
  var assistantSaved = false;

  function saveAssistantMessage() {
    if (assistantSaved) return;
    assistantSaved = true;

    if (fullContent) {
      var msgData = {
        role: 'assistant',
        content: fullContent,
        timestamp: new Date().toISOString()
      };
      if (fullReasoning) {
        msgData.reasoning = fullReasoning;
      }

      var finalMessages = appendMessageAtomic(conversationId, msgData);

      if (isFirstMessage) {
        db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(userMessage.substring(0, 30), conversationId);
      }

      if (finalMessages && shouldGenerateSummary(finalMessages, summary)) {
        generateSummaryAsync(conversationId, finalMessages, summary);
      }
    } else {
      db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);
    }
  }

  res.on('close', function() {
    if (!res.writableEnded) {
      saveAssistantMessage();
    }
  });

  var aiOptions = buildAiOptions(mc, req.user.user_id, thinking);
  aiOptions.onContent = function(content) {
    fullContent += content;
  };
  aiOptions.onReasoning = function(reasoning) {
    fullReasoning += reasoning;
  };
  var enableSearch = shouldEnableSearch(mc);
  if (enableSearch) {
    aiOptions.tools = [SEARCH_TOOL];
  }

  // For stream mode with search enabled, we need to handle tool_calls.
  // Strategy: Use non-stream for the first call to detect tool_calls,
  // then stream the final response after search results are injected.
  if (enableSearch) {
    var nonStreamOptions = Object.assign({}, aiOptions);
    delete nonStreamOptions.stream;
    delete nonStreamOptions.onContent;
    delete nonStreamOptions.onReasoning;

    aiService.chatWithAI(aiMessages, nonStreamOptions).then(async function(data) {
      var maxToolRounds = 2;
      for (var round = 0; round < maxToolRounds; round++) {
        var choice = data.choices && data.choices[0];
        if (!choice || !choice.message || !choice.message.tool_calls || choice.message.tool_calls.length === 0) break;

        var toolCalls = choice.message.tool_calls;
        aiMessages.push(choice.message);

        // Notify frontend about search (don't send intermediate content)
        var searchQuery = '';
        try { searchQuery = JSON.parse(toolCalls[0].function.arguments).query || ''; } catch (e) { searchQuery = toolCalls[0].function.arguments; }
        res.write('data: ' + JSON.stringify({ searching: true, query: searchQuery }) + '\n\n');

        for (var t = 0; t < toolCalls.length; t++) {
          var tc = toolCalls[t];
          var toolResult = await executeSearchTool(tc);
          aiMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
        }

        res.write('data: ' + JSON.stringify({ searching: false }) + '\n\n');

        var followUpOptions = Object.assign({}, nonStreamOptions);
        delete followUpOptions.tools;
        delete followUpOptions.toolChoice;
        data = await aiService.chatWithAI(aiMessages, followUpOptions);
      }

      // Stream the final content manually
      var aiContent = '';
      var reasoningContent = '';
      if (data.choices && data.choices[0] && data.choices[0].message) {
        aiContent = data.choices[0].message.content || '';
        if (thinking) reasoningContent = data.choices[0].message.reasoning_content || '';
      }

      if (reasoningContent) {
        fullReasoning = reasoningContent;
        res.write('data: ' + JSON.stringify({ reasoning: reasoningContent }) + '\n\n');
      }
      if (aiContent) {
        fullContent = aiContent;
        // Use 'replace' action so frontend replaces content instead of appending
        res.write('data: ' + JSON.stringify({ content: aiContent, action: 'replace' }) + '\n\n');
      }
      if (data.usage) {
        res.write('data: ' + JSON.stringify({ usage: data.usage }) + '\n\n');
      }
      res.write('data: ' + JSON.stringify({ done: true }) + '\n\n');
      res.end();
      saveAssistantMessage();
    }).catch(function(err) {
      console.error('AI stream+search error:', err.message);
      if (!res.writableEnded) {
        var ssApiErr = extractApiError(err);
        var ssErrMsg = ssApiErr.isApiError ? translateApiError(ssApiErr.message, ssApiErr.code, mc.label) : 'AI 服务暂时不可用';
        res.write('data: ' + JSON.stringify({ error: ssErrMsg }) + '\n\n');
        res.write('data: ' + JSON.stringify({ done: true }) + '\n\n');
        res.end();
      }
      saveAssistantMessage();
    });
  } else {
    aiService.chatWithAIStream(aiMessages, res, aiOptions).then(function() {
      saveAssistantMessage();
    }).catch(function(streamErr) {
      // chatWithAIStream 失败时可能已自行结束响应（sendSSE error + res.end），
      // 此时不能再 fallback，否则触发 ERR_STREAM_WRITE_AFTER_END 崩溃
      var fbMc = res.writableEnded ? null : getFallbackModel(mc.id, getPolicyAllowedIds(aiSettings.policy_id));
      if (fbMc) {
        console.log('[Fallback] %s stream failed (%s), retrying with %s...', mc.id, streamErr ? streamErr.message : 'unknown', fbMc.id);
        res.write('data: ' + JSON.stringify({ fallback: true, model: fbMc.id, model_label: fbMc.label }) + '\n\n');
        var fbThinking = thinking && fbMc.supportsThinking;
        var fallbackOptions = buildAiOptions(fbMc, req.user.user_id, fbThinking);
        fallbackOptions.onContent = function(content) {
          fullContent += content;
        };
        fallbackOptions.onReasoning = function(reasoning) {
          if (fbThinking) fullReasoning += reasoning;
        };
        aiService.chatWithAIStream(aiMessages, res, fallbackOptions).then(function() {
          saveAssistantMessage();
        }).catch(function(fbErr) {
          if (!res.writableEnded) {
            var fbApiErr = extractApiError(fbErr);
            var fbErrMsg = fbApiErr.isApiError ? translateApiError(fbApiErr.message, fbApiErr.code, fbMc.label) : 'AI 服务暂时不可用，请稍后重试';
            res.write('data: ' + JSON.stringify({ error: fbErrMsg }) + '\n\n');
            res.write('data: ' + JSON.stringify({ done: true }) + '\n\n');
          }
          saveAssistantMessage();
        });
      } else {
        if (!res.writableEnded) {
          var seApiErr = streamErr ? extractApiError(streamErr) : { isApiError: false };
          var seErrMsg = seApiErr.isApiError ? translateApiError(seApiErr.message, seApiErr.code, mc.label) : 'AI 服务暂时不可用，请稍后重试';
          res.write('data: ' + JSON.stringify({ error: seErrMsg }) + '\n\n');
          res.write('data: ' + JSON.stringify({ done: true }) + '\n\n');
        }
        saveAssistantMessage();
      }
    });
  }
});

module.exports = router;
