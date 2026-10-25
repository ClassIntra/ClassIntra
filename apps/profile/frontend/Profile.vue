<template>
  <div class="profile-page ci-skin-scope">
    <AppNavBar :title="pageTitle" />

    <!-- 骨架屏：比整页转圈体感快，也避免布局跳动 -->
    <div v-if="loading" class="profile-skeleton">
      <div class="sk-cover sk-shimmer"></div>
      <div class="sk-body">
        <div class="sk-avatar sk-shimmer"></div>
        <div class="sk-line sk-line--lg sk-shimmer"></div>
        <div class="sk-line sk-line--sm sk-shimmer"></div>
        <div class="sk-stats sk-shimmer"></div>
        <div class="sk-post sk-shimmer" v-for="n in 3" :key="n"></div>
      </div>
    </div>

    <div v-else-if="notFound" class="profile-state">
      <i class="fa-solid fa-user-slash"></i><span>用户不存在</span>
    </div>

    <!-- 加载失败 / 无权限：**不能**退化成"空主页"，必须说清楚原因 -->
    <div v-else-if="loadError" class="profile-state profile-state--error">
      <i :class="loadError.banned ? 'fa-solid fa-lock' : 'fa-solid fa-triangle-exclamation'"></i>
      <span>{{ loadError.title }}</span>
      <p v-if="loadError.detail" class="profile-state-hint">{{ loadError.detail }}</p>
      <p v-if="loadError.expiresAt" class="profile-state-hint">解除时间：{{ loadError.expiresAt }}</p>
      <div class="profile-state-actions">
        <button class="profile-state-btn" @click="load">重试</button>
        <button v-if="loadError.banned" class="profile-state-btn profile-state-btn--ghost" @click="goBanned">查看封禁详情</button>
      </div>
    </div>

    <div v-else class="profile-body scrollbar-thin">
      <div class="profile-card">
        <!-- 封面 + 头像放在同一个定位壳里：头像靠 bottom:0 骑跨封面下沿，
             不需要 JS 量高度，窗口怎么缩放都对得齐 -->
        <div class="profile-hero-shell">
          <!-- ══ 封面 ══ -->
          <div
            class="profile-cover"
            :class="{ 'profile-cover--empty': !cover.has_cover }"
            :style="{ height: coverBoxH + 'px' }"
            ref="cover"
            @click="openCoverPreview"
          >
            <img
              v-if="cover.has_cover"
              ref="coverImg"
              :src="coverUrl"
              class="profile-cover-img"
              :style="coverImgStyle"
              alt=""
              draggable="false"
              decoding="async"
              @load="onCoverLoad"
              @error="onCoverError"
            />
            <div v-if="!cover.has_cover || coverFailed" class="profile-cover-fallback" :style="{ backgroundImage: defaultCoverGradient }">
              <span class="profile-cover-glow"></span>
              <span class="profile-cover-mesh"></span>
            </div>
            <!-- 底部渐隐：保证叠在上面的按钮永远可读 -->
            <div class="profile-cover-scrim"></div>
            <span v-if="!cover.has_cover && !isSelf" class="profile-cover-hint">还没有设置封面</span>
            <button v-if="isSelf" class="profile-cover-edit" @click.stop="openCoverCropper">
              <i class="fa-solid fa-camera"></i>
              <span>{{ cover.has_cover ? '更换封面' : '设置封面' }}</span>
            </button>
          </div>

          <!-- ══ 头像（骑跨封面下沿，点击放大）══ -->
          <div class="profile-avatar-slot" @click="openAvatarPreview">
            <UserAvatar :user-id="userId" :name="profile.net_name" :size="96" />
            <span class="profile-avatar-zoom"><i class="fa-solid fa-magnifying-glass-plus"></i></span>
          </div>
        </div>

        <!-- ══ 身份 + 操作 ══ -->
        <div class="profile-identity">
          <div class="profile-identity-head">
            <div class="profile-name-block">
              <div class="profile-name-row">
                <h1 class="profile-name">{{ profile.net_name || '未知用户' }}</h1>
                <img v-if="showLevelIcon" :src="levelIconUrl" class="profile-level" alt="等级" />
                <span v-if="levelInfo.role === 'admin'" class="profile-badge">管理</span>
                <span v-if="levelInfo.officer_title" class="profile-badge profile-badge-officer">{{ levelInfo.officer_title }}</span>
                <span v-if="isSelf" class="profile-badge profile-badge-self">我自己</span>
              </div>
              <div v-if="profile.real_name" class="profile-realname">
                <i class="fa-solid fa-id-card"></i>{{ profile.real_name }}
              </div>
            </div>

            <div class="profile-actions">
              <template v-if="isSelf">
                <!-- 换封面已经在封面上有悬浮按钮，这里不再重复一个 -->
                <button class="profile-btn profile-btn-primary" @click="goEditProfile">
                  <i class="fa-solid fa-user-pen"></i><span>编辑资料</span>
                </button>
              </template>
              <template v-else>
                <button
                  class="profile-btn"
                  :class="{ liked: profile.liked_by_me }"
                  :title="profile.liked_by_me ? '取消点赞' : '给 TA 点赞'"
                  @click="toggleLike"
                >
                  <i :class="profile.liked_by_me ? 'fa-solid fa-heart' : 'fa-regular fa-heart'"></i>
                  <span>{{ profile.liked_by_me ? '已赞' : '点赞' }}</span>
                  <span class="profile-btn-count">{{ profile.like_count || 0 }}</span>
                </button>
                <button
                  class="profile-btn"
                  :class="followState.following ? 'followed' : 'profile-btn-primary'"
                  :disabled="followBusy"
                  @click="toggleFollow"
                >
                  <i :class="followState.following ? 'fa-solid fa-check' : 'fa-solid fa-plus'"></i>
                  <span>{{ followButtonText }}</span>
                </button>
                <button class="profile-btn" @click="sendMessage">
                  <i class="fa-regular fa-comment-dots"></i><span>发消息</span>
                </button>
              </template>
            </div>
          </div>

          <p v-if="profile.signature" class="profile-signature">{{ profile.signature }}</p>
          <p v-else class="profile-signature profile-signature--muted">这个人很懒，还没写签名</p>
        </div>

        <!-- ══ 统计 ══ -->
        <div class="profile-stats">
          <div class="profile-stat">
            <span class="profile-stat-value">{{ stats.post_count || 0 }}</span>
            <span class="profile-stat-label">帖子</span>
          </div>
          <div class="profile-stat">
            <span class="profile-stat-value">{{ stats.like_count || 0 }}</span>
            <span class="profile-stat-label">获赞</span>
          </div>
          <!-- 关注/粉丝可点：弹出名单，能在名单里直接关注/取关 -->
          <button class="profile-stat profile-stat--action" @click="openFollowSheet('following')">
            <span class="profile-stat-value">{{ followState.following_count || 0 }}</span>
            <span class="profile-stat-label">关注<i class="fa-solid fa-chevron-right profile-stat-arrow"></i></span>
          </button>
          <button class="profile-stat profile-stat--action" @click="openFollowSheet('followers')">
            <span class="profile-stat-value">{{ followState.followers || 0 }}</span>
            <span class="profile-stat-label">粉丝<i class="fa-solid fa-chevron-right profile-stat-arrow"></i></span>
          </button>
        </div>

        <!-- ══ 分栏 ══ -->
        <div class="profile-tabs">
          <button class="profile-tab" :class="{ active: tab === 'posts' }" @click="switchTab('posts')">帖子</button>
          <button class="profile-tab" :class="{ active: tab === 'info' }" @click="switchTab('info')">资料</button>
        </div>
      </div>

      <!-- ══ 帖子列表 ══ -->
      <div v-if="tab === 'posts'" class="profile-panel">
        <!-- 分类与社区主页一致：论坛（含投票/问卷）/ 美食 / 热榜 -->
        <div class="profile-filters" v-if="!postsError">
          <button
            v-for="f in postFilters"
            :key="f.key"
            class="profile-filter"
            :class="{ active: postType === f.key }"
            @click="setPostType(f.key)"
          >{{ f.label }}</button>
        </div>
        <div v-if="postsLoading && posts.length === 0" class="profile-post-skeletons">
          <div v-for="n in 3" :key="n" class="sk-post sk-shimmer"></div>
        </div>

        <!-- 拉取失败（无权限 / 被限制 / 网络）：绝不能显示成"TA 没发过帖子" -->
        <div v-else-if="postsError" class="profile-empty profile-empty--boxed profile-empty--error">
          <i class="fa-solid fa-lock"></i>
          <span>{{ postsError.title }}</span>
          <p v-if="postsError.detail" class="profile-state-hint">{{ postsError.detail }}</p>
          <button class="profile-state-btn" @click="loadPosts(true)">重试</button>
        </div>

        <div v-else-if="posts.length === 0" class="profile-empty">
          <i class="fa-regular fa-file-lines"></i>
          <span>{{ isSelf ? '你还没有发过帖子' : 'TA 还没有发过公开的帖子' }}</span>
        </div>
        <div v-else class="profile-post-list">
          <div
            v-for="post in posts"
            :key="post.id"
            class="profile-post"
            @click="openPost(post.id)"
          >
            <div class="profile-post-tag" :class="'tag-' + post.type">{{ postTypeText(post.type) }}</div>
            <div class="profile-post-body">
              <h3 v-if="post.title" class="profile-post-title">{{ post.title }}</h3>
              <p class="profile-post-content">{{ excerpt(post.content) }}</p>
              <div class="profile-post-meta">
                <span><i class="fa-regular fa-heart"></i>{{ post.like_count || 0 }}</span>
                <span><i class="fa-regular fa-comment"></i>{{ post.comment_count || 0 }}</span>
                <span v-if="post.anonymous === 1 || post.is_anonymous" class="profile-post-anon">匿名</span>
                <span class="profile-post-time">{{ formatTime(post.created_at) }}</span>
              </div>
            </div>
          </div>
          <!-- 无限滚动哨兵：进入视口即自动加载下一页，平板上比点按钮顺手 -->
          <div ref="sentinel" class="profile-sentinel">
            <template v-if="postsLoading"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</template>
            <template v-else-if="!hasMorePosts">没有更多了</template>
          </div>
        </div>
      </div>

      <!-- ══ 资料 ══ -->
      <div v-else class="profile-panel">
        <div v-if="hasAnyInfo" class="profile-info">
          <div v-if="profile.birthday" class="profile-info-row">
            <i class="fa-solid fa-cake-candles"></i><span class="k">生日</span><span class="v">{{ profile.birthday }}</span>
          </div>
          <div v-if="profile.gender" class="profile-info-row">
            <i class="fa-solid fa-venus-mars"></i><span class="k">性别</span><span class="v">{{ genderText }}</span>
          </div>
          <!-- QQ / 微信：点一下复制，平板上比手抄 9 位数靠谱 -->
          <div v-if="profile.qq" class="profile-info-row profile-info-row--copy" @click="copyField('QQ', profile.qq)">
            <i class="fa-brands fa-qq"></i><span class="k">QQ</span>
            <span class="v">{{ profile.qq }}</span>
            <span class="profile-copy-btn"><i class="fa-regular fa-copy"></i>复制</span>
          </div>
          <div v-if="profile.wechat" class="profile-info-row profile-info-row--copy" @click="copyField('微信号', profile.wechat)">
            <i class="fa-brands fa-weixin"></i><span class="k">微信</span>
            <span class="v">{{ profile.wechat }}</span>
            <span class="profile-copy-btn"><i class="fa-regular fa-copy"></i>复制</span>
          </div>
          <div v-if="profile.phone" class="profile-info-row profile-info-row--copy" @click="copyField('电话', profile.phone)">
            <i class="fa-solid fa-phone"></i><span class="k">电话</span>
            <span class="v">{{ profile.phone }}</span>
            <span class="profile-copy-btn"><i class="fa-regular fa-copy"></i>复制</span>
          </div>
          <div v-if="profile.address" class="profile-info-row">
            <i class="fa-solid fa-location-dot"></i><span class="k">地址</span><span class="v">{{ profile.address }}</span>
          </div>
        </div>
        <p v-else class="profile-empty profile-empty--boxed">对方还没有公开任何资料</p>
      </div>
    </div>

    <!-- ══ 头像放大查看 ══ -->
      <div v-if="showAvatarLarge" class="profile-lightbox" @click="showAvatarLarge = false">
        <div class="profile-lightbox-avatar" @click.stop>
          <UserAvatar :user-id="userId" :name="profile.net_name" :size="280" />
        </div>
        <p class="profile-lightbox-name">{{ profile.net_name || '未知用户' }}</p>
      </div>

    <!-- ══ 封面放大查看（与列表所见一致，不暴露未裁切的原始照片）══ -->
      <div v-if="showCoverLarge" class="profile-lightbox" @click="showCoverLarge = false">
        <div class="profile-lightbox-cover" @click.stop>
          <div class="profile-lightbox-cover-inner" :style="{ width: lightboxCoverW + 'px', height: lightboxCoverH + 'px' }">
            <img v-if="cover.has_cover && !coverFailed" :src="coverUrl" :style="coverLargeImgStyle" class="profile-cover-img" alt="" draggable="false" decoding="async" />
            <div v-else class="profile-cover-fallback"></div>
          </div>
        </div>
      </div>

    <!-- ══ 封面裁剪（云盘选图 + 缩放裁选）══ -->
    <ImageCropper
      v-if="showCoverCropper"
      endpoint="/user/cover"
      :aspect="COVER_ASPECT"
      :stage-base="400"
      shape="rect"
      crop-title="裁选封面"
      tip="拖动调整位置，滑动条或双指缩放。建议用横向的风景或合照。"
      :initial-hash="cover.hash || ''"
      :initial-crop="cover.crop || null"
      @close="showCoverCropper = false"
      @saved="onCoverSaved"
      @error="onCoverError"
    />

    <!-- ══ 编辑资料（从设置页搬过来的全部自定义项）══ -->
    <ProfileEditor
      v-if="showEditor && isSelf"
      :user-id="userId"
      @close="showEditor = false"
      @saved="onProfileSaved"
    />

    <!-- ══ 关注 / 粉丝名单 ══ -->
    <FollowListSheet
      v-if="showFollowSheet"
      :user-id="userId"
      :direction="followDirection"
      @close="closeFollowSheet"
      @changed="onFollowListChanged"
    />
  </div>
