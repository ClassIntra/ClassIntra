<template>
  <div v-if="visible" class="cip-overlay" @click.self="onClose">
    <div class="cip-panel">
      <div class="cip-head">
        <h3 class="cip-title">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          从云盘选图
        </h3>
        <button class="cip-close" @click="onClose"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <div class="cip-search">
        <i class="fa-solid fa-magnifying-glass cip-search-icon"></i>
        <input v-model="keyword" class="cip-search-input" placeholder="搜索文件名…" />
        <button v-if="keyword" class="cip-search-clear" @click="keyword = ''"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <div class="cip-body scrollbar-thin">
        <div v-if="loading" class="cip-state"><i class="fa-solid fa-spinner fa-spin"></i><span>加载云盘…</span></div>
        <div v-else-if="error" class="cip-state cip-state--error"><i class="fa-solid fa-circle-exclamation"></i><span>{{ error }}</span></div>
        <div v-else-if="filtered.length === 0" class="cip-state">
          <i class="fa-solid fa-cloud"></i>
          <span>{{ keyword ? '没有匹配的图片' : '云盘里还没有图片，先去云盘上传几张吧' }}</span>
        </div>
        <div v-else class="cip-grid">
          <div
            v-for="f in filtered"
            :key="f.hash"
            class="cip-card"
            :class="{ selected: isSelected(f), disabled: !isSelected(f) && full }"
            @click="toggle(f)"
          >
            <div class="cip-thumb">
              <img :src="f.url + '?w=300'" :alt="f.name" loading="lazy" />
              <span v-if="isSelected(f)" class="cip-check"><i class="fa-solid fa-check"></i></span>
            </div>
            <div class="cip-name">{{ f.name }}</div>
          </div>
        </div>
      </div>

      <div class="cip-foot">
        <span class="cip-count">已选 {{ selected.length }} / {{ max }}</span>
        <div class="cip-foot-actions">
          <button class="cip-btn" @click="onClose">取消</button>
          <button class="cip-btn cip-btn--primary" :disabled="selected.length === 0" @click="onConfirm">
            加入对话<template v-if="selected.length">（{{ selected.length }}）</template>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

export default {
  name: 'CloudImagePicker',
  props: {
    visible: { type: Boolean, default: false },
    max: { type: Number, default: 4 }
  },
  data: function() {
    return {
      files: [],
      loading: false,
      error: '',
      keyword: '',
      selected: []
    };
  },
  computed: {
    filtered: function() {
      var kw = this.keyword.trim().toLowerCase();
      var list = this.files;
      if (kw) {
        list = list.filter(function(f) {
          return String(f.name || '').toLowerCase().indexOf(kw) > -1;
        });
      }
      return list;
    },
    full: function() {
      return this.selected.length >= this.max;
    }
  },
  watch: {
    visible: function(v) {
      if (v) this.load();
    }
  },
  methods: {
    load: function() {
      var self = this;
      self.loading = true;
      self.error = '';
      api.get('/cloud/files', { timeout: 15000 }).then(function(res) {
        var list = (res.data && res.data.data && res.data.data.files) || [];
        self.files = list.filter(function(f) {
          var m = String(f.mime_type || '').toLowerCase();
          return m.indexOf('image/') === 0;
        }).map(function(f) {
          return { hash: f.hash, name: f.display_name || f.name, url: f.url, size: f.size };
        });
      }).catch(function() {
        self.error = '读取云盘失败，请稍后重试';
      }).finally(function() {
        self.loading = false;
      });
    },
    isSelected: function(f) {
      for (var i = 0; i < this.selected.length; i++) {
        if (this.selected[i].hash === f.hash) return true;
      }
      return false;
    },
    toggle: function(f) {
      if (this.isSelected(f)) {
        this.selected = this.selected.filter(function(s) { return s.hash !== f.hash; });
        return;
      }
      if (this.full) return;
      this.selected.push(f);
    },
    onClose: function() {
      this.$emit('close');
    },
    onConfirm: function() {
      this.$emit('confirm', this.selected.slice());
      this.selected = [];
      this.keyword = '';
    }
  }
};
</script>

<style scoped>
.cip-overlay {
  position: fixed;
  /* 兼容红线：inset 简写需Chrome 87+，旧内核（Chrome 80 / Android 9 / 微信 X5）
     会整条忽略 —— 表现是遮罩「铺不满屏」或「位置不对」，且不报错。
     本项目的目标基线见 vite.config.js，必须写全四边。 */
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
  padding: 16px;
}
.cip-panel {
  width: 100%;
  max-width: 560px;
  max-height: 82vh;
  background: var(--bg-secondary, #1c1c1e);
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
}
.cip-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #fff);
  display: flex;
  align-items: center;
  gap: 8px;
}
.cip-close {
  background: none;
  border: none;
  color: var(--text-secondary, #9ca3af);
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
}
.cip-search {
  position: relative;
  margin: 0 16px 10px;
}
.cip-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--text-secondary, #9ca3af);
}
.cip-search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 30px 8px 30px;
  border-radius: 10px;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.06));
  color: var(--text-primary, #fff);
  font-size: 13px;
  outline: none;
}
.cip-search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-secondary, #9ca3af);
  cursor: pointer;
}
.cip-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px;
  -webkit-overflow-scrolling: touch;
}
.cip-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 34px 0;
  color: var(--text-secondary, #9ca3af);
  font-size: 13px;
}
.cip-state--error { color: var(--danger-color, #ef4444); }
.cip-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  padding-bottom: 10px;
}
.cip-card {
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.05));
  transition: border-color 0.15s;
}
.cip-card.selected { border-color: #6366f1; }
.cip-card.disabled { opacity: 0.4; }
.cip-thumb {
  position: relative;
  width: 100%;
  padding-top: 100%;
  background: #000;
}
.cip-thumb img {
  position: absolute;
  /* 同.cip-overlay：inset 简写需Chrome 87+，旧内核整条忽略 */
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cip-check {
  position: absolute;
  right: 5px;
  bottom: 5px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #6366f1;
  color: #fff;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cip-name {
  font-size: 11px;
  color: var(--text-secondary, #9ca3af);
  padding: 5px 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cip-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
}
.cip-count {
  font-size: 12px;
  color: var(--text-secondary, #9ca3af);
}
.cip-foot-actions { display: flex; gap: 8px; }
.cip-btn {
  padding: 7px 14px;
  border-radius: 9px;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
  background: transparent;
  color: var(--text-primary, #fff);
  font-size: 13px;
  cursor: pointer;
}
.cip-btn--primary {
  background: #6366f1;
  border-color: #6366f1;
  color: #fff;
}
.cip-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 480px) {
  .cip-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
