<template>
  <div class="lock-screen" @click="handleTap" @touchend.prevent="handleTap">
    <div class="lock-center">
      <!-- 挂锁图标：内联 SVG，造型按参考图还原（圆弧锁梁 + 圆角锁体 + 锁孔） -->
      <svg class="lock-glyph" viewBox="0 0 39 53" width="31" height="42" aria-hidden="true">
        <defs>
          <mask id="ciLockKeyhole">
            <rect x="0" y="0" width="39" height="53" fill="#ffffff"></rect>
            <circle cx="18.5" cy="30.5" r="3.75" fill="#000000"></circle>
            <path d="M16.5 30.5 V43 a2 2 0 0 0 4 0 V30.5 Z" fill="#000000"></path>
          </mask>
        </defs>
        <!-- 锁梁：描边圆弧 + 两条直腿 -->
        <path class="lock-shackle" d="M9.25 16.5 V11.5 A9.25 9.25 0 0 1 27.75 11.5 V16.5"
              fill="none" stroke="currentColor" stroke-width="4.5"></path>
        <!-- 锁体：圆角矩形，用 mask 打出锁孔 -->
        <rect x="0" y="19" width="38.5" height="33" rx="4.5"
              fill="currentColor" mask="url(#ciLockKeyhole)"></rect>
      </svg>
      <div class="lock-caption">锁屏中</div>
    </div>

    <div class="lock-footer">
      <span class="lock-footer-item" v-if="wifiKnown">WIFI: {{ wifiName || '未连接' }}</span>
      <span class="lock-footer-sep" v-if="wifiKnown" aria-hidden="true"></span>
      <span class="lock-footer-item">{{ classInfoText }}</span>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';

// 班级名与访问地址是固定值（部署时写死，不随环境漂移）
var CLASS_INFO_TEXT = '班级名称/IP: 智慧课堂(192.168.40.90:8022)';
// 轮询间隔：服务端本身有 15s 缓存，这里放宽到 30s，避免长时间锁屏时反复打扰
var NET_POLL_MS = 30000;

export default {
  name: 'LockScreen',
  data: function() {
    return {
      tapTimes: [],
      // 班级信息固定；WiFi 名由服务端探测（浏览器读不到 SSID）
      classInfoText: CLASS_INFO_TEXT,
      wifiName: '',
      wifiKnown: false,
      _wifiTimer: null
    };
  },
  created: function() {
    this.fetchNetworkInfo();
    var self = this;
    this._wifiTimer = setInterval(function() {
      self.fetchNetworkInfo();
    }, NET_POLL_MS);
  },
  beforeDestroy: function() {
    if (this._wifiTimer) {
      clearInterval(this._wifiTimer);
      this._wifiTimer = null;
    }
  },
  methods: {
    // 取当前网络名；失败也「已知」（显示未连接），避免整块布局在间距上抖动
    fetchNetworkInfo: function() {
      var self = this;
      api.get('/system/network-info').then(function(res) {
        var data = (res.data && res.data.data) || {};
        self.wifiName = typeof data.wifi === 'string' ? data.wifi : '';
        self.wifiKnown = true;
      }).catch(function() {
        self.wifiKnown = true;
        self.wifiName = '';
      });
    },
    handleTap: function(e) {
      var x = e.clientX;
      var y = e.clientY;
      if (e.changedTouches && e.changedTouches.length > 0) {
        x = e.changedTouches[0].clientX;
        y = e.changedTouches[0].clientY;
      }
      var w = window.innerWidth;
      var h = window.innerHeight;
      // 解锁手势保留原设计：右上角区域（x>70% 且 y<30%）3 秒内连点 10 次
      if (x < w * 0.7 || y > h * 0.3) return;
      var now = Date.now();
      // 超过 3 秒间隔则重新计数
      var times = this.tapTimes;
      if (times.length > 0 && now - times[times.length - 1] > 3000) {
        this.tapTimes = [];
      }
      this.tapTimes.push(now);
      if (this.tapTimes.length > 10) {
        this.tapTimes = this.tapTimes.slice(-10);
      }
      if (this.tapTimes.length === 10) {
        var diff = this.tapTimes[9] - this.tapTimes[0];
        if (diff < 3000) {
          this.tapTimes = [];
          this.$emit('unlock');
        }
      }
    }
  }
};
</script>

<style scoped>
/* ============================================================
   锁屏：纯黑 + 居中挂锁图标 + 「锁屏中」+ 底部网络/班级信息
   原始规格按参考图逐像素量取（1043x787 视口）后整体缩到 0.8 档：
     图标 39x53 → 31x42，字「锁屏中」21px → 17px，页脚 14px → 11px
   班级名称/IP 固定写死；WIFI 名取服务端探测结果（动态）
   解锁手势（右上角连点 10 次）完全静默：不显示任何进度反馈
   Chrome 80 基线：不使用 gap / inset / :is() / aspect-ratio
   ============================================================ */
.lock-screen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 99999;
  cursor: default;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  overflow: hidden;
  background: #000000;
}

/* ---------- 居中区：图标 + 文案 ---------- */
.lock-center {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 参考图中的内容重心略高于几何中心，用底部内边距补偿 */
  padding-bottom: 19px;
  box-sizing: border-box;
}

.lock-glyph {
  display: block;
  width: 31px;
  height: 42px;
  color: #424242;
  margin-bottom: 14px;
}

.lock-caption {
  font-size: 17px;
  line-height: 1;
  color: #4d4d4d;
}

/* ---------- 底部：网络 / 班级信息 ---------- */
.lock-footer {
  position: absolute;
  bottom: 6px;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lock-footer-item {
  font-size: 11px;
  line-height: 1;
  color: #595959;
  white-space: nowrap;
  letter-spacing: 0.2px;
}

/* 分隔线：比文字略高，颜色更深 */
.lock-footer-sep {
  display: block;
  width: 1px;
  height: 14px;
  margin-left: 25px;
  margin-right: 25px;
  background: #3e3e3e;
}

/* ---------- 小屏：在 0.8 档基础上再收一档 ---------- */
@media (max-width: 720px) {
  .lock-center {
    padding-bottom: 16px;
  }
  .lock-glyph {
    width: 25px;
    height: 34px;
    margin-bottom: 11px;
  }
  .lock-caption {
    font-size: 14px;
  }
  .lock-footer {
    bottom: 5px;
  }
  .lock-footer-item {
    font-size: 10px;
  }
  .lock-footer-sep {
    height: 12px;
    margin-left: 15px;
    margin-right: 15px;
  }
}
</style>
