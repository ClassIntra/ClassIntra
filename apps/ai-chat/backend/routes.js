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
var cloudStore = require('../../../server/src/services/cloud-store');
var appConfig = require('../../../server/src/utils/app-config');

// ---- 视觉（看图）全局开关与限额 ----
// 「统一转述模型」存 app_config（app_name='ai-chat'），改完即时生效、无需重启：
// 当前对话模型不支持视觉时，用它把图片先转成文字，再把文字喂给对话模型。
var AI_APP_NAME = 'ai-chat';
var VISION_KEY_RELAY = 'vision_relay_model';
var VISION_KEY_ENABLED = 'vision_enabled';
var MAX_VISION_IMAGES = 4;                 // 单次最多几张图（模型行可覆盖）
var MAX_IMAGE_BYTES = 4 * 1024 * 1024;     // 单图 4MB（转 base64 后约 5.4MB 请求体）
// 图片在上下文预算里的粗略占位：视觉模型按切块计价，一张常规图约 1k~1.5k token
var IMAGE_TOKEN_RESERVE = 1200;

// Layer 1（不可变前缀）：这段文本**每个请求完全一致**，是 KV prefix 缓存命中的基础。
// 改动它会一次性失效全部历史缓存（只影响第一次请求的命中率），但请避免频繁改。
// 写法取向：只放"每次都该遵守"的硬规则；风格类描述放 DEFAULT_SYSTEM_PROMPT（Layer 2）。
var SYSTEM_PROMPT_PREFIX = '你是「小深」，可靠、克制、务实的中文 AI 助手。始终遵守：\n' +
  '1. 准确优先：不确定就直说「不确定」并说明怎样才能确认；绝不编造事实、数据、引用或链接。\n' +
  '2. 每段对话彼此独立，绝不引用、暗示其他对话的内容。\n' +
  '3. 默认 Markdown：要点用列表或小标题，对比用表格；数学用 LaTeX（行内 $...$，独立公式 $$...$$）；代码块必须标注语言且保证可运行。\n' +
  '4. 不复述用户的问题，不写「作为一个 AI」「很高兴为您解答」这类客套话，直接给结论；篇幅随问题复杂度伸缩。\n' +
  '5. 用中文回答（用户明确要求其他语言时除外）。你的知识截止于 2025 年中，此后的变化可能已过时。\n' +
  '6. 用户消息开头的 [当前时间] 是真实时间，回答时间或日期问题时自然直说，不要提及信息来源。\n' +
  '7. 仅当用户明确要求最新新闻、今日事件、实时数据（价格、比分、天气等）时才调用 web_search，其余一律直接回答；搜索不足以回答时如实说明。\n' +
  '8. 篇幅与结构随问题伸缩：能三句讲清就别写三段；复杂问题先一句结论开场，再用小标题分段展开。不为了显得全面而堆砌与问题无关的内容，不做无意义的重复总结。\n' +
  '9. 计算、代码、数据推导要给过程与结果；推测与未验证的内容必须显式标注（如「这一步是推测」），绝不把猜测写成事实。';
var DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPT_PREFIX + '\n\n' +
  '当前风格：专业严谨，擅长学术、编程、数学与深度分析。回答要有结构、有取舍——先给结论或思路再展开论证，' +
  '该给的公式、代码、步骤完整给出，不确定之处明确标注。';
var MAX_CONTEXT_TOKENS = 10000;
var SUMMARY_TRIGGER_COUNT = 16;
var SUMMARY_KEEP_RECENT = 4;

var SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '搜索互联网获取最新信息。仅当用户明确要求查询最新新闻、今日事件、实时数据（天气、比分、股价、价格、航班等）或自身知识截止之后才发生的事情时才调用。' +
      '普通知识问题、历史事件、学术概念、编程与写作类请求一律直接回答，不要搜索。每次对话最多调用一次，关键词要精炼。',
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

// 是否「值得」为了联网搜索牺牲流式体验。
// 老逻辑：只要模型支持搜索，流式接口就先发一次**非流式**请求去探测 tool_calls——
// 也就是用户要等整段回答生成完才看到第一个字，首字延迟直接等于整轮耗时。
// 实测下来绝大多数问题根本不需要搜索，所以先做一次廉价的字面判断：
// 只有问题里出现实时性诉求/明确要求搜索时，才走「先探测再流」的慢路径；
// 其余请求直接流式，不挂 tools（模型本来也不该搜）。
var SEARCH_HINT_RE = /(今天|今日|明日|昨晚|刚刚|最新|最近|近日|现在|当前|实时|此刻|新闻|资讯|快讯|公告通知|天气|气温|下雨|台风|股价|股票|大盘|基金|净值|汇率|金价|油价|价格表|多少钱|售价|票价|比分|赛程|赛果|积分榜|排名|榜单|热搜|上映|开售|发售|更新到|截至)/;
function looksLikeSearchRequest(text) {
  var s = String(text || '').slice(0, 300);
  if (!s) return false;
  if (/(搜索|搜一下|查一下|帮我查|联网|上网查|查查)/.test(s)) return true;
  return SEARCH_HINT_RE.test(s);
}

// ============================================================
// 视觉（看图）：云盘图片 → 视觉模型 / 统一转述模型
// ============================================================

// 转述提示词：固定文本，保证每次请求前缀一致（省 KV 缓存），且只要求"描述"不要求"回答"
var VISION_RELAY_PROMPT = '你是图片转述器：把用户发来的图片转成一段纯文本模型也能看懂的描述。\n' +
  '1) 第一句用一句话概括这张图是什么；\n' +
  '2) 然后分点列出关键内容：画面主体与布局、出现的文字（逐字完整抄录，含数字、单位、公式）、表格结构与数据、颜色与位置关系；\n' +
  '3) 图里有文字就必须完整抄录，这是最重要的部分；\n' +
  '4) 只输出描述本身，不要评价、不要寒暄、不要说"这张图片显示了"。';

function getVisionSetting(key) {
  try {
    var vals = appConfig.readValues(AI_APP_NAME);
    return String(vals[key] || '').trim();
  } catch (e) {
    return '';
  }
}

function getVisionRelayModelId() {
  return getVisionSetting(VISION_KEY_RELAY);
}

function isVisionEnabled() {
  return getVisionSetting(VISION_KEY_ENABLED) !== '0';
}

// 判定本次请求怎么处理图片：
//   native —— 当前模型直接收图片内容块
//   relay  —— 当前模型不支持视觉，交给管理员配置的统一转述模型先转成文字
//   none   —— 都不行，请求应被拒绝（前端提前灰掉入口，这里是后端兜底）
function resolveVisionMode(mc) {
  if (!mc) return { mode: 'none', relay: null };
  if (!isVisionEnabled()) return { mode: 'none', relay: null, disabled: true };
  if (mc.supportsVision) return { mode: 'native', relay: null };
  var relayId = getVisionRelayModelId();
  if (relayId && relayId !== mc.id) {
    var relay = aiService.resolveModel(relayId);
    if (relay && relay.enabled && relay.supportsVision && relay.apiUrl) {
      return { mode: 'relay', relay: relay };
    }
  }
  return { mode: 'none', relay: null };
}

function visionMaxImages(mc) {
  var n = mc && mc.visionMaxImages ? mc.visionMaxImages : MAX_VISION_IMAGES;
  return Math.max(1, Math.min(6, n));
}

// 校验并读取云盘图片：只认「该用户云盘里确实有」的图片，避免越权读别人的文件
// images: [{ hash }] → { items: [{hash,name,mime,bytes,dataUrl}] } 或 { error: '...' }
function resolveImageAttachments(userId, images) {
  if (!images || !images.length) return { items: [] };
  var list = Array.isArray(images) ? images : [images];
  var items = [];
  for (var i = 0; i < list.length; i++) {
    var raw = list[i];
    var hash = String((raw && raw.hash) || raw || '').trim();
    if (!hash) continue;
    var r = cloudStore.readUserFile(hash, userId, MAX_IMAGE_BYTES);
    if (r.error) return { error: r.error };
    if (!cloudStore.isImageMime(r.mime)) {
      return { error: '「' + r.name + '」不是图片文件' };
    }
    items.push({
      hash: r.hash,
      name: r.name,
      mime: r.mime,
      bytes: r.size,
      url: '/api/cloud/files/' + r.hash,
      dataUrl: cloudStore.toImageDataUrl(r.buffer, r.mime)
    });
    if (items.length >= MAX_VISION_IMAGES) break;
  }
  return { items: items };
}

// 用转述模型把一张图说成文字（非流式，短输出，失败即抛给调用方）
// 返回 { text, usage, modelId }
function describeImage(relayMc, item, userText) {
  var content = [];
  content.push({
    type: 'text',
    text: userText ? ('用户想问的是：' + userText + '\n请先转述图片，再由对话模型回答。') : '请转述这张图片。'
  });
  content.push({ type: 'image_url', image_url: { url: item.dataUrl } });
  var messages = [
    { role: 'system', content: VISION_RELAY_PROMPT },
    { role: 'user', content: content }
  ];
  var opts = { modelId: relayMc.id, maxTokens: 1200, temperature: 0.2 };
  return aiService.chatWithAI(messages, opts).then(function(data) {
    var text = '';
    if (data && data.choices && data.choices[0] && data.choices[0].message) {
      text = data.choices[0].message.content || '';
    }
    return { text: text, usage: (data && data.usage) || null, modelId: relayMc.id };
  });
}

// 多张图依次转述（串行：并发打同一个 key 容易撞限流），拼成一段可注入正文的文本
// 返回 { text, usage, tokensByCall }
function describeImages(relayMc, items, userText) {
  var texts = [];
  var usage = null;
  var seq = Promise.resolve();
  items.forEach(function(item, idx) {
    seq = seq.then(function() {
      return describeImage(relayMc, item, idx === 0 ? userText : '').then(function(r) {
        texts.push('[图片' + (items.length > 1 ? (idx + 1) : '') + '：' + item.name + ']\n' + (r.text || '（转述失败，图片可能无法识别）'));
        usage = addUsage(usage, r.usage);
      });
    });
  });
  return seq.then(function() {
    return { text: texts.join('\n\n'), usage: usage };
  });
}

// ctx 可选：{ userId, conversationId, modelId } —— 用于把搜索次数记进用量流水
async function executeSearchTool(toolCall, ctx) {
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
    var searchInfo = { _instruction: '严格基于下方搜索结果回答：只陈述结果中明确提及的信息，不编造、不推断、不补充结果中未提及的内容。若结果不足以回答，直接说明「搜索结果不足」并给出已知的部分。回答末尾用 [标题](链接) 列出你实际引用的来源（1~3 条）。', answer: result.answer, sources: result.results.map(function(r) { return { title: r.title, url: r.url, content: r.content }; }) };
    console.log('[Tavily] query="%s" topic=%s credits=%d', query, topic, result.credits);
    if (ctx) {
      recordUsage({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        modelId: ctx.modelId || '',
        source: 'search',
        searchCredits: result.credits || 1
      });
    }
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

// ============================================================
// 用量记账（migration 013）—— 只记账，不做额度闸门 / 余额扣减
//
// 单价存「微元/千token」（INTEGER），管理端按「元/百万token」录入后 ×1000：
//   微元每千 = 元每百万 × 1000    （¥18/1M → 18000；¥0.1/1M → 100）
// 成本同样以微元存（1 元 = 1,000,000 微元），展示时再除，全程整数运算。
//
// 记账是旁路：任何异常只写日志，绝不阻断对话主流程。
// ============================================================

var MICRO_PER_YUAN_PER_MILLION = 1000;

// 元/百万 token → 微元/千 token（录入落库）
function toMicroPerK(yuanPerMillion) {
  var n = Number(yuanPerMillion);
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(n * MICRO_PER_YUAN_PER_MILLION);
}

// 微元/千 token → 元/百万 token（管理端展示）
function fromMicroPerK(microPerK) {
  var n = Number(microPerK);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n / MICRO_PER_YUAN_PER_MILLION * 10000) / 10000;
}

