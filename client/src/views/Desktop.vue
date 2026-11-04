<template>
  <div
    class="desktop"
    :class="{ 'desktop-enter': entered, 'desktop--editing': isEditMode, 'desktop--dragging': isDragging, 'desktop--grid': isGridLayout, 'desktop--folder-open': !!openFolderId }"
    :data-icon-size="iconSize"
    @touchstart="onDesktopTouchStart"
    @touchmove="onDesktopTouchMove"
    @touchend="onDesktopTouchEnd"
    @touchcancel="onDesktopTouchCancel"
    @mousedown="onDesktopMouseDown"
    @wheel="onDesktopWheel"
    @contextmenu.prevent="onDesktopContextMenu"
  >
    <template v-if="videoWallpaperSrc && !videoWallpaperFailed">
      <video
        ref="videoA"
        class="desktop-video-wallpaper"
        :class="{ 'video-active': activeVideo === 'A' }"
        :src="videoWallpaperSrc"
        preload="none"
        autoplay
        muted
        playsinline
        loop
        disablePictureInPicture
        @loadedmetadata="onVideoMeta"
        @waiting="onVideoWaiting"
        @playing="onVideoPlaying"
        @canplay="onVideoCanPlay"
        @error="onVideoError"
      ></video>
    </template>
    <div v-else class="desktop-static-wallpaper" :style="staticWallpaperStyle"></div>

    <transition name="announcement-float">
      <div
        v-if="showAnnouncementFloat && hasUnreadAnnouncements && currentAnnouncement"
        class="announcement-float"
        :class="{ 'announcement-float--swiping': announceSwipeX !== 0 }"
        :style="announceSwipeX !== 0 ? { transform: 'translateX(' + announceSwipeX + 'px)' } : null"
        @touchstart.stop="onAnnounceTouchStart"
        @touchmove.stop="onAnnounceTouchMove"
        @touchend.stop="onAnnounceTouchEnd"
        @touchcancel.stop="onAnnounceTouchEnd"
      >
        <div class="announcement-float-header">
          <div class="announcement-float-badge">
            <i class="fa-solid fa-bullhorn"></i>
            <span>新公告</span>
          </div>
          <button class="announcement-float-close" @click="dismissAllAnnouncements">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <!-- 轮播切换交叉淡入：key 绑定当前公告索引 -->
        <transition name="announce-swap" mode="out-in">
          <div
            :key="currentAnnouncementIndex"
            class="announcement-float-body"
            role="button"
            tabindex="0"
            :aria-label="'查看公告全文：' + currentAnnouncement.title"
            @click="openAnnouncementDetail(currentAnnouncement)"
            @keydown.enter="openAnnouncementDetail(currentAnnouncement)"
            @keydown.space.prevent="openAnnouncementDetail(currentAnnouncement)"
          >
            <h4 class="announcement-float-title">{{ currentAnnouncement.title }}</h4>
            <p class="announcement-float-content">
              {{ currentAnnouncement.content && currentAnnouncement.content.length > 100 ? currentAnnouncement.content.substring(0, 100) + '...' : currentAnnouncement.content }}
            </p>
            <span class="announcement-float-more">
              <span>点击查看全文</span>
              <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </span>
          </div>
        </transition>
        <div class="announcement-float-footer">
          <span class="announcement-float-indicator">
            {{ currentAnnouncementIndex + 1 }} / {{ unreadAnnouncements.length }}
          </span>
          <div class="announcement-float-actions">
            <button class="announcement-float-btn announcement-float-btn-detail" @click="openAnnouncementDetail(currentAnnouncement)">
              <i class="fa-solid fa-expand"></i> 查看详情
            </button>
            <button class="announcement-float-btn announcement-float-btn-view" @click="goToAnnouncements">
              <i class="fa-solid fa-list"></i> 查看全部
            </button>
            <button class="announcement-float-btn announcement-float-btn-dismiss" @click="dismissAnnouncement">
              <i class="fa-solid fa-check"></i> 已读
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- 公告未读胶囊：浮窗自动收起/横滑甩出后的重开入口（不标已读） -->
    <transition name="announcement-float">
      <button
        v-if="announcementMinimized && hasUnreadAnnouncements"
        class="announcement-minimized"
        :aria-label="'查看未读公告 ' + unreadAnnouncements.length + ' 条'"
        @click="reopenAnnouncement"
      >
        <i class="fa-solid fa-bullhorn"></i>
        <span class="announcement-minimized-count">{{ unreadAnnouncements.length }}</span>
      </button>
    </transition>

    <!-- iPad 桌面模式：多页面容器 + 4×6 网格 -->
    <div
      v-if="isGridLayout && isLoaded"
      ref="pagesEl"
      class="desktop-pages"
      :style="pagesTransformStyle"
    >
      <div
        v-for="(page, pageIndex) in pages"
        :key="page.id"
        class="desktop-page"
      >
        <div class="desktop-grid" :style="{ gridTemplateRows: 'repeat(' + gridRows + ', 1fr)', maxHeight: gridMaxHeight }">
          <!-- 小组件（与 app 图标共用同一网格，grid-auto-flow: dense 实现环绕分布） -->
          <div
            v-for="w in ((pagesView[pageIndex] && pagesView[pageIndex].widgets) || [])"
            :key="w.id"
            class="desktop-widget"
            :class="{ 'widget-editing': isEditMode }"
            :style="widgetStyle(w)"
            :data-widget-id="w.id"
            :data-src-type="'widget'"
            :data-src-page="pageIndex"
          >
            <component :is="resolveWidget(w.type)" :config="w.config || {}" :refresh-key="widgetRefreshKey" />
            <template v-if="isEditMode">
              <button
                class="widget-remove-btn"
                @click.stop="removeWidgetFromPage(page.id, w.id)"
                title="移除"
              >
                <i class="fa-solid fa-xmark"></i>
              </button>
              <button
                class="widget-ctrl-btn widget-resize-minus"
                @click.stop="resizeWidget(page.id, w, -1, 0)"
                title="缩小宽度"
              >
                <i class="fa-solid fa-minus"></i>
              </button>
              <button
                class="widget-ctrl-btn widget-resize-plus"
                @click.stop="resizeWidget(page.id, w, 1, 0)"
                title="加宽"
              >
                <i class="fa-solid fa-plus"></i>
              </button>
              <button
                v-if="hasWidgetConfig(w.type)"
                class="widget-ctrl-btn widget-config-btn"
                @click.stop="openWidgetConfig(page.id, w)"
                title="配置"
              >
                <i class="fa-solid fa-gear"></i>
              </button>
              <button
                class="widget-ctrl-btn widget-refresh-btn"
                @click.stop="refreshAllWidgets"
                title="刷新"
              >
                <i class="fa-solid fa-rotate"></i>
              </button>
            </template>
          </div>
          <div
            v-for="item in slotRenderList(pageIndex)"
            :key="'slot-' + item.index"
            class="desktop-slot"
            :class="{
              'slot--empty': !item.slot,
              'slot--drop-target': isDropTarget('page', pageIndex, item.index)
            }"
            :style="slotExtraStyle(pageIndex, item.index, item.slot)"
            :data-dst-type="'page'"
            :data-dst-page="pageIndex"
            :data-dst-idx="item.index"
          >
            <template v-if="item.slot">
              <AppIcon
                v-if="item.slot.type === 'app' && isAppEnabled(item.slot.name)"
                :app="appMeta(item.slot.name) || placeholderApp(item.slot.name)"
                :badge="appBadges[item.slot.name] || ''"
                :launching="launchingApp === item.slot.name"
                :editing="isEditMode"
                :pinned="pinnedAppNames.indexOf(item.slot.name) !== -1"
                :show-label="showIconLabels"
                :data-src-type="'page'"
                :data-src-page="pageIndex"
                :data-src-idx="item.index"
                :data-src-app="item.slot.name"
                :data-flip-key="'page-app-' + item.slot.name"
                @launch="launchApp"
                @remove="onRemoveApp(pageIndex, item.index)"
              />
              <DesktopFolderTile
                v-else-if="item.slot.type === 'folder'"
                :folder="folderById(item.slot.id) || { id: item.slot.id, name: '文件夹', apps: [] }"
                :editing="isEditMode"
                :data-src-type="'page'"
                :data-src-page="pageIndex"
                :data-src-idx="item.index"
                :data-src-app="item.slot.id"
                :data-flip-key="'page-folder-' + item.slot.id"
                @open="openFolder(item.slot.id)"
                @remove="onDeleteFolder(item.slot.id)"
                @resize="onResizeFolder(item.slot.id, pageIndex, item.index)"
                @launch-app="launchAppByName"
              />
            </template>
          </div>
        </div>

        <!-- 编辑态：小组件占位导致图标被裁剪的提示 -->
        <div v-if="isEditMode && hiddenIconsCount(pageIndex) > 0" class="desktop-page-overflow-tip">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>小组件占位较大，{{ hiddenIconsCount(pageIndex) }} 个图标被隐藏</span>
        </div>
      </div>
    </div>

    <!-- 分页点指示器（跟手进度由 gestures 直写其内部 DOM，不传响应式 prop） -->
    <DesktopPageIndicator
      v-if="isGridLayout && isLoaded"
      ref="pager"
      :total="totalPages"
      :current="currentPage"
      :max-pages="9"
      @jump="setCurrentPage"
      @add-page="addPage"
      @page-menu="onPageMenu"
    />

    <!-- Dock 栏（transition-group 实现图标进出动画 + 自动扩展/缩减） -->
    <!-- dock-bar 本身作为 "append" 追加落点（拖到 Dock 空白处即追加到末尾） -->
    <!-- 空 Dock 在非编辑态隐藏；编辑态显示占位便于拖入图标 -->
    <transition-group
      name="dock-slot"
      tag="div"
      class="dock-bar"
      :class="{
        'dock-bar--editing': isEditMode,
        'dock-bar--empty': effectiveDockApps.length === 0,
        'dock-bar--hidden': !shouldShowDock,
        'dock-bar--many': effectiveDockApps.length > 8,
        'dock-bar--huge': effectiveDockApps.length > 12
      }"
      :data-dst-type="isGridLayout ? 'dock' : null"
      :data-dst-dock="isGridLayout ? 'append' : null"
    >
      <div v-if="effectiveDockApps.length === 0" key="dock-empty" class="dock-empty-hint">
        拖入应用添加到 Dock
      </div>
      <div
        v-for="(name, i) in effectiveDockApps"
        :key="'dock-' + name"
        class="dock-slot"
        :class="{ 'dock-slot--launching': launchingApp === name, 'slot--drop-target': isDropTarget('dock', null, i) }"
        :data-dst-type="isGridLayout ? 'dock' : null"
        :data-dst-dock="isGridLayout ? i : null"
        :data-src-type="isGridLayout ? 'dock' : null"
        :data-src-dock="isGridLayout ? i : null"
        :data-src-app="isGridLayout ? name : null"
        :data-flip-key="'dock-' + name"
        @click="onDockClick($event, name)"
      >
        <div class="dock-icon">
          <img :src="dockIconUrl(name)" :alt="dockAppMeta(name).label" loading="eager">
        </div>
        <span v-if="appBadges[name]" class="dock-badge" :class="{ 'dock-badge-dot': appBadges[name] === '●' }">{{ appBadges[name] === '●' ? '' : appBadges[name] }}</span>
        <!-- 编辑态删除徽章：从 Dock 移除（固定图标不可移除） -->
        <span
          v-if="isEditMode && pinnedAppNames.indexOf(name) === -1"
          class="dock-remove-btn"
          role="button"
          :aria-label="'从 Dock 移除' + dockAppMeta(name).label"
          @click.stop="onRemoveDockApp(i)"
        >
          <i class="fa-solid fa-minus"></i>
        </span>
      </div>
    </transition-group>

    <!-- 文件夹展开层 -->
    <transition name="folder-expand">
      <DesktopFolderExpanded
        v-if="openFolderId && folderById(openFolderId)"
        :folder="folderById(openFolderId)"
        :editing="isEditMode"
        @close="closeFolder"
        @rename="onRenameFolder"
        @remove="onDeleteFolder(openFolderId)"
        @launch-app="launchAppByName"
      />
    </transition>

    <!-- 捏合调出的设置面板 -->
    <DesktopSettingsPanel
      :visible="settingsPanelOpen"
      :total-pages="totalPages"
      :current-page="currentPage"
      :max-pages="9"
      @close="closeSettingsPanel"
      @done="onSettingsDone"
      @add-page="addPage"
      @remove-page="removePage"
      @tidy="tidyCurrentPage"
      @reset="resetLayout"
    />

    <!-- 生日庆祝动画 -->
    <BirthdayCelebration
      v-if="showBirthdayCelebration"
      :userName="birthdayUserName"
      @dismiss="dismissBirthdayCelebration"
    />

    <!-- PC 右键菜单（触屏不受影响） -->
    <DesktopContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      @select="onCtxSelect"
      @close="closeCtxMenu"
    />

    <!-- Widget 配置弹窗（支持多字段、select/text/bool/number 类型） -->
    <div v-if="widgetConfigEditor.open" class="widget-config-mask" @click.self="closeWidgetConfig">
      <div class="widget-config-dialog">
        <div class="wc-header">
          <span class="wc-title">配置 · {{ widgetConfigEditor.widgetName }}</span>
          <button class="wc-close" @click="closeWidgetConfig"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="wc-body">
          <div v-for="f in widgetConfigEditor.fields" :key="f.key" class="wc-field">
            <label class="wc-label">{{ f.label }}</label>
            <!-- select 类型 -->
            <select v-if="f.type === 'select'" class="wc-select" v-model="widgetConfigEditor.form[f.key]">
              <option v-for="opt in f.options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <!-- text 类型 -->
            <input
              v-else-if="f.type === 'text'"
              type="text"
              class="wc-input"
              v-model="widgetConfigEditor.form[f.key]"
              :placeholder="f.placeholder || ''"
            />
            <!-- number 类型 -->
            <input
              v-else-if="f.type === 'number'"
              type="number"
              class="wc-input"
              v-model.number="widgetConfigEditor.form[f.key]"
              :placeholder="f.placeholder || ''"
            />
            <!-- bool 类型（开关） -->
            <div v-else-if="f.type === 'bool'" class="wc-switch-wrap">
              <button
                class="wc-switch"
                :class="{ on: !!widgetConfigEditor.form[f.key] }"
                @click="widgetConfigEditor.form[f.key] = !widgetConfigEditor.form[f.key]"
              >
                <span class="wc-switch-knob"></span>
              </button>
            </div>
          </div>
          <div v-if="!widgetConfigEditor.fields.length" class="wc-empty">暂无可配置项</div>
        </div>
        <div class="wc-actions">
          <button class="wc-btn wc-btn-cancel" @click="closeWidgetConfig">取消</button>
          <button class="wc-btn wc-btn-save" @click="saveWidgetConfig">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';
