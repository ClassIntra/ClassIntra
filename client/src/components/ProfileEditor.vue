<template>
  <div class="pe-overlay" @click.self="$emit('close')">
    <div class="pe-sheet" @click.stop>
      <div class="pe-header">
        <span class="pe-title">编辑我的资料</span>
        <button class="pe-close" @click="$emit('close')" title="关闭"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <div class="pe-body scrollbar-thin">
        <div v-if="loading" class="pe-state"><i class="fa-solid fa-spinner fa-spin"></i><span>加载中...</span></div>

        <template v-else>
          <!-- ══ 头像 ══ -->
          <section class="pe-section">
            <h3 class="pe-section-title">头像</h3>
            <div class="pe-avatar-row">
              <UserAvatar :user-id="userId" :name="profileName" :avatar="avatar" :size="64" />
              <div class="pe-avatar-side">
                <div class="pe-btn-row">
                  <button class="pe-btn" @click="showAvatarCropper = true">
                    <i class="fa-solid fa-cloud-arrow-up"></i>
                    {{ avatar && avatar.has_avatar ? '重新裁选' : '从云盘选择' }}
                  </button>
                  <button v-if="avatar && avatar.has_avatar" class="pe-btn pe-btn-ghost" @click="removeAvatar">
                    <i class="fa-solid fa-rotate-left"></i> 恢复文字头像
                  </button>
                </div>
                <div class="pe-color-row">
                  <span class="pe-color-label">底色</span>
                  <div
                    v-for="color in avatarPresets"
                    :key="color"
                    class="pe-swatch"
                    :class="{ active: avatarColor === color }"
                    :style="{ background: color }"
                    @click="selectAvatarColor(color)"
                  ></div>
                  <label class="pe-swatch pe-swatch-custom" :class="{ active: avatarColor && avatarPresets.indexOf(avatarColor) === -1 }">
                    <input type="color" :value="avatarColor || '#007AFF'" @input="selectAvatarColor($event.target.value)" class="pe-color-input">
                    <i class="fa-solid fa-palette"></i>
                  </label>
                  <button v-if="avatarColor" class="pe-color-reset" @click="resetAvatarColor" title="恢复默认底色">
                    <i class="fa-solid fa-rotate-left"></i>
                  </button>
                </div>
                <p class="pe-hint">没有图片头像时，用「首字符 + 底色」显示。</p>
              </div>
            </div>
          </section>

          <!-- ══ 封面 ══ -->
          <section class="pe-section">
            <h3 class="pe-section-title">主页封面</h3>
            <div class="pe-cover-row">
              <div class="pe-cover-preview" :class="{ empty: !cover.has_cover }">
                <img v-if="cover.has_cover" :src="cover.url" alt="" draggable="false" />
                <i v-else class="fa-regular fa-image"></i>
              </div>
              <div class="pe-cover-side">
                <div class="pe-btn-row">
                  <button class="pe-btn" @click="showCoverCropper = true">
                    <i class="fa-solid fa-crop-simple"></i>
                    {{ cover.has_cover ? '更换封面' : '设置封面' }}
                  </button>
                  <button v-if="cover.has_cover" class="pe-btn pe-btn-ghost" @click="removeCover">
                    <i class="fa-solid fa-trash-can"></i> 移除
                  </button>
                </div>
                <p class="pe-hint">从云盘选图，可缩放拖动裁成横幅。建议用横向的风景或合照。</p>
              </div>
            </div>
          </section>

          <!-- ══ 个人签名 ══ -->
          <section class="pe-section">
            <h3 class="pe-section-title">个人签名</h3>
            <input v-model="form.signature" class="pe-input" placeholder="一句话介绍自己" maxlength="100" />
          </section>

          <!-- ══ 资料（含隐私开关）══ -->
          <section class="pe-section">
            <h3 class="pe-section-title">
              资料
              <span class="pe-section-note">带锁的字段仅自己可见</span>
            </h3>

            <div class="pe-field">
              <label class="pe-label">生日</label>
              <div class="pe-control">
                <input
                  v-model="form.birthday"
                  type="date"
                  class="pe-input"
                  :disabled="birthdayLocked"
                  :title="birthdayLocked ? '本月已修改过生日（' + lastBirthdayChangeText + '），请下个月再试' : ''"
                />
                <button class="pe-lock" :class="{ private: form.birthday_private }" @click="togglePrivacy('birthday')" :title="form.birthday_private ? '当前仅自己可见，点击公开' : '当前公开可见，点击设为私密'">
                  <i :class="form.birthday_private ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
                </button>
              </div>
              <p v-if="birthdayLocked" class="pe-hint pe-hint-warn">生日每月只能改一次，上次修改于 {{ lastBirthdayChangeText }}。</p>
            </div>

            <div class="pe-field">
              <label class="pe-label">微信号</label>
              <div class="pe-control">
                <input v-model="form.wechat" class="pe-input" placeholder="选填" maxlength="60" />
                <button class="pe-lock" :class="{ private: form.wechat_private }" @click="togglePrivacy('wechat')" :title="form.wechat_private ? '当前仅自己可见，点击公开' : '当前公开可见，点击设为私密'">
                  <i :class="form.wechat_private ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
                </button>
              </div>
            </div>

            <div class="pe-field">
              <label class="pe-label">QQ 号</label>
              <div class="pe-control">
                <input v-model="form.qq" class="pe-input" placeholder="选填，同学可在你主页一键复制" maxlength="30" />
                <button class="pe-lock" :class="{ private: form.qq_private }" @click="togglePrivacy('qq')" :title="form.qq_private ? '当前仅自己可见，点击公开' : '当前公开可见，点击设为私密'">
                  <i :class="form.qq_private ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
                </button>
              </div>
            </div>

            <div class="pe-field">
              <label class="pe-label">手机号</label>
              <div class="pe-control">
                <input v-model="form.phone" class="pe-input" placeholder="选填" maxlength="30" />
                <button class="pe-lock" :class="{ private: form.phone_private }" @click="togglePrivacy('phone')" :title="form.phone_private ? '当前仅自己可见，点击公开' : '当前公开可见，点击设为私密'">
                  <i :class="form.phone_private ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
                </button>
              </div>
            </div>

            <div class="pe-field">
              <label class="pe-label">住址</label>
              <div class="pe-control">
                <input v-model="form.address" class="pe-input" placeholder="选填" maxlength="100" />
                <button class="pe-lock" :class="{ private: form.address_private }" @click="togglePrivacy('address')" :title="form.address_private ? '当前仅自己可见，点击公开' : '当前公开可见，点击设为私密'">
                  <i :class="form.address_private ? 'fa-solid fa-lock' : 'fa-solid fa-lock-open'"></i>
                </button>
              </div>
            </div>

            <div class="pe-field pe-field-inline">
              <label class="pe-label">真实姓名仅自己可见</label>
              <button class="pe-switch" :class="{ on: form.hide_real_name }" @click="form.hide_real_name = !form.hide_real_name">
                <span class="pe-switch-knob"></span>
              </button>
            </div>
          </section>
        </template>
      </div>

      <div class="pe-footer">
        <button class="pe-btn" @click="$emit('close')">取消</button>
        <button class="pe-btn pe-btn-primary" :disabled="saving || loading" @click="save">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>

    <!-- 头像裁剪（圆形 1:1） -->
    <ImageCropper
      v-if="showAvatarCropper"
      endpoint="/user/avatar"
      :aspect="1"
      shape="circle"
      crop-title="裁选头像"
      :start-at="avatar && avatar.hash ? 'crop' : 'pick'"
      tip="拖动图片调整位置；滑动条或双指捏合调整大小。裁出来的就是别人看到的圆形头像。"
      :initial-hash="avatar && avatar.hash ? avatar.hash : ''"
      :initial-crop="avatar && avatar.crop ? avatar.crop : null"
      @close="showAvatarCropper = false"
      @saved="onAvatarSaved"
      @error="onCropperError"
    />

    <!-- 封面裁剪（横幅） -->
    <ImageCropper
      v-if="showCoverCropper"
      endpoint="/user/cover"
      :aspect="COVER_ASPECT"
      :stage-base="400"
      shape="rect"
      crop-title="裁选封面"
      tip="拖动调整位置，滑动条或双指缩放。建议用横向的风景或合照。"
      :initial-hash="cover && cover.hash ? cover.hash : ''"
      :initial-crop="cover && cover.crop ? cover.crop : null"
      @close="showCoverCropper = false"
      @saved="onCoverSaved"
      @error="onCropperError"
    />
  </div>