</template>

<script>
import api from '@/utils/api';
import AppNavBar from '@/components/AppNavBar.vue';
import UserAvatar from '@/components/UserAvatar.vue';
import ImageCropper from '@/components/ImageCropper.vue';
import ProfileEditor from '@/components/ProfileEditor.vue';
import FollowListSheet from '@/components/FollowListSheet.vue';
import { computeCropTransform, COVER_ASPECT } from '@/utils/avatar-crop';
import { coverGradient } from '@/utils/profile-cover';
import { seedAvatars } from '@/utils/avatar-store';

// 主页首屏的 SWR 缓存（模块级，跨路由往返都还在）
// 为什么需要：每次进主页要打 5 个小接口（资料/统计/等级/封面/关注），弱网下前半屏空了半秒。
// 现在再进同一个人的主页先渲染上次的内容（不闪骨架），后台再静默刷新。
// 只缓存「小对象」，帖子列表不缓存（体积大且按分类/分页变化）。
var _profileCache = {};        // userId -> { at, profile, stats, level, cover, follow }
var PROFILE_CACHE_MAX = 20;    // 粗上限，防止逛很多人后无限增长

function _cacheTouch(userId, patch) {
  var key = String(userId || '');
  if (!key) return;
  var entry = _profileCache[key] || { at: 0 };
  for (var k in patch) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) entry[k] = patch[k];
  }
  entry.at = Date.now();
  _profileCache[key] = entry;
  var keys = Object.keys(_profileCache);
  if (keys.length > PROFILE_CACHE_MAX) {
    keys.sort(function(a, b) { return (_profileCache[a].at || 0) - (_profileCache[b].at || 0); });
    delete _profileCache[keys[0]];
  }
}

