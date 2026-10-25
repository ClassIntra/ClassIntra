<template>
  <div>
    <!-- 第一步：直接复用全站统一的云盘选图（底部滑出，带搜索/分组/「当前」角标）。
         关键：**不再自己实现一套列表** —— 之前那套把 128 张图自己加载了一遍，
         而且样式和聊天/社区里的选图不一致（一个居中浮窗、一个从底下滑出来）。 -->
    <CloudImagePicker
      v-if="step === 'pick'"
      media-type="image"
      :current-hash="initialHash"
      @select="onPick"
      @close="onPickerClose"
    />

    <!-- 第二步：裁选（同样底部滑出，保持同一套视觉语言） -->
    <div v-else class="ic-overlay" @click.self="$emit('close')">
      <div class="ic-sheet" :style="{ maxWidth: (stageW + 64) + 'px' }" @click.stop>
        <div class="ic-header">
          <button class="ic-back" @click="step = 'pick'" title="重新选择">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <span class="ic-title">{{ cropTitle }}</span>
          <button class="ic-close" @click="$emit('close')" title="关闭">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="ic-body">
          <div
            ref="stage"
            class="ic-stage"
            :style="{ width: stageW + 'px', height: stageH + 'px' }"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <img
              ref="image"
              class="ic-img"
              :src="imageUrl"
              :style="imageStyle"
              draggable="false"
              @load="onImageLoad"
            />
            <!-- 圆形参考环：头像才需要告诉用户"裁出来是个圆" -->
            <div v-if="shape === 'circle'" class="ic-ring" :style="ringStyle"></div>
            <div v-else class="ic-grid-guide"></div>
          </div>

          <div class="ic-zoom-row">
            <i class="fa-solid fa-image"></i>
            <input v-model.number="zoom" class="ic-zoom" type="range" :min="1" :max="maxZoom" step="0.01" />
            <i class="fa-solid fa-up-right-and-down-left-from-center"></i>
          </div>
          <p class="ic-tip">{{ tip }}</p>
        </div>

        <div class="ic-actions">
          <button class="ic-btn" @click="step = 'pick'">换一张</button>
          <button class="ic-btn ic-btn-primary" :disabled="saving" @click="confirm">{{ saving ? '保存中...' : '确定' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';
import CloudImagePicker from '@/components/CloudImagePicker.vue';
import { computeCropTransform, offsetFromPixelDelta, normalizeCrop } from '@/utils/avatar-crop';

// 通用「云盘选图 → 缩放裁选 → 保存」。
// 头像（圆形 1:1）与个人封面（矩形横幅）共用：差别只在 aspect/shape/舞台尺寸和保存接口。
//
// ⚠️ 2026-10-24 重做：
//   1. 选图交给共享的 CloudImagePicker（全站统一底部滑出，搜索/分组/空态都不用再写一遍）；
//   2. 默认**先进选图**而不是直接进裁剪。之前用 initialHash 判断"已有图就跳裁剪"，
//      结果用户点「更换封面」只看到一张裁剪台、找不到云盘列表，误以为"选不了封面"；
//   3. 想直接调裁切就传 start-at="crop"（头像的「重新裁选」用）。
export default {
  name: 'ImageCropper',
  components: { CloudImagePicker: CloudImagePicker },
  props: {
    // 容器宽高比（宽/高），决定裁剪舞台形状
    aspect: { type: Number, default: 1 },
    // circle = 圆形参考环（头像）；rect = 直角横幅（封面）
    shape: { type: String, default: 'circle' },
    cropTitle: { type: String, default: '缩放裁选' },
    tip: { type: String, default: '拖动图片调整位置；滑动条或双指捏合调整大小。' },
    // 保存接口，如 '/user/avatar' / '/user/cover'
    endpoint: { type: String, required: true },
    // 舞台基准边长（短边），长边按 aspect 推算
    stageBase: { type: Number, default: 260 },
    maxZoom: { type: Number, default: 4 },
    // 当前已设的图（用于选中项高亮 + 起手裁切参数）
    initialHash: { type: String, default: '' },
    initialCrop: { type: Object, default: null },
    // 'pick'（默认，先选图）| 'crop'（直接调现有图的裁切）
    startAt: { type: String, default: 'pick' }
  },
  data: function() {
    return {
      step: 'pick',
      file: null,
      crop: { zoom: 1, ox: 0, oy: 0 },
      zoom: 1,
      naturalWidth: 0,
      naturalHeight: 0,
      saving: false,
      pointers: {}
    };
  },
  computed: {
    stageW: function() {
      return this.aspect >= 1 ? this.stageBase : Math.round(this.stageBase * this.aspect);
    },
    stageH: function() {
      return this.aspect >= 1 ? Math.round(this.stageBase / this.aspect) : this.stageBase;
    },
    ringStyle: function() {
      // 圆环取舞台短边的 92%，留一点边让用户看到"超出的部分会被裁掉"
      var d = Math.round(Math.min(this.stageW, this.stageH) * 0.92);
      return { width: d + 'px', height: d + 'px', margin: (-d / 2) + 'px 0 0 ' + (-d / 2) + 'px' };
    },
    imageUrl: function() {
      // 裁剪预览用 512 档：舞台 ≤340px，2x 屏也够清晰，且比原图小一个数量级
      return this.file ? this.file.url + '?w=512' : '';
    },
    imageStyle: function() {
      if (!this.naturalWidth || !this.naturalHeight) return { opacity: 0 };
      return {
        opacity: 1,
        transform: 'translate(-50%, -50%) ' + computeCropTransform(this.naturalWidth, this.naturalHeight, this.stageW, this.stageH, this.crop)
      };
    }
  },
  watch: {
    zoom: function(v) {
      var z = parseFloat(v);
      if (!isFinite(z)) return;
      this.crop = normalizeCrop({ zoom: z, ox: this.crop.ox, oy: this.crop.oy });
    }
  },
  mounted: function() {
    // 只有显式要求「直接调裁切」且确实已有图时才跳过选图
    if (this.startAt === 'crop' && this.initialHash) {
      this.file = { hash: this.initialHash, url: '/api/cloud/files/' + this.initialHash };
      this.crop = normalizeCrop(this.initialCrop || { zoom: 1, ox: 0, oy: 0 });
      this.zoom = this.crop.zoom;
      this.step = 'crop';
    }
  },
  methods: {
    onPick: function(file) {
      if (!file) return;
      this.file = file;
      // 沿用旧裁切参数（换图时给个熟悉的起点），没有就用默认
      var prev = this.initialCrop;
      this.crop = normalizeCrop(prev || { zoom: 1, ox: 0, oy: 0 });
      this.zoom = this.crop.zoom;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.step = 'crop';
    },
    // ⚠️ CloudImagePicker 的 selectFile 会**先 emit select 再 emit close**，
    //    如果这里无条件把 close 透传出去，父组件会在选完图的同一帧把整个裁剪器关掉，
    //    用户根本看不到裁剪台。所以只在"选图前被关掉"时才代表用户取消了。
    onPickerClose: function() {
      if (this.step !== 'pick') return;
      this.$emit('close');
    },
    onImageLoad: function(e) {
      this.naturalWidth = e.target.naturalWidth;
      this.naturalHeight = e.target.naturalHeight;
    },
    // ---- 拖动 / 捏合 ----
    onPointerDown: function(e) {
      // setPointerCapture 让指针移出舞台也继续收事件，拖到一半不会"断手"
      if (e.target.setPointerCapture) {
        try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
      }
      this.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: function(e) {
      var p = this.pointers[e.pointerId];
      if (!p) return;
      var dx = e.clientX - p.x;
      var dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;

      var ids = Object.keys(this.pointers);
      if (ids.length >= 2) {
        // 双指 = 捏合缩放：用两指间距的变化比例
        var a = this.pointers[ids[0]];
        var b = this.pointers[ids[1]];
        var dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (this._pinchDist) {
          var ratio = dist / this._pinchDist;
          this.zoom = Math.min(this.maxZoom, Math.max(1, this.zoom * ratio));
        }
        this._pinchDist = dist;
        return;
      }
      if (!this.naturalWidth || !this.naturalHeight) return;
      this.crop = offsetFromPixelDelta(this.naturalWidth, this.naturalHeight, this.stageW, this.stageH, this.crop, dx, dy);
    },
    onPointerUp: function(e) {
      delete this.pointers[e.pointerId];
      if (Object.keys(this.pointers).length < 2) this._pinchDist = 0;
    },
    confirm: function() {
      var self = this;
      if (!self.file || self.saving) return;
      self.saving = true;
      api.put(self.endpoint, {
        hash: self.file.hash,
        crop: normalizeCrop(self.crop)
      }).then(function() {
        self.$emit('saved', { hash: self.file.hash, crop: normalizeCrop(self.crop) });
        self.$emit('close');
      }).catch(function(err) {
        var msg = (err.response && err.response.data && err.response.data.message) || '保存失败，请稍后重试';
        self.$emit('error', msg);
      }).then(function() {
        self.saving = false;
      });
    }
  }
};
</script>

<style scoped>
/* 与 CloudImagePicker 完全一致的容器语言：底部滑出、上圆角、半透明遮罩 */
.ic-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 10002;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.ic-sheet {
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--card-bg);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  animation: icSlideUp 0.3s ease;
}

@keyframes icSlideUp {
  from { transform: translateY(100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.ic-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.ic-title {
  flex: 1;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: center;
}

.ic-back, .ic-close {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--radius-sm, 8px);
  background: transparent;
  color: var(--text-secondary);
  font-size: 15px;
  cursor: pointer;
}
.ic-back:hover, .ic-close:hover { background: var(--primary-lighter); color: var(--text-primary); }

.ic-body {
  padding: 18px 20px 4px;
  overflow-y: auto;
}

.ic-stage {
  position: relative;
  margin: 0 auto;
  overflow: hidden;
  background: #000;
  border-radius: var(--radius-md, 10px);
  /* 关键：别让浏览器把拖图当成"拖动图片"原生行为 */
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  cursor: grab;
}

.ic-stage:active { cursor: grabbing; }

.ic-img {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  transform-origin: center center;
  will-change: transform;
}

/* 圆形参考环：告诉用户"裁出来是个圆" */
.ic-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  border-radius: 50%;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.85);
  pointer-events: none;
}

/* 三分构图参考线：裁横幅封面时比圆环更有用 */
.ic-grid-guide {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.28) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.28) 1px, transparent 1px);
  background-size: 33.333% 33.333%;
  background-position: 33.333% 0, 0 33.333%;
  background-repeat: repeat-x, repeat-y;
}

.ic-zoom-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.ic-zoom {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  /* 2px 归到 --radius-xs（规范：等距取小） */
  border-radius: var(--radius-xs, 2px);
  background: var(--primary-lighter);
  outline: none;
}

.ic-zoom::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--primary-color);
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.ic-tip {
  margin: 10px 0 0;
  font-size: var(--font-size-caption2);
  color: var(--text-tertiary);
  line-height: 1.6;
  text-align: center;
}

.ic-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.ic-btn {
  min-height: 40px;
  padding: 0 18px;
  border: 0.5px solid var(--separator-color);
  border-radius: var(--radius-md, 10px);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.ic-btn:hover { background: var(--primary-lighter); color: var(--text-primary); }

.ic-btn-primary {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: #fff;
}

.ic-btn-primary:hover { background: var(--primary-color); color: #fff; opacity: 0.9; }

.ic-btn:disabled { opacity: 0.5; cursor: default; }
</style>
