<template>
  <div class="draw-canvas" :class="['draw-canvas--' + mode, { 'is-annotating': annotating }]" ref="root">
    <!-- ================================================================== -->
    <!--  全屏画板模式：左侧纵向工具条 + 右侧画布区                         -->
    <!-- ================================================================== -->
    <div v-if="mode === 'full'" class="dc-full-layout">
      <!-- 左侧工具条 -->
      <div class="dc-sidebar">
        <button v-for="tool in visibleTools" :key="tool.id" class="dc-side-btn" :class="{ active: activeTool === tool.id }" @click="setTool(tool.id)" :title="tool.name">
          <i class="fa-solid" :class="tool.icon"></i>
        </button>
        <div class="dc-side-sep"></div>
        <button v-for="bt in brushTypes" :key="bt.id" class="dc-side-btn dc-side-btn--sm" :class="{ active: activeTool === 'brush' && brushType === bt.id }" @click="activeTool = 'brush'; brushType = bt.id" :title="bt.name">
          <i class="fa-solid" :class="bt.icon"></i>
        </button>
        <div class="dc-side-sep"></div>
        <button class="dc-side-btn" @click="triggerImageImport" title="导入图片"><i class="fa-solid fa-image"></i></button>
        <button class="dc-side-btn" :class="{ active: showGrid }" @click="toggleGrid" title="网格"><i class="fa-solid fa-border-all"></i></button>
        <button class="dc-side-btn" :class="{ active: snapToGrid }" @click="snapToGrid = !snapToGrid" title="吸附"><i class="fa-solid fa-magnet"></i></button>
        <button class="dc-side-btn" :class="{ active: showGuides }" @click="showGuides = !showGuides" title="参考线"><i class="fa-solid fa-grip-lines"></i></button>
        <input type="file" ref="imageInput" accept="image/*" style="display:none" @change="onImageImport" />
        <div class="dc-side-spacer"></div>
        <button class="dc-side-btn" @click="undo" :disabled="historyIdx <= 0" title="撤销"><i class="fa-solid fa-rotate-left"></i></button>
        <button class="dc-side-btn" @click="redo" :disabled="historyIdx >= history.length - 1" title="重做"><i class="fa-solid fa-rotate-right"></i></button>
      </div>

      <!-- 右侧主体 -->
      <div class="dc-main">
        <div class="dc-options-bar">
          <label class="dc-color-wrap"><input type="color" v-model="color" class="dc-color-input" /><span class="dc-color-preview" :style="{ background: color }"></span></label>
          <div class="dc-preset-colors"><span v-for="c in presetColors" :key="c" class="dc-preset-color" :style="{ background: c }" :class="{ active: color === c }" @click="color = c"></span></div>
          <div class="dc-opt-sep"></div>
          <div class="dc-slider-group"><label class="dc-slider-label">粗细</label><input type="range" min="1" max="80" v-model.number="lineWidth" class="dc-slider" /><span class="dc-slider-value">{{ lineWidth }}</span></div>
          <div class="dc-slider-group"><label class="dc-slider-label">透明</label><input type="range" min="5" max="100" v-model.number="opacity" class="dc-slider" /><span class="dc-slider-value">{{ Math.round(opacity) }}%</span></div>
          <template v-if="isShapeTool"><div class="dc-opt-sep"></div><button class="dc-opt-btn" :class="{ active: fillShape }" @click="fillShape = !fillShape"><i class="fa-solid" :class="fillShape ? 'fa-fill-drip' : 'fa-fill'"></i><span>{{ fillShape ? '填充' : '描边' }}</span></button></template>
          <div class="dc-opt-spacer"></div>
          <button class="dc-opt-btn" @click="clearLayer"><i class="fa-solid fa-trash-can"></i><span>清空画布</span></button>
          <button class="btn-secondary btn-sm" @click="$emit('close')">退出</button>
          <button class="btn-primary btn-sm" @click="saveAndClose">保存</button>
        </div>

        <!-- 画布工作区 -->
        <div class="dc-workspace" ref="workspace" @wheel.prevent="onWheel" @dblclick="fitToWindow">
          <div class="dc-layers-container" ref="layersContainer" :style="layersContainerStyle">
            <canvas ref="mainCanvas" class="dc-layer" :style="{ zIndex: 0 }" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @mouseleave="onMouseUp" @touchstart.prevent="onTouchStart" @touchmove.prevent="onTouchMove" @touchend.prevent="onTouchEnd"></canvas>
            <canvas ref="previewOverlay" class="dc-layer dc-preview-overlay" :style="{ zIndex: 1, pointerEvents: 'none' }"></canvas>
            <canvas ref="gridOverlay" class="dc-layer dc-grid-overlay" :style="{ zIndex: 2, pointerEvents: 'none', opacity: showGrid ? 1 : 0 }"></canvas>
            <canvas v-if="showGuides" ref="guidesOverlay" class="dc-layer dc-guides-overlay" :style="{ zIndex: 3, pointerEvents: 'none' }"></canvas>
            <div v-if="textInput.visible" class="dc-text-input-wrap" :style="{ left: textInput.x + 'px', top: textInput.y + 'px' }"><input ref="textInputEl" v-model="textInput.text" class="dc-text-input" :style="{ fontSize: Math.max(14, lineWidth * 3) + 'px', color: color }" @keydown.enter="commitText" @keydown.escape="cancelText" placeholder="输入文字后回车确认..." /></div>
          </div>
          <div class="dc-minimap" ref="minimap"><canvas ref="minimapCanvas" class="dc-minimap-canvas" @click="onMinimapClick"></canvas><div class="dc-minimap-viewport" :style="minimapViewportStyle"></div></div>
        </div>

        <!-- 导入图片变换 -->
        <div v-if="importedImage" class="dc-image-transform"><div class="dc-image-transform-btns"><button class="btn-sm btn-primary" @click="commitImportedImage">放置</button><button class="btn-sm btn-secondary" @click="cancelImportedImage">取消</button></div></div>
      </div>
    </div>

    <!-- ================================================================== -->
    <!--  批注模式：浮动工具栏 + 透明画布                                     -->
    <!-- ================================================================== -->
    <template v-if="mode === 'annotation'">
      <div class="dc-anno-toolbar">
        <div class="dc-anno-tools">
          <button class="dc-tool-btn" :class="{ active: annotating }" @click="annotating = !annotating" title="批注画笔"><i class="fa-solid fa-pen"></i></button>
          <template v-if="annotating">
            <button v-for="tool in annoTools" :key="tool.id" class="dc-tool-btn" :class="{ active: activeTool === tool.id }" @click="setTool(tool.id)" :title="tool.name"><i class="fa-solid" :class="tool.icon"></i></button>
            <div class="dc-toolbar-sep"></div>
            <label class="dc-color-wrap"><input type="color" v-model="color" class="dc-color-input" /><span class="dc-color-preview dc-color-preview--sm" :style="{ background: color }"></span></label>
            <div class="dc-slider-group"><input type="range" min="1" max="30" v-model.number="lineWidth" class="dc-slider dc-slider--sm" /><span class="dc-slider-value">{{ lineWidth }}</span></div>
            <div class="dc-toolbar-sep"></div>
            <button class="dc-tool-btn" @click="undo" :disabled="historyIdx <= 0"><i class="fa-solid fa-rotate-left"></i></button>
            <button class="dc-tool-btn" @click="redo" :disabled="historyIdx >= history.length - 1"><i class="fa-solid fa-rotate-right"></i></button>
          </template>
        </div>
        <button v-if="annotating" class="btn-primary btn-sm" @click="finishAnnotation">完成批注</button>
      </div>
      <div class="dc-workspace" ref="workspace" @dblclick="fitToWindow">
        <div class="dc-layers-container" ref="layersContainer" :style="layersContainerStyle">
          <canvas ref="mainCanvas" class="dc-layer" :style="{ zIndex: 0, pointerEvents: annotating ? 'auto' : 'none' }" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @mouseleave="onMouseUp" @touchstart.prevent="onTouchStart" @touchmove.prevent="onTouchMove" @touchend.prevent="onTouchEnd"></canvas>
          <canvas ref="previewOverlay" class="dc-layer dc-preview-overlay" :style="{ zIndex: 1, pointerEvents: 'none' }"></canvas>
          <div v-if="textInput.visible" class="dc-text-input-wrap" :style="{ left: textInput.x + 'px', top: textInput.y + 'px' }"><input ref="textInputEl" v-model="textInput.text" class="dc-text-input" :style="{ fontSize: Math.max(14, lineWidth * 3) + 'px', color: color }" @keydown.enter="commitText" @keydown.escape="cancelText" placeholder="输入文字后回车确认..." /></div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
