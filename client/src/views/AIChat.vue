<template>
  <div class="aichat-page">
    <AppNavBar title="小深">
      <template slot="actions">
        <button class="nav-action-btn" @click="showSystemPrompt = !showSystemPrompt" title="系统提示词">
          <i class="fa-solid fa-sliders"></i>
        </button>
        <button v-if="currentConvId && currentMessages.length > 0" class="nav-action-btn" :class="{ 'nav-action-active': selectMode }" @click="toggleSelectMode" title="多选">
          <i class="fa-solid fa-check-double"></i>
        </button>
        <button class="nav-action-btn" @click="createNewChat" title="新对话">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
      </template>
    </AppNavBar>
    <div class="aichat-body">
      <!-- Mobile sidebar overlay -->
      <div v-if="isMobile && showSidebar" class="sidebar-overlay" @click="showSidebar = false"></div>
      <!-- Sidebar -->
      <div class="aichat-sidebar" :class="{ 'sidebar-hidden': !showSidebar }">
        <!-- Sidebar Header -->
        <div class="sidebar-header">
          <span class="sidebar-header-title">对话列表 <span v-if="conversations.length > 0" class="conv-count">({{ conversations.length }})</span></span>
          <button v-if="conversations.length > 0" class="sidebar-header-btn clear-all-btn" @click="confirmClearAll" title="清除所有对话">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
        <div v-if="loadingConvs" class="sidebar-loading">
          <div class="spinner-sm"></div>
          <span>加载中...</span>
        </div>
        <div v-else-if="conversations.length === 0" class="sidebar-empty">
          <i class="fa-regular fa-comment-dots"></i>
          <span>暂无对话</span>
        </div>
        <template v-else>
          <!-- Conversation Search -->
          <div class="sidebar-search">
            <i class="fa-solid fa-magnifying-glass sidebar-search-icon"></i>
            <input
              v-model="convSearchQuery"
              class="sidebar-search-input"
              placeholder="搜索对话..."
            />
            <button v-if="convSearchQuery" class="sidebar-search-clear" @click="convSearchQuery = ''">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <!-- No search results -->
          <div v-if="groupedConversations.length === 0" class="sidebar-empty sidebar-search-empty">
            <i class="fa-solid fa-magnifying-glass"></i>
            <span>未找到匹配的对话</span>
          </div>
          <!-- Chat List with Date Grouping -->
          <div v-else class="chat-list scrollbar-thin">
            <div v-for="group in groupedConversations" :key="group.label" class="conv-group">
              <div class="conv-group-label">{{ group.label }}</div>
              <transition-group name="conv-list" tag="div">
                <div
                  v-for="conv in group.convs"
                  :key="conv.id"
                  class="chat-list-item"
                  :class="{ active: currentConvId === conv.id }"
                  @click="selectConversation(conv.id)"
                >
                  <div class="conv-icon"><i :class="isPinned(conv.id) ? 'fa-solid fa-thumbtack' : 'fa-solid fa-comment-dots'"></i></div>
                  <div class="conv-info">
                    <div class="conv-title" v-if="editingId !== conv.id">{{ conv.title }}</div>
                    <input
                      v-else
                      v-model="editTitle"
                      class="conv-edit-input"
                      @keyup.enter="saveRename(conv.id)"
                      @blur="saveRename(conv.id)"
                      v-focus
                    />
                    <div class="conv-time">{{ formatConvTime(conv.updated_at) }}</div>
                  </div>
                  <div class="conv-actions">
                    <button class="conv-action-btn" :class="{ 'pin-active': isPinned(conv.id) }" @click.stop="togglePin(conv.id)" title="置顶"><i class="fa-solid fa-thumbtack"></i></button>
                    <button class="conv-action-btn" @click.stop="startRename(conv.id, conv.title)" title="重命名"><i class="fa-solid fa-pen"></i></button>
                    <button class="conv-action-btn danger" @click.stop="confirmDelete(conv.id)" title="删除"><i class="fa-solid fa-trash-can"></i></button>
                  </div>
                </div>
              </transition-group>
            </div>
          </div>
        </template>
      </div>

      <!-- Main Chat Area -->
      <div class="aichat-main">
        <div class="aichat-header">
          <button class="sidebar-toggle" @click="showSidebar = !showSidebar" :title="showSidebar ? '收起侧栏' : '展开侧栏'">
            <svg v-if="!showSidebar" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
          <span class="aichat-title">{{ currentTitle }}</span>
          <div class="header-actions">
            <div class="model-status">
              <span v-if="currentModel === 'default'" class="model-badge model-badge-default" title="GPT">
                <i class="fa-solid fa-circle" style="font-size:6px;color:#f59e0b"></i> GPT
              </span>
              <span v-else-if="currentModel === 'deepseek'" class="model-badge model-badge-ds" title="DeepSeek V4 Flash">
                <i class="fa-solid fa-circle" style="font-size:6px;color:#10b981"></i> DS
              </span>
            </div>
            <div v-if="currentModel === 'default' && availableGptModels.length >= 1" class="gpt-model-select">
              <select v-model="gptModel" @change="onGptModelChange" class="gpt-model-dropdown">
                <option v-for="m in availableGptModels" :key="m" :value="m">{{ formatModelName(m) }}</option>
              </select>
            </div>
            <div v-if="deepseekEnabled" class="model-switcher">
              <button class="model-btn" :class="{ active: currentModel === 'default' }" @click="switchModel('default')" title="默认模型（免费）">GPT</button>
              <button class="model-btn" :class="{ active: currentModel === 'deepseek' }" @click="switchModel('deepseek')" title="DeepSeek V4 Flash">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                DS
              </button>
              <button v-if="currentModel === 'deepseek'" class="model-btn thinking-btn" :class="{ active: thinkingMode }" @click="toggleThinkingMode" title="思考模式">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              </button>
            </div>
            <button v-if="currentConvId" class="header-icon-btn" @click="openConvSettings" title="对话设置">
              <i class="fa-solid fa-gear"></i>
            </button>
            <button v-if="currentConvId && currentMessages.length > 0" class="header-btn" @click="confirmClearHistory" title="清空对话">清空</button>
            <button v-if="isStreaming" class="stop-btn" @click="stopGeneration">停止生成</button>
          </div>
        </div>

        <!-- Messages Area -->
        <div class="aichat-messages scrollbar-thin" ref="msgContainer">
          <!-- Loading Messages -->
          <div v-if="loadingMessages" class="loading-container">
            <div class="spinner"></div>
            <p>加载对话消息...</p>
          </div>

          <!-- Empty State / Welcome Screen -->
          <div v-else-if="!currentConvId || currentMessages.length === 0" class="empty-state">
            <div class="empty-icon"><i class="fa-solid fa-face-smile-wink"></i></div>
            <h3 class="empty-title">{{ greetingText }}</h3>
            <p class="empty-desc">我是小深，你的智能伙伴，随时为你解答疑惑～</p>
            <div class="example-prompts">
              <div
                v-for="(tpl, tplIdx) in promptTemplates"
                :key="tplIdx"
                class="prompt-item"
                @click="sendExamplePrompt(tpl.prompt)"
              >
                <span class="prompt-icon"><i :class="tpl.icon"></i></span>
                <span class="prompt-text">{{ tpl.title }}</span>
              </div>
            </div>
          </div>

          <!-- Messages List -->
          <div v-else class="messages-container">
            <div
              v-for="(msg, idx) in currentMessages"
              :key="msg._key"
              class="aichat-msg"
              :class="{
                'msg-user': msg.role === 'user',
                'msg-ai': msg.role === 'assistant',
                'msg-selected': selectMode && selectedMessages.indexOf(msg._key) > -1,
                'msg-selectable': selectMode
              }"
              @click="selectMode && toggleMessageSelect(msg)"
            >
              <div v-if="selectMode" class="msg-checkbox" :class="{ checked: selectedMessages.indexOf(msg._key) > -1 }">
                <i v-if="selectedMessages.indexOf(msg._key) > -1" class="fa-solid fa-check"></i>
              </div>
              <div class="msg-avatar"><i :class="msg.role === 'user' ? 'fa-solid fa-user' : 'fa-solid fa-rooot'"></i></div>
              <div class="msg-body">
                <!-- AI searching indicator -->
                <div v-if="msg.role === 'assistant' && !msg.content && !msg.error && isSearching && idx === currentMessages.length - 1" class="msg-content msg-searching">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-spin"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <span>正在搜索{{ searchQuery ? '：' + searchQuery : '...' }}</span>
                </div>
                <!-- AI streaming: show typing indicator instead of empty bubble -->
                <div v-if="msg.role === 'assistant' && !msg.content && !msg.reasoning && !msg.error && isStreaming && !isSearching && idx === currentMessages.length - 1" class="msg-content msg-typing">
                  <div class="typing-dots-inline">
                    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                  </div>
                </div>
                <div v-if="msg.role === 'assistant' && msg.reasoning" class="reasoning-block" :class="{ collapsed: !msg._showReasoning }">
                  <div class="reasoning-header" @click="$set(msg, '_showReasoning', !msg._showReasoning)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                    <span>思考过程</span>
                    <svg class="chevron" :class="{ rotated: msg._showReasoning }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                  </div>
                  <div v-if="msg._showReasoning" class="reasoning-content">{{ msg.reasoning }}</div>
                </div>
                <div v-if="msg.role === 'assistant' && msg.content" class="msg-content markdown-body" v-html="renderMarkdown(msg.content)"></div>
                <!-- User message -->
                <div v-else-if="msg.role === 'user'" class="msg-content user-markdown" v-html="renderUserMarkdown(msg.content)"></div>
                <!-- AI empty message (not streaming) - shouldn't normally show -->
                <div v-else-if="msg.role === 'assistant' && msg.error" class="msg-content msg-error-only">
                  <i class="fa-solid fa-circle-exclamation"></i> 消息获取失败
                </div>
                <div v-if="msg.error" class="msg-error">
                  <span class="error-text">{{ msg.error }}</span>
                  <button class="retry-btn" @click="retryMessage(msg)">重试</button>
                </div>
                <!-- AI message actions (copy + regenerate + forward) -->
                <div v-if="!selectMode && msg.role === 'assistant' && msg.content && !isStreaming" class="msg-actions">
                  <button class="msg-action-btn" @click="copyRawMarkdown(msg.content)" title="复制原始 Markdown">
                    <i class="fa-regular fa-copy"></i>
                  </button>
                  <button class="msg-action-btn" @click="showForwardMenu(msg)" title="转发">
                    <i class="fa-solid fa-share"></i>
                  </button>
                  <button v-if="idx === currentMessages.length - 1" class="msg-action-btn" @click="regenerateMessage(msg)" title="重新生成">
                    <i class="fa-solid fa-rotate"></i>
                  </button>
                </div>
                <!-- User message actions (edit + forward) -->
                <div v-if="!selectMode && msg.role === 'user' && !isStreaming" class="msg-actions msg-actions-user">
                  <button class="msg-action-btn" @click="editMessage(msg)" title="编辑消息">
                    <i class="fa-solid fa-pen"></i>
                  </button>
                  <button class="msg-action-btn" @click="showForwardMenu(msg)" title="转发">
                    <i class="fa-solid fa-share"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Input Area -->
        <div v-if="!selectMode" class="aichat-input-area">
          <div class="input-wrapper">
            <div class="input-row">
              <textarea
                v-model="inputText"
                class="aichat-input"
                :placeholder="isStreaming ? 'AI 正在回复中...' : '输入消息，Enter 发送，Shift+Enter 换行'"
                @keydown.enter.exact.prevent="sendMessage"
                @keydown.enter.shift.exact="allowNewline"
                @input="autoResize"
                rows="1"
                ref="inputEl"
                :disabled="isStreaming"
              ></textarea>
              <button class="send-btn" @click="sendMessage" :disabled="!inputText.trim() || isStreaming || inputText.length > 2000" :title="isStreaming ? '发送中...' : '发送'">
                <svg v-if="!isStreaming" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                <div v-else class="send-spinner"></div>
              </button>
            </div>
            <div class="input-meta">
              <span class="char-counter" :class="{ 'char-warning': inputText.length > 1800 }">{{ inputText.length }}/2000</span>
            </div>
          </div>
        </div>

        <!-- Batch Action Bar (多选模式) -->
        <div v-if="selectMode" class="batch-action-bar">
          <button @click="selectAllMessages" class="batch-btn">
            <i class="fa-solid" :class="selectedMessages.length === currentMessages.length ? 'fa-square-check' : 'fa-square'"></i>
            {{ selectedMessages.length === currentMessages.length ? '取消全选' : '全选' }}
          </button>
          <span class="batch-count">已选 {{ selectedMessages.length }} 条</span>
          <button @click="batchForwardToCommunity" :disabled="selectedMessages.length === 0" class="batch-btn batch-btn-primary">
            <i class="fa-solid fa-comments"></i> 论坛
          </button>
          <button @click="batchForwardToChat" :disabled="selectedMessages.length === 0" class="batch-btn batch-btn-primary">
            <i class="fa-solid fa-comment"></i> 聊天
          </button>
          <button @click="toggleSelectMode" class="batch-btn">取消</button>
        </div>
      </div>
    </div>

    <!-- System Prompt Panel -->
    <div v-if="showSystemPrompt" class="model-selector-overlay" @click.self="showSystemPrompt = false">
      <div class="model-selector-panel">
        <h3 class="panel-title">系统提示词</h3>
        <textarea class="system-prompt-input" v-model="customSystemPrompt" placeholder="自定义AI的行为和角色..." rows="6"></textarea>
        <div class="panel-actions">
          <button class="btn-reset" @click="resetSystemPrompt">恢复默认</button>
          <button class="btn-save-prompt" @click="saveSystemPrompt">保存</button>
        </div>
      </div>
    </div>

    <!-- Confirm Dialog -->
    <div v-if="showConfirmDialog" class="confirm-overlay" @click.self="showConfirmDialog = false">
      <div class="confirm-dialog">
        <h3 class="confirm-title">{{ confirmDialogTitle }}</h3>
        <p class="confirm-message">{{ confirmDialogMessage }}</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="showConfirmDialog = false">取消</button>
          <button class="confirm-btn danger" @click="confirmAction">确认</button>
        </div>
      </div>
    </div>

    <div v-if="showThinkingWarning" class="confirm-overlay" @click.self="showThinkingWarning = false">
      <div class="confirm-dialog thinking-warning-dialog">
        <div class="thinking-warning-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <h3 class="thinking-warning-title">思考模式将消耗大量 Tokens</h3>
        <p class="thinking-warning-desc">思考模式会让 AI 在回答前进行深度推理，这会显著增加 Token 消耗（通常为普通模式的 3-5 倍）。非必要场景请勿使用。</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="showThinkingWarning = false; thinkingMode = false;">取消</button>
          <button class="confirm-btn primary" @click="confirmThinkingMode">我已了解，启用</button>
        </div>
      </div>
    </div>

    <!-- Conversation Settings Panel -->
    <div v-if="showConvSettings" class="model-selector-overlay" @click.self="showConvSettings = false">
      <div class="conv-settings-panel">
        <div class="conv-settings-header">
          <h3 class="panel-title">对话设置</h3>
          <button class="conv-settings-close" @click="showConvSettings = false">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="conv-settings-body">
          <div class="settings-section">
            <div class="settings-label">
              <i class="fa-solid fa-masks-theater"></i>
              <span>对话人设</span>
            </div>
            <p class="settings-hint">为这个对话单独设置 AI 的角色和性格，留空则使用全局设置</p>
            <textarea
              class="settings-textarea"
              v-model="convPersona"
              placeholder="例如：你是一位严谨的数学老师，擅长用简单的方式解释复杂的数学概念..."
              rows="4"
              maxlength="500"
            ></textarea>
            <div class="settings-textarea-meta">
              <span class="char-counter" :class="{ 'char-warning': convPersona.length > 450 }">{{ convPersona.length }}/500</span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-label">
              <i class="fa-solid fa-circle-info"></i>
              <span>人设优先级</span>
            </div>
            <div class="priority-list">
              <div class="priority-item priority-active">
                <span class="priority-num">1</span>
                <span>对话人设</span>
                <span v-if="convPersona.trim()" class="priority-badge">生效中</span>
              </div>
              <div class="priority-item" :class="{ 'priority-active': !convPersona.trim() && customSystemPrompt }">
                <span class="priority-num">2</span>
                <span>全局提示词</span>
                <span v-if="!convPersona.trim() && customSystemPrompt" class="priority-badge">生效中</span>
              </div>
              <div class="priority-item" :class="{ 'priority-active': !convPersona.trim() && !customSystemPrompt }">
                <span class="priority-num">3</span>
                <span>默认人设（小深）</span>
                <span v-if="!convPersona.trim() && !customSystemPrompt" class="priority-badge">生效中</span>
              </div>
            </div>
          </div>
        </div>
        <div class="conv-settings-footer">
          <button class="btn-reset" @click="resetConvPersona">清空人设</button>
          <button class="btn-save-prompt" @click="saveConvPersona">保存</button>
        </div>
      </div>
    </div>

    <!-- Fallback Notice Toast -->
    <transition name="toast-slide">
      <div v-if="showFallbackNotice" class="fallback-notice">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>默认模型暂时不可用，已自动切换到 DeepSeek</span>
        <button class="fallback-notice-close" @click="showFallbackNotice = false"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </transition>

    <!-- Forward Selection Sheet -->
    <div v-if="showForwardDialog" class="forward-overlay" @click.self="showForwardDialog = false">
      <div class="forward-sheet">
        <div class="forward-sheet-title">转发到</div>
        <button class="forward-option" @click="forwardToCommunity(forwardingMessage)">
          <i class="fa-solid fa-comments"></i>
          <span>论坛</span>
        </button>
        <button class="forward-option" @click="forwardToChat(forwardingMessage)">
          <i class="fa-solid fa-comment"></i>
          <span>聊天</span>
        </button>
        <button class="forward-cancel" @click="showForwardDialog = false">取消</button>
      </div>
    </div>

    <!-- AI Content Viewer (from chat forward) -->
    <div v-if="viewerContent" class="viewer-overlay" @click.self="viewerContent = null">
      <div class="viewer-panel">
        <div class="viewer-header">
          <span class="viewer-title">🤖 AI对话内容</span>
          <button class="viewer-close" @click="viewerContent = null"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="viewer-body scrollbar-thin markdown-body" v-html="renderMarkdown(viewerContent)"></div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';
