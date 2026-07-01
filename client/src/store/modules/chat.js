import Vue from 'vue';
import wsManager from '@/utils/websocket';
import api from '@/utils/api';

var savedPinned = [];
try {
  var stored = localStorage.getItem('classintra_pinned_chats');
  if (stored) {
    savedPinned = JSON.parse(stored);
  }
} catch (e) {
  savedPinned = [];
}

var savedDnd = {};
try {
  var storedDnd = localStorage.getItem('classintra_dnd_settings');
  if (storedDnd) {
    savedDnd = JSON.parse(storedDnd);
  }
} catch (e) {
  savedDnd = {};
}

var state = {
  messages: [],
  onlineUsers: [],
  remoteOnlineUsers: [],
  currentChat: 'public',
  chatTabs: 'public',
  privateChats: {},
  groups: [],
  contacts: [],
  unread: {},
  groupChats: {},
  dndSettings: savedDnd,
  groupMembers: {},
  pinnedChats: savedPinned,
  remotePosts: [],
  _messageIdSet: {},
  _privateMsgIdSet: {},
  _groupMsgIdSet: {},
  _contentDedupSet: {}
};

var getters = {
  currentMessages: function(state) {
    if (state.currentChat === 'public') {
      return state.messages;
    }
    if (state.currentChat.indexOf('group_') === 0 || state.currentChat.indexOf('class_') === 0) {
      return state.groupChats[state.currentChat] || [];
    }
    return state.privateChats[state.currentChat] || [];
  },
  onlineUsers: function(state) {
    return state.onlineUsers;
  },
  contacts: function(state) {
    return state.contacts;
  },
  groups: function(state) {
    return state.groups;
  },
  unread: function(state) {
    return state.unread;
  },
  isDnd: function(state) {
    return function(chatId) {
      return !!state.dndSettings[chatId];
    };
  },
  isPinned: function(state) {
    return function(chatId) {
      return state.pinnedChats.indexOf(chatId) !== -1;
    };
  },
  getGroupMessages: function(state) {
    return function(groupId) {
      return state.groupChats[groupId] || [];
    };
  }
};

