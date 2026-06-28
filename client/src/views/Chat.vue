<template>
  <div class="chat-page">
    <AppNavBar title="聊天">
      <template slot="actions">
        <button class="nav-action-btn" @click="showCreateGroup = true" title="创建群组">
          <i class="fa-solid fa-users"></i>
        </button>
      </template>
    </AppNavBar>
    <div class="chat-body">
      <!-- Sidebar -->
      <div class="chat-sidebar">
        <div class="sidebar-tabs" role="tablist">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="sidebar-tab"
            :class="{ active: isTabActive(tab.key) }"
            role="tab"
            :aria-selected="isTabActive(tab.key) ? 'true' : 'false'"
            @click="switchTab(tab.key)"
          >{{ tab.label }}</button>
        </div>
        <div class="sidebar-list scrollbar-thin">
          <transition name="fade-slide" mode="out-in">
            <!-- Public Room -->
            <div v-if="activeTab === 'public'" key="public">
              <div class="chat-item" :class="{ active: currentChat === 'public' }" @click="selectChat('public')">
                <div class="chat-item-icon"><i class="fa-solid fa-globe"></i></div>
                <div class="chat-item-info">
                  <div class="chat-item-name">公共聊天室</div>
                  <div class="chat-item-preview">{{ publicPreview }}</div>
                </div>
                <div class="chat-item-meta">
                  <div v-if="publicLastTime" class="chat-item-time">{{ publicLastTime }}</div>
                  <div v-if="unread['public']" class="chat-item-badge">{{ unread['public'] }}</div>
                </div>
              </div>
              <div
                v-for="group in classGroups"
                :key="group.group_id"
                class="chat-item"
                :class="{ active: currentChat === group.group_id }"
                @click="selectChat(group.group_id)"
              >
                <div class="chat-item-avatar-wrap">
                  <div class="chat-item-avatar" :style="{ background: getGroupColor(group.group_id) }">{{ firstChar(group.group_name) }}</div>
                </div>
                <div class="chat-item-info">
                  <div class="chat-item-name">
                    {{ group.group_name }}
                    <span class="class-group-badge">班级</span>
                    <i v-if="isDndChat(group.group_id)" class="fa-solid fa-moon dnd-icon"></i>
                    <i v-if="isPinnedChat(group.group_id)" class="fa-solid fa-thumbtack pin-icon"></i>
                  </div>
                  <div class="chat-item-preview">{{ getGroupPreview(group.group_id) }}</div>
                </div>
                <div class="chat-item-meta">
                  <div v-if="getGroupLastTime(group.group_id)" class="chat-item-time">{{ getGroupLastTime(group.group_id) }}</div>
                  <div v-if="unread[group.group_id]" class="chat-item-badge">{{ unread[group.group_id] }}</div>
                </div>
              </div>
            </div>
            <!-- Private Chats -->
            <div v-else-if="activeTab === 'private'" key="private">
              <div class="sidebar-search-bar">
                <div class="search-input-wrap">
                  <i class="fa-solid fa-magnifying-glass search-input-icon"></i>
                  <input v-model="contactSearch" class="search-input" placeholder="搜索联系人..." aria-label="搜索联系人" />
                  <button v-if="contactSearch" class="search-clear" @click="contactSearch = ''"><i class="fa-solid fa-xmark"></i></button>
                </div>
              </div>
              <div
                v-for="contact in filteredContacts"
                :key="contact.user_id"
                class="chat-item"
                :class="{ active: currentChat === contact.user_id }"
                @click="selectChat(contact.user_id)"
              >
                <div class="chat-item-avatar-wrap">
                  <div class="chat-item-avatar" :style="{ background: getAvatarColor(contact.user_id) }">{{ firstChar(getContactDisplayName(contact)) }}</div>
                  <div v-if="isUserOnline(contact.user_id)" class="chat-item-online-dot"></div>
                </div>
                <div class="chat-item-info">
                  <div class="chat-item-name">{{ getContactDisplayName(contact) }}<span v-if="isRemoteUser(contact.user_id)" class="remote-badge">跨班</span></div>
                  <div class="chat-item-preview">{{ getPrivatePreview(contact.user_id) }}</div>
                </div>
                <div class="chat-item-meta">
                  <div v-if="getContactLastTime(contact.user_id)" class="chat-item-time">{{ getContactLastTime(contact.user_id) }}</div>
                  <div v-if="unread[contact.user_id]" class="chat-item-badge">{{ unread[contact.user_id] }}</div>
                </div>
              </div>
              <div v-if="filteredContacts.length === 0 && contactSearch" class="empty-hint">未找到匹配的联系人</div>
            </div>
            <!-- Group Chats -->
            <div v-else-if="activeTab === 'group'" key="group">
              <div class="sidebar-action" @click="showCreateGroup = true">
                <span>+ 创建群组</span>
              </div>
              <div
                v-for="group in sortedNonClassGroups"
                :key="group.group_id"
                class="chat-item"
                :class="{ active: currentChat === group.group_id }"
                @click="selectChat(group.group_id)"
              >
                <div class="chat-item-avatar-wrap">
                  <div class="chat-item-avatar" :style="{ background: getGroupColor(group.group_id) }">{{ firstChar(group.group_name) }}</div>
                </div>
                <div class="chat-item-info">
                  <div class="chat-item-name">
                    {{ group.group_name }}
                    <i v-if="isGroupOwner(group)" class="fa-solid fa-crown group-crown"></i>
                    <i v-if="isDndChat(group.group_id)" class="fa-solid fa-moon dnd-icon"></i>
                    <i v-if="isPinnedChat(group.group_id)" class="fa-solid fa-thumbtack pin-icon"></i>
                  </div>
                  <div class="chat-item-preview">{{ getGroupPreview(group.group_id) }}</div>
                </div>
                <div class="chat-item-meta">
                  <div v-if="getGroupLastTime(group.group_id)" class="chat-item-time">{{ getGroupLastTime(group.group_id) }}</div>
                  <div v-if="unread[group.group_id]" class="chat-item-badge">{{ unread[group.group_id] }}</div>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>
      <!-- Main Chat Area -->
      <div class="chat-main">
        <div class="chat-header">
          <div class="chat-title">
            <span>{{ chatTitle }}</span>
            <span v-if="typingUsers.length > 0" class="typing-indicator">{{ typingDisplayText }}</span>
          </div>
          <div class="chat-header-actions">
            <button class="header-action-btn" @click="toggleSearch">
              <i class="fa-solid fa-magnifying-glass"></i>
            </button>
            <button class="header-action-btn" @click="openSettings">
              <i class="fa-solid fa-gear"></i>
            </button>
          </div>
        </div>
        <div v-if="showSearch" class="chat-search-bar">
          <div class="search-input-wrap">
            <i class="fa-solid fa-magnifying-glass search-input-icon"></i>
            <input
              v-model="searchText"
              class="search-input"
              placeholder="搜索消息..."
              ref="searchInput"
            />
            <button v-if="searchText" class="search-clear" @click="searchText = ''">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <button class="search-close-btn" @click="closeSearch">取消</button>
        </div>
        <div v-if="wsConnecting && currentMessages.length === 0" class="chat-connecting">
          <div class="loading-spinner-sm"></div>
          <span>正在连接聊天服务器...</span>
        </div>
        <div v-else-if="currentMessages.length === 0" class="chat-empty">
          <i class="fa-regular fa-comments chat-empty-icon"></i>
          <div class="chat-empty-text">暂无消息，开始聊天吧</div>
        </div>
        <div v-else class="chat-messages scrollbar-thin" ref="messageContainer" role="log" aria-live="polite" @scroll="onMessageScroll">
          <div v-if="wsConnecting" class="chat-reconnecting-bar">
            <div class="loading-spinner-sm"></div>
            <span>重新连接中...</span>
          </div>
          <div v-if="chatLoadingMore || (isGroupChat(currentChat) && groupLoadingMore[currentChat])" class="loading-more-indicator">
            <div class="spinner-small"></div>
          </div>
          <div v-if="searchText && filteredMessages.length === 0" class="chat-empty">
            <i class="fa-solid fa-magnifying-glass chat-empty-icon"></i>
            <div class="chat-empty-text">未找到匹配的消息</div>
          </div>
          <transition-group name="msg-list" tag="div">
            <ChatBubble
              v-for="(msg, index) in filteredMessages"
              :key="msg.id || msg.message_id"
              :message="msg"
              :isOwn="isOwnMessage(msg)"
              :canRecall="canRecallMessage(msg)"
              :status="getMessageStatus(msg)"
              :showDateSeparator="shouldShowDateSeparator(index)"
              :dateLabel="getDateLabel(index)"
              :searchTerm="searchText"
              :isPrivate="isPrivateChat"
              :isRead="!!readReceipts[msg.id || msg.message_id]"
              :showTimestamp="shouldShowTimestamp(index)"
              :showUnreadDivider="showUnreadDivider && index === unreadDividerIndex"
              :unreadCount="unreadCountOnEnter"
              :senderLevel="chatUserLevels[msg.sender_id || msg.user_id] ? chatUserLevels[msg.sender_id || msg.user_id].level : -1"
              :showLevel="chatUserLevels[msg.sender_id || msg.user_id] ? chatUserLevels[msg.sender_id || msg.user_id].show_level_chat : false"
              :senderRole="getSenderRole(msg.sender_id || msg.user_id)"
              :senderTitle="getSenderTitle(msg.sender_id || msg.user_id)"
              @recall="recallMessage"
              @context-menu="openContextMenu"
              @preview-media="previewMedia"
              @toggle-reaction="toggleReaction"
              @scroll-to="scrollToMessage"
            />
          </transition-group>
        </div>
        <div class="chat-input-area">
          <div v-if="replyingTo" class="reply-preview-bar">
            <div class="reply-preview-content">
              <i class="fa-solid fa-reply reply-preview-icon"></i>
              <span class="reply-preview-text">回复 @{{ replyingTo.user_name }}: {{ replyingTo.content_preview }}</span>
            </div>
            <button class="reply-preview-cancel" @click="cancelReply"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="input-wrapper">
            <button class="emoji-toggle" @click="showEmoji = !showEmoji"><i class="fa-regular fa-face-smile"></i></button>
            <EmojiPicker :visible="showEmoji" @select="insertEmoji" />
            <button class="cloud-toggle" @click="showCloudPicker = true" title="云盘图片"><i class="fa-solid fa-cloud"></i></button>
            <textarea
              v-model="inputText"
              class="chat-input"
              :placeholder="replyingTo ? '回复消息... (Shift+Enter换行)' : '输入消息... (Shift+Enter换行)'"
              rows="1"
              @keydown.enter.exact="onEnterKey"
              @focus="showEmoji = false"
              @input="onInputChange"
            ></textarea>
            <button class="send-btn" @click="sendMessage" :disabled="sending || !inputText.trim()">发送</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Context Menu -->
    <transition name="fade-quick">
      <div v-if="showContextMenu" class="context-menu-overlay" @click="closeContextMenu">
        <div
          class="context-menu-popup"
          :style="{ top: contextMenuPos.y + 'px', left: contextMenuPos.x + 'px' }"
          @click.stop
        >
          <button class="ctx-item" @click="handleContextAction('reply')">
            <i class="fa-solid fa-reply"></i> 回复
          </button>
          <button class="ctx-item" @click="handleContextAction('react')">
            <i class="fa-regular fa-face-smile"></i> 表情回应
          </button>
          <button class="ctx-item" @click="handleContextAction('copy')">
            <i class="fa-regular fa-copy"></i> 复制
          </button>
          <button class="ctx-item" @click="handleContextAction('forward')">
            <i class="fa-solid fa-share"></i> 转发
          </button>
          <button v-if="contextMenuMediaUrl" class="ctx-item" @click="handleContextAction('saveMedia')">
            <i class="fa-solid fa-cloud-arrow-up"></i> 转存到云盘
          </button>
          <button v-if="contextMenuTarget && isOwnMessage(contextMenuTarget)" class="ctx-item ctx-item-danger" @click="handleContextAction('delete')">
            <i class="fa-solid fa-trash"></i> 删除
          </button>
        </div>
      </div>
    </transition>

    <!-- Image Preview -->
    <ImagePreview :visible="showImagePreview" :image-url="mediaPreviewUrl" :media-type="mediaPreviewType" @close="closeImagePreview" />

    <!-- Reaction Picker -->
    <transition name="fade-quick">
      <div v-if="showReactionPicker" class="context-menu-overlay" @click="closeReactionPicker">
        <div
          class="reaction-picker-popup"
          :style="{ top: reactionPickerPos.y + 'px', left: reactionPickerPos.x + 'px' }"
          @click.stop
        >
          <button
            v-for="emoji in reactionEmojis"
            :key="emoji"
            class="reaction-pick-btn"
            @click="selectReaction(emoji)"
          >{{ emoji }}</button>
        </div>
      </div>
    </transition>

    <!-- Create Group Modal -->
    <transition name="modal-fade">
      <div v-if="showCreateGroup" class="modal-overlay" @click.self="showCreateGroup = false">
        <div class="modal-card">
          <h3 class="modal-title">创建群组</h3>
          <div class="form-group">
            <input v-model="newGroupName" class="form-input" placeholder="群组名称" />
          </div>
          <div class="form-group">
            <div class="member-select-label">选择成员 <span class="selected-count">({{ newGroupMembers.length }} 人)</span></div>
            <div class="member-select-list scrollbar-thin">
              <label v-for="contact in contacts" :key="contact.user_id" class="member-select-item">
                <input type="checkbox" :value="contact.user_id" v-model="newGroupMembers" />
                <div class="member-select-avatar">{{ firstChar(contact.net_name) }}</div>
                <span class="member-select-name">{{ contact.net_name }}</span>
              </label>
              <div v-if="contacts.length === 0" class="empty-hint">暂无联系人</div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" @click="closeCreateGroup">取消</button>
            <button class="btn-confirm" @click="createGroup" :disabled="!newGroupName.trim() || newGroupMembers.length === 0">创建</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Group Settings Panel -->
    <transition name="slide-right">
      <div v-if="showGroupSettings" class="settings-panel">
        <div class="settings-header">
          <h3 v-if="!editingGroupName" class="settings-title" :class="{ 'editable-title': isGroupOwnerOfCurrent && !(currentGroup && currentGroup.is_class_group) }" @click="startEditGroupName">
            {{ currentGroup ? currentGroup.group_name : '' }}
            <i v-if="isGroupOwnerOfCurrent && !(currentGroup && currentGroup.is_class_group)" class="fa-solid fa-pen title-edit-icon"></i>
          </h3>
          <div v-else class="group-name-edit-wrap">
            <input v-model="editingGroupNameText" class="group-name-edit-input" maxlength="30" @keyup.enter="saveGroupName" @keyup.escape="editingGroupName = false" ref="groupNameInput" />
            <button class="btn-confirm-sm" @click="saveGroupName">保存</button>
            <button class="btn-cancel-sm" @click="editingGroupName = false">取消</button>
          </div>
          <button class="settings-close" @click="closeGroupSettings"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="settings-body scrollbar-thin">
          <!-- Members -->
          <div class="settings-section">
            <div class="settings-section-title">群成员 ({{ currentGroupMembers.length }})</div>
            <div class="member-list">
              <div v-for="member in currentGroupMembers" :key="member.user_id" class="member-item">
                <div class="member-avatar-wrap">
                  <div class="member-avatar">{{ firstChar(member.net_name || member.real_name) }}</div>
                  <div v-if="isUserOnline(member.user_id)" class="member-online-dot"></div>
                </div>
                <span class="member-name">{{ member.net_name || member.real_name || member.user_id }}</span>
                <span v-if="currentGroup && member.user_id === currentGroup.creator_id" class="member-role role-owner">群主</span>
                <span v-else-if="getSenderRole(member.user_id) === 'admin'" class="member-role role-admin">管理员</span>
                <span v-else class="member-role role-member">成员</span>
                <i v-if="currentGroup && member.user_id === currentGroup.creator_id" class="fa-solid fa-crown member-crown"></i>
                <button
                  v-if="isGroupOwnerOfCurrent && currentGroup && member.user_id !== currentGroup.creator_id"
                  class="member-kick-btn"
                  @click="kickMember(member)"
                  title="移出群聊"
                ><i class="fa-solid fa-xmark"></i></button>
              </div>
            </div>
            <button v-if="!(currentGroup && currentGroup.is_class_group)" class="settings-action-btn" @click="openInviteModal"><i class="fa-solid fa-user-plus"></i> 邀请入群</button>
          </div>
          <!-- Announcement -->
          <div class="settings-section">
            <div class="settings-section-title">群公告</div>
            <div v-if="!showAnnouncementEditor" class="announcement-display">
              <div v-if="currentGroup && currentGroup.announcement" class="announcement-content">
                {{ currentGroup.announcement }}
              </div>
              <div v-else class="announcement-empty">暂无公告</div>
              <button v-if="isGroupOwnerOfCurrent" class="settings-action-btn" @click="editAnnouncement"><i class="fa-solid fa-pen"></i> 编辑</button>
            </div>
            <div v-else class="announcement-editor">
              <textarea v-model="announcementText" class="announcement-textarea" placeholder="输入群公告..." rows="4"></textarea>
              <div class="announcement-editor-actions">
                <button class="btn-cancel-sm" @click="showAnnouncementEditor = false">取消</button>
                <button class="btn-confirm-sm" @click="saveAnnouncement">保存</button>
              </div>
            </div>
          </div>
          <!-- DND -->
          <div class="settings-section">
            <div class="settings-row">
              <span class="settings-row-label">消息免打扰</span>
              <label class="toggle-switch">
                <input type="checkbox" :checked="isCurrentDnd" @change="toggleDnd(currentChat, $event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <!-- Pin -->
          <div class="settings-section">
            <div class="settings-row">
              <span class="settings-row-label">置顶聊天</span>
              <label class="toggle-switch">
                <input type="checkbox" :checked="isCurrentPinned" @change="togglePin(currentChat)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <!-- Owner actions -->
          <div v-if="isGroupOwnerOfCurrent && !(currentGroup && currentGroup.is_class_group)" class="settings-section">
            <button class="settings-action-btn" @click="openTransferModal"><i class="fa-solid fa-right-left"></i> 转让群聊</button>
            <button class="settings-danger-btn" @click="dissolveGroup"><i class="fa-solid fa-trash"></i> 解散群聊</button>
          </div>
          <!-- Member actions -->
          <div v-else-if="!(currentGroup && currentGroup.is_class_group)" class="settings-section">
            <button class="settings-danger-btn" @click="leaveGroup"><i class="fa-solid fa-right-from-bracket"></i> 退出群聊</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Private Chat Settings Panel -->
    <transition name="slide-right">
      <div v-if="showPrivateSettings" class="settings-panel settings-panel-sm">
        <div class="settings-header">
          <h3 class="settings-title">聊天设置</h3>
          <button class="settings-close" @click="showPrivateSettings = false"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="settings-body">
          <div class="settings-section">
            <div class="settings-user-card" v-if="currentPrivateContact">
              <div class="settings-user-avatar" :style="{ background: getAvatarColor(currentChat) }">{{ firstChar(getContactDisplayName(currentPrivateContact)) }}</div>
              <div class="settings-user-info">
                <div class="settings-user-name">{{ getContactDisplayName(currentPrivateContact) }}</div>
                <div v-if="friendRemarks[currentChat]" class="settings-user-realname">{{ currentPrivateContact.net_name || currentPrivateContact.real_name }}</div>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-row-label">好友备注</span>
              <input
                class="form-input settings-remark-input"
                :value="friendRemarks[currentChat] || ''"
                @change="setFriendRemark(currentChat, $event.target.value)"
                placeholder="添加备注..."
              />
            </div>
            <div class="settings-row">
              <span class="settings-row-label">消息免打扰</span>
              <label class="toggle-switch">
                <input type="checkbox" :checked="isCurrentDnd" @change="toggleDnd(currentChat, $event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="settings-row">
              <span class="settings-row-label">置顶聊天</span>
              <label class="toggle-switch">
                <input type="checkbox" :checked="isPinnedChat(currentChat)" @change="togglePin(currentChat, $event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="settings-section">
            <button class="settings-danger-btn" @click="clearPrivateChatHistory">
              <i class="fa-solid fa-eraser"></i> 清除聊天记录
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Public Chat Settings Panel -->
    <transition name="slide-right">
      <div v-if="showPublicSettings" class="settings-panel settings-panel-sm">
        <div class="settings-header">
          <h3 class="settings-title">公共聊天室设置</h3>
          <button class="settings-close" @click="showPublicSettings = false"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="settings-body">
          <div class="settings-section">
            <div class="settings-row">
              <span class="settings-row-label">消息免打扰</span>
              <label class="toggle-switch">
                <input type="checkbox" :checked="isCurrentDnd" @change="toggleDnd('public', $event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="settings-row">
              <span class="settings-row-label">置顶聊天</span>
              <label class="toggle-switch">
                <input type="checkbox" :checked="isPinnedChat('public')" @change="togglePin('public', $event.target.checked)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- Invite Modal -->
    <transition name="modal-fade">
      <div v-if="showInviteModal" class="modal-overlay" @click.self="showInviteModal = false">
        <div class="modal-card">
          <h3 class="modal-title">邀请入群</h3>
          <div class="member-select-list scrollbar-thin" style="max-height: 300px;">
            <label v-for="contact in availableInviteContacts" :key="contact.user_id" class="member-select-item">
              <input type="checkbox" :value="contact.user_id" v-model="inviteUserIds" />
              <div class="member-select-avatar">{{ firstChar(contact.net_name) }}</div>
              <span class="member-select-name">{{ contact.net_name }}</span>
            </label>
            <div v-if="availableInviteContacts.length === 0" class="empty-hint">没有可邀请的联系人</div>
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" @click="showInviteModal = false">取消</button>
            <button class="btn-confirm" @click="inviteSelectedUsers" :disabled="inviteUserIds.length === 0">邀请</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Transfer Modal -->
    <transition name="modal-fade">
      <div v-if="showTransferModal" class="modal-overlay" @click.self="showTransferModal = false">
        <div class="modal-card">
          <h3 class="modal-title">转让群聊</h3>
          <p class="modal-desc">选择新的群主：</p>
          <div class="member-select-list scrollbar-thin" style="max-height: 300px;">
            <div
              v-for="member in transferableMembers"
              :key="member.user_id"
              class="member-select-item member-select-item-clickable"
              @click="confirmTransfer(member.user_id)"
            >
              <div class="member-select-avatar">{{ firstChar(member.net_name || member.real_name) }}</div>
              <span class="member-select-name">{{ member.net_name || member.real_name || member.user_id }}</span>
            </div>
            <div v-if="transferableMembers.length === 0" class="empty-hint">没有可转让的成员</div>
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" @click="showTransferModal = false">取消</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Confirm Dialog -->
    <transition name="modal-fade">
      <div v-if="confirmDialog" class="modal-overlay" @click.self="confirmDialog = null">
        <div class="modal-card">
          <h3 class="modal-title">{{ confirmDialog.title }}</h3>
          <p class="modal-desc">{{ confirmDialog.message }}</p>
          <div class="modal-actions">
            <button class="btn-cancel" @click="confirmDialog = null">取消</button>
            <button class="btn-confirm btn-confirm-danger" @click="onConfirmDialog">确认</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Announcement Popup Modal -->
    <transition name="modal-fade">
      <div v-if="showAnnouncementPopup" class="modal-overlay">
        <div class="modal-card announcement-popup-modal">
          <h3 class="modal-title">
            <i class="fa-solid fa-bullhorn"></i> 群公告
          </h3>
          <div class="announcement-popup-content scrollbar-thin">
            {{ announcementPopupContent }}
          </div>
          <div class="modal-actions">
            <button class="btn-confirm" @click="acknowledgeAnnouncement">我知道了</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Forward Share Modal -->
    <transition name="modal-fade">
      <div v-if="showForwardModal" class="modal-overlay" @click.self="showForwardModal = false">
        <div class="modal-card forward-modal-card">
          <h3 class="modal-title"><i class="fa-solid fa-share"></i> 分享到聊天</h3>
          <div class="forward-preview-card">
            <div class="forward-preview-type">{{ forwardModalTypeLabel }}</div>
            <div class="forward-preview-title">{{ forwardPreviewTitle }}</div>
            <div v-if="pendingForward && (pendingForward.canteen || pendingForward.location)" class="forward-preview-meta">
              <span v-if="pendingForward.canteen"><i class="fa-solid fa-utensils"></i> {{ pendingForward.canteen }}{{ pendingForward.window ? ' · ' + pendingForward.window : '' }}</span>
              <span v-if="pendingForward.location"><i class="fa-solid fa-location-dot"></i> {{ pendingForward.location }}</span>
            </div>
            <div v-if="pendingForward && pendingForward.songCount" class="forward-preview-meta">
              <span><i class="fa-solid fa-music"></i> {{ pendingForward.songCount }} 首歌曲</span>
            </div>
            <div class="forward-preview-content">{{ forwardPreviewContent }}</div>
          </div>
          <div class="forward-target-list scrollbar-thin">
            <div class="forward-target-section">聊天</div>
            <div class="forward-target-item" @click="sendForwardTo('public')">
              <div class="forward-target-avatar" style="background: var(--primary-color);"><i class="fa-solid fa-globe"></i></div>
              <div class="forward-target-info">
                <div class="forward-target-name">公共聊天室</div>
                <div class="forward-target-desc">{{ onlineUsers.length }} 人在线</div>
              </div>
            </div>
            <div v-for="group in classGroups" :key="'fcg-' + group.group_id" class="forward-target-item" @click="sendForwardTo(group.group_id)">
              <div class="forward-target-avatar" :style="{ background: getGroupColor(group.group_id) }">{{ firstChar(group.group_name) }}</div>
              <div class="forward-target-info">
                <div class="forward-target-name">{{ group.group_name }}</div>
                <div class="forward-target-desc">{{ group.member_count || 0 }} 人</div>
              </div>
            </div>
            <div v-if="nonClassGroups.length > 0" class="forward-target-section">群聊</div>
            <div v-for="group in nonClassGroups" :key="'fg-' + group.group_id" class="forward-target-item" @click="sendForwardTo(group.group_id)">
              <div class="forward-target-avatar" :style="{ background: getGroupColor(group.group_id) }">{{ firstChar(group.group_name) }}</div>
              <div class="forward-target-info">
                <div class="forward-target-name">{{ group.group_name }}</div>
                <div class="forward-target-desc">{{ group.member_count || 0 }} 人</div>
              </div>
            </div>
            <div v-if="contacts.length > 0" class="forward-target-section">私聊</div>
            <div v-for="contact in contacts" :key="'fc-' + contact.user_id" class="forward-target-item" @click="sendForwardTo(contact.user_id)">
              <div class="forward-target-avatar" :style="{ background: getAvatarColor(contact.user_id) }">{{ firstChar(getContactDisplayName(contact)) }}</div>
              <div class="forward-target-info">
                <div class="forward-target-name">{{ getContactDisplayName(contact) }}</div>
                <div v-if="isUserOnline(contact.user_id)" class="forward-target-desc online-desc">在线</div>
              </div>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" @click="cancelForward">取消</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Forward Success Dialog -->
    <transition name="modal-fade">
      <div v-if="showForwardSuccess" class="modal-overlay">
        <div class="modal-card">
          <h3 class="modal-title"><i class="fa-solid fa-check-circle" style="color: #34C759;"></i> 分享成功</h3>
          <p class="modal-desc">帖子已成功分享到{{ forwardSuccessTarget }}</p>
          <div class="modal-actions">
            <button class="btn-cancel" @click="stayInChat">留在聊天</button>
            <button class="btn-confirm" @click="backToCommunity">返回社区</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Cloud Image Picker -->
    <CloudImagePicker
      v-if="showCloudPicker"
      @select="onCloudImageSelect"
      @close="showCloudPicker = false"
    />
  </div>
