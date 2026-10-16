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
          <div v-for="n in 4" :key="n" class="conv-skeleton">
            <div class="skeleton skeleton-avatar-sm"></div>
            <div class="skeleton-lines">
              <div class="skeleton skeleton-line-60"></div>
              <div class="skeleton skeleton-line-80"></div>
            </div>
          </div>
        </div>
        <div v-else-if="conversations.length === 0" class="sidebar-empty">
          <i class="fa-regular fa-comment-dots"></i>
          <span>暂无对话</span>
        </div>
        <template v-else>
          <!-- Conversation Search（服务端全文检索：标题 + 消息正文） -->
          <div class="sidebar-search">
            <i class="fa-solid fa-magnifying-glass sidebar-search-icon"></i>
            <input
              v-model="convSearchQuery"
              class="sidebar-search-input"
              placeholder="搜索标题和对话内容..."
              @input="onConvSearchInput"
            />
            <span v-if="searchingConvs" class="sidebar-search-spin"></span>
            <button v-else-if="convSearchQuery" class="sidebar-search-clear" @click="clearConvSearch">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div v-if="serverSearchActive" class="conv-search-meta">
            正文中找到 {{ searchResults.length }} 个对话
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
                    <div class="conv-title" v-if="editingId !== conv.id">{{ conv.title }}<span v-if="streamStates[conv.id]" class="conv-streaming" title="正在生成回复"><i class="fa-solid fa-circle-notch fa-spin"></i></span></div>
                    <input
                      v-else
                      v-model="editTitle"
                      class="conv-edit-input"
                      @keyup.enter="saveRename(conv.id)"
                      @blur="saveRename(conv.id)"
                      v-focus
                    />
                    <div class="conv-time">{{ formatConvTime(conv.updated_at) }}</div>
                    <div v-if="conv.snippet" class="conv-snippet">{{ conv.snippet }}</div>
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
            <!-- 统一模型选择器 -->
            <div class="model-picker">
              <button class="model-picker-btn" @click="showModelPanel = true" title="切换模型">
                <span class="model-dot" :style="{ background: currentModelInfo.color }"></span>
                <span class="model-picker-label">{{ currentModelInfo.label }}</span>
                <i class="fa-solid fa-chevron-down model-picker-chevron"></i>
              </button>
              <button
                v-if="currentModelInfo.supports_thinking"
                class="model-think-btn"
                :class="{ active: thinkingMode }"
                @click="toggleThinkingMode"
                title="思考模式"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                <span>思考</span>
              </button>
            </div>
            <button v-if="currentConvId" class="header-icon-btn" @click="openConvSettings" title="对话设置">
              <i class="fa-solid fa-gear"></i>
            </button>
            <button
              v-if="currentConvId"
              class="ctx-pill"
              :class="ctxClass"
              @click="openMemoryPanel"
              :title="'上下文占用 ' + ctxPercent + '%，点击查看记忆'"
            >
              <span class="ctx-pill-track"><i :style="{ width: ctxPercent + '%' }"></i></span>
              <span class="ctx-pill-text">{{ ctxPercent }}%</span>
            </button>
            <button v-if="currentConvId && currentMessages.length > 0" class="header-icon-btn" @click="exportLongImage" :disabled="exportingImage" title="导出长图到云盘">
              <i v-if="!exportingImage" class="fa-regular fa-image"></i>
              <i v-else class="fa-solid fa-spinner fa-spin"></i>
            </button>
            <button v-if="currentConvId && currentMessages.length > 0" class="header-btn" @click="confirmClearHistory" title="清空对话">清空</button>
            <span v-if="backgroundStreamCount" class="bg-stream-chip" title="其他会话正在后台生成，切换过去可查看进度">
              <i class="fa-solid fa-circle-notch fa-spin"></i> {{ backgroundStreamCount }} 个后台生成
            </span>
            <button v-if="isStreaming" class="stop-btn" @click="stopGeneration">停止生成</button>
          </div>
        </div>

        <!-- Messages Area -->
        <div class="aichat-messages scrollbar-thin" ref="msgContainer" @scroll.passive="onMessagesScroll">
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
            <div v-if="hiddenMessageCount > 0" class="load-earlier-row">
              <button class="load-earlier-btn" @click="loadEarlierMessages">
                显示更早的 {{ Math.min(hiddenMessageCount, 40) }} 条（还有 {{ hiddenMessageCount }} 条未渲染）
              </button>
            </div>
            <div
              v-for="(msg, idx) in renderedMessages"
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
              <div class="msg-avatar"><i :class="msg.role === 'user' ? 'fa-solid fa-user' : 'fa-solid fa-robot'"></i></div>
              <div class="msg-body">
                <!-- AI searching indicator -->
                <div v-if="msg.role === 'assistant' && !msg.content && !msg.error && isSearching && idx === renderedMessages.length - 1" class="msg-content msg-searching">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-spin"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <span>正在搜索{{ searchQuery ? '：' + searchQuery : '...' }}</span>
                </div>
                <!-- AI streaming: show typing indicator instead of empty bubble -->
                <div v-if="msg.role === 'assistant' && !msg.content && !msg.reasoning && !msg.error && isStreaming && !isSearching && idx === renderedMessages.length - 1" class="msg-content msg-typing">
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
                <!-- 用户消息附带的云盘图片 -->
                <div v-if="msg.role === 'user' && msg.images && msg.images.length" class="msg-images">
                  <a
                    v-for="(im, imIdx) in msg.images"
                    :key="imIdx"
                    class="msg-image"
                    :href="im.url"
                    target="_blank"
                    rel="noopener"
                    :title="im.name"
                  >
                    <img :src="im.url + '?w=200'" :alt="im.name || '图片'" loading="lazy" />
                  </a>
                </div>
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
                  <button v-if="idx === renderedMessages.length - 1" class="msg-action-btn" @click="regenerateMessage(msg)" title="重新生成">
                    <i class="fa-solid fa-rotate"></i>
                  </button>
                </div>
                <!-- User message actions (edit + copy + forward) -->
                <div v-if="!selectMode && msg.role === 'user' && !isStreaming" class="msg-actions msg-actions-user">
                  <button class="msg-action-btn" @click="editMessage(msg)" title="编辑消息">
                    <i class="fa-solid fa-pen"></i>
                  </button>
                  <button class="msg-action-btn" @click="copyRawMarkdown(msg.content)" title="复制这条消息">
                    <i class="fa-regular fa-copy"></i>
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
          <!-- 待发送的图片 -->
          <div v-if="pendingImages.length > 0" class="attach-row">
            <div v-for="(im, imIdx) in pendingImages" :key="imIdx" class="attach-chip">
              <img :src="im.url + '?w=120'" :alt="im.name" />
              <span class="attach-name">{{ im.name }}</span>
              <button class="attach-remove" @click="removePendingImage(imIdx)" title="移除">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>
          <div class="input-wrapper">
            <div class="input-row">
              <button
                class="attach-btn"
                :class="{ 'attach-btn--active': pendingImages.length > 0 }"
                @click="openImagePicker"
                :disabled="isStreaming"
                :title="visionMode === 'none' ? visionHint : '从云盘选图发送（' + visionHint + '）'"
              >
                <i class="fa-regular fa-image"></i>
              </button>
              <textarea
                v-model="inputText"
                class="aichat-input"
                :placeholder="isStreaming ? 'AI 正在回复中...' : (visionMode === 'none' ? '输入消息，Enter 发送，Shift+Enter 换行' : '输入消息或从云盘选图，Enter 发送')"
                @keydown.enter.exact.prevent="sendMessage"
                @keydown.enter.shift.exact="allowNewline"
                @input="autoResize"
                rows="1"
                ref="inputEl"
                :disabled="isStreaming"
              ></textarea>
              <button class="send-btn" @click="sendMessage" :disabled="isStreaming || inputText.length > 2000 || (!inputText.trim() && pendingImages.length === 0)" :title="isStreaming ? '发送中...' : '发送'">
                <svg v-if="!isStreaming" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                <div v-else class="send-spinner"></div>
              </button>
            </div>
            <div class="input-meta">
              <span v-if="streamStatText" class="stream-stat">{{ streamStatText }}</span>
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

    <!-- Model Picker Panel -->
    <div v-if="showModelPanel" class="model-selector-overlay" @click.self="showModelPanel = false">
      <div class="model-panel">
        <div class="conv-settings-header">
          <h3 class="panel-title">选择模型</h3>
          <button class="conv-settings-close" @click="showModelPanel = false">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div v-if="currentPolicyLabel" class="model-policy-hint"><i class="fa-solid fa-shield-halved"></i> 当前策略：{{ currentPolicyLabel }}</div>
        <div class="model-list scrollbar-thin">
          <div v-if="availableModels.length === 0" class="admin-empty">
            <i class="fa-solid fa-cubes"></i>
            <span>暂无可用模型，请联系管理员在「模型管理」中启用</span>
          </div>
          <div
            v-for="m in availableModels"
            :key="m.id"
            class="model-item"
            :class="{ active: m.id === currentModel }"
            @click="switchModel(m.id)"
          >
            <span class="model-dot model-dot-lg" :style="{ background: m.color }"></span>
            <div class="model-item-info">
              <div class="model-item-label">
                <span>{{ m.label }}</span>
                <span v-if="m.is_default" class="model-tag model-tag-default">默认</span>
                <span v-if="m.is_free" class="model-tag model-tag-free">免费</span>
              </div>
              <div class="model-item-caps">
                <span v-if="m.supports_thinking"><i class="fa-solid fa-lightbulb"></i> 深度思考</span>
                <span v-if="m.supports_search"><i class="fa-solid fa-magnifying-glass"></i> 联网搜索</span>
                <span v-if="!m.supports_thinking && !m.supports_search">通用对话</span>
              </div>
            </div>
            <i v-if="m.id === currentModel" class="fa-solid fa-check model-item-check"></i>
          </div>
        </div>
        <div v-if="wallet && !wallet.unlimited" class="wallet-line" :class="{ 'wallet-line--warn': wallet.percent >= 80, 'wallet-line--full': wallet.percent >= 100 }">
          <div class="wallet-line-top">
            <i class="fa-solid fa-wallet"></i>
            <span>近 {{ wallet.window_days }} 天已用 ¥{{ (wallet.used_micro / 1000000).toFixed(2) }} / ¥{{ (wallet.quota_micro / 1000000).toFixed(2) }}</span>
            <b>{{ wallet.percent }}%</b>
          </div>
          <div class="wallet-bar"><i :style="{ width: Math.min(100, wallet.percent) + '%' }"></i></div>
          <div v-if="wallet.percent >= 100" class="wallet-tip">额度已用完，发消息会被拒绝，请联系管理员</div>
          <div v-else-if="wallet.percent >= 80" class="wallet-tip">额度快用完了，剩余 ¥{{ (wallet.remaining_micro / 1000000).toFixed(2) }}</div>
        </div>
        <div v-if="isAdmin" class="model-panel-footer">
          <button class="model-admin-entry" @click="goAdminPage">
            <i class="fa-solid fa-cubes"></i>
            <span>前往管理页配置模型</span>
            <i class="fa-solid fa-chevron-right model-admin-arrow"></i>
          </button>
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
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--warning-color)" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
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
    <!-- 上下文与记忆面板 -->
    <div v-if="showMemoryPanel" class="model-selector-overlay" @click.self="showMemoryPanel = false">
      <div class="conv-settings-panel">
        <div class="conv-settings-header">
          <h3 class="panel-title">上下文与记忆</h3>
          <button class="conv-settings-close" @click="showMemoryPanel = false">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="conv-settings-body">
          <div v-if="ctxLoading" class="ctx-loading"><div class="spinner"></div></div>
          <div v-else-if="!ctxInfo" class="ctx-error">{{ ctxError || '无法读取上下文信息' }}</div>
          <template v-else>
            <div class="settings-section">
              <div class="settings-label">
                <i class="fa-solid fa-gauge-high"></i>
                <span>上下文占用</span>
              </div>
              <div class="ctx-bar"><div class="ctx-bar-fill" :class="ctxClass" :style="{ width: ctxInfo.percent + '%' }"></div></div>
              <div class="ctx-legend">
                <span>{{ ctxInfo.used.toLocaleString() }} / {{ ctxInfo.budget.toLocaleString() }} tokens</span>
                <span>{{ ctxInfo.message_count }} 条消息 · {{ ctxInfo.model_label }}</span>
              </div>
              <div class="ctx-breakdown">
                <div class="ctx-item"><i class="ctx-dot ctx-dot--sys"></i>系统提示 <b>{{ ctxInfo.breakdown.system }}</b></div>
                <div class="ctx-item"><i class="ctx-dot ctx-dot--mem"></i>对话记忆 <b>{{ ctxInfo.breakdown.summary }}</b></div>
                <div class="ctx-item"><i class="ctx-dot ctx-dot--his"></i>历史消息 <b>{{ ctxInfo.breakdown.history }}</b></div>
              </div>
              <p class="settings-hint">
                <template v-if="ctxInfo.will_summarize">已达自动记忆阈值（{{ ctxInfo.trigger_count }} 条），下一轮会自动把旧内容压缩成记忆。</template>
                <template v-else-if="ctxInfo.can_summarize">可手动「重新生成记忆」来压缩旧内容（自动保留最近 {{ ctxInfo.keep_recent }} 条）。</template>
                <template v-else>消息还不多，继续聊会自动积累记忆。</template>
              </p>
            </div>

            <div class="settings-section">
              <div class="settings-label">
                <i class="fa-solid fa-brain"></i>
                <span>对话记忆</span>
              </div>
              <p class="settings-hint">记忆会作为长期上下文注入每次请求，可手动修正。它与「对话人设」互补：人设定角色，记忆记事实。</p>
              <textarea
                class="settings-textarea"
                v-model="memoryDraft"
                rows="5"
                maxlength="2000"
                placeholder="（暂无记忆。对话变长后会自动生成，也可点下方「重新生成」）"
              ></textarea>
              <div class="settings-textarea-meta">
                <span class="char-counter" :class="{ 'char-warning': memoryDraft.length > 1800 }">{{ memoryDraft.length }}/2000</span>
                <span v-if="ctxInfo.summary_at" class="ctx-updated">更新于 {{ ctxInfo.summary_at }}</span>
              </div>
              <div class="ctx-actions">
                <button class="ctx-btn ctx-btn--ghost" :disabled="memoryBusy || !memoryDraft.length" @click="clearMemory">清空记忆</button>
                <button class="ctx-btn ctx-btn--ghost" :disabled="memoryBusy || !ctxInfo.can_summarize" @click="rebuildMemory">
                  <i class="fa-solid fa-rotate" :class="{ 'fa-spin': memoryBusy }"></i> 重新生成
                </button>
                <button class="ctx-btn ctx-btn--primary" :disabled="memorySaving || memoryDraft === (ctxInfo.summary || '')" @click="saveMemory">保存记忆</button>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-label">
                <i class="fa-solid fa-share-nodes"></i>
                <span>导出与分享</span>
              </div>
              <p class="settings-hint">不再往设备里落文件：要么复制成文字带走，要么直接生成长图存进云盘。</p>
              <div class="ctx-actions">
                <button class="ctx-btn ctx-btn--ghost" @click="copyConversation('md')">
                  <i class="fa-regular fa-copy"></i> 复制 Markdown
                </button>
                <button class="ctx-btn ctx-btn--ghost" @click="copyConversation('txt')">
                  <i class="fa-regular fa-copy"></i> 复制纯文本
                </button>
                <button class="ctx-btn ctx-btn--primary" :disabled="exportingImage" @click="exportLongImage">
                  <i class="fa-regular fa-image" :class="{ 'fa-spin': false }"></i>
                  {{ exportingImage ? '生成中…' : '导出长图到云盘' }}
                </button>
              </div>
              <p class="settings-hint">长图会存到云盘的「AI 对话导出」分组，生成完可在云盘里查看或分享。</p>
            </div>
          </template>
        </div>
      </div>
    </div>

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
        <span>{{ fallbackNoticeText }}</span>
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
          <span class="viewer-title">AI对话内容</span>
          <button class="viewer-close" @click="viewerContent = null"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="viewer-body scrollbar-thin markdown-body" v-html="renderMarkdown(viewerContent)"></div>
      </div>
    </div>

    <!-- 云盘选图（看图对话） -->
    <CloudImagePicker
      :visible="showImagePicker"
      :max="visionInfo.max_images || 4"
      @close="showImagePicker = false"
      @confirm="onImagesPicked"
    />
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
import CloudImagePicker from './CloudImagePicker.vue';
import { renderConversationLongImage } from './longImage.js';

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

