<template>
  <div class="empty-state" :class="['empty-state--' + variant, { 'empty-state--compact': compact }]">
    <i :class="resolvedIcon" class="empty-state__icon" aria-hidden="true"></i>
    <p class="empty-state__title">{{ resolvedTitle }}</p>
    <p v-if="resolvedDesc" class="empty-state__desc">{{ resolvedDesc }}</p>

    <div v-if="resolvedAction || secondaryText" class="empty-state__actions">
      <button v-if="resolvedAction" type="button" class="empty-state__action" @click="$emit('action')">
        {{ resolvedAction }}
      </button>
      <button
        v-if="secondaryText"
        type="button"
        class="empty-state__action empty-state__action--ghost"
        @click="$emit('secondary')"
      >
        {{ secondaryText }}
      </button>
    </div>
  </div>
</template>

<script>
// 统一空态 / 错误态组件
// ============================================================
// 这个组件存在的唯一理由，是把一条一直只写在文档里的红线变成「默认值」：
//
//   「拉不到 ≠ 没有。列表页请求失败必须显示错误态，绝不能渲染成空态。」
//
// 为什么强调这件事：把「请求失败」画成「还没有内容」是最容易犯、也最伤人的 UI 错误 ——
// 用户会以为自己的数据没了，去重复提交，或者在错误的认知上做决定。
// 而在手写的空态里，这两者长得几乎一样，只能靠开发者记得区分。
//
// 所以这里强制用 variant 显式声明语义，没有「默认空态」这种模糊地带：
//   empty     真的没有数据（首次使用、筛选后为空）
//   error     加载失败，可以重试
//   offline   网络不可用（与 error 分开：重试没有意义，要等网络恢复）
//   forbidden 没有权限（重试也没有意义）
//   notfound  资源不存在（可能已被删除）
//
// 每种语义都有配套的图标、标题、默认行动建议 —— 调用方只传 variant 就能得到
// 一句说得通的话，而不是一个空白页。
//
// 编码约定：ES5 / 单引号 / 2 空格缩进（Chrome 80 兼容基线）

var PRESETS = {
  empty: {
    icon: 'fas fa-inbox',
    title: '还没有内容',
    desc: ''
  },
  error: {
    icon: 'fas fa-triangle-exclamation',
    title: '加载失败',
    desc: '网络或服务出了点问题，稍后再试一次。',
    actionText: '重试'
  },
  offline: {
    icon: 'fas fa-wifi',
    title: '网络不可用',
    desc: '检查一下网络连接，恢复后会自动重新加载。',
    actionText: '已恢复，重试'
  },
  forbidden: {
    icon: 'fas fa-lock',
    title: '没有访问权限',
    desc: '这个内容需要更高的权限，可以找班管申请。',
    actionText: ''
  },
  notfound: {
    icon: 'fas fa-circle-question',
    title: '内容不存在',
    desc: '它可能已被删除，或者链接已经失效。',
    actionText: ''
  }
};

export default {
  name: 'EmptyState',
  props: {
    // 语义：必填，没有默认值 —— 强迫调用方想清楚「这到底是哪种空」
    variant: {
      type: String,
      required: true,
      validator: function(v) {
        return Object.prototype.hasOwnProperty.call(PRESETS, v);
      }
    },
    // 以下三项不传则用 variant 的预设，传了就覆盖
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    icon: { type: String, default: '' },
    actionText: { type: String, default: null },
    secondaryText: { type: String, default: '' },
    // 紧凑模式：用于卡片内、侧栏、弹窗等小空间
    compact: { type: Boolean, default: false }
  },
  computed: {
    preset: function() {
      return PRESETS[this.variant] || PRESETS.empty;
    },
    resolvedIcon: function() {
      return this.icon || this.preset.icon;
    },
    resolvedTitle: function() {
      return this.title || this.preset.title;
    },
    resolvedDesc: function() {
      return this.description || this.preset.desc;
    },
    resolvedAction: function() {
      // 约定：actionText 传 null → 用 variant 预设按钮；传 '' → 明确不要按钮
      return this.actionText === null ? (this.preset.actionText || '') : this.actionText;
    }
  }
};
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: var(--ci-text-secondary, rgba(0, 0, 0, 0.5));
  -webkit-user-select: none;
  user-select: none;
}

.empty-state--compact {
  padding: 20px 16px;
}

.empty-state__icon {
  font-size: 32px;
  color: var(--ci-text-tertiary, rgba(0, 0, 0, 0.24));
  margin-bottom: 12px;
}

.empty-state--compact .empty-state__icon {
  font-size: 22px;
  margin-bottom: 8px;
}

.empty-state__title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--ci-text-primary, rgba(0, 0, 0, 0.86));
}

.empty-state--compact .empty-state__title {
  font-size: 13px;
}

.empty-state__desc {
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  max-width: 320px;
  color: var(--ci-text-secondary, rgba(0, 0, 0, 0.5));
}

.empty-state--compact .empty-state__desc {
  font-size: 12px;
}

/* 错误态用警示色，让它和「空」在视觉上就不是一回事 */
.empty-state--error .empty-state__icon,
.empty-state--offline .empty-state__icon {
  color: var(--ci-warning, #f5a623);
}

.empty-state--forbidden .empty-state__icon {
  color: var(--ci-text-tertiary, rgba(0, 0, 0, 0.3));
}

.empty-state__actions {
  display: flex;
  /* gap 可用：本仓 build.target='80' 只约束 JS 语法（esbuild 不做 CSS 特性降级），
     而真机内核实际是 Chromium 89，flex gap 自 84 起支持。
     全仓 68 个文件都用 gap，这里保持一致，不要为「保险」改成 margin —— 那只会让样式风格分裂。 */
  gap: 8px;
  margin-top: 16px;
}

.empty-state__action {
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 18px;
  border: 0;
  border-radius: 8px;
  background: var(--ci-accent, #007aff);
  color: #fff;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

.empty-state__action:active {
  opacity: 0.8;
}

.empty-state__action--ghost {
  background: transparent;
  color: var(--ci-accent, #007aff);
  border: 1px solid var(--ci-hairline, rgba(0, 0, 0, 0.08));
}
</style>
