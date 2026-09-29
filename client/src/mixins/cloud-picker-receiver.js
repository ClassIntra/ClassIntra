// 接收来自全屏 CloudFilePicker 的选择结果
export default {
  mounted: function() {
    // 延迟检查：等待子组件和 DOM 就绪后处理
    var self = this;
    self.$nextTick(function() {
      self._recvCloudPickerResult();
    });
  },
  activated: function() {
    this._recvCloudPickerResult();
  },
  methods: {
    _recvCloudPickerResult: function() {
      try {
        var raw = sessionStorage.getItem('__cloudPickerFile');
        if (!raw) return;

        // 读取调用上下文（保存的 UI 状态）
        var ctxRaw = sessionStorage.getItem('__cloudPickerContext');
        var context = ctxRaw ? JSON.parse(ctxRaw) : {};
        sessionStorage.removeItem('__cloudPickerFile');
        sessionStorage.removeItem('__cloudPickerContext');

        var file = JSON.parse(raw);
        if (!file || !file.url) return;

        // 恢复调用方 UI 状态。
        // 注意：/cloud-picker 是独立路由 + App.vue 无 keep-alive，跳转时本组件被卸载，
        // 这里要把「回到哪一屏」逐项还原；只还原弹窗开关会掉回默认列表页（详情页丢失）。
        if (context.activeTab && typeof this.activeTab !== 'undefined') {
          this.activeTab = context.activeTab;
        }
        if (context.newPost && this.newPost && typeof this.newPost === 'object') {
          this.newPost = context.newPost;
        }
        if (context.commentCloudTarget) {
          this.commentCloudTarget = context.commentCloudTarget;
        }
        if (context.showPostModal && typeof this.showPostModal !== 'undefined') {
          this.showPostModal = true;
        }
        // 详情页：优先按 id 重开（帖子可能已不在当前列表里，openPost 会兜底拉接口）
        if (context.showFullDetail && context.currentPostId && typeof this.openPost === 'function') {
          this.openPost(context.currentPostId);
        }
        // 草稿放在重开详情之后：openPost → selectPost 会把 replyToUser 重置
        if (typeof context.commentText === 'string' && typeof this.commentText !== 'undefined') {
          this.commentText = context.commentText;
        }
        if (typeof context.replyToUser === 'string' && typeof this.replyToUser !== 'undefined') {
          this.replyToUser = context.replyToUser;
        }

        if (typeof this.onCloudImageSelect === 'function') {
          this.onCloudImageSelect(file);
        }
      } catch (e) {
        // 忽略损坏的数据
      }
    }
  }
};