import readState from '@/utils/read-state';
import updateChecker from '@/utils/update-checker';
import AppIcon from '@/components/AppIcon.vue';
import DesktopFolderTile from '@/components/DesktopFolderTile.vue';
import DesktopFolderExpanded from '@/components/DesktopFolderExpanded.vue';
import DesktopPageIndicator from '@/components/DesktopPageIndicator.vue';
import DesktopSettingsPanel from '@/components/DesktopSettingsPanel.vue';
import DesktopContextMenu from '@/components/DesktopContextMenu.vue';
import BirthdayCelebration from '@/components/BirthdayCelebration.vue';
import desktopDrag from '@/mixins/desktop-drag.js';
import desktopGestures from '@/mixins/desktop-gestures.js';
import { APP_REGISTRY } from '@/store/modules/desktop.js';
import { mergeMarketApps } from '@/core/app-registry';
import { marketRegistry } from '@/core/market-registry';
import { getWidget } from '@/core/widget-aggregator';
import appOpenTransition from '@/core/app-open-transition';
import { resolveAppIcon } from '@/utils/icon-resolver.js';
import { prefetchRoutes } from '@/core/route-prefetch';
import { ROUTE_APP_MAP } from '@/core/router-aggregator';

// 渐变壁纸预设：多层合成（主渐变 + radial 光晕），与 utils/wallpaper-bg.js
// 的 GRADIENT_MAP 保持一致，两边若调整需同步。
var WALLPAPER_MAP = {
  'default': 'radial-gradient(90% 70% at 82% 8%, rgba(191,238,255,0.85) 0%, rgba(191,238,255,0) 55%), radial-gradient(110% 85% at 8% 96%, rgba(0,61,122,0.55) 0%, rgba(0,61,122,0) 60%), linear-gradient(135deg, #0A84FF 0%, #2E7CF6 48%, #4FB3F9 100%)',
  'ocean': 'radial-gradient(100% 75% at 80% 12%, rgba(90,200,250,0.5) 0%, rgba(90,200,250,0) 55%), linear-gradient(140deg, #001D45 0%, #003D7A 40%, #0055B8 75%, #007AFF 100%)',
  'sky': 'radial-gradient(90% 70% at 85% 6%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 55%), linear-gradient(135deg, #0A84FF 0%, #3FA1F8 45%, #5AC8FA 75%, #BFEEFF 100%)',
  'night': 'linear-gradient(135deg, #000000 0%, #1C1C1E 50%, #2C2C2E 100%)',
  'dawn': 'radial-gradient(90% 70% at 80% 10%, rgba(255,204,0,0.55) 0%, rgba(255,204,0,0) 55%), linear-gradient(135deg, #FF2D55 0%, #FF9500 55%, #FFCC00 100%)',
  'arctic': 'radial-gradient(90% 70% at 82% 10%, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 55%), linear-gradient(135deg, #90CAF9 0%, #BBDEFB 50%, #E3F2FD 100%)'
};

var VIDEO_EXTS = ['.mp4', '.webm', '.mov'];
var IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

function isVideoWallpaper(wp) {
  if (!wp) return false;
  for (var i = 0; i < VIDEO_EXTS.length; i++) {
    if (wp.endsWith(VIDEO_EXTS[i])) return true;
  }
  return false;
}

function isImageFile(wp) {
  if (!wp) return false;
  for (var i = 0; i < IMAGE_EXTS.length; i++) {
    if (wp.endsWith(IMAGE_EXTS[i])) return true;
  }
  return false;
}