var mutations = {
  ADD_MESSAGE: function(state, msg) {
    var msgId = msg.id || msg.message_id;
    var target;
    if (msg.chatId === 'public' || !msg.chatId) {
      target = state.messages;
    } else {
      if (!state.privateChats[msg.chatId]) {
        Vue.set(state.privateChats, msg.chatId, []);
      }
      target = state.privateChats[msg.chatId];
    }
    // ID去重 - 最可靠的去重方式
    if (msgId) {
      var idSet = msg.chatId && msg.chatId !== 'public' ? (state._privateMsgIdSet[msg.chatId] || (Vue.set(state._privateMsgIdSet, msg.chatId, {}))) : state._messageIdSet;
      if (idSet[msgId]) return;
      idSet[msgId] = true;
    }
    var dedupScope = msg.chatId || 'public';
    if (!state._contentDedupSet[dedupScope]) {
      Vue.set(state._contentDedupSet, dedupScope, {});
    }
    // 内容精确去重
    var dedupKey = (msg.sender_id || '') + ':' + (msg.content || '') + ':' + (msg.created_at || '');
    if (dedupKey && state._contentDedupSet[dedupScope][dedupKey]) return;
    // 扫描最近20条消息进行宽松去重（sender_id + content 匹配）
    var looseDedupKey = (msg.sender_id || '') + ':' + (msg.content || '');
    if (looseDedupKey && target.length > 0) {
      var scanStart = Math.max(0, target.length - 20);
      for (var di = target.length - 1; di >= scanStart; di--) {
        var existMsg = target[di];
        var existLooseKey = (existMsg.sender_id || '') + ':' + (existMsg.content || '');
        if (existLooseKey === looseDedupKey) {
          // 找到相同内容消息，更新其ID如果没有服务端ID
          if (msgId && !existMsg._serverId && (existMsg.id !== msgId)) {
            Vue.set(target[di], 'id', msgId);
            Vue.set(target[di], '_serverId', true);
          }
          return;
        }
      }
    }
    if (dedupKey) state._contentDedupSet[dedupScope][dedupKey] = true;
    if (msgId) msg._serverId = true;
    target.push(msg);
    if (target.length > 500) {
      var removed = target.splice(0, target.length - 500);
      var cleanIdSet = (msg.chatId && msg.chatId !== 'public')
        ? (state._privateMsgIdSet[msg.chatId] || {})
        : state._messageIdSet;
      for (var ri = 0; ri < removed.length; ri++) {
        var rid = removed[ri].id || removed[ri].message_id;
        if (rid) { delete cleanIdSet[rid]; }
        var rDedupKey = (removed[ri].sender_id || '') + ':' + (removed[ri].content || '') + ':' + (removed[ri].created_at || '');
        if (rDedupKey && state._contentDedupSet[dedupScope]) { delete state._contentDedupSet[dedupScope][rDedupKey]; }
      }
    }
  },
  SET_MESSAGES: function(state, messages) {
    state.messages = messages;
    state._messageIdSet = {};
    state._contentDedupSet['public'] = {};
    for (var si = 0; si < messages.length; si++) {
      var sid = messages[si].id || messages[si].message_id;
      if (sid) { state._messageIdSet[sid] = true; }
      var sDedupKey = (messages[si].sender_id || '') + ':' + (messages[si].content || '') + ':' + (messages[si].created_at || '');
      if (sDedupKey) { state._contentDedupSet['public'][sDedupKey] = true; }
    }
  },
  UPDATE_MESSAGE_ID: function(state, payload) {
    var oldId = payload.oldId;
    var newId = payload.newId;
    for (var i = 0; i < state.messages.length; i++) {
      var msgId = state.messages[i].id || state.messages[i].message_id;
      var msgTempId = state.messages[i].tempId;
      if (msgId === oldId || msgTempId === oldId) {
        var oldDedupKey = (state.messages[i].sender_id || '') + ':' + (state.messages[i].content || '') + ':' + (state.messages[i].created_at || '');
        state.messages[i]._serverId = true;
        if (state.messages[i].id) state.messages[i].id = newId;
        if (state.messages[i].message_id) state.messages[i].message_id = newId;
        if (state._messageIdSet[newId]) break;
        delete state._messageIdSet[oldId];
        state._messageIdSet[newId] = true;
        if (oldDedupKey && state._contentDedupSet['public']) {
          delete state._contentDedupSet['public'][oldDedupKey];
        }
        var newDedupKey = (state.messages[i].sender_id || '') + ':' + (state.messages[i].content || '') + ':' + (state.messages[i].created_at || '');
        if (newDedupKey && !state._contentDedupSet['public']) {
          Vue.set(state._contentDedupSet, 'public', {});
        }
        if (newDedupKey && state._contentDedupSet['public']) {
          state._contentDedupSet['public'][newDedupKey] = true;
        }
        break;
      }
    }
  },
  UPDATE_GROUP_MESSAGE_ID: function(state, payload) {
    var groupId = payload.groupId;
    var oldId = payload.oldId;
    var newId = payload.newId;
    if (!state.groupChats[groupId]) return;
    var msgs = state.groupChats[groupId];
    var dedupScope = 'group_' + groupId;
    for (var i = 0; i < msgs.length; i++) {
      var msgId = msgs[i].id || msgs[i].message_id;
      var msgTempId = msgs[i].tempId;
      if (msgId === oldId || msgTempId === oldId) {
        var oldDedupKey = (msgs[i].sender_id || '') + ':' + (msgs[i].content || '') + ':' + (msgs[i].created_at || '');
        msgs[i]._serverId = true;
        if (msgs[i].id) msgs[i].id = newId;
        if (msgs[i].message_id) msgs[i].message_id = newId;
        if (state._groupMsgIdSet[groupId]) {
          delete state._groupMsgIdSet[groupId][oldId];
          state._groupMsgIdSet[groupId][newId] = true;
        }
        if (oldDedupKey && state._contentDedupSet[dedupScope]) {
          delete state._contentDedupSet[dedupScope][oldDedupKey];
        }
        var newDedupKey = (msgs[i].sender_id || '') + ':' + (msgs[i].content || '') + ':' + (msgs[i].created_at || '');
        if (newDedupKey && !state._contentDedupSet[dedupScope]) {
          Vue.set(state._contentDedupSet, dedupScope, {});
        }
        if (newDedupKey && state._contentDedupSet[dedupScope]) {
          state._contentDedupSet[dedupScope][newDedupKey] = true;
        }
        break;
      }
    }
  },
  SET_ONLINE_USERS: function(state, users) {
    state.onlineUsers = users;
  },
  SET_REMOTE_ONLINE_USERS: function(state, users) {
    state.remoteOnlineUsers = users;
  },
  ADD_REMOTE_ONLINE_USER: function(state, user) {
    var exists = state.remoteOnlineUsers.some(function(u) { return u.user_id === user.user_id; });
    if (!exists) {
      state.remoteOnlineUsers.push(user);
    }
  },
  REMOVE_REMOTE_ONLINE_USER: function(state, userId) {
    state.remoteOnlineUsers = state.remoteOnlineUsers.filter(function(u) {
      return u.user_id !== userId;
    });
  },
  SET_CURRENT_CHAT: function(state, chatId) {
    state.currentChat = chatId;
  },
  SET_CHAT_TABS: function(state, tab) {
    state.chatTabs = tab;
  },
  SET_CONTACTS: function(state, contacts) {
    state.contacts = contacts;
  },
  SET_GROUPS: function(state, groups) {
    state.groups = groups;
  },
  ADD_GROUP: function(state, group) {
    state.groups.push(group);
  },
  SET_PRIVATE_MESSAGES: function(state, payload) {
    var existing = state.privateChats[payload.chatId];
    if (existing && existing.length > 0 && payload.messages && payload.messages.length > 0) {
      var serverMap = {};
      for (var si = 0; si < payload.messages.length; si++) {
        var sid = payload.messages[si].id || payload.messages[si].message_id;
        if (sid) serverMap[String(sid)] = payload.messages[si];
      }
      var merged = payload.messages.slice();
      for (var j = 0; j < existing.length; j++) {
        var exMsg = existing[j];
        var eid = exMsg.id || exMsg.message_id;
        if (eid && serverMap[String(eid)]) continue;
        if (exMsg.tempId) {
          var matched = false;
          for (var mi = 0; mi < payload.messages.length; mi++) {
            if (payload.messages[mi].sender_id === exMsg.sender_id &&
                payload.messages[mi].content === exMsg.content) {
              matched = true;
              break;
            }
          }
          if (matched) continue;
        }
        merged.push(exMsg);
      }
      merged.sort(function(a, b) {
        return (a.created_at || '').localeCompare(b.created_at || '');
      });
      Vue.set(state.privateChats, payload.chatId, merged);
    } else {
      Vue.set(state.privateChats, payload.chatId, payload.messages);
    }
    if (!state._privateMsgIdSet[payload.chatId]) {
      Vue.set(state._privateMsgIdSet, payload.chatId, {});
    }
    if (!state._contentDedupSet[payload.chatId]) {
      Vue.set(state._contentDedupSet, payload.chatId, {});
    }
    var pmList = state.privateChats[payload.chatId] || [];
    for (var pi = 0; pi < pmList.length; pi++) {
      var pmId = pmList[pi].id || pmList[pi].message_id;
      if (pmId) { state._privateMsgIdSet[payload.chatId][pmId] = true; }
      var pmDedupKey = (pmList[pi].sender_id || '') + ':' + (pmList[pi].content || '') + ':' + (pmList[pi].created_at || '');
      if (pmDedupKey) { state._contentDedupSet[payload.chatId][pmDedupKey] = true; }
    }
  },
  SET_UNREAD: function(state, payload) {
    Vue.set(state.unread, payload.chatId, payload.count);
  },
  CLEAR_UNREAD: function(state, chatId) {
    Vue.set(state.unread, chatId, 0);
  },
  ADD_GROUP_MESSAGE: function(state, payload) {
    if (!state.groupChats[payload.groupId]) {
      Vue.set(state.groupChats, payload.groupId, []);
    }
    var target = state.groupChats[payload.groupId];
    var msgId = payload.message.id || payload.message.message_id;
    // ID去重
    if (msgId) {
      if (!state._groupMsgIdSet[payload.groupId]) { Vue.set(state._groupMsgIdSet, payload.groupId, {}); }
      if (state._groupMsgIdSet[payload.groupId][msgId]) return;
      state._groupMsgIdSet[payload.groupId][msgId] = true;
    }
    var gmDedupKey = (payload.message.sender_id || '') + ':' + (payload.message.content || '') + ':' + (payload.message.created_at || '');
    var gmDedupScope = 'group_' + payload.groupId;
    if (!state._contentDedupSet[gmDedupScope]) {
      Vue.set(state._contentDedupSet, gmDedupScope, {});
    }
    // 内容精确去重
    if (gmDedupKey && state._contentDedupSet[gmDedupScope][gmDedupKey]) return;
    // 扫描最近20条消息进行宽松去重
    var gmLooseKey = (payload.message.sender_id || '') + ':' + (payload.message.content || '');
    if (gmLooseKey && target.length > 0) {
      var gmScanStart = Math.max(0, target.length - 20);
      for (var gdi = target.length - 1; gdi >= gmScanStart; gdi--) {
        var gmExistMsg = target[gdi];
        var gmExistKey = (gmExistMsg.sender_id || '') + ':' + (gmExistMsg.content || '');
        if (gmExistKey === gmLooseKey) {
          if (msgId && !gmExistMsg._serverId && (gmExistMsg.id !== msgId)) {
            Vue.set(target[gdi], 'id', msgId);
            Vue.set(target[gdi], '_serverId', true);
          }
          return;
        }
      }
    }
    if (gmDedupKey) state._contentDedupSet[gmDedupScope][gmDedupKey] = true;
    if (msgId) payload.message._serverId = true;
    target.push(payload.message);
    if (target.length > 500) {
      var removed = target.splice(0, target.length - 500);
      for (var ri = 0; ri < removed.length; ri++) {
        var rid = removed[ri].id || removed[ri].message_id;
        if (rid) { delete state._groupMsgIdSet[payload.groupId][rid]; }
        var rGmDedupKey = (removed[ri].sender_id || '') + ':' + (removed[ri].content || '') + ':' + (removed[ri].created_at || '');
        if (rGmDedupKey && state._contentDedupSet[gmDedupScope]) { delete state._contentDedupSet[gmDedupScope][rGmDedupKey]; }
      }
    }
  },
  ADD_SYSTEM_MESSAGE: function(state, payload) {
    var groupId = payload.groupId;
    var msg = {
      id: 'sys_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      type: 'system',
      content: payload.content,
      created_at: new Date().toISOString()
    };
    if (!state.groupChats[groupId]) {
      Vue.set(state.groupChats, groupId, []);
    }
    state.groupChats[groupId].push(msg);
  },
  SET_GROUP_MESSAGES: function(state, payload) {
    var existing = state.groupChats[payload.groupId];
    if (existing && existing.length > 0 && payload.messages && payload.messages.length > 0) {
      var serverMap = {};
      for (var si = 0; si < payload.messages.length; si++) {
        var sid = payload.messages[si].id || payload.messages[si].message_id;
        if (sid) serverMap[String(sid)] = payload.messages[si];
      }
      var merged = payload.messages.slice();
      for (var j = 0; j < existing.length; j++) {
        var exMsg = existing[j];
        var eid = exMsg.id || exMsg.message_id;
        if (eid && serverMap[String(eid)]) continue;
        if (exMsg.tempId) {
          var matched = false;
          for (var mi = 0; mi < payload.messages.length; mi++) {
            if (payload.messages[mi].sender_id === exMsg.sender_id &&
                payload.messages[mi].content === exMsg.content) {
              matched = true;
              break;
            }
          }
          if (matched) continue;
        }
        merged.push(exMsg);
      }
      merged.sort(function(a, b) {
        return (a.created_at || '').localeCompare(b.created_at || '');
      });
      Vue.set(state.groupChats, payload.groupId, merged);
    } else {
      Vue.set(state.groupChats, payload.groupId, payload.messages);
    }
    if (!state._groupMsgIdSet[payload.groupId]) {
      Vue.set(state._groupMsgIdSet, payload.groupId, {});
    }
    var sgmScope = 'group_' + payload.groupId;
    if (!state._contentDedupSet[sgmScope]) {
      Vue.set(state._contentDedupSet, sgmScope, {});
    }
    var gmList = state.groupChats[payload.groupId] || [];
    for (var gi = 0; gi < gmList.length; gi++) {
      var gmId = gmList[gi].id || gmList[gi].message_id;
      if (gmId) { state._groupMsgIdSet[payload.groupId][gmId] = true; }
      var gmDedupKey2 = (gmList[gi].sender_id || '') + ':' + (gmList[gi].content || '') + ':' + (gmList[gi].created_at || '');
      if (gmDedupKey2) { state._contentDedupSet[sgmScope][gmDedupKey2] = true; }
    }
  },
  SET_GROUP_MEMBERS: function(state, payload) {
    Vue.set(state.groupMembers, payload.groupId, payload.members);
  },
  REMOVE_GROUP: function(state, groupId) {
    state.groups = state.groups.filter(function(g) {
      return g.group_id !== groupId;
    });
    Vue.delete(state.groupChats, groupId);
    Vue.delete(state.groupMembers, groupId);
  },
  UPDATE_GROUP: function(state, updatedGroup) {
    for (var i = 0; i < state.groups.length; i++) {
      if (state.groups[i].group_id === updatedGroup.group_id) {
        Vue.set(state.groups, i, Object.assign({}, state.groups[i], updatedGroup));
        break;
      }
    }
  },
  TOGGLE_DND: function(state, payload) {
    Vue.set(state.dndSettings, payload.chatId, payload.enabled);
    try {
      localStorage.setItem('classintra_dnd_settings', JSON.stringify(state.dndSettings));
    } catch (e) {}
  },
  REPLACE_TEMP_MESSAGE: function(state, payload) {
    var msgs = state.privateChats[payload.chatId];
    if (msgs) {
      for (var i = msgs.length - 1; i >= 0; i--) {
        var msgId = msgs[i].id || msgs[i].message_id;
        var msgTempId = msgs[i].tempId;
        if ((msgTempId && msgTempId === payload.tempId) || msgId === payload.tempId) {
          var oldDedupKey = (msgs[i].sender_id || '') + ':' + (msgs[i].content || '') + ':' + (msgs[i].created_at || '');
          msgs[i]._serverId = true;
          Vue.set(msgs[i], 'id', payload.messageId);
          if (msgTempId) Vue.delete(msgs[i], 'tempId');
          var dedupScope = payload.chatId || 'public';
          if (oldDedupKey && state._contentDedupSet[dedupScope]) {
            delete state._contentDedupSet[dedupScope][oldDedupKey];
          }
          var newDedupKey = (msgs[i].sender_id || '') + ':' + (msgs[i].content || '') + ':' + (msgs[i].created_at || '');
          if (newDedupKey && !state._contentDedupSet[dedupScope]) {
            Vue.set(state._contentDedupSet, dedupScope, {});
          }
          if (newDedupKey && state._contentDedupSet[dedupScope]) {
            state._contentDedupSet[dedupScope][newDedupKey] = true;
          }
          break;
        }
      }
    }
  },
  TOGGLE_PIN: function(state, chatId) {
    var idx = state.pinnedChats.indexOf(chatId);
    if (idx !== -1) {
      state.pinnedChats.splice(idx, 1);
    } else {
      state.pinnedChats.push(chatId);
    }
    try {
      localStorage.setItem('classintra_pinned_chats', JSON.stringify(state.pinnedChats));
    } catch (e) {
      // ignore storage errors
    }
  },
  RECALL_MESSAGE: function(state, payload) {
    var chatType = payload.chatType;
    var chatId = payload.chatId;
    var messageId = payload.messageId;
    var messages;
    if (chatType === 'public') {
      messages = state.messages;
    } else if (chatType === 'private') {
      messages = state.privateChats[chatId];
    } else if (chatType === 'group') {
      messages = state.groupChats[chatId];
    }
    if (messages) {
      for (var i = 0; i < messages.length; i++) {
        var mId = messages[i].id || messages[i].message_id;
        if (String(mId) === String(messageId)) {
          Vue.set(messages[i], 'recalled', 1);
          Vue.set(messages[i], 'content', '该消息已撤回');
          break;
        }
      }
    }
  },
  ADD_REMOTE_POST: function(state, post) {
    if (!state.remotePosts) {
      Vue.set(state, 'remotePosts', []);
    }
    state.remotePosts.push(post);
  },
  PREPEND_MESSAGES: function(state, messages) {
    var existing = state.messages || [];
    var existingIds = {};
    for (var i = 0; i < existing.length; i++) {
      existingIds[existing[i].id] = true;
    }
    var toPrepend = [];
    for (var j = 0; j < messages.length; j++) {
      if (!existingIds[messages[j].id]) {
        toPrepend.push(messages[j]);
      }
    }
    state.messages = toPrepend.concat(existing);
  },
  PREPEND_GROUP_MESSAGES: function(state, payload) {
    var existing = state.groupChats[payload.groupId] || [];
    var existingIds = {};
    for (var i = 0; i < existing.length; i++) {
      existingIds[existing[i].id] = true;
    }
    var toPrepend = [];
    for (var j = 0; j < payload.messages.length; j++) {
      if (!existingIds[payload.messages[j].id]) {
        toPrepend.push(payload.messages[j]);
      }
    }
    Vue.set(state.groupChats, payload.groupId, toPrepend.concat(existing));
  }
};

