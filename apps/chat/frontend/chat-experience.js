// 聊天体验内核：纯逻辑、零依赖、零 DOM，可在 Node 下直接单测。
// 抽出来的原因：Chat.vue 已 6000+ 行，体验规则散落在模板与 WebSocket 回调里
// 既改不动也测不了。这里只回答「该显示什么 / 该发什么 / 该翻哪一页」，
// 真正的 Vue 状态与网络请求仍由 Chat.vue 负责。
//
// 兼容性：ES module + var/function，不使用可选链、??、Array.at 等 Chrome 80 之后的特性。

// ---------- 会话识别 ----------

export function chatKind(chatId) {
  var id = String(chatId || '');
  if (id === 'public') return 'public';
  if (id.indexOf('group_') === 0 || id.indexOf('group-') === 0) return 'group';
  return 'private';
}

// 生产库实测：最热 8 个私聊会话里 6 个是 linxi_ai，单会话最多 4965 条。
// 机器人不会发 user_typing，学生发完消息只能盯着一片死寂 —— 需要本地等待指示。
export function isBotChat(chatId, extraPatterns) {
  var id = String(chatId || '').toLowerCase();
  if (!id) return false;
  if (id === 'linxi_ai' || id.indexOf('linxi') !== -1) return true;
  var patterns = extraPatterns || ['bot', 'assistant', 'astrbot'];
  for (var i = 0; i < patterns.length; i++) {
    var p = patterns[i];
    if (id === p || id.indexOf(p + '_') === 0 || id.indexOf('_' + p) !== -1) return true;
  }
  return false;
}

// ---------- 发送：不吞消息 ----------

// 旧逻辑 `if (!content || self.sending) return` —— 上一条还在飞时，
// 学生按发送/回车毫无反应，输入框里的字还在，像卡死。改成明确三态。
export function sendDecision(input) {
  var o = input || {};
  if (!o.content || !String(o.content).trim()) return 'drop';
  if (o.sending) return 'queue';
  return 'send';
}

// 排队队列：严格 FIFO，保证同学看到的顺序与学生打字顺序一致。
export function createSendQueue() {
  var items = [];
  return {
    push: function (item) { items.push(item); return items.length; },
    shift: function () { return items.length ? items.shift() : null; },
    size: function () { return items.length; },
    clear: function () { var n = items.length; items = []; return n; }
  };
}

// 在光标处插入换行。Chrome 80 平板的软键盘没有 Shift+Enter，
// 而裸 Enter 会直接发送半句话；给一个显式按钮比偷偷改键位安全。
export function insertNewline(text, start, end) {
  var s = String(text || '');
  var len = s.length;
  // 未提供光标位置 → 默认插在末尾；给出了越界值 → 钳制到 [0, len]。
  var a = (start === null || start === undefined || start === '' || !isFinite(Number(start)))
    ? len : Math.max(0, Math.min(len, Number(start)));
  var b = (end === null || end === undefined || end === '' || !isFinite(Number(end)))
    ? a : Math.max(a, Math.min(len, Number(end)));
  return { text: s.slice(0, a) + '\n' + s.slice(b), caret: a + 1 };
}

// ---------- 机器人等待指示 ----------

export function createBotTyping(options) {
  var o = options || {};
  var timeoutMs = o.timeoutMs > 0 ? o.timeoutMs : 20000;
  var now = o.now || function () { return Date.now(); };
  var active = {};
  return {
    start: function (chatId) {
      if (!chatId) return false;
      active[chatId] = { startAt: now() };
      return true;
    },
    stop: function (chatId) {
      if (!chatId || !active[chatId]) return false;
      delete active[chatId];
      return true;
    },
    // 超时自动熄灭：宁可不显示，也不能挂一晚上「正在输入…」
    isActive: function (chatId) {
      var a = active[chatId];
      if (!a) return false;
      if (now() - a.startAt >= timeoutMs) { delete active[chatId]; return false; }
      return true;
    },
    // 只有「对方」的消息才能结束等待；自己发的其它消息不算
    onIncoming: function (chatId, senderId, ownId) {
      if (!chatId || !active[chatId]) return false;
      if (senderId && ownId && String(senderId) === String(ownId)) return false;
      delete active[chatId];
      return true;
    },
    activeCount: function () { return Object.keys(active).length; },
    clear: function () { active = {}; }
  };
}

// ---------- 已读回执：失败可补报 ----------

// 生产库 61154 / 99911 条私聊仍是 read=0。旧链路只在「拉取成功」时
// 用 WebSocket 发一次 mark_read，发即忘、无 ack、无补报。
// tracker 只负责判定「这一刻该不该发」，网络仍由 Chat.vue 执行。
export function createReadTracker() {
  var sent = {};
  var dirty = {};
  return {
    shouldSend: function (chatId, msgId) {
      if (!chatId || !msgId) return false;
      if (dirty[chatId]) return true;
      return sent[chatId] !== msgId;
    },
    committed: function (chatId, msgId) {
      if (!chatId || !msgId) return false;
      sent[chatId] = msgId;
      delete dirty[chatId];
      return true;
    },
    // WebSocket 未连接 / send 返回 falsy / 拉取失败 → 标记待补报
    invalidate: function (chatId) {
      if (chatId) { dirty[chatId] = true; return 1; }
      var keys = Object.keys(sent);
      for (var i = 0; i < keys.length; i++) dirty[keys[i]] = true;
      return keys.length;
    },
    reset: function (chatId) { delete sent[chatId]; delete dirty[chatId]; },
    pendingCount: function () { return Object.keys(dirty).length; }
  };
}