export default {
  name: 'Profile',
  components: {
    AppNavBar: AppNavBar,
    UserAvatar: UserAvatar,
    ImageCropper: ImageCropper,
    ProfileEditor: ProfileEditor,
    FollowListSheet: FollowListSheet
  },
  data: function() {
    return {
      COVER_ASPECT: COVER_ASPECT,
      loading: true,
      notFound: false,
      profile: {},
      stats: {},
      levelInfo: { level: -1, role: '', officer_title: '', showLevel: false },

      cover: { has_cover: false, hash: '', crop: { zoom: 1, ox: 0, oy: 0 }, url: '', full_url: '' },
      coverBoxW: 0,
      coverBoxH: 200,
      coverNatural: { w: 0, h: 0 },
      coverFailed: false,
      showCoverCropper: false,
      showCoverLarge: false,
      showEditor: false,
      showFollowSheet: false,
      followDirection: 'followers',
      // 主页整体加载失败（含"账号被禁用"）——必须与「用户不存在」区分开
      loadError: null,
      // 帖子单独失败（例如只有社区权限被限制）：不能让页面显示成"TA 没发过帖子"
      postsError: null,

      followState: { following: false, followed_by: false, followers: 0, following_count: 0 },
      followBusy: false,

      tab: 'posts',
      posts: [],
      postTotal: 0,
      postPage: 1,
      postType: 'all',
      postsLoading: false,

      showAvatarLarge: false,
      windowWidth: typeof window !== 'undefined' ? window.innerWidth : 1043
    };
  },
  computed: {
    userId: function() {
      return String(this.$route.params.userId || '');
    },
    isSelf: function() {
      var me = this.$store.state.auth.user;
      if (me && String(me.user_id) === this.userId) return true;
      // 兜底：auth.store 的 user 是**模块加载时**从 localStorage 读一次的，
      // 如果 token 已写入而 user 还没落盘（首启/刚清过缓存/路由守卫补写晚于 store 初始化），
      // 就会出现"看自己的主页却显示关注按钮"。这里直接再读一次原始存储。
      if (!me) {
        try {
          var raw = localStorage.getItem('user');
          if (raw) {
            var u = JSON.parse(raw);
            if (u && String(u.user_id) === this.userId) return true;
          }
        } catch (e) { /* 存储损坏按未登录处理 */ }
      }
      return false;
    },
    // 「XX的主页」——用户明确要求的标题形态
    pageTitle: function() {
      var name = this.profile && this.profile.net_name;
      return name ? name + '的主页' : '个人主页';
    },
    // ⚠️ levelInfo 可能是 null（无缓存、切人先清场）——这里必须 null-safe，
    //    否则模板里的 showLevelIcon 会在首帧抛 TypeError，整页被 ErrorBoundary 接住
    showLevelIcon: function() {
      var info = this.levelInfo;
      return !!(info && info.showLevel && info.level >= 0);
    },
    levelIconUrl: function() {
      var info = this.levelInfo || {};
      return '/resources/public/level/Lv' + (info.level || 0) + '.svg';
    },
    genderText: function() {
      var g = this.profile.gender;
      if (g === 'male' || g === '男') return '男';
      if (g === 'female' || g === '女') return '女';
      return g || '';
    },
    hasAnyInfo: function() {
      var p = this.profile;
      return !!(p.birthday || p.gender || p.wechat || p.qq || p.phone || p.address);
    },
    // 分类与社区主页保持一致（社区的「论坛」tab 本身就含投票/问卷）
    postFilters: function() {
      return [
        { key: 'all', label: '全部' },
        { key: 'forum', label: '论坛' },
        { key: 'food', label: '美食' },
        { key: 'hot', label: '热榜' }
      ];
    },
    // 没设封面时的默认底：按 userId 取一条**确定性**渐变（同一个人每次进来都一样），
    // 让没设封面看起来是设计过的状态，而不是缺失。配色表在 utils/profile-cover.js，
    // 社区「我的」页共用同一份，避免两处各写一套后漂移。
    defaultCoverGradient: function() {
      return coverGradient(this.userId);
    },
    // 「互相关注」是关注体系里用户最想知道的一句话
    followButtonText: function() {
      if (!this.followState.following) return '关注';
      return this.followState.followed_by ? '互相关注' : '已关注';
    },
    hasMorePosts: function() {
      return this.posts.length < this.postTotal;
    },
    coverUrl: function() {
      return this.cover && this.cover.url ? this.cover.url : '';
    },
    // 封面按容器实测宽度算裁切 —— 与裁剪器同一套公式，任何屏幕宽度都一致
    coverImgStyle: function() {
      if (!this.coverNatural.w || !this.coverNatural.h || !this.coverBoxW) return { opacity: 0 };
      return {
        opacity: 1,
        transform: 'translate(-50%, -50%) ' +
          computeCropTransform(this.coverNatural.w, this.coverNatural.h, this.coverBoxW, this.coverBoxH, this.cover.crop)
      };
    },
    // 光盒尺寸显式写定：裁切计算与容器实际像素必须完全一致，
    // 用 100% 宽度去估会有 1~2px 偏差，放大后肉眼可见错位
    lightboxCoverW: function() {
      return Math.max(200, Math.min(this.windowWidth - 80, 720));
    },
    lightboxCoverH: function() {
      return Math.round(this.lightboxCoverW / COVER_ASPECT);
    },
    coverLargeImgStyle: function() {
      if (!this.coverNatural.w || !this.coverNatural.h) return { opacity: 0 };
      return {
        opacity: 1,
        transform: 'translate(-50%, -50%) ' +
          computeCropTransform(this.coverNatural.w, this.coverNatural.h, this.lightboxCoverW, this.lightboxCoverH, this.cover.crop)
      };
    },
  },
  watch: {
    // 从 A 的主页直接跳到 B（例如点进评论里的另一个人）
    userId: function() {
      this.posts = [];
      this.postPage = 1;
      this.postTotal = 0;
      this.postType = 'all';
      this.coverFailed = false;
      this.coverNatural = { w: 0, h: 0 };
      this.tab = 'posts';
      this.load();
    }
  },
  mounted: function() {
    this.load();
    this.measureCover();
    window.addEventListener('resize', this.onWindowResize);
    // 支持外部直接进编辑态（社区「我的」页的「编辑资料」入口用它，
    // 免得那页再挂一份 ProfileEditor —— 编辑器只保留这一个实例来源）
    if (this.isSelf && String(this.$route.query.edit || '') === '1') {
      this.showEditor = true;
    }
  },
  // keep-alive（App.vue 按 include="Profile" 缓存）：返回主页时免整页重建、
  // 保滚动位置；activated 做一次后台静默刷新（缓存命中不闪骨架，直接更新数据）
  activated: function() {
    var first = !this._profileActivatedOnce;
    this._profileActivatedOnce = true;
    // resize 监听随激活/停挂配对（keep-alive 下 beforeDestroy 不触发，缓存期不需要）
    window.removeEventListener('resize', this.onWindowResize);
    window.addEventListener('resize', this.onWindowResize);
    if (first) return; // 首次激活紧随 mounted 的 load()，跳过避免双载
    this.load();
  },
  deactivated: function() {
    window.removeEventListener('resize', this.onWindowResize);
  },
  updated: function() {
    // 哨兵节点会随分栏切换/列表重渲染被替换，更新时对一下引用，变了就重新观察
    var el = this.$refs.sentinel || null;
    if (el !== this._observedSentinel) this.observeSentinel(el);
  },
  beforeDestroy: function() {
    this.unobserveCover();
    this.observeSentinel(null);
    window.removeEventListener('resize', this.onWindowResize);
  },
  methods: {
    // 无限滚动：哨兵进入视口就取下一页（平板上比"点加载更多"顺手，也不会漏）
    observeSentinel: function(el) {
      if (this._sentinelIO) {
        this._sentinelIO.disconnect();
        this._sentinelIO = null;
      }
      this._observedSentinel = el;
      if (!el || typeof IntersectionObserver === 'undefined') return;
      var self = this;
      this._sentinelIO = new IntersectionObserver(function(entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting && self.hasMorePosts && !self.postsLoading && !self.postsError) {
            self.loadMorePosts();
          }
        }
      }, { rootMargin: '200px' });
      this._sentinelIO.observe(el);
    },

    load: function() {
      var self = this;
      var cached = _profileCache[String(self.userId)];

      // ① 有缓存就先渲染 —— 不闪骨架，也不把名字/统计空着
      if (cached) {
        if (cached.profile) self.profile = cached.profile;
        if (cached.stats) self.stats = cached.stats;
        if (cached.level) self.levelInfo = cached.level;
        if (cached.follow) self.followState = cached.follow;
        if (cached.cover) self.cover = cached.cover;
        self.loading = false;
      } else {
        // 无缓存（含从 A 的主页跳到 B）：先把上一个人的内容清干净，别串号
        self.loading = true;
        self.profile = {};
        self.stats = {};
        self.levelInfo = { level: -1, role: '', officer_title: '', showLevel: false };
        self.followState = { following: false, followed_by: false, followers: 0, following_count: 0 };
        self.cover = { has_cover: false, hash: '', crop: { zoom: 1, ox: 0, oy: 0 }, url: '', full_url: '' };
      }
      self.notFound = false;
      self.loadError = null;
      self.postsError = null;

      // ② 首屏聚合：资料/统计/等级/封面/关注/头像一次往返
      //    （隐私过滤与 /profile/:userId 完全一致，头像顺便种进 avatar-store，
      //     帖子列表里的作者头像就不用再打一次 avatar/batch）
      api.get('/community/users/' + self.userId + '/overview').then(function(res) {
        var d = (res.data && res.data.data) || {};
        if (d.profile) self.profile = d.profile;
        if (d.stats) self.stats = d.stats;
        if (d.level) {
          self.levelInfo = {
            level: d.level.level || 0,
            role: d.level.role || '',
            officer_title: d.level.officer_title || '',
            showLevel: !!d.level.show_level_community
          };
        }
        if (d.cover) {
          // 只有真的换了图才清自然尺寸；同图静默刷新时 src 不变、不会再触发 load，
          // 必须靠 syncCoverNatural 从已加载的元素上把尺寸拿回来（否则封面会"消失"）
          var coverHashChanged = String(d.cover.hash || '') !== String(self.cover.hash || '');
          self.cover = d.cover;
          self.coverFailed = false;
          if (coverHashChanged) self.coverNatural = { w: 0, h: 0 };
          self.$nextTick(function() {
            self.syncCoverNatural();
            self.measureCover();
          });
        }
        if (d.follow) {
          self.followState = {
            following: !!d.follow.following,
            followed_by: !!d.follow.followed_by,
            followers: d.follow.followers || 0,
            following_count: d.follow.following_count || 0
          };
        }
        if (d.avatar && d.avatar.has_avatar) {
          var seed = {};
          seed[self.userId] = d.avatar;
          seedAvatars(seed);
        }
        _cacheTouch(self.userId, {
          profile: self.profile, stats: self.stats, level: self.levelInfo,
          cover: self.cover, follow: self.followState
        });
      }).catch(function(err) {
        // 有缓存时静默失败：宁可显示上次的内容，也不把页面打成错误页
        if (cached) return;
        self.profile = {};
        self.stats = {};
        var status = (err.response && err.response.status) || 0;
        var body = (err.response && err.response.data) || {};
        if (status === 404) {
          self.notFound = true;
        } else {
          self.loadError = self.buildErrorState(status, body, '主页');
        }
      }).then(function() {
        if (!cached) self.loading = false;
        if (self.notFound || self.loadError) return;
        self.loadPosts(true);
        self.$nextTick(self.measureCover);
      });
    },

    loadCover: function() {
      var self = this;
      api.get('/user/cover/' + self.userId).then(function(res) {
        var data = (res.data && res.data.data) || {};
        self.cover = {
          has_cover: !!data.has_cover,
          hash: data.hash || '',
          crop: data.crop || { zoom: 1, ox: 0, oy: 0 },
          url: data.url || '',
          full_url: data.full_url || ''
        };
        self.coverFailed = false;
        // 只有换了图（hash 变了）才清自然尺寸：同一张图重新裁切时 URL 不变、
        // 不会再触发 load 事件，清零后要靠 syncCoverNatural 找回（否则封面消失）
        var hashChanged = String(data.hash || '') !== String(self._lastCoverHash || '');
        self._lastCoverHash = data.hash || '';
        if (hashChanged) self.coverNatural = { w: 0, h: 0 };
        _cacheTouch(self.userId, { cover: self.cover });
        self.$nextTick(function() {
          self.syncCoverNatural();
          self.measureCover();
        });
      }).catch(function() {});
    },

    loadFollow: function() {
      var self = this;
      api.get('/user/follow/' + self.userId).then(function(res) {
        var data = (res.data && res.data.data) || {};
        self.followState = {
          following: !!data.following,
          followed_by: !!data.followed_by,
          followers: data.followers || 0,
          following_count: data.following_count || 0
        };
        _cacheTouch(self.userId, { follow: self.followState });
      }).catch(function() {});
    },

    loadPosts: function(reset) {
      var self = this;
      if (reset) {
        self.postPage = 1;
        self.posts = [];
        self.postTotal = 0;
      }
      if (self.postsLoading) return;
      self.postsLoading = true;
      api.get('/community/posts', {
        params: { type: self.postType, author_id: self.userId, page: self.postPage, limit: 10 }
      }).then(function(res) {
        var data = (res.data && res.data.data) || {};
        var list = data.posts || [];
        self.posts = reset ? list : self.posts.concat(list);
        self.postTotal = data.total || 0;
        self.postsError = null;
      }).catch(function(err) {
        var status = (err.response && err.response.status) || 0;
        var body = (err.response && err.response.data) || {};
        // ⚠️ 关键：拉不到 ≠ 没有。被限制访问社区时后端会返回 403，
        //    如果把 posts 置空就当空态渲染，页面会骗人说"TA 还没发过帖子"。
        self.postsError = self.buildPostsError(status, body);
        if (reset) self.posts = [];
        // 失败就别再自动翻页了，否则无限滚动会一直撞墙
        self.postTotal = self.posts.length;
      }).then(function() {
        self.postsLoading = false;
      });
    },

    // 统一的错误描述：把后端的 code/message 翻译成人话，并把「被禁用」单独标出来
    buildErrorState: function(status, body, scope) {
      var banned = body && Number(body.code) === 403 && /禁用|限制/.test(String(body.message || ''));
      var title = banned
        ? '当前账号已被限制访问'
        : (status === 403 ? '没有权限查看该' + scope : scope + '加载失败');
      var detail = '';
      if (banned) detail = body.ban_reason || '账号已被管理员禁用';
      else if (body && body.message) detail = body.message;
      else if (status === 0) detail = '网络不可用，请检查连接后重试';
      else detail = '请稍后重试';
      return {
        banned: banned,
        title: title,
        detail: detail,
        expiresAt: (body && body.ban_expires_at) || ''
      };
    },

    buildPostsError: function(status, body) {
      var banned = body && Number(body.code) === 403 && /禁用|限制/.test(String(body.message || ''));
      return {
        banned: banned,
        title: banned ? '暂时无法查看 TA 的帖子' : '帖子加载失败',
        detail: banned
          ? '你当前被限制访问社区，只能看到主页信息。' + (body.ban_reason ? '原因：' + body.ban_reason : '')
          : ((body && body.message) || '请稍后重试')
      };
    },

    loadMorePosts: function() {
      if (this.postsLoading) return;
      this.postPage += 1;
      this.loadPosts(false);
    },

    setPostType: function(key) {
      if (this.postType === key) return;
      this.postType = key;
      this.loadPosts(true);
    },

    switchTab: function(name) {
      this.tab = name;
    },

    // ---- 关注 / 粉丝名单 ----
    openFollowSheet: function(direction) {
      this.followDirection = direction === 'following' ? 'following' : 'followers';
      this.showFollowSheet = true;
    },
    closeFollowSheet: function() {
      this.showFollowSheet = false;
      // 名单里可能取关/关注过，回来刷新一次计数
      this.loadFollow();
    },
    onFollowListChanged: function() {
      // 名单内部改了关注关系，计数就地重算（接口已回，重拉一次最稳）
      this.loadFollow();
    },

    goBanned: function() {
      this.$router.push('/banned');
    },

    // ---- 点赞 ----
    toggleLike: function() {
      var self = this;
      var payload = { target_type: 'user', target_id: self.userId };
      // 与社区同一套语义：已赞 → DELETE /community/likes，未赞 → POST
      var req = self.profile.liked_by_me
        ? api.delete('/community/likes', { data: Object.assign({ liked: true }, payload) })
        : api.post('/community/likes', payload);
      req.then(function() {
        var liked = !self.profile.liked_by_me;
        self.profile.liked_by_me = liked;
        self.profile.like_count = (self.profile.like_count || 0) + (liked ? 1 : -1);
        self.$store.commit('toast/SHOW_TOAST', { message: liked ? '已点赞' : '已取消点赞', type: 'success' });
      }).catch(function(err) {
        var msg = (err.response && err.response.data && err.response.data.message) || '操作失败';
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      });
    },

    // ---- 关注 ----
    toggleFollow: function() {
      var self = this;
      if (self.followBusy) return;
      self.followBusy = true;
      var was = self.followState.following;
      var req = was
        ? api.delete('/user/follow/' + self.userId)
        : api.post('/user/follow/' + self.userId);
      req.then(function() {
        self.followState.following = !was;
        self.followState.followers = Math.max(0, (self.followState.followers || 0) + (was ? -1 : 1));
        // 关注态也要进缓存，否则返回再进来会闪回旧状态
        _cacheTouch(self.userId, { follow: self.followState });
        self.$store.commit('toast/SHOW_TOAST', { message: was ? '已取消关注' : '已关注', type: 'success' });
      }).catch(function(err) {
        var msg = (err.response && err.response.data && err.response.data.message) || '操作失败';
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      }).then(function() {
        self.followBusy = false;
      });
    },

    // ---- 封面 ----
    measureCover: function() {
      var el = this.$refs.cover;
      if (!el) return;
      var w = el.clientWidth || el.offsetWidth;
      if (w > 0) this.applyCoverWidth(w);
      // 监听尺寸变化：平板横竖屏切换、窗口拖动都要重算
      this.unobserveCover();
      if (typeof ResizeObserver !== 'undefined') {
        var self = this;
        this._coverRO = new ResizeObserver(function(entries) {
          for (var i = 0; i < entries.length; i++) {
            var cw = Math.round(entries[i].contentRect.width);
            if (cw > 0) self.applyCoverWidth(cw);
          }
        });
        this._coverRO.observe(el);
      }
    },
    unobserveCover: function() {
      if (this._coverRO) {
        try { this._coverRO.disconnect(); } catch (e) {}
        this._coverRO = null;
      }
    },
    applyCoverWidth: function(w) {
      this.coverBoxW = w;
      // 高度跟随宽度，保证展示比例 === 裁剪比例（COVER_ASPECT）
      var h = Math.round(w / COVER_ASPECT);
      this.coverBoxH = Math.min(280, Math.max(120, h));
    },
    onCoverLoad: function(e) {
      this._coverRetry = 0;
      this.coverNatural = { w: e.target.naturalWidth, h: e.target.naturalHeight };
    },
    // 封面加载失败：最多重试 2 次（云盘图走 relay 时偶发抖动），
    // 别一次失败就永久 fallback —— 那会让用户以为"封面丢了"
    onCoverError: function() {
      var self = this;
      self._coverRetry = (self._coverRetry || 0) + 1;
      if (self._coverRetry <= 2 && self.coverUrl && self.cover.has_cover) {
        setTimeout(function() {
          if (!self.cover.has_cover) return;
          var base = String(self.cover.url).split('&r=')[0];
          self.cover = Object.assign({}, self.cover, {
            url: base + (base.indexOf('?') > -1 ? '&' : '?') + 'r=' + self._coverRetry
          });
        }, 500 * self._coverRetry);
        return;
      }
      self.coverFailed = true;
    },
    // ⚠️ 关键：不是所有封面更新都会改变 <img> 的 src ——
    //   SWR 静默刷新拿到同一张封面、重复保存同一张图时，src 不变，
    //   浏览器就不会再派发 load 事件；此时若 coverNatural 被清零，
    //   coverImgStyle 的 opacity 恒为 0，表现为"封面加载不出来"（间歇性、难复现）。
    //   所以清零之后必须从已加载完成的元素上把自然尺寸同步回来。
    syncCoverNatural: function() {
      var img = this.$refs.coverImg;
      if (!img) return;
      if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
        if (this.coverNatural.w !== img.naturalWidth || this.coverNatural.h !== img.naturalHeight) {
          this.coverNatural = { w: img.naturalWidth, h: img.naturalHeight };
        }
      }
    },
    openCoverPreview: function() {
      if (!this.cover.has_cover || this.coverFailed) {
        if (this.isSelf) this.openCoverCropper();
        return;
      }
      this.windowWidth = window.innerWidth;
      this.showCoverLarge = true;
    },
    openCoverCropper: function() {
      this.showCoverCropper = true;
    },
    onCoverSaved: function() {
      this.showCoverCropper = false;
      var self = this;
      // 后端已落库，重新拉一次拿到带 ?w= 的 url（避免手拼缓存键不一致）
      self.loadCover();
      self.$store.commit('toast/SHOW_TOAST', { message: '封面已更新', type: 'success' });
    },
    onCoverError: function(msg) {
      this.$store.commit('toast/SHOW_TOAST', { message: msg || '保存失败', type: 'error' });
    },

    // ---- 头像放大 ----
    openAvatarPreview: function() {
      if (!this.userId) return;
      this.showAvatarLarge = true;
    },

    // ---- 帖子 ----
    openPost: function(postId) {
      this.$router.push('/community?post=' + postId);
    },
    postTypeText: function(type) {
      if (type === 'food') return '美食';
      if (type === 'hot') return '热榜';
      if (type === 'poll') return '投票';
      if (type === 'survey') return '问卷';
      return '论坛';
    },
    excerpt: function(text) {
      var s = String(text || '');
      // 正文可能是 markdown：图片/链接只留可读文字，否则列表里全是 ![...](...) 噪音
      s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]');
      s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
      // 裸链接会把卡片撑变形，统一折叠成「链接」
      s = s.replace(/https?:\/\/\S+/g, '[链接]');
      s = s.replace(/[#>*`_~]/g, '');
      s = s.replace(/\s+/g, ' ').trim();
      return s.length > 90 ? s.slice(0, 90) + '…' : s;
    },
    formatTime: function(t) {
      if (!t) return '';
      var d = new Date(t);
      if (isNaN(d.getTime())) return String(t);
      var now = new Date();
      var same =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
      var pad = function(n) { return n < 10 ? '0' + n : String(n); };
      if (same) return pad(d.getHours()) + ':' + pad(d.getMinutes());
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    // ---- 杂项 ----
    copyField: function(label, value) {
      var self = this;
      var text = String(value || '');
      if (!text) return;
      var done = function() {
        self.$store.commit('toast/SHOW_TOAST', { message: label + '已复制', type: 'success' });
      };
      // 优先用 Clipboard API（需要 https/localhost）；失败回落 execCommand
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function() { legacyCopy(text, done); });
      } else {
        legacyCopy(text, done);
      }
      function legacyCopy(t, cb) {
        try {
          var ta = document.createElement('textarea');
          ta.value = t;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          cb();
        } catch (e) {
          self.$store.commit('toast/SHOW_TOAST', { message: '复制失败，请长按选中', type: 'error' });
        }
      }
    },
    sendMessage: function() {
      // Chat 已支持 ?chat=<id> 直达会话
      this.$router.push('/chat?chat=' + this.userId);
    },
    goEditProfile: function() {
      // 资料编辑已从设置页搬到主页：头像/封面/签名/联系方式/隐私都在这里改
      this.showEditor = true;
    },
    onProfileSaved: function() {
      // 签名/隐私/联系方式都改了，重新拉一份；封面可能也在面板里换过
      this.load();
    },
    onWindowResize: function() {
      this.windowWidth = window.innerWidth;
      this.measureCover();
    }
  }
};
</script>