// ============ 工具函数 ============
function generateId() {
  return 'dc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ============ 工具定义 ============
var FULL_TOOLS = [
  { id: 'select', name: '选择', icon: 'fa-arrow-pointer' },
  { id: 'brush', name: '画笔', icon: 'fa-paintbrush' },
  { id: 'eraser', name: '橡皮擦', icon: 'fa-eraser' },
  { id: 'rect', name: '矩形', icon: 'fa-square' },
  { id: 'circle', name: '圆形', icon: 'fa-circle' },
  { id: 'line', name: '直线', icon: 'fa-minus' },
  { id: 'triangle', name: '三角形', icon: 'fa-play' },
  { id: 'arrow', name: '箭头', icon: 'fa-arrow-right' },
  { id: 'diamond', name: '菱形', icon: 'fa-diamond' },
  { id: 'text', name: '文字', icon: 'fa-font' },
  { id: 'eyedropper', name: '吸管', icon: 'fa-eye-dropper' }
];

var ANNO_TOOLS = [
  { id: 'brush', name: '画笔', icon: 'fa-paintbrush' },
  { id: 'eraser', name: '橡皮擦', icon: 'fa-eraser' },
  { id: 'rect', name: '矩形', icon: 'fa-square' },
  { id: 'circle', name: '圆形', icon: 'fa-circle' },
  { id: 'arrow', name: '箭头', icon: 'fa-arrow-right' }
];

var BRUSH_TYPES = [
  { id: 'pencil', name: '铅笔', icon: 'fa-pencil' },
  { id: 'marker', name: '马克笔', icon: 'fa-highlighter' },
  { id: 'highlighter', name: '荧光笔', icon: 'fa-marker' },
  { id: 'crayon', name: '蜡笔', icon: 'fa-paintbrush' }
];

var PRESET_COLORS = ['#000000', '#ff0000', '#ff6600', '#ffcc00', '#00cc00', '#0066ff', '#9900cc', '#ffffff', '#ffeb3b', '#ff9800', '#e91e63', '#00bcd4'];

var SHAPE_TOOLS = ['rect', 'circle', 'line', 'triangle', 'arrow', 'diamond'];

export default {
  name: 'DrawCanvas',
  props: {
    mode: { type: String, default: 'full' },
    initialLayers: { type: Array, default: function() { return []; } },
    canvasWidth: { type: Number, default: 0 },
    canvasHeight: { type: Number, default: 0 }
  },
  data: function() {
    return {
      // 工具状态
      activeTool: 'brush',
      color: '#000000',
      lineWidth: 3,
      opacity: 100,
      brushType: 'pencil',
      fillShape: false,

      // 画布尺寸（单图层，不再需要 layers 数组）
      canvasW: 0,
      canvasH: 0,

      // 绘制状态
      drawing: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,

      // 历史
      history: [],
      historyIdx: -1,

      // 形状预览
      shapePreview: null,

      // 文字输入
      textInput: { visible: false, text: '', x: 0, y: 0, canvasX: 0, canvasY: 0 },

      // 网格
      showGrid: false,
      gridSize: 20,
      snapToGrid: false,

      // 参考线
      showGuides: false,
      guides: [],
      draggingGuide: null,

      // 无限画布
      scale: 1,
      offsetX: 0,
      offsetY: 0,

      // 图片导入
      importedImage: null,
      imageTransform: { x: 0, y: 0, scale: 1, rotation: 0 },

      // 批注模式
      annotating: false,

      // 触摸
      touchDist0: 0,
      touchCX0: 0,
      touchCY0: 0,

      // 预设
      presetColors: PRESET_COLORS,

      // minimap
      minimapSize: 120
    };
  },
  computed: {
    visibleTools: function() {
      return this.mode === 'full' ? FULL_TOOLS : [];
    },
    annoTools: function() {
      return ANNO_TOOLS;
    },
    brushTypes: function() {
      return BRUSH_TYPES;
    },
    isShapeTool: function() {
      return SHAPE_TOOLS.indexOf(this.activeTool) !== -1;
    },
    layersContainerStyle: function() {
      // 优先使用 init 时计算的实际画布尺寸
      var w = this.canvasW || this.canvasWidth || 800;
      var h = this.canvasH || this.canvasHeight || 600;
      return {
        width: w + 'px',
        height: h + 'px',
        transform: 'scale(' + this.scale + ') translate(' + this.offsetX + 'px, ' + this.offsetY + 'px)',
        transformOrigin: '0 0'
      };
    },
    minimapViewportStyle: function() {
      var ws = this.$refs.workspace;
      if (!ws) return {};
      var vw = ws.offsetWidth;
      var vh = ws.offsetHeight;
      var cw = this.canvasW || this.canvasWidth || 800;
      var ch = this.canvasH || this.canvasHeight || 600;
      var ratio = this.minimapSize / Math.max(cw, ch);
      return {
        left: (-this.offsetX * this.scale * ratio) + 'px',
        top: (-this.offsetY * this.scale * ratio) + 'px',
        width: (vw / this.scale * ratio) + 'px',
        height: (vh / this.scale * ratio) + 'px'
      };
    }
  },
  watch: {
    showGrid: function() {
      this.$nextTick(function() { this.drawGrid(); });
    },
    showGuides: function() {
      this.$nextTick(function() { this.drawGuides(); });
    },
    activeTool: function(val) {
      this.$emit('update:activeTool', val);
    },
    color: function(val) {
      this.$emit('update:color', val);
    }
  },
  methods: {
    // ============ 初始化 ============
    init: function(existingData) {
      var self = this;
      var workspace = self.$refs.workspace;
      if (!workspace) return;
      var w, h;
      if (self.mode === 'annotation') {
        // 批注模式：canvas 尺寸 = 工作区尺寸 = 预览内容完整尺寸
        w = workspace.offsetWidth || 800;
        h = workspace.offsetHeight || 600;
      } else {
        var maxW = workspace.offsetWidth - 40;
        var maxH = workspace.offsetHeight - 40;
        w = self.canvasWidth || Math.min(maxW, 1200);
        h = self.canvasHeight || Math.min(maxH, 800);
      }
      if (w < 400) w = 400;
      if (h < 300) h = 300;
      w = Math.floor(w);
      h = Math.floor(h);

      // 单图层：仅记录画布尺寸，不再维护 layers 数组
      self.canvasW = w;
      self.canvasH = h;
      self.history = [];
      self.historyIdx = -1;
      self.activeTool = 'brush';
      self.color = '#000000';
      self.lineWidth = 3;
      self.opacity = 100;
      self.fillShape = false;
      self.textInput = { visible: false, text: '', x: 0, y: 0, canvasX: 0, canvasY: 0 };
      self.scale = 1;
      self.offsetX = 0;
      self.offsetY = 0;

      self.$nextTick(function() {
        var canvas = self.$refs.mainCanvas;
        if (canvas) {
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          // full 模式填充白色背景；annotation 模式保持透明
          ctx.fillStyle = self.mode === 'annotation' ? 'rgba(0,0,0,0)' : '#ffffff';
          ctx.fillRect(0, 0, w, h);
          // 若有历史数据，绘制到画布上（单图层，取首张）
          if (existingData && existingData.length > 0 && existingData[0]) {
            var img = new Image();
            img.onload = function() { ctx.drawImage(img, 0, 0, w, h); };
            img.src = existingData[0];
          }
        }
        var overlay = self.$refs.previewOverlay;
        if (overlay) {
          overlay.width = w;
          overlay.height = h;
        }
        var gridOverlay = self.$refs.gridOverlay;
        if (gridOverlay) {
          gridOverlay.width = w;
          gridOverlay.height = h;
        }
        var guidesOverlay = self.$refs.guidesOverlay;
        if (guidesOverlay) {
          guidesOverlay.width = w;
          guidesOverlay.height = h;
        }
        self.showGrid = false;
        self.snapToGrid = false;
        self.saveState();
        self.fitToWindow();
      });
    },

    // ============ 画布引用 ============
    getActiveCanvas: function() {
      return this.$refs.mainCanvas;
    },

    // ============ 坐标转换 ============
    getCanvasPos: function(e) {
      var self = this;
      var canvas = self.getActiveCanvas();
      if (!canvas) return { x: 0, y: 0 };
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      var pos = {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
      if (self.snapToGrid && self.showGrid) {
        pos.x = Math.round(pos.x / self.gridSize) * self.gridSize;
        pos.y = Math.round(pos.y / self.gridSize) * self.gridSize;
      }
      return pos;
    },

    // ============ 无限画布 ============
    onWheel: function(e) {
      var self = this;
      if (self.mode !== 'full') return;
      e.preventDefault();
      var delta = e.deltaY > 0 ? 0.9 : 1.1;
      var newScale = Math.min(10, Math.max(0.1, self.scale * delta));
      // 以鼠标位置为中心缩放
      var rect = self.$refs.workspace.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      self.offsetX = mx - (mx - self.offsetX) * (newScale / self.scale);
      self.offsetY = my - (my - self.offsetY) * (newScale / self.scale);
      self.scale = newScale;
      self.updateMinimap();
    },

    fitToWindow: function() {
      var self = this;
      if (self.mode !== 'full') return;
      var ws = self.$refs.workspace;
      if (!ws) return;
      var vw = ws.offsetWidth;
      var vh = ws.offsetHeight;
      var cw = self.canvasW || self.canvasWidth || 800;
      var ch = self.canvasH || self.canvasHeight || 600;
      var fitScale = Math.min(vw / cw, vh / ch, 1) * 0.9;
      self.scale = fitScale;
      self.offsetX = (vw - cw * fitScale) / 2 / fitScale;
      self.offsetY = (vh - ch * fitScale) / 2 / fitScale;
      self.updateMinimap();
    },

    // ============ 鼠标事件 ============
    onMouseDown: function(e) {
      var self = this;
      if (self.mode === 'annotation' && !self.annotating) return;
      if (self.activeTool === 'select') return;
      if (self.activeTool === 'eyedropper') {
        self.doEyedropper(e);
        return;
      }
      if (self.activeTool === 'text') {
        var containerRect = self.$refs.layersContainer.getBoundingClientRect();
        var pos = self.getCanvasPos(e);
        self.textInput = {
          visible: true,
          text: '',
          x: e.clientX - containerRect.left,
          y: e.clientY - containerRect.top,
          canvasX: pos.x,
          canvasY: pos.y
        };
        self.$nextTick(function() {
          if (self.$refs.textInputEl) self.$refs.textInputEl.focus();
        });
        return;
      }
      self.drawing = true;
      var pos = self.getCanvasPos(e);
      self.startX = pos.x;
      self.startY = pos.y;
      self.lastX = pos.x;
      self.lastY = pos.y;
      var canvas = self.getActiveCanvas();
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      if (self.activeTool === 'brush' || self.activeTool === 'eraser') {
        self.beginBrushStroke(ctx, pos);
      }
      if (SHAPE_TOOLS.indexOf(self.activeTool) !== -1) {
        self.shapePreview = {
          tool: self.activeTool,
          startX: pos.x,
          startY: pos.y,
          endX: pos.x,
          endY: pos.y
        };
      }
    },

    onMouseMove: function(e) {
      var self = this;
      if (!self.drawing) return;
      var pos = self.getCanvasPos(e);
      var canvas = self.getActiveCanvas();
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      if (self.activeTool === 'brush' || self.activeTool === 'eraser') {
        self.continueBrushStroke(ctx, pos);
      }
      if (self.shapePreview) {
        self.shapePreview.endX = pos.x;
        self.shapePreview.endY = pos.y;
        self.redrawShapePreview();
      }
    },

    onMouseUp: function(e) {
      var self = this;
      if (!self.drawing) return;
      self.drawing = false;
      var canvas = self.getActiveCanvas();
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      if (self.shapePreview) {
        self.drawShape(ctx, self.shapePreview);
        self.shapePreview = null;
        var overlay = self.$refs.previewOverlay;
        if (overlay) {
          var octx = overlay.getContext('2d');
          octx.clearRect(0, 0, overlay.width, overlay.height);
        }
      }
      self.saveState();
    },

    // ============ 触摸事件 ============
    onTouchStart: function(e) {
      var self = this;
      if (e.touches.length === 1) {
        // 单指绘制
        var touch = e.touches[0];
        self.onMouseDown(touch);
      } else if (e.touches.length === 2 && self.mode === 'full') {
        // 双指缩放/平移
        self.drawing = false;
        var t0 = e.touches[0];
        var t1 = e.touches[1];
        self.touchDist0 = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        self.touchCX0 = (t0.clientX + t1.clientX) / 2;
        self.touchCY0 = (t0.clientY + t1.clientY) / 2;
      }
    },

    onTouchMove: function(e) {
      var self = this;
      if (e.touches.length === 1 && self.drawing) {
        var touch = e.touches[0];
        self.onMouseMove(touch);
      } else if (e.touches.length === 2 && self.mode === 'full') {
        var t0 = e.touches[0];
        var t1 = e.touches[1];
        var dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        var cx = (t0.clientX + t1.clientX) / 2;
        var cy = (t0.clientY + t1.clientY) / 2;
        if (self.touchDist0 > 0) {
          var newScale = Math.min(10, Math.max(0.1, self.scale * (dist / self.touchDist0)));
          self.scale = newScale;
          self.touchDist0 = dist;
        }
        self.offsetX += (cx - self.touchCX0) / self.scale;
        self.offsetY += (cy - self.touchCY0) / self.scale;
        self.touchCX0 = cx;
        self.touchCY0 = cy;
        self.updateMinimap();
      }
    },

    onTouchEnd: function(e) {
      var self = this;
      if (e.touches.length === 0) {
        self.onMouseUp(e);
      }
    },

    // ============ 笔刷绘制 ============
    beginBrushStroke: function(ctx, pos) {
      var self = this;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (self.activeTool === 'eraser') {
        // 按模式区分橡皮擦行为：
        // - full 模式：canvas 有白色不透明背景，用白色画笔模拟擦除（避免 destination-out 把白底也擦成透明）
        // - annotation 模式：canvas 透明，用 destination-out 真正擦除像素，让下层笔记内容显示
        if (self.mode === 'annotation') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.strokeStyle = '#000000';
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.strokeStyle = '#ffffff';
        }
        ctx.globalAlpha = 1;
        ctx.lineWidth = self.lineWidth;
      } else if (self.brushType === 'marker') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = self.color;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = Math.max(10, self.lineWidth);
      } else if (self.brushType === 'highlighter') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = self.color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = Math.max(15, self.lineWidth);
      } else if (self.brushType === 'crayon') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = self.color;
        ctx.globalAlpha = self.opacity / 100;
        ctx.lineWidth = self.lineWidth;
      } else {
        // pencil
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = self.color;
        ctx.globalAlpha = self.opacity / 100;
        ctx.lineWidth = self.lineWidth;
      }
    },

    continueBrushStroke: function(ctx, pos) {
      var self = this;
      if (self.brushType === 'crayon' && self.activeTool === 'brush') {
        // 蜡笔: 添加随机抖动
        var jitterX = pos.x + (Math.random() - 0.5) * self.lineWidth * 0.8;
        var jitterY = pos.y + (Math.random() - 0.5) * self.lineWidth * 0.8;
        ctx.lineTo(jitterX, jitterY);
      } else {
        ctx.lineTo(pos.x, pos.y);
      }
      ctx.stroke();
      self.lastX = pos.x;
      self.lastY = pos.y;
    },

    // ============ 形状绘制 ============
    redrawShapePreview: function() {
      var self = this;
      if (!self.shapePreview) return;
      var overlay = self.$refs.previewOverlay;
      if (!overlay) return;
      var ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      self.drawShape(ctx, self.shapePreview);
    },

    drawShape: function(ctx, shape) {
      var self = this;
      ctx.save();
      ctx.strokeStyle = self.color;
      ctx.fillStyle = self.color;
      ctx.lineWidth = self.lineWidth;
      ctx.globalAlpha = self.opacity / 100;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      var sx = shape.startX, sy = shape.startY;
      var ex = shape.endX, ey = shape.endY;

      if (shape.tool === 'rect') {
        if (self.fillShape) {
          ctx.fillRect(sx, sy, ex - sx, ey - sy);
        } else {
          ctx.strokeRect(sx, sy, ex - sx, ey - sy);
        }
      } else if (shape.tool === 'circle') {
        var rx = Math.abs(ex - sx) / 2;
        var ry = Math.abs(ey - sy) / 2;
        var ccx = (sx + ex) / 2;
        var ccy = (sy + ey) / 2;
        ctx.beginPath();
        ctx.ellipse(ccx, ccy, rx, ry, 0, 0, Math.PI * 2);
        if (self.fillShape) {
          ctx.fill();
        } else {
          ctx.stroke();
        }
      } else if (shape.tool === 'line') {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      } else if (shape.tool === 'triangle') {
        var midX = (sx + ex) / 2;
        ctx.beginPath();
        ctx.moveTo(midX, sy);
        ctx.lineTo(ex, ey);
        ctx.lineTo(sx, ey);
        ctx.closePath();
        if (self.fillShape) {
          ctx.fill();
        } else {
          ctx.stroke();
        }
      } else if (shape.tool === 'arrow') {
        var headLen = Math.max(10, self.lineWidth * 4);
        var dx = ex - sx;
        var dy = ey - sy;
        var angle = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
      } else if (shape.tool === 'diamond') {
        var dcx = (sx + ex) / 2;
        var dcy = (sy + ey) / 2;
        var halfW = Math.abs(ex - sx) / 2;
        var halfH = Math.abs(ey - sy) / 2;
        ctx.beginPath();
        ctx.moveTo(dcx, dcy - halfH);
        ctx.lineTo(dcx + halfW, dcy);
        ctx.lineTo(dcx, dcy + halfH);
        ctx.lineTo(dcx - halfW, dcy);
        ctx.closePath();
        if (self.fillShape) {
          ctx.fill();
        } else {
          ctx.stroke();
        }
      }
      ctx.restore();
    },

    // ============ 历史 ============
    saveState: function() {
      var self = this;
      var canvas = self.getActiveCanvas();
      if (!canvas) return;
      var dataUrl = canvas.toDataURL('image/png');
      if (self.historyIdx < self.history.length - 1) {
        self.history = self.history.slice(0, self.historyIdx + 1);
      }
      self.history.push(dataUrl);
      if (self.history.length > 50) {
        self.history = self.history.slice(self.history.length - 50);
      }
      self.historyIdx = self.history.length - 1;
    },

    undo: function() {
      var self = this;
      if (self.historyIdx <= 0) return;
      self.historyIdx--;
      self.restoreFromHistory();
    },

    redo: function() {
      var self = this;
      if (self.historyIdx >= self.history.length - 1) return;
      self.historyIdx++;
      self.restoreFromHistory();
    },

    restoreFromHistory: function() {
      var self = this;
      var canvas = self.getActiveCanvas();
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var dataUrl = self.history[self.historyIdx];
      if (!dataUrl) return;
      var img = new Image();
      img.onload = function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = dataUrl;
    },

    clearLayer: function() {
      var self = this;
      var canvas = self.getActiveCanvas();
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = self.mode === 'annotation' ? 'rgba(0,0,0,0)' : '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      self.saveState();
    },

    // ============ 网格 ============
    toggleGrid: function() {
      var self = this;
      self.showGrid = !self.showGrid;
      self.$nextTick(function() {
        self.drawGrid();
      });
    },

    drawGrid: function() {
      var self = this;
      var overlay = self.$refs.gridOverlay;
      if (!overlay) return;
      var w = self.canvasW || self.canvasWidth || 800;
      var h = self.canvasH || self.canvasHeight || 600;
      overlay.width = w;
      overlay.height = h;
      var ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      if (!self.showGrid) return;
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 1;
      var gs = self.gridSize;
      for (var x = gs; x < w; x += gs) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }
      for (var y = gs; y < h; y += gs) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }
    },

    // ============ 参考线 ============
    drawGuides: function() {
      var self = this;
      var overlay = self.$refs.guidesOverlay;
      if (!overlay) return;
      var w = self.canvasW || self.canvasWidth || 800;
      var h = self.canvasH || self.canvasHeight || 600;
      overlay.width = w;
      overlay.height = h;
      var ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#00bcd4';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      self.guides.forEach(function(g) {
        ctx.beginPath();
        if (g.orientation === 'horizontal') {
          ctx.moveTo(0, g.position);
          ctx.lineTo(w, g.position);
        } else {
          ctx.moveTo(g.position, 0);
          ctx.lineTo(g.position, h);
        }
        ctx.stroke();
      });
      ctx.setLineDash([]);
    },

    // ============ 吸管 ============
    doEyedropper: function(e) {
      var self = this;
      var canvas = self.getActiveCanvas();
      if (!canvas) return;
      var pos = self.getCanvasPos(e);
      var ctx = canvas.getContext('2d');
      var pixel = ctx.getImageData(Math.round(pos.x), Math.round(pos.y), 1, 1).data;
      var hex = '#' + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1);
      self.color = hex;
      self.activeTool = 'brush';
    },

    // ============ 文字 ============
    commitText: function() {
      var self = this;
      if (!self.textInput.text.trim()) {
        self.textInput.visible = false;
        return;
      }
      var canvas = self.getActiveCanvas();
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      ctx.save();
      ctx.font = Math.max(14, self.lineWidth * 3) + 'px sans-serif';
      ctx.fillStyle = self.color;
      ctx.globalAlpha = self.opacity / 100;
      ctx.textBaseline = 'top';
      var lines = self.textInput.text.split('\n');
      var lineHeight = Math.max(14, self.lineWidth * 3) * 1.3;
      for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], self.textInput.canvasX, self.textInput.canvasY + i * lineHeight);
      }
      ctx.restore();
      self.textInput.visible = false;
      self.saveState();
    },

    cancelText: function() {
      this.textInput.visible = false;
    },

    // ============ 图片导入 ============
    triggerImageImport: function() {
      this.$refs.imageInput.click();
    },

    onImageImport: function(e) {
      var self = this;
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        var img = new Image();
        img.onload = function() {
          self.importedImage = img;
          self.imageTransform = {
            x: 100,
            y: 100,
            scale: 1,
            rotation: 0
          };
          self.drawImportedImagePreview();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },

    drawImportedImagePreview: function() {
      // 在预览层绘制导入图片
      var self = this;
      var overlay = self.$refs.previewOverlay;
      if (!overlay || !self.importedImage) return;
      var ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      var t = self.imageTransform;
      ctx.save();
      ctx.translate(t.x + self.importedImage.width * t.scale / 2, t.y + self.importedImage.height * t.scale / 2);
      ctx.rotate(t.rotation);
      ctx.drawImage(self.importedImage, -self.importedImage.width * t.scale / 2, -self.importedImage.height * t.scale / 2, self.importedImage.width * t.scale, self.importedImage.height * t.scale);
      ctx.restore();
    },

    commitImportedImage: function() {
      var self = this;
      if (!self.importedImage) return;
      var canvas = self.getActiveCanvas();
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var t = self.imageTransform;
      ctx.save();
      ctx.translate(t.x + self.importedImage.width * t.scale / 2, t.y + self.importedImage.height * t.scale / 2);
      ctx.rotate(t.rotation);
      ctx.drawImage(self.importedImage, -self.importedImage.width * t.scale / 2, -self.importedImage.height * t.scale / 2, self.importedImage.width * t.scale, self.importedImage.height * t.scale);
      ctx.restore();
      self.importedImage = null;
      var overlay = self.$refs.previewOverlay;
      if (overlay) {
        overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
      }
      self.saveState();
    },

    cancelImportedImage: function() {
      this.importedImage = null;
      var overlay = this.$refs.previewOverlay;
      if (overlay) {
        overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
      }
    },

    // ============ Minimap ============
    updateMinimap: function() {
      var self = this;
      if (self.mode !== 'full') return;
      self.$nextTick(function() {
        var mc = self.$refs.minimapCanvas;
        if (!mc) return;
        var ms = self.minimapSize;
        var cw = self.canvasW || self.canvasWidth || 800;
        var ch = self.canvasH || self.canvasHeight || 600;
        var ratio = ms / Math.max(cw, ch);
        mc.width = cw * ratio;
        mc.height = ch * ratio;
        var ctx = mc.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, mc.width, mc.height);
        // 单图层：直接绘制主画布缩略图
        var canvas = self.getActiveCanvas();
        if (canvas) {
          ctx.drawImage(canvas, 0, 0, mc.width, mc.height);
        }
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, mc.width, mc.height);
      });
    },

    onMinimapClick: function(e) {
      var self = this;
      var mc = self.$refs.minimapCanvas;
      if (!mc) return;
      var rect = mc.getBoundingClientRect();
      var cw = self.canvasW || self.canvasWidth || 800;
      var ch = self.canvasH || self.canvasHeight || 600;
      var ratio = self.minimapSize / Math.max(cw, ch);
      var clickX = (e.clientX - rect.left) / ratio;
      var clickY = (e.clientY - rect.top) / ratio;
      var ws = self.$refs.workspace;
      if (!ws) return;
      self.offsetX = -(clickX - ws.offsetWidth / 2 / self.scale);
      self.offsetY = -(clickY - ws.offsetHeight / 2 / self.scale);
    },

    // ============ 保存/关闭 ============
    getData: function() {
      // 单图层：返回单元素数组，保持与 Notes.vue canvasData 数组存储格式兼容
      var canvas = this.getActiveCanvas();
      if (!canvas) return [];
      return [canvas.toDataURL('image/png')];
    },

    saveAndClose: function() {
      var data = this.getData();
      this.$emit('save', data);
    },

    finishAnnotation: function() {
      this.annotating = false;
      this.$emit('drawing', false);
      var data = this.getData();
      this.$emit('save', data);
    },

    // ============ 工具切换 ============
    setTool: function(toolId) {
      this.activeTool = toolId;
      if (this.mode === 'annotation') {
        this.annotating = true;
        this.$emit('drawing', true);
      }
    }
  },

  watch: {
    annotating: function(val) {
      if (this.mode === 'annotation') {
        this.$emit('drawing', val);
      }
    }
  },

  mounted: function() {
    var self = this;
    self.$nextTick(function() {
      self.init(self.initialLayers);
    });
  }
};
</script>