// Markdown 渲染缓存：长会话里任何一次状态变更都会让整个列表重算 v-html，
// marked + KaTeX + DOMPurify 跑一遍很贵。内容不变就直接复用上次的 HTML。
var MD_CACHE_MAX = 160;
var mdCache = new Map();
function markdownCached(content, render) {
  var key = content;
  if (mdCache.has(key)) {
    // 命中后挪到队尾（简单 LRU）
    var hit = mdCache.get(key);
    mdCache.delete(key);
    mdCache.set(key, hit);
    return hit;
  }
  var html = render(content);
  mdCache.set(key, html);
  if (mdCache.size > MD_CACHE_MAX) {
    mdCache.delete(mdCache.keys().next().value);
  }
  return html;
}

export default {
  components: { AppNavBar: AppNavBar, CloudImagePicker: CloudImagePicker },
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
      serverSearchActive: false,
      searchResults: [],
      searchingConvs: false,
      convSearchTimer: null,
      // 上下文与记忆
      showMemoryPanel: false,
      ctxInfo: null,
      ctxLoading: false,
      ctxError: '',
      memoryDraft: '',
      memorySaving: false,
      memoryBusy: false,
      pinnedConvIds: [],
      aiSettingsLoaded: false,
      currentModel: 'default',
      availableModels: [],
      currentPolicyLabel: '',
      defaultModelId: 'default',
      showModelPanel: false,
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
      // ---- 看图（云盘选图）----
      showImagePicker: false,
      pendingImages: [],          // 待发送的图片 [{hash,name,url}]
      visionInfo: { enabled: false, relay_model: '', max_images: 4 },
      // ---- 额度（null = 不限额，不显示）----
      wallet: null,
      // ---- 长图导出 ----
      exportingImage: false,
      lastExportHash: '',
      // ---- 长会话渲染优化 ----
      renderLimit: 40,            // 首屏只渲染最近 N 条，向上滚动再加载
      loadEarlierBusy: false,
      // ---- 流式体验：首字延迟 / 耗时 / 字数 ----
      // streamStates 才是真正的运行期状态（按会话隔离）；下面这些是「当前会话」的镜像
      streamStates: {},
      streamStartedAt: 0,
      streamFirstTokenAt: 0,
      streamChars: 0,
      streamRafId: 0,
      streamPending: '',
      streamReplace: false,
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
    isAdmin: function() {
      // 与服务端 requireAuth 的提升逻辑一致：班管（user_id 以 00 结尾，
      // 登录响应带 is_class_admin）也有管理权；user.is_admin 是登录时的
      // 静态快照，班管场景下为 0，不能只看它
      var u = this.$store.state.auth.user;
      if (!u) return false;
      if (u.is_admin === 1) return true;
      return u.is_class_admin === true || u.is_class_admin === 1;
    },
    currentModelInfo: function() {
      var self = this;
      for (var i = 0; i < self.availableModels.length; i++) {
        if (self.availableModels[i].id === self.currentModel) return self.availableModels[i];
      }
      // 兜底：模型列表未加载或当前模型已被移除
      return { id: self.currentModel, label: self.currentModel === 'default' ? 'GPT' : self.currentModel, color: 'var(--accent-ai)', supports_thinking: false, supports_search: false, is_free: false };
    },
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
    // 只渲染最近 N 条：长会话一次渲染几百条 Markdown 是卡顿的主因
    renderedMessages: function() {
      var all = this.currentMessages;
      if (all.length <= this.renderLimit) return all;
      return all.slice(all.length - this.renderLimit);
    },
    hiddenMessageCount: function() {
      return Math.max(0, this.currentMessages.length - this.renderLimit);
    },
    // 当前模型能不能看图：自身支持 → 原生；否则看管理员是否配了统一转述模型
    visionMode: function() {
      if (!this.visionInfo.enabled) return 'none';
      if (this.currentModelInfo.supports_vision) return 'native';
      if (this.visionInfo.relay_model) return 'relay';
      return 'none';
    },
    visionHint: function() {
      if (this.visionMode === 'native') return '当前模型支持看图，图片会直接发给它';
      if (this.visionMode === 'relay') return '当前模型不支持看图，将由管理员配置的转述模型先把图片说成文字';
      return '当前模型不支持看图，且管理员未配置统一转述模型';
    },
    streamElapsed: function() {
      if (!this.streamStartedAt) return 0;
      var end = this.isStreaming ? Date.now() : (this.streamFirstTokenAt ? Date.now() : this.streamStartedAt);
      return Math.max(0, end - this.streamStartedAt);
    },
    streamStatText: function() {
      if (!this.isStreaming && !this.streamChars) return '';
      var parts = [];
      if (this.streamFirstTokenAt && this.streamStartedAt) {
        parts.push('首字 ' + ((this.streamFirstTokenAt - this.streamStartedAt) / 1000).toFixed(1) + 's');
      }
      parts.push(this.streamChars + ' 字');
      if (!this.isStreaming && this.streamStartedAt) {
        parts.push('共 ' + ((Date.now() - this.streamStartedAt) / 1000).toFixed(1) + 's');
      }
      return parts.join(' · ');
    },
    groupedConversations: function() {
      var self = this;
      // 服务端检索结果已按关键词过滤过，这里不再按标题二次过滤
      var source = self.serverSearchActive ? self.searchResults : self.conversations;
      var filtered = source.filter(function(c) {
        if (self.serverSearchActive) return true;
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
    },
    // 上下文占用百分比（未取到时为 0）
    ctxPercent: function() {
      if (!this.ctxInfo) return 0;
      return this.ctxInfo.percent || 0;
    },
    // 分级配色：>=85% 危险，>=60% 提醒
    ctxClass: function() {
      var p = this.ctxPercent;
      if (p >= 85) return 'ctx-danger';
      if (p >= 60) return 'ctx-warn';
      return 'ctx-ok';
    },
    // 除当前会话外还有几个在后台生成
    backgroundStreamCount: function() {
      var self = this;
      return Object.keys(self.streamStates).filter(function(id) { return id !== self.currentConvId; }).length;
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
          var label = m.role === 'user' ? '用户' : 'AI';
          return '### ' + label + '\n\n' + m.content;
        }).join('\n\n---\n\n');
      } catch (e) {}
      self.$router.replace({ query: {} }).catch(function() {});
    }
  },
  beforeDestroy: function() {
    window.removeEventListener('resize', this.handleResize);
    // 离开页面前把所有还在跑的会话全部停掉，避免内存里的 SSE 悬着
    if (this.stopAllStreams) this.stopAllStreams();
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
        if (data.model) self.currentModel = data.model;
        self.aiSettingsLoaded = true;
        self.loadModels();
      }).catch(function() {
        var localPrompt = localStorage.getItem('ai_system_prompt');
        if (localPrompt) self.customSystemPrompt = localPrompt;
        try {
          var localPinned = JSON.parse(localStorage.getItem('ai_pinned_convs') || '[]');
          if (localPinned.length > 0) self.pinnedConvIds = localPinned;
        } catch (e) {}
        self.aiSettingsLoaded = true;
        self.loadModels();
      });
    },
    loadModels: function() {
      var self = this;
      self.loadWallet();
      api.get('/ai-chat/models').then(function(response) {
        var data = response.data.data || {};
        self.availableModels = data.models || [];
        self.defaultModelId = data.default_model || 'default';
        self.currentPolicyLabel = data.policy_label || '';
        // 视觉能力总览：决定「选图」入口与走原生还是转述
        if (data.vision) {
          self.visionInfo = {
            enabled: !!data.vision.enabled,
            relay_model: data.vision.relay_model || '',
            max_images: data.vision.max_images || 4
          };
        }
        // 当前模型不可用（被禁用/删除/未加载）→ 回落全局默认
        var found = false;
        for (var i = 0; i < self.availableModels.length; i++) {
          if (self.availableModels[i].id === self.currentModel) { found = true; break; }
        }
        if (!found) {
          self.currentModel = self.defaultModelId;
          if (self.availableModels.length > 0) {
            var defFound = false;
            for (var j = 0; j < self.availableModels.length; j++) {
              if (self.availableModels[j].id === self.currentModel) { defFound = true; break; }
            }
            if (!defFound) self.currentModel = self.availableModels[0].id;
          }
        }
        // 新模型不支持思考时关闭思考模式
        if (self.thinkingMode && !self.currentModelInfo.supports_thinking) {
          self.thinkingMode = false;
        }
        // 切到不能看图的模型时，清掉待发图片（发上去只会被后端拒）
        if (self.pendingImages.length > 0) {
          var canSee = self.currentModelInfo.supports_vision || !!self.visionInfo.relay_model;
          if (!canSee) {
            self.pendingImages = [];
            self.$store.commit('toast/SHOW_TOAST', { message: '当前模型不支持看图，已移除待发送的图片', type: 'info' });
          }
        }
      }).catch(function() {});
    },

    // ======== 额度（不设额度的人后端直接返回 unlimited，前端就不显示进度条）========
    loadWallet: function() {
      var self = this;
      api.get('/ai-chat/wallet', { timeout: 10000 }).then(function(res) {
        var d = (res.data && res.data.data) || null;
        self.wallet = d && d.unlimited ? null : d;
      }).catch(function() { self.wallet = null; });
    },

    // ======== 看图：云盘选图 ========
    openImagePicker: function() {
      var self = this;
      if (self.visionMode === 'none') {
        self.$store.commit('toast/SHOW_TOAST', {
          message: self.visionHint + '（可在模型上开启视觉能力，或让管理员配置统一转述模型）',
          type: 'warning'
        });
        return;
      }
      self.showImagePicker = true;
    },
    onImagesPicked: function(items) {
      var self = this;
      self.showImagePicker = false;
      var max = self.visionInfo.max_images || 4;
      for (var i = 0; i < items.length && self.pendingImages.length < max; i++) {
        var it = items[i];
        var dup = false;
        for (var j = 0; j < self.pendingImages.length; j++) {
          if (self.pendingImages[j].hash === it.hash) { dup = true; break; }
        }
        if (!dup) self.pendingImages.push({ hash: it.hash, name: it.name, url: it.url });
      }
      if (items.length > max) {
        self.$store.commit('toast/SHOW_TOAST', { message: '一次最多发送 ' + max + ' 张图片', type: 'warning' });
      }
    },
    removePendingImage: function(idx) {
      this.pendingImages.splice(idx, 1);
    },

    // ======== 长会话：分段渲染 ========
    loadEarlierMessages: function() {
      var self = this;
      if (self.loadEarlierBusy) return;
      var container = self.$refs.msgContainer;
      var prevHeight = container ? container.scrollHeight : 0;
      self.loadEarlierBusy = true;
      self.renderLimit += 40;
      self.$nextTick(function() {
        if (container) {
          // 保持视口不跳：把新增内容撑开的高度补回 scrollTop
          container.scrollTop = container.scrollHeight - prevHeight + container.scrollTop;
        }
        self.loadEarlierBusy = false;
      });
    },
    onMessagesScroll: function() {
      var self = this;
      if (self.hiddenMessageCount === 0 || self.loadEarlierBusy) return;
      var container = self.$refs.msgContainer;
      if (!container) return;
      if (container.scrollTop < 120) self.loadEarlierMessages();
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
    // ======== 服务端全文检索（标题 + 消息正文）========
    onConvSearchInput: function() {
      var self = this;
      clearTimeout(self.convSearchTimer);
      var q = String(self.convSearchQuery || '').trim();
      if (!q) {
        self.serverSearchActive = false;
        self.searchResults = [];
        self.loadConversations();
        return;
      }
      self.convSearchTimer = setTimeout(function() { self.runConvSearch(q); }, 320);
    },
    runConvSearch: function(q) {
      var self = this;
      self.searchingConvs = true;
      api.get('/ai-chat/conversations', { params: { q: q, limit: 60 } }).then(function(response) {
        var list = (response.data && response.data.data) || [];
        self.searchResults = list.map(function(c) {
          return {
            id: c.id,
            title: c.title,
            persona: c.persona || '',
            created_at: c.created_at,
            updated_at: c.updated_at,
            snippet: c.snippet || '',
            match_count: c.match_count || 0,
            matched_in: c.matched_in || ''
          };
        });
        self.serverSearchActive = true;
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '搜索失败，请重试', type: 'error' });
      }).finally(function() {
        self.searchingConvs = false;
      });
    },
    clearConvSearch: function() {
      this.convSearchQuery = '';
      this.serverSearchActive = false;
      this.searchResults = [];
      this.loadConversations();
    },

    // ======== 上下文 / 记忆 ========
    loadContext: function() {
      var self = this;
      if (!self.currentConvId) {
        self.ctxInfo = null;
        return;
      }
      self.ctxLoading = true;
      self.ctxError = '';
      var convId = self.currentConvId;
      api.get('/ai-chat/conversations/' + convId + '/context', { params: { model: self.currentModel } }).then(function(response) {
        if (self.currentConvId !== convId) return; // 切走了就丢弃
        self.ctxInfo = (response.data && response.data.data) || null;
        self.memoryDraft = self.ctxInfo ? (self.ctxInfo.summary || '') : '';
      }).catch(function(err) {
        self.ctxInfo = null;
        self.ctxError = (err && err.response && err.response.data && err.response.data.message) || '无法读取上下文信息';
      }).finally(function() {
        self.ctxLoading = false;
      });
    },
    openMemoryPanel: function() {
      this.showMemoryPanel = true;
      this.loadContext();
    },
    saveMemory: function() {
      var self = this;
      self.memorySaving = true;
      api.put('/ai-chat/conversations/' + self.currentConvId + '/summary', { summary: self.memoryDraft }).then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '记忆已保存', type: 'success' });
        self.loadContext();
      }).catch(function(err) {
        var msg = (err && err.response && err.response.data && err.response.data.message) || '保存失败';
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      }).finally(function() {
        self.memorySaving = false;
      });
    },
    clearMemory: function() {
      var self = this;
      self.memoryDraft = '';
      self.saveMemory();
    },
    rebuildMemory: function() {
      var self = this;
      self.memoryBusy = true;
      api.post('/ai-chat/conversations/' + self.currentConvId + '/summary/rebuild', {}).then(function(response) {
        var d = (response.data && response.data.data) || {};
        self.memoryDraft = d.summary || '';
        self.$store.commit('toast/SHOW_TOAST', { message: '记忆已重新生成', type: 'success' });
        self.loadContext();
      }).catch(function(err) {
        var msg = (err && err.response && err.response.data && err.response.data.message) || '生成失败';
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      }).finally(function() {
        self.memoryBusy = false;
      });
    },

    // ======== 导出：复制文本 / 长图存云盘 ========
    // 文件下载式导出已下线：不再往设备落文件，改为「复制带走」或「生成长图存云盘」
    buildConversationText: function(format) {
      var self = this;
      var title = self.currentTitle || 'AI 对话';
      var msgs = self.currentMessages || [];
      var memory = (self.ctxInfo && self.ctxInfo.summary) || '';
      if (format === 'txt') {
        var lines = [title, ''];
        if (memory) lines.push('【对话记忆】' + memory, '');
        for (var i = 0; i < msgs.length; i++) {
          lines.push((msgs[i].role === 'user' ? '我：' : 'AI：') + (msgs[i].content || ''));
          lines.push('');
        }
        return lines.join('\n');
      }
      var md = ['# ' + title, ''];
      md.push('> 导出时间：' + new Date().toLocaleString('zh-CN') + ' · 消息数：' + msgs.length);
      if (memory) md.push('', '## 对话记忆', '', memory);
      md.push('');
      for (var k = 0; k < msgs.length; k++) {
        md.push('## ' + (msgs[k].role === 'user' ? '我' : 'AI'), '', msgs[k].content || '', '');
      }
      return md.join('\n');
    },
    // 导出前确保上下文信息（含对话记忆）已加载，否则长图里会少一块
    ensureContext: function() {
      var self = this;
      if (self.ctxInfo || !self.currentConvId) return Promise.resolve();
      return api.get('/ai-chat/conversations/' + self.currentConvId + '/context').then(function(response) {
        self.ctxInfo = (response.data && response.data.data) || null;
      }).catch(function() {});
    },
    copyConversation: function(format) {
      var self = this;
      if (!self.currentConvId || self.currentMessages.length === 0) {
        self.$store.commit('toast/SHOW_TOAST', { message: '当前对话还没有内容', type: 'warning' });
        return;
      }
      self.ensureContext().then(function() {
        var text = self.buildConversationText(format || 'md');
        self.copyPlainText(text, (format === 'txt' ? '纯文本' : 'Markdown') + ' 已复制（' + text.length + ' 字）');
      });
    },
    copyPlainText: function(text, okMsg) {
      var self = this;
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: okMsg || '已复制', type: 'success' });
        }).catch(function() {
          self.fallbackCopy(text);
        });
      } else {
        self.fallbackCopy(text);
      }
    },
    exportLongImage: function() {
      var self = this;
      if (!self.currentConvId || self.currentMessages.length === 0) {
        self.$store.commit('toast/SHOW_TOAST', { message: '当前对话还没有内容', type: 'warning' });
        return;
      }
      if (self.exportingImage) return;
      self.exportingImage = true;
      self.$store.commit('toast/SHOW_TOAST', { message: '正在生成长图…', type: 'info' });

      self.ensureContext().then(function() {
        var payload = {
          title: self.currentTitle || 'AI 对话',
          modelLabel: self.currentModelInfo.label || '',
          memory: (self.ctxInfo && self.ctxInfo.summary) || '',
          messages: self.currentMessages.map(function(m) {
            return { role: m.role, content: m.content || '', images: m.images || [] };
          }),
          footer: 'ClassIntra · AI 对话导出 · ' + new Date().toLocaleString('zh-CN', { hour12: false })
        };
        return renderConversationLongImage(payload);
      }).then(function(result) {
        var safeName = (self.currentTitle || 'AI 对话').replace(/[\\/:*?"<>|]/g, '_').substring(0, 40);
        var d = new Date();
        var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
          '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
        var fd = new FormData();
        fd.append('file', result.blob, safeName + '_' + stamp + '.png');
        fd.append('folder', 'AI 对话导出');
        fd.append('source', 'app');
        return api.post('/cloud/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 120000
        }).then(function(resp) {
          var data = (resp.data && resp.data.data) || {};
          self.$store.commit('toast/SHOW_TOAST', {
            message: '长图已存入云盘「AI 对话导出」' + (result.omitted ? '（最旧 ' + result.omitted + ' 条已省略）' : ''),
            type: 'success'
          });
          self.lastExportHash = data.hash || '';
        });
      }).catch(function(err) {
        console.error('[AI] 长图导出失败:', err);
        self.$store.commit('toast/SHOW_TOAST', {
          message: '长图生成失败：' + ((err && err.message) || '请稍后重试'),
          type: 'error'
        });
      }).finally(function() {
        self.exportingImage = false;
      });
    },

    selectConversation: function(id) {
      var self = this;
      if (self.currentConvId === id) return;
      // ⚠️ 不再打断正在生成的会话 —— 那是「多任务」的核心：
      // 后台的流继续写它自己的消息对象，切回来就能看到进度
      self.currentConvId = id;
      // 换会话：重置分段渲染，镜像字段对齐到新会话的流状态
      self.renderLimit = 40;
      self.streamChars = 0;
      self.streamStartedAt = 0;
      self.streamFirstTokenAt = 0;
      self.pendingImages = [];
      self.applyStreamMirror(id);
      localStorage.setItem('ai_last_conv_id', id);
      self.loadContext();
      var conv = self.conversations.find(function(c) { return c.id === id; });
      if (conv) {
        self.convPersona = conv.persona || '';
      }
      if (conv && !conv.loaded) {
        self.loadingMessages = true;
        api.get('/ai-chat/conversations/' + id).then(function(response) {
          var rawMessages = response.data.data.messages || [];
          var serverList = rawMessages.map(function(m) {
            var msg = {
              _key: nextMsgKey(),
              id: m.id || nextMsgKey(),
              role: m.role,
              content: m.content,
              error: null
            };
            if (m.images && m.images.length) {
              msg.images = m.images;
            }
            if (m.reasoning) {
              msg.reasoning = m.reasoning;
              msg._showReasoning = false;
            }
            return msg;
          });
          // ⚠️ 竞态保护：这个请求在飞的时候，用户可能已经发消息了（本地 push 进 conv.messages）。
          // 一刀切覆盖会把那条消息和正在生成的回复从界面上抹掉（服务端其实已收到）。
          // 所以：服务端列表 + 本地新增的、服务端还没有的消息（按 角色+内容前缀 去重）。
          var sig = function(m) { return m.role + '|' + String(m.content || '').substring(0, 80); };
          var seen = {};
          serverList.forEach(function(m) { seen[sig(m)] = true; });
          var localPending = (conv.messages || []).filter(function(m) {
            return m._local && !seen[sig(m)];
          });
          conv.messages = serverList.concat(localPending);
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
      if (self.isStreaming) return;
      var question = self.inputText.trim();
      var images = self.pendingImages.slice();
      if (!question && images.length === 0) return;
      if (question.length > self.maxChars) {
        self.$store.commit('toast/SHOW_TOAST', { message: '消息长度超过限制（最大' + self.maxChars + '字符）', type: 'warning' });
        return;
      }
      // 只发图不打字：给一句中性的引导语，避免模型在没有指令时瞎发挥
      if (!question) question = '请看看这张图片，说说你看到了什么。';

      self.inputText = '';

      if (!self.currentConvId) {
        api.post('/ai-chat/conversations', { title: '新对话' }).then(function(response) {
          var conv = Object.assign({}, response.data.data, { messages: [], loaded: true, persona: '' });
          self.conversations.unshift(conv);
          self.currentConvId = conv.id;
          self.$nextTick(function() {
            self.doSendMessage(question, images);
          });
        }).catch(function() {
          self.inputText = question;
          self.$store.commit('toast/SHOW_TOAST', { message: '创建对话失败', type: 'error' });
        });
        return;
      }

      self.doSendMessage(question, images);
    },
    doSendMessage: function(question, images) {
      var self = this;
      var convId = self.currentConvId;
      var conv = self.conversations.find(function(c) { return c.id === convId; });
      if (!conv) return;
      if (self.streamStates[convId]) {
        self.$store.commit('toast/SHOW_TOAST', { message: '这个对话正在生成，等它说完或先停止', type: 'info' });
        return;
      }
      images = images || [];
      self.pendingImages = [];

      var userMsg = {
        _key: nextMsgKey(),
        id: Date.now().toString(),
        role: 'user',
        content: question,
        error: null,
        _local: true          // 标记：本地先行的消息，等历史加载回来时别把它覆盖掉
      };
      if (images.length) userMsg.images = images;
      conv.messages.push(userMsg);

      var aiMsg = {
        _key: nextMsgKey(),
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        error: null,
        _local: true
      };
      var isThinking = self.thinkingMode && self.currentModelInfo.supports_thinking;
      if (isThinking) {
        aiMsg.reasoning = '';
        aiMsg._showReasoning = false;
      }
      conv.messages.push(aiMsg);

      // ======== 按会话隔离的流式状态 ========
      // 一切运行期状态都挂在这个对象上，切到别的会话不打断本次生成；
      // data 里的 isStreaming / sseBuffer / isSearching 等只是「当前正看着的会话」的镜像。
      var st = {
        convId: convId,
        conv: conv,
        question: question,
        aiMsg: aiMsg,
        thinking: isThinking,
        startedAt: Date.now(),
        firstTokenAt: 0,
        chars: 0,
        pending: '',
        replace: false,
        rafId: 0,
        sseBuffer: '',
        searching: false,
        searchQuery: '',
        abortController: null,
        timeoutId: null,
        finished: false
      };
      self.$set(self.streamStates, convId, st);
      self.applyStreamMirror(convId);

      // 渲染窗口跟着新消息一起放大，保证刚发出的消息一定在渲染范围内
      if (conv.messages.length > self.renderLimit) {
        self.renderLimit = conv.messages.length + 10;
      }

      self.$nextTick(function() {
        self.scrollToBottom();
        self.autoResize();
      });

      var token = self.$store.state.auth.token;
      st.abortController = new AbortController();

      st.timeoutId = setTimeout(function() {
        if (!self.streamStates[convId] || self.streamStates[convId] !== st) return;
        st.abortController.abort();
        self.flushStream(st);
        aiMsg.error = '请求超时，AI 服务响应时间过长';
        self.finishConvStream(st);
      }, 180000);

      fetch('/api/ai-chat/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          conversation_id: convId,
          message: question,
          system_prompt: self.customSystemPrompt || undefined,
          model: self.currentModel,
          thinking: st.thinking ? true : undefined,
          images: images.length ? images.map(function(im) { return { hash: im.hash }; }) : undefined
        }),
        signal: st.abortController.signal
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
          clearTimeout(st.timeoutId);
          self.flushStream(st);
          self.finishConvStream(st);
          self.$nextTick(function() {
            self.initCodeBlocks();
          });
        }

        function read() {
          reader.read().then(function(result) {
            if (result.done) {
              finishStream();
              self.updateConvTitle(st);
              return;
            }
            var text = decoder.decode(result.value, { stream: true });
            st.sseBuffer += text;
            var lines = st.sseBuffer.split('\n');
            st.sseBuffer = lines.pop();

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
                  self.updateConvTitle(st);
                  return;
                }
                if (parsed.fallback) {
                  self.fallbackNoticeText = (parsed.model_label || '备用模型') + ' 已接管本次回复（原模型暂时不可用）';
                  self.showFallbackNotice = true;
                  setTimeout(function() { self.showFallbackNotice = false; }, 8000);
                }
                if (parsed.searching !== undefined) {
                  st.searching = parsed.searching;
                  st.searchQuery = parsed.searching && parsed.query ? parsed.query : '';
                  self.applyStreamMirror(convId);
                }
                if (parsed.content) {
                  if (parsed.action === 'replace') {
                    st.pending = parsed.content;
                    st.replace = true;
                  } else {
                    st.pending += parsed.content;
                  }
                  if (!st.firstTokenAt) st.firstTokenAt = Date.now();
                  // 一个 chunk 一次 DOM 更新太贵：合并到每帧一次
                  self.scheduleStreamFlush(st);
                }
                if (parsed.reasoning && st.thinking) {
                  if (!aiMsg.reasoning) aiMsg.reasoning = '';
                  aiMsg.reasoning += parsed.reasoning;
                  if (convId === self.currentConvId) {
                    self.$nextTick(function() { self.scrollToBottom(); });
                  }
                }
              } catch (e) {}
            }
            if (self.streamStates[convId] === st) {
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
        clearTimeout(st.timeoutId);
        if (err.name !== 'AbortError') {
          if (err.message.indexOf('Failed to fetch') > -1 || err.message.indexOf('NetworkError') > -1) {
            aiMsg.error = '网络连接失败，请检查网络后重试';
          } else {
            aiMsg.error = err.message || '请求发送失败';
          }
        }
        self.flushStream(st);
        self.finishConvStream(st);
      });
    },
    // 结束某个会话的流：清状态、若它正被看着就同步镜像
    finishConvStream: function(st) {
      var self = this;
      if (!st || self.streamStates[st.convId] !== st) return;
      self.$delete(self.streamStates, st.convId);
      self.applyStreamMirror(st.convId);
      // 后台跑完的那次回复，标题也要跟着长出来
      self.touchConvOrder(st.convId);
      if (self.ctxInfo && st.convId === self.currentConvId) {
        self.loadContext();
      }
    },
    // 把 data 里的镜像字段对齐到「当前正看着的会话」
    applyStreamMirror: function(convId) {
      var self = this;
      var st = self.streamStates[convId];
      var isCurrent = convId === self.currentConvId;
      self.isStreaming = isCurrent && !!st;
      self.isSearching = isCurrent && !!st && !!st.searching;
      self.searchQuery = isCurrent && st ? st.searchQuery : '';
      self.sseBuffer = '';
      self.streamingContent = st ? st.aiMsg.content : '';
      self.streamStartedAt = st ? st.startedAt : 0;
      self.streamFirstTokenAt = st ? st.firstTokenAt : 0;
      self.streamChars = st ? st.chars : 0;
    },
    // 把攒下的流式增量真正写进消息（每帧最多一次，且只影响自己那条消息）
    scheduleStreamFlush: function(st) {
      var self = this;
      if (!st || st.rafId) return;
      var raf = window.requestAnimationFrame || function(cb) { return setTimeout(cb, 60); };
      st.rafId = raf(function() {
        st.rafId = 0;
        self.flushStream(st);
        if (st.convId === self.currentConvId) {
          self.$nextTick(function() { self.scrollToBottom(); });
        }
      });
    },
    flushStream: function(st) {
      var self = this;
      if (!st) return;
      var aiMsg = st.aiMsg;
      if (st.replace) {
        aiMsg.content = st.pending;
        st.replace = false;
      } else if (st.pending) {
        aiMsg.content += st.pending;
      }
      if (st.pending) {
        st.chars = aiMsg.content.length;
        if (st.convId === self.currentConvId) {
          self.streamingContent = aiMsg.content;
          self.streamChars = st.chars;
        }
      }
      st.pending = '';
    },
    // 用流结束的「那个会话」更新标题与排序（并行生成时它可能不是当前会话）
    updateConvTitle: function(st) {
      var self = this;
      var question = st && st.question;
      var conv = st && st.conv ? st.conv : self.conversations.find(function(c) { return c.id === self.currentConvId; });
      if (conv) {
        if (conv.title === '新对话') {
          conv.title = String(question || '新对话').substring(0, 30);
        }
        conv.updated_at = new Date().toISOString();
      }
      self.touchConvOrder(st && st.convId);
    },
    // 会话有新动静 → 挪到列表最前（仅当不在置顶集合里）
    touchConvOrder: function(convId) {
      var self = this;
      if (!convId) return;
      var conv = self.conversations.find(function(c) { return c.id === convId; });
      if (!conv) return;
      var idx = self.conversations.indexOf(conv);
      if (idx > 0) {
        self.conversations.splice(idx, 1);
        self.conversations.unshift(conv);
      }
    },
    retryMessage: function(msg) {
      var self = this;
      var conv = self.conversations.find(function(c) { return c.id === self.currentConvId; });
      if (!conv) return;
      // 正在生成时不允许重试：先删后发会把半截对话弄丢
      if (self.streamStates[self.currentConvId]) {
        self.$store.commit('toast/SHOW_TOAST', { message: '正在生成中，先停止再重试', type: 'info' });
        return;
      }

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
    // 停止「当前正在看的会话」的生成；当前没有在生成的就全停
    stopGeneration: function() {
      var self = this;
      var targetId = self.currentConvId;
      var st = self.streamStates[targetId];
      if (!st) {
        Object.keys(self.streamStates).forEach(function(id) {
          self.abortConvStream(self.streamStates[id]);
        });
        self.$store.commit('toast/SHOW_TOAST', { message: '已停止所有生成', type: 'info' });
        return;
      }
      self.abortConvStream(st);
      self.$store.commit('toast/SHOW_TOAST', { message: '已停止生成', type: 'info' });
    },
    abortConvStream: function(st) {
      var self = this;
      if (!st) return;
      if (st.abortController) {
        try { st.abortController.abort(); } catch (e) {}
      }
      if (st.rafId && window.cancelAnimationFrame) {
        try { window.cancelAnimationFrame(st.rafId); } catch (e) {}
      }
      // 半截内容也要落地，否则界面上凭空少一段
      self.flushStream(st);
      if (st.timeoutId) clearTimeout(st.timeoutId);
      self.finishConvStream(st);
    },
    stopAllStreams: function() {
      var self = this;
      Object.keys(self.streamStates).forEach(function(id) {
        self.abortConvStream(self.streamStates[id]);
      });
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
      // 长会话里列表每次重渲染都要重算所有 v-html，缓存能省掉绝大部分 marked/KaTeX 开销
      var html = markdownCached(content, function(raw) {
        var result = LatexRenderer.processContent(raw, marked);
        result.html = DOMPurify.sanitize(result.html);
        return LatexRenderer.renderFinalHtml(result.html, result.placeholders);
      });
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
        title: title,
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
    goAdminPage: function() {
      var self = this;
      self.showModelPanel = false;
      self.$router.push('/admin');
    },
    switchModel: function(modelId) {
      var self = this;
      if (modelId === self.currentModel) {
        self.showModelPanel = false;
        return;
      }
      self.currentModel = modelId;
      self.showModelPanel = false;
      // 新模型不支持思考时关闭思考模式
      if (self.thinkingMode && !self.currentModelInfo.supports_thinking) {
        self.thinkingMode = false;
      }
      api.put('/ai-chat/settings', { model: modelId }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '模型偏好保存失败，本次会话仍生效', type: 'info' });
      });
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
      var title = 'AI对话记录（' + messages.length + '条）';
      var content = '> 以下内容来自AI对话\n\n';
      for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var roleLabel = msg.role === 'user' ? '**用户：**' : '**AI：**';
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
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
  background: none;
  border: none;
  cursor: pointer;
}