</template>

<script>
import ChatBubble from '@/components/ChatBubble.vue';
import EmojiPicker from '@/components/EmojiPicker.vue';
import AppNavBar from '@/components/AppNavBar.vue';
import CloudImagePicker from '@/components/CloudImagePicker.vue';
import ImagePreview from '@/components/ImagePreview.vue';
import helpers from '@/utils/helpers';
import wsManager from '@/utils/websocket';
import { autoConnect } from '@/utils/websocket';
import api from '@/utils/api';

export default {
  name: 'Chat',
  components: {
    ChatBubble: ChatBubble,
    EmojiPicker: EmojiPicker,
    AppNavBar: AppNavBar,
    CloudImagePicker: CloudImagePicker,
    ImagePreview: ImagePreview
  },
  data: function() {
    return {
      activeTab: 'public',
      currentChat: 'public',
      inputText: '',
      showEmoji: false,
      showCloudPicker: false,
      showCreateGroup: false,
      newGroupName: '',
      newGroupMembers: [],
      wsConnecting: true,
      sending: false,
      showGroupSettings: false,
      showPrivateSettings: false,
      showPublicSettings: false,
      showInviteModal: false,
      inviteGroupId: '',
      contactSearch: '',
      friendRemarks: {},
      inviteUserIds: [],
      showTransferModal: false,
      transferGroupId: '',
      showAnnouncementEditor: false,
      announcementText: '',
      confirmDialog: null,
      tabs: [
        { key: 'public', label: '公共' },
        { key: 'private', label: '私聊' },
        { key: 'group', label: '群组' }
      ],
      showSearch: false,
      searchText: '',
      typingUsers: [],
      lastReadMessageId: null,
      typingTimer: null,
      lastTypingSent: 0,
      messageStatuses: {},
      unreadCountOnEnter: 0,
      showUnreadDivider: false,
      prevChatId: null,
      editingGroupName: false,
      editingGroupNameText: '',
      showAnnouncementPopup: false,
      announcementPopupContent: '',
      announcementPopupGroupId: '',
      pendingForward: null,
      pendingForwardType: 'community_forward',
      showForwardModal: false,
      showForwardSuccess: false,
      forwardSuccessTarget: '',
      // Reply system
      replyingTo: null,
      // Context menu
      showContextMenu: false,
      contextMenuTarget: null,
      contextMenuPos: { x: 0, y: 0 },
      contextMenuMediaUrl: null,
      // Media preview (image/video/audio)
      showImagePreview: false,
      mediaPreviewUrl: null,
      mediaPreviewType: 'image',
      // Reaction picker
      showReactionPicker: false,
      reactionPickerTarget: null,
      reactionPickerPos: { x: 0, y: 0 },
      reactionEmojis: ['\uD83D\uDC4D', '\u2764\uFE0F', '\uD83D\uDE02', '\uD83D\uDE2E', '\uD83D\uDE22', '\uD83D\uDE21'],
      // Message reactions (mapping messageId -> reactions object)
      messageReactions: {},
      // Read receipts (mapping messageId -> boolean)
      readReceipts: {},
      // Level data for chat users
      chatUserLevels: {},
      chatHasMore: true,
      chatLoadingMore: false,
      privateHasMore: {},
      privateLoadingMore: {},
      groupHasMore: {},
      groupLoadingMore: {},
      showClearChatConfirmDialog: false,
    };
  },
  computed: {
    currentMessages: function() {
      var state = this.$store.state.chat;
      if (this.currentChat === 'public') {
        return state.messages;
      }
      if (this.isGroupChat(this.currentChat)) {
        return state.groupChats[this.currentChat] || [];
      }
      return state.privateChats[this.currentChat] || [];
    },
    onlineUsers: function() {
      return this.$store.state.chat.onlineUsers;
    },
    remoteOnlineUsers: function() {
      return this.$store.state.chat.remoteOnlineUsers;
    },
    contacts: function() {
      var local = this.$store.state.chat.contacts;
      var remote = this.remoteOnlineUsers;
      var merged = local.slice();
      for (var i = 0; i < remote.length; i++) {
        // 跳过无效的远程用户（缺少 user_id）
        if (!remote[i] || !remote[i].user_id) continue;
        var existing = merged.find(function(c) { return c.user_id === remote[i].user_id; });
        if (!existing) {
          merged.push({
            user_id: remote[i].user_id,
            net_name: remote[i].net_name || remote[i].user_id,
            real_name: remote[i].real_name || '',
            gender: remote[i].gender || '',
            remote: true
          });
        } else {
          if (remote[i].net_name) existing.net_name = remote[i].net_name;
          if (remote[i].real_name) existing.real_name = remote[i].real_name;
          existing.remote = true;
        }
      }
      return merged;
    },
    sortedContacts: function() {
      var self = this;
      var privateChats = self.$store.state.chat.privateChats;
      var contacts = self.contacts.slice();
      contacts.sort(function(a, b) {
        var aMsgs = privateChats[a.user_id];
        var bMsgs = privateChats[b.user_id];
        var aTime = '';
        var bTime = '';
        if (aMsgs && aMsgs.length > 0) {
          aTime = aMsgs[aMsgs.length - 1].created_at || '';
        } else {
          aTime = a.last_message_at || '';
        }
        if (bMsgs && bMsgs.length > 0) {
          bTime = bMsgs[bMsgs.length - 1].created_at || '';
        } else {
          bTime = b.last_message_at || '';
        }
        if (aTime && !bTime) return -1;
        if (!aTime && bTime) return 1;
        if (!aTime && !bTime) return (a.net_name || '').localeCompare(b.net_name || '');
        return bTime.localeCompare(aTime);
      });
      return contacts;
    },
    filteredContacts: function() {
      var self = this;
      if (!self.contactSearch) return self.sortedContacts;
      var term = self.contactSearch.toLowerCase();
      return self.sortedContacts.filter(function(c) {
        var displayName = self.getContactDisplayName(c).toLowerCase();
        var realName = (c.real_name || '').toLowerCase();
        var userId = (c.user_id || '').toLowerCase();
        return displayName.indexOf(term) > -1 || realName.indexOf(term) > -1 || userId.indexOf(term) > -1;
      });
    },
    groups: function() {
      return this.$store.state.chat.groups;
    },
    unread: function() {
      return this.$store.state.chat.unread;
    },
    chatTitle: function() {
      if (this.currentChat === 'public') return '公共聊天室';
      var self = this;
      var contact = self.contacts.find(function(c) { return c.user_id === self.currentChat; });
      if (contact) return contact.net_name;
      var group = self.groups.find(function(g) { return g.group_id === self.currentChat; });
      if (group) return group.group_name;
      return '聊天';
    },
    publicPreview: function() {
      var msgs = this.$store.state.chat.messages;
      if (msgs.length === 0) return '暂无消息';
      var last = msgs[msgs.length - 1];
      return (last.sender_name || '') + ': ' + (last.content || '').substring(0, 20);
    },
    publicLastTime: function() {
      var msgs = this.$store.state.chat.messages;
      if (msgs.length === 0) return '';
      var last = msgs[msgs.length - 1];
      return this.formatRelativeTime(last.created_at);
    },
    currentUser: function() {
      return this.$store.state.auth.user;
    },
    currentGroup: function() {
      var self = this;
      if (!this.isGroupChat(self.currentChat)) return null;
      var found = self.groups.find(function(g) { return g.group_id === self.currentChat; });
      return found || null;
    },
    isGroupOwnerOfCurrent: function() {
      var group = this.currentGroup;
      var user = this.currentUser;
      return group && user && group.creator_id === user.user_id;
    },
    currentGroupMembers: function() {
      if (!this.currentGroup) return [];
      var members = this.$store.state.chat.groupMembers[this.currentChat] || [];
      var self = this;
      return members.map(function(m) {
        if (typeof m === 'string') {
          var contact = self.contacts.find(function(c) { return c.user_id === m; });
          return contact || { user_id: m, net_name: m };
        }
        return m;
      });
    },
    availableInviteContacts: function() {
      var self = this;
      if (!self.currentGroup) return [];
      var memberIds = self.currentGroupMembers.map(function(m) { return m.user_id; });
      return self.contacts.filter(function(c) {
        return memberIds.indexOf(c.user_id) === -1;
      });
    },
    isCurrentDnd: function() {
      return this.$store.getters['chat/isDnd'](this.currentChat);
    },
    transferableMembers: function() {
      var self = this;
      var userId = self.currentUser ? self.currentUser.user_id : '';
      return self.currentGroupMembers.filter(function(m) {
        return m.user_id !== userId;
      });
    },
    filteredMessages: function() {
      var self = this;
      var msgs = self.currentMessages;
      if (self.searchText) {
        var term = self.searchText.toLowerCase();
        msgs = msgs.filter(function(msg) {
          if (msg.type === 'system') return false;
          if (msg.recalled) return false;
          return (msg.content || '').toLowerCase().indexOf(term) > -1;
        });
      }
      var perfLevel = document.documentElement.getAttribute('data-perf');
      if (perfLevel === 'low' && msgs.length > 100) {
        return msgs.slice(msgs.length - 100);
      }
      if (perfLevel === 'medium' && msgs.length > 300) {
        return msgs.slice(msgs.length - 300);
      }
      return msgs;
    },
    isPrivateChat: function() {
      return this.currentChat !== 'public' && !this.isGroupChat(this.currentChat);
    },
    currentPrivateContact: function() {
      if (this.isGroupChat(this.currentChat) || this.currentChat === 'public') return null;
      return this.contacts.find(function(c) { return c.user_id === this.currentChat; }.bind(this));
    },
    sortedGroups: function() {
      var self = this;
      var groupChats = self.$store.state.chat.groupChats;
      var pinned = [];
      var unpinned = [];
      for (var i = 0; i < self.groups.length; i++) {
        if (self.$store.getters['chat/isPinned'](self.groups[i].group_id)) {
          pinned.push(self.groups[i]);
        } else {
          unpinned.push(self.groups[i]);
        }
      }
      pinned.sort(function(a, b) {
        var aMsgs = groupChats[a.group_id];
        var bMsgs = groupChats[b.group_id];
        var aTime = (aMsgs && aMsgs.length > 0) ? (aMsgs[aMsgs.length - 1].created_at || '') : (a.last_message_at || a.created_at || '');
        var bTime = (bMsgs && bMsgs.length > 0) ? (bMsgs[bMsgs.length - 1].created_at || '') : (b.last_message_at || b.created_at || '');
        return bTime.localeCompare(aTime);
      });
      unpinned.sort(function(a, b) {
        var aMsgs = groupChats[a.group_id];
        var bMsgs = groupChats[b.group_id];
        var aTime = (aMsgs && aMsgs.length > 0) ? (aMsgs[aMsgs.length - 1].created_at || '') : (a.last_message_at || a.created_at || '');
        var bTime = (bMsgs && bMsgs.length > 0) ? (bMsgs[bMsgs.length - 1].created_at || '') : (b.last_message_at || b.created_at || '');
        return bTime.localeCompare(aTime);
      });
      return pinned.concat(unpinned);
    },
    classGroups: function() {
      return this.groups.filter(function(g) {
        return g.is_class_group;
      });
    },
    nonClassGroups: function() {
      return this.groups.filter(function(g) {
        return !g.is_class_group;
      });
    },
    sortedNonClassGroups: function() {
      var self = this;
      var groupChats = self.$store.state.chat.groupChats;
      var nonClass = self.groups.filter(function(g) {
        return !g.is_class_group;
      });
      var pinned = [];
      var unpinned = [];
      for (var i = 0; i < nonClass.length; i++) {
        if (self.$store.getters['chat/isPinned'](nonClass[i].group_id)) {
          pinned.push(nonClass[i]);
        } else {
          unpinned.push(nonClass[i]);
        }
      }
      pinned.sort(function(a, b) {
        var aMsgs = groupChats[a.group_id];
        var bMsgs = groupChats[b.group_id];
        var aTime = (aMsgs && aMsgs.length > 0) ? (aMsgs[aMsgs.length - 1].created_at || '') : (a.last_message_at || a.created_at || '');
        var bTime = (bMsgs && bMsgs.length > 0) ? (bMsgs[bMsgs.length - 1].created_at || '') : (b.last_message_at || b.created_at || '');
        return bTime.localeCompare(aTime);
      });
      unpinned.sort(function(a, b) {
        var aMsgs = groupChats[a.group_id];
        var bMsgs = groupChats[b.group_id];
        var aTime = (aMsgs && aMsgs.length > 0) ? (aMsgs[aMsgs.length - 1].created_at || '') : (a.last_message_at || a.created_at || '');
        var bTime = (bMsgs && bMsgs.length > 0) ? (bMsgs[bMsgs.length - 1].created_at || '') : (b.last_message_at || b.created_at || '');
        return bTime.localeCompare(aTime);
      });
      return pinned.concat(unpinned);
    },
    groupOnlineCount: function() {
      var self = this;
      if (!self.currentGroup) return 0;
      var members = self.$store.state.chat.groupMembers[self.currentChat] || [];
      var count = 0;
      for (var i = 0; i < members.length; i++) {
        var memberId = typeof members[i] === 'string' ? members[i] : members[i].user_id;
        if (self.isUserOnline(memberId)) {
          count++;
        }
      }
      return count;
    },
    isCurrentPinned: function() {
      return this.$store.getters['chat/isPinned'](this.currentChat);
    },
    forwardModalTypeLabel: function() {
      if (!this.pendingForward) return '帖子';
      if (this.pendingForwardType === 'music_playlist' || this.pendingForward.playlistId) return '音乐歌单';
      if (this.pendingForwardType === 'ai_batch') return 'AI对话记录';
      var t = this.pendingForward.postType;
      if (t === 'food') return '美食推荐';
      if (t === 'hot') return '热事爆料';
      return '论坛帖子';
    },
    forwardPreviewTitle: function() {
      if (!this.pendingForward) return '';
      if (this.pendingForward.playlistName) return this.pendingForward.playlistName;
      return this.pendingForward.title || this.pendingForward.dish_name || '帖子';
    },
    forwardPreviewContent: function() {
      if (!this.pendingForward) return '';
      if (this.pendingForward.description) return this.pendingForward.description.substring(0, 60);
      return (this.pendingForward.content || this.pendingForward.reason || this.pendingForward.detail || '').substring(0, 60);
    },
    typingDisplayText: function() {
      var users = this.typingUsers;
      if (users.length === 0) return '';
      var names = [];
      for (var i = 0; i < users.length; i++) {
        names.push(users[i].user_name);
      }
      if (names.length === 1) return names[0] + '正在输入...';
      if (names.length === 2) return names[0] + '、' + names[1] + '正在输入...';
      return names[0] + '等' + names.length + '人正在输入...';
    },
    unreadDividerIndex: function() {
      if (!this.showUnreadDivider || this.unreadCountOnEnter <= 0) return -1;
      var msgs = this.filteredMessages;
      var idx = msgs.length - this.unreadCountOnEnter;
      return idx < 0 ? 0 : idx;
    }
  },
  watch: {
    currentChat: function(newVal) {
      var self = this;
      self.typingUsers = [];
      self._clearAllTypingTimers();
      self._lastMarkReadChat = null;
      if (self.isPrivateChat) {
        self.$nextTick(function() {
          self.sendMarkRead();
        });
      }
    },
    currentMessages: function() {
      this.loadChatUserLevels();
      if (this.isPrivateChat && this.currentChat) {
        this.sendMarkRead();
      }
    }
  },
  mounted: function() {
    var self = this;
    self.$store.dispatch('chat/loadMessages');
    self.$store.dispatch('chat/loadContacts');
    self.$store.dispatch('chat/loadGroups');
    self.loadFriendRemarks();
    self.connectWS();
    var forwardData = self.$route.query.forward;
    if (forwardData) {
      try {
        var fwd = JSON.parse(decodeURIComponent(forwardData));
        var forwardType = self.$route.query.forwardType || 'community_forward';
        self.$nextTick(function() {
          self.pendingForward = fwd;
          self.pendingForwardType = forwardType;
          self.showForwardModal = true;
        });
        self.$router.replace({ query: {} }).catch(function() {});
      } catch (e) {}
    }
    document.addEventListener('click', self.onDocumentClick);
  },
  beforeDestroy: function() {
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
    }
    if (this._levelDebounce) {
      clearTimeout(this._levelDebounce);
    }
    this._clearAllTypingTimers();
    document.removeEventListener('click', this.onDocumentClick);
    if (this._wsHandlers) {
      var handlerKeys = Object.keys(this._wsHandlers);
      for (var hki = 0; hki < handlerKeys.length; hki++) {
        wsManager.off(handlerKeys[hki], this._wsHandlers[handlerKeys[hki]]);
      }
      this._wsHandlers = {};
    }
  },
  methods: {
    // 安全获取字符串首字符（支持 emoji / 数学粗体等代理对字符）
    firstChar: function(str) {
      var chars = Array.from(str || '?');
      return chars[0] || '?';
    },
    onDocumentClick: function() {
      if (this.showContextMenu) {
        this.closeContextMenu();
      }
      if (this.showReactionPicker) {
        this.closeReactionPicker();
      }
    },
    connectWS: function() {
      var self = this;

      if (self._wsHandlers) {
        var handlerKeys = Object.keys(self._wsHandlers);
        for (var hki = 0; hki < handlerKeys.length; hki++) {
          wsManager.off(handlerKeys[hki], self._wsHandlers[handlerKeys[hki]]);
        }
      }
      self._wsHandlers = {};

      self._wsHandlers['connected'] = function(data) {
        self.wsConnecting = false;
        self._processConnectedData(data);
      };
      wsManager.on('connected', self._wsHandlers['connected']);

      self._wsHandlers['_wsOpen'] = function() {
      };
      wsManager.on('_wsOpen', self._wsHandlers['_wsOpen']);

      self._wsHandlers['_wsClose'] = function() {
        self.wsConnecting = true;
      };
      wsManager.on('_wsClose', self._wsHandlers['_wsClose']);

      self._wsHandlers['_wsTimeout'] = function() {
        self.wsConnecting = false;
        self.$store.commit('toast/SHOW_TOAST', { message: '连接超时，请检查网络', type: 'error' });
      };
      wsManager.on('_wsTimeout', self._wsHandlers['_wsTimeout']);

      self._wsHandlers['_wsError'] = function() {
        self.wsConnecting = false;
        self.$store.commit('toast/SHOW_TOAST', { message: '连接失败，请重试', type: 'error' });
      };
      wsManager.on('_wsError', self._wsHandlers['_wsError']);

      self._wsHandlers['message_sent'] = function(data) {
        if (data && data.success && data.message_id) {
          if (data.temp_id) {
            self.$store.commit('chat/UPDATE_MESSAGE_ID', { oldId: data.temp_id, newId: data.message_id });
          }
        }
      };
      wsManager.on('message_sent', self._wsHandlers['message_sent']);

      self._wsHandlers['new_message'] = function(data) {
        if (data.message) {
          var isOwn = data.message.sender_id === (self.currentUser ? self.currentUser.user_id : '');
          // 统一通过 ADD_MESSAGE 添加，ADD_MESSAGE 内部有完善的去重逻辑
          self.$store.commit('chat/ADD_MESSAGE', data.message);
          if (self.currentChat !== 'public' && !isOwn) {
            var count = self.$store.state.chat.unread['public'] || 0;
            self.$store.commit('chat/SET_UNREAD', { chatId: 'public', count: count + 1 });
          }
          if (!isOwn) {
            self.playNotificationSound();
          }
          self.$nextTick(function() {
            if (isOwn) {
              self.scrollToBottom();
            } else {
              self.scrollToBottomIfNear();
            }
          });
        }
      };
      wsManager.on('new_message', self._wsHandlers['new_message']);

      self._wsHandlers['private_message'] = function(data) {
        if (data.message) {
          var chatId = data.from_user_id;
          var isPmOwn = data.message.sender_id === (self.currentUser ? self.currentUser.user_id : '') ||
                        data.message.from_user_id === (self.currentUser ? self.currentUser.user_id : '');
          if (isPmOwn) {
            var pmServerMsgId = data.message.id || data.message.message_id;
            if (pmServerMsgId) {
              var pmTempId = data.message.temp_id || data.temp_id;
              var pmMatched = false;
              if (pmTempId) {
                self.$store.commit('chat/REPLACE_TEMP_MESSAGE', { chatId: chatId, tempId: pmTempId, messageId: pmServerMsgId });
                pmMatched = true;
              }
              if (!pmMatched) {
                var pmMsgs = self.$store.state.chat.privateChats[chatId];
                if (pmMsgs) {
                  for (var pmi = pmMsgs.length - 1; pmi >= 0; pmi--) {
                    if (pmMsgs[pmi].sender_id === data.message.sender_id &&
                        pmMsgs[pmi].content === data.message.content && !pmMsgs[pmi]._serverId) {
                      self.$store.commit('chat/REPLACE_TEMP_MESSAGE', {
                        chatId: chatId,
                        tempId: pmMsgs[pmi].tempId || pmMsgs[pmi].id,
                        messageId: pmServerMsgId
                      });
                      pmMatched = true;
                      break;
                    }
                  }
                }
              }
              if (!pmMatched) {
                self.$store.commit('chat/ADD_MESSAGE', Object.assign({}, data.message, { chatId: chatId }));
              }
            }
          } else {
            self.$store.commit('chat/ADD_MESSAGE', Object.assign({}, data.message, { chatId: chatId }));
          }
          if (!isPmOwn && self.currentChat !== chatId) {
            var count = self.$store.state.chat.unread[chatId] || 0;
            self.$store.commit('chat/SET_UNREAD', { chatId: chatId, count: count + 1 });
          }
          if (!isPmOwn && !self.$store.getters['chat/isDnd'](chatId)) {
            self.playNotificationSound();
          }
          if (self.currentChat === chatId) {
            self.sendMarkRead();
          }
          self.$nextTick(function() {
            self.scrollToBottomIfNear();
          });
        }
      };
      wsManager.on('private_message', self._wsHandlers['private_message']);

      self._wsHandlers['private_message_sent'] = function(data) {
        if (data && data.success && data.message_id) {
          var targetUserId = data.target_user_id || self.currentChat;
          if (data.temp_id) {
            self.$store.commit('chat/REPLACE_TEMP_MESSAGE', {
              chatId: targetUserId,
              tempId: data.temp_id,
              messageId: data.message_id
            });
          }
        }
      };
      wsManager.on('private_message_sent', self._wsHandlers['private_message_sent']);

      self._wsHandlers['group_message_sent'] = function(data) {
        if (data && data.success && data.message_id) {
          var groupId = data.group_id;
          if (data.temp_id && groupId) {
            self.$store.commit('chat/UPDATE_GROUP_MESSAGE_ID', { groupId: groupId, oldId: data.temp_id, newId: data.message_id });
          }
        }
      };
      wsManager.on('group_message_sent', self._wsHandlers['group_message_sent']);

      self._wsHandlers['group_message'] = function(data) {
        var groupId = data.group_id;
        var isOwn = data.message && data.message.sender_id === (self.currentUser ? self.currentUser.user_id : '');
        // 统一通过 ADD_GROUP_MESSAGE 添加，内部有完善的去重逻辑
        self.$store.commit('chat/ADD_GROUP_MESSAGE', { groupId: groupId, message: data.message });
        if (self.currentChat !== groupId) {
          var count = self.$store.state.chat.unread[groupId] || 0;
          self.$store.commit('chat/SET_UNREAD', { chatId: groupId, count: count + 1 });
        }
        if (!isOwn && !self.$store.getters['chat/isDnd'](groupId)) {
          self.playNotificationSound();
        }
        self.$nextTick(function() {
          if (isOwn) {
            self.scrollToBottom();
          } else {
            self.scrollToBottomIfNear();
          }
        });
      };
      wsManager.on('group_message', self._wsHandlers['group_message']);

      self._wsHandlers['group_created'] = function(data) {
        self.$store.dispatch('chat/loadGroups');
        if (data.group_id) {
          self.$store.commit('chat/ADD_GROUP', {
            group_id: data.group_id,
            group_name: data.group_name || '新群组',
            creator_id: '',
            member_count: 0,
            announcement: '',
            announcement_at: null,
            created_at: new Date().toISOString()
          });
        }
      };
      wsManager.on('group_created', self._wsHandlers['group_created']);

      self._wsHandlers['group_member_joined'] = function(data) {
        self.$store.dispatch('chat/loadGroups');
        if (self.currentChat === data.group_id) {
          self.$store.dispatch('chat/loadGroupMembers', data.group_id);
        }
        var userName = data.user_name || data.net_name || data.user_id || '用户';
        self.$store.commit('chat/ADD_SYSTEM_MESSAGE', {
          groupId: data.group_id,
          content: userName + ' 加入了群聊'
        });
      };
      wsManager.on('group_member_joined', self._wsHandlers['group_member_joined']);

      self._wsHandlers['group_member_left'] = function(data) {
        var groupId = data.group_id;
        var userId = data.user_id;
        var currentUserId = self.currentUser ? self.currentUser.user_id : '';
        var userName = data.user_name || data.net_name || userId || '用户';
        self.$store.commit('chat/ADD_SYSTEM_MESSAGE', {
          groupId: groupId,
          content: userName + ' 退出了群聊'
        });
        if (userId === currentUserId) {
          self.$store.commit('chat/REMOVE_GROUP', groupId);
          if (self.currentChat === groupId) {
            self.activeTab = 'public';
            self.currentChat = 'public';
            self.$store.commit('chat/SET_CURRENT_CHAT', 'public');
          }
          self.showGroupSettings = false;
        } else {
          if (self.currentChat === groupId) {
            self.$store.dispatch('chat/loadGroupMembers', groupId);
          }
          self.$store.dispatch('chat/loadGroups');
        }
      };
      wsManager.on('group_member_left', self._wsHandlers['group_member_left']);

      self._wsHandlers['group_dissolved'] = function(data) {
        self.$store.commit('chat/ADD_SYSTEM_MESSAGE', {
          groupId: data.group_id,
          content: '群聊已解散'
        });
        self.$store.commit('chat/REMOVE_GROUP', data.group_id);
        if (self.currentChat === data.group_id) {
          self.activeTab = 'public';
          self.currentChat = 'public';
          self.$store.commit('chat/SET_CURRENT_CHAT', 'public');
        }
        self.showGroupSettings = false;
      };
      wsManager.on('group_dissolved', self._wsHandlers['group_dissolved']);

      self._wsHandlers['group_transferred'] = function(data) {
        var newOwnerName = data.new_owner_name || data.net_name || data.new_owner_id || '新群主';
        self.$store.commit('chat/ADD_SYSTEM_MESSAGE', {
          groupId: data.group_id,
          content: '群主已转让给 ' + newOwnerName
        });
        self.$store.dispatch('chat/loadGroups');
        if (self.currentChat === data.group_id) {
          self.$store.dispatch('chat/loadGroupMembers', data.group_id);
        }
        self.$store.commit('chat/UPDATE_GROUP', {
          group_id: data.group_id,
          creator_id: data.new_owner_id
        });
      };
      wsManager.on('group_transferred', self._wsHandlers['group_transferred']);

      self._wsHandlers['group_announcement'] = function(data) {
        self.$store.commit('chat/UPDATE_GROUP', {
          group_id: data.group_id,
          announcement: data.announcement,
          announced_by: data.announced_by,
          announcement_at: data.announcement_at
        });
        self.$store.dispatch('chat/loadGroups').then(function() {
          self.checkAndShowAnnouncement(data.group_id);
        });
      };
      wsManager.on('group_announcement', self._wsHandlers['group_announcement']);

      self._wsHandlers['group_member_kicked'] = function(data) {
        var groupId = data.group_id;
        var kickedUserId = data.user_id;
        var kickedByName = data.kicked_by || '群主';
        var kickedMember = self.contacts.find(function(c) { return c.user_id === kickedUserId; });
        var kickedName = kickedMember ? (kickedMember.net_name || kickedMember.real_name) : kickedUserId;
        self.$store.commit('chat/ADD_SYSTEM_MESSAGE', {
          groupId: groupId,
          content: kickedName + ' 被移出群聊'
        });
        var currentUserId = self.currentUser ? self.currentUser.user_id : '';
        if (kickedUserId === currentUserId) {
          self.$store.commit('chat/REMOVE_GROUP', groupId);
          if (self.currentChat === groupId) {
            self.activeTab = 'public';
            self.currentChat = 'public';
            self.$store.commit('chat/SET_CURRENT_CHAT', 'public');
          }
          self.showGroupSettings = false;
        } else {
          if (self.currentChat === groupId) {
            self.$store.dispatch('chat/loadGroupMembers', groupId);
          }
          self.$store.dispatch('chat/loadGroups');
        }
      };
      wsManager.on('group_member_kicked', self._wsHandlers['group_member_kicked']);

      self._wsHandlers['group_renamed'] = function(data) {
        self.$store.commit('chat/UPDATE_GROUP', {
          group_id: data.group_id,
          group_name: data.new_name
        });
      };
      wsManager.on('group_renamed', self._wsHandlers['group_renamed']);

      self._wsHandlers['message_recalled'] = function(data) {
        var chatType = data.message_type;
        var messageId = data.message_id;
        var chatId = '';

        if (chatType === 'public') {
          chatId = 'public';
        } else if (chatType === 'group') {
          chatId = data.group_id || '';
        } else if (chatType === 'private') {
          chatId = data.chat_id || '';
          if (!chatId) {
            var privateChats = self.$store.state.chat.privateChats;
            var keys = Object.keys(privateChats);
            for (var i = 0; i < keys.length; i++) {
              var msgs = privateChats[keys[i]];
              if (msgs) {
                for (var j = 0; j < msgs.length; j++) {
                  if (msgs[j].id === messageId || msgs[j].message_id === messageId) {
                    chatId = keys[i];
                    break;
                  }
                }
              }
              if (chatId) break;
            }
          }
        }

        if (chatId) {
          self.$store.commit('chat/RECALL_MESSAGE', {
            chatType: chatType,
            chatId: chatId,
            messageId: messageId
          });
        }
      };
      wsManager.on('message_recalled', self._wsHandlers['message_recalled']);

      self._wsHandlers['user_online'] = function(data) {
        if (data.user_info) {
          var users = self.$store.state.chat.onlineUsers.slice();
          var exists = users.some(function(u) { return u.user_id === data.user_info.user_id; });
          if (!exists) {
            users.push(data.user_info);
            self.$store.commit('chat/SET_ONLINE_USERS', users);
          }
        }
      };
      wsManager.on('user_online', self._wsHandlers['user_online']);

      self._wsHandlers['user_offline'] = function(data) {
        var users = self.$store.state.chat.onlineUsers.filter(function(u) {
          return u.user_id !== data.user_id;
        });
        self.$store.commit('chat/SET_ONLINE_USERS', users);
      };
      wsManager.on('user_offline', self._wsHandlers['user_offline']);

      self._wsHandlers['remote_user_online'] = function(data) {
        if (data.user_info) {
          self.$store.commit('chat/ADD_REMOTE_ONLINE_USER', data.user_info);
        }
      };
      wsManager.on('remote_user_online', self._wsHandlers['remote_user_online']);

      self._wsHandlers['remote_user_offline'] = function(data) {
        self.$store.commit('chat/REMOVE_REMOTE_ONLINE_USER', data.user_id);
      };
      wsManager.on('remote_user_offline', self._wsHandlers['remote_user_offline']);

      self._wsHandlers['remote_users_sync'] = function(data) {
        if (data.remote_users) {
          var ruArray = [];
          for (var ruid in data.remote_users) {
            ruArray.push(data.remote_users[ruid]);
          }
          self.$store.commit('chat/SET_REMOTE_ONLINE_USERS', ruArray);
        }
      };
      wsManager.on('remote_users_sync', self._wsHandlers['remote_users_sync']);

      self._wsHandlers['community_event'] = function(data) {
        if (data.action === 'create_post' && data.post) {
          self.$store.commit('chat/ADD_REMOTE_POST', data.post);
        }
      };
      wsManager.on('community_event', self._wsHandlers['community_event']);

      self._wsHandlers['user_typing'] = function(data) {
        var userId = data.from_user_id;
        var userName = data.from_user_name || data.sender_name || userId;
        var chatId = data.group_id || data.from_user_id;

        if (chatId !== self.currentChat && data.from_user_id !== self.currentChat) return;

        var existingIndex = -1;
        for (var i = 0; i < self.typingUsers.length; i++) {
          if (self.typingUsers[i].user_id === userId) {
            existingIndex = i;
            break;
          }
        }

        if (existingIndex === -1) {
          self.typingUsers.push({ user_id: userId, user_name: userName });
        } else {
          self.$set(self.typingUsers, existingIndex, { user_id: userId, user_name: userName });
        }

        if (!self._typingTimers) self._typingTimers = {};
        if (self._typingTimers[userId]) {
          clearTimeout(self._typingTimers[userId]);
        }

        self._typingTimers[userId] = setTimeout(function() {
          var idx = -1;
          for (var j = 0; j < self.typingUsers.length; j++) {
            if (self.typingUsers[j].user_id === userId) {
              idx = j;
              break;
            }
          }
          if (idx > -1) {
            self.typingUsers.splice(idx, 1);
          }
          delete self._typingTimers[userId];
        }, 3000);
      };
      wsManager.on('user_typing', self._wsHandlers['user_typing']);

      self._wsHandlers['message_read'] = function(data) {
        if (data && data.message_id) {
          self.$set(self.readReceipts, data.message_id, true);
        }
      };
      wsManager.on('message_read', self._wsHandlers['message_read']);

      autoConnect();

      if (wsManager.isReady()) {
        self.wsConnecting = false;
        var cached = wsManager.getLastConnectedData();
        if (cached) {
          self._processConnectedData(cached);
        }
      }
    },
    _processConnectedData: function(data) {
      var self = this;
      var usersArray = [];
      if (data.users) {
        for (var uid in data.users) {
          usersArray.push(data.users[uid]);
        }
      }
      self.$store.commit('chat/SET_ONLINE_USERS', usersArray);
      var remoteUsersArray = [];
      if (data.remote_users) {
        for (var ruid in data.remote_users) {
          remoteUsersArray.push(data.remote_users[ruid]);
        }
      }
      self.$store.commit('chat/SET_REMOTE_ONLINE_USERS', remoteUsersArray);
      if (data.history && data.history.length > 0) {
        self.$store.commit('chat/SET_MESSAGES', data.history);
      }
      if (data.groups && data.groups.length > 0) {
        var existingGroups = self.$store.state.chat.groups;
        var normalizedGroups = data.groups.map(function(g) {
          var gid = g.group_id || g.id;
          var existing = existingGroups.find(function(eg) { return eg.group_id === gid; });
          return {
            group_id: gid,
            group_name: g.group_name || g.name,
            creator_id: g.creator_id,
            member_count: g.member_count || (g.members ? g.members.length : 0),
            announcement: g.announcement || '',
            announcement_at: g.announcement_at || null,
            created_at: g.created_at,
            is_class_group: !!g.is_class_group,
            last_message: existing ? existing.last_message : undefined,
            last_message_type: existing ? existing.last_message_type : undefined,
            last_message_sender: existing ? existing.last_message_sender : undefined,
            last_message_sender_id: existing ? existing.last_message_sender_id : undefined,
            last_message_at: existing ? existing.last_message_at : undefined
          };
        });
        self.$store.commit('chat/SET_GROUPS', normalizedGroups);
      }
      self.$nextTick(function() {
        self.scrollToBottom();
      });
    },
    switchTab: function(tab) {
      this.activeTab = tab;
      if (tab === 'public' && this.isGroupChat(this.currentChat)) {
        var isClass = this.classGroups.some(function(g) { return g.group_id === this.currentChat; }.bind(this));
        if (isClass) return;
      }
      if (tab !== 'public' && this.currentChat === 'public') {
        // keep public selected, just switch tab view
      }
    },
    isGroupChat: function(chatId) {
      if (!chatId) return false;
      if (chatId === 'public') return false;
      if (chatId.indexOf('group_') === 0) return true;
      if (chatId.indexOf('class_') === 0) return true;
      return false;
    },
    getAvatarColor: function(userId) {
      return helpers.getAvatarColor(userId);
    },
    getContactDisplayName: function(contact) {
      if (!contact) return '';
      var remark = this.friendRemarks[contact.user_id];
      if (remark) return remark;
      return contact.net_name || contact.real_name || contact.user_id || '?';
    },
    loadFriendRemarks: function() {
      try {
        var stored = localStorage.getItem('classnet_friend_remarks');
        if (stored) {
          this.friendRemarks = JSON.parse(stored);
        }
      } catch (e) {}
    },
    setFriendRemark: function(userId, remark) {
      if (remark && remark.trim()) {
        this.$set(this.friendRemarks, userId, remark.trim());
      } else {
        this.$delete(this.friendRemarks, userId);
      }
      try {
        localStorage.setItem('classnet_friend_remarks', JSON.stringify(this.friendRemarks));
      } catch (e) {}
    },
    isTabActive: function(tabKey) {
      if (tabKey === 'public') {
        if (this.activeTab === 'public') return true;
        if (this.isGroupChat(this.currentChat)) {
          var isClass = this.classGroups.some(function(g) { return g.group_id === this.currentChat; }.bind(this));
          if (isClass) return true;
        }
        return false;
      }
      return this.activeTab === tabKey;
    },
    selectChat: function(chatId) {
      var self = this;
      self.showSearch = false;
      self.searchText = '';
      self.showUnreadDivider = false;
      self.cancelReply();
      if (self.isGroupChat(chatId)) {
        var isClass = self.classGroups.some(function(g) { return g.group_id === chatId; });
        if (isClass) {
          self.activeTab = 'public';
        }
      }
      var prevUnread = self.$store.state.chat.unread[chatId] || 0;
      if (prevUnread > 0) {
        self.unreadCountOnEnter = prevUnread;
        self.showUnreadDivider = true;
        // Calculate lastReadMessageId
        var chatMsgs;
        if (chatId === 'public') {
          chatMsgs = self.$store.state.chat.messages;
        } else if (self.isGroupChat(chatId)) {
          chatMsgs = self.$store.state.chat.groupChats[chatId] || [];
        } else {
          chatMsgs = self.$store.state.chat.privateChats[chatId] || [];
        }
        if (chatMsgs.length > prevUnread) {
          var lastReadMsg = chatMsgs[chatMsgs.length - prevUnread - 1];
          self.lastReadMessageId = lastReadMsg ? (lastReadMsg.id || lastReadMsg.message_id) : null;
        } else {
          self.lastReadMessageId = null;
        }
      } else {
        self.lastReadMessageId = null;
      }
      self.prevChatId = self.currentChat;
      self.currentChat = chatId;
      self.chatHasMore = true;
      self.chatLoadingMore = false;
      self.$store.commit('chat/SET_CURRENT_CHAT', chatId);
      self.$store.commit('chat/CLEAR_UNREAD', chatId);
      if (chatId === 'public') {
        // nothing extra
      } else if (self.isGroupChat(chatId)) {
        self.$store.dispatch('chat/loadGroupMessages', chatId).then(function() {
          self.$nextTick(function() {
            self.scrollToBottom();
            self.checkAndShowAnnouncement(chatId);
          });
        });
        return;
      } else {
        self.$store.dispatch('chat/loadPrivateMessages', chatId).then(function() {
          self.$nextTick(function() {
            self.scrollToBottom();
          });
          self.sendMarkRead();
        });
      }
    },
    isOwnMessage: function(msg) {
      var user = this.currentUser;
      return user && (msg.sender_id === user.user_id || msg.user_id === user.user_id);
    },
    getSenderRole: function(userId) {
      if (!userId) return '';
      var user = this.currentUser;
      if (user && userId === user.user_id) {
        if (user.is_admin === 1) return 'admin';
        if (user.role === 'officer') return 'officer';
        return '';
      }
      var contact = this.contacts.find(function(c) { return c.user_id === userId; });
      if (contact) {
        if (contact.role === 'admin' || contact.is_admin === 1) return 'admin';
        if (contact.role === 'officer') return 'officer';
      }
      return '';
    },
    getSenderTitle: function(userId) {
      if (!userId) return '';
      var user = this.currentUser;
      if (user && userId === user.user_id) {
        return user.officer_title || '';
      }
      var contact = this.contacts.find(function(c) { return c.user_id === userId; });
      if (contact) return contact.officer_title || '';
      return '';
    },
    canRecallMessage: function(msg) {
      if (msg.recalled === 1) return false;
      if (!this.isOwnMessage(msg)) return false;
      var createdAt = new Date(msg.created_at).getTime();
      var now = Date.now();
      return (now - createdAt) < 2 * 60 * 1000;
    },
    recallMessage: function(msg) {
      var self = this;
      var messageType = 'public';
      var chatId = self.currentChat;
      var groupId = '';
      if (self.currentChat === 'public') {
        messageType = 'public';
        chatId = 'public';
      } else if (self.isGroupChat(self.currentChat)) {
        messageType = 'group';
        chatId = self.currentChat;
        groupId = self.currentChat;
      } else {
        messageType = 'private';
        chatId = self.currentChat;
      }
      self.$store
        .dispatch('chat/recallMessage', {
          messageType: messageType,
          messageId: msg.id || msg.message_id,
          chatId: chatId,
          groupId: groupId
        })
        .catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '撤回失败', type: 'error' });
        });
    },
    sendMessage: function(options) {
      var self = this;
      var isForward = !!(options && options.forwardData);
      var rawContent = isForward ? JSON.stringify(options.forwardData) : self.inputText.trim();
      // 将云盘媒体标记转换为实际 URL
      var content = rawContent.replace(/\[cloud-(img|video|audio):([^\]]+)\]/g, function(match, tag, filename) {
        return '/api/cloud/files/' + encodeURIComponent(filename);
      });
      var msgType = isForward ? 'community_forward' : 'text';
      if (!content || self.sending) return;
      var user = self.currentUser;
      var msgId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6);
      var msg = {
        id: msgId,
        tempId: msgId,
        type: msgType,
        content: content,
        sender_id: user ? user.user_id : '',
        sender_name: user ? user.net_name : '',
        chatId: self.currentChat,
        created_at: new Date().toISOString()
      };
      // Include reply_to if replying
      if (self.replyingTo) {
        msg.reply_to = {
          message_id: self.replyingTo.message_id,
          user_name: self.replyingTo.user_name,
          content_preview: self.replyingTo.content_preview
        };
      }
      self.sending = true;
      self.$set(self.messageStatuses, msgId, 'sending');
      var sendAction;
      if (self.currentChat === 'public') {
        sendAction = 'chat/sendMessage';
      } else if (self.isGroupChat(self.currentChat)) {
        sendAction = 'chat/sendGroupMessage';
      } else {
        sendAction = 'chat/sendPrivateMessage';
      }
      var payload = Object.assign({}, msg, { msg_type: msgType });
      self.$store
        .dispatch(sendAction, payload)
        .then(function() {
          self.$set(self.messageStatuses, msgId, 'sent');
          if (!isForward) {
            self.inputText = '';
          }
          // Clear reply state after sending
          if (self.replyingTo) {
            self.replyingTo = null;
          }
          self.$nextTick(function() {
            self.scrollToBottom();
          });
        })
        .catch(function() {
          self.$set(self.messageStatuses, msgId, 'failed');
          self.$store.commit('toast/SHOW_TOAST', { message: '消息发送失败，请重试', type: 'error' });
        })
        .finally(function() {
          self.sending = false;
        });
    },
    insertEmoji: function(emoji) {
      this.inputText += emoji;
      this.showEmoji = false;
    },
    onCloudImageSelect: function(file) {
      var lower = (file.name || '').toLowerCase();
      var tag = 'cloud-img';
      if (lower.indexOf('__video') > -1 || lower.indexOf('.mp4') > -1 || lower.indexOf('.mov') > -1 ||
          lower.indexOf('.webm') > -1 || lower.indexOf('.mkv') > -1 || lower.indexOf('.avi') > -1 || lower.indexOf('.3gp') > -1) {
        tag = 'cloud-video';
      } else if (lower.indexOf('__audio') > -1 || lower.indexOf('.mp3') > -1 || lower.indexOf('.m4a') > -1 ||
                 lower.indexOf('.aac') > -1 || lower.indexOf('.wav') > -1 || lower.indexOf('.ogg') > -1 || lower.indexOf('.opus') > -1) {
        tag = 'cloud-audio';
      }
      this.inputText += '[' + tag + ':' + file.name + ']';
      this.showCloudPicker = false;
    },
    scrollToBottom: function() {
      var self = this;
      self.$nextTick(function() {
        var container = self.$refs.messageContainer;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    },
    isNearBottom: function() {
      var container = this.$refs.messageContainer;
      if (!container) return true;
      var threshold = 150;
      var distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      return distanceFromBottom <= threshold;
    },
    scrollToBottomIfNear: function() {
      var self = this;
      self.$nextTick(function() {
        var container = self.$refs.messageContainer;
        if (container) {
          var threshold = 150;
          if (container.scrollHeight - container.scrollTop - container.clientHeight < threshold) {
            container.scrollTop = container.scrollHeight;
          }
        }
      });
    },
    scrollToMessage: function(messageId) {
      var self = this;
      var container = self.$refs.messageContainer;
      if (!container) return;
      // Find the DOM element for the message
      var msgElements = container.querySelectorAll('.chat-bubble-wrapper');
      var msgs = self.filteredMessages;
      for (var i = 0; i < msgs.length; i++) {
        var msg = msgs[i];
        var msgId = msg.id || msg.message_id;
        if (msgId === messageId && msgElements[i]) {
          msgElements[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Brief highlight effect
          var bubble = msgElements[i].querySelector('.chat-bubble');
          if (bubble) {
            bubble.style.transition = 'background 0.3s';
            bubble.style.boxShadow = '0 0 0 2px var(--primary-color)';
            setTimeout(function() {
              bubble.style.boxShadow = '';
            }, 1500);
          }
          break;
        }
      }
    },
    getPrivatePreview: function(chatId) {
      var msgs = this.$store.state.chat.privateChats[chatId];
      if (msgs && msgs.length > 0) {
        var last = msgs[msgs.length - 1];
        if (last.recalled === 1) return '[消息已撤回]';
        var prefix = this.isOwnMessage(last) ? '你: ' : '';
        var content = last.content || '';
        if (last.type === 'community_forward') {
          try { var fwd = JSON.parse(content); content = '[分享] ' + (fwd.title || fwd.dish_name || '帖子'); } catch (e) {}
        }
        return prefix + content.substring(0, 20);
      }
      var contact = this.contacts.find(function(c) { return c.user_id === chatId; });
      if (contact && contact.last_message) {
        var userId = this.currentUser ? this.currentUser.user_id : '';
        var prefix = contact.last_message_sender_id === userId ? '你: ' : '';
        var content = contact.last_message || '';
        if (contact.last_message_type === 'community_forward') {
          try { var fwd = JSON.parse(content); content = '[分享] ' + (fwd.title || fwd.dish_name || '帖子'); } catch (e) {}
        }
        return prefix + content.substring(0, 20);
      }
      return '暂无消息';
    },
    getGroupPreview: function(groupId) {
      var msgs = this.$store.state.chat.groupChats[groupId];
      if (msgs && msgs.length > 0) {
        var last = msgs[msgs.length - 1];
        if (last.type === 'system') return last.content || '';
        if (last.recalled === 1) return '[消息已撤回]';
        var name = last.sender_name || '';
        var prefix = this.isOwnMessage(last) ? '你' : name;
        var content = last.content || '';
        if (last.type === 'community_forward') {
          try { var fwd = JSON.parse(content); content = '[分享] ' + (fwd.title || fwd.dish_name || '帖子'); } catch (e) {}
        }
        return prefix + ': ' + content.substring(0, 15);
      }
      var group = this.groups.find(function(g) { return g.group_id === groupId; });
      if (group && group.last_message) {
        var userId = this.currentUser ? this.currentUser.user_id : '';
        var sender = group.last_message_sender || '';
        if (group.last_message_sender_id === userId) sender = '你';
        var content = group.last_message || '';
        if (group.last_message_type === 'community_forward') {
          try { var fwd = JSON.parse(content); content = '[分享] ' + (fwd.title || fwd.dish_name || '帖子'); } catch (e) {}
        }
        return sender + ': ' + content.substring(0, 15);
      }
      return group ? (group.member_count || 0) + ' 人' : '';
    },
    formatRelativeTime: function(dateStr) {
      if (!dateStr) return '';
      var date = new Date(dateStr);
      if (isNaN(date.getTime())) return '';
      var now = new Date();
      var diff = now.getTime() - date.getTime();
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
      var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      var yesterdayStart = todayStart - 86400000;
      if (date.getTime() >= todayStart) return Math.floor(diff / 3600000) + '小时前';
      if (date.getTime() >= yesterdayStart) return '昨天';
      var month = (date.getMonth() + 1).toString().padStart(2, '0');
      var day = date.getDate().toString().padStart(2, '0');
      return month + '/' + day;
    },
    getContactLastTime: function(chatId) {
      var msgs = this.$store.state.chat.privateChats[chatId];
      if (msgs && msgs.length > 0) {
        var last = msgs[msgs.length - 1];
        return this.formatRelativeTime(last.created_at);
      }
      var contact = this.contacts.find(function(c) { return c.user_id === chatId; });
      if (contact && contact.last_message_at) {
        return this.formatRelativeTime(contact.last_message_at);
      }
      return '';
    },
    getGroupLastTime: function(groupId) {
      var msgs = this.$store.state.chat.groupChats[groupId];
      if (msgs && msgs.length > 0) {
        var last = msgs[msgs.length - 1];
        if (last.created_at) return this.formatRelativeTime(last.created_at);
      }
      var group = this.groups.find(function(g) { return g.group_id === groupId; });
      if (group && group.last_message_at) {
        return this.formatRelativeTime(group.last_message_at);
      }
      return '';
    },
    isGroupOwner: function(group) {
      var user = this.currentUser;
      return user && group && group.creator_id === user.user_id;
    },
    isUserOnline: function(userId) {
      var local = this.onlineUsers.some(function(u) { return u.user_id === userId; });
      if (local) return true;
      return this.remoteOnlineUsers.some(function(u) { return u.user_id === userId; });
    },
    isRemoteUser: function(userId) {
      // 优先检查联系人列表中的 remote 标记
      var contact = this.contacts.find(function(c) { return c.user_id === userId; });
      if (contact && contact.remote) return true;
      // 也检查远程在线用户列表
      return this.remoteOnlineUsers.some(function(u) { return u.user_id === userId; });
    },
    getGroupColor: function(groupId) {
      var colors = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30', '#5AC8FA', '#8E8E93', '#FF2D55'];
      var hash = 0;
      for (var i = 0; i < groupId.length; i++) {
        hash = ((hash << 5) - hash) + groupId.charCodeAt(i);
        hash = hash & hash;
      }
      return colors[Math.abs(hash) % colors.length];
    },
    isDndChat: function(chatId) {
      return this.$store.getters['chat/isDnd'](chatId);
    },
    isPinnedChat: function(chatId) {
      return this.$store.getters['chat/isPinned'](chatId);
    },
    openSettings: function() {
      if (this.currentChat === 'public') {
        this.showPublicSettings = true;
      } else if (this.isGroupChat(this.currentChat)) {
        this.openGroupSettings();
      } else {
        this.showPrivateSettings = true;
      }
    },
    openGroupSettings: function() {
      this.showGroupSettings = true;
      this.$store.dispatch('chat/loadGroupMembers', this.currentChat);
    },
    closeGroupSettings: function() {
      this.showGroupSettings = false;
      this.showAnnouncementEditor = false;
    },
    openInviteModal: function() {
      this.inviteGroupId = this.currentChat;
      this.inviteUserIds = [];
      this.showInviteModal = true;
    },
    inviteSelectedUsers: function() {
      var self = this;
      for (var i = 0; i < self.inviteUserIds.length; i++) {
        self.$store.dispatch('chat/inviteToGroup', {
          groupId: self.inviteGroupId,
          userId: self.inviteUserIds[i]
        });
      }
      self.showInviteModal = false;
      self.inviteUserIds = [];
      self.$store.commit('toast/SHOW_TOAST', { message: '邀请已发送', type: 'success' });
    },
    openTransferModal: function() {
      this.transferGroupId = this.currentChat;
      this.showTransferModal = true;
    },
    confirmTransfer: function(userId) {
      var self = this;
      self.confirmDialog = {
        title: '转让群聊',
        message: '确定要将群聊转让给该成员吗？转让后你将成为普通成员。',
        onConfirm: function() {
          self.$store.dispatch('chat/leaveGroup', {
            groupId: self.transferGroupId,
            newOwnerId: userId
          });
          self.showTransferModal = false;
          self.showGroupSettings = false;
          self.$store.commit('toast/SHOW_TOAST', { message: '群聊已转让', type: 'success' });
        }
      };
    },
    dissolveGroup: function() {
      var self = this;
      var groupId = self.currentChat;
      self.confirmDialog = {
        title: '解散群聊',
        message: '确定要解散该群聊吗？此操作不可撤销。',
        onConfirm: function() {
          self.$store.dispatch('chat/dissolveGroup', groupId);
          self.showGroupSettings = false;
          self.activeTab = 'public';
          self.currentChat = 'public';
          self.$store.commit('chat/SET_CURRENT_CHAT', 'public');
        }
      };
    },
    leaveGroup: function() {
      var self = this;
      var groupId = self.currentChat;
      self.confirmDialog = {
        title: '退出群聊',
        message: '确定要退出该群聊吗？',
        onConfirm: function() {
          self.$store.dispatch('chat/leaveGroup', { groupId: groupId });
          self.showGroupSettings = false;
          self.activeTab = 'public';
          self.currentChat = 'public';
          self.$store.commit('chat/SET_CURRENT_CHAT', 'public');
        }
      };
    },
    onConfirmDialog: function() {
      if (this.confirmDialog && this.confirmDialog.onConfirm) {
        this.confirmDialog.onConfirm();
      }
      this.confirmDialog = null;
    },
    toggleDnd: function(chatId, enabled) {
      this.$store.commit('chat/TOGGLE_DND', { chatId: chatId, enabled: enabled });
    },
    togglePin: function(chatId) {
      this.$store.commit('chat/TOGGLE_PIN', chatId);
    },
    clearPrivateChatHistory: function() {
      var self = this;
      var contactName = self.getContactDisplayName(self.currentPrivateContact);
      self.confirmDialog = {
        title: '清除聊天记录',
        message: '确定要清除与 ' + contactName + ' 的所有聊天记录吗？此操作不可撤销。',
        onConfirm: function() {
          api.delete('/chat/messages/private/' + self.currentChat).then(function(response) {
            var data = response.data;
            var count = (data && data.message) ? (data.message.match(/\d+/) || ['0'])[0] : '';
            self.$store.commit('toast/SHOW_TOAST', { message: '聊天记录已清除' + (count ? '（共 ' + count + ' 条）' : ''), type: 'success' });
            // Clear local store
            self.$store.commit('chat/SET_PRIVATE_MESSAGES', { chatId: self.currentChat, messages: [] });
            self.showPrivateSettings = false;
          }).catch(function() {
            self.$store.commit('toast/SHOW_TOAST', { message: '清除失败，请重试', type: 'error' });
          });
        }
      };
    },
    kickMember: function(member) {
      var self = this;
      var memberName = member.net_name || member.real_name || member.user_id;
      self.confirmDialog = {
        title: '移出成员',
        message: '确定要将 ' + memberName + ' 移出群聊吗？',
        onConfirm: function() {
          self.$store.dispatch('chat/kickMember', {
            groupId: self.currentChat,
            targetUserId: member.user_id
          });
          self.$store.commit('toast/SHOW_TOAST', { message: '已移出成员', type: 'success' });
        }
      };
    },
    startEditGroupName: function() {
      if (!this.isGroupOwnerOfCurrent) return;
      if (this.currentGroup && this.currentGroup.is_class_group) return;
      this.editingGroupName = true;
      this.editingGroupNameText = this.currentGroup ? this.currentGroup.group_name : '';
      var self = this;
      self.$nextTick(function() {
        if (self.$refs.groupNameInput) {
          self.$refs.groupNameInput.focus();
        }
      });
    },
    saveGroupName: function() {
      var self = this;
      var newName = self.editingGroupNameText.trim();
      if (!newName) {
        self.$store.commit('toast/SHOW_TOAST', { message: '群名不能为空', type: 'error' });
        return;
      }
      if (newName.length > 30) {
        self.$store.commit('toast/SHOW_TOAST', { message: '群名不能超过30个字符', type: 'error' });
        return;
      }
      self.$store.dispatch('chat/renameGroup', {
        groupId: self.currentChat,
        newName: newName
      });
      self.editingGroupName = false;
      self.$store.commit('toast/SHOW_TOAST', { message: '群名已更新', type: 'success' });
    },
    editAnnouncement: function() {
      this.showAnnouncementEditor = true;
      this.announcementText = this.currentGroup ? (this.currentGroup.announcement || '') : '';
    },
    saveAnnouncement: function() {
      var self = this;
      var groupId = self.currentChat;
      self.$store.dispatch('chat/setAnnouncement', {
        groupId: groupId,
        announcement: self.announcementText
      });
      self.showAnnouncementEditor = false;
      self.$store.commit('toast/SHOW_TOAST', { message: '公告已更新', type: 'success' });
    },
    checkAndShowAnnouncement: function(groupId) {
      var self = this;
      var group = self.groups.find(function(g) { return g.group_id === groupId; });
      if (!group) return;
      if (!group.announcement) return;
      if (!group.announcement_at) return;

      // 先检查 localStorage 本地缓存，避免频繁请求后端
      var storageKey = 'classnet_announcement_ack_' + groupId;
      var lastAck = localStorage.getItem(storageKey);
      var announcementAt = String(group.announcement_at);
      var annTime = new Date(announcementAt).getTime();
      if (lastAck && !isNaN(annTime)) {
        var ackNum = Number(lastAck);
        if (!isNaN(ackNum) && annTime <= ackNum) return;
      }

      // 调用后端 API 获取确认状态
      api.get('/chat/groups/' + groupId + '/announcement-status').then(function(response) {
        var data = response.data && response.data.data;
        if (data && data.acknowledged && data.acknowledged_at) {
          var ackTime = new Date(data.acknowledged_at).getTime();
          var annTimeInner = new Date(announcementAt).getTime();
          // 更新本地缓存
          if (!isNaN(ackTime)) {
            localStorage.setItem(storageKey, String(ackTime));
          }
          // 如果已确认且确认时间 >= 公告时间，则不再弹窗
          if (!isNaN(ackTime) && !isNaN(annTimeInner) && annTimeInner <= ackTime) return;
        }
        // 未确认或确认时间早于公告时间，显示弹窗
        self.announcementPopupContent = group.announcement;
        self.announcementPopupGroupId = groupId;
        self.showAnnouncementPopup = true;
      }).catch(function() {
        // API 调用失败时，回退到 localStorage 逻辑
        if (lastAck) {
          var ackNum = Number(lastAck);
          if (!isNaN(ackNum) && !isNaN(annTime) && annTime <= ackNum) return;
          if (announcementAt === lastAck) return;
          var ackTime = new Date(lastAck).getTime();
          if (!isNaN(ackTime) && !isNaN(annTime) && annTime <= ackTime) return;
        }
        self.announcementPopupContent = group.announcement;
        self.announcementPopupGroupId = groupId;
        self.showAnnouncementPopup = true;
      });
    },
    acknowledgeAnnouncement: function() {
      var self = this;
      var groupId = self.announcementPopupGroupId;
      var group = self.groups.find(function(g) { return g.group_id === groupId; });

      // 先关闭弹窗，提升用户体验
      self.showAnnouncementPopup = false;
      self.announcementPopupContent = '';
      self.announcementPopupGroupId = '';

      if (!groupId) return;

      // 调用后端 API 保存确认状态
      api.post('/chat/groups/' + groupId + '/acknowledge-announcement').then(function(response) {
        // 同步更新 localStorage 本地缓存
        var storageKey = 'classnet_announcement_ack_' + groupId;
        var data = response.data && response.data.data;
        if (data && data.acknowledged_at) {
          var ackTime = new Date(data.acknowledged_at).getTime();
          if (!isNaN(ackTime)) {
            localStorage.setItem(storageKey, String(ackTime));
          }
        } else if (group && group.announcement_at) {
          var annTime = new Date(group.announcement_at).getTime();
          if (!isNaN(annTime)) {
            localStorage.setItem(storageKey, String(annTime));
          } else {
            localStorage.setItem(storageKey, String(group.announcement_at));
          }
        }
      }).catch(function() {
        // API 调用失败时，回退到 localStorage
        var storageKey = 'classnet_announcement_ack_' + groupId;
        if (group && group.announcement_at) {
          var annTime = new Date(group.announcement_at).getTime();
          if (!isNaN(annTime)) {
            localStorage.setItem(storageKey, String(annTime));
          } else {
            localStorage.setItem(storageKey, String(group.announcement_at));
          }
        }
      });
    },
    createGroup: function() {
      var self = this;
      if (!self.newGroupName.trim() || self.newGroupMembers.length === 0) return;
      self.$store
        .dispatch('chat/createGroup', { group_name: self.newGroupName.trim(), member_ids: self.newGroupMembers })
        .then(function(response) {
          self.showCreateGroup = false;
          self.newGroupName = '';
          self.newGroupMembers = [];
          self.$store.commit('toast/SHOW_TOAST', { message: '群组创建成功', type: 'success' });
          self.$store.dispatch('chat/loadGroups').then(function() {
            var data = response.data && response.data.data;
            if (data && data.group_id) {
              self.activeTab = 'group';
              self.selectChat(data.group_id);
            }
          });
        })
        .catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '群组创建失败', type: 'error' });
        });
    },
    closeCreateGroup: function() {
      this.showCreateGroup = false;
      this.newGroupName = '';
      this.newGroupMembers = [];
    },
    playNotificationSound: function() {
      try {
        if (!this._audioCtx) {
          this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        var audioCtx = this._audioCtx;
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        var oscillator = audioCtx.createOscillator();
        var gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        oscillator.frequency.setValueAtTime(660, audioCtx.currentTime + 0.08);
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.2);
      } catch (e) {
        // ignore audio errors
      }
    },
    getMessageStatus: function(msg) {
      var msgId = msg.id || msg.message_id;
      if (this.messageStatuses[msgId]) {
        return this.messageStatuses[msgId];
      }
      return 'sent';
    },
    shouldShowDateSeparator: function(index) {
      if (index === 0) return true;
      var msgs = this.filteredMessages;
      var prev = msgs[index - 1];
      var curr = msgs[index];
      if (!prev || !curr) return false;
      var prevDate = this.getMessageDate(prev);
      var currDate = this.getMessageDate(curr);
      return prevDate !== currDate;
    },
    getDateLabel: function(index) {
      var msgs = this.filteredMessages;
      var msg = msgs[index];
      if (!msg) return '';
      var date = new Date(msg.created_at);
      var now = new Date();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var yesterday = new Date(today.getTime() - 86400000);
      var dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      if (dateDay.getTime() === today.getTime()) return '今天';
      if (dateDay.getTime() === yesterday.getTime()) return '昨天';
      var month = (date.getMonth() + 1).toString().padStart(2, '0');
      var day = date.getDate().toString().padStart(2, '0');
      return month + '月' + day + '日';
    },
    getMessageDate: function(msg) {
      if (!msg || !msg.created_at) return '';
      var d = new Date(msg.created_at);
      return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    },
    shouldShowTimestamp: function(index) {
      var msgs = this.filteredMessages;
      if (index === 0) return true;
      var prev = msgs[index - 1];
      var curr = msgs[index];
      if (!prev || !curr) return true;
      if (prev.type === 'system' || curr.type === 'system') return true;
      // Different sender always shows timestamp
      if (prev.sender_id !== curr.sender_id) return true;
      // Same sender: show if more than 1 minute apart
      var prevTime = new Date(prev.created_at).getTime();
      var currTime = new Date(curr.created_at).getTime();
      return (currTime - prevTime) >= 60000;
    },
    onMessageScroll: function() {
      // rAF 节流，避免高频滚动事件触发重排
      if (this._scrollRaf) return;
      var self = this;
      this._scrollRaf = requestAnimationFrame(function() {
        self._scrollRaf = null;
        var container = self.$refs.messageContainer;
        if (!container) return;
        if (container.scrollTop <= 50 && !self.chatLoadingMore && self.chatHasMore) {
          self.loadOlderMessages();
        }
      });
    },
    loadOlderMessages: function() {
      var self = this;
      var chatId = self.currentChat;
      if (self.chatLoadingMore) return;

      if (chatId === 'public') {
        var messages = self.$store.state.chat.messages;
        if (!messages || messages.length === 0) return;
        var oldestId = messages[0].id;
        if (!oldestId) return;
        self.chatLoadingMore = true;
        api.get('/chat/messages', { params: { before_id: oldestId, limit: 50 } }).then(function(response) {
          var olderMessages = response.data.data || [];
          var hasMore = response.data.has_more;
          self.chatHasMore = hasMore;
          if (olderMessages.length > 0) {
            var container = self.$refs.messageContainer;
            var prevScrollHeight = container ? container.scrollHeight : 0;
            self.$store.commit('chat/PREPEND_MESSAGES', olderMessages);
            self.$nextTick(function() {
              if (container) {
                var newScrollHeight = container.scrollHeight;
                container.scrollTop = newScrollHeight - prevScrollHeight;
              }
            });
          }
          self.chatLoadingMore = false;
        }).catch(function() {
          self.chatLoadingMore = false;
        });
      } else if (self.isGroupChat(chatId)) {
        var groupMessages = self.$store.state.chat.groupChats[chatId] || [];
        if (groupMessages.length === 0) return;
        var oldestGroupMsgId = groupMessages[0].id;
        if (!oldestGroupMsgId) return;
        if (self.groupLoadingMore[chatId]) return;
        self.$set(self.groupLoadingMore, chatId, true);
        api.get('/chat/groups/' + chatId + '/messages', { params: { before_id: oldestGroupMsgId, limit: 50 } }).then(function(response) {
          var responseData = response.data.data || {};
          var olderMessages = responseData.messages || [];
          var hasMore = responseData.has_more;
          self.$set(self.groupHasMore, chatId, hasMore);
          if (olderMessages.length > 0) {
            var container = self.$refs.messageContainer;
            var prevScrollHeight = container ? container.scrollHeight : 0;
            self.$store.commit('chat/PREPEND_GROUP_MESSAGES', { groupId: chatId, messages: olderMessages });
            self.$nextTick(function() {
              if (container) {
                var newScrollHeight = container.scrollHeight;
                container.scrollTop = newScrollHeight - prevScrollHeight;
              }
            });
          }
          self.$set(self.groupLoadingMore, chatId, false);
        }).catch(function() {
          self.$set(self.groupLoadingMore, chatId, false);
        });
      }
    },
    toggleSearch: function() {
      this.showSearch = !this.showSearch;
      if (this.showSearch) {
        var self = this;
        self.$nextTick(function() {
          if (self.$refs.searchInput) {
            self.$refs.searchInput.focus();
          }
        });
      } else {
        this.searchText = '';
      }
    },
    closeSearch: function() {
      this.showSearch = false;
      this.searchText = '';
    },
    onInputChange: function() {
      this.autoResizeInput();
      if (!this.inputText.trim()) return;
      this.sendTyping();
    },
    sendTyping: function() {
      var self = this;
      if (self.currentChat === 'public') return;
      var now = Date.now();
      if (now - self.lastTypingSent < 3000) return;
      self.lastTypingSent = now;
      var payload = {
        type: 'typing',
        target_user_id: self.currentChat
      };
      if (self.isGroupChat(self.currentChat)) {
        payload.group_id = self.currentChat;
      }
      wsManager.send(payload);
    },
    _clearAllTypingTimers: function() {
      if (this._typingTimers) {
        var keys = Object.keys(this._typingTimers);
        for (var i = 0; i < keys.length; i++) {
          clearTimeout(this._typingTimers[keys[i]]);
        }
        this._typingTimers = {};
      }
    },
    sendForwardTo: function(chatId) {
      var self = this;
      if (!self.pendingForward) return;
      var forwardData = self.pendingForward;
      var isCommunityForward = !!forwardData.postId;
      var isMusicPlaylist = self.pendingForwardType === 'music_playlist' || !!forwardData.playlistId;
      var isAiForward = self.pendingForwardType === 'ai_forward';
      var isAiBatch = self.pendingForwardType === 'ai_batch';
      var msgType = isMusicPlaylist ? 'music_playlist' : (isCommunityForward ? 'community_forward' : (isAiForward ? 'ai_forward' : (isAiBatch ? 'ai_batch' : 'text')));
      var content;
      if (isCommunityForward) {
        content = JSON.stringify(forwardData);
      } else if (isMusicPlaylist) {
        content = JSON.stringify(forwardData);
      } else if (isAiForward) {
        content = JSON.stringify({
          content: forwardData.content,
          role: forwardData.role || 'assistant'
        });
      } else if (isAiBatch) {
        content = JSON.stringify({
          messages: forwardData.messages,
          timestamp: forwardData.timestamp
        });
      } else {
        content = forwardData.content;
      }

      // Optimistic local add so sender sees the forwarded message immediately
      var user = self.currentUser;
      var tempId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6);
      var optimisticMsg = {
        id: tempId,
        tempId: tempId,
        type: msgType,
        content: content,
        sender_id: user ? user.user_id : '',
        sender_name: user ? user.net_name : '',
        chatId: chatId,
        created_at: new Date().toISOString()
      };

      if (chatId === 'public') {
        self.$store.commit('chat/ADD_MESSAGE', optimisticMsg);
        wsManager.send({
          type: 'text',
          content: content,
          msg_type: msgType,
          temp_id: tempId
        });
      } else if (self.isGroupChat(chatId)) {
        self.$store.commit('chat/ADD_GROUP_MESSAGE', { groupId: chatId, message: optimisticMsg });
        wsManager.send({
          type: 'group_message',
          group_id: chatId,
          content: content,
          msg_type: msgType,
          temp_id: tempId
        });
      } else {
        self.$store.commit('chat/ADD_MESSAGE', optimisticMsg);
        wsManager.send({
          type: 'private_message',
          target_user_id: chatId,
          content: content,
          msg_type: msgType,
          temp_id: tempId
        });
      }

      // Increment share count for community forwards (fire-and-forget)
      if (isCommunityForward && forwardData.postId) {
        self.$store.dispatch('community/incrementShareCount', forwardData.postId).catch(function() {});
      }

      self.showForwardModal = false;
      self.pendingForward = null;
      self.pendingForwardType = 'community_forward';

      // AI 转发：用户已在聊天页，消息会立即出现，无需弹出成功对话框
      if (isAiForward) return;
      // AI 批量转发：同上，无需弹出成功对话框
      if (isAiBatch) return;

      var targetName = '公共聊天室';
      if (self.isGroupChat(chatId)) {
        var group = self.groups.find(function(g) { return g.group_id === chatId; });
        targetName = group ? group.group_name : '群聊';
      } else if (chatId !== 'public') {
        var contact = self.contacts.find(function(c) { return c.user_id === chatId; });
        targetName = contact ? contact.net_name : '私聊';
      }
      self.forwardSuccessTarget = targetName;
      self.showForwardSuccess = true;
    },
    cancelForward: function() {
      this.showForwardModal = false;
      this.pendingForward = null;
    },
    stayInChat: function() {
      this.showForwardSuccess = false;
    },
    backToCommunity: function() {
      this.showForwardSuccess = false;
      this.$router.push('/community');
    },
    onEnterKey: function(e) {
      if (e.shiftKey) return;
      e.preventDefault();
      this.sendMessage();
    },
    autoResizeInput: function() {
      var self = this;
      self.$nextTick(function() {
        var el = self.$el.querySelector('.chat-input');
        if (el) {
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 120) + 'px';
        }
      });
    },
    // Reply system
    startReply: function(message) {
      var contentPreview = (message.content || '').substring(0, 40);
      this.replyingTo = {
        message_id: message.id || message.message_id,
        user_name: message.sender_name || '',
        content_preview: contentPreview
      };
      // Focus the input
      var self = this;
      self.$nextTick(function() {
        var el = self.$el.querySelector('.chat-input');
        if (el) {
          el.focus();
        }
      });
    },
    cancelReply: function() {
      this.replyingTo = null;
    },
    // Context menu
    openContextMenu: function(msg, event) {
      this.closeReactionPicker();

      var x = event.clientX;
      var y = event.clientY;
      // Adjust position to avoid overflow
      var menuWidth = 160;
      var menuHeight = 280;
      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 8;
      }
      if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 8;
      }
      this.contextMenuTarget = msg;
      this.contextMenuPos = { x: x, y: y };
      this.contextMenuMediaUrl = event.imageUrl || null;
      this.showContextMenu = true;
    },
    closeContextMenu: function() {
      this.showContextMenu = false;
      this.contextMenuTarget = null;
      this.contextMenuMediaUrl = null;
    },
    // Media preview (image/video/audio)
    previewMedia: function(media) {
      // 兼容旧的字符串格式和新的对象格式
      if (typeof media === 'string') {
        this.mediaPreviewUrl = media;
        this.mediaPreviewType = 'image';
      } else {
        this.mediaPreviewUrl = media.url;
        this.mediaPreviewType = media.type || 'image';
      }
      this.showImagePreview = true;
    },
    closeImagePreview: function() {
      this.showImagePreview = false;
      this.mediaPreviewUrl = null;
      this.mediaPreviewType = 'image';
    },
    saveMediaToCloud: function(mediaUrl) {
      var self = this;
      if (!mediaUrl) return;

      api.post('/cloud/save-from-url', { url: mediaUrl }).then(function(res) {
        if (res.data.code === 200) {
          self.$store.commit('toast/SHOW_TOAST', { message: '文件已转存到云盘', type: 'success' });
        } else {
          self.$store.commit('toast/SHOW_TOAST', { message: res.data.message || '转存失败', type: 'error' });
        }
      }).catch(function(err) {
        console.error('转存文件失败:', err);
        self.$store.commit('toast/SHOW_TOAST', { message: '转存失败，请重试', type: 'error' });
      });
    },
    handleContextAction: function(action) {
      var self = this;
      var msg = self.contextMenuTarget;
      var imageUrl = self.contextMenuMediaUrl;

      if (action === 'saveMedia') {
        self.closeContextMenu();
        self.saveMediaToCloud(imageUrl);
        return;
      }

      self.closeContextMenu();

      if (!msg) return;

      if (action === 'reply') {
        self.startReply(msg);
      } else if (action === 'react') {
        self.openReactionPicker(msg, self.contextMenuPos);
      } else if (action === 'copy') {
        var content = msg.content || '';
        if (msg.type === 'community_forward') {
          try {
            var fwd = JSON.parse(msg.content);
            content = fwd.title || fwd.dish_name || msg.content;
          } catch (e) {
            // use raw content
          }
        }
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(content).then(function() {
            self.$store.commit('toast/SHOW_TOAST', { message: '已复制', type: 'success' });
          }).catch(function() {
            self.$store.commit('toast/SHOW_TOAST', { message: '复制失败', type: 'error' });
          });
        } else {
          // Fallback for older browsers
          var textarea = document.createElement('textarea');
          textarea.value = content;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          try {
            document.execCommand('copy');
            self.$store.commit('toast/SHOW_TOAST', { message: '已复制', type: 'success' });
          } catch (e) {
            self.$store.commit('toast/SHOW_TOAST', { message: '复制失败', type: 'error' });
          }
          document.body.removeChild(textarea);
        }
      } else if (action === 'forward') {
        // Forward the message content
        var forwardContent = msg.content || '';
        var forwardType = 'text';
        if (msg.type === 'community_forward') {
          try {
            var fwdData = JSON.parse(msg.content);
            self.pendingForward = fwdData;
            self.showForwardModal = true;
            return;
          } catch (e) {
            // fall through to text forward
          }
        }
        // For text messages, create a simple forward
        self.pendingForward = { postType: 'text', content: forwardContent, title: msg.sender_name + '的消息' };
        self.showForwardModal = true;
      } else if (action === 'delete') {
        self.recallMessage(msg);
      }
    },
    // Reaction system
    openReactionPicker: function(msg, pos) {
      var x = pos ? pos.x : 0;
      var y = pos ? pos.y : 0;
      var pickerWidth = 260;
      var pickerHeight = 50;
      if (x + pickerWidth > window.innerWidth) {
        x = window.innerWidth - pickerWidth - 8;
      }
      if (y + pickerHeight > window.innerHeight) {
        y = y - pickerHeight - 8;
      }
      this.reactionPickerTarget = msg;
      this.reactionPickerPos = { x: x, y: y };
      this.showReactionPicker = true;
    },
    closeReactionPicker: function() {
      this.showReactionPicker = false;
      this.reactionPickerTarget = null;
    },
    selectReaction: function(emoji) {
      var self = this;
      var msg = self.reactionPickerTarget;
      self.closeReactionPicker();
      if (!msg) return;
      self.toggleReaction(msg, emoji);
    },
    getReactionMessageType: function() {
      if (this.currentChat === 'public') return 'public';
      if (this.isGroupChat(this.currentChat)) return 'group';
      return 'private';
    },
    toggleReaction: function(msg, emoji) {
      var self = this;
      var messageId = msg.id || msg.message_id;
      if (!messageId) return;

      // Check if current user already reacted with this emoji
      var existingReactions = msg.reactions || {};
      var existingEmoji = existingReactions[emoji];
      var hasOwn = false;
      var userId = self.currentUser ? self.currentUser.user_id : '';
      var messageType = self.getReactionMessageType();

      if (existingEmoji && existingEmoji.users && existingEmoji.users.indexOf(userId) > -1) {
        hasOwn = true;
      }

      if (hasOwn) {
        // Remove reaction
        api.delete('/community/reactions', {
          data: {
            message_id: messageId,
            message_type: messageType,
            emoji: emoji
          }
        }).then(function() {
          self.updateMessageReaction(messageId, emoji, -1, userId);
        }).catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '操作失败', type: 'error' });
        });
      } else {
        // Add reaction
        api.post('/community/reactions', {
          message_id: messageId,
          message_type: messageType,
          emoji: emoji
        }).then(function() {
          self.updateMessageReaction(messageId, emoji, 1, userId);
        }).catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '操作失败', type: 'error' });
        });
      }
    },
    updateMessageReaction: function(messageId, emoji, delta, userId) {
      var self = this;
      var msgs = self.currentMessages;
      for (var i = 0; i < msgs.length; i++) {
        var msgId = msgs[i].id || msgs[i].message_id;
        if (msgId === messageId) {
          if (!msgs[i].reactions) {
            self.$set(msgs[i], 'reactions', {});
          }
          if (!msgs[i].reactions[emoji]) {
            self.$set(msgs[i].reactions, emoji, { count: 0, users: [] });
          }
          var reaction = msgs[i].reactions[emoji];
          var newCount = reaction.count + delta;
          if (newCount <= 0) {
            self.$set(msgs[i].reactions, emoji, { count: 0, users: [] });
          } else {
            var newUsers = (reaction.users || []).slice();
            if (delta > 0) {
              if (newUsers.indexOf(userId) === -1) {
                newUsers.push(userId);
              }
            } else {
              var idx = newUsers.indexOf(userId);
              if (idx > -1) {
                newUsers.splice(idx, 1);
              }
            }
            self.$set(msgs[i].reactions, emoji, { count: newCount, users: newUsers });
          }
          break;
        }
      }
    },
    // Read receipts
    sendMarkRead: function() {
      var self = this;
      if (!self.isPrivateChat) return;
      var chatId = self.currentChat;
      if (self._lastMarkReadChat === chatId) return;
      var msgs = self.$store.state.chat.privateChats[chatId];
      if (!msgs || msgs.length === 0) return;

      var hasUnread = false;
      var userId = self.currentUser ? self.currentUser.user_id : '';
      for (var i = msgs.length - 1; i >= 0; i--) {
        var msg = msgs[i];
        if (msg.sender_id !== userId && msg.recalled !== 1) {
          hasUnread = true;
          break;
        }
      }
      if (!hasUnread) {
        self._lastMarkReadChat = chatId;
        return;
      }

      var lastOtherMsgId = null;
      for (var j = msgs.length - 1; j >= 0; j--) {
        var m = msgs[j];
        if (m.sender_id !== userId && m.recalled !== 1) {
          lastOtherMsgId = m.id || m.message_id;
          break;
        }
      }

      if (lastOtherMsgId) {
        self._lastMarkReadChat = chatId;
        wsManager.send({
          type: 'mark_read',
          chat_id: chatId,
          message_id: lastOtherMsgId
        });
      }
    },
    showClearChatConfirm: function() {
      this.showClearChatConfirmDialog = true;
    },
    confirmClearCurrentChat: function() {
      var self = this;
      var chatId = self.currentChat;
      if (chatId === 'public') {
        api.delete('/chat/messages/public').then(function(response) {
          self.$store.commit('chat/SET_MESSAGES', []);
          self.$store.commit('toast/SHOW_TOAST', { message: response.data.message, type: 'success' });
          self.showClearChatConfirmDialog = false;
        }).catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '清除失败', type: 'error' });
        });
      } else if (self.isGroupChat(chatId)) {
        api.delete('/chat/messages/group/' + chatId).then(function(response) {
          self.$store.commit('chat/SET_GROUP_MESSAGES', { groupId: chatId, messages: [] });
          self.$store.commit('toast/SHOW_TOAST', { message: response.data.message, type: 'success' });
          self.showClearChatConfirmDialog = false;
        }).catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '清除失败', type: 'error' });
        });
      } else {
        api.delete('/chat/messages/private/' + chatId).then(function(response) {
          self.$store.commit('chat/SET_PRIVATE_MESSAGES', { chatId: chatId, messages: [] });
          self.$store.commit('toast/SHOW_TOAST', { message: response.data.message, type: 'success' });
          self.showClearChatConfirmDialog = false;
        }).catch(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '清除失败', type: 'error' });
        });
      }
    },
    loadChatUserLevels: function() {
      var self = this;
      if (self._levelDebounce) {
        clearTimeout(self._levelDebounce);
      }
      self._levelDebounce = setTimeout(function() {
        var msgs = self.currentMessages;
        if (!msgs || msgs.length === 0) return;
        var userIds = [];
        for (var i = 0; i < msgs.length; i++) {
          var uid = msgs[i].sender_id || msgs[i].user_id;
          if (uid && userIds.indexOf(uid) === -1 && !self.chatUserLevels[uid]) {
            userIds.push(uid);
          }
        }
        if (userIds.length === 0) return;
        api.get('/level/batch-levels', { params: { user_ids: userIds.join(',') } }).then(function(response) {
          var data = response.data && response.data.data;
          if (data) {
            for (var j = 0; j < userIds.length; j++) {
              var id = userIds[j];
              if (data[id] !== undefined) {
                self.$set(self.chatUserLevels, id, { level: data[id].level || 0, show_level_chat: !!data[id].show_level_chat });
              }
            }
          }
        }).catch(function() {
          // silently ignore level fetch failure
        });
      }, 500);
    }
  }
};
</script>

