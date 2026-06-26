<template>
  <div class="settings-page">
    <AppNavBar title="设置" />
    <div class="settings-body">
      <div class="settings-sidebar">
        <div class="sidebar-nav">
          <button
            v-for="nav in visibleNavItems"
            :key="nav.key"
            class="nav-item"
            :class="{ active: activeNav === nav.key }"
            @click="activeNav = nav.key"
          >
            <i :class="nav.icon" class="nav-icon"></i>
            <span class="nav-label">{{ nav.label }}</span>
          </button>
        </div>
      </div>
      <div class="settings-content scrollbar-thin">
        <transition name="section-fade" mode="out-in">
          <!-- 个人信息 -->
          <div v-if="activeNav === 'profile'" key="profile" class="settings-section">
            <h2 class="section-title"><i class="fa-solid fa-user section-title-icon"></i>个人信息</h2>
            <div class="form-card">
              <div class="form-row">
                <label class="form-label">网名</label>
                <input v-model="profileForm.net_name" class="form-input" />
              </div>
              <div class="form-row">
                <label class="form-label">真实姓名</label>
                <input :value="user.real_name" class="form-input" disabled />
              </div>
              <div class="form-row">
                <label class="form-label">用户ID</label>
                <input :value="user.user_id" class="form-input" disabled />
              </div>
              <div class="form-row">
                <label class="form-label">头像颜色</label>
                <div class="avatar-color-picker">
                  <div
                    v-for="color in avatarPresets"
                    :key="color"
                    class="color-swatch"
                    :class="{ active: avatarColor === color }"
                    :style="{ background: color }"
                    @click="selectAvatarColor(color)"
                  ></div>
                  <label class="color-swatch custom-swatch" :class="{ active: avatarColor && avatarPresets.indexOf(avatarColor) === -1 }">
                    <input type="color" :value="avatarColor || '#007AFF'" @input="selectAvatarColor($event.target.value)" class="color-input-hidden">
                    <i class="fa-solid fa-palette"></i>
                  </label>
                  <button v-if="avatarColor" class="color-reset-btn" @click="resetAvatarColor" title="恢复默认"><i class="fa-solid fa-rotate-left"></i></button>
                </div>
              </div>
              <div class="form-row">
                <label class="form-label">性别</label>
                <input :value="genderText" class="form-input" disabled />
              </div>
              <div class="form-row">
                <label class="form-label">注册时间</label>
                <input :value="formatDate(user.created_at)" class="form-input" disabled />
              </div>
              <div class="form-divider"></div>
              <div class="form-row">
                <label class="form-label">生日</label>
                <div class="form-input-group">
                  <input v-model="profileForm.birthday" type="date" class="form-input" />
                  <button class="privacy-toggle" :class="{ private: profileForm.birthday_private }" @click="togglePrivacy('birthday')" :title="profileForm.birthday_private ? '当前仅自己可见，点击公开' : '当前公开可见，点击设为私密'">
                    <i :class="profileForm.birthday_private ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
                  </button>
                </div>
              </div>
              <div class="form-row">
                <label class="form-label">微信号</label>
                <div class="form-input-group">
                  <input v-model="profileForm.wechat" class="form-input" placeholder="请输入微信号" />
                  <button class="privacy-toggle" :class="{ private: profileForm.wechat_private }" @click="togglePrivacy('wechat')" :title="profileForm.wechat_private ? '当前仅自己可见，点击公开' : '当前公开可见，点击设为私密'">
                    <i :class="profileForm.wechat_private ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
                  </button>
                </div>
              </div>
              <div class="form-row">
                <label class="form-label">QQ号</label>
                <div class="form-input-group">
                  <input v-model="profileForm.qq" class="form-input" placeholder="请输入QQ号" />
                  <button class="privacy-toggle" :class="{ private: profileForm.qq_private }" @click="togglePrivacy('qq')" :title="profileForm.qq_private ? '当前仅自己可见，点击公开' : '当前公开可见，点击设为私密'">
                    <i :class="profileForm.qq_private ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
                  </button>
                </div>
              </div>
              <div class="form-row">
                <label class="form-label">手机号</label>
                <div class="form-input-group">
                  <input v-model="profileForm.phone" class="form-input" placeholder="请输入手机号" />
                  <button class="privacy-toggle" :class="{ private: profileForm.phone_private }" @click="togglePrivacy('phone')" :title="profileForm.phone_private ? '当前仅自己可见，点击公开' : '当前公开可见，点击设为私密'">
                    <i :class="profileForm.phone_private ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
                  </button>
                </div>
              </div>
              <div class="form-row">
                <label class="form-label">住址</label>
                <div class="form-input-group">
                  <input v-model="profileForm.address" class="form-input" placeholder="请输入住址" />
                  <button class="privacy-toggle" :class="{ private: profileForm.address_private }" @click="togglePrivacy('address')" :title="profileForm.address_private ? '当前仅自己可见，点击公开' : '当前公开可见，点击设为私密'">
                    <i :class="profileForm.address_private ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
                  </button>
                </div>
              </div>
              <div class="form-row">
                <label class="form-label">个人签名</label>
                <input v-model="profileForm.signature" class="form-input" placeholder="请输入个人签名" />
              </div>
              <div class="form-actions">
                <button class="btn-primary" @click="saveProfile" :disabled="saving || profileLoading">
                  <i class="fa-solid fa-check btn-icon"></i>保存
                </button>
              </div>
            </div>
          </div>

          <!-- 账户安全 -->
          <div v-else-if="activeNav === 'security'" key="security" class="settings-section">
            <h2 class="section-title"><i class="fa-solid fa-shield-halved section-title-icon"></i>账户安全</h2>
            <div class="form-card">
              <div class="form-row">
                <label class="form-label">当前密码</label>
                <input v-model="securityForm.old_password" type="password" class="form-input" placeholder="输入当前密码" />
              </div>
              <div class="form-row">
                <label class="form-label">新密码</label>
                <input v-model="securityForm.new_password" type="password" class="form-input" placeholder="输入新密码（至少6位）" />
              </div>
              <div class="form-row">
                <label class="form-label">确认新密码</label>
                <input v-model="securityForm.confirm_password" type="password" class="form-input" placeholder="再次输入新密码" />
              </div>
              <div class="form-hint" v-if="securityForm.new_password && securityForm.new_password.length < 6">
                <i class="fa-solid fa-circle-exclamation hint-icon"></i>新密码至少需要6位字符
              </div>
              <div class="form-hint hint-error" v-if="securityForm.confirm_password && securityForm.new_password !== securityForm.confirm_password">
                <i class="fa-solid fa-circle-exclamation hint-icon"></i>两次输入的密码不一致
              </div>
              <div class="form-actions">
                <button class="btn-primary" @click="changePassword" :disabled="saving">
                  <i class="fa-solid fa-key btn-icon"></i>修改密码
                </button>
              </div>
            </div>
          </div>

          <!-- 通知设置 -->
          <div v-else-if="activeNav === 'notifications'" key="notifications" class="settings-section">
            <h2 class="section-title"><i class="fa-solid fa-bell section-title-icon"></i>通知设置</h2>
            <div class="form-card">
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-comment-dots form-row-icon"></i>聊天消息通知
                </label>
                <label class="switch">
                  <input type="checkbox" v-model="notifications.chat" @change="saveNotifications" />
                  <span class="switch-slider"></span>
                </label>
              </div>
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-users form-row-icon"></i>社区帖子通知
                </label>
                <label class="switch">
                  <input type="checkbox" v-model="notifications.community" @change="saveNotifications" />
                  <span class="switch-slider"></span>
                </label>
              </div>
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-bullhorn form-row-icon"></i>广播通知
                </label>
                <label class="switch">
                  <input type="checkbox" v-model="notifications.broadcast" @change="saveNotifications" />
                  <span class="switch-slider"></span>
                </label>
              </div>
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-robot form-row-icon"></i>AI对话通知
                </label>
                <label class="switch">
                  <input type="checkbox" v-model="notifications.aiChat" @change="saveNotifications" />
                  <span class="switch-slider"></span>
                </label>
              </div>
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-gear form-row-icon"></i>系统通知
                </label>
                <label class="switch">
                  <input type="checkbox" v-model="notifications.system" @change="saveNotifications" />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
          </div>

          <!-- 等级 -->
          <div v-else-if="activeNav === 'level'" key="level" class="settings-section">
            <h2 class="section-title"><i class="fa-solid fa-star section-title-icon"></i>等级</h2>
            <div class="form-card">
              <div class="level-card">
                <div class="level-card-icon">
                  <img :src="'/resources/public/level/Lv' + levelInfo.level + '.svg'" class="level-icon-lg" />
                </div>
                <div class="level-card-info">
                  <div class="level-card-title">Lv.{{ levelInfo.level }}</div>
                  <div class="level-card-exp">{{ levelInfo.exp }} / {{ levelInfo.next_level_exp || 9900 }} EXP</div>
                  <div class="level-progress-bar">
                    <div class="level-progress-fill" :style="{ width: (levelInfo.exp_progress && levelInfo.exp_progress.percentage !== undefined ? levelInfo.exp_progress.percentage : 0) + '%' }"></div>
                  </div>
                </div>
              </div>
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-calendar-check form-row-icon"></i>每日签到
                </label>
                <div class="daily-login-group">
                  <span v-if="levelInfo.login_streak > 0" class="streak-badge">🔥 {{ levelInfo.login_streak }}天</span>
                  <button class="btn-outline" :disabled="dailyLoginClaimed || dailyLoginLoading" @click="claimDailyLogin">
                    {{ dailyLoginClaimed ? '已签到' : '签到' }}
                  </button>
                </div>
              </div>
              <div v-if="levelInfo.login_streak > 0" class="streak-info">
                <span>连续签到 {{ levelInfo.login_streak }} 天</span>
                <span v-if="levelInfo.streak_bonus > 0" class="streak-bonus-text">+{{ levelInfo.streak_bonus }} 额外经验</span>
                <span v-else class="streak-next-text">再坚持 {{ getNextStreakMilestone(levelInfo.login_streak) - levelInfo.login_streak }} 天可获额外奖励</span>
              </div>
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-bolt form-row-icon"></i>今日经验
                </label>
                <div class="daily-exp-info">
                  <span class="daily-exp-value">{{ levelInfo.daily_exp_earned }} / {{ levelInfo.daily_exp_cap }}</span>
                  <div class="daily-exp-bar">
                    <div class="daily-exp-fill" :style="{ width: Math.min(100, (levelInfo.daily_exp_earned / levelInfo.daily_exp_cap) * 100) + '%' }"></div>
                  </div>
                </div>
              </div>
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-users form-row-icon"></i>在社区显示等级
                </label>
                <label class="switch">
                  <input type="checkbox" :checked="levelInfo.show_level_community" @change="toggleLevelCommunity" />
                  <span class="switch-slider"></span>
                </label>
              </div>
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-comment-dots form-row-icon"></i>在聊天显示等级
                </label>
                <label class="switch">
                  <input type="checkbox" :checked="levelInfo.show_level_chat" @change="toggleLevelChat" />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
            <div class="form-card" style="margin-top:12px">
              <h3 class="sub-title" style="margin-bottom:8px">经验获取方式</h3>
              <div class="exp-rules-grid">
                <div class="exp-rule-item"><i class="fa-solid fa-calendar-check"></i><span class="exp-rule-name">每日签到</span><span class="exp-rule-value">+20</span></div>
                <div class="exp-rule-item"><i class="fa-solid fa-fire"></i><span class="exp-rule-name">连续签到</span><span class="exp-rule-value">+5~30</span></div>
                <div class="exp-rule-item"><i class="fa-solid fa-comment"></i><span class="exp-rule-name">发消息</span><span class="exp-rule-value">+1/条</span></div>
                <div class="exp-rule-item"><i class="fa-solid fa-pen-to-square"></i><span class="exp-rule-name">发帖</span><span class="exp-rule-value">+5/帖</span></div>
                <div class="exp-rule-item"><i class="fa-solid fa-heart"></i><span class="exp-rule-name">获赞</span><span class="exp-rule-value">+2/次</span></div>
                <div class="exp-rule-item"><i class="fa-solid fa-reply"></i><span class="exp-rule-name">评论</span><span class="exp-rule-value">+3/条</span></div>
                <div class="exp-rule-item"><i class="fa-solid fa-share"></i><span class="exp-rule-name">转发</span><span class="exp-rule-value">+3/次</span></div>
              </div>
              <div class="exp-rules-note">每日经验上限 {{ levelInfo.daily_exp_cap || 100 }}，连续99天满经验可达满级</div>
            </div>
          </div>

          <!-- 个性化 -->
          <div v-else-if="activeNav === 'customize'" key="customize" class="settings-section">
            <h2 class="section-title"><i class="fa-solid fa-palette section-title-icon"></i>个性化</h2>
            <div class="form-card">
              <div class="form-row">
                <label class="form-label">主题</label>
                <div class="toggle-group">
                  <button
                    class="toggle-btn"
                    :class="{ active: theme === 'light' }"
                    @click="setTheme('light')"
                  >浅色</button>
                  <button
                    class="toggle-btn"
                    :class="{ active: theme === 'dark' }"
                    @click="setTheme('dark')"
                  >深色</button>
                </div>
              </div>
              <div class="form-row">
                <label class="form-label">壁纸</label>
              </div>
              <div v-if="wallpaperLoading" class="wp-loading">
                <i class="fa-solid fa-spinner fa-spin"></i> 加载中...
              </div>
              <template v-else>
                <div class="wp-tabs">
                  <div class="wp-tab" :class="{ active: wpTab === 'builtin' }" @click="wpTab = 'builtin'">
                    <i class="fa-solid fa-palette"></i> 内置
                  </div>
                  <div v-if="staticWallpapers.length > 0" class="wp-tab" :class="{ active: wpTab === 'static' }" @click="wpTab = 'static'">
                    <i class="fa-solid fa-image"></i> 静态 <span class="wp-tab-count">{{ staticWallpapers.length }}</span>
                  </div>
                  <div v-if="videoWallpapers.length > 0" class="wp-tab" :class="{ active: wpTab === 'video' }" @click="wpTab = 'video'">
                    <i class="fa-solid fa-film"></i> 动态 <span class="wp-tab-count">{{ videoWallpapers.length }}</span>
                  </div>
                </div>
                <div class="wp-list">
                  <div v-if="wpTab === 'builtin'" class="wp-grid">
                    <div
                      v-for="item in builtinWallpapers"
                      :key="item.id"
                      class="wp-card"
                      :class="{ active: wallpaper === item.id }"
                      @click="setWallpaper(item.id)"
                    >
                      <div class="wp-card-preview" :style="{ background: item.gradient }"></div>
                      <div class="wp-card-label">
                        <span class="wp-card-name">{{ item.name }}</span>
                        <i v-if="wallpaper === item.id" class="fa-solid fa-circle-check wp-card-check"></i>
                      </div>
                    </div>
                  </div>
                  <div v-if="wpTab === 'static'" class="wp-grid">
                    <div
                      v-for="wp in staticWallpapers"
                      :key="wp.filename"
                      class="wp-card"
                      :class="{ active: wallpaper === wp.url }"
                      @click="setWallpaper(wp.url)"
                    >
                      <div class="wp-card-preview" :style="{ backgroundImage: 'url(' + wp.url + ')', backgroundSize: 'cover', backgroundPosition: 'center' }"></div>
                      <div class="wp-card-label">
                        <span class="wp-card-name">{{ wp.name }}</span>
                        <i v-if="wallpaper === wp.url" class="fa-solid fa-circle-check wp-card-check"></i>
                      </div>
                    </div>
                  </div>
                  <div v-if="wpTab === 'video'" class="wp-grid">
                    <div
                      v-for="vw in videoWallpapers"
                      :key="vw.filename"
                      class="wp-card"
                      :class="{ active: wallpaper === vw.filename }"
                      @click="setWallpaper(vw.filename)"
                    >
                      <div class="wp-card-preview wp-card-preview-video">
                        <video class="wp-video-thumb" :src="vw.url" muted preload="metadata"></video>
                        <div class="wp-video-badge"><i class="fa-solid fa-play"></i></div>
                      </div>
                      <div class="wp-card-label">
                        <span class="wp-card-name">{{ vw.name }}</span>
                        <i v-if="wallpaper === vw.filename" class="fa-solid fa-circle-check wp-card-check"></i>
                      </div>
                    </div>
                  </div>
                  <div v-if="staticWallpapers.length === 0 && videoWallpapers.length === 0 && wpTab !== 'builtin'" class="wp-empty">
                    <i class="fa-solid fa-folder-open wp-empty-icon"></i>
                    <span>暂无自定义壁纸</span>
                    <span class="wp-empty-hint">将图片或视频放入服务器 Resources/public/wallpaper/ 目录</span>
                  </div>
                </div>
              </template>
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-id-card form-row-icon"></i>在社区显示真实姓名
                </label>
                <label class="switch">
                  <input type="checkbox" v-model="privacyCustomize.showRealName" @change="savePrivacyCustomize" />
                  <span class="switch-slider"></span>
                </label>
              </div>
            </div>
          </div>

          <!-- 数据管理 -->
          <div v-else-if="activeNav === 'data'" key="data" class="settings-section">
            <h2 class="section-title"><i class="fa-solid fa-database section-title-icon"></i>数据管理</h2>
            <div class="form-card">
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-broom form-row-icon"></i>清除缓存
                </label>
                <button class="btn-outline" @click="clearCache">清除</button>
              </div>
              <div class="form-row">
                <label class="form-label">
                  <i class="fa-solid fa-right-from-bracket form-row-icon"></i>退出登录
                </label>
                <button class="btn-danger-outline" @click="logout">退出</button>
              </div>
              <div class="data-info">
                <p class="data-info-text"><i class="fa-solid fa-circle-info data-info-icon"></i>清除缓存将删除本地存储的临时数据和浏览器缓存，并刷新页面。不会影响您的账户信息。</p>
              </div>
            </div>
          </div>

          <!-- 关于系统 -->
          <div v-else-if="activeNav === 'about'" key="about" class="settings-section">
            <h2 class="section-title"><i class="fa-solid fa-circle-info section-title-icon"></i>关于系统</h2>
            <div class="form-card">
              <div class="about-logo">
                <div class="about-logo-icon">
                  <i class="fa-solid fa-graduation-cap"></i>
                </div>
                <div class="about-logo-text">ClassNet</div>
              </div>
              <div class="about-item">
                <span class="about-label">系统名称</span>
                <span class="about-value">ClassNet 智慧校园平台</span>
              </div>
              <div class="about-item">
                <span class="about-label">版本</span>
                <span class="about-value">{{ versionInfo.version }}</span>
              </div>
              <div class="about-item">
                <span class="about-label">前端框架</span>
                <span class="about-value">Vue 2.7 + Vite</span>
              </div>
              <div v-if="versionInfo.changelog" class="about-changelog">
                <div class="about-changelog-title">更新介绍</div>
                <div class="about-changelog-list">
                  <div v-for="(line, idx) in versionInfo.changelogLines" :key="idx" class="about-changelog-line">{{ line }}</div>
                </div>
              </div>
              <div class="about-item">
                <span class="about-label">开发者</span>
                <span class="about-value">Nevino</span>
              </div>
              <div v-if="isOfficer && officerTitle" class="about-item">
                <span class="about-label">我的头衔</span>
                <span class="about-value" style="color:var(--primary-color)">{{ officerTitle }}</span>
              </div>
              <div class="about-footer">
                <button class="btn-outline check-update-btn" @click="checkForUpdate" :disabled="updateChecking">
                  <i class="fa-solid fa-rotate" :class="{ 'fa-spin': updateChecking }"></i>
                  {{ updateChecking ? '检查中...' : '检查更新' }}
                </button>
                <p class="about-copyright">Nevino. All rights reserved.</p>
              </div>
            </div>
          </div>

          <!-- 系统管理 -->
          <div v-else-if="activeNav === 'admin' && (isAdmin || isOfficer)" key="admin" class="settings-section">
            <h2 class="section-title"><i class="fa-solid fa-screwdriver-wrench section-title-icon"></i>系统管理</h2>
            <div class="form-card">
              <p class="admin-desc">管理用户、广播、服务器状态和资源文件。</p>
              <button class="btn-primary" @click="goToAdmin">
                <i class="fa-solid fa-arrow-right btn-icon"></i>进入管理面板
              </button>
            </div>
          </div>
        </transition>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';