export default {
  name: 'Desktop',
  components: {
    AppIcon: AppIcon,
    DesktopFolderTile: DesktopFolderTile,
    DesktopFolderExpanded: DesktopFolderExpanded,
    DesktopPageIndicator: DesktopPageIndicator,
    DesktopSettingsPanel: DesktopSettingsPanel,
    DesktopContextMenu: DesktopContextMenu,
    BirthdayCelebration: BirthdayCelebration
  },
  mixins: [desktopDrag, desktopGestures],
  data: function() {
    return {
      entered: false,
      launchingApp: '',
      // 公告浮窗横滑关闭的跟手位移（0 = 未拖动；负左正右）
      announceSwipeX: 0,
      // 公告浮窗已收起为右上角胶囊（未读保留，不标已读）
      announcementMinimized: false,
      // PC 右键菜单状态（meta 携带动作上下文：图标源信息 / blank）
      ctxMenu: { visible: false, x: 0, y: 0, items: [], meta: { type: 'blank' } },
      videoBuffering: false,
      videoWallpaperFailed: false,
      videoPerformanceLevel: 2,
      videoStallCount: 0,
      videoLastStallTime: 0,
      videoRetryCount: 0,
      performanceCheckTimer: null,
      activeVideo: 'A',
      unreadAnnouncements: [],
      showAnnouncementFloat: false,
      currentAnnouncementIndex: 0,
      newVersionAvailable: false,
      latestVersion: '',
      // 应用元数据（从 APP_REGISTRY 引用，作为降级备份）
      dockApps: APP_REGISTRY,
      enabledApps: null,  // null=未加载，数组=已加载的启用应用名列表
      // 生日庆祝
      showBirthdayCelebration: false,
      birthdayUserName: '',
      // widget 配置弹窗（支持多字段、select/text/bool/number 类型）
      widgetConfigEditor: {
        open: false,
        pageId: null,
        widgetId: null,
        widgetType: '',
        widgetName: '',
        fields: [],
        form: {}
      }
    };
  },
  computed: {
    wallpaper: function() {
      return this.$store.state.settings.wallpaper;
    },
    videoWallpaperSrc: function() {
      var wp = this.wallpaper;
      if (!wp) return '';
      if (isVideoWallpaper(wp)) {
        if (wp.startsWith('/') || wp.startsWith('http')) return wp;
        return '/resources/public/wallpaper/' + wp;
      }
      return '';
    },
    staticWallpaperStyle: function() {
      var wp = this.wallpaper || 'default';
      if (wp.startsWith('/') || wp.startsWith('http')) {
        return {
          backgroundImage: 'url(' + wp + ')',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        };
      }
      if (isImageFile(wp)) {
        return {
          backgroundImage: 'url(/resources/public/wallpaper/' + wp + ')',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        };
      }
      if (WALLPAPER_MAP[wp]) {
        return { background: WALLPAPER_MAP[wp] };
      }
      return { background: WALLPAPER_MAP['default'] };
    },
    appBadges: function() {
      var badges = {};
      // 走 store 的 unreadTotal getter：与超能岛收起态共用同一判据，
      // 避免两处各自遍历导致角标数字不一致。
      var totalChat = this.$store.getters['chat/unreadTotal'] || 0;
      if (totalChat > 0) {
        badges['chat'] = totalChat > 99 ? '99+' : totalChat;
      }
      if (this.newVersionAvailable) {
        badges['settings'] = '●';
      }
      // 应用自设角标（context.system.setBadge）：并入同一张表，
      // 系统自己的 chat / settings 优先，避免被第三方覆盖。
      var appSet = this.$store.state.desktop.appBadges || {};
      var names = Object.keys(appSet);
      for (var i = 0; i < names.length; i++) {
        if (!badges[names[i]]) badges[names[i]] = appSet[names[i]];
      }
      return badges;
    },
    // 桌面布局是否已加载
    isLoaded: function() {
      return this.$store.getters['desktop/isLoaded'];
    },
    // 当前登录用户
    currentUser: function() {
      return this.$store.state.auth.user || {};
    },
    // 是否为管理员或班干（用于 admin 应用图标可见性判断）
    isAdminOrOfficer: function() {
      var u = this.currentUser;
      return !!(u && (u.is_admin === 1 || u.is_admin === true || u.role === 'officer' || u.is_class_admin));
    },
    // 是否为班管或系统管理员（classAdmin 角色判断：班管 = user_id 末尾 00；
    // 不含班干 officer——应用中心等管理入口仅班管可见）
    isClassAdmin: function() {
      var u = this.currentUser;
      return !!(u && (u.is_class_admin === true || u.is_admin === 1 || u.is_admin === true));
    },
    // 桌面布局模式：'grid'（iPad 桌面图标）| 'dock'（仅 Dock）
    isGridLayout: function() {
      return this.$store.getters['settings/desktopLayout'] === 'grid';
    },
    // 所有页面
    pages: function() {
      var layout = this.$store.state.desktop.layout;
      return layout ? layout.pages : [];
    },
    // 当前页索引
    currentPage: function() {
      return this.$store.state.desktop.currentPage;
    },
    // 页面容器 transform：只表达「当前页」这一稳定态。
    // 跟手位移由 desktop-gestures 逐帧直写 DOM（2026-11-02）——拖拽期间不产生
    // 响应式更新，避免整个桌面组件（三页图标 + Dock + 公告）逐帧重渲染。
    pagesTransformStyle: function() {
      return { transform: 'translateX(-' + (this.currentPage * 100) + '%)' };
    },
    // 总页数
    totalPages: function() {
      return this.$store.getters['desktop/totalPages'];
    },
    // 桌面网格图标是否显示文字标签（dock 恒无标签）
    showIconLabels: function() {
      return this.$store.state.settings.showIconLabels;
    },
    // 图标尺寸档位（small/standard/large），经 root data 属性驱动 --app-icon-size
    iconSize: function() {
      return this.$store.state.settings.iconSize;
    },
    // 网格行数（图标密度），列固定 6
    gridRows: function() {
      return this.$store.getters['desktop/gridRows'];
    },
    // 网格最大高度：随行数放宽，且不超过视口可用高度
    gridMaxHeight: function() {
      var rows = this.gridRows;
      var byRows = 440 + (rows - 4) * 113;
      var byViewport = (window.innerHeight || 787) - 245;
      return Math.max(300, Math.min(byRows, byViewport)) + 'px';
    },
    // 桌宠是否应让位：设置面板/文件夹展开/widget 配置/编辑态任一打开
    uiOverlayBusy: function() {
      var s = this.$store.state.desktop;
      return !!(s.settingsPanelOpen || s.openFolderId || this.widgetConfigEditor.open || this.isEditMode);
    },
    // 是否编辑态
    isEditMode: function() {
      return this.$store.getters['desktop/isEditMode'];
    },
    // 是否拖拽中
    isDragging: function() {
      return this.$store.getters['desktop/isDragging'];
    },
    // 每页「可见 widget + 可用 slot」预计算。
    // 模板原先在 v-for 里直接调用 visibleWidgetsByPage(page.id) 与 visibleSlots(page)，
    // 而 visibleSlots 内部又调一遍 visibleWidgetsByPage → 每次渲染、每页都要重跑
    // filter + getWidget 查表 + canManage 权限 getter（桌面在拖拽/编辑时会高频重渲染）。
    // 收敛成 computed 后由 Vue 缓存，仅在 pages / 权限变化时重算。
    pagesView: function() {
      var self = this;
      var rows = this.gridRows;
      var slotCount = 6 * rows;
      return (this.pages || []).map(function(page, pageIndex) {
        var widgets = self.visibleWidgetsByPage(page.id);
        var widgetCells = 0;
        for (var i = 0; i < widgets.length; i++) {
          var w = widgets[i];
          widgetCells += ((w.w || 2) * (w.h || 2));
        }
        var maxSlots = slotCount - widgetCells;
        if (maxSlots < 0) maxSlots = 0;
        // 大文件夹：跨度与覆盖格（covered 索引跳过渲染，span 由 slot div 承载）
        var layoutFolders = (self.$store.state.desktop.layout || {}).folders || {};
        var covered = {};
        var spans = {};
        var slots = page.slots || [];
        for (var j = 0; j < slots.length && j < slotCount; j++) {
          var s = slots[j];
          if (!s || s.type !== 'folder') continue;
          var f = layoutFolders[s.id];
          var size = f && f.size;
          if (size !== '2x2' && size !== '2x4') continue;
          var w2 = size === '2x4' ? 4 : 2;
          var c0 = j % 6;
          var r0 = Math.floor(j / 6);
          if (c0 + w2 > 6 || r0 + 2 > rows) continue;
          spans[j] = size;
          for (var dr = 0; dr < 2; dr++) {
            for (var dc = 0; dc < w2; dc++) {
              if (dr === 0 && dc === 0) continue;
              covered[j + dr * 6 + dc] = true;
            }
          }
        }
        return { widgets: widgets, slots: (page.slots || []).slice(0, maxSlots), covered: covered, spans: spans };
      });
    },
    // 应用可见性查找表：把「注册表元数据 + 角色过滤 + 管控过滤」一次性归并。
    // 模板里按 slot 逐个调用 isAppEnabled → isVisibleForUser，原先每次都线性扫描
    // dockApps（O(注册表长度)）再 indexOf(enabledApps)，拖拽/编辑高频重渲染时叠加明显。
    // 收敛成 computed 后由 Vue 缓存，仅在 dockApps / 角色派生值 / enabledApps 变化时重算一次。
    visibleAppMap: function() {
      var map = {};
      var apps = this.dockApps || [];
      var enabled = this.enabledApps;
      for (var i = 0; i < apps.length; i++) {
        var appMeta = apps[i];
        var name = appMeta && appMeta.name;
        if (!name) continue;
        // 1. 角色过滤：visibleRoles 声明的应用仅对指定角色显示
        if (appMeta.visibleRoles && appMeta.visibleRoles.length) {
          var roleOk = false;
          for (var r = 0; r < appMeta.visibleRoles.length; r++) {
            var role = appMeta.visibleRoles[r];
            if (role === 'classAdmin' && this.isClassAdmin) { roleOk = true; break; }
            if (role === 'admin' && this.isAdminOrOfficer) { roleOk = true; break; }
            if (role === 'officer' && this.currentUser.role === 'officer') { roleOk = true; break; }
          }
          if (!roleOk) continue;
        }
        // 2. 管控过滤：enabledApps 未加载(null)时全部可见，加载后过滤禁用的
        if (enabled !== null && enabled.indexOf(name) === -1) continue;
        map[name] = true;
      }
      return map;
    },
    // Dock 应用名列表
    dockAppNames: function() {
      var self = this;
      var dockNames = this.$store.getters['desktop/dockApps'];
      // 应用管控过滤 + 角色过滤（admin 应用仅管理员/班干可见）
      var filtered = dockNames.filter(function(name) {
        return self.isVisibleForUser(name);
      });
      return filtered;
    },
    // Dock 实际渲染应用列表：
    //   grid 模式 → 仅 layout.dock（过滤禁用应用）
    //   dock-only 模式 → 聚合 pinned + dock + 所有 page app + 所有 folder app，去重，按启用列表过滤
    // dock-only 模式下布局数据不动，切回 grid 自然还原页面/文件夹
    effectiveDockApps: function() {
      if (this.isGridLayout) return this.dockAppNames;
      var layout = this.$store.state.desktop.layout;
      if (!layout) return [];
      var enabled = this.enabledApps;
      var ready = enabled !== null;
      var self = this;
      var seen = {};
      var result = [];
      function push(name) {
        if (!name) return;
        // 角色过滤（admin 应用仅管理员/班干可见）
        if (!self.isVisibleForUser(name)) return;
        if (ready && enabled.indexOf(name) === -1) return;
        if (seen[name]) return;
        seen[name] = true;
        result.push(name);
      }
      // 1. pinned 优先（固定应用恒定首位）
      (layout.pinnedApps || []).forEach(push);
      // 2. Dock 原有顺序
      layout.dock.forEach(push);
      // 3. 所有页面 app（按页序、slot 序）
      layout.pages.forEach(function(p) {
        p.slots.forEach(function(s) {
          if (s && s.type === 'app') push(s.name);
        });
      });
      // 4. 所有文件夹内 app（按 folder id 序）
      Object.keys(layout.folders).sort().forEach(function(fid) {
        (layout.folders[fid].apps || []).forEach(push);
      });
      return result;
    },
    // Dock 是否应显示：有图标时始终显示；空 Dock 仅在编辑态显示占位（便于拖入）
    // dock-only 模式下 effectiveDockApps 聚合所有应用，不会为空
    shouldShowDock: function() {
      if (this.effectiveDockApps.length > 0) return true;
      // grid 模式空 Dock：仅编辑态显示占位
      return this.isEditMode && this.isGridLayout;
    },
    // 固定应用名列表
    pinnedAppNames: function() {
      return this.$store.getters['desktop/pinnedApps'];
    },
    // 当前打开的文件夹 id
    openFolderId: function() {
      return this.$store.getters['desktop/openFolderId'];
    },
    // 设置面板是否打开
    settingsPanelOpen: function() {
      return this.$store.getters['desktop/settingsPanelOpen'];
    },
    hasUnreadAnnouncements: function() {
      return this.unreadAnnouncements.length > 0;
    },
    currentAnnouncement: function() {
      if (this.unreadAnnouncements.length === 0) return null;
      return this.unreadAnnouncements[this.currentAnnouncementIndex] || null;
    },
    // 小组件列表 getter（预留小组件系统）
    widgetsByPage: function() {
      return this.$store.getters['desktop/widgetsByPage'];
    },
    // widget 刷新 key（watch 此值触发 widget 重新加载数据）
    widgetRefreshKey: function() {
      return this.$store.state.desktop.widgetRefreshKey;
    }
  },
  mounted: function() {
    var self = this;
    // PC 键盘：方向键翻页 / Esc 分层收起（组件级监听随路由自动隔离在桌面页）
    document.addEventListener('keydown', this._onPcKeyDown);
    // 悬空引用守卫：打开中的文件夹被解散（拖出最后一个应用/管控清空）时自动收起，
    // 避免 folder=null 渲染崩溃（拖出定住/禁用后打开报错的共同根因）
    self._unwatchFolderGone = self.$store.watch(
      function (state, getters) {
        var id = getters['desktop/openFolderId'];
        return id ? (getters['desktop/folderById'](id) || null) : 'idle';
      },
      function (folder) {
        if (folder === null) {
          self.$store.commit('desktop/SET_OPEN_FOLDER', null);
        }
      }
    );
    // 拖拽流畅性：拖拽期间暂停视频壁纸（解码是掉帧主因），结束自动恢复
    self._unwatchDragging = self.$store.watch(
      function (state, getters) { return getters['desktop/isDragging']; },
      function (dragging) {
        var videos = document.querySelectorAll('.desktop-wallpaper-video video, video.desktop-video');
        if (!videos.length && self.$refs.videoA) videos = [self.$refs.videoA];
        for (var i = 0; i < videos.length; i++) {
          // 拖拽结束恢复播放：仅当视频壁纸仍生效且不在编辑态（编辑态的暂停/恢复由 isEditMode watcher 管）
          try { if (dragging) { videos[i].pause(); } else if (videos[i].paused && !self.isEditMode && self.videoWallpaperSrc && !self.videoWallpaperFailed) { videos[i].play(); } } catch (e) {}
        }
      }
    );
    self.detectPerformanceLevel();
    self.$nextTick(function() {
      self.entered = true;
      self.playVideoWallpaper();
    });
    self.loadUnreadAnnouncements();
    // 空闲预取常用应用的懒加载 chunk：把「点开才下载+解析」的等待前移到桌面空闲期。
    // 延迟 1.2s 触发（等 enabledApps 落地再筛名单），模块内部再等 2.6s 空闲才开拉。
    self._prefetchTimer = setTimeout(function() {
      self._prefetchTimer = null;
      if (self._isDestroyed) return;
      prefetchRoutes(self.$router, self._buildPrefetchPaths());
    }, 1200);
    mergeMarketApps(marketRegistry.getInstalledApps());
    self.dockApps = APP_REGISTRY.slice();
    self._marketUnsubscribe = marketRegistry.onChange(function(apps) {
      mergeMarketApps(apps);
      self.dockApps = APP_REGISTRY.slice();
      if (self.$router && self.$router.registerMarketApps) self.$router.registerMarketApps(apps);
      self.loadEnabledApps();
    });
    // 首次加载不强制：复用路由守卫在导航阶段已发起的同一次 /system/app-control 请求
    self.loadEnabledApps();
    self.checkBirthday();
    self.checkVersionUpdate();
    // 应用管控实时同步：页面重新可见 / 窗口聚焦时刷新（管理员切换后自动生效）
    // force=true：绕过 router 缓存强制重取，确保管理员改动后回到前台能拿到最新状态
    self._visibilityHandler = function() {
      if (!document.hidden) self.loadEnabledApps(true);
    };
    document.addEventListener('visibilitychange', self._visibilityHandler);
    self._focusHandler = function() { self.loadEnabledApps(true); };
    window.addEventListener('focus', self._focusHandler);
  },
  beforeDestroy: function() {
    document.removeEventListener('keydown', this._onPcKeyDown);
    if (this._unwatchFolderGone) {
      this._unwatchFolderGone();
      this._unwatchFolderGone = null;
    }
    if (this._unwatchDragging) {
      this._unwatchDragging();
      this._unwatchDragging = null;
    }
    if (this._marketUnsubscribe) {
      this._marketUnsubscribe();
      this._marketUnsubscribe = null;
    }
    if (this._updateUnsubscribe) {
      this._updateUnsubscribe();
      this._updateUnsubscribe = null;
    }
    // 移除应用管控刷新监听
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
    if (this._focusHandler) {
      window.removeEventListener('focus', this._focusHandler);
      this._focusHandler = null;
    }
    if (this.performanceCheckTimer) {
      clearInterval(this.performanceCheckTimer);
      this.performanceCheckTimer = null;
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (this._launchTimer) {
      clearTimeout(this._launchTimer);
      this._launchTimer = null;
    }
    if (this._prefetchTimer) {
      clearTimeout(this._prefetchTimer);
      this._prefetchTimer = null;
    }
    this.stopAnnouncementRotate();
    this.stopAnnouncementMinimize();
    var video = this.$refs.videoA;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  },
  watch: {
    // 桌宠让位：全屏面板/遮罩/编辑态任一打开 → body 挂 ci-pet-suppressed，
    // pet overlay 的 syncRouteVisibility 消费（轮询兜底 + ci-route-changed 即时触发）
    uiOverlayBusy: {
      handler: function(val) {
        document.body.classList.toggle('ci-pet-suppressed', !!val);
        try { window.dispatchEvent(new Event('ci-route-changed')); } catch (e) {}
      },
      immediate: true
    },
    videoWallpaperSrc: function() {
      var self = this;
      // 换壁纸：重置降级状态——此前源的视频播放失败不代表新源也会失败，
      // 不重置会导致一旦降级静态壁纸，之后换任何视频壁纸都永不恢复
      self.videoWallpaperFailed = false;
      self.videoRetryCount = 0;
      self.videoStallCount = 0;
      self.$nextTick(function() {
        self.playVideoWallpaper();
      });
    },
    // 编辑态暂停视频壁纸：编辑态已对壁纸施加 brightness(0.6)+blur(4px)，
    // 视频动态细节几乎不可见，暂停可显著降低 CPU/GPU 占用，提升拖拽流畅度
    isEditMode: function(val) {
      var video = this.$refs.videoA;
      if (!video) return;
      if (val) {
        // 进入编辑态：暂停视频（保留 currentTime，退出时无缝恢复）
        if (!video.paused) video.pause();
      } else {
        // 退出编辑态：恢复播放（仅当视频壁纸仍生效时）
        if (this.videoWallpaperSrc && !this.videoWallpaperFailed && video.paused) {
          video.play().catch(function() {});
        }
      }
    },
    // 外部页面（公告中心）标记已读后，桌面浮窗同步刷新，
    // 否则会出现「公告中心看完了，回桌面浮窗还挂着同一条」。
    '$store.state.island.readStateSeq': function() {
      this.loadUnreadAnnouncements();
    }
  },
  methods: {
    // ===== 小组件相关 =====
    // 懒加载 widget 组件
    resolveWidget: function(type) {
      var def = getWidget(type);
      if (!def || !def.component) return null;
      return def.component;
    },
    // 按权限过滤后的可见 widget 列表（无权限的 widget 不渲染、不占位）
    visibleWidgetsByPage: function(pageId) {
      var all = this.widgetsByPage(pageId);
      var self = this;
      return all.filter(function(w) {
        var def = getWidget(w.type);
        if (!def) return false;
        if (!def.permission) return true;
        return self.$store.getters['auth/canManage'](def.permission);
      });
    },
    // 计算 widget 网格跨度样式
    // 若 widget 有 col/row（拖拽固定后），用显式起始坐标 + span，CSS grid dense 自动让 app 图标避让
    widgetStyle: function(w) {
      var colSpan = (w && w.w) || 2;
      var rowSpan = (w && w.h) || 2;
      var style = {
        gridColumn: 'span ' + colSpan,
        gridRow: 'span ' + rowSpan
      };
      if (w && w.col && w.row) {
        style.gridColumn = w.col + ' / span ' + colSpan;
        style.gridRow = w.row + ' / span ' + rowSpan;
      }
      return style;
    },
    // 注：可见 slot 数量已收敛到 computed pagesView 中预计算（见上），
    // 原运行时方法 visibleSlots 已删除，避免每次渲染重复扫描。
    // 从指定页移除 widget
    removeWidgetFromPage: function(pageId, widgetId) {
      this.$store.dispatch('desktop/removeWidget', { pageId: pageId, widgetId: widgetId });
    },
    // 调整 widget 大小（dw/dh 为增量）
    resizeWidget: function(pageId, widget, dw, dh) {
      this.$store.dispatch('desktop/resizeWidget', {
        pageId: pageId, widgetId: widget.id, dw: dw, dh: dh
      });
    },
    // 判断 widget 是否有配置项
    hasWidgetConfig: function(type) {
      var def = getWidget(type);
      return !!(def && def.configSchema && def.configSchema.fields && def.configSchema.fields.length);
    },
    // 打开 widget 配置弹窗（支持多字段、select/text/bool/number 类型）
    openWidgetConfig: function(pageId, widget) {
      var def = getWidget(widget.type);
      if (!def || !def.configSchema || !def.configSchema.fields || !def.configSchema.fields.length) return;
      var form = {};
      def.configSchema.fields.forEach(function(f) {
        // 优先用 widget 已有配置，其次用字段默认值
        var currentVal = (widget.config && widget.config[f.key] !== undefined)
          ? widget.config[f.key]
          : f.default;
        form[f.key] = currentVal;
      });
      this.widgetConfigEditor.pageId = pageId;
      this.widgetConfigEditor.widgetId = widget.id;
      this.widgetConfigEditor.widgetType = widget.type;
      this.widgetConfigEditor.widgetName = def.name || widget.type;
      this.widgetConfigEditor.fields = def.configSchema.fields;
      this.widgetConfigEditor.form = form;
      this.widgetConfigEditor.open = true;
    },
    // 关闭 widget 配置弹窗
    closeWidgetConfig: function() {
      this.widgetConfigEditor.open = false;
      this.widgetConfigEditor.pageId = null;
      this.widgetConfigEditor.widgetId = null;
      this.widgetConfigEditor.widgetType = '';
      this.widgetConfigEditor.widgetName = '';
      this.widgetConfigEditor.fields = [];
      this.widgetConfigEditor.form = {};
    },
    // 保存 widget 配置
    saveWidgetConfig: function() {
      var self = this;
      var newConfig = {};
      this.widgetConfigEditor.fields.forEach(function(f) {
        var val = self.widgetConfigEditor.form[f.key];
        // 数字类型转换
        if (f.type === 'number') {
          val = parseFloat(val);
          if (isNaN(val)) val = f.default;
        }
        newConfig[f.key] = val;
      });
      this.$store.dispatch('desktop/updateWidgetConfig', {
        pageId: this.widgetConfigEditor.pageId,
        widgetId: this.widgetConfigEditor.widgetId,
        config: newConfig
      });
      this.$store.commit('toast/SHOW_TOAST', { message: '配置已更新', type: 'success' });
      this.closeWidgetConfig();
    },
    // 刷新所有 widget
    refreshAllWidgets: function() {
      this.$store.dispatch('desktop/refreshAllWidgets');
    },
    detectPerformanceLevel: function() {
      var self = this;
      var existingPerf = document.documentElement.getAttribute('data-perf');
      if (existingPerf === 'high') {
        self.videoPerformanceLevel = 3;
      } else if (existingPerf === 'medium') {
        self.videoPerformanceLevel = 2;
      } else if (existingPerf === 'low') {
        self.videoPerformanceLevel = 1;
      } else {
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        var cores = navigator.hardwareConcurrency || 2;
        var memory = navigator.deviceMemory || 4;
        var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        var dpr = window.devicePixelRatio || 1;
        var pixels = window.screen.width * window.screen.height * dpr * dpr;

        var score = 0;
        if (cores >= 8) score += 3;
        else if (cores >= 4) score += 2;
        else score += 1;

        if (memory >= 8) score += 3;
        else if (memory >= 4) score += 2;
        else score += 1;

        if (gl) {
          try {
            var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            // X5/无 GPU 信息设备上 getParameter 可能返回 null 或抛错——
            // 此处在 mounted 主链路上，抛错会中断后续桌面初始化，必须整体兜底
            var renderer = ((debugInfo && gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) || '').toLowerCase();
            if (renderer.indexOf('nvidia') !== -1 || renderer.indexOf('radeon') !== -1 || renderer.indexOf('apple') !== -1) {
              score += 3;
            } else if (renderer.indexOf('intel') !== -1 || renderer.indexOf('adreno') !== -1 || renderer.indexOf('mali') !== -1) {
              score += 1;
            } else {
              score += 2;
            }
          } catch (glErr) {
            score += 2; // GPU 信息不可得，按中档处理
          }
        } else {
          score += 2;
        }

        if (isMobile) score -= 2;
        if (pixels > 4000000) score -= 1;
        if (pixels > 8000000) score -= 1;

        if (score >= 7) self.videoPerformanceLevel = 3;
        else if (score >= 4) self.videoPerformanceLevel = 2;
        else self.videoPerformanceLevel = 1;

        var perfLevel = self.videoPerformanceLevel === 3 ? 'high' : (self.videoPerformanceLevel === 2 ? 'medium' : 'low');
        document.documentElement.setAttribute('data-perf', perfLevel);
      }

      self.performanceCheckTimer = setInterval(function() {
        self.checkVideoHealth();
      }, 10000);
    },
    checkVideoHealth: function() {
      var self = this;
      // 编辑态/拖拽中刻意暂停了壁纸（降耗+防掉帧），巡检不得强行拉起
      if (self.isEditMode || self.isDragging) return;
      var video = self.$refs.videoA;
      if (!video) return;
      if (video.paused && !video.ended && video.readyState >= 3) {
        video.play().catch(function() {});
      }
    },
    onVideoMeta: function() {
      var self = this;
      var video = self.$refs.videoA;
      if (!video) return;

      var vw = video.videoWidth || 0;
      var vh = video.videoHeight || 0;

      if (vw > 0 && vh > 0) {
        var sw = window.screen.width;
        var sh = window.screen.height;
        var videoRatio = vw / vh;
        var screenRatio = sw / sh;
        if (Math.abs(videoRatio - screenRatio) > 0.5) {
          video.style.objectFit = 'cover';
        }
      }

      if (self.videoPerformanceLevel <= 1 && vw > 1920) {
        video.style.maxWidth = '1920px';
        video.style.maxHeight = '1080px';
      }
    },
    onVideoCanPlay: function() {
      // 视频就绪，无需额外处理
    },
    onVideoWaiting: function() {
      var self = this;
      self.videoBuffering = true;
      var now = Date.now();
      if (now - self.videoLastStallTime > 5000) {
        self.videoStallCount++;
        self.videoLastStallTime = now;
      }
      if (self.videoStallCount >= 3 && self.videoPerformanceLevel > 1) {
        self.videoPerformanceLevel--;
        self.videoStallCount = 0;
        self.applyPerformanceOptimizations();
      }
    },
    onVideoPlaying: function() {
      this.videoBuffering = false;
      this.videoRetryCount = 0;
    },
    onVideoError: function() {
      var self = this;
      self.videoBuffering = false;
      if (self.videoRetryCount < 3) {
        self.videoRetryCount++;
        if (self._retryTimer) clearTimeout(self._retryTimer);
        self._retryTimer = setTimeout(function() {
          self._retryTimer = null;
          self.retryVideoPlayback();
        }, 2000 * self.videoRetryCount);
      } else {
        self.videoWallpaperFailed = true;
      }
    },
    retryVideoPlayback: function() {
      var self = this;
      var video = self.$refs.videoA;
      if (!video) return;
      video.load();
      video.play().catch(function() {});
    },
    applyPerformanceOptimizations: function() {
      var video = this.$refs.videoA;
      if (!video) return;
      if (this.videoPerformanceLevel <= 1) {
        video.playbackRate = 0.75;
      } else if (this.videoPerformanceLevel === 2) {
        video.playbackRate = 0.9;
      } else {
        video.playbackRate = 1.0;
      }
    },
    // ===== 桌面手势入口（转发到 mixin）=====
    // 判断点击是否落在"空白区域"（非图标/文件夹/Dock/面板）
    // 编辑态下点击空白 → 退出编辑态（符合手机桌面行为）
    _isClickOnBlank: function(e) {
      var target = e.target;
      if (!target || !target.closest) return true;
      // 这些元素上的点击不算空白
      if (target.closest('.app-icon')) return false;
      if (target.closest('.desktop-folder')) return false;
      if (target.closest('.dock-slot')) return false;
      if (target.closest('.desktop-widget')) return false;
      if (target.closest('.desktop-settings-overlay')) return false;
      if (target.closest('.announcement-float')) return false;
      // 桌面背景、desktop-pages、desktop-grid、空槽位 → 空白
      return true;
    },
    onDesktopTouchStart: function(e) {
      this._touchActive = true;
      this._markTouchActivity();
      this.onDesktopGestureTouchStart(e);
      // 编辑态下：点击空白退出编辑态，点击图标转发到拖拽引擎
      if (this.isEditMode) {
        if (this._isClickOnBlank(e)) {
          this.$store.dispatch('desktop/exitEditMode');
          if (navigator.vibrate) navigator.vibrate(10);  // 与进入编辑态的 15ms 对称收尾
          return;
        }
        this.onPointerDown(e);
      }
    },
    onDesktopTouchMove: function(e) {
      this._markTouchActivity();
      this.onDesktopGestureTouchMove(e);
    },
    onDesktopTouchEnd: function(e) {
      this._touchActive = !!(e.touches && e.touches.length > 0);
      this._markTouchActivity();
      this.onDesktopGestureTouchEnd(e);
    },
    onDesktopTouchCancel: function(e) {
      this._touchActive = !!(e.touches && e.touches.length > 0);
      this._markTouchActivity();
      this.onDesktopGestureTouchEnd(e);
    },
    // 触摸活动时间戳：供 onDesktopContextMenu 识别「长按合成的 contextmenu」
    // （安卓 Chrome 长按 ~500ms 会补发 contextmenu，与长按进编辑态的手势叠车）
    _markTouchActivity: function() {
      this._lastTouchActivityAt = Date.now();
    },
    onDesktopMouseDown: function(e) {
      // PC：右键菜单打开时，任意左键按下即关闭（菜单内部已 .stop 不会误触）
      this.closeCtxMenu();
      if (this.isEditMode) {
        // 点击空白退出编辑态，点击图标转发到拖拽引擎
        if (this._isClickOnBlank(e)) {
          this.$store.dispatch('desktop/exitEditMode');
          if (navigator.vibrate) navigator.vibrate(10);
          return;
        }
        this.onPointerDown(e);
      }
    },
    // ===== 应用元数据 =====
    appMeta: function(name) {
      return this.$store.getters['desktop/appByName'](name);
    },
    // 应用名 → 路由路径（预取用；ROUTE_APP_MAP 是 path→name，这里反查）
    _routePathOfApp: function(name) {
      for (var path in ROUTE_APP_MAP) {
        if (Object.prototype.hasOwnProperty.call(ROUTE_APP_MAP, path) && ROUTE_APP_MAP[path] === name) {
          return path;
        }
      }
      return '';
    },
    // 预取候选：重块优先（社区/聊天/音乐/日历），再补 Dock 与当前页图标（都是最短路径的高频入口）
    _buildPrefetchPaths: function() {
      var self = this;
      var order = ['community', 'chat', 'music', 'calendar'];
      function push(name) {
        if (name && order.indexOf(name) === -1) order.push(name);
      }
      (self.effectiveDockApps || []).forEach(push);
      var page = self.pages && self.pages[self.currentPage];
      if (page && page.slots) {
        page.slots.forEach(function(slot) {
          if (slot && slot.type === 'app') push(slot.name);
        });
      }
      var enabled = self.enabledApps;  // null=清单未到，先不筛
      var paths = [];
      order.forEach(function(name) {
        if (enabled && enabled.indexOf(name) === -1) return;
        var path = self._routePathOfApp(name);
        if (path && paths.indexOf(path) === -1) paths.push(path);
      });
      return paths;
    },
    placeholderApp: function(name) {
      return { name: name, label: name, icon: '', color: '#8E8E93', route: '' };
    },
    // Dock 图标元数据：安全查找，未注册应用降级为占位（避免模板访问 .icon/.label 崩溃）
    // dock-only 模式下 effectiveDockApps 聚合了文件夹内应用，可能有未注册名称
    dockAppMeta: function(name) {
      return this.appMeta(name) || this.placeholderApp(name);
    },
    // Dock 图标 URL：走解析器（DPR≤2 取 120px 变体，与桌面图标同源）
    dockIconUrl: function(name) {
      return resolveAppIcon(this.dockAppMeta(name));
    },
    // 根据 id 查文件夹对象（委托 store getter，修复模板调用 folderById is not a function）
    folderById: function(fid) {
      return this.$store.getters['desktop/folderById'](fid);
    },
    // ===== 文件夹操作 =====
    openFolder: function(folderId) {
      // 捕获文件夹 tile 位置，展开卡片从 tile 原点弹出（局部实现；
      // 不复用路由级 appOpenTransition——其 origin 由 App.vue 的路由 watcher 消费，会与应用启动起点冲突。
      // origin 在父侧 nextTick 直接写卡片 style（rect 捕获与 origin 写入同处收口，
      // 不依赖子组件挂载时机；组件已拆分为单根，此写法继续保留）
      // 子组件实例的 props/mounted 链路不可靠，父侧 DOM 直设不依赖它）
      var rect = null;
      var tile = document.querySelector('[data-flip-key="page-folder-' + folderId + '"]');
      if (tile && tile.getBoundingClientRect) {
        try {
          var r = tile.getBoundingClientRect();
          if (r.width > 8 && r.height > 8) rect = { left: r.left, top: r.top, width: r.width, height: r.height };
        } catch (e) {}
      }
      this.$store.commit('desktop/SET_OPEN_FOLDER', folderId);
      if (rect) {
        this.$nextTick(function() {
          var card = document.querySelector('.folder-expanded-card');
          if (!card || !card.getBoundingClientRect) return;
          try {
            var cr = card.getBoundingClientRect();
            if (cr.width < 8 || cr.height < 8) return;
            var ox = ((rect.left + rect.width / 2) - cr.left) / cr.width * 100;
            var oy = ((rect.top + rect.height / 2) - cr.top) / cr.height * 100;
            // tile 理论上位于卡片附近，越界值夹取防异常元素（悬空 tile/隐藏态）
            ox = Math.max(-20, Math.min(120, ox));
            oy = Math.max(-20, Math.min(120, oy));
            card.style.transformOrigin = ox.toFixed(1) + '% ' + oy.toFixed(1) + '%';
          } catch (e) {}
        });
      }
      if (navigator.vibrate) navigator.vibrate(8);
    },
    closeFolder: function() {
      this.$store.commit('desktop/SET_OPEN_FOLDER', null);
      if (navigator.vibrate) navigator.vibrate(8);
    },
    onRenameFolder: function(payload) {
      this.$store.commit('desktop/RENAME_FOLDER', { folderId: payload.folder.id, name: payload.name });
      this.$store.dispatch('desktop/saveDesktopLayout');
    },
    onDeleteFolder: function(folderId) {
      this.$store.commit('desktop/DELETE_FOLDER', { folderId: folderId });
      this.$store.dispatch('desktop/saveDesktopLayout');
    },
    // ===== 桌面图标移除 =====
    onRemoveApp: function(pageIndex, index) {
      var self = this;
      var slot = this.pages[pageIndex].slots[index];
      if (!slot || slot.type !== 'app') return;
      var appName = slot.name;
      var label = (this.appMeta(appName) || {}).label || appName;
      this.$modal.confirm({
        title: '移除应用',
        message: '将"' + label + '"从桌面移除？可在设置中重置布局恢复。',
        confirmText: '移除',
        cancelText: '取消'
      }).then(function(result) {
        // 取消时不执行（confirm 的取消走 resolve(false)，不会进 catch）
        if (!result) return;
        self.$store.commit('desktop/REMOVE_APP', { type: 'page', pageIndex: pageIndex, index: index });
        self.$store.dispatch('desktop/saveDesktopLayout');
      }).catch(function() {});
    },
    // 从 Dock 移除应用（拖到 Dock 删除区或编辑态删除）
    onRemoveDockApp: function(index) {
      var self = this;
      var name = this.dockAppNames[index];
      if (!name) return;
      var label = (this.appMeta(name) || {}).label || name;
      this.$modal.confirm({
        title: '移除应用',
        message: '将"' + label + '"从 Dock 移除？可在设置中重置布局恢复。',
        confirmText: '移除',
        cancelText: '取消'
      }).then(function(result) {
        // 取消时不执行（confirm 的取消走 resolve(false)，不会进 catch）
        if (!result) return;
        self.$store.commit('desktop/REMOVE_APP', { type: 'dock', index: index });
        self.$store.dispatch('desktop/saveDesktopLayout');
      }).catch(function() {});
    },
    // ===== 页面管理 =====
    setCurrentPage: function(pageIndex) {
      this.$store.commit('desktop/SET_CURRENT_PAGE', pageIndex);
      if (navigator.vibrate) navigator.vibrate(8);  // 页码点跳页轻震（仅此路径；翻页手势路径各自已震）
    },
    // 因小组件占位被裁剪、当前不可见的图标数——编辑态溢出提示用
    hiddenIconsCount: function(pageIndex) {
      var page = this.pages[pageIndex];
      var view = this.pagesView[pageIndex];
      if (!page || !view) return 0;
      var visibleLen = view.slots.length;
      var slots = page.slots || [];
      var hidden = 0;
      for (var i = visibleLen; i < slots.length; i++) {
        if (slots[i]) hidden++;
      }
      return hidden;
    },
    // 大文件夹：某槽位是否被文件夹 tile 覆盖（覆盖格不渲染，index 与 store 对齐）
    isSlotCovered: function(pageIndex, index) {
      var pv = this.pagesView[pageIndex];
      return !!(pv && pv.covered && pv.covered[index]);
    },
    // 槽位附加样式：入场 stagger + 大文件夹跨格（grid span）
    slotExtraStyle: function(pageIndex, index, slot) {
      var style = { '--stagger': ((pageIndex === this.currentPage ? index : 6 * this.gridRows) * 22) + 'ms' };
      var pv = this.pagesView[pageIndex];
      if (slot && slot.type === 'folder' && pv && pv.spans && pv.spans[index]) {
        style.gridColumn = 'span ' + pv.spans[index].w;
        style.gridRow = 'span ' + pv.spans[index].h;
      }
      return style;
    },
    // 大文件夹渲染列表：跳过覆盖格，保留原始 index（拖放/源定位依赖它对齐 store）
    slotRenderList: function(pageIndex) {
      var pv = this.pagesView[pageIndex];
      if (!pv) return [];
      var out = [];
      for (var i = 0; i < pv.slots.length; i++) {
        if (pv.covered && pv.covered[i]) continue;
        out.push({ index: i, slot: pv.slots[i] });
      }
      return out;
    },
    // 大文件夹尺寸循环：校验覆盖格（空且不越界）→ RESIZE_FOLDER
    onResizeFolder: function(folderId, pageIndex, index) {
      var order = ['1x1', '2x2', '2x4'];
      var page = this.pages[pageIndex];
      var f = (this.$store.state.desktop.layout.folders || {})[folderId];
      if (!page || !f) return;
      var cur = order.indexOf(f.size || '1x1');
      var nextSize = order[(cur + 1) % order.length];
      var rows = this.gridRows;
      var w = nextSize === '2x4' ? 4 : 2;
      var c0 = index % 6;
      var r0 = Math.floor(index / 6);
      if (c0 + w > 6 || r0 + 2 > rows) {
        if (this.$store.state.toast) {
          this.$store.commit('toast/SHOW_TOAST', { message: '右侧 / 下方空间不足，无法放大', type: 'info' });
        }
        return;
      }
      for (var dr = 0; dr < 2; dr++) {
        for (var dc = 0; dc < w; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (page.slots[index + dr * 6 + dc]) {
            if (this.$store.state.toast) {
              this.$store.commit('toast/SHOW_TOAST', { message: '相邻位置已被图标占用，无法放大', type: 'info' });
            }
            return;
          }
        }
      }
      this.$store.commit('desktop/RESIZE_FOLDER', { folderId: folderId, pageIndex: pageIndex, index: index, nextSize: nextSize });
      this.$store.dispatch('desktop/saveDesktopLayout');
    },
    addPage: function() {
      this.$store.commit('desktop/ADD_PAGE');
      this.$store.dispatch('desktop/saveDesktopLayout');
    },
    // 删除当前桌面页（仅允许 > 1 页时删除）
    removePage: function() {
      var self = this;
      if (this.totalPages <= 1) {
        if (this.$store.state.toast) {
          this.$store.commit('toast/SHOW_TOAST', { message: '至少保留一个桌面', type: 'info' });
        }
        return;
      }
      this.$modal.confirm({
        title: '删除桌面页',
        message: '将删除第 ' + (this.currentPage + 1) + ' 页，页内图标会迁移到其他页面。确定继续吗？',
        confirmText: '删除',
        cancelText: '取消'
      }).then(function(result) {
        // 取消时不执行（confirm 的取消走 resolve(false)，不会进 catch）
        if (!result) return;
        self.$store.dispatch('desktop/removePage', self.currentPage);
      }).catch(function() {});
    },
    tidyCurrentPage: function() {
      this.$store.commit('desktop/TIDY_PAGE', this.currentPage);
      this.$store.dispatch('desktop/saveDesktopLayout');
    },
    resetLayout: function() {
      this.$store.dispatch('desktop/resetLayout', this.enabledApps || []);
      if (this.$store.state.toast) {
        this.$store.commit('toast/SHOW_TOAST', { message: '桌面布局已重置', type: 'success' });
      }
    },
    // ===== 设置面板 =====
    closeSettingsPanel: function() {
      this.$store.commit('desktop/SET_SETTINGS_PANEL', false);
    },
    onSettingsDone: function() {
      this.$store.commit('desktop/SET_SETTINGS_PANEL', false);
      this.$store.dispatch('desktop/exitEditMode');
      if (navigator.vibrate) navigator.vibrate(10);
    },
    // ===== 公告浮窗横滑关闭 =====
    // 跟手位移 + 快速甩出判定；仅隐藏不标已读（与右上角 × 的"全部已读"语义区分）
    onAnnounceTouchStart: function(e) {
      if (!e.touches || e.touches.length !== 1) { this._announceSwipe = null; return; }
      var t = e.touches[0];
      this._announceSwipe = {
        startX: t.clientX, startY: t.clientY,
        lastX: t.clientX, lastT: e.timeStamp || Date.now(),
        v: 0, active: false
      };
      this.announceSwipeX = 0;
    },
    onAnnounceTouchMove: function(e) {
      var s = this._announceSwipe;
      if (!s) return;
      var t = e.touches[0];
      var dx = t.clientX - s.startX;
      var dy = t.clientY - s.startY;
      if (!s.active) {
        // 横向意图确认后才接管（参数与跟手翻页一致）
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          s.active = true;
        } else {
          return;
        }
      }
      if (e.cancelable) e.preventDefault();
      this.announceSwipeX = dx;
      // 瞬时速度（供甩出判定），指数平滑
      var now = e.timeStamp || Date.now();
      var dt = now - s.lastT;
      if (dt > 0) {
        s.v = s.v * 0.6 + ((t.clientX - s.lastX) / dt) * 0.4;
      }
      s.lastX = t.clientX;
      s.lastT = now;
    },
    onAnnounceTouchEnd: function() {
      var s = this._announceSwipe;
      this._announceSwipe = null;
      if (!s || !s.active) { this.announceSwipeX = 0; return; }
      var dx = this.announceSwipeX;
      this.announceSwipeX = 0;
      if (Math.abs(dx) > 80 || Math.abs(s.v) > 0.5) {
        // 甩出：先补一段出场位移（移除 swiping 类恢复 transition 播放滑出），再收起为胶囊
        var self = this;
        this.announceSwipeX = dx >= 0 ? 420 : -420;
        setTimeout(function() {
          self.announceSwipeX = 0;
          self.minimizeAnnouncement();
        }, 180);
        if (navigator.vibrate) navigator.vibrate(10);
      }
    },
    // ===== PC 适配：右键菜单 / 滚轮翻页 / 键盘 =====

    // 右键：按目标分菜单——网格图标（打开/移除）与空白（编辑/整理/设置）
    // 触屏长按会由浏览器合成 contextmenu（安卓 Chrome ~500ms，手指仍按住时派发），
    // 此时长按手势同时已进入编辑态——双响叠车。判定以「触摸仍激活」为主信号
    // （合成事件必然发生在触摸序列内），250ms 时间窗只兜底少数抬起后才补发的机型；
    // 本菜单只服务鼠标右键（PC 适配）。
    onDesktopContextMenu: function(e) {
      if (this._touchActive) return;
      if (Date.now() - (this._lastTouchActivityAt || 0) < 250) return;
      var el = e.target;
      var items = [];
      var meta = { type: 'blank' };
      var icon = el && el.closest ? el.closest('.app-icon') : null;
      // 仅网格图标带 data-src-page/idx（文件夹展开层/其他 AppIcon 复用场景走空白菜单）
      if (icon && !this.isEditMode && icon.getAttribute('data-src-page') !== null) {
        var pageIndex = parseInt(icon.getAttribute('data-src-page'), 10);
        var index = parseInt(icon.getAttribute('data-src-idx'), 10);
        var slot = this.pages[pageIndex] && this.pages[pageIndex].slots[index];
        if (slot && slot.type === 'app') {
          var meta0 = this.appMeta(slot.name);
          if (meta0 && meta0.route) {
            meta = { type: 'icon', app: meta0, el: icon, pageIndex: pageIndex, index: index };
            items = [
              { icon: 'fa-solid fa-arrow-up-right-from-square', label: '打开' },
              { icon: 'fa-solid fa-minus', label: '从桌面移除', danger: true }
            ];
          }
        }
      }
      // 文件夹 tile：打开 / 调整大小（大文件夹循环）/ 解散
      var tile = el && el.closest ? el.closest('.desktop-folder-tile') : null;
      if (!items.length && tile && tile.getAttribute('data-src-app') !== null) {
        var fid = tile.getAttribute('data-src-app');
        var fPage = parseInt(tile.getAttribute('data-src-page'), 10);
        var fIdx = parseInt(tile.getAttribute('data-src-idx'), 10);
        if (fid) {
          meta = { type: 'folder-tile', folderId: fid, pageIndex: fPage, index: fIdx };
          items = [
            { icon: 'fa-solid fa-folder-open', label: '打开' },
            { icon: 'fa-solid fa-up-right-and-down-left-from-center', label: '调整大小' },
            { icon: 'fa-solid fa-trash', label: '解散文件夹', danger: true }
          ];
        }
      }
      if (!items.length) {
        items = this.isEditMode ? [
          { icon: 'fa-solid fa-check', label: '退出编辑模式' },
          { icon: 'fa-solid fa-broom', label: '整理当前页' },
          { icon: 'fa-solid fa-gear', label: '桌面设置' }
        ] : [
          { icon: 'fa-solid fa-pen-to-square', label: '编辑模式' },
          { icon: 'fa-solid fa-broom', label: '整理当前页' },
          { icon: 'fa-solid fa-gear', label: '桌面设置' }
        ];
      }
      this.ctxMenu = { visible: true, x: e.clientX, y: e.clientY, items: items, meta: meta };
    },
    onCtxSelect: function(i) {
      var meta = this.ctxMenu.meta;
      this.closeCtxMenu();
      if (meta.type === 'icon') {
        if (i === 0) {
          this.launchApp(meta.app, meta.el);
        } else if (i === 1) {
          this.onRemoveApp(meta.pageIndex, meta.index);
        }
        return;
      }
      if (meta.type === 'pager') {
        // 页点菜单：整理当前页 / 删除当前页
        if (i === 0) this.tidyCurrentPage();
        else if (i === 1) this.removePage();
        return;
      }
      if (meta.type === 'folder-tile') {
        // 文件夹 tile 菜单：打开 / 调整大小 / 解散
        if (i === 0) this.openFolder(meta.folderId);
        else if (i === 1) this.onResizeFolder(meta.folderId, meta.pageIndex, meta.index);
        else if (i === 2) this.onDeleteFolder(meta.folderId);
        return;
      }
      if (i === 0) {
        if (this.$store.getters['desktop/isEditMode']) {
          this.$store.dispatch('desktop/exitEditMode');
          if (navigator.vibrate) navigator.vibrate(10);
        } else {
          this.$store.dispatch('desktop/enterEditMode');
          if (navigator.vibrate) navigator.vibrate(15);
        }
      } else if (i === 1) {
        this.tidyCurrentPage();
      } else if (i === 2) {
        // 桌面设置面板的 PC 唯一入口（触屏为双指捏合）
        this.$store.commit('desktop/SET_SETTINGS_PANEL', true);
      }
    },
    // 页点右键：页面管理（对齐 iPadOS 长按页点）
    onPageMenu: function(e) {
      this.ctxMenu = {
        visible: true,
        x: e.clientX,
        y: e.clientY,
        items: [
          { icon: 'fa-solid fa-broom', label: '整理当前页' },
          { icon: 'fa-solid fa-minus', label: '删除当前页', danger: true }
        ],
        meta: { type: 'pager' }
      };
    },
    closeCtxMenu: function() {
      if (this.ctxMenu.visible) this.ctxMenu.visible = false;
    },

    // 滚轮翻页：累积 delta 过阈值翻一页（widget 无内部滚动区，dock 横滚区与浮层排除）
    onDesktopWheel: function(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('.dock-bar, .desktop-widget, .desktop-settings-overlay, .folder-expanded-overlay, .announcement-float, .widget-config-mask, .desktop-ctx-menu')) return;
      if (!this.isGridLayout) return;
      if (this.$store.state.desktop.openFolderId || this.$store.state.desktop.settingsPanelOpen) return;
      var total = this.$store.getters['desktop/totalPages'];
      if (total < 2) return;
      var now = Date.now();
      if (now - (this._wheelFlipAt || 0) < 350) { this._wheelAcc = 0; return; }  // 冷却防连翻
      var dy = e.deltaY;
      if (e.deltaMode === 1) dy = dy * 16;  // 行模式归一为像素
      this._wheelAcc = (this._wheelAcc || 0) + dy;
      if (Math.abs(this._wheelAcc) < 80) return;
      var dir = this._wheelAcc > 0 ? 1 : -1;  // 下滚 → 下一页
      this._wheelAcc = 0;
      this._wheelFlipAt = now;
      var target = this.$store.state.desktop.currentPage + dir;
      if (target < 0 || target > total - 1) return;
      this.$store.commit('desktop/SET_CURRENT_PAGE', target);
    },

    // 键盘：←/→ 翻页；Esc 按层级收（右键菜单 > 设置面板 > 编辑态）
    _onPcKeyDown: function(e) {
      var t = e.target;
      var tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (e.key === 'Escape') {
        if (this.ctxMenu.visible) { this.closeCtxMenu(); return; }
        if (this.$store.state.desktop.settingsPanelOpen) {
          this.$store.commit('desktop/SET_SETTINGS_PANEL', false);
          return;
        }
        if (this.$store.getters['desktop/isEditMode']) {
          this.$store.dispatch('desktop/exitEditMode');
          if (navigator.vibrate) navigator.vibrate(10);
        }
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (this.ctxMenu.visible) return;
      if (this.$store.state.desktop.openFolderId || this.$store.state.desktop.settingsPanelOpen) return;
      if (this.$store.getters['desktop/isDragging']) return;
      if (!this.isGridLayout) return;
      var total = this.$store.getters['desktop/totalPages'];
      var target = this.$store.state.desktop.currentPage + (e.key === 'ArrowRight' ? 1 : -1);
      if (target < 0 || target > total - 1) return;
      e.preventDefault();
      this.$store.commit('desktop/SET_CURRENT_PAGE', target);
    },

    // ===== 启动应用 =====
    // sourceEl：被点击的图标元素（AppIcon 根 / dock 项），供容器变换过渡捕获起点
    launchApp: function(app, sourceEl) {
      var self = this;
      if (!app) return;
      if (app.name === 'settings') {
        self.markVersionSeen();
      }
      if (sourceEl) {
        appOpenTransition.captureOrigin(sourceEl);
      }
      // 打开动画关闭（性能救急）：立即导航，跳过图标脉冲的 250ms 等待
      if (!appOpenTransition.enabled()) {
        if (self._launchTimer) {
          clearTimeout(self._launchTimer);
          self._launchTimer = null;
        }
        self.launchingApp = '';
        self.$router.push(app.route).catch(function() {});
        return;
      }
      self.launchingApp = app.name;
      // 重入保护：250ms 延迟内连点其他图标时以最后一次为准，旧计时作废
      if (self._launchTimer) {
        clearTimeout(self._launchTimer);
      }
      self._launchTimer = setTimeout(function() {
        self._launchTimer = null;
        self.launchingApp = '';
        self.$router.push(app.route).catch(function() {});
      }, 250);
    },
    // Dock 图标点击：编辑态下不启动应用（与 AppIcon 一致），仅非编辑态启动
    onDockClick: function(e, name) {
      if (this.isEditMode) return;
      var iconEl = e && e.currentTarget;
      this.launchApp(this.dockAppMeta(name), iconEl);
    },
    launchAppByName: function(name, sourceEl) {
      var meta = this.appMeta(name);
      if (meta) {
        this.closeFolder();
        this.launchApp(meta, sourceEl);
      }
    },
    playVideoWallpaper: function() {
      var self = this;
      var video = self.$refs.videoA;
      if (!video) return;
      self.activeVideo = 'A';
      self.applyPerformanceOptimizations();
      video.play().catch(function() {
        video.addEventListener('canplay', function onCanPlay() {
          video.removeEventListener('canplay', onCanPlay);
          video.play().catch(function() {});
        });
      });
    },
    loadUnreadAnnouncements: function() {
      var self = this;
      api.get('/assets/announcements').then(function(response) {
        var announcements = response.data.data || [];
        // 统一走 utils/read-state：原先这里自己 try/catch 读 localStorage，
        // 与公告中心的写入不同源，容易出现「一边写一边读不到」。
        self.unreadAnnouncements = readState.filterUnread('announcement', announcements, 'id');
        if (self.unreadAnnouncements.length > 0) {
          self.currentAnnouncementIndex = 0;
          self.showAnnouncementFloat = true;
          self.startAnnouncementRotate();
          self.startAnnouncementMinimize();
        } else {
          self.showAnnouncementFloat = false;
          self.announcementMinimized = false;
          self.stopAnnouncementRotate();
          self.stopAnnouncementMinimize();
        }
      }).catch(function() {
        self.unreadAnnouncements = [];
      });
    },
    // 判断应用是否对当前用户可见（结合应用管控 + 角色过滤）
    // 0. 注册表过滤：不在 APP_REGISTRY 中的应用（如 hidden category 的 integration）一律不显示
    // 1. 角色过滤：visibleRoles 声明的应用仅对指定角色显示（如 admin 仅管理员/班干可见）
    // 2. 应用管控：enabledApps 加载后过滤禁用的应用
    // 实现：直接命中预计算查找表 visibleAppMap（O(1)），语义与原先的三段判定完全一致——
    // 不在表内（含未注册 / 角色不符 / 被管控禁用）即返回 false。
    isVisibleForUser: function(name) {
      return this.visibleAppMap[name] === true;
    },
    // 判断应用是否启用（兼容旧调用，实际委托给 isVisibleForUser）
    isAppEnabled: function(name) {
      return this.isVisibleForUser(name);
    },
    // 加载后端应用管控状态，过滤桌面禁用的应用
    // force=true 时强制重新拉取（回到前台/窗口聚焦的兜底刷新）；
    // 否则复用 router 侧缓存，与路由守卫共享同一次 /system/app-control 请求
    // （原先守卫 / App.vue / 桌面三方各裸拉一次 → 冷启动同一接口打三遍）。
    loadEnabledApps: function(force) {
      var self = this;
      var loader = (self.$router && self.$router.getAppControl)
        ? self.$router.getAppControl({ force: !!force })
        : api.get('/system/app-control').then(function(response) {
            return (response.data && response.data.data) || {};
          });
      loader.then(function(data) {
        var apps = (data && data.enabled_apps) || [];
        self.enabledApps = apps;
        // 同步到 store（供 DesktopFolderExpanded 等组件通过 getter 读取）
        self.$store.commit('desktop/SET_ENABLED_APPS', apps);
        // 加载桌面布局：传入当前用户可见的应用列表，避免 admin 等角色限定应用占用普通用户桌面槽位
        var visibleApps = apps.filter(function(name) { return self.isVisibleForUser(name); });
        self.$store.dispatch('desktop/loadDesktopLayout', visibleApps);
        // 同步清除 router 的应用管控缓存，保证 URL 直接访问也用最新状态
        if (self.$router && self.$router.clearAppControlCache) {
          self.$router.clearAppControlCache();
        }
      }).catch(function() {
        // 降级：全部启用（过滤掉当前用户不可见的应用用于布局生成）
        var allApps = self.dockApps.map(function(app) { return app.name; });
        self.enabledApps = allApps;
        self.$store.commit('desktop/SET_ENABLED_APPS', allApps);
        var visibleFallback = allApps.filter(function(name) { return self.isVisibleForUser(name); });
        self.$store.dispatch('desktop/loadDesktopLayout', visibleFallback);
        if (self.$router && self.$router.clearAppControlCache) {
          self.$router.clearAppControlCache();
        }
      });
    },
    checkVersionUpdate: function() {
      var self = this;
      if (updateChecker.isUpdateAvailable()) {
        var info = updateChecker.getCurrentVersionInfo();
        if (info) {
          var storedVersion = localStorage.getItem('classintra_seen_version') || '0.0.0';
          if (updateChecker.compareVersions(info.version, storedVersion) > 0) {
            self.newVersionAvailable = true;
            self.latestVersion = info.version;
          }
        }
      }
      self._updateUnsubscribe = updateChecker.onUpdateAvailable(function(event, info) {
        if (info && info.serverVersion) {
          var storedVer = localStorage.getItem('classintra_seen_version') || '0.0.0';
          if (updateChecker.compareVersions(info.serverVersion, storedVer) > 0) {
            self.newVersionAvailable = true;
            self.latestVersion = info.serverVersion;
          }
        }
      });
    },
    markVersionSeen: function() {
      if (this.newVersionAvailable && this.latestVersion) {
        localStorage.setItem('classintra_seen_version', this.latestVersion);
        this.newVersionAvailable = false;
        this.latestVersion = '';
      }
    },

    // ============ 生日庆祝 ============
    checkBirthday: function() {
      var self = this;
      try {
        var user = self.$store.state.auth.user;
        if (!user || !user.info || !user.info.birthday) return;
        var birthday = user.info.birthday; // 格式: YYYY-MM-DD
        var today = new Date();
        var todayStr = (today.getMonth() + 1) + '-' + today.getDate();
        // 从生日中提取月-日
        var parts = birthday.split('-');
        if (parts.length < 3) return;
        var birthMD = parts[1] + '-' + parts[2];
        if (birthMD !== todayStr) return;
        // 检查今天是否已庆祝过
        var celebrated = localStorage.getItem('classintra_birthday_celebrated');
        var todayFull = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
        if (celebrated === todayFull) return;
        // 触发庆祝
        self.birthdayUserName = user.net_name || user.real_name || '';
        self.showBirthdayCelebration = true;
      } catch (e) {}
    },

    dismissBirthdayCelebration: function() {
      var self = this;
      self.showBirthdayCelebration = false;
      var today = new Date();
      var todayFull = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
      localStorage.setItem('classintra_birthday_celebrated', todayFull);
      // 显示生日祝福 Toast
      self.$store.commit('toast/SHOW_TOAST', {
        message: '今天是你的生日，祝你生日快乐！',
        type: 'success',
        duration: 4000
      });
    },

    // 公告浮窗自动轮播：多条未读时每 8s 推进一条（后台标签页跳过），列表清空自动停
    startAnnouncementRotate: function() {
      var self = this;
      self.stopAnnouncementRotate();
      if (!self.unreadAnnouncements || self.unreadAnnouncements.length < 2) return;
      self._announceTimer = setInterval(function() {
        if (document.hidden) return;
        if (!self.showAnnouncementFloat || self.unreadAnnouncements.length < 2) {
          self.stopAnnouncementRotate();
          return;
        }
        self.currentAnnouncementIndex = (self.currentAnnouncementIndex + 1) % self.unreadAnnouncements.length;
      }, 8000);
    },
    stopAnnouncementRotate: function() {
      if (this._announceTimer) {
        clearInterval(this._announceTimer);
        this._announceTimer = null;
      }
    },

    // 公告浮窗 30s 自动收起为右上角胶囊（iPadOS 横幅语义：不打扰但保留入口，不标已读）
    startAnnouncementMinimize: function() {
      var self = this;
      self.stopAnnouncementMinimize();
      self._announceMinimizeTimer = setTimeout(function() {
        self._announceMinimizeTimer = null;
        if (self.showAnnouncementFloat && self.unreadAnnouncements.length > 0) {
          self.minimizeAnnouncement();
        }
      }, 30000);
    },
    stopAnnouncementMinimize: function() {
      if (this._announceMinimizeTimer) {
        clearTimeout(this._announceMinimizeTimer);
        this._announceMinimizeTimer = null;
      }
    },
    minimizeAnnouncement: function() {
      this.showAnnouncementFloat = false;
      this.announcementMinimized = true;
      this.stopAnnouncementRotate();
      this.stopAnnouncementMinimize();
    },
    // 点胶囊重开：未读列表未动，轮播与 30s 收起计时重新开始
    reopenAnnouncement: function() {
      this.announcementMinimized = false;
      this.showAnnouncementFloat = true;
      this.startAnnouncementRotate();
      this.startAnnouncementMinimize();
    },

    dismissAnnouncement: function() {
      var self = this;
      var current = self.currentAnnouncement;
      if (!current) return;
      readState.markRead('announcement', current.id);
      self.unreadAnnouncements.splice(self.currentAnnouncementIndex, 1);
      if (self.unreadAnnouncements.length === 0) {
        self.showAnnouncementFloat = false;
        self.announcementMinimized = false;
        self.currentAnnouncementIndex = 0;
        self.stopAnnouncementMinimize();
      } else if (self.currentAnnouncementIndex >= self.unreadAnnouncements.length) {
        self.currentAnnouncementIndex = self.unreadAnnouncements.length - 1;
      }
      // 通知其他页面（公告中心可能正开着）已读状态变了
      self.$store.commit('island/READ_STATE_CHANGED');
    },
    dismissAllAnnouncements: function() {
      var self = this;
      var ids = [];
      for (var i = 0; i < self.unreadAnnouncements.length; i++) {
        if (self.unreadAnnouncements[i] && self.unreadAnnouncements[i].id !== undefined) {
          ids.push(self.unreadAnnouncements[i].id);
        }
      }
      readState.markManyRead('announcement', ids);
      self.unreadAnnouncements = [];
      self.showAnnouncementFloat = false;
      self.announcementMinimized = false;
      self.currentAnnouncementIndex = 0;
      self.stopAnnouncementMinimize();
      self.$store.commit('island/READ_STATE_CHANGED');
    },
    goToAnnouncements: function() {
      var self = this;
      self.showAnnouncementFloat = false;
      self.$router.push('/announcements').catch(function() {});
    },
    // 浮窗只显示 100 字摘要，点「查看详情」/点正文 → 弹窗看完整公告。
    // 不在这里标已读：用户看完再决定，避免「点开就消失」。
    openAnnouncementDetail: function(item) {
      var self = this;
      if (!item) return;
      var meta = item.author_name || '管理员';
      if (item.created_at) {
        var d = new Date(item.created_at);
        if (!isNaN(d.getTime())) {
          meta += ' · ' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
        }
      }
      self.$modal.alert({
        title: item.title || '公告',
        message: (item.content || '') + '\n\n—— ' + meta,
        wide: true,
        confirmText: '知道了'
      });
    }
  }
};
</script>

