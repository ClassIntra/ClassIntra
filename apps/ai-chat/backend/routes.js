var express = require('express');
var router = express.Router();
var db = require('../../../server/src/utils/db');
var auth = require('../../../server/src/middleware/auth');
var aiService = require('../../../server/src/services/ai-chat');
var tavilyService = require('../../../server/src/services/tavily');
var uuid = require('uuid');
var time = require('../../../server/src/utils/time');
var config = require('../../../server/src/config');

var SYSTEM_PROMPT_PREFIX = '你是小深，专业且温暖的AI助手。规则：1.每段对话独立，绝不引用其他对话内容；2.不确定时坦诚说明；3.回答准确有条理，善用结构化表达；4.用中文；5.用户消息开头的[当前时间]为真实时间，回答时间/日期问题时直接自然地说出，绝不提及"根据您提供的信息""根据消息"等来源表述，就像你自己知道一样；你的知识截止于2025年中。仅在用户明确要求查最新新闻/实时数据时才调用web_search，其余一律直接回答。';
var DEFAULT_SYSTEM_PROMPT_DS = SYSTEM_PROMPT_PREFIX + '风格：专业严谨，擅长学术、编程、数学、深度分析与高质量写作，回答详尽有深度。';
var DEFAULT_SYSTEM_PROMPT_GPT = SYSTEM_PROMPT_PREFIX + '风格：温暖亲切，擅长日常交流、情感陪伴与轻松对话，像一位关心你的朋友。';
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