<style scoped>
/* ══════════════════════════════════════════════════════════════
   个人主页样式层
   ──────────────────────────────────────────────────────────────
   为后续「装扮系统」预留：所有可换的东西都收进 .profile-page 上的
   自定义属性。装扮 = 覆盖这几个变量（甚至按用户下发不同的值），
   不用动任何结构或选择器。
   ══════════════════════════════════════════════════════════════ */
.profile-page {
  /* 造型变量已提升到 global.scss 的 :root（见「个人主页 / 装扮令牌」一节）：
     输入层 --ci-profile-*（主题/装扮写它），消费层 --pf-*（这里只读这一层）。
     提升原因：① 别的页面也能复用；② 扩展主题 manifest 的 profile 段能直接生效；
     ③ 装扮系统只需 inline 覆盖 --ci-profile-*，不必回来改本文件。
     令牌清单：client/src/core/profile-skin.js → TOKEN_SPEC。 */

  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
  overflow: hidden;
}

.profile-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 16px 40px;
}

.profile-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption1);
  padding: 48px 16px;
}
.profile-state i { font-size: 28px; }
.profile-state--inline { padding: 36px 16px; }

/* ---- 加载失败 / 无权限 ---- */
.profile-state--error {
  text-align: center;
  color: var(--text-secondary);
}
.profile-state--error > i { color: var(--warning-color, #FF9500); }
.profile-state--error > span {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.profile-state-hint {
  margin: 0;
  max-width: 380px;
  font-size: var(--font-size-caption1);
  color: var(--text-tertiary);
  line-height: 1.6;
}

.profile-state-actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.profile-state-btn {
  min-height: 38px;
  padding: 0 18px;
  border: 0;
  border-radius: var(--pf-radius-sm);
  background: var(--pf-accent);
  color: #fff;
  font-size: var(--font-size-footnote, 14px);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-standard);
}
.profile-state-btn:active { opacity: 0.85; }

.profile-state-btn--ghost {
  background: transparent;
  border: 0.5px solid var(--pf-hairline);
  color: var(--text-secondary);
}

/* 大屏上别拉满整行：760px 是读完一行文字不费眼的宽度 */
.profile-card,
.profile-panel {
  max-width: 760px;
  margin: 0 auto;
}

/* ══════════ 主卡片 ══════════ */
.profile-card {
  position: relative;
  border-radius: var(--pf-radius);
  background: var(--pf-card-bg);
  /* 1px 描边比投影像素更"贵"：暗色下也能把卡片从背景里拎出来 */
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 8px 28px -12px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  animation: pfEnter 0.32s cubic-bezier(0.2, 0.8, 0.3, 1);
}

@keyframes pfEnter {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}

/* ══════════ 封面 ══════════ */
.profile-hero-shell { position: relative; }

.profile-cover {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: var(--pf-surface);
  cursor: pointer;
}

/* 图与卡片之间加一道极淡的内阴影，接缝不"糊" */
.profile-cover::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
  pointer-events: none;
}

.profile-cover-img {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  transform-origin: center center;
  transition: opacity var(--duration-normal) var(--ease-standard);
  pointer-events: none;
}

/* ---- 没设封面时的默认底：按 userId 取一条确定性渐变 ---- */
.profile-cover-fallback {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
}

/* 左上角一团柔光，让纯渐变有"打光"的层次 */
.profile-cover-glow {
  position: absolute;
  left: -6%;
  top: -40%;
  width: 62%;
  height: 180%;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.32), rgba(255, 255, 255, 0) 62%);
  pointer-events: none;
}