<style scoped>
/* ========== 根容器 ========== */
.draw-canvas {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-color);
  user-select: none;
  -webkit-user-select: none;
}

.draw-canvas--annotation {
  /* 撑满 .annotation-overlay，即整个预览内容区域 */
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  background: transparent !important;
}

.draw-canvas--annotation .dc-anno-toolbar {
  /* 工具栏浮动在顶部，不占据画布空间 */
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  pointer-events: auto;
}

/* ========== 全屏模式：左右布局 ========== */
.dc-full-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 左侧工具条 */
.dc-sidebar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  background: var(--card-bg);
  border-right: 0.5px solid var(--separator-color);
  flex-shrink: 0;
  width: 52px;
  overflow-y: auto;
}

.dc-side-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  border: 2px solid transparent;
  background: none;
  transition: all 0.15s;
  flex-shrink: 0;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.dc-side-btn--sm {
  width: 36px;
  height: 36px;
  font-size: 14px;
}

.dc-side-btn:active:not(:disabled) {
  transform: scale(0.9);
  opacity: 0.7;
}

.dc-side-btn.active {
  background: var(--primary-color);
  color: #FFFFFF;
  border-color: var(--primary-color);
}

.dc-side-btn:disabled {
  opacity: 0.3;
  pointer-events: none;
}