import AppNavBar from '@/components/AppNavBar.vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.min.css';
import LatexRenderer from '@/utils/latex-renderer';
import RichTextRenderer from '@/utils/rich-text-renderer';

var customRenderer = new marked.Renderer();
customRenderer.code = function(code, lang) {
  var language = lang || '';
  var highlighted;
  if (language && hljs.getLanguage(language)) {
    try {
      highlighted = hljs.highlight(code, { language: language }).value;
    } catch (e) {
      highlighted = hljs.highlightAuto(code).value;
    }
  } else {
    highlighted = hljs.highlightAuto(code).value;
  }
  var lines = highlighted.split('\n');
  var lineNumbersHtml = '';
  var codeLinesHtml = '';
  for (var i = 0; i < lines.length; i++) {
    lineNumbersHtml += '<span class="code-line-number">' + (i + 1) + '</span>';
    codeLinesHtml += '<span class="code-line">' + lines[i] + '</span>';
  }
  var langLaoel = language ? '<span class="code-lang-label">' + language + '</span>' : '';
  return '<pre class="code-block-wrapper">' + langLaoel + '<div class="code-block-inner"><div class="code-line-numbers">' + lineNumbersHtml + '</div><code class="hljs code-block-content">' + codeLinesHtml + '</code></div></pre>';
};
customRenderer.table = function(header, body) {
  return '<div class="table-wrapper"><table class="md-table"><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>';
};
customRenderer.tablerow = function(content) {
  return '<tr>' + content + '</tr>';
};
customRenderer.tablecell = function(content, flags) {
  var tag = flags.header ? 'th' : 'td';
  var align = flags.align ? ' style="text-align:' + flags.align + '"' : '';
  return '<' + tag + align + '>' + content + '</' + tag + '>';
};

marked.setOptions({
  renderer: customRenderer,
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false
});

var msgKeyCounter = 0;
function nextMsgKey() {
  msgKeyCounter++;
  return 'mk_' + Date.now() + '_' + msgKeyCounter;
}

