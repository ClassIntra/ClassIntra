import Vue from 'vue';
import api from '@/utils/api';

function transformFoodItem(item) {
  var extra = {};
  try { extra = JSON.parse(item.extra_json || '{}'); } catch (e) {}
  return Object.assign({}, item, {
    dish_name: item.title || '',
    canteen: extra.canteen || '',
    window: extra.window || '',
    reason: item.content || '',
    is_anonymous: item.anonymous || item.is_anonymous || 0
  });
}

function transformHotItem(item) {
  var extra = {};
  try { extra = JSON.parse(item.extra_json || '{}'); } catch (e) {}
  return Object.assign({}, item, {
    detail: item.content || '',
    location: extra.location || '',
    is_anonymous: item.anonymous || item.is_anonymous || 0
  });
}

var state = {
  posts: [],
  postsTotal: 0,
  currentPost: null,
  comments: [],
  foodRanking: [],
  hotRanking: [],
  profile: null,
  myPosts: [],
  myPostsTotal: 0,
  groups: [],
  searchResults: [],
  searchTotal: 0,
  userStats: {},
  bookmarks: [],
  bookmarksTotal: 0,
  tagList: []
};

var mutations = {
  SET_POSTS: function(state, data) { state.posts = data.posts; state.postsTotal = data.total; },
  ADD_POST: function(state, post) { state.posts.unshift(post); },
  REMOVE_POST: function(state, postId) {
    state.posts = state.posts.filter(function(p) { return p.id !== postId; });
    state.myPosts = state.myPosts.filter(function(p) { return p.id !== postId; });
    state.bookmarks = state.bookmarks.filter(function(p) { return p.id !== postId; });
  },
  SET_CURRENT_POST: function(state, post) { state.currentPost = post; },
  SET_COMMENTS: function(state, comments) { state.comments = comments; },
  ADD_COMMENT: function(state, comment) { state.comments.push(comment); },
  SET_FOOD_RANKING: function(state, ranking) { state.foodRanking = ranking; },
  SET_HOT_RANKING: function(state, ranking) { state.hotRanking = ranking; },
  SET_PROFILE: function(state, profile) { state.profile = profile; },
  SET_MY_POSTS: function(state, data) { state.myPosts = data.posts; state.myPostsTotal = data.total; },
  SET_GROUPS: function(state, groups) { state.groups = groups; },
  SET_SEARCH_RESULTS: function(state, data) { state.searchResults = data.posts; state.searchTotal = data.total; },
  SET_USER_STATS: function(state, data) {
    var key = data.userId;
    var obj = {};
    obj[key] = data.stats;
    state.userStats = Object.assign({}, state.userStats, obj);
  },
  SET_BOOKMARKS: function(state, data) { state.bookmarks = data.posts; state.bookmarksTotal = data.total; },
  TOGGLE_POST_BOOKMARK: function(state, postId) {
    var posts = [state.currentPost];
    state.posts.forEach(function(p) { posts.push(p); });
    state.searchResults.forEach(function(p) { posts.push(p); });
    state.bookmarks.forEach(function(p) { posts.push(p); });
    posts.forEach(function(p) {
      if (p && p.id === postId) {
        Vue.set(p, 'bookmarked', !p.bookmarked);
      }
    });
  },
  SET_TAG_LIST: function(state, tags) { state.tagList = tags; },
  APPEND_POSTS: function(state, posts) {
    var existingIds = {};
    for (var i = 0; i < state.posts.length; i++) {
      existingIds[state.posts[i].id] = true;
    }
    for (var j = 0; j < posts.length; j++) {
      if (!existingIds[posts[j].id]) {
        state.posts.push(posts[j]);
      }
    }
  }
};