<style scoped>
.desktop {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: #000;
  /* 横向手势全部归 JS（跟手翻页），浏览器仅保留纵向滚动（小组件内列表）；
     同时关闭横向 overscroll，防止浏览器把右滑误当历史返回 */
  touch-action: pan-y;
  overscroll-behavior-x: none;
}

/* 图标尺寸三档（桌面设置→桌面外观）：属性选择器特异性高于 AppIcon 小屏媒体查询 */
.desktop[data-icon-size="small"] { --app-icon-size: 52px; }
.desktop[data-icon-size="large"] { --app-icon-size: 68px; }

/* 入场编排：桌面挂载/返回时图标按序弹入（.desktop-enter 由 mounted 置位） */
.desktop-enter .desktop-slot {
  animation: slotIn var(--duration-normal) var(--ease-spring) both;
  animation-delay: var(--stagger, 0ms);
}
@keyframes slotIn {
  0% { opacity: 0; transform: scale(0.86) translateY(6px); }
  100% { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .desktop-enter .desktop-slot { animation: none; }
}
[data-no-motion="true"] .desktop-enter .desktop-slot { animation: none; }

.desktop-video-wallpaper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  -o-object-fit: cover;
  object-fit: cover;
  z-index: 0;
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
  will-change: transform, opacity;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  opacity: 0;
  transition: opacity 0.8s var(--ease-standard), -webkit-filter var(--duration-normal) var(--ease-standard), filter var(--duration-normal) var(--ease-standard);
}