export default {
  components: { AppNavBar: AppNavBar },
  name: 'AIChat',
  directives: {
    focus: { inserted: function(el) { el.focus(); } }
  },
  data: function() {
    return {
      conversations: [],
      currentConvId: null,
      inputText: '',
      isStreaming: false,
      streamingContent: '',
      isSearching: false,
      searchQuery: '',
      editingId: null,
      editTitle: '',
      abortController: null,
      loadingConvs: false,
      loadingMessages: false,
      showSidebar: false,
      isMobile: window.innerWidth <= 768,
      showConfirmDialog: false,
      confirmDialogTitle: '',
      confirmDialogMessage: '',
      confirmCallback: null,
      maxChars: 2000,
      sseBuffer: '',
      showSystemPrompt: false,
      customSystemPrompt: '',
      convSearchQuery: '',
      pinnedConvIds: [],
      aiSettingsLoaded: false,
      deepseekEnabled: false,
      currentModel: 'default',
      gptModel: '',
      availableGptModels: [],
      thinkingMode: false,
      showThinkingWarning: false,
      showConvSettings: false,
      convPersona: '',
      showFallbackNotice: false,
      showForwardDialog: false,
      forwardingMessage: null,
      viewerContent: null,
      selectMode: false,
      selectedMessages: [],
      promptTemplates: [
        { icon: 'fa-solid fa-graduation-cap', title: '学术问题', prompt: '请详细解释量子纠缠的原理，并举一个通俗的类比' },
        { icon: 'fa-solid fa-laptop-code', title: '编程开发', prompt: '用 Python 实现一个 LRU 缓存，要求 O(1) 读写' },
        { icon: 'fa-solid fa-square-root-variaole', title: '数学解题', prompt: '求不定方程 3x + 5y = 24 的所有正整数解' },
        { icon: 'fa-solid fa-pen-fancy', title: '高质量写作', prompt: '以"时光"为主题写一篇800字散文，语言优美有深度' },
        { icon: 'fa-solid fa-magnifying-glass', title: '深度分析', prompt: '对比分析 TCP 和 UDP 的优劣，给出适用场景' },
        { icon: 'fa-solid fa-language', title: '翻译润色', prompt: '将以下中文翻译为地道的英文：学而不思则罔，思而不学则殆' }
      ]
    };
  },
  computed: {
    greetingText: function() {
      var hour = new Date().getHours();
      if (hour >= 5 && hour < 12) return '早上好～新的一天，元气满满';
      if (hour >= 12 && hour < 14) return '中午好～记得吃饭休息哦';
      if (hour >= 14 && hour < 18) return '下午好～有什么我能帮你的吗';
      if (hour >= 18 && hour < 22) return '晚上好～辛苦了一天，放松一下吧';
      return '夜深了～早点休息，明天更好';
    },
    currentMessages: function() {
      var self = this;
      var conv = this.conversations.find(function(c) { return c.id === self.currentConvId; });
      if (!conv) return [];
      // Filter out tool messages and assistant messages that are only tool_calls (no visible content)
      return conv.messages.filter(function(msg) {
        if (msg.role === 'tool') return false;
        if (msg.role === 'assistant' && msg.tool_calls && !msg.content) return false;
        return true;
      });
    },
    currentTitle: function() {
      var self = this;
      var conv = this.conversations.find(function(c) { return c.id === self.currentConvId; });
      return conv ? conv.title : 'AI 对话';
    },
    groupedConversations: function() {
      var self = this;
      var filtered = this.conversations.filter(function(c) {
        if (!self.convSearchQuery) return true;
        var query = self.convSearchQuery.toLowerCase();
        return c.title.toLowerCase().indexOf(query) > -1;
      });

      filtered.sort(function(a, o) {
        var aPinned = self.isPinned(a.id) ? 1 : 0;
        var oPinned = self.isPinned(o.id) ? 1 : 0;
        if (aPinned !== oPinned) return oPinned - aPinned;
        var aDate = new Date(a.updated_at);
        var oDate = new Date(o.updated_at);
        if (isNaN(aDate.getTime())) aDate = new Date(0);
        if (isNaN(oDate.getTime())) oDate = new Date(0);
        return oDate.getTime() - aDate.getTime();
      });

      var now = new Date();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var yesterday = new Date(today.getTime() - 86400000);
      var thisWeek = new Date(today.getTime() - 6 * 86400000);

      var groups = [
        { label: '今天', convs: [] },
        { label: '昨天', convs: [] },
        { label: '本周', convs: [] },
        { label: '更早', convs: [] }
      ];

      for (var i = 0; i < filtered.length; i++) {
        var conv = filtered[i];
        var convDate = new Date(conv.updated_at);
        if (isNaN(convDate.getTime())) {
          groups[3].convs.push(conv);
        } else if (convDate >= today) {
          groups[0].convs.push(conv);
        } else if (convDate >= yesterday) {
          groups[1].convs.push(conv);
        } else if (convDate >= thisWeek) {
          groups[2].convs.push(conv);
        } else {
          groups[3].convs.push(conv);
        }
      }

      return groups.filter(function(g) { return g.convs.length > 0; });
    }
  },
  mounted: function() {
    var self = this;
    this.loadAiSettings();
    this.loadConversations();
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    // 处理 view query 参数（来自聊天的单条 AI 转发查看）
    var viewContent = self.$route.query.view;
    if (viewContent) {
      self.viewerContent = decodeURIComponent(viewContent);
      self.$router.replace({ query: {} }).catch(function() {});
    }
    // 处理 viewBatch query 参数（来自聊天的批量 AI 转发查看）
    var viewBatch = self.$route.query.viewBatch;
    if (viewBatch) {
      try {
        var msgs = JSON.parse(decodeURIComponent(viewBatch));
        self.viewerContent = msgs.map(function(m) {
          var label = m.role === 'user' ? '🙋 用户' : '🤖 AI';
          return '### ' + label + '\n\n' + m.content;
        }).join('\n\n---\n\n');
      } catch (e) {}
      self.$router.replace({ query: {} }).catch(function() {});
    }
  },
  beforeDestroy: function() {
    window.removeEventListener('resize', this.handleResize);
    if (this.abortController) {
      this.abortController.abort();
    }
  },
  methods: {
    loadAiSettings: function() {
      var self = this;
      api.get('/ai-chat/settings').then(function(response) {
        var data = response.data.data || {};
        if (data.system_prompt !== undefined && data.system_prompt !== '') {
          self.customSystemPrompt = data.system_prompt;
          localStorage.setItem('ai_system_prompt', data.system_prompt);
        } else {
          var localPrompt = localStorage.getItem('ai_system_prompt');
          if (localPrompt) {
            self.customSystemPrompt = localPrompt;
          }
        }
        if (data.pinned_conversations && data.pinned_conversations.length > 0) {
          self.pinnedConvIds = data.pinned_conversations;
          localStorage.setItem('ai_pinned_convs', JSON.stringify(data.pinned_conversations));
        } else {
          try {
            var localPinned = JSON.parse(localStorage.getItem('ai_pinned_convs') || '[]');
            if (localPinned.length > 0) {
              self.pinnedConvIds = localPinned;
              api.put('/ai-chat/settings', { pinned_conversations: localPinned }).catch(function() {});
            }
          } catch (e) {}
        }
        self.deepseekEnabled = !!data.deepseek_enabled;
        self.currentModel = data.model || 'default';
        if (self.currentModel === 'deepseek' && !self.deepseekEnabled) {
          self.currentModel = 'default';
        }
        self.gptModel = data.gpt_model || '';
        self.availableGptModels = data.available_gpt_models || [];
        self.aiSettingsLoaded = true;
      }).catch(function() {
        var localPrompt = localStorage.getItem('ai_system_prompt');
        if (localPrompt) self.customSystemPrompt = localPrompt;
        try {
          var localPinned = JSON.parse(localStorage.getItem('ai_pinned_convs') || '[]');
          if (localPinned.length > 0) self.pinnedConvIds = localPinned;
        } catch (e) {}
        self.aiSettingsLoaded = true;
      });
    },
    handleResize: function() {
      this.isMobile = window.innerWidth <= 768;
    },
    formatConvTime: function(timeStr) {
      if (!timeStr) return '';
      var d = new Date(timeStr);
      if (isNaN(d.getTime())) return '';
      var now = new Date();
      var diff = now - d;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
      if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
      return (d.getMonth() + 1) + '/' + d.getDate();
    },
    loadConversations: function() {
      var self = this;
      self.loadingConvs = true;
      api.get('/ai-chat/conversations').then(function(response) {
        self.conversations = (response.data.data || []).map(function(c) {
          return {
            id: c.id,
            title: c.title,
            persona: c.persona || '',
            created_at: c.created_at,
            updated_at: c.updated_at,
            messages: [],
            loaded: false
          };
        });
        if (self.conversations.length > 0) {
          var lastId = localStorage.getItem('ai_last_conv_id');
          var targetId = null;
          if (lastId) {
            for (var i = 0; i < self.conversations.length; i++) {
              if (self.conversations[i].id === lastId) {
                targetId = lastId;
                break;
              }
            }
          }
          if (!targetId) {
            targetId = self.conversations[0].id;
          }
          self.currentConvId = null;
          self.selectConversation(targetId);
        }
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '加载对话列表失败', type: 'error' });
      }).finally(function() {
        self.loadingConvs = false;
      });
    },
    selectConversation: function(id) {
      var self = this;
      if (self.currentConvId === id) return;
      if (self.isStreaming) {
        self.stopGeneration();
      }
      self.currentConvId = id;
      localStorage.setItem('ai_last_conv_id', id);
      var conv = self.conversations.find(function(c) { return c.id === id; });
      if (conv) {
        self.convPersona = conv.persona || '';
      }
      if (conv && !conv.loaded) {
        self.loadingMessages = true;
        api.get('/ai-chat/conversations/' + id).then(function(response) {
          var rawMessages = response.data.data.messages || [];
          conv.messages = rawMessages.map(function(m) {
            var msg = {
              _key: nextMsgKey(),
              id: m.id || nextMsgKey(),
              role: m.role,
              content: m.content,
              error: null
            };
            if (m.reasoning) {
              msg.reasoning = m.reasoning;
              msg._showReasoning = false;
            }
            return msg;
          });
          conv.loaded = true;
          self.$nextTick(function() {
            self.scrollToBottom();
            self.initCodeBlocks();
          });
        }).catch(function() {
          conv.loaded = true;
          self.$store.commit('toast/SHOW_TOAST', { message: '加载对话消息失败', type: 'error' });
        }).finally(function() {
          self.loadingMessages = false;
        });
      }
      if (self.isMobile) {
        self.showSidebar = false;
      }
    },
    createNewChat: function() {
      var self = this;
      api.post('/ai-chat/conversations', { title: '新对话' }).then(function(response) {
        var conv = Object.assign({}, response.data.data, { messages: [], loaded: true, persona: '' });
        self.conversations.unshift(conv);
        self.currentConvId = conv.id;
        self.inputText = '';
        self.$nextTick(function() {
          self.focusInput();
        });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '创建对话失败', type: 'error' });
      });
    },
    startRename: function(id, title) {
      this.editingId = id;
      this.editTitle = title;
    },
    saveRename: function(id) {
      var self = this;
      if (!self.editTitle.trim()) {
        self.editingId = null;
        return;
      }
      api.patch('/ai-chat/conversations/' + id, { title: self.editTitle.trim() }).then(function() {
        var conv = self.conversations.find(function(c) { return c.id === id; });
        if (conv) {
          conv.title = self.editTitle.trim();
        }
        self.editingId = null;
      }).catch(function() {
        self.editingId = null;
        self.$store.commit('toast/SHOW_TOAST', { message: '重命名失败', type: 'error' });
      });
    },
    confirmDelete: function(id) {
      var self = this;
      self.confirmDialogTitle = '删除对话';
      self.confirmDialogMessage = '确定要删除这个对话吗？此操作无法撤销。';
      self.showConfirmDialog = true;
      self.confirmCallback = function() {
        self.deleteConversation(id);
      };
    },
    deleteConversation: function(id) {
      var self = this;
      var currentIdx = -1;
      for (var i = 0; i < self.conversations.length; i++) {
        if (self.conversations[i].id === id) {
          currentIdx = i;
          break;
        }
      }
      api.delete('/ai-chat/conversations/' + id).then(function() {
        self.conversations.splice(currentIdx, 1);
        // Remove from pinned list
        var pinIdx = self.pinnedConvIds.indexOf(id);
        if (pinIdx > -1) {
          self.pinnedConvIds.splice(pinIdx, 1);
          self.savePinnedConvs();
        }
        if (self.currentConvId === id) {
          localStorage.removeItem('ai_last_conv_id');
          if (self.conversations.length > 0) {
            var nextIdx = currentIdx < self.conversations.length ? currentIdx : self.conversations.length - 1;
            self.currentConvId = null;
            self.selectConversation(self.conversations[nextIdx].id);
          } else {
            self.currentConvId = null;
          }
        }
        self.$store.commit('toast/SHOW_TOAST', { message: '对话已删除', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '删除对话失败', type: 'error' });
      });
    },
    confirmClearAll: function() {
      var self = this;
      if (self.conversations.length === 0) return;
      self.confirmDialogTitle = '清除所有对话';
      self.confirmDialogMessage = '确定要删除所有对话吗？此操作无法撤销。';
      self.showConfirmDialog = true;
      self.confirmCallback = function() {
        self.clearAllConversations();
      };
    },
    clearAllConversations: function() {
      var self = this;
      var ids = self.conversations.map(function(c) { return c.id; });
      var deletePromises = ids.map(function(id) {
        return api.delete('/ai-chat/conversations/' + id).catch(function() {});
      });
      Promise.all(deletePromises).then(function() {
        self.conversations = [];
        self.currentConvId = null;
        localStorage.removeItem('ai_last_conv_id');
        self.pinnedConvIds = [];
        self.savePinnedConvs();
        self.$store.commit('toast/SHOW_TOAST', { message: '所有对话已清除', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '清除对话失败', type: 'error' });
      });
    },
    confirmClearHistory: function() {
      var self = this;
      if (!self.currentConvId) return;
      self.confirmDialogTitle = '清空对话';
      self.confirmDialogMessage = '确定要清空当前对话的所有消息吗？此操作无法撤销。';
      self.showConfirmDialog = true;
      self.confirmCallback = function() {
        self.clearHistory();
      };
    },
    clearHistory: function() {
      var self = this;
      var conv = self.conversations.find(function(c) { return c.id === self.currentConvId; });
      if (conv) {
        conv.messages = [];
        api.patch('/ai-chat/conversations/' + self.currentConvId, { clear_messages: true }).then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '对话已清空', type: 'success' });
        }).catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '清空对话失败', type: 'error' });
        });
      }
    },
    confirmAction: function() {
      if (this.confirmCallback) {
        this.confirmCallback();
      }
      this.showConfirmDialog = false;
      this.confirmCallback = null;
    },
    sendMessage: function() {
      var self = this;
      if (!self.inputText.trim() || self.isStreaming) return;
      if (self.inputText.length > self.maxChars) {
        self.$store.commit('toast/SHOW_TOAST', { message: '消息长度超过限制（最大' + self.maxChars + '字符）', type: 'warning' });
        return;
      }

      var question = self.inputText.trim();
      self.inputText = '';

      if (!self.currentConvId) {
        api.post('/ai-chat/conversations', { title: '新对话' }).then(function(response) {
          var conv = Object.assign({}, response.data.data, { messages: [], loaded: true, persona: '' });
          self.conversations.unshift(conv);
          self.currentConvId = conv.id;
          self.$nextTick(function() {
            self.doSendMessage(question);
          });
        }).catch(function() {
          self.inputText = question;
          self.$store.commit('toast/SHOW_TOAST', { message: '创建对话失败', type: 'error' });
        });
        return;
      }

      self.doSendMessage(question);
    },
    doSendMessage: function(question) {
      var self = this;
      var conv = self.conversations.find(function(c) { return c.id === self.currentConvId; });
      if (!conv) return;

      var userMsg = {
        _key: nextMsgKey(),
        id: Date.now().toString(),
        role: 'user',
        content: question,
        error: null
      };
      conv.messages.push(userMsg);

      self.isStreaming = true;
      self.streamingContent = '';
      self.sseBuffer = '';

      var aiMsg = {
        _key: nextMsgKey(),
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        error: null
      };
      var isThinking = self.thinkingMode && self.currentModel === 'deepseek';
      if (isThinking) {
        aiMsg.reasoning = '';
        aiMsg._showReasoning = false;
      }
      conv.messages.push(aiMsg);

      self.$nextTick(function() {
        self.scrollToBottom();
        self.autoResize();
      });

      var token = self.$store.state.auth.token;
      self.abortController = new AbortController();

      var timeoutId = setTimeout(function() {
        if (self.isStreaming) {
          self.abortController.abort();
          aiMsg.error = '请求超时，AI 服务响应时间过长';
          self.isStreaming = false;
          self.streamingContent = '';
          self.sseBuffer = '';
          self.abortController = null;
        }
      }, 180000);

      fetch('/api/ai-chat/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          conversation_id: self.currentConvId,
          message: question,
          system_prompt: self.customSystemPrompt || undefined,
          model: self.currentModel !== 'default' ? self.currentModel : undefined,
          gpt_model: self.currentModel === 'default' ? self.gptModel || undefined : undefined,
          thinking: self.thinkingMode && self.currentModel === 'deepseek' ? true : undefined
        }),
        signal: self.abortController.signal
      }).then(function(response) {
        if (!response.ok) {
          return response.json().catch(function() {
            return { message: 'HTTP error! status: ' + response.status };
          }).then(function(errData) {
            throw new Error(errData.message || 'HTTP error! status: ' + response.status);
          });
        }
        var reader = response.body.getReader();
        var decoder = new TextDecoder();

        function finishStream() {
          clearTimeout(timeoutId);
          self.isStreaming = false;
          self.streamingContent = '';
          self.isSearching = false;
          self.searchQuery = '';
          self.sseBuffer = '';
          self.abortController = null;
          self.$nextTick(function() {
            self.initCodeBlocks();
          });
        }

        function read() {
          reader.read().then(function(result) {
            if (result.done) {
              finishStream();
              self.updateConvTitle(question);
              return;
            }
            var text = decoder.decode(result.value, { stream: true });
            self.sseBuffer += text;
            var lines = self.sseBuffer.split('\n');
            self.sseBuffer = lines.pop();

            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (!line || line.startsWith(':')) continue;
              if (!line.startsWith('data: ')) continue;

              var data = line.substring(6);
              try {
                var parsed = JSON.parse(data);
                if (parsed.error) {
                  aiMsg.error = parsed.error;
                  finishStream();
                  return;
                }
                if (parsed.done) {
                  finishStream();
                  self.updateConvTitle(question);
                  return;
                }
                if (parsed.fallback) {
                  self.showFallbackNotice = true;
                  setTimeout(function() { self.showFallbackNotice = false; }, 8000);
                }
                if (parsed.searching !== undefined) {
                  self.isSearching = parsed.searching;
                  if (parsed.searching && parsed.query) {
                    self.searchQuery = parsed.query;
                  } else {
                    self.searchQuery = '';
                  }
                }
                if (parsed.content) {
                  if (parsed.action === 'replace') {
                    aiMsg.content = parsed.content;
                  } else {
                    aiMsg.content += parsed.content;
                  }
                  self.streamingContent = aiMsg.content;
                  self.$nextTick(function() {
                    self.scrollToBottom();
                  });
                }
                if (parsed.reasoning && isThinking) {
                  if (!aiMsg.reasoning) aiMsg.reasoning = '';
                  aiMsg.reasoning += parsed.reasoning;
                  self.$nextTick(function() {
                    self.scrollToBottom();
                  });
                }
              } catch (e) {}
            }
            if (self.isStreaming) {
              read();
            }
          }).catch(function(err) {
            if (err.name !== 'AbortError') {
              aiMsg.error = '读取响应时出错';
            }
            finishStream();
          });
        }
        read();
      }).catch(function(err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          // aborted by user
        } else {
          if (err.message.indexOf('Failed to fetch') > -1 || err.message.indexOf('NetworkError') > -1) {
            aiMsg.error = '网络连接失败，请检查网络后重试';
          } else {
            aiMsg.error = err.message || '请求发送失败';
          }
          if (self.currentModel === 'default' && self.deepseekEnabled) {
            self.showFallbackNotice = true;
            setTimeout(function() { self.showFallbackNotice = false; }, 8000);
          }
        }
        self.isStreaming = false;
        self.streamingContent = '';
        self.sseBuffer = '';
        self.abortController = null;
      });
    },
    updateConvTitle: function(question) {
      var self = this;
      var conv = self.conversations.find(function(c) { return c.id === self.currentConvId; });
      if (conv) {
        if (conv.title === '新对话') {
          conv.title = question.substring(0, 30);
        }
        conv.updated_at = new Date().toISOString();
        var idx = self.conversations.indexOf(conv);
        if (idx > 0) {
          self.conversations.splice(idx, 1);
          self.conversations.unshift(conv);
        }
      }
    },
    retryMessage: function(msg) {
      var self = this;
      var conv = self.conversations.find(function(c) { return c.id === self.currentConvId; });
      if (!conv) return;

      var aiIdx = -1;
      for (var i = conv.messages.length - 1; i >= 0; i--) {
        if (conv.messages[i]._key === msg._key) {
          aiIdx = i;
          break;
        }
      }
      if (aiIdx === -1) return;

      var userMsgContent = '';
      if (aiIdx > 0 && conv.messages[aiIdx - 1].role === 'user') {
        userMsgContent = conv.messages[aiIdx - 1].content;
      }

      conv.messages.splice(aiIdx, 1);
      self.syncMessagesToServer(conv);

      if (userMsgContent) {
        self.doSendMessage(userMsgContent);
      }
    },
    editMessage: function(msg) {
      var self = this;
      var conv = self.conversations.find(function(c) { return c.id === self.currentConvId; });
      if (!conv) return;

      var msgIdx = -1;
      for (var i = 0; i < conv.messages.length; i++) {
        if (conv.messages[i]._key === msg._key) {
          msgIdx = i;
          break;
        }
      }
      if (msgIdx === -1) return;

      self.inputText = msg.content;
      conv.messages.splice(msgIdx);

      var syncMsgs = conv.messages.map(function(m) {
        return { role: m.role, content: m.content, timestamp: new Date().toISOString() };
      });
      api.put('/ai-chat/conversations/' + self.currentConvId + '/messages', { messages: syncMsgs }).catch(function() {});

      self.$nextTick(function() {
        self.focusInput();
        self.autoResize();
      });
    },
    stopGeneration: function() {
      if (this.abortController) {
        this.abortController.abort();
      }
      this.isStreaming = false;
      this.streamingContent = '';
      this.sseBuffer = '';
      this.$store.commit('toast/SHOW_TOAST', { message: '已停止生成', type: 'info' });
    },
    sendExamplePrompt: function(prompt) {
      this.inputText = prompt;
      this.sendMessage();
    },
    allowNewline: function() {},
    autoResize: function() {
      var self = this;
      self.$nextTick(function() {
        var textarea = self.$refs.inputEl;
        if (textarea) {
          textarea.style.height = 'auto';
          var newHeight = Math.min(textarea.scrollHeight, 160);
          textarea.style.height = newHeight + 'px';
          textarea.style.overflowY = textarea.scrollHeight > 160 ? 'auto' : 'hidden';
        }
      });
    },
    focusInput: function() {
      var self = this;
      self.$nextTick(function() {
        if (self.$refs.inputEl) {
          self.$refs.inputEl.focus();
        }
      });
    },
    renderMarkdown: function(content) {
      if (!content) return '';
      var result = LatexRenderer.processContent(content, marked);
      result.html = DOMPurify.sanitize(result.html);
      var html = LatexRenderer.renderFinalHtml(result.html, result.placeholders);
      this.$nextTick(function() {
        this.initCodeBlocks();
      }.bind(this));
      return html;
    },
    scrollToBottom: function() {
      var container = this.$refs.msgContainer;
      if (container) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }
    },
    initCodeBlocks: function() {
      var self = this;
      self.$nextTick(function() {
        var msgContainer = self.$refs.msgContainer;
        if (!msgContainer) return;
        var pres = msgContainer.querySelectorAll('.markdown-body pre.code-block-wrapper');
        for (var i = 0; i < pres.length; i++) {
          var pre = pres[i];
          if (!pre.querySelector('.copy-code-btn')) {
            var code = pre.querySelector('code');
            if (code) {
              var btn = document.createElement('button');
              btn.className = 'copy-code-btn';
              btn.innerHTML = '<i class="fa-regular fa-copy"></i>';
              btn.onclick = function(e) {
                e.stopPropagation();
                var wrapper = this.parentElement;
                var codeEl = wrapper.querySelector('code');
                var codeText = codeEl ? codeEl.innerText : '';
                self.copyCode(codeText);
                var btnEl = this;
                btnEl.innerHTML = '<i class="fa-solid fa-check"></i>';
                setTimeout(function() {
                  btnEl.innerHTML = '<i class="fa-regular fa-copy"></i>';
                }, 1500);
              };
              pre.insertBefore(btn, pre.firstChild);
            }
          }
        }
      });
    },
    copyCode: function(code) {
      var self = this;
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(code).then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '代码已复制', type: 'success' });
        }).catch(function() {
          self.fallbackCopy(code);
        });
      } else {
        self.fallbackCopy(code);
      }
    },
    fallbackCopy: function(text) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand('copy');
        this.$store.commit('toast/SHOW_TOAST', { message: '已复制', type: 'success' });
      } catch (e) {
        this.$store.commit('toast/SHOW_TOAST', { message: '复制失败', type: 'error' });
      }
      document.body.removeChild(textarea);
    },
    copyRawMarkdown: function(content) {
      var self = this;
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(content).then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: 'Markdown 已复制', type: 'success' });
        }).catch(function() {
          self.fallbackCopy(content);
        });
      } else {
        self.fallbackCopy(content);
      }
    },
    showForwardMenu: function(msg) {
      this.forwardingMessage = msg;
      this.showForwardDialog = true;
    },
    forwardToCommunity: function(msg) {
      this.showForwardDialog = false;
      if (!msg || !msg.content) return;
      var content = msg.content;
      var title = content.substring(0, 30).replace(/[#*`\n]/g, '').trim() || 'AI对话分享';
      var postData = {
        type: 'forum',
        title: '🤖 ' + title,
        content: '> 以下内容来自AI对话\n\n' + content,
        is_anonymous: false
      };
      var self = this;
      api.post('/community/posts', postData).then(function(res) {
        if (res.data.code === 200) {
          self.$store.commit('toast/SHOW_TOAST', { message: '已转发到论坛', type: 'success' });
          setTimeout(function() {
            self.$router.push('/community?post=' + res.data.data.id);
          }, 1000);
        }
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '转发失败', type: 'error' });
      });
    },
    forwardToChat: function(msg) {
      this.showForwardDialog = false;
      if (!msg || !msg.content) return;
      var forwardData = {
        content: msg.content,
        role: msg.role,
        timestamp: new Date().toISOString()
      };
      this.$router.push('/chat?forward=' + encodeURIComponent(JSON.stringify(forwardData)) + '&forwardType=ai_forward');
    },
    regenerateMessage: function(msg) {
      var self = this;
      var conv = self.conversations.find(function(c) { return c.id === self.currentConvId; });
      if (!conv) return;

      var aiIdx = -1;
      for (var i = conv.messages.length - 1; i >= 0; i--) {
        if (conv.messages[i]._key === msg._key) {
          aiIdx = i;
          break;
        }
      }
      if (aiIdx === -1) return;

      conv.messages.splice(aiIdx, 1);
      self.syncMessagesToServer(conv);

      var userMsgIdx = aiIdx - 1;
      if (userMsgIdx >= 0 && conv.messages[userMsgIdx] && conv.messages[userMsgIdx].role === 'user') {
        var retryContent = conv.messages[userMsgIdx].content;
        self.doSendMessage(retryContent);
      }
    },
    copyMessage: function(content) {
      var self = this;
      var text = content.replace(/<[^>]*>/g, '').replace(/&nosp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '消息已复制', type: 'success' });
        }).catch(function() {
          self.fallbackCopy(text);
        });
      } else {
        this.fallbackCopy(text);
      }
    },
    saveSystemPrompt: function() {
      var self = this;
      localStorage.setItem('ai_system_prompt', this.customSystemPrompt);
      api.put('/ai-chat/settings', { system_prompt: self.customSystemPrompt }).catch(function() {});
      this.showSystemPrompt = false;
      this.$store.commit('toast/SHOW_TOAST', { message: '系统提示词已保存', type: 'success' });
    },
    resetSystemPrompt: function() {
      this.customSystemPrompt = '';
      localStorage.removeItem('ai_system_prompt');
      api.put('/ai-chat/settings', { system_prompt: '' }).catch(function() {});
      this.$store.commit('toast/SHOW_TOAST', { message: '已恢复默认提示词', type: 'success' });
    },
    renderUserMarkdown: function(content) {
      return RichTextRenderer.renderUserMarkdown(content);
    },
    togglePin: function(convId) {
      var self = this;
      var idx = self.pinnedConvIds.indexOf(convId);
      if (idx > -1) {
        self.pinnedConvIds.splice(idx, 1);
        self.$store.commit('toast/SHOW_TOAST', { message: '已取消置顶', type: 'info' });
      } else {
        self.pinnedConvIds.push(convId);
        self.$store.commit('toast/SHOW_TOAST', { message: '已置顶对话', type: 'success' });
      }
      self.savePinnedConvs();
    },
    isPinned: function(convId) {
      return this.pinnedConvIds.indexOf(convId) > -1;
    },
    savePinnedConvs: function() {
      localStorage.setItem('ai_pinned_convs', JSON.stringify(this.pinnedConvIds));
      api.put('/ai-chat/settings', { pinned_conversations: this.pinnedConvIds }).catch(function() {});
    },
    syncMessagesToServer: function(conv) {
      if (!conv || !conv.id) return;
      var syncMsgs = conv.messages.map(function(m) {
        return { role: m.role, content: m.content, timestamp: new Date().toISOString() };
      });
      api.put('/ai-chat/conversations/' + conv.id + '/messages', { messages: syncMsgs }).catch(function() {});
    },
    switchModel: function(model) {
      var self = this;
      if (model === self.currentModel) return;
      if (model !== 'deepseek') {
        self.thinkingMode = false;
      }
      api.put('/ai-chat/settings', { model: model }).then(function(response) {
        self.currentModel = model;
      }).catch(function(err) {
        if (err.response && err.response.status === 403) {
          self.$store.commit('toast/SHOW_TOAST', { message: 'DeepSeek 模型未启用，请联系管理员', type: 'error' });
        }
      });
    },
    formatModelName: function(modelId) {
      var map = {
        'gpt-4o-mini-2024-07-18': 'GPT-4o Mini (0718)',
        'gpt-4o-mini': 'GPT-4o Mini'
      };
      return map[modelId] || modelId;
    },
    onGptModelChange: function() {
      var self = this;
      api.put('/ai-chat/settings', { gpt_model: self.gptModel }).catch(function() {});
    },
    toggleThinkingMode: function() {
      if (!this.thinkingMode) {
        this.showThinkingWarning = true;
      } else {
        this.thinkingMode = false;
      }
    },
    confirmThinkingMode: function() {
      this.thinkingMode = true;
      this.showThinkingWarning = false;
    },
    openConvSettings: function() {
      var self = this;
      var conv = self.conversations.find(function(c) { return c.id === self.currentConvId; });
      if (conv) {
        self.convPersona = conv.persona || '';
      }
      self.showConvSettings = true;
    },
    saveConvPersona: function() {
      var self = this;
      var conv = self.conversations.find(function(c) { return c.id === self.currentConvId; });
      if (!conv) return;
      api.patch('/ai-chat/conversations/' + self.currentConvId, { persona: self.convPersona }).then(function() {
        conv.persona = self.convPersona;
        self.showConvSettings = false;
        self.$store.commit('toast/SHOW_TOAST', { message: '对话人设已保存', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '保存人设失败', type: 'error' });
      });
    },
    resetConvPersona: function() {
      this.convPersona = '';
    },
    toggleSelectMode: function() {
      this.selectMode = !this.selectMode;
      if (!this.selectMode) {
        this.selectedMessages = [];
      }
    },
    toggleMessageSelect: function(msg) {
      var key = msg._key;
      var idx = this.selectedMessages.indexOf(key);
      if (idx > -1) {
        this.selectedMessages.splice(idx, 1);
      } else {
        this.selectedMessages.push(key);
      }
    },
    selectAllMessages: function() {
      var self = this;
      if (this.selectedMessages.length === this.currentMessages.length) {
        this.selectedMessages = [];
      } else {
        this.selectedMessages = this.currentMessages.map(function(msg) { return msg._key; });
      }
    },
    getSelectedMessagesData: function() {
      var self = this;
      return this.selectedMessages.map(function(key) {
        var msg = self.currentMessages.find(function(m) { return m._key === key; });
        if (!msg) return null;
        return { role: msg.role, content: msg.content || '' };
      }).filter(function(m) { return m !== null; });
    },
    batchForwardToCommunity: function() {
      var self = this;
      var messages = this.getSelectedMessagesData();
      if (messages.length === 0) return;

      // 合并所有消息为一个帖子
      var title = '🤖 AI对话记录（' + messages.length + '条）';
      var content = '> 以下内容来自AI对话\n\n';
      for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var roleLabel = msg.role === 'user' ? '**🙋 用户：**' : '**🤖 AI：**';
        content += roleLabel + '\n\n' + msg.content + '\n\n---\n\n';
      }

      api.post('/community/posts', {
        type: 'forum',
        title: title,
        content: content,
        is_anonymous: false
      }).then(function(res) {
        if (res.data.code === 200) {
          self.$store.commit('toast/SHOW_TOAST', { message: '已转发到论坛', type: 'success' });
          self.selectMode = false;
          self.selectedMessages = [];
          setTimeout(function() {
            self.$router.push('/community?post=' + res.data.data.id);
          }, 1000);
        }
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '转发失败', type: 'error' });
      });
    },
    batchForwardToChat: function() {
      var self = this;
      var messages = this.getSelectedMessagesData();
      if (messages.length === 0) return;

      var forwardData = {
        messages: messages,
        timestamp: new Date().toISOString()
      };
      this.$router.push('/chat?forward=' + encodeURIComponent(JSON.stringify(forwardData)) + '&forwardType=ai_batch');
      this.selectMode = false;
      this.selectedMessages = [];
    }
  }
};
</script>