.dc-side-sep {
  width: 36px;
  height: 1px;
  background: var(--separator-color);
  margin: 4px 0;
}

.dc-side-spacer {
  flex: 1;
}

/* 右侧主体 */
.dc-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

/* 选项栏 */
.dc-options-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--card-bg);
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.dc-opt-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  min-height: 36px;
  touch-action: manipulation;
  white-space: nowrap;
}

.dc-opt-btn:active {
  transform: scale(0.95);
}

.dc-opt-btn.active {
  background: var(--primary-color);
  color: #FFFFFF;
  border-color: var(--primary-color);
}

.dc-opt-sep {
  width: 1px;
  height: 24px;
  background: var(--separator-color);
}

.dc-opt-spacer {
  flex: 1;
}

/* ========== 旧式全屏工具栏（保留用于回退） ========== */
.dc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 0.5px solid var(--separator-color);
  background: var(--card-bg);
  flex-shrink: 0;
  gap: 4px;
  flex-wrap: wrap;
}

.dc-tools-left {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.dc-tools-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dc-toolbar-sep {
  width: 1px;
  height: 28px;
  background: var(--separator-color);
  margin: 0 4px;
}

/* ========== 工具按钮 ========== */
.dc-tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  height: 44px;
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  border: 2px solid transparent;
  background: none;
  transition: all 0.15s;
  padding: 0 8px;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.dc-tool-btn:active:not(:disabled) {
  transform: scale(0.9);
  opacity: 0.7;
}

.dc-tool-btn.active {
  background: var(--primary-color);
  color: #FFFFFF;
  border-color: var(--primary-color);
}

.dc-tool-btn:disabled {
  opacity: 0.3;
  pointer-events: none;
}

/* ========== 颜色选择 ========== */
.dc-color-wrap {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.dc-color-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.dc-color-preview {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: 2px solid var(--border-color);
  cursor: pointer;
}

.dc-color-preview--sm {
  width: 36px;
  height: 36px;
  border-radius: 8px;
}

.dc-preset-colors {
  display: flex;
  gap: 3px;
  align-items: center;
}

.dc-preset-color {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.15s, transform 0.15s;
  touch-action: manipulation;
}

.dc-preset-color:active {
  transform: scale(0.85);
  opacity: 0.7;
}

.dc-preset-color.active {
  border-color: var(--primary-color);
  transform: scale(1.15);
}

/* ========== 滑块 ========== */
.dc-slider-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dc-slider-label {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.dc-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 70px;
  height: 4px;
  background: var(--separator-color);
  border-radius: 2px;
  cursor: pointer;
  outline: none;
}

.dc-slider--sm {
  width: 50px;
}

.dc-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #FFFFFF;
  border: none;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
}

.dc-slider::-webkit-slider-thumb:active {
  transform: scale(1.15);
}

.dc-slider-value {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 28px;
  text-align: center;
}

/* ========== 批注工具栏 ========== */
.dc-anno-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--card-bg);
  border-bottom: 0.5px solid var(--separator-color);
  flex-shrink: 0;
  gap: 6px;
}