.desktop-video-wallpaper.video-active {
  opacity: 1;
}

.desktop-static-wallpaper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  transition: -webkit-filter var(--duration-normal) var(--ease-standard), filter var(--duration-normal) var(--ease-standard);
}

/* ===== 多页面容器 ===== */
/* bottom 需大于指示器顶边（124px+20px=144px）+ dock 顶部（124px），留充足间隙 → 170px */
.desktop-pages {
  position: absolute;
  top: 60px;
  left: 0;
  right: 0;
  bottom: 170px;
  display: -webkit-flex;
  display: flex;
  z-index: 1;
  transition: transform var(--duration-normal) var(--ease-decelerate);
  will-change: transform;
}

/* 跟手翻页进行中：关掉过渡（位移由手势实时驱动），松手移除标记后恢复 transition 完成翻页/回弹。
   2026-11-02：标记改挂 <html data-paging>（手势 mixin 直写），不再走 Vue class 绑定——
   逐帧的响应式更新会让整个桌面组件重渲染。 */
[data-paging="1"] .desktop-pages {
  transition: none;
}

.desktop-page {
  position: relative;
  min-width: 100%;
  -webkit-flex: 0 0 100%;
  flex: 0 0 100%;
  display: -webkit-flex;
  display: flex;
  -webkit-flex-direction: column;
  flex-direction: column;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  padding: 0 32px;
}