import helpers from '@/utils/helpers';
import updateChecker from '@/utils/update-checker';
import AppNavBar from '@/components/AppNavBar.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

export default {
  name: 'Settings',
  components: {
    AppNavBar: AppNavBar,
    ConfirmDialog: ConfirmDialog
  },
  data: function() {
    return {
      activeNav: 'profile',
      saving: false,
      avatarColor: '',
      avatarPresets: helpers.AVATAR_PRESETS,
      staticWallpapers: [],
      videoWallpapers: [],
      wallpaperLoading: false,
      wpTab: 'builtin',
      builtinWallpapers: [
        { id: 'default', name: '默认', gradient: 'linear-gradient(135deg, #003E80 0%, #0A84FF 50%, #5AC8FA 100%)' },
        { id: 'ocean', name: '海洋', gradient: 'linear-gradient(135deg, #002E66 0%, #0066CC 50%, #409CFF 100%)' },
        { id: 'sky', name: '天空', gradient: 'linear-gradient(135deg, #0A84FF 0%, #0A84FF 40%, #80D0FF 100%)' },
        { id: 'night', name: '夜空', gradient: 'linear-gradient(135deg, #000000 0%, #1C1C1E 50%, #2C2C2E 100%)' },
        { id: 'dawn', name: '黎明', gradient: 'linear-gradient(135deg, #003E80 0%, #0A84FF 30%, #FFE0B2 100%)' },
        { id: 'arctic', name: '极地', gradient: 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 50%, #5AC8FA 100%)' }
      ],
      autoWallpaper: false,
      autoWallpaperTimer: null,
      profileForm: {
        net_name: '',
        birthday: '',
        birthday_private: true,
        wechat: '',
        wechat_private: true,
        qq: '',
        qq_private: true,
        phone: '',
        phone_private: true,
        address: '',
        address_private: true,
        signature: ''
      },
      profileLoading: false,
      securityForm: {
        old_password: '',
        new_password: '',
        confirm_password: ''
      },
      navItems: [
        { key: 'profile', icon: 'fa-solid fa-user-pen', label: '个人信息' },
        { key: 'security', icon: 'fa-solid fa-shield-halved', label: '账户安全' },
        { key: 'notifications', icon: 'fa-solid fa-bell', label: '通知设置' },
        { key: 'level', icon: 'fa-solid fa-star', label: '等级' },
        { key: 'customize', icon: 'fa-solid fa-palette', label: '个性化' },
        { key: 'data', icon: 'fa-solid fa-database', label: '数据管理' },
        { key: 'about', icon: 'fa-solid fa-circle-info', label: '关于系统' },
        { key: 'admin', icon: 'fa-solid fa-screwdriver-wrench', label: '系统管理' }
      ],
      versionInfo: {
        version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0',
        changelog: '',
        changelogLines: []
      },
      levelInfo: {
        level: 0,
        exp: 0,
        show_level_community: false,
        show_level_chat: false,
        exp_progress: { current: 0, needed: 100, percentage: 0 },
        next_level_exp: 100,
        level_thresholds: [],
        daily_exp_earned: 0,
        daily_exp_cap: 100,
        login_streak: 0,
        max_login_streak: 0,
        streak_bonus: 0
      },
      dailyLoginClaimed: false,
      dailyLoginLoading: false,
      updateChecking: false,
      privacyCustomize: {
        showRealName: true  // 默认在社区显示真实姓名
      }
    };
  },
  computed: {
    user: function() {
      return this.$store.state.auth.user || {};
    },
    isAdmin: function() {
      return this.$store.getters['auth/isAdmin'];
    },
    isOfficer: function() {
      return this.$store.getters['auth/isOfficer'];
    },
    officerTitle: function() {
      var user = this.$store.state.auth.user;
      return user && user.officer_title ? user.officer_title : '';
    },
    visibleNavItems: function() {
      var self = this;
      return self.navItems.filter(function(nav) {
        if (nav.key === 'admin') {
          return self.isAdmin || self.isOfficer;
        }
        return true;
      });
    },
    theme: function() {
      return this.$store.state.settings.theme;
    },
    wallpaper: function() {
      return this.$store.state.settings.wallpaper;
    },
    notifications: function() {
      return this.$store.state.settings.notifications;
    },
    genderText: function() {
      var gender = this.user.gender;
      if (gender === 'M' || gender === 'male' || gender === '男') return '男';
      if (gender === 'F' || gender === 'female' || gender === '女') return '女';
      return gender || '未设置';
    }
  },
  mounted: function() {
    this.profileForm.net_name = this.user.net_name || '';
    this.loadProfile();
    this.loadAllWallpapers();
    this.autoWallpaper = localStorage.getItem('autoWallpaper') === 'true';
    if (this.autoWallpaper) {
      this.startAutoWallpaper();
    }
    this.fetchVersionInfo();
    this.loadLevelInfo();
    this.avatarColor = localStorage.getItem('avatar_color_' + (this.user && this.user.user_id)) || '';
  },
  beforeDestroy: function() {
    if (this.autoWallpaperTimer) {
      clearInterval(this.autoWallpaperTimer);
    }
  },
  methods: {
    saveProfile: function() {
      var self = this;
      if (!self.profileForm.net_name.trim()) {
        self.$store.commit('toast/SHOW_TOAST', { message: '网名不能为空', type: 'error' });
        return;
      }
      self.saving = true;
      var profileData = {
        net_name: self.profileForm.net_name.trim(),
        birthday: self.profileForm.birthday,
        wechat: self.profileForm.wechat.trim(),
        qq: self.profileForm.qq.trim(),
        phone: self.profileForm.phone.trim(),
        address: self.profileForm.address.trim(),
        signature: self.profileForm.signature.trim(),
        privacy_settings: {
          birthday: self.profileForm.birthday_private,
          wechat: self.profileForm.wechat_private,
          qq: self.profileForm.qq_private,
          phone: self.profileForm.phone_private,
          address: self.profileForm.address_private
        }
      };
      // 同时更新网名和完整资料，任一失败则回滚用户状态
      var netNameUpdated = false;
      api.patch('/user/profile', { net_name: profileData.net_name })
        .then(function() {
          netNameUpdated = true;
          var updatedUser = Object.assign({}, self.user, { net_name: profileData.net_name });
          self.$store.commit('auth/SET_USER', updatedUser);
          return api.put('/community/profile', profileData);
        })
        .then(function() {
          self.$store.commit('toast/SHOW_TOAST', { message: '个人信息保存成功', type: 'success' });
        })
        .catch(function(err) {
          // 回滚：如果网名已更新但后续失败，恢复原网名
          if (netNameUpdated && self.user.net_name) {
            var rollbackUser = Object.assign({}, self.user);
            self.$store.commit('auth/SET_USER', rollbackUser);
          }
          var resp = err.response && err.response.data;
          var msg = (resp && resp.message) || '保存失败';
          self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
        })
        .finally(function() {
          self.saving = false;
        });
    },
    loadProfile: function() {
      var self = this;
      self.profileLoading = true;
      api.get('/community/profile')
        .then(function(response) {
          var data = response.data && response.data.data;
          if (data) {
            var privacy = data.privacy_settings || {};
            self.profileForm.birthday = data.birthday || '';
            self.profileForm.birthday_private = privacy.birthday !== false;
            self.profileForm.wechat = data.wechat || '';
            self.profileForm.qq = data.qq || '';
            self.profileForm.phone = data.phone || '';
            self.profileForm.address = data.address || '';
            self.profileForm.signature = data.signature || '';
            self.profileForm.wechat_private = privacy.wechat !== false;
            self.profileForm.qq_private = privacy.qq !== false;
            self.profileForm.phone_private = privacy.phone !== false;
            self.profileForm.address_private = privacy.address !== false;
            // 真实姓名显示设置：hide_real_name=true 时关闭开关
            self.privacyCustomize.showRealName = !privacy.hide_real_name;
          }
        })
        .catch(function() {
          // silently ignore, use defaults
        })
        .finally(function() {
          self.profileLoading = false;
        });
    },
    togglePrivacy: function(field) {
      this.profileForm[field + '_private'] = !this.profileForm[field + '_private'];
    },
    changePassword: function() {
      var self = this;
      if (!self.securityForm.old_password) {
        self.$store.commit('toast/SHOW_TOAST', { message: '请输入当前密码', type: 'error' });
        return;
      }
      if (!self.securityForm.new_password) {
        self.$store.commit('toast/SHOW_TOAST', { message: '请输入新密码', type: 'error' });
        return;
      }
      if (self.securityForm.new_password.length < 6) {
        self.$store.commit('toast/SHOW_TOAST', { message: '新密码至少6位', type: 'error' });
        return;
      }
      if (self.securityForm.new_password !== self.securityForm.confirm_password) {
        self.$store.commit('toast/SHOW_TOAST', { message: '两次密码不一致', type: 'error' });
        return;
      }
      self.saving = true;
      api.post('/user/change-password', {
        old_password: self.securityForm.old_password,
        new_password: self.securityForm.new_password
      })
        .then(function() {
          self.securityForm = { old_password: '', new_password: '', confirm_password: '' };
          self.$store.commit('toast/SHOW_TOAST', { message: '密码修改成功', type: 'success' });
        })
        .catch(function(err) {
          var resp = err.response && err.response.data;
          var msg = (resp && resp.message) || '修改失败';
          self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
        })
        .finally(function() {
          self.saving = false;
        });
    },
    setTheme: function(theme) {
      this.$store.commit('settings/SET_THEME', theme);
      this.$store.commit('toast/SHOW_TOAST', { message: '主题已切换为' + (theme === 'dark' ? '深色' : '浅色'), type: 'success' });
      api.post('/user/settings', { theme: theme }).catch(function() {});
    },
    setWallpaper: function(wallpaper) {
      this.$store.commit('settings/SET_WALLPAPER', wallpaper);
      this.$store.commit('toast/SHOW_TOAST', { message: '壁纸已更换', type: 'success' });
      var self = this;
      api.post('/user/settings', { wallpaper: wallpaper }).catch(function() {});
    },
    loadAllWallpapers: function() {
      var self = this;
      self.wallpaperLoading = true;
      api.get('/assets/wallpapers').then(function(response) {
        var data = response.data.data || {};
        self.staticWallpapers = data.wallpapers || [];
        self.videoWallpapers = data.videos || [];
      }).catch(function() {}).finally(function() {
        self.wallpaperLoading = false;
      });
    },
    toggleAutoWallpaper: function() {
      localStorage.setItem('autoWallpaper', this.autoWallpaper ? 'true' : 'false');
      if (this.autoWallpaper) {
        this.startAutoWallpaper();
      } else {
        if (this.autoWallpaperTimer) {
          clearInterval(this.autoWallpaperTimer);
          this.autoWallpaperTimer = null;
        }
      }
    },
    startAutoWallpaper: function() {
      var self = this;
      var allWallpapers = ['default', 'ocean', 'sky', 'night', 'dawn', 'arctic'];
      for (var i = 0; i < self.staticWallpapers.length; i++) {
        allWallpapers.push(self.staticWallpapers[i].url);
      }
      for (var j = 0; j < self.videoWallpapers.length; j++) {
        allWallpapers.push(self.videoWallpapers[j].filename);
      }
      if (allWallpapers.length <= 1) return;
      self.autoWallpaperTimer = setInterval(function() {
        var current = self.$store.state.settings.wallpaper;
        var idx = allWallpapers.indexOf(current);
        var nextIdx = (idx + 1) % allWallpapers.length;
        self.$store.commit('settings/SET_WALLPAPER', allWallpapers[nextIdx]);
      }, 30000);
    },
    savePrivacyCustomize: function() {
      var self = this;
      api.put('/community/profile', {
        privacy_settings: {
          hide_real_name: !self.privacyCustomize.showRealName
        }
      }).then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '隐私设置已保存', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '保存失败，请重试', type: 'error' });
        // 回滚开关状态
        self.privacyCustomize.showRealName = !self.privacyCustomize.showRealName;
      });
    },
    saveNotifications: function() {
      var self = this;
      self.$store.commit('settings/SET_NOTIFICATIONS', self.notifications);
      api.post('/user/settings', { notifications: self.notifications }).then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '通知设置已保存', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '通知设置保存失败，请重试', type: 'error' });
      });
    },
    // Data management methods
    clearCache: function() {
      var self = this;
      self.$modal.confirm({
        title: '清除缓存',
        message: '将清除所有本地缓存数据并刷新页面，不会影响您的账户信息。确定继续？',
        confirmText: '确定清除',
        cancelText: '取消'
      }).then(function(result) {
        if (!result) return;

        var keepKeys = ['token', 'user', 'theme', 'wallpaper', 'autoWallpaper'];
        var allKeys = Object.keys(localStorage);
        for (var i = 0; i < allKeys.length; i++) {
          if (keepKeys.indexOf(allKeys[i]) === -1) {
            localStorage.removeItem(allKeys[i]);
          }
        }

        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(function(registrations) {
            return Promise.all(registrations.map(function(reg) {
              return reg.unregister();
            }));
          }).then(function() {
            if ('caches' in window) {
              return caches.keys().then(function(names) {
                return Promise.all(names.map(function(name) {
                  return caches.delete(name);
                }));
              });
            }
            return Promise.resolve();
          }).then(function() {
            window.location.reload(true);
          }).catch(function() {
            window.location.reload(true);
          });
        } else {
          if ('caches' in window) {
            caches.keys().then(function(names) {
              for (var j = 0; j < names.length; j++) {
                caches.delete(names[j]);
              }
            }).catch(function() {});
          }
          window.location.reload(true);
        }
      }).catch(function() {});
    },
    logout: function() {
      var self = this;
      self.$modal.confirm({
        title: '退出登录',
        message: '确定要退出当前账号吗？',
        confirmText: '退出',
        cancelText: '取消'
      }).then(function(result) {
        if (result) {
          self.$store.dispatch('auth/logout').then(function() {
            self.$router.push({ name: 'Login' });
          }).catch(function() {
            self.$router.push({ name: 'Login' });
          });
        }
      }).catch(function() {});
    },
    fetchVersionInfo: function() {
      var self = this;
      api.get('/system/version')
        .then(function(response) {
          var data = response.data && response.data.data;
          if (data) {
            self.versionInfo.version = data.version || self.versionInfo.version;
            self.versionInfo.changelog = data.changelog || '';
            self.versionInfo.changelogLines = self.parseChangelog(data.changelog);
          }
        })
        .catch(function() {
          // 使用构建时注入的 __APP_VERSION__ 作为回退
        });
    },
    parseChangelog: function(text) {
      if (!text) return [];
      // changelog 是多行文本，按行分割
      var lines = text.split('\n');
      var result = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line) result.push(line);
      }
      return result;
    },
    // 手动检查更新
    checkForUpdate: function() {
      var self = this;
      if (self.updateChecking) return;
      self.updateChecking = true;
      updateChecker.checkForUpdate().then(function(result) {
        self.updateChecking = false;
        if (result && result.needsUpdate) {
          self.$store.commit('toast/SHOW_TOAST', {
            message: '发现新版本 ' + result.serverVersion + '，请刷新页面获取更新',
            type: 'info'
          });
          // 刷新 changelog 显示
          self.fetchVersionInfo();
        } else {
          self.$store.commit('toast/SHOW_TOAST', {
            message: '已是最新版本 ' + self.versionInfo.version,
            type: 'success'
          });
        }
      }).catch(function() {
        self.updateChecking = false;
        self.$store.commit('toast/SHOW_TOAST', { message: '检查更新失败，请稍后重试', type: 'error' });
      });
    },
    goToAdmin: function() {
      this.$router.push({ name: 'Admin' });
    },
    formatDate: function(dateStr) {
      if (!dateStr) return '';
      var date = new Date(dateStr);
      var y = date.getFullYear();
      var m = (date.getMonth() + 1).toString().padStart(2, '0');
      var d = date.getDate().toString().padStart(2, '0');
      return y + '-' + m + '-' + d;
    },
    loadLevelInfo: function() {
      var self = this;
      api.get('/level/info').then(function(response) {
        var data = response.data && response.data.data;
        if (data) {
          self.levelInfo = {
            level: data.level || 0,
            exp: data.exp || 0,
            show_level_community: !!data.show_level_community,
            show_level_chat: !!data.show_level_chat,
            exp_progress: data.exp_progress || { current: 0, needed: 100, percentage: 0 },
            next_level_exp: data.next_level_exp || 100,
            level_thresholds: data.level_thresholds || [],
            daily_exp_earned: data.daily_exp_earned || 0,
            daily_exp_cap: data.daily_exp_cap || 100,
            login_streak: data.login_streak || 0,
            max_login_streak: data.max_login_streak || 0,
            streak_bonus: data.streak_bonus || 0
          };
          self.dailyLoginClaimed = !!data.daily_login_claimed;
        }
      }).catch(function() {
      });
    },
    toggleLevelCommunity: function() {
      var self = this;
      var show = self.levelInfo.show_level_community;
      api.post('/level/settings/community', { show: !show }).then(function() {
        self.levelInfo.show_level_community = !show;
        self.$store.commit('toast/SHOW_TOAST', { message: self.levelInfo.show_level_community ? '已在社区显示等级' : '已隐藏社区等级', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '设置失败', type: 'error' });
      });
    },
    toggleLevelChat: function() {
      var self = this;
      var show = self.levelInfo.show_level_chat;
      api.post('/level/settings/chat', { show: !show }).then(function() {
        self.levelInfo.show_level_chat = !show;
        self.$store.commit('toast/SHOW_TOAST', { message: self.levelInfo.show_level_chat ? '已在聊天显示等级' : '已隐藏聊天等级', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '设置失败', type: 'error' });
      });
    },
    claimDailyLogin: function() {
      var self = this;
      if (self.dailyLoginLoading) return;
      self.dailyLoginLoading = true;
      api.post('/level/daily-login').then(function(response) {
        var data = response.data;
        if (data && data.message === 'already_claimed') {
          self.dailyLoginClaimed = true;
          self.$store.commit('toast/SHOW_TOAST', { message: '今日已签到', type: 'info' });
        } else {
          var expData = data && data.data;
          self.dailyLoginClaimed = true;
          var msg = '签到成功！获得 ' + (expData && expData.exp_gained ? expData.exp_gained : 0) + ' 经验';
          if (expData && expData.login_streak > 1) {
            msg += '（连续' + expData.login_streak + '天）';
          }
          self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'success' });
          self.loadLevelInfo();
        }
      }).catch(function(err) {
        var resp = err.response && err.response.data;
        var msg = (resp && resp.message) || '签到失败';
        self.$store.commit('toast/SHOW_TOAST', { message: msg, type: 'error' });
      }).finally(function() {
        self.dailyLoginLoading = false;
      });
    },
    getNextStreakMilestone: function(currentStreak) {
      var milestones = [3, 7, 14, 30, 60, 99];
      for (var i = 0; i < milestones.length; i++) {
        if (currentStreak < milestones[i]) return milestones[i];
      }
      return 99;
    },
    selectAvatarColor: function(color) {
      var userId = this.user && this.user.user_id;
      if (!userId) return;
      this.avatarColor = color;
      helpers.setAvatarColor(userId, color);
      this.$store.commit('toast/SHOW_TOAST', { message: '头像颜色已更新', type: 'success' });
    },
    resetAvatarColor: function() {
      var userId = this.user && this.user.user_id;
      if (!userId) return;
      this.avatarColor = '';
      helpers.setAvatarColor(userId, '');
      this.$store.commit('toast/SHOW_TOAST', { message: '已恢复默认颜色', type: 'success' });
    }
  }
};
</script>

