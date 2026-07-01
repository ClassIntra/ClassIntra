// 接收来自全屏 CloudFilePicker 的选择结果
export default {
  mounted: function() {
    this._recvCloudPickerResult();
  },
  activated: function() {
    this._recvCloudPickerResult();
  },
  methods: {
    _recvCloudPickerResult: function() {
      try {
        var raw = sessionStorage.getItem('__cloudPickerFile');
        if (!raw) return;
        sessionStorage.removeItem('__cloudPickerFile');
        var file = JSON.parse(raw);
        if (file && file.url && typeof this.onCloudImageSelect === 'function') {
          this.onCloudImageSelect(file);
        }
      } catch (e) {
        // 忽略损坏的数据
      }
    }
  }
};
