import axios from 'axios';

var state = {
  token: localStorage.getItem('token') || '',
  user: (function() { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { localStorage.removeItem('user'); return null; } })()
};

var getters = {
  isLoggedIn: function(state) { return !!state.token; },
  isAdmin: function(state) { return state.user && state.user.is_admin === 1; },
  isOfficer: function(state) { return state.user && state.user.role === 'officer'; },
  officerPermissions: function(state) {
    if (!state.user) return [];
    if (state.user.officer_permissions) {
      if (typeof state.user.officer_permissions === 'string') {
        try { return JSON.parse(state.user.officer_permissions); } catch (e) { return []; }
      }
      return state.user.officer_permissions;
    }
    return [];
  },
  canManage: function(state) {
    return function(permission) {
      if (state.user && state.user.is_admin === 1) return true;
      if (state.user && state.user.role === 'officer') {
        var perms = [];
        if (typeof state.user.officer_permissions === 'string') {
          try { perms = JSON.parse(state.user.officer_permissions); } catch (e) { return false; }
        } else if (Array.isArray(state.user.officer_permissions)) {
          perms = state.user.officer_permissions;
        }
        return perms.indexOf(permission) !== -1;
      }
      return false;
    };
  },
  user: function(state) { return state.user; }
};

var mutations = {
  SET_TOKEN: function(state, token) {
    state.token = token;
    localStorage.setItem('token', token);
  },
  SET_USER: function(state, user) {
    state.user = user;
    localStorage.setItem('user', JSON.stringify(user));
  },
  LOGOUT: function(state) {
    state.token = '';
    state.user = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }
};

var actions = {
  login: function(context, credentials) {
    return axios.post('/api/auth/login', credentials).then(function(response) {
      if (response.data.code !== 200) {
        // 附带 response 模拟 axios 错误结构，让调用方 catch 能读取 err.response.data.message
        var err = new Error(response.data.message || '登录失败');
        err.response = response;
        return Promise.reject(err);
      }
      var data = response.data.data;
      context.commit('SET_TOKEN', data.token);
      context.commit('SET_USER', data.user_info);
      return data;
    });
  },
  logout: function(context) {
    context.commit('LOGOUT');
  }
};

export default {
  namespaced: true,
  state: state,
  getters: getters,
  mutations: mutations,
  actions: actions
};
