var state = {
  activities: [],
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