<style scoped>
.settings-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}

.settings-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.settings-sidebar {
  width: 200px;
  background: var(--sidebar-bg);
  border-right: 0.5px solid var(--separator-color);
  backdrop-filter: var(--glass-blur-container);
  -webkit-backdrop-filter: var(--glass-blur-container);
  padding: 16px 10px;
  flex-shrink: 0;
  overflow-y: auto;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  min-height: 44px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  color: var(--text-primary);
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
  text-align: left;
  width: 100%;
}

.nav-item:hover {
  background: var(--bg-color);
}

.nav-item:active {
  background: var(--border-color);
}

.nav-item.active {
  background: var(--primary-light);
  color: var(--primary-color);
  font-weight: var(--font-weight-medium);
}

.nav-icon {
  font-size: var(--font-size-callout);
  width: 20px;
  text-align: center;
  color: var(--text-secondary);
}

.nav-item.active .nav-icon {
  color: var(--primary-color);
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px 40px;
}

.settings-section {
  max-width: 640px;
}

.section-title {
  font-size: var(--font-size-title2);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.section-title-icon {
  font-size: var(--font-size-headline);
  color: var(--primary-color);
}

.form-card {
  background: var(--card-bg);
  border-radius: var(--radius-md);
  padding: 0 var(--spacing-md);
  margin: 0 var(--spacing-md) var(--spacing-md);
  box-shadow: none;
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px var(--spacing-sm);
  border-bottom: 0.5px solid var(--separator-color);
}

.form-row:last-of-type {
  border-bottom: none;
}

.form-label {
  font-size: var(--font-size-body);
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
  min-width: 100px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-row-icon {
  font-size: var(--font-size-footnote);
  color: var(--text-secondary);
  width: 18px;
  text-align: center;
}

.form-row-icon-danger {
  color: var(--danger-color);
}

.form-input {
  flex: 1;
  max-width: 360px;
  min-height: 44px;
  height: 44px;
  padding: 0 14px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-footnote);
  color: var(--text-primary);
  background: var(--bg-color);
  transition: border-color var(--duration-normal) var(--ease-standard), box-shadow var(--duration-normal) var(--ease-standard);
}

.form-input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.form-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.form-hint {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  padding: 6px 0 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.form-hint.hint-error {
  color: var(--danger-color);
}

.hint-icon {
  font-size: var(--font-size-caption2);
}

.form-actions {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.btn-primary {
  padding: 10px 24px;
  min-height: 44px;
  background: var(--primary-color);
  color: #FFFFFF;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  transition: background var(--duration-normal) var(--ease-standard), transform var(--duration-fast) var(--ease-standard), opacity var(--duration-fast) var(--ease-standard);
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.btn-primary:active:not(:disabled) {
  transform: scale(0.92);
  opacity: 0.7;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-icon {
  font-size: var(--font-size-footnote);
}

.btn-outline {
  padding: 8px 18px;
  min-height: 44px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-footnote);
  color: var(--text-primary);
  background: transparent;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-standard);
}

.btn-outline:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background: rgba(var(--primary-rgb), 0.05);
}

.btn-outline:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.btn-danger-outline {
  padding: 8px 18px;
  min-height: 44px;
  border: 0.5px solid rgba(var(--danger-rgb), 0.3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-footnote);
  color: var(--danger-color);
  background: transparent;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-standard);
}

.btn-danger-outline:hover {
  background: rgba(var(--danger-rgb), 0.06);
  border-color: var(--danger-color);
}

.btn-danger-outline:active {
  transform: scale(0.92);
  opacity: 0.7;
}

/* Toggle Group - iOS Segmented Control */
.toggle-group {
  display: flex;
  gap: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: rgba(118, 118, 128, 0.12);
  padding: 2px;
  border: none;
}

.toggle-btn {
  padding: 8px 20px;
  min-height: 40px;
  font-size: var(--font-size-footnote);
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: var(--radius-xs);
  transition: all var(--duration-fast) var(--ease-standard);
  flex: 1;
}

.toggle-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.toggle-btn.active {
  background: var(--card-bg);
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-sm);
}