/* 细斜纹：极低对比，只做质感，不抢主体 */
.profile-cover-mesh {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-image: repeating-linear-gradient(
    115deg,
    rgba(255, 255, 255, 0.055) 0,
    rgba(255, 255, 255, 0.055) 1px,
    transparent 1px,
    transparent 9px
  );
  pointer-events: none;
}

.profile-cover-scrim {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 62px;
  /* 上面那层来自装扮（--pf-cover-overlay，默认 transparent 等于不加）；
     底下这层基础渐隐必须保留 —— 没有它，浅色封面上「更换封面」按钮就不可读。 */
  background:
    var(--pf-cover-overlay),
    linear-gradient(to top, rgba(0, 0, 0, 0.3), transparent);
  pointer-events: none;
}

.profile-cover-hint {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: rgba(255, 255, 255, 0.92);
  font-size: var(--font-size-caption1);
  letter-spacing: 0.02em;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.28);
  pointer-events: none;
}

.profile-cover-edit {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: var(--radius-pill, 999px);
  background: rgba(0, 0, 0, 0.42);
  color: #fff;
  font-size: var(--font-size-caption1);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  /* 毛玻璃让按钮在任意封面上都能读 */
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  transition: background var(--duration-fast) var(--ease-standard);
}
.profile-cover-edit:hover { background: rgba(0, 0, 0, 0.6); }

