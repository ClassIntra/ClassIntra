<template>
  <div class="chat-bubble-wrapper">
    <div v-if="showUnreadDivider" class="unread-divider">
      <div class="unread-divider-line"></div>
      <span class="unread-divider-text">{{ unreadCount }} 条未读消息</span>
      <div class="unread-divider-line"></div>
    </div>
    <div v-if="showDateSeparator" class="date-separator">
      <div class="date-separator-line"></div>
      <span class="date-separator-text">{{ dateLabel }}</span>
      <div class="date-separator-line"></div>
    </div>
    <div
      v-if="message.type === 'system'"
      class="system-message"
    >{{ message.content }}</div>
    <div
      v-else
      class="chat-bubble"
      :class="{ 'own-bubble': isOwn, 'recalled-bubble': message.recalled === 1 }"
      @contextmenu.prevent="onContextMenu"
      @touchstart="onTouchStart"
      @touchend="onTouchEnd"
      @touchmove="onTouchMove"
    >
      <div v-if="!isOwn && message.recalled !== 1" class="bubble-sender">{{ message.sender_name }}<span v-if="senderRole === 'admin'" class="admin-badge-inline">管理</span><img v-if="showLevel && senderLevel >= 0" :src="'/resources/public/level/Lv' + senderLevel + '.svg'" class="level-icon-chat" /></div>
      <div v-if="message.recalled === 1" class="bubble-recalled">该消息已撤回</div>
      <div v-else-if="message.type === 'community_forward'" class="bubble-content bubble-forward" @click="onForwardClick">
        <div class="forward-label"><i class="fa-solid fa-share-from-square"></i> 社区帖子 · {{ forwardTypeLabel }}</div>
        <div class="forward-card">
          <div v-if="forwardData.title || forwardData.dish_name" class="forward-title">{{ forwardData.title || forwardData.dish_name }}</div>
          <div v-if="forwardData.canteen" class="forward-meta"><i class="fa-solid fa-utensils"></i> {{ forwardData.canteen }}{{ forwardData.window ? ' · ' + forwardData.window : '' }}</div>
          <div v-if="forwardData.location" class="forward-meta"><i class="fa-solid fa-location-dot"></i> {{ forwardData.location }}</div>
          <div class="forward-preview">{{ forwardPreviewText }}</div>
        </div>
        <div class="forward-action">点击查看详情 <i class="fa-solid fa-chevron-right"></i></div>
      </div>
      <div v-else-if="message.type === 'music_playlist'" class="bubble-content bubble-forward bubble-music" @click="onMusicPlaylistClick">
        <div class="forward-label"><i class="fa-solid fa-music"></i> 音乐歌单</div>
        <div class="forward-card forward-card-music">
          <div class="forward-music-icon"><i class="fa-solid fa-list"></i></div>
          <div class="forward-music-info">
            <div class="forward-title">{{ playlistData.playlistName || '歌单' }}</div>
            <div class="forward-meta"><i class="fa-solid fa-music"></i> {{ playlistData.songCount || 0 }} 首歌曲</div>
            <div v-if="playlistData.description" class="forward-preview">{{ playlistData.description.substring(0, 60) }}</div>
          </div>
        </div>
        <div class="forward-action">点击打开歌单 <i class="fa-solid fa-chevron-right"></i></div>
      </div>
      <div v-else-if="message.type === 'ai_forward'" class="bubble-content bubble-forward bubble-ai" @click="onAiForwardClick">
        <div class="forward-label"><i class="fa-solid fa-robot"></i> AI对话内容</div>
        <div class="forward-card forward-card-ai">
          <div class="forward-title">🤖 {{ aiForwardRoleLabel }}</div>
          <div class="forward-preview">{{ aiForwardPreviewText }}</div>
        </div>
        <div class="forward-action">点击查看全文 <i class="fa-solid fa-chevron-right"></i></div>
      </div>
      <div v-else-if="message.type === 'ai_batch'" class="bubble-content bubble-forward bubble-ai" @click="onAiBatchClick">
        <div class="forward-label"><i class="fa-solid fa-robot"></i> AI对话记录（{{ aiBatchCount }}条）</div>
        <div class="forward-card forward-card-ai">
          <div class="forward-title">🤖 对话记录</div>
          <div class="forward-preview">{{ aiBatchPreview }}</div>
        </div>
        <div class="forward-action">点击查看全文 <i class="fa-solid fa-chevron-right"></i></div>
      </div>
      <div v-else class="bubble-content">
        <div v-if="message.reply_to" class="reply-quote" @click="onReplyQuoteClick">
          <div class="reply-quote-name">{{ message.reply_to.user_name }}</div>
          <div class="reply-quote-preview">{{ message.reply_to.content_preview }}</div>
        </div>
        <span v-html="renderContent(message.content)" @click="onContentClick"></span>
      </div>
      <div v-if="message.reactions && hasReactions" class="bubble-reactions">
        <span
          v-for="reaction in reactionList"
          :key="reaction.emoji"
          class="reaction-badge"
          :class="{ 'reaction-own': reaction.hasOwn }"
          @click="onReactionClick(reaction.emoji)"
        >{{ reaction.emoji }} {{ reaction.count }}</span>
      </div>
      <div class="bubble-time-row">
        <span v-if="showTimestamp" class="bubble-time">{{ formatTime(message.created_at) }}</span>
        <span v-if="isOwn && status === 'sending'" class="status-icon status-sending">
          <i class="fa-solid fa-spinner fa-spin"></i>
        </span>
        <span v-else-if="isOwn && status === 'sent'" class="status-icon status-sent">
          <i class="fa-solid fa-check"></i>
        </span>
        <span v-else-if="isOwn && status === 'failed'" class="status-icon status-failed">
          <i class="fa-solid fa-exclamation"></i>
        </span>
        <span v-if="isOwn && isPrivate && message.recalled !== 1" class="read-receipt">
          <span v-if="isRead" class="read-receipt-read">&#10003;&#10003;</span>
          <span v-else class="read-receipt-unread">&#10003;</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script>