<style scoped>
.chat-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}

.chat-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.nav-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  color: var(--primary-color);
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.nav-action-btn:hover {
  background: rgba(var(--primary-rgb), 0.08);
}

.nav-action-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

/* Sidebar */
.chat-sidebar {
  width: 300px;
  background: var(--sidebar-bg);
  border-right: 0.5px solid var(--separator-color);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
}

.sidebar-tabs {
  display: flex;
  border-bottom: 0.5px solid var(--separator-color);
  padding: 0;
}

.sidebar-tab {
  flex: 1;
  padding: 14px 0;
  min-height: 44px;
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
  text-align: center;
  transition: color var(--duration-normal) var(--ease-standard), border-bottom-color var(--duration-normal) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
  border-bottom: 2px solid transparent;
}

.sidebar-tab.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}

.sidebar-tab:active {
  background: var(--border-color);
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.chat-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  min-height: 44px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
  position: relative;
}

.chat-item:hover {
  background: var(--bg-color);
}

.chat-item:active {
  background: var(--border-color);
}

.chat-item.active {
  background: rgba(var(--primary-rgb), 0.08);
}

.chat-item-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-callout);
  color: var(--primary-color);
  flex-shrink: 0;
}

.chat-item-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--primary-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-subheadline);
  font-weight: 600;
  color: #FFFFFF;
  flex-shrink: 0;
}