.nav-action-btn:hover {
  background: rgba(var(--primary-rgb), 0.08);
}

.nav-action-btn:active {
  transform: scale(0.94);
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
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
  font-size: var(--font-size-sm);
}

.sidebar-header-btn:hover {
  background: var(--bg-color);
  color: var(--danger-color);
}

.sidebar-header-btn:active {
  transform: scale(0.94);
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
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}
.panel-close:active { transform: scale(0.94); opacity: 0.7; }

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
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}
.btn-reset:active { transform: scale(0.94); opacity: 0.7; }

.btn-save-prompt {
  padding: 8px 16px; min-height: 44px; border-radius: var(--radius-sm); border: none;
  background: var(--primary-color); color: #fff; font-size: var(--font-size-sm); font-weight: 600; cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}
.btn-save-prompt:active { transform: scale(0.94); opacity: 0.7; }

.user-markdown >>> .inline-code {
  background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: var(--radius-xs);
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace; font-size: 0.9em;
}

.aichat-sidebar {
  flex-shrink: 0;
  /* 规范例外：侧栏收起展开，宽度即语义；scaleX 会压扁内部文字（§5.5.2 形状形变豁免） */
  transition: width var(--duration-slow) var(--ease-standard), opacity var(--duration-slow) var(--ease-standard), transform var(--duration-slow) var(--ease-standard);
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
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
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
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
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
  transition: opacity var(--duration-fast) var(--ease-standard);
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
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
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
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.sidebar-toggle:hover {
  background: var(--bg-color);
}

.sidebar-toggle:active {
  transform: scale(0.94);
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

/* ===== 统一模型选择器 ===== */
.model-picker {
  display: flex;
  align-items: center;
  gap: 6px;
}

.model-picker-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  background: var(--bg-color);
  color: var(--text-primary);
  font-size: var(--font-size-caption);
  font-weight: 600;
  cursor: pointer;
  max-width: 160px;
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
}

.model-picker-btn:hover {
  border-color: var(--primary-color);
  background: rgba(var(--primary-rgb), 0.05);
}

.model-picker-btn:active {
  transform: scale(0.97);
}

.model-picker-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-picker-chevron {
  font-size: 9px;
  color: var(--text-tertiary);
}

.model-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
  display: inline-block;
}

.model-dot-lg {
  width: 12px;
  height: 12px;
}

.model-think-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 9px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  background: var(--bg-color);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
}