import RichTextRenderer from '@/utils/rich-text-renderer';
import AudioPlayerManager from '@/utils/audio-player-manager';

export default {
  name: 'ChatBubble',
  props: {
    message: {
      type: Object,
      required: true
    },
    isOwn: {
      type: Boolean,
      default: false
    },
    canRecall: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      default: 'sent'
    },
    showDateSeparator: {
      type: Boolean,
      default: false
    },
    dateLabel: {
      type: String,
      default: ''
    },
    searchTerm: {
      type: String,
      default: ''
    },
    isPrivate: {
      type: Boolean,
      default: false
    },
    isRead: {
      type: Boolean,
      default: false
    },
    showTimestamp: {
      type: Boolean,
      default: true
    },
    showUnreadDivider: {
      type: Boolean,
      default: false
    },
    unreadCount: {
      type: Number,
      default: 0
    },
    senderLevel: {
      type: Number,
      default: -1
    },
    showLevel: {
      type: Boolean,
      default: false
    },
    senderRole: {
      type: String,
      default: ''
    },
    senderTitle: {
      type: String,
      default: ''
    }
  },
  data: function() {
    return {
      showContextMenu: false,
      longPressTimer: null,
      longPressFired: false,
      longPressMediaUrl: null,
      longPressMediaType: null,
      audioManager: new AudioPlayerManager() // 语音条播放管理器
    };
  },
  computed: {
    forwardData: function() {
      if (this.message.type !== 'community_forward' && this.message.type !== 'music_playlist') return {};
      try {
        return JSON.parse(this.message.content);
      } catch (e) {
        return {};
      }
    },
    playlistData: function() {
      if (this.message.type !== 'music_playlist') return {};
      try {
        return JSON.parse(this.message.content);
      } catch (e) {
        return {};
      }
    },
    aiForwardData: function() {
      if (this.message.type !== 'ai_forward') return {};
      try {
        return JSON.parse(this.message.content);
      } catch (e) {
        return {};
      }
    },
    aiForwardRoleLabel: function() {
      return this.aiForwardData.role === 'user' ? '用户提问' : 'AI 回答';
    },
    aiForwardPreviewText: function() {
      var text = this.aiForwardData.content || '';
      if (!text) return '';
      // 去除 Markdown 标记符号，生成纯文本预览
      var plain = text.replace(/[#*`>\-\[\]()!]/g, '').replace(/\n+/g, ' ').trim();
      return plain.length > 50 ? plain.substring(0, 50) + '...' : plain;
    },
    aiBatchData: function() {
      if (this.message.type !== 'ai_batch') return {};
      try {
        return JSON.parse(this.message.content);
      } catch (e) {
        return {};
      }
    },
    aiBatchCount: function() {
      return (this.aiBatchData.messages || []).length;
    },
    aiBatchPreview: function() {
      var msgs = this.aiBatchData.messages || [];
      if (msgs.length === 0) return '';
      var first = msgs[0];
      var text = (first.content || '').replace(/[#*`>\-\[\]()!]/g, '').replace(/\n+/g, ' ').trim();
      return text.length > 50 ? text.substring(0, 50) + '...' : text;
    },
    forwardTypeLabel: function() {
      var t = this.forwardData.postType;
      if (t === 'food') return '美食推荐';
      if (t === 'hot') return '热事爆料';
      return '论坛帖子';
    },
    forwardPreviewText: function() {
      var text = this.forwardData.content || this.forwardData.reason || this.forwardData.detail || '';
      if (!text) return '';
      return text.length > 60 ? text.substring(0, 60) + '...' : text;
    },
    hasReactions: function() {
      var reactions = this.message.reactions;
      if (!reactions) return false;
      var keys = Object.keys(reactions);
      for (var i = 0; i < keys.length; i++) {
        if (reactions[keys[i]] && reactions[keys[i]].count > 0) {
          return true;
        }
      }
      return false;
    },
    reactionList: function() {
      var self = this;
      var reactions = self.message.reactions;
      if (!reactions) return [];
      var result = [];
      var keys = Object.keys(reactions);
      for (var i = 0; i < keys.length; i++) {
        var emoji = keys[i];
        var data = reactions[emoji];
        if (data && data.count > 0) {
          result.push({
            emoji: emoji,
            count: data.count,
            hasOwn: !!(data.users && data.users.indexOf(self.currentUserId) > -1)
          });
        }
      }
      return result;
    },
    currentUserId: function() {
      var user = this.$store && this.$store.state && this.$store.state.auth && this.$store.state.auth.user;
      return user ? user.user_id : '';
    }
  },
  mounted: function() {
    document.addEventListener('click', this.closeContextMenu);
    var self = this;
    this.$nextTick(function() {
      self.audioManager.initBars(self.$el);
    });
  },
  updated: function() {
    // v-html 重新渲染后，初始化新增的语音条
    var self = this;
    this.$nextTick(function() {
      self.audioManager.initBars(self.$el);
    });
  },
  beforeDestroy: function() {
    document.removeEventListener('click', this.closeContextMenu);
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.audioManager.cleanup();
  },
  methods: {
    onContentClick: function(e) {
      var target = e.target;
      // 语音条点击 → 切换播放（不触发全屏预览）
      var voiceBar = target.closest && target.closest('.msg-voice-bar');
      if (voiceBar) {
        e.preventDefault();
        e.stopPropagation();
        var voiceUrl = voiceBar.getAttribute('data-media-url');
        if (voiceUrl) {
          this.audioManager.togglePlay(voiceUrl, voiceBar);
        }
        return;
      }
      // 视频/图片媒体点击 → 全屏预览（向上查找 msg-media 包裹器）
      var mediaEl = target.closest ? target.closest('.msg-media') : null;
      if (!mediaEl && target.classList && target.classList.contains('msg-media')) {
        mediaEl = target;
      }
      if (mediaEl && !mediaEl.classList.contains('msg-voice-bar')) {
        e.preventDefault();
        e.stopPropagation();
        var mediaUrl = mediaEl.getAttribute('data-media-url');
        var mediaType = mediaEl.getAttribute('data-media-type') || 'image';
        if (mediaUrl) {
          this.$emit('preview-media', { url: mediaUrl, type: mediaType });
        }
        return;
      }
      // 处理链接点击
      if (target.tagName === 'A' && target.getAttribute('data-external') === 'true') {
        e.preventDefault();
        var href = target.getAttribute('href');
        if (href) {
          this.$router.push('/browser?url=' + encodeURIComponent(href));
        }
        return;
      }
    },
    onForwardClick: function() {
      if (this.forwardData.postId) {
        this.$router.push('/community?post=' + this.forwardData.postId);
      }
    },
    onMusicPlaylistClick: function() {
      var data = this.playlistData;
      if (data.playlistId) {
        this.$router.push('/music?playlist=' + data.playlistId);
      }
    },
    onAiForwardClick: function() {
      var data = this.aiForwardData;
      if (data.content) {
        // 跳转到AI聊天页面查看完整内容
        this.$router.push('/ai-chat?view=' + encodeURIComponent(data.content));
      }
    },
    onAiBatchClick: function() {
      var data = this.aiBatchData;
      if (data.messages && data.messages.length) {
        this.$router.push('/ai-chat?viewBatch=' + encodeURIComponent(JSON.stringify(data.messages)));
      }
    },
    formatTime: function(timestamp) {
      if (!timestamp) return '';
      var timeStr = String(timestamp);
      if (timeStr.indexOf('T') === -1) { timeStr = timeStr.replace(' ', 'T'); }
      if (timeStr.indexOf('Z') === -1 && timeStr.indexOf('+') === -1) { timeStr = timeStr + 'Z'; }
      var date = new Date(timeStr);
      if (isNaN(date.getTime())) return '';
      var now = new Date();
      var diff = now.getTime() - date.getTime();
      if (diff < 0) diff = 0;
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var yesterday = new Date(today.getTime() - 86400000);
      var dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      var hours = date.getHours().toString().padStart(2, '0');
      var minutes = date.getMinutes().toString().padStart(2, '0');
      var timeDisplay = hours + ':' + minutes;

      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
      if (dateDay.getTime() === today.getTime()) return timeDisplay;
      if (dateDay.getTime() === yesterday.getTime()) return '昨天 ' + timeDisplay;
      var month = (date.getMonth() + 1).toString().padStart(2, '0');
      var day = date.getDate().toString().padStart(2, '0');
      return month + '/' + day + ' ' + timeDisplay;
    },
    highlightContent: function(content) {
      if (!this.searchTerm || !content) return content;
      var htmlEscaped = RichTextRenderer.escapeHtml(content);
      return RichTextRenderer.applyHighlight(htmlEscaped, this.searchTerm);
    },
    renderContent: function(content) {
      return RichTextRenderer.renderRichText(content, {
        highlightTerm: this.searchTerm
      });
    },
    onContextMenu: function(e) {
      if (this.message.recalled === 1) return;
      this.$emit('context-menu', this.message, e);
    },
    onTouchStart: function(e) {
      var self = this;
      self.longPressFired = false;
      self.longPressMediaUrl = null;
      self.longPressMediaType = null;

      // 检测触摸点是否在媒体元素上（图片/视频/音频/照片徽章）
      var touch = e.touches[0];
      var target = document.elementFromPoint(touch.clientX, touch.clientY);

      self.longPressMediaUrl = null;
      self.longPressMediaType = null;
      while (target && target !== self.$el) {
        if (target.classList && target.classList.contains('photo-badge')) {
          self.longPressMediaUrl = target.getAttribute('data-media-url') || target.getAttribute('data-image-url');
          self.longPressMediaType = 'image';
          break;
        }
        if (target.classList && target.classList.contains('msg-media')) {
          self.longPressMediaUrl = target.getAttribute('data-media-url');
          self.longPressMediaType = target.getAttribute('data-media-type') || 'image';
          break;
        }
        target = target.parentNode;
      }

      self.longPressTimer = setTimeout(function() {
        self.longPressFired = true;
        // 长按统一触发 context-menu，附带媒体 URL（如有）
        self.$emit('context-menu', self.message, {
          clientX: touch.clientX,
          clientY: touch.clientY,
          preventDefault: function() {},
          imageUrl: self.longPressMediaUrl,
          mediaType: self.longPressMediaType
        });
      }, 600);
    },
    onTouchEnd: function() {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
    },
    onTouchMove: function() {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
    },
    closeContextMenu: function() {
      this.showContextMenu = false;
    },
    onReplyQuoteClick: function() {
      var replyTo = this.message.reply_to;
      if (replyTo && replyTo.message_id) {
        this.$emit('scroll-to', replyTo.message_id);
      }
    },
    onReactionClick: function(emoji) {
      this.$emit('toggle-reaction', this.message, emoji);
    }
  }
};
</script>

<style scoped>
.chat-bubble-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.date-separator {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0 12px;
  padding: 0 8px;
}

.date-separator-line {
  flex: 1;
  height: 1px;
  background: var(--border-color);
}

.date-separator-text {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
}

.system-message {
  text-align: center;
  font-size: 13px;
  font-style: italic;
  color: var(--text-tertiary);
  padding: 8px 0;
  margin: 4px 0;
}

.chat-bubble {
  max-width: 65%;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  position: relative;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.chat-bubble.own-bubble {
  align-self: flex-end;
  align-items: flex-end;
}

.chat-bubble:not(.own-bubble) {
  align-self: flex-start;
  align-items: flex-start;
}

.bubble-sender {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  padding-left: 4px;
}

.level-icon-chat {
  height: 14px;
  width: auto;
  vertical-align: middle;
  margin-left: 4px;
}

.admin-badge-inline {
  display: inline-block;
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: #fff;
  font-size: 10px;
  padding: 0 5px;
  border-radius: var(--radius-sm);
  margin-left: 4px;
  vertical-align: middle;
  font-weight: 600;
  line-height: 16px;
}

.bubble-content {
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  font-size: 15px;
  line-height: 1.5;
  word-break: break-word;
}

.own-bubble .bubble-content {
  background: var(--primary-color);
  color: #fff;
  border-bottom-right-radius: 6px;
}

.chat-bubble:not(.own-bubble) .bubble-content {
  background: var(--card-bg);
  color: var(--text-primary);
  border-bottom-left-radius: 6px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.bubble-forward {
  cursor: pointer;
  min-width: 200px;
  max-width: 300px;
  padding: 10px 14px;
}

.bubble-forward:hover {
  opacity: 0.9;
}

.forward-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.forward-card {
  border-left: 3px solid var(--primary-color);
  padding: 6px 10px;
  margin-bottom: 8px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 0 6px 6px 0;
}
/* 深色模式下对方气泡(深灰底)用半透明白，避免与气泡融为一片 */
[data-theme="dark"] .forward-card {
  background: rgba(255, 255, 255, 0.06);
}

.own-bubble .forward-card {
  background: rgba(255, 255, 255, 0.1);
  border-left-color: rgba(255, 255, 255, 0.6);
}

.forward-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--text-primary);
}

.forward-meta {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 3px;
}

.forward-meta i {
  margin-right: 4px;
  font-size: 11px;
}

.forward-preview {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
}

.forward-action {
  font-size: 12px;
  color: var(--primary-color);
  display: flex;
  align-items: center;
  gap: 4px;
}

.own-bubble .forward-label {
  color: rgba(255, 255, 255, 0.7);
}

.own-bubble .forward-title {
  color: #fff;
}

.own-bubble .forward-meta {
  color: rgba(255, 255, 255, 0.7);
}

.own-bubble .forward-preview {
  color: rgba(255, 255, 255, 0.6);
}

.own-bubble .forward-action {
  color: rgba(255, 255, 255, 0.8);
}

.forward-card-music {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.forward-music-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--primary-color), var(--accent-ai));
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  flex-shrink: 0;
}

.forward-music-info {
  flex: 1;
  min-width: 0;
}

.bubble-music .forward-label {
  color: var(--accent-ai);
}

.own-bubble .bubble-music .forward-label {
  color: rgba(255, 255, 255, 0.7);
}

.forward-music-icon i {
  display: block;
}

/* AI forward card */
.bubble-ai .forward-label {
  color: var(--accent-ai, #007aff);
}

.own-bubble .bubble-ai .forward-label {
  color: rgba(255, 255, 255, 0.7);
}

.forward-card-ai {
  border-left-color: var(--accent-ai, #007aff);
}

.own-bubble .forward-card-ai {
  border-left-color: rgba(255, 255, 255, 0.6);
}

/* Reply quote */
.reply-quote {
  background: rgba(0, 0, 0, 0.06);
  border-left: 3px solid var(--primary-color);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
/* 深色模式下对方气泡引用块用半透明白 */
[data-theme="dark"] .reply-quote {
  background: rgba(255, 255, 255, 0.08);
}

.own-bubble .reply-quote {
  background: rgba(255, 255, 255, 0.15);
  border-left-color: rgba(255, 255, 255, 0.6);
}

.reply-quote:hover {
  background: rgba(0, 0, 0, 0.1);
}
[data-theme="dark"] .reply-quote:hover {
  background: rgba(255, 255, 255, 0.14);
}

.own-bubble .reply-quote:hover {
  background: rgba(255, 255, 255, 0.22);
}

.reply-quote-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary-color);
  margin-bottom: 2px;
}

.own-bubble .reply-quote-name {
  color: rgba(255, 255, 255, 0.9);
}

.reply-quote-preview {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.own-bubble .reply-quote-preview {
  color: rgba(255, 255, 255, 0.7);
}

/* Reactions */
.bubble-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
  padding: 0 4px;
}

.reaction-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: var(--radius-md);
  font-size: 13px;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  -webkit-user-select: none;
  user-select: none;
}

.reaction-badge:hover {
  background: var(--border-color);
}

.reaction-badge.reaction-own {
  background: var(--primary-light);
  border-color: var(--primary-color);
}

.bubble-time-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  padding: 0 4px;
}

