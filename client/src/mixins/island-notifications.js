/**
 * Island 通知与 WebSocket 逻辑 Mixin
 *
 * 职责：
 * - WebSocket 事件监听注册/清理（13 类事件）
 * - 通知队列管理（入队/展示/消失/排队）
 * - 进度条与时间戳更新
 * - 通知历史记录与筛选
 * - 广播消息加载
 *
 * 依赖：vuex ($store), @/utils/websocket, @/utils/api
 * 注入到：SuperIsland.vue
 */
import wsManager from '@/utils/websocket';
import api from '@/utils/api';

var NOTIFICATION_DURATION = 3000;
var PROGRESS_INTERVAL = 30;

export default {
  data: function() {
    return {
      // 通知状态
      notification: null,
      notificationPriority: 'normal',
      notificationAppearTime: null,
      notificationTimestamp: '',
      timestampTimer: null,
      broadcastText: '',
      latestBroadcast: null,
      collapseTimer: null,
      notificationQueue: [],
      queueTimer: null,
      wsListeners: {},
      progressWidth: 100,
      progressTimer: null,
      // 历史记录
      notificationHistory: [],
      historyFilter: 'all',
      // 在线用户
      onlineUserCount: 0
    };
  },

  computed: {
    queueCount: function() {
      return this.notificationQueue.length;
    },
    notifIconStyle: function() {
      if (!this.notification || !this.notification.color) return {};
      return { background: this.notification.color };
    },
    notifIconClasses: function() {
      return {
        'notif-icon-urgent': this.notificationPriority === 'urgent',
        'notif-icon-pulse': this.isBouncing
      };
    },
    queueBadgeStyle: function() {
      var color = '#3b82f6';
      if (this.notification) {
        if (this.notification.type === 'group_event') color = '#f59e0b';
        else if (this.notification.type === 'online') color = '#22c55e';
      }
      return { background: color };
    },
    progressBarStyle: function() {
      var color = '#3b82f6';
      if (this.notification) {
        if (this.notification.type === 'group_event') color = '#f59e0b';
        else if (this.notification.type === 'online') color = '#22c55e';
      }
      if (this.notificationPriority === 'urgent') color = '#ef4444';
      else if (this.notificationPriority === 'low') color = '#9ca3af';
      return { transform: 'scaleX(' + (this.progressWidth / 100) + ')', background: color };
    },
    filteredHistory: function() {
      var self = this;
      if (self.historyFilter === 'all') return self.notificationHistory;
      return self.notificationHistory.filter(function(item) {
        return item.category === self.historyFilter;
      });
    }
  },

  methods: {
    loadBroadcasts: function() {
      var self = this;
      api.get('/assets/broadcasts').then(function(response) {
        var list = response.data.data || [];
        if (list.length > 0) {
          self.latestBroadcast = list[0];
          self.broadcastText = list[0].content;
        }
      }).catch(function() {});
    },

    connectWS: function() {
      var self = this;

      self.wsListeners['private_message'] = function(data) {
        if (!data.message) return;
        var chatId = data.from_user_id;
        if (self.currentRoute === '/chat' && self.currentChatId === chatId) return;
        var senderName = data.message.sender_name || '未知用户';
        var content = data.message.content || '';
        var truncated = content.length > 30 ? content.substring(0, 30) + '...' : content;
        self.enqueueNotification({
          icon: 'fa-solid fa-comment',
          color: 'rgba(59, 130, 246, 0.25)',
          title: senderName,
          text: truncated,
          route: '/chat',
          type: 'chat',
          category: 'chat',
          chatId: chatId,
          priority: 'normal'
        });
      };

      self.wsListeners['group_message'] = function(data) {
        var groupId = data.group_id;
        if (self.currentRoute === '/chat' && self.currentChatId === groupId) return;
        var senderName = (data.message && data.message.sender_name) || '未知用户';
        var content = (data.message && data.message.content) || '';
        var truncated = content.length > 30 ? content.substring(0, 30) + '...' : content;
        self.enqueueNotification({
          icon: 'fa-solid fa-users',
          color: 'rgba(59, 130, 246, 0.25)',
          title: senderName,
          text: truncated,
          route: '/chat',
          type: 'chat',
          category: 'chat',
          chatId: groupId,
          priority: 'normal'
        });
      };

      self.wsListeners['new_message'] = function(data) {
        if (!data.message) return;
        if (self.currentRoute === '/chat') return;
        var senderName = data.message.sender_name || '未知用户';
        var content = data.message.content || '';
        var truncated = content.length > 30 ? content.substring(0, 30) + '...' : content;
        self.enqueueNotification({
          icon: 'fa-solid fa-globe',
          color: 'rgba(59, 130, 246, 0.25)',
          title: senderName + ' (公共)',
          text: truncated,
          route: '/chat',
          type: 'chat',
          category: 'chat',
          chatId: 'public',
          priority: 'low'
        });
      };

      self.wsListeners['group_member_joined'] = function(data) {
        var userName = data.user_name || data.net_name || '新成员';
        self.enqueueNotification({
          icon: 'fa-solid fa-user-plus',
          color: 'rgba(245, 158, 11, 0.25)',
          title: '群成员变动',
          text: userName + ' 加入了群聊',
          route: '/chat',
          type: 'group_event',
          category: 'chat',
          priority: 'low'
        });
      };

      self.wsListeners['group_dissolved'] = function(data) {
        var groupName = data.group_name || '群聊';
        self.enqueueNotification({
          icon: 'fa-solid fa-circle-exclamation',
          color: 'rgba(245, 158, 11, 0.25)',
          title: '群聊已解散',
          text: groupName,
          route: '/chat',
          type: 'group_event',
          category: 'system',
          priority: 'urgent'
        });
      };

      self.wsListeners['group_transferred'] = function(data) {
        var newOwnerName = data.new_owner_name || data.net_name || '新群主';
        self.enqueueNotification({
          icon: 'fa-solid fa-right-left',
          color: 'rgba(245, 158, 11, 0.25)',
          title: '群主变更',
          text: newOwnerName + ' 成为新群主',
          route: '/chat',
          type: 'group_event',
          category: 'chat',
          priority: 'normal'
        });
      };

      self.wsListeners['group_announcement'] = function(data) {
        var announcement = data.announcement || '';
        var truncated = announcement.length > 30 ? announcement.substring(0, 30) + '...' : announcement;
        self.enqueueNotification({
          icon: 'fa-solid fa-bell',
          color: 'rgba(245, 158, 11, 0.25)',
          title: '群公告更新',
          text: truncated,
          route: '/chat',
          type: 'group_event',
          category: 'chat',
          priority: 'normal'
        });
      };

      self.wsListeners['user_online'] = function() {
        self.onlineUserCount = (self.onlineUserCount || 0) + 1;
      };

      self.wsListeners['notification'] = function(data) {
        if (!data.category) data.category = 'system';
        if (!data.priority) data.priority = 'normal';
        self.enqueueNotification(data);
      };

      self.wsListeners['user_offline'] = function() {
        self.onlineUserCount = Math.max(0, (self.onlineUserCount || 0) - 1);
      };

      self.wsListeners['connected'] = function(data) {
        var count = 0;
        if (data.users) {
          var keys = Object.keys(data.users);
          count += keys.length;
        }
        if (data.remote_users) {
          var rkeys = Object.keys(data.remote_users);
          count += rkeys.length;
        }
        self.onlineUserCount = count;
      };

      self.wsListeners['online_users'] = function(data) {
        if (data && data.users) self.onlineUserCount = data.users.length;
      };

      self.wsListeners['broadcast'] = function(data) {
        self.latestBroadcast = data;
        self.broadcastText = data.content;
      };

      self.wsListeners['super_island_notification'] = function(data) {
        var notif = data.notification || data;
        if (notif.type === 'broadcast') {
          var prefix = notif.relayed_from ? '[跨班] ' : '';
          self.latestBroadcast = { content: prefix + notif.content, priority: notif.priority };
          self.broadcastText = prefix + notif.content;
        }
        self.enqueueNotification(notif);
      };

      self.wsListeners['community_event'] = function(data) {
        if (!data || !data.action) return;
        if (self.currentRoute === '/community') return;
        if (data.action === 'create_post' && data.post) {
          var postType = data.post.type || 'forum';
          var typeLabel = postType === 'food' ? '美食推荐' : postType === 'hot' ? '热事爆料' : '新帖子';
          var postTitle = data.post.title || data.post.content || '';
          var truncated = postTitle.length > 25 ? postTitle.substring(0, 25) + '...' : postTitle;
          self.enqueueNotification({
            icon: postType === 'food' ? 'fa-solid fa-utensils' : postType === 'hot' ? 'fa-solid fa-fire' : 'fa-solid fa-newspaper',
            color: 'rgba(16, 185, 129, 0.25)',
            title: typeLabel,
            text: truncated,
            route: '/community?post=' + data.post.id,
            type: 'community',
            category: 'community',
            priority: 'low'
          });
        }
      };

      var events = Object.keys(self.wsListeners);
      for (var i = 0; i < events.length; i++) {
        wsManager.on(events[i], self.wsListeners[events[i]]);
      }
    },

    cleanupWSListeners: function() {
      var events = Object.keys(this.wsListeners);
      for (var i = 0; i < events.length; i++) {
        wsManager.off(events[i], this.wsListeners[events[i]]);
      }
      this.wsListeners = {};
    },

    enqueueNotification: function(notification) {
      // 免打扰过滤：聊天类通知检查 dnd 设置
      if (notification.category === 'chat' && notification.chatId) {
        var dndSettings = this.$store.state.chat.dndSettings;
        if (dndSettings && dndSettings[notification.chatId]) {
          return; // 已开启免打扰，不显示通知
        }
      }
      if (!notification.category) notification.category = 'system';
      if (!notification.priority) notification.priority = 'normal';
      if (this.islandMode === 'notification' && this.notification) {
        this.notificationQueue.push(notification);
      } else {
        this.showNotification(notification);
      }
    },

    showNotification: function(data) {
      var self = this;
      self.notification = data;
      self.notificationPriority = data.priority || 'normal';
      self.prevMode = self.islandMode;
      self.islandMode = 'notification';
      self.isDismissing = false;
      self.notificationAppearTime = Date.now();
      self.notificationTimestamp = '刚刚';
      self.progressWidth = 100;
      self.showQuickCompose = false;

      var historyItem = Object.assign({}, data, { timestamp: Date.now() });
      self.notificationHistory.unshift(historyItem);
      if (self.notificationHistory.length > 50) {
        self.notificationHistory = self.notificationHistory.slice(0, 50);
      }

      self.isBouncing = true;
      self._bounceTimer = setTimeout(function() { self.isBouncing = false; }, 500);

      self.startProgressBar();
      self.startTimestampUpdate();

      var duration = NOTIFICATION_DURATION;
      if (self.notificationPriority === 'urgent') duration = 5000;
      else if (self.notificationPriority === 'low') duration = 2000;
      if (self.collapseTimer) clearTimeout(self.collapseTimer);
      self.collapseTimer = setTimeout(function() {
        self.dismissNotification();
      }, duration);
    },

    startProgressBar: function() {
      var self = this;
      if (self.progressTimer) clearInterval(self.progressTimer);
      var duration = NOTIFICATION_DURATION;
      if (self.notificationPriority === 'urgent') duration = 5000;
      else if (self.notificationPriority === 'low') duration = 2000;
      var elapsed = 0;
      self.progressTimer = setInterval(function() {
        elapsed += PROGRESS_INTERVAL;
        self.progressWidth = Math.max(0, 100 - (elapsed / duration) * 100);
        if (self.progressWidth <= 0) {
          clearInterval(self.progressTimer);
          self.progressTimer = null;
        }
      }, PROGRESS_INTERVAL);
    },

    startTimestampUpdate: function() {
      var self = this;
      if (self.timestampTimer) clearInterval(self.timestampTimer);
      self.timestampTimer = setInterval(function() {
        if (!self.notificationAppearTime) return;
        var diff = Date.now() - self.notificationAppearTime;
        var seconds = Math.floor(diff / 1000);
        if (seconds < 60) self.notificationTimestamp = '刚刚';
        else self.notificationTimestamp = Math.floor(seconds / 60) + '分钟前';
      }, 5000);
    },

    dismissNotification: function() {
      var self = this;
      if (self.isDismissing) return;
      self.isDismissing = true;
      if (self.progressTimer) { clearInterval(self.progressTimer); self.progressTimer = null; }
      if (self.timestampTimer) { clearInterval(self.timestampTimer); self.timestampTimer = null; }
      if (self.collapseTimer) { clearTimeout(self.collapseTimer); self.collapseTimer = null; }
      if (self.prevMode && self.prevMode !== 'notification') {
        self.islandMode = self.prevMode;
      } else {
        self.goCompact();
      }
      self.prevMode = 'compact';
      self._dismissTimer = setTimeout(function() {
        self.isDismissing = false;
        self.notification = null;
        self.notificationPriority = 'normal';
        self.notificationAppearTime = null;
        self.notificationTimestamp = '';
        self.progressWidth = 100;
        self.processQueue();
      }, 250);
    },

    processQueue: function() {
      var self = this;
      if (self.notificationQueue.length === 0) return;
      if (self.queueTimer) clearTimeout(self.queueTimer);
      self.queueTimer = setTimeout(function() {
        var next = self.notificationQueue.shift();
        if (next) self.showNotification(next);
      }, 300);
    },

    formatHistoryTime: function(ts) {
      if (!ts) return '';
      var diff = Date.now() - ts;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
      return Math.floor(diff / 86400000) + '天前';
    },

    cleanupNotificationTimers: function() {
      if (this.collapseTimer) clearTimeout(this.collapseTimer);
      if (this.queueTimer) clearTimeout(this.queueTimer);
      if (this.progressTimer) clearInterval(this.progressTimer);
      if (this.timestampTimer) clearInterval(this.timestampTimer);
      if (this._bounceTimer) clearTimeout(this._bounceTimer);
      if (this._dismissTimer) clearTimeout(this._dismissTimer);
    }
  }
};