.model-think-btn:hover {
  border-color: var(--warning-color);
  color: var(--warning-color);
}

.model-think-btn.active {
  background: var(--warning-color);
  border-color: var(--warning-color);
  color: #fff;
}

/* ===== 模型选择面板 ===== */
.model-panel {
  background: var(--bg-color);
  border-radius: var(--radius-lg);
  width: min(400px, calc(100vw - 32px));
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.12));
}

.model-policy-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 12px 0;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  background: rgba(var(--primary-rgb), 0.05);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

.model-policy-hint i {
  color: var(--primary-color);
  font-size: 11px;
}

.model-list {
  padding: 8px 12px 12px;
  overflow-y: auto;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
}

.model-item:hover {
  background: rgba(var(--primary-rgb), 0.05);
}

.model-item.active {
  background: rgba(var(--primary-rgb), 0.08);
}

.model-item-info {
  flex: 1;
  min-width: 0;
}

.model-item-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.model-item-caps {
  display: flex;
  gap: 10px;
  margin-top: 3px;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.model-item-caps i {
  font-size: 10px;
  margin-right: 2px;
}

.model-item-check {
  color: var(--primary-color);
  font-size: 14px;
}

.model-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
  flex-shrink: 0;
}

.model-tag-default {
  background: rgba(var(--primary-rgb), 0.12);
  color: var(--primary-color);
}