</template>

<script>
import api from '@/utils/api';
import helpers from '@/utils/helpers';
import UserAvatar from '@/components/UserAvatar.vue';
import ImageCropper from '@/components/ImageCropper.vue';
import { COVER_ASPECT } from '@/utils/avatar-crop';
import { invalidate as invalidateAvatarCache } from '@/utils/avatar-store';

// 资料编辑面板：从设置页搬过来的所有「自定义」项目。
// 为什么不放回设置页 —— 用户明确要求设置页只留身份基础信息（网名/姓名/ID/性别/注册时间），
// 头像、封面、签名、联系方式、隐私开关都属于「个人主页长什么样」，在主页里改更直观。
export default {
  name: 'ProfileEditor',
  components: { UserAvatar: UserAvatar, ImageCropper: ImageCropper },
  props: {
    userId: { type: [String, Number], default: '' }
  },
  data: function() {
    return {
      COVER_ASPECT: COVER_ASPECT,
      loading: true,
      saving: false,
      avatarPresets: helpers.AVATAR_PRESETS,

      profileName: '',
      avatarColor: '',
      avatar: { has_avatar: false, hash: '', crop: { zoom: 1, ox: 0, oy: 0 } },
      cover: { has_cover: false, hash: '', crop: { zoom: 1, ox: 0, oy: 0 }, url: '' },

      form: {
        birthday: '', wechat: '', qq: '', phone: '', address: '', signature: '',
        birthday_private: true, wechat_private: true, qq_private: true,
        phone_private: true, address_private: true, hide_real_name: false
      },
      birthdayLocked: false,
      lastBirthdayChangeText: '',

      showAvatarCropper: false,
      showCoverCropper: false
    };
  },
  mounted: function() {
    this.load();
  },
  methods: {
    load: function() {
      var self = this;
      self.loading = true;
      api.get('/community/profile').then(function(res) {
        var data = (res.data && res.data.data) || {};
        var privacy = data.privacy_settings || {};
        self.profileName = data.net_name || '';
        self.form.birthday = data.birthday || '';
        self.form.wechat = data.wechat || '';
        self.form.qq = data.qq || '';
        self.form.phone = data.phone || '';
        self.form.address = data.address || '';
        self.form.signature = data.signature || '';
        // 后端语义：privacy_settings[field] === true 表示「仅自己可见」。
        // ⚠️ 必须用 === true 而不是 !== false：键不存在时后端会**当作公开**
        //    （`if (!privacy[field]) 显示`），旧设置页写成 !== false 会让界面显示
        //    「已上锁」而实际是公开的 —— 那种"以为锁了其实没锁"最危险。
        self.form.birthday_private = privacy.birthday === true;
        self.form.wechat_private = privacy.wechat === true;
        self.form.qq_private = privacy.qq === true;
        self.form.phone_private = privacy.phone === true;
        self.form.address_private = privacy.address === true;
        self.form.hide_real_name = privacy.hide_real_name === true;

        // 生日每月只能改一次
        self.birthdayLocked = false;
        self.lastBirthdayChangeText = '';
        if (data.last_birthday_change) {
          var lc = new Date(data.last_birthday_change);
          var now = new Date();
          if (lc.getFullYear() === now.getFullYear() && lc.getMonth() === now.getMonth()) {
            self.birthdayLocked = true;
            self.lastBirthdayChangeText = (lc.getMonth() + 1) + '月' + lc.getDate() + '日';
          }
        }
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '资料加载失败', type: 'error' });
      }).then(function() {
        self.loading = false;
        self.loadAvatar();
        self.loadCover();
        self.loadAvatarColor();
      });
    },

    loadAvatar: function() {
      var self = this;
      api.get('/user/avatar').then(function(res) {
        var d = (res.data && res.data.data) || {};
        self.avatar = { has_avatar: !!d.has_avatar, hash: d.hash || '', crop: d.crop || { zoom: 1, ox: 0, oy: 0 } };
      }).catch(function() {});
    },
    loadCover: function() {
      var self = this;
      api.get('/user/cover').then(function(res) {
        var d = (res.data && res.data.data) || {};
        self.cover = { has_cover: !!d.has_cover, hash: d.hash || '', crop: d.crop || { zoom: 1, ox: 0, oy: 0 }, url: d.url || '' };
      }).catch(function() {});
    },
    loadAvatarColor: function() {
      var self = this;
      helpers.syncAvatarColorFromServer(self.userId).then(function(color) {
        self.avatarColor = color || '';
      });
    },

    // ---- 头像 / 封面 ----
    onAvatarSaved: function(payload) {
      this.avatar = { has_avatar: true, hash: payload.hash, crop: payload.crop };
      invalidateAvatarCache(this.userId);
      this.showAvatarCropper = false;
      this.$store.commit('toast/SHOW_TOAST', { message: '头像已更新', type: 'success' });
    },
    removeAvatar: function() {
      var self = this;
      api.delete('/user/avatar').then(function() {
        self.avatar = { has_avatar: false, hash: '', crop: { zoom: 1, ox: 0, oy: 0 } };
        invalidateAvatarCache(self.userId);
        self.$store.commit('toast/SHOW_TOAST', { message: '已恢复文字头像', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '操作失败，请稍后重试', type: 'error' });
      });
    },
    onCoverSaved: function(payload) {
      this.cover = { has_cover: true, hash: payload.hash, crop: payload.crop, url: '/api/cloud/files/' + payload.hash + '?w=720' };
      this.showCoverCropper = false;
      this.$store.commit('toast/SHOW_TOAST', { message: '封面已更新', type: 'success' });
    },
    removeCover: function() {
      var self = this;
      api.delete('/user/cover').then(function() {
        self.cover = { has_cover: false, hash: '', crop: { zoom: 1, ox: 0, oy: 0 }, url: '' };
        self.$store.commit('toast/SHOW_TOAST', { message: '封面已移除', type: 'success' });
      }).catch(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '操作失败，请稍后重试', type: 'error' });
      });
    },
    onCropperError: function(msg) {
      this.$store.commit('toast/SHOW_TOAST', { message: msg || '保存失败', type: 'error' });
    },

    // ---- 底色 ----
    selectAvatarColor: function(color) {
      this.avatarColor = color;
      helpers.setAvatarColor(this.userId, color);
    },
    resetAvatarColor: function() {
      this.avatarColor = '';
      helpers.setAvatarColor(this.userId, '');
    },

    // ---- 隐私开关 ----
    togglePrivacy: function(field) {
      var key = field + '_private';
      this.form[key] = !this.form[key];
    },

    // ---- 保存 ----
    save: function() {
      var self = this;
      if (self.saving) return;
      self.saving = true;
      var payload = {
        birthday: self.form.birthday,
        wechat: self.form.wechat.trim(),
        qq: self.form.qq.trim(),
        phone: self.form.phone.trim(),
        address: self.form.address.trim(),
        signature: self.form.signature.trim(),
        // ⚠️ 后端会把 privacy_settings **整体替换**（不是 merge），
        // 所以这里必须把所有键都带上，否则 hide_real_name 之类的会被悄悄清掉。
        privacy_settings: {
          birthday: self.form.birthday_private,
          wechat: self.form.wechat_private,
          qq: self.form.qq_private,
          phone: self.form.phone_private,
          address: self.form.address_private,
          hide_real_name: self.form.hide_real_name
        }
      };
      api.put('/community/profile', payload).then(function() {
        self.$store.commit('toast/SHOW_TOAST', { message: '资料已保存', type: 'success' });
        self.$emit('saved');
        self.$emit('close');
      }).catch(function(err) {
        var resp = err.response && err.response.data;
        self.$store.commit('toast/SHOW_TOAST', { message: (resp && resp.message) || '保存失败', type: 'error' });
      }).then(function() {
        self.saving = false;
      });
    }
  }
};
</script>