var actions = {
  sendMessage: function(context, msg) {
    var sendData = {
      type: 'text',
      content: msg.content,
      msg_type: msg.msg_type || 'text',
      temp_id: msg.tempId || msg.id || null
    };
    if (msg.reply_to) {
      sendData.reply_to = msg.reply_to;
    }
    wsManager.send(sendData);
    context.commit('ADD_MESSAGE', msg);
  },
  sendPrivateMessage: function(context, msg) {
    var sendData = {
      type: 'private_message',
      target_user_id: msg.chatId,
      content: msg.content,
      msg_type: msg.msg_type || 'text',
      temp_id: msg.tempId || null
    };
    if (msg.reply_to) {
      sendData.reply_to = msg.reply_to;
    }
    wsManager.send(sendData);
    context.commit('ADD_MESSAGE', msg);
  },
  loadMessages: function(context) {
    return api.get('/chat/messages').then(function(response) {
      context.commit('SET_MESSAGES', response.data.data || []);
    });
  },
  loadContacts: function(context) {
    return api.get('/chat/contacts').then(function(response) {
      context.commit('SET_CONTACTS', response.data.data || []);
    });
  },
  loadGroups: function(context) {
    return api.get('/chat/groups').then(function(response) {
      context.commit('SET_GROUPS', response.data.data || []);
    });
  },
  createGroup: function(context, groupData) {
    return api.post('/chat/groups', {
      group_name: groupData.group_name,
      member_ids: groupData.member_ids
    }).then(function(response) {
      context.commit('ADD_GROUP', response.data.data);
      return response.data.data;
    });
  },
  loadPrivateMessages: function(context, chatId) {
    return api.get('/chat/private/' + chatId).then(function(response) {
      context.commit('SET_PRIVATE_MESSAGES', {
        chatId: chatId,
        messages: response.data.data || []
      });
    });
  },
  sendGroupMessage: function(context, msg) {
    var sendData = {
      type: 'group_message',
      group_id: msg.chatId,
      content: msg.content,
      msg_type: msg.msg_type || 'text',
      temp_id: msg.tempId || msg.id || null
    };
    if (msg.reply_to) {
      sendData.reply_to = msg.reply_to;
    }
    wsManager.send(sendData);
    context.commit('ADD_GROUP_MESSAGE', {
      groupId: msg.chatId,
      message: msg
    });
  },
  loadGroupMessages: function(context, groupId) {
    return api.get('/chat/groups/' + groupId + '/messages').then(function(response) {
      var responseData = response.data.data;
      var messages = [];
      if (responseData) {
        messages = responseData.messages || (Array.isArray(responseData) ? responseData : []);
      }
      context.commit('SET_GROUP_MESSAGES', {
        groupId: groupId,
        messages: messages
      });
    });
  },
  loadGroupMembers: function(context, groupId) {
    return api.get('/chat/groups/' + groupId + '/members').then(function(response) {
      var responseData = response.data.data;
      var members = [];
      if (responseData) {
        members = responseData.members || (Array.isArray(responseData) ? responseData : []);
      }
      context.commit('SET_GROUP_MEMBERS', {
        groupId: groupId,
        members: members
      });
    });
  },
  recallMessage: function(context, payload) {
    var messageType = payload.messageType;
    var messageId = payload.messageId;
    var chatId = payload.chatId;
    var groupId = payload.groupId;
    var promise;
    if (messageType === 'public') {
      promise = api.post('/chat/messages/' + messageId + '/recall');
    } else if (messageType === 'private') {
      promise = api.post('/chat/private/' + messageId + '/recall');
    } else if (messageType === 'group') {
      promise = api.post('/chat/groups/' + groupId + '/recall/' + messageId);
    } else {
      return Promise.reject(new Error('无效的消息类型'));
    }
    return promise.then(function() {
      context.commit('RECALL_MESSAGE', {
        chatType: messageType,
        chatId: chatId,
        messageId: messageId
      });
    });
  },
  dissolveGroup: function(context, groupId) {
    wsManager.send({
      type: 'dissolve_group',
      group_id: groupId
    });
  },
  leaveGroup: function(context, payload) {
    var groupId = payload.groupId;
    var newOwnerId = payload.newOwnerId;
    if (newOwnerId) {
      wsManager.send({
        type: 'transfer_group',
        group_id: groupId,
        new_owner_id: newOwnerId
      });
    } else {
      wsManager.send({
        type: 'leave_group',
        group_id: groupId
      });
    }
  },
  inviteToGroup: function(context, payload) {
    wsManager.send({
      type: 'invite_to_group',
      group_id: payload.groupId,
      invite_user_id: payload.userId
    });
  },
  setAnnouncement: function(context, payload) {
    wsManager.send({
      type: 'set_announcement',
      group_id: payload.groupId,
      announcement: payload.announcement
    });
  },
  kickMember: function(context, payload) {
    wsManager.send({
      type: 'kick_member',
      group_id: payload.groupId,
      target_user_id: payload.targetUserId
    });
  },
  renameGroup: function(context, payload) {
    wsManager.send({
      type: 'rename_group',
      group_id: payload.groupId,
      new_name: payload.newName
    });
  },
  markRead: function(context, payload) {
    wsManager.send({
      type: 'mark_read',
      target_user_id: payload.targetUserId,
      message_ids: payload.messageIds || []
    });
  }
};

export default {
  namespaced: true,
  state: state,
  getters: getters,
  mutations: mutations,
  actions: actions
};