.model-tag-free {
  background: rgba(16, 185, 129, 0.12);
  color: var(--success-color);
}

.model-tag-off {
  background: rgba(148, 163, 184, 0.15);
  color: var(--text-tertiary);
}

.model-panel-footer {
  border-top: 1px solid var(--border-color);
  padding: 6px 12px;
}

.model-admin-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
}

.model-admin-entry:hover {
  background: rgba(var(--primary-rgb), 0.05);
  color: var(--primary-color);
}

.model-admin-arrow {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-tertiary);
}

.admin-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

.admin-empty i {
  font-size: 24px;
  opacity: 0.5;
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
  transition: transform var(--duration-normal) var(--ease-standard);
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
  background: var(--warning-color);
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
  transition: background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}

.header-btn:hover {
  background: var(--bg-color);
  color: var(--danger-color);
  border-color: var(--danger-color);
}

.header-btn:active {
  transform: scale(0.94);
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
  background: var(--danger-color);
}

.stop-btn:active {
  transform: scale(0.94);
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
  transition: background-color var(--duration-normal) var(--ease-standard), border-color var(--duration-normal) var(--ease-standard), color var(--duration-normal) var(--ease-standard), transform var(--duration-normal) var(--ease-standard), opacity var(--duration-normal) var(--ease-standard), box-shadow var(--duration-normal) var(--ease-standard);
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
  transition: background var(--duration-normal) var(--ease-standard);
}