/* ══════════ 头像 ══════════ */
.profile-avatar-slot {
  position: absolute;
  left: 20px;
  bottom: 0;
  /* 骑跨封面下沿：一半压在封面上，一半落在卡片白底上 */
  transform: translateY(50%);
  width: calc(var(--pf-avatar) + 12px);
  height: calc(var(--pf-avatar) + 12px);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--pf-card-bg);
  /* 双环：内圈是卡片底色，外圈一道发丝线，头像在任何封面上都有边界 */
  box-shadow: 0 0 0 1px var(--pf-hairline), 0 4px 14px -4px rgba(0, 0, 0, 0.24);
  cursor: zoom-in;
  z-index: 1;
  transition: transform var(--duration-fast) var(--ease-standard);
}
.profile-avatar-slot:active { transform: translateY(50%) scale(0.97); }

.profile-avatar-zoom {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  border: 2px solid var(--pf-card-bg);
  color: #fff;
  font-size: 10px;
  pointer-events: none;
  /* 常驻的深色小圆压在头像边角上像块污渍：悬停才浮出。
     触摸设备没有 hover，但整块可点 + 按压缩放已经足够表达。 */
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}
.profile-avatar-slot:hover .profile-avatar-zoom { opacity: 1; }

/* ══════════ 身份 ══════════ */
.profile-identity {
  padding: 60px 20px 6px;
}

