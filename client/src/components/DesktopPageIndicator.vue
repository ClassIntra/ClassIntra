<template>
  <!-- 右键页点：页面管理菜单（对齐 iPadOS 长按页点），坐标透传给宿主的 ctxMenu -->
  <div class="page-indicator" @click.stop @contextmenu.prevent.stop="$emit('page-menu', $event)">
    <button
      v-for="i in total"
      :key="i"
      class="page-dot"
      :class="{ 'page-dot--active': (i - 1) === current }"
      :style="(i - 1) === current ? activeDotStyle : null"
      @click="onJump(i - 1)"
      :aria-label="'第 ' + i + ' 页'"
    ></button>
    <button
      v-if="total < maxPages"
      class="page-add-btn"
      @click="$emit('add-page')"
      aria-label="添加桌面页"
    >
      <i class="fa-solid fa-plus"></i>
    </button>
  </div>
</template>

<script>
export default {
  name: 'DesktopPageIndicator',
  props: {
    // 总页数
    total: { type: Number, default: 1 },
    // 当前页索引
    current: { type: Number, default: 0 },
    // 最大页数
    maxPages: { type: Number, default: 9 },
    // 跟手翻页进度（兼容旧的 prop 驱动方式）：-1 上一页方向 ~ 1 下一页方向，0 未拖动。
    // 2026-11-02 起桌面改为拖拽中调用 setDragProgress() 直写 DOM（不产生逐帧重渲染），
    // 该 prop 仅保留给其它宿主/测试用，缺省 0 时行为与以前一致。
    dragProgress: { type: Number, default: 0 }
  },
  computed: {
    // active 长条的实时联动样式（仅拖动中非零）
    activeDotStyle: function() {
      var p = this.dragProgress || 0;
      // 边界页的越界方向没有目标点，不联动（首页右拖 / 末页左拖为橡皮筋阻尼）
      if ((this.current === 0 && p < 0) || (this.current === this.total - 1 && p > 0)) p = 0;
      if (!p) return null;
      var shift = p * 22;  // 朝相邻点位移（点距 20px + 2px gap）
      var stretch = 1 + Math.abs(p) * 0.5;
      return { transform: 'translateX(' + shift.toFixed(1) + 'px) scaleX(' + stretch.toFixed(3) + ')' };
    }
  },
  methods: {
    onJump: function(pageIndex) {
      this.$emit('jump', pageIndex);
    },
    // 跟手进度直写 DOM（2026-11-02）：宿主不再为每一帧拖拽维护响应式 offset，
    // 避免整个桌面组件逐帧重渲染。语义与 activeDotStyle 完全一致，只是绕过 Vue。
    setDragProgress: function(p) {
      var dot = this.$el && this.$el.querySelector('.page-dot--active');
      if (!dot) return;
      if ((this.current === 0 && p < 0) || (this.current === this.total - 1 && p > 0)) p = 0;
      if (!p) { dot.style.transform = ''; return; }
      var shift = p * 22;  // 朝相邻点位移（点距 20px + 2px gap）
      var stretch = 1 + Math.abs(p) * 0.5;
      dot.style.transform = 'translateX(' + shift.toFixed(1) + 'px) scaleX(' + stretch.toFixed(3) + ')';
    },
    clearDragProgress: function() {
      var dot = this.$el && this.$el.querySelector('.page-dot--active');
      if (dot) dot.style.transform = '';
    }
  }
};
</script>

<style scoped>
.page-indicator {
  position: absolute;
  bottom: 160px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 2px;
  z-index: 1000;
  -webkit-tap-highlight-color: transparent;
}

/* 小屏适配：Dock bottom 8px + 高 ~68px = 顶边 76px，108px 间隙充足 */
@media (max-height: 400px), (max-width: 520px) {
  .page-indicator {
    bottom: 108px;
  }
}

/* 横屏矮屏适配：横屏 Dock bottom 14px + 高 ~96px = 顶边 ~110px，124px 留出净间隙避免重叠 */
@media (orientation: landscape) and (max-height: 600px) {
  .page-indicator {
    bottom: 124px;
  }
}

.page-dot {
  width: 20px;
  height: 20px;
  border: none;
  padding: 0;
  cursor: pointer;
  background: transparent;
  position: relative;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--duration-fast) var(--ease-standard);
}

.page-dot:active {
  transform: scale(0.85);
}

/* 视觉圆点（伪元素，保持 6px 视觉 + 24px 触摸目标） */
.page-dot::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  -webkit-transform: translate(-50%, -50%);
  transform: translate(-50%, -50%);
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--indicator-dot, rgba(255, 255, 255, 0.4));
  /* 规范例外（§5.5.2）：页面指示器由 6px 变 18px 长条，
     改用 scaleX 会把 pill 圆角拉成椭圆，视觉错误；
     元素极小（<100px²），重排代价可忽略，故保留 width 过渡。 */
  transition: width var(--duration-normal) var(--ease-standard),
              background-color var(--duration-normal) var(--ease-standard);
}

.page-dot--active::before {
  width: 18px;
  background: var(--indicator-dot-active, #fff);
}

.page-add-btn {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-pill);
  border: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--duration-fast) var(--ease-standard);
}

.page-add-btn:active {
  transform: scale(0.85);
}
</style>