<style scoped>
.pe-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: var(--z-modal, 10001);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.pe-sheet {
  width: 560px;
  max-width: 100%;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-color, #fff);
  border-radius: var(--radius-lg, 16px);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.pe-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
}

.pe-title {
  flex: 1;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
  text-align: center;
}

.pe-close {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--radius-sm, 8px);
  background: transparent;
  color: var(--text-secondary);
  font-size: 15px;
  cursor: pointer;
}
.pe-close:hover { background: var(--primary-lighter); color: var(--text-primary); }

.pe-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 18px 8px;
  min-height: 0;
}

.pe-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 44px 16px;
  color: var(--text-tertiary);
  font-size: var(--font-size-caption1);
}
.pe-state i { font-size: 24px; }

.pe-section {
  padding: 14px 0;
  border-bottom: 0.5px solid var(--separator-color);
}
.pe-section:last-child { border-bottom: 0; }

.pe-section-title {
  margin: 0 0 10px;
  font-size: var(--font-size-caption1);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.pe-section-note {
  font-size: var(--font-size-caption2);
  font-weight: var(--font-weight-regular, 400);
  color: var(--text-tertiary);
}

/* ---- 头像 ---- */
.pe-avatar-row { display: flex; align-items: flex-start; gap: 14px; }
.pe-avatar-side { flex: 1; min-width: 0; }

.pe-btn-row { display: flex; flex-wrap: wrap; gap: 8px; }

.pe-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 13px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md, 10px);
  background: var(--surface-elevated, transparent);
  color: var(--text-secondary);
  font-size: var(--font-size-footnote, 14px);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-standard);
}
.pe-btn:active { opacity: 0.8; }
.pe-btn-ghost { color: var(--text-tertiary); }