.profile-identity-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.profile-name-block { min-width: 0; flex: 1; }

.profile-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.profile-name {
  margin: 0;
  font-size: var(--font-size-title2, 22px);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.01em;
  color: var(--text-primary);
  word-break: break-all;
}

.profile-level { height: 18px; width: auto; }

/* 徽章统一走"淡底 + 同色字"，比实心色块更克制，也更容易和装扮配色共存 */
.profile-badge {
  padding: 1px 7px;
  border-radius: var(--radius-xs, 4px);
  font-size: var(--font-size-caption2);
  font-weight: var(--font-weight-medium);
  line-height: 1.5;
  color: var(--danger-color);
  background: rgba(255, 59, 48, 0.12);
  flex-shrink: 0;
}
.profile-badge-officer {
  color: var(--pf-accent);
  background: rgba(0, 122, 255, 0.12);
}
.profile-badge-self {
  color: var(--text-tertiary);
  background: var(--pf-surface);
}

.profile-realname {
  margin-top: 6px;
  font-size: var(--font-size-caption1);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 5px;
}
.profile-realname i { color: var(--text-tertiary); font-size: 11px; }

.profile-signature {
  margin: 12px 0 0;
  font-size: var(--font-size-caption1);
  color: var(--text-secondary);
  line-height: 1.65;
  word-break: break-word;
}
.profile-signature--muted { color: var(--text-tertiary); }

/* ══════════ 操作按钮 ══════════ */
.profile-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.profile-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 14px;
  border: 0.5px solid var(--pf-hairline);
  border-radius: var(--pf-radius-sm);
  background: var(--pf-card-bg);
  color: var(--text-secondary);
  font-size: var(--font-size-footnote, 14px);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  white-space: nowrap;
  transition: opacity var(--duration-fast) var(--ease-standard),
              transform var(--duration-fast) var(--ease-standard),
              border-color var(--duration-fast) var(--ease-standard);
}
.profile-btn:active { transform: scale(0.97); opacity: 0.85; }
.profile-btn:disabled { opacity: 0.55; cursor: default; }

.profile-btn.liked { color: var(--danger-color); border-color: rgba(255, 59, 48, 0.35); }
.profile-btn.followed { color: var(--text-secondary); }

.profile-btn-count { font-variant-numeric: tabular-nums; opacity: 0.75; }

.profile-btn-primary {
  background: var(--pf-accent);
  border-color: var(--pf-accent);
  color: #fff;
}

/* ══════════ 统计（发丝线分栏，不再用色块）══════════ */
.profile-stats {
  display: flex;
  margin: 18px 0 0;
  border-top: 0.5px solid var(--pf-hairline);
  border-bottom: 0.5px solid var(--pf-hairline);
  background: transparent;
}

.profile-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 12px 0;
  border: 0;
  border-right: 0.5px solid var(--pf-hairline);
  background: transparent;
  cursor: default;
  transition: background var(--duration-fast) var(--ease-standard);
}
.profile-stat:last-child { border-right: 0; }

.profile-stat--action { cursor: pointer; }
.profile-stat--action:hover { background: var(--pf-surface); }
.profile-stat--action:active { background: rgba(0, 122, 255, 0.12); }