.chat-item-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.chat-item-online-dot {
  position: absolute;
  bottom: 1px;
  right: 1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--success-color);
  border: 2px solid var(--card-bg);
}

.chat-item-info {
  flex: 1;
  min-width: 0;
}

.chat-item-name {
  font-size: var(--font-size-body);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-item-preview {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.chat-item-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 4px;
}

.chat-item-time {
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.chat-item-badge {
  min-width: 18px;
  height: 18px;
  background: var(--danger-color);
  color: #FFFFFF;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption2);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
}

.sidebar-action {
  padding: 12px;
  min-height: 44px;
  text-align: center;
  color: var(--primary-color);
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.sidebar-action:hover {
  background: rgba(var(--primary-rgb), 0.08);
}

.sidebar-action:active {
  background: var(--border-color);
}

.group-crown {
  font-size: var(--font-size-caption2);
  color: var(--warning-color);
  margin-left: 4px;
  vertical-align: middle;
}

.dnd-icon {
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  margin-left: 4px;
  vertical-align: middle;
}

.pin-icon {
  font-size: var(--font-size-caption2);
  color: var(--primary-color);
  margin-left: 4px;
  vertical-align: middle;
}

/* Main Chat Area */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.chat-header {
  padding: 16px 24px;
  border-bottom: 0.5px solid var(--separator-color);
  background: var(--card-bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chat-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--font-size-subheadline);
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.chat-title > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.online-count {
  font-size: var(--font-size-sm);
  font-weight: 400;
  color: var(--text-secondary);
}

.header-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--font-size-callout);
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.header-action-btn:hover {
  background: var(--bg-color);
  color: var(--primary-color);
}

.header-action-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.chat-header-btn {
  background: none;
  border: none;
  color: rgba(255,255,255,0.4);
  font-size: var(--font-size-sm);
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  transition: all 0.2s;
}
.chat-header-btn:hover {
  color: rgba(255,255,255,0.8);
  background: rgba(255,255,255,0.08);
}

.chat-connecting {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.chat-reconnecting-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 0;
  background: rgba(var(--warning-rgb), 0.12);
  color: var(--warning-color);
  font-size: var(--font-size-caption1);
  border-bottom: 0.5px solid var(--separator-color);
}

.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-tertiary);
}

.chat-empty-icon {
  font-size: 48px;
  opacity: 0.4;
}

.chat-empty-text {
  font-size: var(--font-size-body);
}

.loading-spinner-sm {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-more-indicator {
  display: flex;
  justify-content: center;
  padding: 8px;
}

.spinner-small {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255,255,255,0.1);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s var(--ease-standard) infinite;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  position: relative;
}

.chat-input-area {
  padding: 16px 24px;
  border-top: 0.5px solid var(--separator-color);
  background: var(--card-bg);
}

/* Reply preview bar */
.reply-preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: var(--bg-color);
  border-radius: var(--radius-md);
  border-left: 3px solid var(--primary-color);
}