.pe-btn-primary {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
}
.pe-btn:disabled { opacity: 0.55; cursor: default; }

.pe-color-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.pe-color-label {
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  margin-right: 0;
}

.pe-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
  transition: transform var(--duration-fast) var(--ease-standard);
}
.pe-swatch.active { border-color: var(--text-primary); }
.pe-swatch:active { transform: scale(0.92); }

.pe-swatch-custom {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-lighter);
  color: var(--text-secondary);
  font-size: 10px;
  position: relative;
  overflow: hidden;
}

.pe-color-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
  border: 0;
  padding: 0;
}

.pe-color-reset {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0.5px solid var(--separator-color);
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 9px;
  cursor: pointer;
}

/* ---- 封面 ---- */
.pe-cover-row { display: flex; align-items: flex-start; gap: 14px; }

.pe-cover-preview {
  width: 180px;
  height: 56px;
  flex-shrink: 0;
  border-radius: var(--radius-sm, 8px);
  overflow: hidden;
  background: var(--primary-lighter);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 18px;
}
.pe-cover-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.pe-cover-side { flex: 1; min-width: 0; }

/* ---- 字段 ---- */
.pe-field { margin-bottom: 10px; }
.pe-field:last-child { margin-bottom: 0; }

.pe-field-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
}

.pe-label {
  display: block;
  margin-bottom: 5px;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
}
.pe-field-inline .pe-label { margin-bottom: 0; }

