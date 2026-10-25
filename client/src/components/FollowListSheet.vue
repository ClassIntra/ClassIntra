<template>
  <div class="fl-overlay" @click.self="$emit('close')">
    <div class="fl-sheet" @click.stop>
      <div class="fl-header">
        <span class="fl-title">{{ direction === 'followers' ? '粉丝' : '关注' }}</span>
        <span v-if="total" class="fl-count">{{ total }}</span>
        <button class="fl-close" @click="$emit('close')" title="关闭"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <div class="fl-body scrollbar-thin" ref="body" @scroll="onScroll">
        <div v-if="loading && users.length === 0" class="fl-state">
          <i class="fa-solid fa-spinner fa-spin"></i><span>加载中...</span>
        </div>
        <div v-else-if="error" class="fl-state">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>{{ error }}</span>
          <button class="fl-retry" @click="reload">重试</button>
        </div>
        <div v-else-if="users.length === 0" class="fl-state">
          <i class="fa-regular fa-user"></i>
          <span>{{ direction === 'followers' ? '还没有粉丝' : '还没有关注任何人' }}</span>
        </div>
        <template v-else>
          <div
            v-for="u in users"
            :key="u.user_id"
            class="fl-row"
            @click="goProfile(u.user_id)"
          >
            <UserAvatar
              :user-id="u.user_id"
              :name="u.net_name"
              :size="44"
              :avatar="{ has_avatar: u.has_avatar, hash: u.avatar_hash, crop: parseCrop(u.avatar_crop) }"
            />
            <div class="fl-info">
              <div class="fl-name">
                {{ u.net_name }}
                <span v-if="u.is_self" class="fl-self">我</span>
              </div>
              <div class="fl-sign">{{ u.signature || '这个人很懒，还没写签名' }}</div>
            </div>
            <button
              v-if="!u.is_self"
              class="fl-btn"
              :class="{ followed: u.is_following, busy: u._busy }"
              :disabled="u._busy"
              @click.stop="toggle(u)"
            >
              <i :class="u.is_following ? 'fa-solid fa-check' : 'fa-solid fa-plus'"></i>
              <span>{{ u.is_following ? '已关注' : '关注' }}</span>
            </button>
          </div>
          <div v-if="loadingMore" class="fl-more"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</div>
          <div v-else-if="!hasMore" class="fl-end">没有更多了</div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';
import UserAvatar from '@/components/UserAvatar.vue';
import { normalizeCrop } from '@/utils/avatar-crop';

// 关注 / 粉丝列表（底部滑出，与全站选图/裁剪同一套弹层语言）
export default {
  name: 'FollowListSheet',
  components: { UserAvatar: UserAvatar },
  props: {
    userId: { type: [String, Number], required: true },
    // 'followers' | 'following'
    direction: { type: String, default: 'followers' }
  },
  data: function() {
    return {
      users: [],
      total: 0,
      page: 1,
      hasMore: false,
      loading: true,
      loadingMore: false,
      error: ''
    };
  },
  watch: {
    direction: function() { this.reload(); },
    userId: function() { this.reload(); }
  },
  mounted: function() {
    this.reload();
  },
  methods: {
    parseCrop: function(raw) {
      if (!raw) return { zoom: 1, ox: 0, oy: 0 };
      try { return normalizeCrop(JSON.parse(raw)); } catch (e) { return { zoom: 1, ox: 0, oy: 0 }; }
    },
    reload: function() {
      this.users = [];
      this.total = 0;
      this.page = 1;
      this.hasMore = false;
      this.error = '';
      this.fetch(true);
    },
    fetch: function(reset) {
      var self = this;
      if (self.loadingMore) return;
      if (reset) self.loading = true; else self.loadingMore = true;
      var endpoint = '/user/follow/' + self.userId + '/' + (self.direction === 'followers' ? 'followers' : 'following');
      api.get(endpoint, { params: { page: self.page } }).then(function(res) {
        var data = (res.data && res.data.data) || {};
        var list = (data.users || []).map(function(u) {
          u._busy = false;
          return u;
        });
        self.users = reset ? list : self.users.concat(list);
        self.total = data.total || 0;
        self.hasMore = !!data.has_more;
      }).catch(function(err) {
        var body = err.response && err.response.data;
        self.error = (body && body.message) || '加载失败，请稍后重试';
      }).then(function() {
        self.loading = false;
        self.loadingMore = false;
      });
    },
    onScroll: function(e) {
      var el = e.target;
      if (!this.hasMore || this.loadingMore) return;
      // 距底部不足 120px 就预取下一页
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        this.page += 1;
        this.fetch(false);
      }
    },
    toggle: function(u) {
      var self = this;
      if (u._busy) return;
      u._busy = true;
      var was = u.is_following;
      var req = was
        ? api.delete('/user/follow/' + u.user_id)
        : api.post('/user/follow/' + u.user_id);
      req.then(function() {
        u.is_following = !was;
        self.$emit('changed', { user_id: u.user_id, following: !was });
      }).catch(function(err) {
        var body = err.response && err.response.data;
        self.$store.commit('toast/SHOW_TOAST', { message: (body && body.message) || '操作失败', type: 'error' });
      }).then(function() {
        u._busy = false;
      });
    },
    goProfile: function(uid) {
      this.$emit('close');
      this.$router.push('/profile/' + uid);
    }
  }
};
</script>

<style scoped>
.fl-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 10002;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.fl-sheet {
  width: 100%;
  max-width: 560px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--card-bg);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  animation: flSlideUp 0.3s ease;
}

@keyframes flSlideUp {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.fl-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.fl-title {
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}

.fl-count {
  flex-shrink: 0;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  margin-right: 4px;
}

.fl-close {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--radius-sm, 8px);
  background: transparent;
  color: var(--text-secondary);
  font-size: 15px;
  cursor: pointer;
}
.fl-close:hover { background: var(--primary-lighter); color: var(--text-primary); }

.fl-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 6px 0 12px;
}

.fl-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 44px 20px;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption1);
  text-align: center;
}
.fl-state i { font-size: 24px; }

.fl-retry {
  margin-top: 4px;
  min-height: 34px;
  padding: 0 16px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md, 10px);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-footnote);
  cursor: pointer;
}

.fl-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
}
.fl-row:hover { background: var(--primary-lighter); }

.fl-info { flex: 1; min-width: 0; }

.fl-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-footnote, 14px);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fl-self {
  padding: 0 5px;
  border-radius: var(--radius-xs, 4px);
  background: var(--primary-lighter);
  color: var(--primary-color);
  font-size: var(--font-size-caption2);
  font-weight: var(--font-weight-regular, 400);
}

.fl-sign {
  margin-top: 2px;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fl-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 0 13px;
  border: 0.5px solid var(--primary-color);
  border-radius: var(--radius-pill, 999px);
  background: var(--primary-color);
  color: #fff;
  font-size: var(--font-size-caption1);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-standard);
}
.fl-btn.followed {
  background: transparent;
  border-color: var(--separator-color);
  color: var(--text-secondary);
}
.fl-btn.busy { opacity: 0.55; cursor: default; }

.fl-more, .fl-end {
  padding: 14px 20px 6px;
  text-align: center;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
}
</style>