/* 编辑态：小组件占位溢出提示（浮在页面顶部，不挡拖拽落点判定） */
.desktop-page-overflow-tip {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  padding: 6px 14px;
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  pointer-events: none;
  white-space: nowrap;
}
.desktop-page-overflow-tip i {
  margin-right: 6px;
  color: var(--warning-color, #FF9F0A);
}

/* ===== 小组件区域 ===== */
.desktop-widgets {
  width: 100%;
  max-width: 760px;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-auto-rows: 80px;
  grid-gap: 12px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.desktop-widget {
  position: relative;
  min-height: 0;
  border-radius: var(--radius-2xl);
  overflow: hidden;
  transition: transform var(--duration-fast) var(--ease-standard);
  /* 兜底背景，避免 widget 内部组件未设背景时与壁纸融合看不清 */
  background: var(--card-bg, rgba(255, 255, 255, 0.7));
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.08));
}
.desktop-widget.widget-editing {
  /* 与图标 wiggle 统一节奏（±2deg alternate）——原 ±0.5deg 对称循环与图标三重不一致 */
  animation: widgetWiggle var(--duration-normal) var(--ease-standard) infinite alternate;
  outline: 2px dashed rgba(var(--primary-rgb), 0.5);
  outline-offset: -2px;
}
/* 触屏无 hover 概念：sticky hover 会让点过的 widget 悬停在高处不落回，仅精确指针生效 */
@media (hover: hover) and (pointer: fine) {
  .desktop-widget.widget-editing:hover {
    transform: scale(1.02);
  }
}
@keyframes widgetWiggle {
  0% { transform: rotate(-2deg); }
  100% { transform: rotate(2deg); }
}
/* widget 编辑态控制按钮：iPadOS 摇晃编辑态的统一玻璃圆钮——
   除「移除」外一律中性深玻璃，hover 只提亮不改色相，消除四种颜色的混搭感 */
