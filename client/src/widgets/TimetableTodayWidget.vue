<template>
  <div class="timetable-widget">
    <div v-if="loading" class="tw-loading">
      <div class="tw-spinner"></div>
    </div>
    <div v-else-if="error" class="tw-error">
      <i class="fa-solid fa-circle-exclamation"></i>
      <span>加载失败</span>
    </div>
    <div v-else-if="todayHoliday" class="tw-holiday">
      <i class="fa-solid fa-umbrella-beach"></i>
      <div class="tw-holiday-text">
        <span class="tw-holiday-name">{{ todayHoliday.name }}</span>
        <span class="tw-holiday-label">今日放假</span>
      </div>
    </div>
    <div v-else class="tw-content">
      <div class="tw-header">
        <span class="tw-date">{{ dateLabel }}</span>
        <span class="tw-week-type" :class="weekType">{{ weekType === 'odd' ? '单' : '双' }}</span>
      </div>
      <div v-if="nextClassInfo.class" class="tw-next" :class="nextClassInfo.status">
        <div
          class="tw-next-subject"
          :style="{ background: getSubjectColor(nextClassInfo.class.subject) }"
        >{{ getSimplified(nextClassInfo.class.subject) }}</div>
        <div class="tw-next-info">
          <span class="tw-next-name">{{ nextClassInfo.class.subject }}</span>
          <span class="tw-next-time">{{ formatTime(nextClassInfo.class.start_time) }}</span>
        </div>
        <span class="tw-next-countdown" v-if="nextClassInfo.status === 'upcoming'">{{ countdown }}</span>
        <span class="tw-next-countdown ongoing" v-else-if="nextClassInfo.status === 'ongoing'">进行中</span>
      </div>
      <div v-else class="tw-next tw-next-done">
        <i class="fa-solid fa-circle-check"></i>
        <span>今日课程已结束</span>
      </div>
      <div class="tw-classes" v-if="todayClasses.length">
        <div
          v-for="(cls, idx) in todayClasses"
          :key="idx"
          class="tw-class-dot"
          :class="{ ongoing: isOngoing(cls), ended: isEnded(cls) }"
          :style="{ background: getSubjectColor(cls.subject) }"
          :title="cls.subject + ' ' + formatTime(cls.start_time)"
        ></div>
      </div>
    </div>
  </div>
</template>

<script>
import api from '@/utils/api';
import {
  calcWeekNumber,
  formatDateStr,
  getDayClasses,
  findHoliday,
  findAdjustment,
  getEffectiveDay,
  findNextClass,
  formatCountdown,
  timeStrToTodayMs,
  formatTime,
  getSubjectColor
} from '@/widgets/timetable-helpers';

var DAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default {
  name: 'TimetableTodayWidget',
  props: {
    config: {
      type: Object,
      default: function() { return {}; }
    }
  },
  data: function() {
    return {
      loading: true,
      error: '',
      raw: null,
      termStart: '',
      weekType: 'odd',
      nowTime: Date.now()
    };
  },
  computed: {
    todayDateStr: function() {
      return formatDateStr(new Date());
    },
    dateLabel: function() {
      var d = new Date();
      var day = d.getDay();
      var label = day === 0 ? '周日' : DAY_LABELS[day];
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + label;
    },
    todayHoliday: function() {
      if (!this.raw || !this.raw.holidays) return null;
      return findHoliday(this.todayDateStr, this.raw.holidays);
    },
    todayAdjustment: function() {
      if (!this.raw || !this.raw.adjustments) return null;
      return findAdjustment(this.todayDateStr, this.raw.adjustments);
    },
    todayClasses: function() {
      if (!this.raw || this.todayHoliday) return [];
      var eff = getEffectiveDay(new Date().getDay(), this.todayDateStr, this.raw.adjustments, this.weekType);
      return getDayClasses(this.raw, eff.day, eff.weekType);
    },
    nextClassInfo: function() {
      var _ = this.nowTime;
      return findNextClass(this.todayClasses, this.nowTime);
    },
    countdown: function() {
      if (!this.nextClassInfo.class || this.nextClassInfo.status !== 'upcoming') return '';
      var targetMs = timeStrToTodayMs(this.nextClassInfo.class.start_time);
      return formatCountdown(targetMs, this.nowTime);
    }
  },
  mounted: function() {
    var self = this;
    // 不缓存：每次 mounted 都重新请求
    self.termStart = localStorage.getItem('timetable_term_start') || self.guessTermStart();
    var weekNum = calcWeekNumber(self.termStart);
    self.weekType = weekNum % 2 === 1 ? 'odd' : 'even';
    self.loadData();
    // 每分钟刷新时间（用于下节课倒计时和当前课高亮）
    self._timer = setInterval(function() { self.nowTime = Date.now(); }, 60000);
    // 页面重新可见时重新加载
    self._visibilityHandler = function() {
      if (!document.hidden) self.loadData();
    };
    document.addEventListener('visibilitychange', self._visibilityHandler);
  },
  beforeDestroy: function() {
    var self = this;
    if (self._timer) clearInterval(self._timer);
    if (self._visibilityHandler) {
      document.removeEventListener('visibilitychange', self._visibilityHandler);
    }
  },
  methods: {
    loadData: function() {
      var self = this;
      self.loading = true;
      api.get('/timetable').then(function(res) {
        self.loading = false;
        if (res.data && res.data.code === 200) {
          self.raw = res.data.data;
        } else {
          self.error = (res.data && res.data.message) || '加载失败';
        }
      }).catch(function(err) {
        self.loading = false;
        self.error = (err && err.message) || '网络错误';
      });
    },
    guessTermStart: function() {
      var now = new Date();
      var year = now.getFullYear();
      if (now.getMonth() < 8) year = year - 1;
      return year + '-09-01';
    },
    getSimplified: function(subjectName) {
      if (!this.raw || !this.raw.subjects) return subjectName;
      for (var i = 0; i < this.raw.subjects.length; i++) {
        if (this.raw.subjects[i].name === subjectName) {
          return this.raw.subjects[i].simplified_name || subjectName;
        }
      }
      return subjectName;
    },
    isOngoing: function(cls) {
      var _ = this.nowTime;
      if (!cls || !cls.start_time) return false;
      var now = new Date();
      var nowMin = now.getHours() * 60 + now.getMinutes();
      var sp = cls.start_time.split(':');
      var ep = cls.end_time.split(':');
      var s = parseInt(sp[0], 10) * 60 + parseInt(sp[1], 10);
      var e = parseInt(ep[0], 10) * 60 + parseInt(ep[1], 10);
      return nowMin >= s && nowMin <= e;
    },
    isEnded: function(cls) {
      if (!cls || !cls.end_time) return false;
      if (this.isOngoing(cls)) return false;
      var now = new Date();
      var nowMin = now.getHours() * 60 + now.getMinutes();
      var ep = cls.end_time.split(':');
      var e = parseInt(ep[0], 10) * 60 + parseInt(ep[1], 10);
      return nowMin > e;
    },
    formatTime: function(t) { return formatTime(t); },
    getSubjectColor: function(name) { return getSubjectColor(name); }
  }
};
</script>