.reply-preview-content {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.reply-preview-icon {
  color: var(--primary-color);
  font-size: var(--font-size-sm);
  flex-shrink: 0;
}

.reply-preview-text {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reply-preview-cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  font-size: var(--font-size-footnote);
  flex-shrink: 0;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.reply-preview-cancel:hover {
  background: var(--border-color);
  color: var(--text-primary);
}

.reply-preview-cancel:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}

.emoji-toggle {
  font-size: var(--font-size-subheadline);
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.emoji-toggle:hover {
  background: var(--bg-color);
  color: var(--primary-color);
}

.emoji-toggle:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.cloud-toggle {
  font-size: var(--font-size-subheadline);
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.cloud-toggle:hover {
  background: var(--bg-color);
  color: var(--accent-ai);
}

.cloud-toggle:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.chat-input {
  flex: 1;
  min-height: 44px;
  height: 44px;
  max-height: 120px;
  padding: 8px 14px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-xl);
  font-size: var(--font-size-body);
  color: var(--text-primary);
  background: var(--bg-color);
  transition: border-color var(--duration-normal) var(--ease-standard);
  resize: none;
  font-family: inherit;
  line-height: 1.4;
  box-sizing: border-box;
  outline: none;
}

.chat-input:focus {
  border-color: var(--primary-color);
}

.send-btn {
  min-height: 44px;
  padding: 8px 20px;
  background: var(--primary-color);
  color: #FFFFFF;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-semibold);
  transition: background var(--duration-normal) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.send-btn:hover {
  background: var(--primary-hover);
}

.send-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Context Menu */
.context-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 3000;
}

.context-menu-popup {
  position: fixed;
  background: var(--card-bg);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-color);
  padding: 6px 0;
  min-width: 160px;
  z-index: 3001;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 10px 16px;
  font-size: var(--font-size-footnote);
  color: var(--text-primary);
  text-align: left;
  transition: background var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.ctx-item:hover {
  background: var(--bg-color);
}

.ctx-item:active {
  background: var(--border-color);
}

.ctx-item i {
  width: 16px;
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.ctx-item-danger {
  color: var(--danger-color);
}

.ctx-item-danger i {
  color: var(--danger-color);
}

/* Reaction Picker */
.reaction-picker-popup {
  position: fixed;
  background: var(--card-bg);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-color);
  padding: 6px 8px;
  display: flex;
  gap: 4px;
  z-index: 3001;
}

.reaction-pick-btn {
  min-width: 44px;
  min-height: 44px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-title2);
  border-radius: 50%;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.reaction-pick-btn:hover {
  background: var(--bg-color);
}

.reaction-pick-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: var(--glass-blur-overlay);
  -webkit-backdrop-filter: var(--glass-blur-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal-card {
  width: 400px;
  background: var(--card-bg);
  border-radius: var(--radius-md);
  padding: 28px;
  box-shadow: var(--shadow-xl);
}

.modal-title {
  font-size: var(--font-size-subheadline);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin-bottom: 20px;
}

.modal-desc {
  font-size: var(--font-size-footnote);
  color: var(--text-secondary);
  margin-bottom: 16px;
  line-height: 1.5;
}

.form-group {
  margin-bottom: 16px;
}

.form-input {
  width: 100%;
  min-height: 44px;
  height: 44px;
  padding: 0 14px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  color: var(--text-primary);
  background: var(--bg-color);
  transition: border-color var(--duration-normal) var(--ease-standard);
}

.form-input:focus {
  border-color: var(--primary-color);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}

.btn-cancel {
  min-height: 44px;
  padding: 10px 20px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  background: var(--bg-color);
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.btn-cancel:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.btn-confirm {
  min-height: 44px;
  padding: 10px 20px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  color: #FFFFFF;
  background: var(--primary-color);
  transition: background var(--duration-normal) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.btn-confirm:hover {
  background: var(--primary-hover);
}

.btn-confirm:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-confirm-danger {
  background: var(--danger-color);
}

.btn-confirm-danger:hover {
  background: var(--danger-color);
}

.btn-cancel-sm,
.btn-confirm-sm {
  min-height: 44px;
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-footnote);
  transition: transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.btn-cancel-sm:active,
.btn-confirm-sm:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.btn-cancel-sm {
  color: var(--text-secondary);
  background: var(--bg-color);
}

.btn-confirm-sm {
  color: #FFFFFF;
  background: var(--primary-color);
  font-weight: 600;
}

.btn-confirm-sm:hover {
  background: var(--primary-hover);
}

/* Member select */
.member-select-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.selected-count {
  color: var(--text-secondary);
  font-weight: 400;
}

.member-select-list {
  max-height: 240px;
  overflow-y: auto;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md);
  padding: 8px;
}

.member-select-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  min-height: 44px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.member-select-item:hover {
  background: var(--bg-color);
}

.member-select-item:active {
  background: var(--border-color);
}

.member-select-item input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--primary-color);
  flex-shrink: 0;
}

.member-select-item-clickable {
  cursor: pointer;
}

.member-select-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--primary-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: #FFFFFF;
  flex-shrink: 0;
}

.member-select-name {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.empty-hint {
  text-align: center;
  padding: 24px 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
}

/* Settings Panel */
.settings-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 360px;
  height: 100%;
  background: var(--card-bg);
  border-left: 0.5px solid var(--separator-color);
  z-index: 1500;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}

.settings-panel-sm {
  width: 300px;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
}

.settings-title {
  font-size: var(--font-size-subheadline);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  margin: 0;
}

.settings-close {
  min-width: 44px;
  min-height: 44px;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-callout);
  color: var(--text-secondary);
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.settings-close:hover {
  background: var(--bg-color);
  color: var(--text-primary);
}

.settings-close:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}

