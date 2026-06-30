var state = {
  theme: localStorage.getItem('theme') || 'light',
  wallpaper: localStorage.getItem('wallpaper') || 'default',
  notifications: (function() { try { var saved = localStorage.getItem('notifications'); return saved ? JSON.parse(saved) : { chat: true, broadcast: true, aiChat: true, community: true, system: true }; } catch(e) { return { chat: true, broadcast: true, aiChat: true, community: true, system: true }; } })(),
  // 桌面布局模式：'grid'（iPad 桌面图标 + Dock）| 'dock'（仅 Dock）
  desktopLayout: localStorage.getItem('desktopLayout') || 'grid'
};

var getters = {
  theme: function(state) { return state.theme; },
  wallpaper: function(state) { return state.wallpaper; },
  notifications: function(state) { return state.notifications; },
  desktopLayout: function(state) { return state.desktopLayout; }
};

var mutations = {
  SET_THEME: function(state, theme) {
    state.theme = theme;
    localStorage.setItem('theme', theme);
    if (theme === 'light') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  },
  SET_WALLPAPER: function(state, wallpaper) {
    state.wallpaper = wallpaper;
    localStorage.setItem('wallpaper', wallpaper);
  },
  SET_NOTIFICATIONS: function(state, payload) {
    state.notifications = Object.assign({}, state.notifications, payload);
    try { localStorage.setItem('notifications', JSON.stringify(state.notifications)); } catch(e) {}
  },
  SET_DESKTOP_LAYOUT: function(state, layout) {
    state.desktopLayout = layout;
    localStorage.setItem('desktopLayout', layout);
  }
};

var actions = {
  loadSettings: function(context) {
    var theme = localStorage.getItem('theme') || 'light';
    var wallpaper = localStorage.getItem('wallpaper') || 'default';
    var desktopLayout = localStorage.getItem('desktopLayout') || 'grid';
    context.commit('SET_THEME', theme);
    context.commit('SET_WALLPAPER', wallpaper);
    context.commit('SET_DESKTOP_LAYOUT', desktopLayout);
  },
  saveSettings: function(context) {
    // Settings are auto-saved via localStorage in mutations
  }
};

export default {
  namespaced: true,
  state: state,
  getters: getters,
  mutations: mutations,
  actions: actions
};