.profile-stat-value {
  font-size: var(--font-size-title3, 20px);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.profile-stat-label {
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
}

.profile-stat-arrow {
  margin-left: 3px;
  font-size: 8px;
  opacity: 0.6;
}

/* ══════════ 分栏 ══════════ */
.profile-tabs {
  display: flex;
  gap: 4px;
  padding: 0 20px;
}

.profile-tab {
  position: relative;
  padding: 12px 14px 13px;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--font-size-footnote, 14px);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard);
}
.profile-tab.active { color: var(--pf-accent); }
.profile-tab.active::after {
  content: '';
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 6px;
  height: 2px;
  border-radius: var(--radius-xs, 2px);
  background: var(--pf-accent);
}

.profile-panel { margin-top: 10px; }

/* ══════════ 分类筛选 ══════════ */
.profile-filters {
  display: flex;
  gap: 8px;
  padding: 0 2px 10px;
  overflow-x: auto;
  scrollbar-width: none;
}
.profile-filters::-webkit-scrollbar { display: none; }

.profile-filter {
  flex-shrink: 0;
  height: 30px;
  padding: 0 14px;
  border: 0.5px solid var(--pf-hairline);
  border-radius: var(--radius-pill, 999px);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-caption1);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard),
              color var(--duration-fast) var(--ease-standard),
              border-color var(--duration-fast) var(--ease-standard);
}
.profile-filter.active {
  background: var(--pf-accent);
  border-color: var(--pf-accent);
  color: #fff;
}

/* ══════════ 帖子列表 ══════════ */
.profile-post-list { display: flex; flex-direction: column; gap: 8px; }

.profile-post {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border: 0.5px solid transparent;
  border-radius: var(--pf-radius);
  background: var(--pf-card-bg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-standard),
              box-shadow var(--duration-fast) var(--ease-standard),
              border-color var(--duration-fast) var(--ease-standard);
}
.profile-post:hover {
  border-color: var(--pf-hairline);
  box-shadow: 0 6px 20px -10px rgba(0, 0, 0, 0.22);
}
.profile-post:active { transform: scale(0.995); }

.profile-post-tag {
  flex-shrink: 0;
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: var(--radius-xs, 4px);
  font-size: var(--font-size-caption2);
  font-weight: var(--font-weight-medium);
  line-height: 1.5;
  color: #fff;
  background: var(--pf-accent);
}
.profile-post-tag.tag-food { background: #D98218; }
.profile-post-tag.tag-hot { background: #D9433F; }
.profile-post-tag.tag-poll { background: #6E56CF; }
.profile-post-tag.tag-survey { background: #2F8F63; }

.profile-post-body { flex: 1; min-width: 0; }

.profile-post-title {
  margin: 0 0 4px;
  font-size: var(--font-size-footnote, 14px);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-post-content {
  margin: 0;
  font-size: var(--font-size-caption1);
  color: var(--text-secondary);
  line-height: 1.65;
  word-break: break-word;
}

.profile-post-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 9px;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.profile-post-meta i { margin-right: 4px; }

.profile-post-anon {
  padding: 0 6px;
  border-radius: var(--radius-xs, 4px);
  background: var(--pf-surface);
  color: var(--text-secondary);
}

.profile-post-time { margin-left: auto; }

/* ══════════ 无限滚动哨兵 ══════════ */
.profile-sentinel {
  padding: 16px 0 4px;
  text-align: center;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
}
.profile-sentinel i { margin-right: 6px; }

/* ══════════ 资料 ══════════ */
.profile-info {
  border-radius: var(--pf-radius);
  background: var(--pf-card-bg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.profile-info-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 0.5px solid var(--pf-hairline);
  font-size: var(--font-size-footnote, 14px);
  transition: background var(--duration-fast) var(--ease-standard);
}
.profile-info-row:last-child { border-bottom: 0; }

.profile-info-row i {
  width: 18px;
  text-align: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.profile-info-row .k { width: 44px; color: var(--text-tertiary); flex-shrink: 0; }
.profile-info-row .v {
  flex: 1;
  color: var(--text-primary);
  word-break: break-all;
  user-select: text;
  -webkit-user-select: text;
}

.profile-info-row--copy { cursor: pointer; }
.profile-info-row--copy:active { background: var(--pf-surface); }

.profile-copy-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: var(--radius-sm, 8px);
  background: var(--pf-surface);
  color: var(--pf-accent);
  font-size: var(--font-size-caption2);
}

/* ══════════ 空态 ══════════ */
.profile-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 20px;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption1);
  text-align: center;
}
.profile-empty i { font-size: 26px; opacity: 0.8; }
.profile-empty--boxed {
  border-radius: var(--pf-radius);
  background: var(--pf-card-bg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  padding: 32px 16px;
}

.profile-empty--error > i { color: var(--warning-color, #FF9500); opacity: 1; }
.profile-empty--error .profile-state-btn { margin-top: 4px; }

/* ══════════ 放大查看 ══════════ */
.profile-lightbox {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-overlay, 10000);
  background: rgba(0, 0, 0, 0.84);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 24px;
  animation: pfFade 0.2s ease;
}

@keyframes pfFade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.profile-lightbox-avatar {
  border-radius: 50%;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.55);
}

.profile-lightbox-name {
  margin: 0;
  color: rgba(255, 255, 255, 0.92);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.01em;
}

.profile-lightbox-cover {
  width: 100%;
  max-width: 760px;
  display: flex;
  justify-content: center;
}

.profile-lightbox-cover-inner {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: var(--pf-radius);
  background: rgba(255, 255, 255, 0.06);
}

/* ══════════ 骨架屏 ══════════ */
.profile-skeleton {
  flex: 1;
  overflow: hidden;
  padding: 16px 16px 32px;
}

.sk-shimmer {
  position: relative;
  overflow: hidden;
  background: var(--pf-surface);
}
.sk-shimmer::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
  animation: skSweep 1.3s ease-in-out infinite;
}

@keyframes skSweep {
  to { transform: translateX(100%); }
}

.profile-skeleton .sk-cover {
  height: 180px;
  border-radius: var(--pf-radius);
  max-width: 760px;
  margin: 0 auto;
}

.sk-body {
  max-width: 760px;
  margin: -34px auto 0;
  padding: 0 20px;
}

.sk-avatar {
  width: var(--pf-avatar);
  height: var(--pf-avatar);
  border-radius: 50%;
  border: 4px solid var(--bg-color);
  margin-bottom: 12px;
}

.sk-line {
  height: 14px;
  border-radius: var(--radius-xs, 4px);
  margin-bottom: 10px;
}
.sk-line--lg { width: 42%; height: 20px; }
.sk-line--sm { width: 68%; }

.sk-stats {
  height: 62px;
  border-radius: var(--pf-radius-sm);
  margin: 18px 0;
}

.sk-post {
  height: 82px;
  border-radius: var(--pf-radius);
  margin-bottom: 10px;
  max-width: 760px;
  margin-left: auto;
  margin-right: auto;
}

.profile-post-skeletons .sk-post { max-width: none; }

/* ══════════ 无障碍：尊重"减少动态效果" ══════════ */
@media (prefers-reduced-motion: reduce) {
  .profile-card,
  .profile-lightbox { animation: none; }
  .sk-shimmer::after { animation: none; }
  .profile-avatar-slot,
  .profile-stat,
  .profile-filter,
  .profile-post,
  .profile-btn { transition: none; }
}

</style>