.settings-section {
  margin-bottom: 24px;
}

.settings-section-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Member list in settings */
.member-list {
  margin-bottom: 12px;
}

.member-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.member-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--primary-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-body);
  font-weight: 600;
  color: #FFFFFF;
  flex-shrink: 0;
}

.member-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.member-online-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--success-color);
  border: 2px solid var(--card-bg);
}

.member-name {
  font-size: var(--font-size-body);
  color: var(--text-primary);
  flex: 1;
}

.member-crown {
  font-size: var(--font-size-caption);
  color: var(--warning-color);
}

.member-role {
  font-size: var(--font-size-caption2);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  font-weight: 500;
  flex-shrink: 0;
}

.role-owner {
  background: rgba(var(--warning-rgb), 0.12);
  color: var(--warning-color);
}

.role-admin {
  background: rgba(var(--primary-rgb), 0.12);
  color: var(--info-color);
}



.role-member {
  background: var(--bg-color);
  color: var(--text-tertiary);
}

.member-kick-btn {
  min-width: 44px;
  min-height: 44px;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-caption1);
  color: var(--text-tertiary);
  background: transparent;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
}

.member-kick-btn:hover {
  background: rgba(var(--danger-rgb), 0.1);
  color: var(--danger-color);
}

.member-kick-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.editable-title {
  cursor: pointer;
  transition: color 0.15s;
}