var actions = {
  fetchPosts: function(context, params) {
    return api.get('/community/posts', { params: params }).then(function(res) {
      context.commit('SET_POSTS', res.data.data);
      var allTags = [];
      var posts = res.data.data.posts || [];
      for (var i = 0; i < posts.length; i++) {
        if (posts[i].tags && Array.isArray(posts[i].tags)) {
          for (var j = 0; j < posts[i].tags.length; j++) {
            if (allTags.indexOf(posts[i].tags[j]) === -1) {
              allTags.push(posts[i].tags[j]);
            }
          }
        }
      }
      if (allTags.length > 0) {
        context.commit('SET_TAG_LIST', allTags);
      }
    });
  },
  fetchPostsPage: function(context, params) {
    return api.get('/community/posts', { params: { page: params.page || 1, limit: 20, sort: params.sort || 'latest' } }).then(function(response) {
      var data = response.data.data;
      var newPosts = data.posts || [];
      context.commit('APPEND_POSTS', newPosts);
      return { has_more: newPosts.length >= 20 };
    });
  },
  createPost: function(context, data) {
    return api.post('/community/posts', data).then(function(res) {
      context.commit('ADD_POST', res.data.data);
      return res.data.data;
    });
  },
  deletePost: function(context, postId) {
    return api.delete('/community/posts/' + postId).then(function() {
      context.commit('REMOVE_POST', postId);
    });
  },
  fetchComments: function(context, postId) {
    return api.get('/community/posts/' + postId + '/comments').then(function(res) {
      context.commit('SET_COMMENTS', res.data.data);
    });
  },
  addComment: function(context, data) {
    return api.post('/community/posts/' + data.postId + '/comments', data).then(function(res) {
      context.commit('ADD_COMMENT', res.data.data);
    });
  },
  toggleLike: function(context, data) {
    if (data.liked) {
      return api.delete('/community/likes', { data: data });
    }
    return api.post('/community/likes', data);
  },
  fetchFoodRanking: function(context) {
    return api.get('/community/ranking/food').then(function(res) {
      var items = (res.data.data || []).map(transformFoodItem);
      context.commit('SET_FOOD_RANKING', items);
    });
  },
  fetchHotRanking: function(context) {
    return api.get('/community/ranking/hot').then(function(res) {
      var items = (res.data.data || []).map(transformHotItem);
      context.commit('SET_HOT_RANKING', items);
    });
  },
  createFood: function(context, data) {
    return api.post('/community/ranking/food', data);
  },
  createHot: function(context, data) {
    return api.post('/community/ranking/hot', data);
  },
  fetchProfile: function(context) {
    return api.get('/community/profile').then(function(res) {
      context.commit('SET_PROFILE', res.data.data);
    });
  },
  updateProfile: function(context, data) {
    return api.put('/community/profile', data);
  },
  fetchUserProfile: function(context, userId) {
    return api.get('/community/profile/' + userId).then(function(res) {
      return res.data.data;
    });
  },
  fetchUserStats: function(context, userId) {
    return api.get('/community/user-stats/' + userId).then(function(res) {
      context.commit('SET_USER_STATS', { userId: userId, stats: res.data.data });
      return res.data.data;
    });
  },
  fetchMyPosts: function(context, params) {
    return api.get('/community/my/posts', { params: params }).then(function(res) {
      context.commit('SET_MY_POSTS', res.data.data);
    });
  },
  fetchGroups: function(context) {
    return api.get('/community/groups').then(function(res) {
      context.commit('SET_GROUPS', res.data.data);
    });
  },
  createGroup: function(context, name) {
    return api.post('/community/groups', { name: name }).then(function(res) {
      context.dispatch('fetchGroups');
      return res.data.data;
    });
  },
  searchPosts: function(context, params) {
    return api.get('/community/search', { params: params }).then(function(res) {
      context.commit('SET_SEARCH_RESULTS', res.data.data);
    });
  },
  toggleBookmark: function(context, postId) {
    var currentPost = context.state.currentPost;
    var isBookmarked = currentPost && currentPost.id === postId ? currentPost.bookmarked : false;
    var found = context.state.posts.find(function(p) { return p.id === postId; });
    if (found) { isBookmarked = found.bookmarked; }
    if (!isBookmarked) {
      found = context.state.bookmarks.find(function(p) { return p.id === postId; });
      if (found) { isBookmarked = found.bookmarked; }
    }

    if (isBookmarked) {
      return api.delete('/community/bookmarks/' + postId).then(function() {
        context.commit('TOGGLE_POST_BOOKMARK', postId);
      });
    }
    return api.post('/community/bookmarks/' + postId).then(function() {
      context.commit('TOGGLE_POST_BOOKMARK', postId);
    });
  },
  fetchBookmarks: function(context, params) {
    return api.get('/community/bookmarks', { params: params }).then(function(res) {
      context.commit('SET_BOOKMARKS', res.data.data);
    });
  },
  incrementShareCount: function(context, postId) {
    return api.post('/community/posts/' + postId + '/share');
  },
  addReaction: function(context, data) {
    return api.post('/community/reactions', data);
  },
  removeReaction: function(context, data) {
    return api.delete('/community/reactions', { data: data });
  },
  fetchReactions: function(context, params) {
    return api.get('/community/reactions/' + params.messageId, { params: { type: params.messageType } }).then(function(res) {
      return res.data.data;
    });
  }
};

export default {
  namespaced: true,
  state: state,
  mutations: mutations,
  actions: actions,
  getters: {}
};