/* Wallpaper Picker */
.wp-loading {
  text-align: center;
  padding: 20px;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.wp-tabs {
  display: flex;
  gap: 2px;
  background: rgba(118, 118, 128, 0.12);
  border-radius: var(--radius-sm);
  padding: 2px;
  margin-bottom: 12px;
  border: none;
}

.wp-tab {
  flex: 1;
  text-align: center;
  padding: 9px 10px;
  min-height: 40px;
  border-radius: var(--radius-xs);
  font-size: var(--font-size-footnote);
  font-weight: var(--font-weight-regular);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-standard);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  -webkit-user-select: none;
  user-select: none;
  background: transparent;
  border: none;
}

.wp-tab:hover {
  color: var(--text-primary);
}

.wp-tab:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.wp-tab.active {
  background: var(--card-bg);
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
  box-shadow: var(--shadow-sm);
}

.wp-tab i {
  font-size: var(--font-size-caption);
}

.wp-tab-count {
  font-size: var(--font-size-caption2);
  background: rgba(255, 255, 255, 0.25);
  padding: 0 5px;
  border-radius: var(--radius-sm);
  line-height: 16px;
  min-width: 16px;
}

.wp-tab.active .wp-tab-count {
  background: rgba(255, 255, 255, 0.3);
}

.wp-list {
  max-height: 360px;
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: var(--radius-md);
  border: 0.5px solid var(--separator-color);
  background: var(--bg-color);
  -webkit-overflow-scrolling: touch;
}