function shouldEnableSearch(provider) {
  return provider === 'deepseek' && config.tavily && config.tavily.apiKey;
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
function translateApiError(msg, code, provider) {
  var m = (msg || '').toLowerCase();
  var c = (code || '').toLowerCase();

  if (m.indexOf('quota') > -1 || m.indexOf('insufficient') > -1 || c.indexOf('insufficient_quota') > -1) {
    if (provider === 'default') return 'GPT 模型免费额度已用完，请切换到 DeepSeek 后重试';
    return 'AI 模型额度已用完，请联系管理员';
  }
  if (m.indexOf('rate') > -1 || m.indexOf('429') > -1) return '请求过于频繁，请稍后再试';
  if (m.indexOf('invalid') > -1 || m.indexOf('token') > -1 || m.indexOf('key') > -1 || m.indexOf('auth') > -1) {
    if (provider === 'default') return 'GPT API 密钥无效，请联系管理员更新配置';
    return 'API 密钥无效，请联系管理员';
  }
  if (m.indexOf('invalid_response') > -1 || m.indexOf('stream_expected') > -1) {
    if (provider === 'default') return 'GPT 服务返回异常，可能已失效，请切换到 DeepSeek 后重试';
    return 'AI 服务返回异常，请稍后重试';
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

function getUserAiSettings(userId) {
  var row = db.prepare('SELECT ai_settings_json, deepseek_enabled FROM user_settings WHERE user_id = ?').get(userId);
  var settings = { system_prompt: '', pinned_conversations: [], model: 'default', gpt_model: config.ai.model };
  if (row && row.ai_settings_json) {
    try {
      var parsed = JSON.parse(row.ai_settings_json);
      settings.system_prompt = parsed.system_prompt || '';
      settings.pinned_conversations = parsed.pinned_conversations || [];
      settings.model = parsed.model || 'default';
      settings.gpt_model = parsed.gpt_model || config.ai.model;
    } catch (e) {}
  }
  settings.deepseek_enabled = row && row.deepseek_enabled === 1;
  return settings;
}

function saveUserAiSettings(userId, settings) {
  var existing = db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(userId);
  var jsonStr = JSON.stringify({
    system_prompt: settings.system_prompt || '',
    pinned_conversations: settings.pinned_conversations || [],
    model: settings.model || 'default',
    gpt_model: settings.gpt_model || config.ai.model
  });
  if (existing) {
    db.prepare("UPDATE user_settings SET ai_settings_json = ?, updated_at = datetime('now') WHERE user_id = ?")
      .run(jsonStr, userId);
  } else {
    db.prepare("INSERT INTO user_settings (user_id, ai_settings_json, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))")
      .run(userId, jsonStr);
  }
}

// Resolve the actual GPT model to use: user preference > config default
function getGptModel(userId, requestedModel) {
  if (requestedModel && config.ai.availableModels.indexOf(requestedModel) >= 0) {
    return requestedModel;
  }
  var settings = getUserAiSettings(userId);
  if (settings.gpt_model && config.ai.availableModels.indexOf(settings.gpt_model) >= 0) {
    return settings.gpt_model;
  }
  return config.ai.model;
}

function getProviderForUser(userId, requestedModel) {
  var settings = getUserAiSettings(userId);
  var model = requestedModel || settings.model || 'default';

  if (model === 'deepseek') {
    if (!settings.deepseek_enabled) {
      return { provider: 'default', reason: 'deepseek_not_enabled' };
    }
    if (!config.deepseek.apiKey) {
      return { provider: 'default', reason: 'deepseek_not_configured' };
    }
    return { provider: 'deepseek' };
  }

  return { provider: 'default' };
}

function getDefaultPrompt(provider) {
  return provider === 'deepseek' ? DEFAULT_SYSTEM_PROMPT_DS : DEFAULT_SYSTEM_PROMPT_GPT;
}

function buildAiMessages(messages, summary, systemPrompt, userMessage, enableThinking) {
  // Cache optimization: Use SYSTEM_PROMPT_PREFIX as immutable first message.
  // This prefix never changes across any request/conversation/user,
  // maximizing DeepSeek KV cache prefix hits (prompt_cache_hit_tokens).
  var aiMessages = [];

  // Layer 1: Immutable system prefix - always identical, maximizes cache hit
  aiMessages.push({ role: 'system', content: SYSTEM_PROMPT_PREFIX });

  // Layer 2: Variable persona suffix - only if different from immutable prefix
  var effectivePrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT_DS;
  if (effectivePrompt !== SYSTEM_PROMPT_PREFIX) {
    aiMessages.push({ role: 'system', content: effectivePrompt });
  }

  // Layer 3: Historical messages - keep from the beginning for prefix stability
  var tokenBudget = MAX_CONTEXT_TOKENS - estimateTokens(SYSTEM_PROMPT_PREFIX) - estimateTokens(userMessage);
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

function cleanMessagesForApi(messages) {
  var cleaned = [];
  for (var i = 0; i < messages.length; i++) {
    var m = { role: messages[i].role, content: messages[i].content };
    cleaned.push(m);
  }
  return cleaned;
}

function getEffectiveSystemPrompt(convPersona, userSystemPrompt, provider) {
  if (convPersona && convPersona.trim()) return convPersona.trim();
  if (userSystemPrompt && userSystemPrompt.trim()) return userSystemPrompt.trim();
  return getDefaultPrompt(provider || 'default');
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

  // Use free default model for summary to save costs, fallback to deepseek only if it fails
  aiService.chatWithAI(summaryPrompt, { maxTokens: 200, temperature: 0.3, userId: 'system-summary' }).catch(function() {
    return aiService.chatWithAI(summaryPrompt, { maxTokens: 200, temperature: 0.3, provider: 'deepseek', userId: 'system-summary' });
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

router.post('/chat', function(req, res) {
  var conversationId = req.body.conversation_id;
  var userMessage = req.body.message;
  var userSystemPrompt = req.body.system_prompt;
  var requestedModel = req.body.model;
  var requestedGptModel = req.body.gpt_model;
  var thinking = !!req.body.thinking;

  if (!userMessage) return res.status(400).json({ code: 400, message: '消息不能为空' });
  if (!conversationId) return res.status(400).json({ code: 400, message: '对话ID不能为空' });

  var conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, req.user.user_id);
  if (!conv) return res.status(404).json({ code: 404, message: '对话不存在' });

  var aiSettings = getUserAiSettings(req.user.user_id);
  var providerInfo = getProviderForUser(req.user.user_id, requestedModel);
  var provider = providerInfo.provider;

  if (thinking && provider !== 'deepseek') thinking = false;

  var systemPrompt = getEffectiveSystemPrompt(conv.persona, userSystemPrompt || aiSettings.system_prompt, provider);
  var messages = JSON.parse(conv.messages_json || '[]');
  var summary = conv.summary || '';

  var aiMessages = buildAiMessages(messages, summary, systemPrompt, userMessage, thinking);
  var isFirstMessage = messages.length === 0;

  appendMessageAtomic(conversationId, {
    role: 'user',
    content: userMessage,
    timestamp: new Date().toISOString()
  });

  var aiOptions = { provider: provider, userId: req.user.user_id };
  if (provider === 'default') {
    aiOptions.model = getGptModel(req.user.user_id, requestedGptModel);
  }
  if (thinking) aiOptions.thinking = true;
  if (shouldEnableSearch(provider)) {
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

    var msgData = {
      role: 'assistant',
      content: aiContent,
      timestamp: new Date().toISOString()
    };
    if (reasoningContent) {
      msgData.reasoning = reasoningContent;
    }

    var finalMessages = appendMessageAtomic(conversationId, msgData);

    if (isFirstMessage) {
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(userMessage.substring(0, 30), conversationId);
    }

    if (finalMessages && shouldGenerateSummary(finalMessages, summary)) {
      generateSummaryAsync(conversationId, finalMessages, summary);
    }

    var responseData = { content: aiContent, title: isFirstMessage ? userMessage.substring(0, 30) : null, model: provider };
    if (reasoningContent) responseData.reasoning = reasoningContent;
    if (data.usage) {
      responseData.usage = {
        prompt_tokens: data.usage.prompt_tokens || 0,
        completion_tokens: data.usage.completion_tokens || 0,
        cache_hit: data.usage.prompt_cache_hit_tokens || 0,
        cache_miss: data.usage.prompt_cache_miss_tokens || 0
      };
      var hitRate = data.usage.prompt_tokens > 0
        ? Math.round((data.usage.prompt_cache_hit_tokens || 0) / data.usage.prompt_tokens * 100)
        : 0;
      console.log('[Cache] user=%s conv=%s hit=%d miss=%d rate=%d%% provider=%s',
        req.user.user_id, conversationId.substring(0, 8),
        data.usage.prompt_cache_hit_tokens || 0,
        data.usage.prompt_cache_miss_tokens || 0,
        hitRate, provider);
    }
    res.json({ code: 200, message: 'ok', data: responseData });
  }).catch(function(err) {
    if (provider === 'default' && aiSettings.deepseek_enabled && config.deepseek.apiKey) {
      console.log('[Fallback] Default model failed, retrying with DeepSeek...');
      var fallbackOptions = { provider: 'deepseek', userId: req.user.user_id };
      if (thinking) fallbackOptions.thinking = true;
      return aiService.chatWithAI(aiMessages, fallbackOptions).then(function(data) {
        var aiContent = '';
        var reasoningContent = '';
        if (data.choices && data.choices[0] && data.choices[0].message) {
          aiContent = data.choices[0].message.content || '';
          if (thinking) {
            reasoningContent = data.choices[0].message.reasoning_content || '';
          }
        }
        var msgData = { role: 'assistant', content: aiContent, timestamp: new Date().toISOString() };
        if (reasoningContent) msgData.reasoning = reasoningContent;
        var finalMessages = appendMessageAtomic(conversationId, msgData);
        if (isFirstMessage) {
          db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(userMessage.substring(0, 30), conversationId);
        }
        if (finalMessages && shouldGenerateSummary(finalMessages, summary)) {
          generateSummaryAsync(conversationId, finalMessages, summary);
        }
        var responseData = { content: aiContent, title: isFirstMessage ? userMessage.substring(0, 30) : null, model: 'deepseek', fallback: true };
        if (reasoningContent) responseData.reasoning = reasoningContent;
        if (data.usage) {
          responseData.usage = {
            prompt_tokens: data.usage.prompt_tokens || 0,
            completion_tokens: data.usage.completion_tokens || 0,
            cache_hit: data.usage.prompt_cache_hit_tokens || 0,
            cache_miss: data.usage.prompt_cache_miss_tokens || 0
          };
          var hitRate2 = data.usage.prompt_tokens > 0
            ? Math.round((data.usage.prompt_cache_hit_tokens || 0) / data.usage.prompt_tokens * 100)
            : 0;
          console.log('[Cache] user=%s conv=%s hit=%d miss=%d rate=%d%% provider=deepseek(fallback)',
            req.user.user_id, conversationId.substring(0, 8),
            data.usage.prompt_cache_hit_tokens || 0,
            data.usage.prompt_cache_miss_tokens || 0,
            hitRate2);
        }
        res.json({ code: 200, message: 'ok', data: responseData });
      }).catch(function(fallbackErr) {
        console.error('AI chat fallback error:', fallbackErr.message);
        var fbApiErr = extractApiError(fallbackErr);
        var errorMsg;
        if (fbApiErr.isApiError) {
          errorMsg = translateApiError(fbApiErr.message, fbApiErr.code, 'deepseek');
        } else if (fallbackErr.code === 'ECONNABORTED') errorMsg = 'AI 响应超时，请稍后重试';
        else if (fallbackErr.code === 'ECONNREFUSED' || fallbackErr.code === 'ERR_NETWORK') errorMsg = '无法连接到 AI 服务，请检查网络';
        else if (fallbackErr.response) {
          var fbStatus = fallbackErr.response.status;
          if (fbStatus === 401) errorMsg = 'API 密钥无效';
          else if (fbStatus === 402 || fbStatus === 403) errorMsg = 'AI 服务余额不足，请联系管理员';
          else if (fbStatus === 429) errorMsg = '请求过于频繁，请稍后再试';
          else if (fbStatus >= 500) errorMsg = 'AI 服务内部错误，请稍后重试';
          else errorMsg = 'AI 服务错误（' + fbStatus + '），请稍后重试';
        } else {
          errorMsg = 'AI 服务暂时不可用，请稍后重试';
        }
        res.status(502).json({ code: 502, message: errorMsg });
      });
    }
    console.error('AI chat error:', err.message);
    var apiErr = extractApiError(err);
    var errorMsg;
    if (apiErr.isApiError) {
      errorMsg = translateApiError(apiErr.message, apiErr.code, provider);
    } else if (err.code === 'ECONNABORTED') errorMsg = 'AI 响应超时，请稍后重试';
    else if (err.code === 'ECONNREFUSED' || err.code === 'ERR_NETWORK') errorMsg = '无法连接到 AI 服务，请检查网络';
    else if (err.response) {
      var status = err.response.status;
      if (status === 401) errorMsg = 'API 密钥无效，请联系管理员更新配置';
      else if (status === 402) errorMsg = 'AI 服务余额不足，请联系管理员';
      else if (status === 403) errorMsg = 'GPT 服务访问被拒绝，可能配额已用完，请切换到 DeepSeek 后重试';
      else if (status === 429) errorMsg = '请求过于频繁，请稍后再试';
      else if (status === 422) errorMsg = '请求参数错误';
      else if (status >= 500) errorMsg = 'AI 服务内部错误，请稍后重试';
      else errorMsg = 'AI 服务错误（' + status + '），请稍后重试';
    } else {
      errorMsg = 'AI 服务暂时不可用，请稍后重试';
    }
    res.status(502).json({ code: 502, message: errorMsg });
  });
});

router.post('/chat/stream', function(req, res) {
  var conversationId = req.body.conversation_id;
  var userMessage = req.body.message;
  var userSystemPrompt = req.body.system_prompt;
  var requestedModel = req.body.model;
  var requestedGptModel = req.body.gpt_model;
  var thinking = !!req.body.thinking;

  if (!userMessage) return res.status(400).json({ code: 400, message: '消息不能为空' });
  if (!conversationId) return res.status(400).json({ code: 400, message: '对话ID不能为空' });

  var conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, req.user.user_id);
  if (!conv) return res.status(404).json({ code: 404, message: '对话不存在' });

  var aiSettings = getUserAiSettings(req.user.user_id);
  var providerInfo = getProviderForUser(req.user.user_id, requestedModel);
  var provider = providerInfo.provider;

  if (thinking && provider !== 'deepseek') thinking = false;

  var systemPrompt = getEffectiveSystemPrompt(conv.persona, userSystemPrompt || aiSettings.system_prompt, provider);
  var messages = JSON.parse(conv.messages_json || '[]');
  var summary = conv.summary || '';

  var aiMessages = buildAiMessages(messages, summary, systemPrompt, userMessage, thinking);
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

  var aiOptions = {
    provider: provider,
    userId: req.user.user_id,
    onContent: function(content) {
      fullContent += content;
    },
    onReasoning: function(reasoning) {
      fullReasoning += reasoning;
    }
  };
  if (provider === 'default') {
    aiOptions.model = getGptModel(req.user.user_id, requestedGptModel);
  }
  if (thinking) aiOptions.thinking = true;
  if (shouldEnableSearch(provider)) {
    aiOptions.tools = [SEARCH_TOOL];
  }

  // For stream mode with search enabled, we need to handle tool_calls.
  // Strategy: Use non-stream for the first call to detect tool_calls,
  // then stream the final response after search results are injected.
  if (shouldEnableSearch(provider)) {
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
        var ssErrMsg = ssApiErr.isApiError ? translateApiError(ssApiErr.message, ssApiErr.code, provider) : 'AI 服务暂时不可用';
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
      if (provider === 'default' && aiSettings.deepseek_enabled && config.deepseek.apiKey) {
        console.log('[Fallback] Default model stream failed (' + (streamErr ? streamErr.message : 'unknown') + '), retrying with DeepSeek...');
        res.write('data: ' + JSON.stringify({ fallback: true, model: 'deepseek' }) + '\n\n');
        var fallbackOptions = {
          provider: 'deepseek',
          userId: req.user.user_id,
          onContent: function(content) {
            fullContent += content;
          },
          onReasoning: function(reasoning) {
            if (thinking) fullReasoning += reasoning;
          }
        };
        if (thinking) fallbackOptions.thinking = true;
        aiService.chatWithAIStream(aiMessages, res, fallbackOptions).then(function() {
          saveAssistantMessage();
        }).catch(function(fbErr) {
          if (!res.writableEnded) {
            var fbApiErr = extractApiError(fbErr);
            var fbErrMsg = fbApiErr.isApiError ? translateApiError(fbApiErr.message, fbApiErr.code, 'deepseek') : 'AI 服务暂时不可用，请稍后重试';
            res.write('data: ' + JSON.stringify({ error: fbErrMsg }) + '\n\n');
            res.write('data: ' + JSON.stringify({ done: true }) + '\n\n');
          }
          saveAssistantMessage();
        });
      } else {
        if (!res.writableEnded) {
          var seApiErr = streamErr ? extractApiError(streamErr) : { isApiError: false };
          var seErrMsg = seApiErr.isApiError ? translateApiError(seApiErr.message, seApiErr.code, provider) : 'AI 服务暂时不可用，请稍后重试';
          res.write('data: ' + JSON.stringify({ error: seErrMsg }) + '\n\n');
          res.write('data: ' + JSON.stringify({ done: true }) + '\n\n');
        }
        saveAssistantMessage();
      }
    });
  }
});

router.get('/settings', function(req, res) {
  var settings = getUserAiSettings(req.user.user_id);
  settings.available_gpt_models = config.ai.availableModels;
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
    if (req.body.model === 'deepseek' && !current.deepseek_enabled) {
      return res.status(403).json({ code: 403, message: 'DeepSeek 模型未启用，请联系管理员' });
    }
    current.model = req.body.model;
  }
  if (req.body.gpt_model !== undefined) {
    if (config.ai.availableModels.indexOf(req.body.gpt_model) < 0) {
      return res.status(400).json({ code: 400, message: '不支持的 GPT 模型' });
    }
    current.gpt_model = req.body.gpt_model;
  }
  saveUserAiSettings(req.user.user_id, current);
  res.json({ code: 200, message: 'ok', data: current });
});

module.exports = router;