.widget-remove-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(28, 28, 30, 0.68);
  color: #fff;
  border: none;
  font-size: 12px;
  cursor: pointer;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  z-index: 10;
  transition: transform var(--duration-fast) var(--ease-standard);
  /* 编辑态进入时随 wiggle 一起弹入（keyframe 在 global.scss） */
  animation: ctrlPopIn var(--duration-normal) var(--ease-spring);
}
@media (hover: hover) and (pointer: fine) {
  .widget-remove-btn:hover { transform: scale(1.15); background: var(--danger-color); }
}
.widget-remove-btn:active { transform: scale(0.9); }

/* widget 编辑态控制按钮（resize/config/refresh） */
.widget-ctrl-btn {
  position: absolute;
  bottom: 6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(28, 28, 30, 0.68);
  color: #fff;
  border: none;
  font-size: 11px;
  cursor: pointer;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  z-index: 10;
  transition: transform var(--duration-fast) var(--ease-standard),
              background var(--duration-fast) var(--ease-standard);
  /* 编辑态进入时随 wiggle 一起弹入（keyframe 在 global.scss） */
  animation: ctrlPopIn var(--duration-normal) var(--ease-spring);
}
@media (hover: hover) and (pointer: fine) {
  .widget-ctrl-btn:hover { transform: scale(1.15); }
}
.widget-ctrl-btn:active { transform: scale(0.9); }
.widget-resize-minus { right: 6px; }
.widget-resize-plus { right: 32px; }
.widget-config-btn { right: 58px; }
.widget-refresh-btn { right: 84px; }
/* 中性按钮统一 hover：提亮而不是换色相（触屏 sticky hover 防残留，仅精确指针生效） */
@media (hover: hover) and (pointer: fine) {
  .widget-resize-minus:hover,
  .widget-resize-plus:hover,
  .widget-config-btn:hover,
  .widget-refresh-btn:hover { background: rgba(80, 80, 84, 0.85); }
}

/* ===== 4×6 网格（widget + app icon 共用） ===== */
.desktop-grid {
  width: 100%;
  max-width: 760px;
  -webkit-flex: 1;
  flex: 1;
  min-height: 0;
  max-height: 440px;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-template-rows: repeat(4, 1fr);
  /* dense 模式：app icon 自动填充 widget 旁边的空位，实现环绕分布 */
  grid-auto-flow: row dense;
  grid-gap: 12px;
}

/* 横屏平板（≥900px 宽）：网格放宽填满横向空间，行距同步放大 */
@media (min-width: 900px) and (orientation: landscape) {
  .desktop-grid {
    max-width: 940px;
    grid-gap: 16px;
    max-height: 480px;
  }
}

.desktop-slot {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  position: relative;
  border-radius: var(--radius-lg);
  transition: background var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard);
}

/* 落点高亮 */
.slot--drop-target {
  background: rgba(255, 255, 255, 0.22);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.55);
}

/* 编辑态：壁纸轻微变暗+模糊，突出图标层（类似 iOS 编辑态） */
.desktop--editing .desktop-video-wallpaper,
.desktop--editing .desktop-static-wallpaper {
  -webkit-filter: brightness(0.6) blur(4px);
  filter: brightness(0.6) blur(4px);
}

/* 文件夹展开：底层整体磨砂——全部走直接 filter（不依赖 backdrop-filter：
   视频合成层采样在 Chrome80/X5 不可靠），与编辑态同机制 */
.desktop--folder-open .desktop-video-wallpaper,
.desktop--folder-open .desktop-static-wallpaper {
  -webkit-filter: brightness(0.8) blur(14px);
  filter: brightness(0.8) blur(14px);
}
.desktop--folder-open .desktop-pages,
.desktop--folder-open .dock-bar,
.desktop--folder-open .page-indicator,
.desktop--folder-open .announcement-float,
.desktop--folder-open .announcement-minimized {
  -webkit-filter: blur(12px) brightness(0.85);
  filter: blur(12px) brightness(0.85);
}

/* 编辑态空槽位虚线提示 */
.desktop--editing .slot--empty::after {
  content: '';
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md);
  border: 1px dashed rgba(255, 255, 255, 0.25);
}

.desktop--editing .desktop-slot {
  cursor: grab;
}
.desktop--dragging {
  cursor: grabbing;
}

/* ===== Dock 栏 ===== */
/* 可滚动容器：图标少时 max-content + margin auto 居中；多时 max-width 限制 + overflow-x 滚动 */
.dock-bar {
  position: fixed;
  bottom: 12px;
  left: 16px;
  right: 16px;
  width: -webkit-max-content;
  width: max-content;
  max-width: calc(100vw - 32px);
  margin: 0 auto;
  z-index: 999;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: flex-start;
  justify-content: flex-start;
  padding: 14px 28px;
  background: var(--dock-bg);
  -webkit-backdrop-filter: var(--glass-blur-container);
  backdrop-filter: var(--glass-blur-container);
  border-radius: var(--radius-2xl);
  border: none;
  -webkit-box-shadow: var(--shadow-lg);
  box-shadow: var(--shadow-lg);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  transition: background var(--duration-normal) var(--ease-standard), box-shadow var(--duration-normal) var(--ease-standard);
}
/* Chrome/Safari/Edge 隐藏滚动条 */
.dock-bar::-webkit-scrollbar {  display: none;
}

/* Dock 空状态提示 */
.dock-empty-hint {
  color: var(--text-secondary, rgba(60, 60, 67, 0.6));
  font-size: var(--font-size-sm);
  padding: 8px 16px;
  white-space: nowrap;
}

.dock-bar--editing {
  /* 编辑态视觉区分：阴影微调（wiggle 已移到 dock-slot，避免容器 overflow+rotate 冲突） */
  -webkit-box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.08);
}

/* 空 Dock 隐藏（非编辑态不显示；编辑态显示占位供拖入） */
.dock-bar--hidden {
  display: none !important;
}

/* 空 Dock 占位提示（编辑态显示，虚线框引导拖入） */
.dock-bar--empty {
  padding: 18px 32px;
  border: 2px dashed rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.08);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  color: rgba(255, 255, 255, 0.85);
}

/* 编辑态：Dock 图标单独 wiggle（与 AppIcon 统一），禁用 hover 缩放避免与 wiggle 冲突 */
.desktop--editing .dock-slot {
  -webkit-animation: dockSlotWiggle var(--duration-normal) var(--ease-standard) infinite alternate;
  animation: dockSlotWiggle var(--duration-normal) var(--ease-standard) infinite alternate;
  will-change: transform;
}
.desktop--editing .dock-slot:hover {
  -webkit-transform: none;
  transform: none;
}
/* 编辑态按压反馈：wiggle 占用根元素 transform，:active 缩放下移到 .dock-icon 子元素 */
.desktop--editing .dock-slot:active .dock-icon {
  -webkit-transform: scale(0.94);
  transform: scale(0.94);
}
@-webkit-keyframes dockSlotWiggle {
  0% { -webkit-transform: rotate(-2deg); }
  100% { -webkit-transform: rotate(2deg); }
}
@keyframes dockSlotWiggle {
  0% { transform: rotate(-2deg); }
  100% { transform: rotate(2deg); }
}

.dock-slot {
  display: -webkit-flex;
  display: flex;
  -webkit-flex-direction: column;
  flex-direction: column;
  -webkit-align-items: center;
  align-items: center;
  cursor: pointer;
  position: relative;
  margin: 0 9px;
  -webkit-transition: -webkit-transform var(--duration-normal) var(--ease-spring);
  transition: transform var(--duration-normal) var(--ease-spring);
  border-radius: var(--radius-xl);
}

/* 触屏无 hover：sticky hover 残留会让图标点完悬停在高处不落回（iPadOS 仅精确指针有 hover） */
@media (hover: hover) and (pointer: fine) {
  .dock-slot:hover {
    -webkit-transform: scale(1.15) translateY(-6px);
    transform: scale(1.15) translateY(-6px);
  }
}

.dock-slot:active {
  -webkit-transform: scale(0.94) translateY(0);
  transform: scale(0.94) translateY(0);
  transition-duration: 0.12s;
}

/* transition-group：Dock 图标进出动画（自动扩展/缩减） */
.dock-slot-move {
  -webkit-transition: -webkit-transform var(--duration-normal) var(--ease-spring);
  transition: transform var(--duration-normal) var(--ease-spring);
}

.dock-slot-enter-active {
  -webkit-transition: opacity var(--duration-normal) var(--ease-standard), -webkit-transform var(--duration-normal) var(--ease-spring);
  transition: opacity var(--duration-normal) var(--ease-standard), transform var(--duration-normal) var(--ease-spring);
}

.dock-slot-leave-active {
  -webkit-transition: opacity var(--duration-normal) var(--ease-accelerate), -webkit-transform var(--duration-normal) var(--ease-accelerate);
  transition: opacity var(--duration-normal) var(--ease-accelerate), transform var(--duration-normal) var(--ease-accelerate);
  position: absolute;
}

.dock-slot-enter {
  opacity: 0;
  -webkit-transform: scale(0.4);
  transform: scale(0.4);
}

.dock-slot-leave-to {
  opacity: 0;
  -webkit-transform: scale(0.4);
  transform: scale(0.4);
}

.dock-slot.dock-slot--launching {
  -webkit-animation: dockLaunch var(--duration-normal) var(--ease-emphasized) forwards;
  animation: dockLaunch var(--duration-normal) var(--ease-emphasized) forwards;
}