.wp-list::-webkit-scrollbar {
  width: 5px;
}

.wp-list::-webkit-scrollbar-track {
  background: transparent;
}

.wp-list::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: var(--radius-xs);
}

.wp-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 10px;
}

.wp-card {
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  background: var(--card-bg);
}

.wp-card:hover {
  border-color: var(--border-color);
  box-shadow: var(--shadow-sm);
}

.wp-card:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.wp-card.active {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 1px var(--primary-color), 0 2px 12px rgba(var(--primary-rgb), 0.25);
}

.wp-card-preview {
  width: 100%;
  height: 0;
  padding-bottom: 56.25%;
  position: relative;
  object-fit: cover;
}

.wp-card-preview-video {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wp-video-thumb {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.5;
}

.wp-video-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}

.wp-video-badge i {
  color: rgba(255, 255, 255, 0.9);
  font-size: var(--font-size-caption2);
  margin-left: 1px;
}

.wp-card-label {
  padding: 6px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
}

.wp-card-name {
  font-size: var(--font-size-caption);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.wp-card-check {
  color: var(--primary-color);
  font-size: var(--font-size-sm);
  flex-shrink: 0;
  margin-left: 4px;
}

.wp-empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.wp-empty-icon {
  font-size: var(--font-size-title1);
  color: var(--border-color);
  margin-bottom: 4px;
}

.wp-empty-hint {
  font-size: var(--font-size-caption2);
  color: var(--text-secondary);
  opacity: 0.7;
}

@media (max-width: 600px) {
  .wp-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .wp-list {
    max-height: 300px;
  }
}

@media (min-width: 900px) {
  .wp-grid {
    grid-template-columns: repeat(4, 1fr);
  }
  .wp-list {
    max-height: 420px;
  }
}

/* Switch */
.switch {
  position: relative;
  display: inline-block;
  width: 51px;
  height: 31px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(120, 120, 128, 0.16);
  border-radius: var(--radius-pill);
  transition: background var(--duration-normal) var(--ease-standard);
}

.switch-slider::before {
  content: '';
  position: absolute;
  height: 27px;
  width: 27px;
  left: 2px;
  bottom: 2px;
  background: #FFFFFF;
  border-radius: 50%;
  transition: transform var(--duration-normal) var(--ease-standard);
  box-shadow: var(--shadow-md);
}

.switch input:checked + .switch-slider {
  background: var(--success-color);
}

.switch input:checked + .switch-slider::before {
  transform: translateX(20px);
}

/* Data Management */
.data-info {
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--bg-color);
  border-radius: var(--radius-md);
  border: 0.5px solid var(--separator-color);
}

