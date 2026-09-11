var state = {
  activities: [],
  // 通知历史的「外部唤出」请求信号。
  // SuperIsland 内部的通知历史是组件局部状态，桌面等外部视图无法直接改。
  // 约定：外部只递增 historyRequestSeq，SuperIsland watch 到变化后自行切到 history 模式。
  // 用自增序号而非布尔量，保证连续两次请求（中间未复位）也能被观察到。
  historyRequestSeq: 0,
  // 已读状态变更信号。
  // 已读记录存在 localStorage（utils/read-state.js），本身不可响应式观测。
  // 公告中心标记已读后递增此序号，桌面浮窗与超能岛 watch 到变化后重新求值，
  // 避免「在公告中心看完了、回桌面浮窗还挂着」。
  readStateSeq: 0
};

var mutations = {
  START_ACTIVITY: function(s, activity) {
    var idx = -1;
    for (var i = 0; i < s.activities.length; i++) {
      if (s.activities[i].id === activity.id) { idx = i; break; }
    }
    if (idx >= 0) {
      s.activities.splice(idx, 1, Object.assign({}, s.activities[idx], activity));
    } else {
      s.activities.push(Object.assign({}, activity));
    }
  },
  UPDATE_ACTIVITY: function(s, payload) {
    for (var i = 0; i < s.activities.length; i++) {
      if (s.activities[i].id === payload.id) {
        s.activities.splice(i, 1, Object.assign({}, s.activities[i], payload.updates));
        break;
      }
    }
  },
  END_ACTIVITY: function(s, activityId) {
    s.activities = s.activities.filter(function(a) { return a.id !== activityId; });
  },
  // 请求唤出通知历史（由 Desktop.vue 双击空白处等外部入口提交）
  OPEN_HISTORY: function(s) {
    s.historyRequestSeq++;
  },
  // 已读状态变更（由公告中心等页面提交），外部组件据此重算未读
  READ_STATE_CHANGED: function(s) {
    s.readStateSeq++;
  }
};

export default {
  namespaced: true,
  state: state,
  mutations: mutations
};