@-webkit-keyframes dockLaunch {
  0% { -webkit-transform: scale(1); }
  35% { -webkit-transform: scale(1.25) translateY(-10px); }
  100% { -webkit-transform: scale(0.7) translateY(0); opacity: 0.4; }
}
@keyframes dockLaunch {
  0% { transform: scale(1); }
  35% { transform: scale(1.25) translateY(-10px); }
  100% { transform: scale(0.7) translateY(0); opacity: 0.4; }
}

@media (min-width: 900px) and (orientation: landscape) {
  .dock-bar {
    padding: 15px 30px;
    bottom: 14px;
  }
  .dock-icon {
    width: 66px;
    height: 66px;
  }
}

/* dock-only 满载自适应：图标随数量收缩（many >8 / huge >12，后者叠加时靠后声明覆盖），
   免去横向滚动；类选择器特异性高于上方媒体查询的 .dock-icon */
.dock-bar--many .dock-icon {
  width: 52px;
  height: 52px;
}
.dock-bar--many .dock-slot {
  margin: 0 7px;
}
.dock-bar--many .dock-badge {
  top: -3px;
  right: -3px;
  min-width: 17px;
  height: 17px;
  line-height: 17px;
  font-size: 10px;
}
.dock-bar--huge .dock-icon {
  width: 46px;
  height: 46px;
}
.dock-bar--huge .dock-slot {
  margin: 0 6px;
}

.dock-icon {
  width: 60px;
  height: 60px;
  border-radius: var(--radius-lg);
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  overflow: hidden;
  /* 编辑态按压反馈作用于此子元素（wiggle 占用根元素 transform），过渡供按压缩放使用 */
  transition: transform var(--duration-fast) var(--ease-standard);
}

.dock-icon img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

/* Dock 编辑态删除徽章（与 AppIcon 删除徽章同语言） */
.dock-remove-btn {
  position: absolute;
  top: -6px;
  left: -6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(28, 28, 30, 0.68);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  z-index: 2;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  -webkit-tap-highlight-color: transparent;
  /* 编辑态进入时随 wiggle 一起弹入（keyframe 在 global.scss） */
  animation: ctrlPopIn var(--duration-normal) var(--ease-spring);
}

.dock-remove-btn:active {
  transform: scale(0.9);
}

.dock-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--danger-color);
  border-radius: var(--radius-pill);
  padding: 0 5px;
  -webkit-box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  border: 2px solid var(--dock-bg);
}

.dock-badge-dot {
  min-width: 10px;
  width: 10px;
  height: 10px;
  padding: 0;
  border-radius: 50%;
  line-height: 0;
  font-size: 0;
  top: -3px;
  right: -3px;
}

/* 注：拖拽 ghost 样式已迁移到 global.scss（ghost 被 append 到 document.body，scoped 样式不生效） */

/* ===== 小屏适配 ===== */
/* 小屏 dock 顶部约 84px + 指示器 92~112px，留充足间隙 → 130px */
@media (max-height: 400px), (max-width: 520px) {
  .desktop-pages {
    top: 50px;
    bottom: 130px;
  }
  .desktop-grid {
    grid-gap: 8px;
    max-height: 360px;
  }
  /* 小屏 widget 区域：减小行高和间距，避免占用过多空间 */
  .desktop-widgets {
    grid-auto-rows: 70px;
    grid-gap: 8px;
    margin-bottom: 8px;
  }
  .desktop-widget {
    min-height: 0;
    border-radius: var(--radius-xl);
  }
  .dock-bar {
    bottom: 8px;
    left: 8px;
    right: 8px;
    max-width: calc(100vw - 16px);
    padding: 8px 16px;
    border-radius: var(--radius-lg);
  }
  .dock-slot {
    margin: 0 6px;
  }
  .dock-icon {
    width: 52px;
    height: 52px;
    border-radius: var(--radius-md);
  }
  .dock-badge {
    min-width: 18px;
    height: 18px;
    line-height: 18px;
    font-size: 10px;
    top: -3px;
    right: -3px;
    padding: 0 4px;
    border-width: 2px;
  }
}

/* ===== 横屏适配：避免 widget + grid 高度溢出 ===== */
/* 横屏 dock 顶部约 84px + 指示器 92~112px，留充足间隙 → 130px */
@media (orientation: landscape) and (max-height: 600px) {
  .desktop-pages {
    top: 50px;
    bottom: 130px;
  }
  .desktop-widgets {
    grid-auto-rows: 70px;
    grid-gap: 8px;
    margin-bottom: 8px;
  }
  .desktop-widget {
    min-height: 0;
  }
  .desktop-grid {
    max-height: 320px;
    grid-gap: 8px;
  }
}

/* ===== Announcement Float ===== */
.announcement-float {
  position: fixed;
  top: 24px;
  right: 24px;
  max-width: 360px;
  width: calc(100vw - 48px);
  z-index: 900;
  background: var(--nav-bg);
  -webkit-backdrop-filter: var(--glass-blur-container);
  backdrop-filter: var(--glass-blur-container);
  border-radius: var(--radius-lg);
  border: 1px solid rgba(255, 255, 255, 0.12);
  -webkit-box-shadow: 0 12px 48px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  overflow: hidden;
  color: var(--text-primary, #e0e0e0);
}

.announcement-float-header {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: space-between;
  justify-content: space-between;
  padding: 14px 16px 10px;
}

.announcement-float-badge {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-caption1);
  font-weight: 600;
  color: var(--primary-color);
  letter-spacing: 0.3px;
}

.announcement-float-badge i {
  font-size: var(--font-size-footnote);
}

/* 公告未读胶囊（浮窗收起后的重开入口） */
.announcement-minimized {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 900;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-pill);
  background: rgba(28, 28, 30, 0.72);
  -webkit-backdrop-filter: var(--glass-blur-thin);
  backdrop-filter: var(--glass-blur-thin);
  color: var(--text-on-wallpaper, #fff);
  font-size: 13px;
  cursor: pointer;
  box-shadow: var(--shadow-md);
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard);
}

.announcement-minimized:active {
  transform: scale(0.94);
}

.announcement-minimized i {
  font-size: 13px;
  color: var(--warning-color, #FFD60A);
}

.announcement-minimized-count {
  margin-left: 6px;
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  border-radius: var(--radius-pill);
  background: var(--danger-color);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  padding: 0 4px;
}

.announcement-float-close {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #e0e0e0);
  cursor: pointer;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: center;
  justify-content: center;
  font-size: 14px;
  -webkit-transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}

.announcement-float-close:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}

.announcement-float-close:active {
  transform: scale(0.9);
}

.announcement-float-body {
  padding: 0 16px 12px;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background var(--duration-fast) var(--ease-standard);
}

.announcement-float-body:active {
  background: rgba(255, 255, 255, 0.06);
}

/* 横滑关闭进行中：关掉过渡（位移由手势实时驱动），松手移除后恢复过渡播放甩出/回弹 */
.announcement-float--swiping {
  transition: none !important;
}

/* 轮播切换交叉淡入 */
.announce-swap-enter-active,
.announce-swap-leave-active {
  transition: opacity var(--duration-fast) var(--ease-standard);
}
.announce-swap-enter,
.announce-swap-leave-to {
  opacity: 0;
}

/* 「点击查看全文」提示：浮窗正文只截 100 字，点进去看完整公告 */
.announcement-float-more {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  gap: 2px;
  margin-top: 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--primary-color);
}

.announcement-float-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #e0e0e0);
  line-height: 1.4;
}

.announcement-float-content {
  margin: 0;
  font-size: var(--font-size-footnote);
  line-height: 1.6;
  color: var(--text-secondary, rgba(224, 224, 224, 0.7));
  word-break: break-word;
}

.announcement-float-footer {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-justify-content: space-between;
  justify-content: space-between;
  padding: 10px 16px 14px;
  border-top: 0.5px solid rgba(255, 255, 255, 0.06);
}

.announcement-float-indicator {
  font-size: 11px;
  color: var(--text-secondary, rgba(224, 224, 224, 0.5));
  font-weight: 500;
}

.announcement-float-actions {
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  -webkit-flex-wrap: wrap;
  flex-wrap: wrap;
  -webkit-justify-content: flex-end;
  justify-content: flex-end;
  gap: 8px;
}

.announcement-float-btn {
  border: none;
  border-radius: var(--radius-sm);
  padding: 6px 12px;
  font-size: var(--font-size-caption1);
  font-weight: 500;
  cursor: pointer;
  display: -webkit-flex;
  display: flex;
  -webkit-align-items: center;
  align-items: center;
  gap: 4px;
  -webkit-transition: background var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  transition: background var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
}

.announcement-float-btn i {
  font-size: 11px;
}

.announcement-float-btn:active {
  transform: scale(0.94);
}

.announcement-float-btn-detail {
  background: rgba(var(--primary-rgb), 0.32);
  color: #fff;
}

.announcement-float-btn-detail:hover {
  background: rgba(var(--primary-rgb), 0.5);
}

.announcement-float-btn-view {
  background: rgba(var(--primary-rgb), 0.2);
  color: var(--primary-color);
}

.announcement-float-btn-view:hover {
  background: rgba(var(--primary-rgb), 0.35);
}

.announcement-float-btn-dismiss {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary, rgba(224, 224, 224, 0.7));
}

.announcement-float-btn-dismiss:hover {
  background: rgba(255, 255, 255, 0.16);
  color: var(--text-primary, #e0e0e0);
}

/* Announcement Float Transition */
.announcement-float-enter-active {
  -webkit-transition: opacity var(--duration-normal) var(--ease-standard), -webkit-transform var(--duration-normal) var(--ease-spring);
  transition: opacity var(--duration-normal) var(--ease-standard), transform var(--duration-normal) var(--ease-spring);
}

.announcement-float-leave-active {
  -webkit-transition: opacity var(--duration-normal) var(--ease-standard), -webkit-transform var(--duration-normal) var(--ease-accelerate);
  transition: opacity var(--duration-normal) var(--ease-standard), transform var(--duration-normal) var(--ease-accelerate);
}

.announcement-float-enter {
  opacity: 0;
  -webkit-transform: translateX(60px);
  transform: translateX(60px);
}

.announcement-float-leave-to {
  opacity: 0;
  -webkit-transform: translateX(60px);
  transform: translateX(60px);
}

/* 文件夹展开过渡：打开淡入，关闭时遮罩纯淡出、仅卡片缩回 tile 原点
   （原实现把 scale(0.92) 施加在 overlay 根上，毛玻璃遮罩跟着一起缩，不符合果风语义） */
.folder-expand-enter-active {
  -webkit-transition: opacity var(--duration-normal) var(--ease-standard);
  transition: opacity var(--duration-normal) var(--ease-standard);
}
.folder-expand-leave-active {
  -webkit-transition: opacity var(--duration-fast) var(--ease-accelerate);
  transition: opacity var(--duration-fast) var(--ease-accelerate);
}
.folder-expand-enter, .folder-expand-leave-to {
  opacity: 0;
}
/* 收起：卡片朝 transform-origin（tile 中心，父侧 openFolder 写入）缩回并淡出 */
.folder-expand-leave-active .folder-expanded-card {
  animation: folderCollapse var(--duration-fast) var(--ease-accelerate) forwards;
}
@keyframes folderCollapse {
  0% { opacity: 1; transform: scale(1) translateY(0); }
  100% { opacity: 0; transform: scale(0.92) translateY(8px); }
}

/* ========== Widget 配置弹窗（支持多字段、select/text/bool/number） ========== */
.widget-config-mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.widget-config-dialog {
  width: 360px;
  max-width: 92vw;
  max-height: 80vh;
  background: var(--card-bg, #fff);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: wcDialogIn var(--duration-fast) var(--ease-standard);
}
@keyframes wcDialogIn {
  from { opacity: 0; transform: scale(0.92); }
  to { opacity: 1; transform: scale(1); }
}
.wc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--separator-color, rgba(0,0,0,0.06));
}
.wc-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}
.wc-close {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-standard);
}
.wc-close:hover {
  background: var(--separator-color, rgba(0,0,0,0.06));
}
.wc-body {
  padding: var(--spacing-md) var(--spacing-lg);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.wc-field {
  margin-bottom: 16px;
}
.wc-field:last-child {
  margin-bottom: 0;
}
.wc-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.wc-select, .wc-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.1));
  border-radius: var(--radius-md);
  background: var(--bg-color, #f2f2f7);
  color: var(--text-primary);
  font-size: 14px;
  box-sizing: border-box;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.wc-select:focus, .wc-input:focus {
  outline: none;
  border-color: var(--primary-color);
}
/* iOS 风格开关 */
.wc-switch-wrap {
  display: flex;
  align-items: center;
}
.wc-switch {
  width: 44px;
  height: 26px;
  border-radius: var(--radius-pill);
  border: none;
  background: rgba(120, 120, 128, 0.16);
  position: relative;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-standard);
  padding: 0;
  flex-shrink: 0;
}
.wc-switch.on {
  background: var(--success-color, #34C759);
}
.wc-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  transition: transform var(--duration-fast) var(--ease-standard);
}
.wc-switch.on .wc-switch-knob {
  transform: translateX(18px);
}
.wc-empty {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 14px;
  padding: var(--spacing-lg) 0;
}
.wc-actions {
  display: flex;
  gap: 10px;
  padding: var(--spacing-md) var(--spacing-lg);
  border-top: 1px solid var(--separator-color, rgba(0,0,0,0.06));
  justify-content: flex-end;
}
.wc-btn {
  padding: var(--spacing-sm) var(--spacing-lg);
  border-radius: var(--radius-md);
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
  min-height: 38px;
}
.wc-btn:active {
  transform: scale(0.96);
}
.wc-btn-cancel {
  background: var(--separator-color, rgba(0,0,0,0.06));
  color: var(--text-primary);
}
.wc-btn-save {
  background: var(--primary-color);
  color: #fff;
}
.wc-btn-save:hover {
  opacity: 0.9;
}
</style>