.data-info-text {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.data-info-icon {
  font-size: var(--font-size-sm);
  color: var(--primary-color);
  margin-top: 2px;
  flex-shrink: 0;
}

/* About */
.about-logo {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 0 24px;
  margin-bottom: 8px;
}

.about-logo-icon {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--primary-dark), var(--primary-color));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-title1);
  color: #FFFFFF;
  margin-bottom: 12px;
  box-shadow: 0 4px 16px rgba(var(--primary-rgb), 0.2);
}

.about-logo-text {
  font-size: var(--font-size-headline);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.about-item {
  display: flex;
  justify-content: space-between;
  padding: 14px 0;
  min-height: 44px;
  align-items: center;
  border-bottom: 0.5px solid var(--separator-color);
}

.about-item:last-of-type {
  border-bottom: none;
}

.about-label {
  font-size: var(--font-size-footnote);
  color: var(--text-secondary);
}

.about-value {
  font-size: var(--font-size-footnote);
  color: var(--text-primary);
  font-weight: var(--font-weight-medium);
}

/* 更新日志 */
.about-changelog {
  padding: 14px 0;
  border-bottom: 0.5px solid var(--separator-color);
}

.about-changelog-title {
  font-size: var(--font-size-footnote);
  color: var(--text-secondary);
  font-weight: var(--font-weight-medium);
  margin-bottom: 10px;
}

.about-changelog-list {
  max-height: 160px;
  overflow-y: auto;
}

.about-changelog-line {
  font-size: var(--font-size-caption);
  color: var(--text-primary);
  padding: 4px 0;
  line-height: 1.5;
  word-break: break-all;
}

.about-changelog-line::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary-color);
  margin-right: 8px;
  vertical-align: middle;
  flex-shrink: 0;
}

