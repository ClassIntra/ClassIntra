// 聊天体验内核回归：纯逻辑，不连库、不启服务、不碰生产数据。
// 用系统 Node 直接跑：node scripts-test-chat-experience.mjs
import * as X from '../apps/chat/frontend/chat-experience.js';

var pass = 0;
var fail = 0;
function eq(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return; }
  fail++;
  console.log('  ✗ ' + name + ' → got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}
function ok(name, cond) { eq(name, !!cond, true); }
function throws(name, fn) {
  try { fn(); fail++; console.log('  ✗ ' + name + ' → 未抛错'); }
  catch (e) { pass++; }
}

console.log('=== 会话识别 ===');
eq('public', X.chatKind('public'), 'public');
eq('group_ 前缀', X.chatKind('group_1790_sg'), 'group');
eq('group- 前缀', X.chatKind('group-42'), 'group');
eq('学号是私聊', X.chatKind('250866'), 'private');
eq('空值按私聊', X.chatKind(''), 'private');
eq('linxi_ai 是 bot', X.isBotChat('linxi_ai'), true);
eq('LINXI_AI 大小写不敏感', X.isBotChat('LINXI_AI'), true);
eq('含 linxi', X.isBotChat('linxi_ai_2'), true);
eq('astrbot 前缀', X.isBotChat('astrbot_relay'), true);
eq('普通学号不是 bot', X.isBotChat('250866'), false);
eq('public 不是 bot', X.isBotChat('public'), false);
eq('空值不是 bot', X.isBotChat(null), false);
eq('自定义模式', X.isBotChat('tutor_x', ['tutor']), true);

console.log('=== 发送决策与队列 ===');
eq('空内容丢弃', X.sendDecision({ content: '   ', sending: false }), 'drop');
eq('null 内容丢弃', X.sendDecision({ content: null, sending: false }), 'drop');
eq('空闲直接发', X.sendDecision({ content: '在吗', sending: false }), 'send');
eq('忙时排队而非吞掉', X.sendDecision({ content: '第二句', sending: true }), 'queue');
eq('忙时空内容仍丢弃', X.sendDecision({ content: '', sending: true }), 'drop');
var q = X.createSendQueue();
eq('队列初始为空', q.size(), 0);
eq('入队返回长度', q.push('a'), 1);
q.push('b'); q.push('c');
eq('队列长度 3', q.size(), 3);
eq('严格 FIFO 1', q.shift(), 'a');
eq('严格 FIFO 2', q.shift(), 'b');
eq('空队列 shift 返回 null', (function () { q.shift(); return q.shift(); })(), null);
eq('clear 返回清掉的数量', (function () { q.push('x'); q.push('y'); return q.clear(); })(), 2);

console.log('=== 换行插入 ===');
eq('末尾换行', X.insertNewline('你好', 2, 2), { text: '你好\n', caret: 3 });
eq('中间插入', X.insertNewline('abcd', 2, 2), { text: 'ab\ncd', caret: 3 });
eq('选中替换', X.insertNewline('abcdef', 2, 4), { text: 'ab\nef', caret: 3 });
eq('空文本', X.insertNewline('', 0, 0), { text: '\n', caret: 1 });
eq('越界 start 收敛到末尾', X.insertNewline('ab', 99, 99), { text: 'ab\n', caret: 3 });
eq('负数 start 收敛到 0', X.insertNewline('ab', -5, -5), { text: '\nab', caret: 1 });
eq('end 小于 start 时收敛', X.insertNewline('abcd', 3, 1), { text: 'abc\nd', caret: 4 });

console.log('=== 机器人等待指示（假时钟） ===');
var clock = 1000;
var bt = X.createBotTyping({ timeoutMs: 20000, now: function () { return clock; } });
eq('初始未激活', bt.isActive('linxi_ai'), false);
eq('start 成功', bt.start('linxi_ai'), true);
eq('start 后激活', bt.isActive('linxi_ai'), true);
eq('activeCount=1', bt.activeCount(), 1);
eq('空 chatId 不 start', bt.start(''), false);
eq('自己发的消息不结束等待', bt.onIncoming('linxi_ai', '250866', '250866'), false);
eq('仍在等待', bt.isActive('linxi_ai'), true);
eq('对方消息结束等待', bt.onIncoming('linxi_ai', 'linxi_ai', '250866'), true);
eq('结束后不激活', bt.isActive('linxi_ai'), false);
bt.start('linxi_ai');
clock = 20999;
eq('超时前仍激活', bt.isActive('linxi_ai'), true);
clock = 21000;
eq('超时自动熄灭', bt.isActive('linxi_ai'), false);
eq('超时后 activeCount 归零', bt.activeCount(), 0);
bt.start('a'); bt.start('b');
eq('多会话', bt.activeCount(), 2);
eq('stop 单个', bt.stop('a'), true);
eq('stop 不存在的返回 false', bt.stop('a'), false);
eq('clear 全部', (function () { bt.clear(); return bt.activeCount(); })(), 0);

console.log('=== 已读回执补报 ===');
var rt = X.createReadTracker();
eq('缺 chatId 不报', rt.shouldSend('', 12), false);
eq('缺 msgId 不报', rt.shouldSend('250866', null), false);
eq('首次该报', rt.shouldSend('250866', 12), true);
eq('提交成功', rt.committed('250866', 12), true);
eq('同点位不重复报', rt.shouldSend('250866', 12), false);
eq('点位前移要补报', rt.shouldSend('250866', 13), true);
rt.committed('250866', 13);
eq('发送失败标记待补报', rt.invalidate('250866'), 1);
eq('待补报数 1', rt.pendingCount(), 1);
eq('同点位也要重发', rt.shouldSend('250866', 13), true);
rt.committed('250866', 13);
eq('补报后清空', rt.pendingCount(), 0);
rt.committed('250800', 5);
eq('全局 invalidate 覆盖全部已知会话', rt.invalidate(), 2);
rt.reset('250866');
eq('reset 后按新会话处理', rt.shouldSend('250866', 99), true);
eq('commit 空参数不生效', rt.committed('', 1), false);

console.log('=== 历史分页请求 ===');
eq('public 请求', X.olderRequest({ kind: 'public', chatId: 'public', oldestId: 900 }),
  { url: '/chat/messages', params: { before_id: 900, limit: 50 }, payload: 'list' });
eq('group 请求', X.olderRequest({ kind: 'group', chatId: 'group_1', oldestId: 30 }),
  { url: '/chat/groups/group_1/messages', params: { before_id: 30, limit: 50 }, payload: 'messages' });
eq('private 请求（旧版缺失的分支）', X.olderRequest({ kind: 'private', chatId: '250866', oldestId: 12 }),
  { url: '/chat/private/250866', params: { before_id: 12, limit: 50 }, payload: 'list' });
eq('自动推断私聊', X.olderRequest({ chatId: '250866', oldestId: 12 }).payload, 'list');
eq('自定义 limit', X.olderRequest({ kind: 'private', chatId: 'a', oldestId: 1, limit: 30 }).params.limit, 30);
eq('无游标返回 null', X.olderRequest({ kind: 'private', chatId: 'a' }), null);
eq('0 游标返回 null', X.olderRequest({ kind: 'private', chatId: 'a', oldestId: 0 }), null);
eq('临时 id 不能当游标', X.olderRequest({ kind: 'private', chatId: 'a', oldestId: '1730000_abc' }), null);
eq('未知 kind 返回 null', X.olderRequest({ kind: 'weird', chatId: 'a', oldestId: 1 }), null);
eq('chatId 转义', X.olderRequest({ kind: 'private', chatId: 'a b', oldestId: 1 }).url, '/chat/private/a%20b');
eq('list 载荷取 data', X.pickOlderMessages({ data: [1, 2] }, 'list'), [1, 2]);
eq('messages 载荷取 messages', X.pickOlderMessages({ messages: [3] }, 'messages'), [3]);
eq('缺数据返回空数组', X.pickOlderMessages(null, 'list'), []);
eq('非数组返回空数组', X.pickOlderMessages({ data: 'oops' }, 'list'), []);
eq('滚动锚定：高度增加量补给 scrollTop', X.scrollAnchor(1000, 1400, 0), 400);
eq('滚动锚定：保留原有偏移', X.scrollAnchor(1000, 1400, 20), 420);
eq('滚动锚定：不变高', X.scrollAnchor(1000, 1000, 33), 33);
eq('滚动锚定：不为负', X.scrollAnchor(1000, 800, 5), 0);

console.log('=== 分页状态判定 ===');
var maps = {
  chatHasMore: false, chatLoadingMore: true,
  groupHasMore: { g1: false }, groupLoadingMore: { g2: true },
  privateHasMore: { p1: false }, privateLoadingMore: { p2: true }
};
eq('public 无更多', X.hasMoreFor('public', 'public', maps), false);
eq('public 正在加载', X.loadingFor('public', 'public', maps), true);
eq('group 无更多', X.hasMoreFor('group', 'g1', maps), false);
eq('group 默认有更多', X.hasMoreFor('group', 'g9', maps), true);
eq('private 无更多（4965 条翻到底）', X.hasMoreFor('private', 'p1', maps), false);
eq('private 默认有更多', X.hasMoreFor('private', 'p9', maps), true);
eq('private 正在加载', X.loadingFor('private', 'p2', maps), true);
eq('private 未在加载', X.loadingFor('private', 'p1', maps), false);
eq('空 maps 默认有更多', X.hasMoreFor('private', 'x'), true);

console.log('=== 错误态（拉不到 ≠ 没有） ===');
eq('加载中', X.emptyState({ loading: true, rows: [] }).kind, 'loading');
eq('失败优先于空态', X.emptyState({ error: '网络超时', rows: [] }).kind, 'error');
eq('失败给重试', X.emptyState({ error: '网络超时', rows: [] }).retry, true);
eq('失败保留原因', X.emptyState({ error: 'HTTP 502', rows: [] }).hint, 'HTTP 502');
eq('搜索无结果', X.emptyState({ searching: true, rows: [] }).text, '未找到匹配的消息');
eq('真空态', X.emptyState({ rows: [] }).kind, 'empty');
eq('有数据走列表', X.emptyState({ rows: [1] }).kind, 'list');
eq('自定义空态文案', X.emptyState({ rows: [], emptyText: '和同学打个招呼' }).text, '和同学打个招呼');

console.log('=== 置顶排序 ===');
eq('置顶命中', X.pinnedRank('250866', ['250800', '250866']), 1);
eq('对象形式命中', X.pinnedRank('250866', [{ id: '250866' }]), 1);
eq('对象 chatId 形式命中', X.pinnedRank('250866', [{ chatId: '250866' }]), 1);
eq('未置顶', X.pinnedRank('250866', ['250800']), 0);
eq('空列表', X.pinnedRank('250866', null), 0);
eq('数字 id 比较', X.pinnedRank(250866, [250866]), 1);

console.log('=== 机器人回复排版（先转义，后插标签） ===');
eq('普通文本不启用', X.needsMarkdown('你好呀'), false);
eq('加粗要启用', X.needsMarkdown('这是 **重点**'), true);
eq('行内代码要启用', X.needsMarkdown('用 `npm test`'), true);
eq('代码块要启用', X.needsMarkdown('```\ncode\n```'), true);
eq('列表要启用', X.needsMarkdown('第一点\n- 第二点'), true);
eq('加粗渲染', X.renderBotReply('这是 **重点**'), '这是 <strong>重点</strong>');
eq('行内代码渲染', X.renderBotReply('跑 `npm test`'), '跑 <code class="inline-code">npm test</code>');
eq('换行转 br', X.renderBotReply('第一行\n第二行'), '第一行<br>第二行');
eq('列表渲染', X.renderBotReply('- 一条'), '<span class="bot-list-item">• 一条</span>');
eq('代码块独立成段', X.renderBotReply('说明\n```\nvar a = 1;\n```'),
  '说明<br><pre class="bot-code-block"><code>var a = 1;\n</code></pre>');
ok('代码块内的 ** 不被当加粗', X.renderBotReply('```\n**raw**\n```').indexOf('<strong>') === -1);
ok('XSS：script 被转义', X.renderBotReply('<script>alert(1)</script>').indexOf('&lt;script&gt;') !== -1);
ok('XSS：不产生可执行标签', X.renderBotReply('**<img src=x onerror=alert(1)>**').indexOf('<img') === -1);
ok('XSS：引号被转义', X.renderBotReply('"onmouseover="x').indexOf('&quot;') !== -1);
eq('空内容安全', X.renderBotReply(null), '');

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
