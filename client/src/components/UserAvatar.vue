<template>
  <div class="user-avatar" :style="avatarStyle" @click="$emit('click', $event)">
    <!-- 图片头像：与文字头像共用同一个容器，图挂了/还没设就回落文字，
         观感上永远是"有个头像"，不会出现空白方块 -->
    <img
      v-if="showImage"
      :src="imageUrl"
      class="user-avatar-img"
      :style="imageStyle"
      :alt="name"
      draggable="false"
      decoding="async"
      loading="lazy"
      @load="onImageLoad"
      @error="onImageError"
    />
    <span v-if="!showImage" class="user-avatar-text">{{ displayText }}</span>
  </div>
</template>

<script>
import helpers from '@/utils/helpers';
import { ensureAvatars, getAvatar, pickUrl, onAvatarsUpdated, refreshAvatars } from '@/utils/avatar-store';
import { computeCropTransform } from '@/utils/avatar-crop';

export default {
  name: 'UserAvatar',
  props: {
    userId: { type: [String, Number], default: '' },
    name: { type: String, default: '' },
    isAnonymous: { type: Boolean, default: false },
    size: { type: Number, default: 40 },
    // 外部可以直接喂头像数据（已从别处拿到时免一次查询）；不传则组件自己按需拉
    avatar: { type: Object, default: null },
    // 是否联网查该 userId 的头像。群聊 / 系统等"永远不会有图片头像"的场合传 false，
    // 省掉一次无谓的批量请求，但仍保留 userId 哈希出来的稳定配色。
    lookup: { type: Boolean, default: true }
  },
  data: function() {
    return {
      naturalWidth: 0,
      naturalHeight: 0,
      imageFailed: false,
      // ⚠️ 关键：avatar-store 的缓存是模块级普通对象，不是 Vue 响应式数据。
      // 之前直接在 computed 里 return getAvatar(userId)，数据异步到达后 computed
      // 的依赖（只有 userId）没变 → 永远不重算 → 首批渲染的用户头像一直空着，
      // 只有第二次进页面（缓存已热）才显示，这就是「头像有时不显示」的根因。
      // 现在把结果落到组件 data，数据一到就赋值触发重渲染。
      resolvedAvatar: null,
      unsubscribe: null,
      // 图片加载失败的重试计数：云盘图经 relay 偶发抖动，第一次失败就永久回落
      // 文字头像太可惜（封面都有 2 次重试）。带 &r=n 绕过可能损坏的缓存副本。
      imageRetry: 0
    };
  },
  computed: {
    avatarData: function() {
      if (this.avatar) return this.avatar;
      return this.resolvedAvatar;
    },
    hasImage: function() {
      return !!(this.avatarData && this.avatarData.has_avatar && this.avatarData.hash);
    },
    showImage: function() {
      return this.hasImage && !this.imageFailed;
    },
    imageUrl: function() {
      var base = pickUrl(this.avatarData, this.size);
      if (!base) return '';
      // 重试时换一个查询参数：浏览器对「加载失败」的响应也可能进了缓存，
      // 同 URL 再请求会直接吃缓存里的错误响应，必须换 key
      if (this.imageRetry > 0) {
        base += (base.indexOf('?') > -1 ? '&' : '?') + 'r=' + this.imageRetry;
      }
      return base;
    },
    avatarStyle: function() {
      var color = this.isAnonymous ? '#9E9E9E' : helpers.getAvatarColor(this.userId);
      return {
        width: this.size + 'px',
        height: this.size + 'px',
        fontSize: Math.max(12, this.size * 0.4) + 'px',
        background: this.showImage ? 'var(--avatar-img-bg, #E5E5EA)' : color
      };
    },
    imageStyle: function() {
      if (!this.naturalWidth || !this.naturalHeight) {
        // 图片尺寸未知（还没 load 完）：先藏起来等 onImageLoad 补上，
        // 否则 transform 会是 scale(0) 直接看不见
        return { opacity: 0 };
      }
      return {
        opacity: 1,
        transform: 'translate(-50%, -50%) ' + computeCropTransform(this.naturalWidth, this.naturalHeight, this.size, this.size, this.avatarData && this.avatarData.crop)
      };
    },
    displayText: function() {
      if (this.isAnonymous) return '?';
      return helpers.getAvatarText(this.name);
    }
  },
  watch: {
    userId: function() { this.loadAvatar(); },
    avatar: function() { this.imageFailed = false; this.imageRetry = 0; this.naturalWidth = 0; this.naturalHeight = 0; },
    // 换图（设置页刚改完 / 数据晚到）：旧 naturalWidth 会让 transform 短暂失准，
    // 先清零等新的 load 事件补上，中间用 opacity:0 过渡
    imageUrl: function() { this.naturalWidth = 0; this.naturalHeight = 0; }
  },
  mounted: function() { this.loadAvatar(); },
  beforeDestroy: function() {
    // 组件销毁时退订，否则 listeners 数组会随列表滚动无限增长
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
  },
  methods: {
    loadAvatar: function() {
      // 换人先清场：否则 /profile/A → /profile/B 时会短暂挂着 A 的头像
      this.resolvedAvatar = null;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.imageFailed = false;
      this.imageRetry = 0;
      if (this.avatar || !this.userId || !this.lookup) return;
      // 1) 缓存已热（别人先查过 / 上次进页面留下的）→ 立即同步，不必等网络
      var cached = getAvatar(this.userId);
      if (cached) this.resolvedAvatar = cached;
      // 2) 批量合并请求（见 avatar-store），一屏几十个头像也只打一次网络
      ensureAvatars([this.userId]);
      // 3) 订阅数据到达：缓存不是响应式的，只能靠回调把结果搬进 data
      if (!this.unsubscribe) {
        this.unsubscribe = onAvatarsUpdated(this.onAvatarsUpdated);
      }
    },
    onAvatarsUpdated: function() {
      var cached = getAvatar(this.userId);
      if (cached) {
        if (cached !== this.resolvedAvatar) this.resolvedAvatar = cached;
        return;
      }
      // 缓存里没有但组件还显示着旧头像 = 用户在别处改过（invalidate 通知来的），
      // 清掉旧数据并重新拉，避免回到聊天还看到上一张头像
      if (this.resolvedAvatar) {
        this.resolvedAvatar = null;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
        this.imageRetry = 0;
        refreshAvatars([this.userId]);
      }
    },
    onImageLoad: function(e) {
      var img = e.target;
      // ⚠️ 不要在这里重置 imageRetry：它参与 imageUrl 的计算，一归零 src 就会
      // 从「?w=256&r=1」翻回「?w=256」→ 浏览器重新请求 → 若重试前的坏响应被缓存/
      // 或请求再次失败，就形成「加载成功→翻回→再失败→再重试」的循环，且每次翻回
      // 都会触发 imageUrl watcher 清零 naturalWidth，头像肉眼可见地闪一下。
      // 重试计数只在该头像「换人/换图」时清零（loadAvatar / watch avatar）。
      this.naturalWidth = img.naturalWidth;
      this.naturalHeight = img.naturalHeight;
    },
    onImageError: function() {
      // 云盘文件被删/同步未到位：先重试一次，仍失败才回落文字头像
      if (this.imageRetry < 1 && this.avatarData && this.avatarData.hash) {
        // imageRetry 进了 imageUrl 的 computed：+1 即换 URL（&r=1），
        // imageUrl watcher 会顺手清零 naturalWidth，浏览器重新发起请求
        this.imageRetry += 1;
        return;
      }
      this.imageFailed = true;
    }
  }
};
</script>

<style scoped>
.user-avatar {
  border-radius: 50%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  flex-shrink: 0;
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-standard);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Symbol', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
  /* 图片头像的裁切容器：必须 overflow:hidden，否则 scale 后的图会溢出成方块 */
  position: relative;
  overflow: hidden;
}
.user-avatar:hover {
  opacity: 0.85;
}
.user-avatar-text {
  line-height: 1;
}
/* 图片按自然尺寸渲染，靠 transform 缩放/平移来裁切。
   max-width:none 是必须的 —— 全局 reset 常给 img 设 max-width:100%，
   那会让图片被提前压扁，transform 的数学全部失准。 */
.user-avatar-img {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  transform-origin: center center;
  user-select: none;
  -webkit-user-select: none;
  transition: opacity var(--duration-fast) var(--ease-standard);
}
</style>