.retry-btn:hover {
  background: var(--danger-color);
}

.msg-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
  opacity: 0;
  transition: opacity var(--duration-normal) var(--ease-standard);
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
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
}

.msg-action-btn:hover {
  background: var(--bg-color);
  color: var(--primary-color);
}

.msg-action-btn:active {
  transform: scale(0.94);
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
  transition: background-color var(--duration-normal) var(--ease-standard), border-color var(--duration-normal) var(--ease-standard), color var(--duration-normal) var(--ease-standard), transform var(--duration-normal) var(--ease-standard), opacity var(--duration-normal) var(--ease-standard), box-shadow var(--duration-normal) var(--ease-standard);
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
  transition: border-color var(--duration-normal) var(--ease-standard);
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
  transition: background var(--duration-normal) var(--ease-standard), opacity var(--duration-normal) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
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
  transform: scale(0.94);
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
  transition: background-color var(--duration-normal) var(--ease-standard), border-color var(--duration-normal) var(--ease-standard), color var(--duration-normal) var(--ease-standard), transform var(--duration-normal) var(--ease-standard), opacity var(--duration-normal) var(--ease-standard), box-shadow var(--duration-normal) var(--ease-standard);
  border: none;
}

.confirm-btn:active {
  transform: scale(0.94);
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
  background: var(--danger-color);
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
  transition: background-color var(--duration-normal) var(--ease-standard), border-color var(--duration-normal) var(--ease-standard), color var(--duration-normal) var(--ease-standard), transform var(--duration-normal) var(--ease-standard), opacity var(--duration-normal) var(--ease-standard), box-shadow var(--duration-normal) var(--ease-standard);
  font-size: var(--font-size-sm);
}