.pe-control { display: flex; align-items: center; gap: 8px; }

.pe-input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md, 10px);
  /* 用 --bg-color（与设置页输入框一致）：--bg-secondary 在部分主题下没定义，
     兜底值 #f7f7f9 会让深色模式里出现白底白字的输入框 */
  background: var(--bg-color);
  color: var(--text-primary);
  font-size: var(--font-size-footnote, 14px);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-standard);
}
.pe-input:focus { border-color: var(--primary-color); }
.pe-input:disabled { opacity: 0.55; }

.pe-lock {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md, 10px);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 13px;
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-standard);
}
.pe-lock.private {
  color: var(--primary-color);
  border-color: rgba(0, 122, 255, 0.35);
  background: var(--primary-lighter);
}

/* 开关 */
.pe-switch {
  position: relative;
  width: 46px;
  height: 28px;
  flex-shrink: 0;
  border: 0;
  border-radius: var(--radius-pill, 999px);
  background: var(--separator-color);
  cursor: pointer;
  transition: background var(--duration-normal) var(--ease-standard);
}
.pe-switch.on { background: var(--primary-color); }

.pe-switch-knob {
  position: absolute;
  left: 3px;
  top: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform var(--duration-normal) var(--ease-standard);
}
.pe-switch.on .pe-switch-knob { transform: translateX(18px); }

.pe-hint {
  margin: 7px 0 0;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  line-height: 1.55;
}
.pe-hint-warn { color: var(--warning-color, #FF9500); }

/* ---- 底部 ---- */
.pe-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px;
  border-top: 0.5px solid var(--separator-color);
  flex-shrink: 0;
}
</style>