<style scoped>
.timetable-widget {
  width: 100%;
  height: 100%;
  background: var(--card-bg, rgba(255,255,255,0.7));
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border-radius: 22px;
  padding: 14px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--text-primary, #1d1d1f);
  overflow: hidden;
  box-shadow: 0 2px 16px rgba(0,0,0,0.08);
}

/* 加载/错误状态 */
.tw-loading, .tw-error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 0.5;
}
.tw-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(0,0,0,0.1);
  border-top-color: #007AFF;
  border-radius: 50%;
  animation: twSpin 0.8s linear infinite;
}
@keyframes twSpin { to { transform: rotate(360deg); } }
.tw-error i { font-size: 20px; }
.tw-error span { font-size: 12px; }

/* 节假日 */
.tw-holiday {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #FF453A;
}
.tw-holiday i { font-size: 28px; }
.tw-holiday-text {
  display: flex;
  flex-direction: column;
}
.tw-holiday-name {
  font-size: 18px;
  font-weight: 700;
}
.tw-holiday-label {
  font-size: 11px;
  opacity: 0.7;
}

/* 内容区 */
.tw-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 头部 */
.tw-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tw-date {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.8;
}
.tw-week-type {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 8px;
}
.tw-week-type.odd {
  background: rgba(255, 69, 58, 0.15);
  color: #FF453A;
}
.tw-week-type.even {
  background: rgba(0, 122, 255, 0.15);
  color: #007AFF;
}

/* 下节课 */
.tw-next {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 14px;
  background: rgba(0,0,0,0.04);
  transition: all 0.3s;
}
.tw-next.upcoming {
  background: rgba(0, 122, 255, 0.08);
  box-shadow: 0 0 0 1px rgba(0, 122, 255, 0.2);
}
.tw-next.ongoing {
  background: rgba(52, 199, 89, 0.1);
  box-shadow: 0 0 0 1px #34C759;
}
.tw-next-subject {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}
.tw-next-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.tw-next-name {
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tw-next-time {
  font-size: 11px;
  opacity: 0.6;
}
.tw-next-countdown {
  font-size: 12px;
  font-weight: 700;
  color: #007AFF;
  white-space: nowrap;
}
.tw-next-countdown.ongoing {
  color: #34C759;
}
.tw-next-done {
  color: #34C759;
  font-size: 13px;
  font-weight: 600;
  justify-content: center;
}
.tw-next-done i { font-size: 18px; }

/* 今日课节缩略条 */
.tw-classes {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  align-items: center;
}
.tw-class-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  opacity: 0.5;
  transition: all 0.2s;
}
.tw-class-dot.ongoing {
  opacity: 1;
  transform: scale(1.3);
  box-shadow: 0 0 0 2px rgba(255,255,255,0.5);
}
.tw-class-dot.ended {
  opacity: 0.25;
}
</style>