.bubble-time {
  font-size: 11px;
  color: var(--text-secondary);
}

.status-icon {
  font-size: 11px;
  display: inline-flex;
  align-items: center;
}

.status-sending {
  color: var(--text-tertiary);
}

.status-sent {
  color: var(--primary-color);
}

.status-failed {
  color: var(--danger-color);
}

/* Read receipt */
.read-receipt {
  font-size: 11px;
  margin-left: 2px;
}

.read-receipt-read {
  color: var(--primary-color);
  font-weight: 600;
}

.read-receipt-unread {
  color: var(--text-tertiary);
}

.chat-bubble >>> .search-highlight {
  background: rgba(255, 213, 0, 0.4);
  color: inherit;
  padding: 0 1px;
  border-radius: 2px;
}

.chat-bubble >>> .msg-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}

.own-bubble >>> .msg-link {
  color: #fff;
}

/* Message image — 固定尺寸防止图片加载时布局重排导致滚动卡顿 */
.chat-bubble >>> .msg-image {
  width: 200px;
  height: 200px;
  border-radius: var(--radius-md);
  margin: 4px 0;
  display: block;
  cursor: pointer;
  object-fit: cover;
  background: var(--bg-color);
  will-change: transform;
}

.own-bubble >>> .msg-image {
  background: rgba(255, 255, 255, 0.1);
}

