<template>
  <div class="bot-admin-page">
    <div class="ba-header">
      <div class="ba-title">
        <i class="fa-solid fa-robot"></i>
        <span>Bot 控制台</span>
      </div>
      <div class="ba-actions">
        <button class="ba-btn" @click="reload"><i class="fa-solid fa-rotate-right"></i> 刷新</button>
        <button class="ba-btn ba-btn-primary" @click="openNewWindow">
          <i class="fa-solid fa-up-right-from-square"></i> 新窗口打开
        </button>
      </div>
    </div>

    <div class="ba-tip" v-if="!loaded">
      <i class="fa-solid fa-spinner fa-spin"></i> 正在连接 Bot WebUI（{{ webuiOrigin }}）…
    </div>
    <div class="ba-tip ba-tip-err" v-if="failed">
      <i class="fa-solid fa-triangle-exclamation"></i>
      Bot WebUI 无法连接。请确认本机 AstrBot 已启动
      （桌面双击 start-astrbot 或运行 D:\NetWork\Integration\AstrBot\start-astrbot.cmd），
      然后点击刷新。也可以直接
      <a :href="webuiOrigin" target="_blank">新窗口打开</a>。
    </div>

    <iframe
      v-show="loaded"
      ref="frame"
      class="ba-frame"
      :src="webuiOrigin"
      @load="onLoad"
    ></iframe>
  </div>
</template>

<script>
export default {
  name: 'BotAdmin',
  data: function () {
    return {
      loaded: false,
      failed: false,
      loadTimer: null,
      webuiOrigin: 'http://' + (window.location.hostname || 'localhost') + ':6185'
    };
  },
  mounted: function () {
    var self = this;
    // 12 秒内没触发 load 视为 WebUI 未启动
    this.loadTimer = setTimeout(function () {
      if (!self.loaded) self.failed = true;
    }, 12000);
  },
  beforeDestroy: function () {
    if (this.loadTimer) clearTimeout(this.loadTimer);
  },
  methods: {
    onLoad: function () {
      this.loaded = true;
      this.failed = false;
      if (this.loadTimer) clearTimeout(this.loadTimer);
    },
    reload: function () {
      this.loaded = false;
      this.failed = false;
      var self = this;
      this.loadTimer = setTimeout(function () {
        if (!self.loaded) self.failed = true;
      }, 12000);
      this.$refs.frame.src = this.webuiOrigin;
    },
    openNewWindow: function () {
      window.open(this.webuiOrigin, '_blank');
    }
  }
};
</script>

<style scoped>
.bot-admin-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px 16px;
  box-sizing: border-box;
}
.ba-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.ba-title {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ba-actions {
  display: flex;
  gap: 8px;
}
.ba-btn {
  border: 1px solid rgba(128, 128, 128, 0.35);
  background: transparent;
  color: inherit;
  border-radius: var(--radius-sm);
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ba-btn-primary {
  background: #5e5ce6;
  border-color: #5e5ce6;
  color: #fff;
}
.ba-tip {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: rgba(94, 92, 230, 0.12);
  margin-bottom: 10px;
  font-size: 13px;
}
.ba-tip-err {
  background: rgba(255, 99, 71, 0.14);
}
.ba-frame {
  flex: 1;
  width: 100%;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: var(--radius-md);
  background: #fff;
}
</style>