<style scoped>
.aichat-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}

.aichat-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.nav-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  color: var(--primary-color);
  transition: background 0.15s, transform 0.15s, opacity 0.15s;
  background: none;
  border: none;
  cursor: pointer;
}

.nav-action-btn:hover {
  background: rgba(var(--primary-rgb), 0.08);
}

.nav-action-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.aichat-sidebar {
  width: 280px;
  background: var(--sidebar-bg);
  border-right: 0.5px solid var(--separator-color);
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 20;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-oetween;
  padding: 12px 14px;
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
}

.sidebar-header-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.conv-count {
  font-weight: 400;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}

.sidebar-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.15s;
  font-size: var(--font-size-sm);
}

.sidebar-header-btn:hover {
  background: var(--bg-color);
  color: var(--danger-color);
}

.sidebar-header-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.sidebar-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4); z-index: 15;
}

.model-selector-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4); backdrop-filter: var(--glass-blur-thin); -webkit-backdrop-filter: var(--glass-blur-thin);
  display: flex; align-items: center; justify-content: center; z-index: 2000;
}

.model-selector-panel {
  width: 400px; max-width: 90vw; background: var(--card-bg);
  border-radius: var(--radius-lg); padding: 24px; box-shadow: var(--shadow-lg);
}

.panel-title {
  font-size: var(--font-size-subheadline); font-weight: 600; color: var(--text-primary); margin: 0 0 16px 0;
}