.editable-title:hover {
  color: var(--primary-color);
}

.title-edit-icon {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  margin-left: 6px;
  vertical-align: middle;
}

.editable-title:hover .title-edit-icon {
  color: var(--primary-color);
}

.group-name-edit-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.group-name-edit-input {
  flex: 1;
  min-height: 44px;
  height: 44px;
  padding: 0 10px;
  border: 0.5px solid var(--primary-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-callout);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  background: var(--bg-color);
  min-width: 0;
  transition: border-color var(--duration-normal) var(--ease-standard);
}

.group-name-edit-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

/* Announcement */
.announcement-display {
  background: var(--bg-color);
  border-radius: var(--radius-md);
  padding: 14px;
}

.announcement-content {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.announcement-empty {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  font-style: italic;
}

.announcement-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.announcement-textarea {
  width: 100%;
  min-height: 44px;
  padding: 12px 14px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md);
  font-size: var(--font-size-footnote);
  color: var(--text-primary);
  background: var(--bg-color);
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
  transition: border-color var(--duration-normal) var(--ease-standard);
}

.announcement-textarea:focus {
  border-color: var(--primary-color);
}

.announcement-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Settings row */
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.settings-row-label {
  font-size: var(--font-size-body);
  color: var(--text-primary);
}

.settings-user-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 0.5px solid var(--separator-color);
  margin-bottom: 8px;
}