.chat-bubble:not(.own-bubble) >>> .msg-image {
  background: var(--bg-color);
}

/* Unread divider */
.unread-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
  padding: 0 8px;
}

.unread-divider-line {
  flex: 1;
  height: 1px;
  background: var(--danger-color);
  opacity: 0.4;
}

.unread-divider-text {
  font-size: 12px;
  color: var(--danger-color);
  white-space: nowrap;
  flex-shrink: 0;
  font-weight: 500;
}

.bubble-recalled {
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  font-style: italic;
  color: var(--text-tertiary);
  background: var(--bg-color);
}

.recalled-bubble.own-bubble .bubble-recalled {
  border-bottom-right-radius: 6px;
}

.recalled-bubble:not(.own-bubble) .bubble-recalled {
  border-bottom-left-radius: 6px;
}

.bubble-context-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  background: var(--card-bg);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  border: 1px solid var(--border-color);
  padding: 4px 0;
  z-index: 100;
  margin-bottom: 4px;
  min-width: 80px;
}

.context-menu-item {
  display: block;
  width: 100%;
  padding: 8px 16px;
  font-size: 14px;
  color: var(--danger-color);
  text-align: center;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.context-menu-item:hover {
  background: var(--bg-color);
}

.msg-image {
  display: block;
  max-width: 100%;
  max-height: 240px;
  border-radius: var(--radius-md);
  cursor: pointer;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
}

.msg-image:active {
  opacity: 0.85;
}

/* 视频/音频内联播放器 */
.chat-bubble >>> .msg-media-wrapper {
  position: relative;
  display: inline-block;
  max-width: 100%;
  cursor: pointer;
}

.chat-bubble >>> .msg-video-wrapper {
  width: 280px;
  max-width: 100%;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: #000;
}

.chat-bubble >>> .msg-video {
  display: block;
  width: 100%;
  max-height: 200px;
  border-radius: var(--radius-md);
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}

.chat-bubble >>> .msg-media-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.chat-bubble >>> .msg-media-play i {
  color: #fff;
  font-size: 14px;
  margin-left: 2px;
}

/* 语音条 UI（微信式） */
.chat-bubble >>> .msg-voice-bar {
  display: flex;
  align-items: center;
  min-width: 160px;
  max-width: 240px;
  height: 40px;
  padding: 0 12px;
  border-radius: 20px;
  background: var(--bg-elevated, #f5f5f7);
  cursor: pointer;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
}

/* 自己消息的语音条 */
.chat-bubble.own-bubble >>> .msg-voice-bar {
  background: rgba(255, 255, 255, 0.25);
}

.chat-bubble >>> .voice-play-btn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--primary-color, #007aff);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 10px;
}

.own-bubble >>> .voice-play-btn {
  background: rgba(255, 255, 255, 0.9);
}

.own-bubble >>> .voice-play-btn i {
  color: var(--primary-color, #007aff);
}

.chat-bubble >>> .voice-play-btn i {
  color: #fff;
  font-size: 11px;
  margin-left: 1px;
}

.chat-bubble >>> .voice-wave {
  flex: 1;
  position: relative;
  height: 24px;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.chat-bubble >>> .voice-wave-bars {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  height: 100%;
}

.chat-bubble >>> .voice-wave-bars span {
  flex: 1;
  height: 4px;
  min-width: 2px;
  max-width: 6px;
  border-radius: 2px;
  background: var(--text-color-secondary, rgba(0, 0, 0, 0.3));
  transition: background 0.15s;
}

.own-bubble >>> .voice-wave-bars span {
  background: rgba(255, 255, 255, 0.4);
}

.chat-bubble >>> .voice-wave-bars span.active {
  background: var(--primary-color, #007aff);
}

.own-bubble >>> .voice-wave-bars span.active {
  background: #fff;
}

.chat-bubble >>> .voice-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 0%;
  background: transparent;
  pointer-events: none;
}

.chat-bubble >>> .voice-duration {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-color-secondary, rgba(0, 0, 0, 0.5));
  margin-left: 8px;
  min-width: 28px;
  text-align: right;
}

.own-bubble >>> .voice-duration {
  color: rgba(255, 255, 255, 0.8);
}

.chat-bubble >>> .msg-media {
  cursor: pointer;
}
</style>