.panel-close {
  width: 100%; padding: 10px; min-height: 44px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);
  background: var(--card-bg); color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer;
  transition: background 0.15s, transform 0.15s, opacity 0.15s;
}
.panel-close:active { transform: scale(0.92); opacity: 0.7; }

.system-prompt-input {
  width: 100%; padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);
  background: var(--bg-color); color: var(--text-primary); font-size: var(--font-size-sm); outline: none;
  resize: vertical; font-family: inherit; box-sizing: border-box; margin-bottom: 12px;
}

.system-prompt-input:focus { border-color: var(--primary-color); }

.panel-actions { display: flex; gap: 10px; justify-content: flex-end; }

.btn-reset {
  padding: 8px 16px; min-height: 44px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);
  background: var(--card-bg); color: var(--text-primary); font-size: var(--font-size-sm); cursor: pointer;
  transition: background 0.15s, transform 0.15s, opacity 0.15s;
}
.btn-reset:active { transform: scale(0.92); opacity: 0.7; }

.btn-save-prompt {
  padding: 8px 16px; min-height: 44px; border-radius: var(--radius-sm); border: none;
  background: var(--primary-color); color: #fff; font-size: var(--font-size-sm); font-weight: 600; cursor: pointer;
  transition: background 0.15s, transform 0.15s, opacity 0.15s;
}
.btn-save-prompt:active { transform: scale(0.92); opacity: 0.7; }

