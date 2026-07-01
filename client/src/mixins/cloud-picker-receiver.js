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

        // 恢复调用方 UI 状态
        if (context.showPostModal && typeof this.showPostModal !== 'undefined') {
          this.showPostModal = true;
        }
        if (context.commentCloudTarget) {
          this.commentCloudTarget = context.commentCloudTarget;
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