.header-icon-btn:hover {
  background: var(--bg-color);
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.header-icon-btn:active {
  transform: scale(0.94);
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
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
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
  transition: border-color var(--duration-normal) var(--ease-standard);
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
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
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
  background: rgba(var(--warning-rgb), 0.08);
  border: 1px solid rgba(var(--warning-rgb), 0.35);
  border-radius: var(--radius-md);
  color: var(--warning-color);
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
  color: var(--warning-color);
  font-size: var(--font-size-sm);
  flex-shrink: 0;
  transition: background var(--duration-fast) var(--ease-standard);
}

.fallback-notice-close:hover {
  background: rgba(245, 158, 11, 0.15);
}

.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: background-color var(--duration-slow) var(--ease-standard), border-color var(--duration-slow) var(--ease-standard), color var(--duration-slow) var(--ease-standard), transform var(--duration-slow) var(--ease-standard), opacity var(--duration-slow) var(--ease-standard), box-shadow var(--duration-slow) var(--ease-standard);
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
  .model-picker-label {
    max-width: 72px;
  }
  .model-think-btn span {
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
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
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
  color: var(--text-secondary, #999);
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
  color: var(--text-primary, #000);
  cursor: pointer;
}
.forward-option:active { background: var(--bg-color, #f5f5f5); }
.forward-option i { width: 24px; text-align: center; color: var(--text-secondary, #999); }
.forward-cancel {
  width: 100%;
  padding: 16px;
  margin-top: 8px;
  background: none;
  border: none;
  border-top: 0.5px solid var(--separator-color, #e5e5ea);
  font-size: 16px;
  color: var(--text-primary, #000);
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
  border-radius: var(--radius-lg);
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
  color: var(--text-primary, #000);
}
.viewer-close {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--text-secondary, #999);
  cursor: pointer;
  padding: 4px 8px;
}
.viewer-body {
  padding: 20px;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary, #000);
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
  transition: background var(--duration-fast) var(--ease-standard);
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
  transition: background-color var(--duration-normal) var(--ease-standard), border-color var(--duration-normal) var(--ease-standard), color var(--duration-normal) var(--ease-standard), transform var(--duration-normal) var(--ease-standard), opacity var(--duration-normal) var(--ease-standard), box-shadow var(--duration-normal) var(--ease-standard);
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
  color: var(--text-primary, #000);
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
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
  color: var(--text-secondary, #999);
}

.batch-count {
  flex: 1;
  text-align: center;
  font-size: var(--font-size-caption1, 13px);
  color: var(--text-secondary, #999);
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

/* 会话列表骨架屏：复用全局 .skeleton 微光，补排布尺寸 */
.sidebar-loading { padding: 8px 10px; }

.conv-skeleton {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}

.skeleton-avatar-sm {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  flex-shrink: 0;
}

.skeleton-lines {
  flex: 1;
  min-width: 0;
}

.skeleton-line-60 { height: 14px; width: 60%; border-radius: var(--radius-sm); margin-bottom: 8px; }
.skeleton-line-80 { height: 12px; width: 80%; border-radius: var(--radius-sm); }

/* ====== 对话检索（服务端全文）====== */
.sidebar-search-spin {
  width: 13px; height: 13px; flex-shrink: 0;
  border-radius: 50%;
  border: 2px solid var(--separator-color);
  border-top-color: var(--accent-ai, #AF52DE);
  animation: conv-search-spin 0.8s linear infinite;
}
@keyframes conv-search-spin { to { transform: rotate(360deg); } }
.conv-search-meta {
  padding: 4px 14px 6px;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}
.conv-snippet {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-tertiary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ====== 上下文占用 pill ====== */
.ctx-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border: 1px solid var(--separator-color);
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ctx-pill:active { transform: scale(0.96); }
.ctx-pill-track {
  display: block;
  width: 34px; height: 4px;
  border-radius: 2px;
  background: var(--fill-quaternary, rgba(120, 120, 128, 0.2));
  overflow: hidden;
}
.ctx-pill-track i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--text-tertiary);
  transition: width var(--duration-normal) var(--ease-standard, ease);
}
.ctx-pill-text { font-size: 11px; color: var(--text-secondary); }
.ctx-pill.ctx-ok .ctx-pill-track i { background: var(--success-color, #34C759); }
.ctx-pill.ctx-warn .ctx-pill-track i { background: var(--warning-color, #FF9500); }
.ctx-pill.ctx-warn .ctx-pill-text { color: var(--warning-color, #FF9500); }
.ctx-pill.ctx-danger .ctx-pill-track i { background: var(--danger-color, #FF3B30); }
.ctx-pill.ctx-danger .ctx-pill-text { color: var(--danger-color, #FF3B30); }

/* ====== 上下文与记忆面板 ====== */
.ctx-loading { padding: 30px 0; display: flex; justify-content: center; }
.ctx-error { padding: 14px 0; font-size: var(--font-size-caption); color: var(--danger-color, #FF3B30); text-align: center; }
.ctx-bar {
  height: 8px;
  border-radius: 4px;
  background: var(--fill-quaternary, rgba(120, 120, 128, 0.16));
  overflow: hidden;
  margin: 6px 0 8px;
}
.ctx-bar-fill { height: 100%; border-radius: 4px; background: var(--text-tertiary); transition: width var(--duration-normal) var(--ease-standard, ease); }
.ctx-bar-fill.ctx-ok { background: var(--success-color, #34C759); }
.ctx-bar-fill.ctx-warn { background: var(--warning-color, #FF9500); }
.ctx-bar-fill.ctx-danger { background: var(--danger-color, #FF3B30); }
.ctx-legend {
  display: flex; justify-content: space-between; gap: 8px;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  flex-wrap: wrap;
}
.ctx-breakdown { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; }
.ctx-item { display: flex; align-items: center; gap: 5px; font-size: var(--font-size-caption); color: var(--text-secondary); }
.ctx-item b { color: var(--text-primary); font-weight: 600; }
.ctx-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
.ctx-dot--sys { background: var(--text-tertiary); }
.ctx-dot--mem { background: var(--accent-ai, #AF52DE); }
.ctx-dot--his { background: var(--info-color, #007AFF); }
.ctx-updated { font-size: var(--font-size-caption); color: var(--text-tertiary); }
.ctx-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; flex-wrap: wrap; }
.ctx-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--separator-color);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ctx-btn:active { transform: scale(0.97); }
.ctx-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ctx-btn--primary { background: var(--accent-ai, #AF52DE); border-color: var(--accent-ai, #AF52DE); color: #fff; }

/* ======== 云盘选图（看图对话） ======== */
.attach-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 2px 8px;
}
.attach-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 22px 4px 4px;
  border-radius: 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--separator-color);
  max-width: 190px;
}
.attach-chip img {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  object-fit: cover;
  background: #000;
}
.attach-name {
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.attach-remove {
  position: absolute;
  right: 3px;
  top: 50%;
  transform: translateY(-50%);
  width: 17px;
  height: 17px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 9px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.attach-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  border: 1px solid var(--separator-color);
  background: transparent;
  color: var(--text-secondary);
  font-size: 17px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.attach-btn--active {
  color: var(--accent-ai, #AF52DE);
  border-color: var(--accent-ai, #AF52DE);
}
.attach-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* 用户消息里的图片附件 */
.msg-images { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.msg-image img {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--separator-color);
  display: block;
}

/* 流式状态（首字 / 字数 / 耗时） */
.stream-stat {
  margin-right: auto;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 长会话：加载更早消息 */
.load-earlier-row { display: flex; justify-content: center; padding: 10px 0 14px; }
.load-earlier-btn {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--separator-color);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.load-earlier-btn:active { transform: scale(0.97); }

/* ======== 多任务并发：后台生成标记 ======== */
.conv-streaming {
  display: inline-block;
  margin-left: 5px;
  font-size: 10px;
  color: var(--accent-ai, #AF52DE);
  vertical-align: middle;
}
.bg-stream-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--accent-ai, #AF52DE);
  color: var(--accent-ai, #AF52DE);
  font-size: var(--font-size-caption);
  white-space: nowrap;
}

/* ======== 额度（模型面板内）======== */
.wallet-line {
  border: 1px solid var(--separator-color);
  border-radius: var(--radius-sm);
  padding: 7px 9px;
  margin-bottom: 8px;
}
.wallet-line--warn { border-color: rgba(255, 149, 0, 0.6); }
.wallet-line--full { border-color: rgba(255, 59, 48, 0.65); }
.wallet-line-top {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--text-secondary);
}
.wallet-line-top b { margin-left: auto; font-variant-numeric: tabular-nums; }
.wallet-bar {
  height: 4px; border-radius: 2px; overflow: hidden;
  background: var(--fill-quaternary, rgba(120, 120, 128, 0.12));
  margin: 5px 0 3px;
}
.wallet-bar i { display: block; height: 100%; background: var(--accent-ai, #AF52DE); border-radius: 2px; }
.wallet-line--warn .wallet-bar i { background: #FF9500; }
.wallet-line--full .wallet-bar i { background: var(--danger-color, #FF3B30); }
.wallet-tip { font-size: 10px; color: var(--text-tertiary); }

</style>