.user-markdown >>> .inline-code {
  background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: var(--radius-xs);
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace; font-size: 0.9em;
}

.aichat-sidebar {
  flex-shrink: 0;
  transition: width 0.3s var(--ease-standard), opacity 0.3s var(--ease-standard), transform 0.3s var(--ease-standard);
  overflow: hidden;
}

.aichat-sidebar.sidebar-hidden {
  width: 0;
  opacity: 0;
  pointer-events: none;
  border-right: none;
}

.sidebar-loading,
.sidebar-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-secondary);
  gap: 8px;
  font-size: var(--font-size-sm);
}

.sidebar-empty i {
  font-size: var(--font-size-title1);
  opacity: 0.5;
}

.sidebar-search-empty {
  padding: 24px 20px;
}

.sidebar-search-empty i {
  font-size: 24px;
}

.spinner-sm {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Sidebar Search */
.sidebar-search {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 0.5px solid var(--separator-color);
  gap: 8px;
  flex-shrink: 0;
}

.sidebar-search-icon {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.sidebar-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  padding: 0;
  min-width: 0;
}

.sidebar-search-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.7;
}

.sidebar-search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: var(--font-size-caption2);
  flex-shrink: 0;
  transition: all 0.15s;
}

.sidebar-search-clear:hover {
  background: var(--bg-color);
  color: var(--text-primary);
}

/* Conversation Date Grouping */
.conv-group {
  margin-bottom: 4px;
}

.conv-group-label {
  font-size: var(--font-size-caption2);
  font-weight: 600;
  color: var(--text-secondary);
  padding: 8px 12px 4px 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  -webkit-user-select: none;
  user-select: none;
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 8px 8px;
}

.chat-list-item {
  display: flex;
  align-items: center;
  padding: 12px;
  min-height: 44px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s, transform 0.15s, opacity 0.15s;
  margin-bottom: 2px;
  gap: 10px;
}

.chat-list-item:hover {
  background: var(--bg-color);
}

.chat-list-item.active {
  background: rgba(var(--primary-rgb), 0.08);
}

.chat-list-item:active {
  background: var(--border-color);
}

.conv-icon {
  font-size: var(--font-size-sm);
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--primary-rgb), 0.08);
  color: var(--info-color);
}

.conv-info {
  flex: 1;
  min-width: 0;
}

.conv-title {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conv-time {
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
  margin-top: 2px;
}

.conv-edit-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--primary-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  background: var(--bg-color);
  box-sizing: border-box;
}

.conv-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.chat-list-item:hover .conv-actions {
  opacity: 1;
}

.conv-action-btn {
  font-size: var(--font-size-sm);
  padding: 2px 4px;
  border-radius: var(--radius-xs);
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.conv-action-btn:hover {
  background: var(--bg-color);
  color: var(--primary-color);
}

.conv-action-btn.danger:hover {
  color: var(--danger-color);
}

.conv-action-btn.pin-active {
  color: var(--primary-color);
}

.conv-action-btn.pin-active:hover {
  color: var(--primary-color);
}

.aichat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
}

.aichat-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-bottom: 0.5px solid var(--separator-color);
  background: var(--card-bg);
  min-height: 52px;
}

.sidebar-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-primary);
  padding: 4px;
  min-width: 44px;
  min-height: 44px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  transition: background 0.15s, transform 0.15s, opacity 0.15s;
}

.sidebar-toggle:hover {
  background: var(--bg-color);
}

.sidebar-toggle:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.aichat-title {
  font-size: var(--font-size-callout);
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.model-switcher {
  display: flex;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.model-btn {
  padding: 4px 10px;
  font-size: var(--font-size-caption);
  font-weight: 600;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

.model-btn.active {
  background: var(--primary-color);
  color: #fff;
}

.model-btn:hover:not(.active) {
  background: rgba(var(--primary-rgb), 0.06);
}

.thinking-btn.active {
  background: var(--warning-color);
  color: #fff;
}

.thinking-btn.active:hover {
  background: #d97706;
}

.gpt-model-select {
  margin: 0 4px;
}

.gpt-model-dropdown {
  padding: 3px 6px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-color);
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  max-width: 130px;
}

.gpt-model-dropdown:focus {
  border-color: var(--primary-color);
}

.reasoning-block {
  margin-bottom: 8px;
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: rgba(245, 158, 11, 0.04);
}

.reasoning-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: var(--font-size-caption);
  color: var(--warning-color);
  font-weight: 500;
  -webkit-user-select: none;
  user-select: none;
}

.reasoning-header:hover {
  background: rgba(245, 158, 11, 0.08);
}

.reasoning-header .chevron {
  margin-left: auto;
  transition: transform 0.2s;
}

.reasoning-header .chevron.rotated {
  transform: rotate(180deg);
}

.reasoning-content {
  padding: 8px 12px;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  border-top: 0.5px solid rgba(245, 158, 11, 0.15);
  max-height: 300px;
  overflow-y: auto;
}

.thinking-warning-dialog {
  max-width: 400px;
  text-align: center;
}

.thinking-warning-icon {
  margin-bottom: 12px;
}

.thinking-warning-title {
  font-size: var(--font-size-callout);
  font-weight: 600;
  color: var(--warning-color);
  margin: 0 0 8px 0;
}

.thinking-warning-desc {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 20px 0;
}

.confirm-btn.primary {
  background: var(--warning-color);
  color: #fff;
  border: none;
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
}

.confirm-btn.primary:hover {
  background: #d97706;
}

.header-btn {
  padding: 6px 12px;
  min-height: 44px;
  background: transparent;
  color: var(--text-secondary);
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.header-btn:hover {
  background: var(--bg-color);
  color: var(--danger-color);
  border-color: var(--danger-color);
}

.header-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.stop-btn {
  padding: 8px 16px;
  min-height: 44px;
  background: var(--danger-color);
  color: var(--card-bg);
  border-radius: var(--radius-md);
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-medium);
  transition: background var(--transition-fast);
  border: none;
  cursor: pointer;
}

.stop-btn:hover {
  background: #e0342b;
}

.stop-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.aichat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  position: relative;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  gap: 12px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.messages-container {
  min-height: 100%;
  max-width: 900px;
  margin: 0 auto;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 40px 20px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-title {
  font-size: var(--font-size-headline);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 6px 0;
}

.empty-desc {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin: 0 0 24px 0;
  max-width: 400px;
}

.example-prompts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  max-width: 600px;
  width: 100%;
}

.prompt-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  text-align: left;
}

.prompt-item:hover {
  background: rgba(var(--primary-rgb), 0.04);
  border-color: var(--primary-color);
}

.prompt-icon {
  font-size: var(--font-size-sm);
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--primary-rgb), 0.08);
  color: var(--info-color);
}

.prompt-text {
  font-size: var(--font-size-sm);
  line-height: 1.3;
  color: var(--text-primary);
}

.aichat-msg {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.msg-user {
  flex-direction: row-reverse;
}

.msg-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-body);
  flex-shrink: 0;
}

.msg-user .msg-avatar {
  background: rgba(var(--primary-rgb), 0.12);
  color: var(--info-color);
}

.msg-ai .msg-avatar {
  background: rgba(var(--accent-ai-rgb), 0.12);
  color: var(--accent-ai);
}