// ---------- 历史分页 ----------

// 后端三种会话都支持 before_id（public / groups / private），
// 但旧前端只为 public 与 group 实现了往上翻，私聊 4965 条永远停在最近 50 条。
export function olderRequest(input) {
  var o = input || {};
  var oldestId = o.oldestId;
  if (oldestId === null || oldestId === undefined || oldestId === '') return null;
  // 数据库 id 是正整数；0 / 负数 / 非数字都不能当游标，否则会把全表当「更早」再拉一遍
  var cursor = Number(oldestId);
  if (!isFinite(cursor) || cursor <= 0) return null;
  // 本地乐观消息 id 形如 "1730000000000_abc123"，不能当数据库游标
  if (String(oldestId).indexOf('_') !== -1) return null;
  var params = { before_id: oldestId, limit: o.limit || 50 };
  var kind = o.kind || chatKind(o.chatId);
  if (kind === 'public') {
    return { url: '/chat/messages', params: params, payload: 'list' };
  }
  if (kind === 'group') {
    return {
      url: '/chat/groups/' + encodeURIComponent(o.chatId) + '/messages',
      params: params, payload: 'messages'
    };
  }
  if (kind === 'private') {
    return {
      url: '/chat/private/' + encodeURIComponent(o.chatId),
      params: params, payload: 'list'
    };
  }
  return null;
}

export function pickOlderMessages(data, payload) {
  if (!data) return [];
  var raw = payload === 'messages' ? (data.messages || []) : (data.data || []);
  return Array.isArray(raw) ? raw : [];
}

// 顶部插入历史后保持视觉位置：新增高度全部补给 scrollTop。
export function scrollAnchor(prevHeight, nextHeight, currentTop) {
  var delta = (Number(nextHeight) || 0) - (Number(prevHeight) || 0);
  return Math.max(0, (Number(currentTop) || 0) + delta);
}

export function hasMoreFor(kind, chatId, maps) {
  var m = maps || {};
  if (kind === 'public') return m.chatHasMore !== false;
  var table = kind === 'group' ? (m.groupHasMore || {}) : (m.privateHasMore || {});
  return table[chatId] !== false;
}

export function loadingFor(kind, chatId, maps) {
  var m = maps || {};
  if (kind === 'public') return !!m.chatLoadingMore;
  var table = kind === 'group' ? (m.groupLoadingMore || {}) : (m.privateLoadingMore || {});
  return !!table[chatId];
}

// ---------- 错误态：拉不到 ≠ 没有 ----------

export function emptyState(input) {
  var o = input || {};
  if (o.loading) return { kind: 'loading', text: '正在连接聊天服务器…', retry: false };
  if (o.error) return { kind: 'error', text: '消息没加载出来', hint: String(o.error), retry: true };
  if (o.searching) return { kind: 'empty', text: '未找到匹配的消息', retry: false };
  var rows = o.rows || [];
  if (rows.length === 0) return { kind: 'empty', text: o.emptyText || '暂无消息，开始聊天吧', retry: false };
  return { kind: 'list', text: '', retry: false };
}

// ---------- 联系人排序：置顶要真的生效 ----------

export function pinnedRank(chatId, pinnedList) {
  var list = pinnedList || [];
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    var id = (p && typeof p === 'object') ? (p.id || p.chatId) : p;
    if (String(id) === String(chatId)) return 1;
  }
  return 0;
}

// ---------- 机器人回复排版 ----------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 只对「确实带 Markdown 标记」的机器人消息启用，其余（图片 / 支付卡片 / 普通文本）
// 仍走原来的 renderRichText，媒体与链接行为一字不动。
export function needsMarkdown(content) {
  var s = String(content || '');
  return s.indexOf('**') !== -1 || s.indexOf('`') !== -1 || /(^|\n)\s*[-*]\s+/.test(s);
}

// 先整体转义、再插入自生成标签 —— 绝不把用户输入当 HTML。
// 代码块优先切段，块内内容不再做行内替换，避免把代码里的 ** 换成 <strong>。
export function renderBotReply(content) {
  var text = String(content || '');
  var parts = text.split('```');
  var out = '';
  for (var i = 0; i < parts.length; i++) {
    var seg = parts[i];
    if (i % 2 === 1) {
      out += '<pre class="bot-code-block"><code>' + escapeHtml(seg.replace(/^\r?\n/, '')) + '</code></pre>';
      continue;
    }
    var lines = seg.split('\n');
    var htmlLines = [];
    for (var j = 0; j < lines.length; j++) {
      var line = escapeHtml(lines[j]);
      line = line.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
      line = line.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      line = line.replace(/^\s*[-*]\s+(.*)$/, '<span class="bot-list-item">• $1</span>');
      htmlLines.push(line);
    }
    out += htmlLines.join('<br>');
  }
  return out;
}