.dc-anno-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

/* ========== 工作区 ========== */
.dc-workspace {
  flex: 1;
  min-height: 0;
  position: relative;
  background: #e8e8e8;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.draw-canvas--annotation .dc-workspace {
  /* 工作区覆盖整个内容区域，canvas 尺寸 = 内容尺寸 */
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: transparent;
  align-items: flex-start;
  justify-content: flex-start;
}

.dc-layers-container {
  position: relative;
  background: var(--card-bg);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  transition: transform 0.05s ease-out;
}

.draw-canvas--annotation .dc-layers-container {
  background: transparent;
  box-shadow: none;
}

/* ========== 图层 Canvas ========== */
.dc-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  touch-action: none;
}

.dc-preview-overlay {
  pointer-events: none;
}

.dc-grid-overlay {
  pointer-events: none;
  transition: opacity 0.2s;
}

.dc-guides-overlay {
  pointer-events: none;
}

/* ========== 文字输入 ========== */
.dc-text-input-wrap {
  position: absolute;
  z-index: 999;
}

.dc-text-input {
  border: 2px dashed var(--primary-color);
  background: rgba(255, 255, 255, 0.95);
  padding: 6px 10px;
  outline: none;
  min-width: 120px;
  font-family: sans-serif;
  border-radius: 6px;
}