.about-footer {
  margin-top: 20px;
  text-align: center;
  padding-top: 16px;
  border-top: 0.5px solid var(--separator-color);
}

.check-update-btn {
  margin-bottom: 12px;
}

.about-copyright {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin: 0;
}

.admin-desc {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-bottom: 16px;
  line-height: 1.6;
}

/* Section transition */
.section-fade-enter-active,
.section-fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.section-fade-enter {
  opacity: 0;
  transform: translateX(10px);
}

.section-fade-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

/* 等级卡片 */
.level-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px;
  background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.06), rgba(var(--primary-rgb), 0.02));
  border-radius: var(--radius-lg);
  margin-bottom: 8px;
}

.level-card-icon {
  flex-shrink: 0;
}

.level-icon-lg {
  height: 48px;
  width: auto;
}

.level-card-info {
  flex: 1;
  min-width: 0;
}

.level-card-title {
  font-size: var(--font-size-headline);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin-bottom: 4px;
}

.level-card-exp {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.level-progress-bar {
  width: 100%;
  height: 8px;
  background: var(--border-color);
  border-radius: var(--radius-pill);
  overflow: hidden;
}

.level-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-color), var(--primary-color));
  border-radius: var(--radius-pill);
  transition: width var(--duration-slow) var(--ease-standard);
}