// ============================================================
// 价格规则引擎（migration 014）
//
// 基准价挂在 ai_models 行上（每模型一组）；ai_price_rules 提供「覆盖」：
//   kind='price'    绝对单价覆盖（峰谷价、临时改价）
//   kind='discount' 基准价 × discount_percent/100（打优惠）
//   kind='free'     限免：计 0 成本，token 仍照记
// 命中多条时取 priority 最小者；同优先级「模型专用」优先于「全局」。
// 时段按规则自带时区换算 —— 峰谷价通常按厂商时区（DeepSeek 闲时用 UTC）。
// ============================================================

// 'HH:MM' → 当天分钟数；空/非法 → null（该侧不限制）
function minutesOfDay(hhmm) {
  var s = String(hhmm || '').trim();
  if (!s) return null;
  var m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  var h = parseInt(m[1], 10);
  var mi = parseInt(m[2], 10);
  if (!isFinite(h) || !isFinite(mi) || h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// 按规则时区把 UTC 毫秒拆成「当地星期 / 当天分钟 / 当地日期」
function ruleLocalParts(utcMs, offsetMinutes) {
  var d = new Date(utcMs + (offsetMinutes || 0) * 60000);
  var dow = d.getUTCDay(); // 0 = 周日
  return {
    dow: dow === 0 ? 7 : dow,
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    date: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
  };
}

// 时段命中：start > end 视为跨零点（如 16:30 → 00:30）；start == end 视为全天
function inTimeRange(minutes, start, end) {
  if (start === null && end === null) return true;
  if (start === null) start = 0;
  if (end === null) end = start;
  if (start === end) return true;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

// '1,2,3,4,5'（1=周一..7=周日）| '*' = 不限 → 数组或 null
function parseDays(spec) {
  var s = String(spec || '').trim();
  if (!s || s === '*') return null;
  var out = [];
  var parts = s.split(',');
  for (var i = 0; i < parts.length; i++) {
    var n = parseInt(parts[i], 10);
    if (n >= 1 && n <= 7) out.push(n);
  }
  return out.length ? out : null;
}

// 规则是否命中：模型 + 生效日期区间（含两端）+ 星期 + 时段，全部满足
function ruleMatches(rule, modelId, utcMs) {
  if (rule.model_id && rule.model_id !== modelId) return false;
  var p = ruleLocalParts(utcMs, rule.timezone_offset);
  var from = String(rule.valid_from || '').trim();
  if (from && p.date < from) return false;
  var until = String(rule.valid_until || '').trim();
  if (until && p.date > until) return false;
  var days = parseDays(rule.days_of_week);
  if (days && days.indexOf(p.dow) < 0) return false;
  return inTimeRange(p.minutes, minutesOfDay(rule.start_time), minutesOfDay(rule.end_time));
}

// 候选规则（启用 + 模型匹配），已按「优先级升序、模型专用优先」排好
function getPriceRules(modelId) {
  try {
    return db.prepare([
      'SELECT * FROM ai_price_rules',
      'WHERE enabled = 1 AND (model_id = \'\' OR model_id = ?)',
      'ORDER BY priority ASC, CASE WHEN model_id = \'\' THEN 1 ELSE 0 END ASC, id ASC'
    ].join('\n')).all(String(modelId || ''));
  } catch (e) {
    return null; // 表不存在（旧库未跑 014）
  }
}

// 解析「此刻该模型该用什么单价」
// 返回 { priceIn, priceOut, priceCacheHit, free, ruleId, ruleLabel, base }
// base = 1 表示未命中任何规则，用的是模型基准价
function resolvePrice(mc, utcMs) {
  var when = utcMs || Date.now();
  var basePrice = {
    priceIn: (mc && mc.priceIn) || 0,
    priceOut: (mc && mc.priceOut) || 0,
    priceCacheHit: (mc && mc.priceCacheHit) || 0
  };
  var base = {
    priceIn: basePrice.priceIn, priceOut: basePrice.priceOut, priceCacheHit: basePrice.priceCacheHit,
    free: !!(mc && mc.isFree), ruleId: '', ruleLabel: '', base: 1
  };

  var modelId = (mc && mc.id) || '';
  var rules = getPriceRules(modelId);
  if (!rules || !rules.length) return base;

  for (var i = 0; i < rules.length; i++) {
    var r = rules[i];
    if (!ruleMatches(r, modelId, when)) continue;
    if (r.kind === 'free') {
      return { priceIn: 0, priceOut: 0, priceCacheHit: 0, free: true, ruleId: r.id, ruleLabel: r.label, base: 0 };
    }
    if (r.kind === 'discount') {
      var pct = parseInt(r.discount_percent, 10);
      if (!isFinite(pct) || pct < 0) pct = 100;
      if (pct > 1000) pct = 1000;
      return {
        priceIn: Math.round(basePrice.priceIn * pct / 100),
        priceOut: Math.round(basePrice.priceOut * pct / 100),
        priceCacheHit: Math.round(basePrice.priceCacheHit * pct / 100),
        free: false, ruleId: r.id, ruleLabel: r.label, base: 0
      };
    }
    return {
      priceIn: r.price_in || 0, priceOut: r.price_out || 0, priceCacheHit: r.price_cache_hit || 0,
      free: false, ruleId: r.id, ruleLabel: r.label, base: 0
    };
  }
  return base;
}

// 单次调用成本（微元）。price 为 resolvePrice 的解析结果（已含峰谷/折扣/限免）。
// free 时记 0 成本但 token 照记。
function calcCostMicro(price, usage) {
  if (!price || price.free) return 0;
  var promptTok = usage.prompt_tokens || 0;
  var compTok = usage.completion_tokens || 0;
  var hitTok = usage.prompt_cache_hit_tokens || 0;
  var cost = 0;
  // 命中部分已含在 prompt_tokens 内，必须拆开算，否则重复计费；
  // 未配命中价（=0）时命中部分回落按输入价计，避免少收。
  if (hitTok > 0 && price.priceCacheHit > 0) {
    cost += Math.max(0, promptTok - hitTok) / 1000 * (price.priceIn || 0);
    cost += hitTok / 1000 * price.priceCacheHit;
  } else {
    cost += promptTok / 1000 * (price.priceIn || 0);
  }
  cost += compTok / 1000 * (price.priceOut || 0);
  return Math.round(cost);
}

// 上游未回 usage 时的兜底估算（recordUsage 会打 estimated 标记，非精确账）
function estimateUsage(promptTokens, content) {
  var p = Math.max(0, promptTokens || 0);
  var c = estimateTokens(content || '');
  return {
    prompt_tokens: p,
    completion_tokens: c,
    total_tokens: p + c,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: p
  };
}

// 请求侧 token 估算：上游不回 usage 时用它补一个 prompt 计数
function estimatePromptTokens(messages) {
  var total = 0;
  for (var i = 0; i < (messages || []).length; i++) {
    var m = messages[i];
    if (!m) continue;
    if (typeof m.content === 'string') {
      total += estimateTokens(m.content);
    } else if (Array.isArray(m.content)) {
      // 多模态内容块：文本按字符估，图片按固定占位（真实计价以 tokens_details 为准）
      for (var ci = 0; ci < m.content.length; ci++) {
        var part = m.content[ci];
        if (!part) continue;
        if (typeof part.text === 'string') total += estimateTokens(part.text);
        else if (part.image_url) total += IMAGE_TOKEN_RESERVE;
      }
    }
    if (Array.isArray(m.tool_calls)) {
      for (var j = 0; j < m.tool_calls.length; j++) {
        total += estimateTokens(m.tool_calls[j].function && m.tool_calls[j].function.arguments);
      }
    }
  }
  return total;
}

// 合并两段 usage（搜索分支会连发两次请求：先探测工具调用、再出正式回答）
function addUsage(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return {
    prompt_tokens: (a.prompt_tokens || 0) + (b.prompt_tokens || 0),
    completion_tokens: (a.completion_tokens || 0) + (b.completion_tokens || 0),
    total_tokens: (a.total_tokens || 0) + (b.total_tokens || 0),
    prompt_cache_hit_tokens: (a.prompt_cache_hit_tokens || 0) + (b.prompt_cache_hit_tokens || 0),
    prompt_cache_miss_tokens: (a.prompt_cache_miss_tokens || 0) + (b.prompt_cache_miss_tokens || 0)
  };
}

// 缓存命中字段归一：不同上游用的字段名不一样，统一成
// prompt_cache_hit_tokens / prompt_cache_miss_tokens 两个内部字段。
//   DeepSeek   prompt_cache_hit_tokens / prompt_cache_miss_tokens（原生）
//   OpenAI 系  prompt_tokens_details.cached_tokens
//   偶见中转   cached_tokens
//   Anthropic  cache_read_input_tokens
// 不做归一的后果：OpenAI 系模型的命中部分会被当成全价输入 → 成本高估（命中价常为输入价的 1~5 折）。
function normalizeCacheFields(u) {
  if (!u) return u;
  var promptTok = u.prompt_tokens || 0;
  var hit = u.prompt_cache_hit_tokens;
  if (hit === undefined || hit === null) {
    var details = u.prompt_tokens_details;
    if (details && typeof details.cached_tokens === 'number') hit = details.cached_tokens;
    else if (typeof u.cached_tokens === 'number') hit = u.cached_tokens;
    else if (typeof u.cache_read_input_tokens === 'number') hit = u.cache_read_input_tokens;
  }
  if (typeof hit === 'number' && hit > 0) {
    // 防御：上游字段偶有超过 prompt_tokens 的脏值
    if (promptTok > 0 && hit > promptTok) hit = promptTok;
    u.prompt_cache_hit_tokens = hit;
    if (u.prompt_cache_miss_tokens === undefined) {
      u.prompt_cache_miss_tokens = Math.max(0, promptTok - hit);
    }
  }
  return u;
}

var insertUsageStmt = null;

// 落一条用量流水。表不存在（旧库未跑 013）时静默跳过。
function recordUsage(p) {
  try {
    var source = p.source || 'chat';
    var usage = p.usage || null;
    var estimated = 0;
    var hasUsage = !!usage && (usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined);
    if (!hasUsage) {
      if (source === 'search') {
        // 联网搜索不产生 token，只记 credits
        usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0 };
      } else if (p.promptTokens === undefined && !p.content) {
        return;
      } else {
        usage = estimateUsage(p.promptTokens, p.content);
        estimated = 1;
      }
    }
    usage = normalizeCacheFields(usage);
    var mc = p.mc || (p.modelId ? aiService.resolveModel(p.modelId) : null);
    var promptTok = usage.prompt_tokens || 0;
    var compTok = usage.completion_tokens || 0;
    var hitTok = usage.prompt_cache_hit_tokens || 0;
    var missTok = usage.prompt_cache_miss_tokens || Math.max(0, promptTok - hitTok);
    var totalTok = usage.total_tokens || (promptTok + compTok);
    // 结算当时的价格快照：峰谷/折扣/限免在这一刻定格，
    // 事后改基准价或增删规则都不会篡改历史账（报表只读快照列）。
    var price = source === 'search' ? null : resolvePrice(mc, p.priceAt || Date.now());
    var costMicro = price ? calcCostMicro(price, usage) : 0;

    if (!insertUsageStmt) {
      insertUsageStmt = db.prepare([
        'INSERT INTO ai_usage_log',
        '  (user_id, conversation_id, model_id, source, prompt_tokens, completion_tokens,',
        '   cache_hit_tokens, cache_miss_tokens, total_tokens, cost_micro, estimated, search_credits,',
        '   rule_id, rule_label, price_in_snapshot, price_out_snapshot, price_cache_hit_snapshot)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ].join('\n'));
    }
    insertUsageStmt.run(
      String(p.userId || ''), String(p.conversationId || ''), String(p.modelId || ''),
      source, promptTok, compTok, hitTok, missTok, totalTok, costMicro, estimated,
      p.searchCredits || 0,
      price ? String(price.ruleId || '') : '',
      price ? String(price.ruleLabel || '') : '',
      price ? (price.priceIn || 0) : 0,
      price ? (price.priceOut || 0) : 0,
      price ? (price.priceCacheHit || 0) : 0
    );
    console.log('[Usage] user=%s model=%s src=%s in=%d out=%d hit=%d cost=%s元%s',
      String(p.userId || ''), String(p.modelId || ''), source, promptTok, compTok, hitTok,
      (costMicro / 1000000).toFixed(6), estimated ? ' [估算]' : '');
  } catch (e) {
    console.error('[Usage] record failed:', e.message);
  }
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
// allowed 由调用方传入（管理员豁免时传 null）；缺省时内部计算
function resolveUserModel(userId, requestedModel, allowed) {
  var visible = getUserVisibleModels();
  if (visible.length === 0) return null;

  var settings = getUserAiSettings(userId);
  if (allowed === undefined) {
    allowed = getPolicyAllowedIds(settings.policy_id);
  }

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

// imageUrls 可选：本次用户消息附带的图片 data URL 数组（视觉模型原生多模态）
function buildAiMessages(messages, summary, systemPrompt, userMessage, enableThinking, maxContextTokens, imageUrls) {
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
  // 图片要占上下文预算，不预留会把历史消息挤爆、反而更贵
  var hasImages = !!(imageUrls && imageUrls.length);
  if (hasImages) {
    tokenBudget -= imageUrls.length * IMAGE_TOKEN_RESERVE;
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

  if (hasImages) {
    // 多模态内容块：文字先、图片后（多数视觉模型对"先问后图"的遵循更好）
    var parts = [{ type: 'text', text: timePrefix + userMessage }];
    for (var ii = 0; ii < imageUrls.length; ii++) {
      parts.push({ type: 'image_url', image_url: { url: imageUrls[ii] } });
    }
    aiMessages.push({ role: 'user', content: parts });
  } else {
    aiMessages.push({ role: 'user', content: timePrefix + userMessage });
  }
  return aiMessages;
}

// 把历史消息里的图片搬运进请求：历史里存的是云盘 hash，这里按需要重新读成 data URL。
// 只有当前模型支持视觉时才搬运（否则历史图片只会白烧 token）。
function collectHistoryImageUrls(messages, userId, limit) {
  var urls = [];
  if (!messages || !limit) return urls;
  for (var i = messages.length - 1; i >= 0 && urls.length < limit; i--) {
    var m = messages[i];
    if (!m || !Array.isArray(m.images) || m.images.length === 0) continue;
    var picked = [];
    for (var j = m.images.length - 1; j >= 0 && urls.length + picked.length < limit; j--) {
      var r = cloudStore.readUserFile(m.images[j].hash, userId, MAX_IMAGE_BYTES);
      if (r.error || !cloudStore.isImageMime(r.mime)) continue;
      picked.unshift(cloudStore.toImageDataUrl(r.buffer, r.mime));
    }
    urls = picked.concat(urls);
  }
  return urls;
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

// 固定摘要系统提示：不变才能跨次复用 prefix 缓存（省钱）。
// 要点式 + 限长 + 只保留长效信息，避免摘要越滚越长反而吃掉上下文预算。
var SUMMARY_SYSTEM_PROMPT = '把对话压缩成要点式的长期记忆。要求：\n' +
  '1) 只记录事实与结论，用短句或短列表，不用小标题、不加解释；\n' +
  '2) 必须保留：用户的身份/偏好/目标、已确认的关键结论、未解决的问题、后续待办；\n' +
  '3) 丢弃寒暄、重复内容、被推翻的中间过程；\n' +
  '4) 全文不超过 200 字；\n' +
  '5) 只输出记忆内容本身。';

// 构造摘要请求。自动触发与手动「重建记忆」共用同一份，保证口径一致。
// 返回 null 表示消息太少、不值得摘要。
function buildSummaryPrompt(messages, existingSummary) {
  var keep = messages.length - SUMMARY_KEEP_RECENT;
  if (keep <= 0) return null;
  var toSummarize = messages.slice(0, keep);
  if (toSummarize.length < 4) return null;

  var summaryPrompt = [{ role: 'system', content: SUMMARY_SYSTEM_PROMPT }];
  var conversationText = '';
  if (existingSummary) {
    conversationText += '[之前的摘要]\n' + existingSummary + '\n\n[后续对话]\n';
  }
  for (var i = 0; i < toSummarize.length; i++) {
    var c = toSummarize[i].content || '';
    if (!c) continue;
    conversationText += (toSummarize[i].role === 'user' ? '用户' : 'AI') + ': ' + c + '\n';
  }
  summaryPrompt.push({ role: 'user', content: conversationText });
  return summaryPrompt;
}

// 生成一次摘要并写回会话，返回 Promise<摘要文本>（空串 = 没生成）。
// 用默认模型省成本，失败后逐个换其他启用模型；记账 source='summary' 归到会话归属人。
function generateSummary(conversationId, messages, existingSummary) {
  var summaryPrompt = buildSummaryPrompt(messages, existingSummary);
  if (!summaryPrompt) return Promise.resolve('');

  var defaultId = aiService.getDefaultModelId();
  var ownerRow = db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(conversationId);
  var ownerId = ownerRow ? ownerRow.user_id : '';
  var summaryModelId = defaultId;

  return aiService.chatWithAI(summaryPrompt, { maxTokens: 300, temperature: 0.3, modelId: defaultId, userId: 'system-summary' }).catch(function() {
    var list = aiService.getEnabledModels() || [];
    for (var fi = 0; fi < list.length; fi++) {
      if (list[fi].id === defaultId) continue;
      summaryModelId = list[fi].id;
      return aiService.chatWithAI(summaryPrompt, { maxTokens: 300, temperature: 0.3, modelId: list[fi].id, userId: 'system-summary' });
    }
    throw new Error('no available model for summary');
  }).then(function(data) {
    recordUsage({
      userId: ownerId,
      conversationId: conversationId,
      modelId: summaryModelId,
      mc: aiService.resolveModel(summaryModelId),
      source: 'summary',
      usage: data.usage || null,
      promptTokens: estimatePromptTokens(summaryPrompt),
      content: ''
    });
    var summary = '';
    if (data.choices && data.choices[0] && data.choices[0].message) {
      summary = data.choices[0].message.content || '';
    }
    if (summary) {
      db.prepare("UPDATE conversations SET summary = ?, summary_at = datetime('now') WHERE id = ?")
        .run(summary, conversationId);
    }
    return summary;
  });
}

// 自动触发（fire-and-forget）：失败只记日志，绝不影响对话主流程
function generateSummaryAsync(conversationId, messages, existingSummary) {
  generateSummary(conversationId, messages, existingSummary).catch(function(err) {
    console.error('Summary generation error:', err.message);
  });
}

router.use(auth.requireAuth);

// ============================================================
// 对话 CRUD（不变）
// ============================================================

// 对话列表 + 全文检索：见下方「上下文 / 记忆 / 检索 / 导出」段落中的 GET /conversations

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
// 上下文 / 记忆 / 检索 / 导出
// ============================================================

// 扫消息正文：返回 { count, snippet }。只扫 content，避免命中 JSON 键名与转义序列。
function scanConvContent(messagesJson, q) {
  var needle = String(q || '').toLowerCase();
  if (!needle) return { count: 0, snippet: '' };
  var messages = [];
  try { messages = JSON.parse(messagesJson || '[]'); } catch (e) { return { count: 0, snippet: '' }; }
  var count = 0;
  var snippet = '';
  for (var i = 0; i < messages.length; i++) {
    var c = String(messages[i].content || '');
    if (!c) continue;
    var lower = c.toLowerCase();
    var from = 0;
    var at;
    while ((at = lower.indexOf(needle, from)) >= 0) {
      count++;
      if (!snippet) {
        var start = Math.max(0, at - 30);
        var end = Math.min(c.length, at + needle.length + 50);
        snippet = (messages[i].role === 'user' ? '你：' : 'AI：') +
          (start > 0 ? '…' : '') + c.substring(start, end).replace(/\s+/g, ' ') + (end < c.length ? '…' : '');
      }
      from = at + needle.length;
      if (count > 200) return { count: count, snippet: snippet };
    }
  }
  return { count: count, snippet: snippet };
}

// 对话列表（含全文检索）。
// q 为空 = 原行为。带 q 时同时匹配标题与消息正文：会话总量在校级规模下很小，
// 直接全量加载后内存过滤，比 LIKE messages_json 更准（不受 JSON 转义影响）。
router.get('/conversations', function(req, res) {
  var q = String(req.query.q || '').trim();
  var userId = req.user.user_id;

  if (!q) {
    var stmt = db.prepare('SELECT id, user_id, title, summary, persona, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC');
    var conversations = stmt.all(userId);
    for (var i = 0; i < conversations.length; i++) {
      if (conversations[i].created_at) conversations[i].created_at = time.toISOString(conversations[i].created_at);
      if (conversations[i].updated_at) conversations[i].updated_at = time.toISOString(conversations[i].updated_at);
    }
    return res.json({ code: 200, message: 'ok', data: conversations });
  }

  var limit = parseInt(req.query.limit, 10);
  if (!isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 200) limit = 200;

  var needle = q.toLowerCase();
  var rows = db.prepare('SELECT id, user_id, title, summary, persona, created_at, updated_at, messages_json FROM conversations WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
  var hits = [];
  for (var j = 0; j < rows.length; j++) {
    var row = rows[j];
    var titleHit = String(row.title || '').toLowerCase().indexOf(needle) >= 0;
    var scan = titleHit ? { count: 0, snippet: '' } : scanConvContent(row.messages_json, q);
    if (!titleHit && !scan.count) continue;
    var item = {
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      summary: row.summary,
      persona: row.persona,
      created_at: time.toISOString(row.created_at),
      updated_at: time.toISOString(row.updated_at),
      matched_in: titleHit ? (scan.count ? 'both' : 'title') : 'content',
      match_count: (titleHit ? 1 : 0) + scan.count,
      snippet: titleHit ? '' : scan.snippet
    };
    hits.push(item);
    if (hits.length >= limit) break;
  }
  res.json({ code: 200, message: 'ok', data: hits });
});

// 上下文与记忆状态：给前端画「占用条」与「记忆面板」
router.get('/conversations/:id/context', function(req, res) {
  var conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.user_id);
  if (!conv) return res.status(404).json({ code: 404, message: '对话不存在' });

  var aiSettings = getUserAiSettings(req.user.user_id);
  var policyAllowed = req.user.is_admin === 1 ? null : getPolicyAllowedIds(aiSettings.policy_id);
  var mc = resolveUserModel(req.user.user_id, String(req.query.model || ''), policyAllowed);
  if (!mc) return res.status(503).json({ code: 503, message: '暂无可用模型' });

  var messages = [];
  try { messages = JSON.parse(conv.messages_json || '[]'); } catch (e) {}
  var summary = conv.summary || '';
  var effectivePrompt = getEffectiveSystemPrompt(conv.persona, aiSettings.system_prompt);

  var budget = mc.maxContextTokens > 0 ? mc.maxContextTokens : MAX_CONTEXT_TOKENS;
  // 与 buildAiMessages 同口径：系统提示走固定前缀（缓存友好）+ 差异部分
  var systemTokens = estimateTokens(SYSTEM_PROMPT_PREFIX);
  if (effectivePrompt !== SYSTEM_PROMPT_PREFIX) systemTokens += estimateTokens(effectivePrompt);
  var summaryTokens = summary ? estimateTokens(summary) + 50 : 0;
  var userTokens = 0;
  var assistantTokens = 0;
  for (var i = 0; i < messages.length; i++) {
    var t = estimateTokens(messages[i].content || '') + 8;
    if (messages[i].role === 'user') userTokens += t; else assistantTokens += t;
  }
  var historyTokens = userTokens + assistantTokens;
  var used = systemTokens + summaryTokens + historyTokens;
  var canSummarize = !!buildSummaryPrompt(messages, summary);

  res.json({
    code: 200,
    message: 'ok',
    data: {
      model_id: mc.id,
      model_label: mc.label,
      budget: budget,
      used: used,
      percent: budget > 0 ? Math.min(100, Math.round(used / budget * 100)) : 0,
      breakdown: {
        system: systemTokens,
        summary: summaryTokens,
        history: historyTokens,
        user: userTokens,
        assistant: assistantTokens
      },
      message_count: messages.length,
      summary: summary,
      summary_at: conv.summary_at || '',
      keep_recent: SUMMARY_KEEP_RECENT,
      trigger_count: SUMMARY_TRIGGER_COUNT,
      can_summarize: canSummarize,
      will_summarize: canSummarize && messages.length >= SUMMARY_TRIGGER_COUNT,
      persona: conv.persona || ''
    }
  });
});

// 手动编辑「对话记忆」（summary）。空字符串 = 清除记忆。
router.put('/conversations/:id/summary', function(req, res) {
  var conv = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.user_id);
  if (!conv) return res.status(404).json({ code: 404, message: '对话不存在' });

  var text = String(req.body.summary === undefined || req.body.summary === null ? '' : req.body.summary).trim();
  if (text.length > 2000) return res.status(400).json({ code: 400, message: '记忆内容过长（最多 2000 字）' });

  if (text) {
    db.prepare("UPDATE conversations SET summary = ?, summary_at = datetime('now') WHERE id = ?").run(text, conv.id);
  } else {
    db.prepare('UPDATE conversations SET summary = \'\', summary_at = NULL WHERE id = ?').run(conv.id);
  }
  console.log('[AI] summary edited: conv=%s len=%d by %s', conv.id.substring(0, 8), text.length, req.user.user_id);
  res.json({ code: 200, message: 'ok', data: { summary: text } });
});

// 强制重建「对话记忆」（异步消耗 token，source='summary' 会记账）
router.post('/conversations/:id/summary/rebuild', function(req, res) {
  var conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(req.params.id, req.user.user_id);
  if (!conv) return res.status(404).json({ code: 404, message: '对话不存在' });

  var messages = [];
  try { messages = JSON.parse(conv.messages_json || '[]'); } catch (e) {}
  // 默认从头重建；带 keep_existing=1 时把现有记忆当作上下文，做增量总结
  var existing = req.body.keep_existing ? (conv.summary || '') : '';
  if (!buildSummaryPrompt(messages, existing)) {
    return res.status(400).json({ code: 400, message: '消息太少，暂不需要生成记忆（至少 4 条）' });
  }
  generateSummary(conv.id, messages, existing).then(function (text) {
    if (!text) return res.status(502).json({ code: 502, message: '模型未返回记忆内容，请重试' });
    var row = db.prepare('SELECT summary, summary_at FROM conversations WHERE id = ?').get(conv.id);
    res.json({ code: 200, message: 'ok', data: { summary: row.summary, summary_at: row.summary_at } });
  }).catch(function (err) {
    console.error('[AI] summary rebuild failed:', err.message);
    res.status(502).json({ code: 502, message: '记忆生成失败：' + (err.message || '未知错误') });
  });
});

// 说明：这里原本是 GET /conversations/:id/export（导出 md/txt/json 文件），已按需求下线。
// 取而代之的是纯前端两条路：①复制对话文本；②把对话渲染成长图上传到云盘
// （见 frontend/longImage.js）—— 不再往用户设备落文件，也不再需要后端拼文本。

// ============================================================
// 模型 API（用户端）
// ============================================================

router.get('/models', function(req, res) {
  var visible = getUserVisibleModels();
  var settings = getUserAiSettings(req.user.user_id);
  // 按用户策略过滤（与 chat 的 resolveUserModel 同一语义）：
  // 策略外的模型对用户完全不可见，而非仅发消息时静默回落
  var isSuperAdmin = req.user.is_admin === 1;
  var allowed = isSuperAdmin ? null : getPolicyAllowedIds(settings.policy_id);
  if (allowed !== null) {
    visible = visible.filter(function(row) {
      return allowed.indexOf(row.id) >= 0;
    });
  }
  var defaultId = aiService.getDefaultModelId();
  // 默认模型在策略外时，取策略内第一个可见模型作为展示默认
  var defaultVisible = visible.some(function(row) { return row.id === defaultId; });
  if (!defaultVisible && visible.length > 0) {
    defaultId = visible[0].id;
  }
  var models = visible.map(function(row) {
    return {
      id: row.id,
      label: row.label,
      color: row.color || '#6366f1',
      is_free: !!row.is_free,
      supports_thinking: !!row.supports_thinking,
      supports_search: !!row.supports_search,
      supports_vision: !!row.supports_vision,
      is_default: row.id === defaultId
    };
  });
  // 视觉能力总览：前端据此决定「选图」入口是否可用、以及走原生还是转述
  var relayId = getVisionRelayModelId();
  var visionEnabled = isVisionEnabled();
  var nativeCount = 0;
  for (var vi = 0; vi < models.length; vi++) {
    if (models[vi].supports_vision) nativeCount++;
  }
  res.json({
    code: 200,
    message: 'ok',
    data: {
      models: models,
      default_model: defaultId,
      user_model: settings.model || '',
      vision: {
        enabled: visionEnabled && (nativeCount > 0 || !!relayId),
        relay_model: relayId,
        max_images: MAX_VISION_IMAGES,
        max_bytes: MAX_IMAGE_BYTES
      },
      policy_label: (function() {
        var pRow = settings.policy_id ? getPolicyRow(settings.policy_id) : getDefaultPolicyRow();
        return pRow ? pRow.label : '';
      })(),
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
  // 用量记账单价（migration 013）：管理端按「元/百万token」录入，落库换算为微元/千token
  var priceKeys = ['price_in', 'price_out', 'price_cache_hit'];
  for (var pi = 0; pi < priceKeys.length; pi++) {
    var pk = priceKeys[pi];
    if (body[pk] === undefined) continue;
    var yuan = Number(body[pk]);
    if (!isFinite(yuan) || yuan < 0) yuan = 0;
    out[pk] = toMicroPerK(Math.min(yuan, 100000));
  }
  if (body.supports_stream_options !== undefined) {
    out.supports_stream_options = body.supports_stream_options ? 1 : 0;
  }
  // 视觉能力（migration 015）
  if (body.supports_vision !== undefined) out.supports_vision = body.supports_vision ? 1 : 0;
  if (body.vision_max_images !== undefined) {
    var vmi = parseInt(body.vision_max_images, 10);
    out.vision_max_images = isNaN(vmi) ? 0 : Math.max(0, Math.min(6, vmi));
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
      reasoning_effort: row.reasoning_effort || '',
      // 单价回显为「元/百万token」，与录入口径一致
      price_in: fromMicroPerK(row.price_in),
      price_out: fromMicroPerK(row.price_out),
      price_cache_hit: fromMicroPerK(row.price_cache_hit),
      supports_stream_options: row.supports_stream_options === undefined ? 1 : (row.supports_stream_options ? 1 : 0),
      supports_vision: !!row.supports_vision,
      vision_max_images: row.vision_max_images || 0
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
    'INSERT INTO ai_models (id, label, api_url, api_key, model, color, api_style, supports_thinking, supports_search, is_free, enabled, is_default, builtin, sort_order, price_in, price_out, price_cache_hit, supports_stream_options, supports_vision, vision_max_images)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)'
  ].join('\n')).run(
    id, v.label, v.api_url || '', v.api_key || '', v.model || '',
    v.color || '#6366f1', v.api_style || 'openai',
    v.supports_thinking || 0, v.supports_search || 0,
    v.is_free || 0, v.enabled === undefined ? 1 : v.enabled, v.sort_order || 100,
    v.price_in || 0, v.price_out || 0, v.price_cache_hit || 0,
    v.supports_stream_options === undefined ? 1 : v.supports_stream_options,
    v.supports_vision || 0, v.vision_max_images || 0
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

// 「把某模型设为全局默认」= PUT /admin/models/default { id }
function setDefaultModelHandler(req, res) {
  var id = String((req.body && req.body.id) || '');
  var row = aiService.getModelRow(id);
  if (!row) return res.status(404).json({ code: 404, message: '模型不存在' });
  if (!row.enabled) return res.status(400).json({ code: 400, message: '该模型已停用，请先启用' });
  setDefaultModelId(id);
  console.log('[AI-Admin] default model set: %s by %s', id, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
}

// ⚠️ 路径冲突（历史坑）：内置模型 id 就叫 "default"，
// 而「设为默认」的旧接口路径也是 /admin/models/default，必须定义在 /:id 之前才不会被吞。
// 于是编辑内置 default 模型本体的请求（不带 body.id）会误落到「设为默认」上，
// 得到 "模型不存在" —— 内置模型的任何字段都改不了（视觉能力位也改不了）。
// 现在按 body.id 是否存在区分两种语义，两者都能用。
router.put('/admin/models/default', function(req, res) {
  if (req.body && req.body.id) return setDefaultModelHandler(req, res);
  req.params.id = 'default';
  return modelUpdateHandler(req, res);
});

function modelUpdateHandler(req, res) {
  var row = aiService.getModelRow(req.params.id);
  if (!row) return res.status(404).json({ code: 404, message: '模型不存在' });

  var check = validateModelInput(req.body, false);
  if (check.error) return res.status(400).json({ code: 400, message: check.error });
  var v = check.value;

  var sets = [];
  var params = [];
  var allowed = ['label', 'api_url', 'model', 'color', 'api_style', 'supports_thinking', 'supports_search', 'is_free', 'enabled', 'sort_order', 'max_context_tokens', 'max_output_tokens', 'reasoning_effort', 'price_in', 'price_out', 'price_cache_hit', 'supports_stream_options', 'supports_vision', 'vision_max_images'];
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
}

router.put('/admin/models/:id', modelUpdateHandler);

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

// 批量接入（单源多模型）：一次填好源（地址+密钥+能力位），N 个模型一次提交
// models: [{ model: 'glm-4-plus', label?: 'GLM Plus' }]；id 从 model slug 化，冲突自动加后缀
router.post('/admin/models/batch', function(req, res) {
  var items = Array.isArray(req.body.models) ? req.body.models : [];
  if (items.length === 0) return res.status(400).json({ code: 400, message: 'models 不能为空' });
  if (items.length > 50) return res.status(400).json({ code: 400, message: '单次最多接入 50 个模型' });

  var apiUrl = String(req.body.api_url || '').trim();
  if (!apiUrl) return res.status(400).json({ code: 400, message: 'API 地址不能为空' });
  if (!/^https?:\/\//i.test(apiUrl)) return res.status(400).json({ code: 400, message: 'API 地址必须以 http:// 或 https:// 开头' });

  var color = /^#[0-9a-fA-F]{6}$/.test(String(req.body.color || '')) ? req.body.color : '#6366f1';
  var apiStyle = req.body.api_style === 'deepseek' ? 'deepseek' : 'openai';
  var apiKey = String(req.body.api_key || '').trim();
  var eff = ['low', 'medium', 'high'].indexOf(String(req.body.reasoning_effort || '')) >= 0 ? req.body.reasoning_effort : '';
  var maxCtx = parseInt(req.body.max_context_tokens, 10) || 0;
  var maxOut = parseInt(req.body.max_output_tokens, 10) || 0;
  var sortBase = Math.max(0, Math.min(9999, parseInt(req.body.sort_order, 10) || 100));

  var reuseKeyFrom = String(req.body.reuse_key_from || '');
  var reuseKey = '';
  if (!apiKey && reuseKeyFrom) {
    var src = aiService.getModelRow(reuseKeyFrom);
    if (src && src.api_key) reuseKey = src.api_key;
  }

  var existingIds = {};
  (aiService.getAllModels() || []).forEach(function(r) { existingIds[r.id] = true; });

  function slugify(modelName) {
    return String(modelName || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 32) || 'model';
  }

  // 批次共用同一套单价（同源多模型通常同价），单位：元/百万token 入参 → 微元/千token 落库
  function numYuan(v) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) return 0;
    return toMicroPerK(Math.min(n, 100000));
  }
  var batchPriceIn = numYuan(req.body.price_in);
  var batchPriceOut = numYuan(req.body.price_out);
  var batchPriceHit = numYuan(req.body.price_cache_hit);
  var batchStreamOpts = req.body.supports_stream_options === undefined ? 1 : (req.body.supports_stream_options ? 1 : 0);

  var created = [];
  var failed = [];
  var insert = db.prepare([
    'INSERT INTO ai_models (id, label, api_url, api_key, model, color, api_style, supports_thinking, supports_search, is_free, enabled, is_default, builtin, sort_order, max_context_tokens, max_output_tokens, reasoning_effort, price_in, price_out, price_cache_hit, supports_stream_options, supports_vision, vision_max_images)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ].join('\n'));

  for (var i = 0; i < items.length; i++) {
    var modelName = String(items[i].model || '').trim();
    if (!modelName) { failed.push({ model: modelName, reason: '模型标识为空' }); continue; }
    var id = slugify(modelName);
    var n = 2;
    while (existingIds[id]) { id = slugify(modelName) + '-' + n; n++; }
    if (db.prepare('SELECT id FROM ai_models WHERE id = ?').get(id)) { failed.push({ model: modelName, reason: 'ID 冲突' }); continue; }
    var label = String(items[i].label || '').trim() || modelName;
    if (label.length > 30) label = label.substring(0, 30);
    try {
      insert.run(id, label, apiUrl, apiKey || reuseKey, modelName,
        color, apiStyle,
        req.body.supports_thinking ? 1 : 0, req.body.supports_search ? 1 : 0,
        req.body.is_free ? 1 : 0, req.body.enabled === undefined ? 1 : (req.body.enabled ? 1 : 0),
        sortBase + i, maxCtx, maxOut, eff,
        batchPriceIn, batchPriceOut, batchPriceHit, batchStreamOpts,
        req.body.supports_vision ? 1 : 0, 0);
      existingIds[id] = true;
      created.push({ id: id, model: modelName, label: label });
    } catch (e) {
      failed.push({ model: modelName, reason: e.message });
    }
  }

  console.log('[AI-Admin] batch created %d models (failed %d) by %s', created.length, failed.length, req.user.user_id);
  res.json({ code: 200, message: 'ok', data: { created: created, failed: failed } });
});

// ============================================================
// 管理端：视觉（看图）配置
//
// 两条路：
//   ① 模型自己支持视觉 → 图片直接进内容块（native）
//   ② 模型不支持 → 由「统一转述模型」先把图说成文字，再交给对话模型（relay）
// 管理员只需在②的场景下挑一个视觉模型即可；留空 = 非视觉模型收不到图（前端入口灰掉）。
// ============================================================

router.get('/admin/vision', function(req, res) {
  var rows = aiService.getAllModels() || [];
  var models = rows.map(function(row) {
    return {
      id: row.id,
      label: row.label,
      enabled: !!row.enabled,
      supports_vision: !!row.supports_vision,
      vision_max_images: row.vision_max_images || 0
    };
  });
  res.json({
    code: 200,
    message: 'ok',
    data: {
      enabled: isVisionEnabled(),
      relay_model: getVisionRelayModelId(),
      max_images: MAX_VISION_IMAGES,
      max_bytes: MAX_IMAGE_BYTES,
      models: models
    }
  });
});

router.put('/admin/vision', function(req, res) {
  var patch = {};
  if (req.body.enabled !== undefined) {
    patch[VISION_KEY_ENABLED] = req.body.enabled ? '1' : '0';
  }
  if (req.body.relay_model !== undefined) {
    var relay = String(req.body.relay_model || '').trim();
    if (relay) {
      var row = aiService.getModelRow(relay);
      if (!row) return res.status(404).json({ code: 404, message: '模型不存在' });
      if (!row.supports_vision) {
        return res.status(400).json({ code: 400, message: '转述模型必须自己支持视觉，请先在该模型上勾选「支持视觉」' });
      }
    }
    patch[VISION_KEY_RELAY] = relay;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ code: 400, message: '没有要修改的配置' });
  }
  try {
    appConfig.saveValues(AI_APP_NAME, patch);
  } catch (e) {
    return res.status(500).json({ code: 500, message: '保存失败：' + e.message });
  }
  console.log('[AI-Admin] vision config updated by %s: %j', req.user.user_id, patch);
  res.json({
    code: 200,
    message: 'ok',
    data: { enabled: isVisionEnabled(), relay_model: getVisionRelayModelId() }
  });
});

// ============================================================
// 额度闸门（migration 016）
//
// 013 只记账、人人无限用；016 给管理员一个「按用户设金额上限」的开关。
// 关键语义（决定会不会误伤人）：
//   quota_micro = 0  → **不限额**（默认，存量用户零影响）
//   quota_micro > 0  → 滚动窗口内已用 ≥ 上限 → 发消息返回 402
// 已用金额直接聚合 ai_usage_log（跟流水走，永不漂移），本表只存上限。
// ============================================================

var WALLET_DEFAULT_WINDOW_DAYS = 30;
var WALLET_MAX_QUOTA_YUAN = 100000;

function getWalletRow(userId) {
  try {
    return db.prepare('SELECT user_id, quota_micro, window_days FROM ai_wallet WHERE user_id = ?').get(String(userId)) || null;
  } catch (e) {
    return null; // 表还没建（迁移未跑）→ 一律放行
  }
}

// 有额度且已用达标 → 返回拒给用户的文案；否则 null（放行）
function checkWalletGate(userId) {
  var w = getWalletRow(userId);
  if (!w || !(w.quota_micro > 0)) return null;
  var days = w.window_days > 0 ? w.window_days : WALLET_DEFAULT_WINDOW_DAYS;
  var from = fmtUtc(new Date(Date.now() - days * 24 * 3600 * 1000));
  var row;
  try {
    row = db.prepare('SELECT SUM(cost_micro) AS used FROM ai_usage_log WHERE user_id = ? AND created_at >= ?').get(String(userId), from);
  } catch (e) {
    return null;
  }
  var used = (row && row.used) || 0;
  if (used < w.quota_micro) return null;
  var remain = Math.max(0, (w.quota_micro - used) / 1000000);
  return '你的 AI 额度已用完（近 ' + days + ' 天剩余 ¥' + remain.toFixed(2) + '）。' +
    '请联系管理员调整额度，或改用标记为「免费」的模型。';
}

// 用户侧余额视图：没设额度时返回 unlimited，前端就不显示进度条
function getWalletView(userId) {
  var w = getWalletRow(userId);
  if (!w || !(w.quota_micro > 0)) return { unlimited: true, quota_micro: 0, window_days: 0, used_micro: 0, remaining_micro: 0 };
  var days = w.window_days > 0 ? w.window_days : WALLET_DEFAULT_WINDOW_DAYS;
  var from = fmtUtc(new Date(Date.now() - days * 24 * 3600 * 1000));
  var row = db.prepare('SELECT SUM(cost_micro) AS used FROM ai_usage_log WHERE user_id = ? AND created_at >= ?').get(String(userId), from);
  var used = (row && row.used) || 0;
  return {
    unlimited: false,
    quota_micro: w.quota_micro,
    window_days: days,
    used_micro: used,
    remaining_micro: Math.max(0, w.quota_micro - used),
    percent: Math.min(100, Math.round(used / w.quota_micro * 100))
  };
}

router.get('/wallet', function(req, res) {
  res.json({ code: 200, message: 'ok', data: getWalletView(req.user.user_id) });
});

router.get('/admin/wallet', function(req, res) {
  var win = resolveUsageWindow({ days: req.query.days || 30 });
  var sql = [
    'SELECT u.user_id, u.net_name, u.real_name, u.status,',
    '       IFNULL(w.quota_micro, 0) AS quota_micro,',
    '       IFNULL(w.window_days, 0) AS window_days,',
    '       IFNULL(s.used, 0) AS used_micro,',
    '       IFNULL(s.calls, 0) AS calls,',
    '       IFNULL(s.total_tokens, 0) AS total_tokens,',
    '       s.last_at',
    'FROM users u',
    'LEFT JOIN ai_wallet w ON w.user_id = u.user_id',
    'LEFT JOIN (',
    '  SELECT user_id, SUM(cost_micro) AS used, COUNT(*) AS calls,',
    '         SUM(total_tokens) AS total_tokens, MAX(created_at) AS last_at',
    '  FROM ai_usage_log WHERE created_at >= ? AND created_at < ? GROUP BY user_id',
    ') s ON s.user_id = u.user_id',
    'WHERE (IFNULL(s.calls, 0) > 0 OR IFNULL(w.quota_micro, 0) > 0)',
    'ORDER BY used_micro DESC, quota_micro DESC',
    'LIMIT 500'
  ].join('\n');
  try {
    var rows = db.prepare(sql).all(win.from, win.to);
    var users = rows.map(function(r) {
      return {
        user_id: r.user_id,
        net_name: r.net_name || r.real_name || r.user_id,
        status: r.status || '',
        // 管理端按「元」进出，与单价的口径习惯一致
        quota_yuan: (r.quota_micro || 0) / 1000000,
        quota_micro: r.quota_micro || 0,
        window_days: r.window_days || 0,
        used_micro: r.used_micro || 0,
        used_yuan: Math.round((r.used_micro || 0) / 100) / 10000,
        calls: r.calls || 0,
        total_tokens: r.total_tokens || 0,
        last_at: r.last_at || ''
      };
    });
    res.json({
      code: 200,
      message: 'ok',
      data: {
        users: users,
        default_window_days: WALLET_DEFAULT_WINDOW_DAYS,
        window: win,
        // 单价全 0 时记账恒为 0，额度永远到不了上限 —— 必须提示管理员先把价填了
        priced_models: (function() {
          try {
            return db.prepare('SELECT COUNT(*) AS c FROM ai_models WHERE enabled = 1 AND (price_in > 0 OR price_out > 0)').get().c;
          } catch (e) { return 0; }
        })()
      }
    });
  } catch (e) {
    console.error('[AI-Admin] wallet list failed:', e.message);
    res.json({ code: 200, message: 'ok', data: { users: [], unavailable: true } });
  }
});

function setWalletQuota(req, res) {
  var userId = String(req.params.userId || '');
  var body = req.body || {};
  var row = db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(userId);
  if (!row) return res.status(404).json({ code: 404, message: '用户不存在' });
  var yuan = Number(body.quota_yuan);
  if (!isFinite(yuan) || yuan < 0) return res.status(400).json({ code: 400, message: '额度必须是不小于 0 的数字（元）' });
  if (yuan > WALLET_MAX_QUOTA_YUAN) return res.status(400).json({ code: 400, message: '单用户额度上限 ' + WALLET_MAX_QUOTA_YUAN + ' 元' });
  var days = parseInt(body.window_days, 10);
  if (!isFinite(days) || days < 0) days = 0;
  if (days > 365) days = 365;
  db.prepare([
    'INSERT INTO ai_wallet (user_id, quota_micro, window_days, updated_at) VALUES (?, ?, ?, datetime(\'now\'))',
    'ON CONFLICT(user_id) DO UPDATE SET quota_micro = excluded.quota_micro, window_days = excluded.window_days, updated_at = excluded.updated_at'
  ].join('\n')).run(userId, Math.round(yuan * 1000000), days);
  console.log('[AI-Admin] wallet quota set: %s = %s 元 / %s 天 by %s', userId, yuan, days, req.user.user_id);
  res.json({ code: 200, message: 'ok', data: getWalletView(userId) });
}

router.put('/admin/wallet/:userId', function(req, res) {
  setWalletQuota(req, res);
});

// 删除 = 恢复不限额（比把额度改成 0 更明确）
router.delete('/admin/wallet/:userId', function(req, res) {
  db.prepare('DELETE FROM ai_wallet WHERE user_id = ?').run(String(req.params.userId));
  console.log('[AI-Admin] wallet quota cleared: %s by %s', req.params.userId, req.user.user_id);
  res.json({ code: 200, message: 'ok', data: { unlimited: true } });
});

// ============================================================
// 管理端：用量报表（migration 013）
// 只读聚合，不做额度扣减；时间窗用「最近 N 天」滚动窗口（Store 里 created_at 是 UTC，
// 用滚动窗口可绕开本地时区/日期解析的歧义）。
// ============================================================

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function fmtUtc(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + ' ' +
    pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
}

function resolveUsageWindow(query) {
  var days = parseInt(query.days, 10);
  if (!isFinite(days) || days <= 0) days = 7;
  if (days > 365) days = 365;
  var now = new Date();
  var from = new Date(now.getTime() - days * 24 * 3600 * 1000);
  return { days: days, from: fmtUtc(from), to: fmtUtc(new Date(now.getTime() + 1000)) };
}

// 注意：下面这些聚合列必须带 l. 前缀 —— group=user/model 会 JOIN users / ai_models，
// 两张表都有 created_at，不加前缀会报 ambiguous column name
var USAGE_AGG_COLS = [
  'COUNT(*) AS calls',
  'SUM(l.prompt_tokens) AS prompt_tokens',
  'SUM(l.completion_tokens) AS completion_tokens',
  'SUM(l.cache_hit_tokens) AS cache_hit_tokens',
  'SUM(l.total_tokens) AS total_tokens',
  'SUM(l.cost_micro) AS cost_micro',
  'SUM(l.search_credits) AS search_credits',
  'SUM(l.estimated) AS estimated_calls',
  'MAX(l.created_at) AS last_at'
].join(', ');

// 用量报表：group=user（默认）| model | source | day
router.get('/admin/usage/summary', function(req, res) {
  var win = resolveUsageWindow(req.query);
  var group = String(req.query.group || 'user');

  var sql = '';
  if (group === 'model') {
    sql = 'SELECT l.model_id AS key, ' + USAGE_AGG_COLS +
      ', MAX(m.label) AS label, MAX(m.color) AS color, MAX(m.is_free) AS is_free' +
      ' FROM ai_usage_log l LEFT JOIN ai_models m ON m.id = l.model_id' +
      ' WHERE l.created_at >= ? AND l.created_at < ?' +
      ' GROUP BY l.model_id ORDER BY cost_micro DESC, total_tokens DESC LIMIT 200';
  } else if (group === 'rule') {
    // 按价格规则分组：'' = 走的模型基准价，其余为命中的峰谷/折扣/限免规则
    sql = 'SELECT l.rule_id AS key, ' + USAGE_AGG_COLS +
      ', MAX(l.rule_label) AS label' +
      ' FROM ai_usage_log l WHERE l.created_at >= ? AND l.created_at < ?' +
      ' GROUP BY l.rule_id ORDER BY cost_micro DESC, total_tokens DESC LIMIT 200';
  } else if (group === 'source') {
    sql = 'SELECT l.source AS key, ' + USAGE_AGG_COLS +
      ' FROM ai_usage_log l WHERE l.created_at >= ? AND l.created_at < ?' +
      ' GROUP BY l.source ORDER BY total_tokens DESC LIMIT 50';
  } else if (group === 'day') {
    sql = 'SELECT substr(l.created_at, 1, 10) AS key, ' + USAGE_AGG_COLS +
      ' FROM ai_usage_log l WHERE l.created_at >= ? AND l.created_at < ?' +
      ' GROUP BY key ORDER BY key DESC LIMIT 400';
  } else {
    group = 'user';
    sql = 'SELECT l.user_id AS key, ' + USAGE_AGG_COLS +
      ', MAX(u.net_name) AS net_name, MAX(u.real_name) AS real_name, MAX(u.status) AS status' +
      ' FROM ai_usage_log l LEFT JOIN users u ON u.user_id = l.user_id' +
      ' WHERE l.created_at >= ? AND l.created_at < ?' +
      ' GROUP BY l.user_id ORDER BY cost_micro DESC, total_tokens DESC LIMIT 200';
  }

  try {
    var rows = db.prepare(sql).all(win.from, win.to);
    var totals = db.prepare([
      'SELECT COUNT(*) AS calls, COUNT(DISTINCT user_id) AS users,',
      ' SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens,',
      ' SUM(cache_hit_tokens) AS cache_hit_tokens, SUM(total_tokens) AS total_tokens,',
      ' SUM(cost_micro) AS cost_micro, SUM(search_credits) AS search_credits,',
      ' SUM(estimated) AS estimated_calls',
      'FROM ai_usage_log WHERE created_at >= ? AND created_at < ?'
    ].join('\n')).get(win.from, win.to) || {};

    var list = (rows || []).map(function(r) {
      var cost = r.cost_micro || 0;
      var promptTok = r.prompt_tokens || 0;
      var hit = r.cache_hit_tokens || 0;
      return {
        key: r.key,
        label: r.label || r.net_name || r.key || '',
        real_name: r.real_name || '',
        color: r.color || '',
        is_free: r.is_free === null || r.is_free === undefined ? null : !!r.is_free,
        status: r.status || '',
        calls: r.calls || 0,
        prompt_tokens: promptTok,
        completion_tokens: r.completion_tokens || 0,
        cache_hit_tokens: hit,
        total_tokens: r.total_tokens || 0,
        cache_hit_rate: promptTok > 0 ? Math.round(hit / promptTok * 100) : 0,
        cost_micro: cost,
        cost_yuan: Math.round(cost / 100) / 10000,
        search_credits: r.search_credits || 0,
        estimated_calls: r.estimated_calls || 0,
        last_at: r.last_at || ''
      };
    });

    var tCost = totals.cost_micro || 0;
    res.json({
      code: 200,
      message: 'ok',
      data: {
        group: group,
        days: win.days,
        window: { from: win.from, to: win.to },
        totals: {
          calls: totals.calls || 0,
          users: totals.users || 0,
          prompt_tokens: totals.prompt_tokens || 0,
          completion_tokens: totals.completion_tokens || 0,
          cache_hit_tokens: totals.cache_hit_tokens || 0,
          total_tokens: totals.total_tokens || 0,
          cost_micro: tCost,
          cost_yuan: Math.round(tCost / 100) / 10000,
          search_credits: totals.search_credits || 0,
          estimated_calls: totals.estimated_calls || 0
        },
        rows: list
      }
    });
  } catch (e) {
    // 表不存在（旧库未跑 013）→ 返回空报表而不是 500
    console.error('[AI-Admin] usage summary failed:', e.message);
    res.json({
      code: 200, message: 'ok',
      data: { group: group, days: win.days, window: { from: win.from, to: win.to }, totals: null, rows: [], unavailable: true }
    });
  }
});

// 用量明细：按用户/模型/来源过滤，倒序分页
router.get('/admin/usage/logs', function(req, res) {
  var limit = parseInt(req.query.limit, 10);
  if (!isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 500) limit = 500;
  var offset = parseInt(req.query.offset, 10);
  if (!isFinite(offset) || offset < 0) offset = 0;

  var conds = [];
  var params = [];
  if (req.query.user_id) { conds.push('l.user_id = ?'); params.push(String(req.query.user_id)); }
  if (req.query.model_id) { conds.push('l.model_id = ?'); params.push(String(req.query.model_id)); }
  if (req.query.source) { conds.push('l.source = ?'); params.push(String(req.query.source)); }
  var win = null;
  if (!req.query.user_id && !req.query.model_id) {
    win = resolveUsageWindow(req.query);
    conds.push('l.created_at >= ? AND l.created_at < ?');
    params.push(win.from, win.to);
  }
  var where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';

  try {
    var stmt = db.prepare([
      'SELECT l.id, l.user_id, l.conversation_id, l.model_id, l.source,',
      ' l.prompt_tokens, l.completion_tokens, l.cache_hit_tokens, l.cache_miss_tokens,',
      ' l.total_tokens, l.cost_micro, l.estimated, l.search_credits, l.created_at,',
      ' l.rule_id, l.rule_label,',
      ' l.price_in_snapshot, l.price_out_snapshot, l.price_cache_hit_snapshot,',
      ' u.net_name, c.title AS conv_title',
      'FROM ai_usage_log l',
      ' LEFT JOIN users u ON u.user_id = l.user_id',
      ' LEFT JOIN conversations c ON c.id = l.conversation_id' + where,
      ' ORDER BY l.id DESC LIMIT ? OFFSET ?'
    ].join('\n'));
    // better-sqlite3 铁律：可变参数必须 apply(stmt, ...) 绑定 this
    var rows = stmt.all.apply(stmt, params.concat([limit, offset]));

    var list = (rows || []).map(function(r) {
      return {
        id: r.id,
        user_id: r.user_id,
        net_name: r.net_name || '',
        conversation_id: r.conversation_id,
        conv_title: r.conv_title || '',
        model_id: r.model_id,
        source: r.source,
        prompt_tokens: r.prompt_tokens,
        completion_tokens: r.completion_tokens,
        cache_hit_tokens: r.cache_hit_tokens,
        cache_miss_tokens: r.cache_miss_tokens,
        total_tokens: r.total_tokens,
        cost_micro: r.cost_micro,
        cost_yuan: Math.round((r.cost_micro || 0) / 100) / 10000,
        rule_id: r.rule_id || '',
        rule_label: r.rule_label || '',
        // 结算当时的单价快照（历史账只读快照，不随改价变化）
        price_in: fromMicroPerK(r.price_in_snapshot),
        price_out: fromMicroPerK(r.price_out_snapshot),
        price_cache_hit: fromMicroPerK(r.price_cache_hit_snapshot),
        estimated: !!r.estimated,
        search_credits: r.search_credits,
        created_at: r.created_at
      };
    });
    res.json({ code: 200, message: 'ok', data: { logs: list, limit: limit, offset: offset, window: win } });
  } catch (e) {
    console.error('[AI-Admin] usage logs failed:', e.message);
    res.json({ code: 200, message: 'ok', data: { logs: [], limit: limit, offset: offset, unavailable: true } });
  }
});

// 用量报表 CSV 导出（管理看板「导出」按钮用）
// 记得带 BOM：Excel 在 Windows 上默认按 ANSI 打开，没有 BOM 中文全是乱码。
router.get('/admin/usage/export.csv', function(req, res) {
  var win = resolveUsageWindow(req.query);
  var group = String(req.query.group || 'user');
  var sql, keyCol, labelExpr;
  if (group === 'model') {
    keyCol = 'l.model_id';
    labelExpr = 'MAX(m.label)';
  } else {
    group = 'user';
    keyCol = 'l.user_id';
    labelExpr = 'MAX(IFNULL(NULLIF(u.net_name, \'\'), u.user_id))';
  }
  sql = [
    'SELECT ' + keyCol + ' AS key, ' + labelExpr + ' AS label,',
    ' COUNT(*) AS calls,',
    ' SUM(l.prompt_tokens) AS prompt_tokens,',
    ' SUM(l.completion_tokens) AS completion_tokens,',
    ' SUM(l.cache_hit_tokens) AS cache_hit_tokens,',
    ' SUM(l.total_tokens) AS total_tokens,',
    ' SUM(l.cost_micro) AS cost_micro,',
    ' SUM(l.search_credits) AS search_credits,',
    ' SUM(l.estimated) AS estimated_calls,',
    ' MAX(l.created_at) AS last_at',
    'FROM ai_usage_log l' + (group === 'model' ? ' LEFT JOIN ai_models m ON m.id = l.model_id' : ' LEFT JOIN users u ON u.user_id = l.user_id'),
    ' WHERE l.created_at >= ? AND l.created_at < ?',
    ' GROUP BY ' + keyCol + ' ORDER BY cost_micro DESC LIMIT 10000'
  ].join('\n');
  try {
    var rows = db.prepare(sql).all(win.from, win.to);
    var header = ['标识', '名称', '调用次数', '输入tokens', '输出tokens', '缓存命中tokens', '总tokens', '费用(元)', '联网次数', '估算次数', '最近一次'];
    var lines = [header.join(',')];
    function csvCell(v) {
      var s = String(v === undefined || v === null ? '' : v);
      if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      lines.push([
        csvCell(r.key), csvCell(r.label || r.key), r.calls || 0,
        r.prompt_tokens || 0, r.completion_tokens || 0, r.cache_hit_tokens || 0, r.total_tokens || 0,
        // 元，固定 6 位小数，避免微元换算丢精度
        ((r.cost_micro || 0) / 1000000).toFixed(6),
        r.search_credits || 0, r.estimated_calls || 0, csvCell(r.last_at)
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ai-usage-' + group + '-' + win.days + 'd.csv"');
    res.send('\ufeff' + lines.join('\r\n'));
  } catch (e) {
    console.error('[AI-Admin] usage csv failed:', e.message);
    res.status(500).json({ code: 500, message: '导出失败' });
  }
});

// ============================================================
// 管理端：价格规则（migration 014）—— 峰谷 / 折扣 / 限免
// 管理端单价一律以「元/百万token」进出，落库换算为微元/千token。
// ============================================================

var RULE_KINDS = ['price', 'discount', 'free'];

// 星期归一：数组或字符串 → '1,3,5' / '*'
function normalizeDays(v) {
  if (Array.isArray(v)) {
    var out = [];
    for (var i = 0; i < v.length; i++) {
      var n = parseInt(v[i], 10);
      if (n >= 1 && n <= 7 && out.indexOf(n) < 0) out.push(n);
    }
    return out.length ? out.sort().join(',') : '*';
  }
  var s = String(v === undefined || v === null ? '*' : v).trim();
  if (!s || s === '*') return '*';
  var parsed = parseDays(s);
  return parsed ? parsed.sort().join(',') : '*';
}

function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }

function validateRuleInput(body, isCreate) {
  var out = {};
  if (isCreate || body.label !== undefined) {
    var label = String(body.label || '').trim();
    if (!label) return { error: '规则名称不能为空' };
    if (label.length > 30) return { error: '规则名称过长（最多 30 字）' };
    out.label = label;
  }
  if (body.model_id !== undefined) {
    var mid = String(body.model_id || '').trim();
    if (mid && !aiService.getModelRow(mid)) return { error: '模型「' + mid + '」不存在' };
    out.model_id = mid;
  }
  if (body.kind !== undefined) {
    var kind = String(body.kind || 'price');
    if (RULE_KINDS.indexOf(kind) < 0) return { error: '计价方式无效' };
    out.kind = kind;
  }
  var priceKeys = ['price_in', 'price_out', 'price_cache_hit'];
  for (var i = 0; i < priceKeys.length; i++) {
    var pk = priceKeys[i];
    if (body[pk] === undefined) continue;
    var yuan = Number(body[pk]);
    if (!isFinite(yuan) || yuan < 0) yuan = 0;
    out[pk] = toMicroPerK(Math.min(yuan, 100000));
  }
  if (body.discount_percent !== undefined) {
    var pct = parseInt(body.discount_percent, 10);
    out.discount_percent = isFinite(pct) ? Math.max(0, Math.min(1000, pct)) : 100;
  }
  if (body.days_of_week !== undefined) out.days_of_week = normalizeDays(body.days_of_week);
  if (body.start_time !== undefined) {
    var st = String(body.start_time || '').trim();
    if (st && minutesOfDay(st) === null) return { error: '开始时间格式应为 HH:MM' };
    out.start_time = st;
  }
  if (body.end_time !== undefined) {
    var et = String(body.end_time || '').trim();
    if (et && minutesOfDay(et) === null) return { error: '结束时间格式应为 HH:MM' };
    out.end_time = et;
  }
  if (body.timezone_offset !== undefined) {
    var tz = parseInt(body.timezone_offset, 10);
    out.timezone_offset = isFinite(tz) ? Math.max(-720, Math.min(840, tz)) : 0;
  }
  if (body.valid_from !== undefined) {
    var vf = String(body.valid_from || '').trim();
    if (vf && !isDateStr(vf)) return { error: '生效开始日期格式应为 YYYY-MM-DD' };
    out.valid_from = vf;
  }
  if (body.valid_until !== undefined) {
    var vu = String(body.valid_until || '').trim();
    if (vu && !isDateStr(vu)) return { error: '生效结束日期格式应为 YYYY-MM-DD' };
    out.valid_until = vu;
  }
  if (body.priority !== undefined) {
    var pr = parseInt(body.priority, 10);
    out.priority = isFinite(pr) ? Math.max(0, Math.min(9999, pr)) : 100;
  }
  if (body.enabled !== undefined) out.enabled = body.enabled ? 1 : 0;
  if (body.note !== undefined) out.note = String(body.note || '').trim().substring(0, 200);
  return { value: out };
}

// 单条规则回显：单价换算回「元/百万token」，并标出此刻是否命中
function ruleToApi(r, nowMs) {
  return {
    id: r.id,
    label: r.label,
    model_id: r.model_id || '',
    kind: r.kind,
    price_in: fromMicroPerK(r.price_in),
    price_out: fromMicroPerK(r.price_out),
    price_cache_hit: fromMicroPerK(r.price_cache_hit),
    discount_percent: r.discount_percent === undefined ? 100 : r.discount_percent,
    days_of_week: r.days_of_week || '*',
    start_time: r.start_time || '',
    end_time: r.end_time || '',
    timezone_offset: r.timezone_offset || 0,
    valid_from: r.valid_from || '',
    valid_until: r.valid_until || '',
    priority: r.priority === undefined ? 100 : r.priority,
    enabled: !!r.enabled,
    note: r.note || '',
    matched_now: ruleMatches(r, r.model_id || '', nowMs || Date.now()),
    updated_at: r.updated_at || ''
  };
}

function allPriceRules() {
  try {
    return db.prepare('SELECT * FROM ai_price_rules ORDER BY priority ASC, id ASC').all();
  } catch (e) {
    return null;
  }
}

router.get('/admin/pricing/rules', function(req, res) {
  var rows = allPriceRules();
  if (rows === null) {
    return res.json({ code: 200, message: 'ok', data: { rules: [], unavailable: true } });
  }
  var now = Date.now();
  res.json({ code: 200, message: 'ok', data: { rules: rows.map(function(r) { return ruleToApi(r, now); }) } });
});

router.post('/admin/pricing/rules', function(req, res) {
  var check = validateRuleInput(req.body, true);
  if (check.error) return res.status(400).json({ code: 400, message: check.error });
  var v = check.value;
  var id = String(req.body.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!id) id = 'rule-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  if (id.length > 32) id = id.substring(0, 32);
  if (db.prepare('SELECT id FROM ai_price_rules WHERE id = ?').get(id)) {
    return res.status(400).json({ code: 400, message: '规则 ID 已存在，请换一个' });
  }
  try {
    db.prepare([
      'INSERT INTO ai_price_rules',
      '  (id, label, model_id, kind, price_in, price_out, price_cache_hit, discount_percent,',
      '   days_of_week, start_time, end_time, timezone_offset, valid_from, valid_until, priority, enabled, note)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ].join('\n')).run(
      id, v.label, v.model_id || '', v.kind || 'price',
      v.price_in || 0, v.price_out || 0, v.price_cache_hit || 0,
      v.discount_percent === undefined ? 100 : v.discount_percent,
      v.days_of_week || '*', v.start_time || '', v.end_time || '',
      v.timezone_offset || 0, v.valid_from || '', v.valid_until || '',
      v.priority === undefined ? 100 : v.priority,
      v.enabled === undefined ? 1 : v.enabled, v.note || ''
    );
  } catch (e) {
    return res.status(500).json({ code: 500, message: '规则创建失败：' + e.message });
  }
  console.log('[AI-Admin] price rule created: %s (%s) by %s', id, v.label, req.user.user_id);
  res.json({ code: 200, message: 'ok', data: { id: id } });
});

router.put('/admin/pricing/rules/:id', function(req, res) {
  var row = db.prepare('SELECT * FROM ai_price_rules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ code: 404, message: '规则不存在' });
  var check = validateRuleInput(req.body, false);
  if (check.error) return res.status(400).json({ code: 400, message: check.error });
  var v = check.value;

  var allowed = ['label', 'model_id', 'kind', 'price_in', 'price_out', 'price_cache_hit',
    'discount_percent', 'days_of_week', 'start_time', 'end_time', 'timezone_offset',
    'valid_from', 'valid_until', 'priority', 'enabled', 'note'];
  var sets = [];
  var params = [];
  for (var i = 0; i < allowed.length; i++) {
    var field = allowed[i];
    if (v[field] !== undefined) {
      sets.push(field + ' = ?');
      params.push(v[field]);
    }
  }
  if (sets.length > 0) {
    params.push(row.id);
    var stmt = db.prepare("UPDATE ai_price_rules SET " + sets.join(', ') + ", updated_at = datetime('now') WHERE id = ?");
    stmt.run.apply(stmt, params);
  }
  console.log('[AI-Admin] price rule updated: %s by %s', row.id, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
});

router.put('/admin/pricing/rules/:id/toggle', function(req, res) {
  var row = db.prepare('SELECT * FROM ai_price_rules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ code: 404, message: '规则不存在' });
  var enabled = req.body.enabled ? 1 : 0;
  db.prepare("UPDATE ai_price_rules SET enabled = ?, updated_at = datetime('now') WHERE id = ?").run(enabled, row.id);
  console.log('[AI-Admin] price rule %s: %s by %s', enabled ? 'enabled' : 'disabled', row.id, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
});

router.delete('/admin/pricing/rules/:id', function(req, res) {
  var row = db.prepare('SELECT * FROM ai_price_rules WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ code: 404, message: '规则不存在' });
  db.prepare('DELETE FROM ai_price_rules WHERE id = ?').run(row.id);
  console.log('[AI-Admin] price rule deleted: %s by %s', row.id, req.user.user_id);
  res.json({ code: 200, message: 'ok' });
});

// 试算器：给定模型 + 时间点 + 示例 token，返回命中规则、单价、金额，
// 并给出以 tz_offset 为基准的当天 24 小时价格曲线（用于核对峰谷设置）。
router.post('/admin/pricing/preview', function(req, res) {
  var modelId = String(req.body.model_id || '');
  var mc = modelId ? aiService.resolveModel(modelId) : null;
  if (!mc) return res.status(404).json({ code: 404, message: '模型不存在' });

  var tz = parseInt(req.body.tz_offset, 10);
  if (!isFinite(tz) || tz < -720 || tz > 840) tz = 480;

  var when = Date.now();
  var atStr = String(req.body.at || '').trim();
  if (atStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(atStr);
    if (!m) return res.status(400).json({ code: 400, message: '时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:MM' });
    when = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), 0) - tz * 60000;
  }

  function nonNeg(v, dft) {
    var n = parseInt(v, 10);
    if (!isFinite(n) || n < 0) return dft;
    return n;
  }
  var sample = {
    prompt_tokens: nonNeg(req.body.prompt_tokens, 1000),
    completion_tokens: nonNeg(req.body.completion_tokens, 200),
    prompt_cache_hit_tokens: nonNeg(req.body.cache_hit_tokens, 0)
  };

  function describe(utcMs) {
    var pr = resolvePrice(mc, utcMs);
    var cost = calcCostMicro(pr, sample);
    return {
      at: fmtUtc(new Date(utcMs)),
      rule_id: pr.ruleId,
      rule_label: pr.ruleLabel,
      is_base: !!pr.base,
      free: !!pr.free,
      price_in: fromMicroPerK(pr.priceIn),
      price_out: fromMicroPerK(pr.priceOut),
      price_cache_hit: fromMicroPerK(pr.priceCacheHit),
      cost_micro: cost,
      cost_yuan: Math.round(cost / 100) / 10000
    };
  }

  // 当天 24 小时曲线：以 tz_offset 的当地 00:00 为起点
  var local = new Date(when + tz * 60000);
  var dayStartUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0) - tz * 60000;
  var hours = [];
  for (var i = 0; i < 24; i++) {
    var d = describe(dayStartUtc + i * 3600000);
    d.hour = i;
    hours.push(d);
  }

  res.json({
    code: 200, message: 'ok',
    data: {
      model_id: mc.id,
      model_label: mc.label,
      model_is_free: !!mc.isFree,
      tz_offset: tz,
      base: {
        price_in: fromMicroPerK(mc.priceIn),
        price_out: fromMicroPerK(mc.priceOut),
        price_cache_hit: fromMicroPerK(mc.priceCacheHit)
      },
      sample: sample,
      current: describe(when),
      hours: hours
    }
  });
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

// 统一前置（/chat 与 /chat/stream 共用）：
//   校验会话与模型 → 解析云盘图片附件 → 决定 native / relay → 落库用户消息 → 构造 aiMessages
// 图片相关的一切都在这一处处理，两个发送接口不再各写一遍。
// resolve 出的字段里：
//   items       —— 本次附带的云盘图片（含 dataUrl）
//   imageUrls   —— 需要直接发给视觉模型的 data URL（native 模式才有）
//   finalUserText —— 真正送进模型的用户文本（relay 模式下已拼好图片转述）
//   relayUsage  —— 转述模型自身消耗的 token（要单独记一笔账）
function prepareChatRequest(req) {
  var conversationId = req.body.conversation_id;
  var userMessage = String(req.body.message || '');
  var userSystemPrompt = req.body.system_prompt;
  var requestedModel = req.body.model;
  var userId = req.user.user_id;

  if (!userMessage) return Promise.reject({ status: 400, message: '消息不能为空' });
  if (!conversationId) return Promise.reject({ status: 400, message: '对话ID不能为空' });

  var conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId);
  if (!conv) return Promise.reject({ status: 404, message: '对话不存在' });

  var aiSettings = getUserAiSettings(userId);
  var policyAllowed = req.user.is_admin === 1 ? null : getPolicyAllowedIds(aiSettings.policy_id);
  var mc = resolveUserModel(userId, requestedModel, policyAllowed);
  if (!mc) return Promise.reject({ status: 503, message: '暂无可用模型，请联系管理员启用' });

  // 额度闸门（migration 016）：没设额度的人在这里零开销直接放行
  var gateMsg = checkWalletGate(userId);
  if (gateMsg) return Promise.reject({ status: 402, message: gateMsg });

  var thinking = !!req.body.thinking && mc.supportsThinking;
  var systemPrompt = getEffectiveSystemPrompt(conv.persona, userSystemPrompt || aiSettings.system_prompt);
  var messages = JSON.parse(conv.messages_json || '[]');
  var summary = conv.summary || '';
  var isFirstMessage = messages.length === 0;

  var rawImages = Array.isArray(req.body.images) ? req.body.images : [];
  var maxImgs = visionMaxImages(mc);
  var items = [];
  var visionMode = 'none';
  var vision = null;

  if (rawImages.length > 0) {
    vision = resolveVisionMode(mc);
    visionMode = vision.mode;
    if (visionMode === 'none') {
      return Promise.reject({
        status: 400,
        message: vision.disabled
          ? '管理员已关闭看图功能'
          : '当前模型「' + mc.label + '」不支持看图。请切换到支持视觉的模型，或让管理员配置「统一转述模型」'
      });
    }
    if (rawImages.length > maxImgs) {
      return Promise.reject({ status: 400, message: '一次最多发送 ' + maxImgs + ' 张图片' });
    }
    var attach = resolveImageAttachments(userId, rawImages);
    if (attach.error) return Promise.reject({ status: 400, message: attach.error });
    items = attach.items;
    if (!items.length) return Promise.reject({ status: 400, message: '图片无效或无权访问' });
  }

  // 落库只记云盘 hash + 直链，绝不把 base64 写进 messages_json
  var storedMessage = { role: 'user', content: userMessage, timestamp: new Date().toISOString() };
  if (items.length) {
    storedMessage.images = items.map(function(it) {
      return { hash: it.hash, name: it.name, url: it.url };
    });
  }

  function finish(relayText, relayUsage, relayModelId, imageUrls) {
    var finalUserText = userMessage;
    if (relayText) {
      finalUserText = '（以下是用户所发图片的转述内容，请据此回答用户的问题）\n' +
        relayText + '\n\n用户的问题：' + userMessage;
    }
    var aiMessages = buildAiMessages(messages, summary, systemPrompt, finalUserText, thinking, mc.maxContextTokens, imageUrls);
    appendMessageAtomic(conversationId, storedMessage);
    return {
      conversationId: conversationId,
      conv: conv,
      mc: mc,
      thinking: thinking,
      policyAllowed: policyAllowed,
      messages: messages,
      summary: summary,
      isFirstMessage: isFirstMessage,
      aiMessages: aiMessages,
      userMessage: userMessage,
      finalUserText: finalUserText,
      items: items,
      imageUrls: imageUrls || [],
      visionMode: visionMode,
      relayUsage: relayUsage || null,
      relayModelId: relayModelId || ''
    };
  }

  if (visionMode === 'native') {
    // 本次的图 + 最近两条带图历史（上限 2 张）：让「再看看这张」这类追问能接得上
    var extra = collectHistoryImageUrls(messages, userId, Math.max(0, 2 - items.length));
    var urls = extra.concat(items.map(function(it) { return it.dataUrl; }));
    return Promise.resolve(finish(null, null, '', urls));
  }

  if (visionMode === 'relay') {
    return describeImages(vision.relay, items, userMessage).then(function(r) {
      return finish(r.text, r.usage, vision.relay.id, null);
    }).catch(function(err) {
      var msg = (err && err.message) ? err.message : '未知错误';
      return Promise.reject({ status: 502, message: '图片转述失败：' + msg });
    });
  }

  return Promise.resolve(finish(null, null, '', null));
}

// 转述模型的消耗单独记一笔（source='vision'），不混进对话模型的账里
function recordRelayUsage(req, p) {
  if (!p || !p.relayUsage || !p.relayModelId) return;
  try {
    recordUsage({
      userId: req.user.user_id,
      conversationId: p.conversationId,
      modelId: p.relayModelId,
      mc: aiService.resolveModel(p.relayModelId),
      source: 'vision',
      usage: p.relayUsage,
      promptTokens: 0,
      content: ''
    });
  } catch (e) {
    console.error('[AI] vision relay usage 记账失败:', e.message);
  }
}

router.post('/chat', function(req, res) {
  prepareChatRequest(req).then(function(p) {
    var conversationId = p.conversationId;
    var mc = p.mc;
    var thinking = p.thinking;
    var aiMessages = p.aiMessages;
    var isFirstMessage = p.isFirstMessage;
    var userMessage = p.userMessage;
    var summary = p.summary;
    var policyAllowed = p.policyAllowed;

    recordRelayUsage(req, p);

    var aiOptions = buildAiOptions(mc, req.user.user_id, thinking);
    // 与 /chat/stream 同口径：非实时问题不挂工具，省一次往返也避免模型乱搜
    if (shouldEnableSearch(mc) && (req.body.force_search === true || looksLikeSearchRequest(userMessage))) {
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
        var toolResult = await executeSearchTool(tc, { userId: req.user.user_id, conversationId: conversationId, modelId: mc.id });
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
      usage: data.usage || null,
      userId: req.user.user_id,
      source: 'chat',
      mc: mc,
      promptTokens: estimatePromptTokens(aiMessages)
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
    var fbMc = getFallbackModel(mc.id, policyAllowed);
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
          usage: data.usage || null,
          userId: req.user.user_id,
          source: 'fallback',
          mc: fbMc,
          promptTokens: estimatePromptTokens(aiMessages)
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
  }).catch(function(prepErr) {
    // 前置失败（会话不存在 / 模型不可用 / 图片不合规 / 转述失败）
    if (prepErr && prepErr.status) {
      return res.status(prepErr.status).json({ code: prepErr.status, message: prepErr.message });
    }
    console.error('AI chat prepare error:', prepErr && prepErr.message);
    res.status(500).json({ code: 500, message: '请求处理失败' });
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

// 落库助手回复 + 首条消息命名 + 用量记账（chat 与 fallback 共用）
// p: { content, reasoning, isFirstMessage, userMessage, summary, usedModelId,
//      usage, userId, source, mc, promptTokens }
function finishAssistantReply(conversationId, p) {
  // 记账先于「空回复」判断：上游已计费但内容为空（如仅工具调用）也要留痕
  if (p.usage || p.promptTokens !== undefined || p.content) {
    recordUsage({
      userId: p.userId,
      conversationId: conversationId,
      modelId: p.usedModelId,
      mc: p.mc,
      source: p.source || 'chat',
      usage: p.usage,
      promptTokens: p.promptTokens,
      content: p.content
    });
  }

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
  // 前置（会话校验 / 模型解析 / 云盘图片 / 落库用户消息）与 /chat 完全同一条路径，
  // 差异只在「怎么把结果吐给前端」：这里跑 SSE，故主体抽成 runStream 由 Promise 驱动。
  prepareChatRequest(req).then(runStream).catch(function(prepErr) {
    if (prepErr && prepErr.status) {
      return res.status(prepErr.status).json({ code: prepErr.status, message: prepErr.message });
    }
    console.error('AI stream prepare error:', prepErr && prepErr.message);
    return res.status(500).json({ code: 500, message: '请求处理失败' });
  });

  function runStream(p) {
  var conversationId = p.conversationId;
  var mc = p.mc;
  var thinking = p.thinking;
  var aiMessages = p.aiMessages;
  var isFirstMessage = p.isFirstMessage;
  var userMessage = p.userMessage;
  var summary = p.summary;
  var policyAllowed = p.policyAllowed;

  recordRelayUsage(req, p);

  var fullContent = '';
  var fullReasoning = '';
  var assistantSaved = false;
  // 用量记账（migration 013）：流式末帧 usage 来自 onUsage 回调，
  // 搜索分支走非流式、用 data.usage；降级换模时记录实际使用的模型。
  var streamUsage = null;
  var streamUsedMc = mc;
  var streamSource = 'stream';

  function saveAssistantMessage() {
    if (assistantSaved) return;
    assistantSaved = true;

    // 记账先于「空回复」判断：中断的半截回复同样消耗了上游 token
    recordUsage({
      userId: req.user.user_id,
      conversationId: conversationId,
      modelId: streamUsedMc ? streamUsedMc.id : mc.id,
      mc: streamUsedMc,
      source: streamSource,
      usage: streamUsage,
      promptTokens: estimatePromptTokens(aiMessages),
      content: fullContent
    });

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
  aiOptions.onUsage = function(usage) {
    streamUsage = usage;
  };
  // 只有「看起来真需要联网」才挂工具并走非流式探测，否则直接流式出字
  var enableSearch = shouldEnableSearch(mc) &&
    (req.body.force_search === true || looksLikeSearchRequest(userMessage));
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
      // 搜索分支全程走非流式，usage 需在此累积（含工具探测那一发）
      streamUsage = addUsage(streamUsage, data.usage);
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
          var toolResult = await executeSearchTool(tc, { userId: req.user.user_id, conversationId: conversationId, modelId: mc.id });
          aiMessages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
        }

        res.write('data: ' + JSON.stringify({ searching: false }) + '\n\n');

        var followUpOptions = Object.assign({}, nonStreamOptions);
        delete followUpOptions.tools;
        delete followUpOptions.toolChoice;
        data = await aiService.chatWithAI(aiMessages, followUpOptions);
        streamUsage = addUsage(streamUsage, data.usage);
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
        // 该分支已把两次调用的 usage 合并进 streamUsage，SSE 只推本轮增量
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
      var fbMc = res.writableEnded ? null : getFallbackModel(mc.id, policyAllowed);
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
        fallbackOptions.onUsage = function(usage) {
          streamUsage = usage;
        };
        // 记账归到真正出字的模型
        streamUsedMc = fbMc;
        streamSource = 'fallback';
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
  }
});

module.exports = router;