.msg-body {
  max-width: 70%;
}

.msg-content {
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  font-size: var(--font-size-body);
  line-height: 1.6;
  word-break: break-word;
}

.msg-user .msg-content {
  background: var(--primary-color);
  color: #fff;
  border-bottom-right-radius: var(--radius-xs);
}

.msg-ai .msg-content {
  background: var(--card-bg);
  color: var(--text-primary);
  border-bottom-left-radius: var(--radius-xs);
  box-shadow: var(--shadow-sm);
}

.msg-typing {
  padding: 16px 20px;
  background: var(--card-bg);
}

.msg-searching {
  padding: 12px 20px;
  background: var(--card-bg);
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--primary-color);
  font-size: var(--font-size-sm);
}

.search-spin {
  animation: search-spin 0.8s var(--ease-standard) infinite;
}

@keyframes search-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.typing-dots-inline {
  display: flex;
  gap: 6px;
  align-items: center;
}

.typing-dots-inline .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary-color);
  opacity: 0.4;
  animation: dotPulse 1.4s ease-in-out infinite;
}

.typing-dots-inline .dot:nth-child(1) {
  animation-delay: 0s;
}

.typing-dots-inline .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-dots-inline .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dotPulse {
  0%, 60%, 100% { opacity: 0.4; transform: scale(0.8); }
  30% { opacity: 1; transform: scale(1); }
}

.msg-error-only {
  color: var(--danger-color);
  font-size: var(--font-size-sm);
  padding: 10px 14px;
}

.msg-error-only i {
  margin-right: 4px;
}

.msg-error {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(var(--danger-rgb), 0.1);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
}

.error-text {
  color: var(--danger-color);
  flex: 1;
}

.retry-btn {
  padding: 4px 12px;
  background: var(--danger-color);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
  cursor: pointer;
  transition: background 0.2s;
}

.retry-btn:hover {
  background: #c82333;
}

.msg-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
  opacity: 0;
  transition: opacity 0.2s;
}

.msg-body:hover .msg-actions {
  opacity: 1;
}

.msg-actions-user {
  justify-content: flex-start;
}

.msg-action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  min-height: 44px;
  min-width: 44px;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  transition: all 0.15s;
}

.msg-action-btn:hover {
  background: var(--bg-color);
  color: var(--primary-color);
}

.msg-action-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.msg-action-btn i {
  font-size: var(--font-size-sm);
}

.markdown-body >>> pre.code-block-wrapper {
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: var(--radius-md);
  overflow: hidden;
  margin: 8px 0;
  font-size: var(--font-size-sm);
  position: relative;
}

.markdown-body >>> .code-lang-label {
  display: block;
  padding: 6px 14px;
  font-size: var(--font-size-caption2);
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);
  -webkit-user-select: none;
  user-select: none;
}

.markdown-body >>> .code-block-inner {
  display: -webkit-flex; display: flex;
  overflow-x: auto;
  padding: 0;
}

.markdown-body >>> .code-line-numbers {
  display: -webkit-flex; display: flex;
  -webkit-flex-direction: column; flex-direction: column;
  padding: 14px 0;
  min-width: 40px;
  text-align: right;
  -webkit-user-select: none;
  user-select: none;
  background: rgba(255, 255, 255, 0.03);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  -webkit-flex-shrink: 0; flex-shrink: 0;
}

.markdown-body >>> .code-line-number {
  display: block;
  padding: 0 10px;
  font-size: var(--font-size-caption);
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.3);
  font-family: 'Menlo', 'Consolas', monospace;
}

.markdown-body >>> .code-block-content {
  -webkit-flex: 1; flex: 1;
  padding: 14px;
  min-width: 0;
}

.markdown-body >>> .code-block-content .code-line {
  display: block;
  line-height: 1.6;
  white-space: pre;
}

.markdown-body >>> pre:hover .copy-code-btn {
  opacity: 1;
}

.markdown-body >>> .copy-code-btn {
  position: absolute;
  top: 6px;
  right: 8px;
  display: -webkit-flex; display: flex;
  -webkit-align-items: center; align-items: center;
  -webkit-justify-content: center; justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-sm);
  color: rgba(255, 255, 255, 0.8);
  font-size: var(--font-size-sm);
  cursor: pointer;
  opacity: 0;
  transition: all 0.2s;
  z-index: 2;
}

.markdown-body >>> .copy-code-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.markdown-body >>> code {
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: var(--font-size-sm);
}

.markdown-body >>> p {
  margin: 8px 0;
}

.markdown-body >>> ul,
.markdown-body >>> ol {
  padding-left: 20px;
  margin: 8px 0;
}

.markdown-body >>> blockquote {
  border-left: 3px solid var(--primary-color);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--text-secondary);
}

.markdown-body >>> .table-wrapper {
  overflow-x: auto;
  margin: 8px 0;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
}

.markdown-body >>> table.md-table {
  border-collapse: collapse;
  width: 100%;
  font-size: var(--font-size-sm);
}

.markdown-body >>> table.md-table th {
  background: var(--bg-color);
  font-weight: 600;
  color: var(--text-primary);
  padding: 10px 14px;
  text-align: left;
  border: 1px solid var(--border-color);
}

.markdown-body >>> table.md-table td {
  padding: 8px 14px;
  text-align: left;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.markdown-body >>> table.md-table tr:hover td {
  background: rgba(var(--primary-rgb), 0.03);
}

.markdown-body >>> .katex {
  font-size: 1.1em;
}

.markdown-body >>> .katex-display-wrapper {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 8px 0;
  text-align: center;
}

.markdown-body >>> .katex-display {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 8px 0;
  margin: 4px 0;
}

.markdown-body >>> .katex-html {
  max-width: 100%;
  overflow-x: auto;
}

.markdown-body >>> .latex-error {
  color: #e74c3c;
  background: rgba(var(--danger-rgb), 0.1);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-sm);
  font-family: 'Menlo', 'Consolas', monospace;
}

/* LaTeX 文档样式 */
.markdown-body >>> .latex-document {
  line-height: 1.6;
  padding: 16px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  word-break: normal;
  margin: 8px 0;
}

.markdown-body >>> .latex-tt {
  font-family: 'Menlo', 'Consolas', 'Courier New', monospace;
  background: rgba(127, 127, 127, 0.1);
  padding: 1px 4px;
  border-radius: var(--radius-xs);
}

.markdown-body >>> .latex-pagebreak {
  border: none;
  border-top: 1px dashed var(--border-color, #ddd);
  margin: 16px 0;
}

.markdown-body >>> .latex-block-wrapper {
  margin: 8px 0;
}

.markdown-body >>> .latex-colorbox {
  display: inline-block;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  line-height: 1.5;
}

.markdown-body >>> .latex-fbox {
  display: inline-block;
  border: 1px solid currentColor;
  padding: 4px 8px;
}

.markdown-body >>> .latex-parbox {
  display: block;
}

.markdown-body >>> .latex-list {
  padding-left: 2em;
  margin: 4px 0;
}
.markdown-body >>> .latex-list li {
  margin: 2px 0;
}

.markdown-body >>> .latex-quote {
  margin: 8px 0;
  padding: 8px 16px;
  border-left: 3px solid var(--border-color, #ccc);
  font-style: italic;
  opacity: 0.9;
}

.markdown-body >>> .latex-verbatim {
  background: rgba(127, 127, 127, 0.08);
  padding: 8px 12px;
  border-radius: var(--radius-xs);
  overflow-x: auto;
  font-family: 'Menlo', 'Consolas', 'Courier New', monospace;
  font-size: 0.9em;
  white-space: pre-wrap;
}

.markdown-body >>> .latex-abstract {
  margin: 8px 0;
  padding: 8px 12px;
  font-size: 0.95em;
  opacity: 0.85;
}

.markdown-body >>> .latex-verse {
  margin: 8px 0;
  padding-left: 2em;
  white-space: pre-line;
}

/* LaTeX 字体大小（在 markdown-body 上下文中） */
.markdown-body >>> .latex-tiny        { font-size: 0.5em; }
.markdown-body >>> .latex-footnotesize { font-size: 0.7em; }
.markdown-body >>> .latex-small       { font-size: 0.85em; }
.markdown-body >>> .latex-normalsize  { font-size: 1em; }
.markdown-body >>> .latex-large       { font-size: 1.2em; }
.markdown-body >>> .latex-Large       { font-size: 1.44em; }
.markdown-body >>> .latex-LARGE       { font-size: 1.73em; }
.markdown-body >>> .latex-huge        { font-size: 2.07em; }
.markdown-body >>> .latex-Huge        { font-size: 2.5em; }

.markdown-body >>> h1 {
  font-size: 1.6em;
  font-weight: 700;
  margin: 16px 0 8px;
  padding-bottom: 6px;
  border-bottom: 0.5px solid var(--separator-color);
}

.markdown-body >>> h2 {
  font-size: 1.4em;
  font-weight: 600;
  margin: 14px 0 6px;
  padding-bottom: 4px;
  border-bottom: 0.5px solid var(--separator-color);
}

.markdown-body >>> h3 {
  font-size: 1.2em;
  font-weight: 600;
  margin: 12px 0 4px;
}

.markdown-body >>> h4 {
  font-size: 1.05em;
  font-weight: 600;
  margin: 10px 0 4px;
}

.markdown-body >>> h5,
.markdown-body >>> h6 {
  font-size: 1em;
  font-weight: 600;
  margin: 8px 0 4px;
  color: var(--text-secondary);
}

.markdown-body >>> strong {
  font-weight: 700;
  color: var(--text-primary);
}

.markdown-body >>> em {
  font-style: italic;
}

.markdown-body >>> del {
  text-decoration: line-through;
  color: var(--text-secondary);
}

.markdown-body >>> hr {
  border: none;
  border-top: 0.5px solid var(--separator-color);
  margin: 16px 0;
}

.markdown-body >>> a {
  color: var(--primary-color);
  text-decoration: none;
}

.markdown-body >>> a:hover {
  text-decoration: underline;
}

.markdown-body >>> img {
  max-width: 100%;
  border-radius: var(--radius-sm);
  margin: 8px 0;
}

.markdown-body >>> code:not(.hljs) {
  background: rgba(var(--primary-rgb), 0.08);
  color: var(--primary-color);
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 0.9em;
}

.markdown-body >>> input[type="checkbox"] {
  margin-right: 6px;
}

.markdown-body >>> .task-list-item {
  list-style: none;
  margin-left: -20px;
}

.aichat-input-area {
  padding: 12px 20px;
  border-top: 0.5px solid var(--separator-color);
  background: var(--card-bg);
}

.input-wrapper {
  max-width: 800px;
  margin: 0 auto;
}

.aichat-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-body);
  color: var(--text-primary);
  background: var(--bg-color);
  resize: none;
  max-height: 160px;
  min-height: 44px;
  line-height: 1.5;
  transition: border-color 0.2s;
  box-sizing: border-box;
  font-family: inherit;
  overflow-y: hidden;
  min-width: 0;
}