/* Form divider */
.form-divider {
  height: 0.5px;
  background: var(--separator-color);
  margin: 8px 0;
}

/* Form input group with privacy toggle */
.form-input-group {
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 360px;
  gap: 8px;
}

.form-input-group .form-input {
  flex: 1;
  max-width: none;
}

.privacy-toggle {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  border: 0.5px solid var(--separator-color);
  background: var(--bg-color);
  color: var(--text-secondary);
  font-size: var(--font-size-footnote);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
}

.privacy-toggle:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background: rgba(var(--primary-rgb), 0.05);
}

.privacy-toggle:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.privacy-toggle.private {
  color: var(--danger-color);
  border-color: rgba(var(--danger-rgb), 0.3);
  background: rgba(var(--danger-rgb), 0.05);
}

.privacy-toggle.private:hover {
  border-color: var(--danger-color);
  background: rgba(var(--danger-rgb), 0.1);
}

.daily-exp-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex: 1;
  max-width: 200px;
}

.daily-exp-value {
  font-size: var(--font-size-footnote);
  color: var(--text-secondary);
  font-weight: var(--font-weight-medium);
}

.daily-exp-bar {
  width: 100%;
  height: 6px;
  background: var(--border-color);
  border-radius: var(--radius-pill);
  overflow: hidden;
}

.daily-exp-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--warning-color), var(--danger-color));
  border-radius: var(--radius-pill);
  transition: width var(--duration-slow) var(--ease-standard);
}

.daily-login-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.streak-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: rgba(var(--warning-rgb), 0.12);
  border-radius: var(--radius-md);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-semibold);
  color: var(--warning-color);
}

.streak-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  margin: -4px 0 8px;
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}

.streak-bonus-text {
  color: var(--warning-color);
  font-weight: var(--font-weight-medium);
}

.streak-next-text {
  color: var(--text-tertiary);
}

.exp-rules-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.exp-rule-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  font-size: var(--font-size-caption);
}

.exp-rule-item i {
  color: var(--text-secondary);
  width: 14px;
  text-align: center;
  font-size: var(--font-size-caption2);
}

.exp-rule-name {
  flex: 1;
  color: var(--text-secondary);
}

.exp-rule-value {
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.exp-rules-note {
  margin-top: 8px;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  text-align: center;
}

.avatar-color-picker {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.color-swatch {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
}

.color-swatch:hover {
  transform: scale(1.15);
}

.color-swatch:active {
  transform: scale(0.92);
  opacity: 0.7;
}

.color-swatch.active {
  border-color: var(--text-primary);
  box-shadow: 0 0 0 2px var(--card-bg);
}

.custom-swatch {
  display: flex;
  align-items: center;
  justify-content: center;
  background: conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  position: relative;
  overflow: hidden;
}

.custom-swatch i {
  font-size: var(--font-size-caption2);
  color: #FFFFFF;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  position: relative;
  z-index: 1;
}

.color-input-hidden {
  position: absolute;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  top: 0;
  left: 0;
}

.color-reset-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 0.5px solid var(--separator-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-caption2);
  transition: background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard);
  flex-shrink: 0;
}

.color-reset-btn:hover {
  background: var(--border-color);
}

.color-reset-btn:active {
  transform: scale(0.92);
  opacity: 0.7;
}

@media (max-width: 768px) {
  .settings-body {
    flex-direction: column;
  }
  .settings-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 0.5px solid var(--separator-color);
    padding: 8px 12px;
  }
  .sidebar-nav {
    flex-direction: row;
    overflow-x: auto;
    gap: 2px;
    -webkit-overflow-scrolling: touch;
  }
  .nav-item {
    padding: 8px 12px;
    font-size: var(--font-size-sm);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .nav-label {
    display: inline;
  }
  .settings-content {
    padding: 20px 16px;
  }
  .settings-section {
    max-width: 100%;
  }
  .form-card {
    padding: 20px;
  }
  .form-row {
    flex-wrap: wrap;
    gap: 8px;
  }
  .form-input {
    max-width: 100%;
  }
  .form-input-group {
    max-width: 100%;
  }
}

@media (min-width: 769px) and (max-width: 1024px) {
  .settings-sidebar {
    width: 180px;
    padding: 12px 8px;
  }
  .nav-item {
    padding: 10px 12px;
    font-size: var(--font-size-sm);
  }
  .settings-content {
    padding: 24px 24px;
  }
  .settings-section {
    max-width: 100%;
  }
}

@media (min-width: 1025px) {
  .settings-section {
    max-width: 720px;
  }
}
</style>