.settings-user-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #FFFFFF;
  font-size: var(--font-size-headline);
  font-weight: 600;
  flex-shrink: 0;
}

.settings-user-info {
  flex: 1;
  min-width: 0;
}

.settings-user-name {
  font-size: var(--font-size-callout);
  font-weight: 600;
  color: var(--text-primary);
}

.settings-user-realname {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-top: 2px;
}

.settings-remark-input {
  flex: 1;
  max-width: 180px;
  min-height: 44px;
  padding: 4px 8px;
  font-size: var(--font-size-footnote);
  text-align: right;
  background: transparent;
  border: 0.5px solid transparent;
  border-radius: var(--radius-sm);
  transition: border-color var(--duration-normal) var(--ease-standard), background var(--duration-normal) var(--ease-standard);
}

.settings-remark-input:focus {
  border-color: var(--primary-color);
  background: var(--bg-color);
}

.sidebar-search-bar {
  padding: 8px 12px;
  border-bottom: 0.5px solid var(--separator-color);
}

/* Toggle switch - iOS standard 51x31 */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 51px;
  height: 31px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(120, 120, 128, 0.16);
  border-radius: var(--radius-pill);
  transition: background var(--duration-normal) var(--ease-standard);
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 27px;
  width: 27px;
  left: 2px;
  bottom: 2px;
  background-color: #FFFFFF;
  border-radius: 50%;
  transition: transform var(--duration-normal) var(--ease-standard);
  box-shadow: var(--shadow-md);
}

.toggle-switch input:checked + .toggle-slider {
  background: var(--success-color);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(20px);
}

/* Settings action buttons */
.settings-action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-footnote);
  color: var(--primary-color);
  background: var(--primary-light);
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
  margin-top: 8px;
}

.settings-action-btn:hover {
  background: rgba(var(--primary-rgb), 0.14);
}

.settings-action-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.settings-danger-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-footnote);
  color: var(--danger-color);
  background: rgba(var(--danger-rgb), 0.08);
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
  margin-top: 8px;
}

.settings-danger-btn:hover {
  background: rgba(var(--danger-rgb), 0.14);
}

.settings-danger-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

/* Transitions */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.fade-slide-enter {
  opacity: 0;
  transform: translateX(-10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

.msg-list-enter-active {
  transition: opacity 0.3s, transform 0.3s;
}

.msg-list-enter {
  opacity: 0;
  transform: translateY(10px);
}

.modal-fade-enter-active {
  transition: opacity 0.25s var(--ease-standard), transform 0.3s var(--ease-spring);
}
.modal-fade-leave-active {
  transition: opacity 0.15s var(--ease-accelerate), transform 0.15s var(--ease-accelerate);
}

.modal-fade-enter {
  opacity: 0;
  transform: scale(0.92) translateY(8px);
}
.modal-fade-leave-to {
  opacity: 0;
  transform: scale(0.97) translateY(-4px);
}

.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.3s var(--ease-standard);
}

.slide-right-enter,
.slide-right-leave-to {
  transform: translateX(100%);
}

.fade-quick-enter-active,
.fade-quick-leave-active {
  transition: opacity 0.15s;
}

.fade-quick-enter,
.fade-quick-leave-to {
  opacity: 0;
}

/* Header actions */
.chat-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Typing indicator */
.typing-indicator {
  font-size: var(--font-size-caption);
  font-weight: 400;
  color: var(--text-secondary);
  animation: typing-pulse 1.5s ease-in-out infinite;
}

@keyframes typing-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

/* Search bar */
.chat-search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  border-bottom: 0.5px solid var(--separator-color);
  background: var(--card-bg);
}

.search-input-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-color);
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-pill);
  padding: 0 12px;
  min-height: 44px;
  height: 44px;
  transition: border-color var(--duration-normal) var(--ease-standard);
}

.search-input-wrap:focus-within {
  border-color: var(--primary-color);
}

.search-input-icon {
  font-size: var(--font-size-footnote);
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: var(--font-size-body);
  color: var(--text-primary);
  outline: none;
  min-width: 0;
}

.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  font-size: var(--font-size-caption1);
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.search-clear:hover {
  background: var(--border-color);
}

.search-clear:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.search-close-btn {
  min-height: 44px;
  font-size: var(--font-size-footnote);
  color: var(--primary-color);
  padding: 6px 12px;
  flex-shrink: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.search-close-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
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
  font-size: var(--font-size-caption);
  color: var(--danger-color);
  white-space: nowrap;
  flex-shrink: 0;
  font-weight: 500;
}

/* Announcement Popup Modal */
.announcement-popup-modal {
  max-width: 400px;
}

.announcement-popup-content {
  max-height: 200px;
  overflow-y: auto;
  font-size: var(--font-size-body);
  color: var(--text-primary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--bg-color);
  border-radius: var(--radius-md);
  padding: 14px;
}

.forward-modal-card {
  max-width: 420px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.forward-preview-card {
  background: var(--bg-color);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  margin-bottom: 14px;
  border-left: 3px solid var(--primary-color);
}

.forward-preview-type {
  font-size: var(--font-size-caption2);
  color: var(--primary-color);
  font-weight: 600;
  margin-bottom: 4px;
}

.forward-preview-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.forward-preview-content {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forward-target-list {
  flex: 1;
  overflow-y: auto;
  max-height: 300px;
  margin: 0 -8px;
  padding: 0 8px;
}

.forward-target-section {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  font-weight: 600;
  padding: 8px 4px 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.forward-target-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  min-height: 44px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
}

.forward-target-item:hover {
  background: var(--bg-color);
}

.forward-target-item:active {
  background: var(--border-color);
}

.forward-target-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: #FFFFFF;
  background: var(--card-bg);
  flex-shrink: 0;
}

.forward-target-info {
  flex: 1;
  min-width: 0;
}

.forward-target-name {
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  font-weight: 500;
}

.forward-target-desc {
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
}

.online-desc {
  color: var(--success-color);
}

.remote-badge {
  display: inline-block;
  font-size: var(--font-size-caption2);
  font-weight: 600;
  color: #FFFFFF;
  background: var(--primary-color);
  border-radius: var(--radius-xs);
  padding: 1px 5px;
  margin-left: 6px;
  vertical-align: middle;
  line-height: 1.4;
}

.class-group-badge {
  display: inline-block;
  font-size: var(--font-size-caption2);
  font-weight: 600;
  color: #FFFFFF;
  background: var(--accent-community);
  border-radius: var(--radius-xs);
  padding: 1px 5px;
  margin-left: 6px;
  vertical-align: middle;
  line-height: 1.4;
}

.remote-count {
  color: var(--primary-color);
}

/* Landscape tablet optimization */
@media (min-width: 1024px) and (orientation: landscape) {
  .chat-sidebar { width: 240px; }
  .sidebar-tab { padding: 10px 0; font-size: var(--font-size-sm); }
  .sidebar-list { padding: 6px; }
  .chat-item { padding: 8px; gap: 8px; border-radius: var(--radius-md); }
  .chat-item-icon { width: 36px; height: 36px; border-radius: var(--radius-md); font-size: var(--font-size-sm); }
  .chat-item-avatar { width: 36px; height: 36px; font-size: var(--font-size-callout); }
  .chat-item-name { font-size: var(--font-size-sm); }
  .chat-item-preview { font-size: var(--font-size-caption); }
  .chat-header { padding: 12px 20px; }
  .chat-title { font-size: var(--font-size-callout); gap: 8px; }
  .chat-messages { padding: 16px 20px; }
  .chat-input-area { padding: 12px 20px; }
  .settings-panel { width: 320px; }
  .settings-panel-sm { width: 260px; }
  .settings-header { padding: 14px 18px; }
  .settings-body { padding: 12px 18px; }
}
</style>