/* ========== Minimap ========== */
.dc-minimap {
  position: absolute;
  right: 10px;
  bottom: 10px;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  box-shadow: var(--shadow-md);
  cursor: pointer;
}

.dc-minimap-canvas {
  display: block;
}

.dc-minimap-viewport {
  position: absolute;
  border: 2px solid var(--primary-color);
  background: rgba(0, 122, 255, 0.08);
  pointer-events: none;
}

/* ========== 按钮样式 ========== */
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 16px;
  border-radius: 8px;
  background: var(--primary-color);
  color: #FFFFFF;
  border: none;
  font-size: 14px;
  cursor: pointer;
  min-width: 44px;
  height: 44px;
  touch-action: manipulation;
  white-space: nowrap;
}

.btn-primary:active {
  opacity: 0.8;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 16px;
  border-radius: 8px;
  background: var(--bg-color);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  font-size: 14px;
  cursor: pointer;
  min-width: 44px;
  height: 44px;
  touch-action: manipulation;
  white-space: nowrap;
}

.btn-secondary:active {
  background: var(--separator-color);
}

.btn-sm {
  padding: 4px 12px;
  height: 36px;
  min-width: 36px;
  font-size: 13px;
  border-radius: 6px;
}

/* ========== 图片变换控制 ========== */
.dc-image-transform {
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  background: var(--card-bg);
  border-radius: 12px;
  padding: 8px 16px;
  box-shadow: var(--shadow-lg);
}

.dc-image-transform-btns {
  display: flex;
  gap: 8px;
}
</style>