.aichat-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.aichat-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.input-meta {
  display: flex;
  justify-content: flex-end;
  padding: 2px 4px 0 0;
  min-height: 18px;
}

.char-counter {
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
}

.char-warning {
  color: var(--danger-color);
  font-weight: 600;
}

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: var(--primary-color);
  color: #fff;
  border-radius: var(--radius-md);
  transition: background 0.2s, opacity 0.2s, transform 0.15s;
  white-space: nowrap;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn:active:not(:disabled) {
  transform: scale(0.92);
  opacity: 0.7;
}

.send-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.confirm-dialog {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 24px;
  max-width: 400px;
  width: 90%;
  box-shadow: var(--shadow-lg);
}

.confirm-title {
  font-size: var(--font-size-subheadline);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px 0;
}

.confirm-message {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin: 0 0 20px 0;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.confirm-btn {
  padding: 10px 20px;
  min-height: 44px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.confirm-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.confirm-btn.cancel {
  background: var(--bg-color);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.confirm-btn.cancel:hover {
  background: var(--border-color);
}

.confirm-btn.danger {
  background: var(--danger-color);
  color: #fff;
}

.confirm-btn.danger:hover {
  background: #c82333;
}

.conv-list-enter-active,
.conv-list-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.conv-list-enter {
  opacity: 0;
  transform: translateX(-10px);
}

.conv-list-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

@media (max-width: 768px) {
  .aichat-sidebar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    box-shadow: var(--shadow-md);
    width: 280px;
  }

  .aichat-sidebar.sidebar-hidden {
    transform: translateX(-100%);
    width: 280px;
    opacity: 0;
    pointer-events: none;
  }

  .aichat-main {
    width: 100%;
  }

  .aichat-header {
    padding: 10px 14px;
  }

  .aichat-messages {
    padding: 12px 14px;
  }

  .aichat-input-area {
    padding: 10px 14px;
  }

  .msg-body {
    max-width: 85%;
  }

  .example-prompts {
    grid-template-columns: repeat(2, 1fr);
  }

  .empty-state {
    padding: 24px 16px;
  }

  .empty-icon {
    font-size: 40px;
  }

  .empty-title {
    font-size: var(--font-size-subheadline);
  }

  .conv-actions {
    opacity: 1;
  }
}

/* Landscape tablet optimization */
@media (min-width: 1024px) and (orientation: landscape) {
  .aichat-sidebar { width: 260px; }
  .sidebar-search { padding: 8px 10px; }
  .sidebar-search-input { font-size: var(--font-size-caption); }
  .chat-list { padding: 4px 6px 6px 6px; }
  .chat-list-item { padding: 8px 10px; gap: 8px; }
  .conv-icon { font-size: var(--font-size-sm); }
  .conv-title { font-size: var(--font-size-sm); }
  .conv-time { font-size: var(--font-size-caption2); }
  .conv-group-label { font-size: var(--font-size-caption2); padding: 6px 10px 2px 10px; }
  .aichat-header { padding: 10px 16px; min-height: 48px; }
  .aichat-title { font-size: var(--font-size-body); }
  .aichat-messages { padding: 12px 16px; }
  .aichat-input-area { padding: 10px 16px; }
  .msg-body { max-width: 75%; }
  .example-prompts { grid-template-columns: repeat(3, 1fr); gap: 8px; max-width: 600px; }
  .prompt-item { padding: 10px 12px; font-size: var(--font-size-caption); }
}

.model-status {
  display: flex;
  align-items: center;
  margin-right: 4px;
}

.model-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-caption2);
  font-weight: 600;
  letter-spacing: 0.3px;
}

.model-badge-default {
  background: rgba(var(--warning-rgb), 0.1);
  color: var(--warning-color);
  border: 1px solid rgba(var(--warning-rgb), 0.2);
}

.model-badge-ds {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.header-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  font-size: var(--font-size-sm);
}

.header-icon-btn:hover {
  background: var(--bg-color);
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.header-icon-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.conv-settings-panel {
  width: 440px;
  max-width: 92vw;
  max-height: 85vh;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.conv-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-oetween;
  padding: 18px 20px 14px;
  border-bottom: 0.5px solid var(--separator-color);
}

.conv-settings-header .panel-title {
  margin: 0;
}

.conv-settings-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: var(--font-size-callout);
  transition: all 0.15s;
}

.conv-settings-close:hover {
  background: var(--bg-color);
  color: var(--text-primary);
}

.conv-settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.settings-section {
  margin-bottom: 20px;
}

.settings-section:last-child {
  margin-bottom: 0;
}

.settings-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.settings-label i {
  font-size: var(--font-size-sm);
  color: var(--primary-color);
}

.settings-hint {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin: 0 0 10px 0;
  line-height: 1.5;
}

.settings-textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
  outline: none;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.settings-textarea:focus {
  border-color: var(--primary-color);
}

.settings-textarea-meta {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}

.priority-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.priority-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  background: var(--bg-color);
  border: 1px solid transparent;
  transition: all 0.15s;
}

.priority-item.priority-active {
  color: var(--text-primary);
  border-color: var(--primary-color);
  background: rgba(var(--primary-rgb), 0.04);
}

.priority-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--border-color);
  color: var(--text-secondary);
  font-size: var(--font-size-caption2);
  font-weight: 700;
  flex-shrink: 0;
}

.priority-active .priority-num {
  background: var(--primary-color);
  color: #fff;
}

.priority-badge {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: var(--radius-md);
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--primary-color);
  font-size: var(--font-size-caption2);
  font-weight: 600;
}

.conv-settings-footer {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 14px 20px;
  border-top: 0.5px solid var(--separator-color);
}

.fallback-notice {
  position: fixed;
  top: 70px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  background: #fffbeb;
  border: 1px solid #fbbf24;
  border-radius: var(--radius-md);
  color: #92400e;
  font-size: var(--font-size-sm);
  font-weight: 500;
  box-shadow: var(--shadow-md);
  z-index: 3000;
  max-width: 90vw;
}

.fallback-notice i {
  font-size: var(--font-size-callout);
  color: var(--warning-color);
  flex-shrink: 0;
}

.fallback-notice-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: none;
  border: none;
  cursor: pointer;
  color: #92400e;
  font-size: var(--font-size-sm);
  flex-shrink: 0;
  transition: background 0.15s;
}

.fallback-notice-close:hover {
  background: rgba(245, 158, 11, 0.15);
}

.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: all 0.3s var(--ease-standard);
}

.toast-slide-enter,
.toast-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}

.empty-icon {
  color: rgba(var(--primary-rgb), 0.4);
}

@media (max-width: 768px) {
  .model-status {
    display: none;
  }
  .conv-settings-panel {
    max-width: 100vw;
    width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }
  .fallback-notice {
    left: 10px;
    right: 10px;
    transform: none;
    font-size: var(--font-size-caption);
  }
  .toast-slide-enter,
  .toast-slide-leave-to {
    transform: translateY(-20px);
  }
}

/* Forward Selection Sheet (iOS-style) */
.forward-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 9999;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.forward-sheet {
  background: var(--bg-color, #fff);
  border-radius: 20px 20px 0 0;
  width: 100%;
  max-width: 500px;
  padding: 8px 0 20px;
  animation: forwardSlideUp 0.3s ease;
}
@keyframes forwardSlideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.forward-sheet-title {
  text-align: center;
  font-size: 13px;
  color: var(--text-color-secondary, #999);
  padding: 12px 0;
  border-bottom: 0.5px solid var(--separator-color, #e5e5ea);
}
.forward-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 16px 20px;
  background: none;
  border: none;
  font-size: 16px;
  color: var(--text-color, #000);
  cursor: pointer;
}
.forward-option:active { background: var(--bg-color-secondary, #f5f5f5); }
.forward-option i { width: 24px; text-align: center; color: var(--text-color-secondary, #999); }
.forward-cancel {
  width: 100%;
  padding: 16px;
  margin-top: 8px;
  background: none;
  border: none;
  border-top: 0.5px solid var(--separator-color, #e5e5ea);
  font-size: 16px;
  color: var(--text-color, #000);
  cursor: pointer;
}

/* AI Content Viewer */
.viewer-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.viewer-panel {
  background: var(--bg-color, #fff);
  border-radius: 14px;
  width: 100%;
  max-width: 720px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--separator-color, #e5e5ea);
}
.viewer-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color, #000);
}
.viewer-close {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--text-color-secondary, #999);
  cursor: pointer;
  padding: 4px 8px;
}
.viewer-body {
  padding: 20px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-color, #000);
}

/* 多选模式 - 导航栏按钮激活态 */
.nav-action-active {
  background: rgba(var(--primary-rgb), 0.12);
  color: var(--primary-color);
}

/* 多选模式 - 消息选中样式 */
.msg-selectable {
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background 0.15s var(--ease-standard);
}

.msg-selectable:hover {
  background: rgba(var(--primary-rgb), 0.04);
}

.msg-selected {
  background: rgba(0, 122, 255, 0.08);
}

/* 多选模式 - 圆形 checkbox */
.msg-checkbox {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--separator-color, #e5e5ea);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: 8px;
  align-self: center;
  transition: all 0.2s var(--ease-standard);
}

.msg-checkbox.checked {
  background: var(--primary-color, #007aff);
  border-color: var(--primary-color, #007aff);
  color: #fff;
}

.msg-checkbox i {
  font-size: 12px;
}

/* 多选模式 - 底部批量操作栏 */
.batch-action-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--nav-bg, var(--card-bg, #fff));
  backdrop-filter: var(--glass-blur-nav, blur(20px));
  -webkit-backdrop-filter: var(--glass-blur-nav, blur(20px));
  border-top: 0.5px solid var(--separator-color, #e5e5ea);
  z-index: 100;
}

.batch-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: none;
  border: 0.5px solid var(--separator-color, #e5e5ea);
  border-radius: var(--radius-md, 10px);
  font-size: var(--font-size-caption1, 13px);
  color: var(--text-color, #000);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}

.batch-btn:active {
  opacity: 0.7;
  transform: scale(0.96);
}

.batch-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.batch-btn-primary {
  background: var(--primary-color, #007aff);
  color: #fff;
  border-color: var(--primary-color, #007aff);
}

.batch-btn-primary:disabled {
  background: var(--separator-color, #e5e5ea);
  border-color: var(--separator-color, #e5e5ea);
  color: var(--text-color-secondary, #999);
}

.batch-count {
  flex: 1;
  text-align: center;
  font-size: var(--font-size-caption1, 13px);
  color: var(--text-color-secondary, #999);
}

@media (max-width: 768px) {
  .batch-action-bar {
    padding: 10px 12px;
    gap: 6px;
  }
  .batch-btn {
    padding: 8px 10px;
    font-size: 12px;
  }
  .batch-count {
    font-size: 12px;
  }
}
</style>
