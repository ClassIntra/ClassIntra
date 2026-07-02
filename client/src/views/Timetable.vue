<template>
  <div class="timetable-page">
    <AppNavBar title="课程表">
      <template slot="actions">
        <button class="week-toggle" :class="weekType" @click="toggleWeekType">
          {{ weekType === 'odd' ? '单周' : '双周' }}
        </button>
      </template>
    </AppNavBar>

    <div class="status-bar">
      <div class="week-info" @click="showTermStartPicker = !showTermStartPicker" v-if="!showTermStartPicker">
        <span class="week-num">第 {{ weekNumber }} 周</span>
        <span class="week-sep">·</span>
        <span class="week-type-label" :class="weekType">{{ weekType === 'odd' ? '单周' : '双周' }}</span>
        <i class="fa-solid fa-pen-to-square edit-icon"></i>
      </div>
      <div class="term-picker" v-else>
        <span class="picker-label">开学日期</span>
        <input type="date" v-model="termStart" @change="onTermStartChange" />
        <button class="picker-confirm" @click="showTermStartPicker = false">确定</button>
      </div>
      <div class="today-info">{{ todayLabel }}</div>
    </div>

    <div v-if="loading && !raw" class="loading-state">
      <div class="skeleton-pulse"></div>
      <p class="loading-text">加载课表中...</p>
    </div>

    <div v-else-if="error" class="error-state">
      <i class="fa-solid fa-circle-exclamation"></i>
      <p>{{ error }}</p>
      <button class="btn-retry" @click="loadData">重试</button>
    </div>

    <div v-else-if="rows.length" class="timetable-scroll">
      <table class="timetable-table">
        <thead>
          <tr>
            <th class="corner-cell"></th>
            <th
              v-for="day in days"
              :key="day.value"
              class="day-header"
              :class="{ today: isToday(day.value), weekend: day.value === 6 || day.value === 7 }"
            >
              <span class="day-name">{{ day.label }}</span>
              <span class="day-date">{{ day.dateStr }}</span>
              <span v-if="!day.hasSchool" class="no-school-tag">无课</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in rows" :key="ri" :class="{ 'period-start': row.period }">
            <td class="period-cell">
              <span v-if="row.period" class="period-name">{{ row.period }}</span>
            </td>
            <td
              v-for="day in days"
              :key="day.value"
              class="class-cell"
              :class="{ today: isToday(day.value) }"
            >
              <div
                v-if="row.cells[day.value]"
                class="class-item"
                :style="{ background: row.cells[day.value].bg, color: row.cells[day.value].color }"
                :class="{ current: isCurrentClass(row.cells[day.value], day.value) }"
              >
                <span class="class-name">{{ row.cells[day.value].simplified }}</span>
                <span class="class-time">{{ formatTime(row.cells[day.value].start) }}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="legend">
        <div class="legend-title">科目图例</div>
        <div class="legend-grid">
          <div v-for="subj in legendSubjects" :key="subj.name" class="legend-item">
            <span class="legend-dot" :style="{ background: subj.color }"></span>
            <span class="legend-text">{{ subj.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <i class="fa-solid fa-calendar-xmark"></i>
      <p>暂无课表数据</p>
    </div>
  </div>
</template>

<script>
import AppNavBar from '@/components/AppNavBar.vue';
import api from '@/utils/api';

// 科目颜色映射（iOS 系统配色，亮色/暗色模式均可读）
var SUBJECT_COLORS = {
  '语文': '#FF453A',
  '数学': '#007AFF',
  '英语': '#34C759',
  '物理': '#FF9500',
  '化学': '#AF52DE',
  '生物': '#5AC8FA',
  '历史': '#FFCC00',
  '地理': '#5856D6',
  '政治': '#FF2D55',
  '体育': '#30D158',
  '音乐': '#FF375F',
  '美术': '#BF5AF2',
  '信息技术': '#64D2FF',
  '通用技术': '#64D2FF',
  '自习': '#8E8E93',
  '早读': '#FF9F0A',
  '班会': '#FF453A',
  '周测': '#FF6961',
  '新闻联播': '#0A84FF',
  '课外活动': '#30D158',
  '听力': '#0A84FF',
  '社团': '#BF5AF2',
  '心理': '#FF375F',
  '考试': '#FF453A'
};

var DAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// 时段显示顺序
var PERIOD_ORDER = ['早读', '上午', '下午', '课外活动', '听力', '新闻联播', '晚自习', '收尾'];

// 根据 'HH:MM:SS' 判断所属时段
function getPeriodKey(timeStr) {
  var parts = timeStr.split(':');
  var minutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  if (minutes < 8 * 60) return '早读';
  if (minutes < 12 * 60) return '上午';
  if (minutes < 17 * 60 + 20) return '下午';
  if (minutes < 18 * 60) return '课外活动';
  if (minutes < 19 * 60 + 10) return '听力';
  if (minutes < 19 * 60 + 30) return '新闻联播';
  if (minutes < 21 * 60 + 30) return '晚自习';
  return '收尾';
}

// hex 转 rgba 字符串（用于卡片半透明背景）
function hexToRgba(hex, alpha) {
  var r = parseInt(hex.substring(1, 3), 16);
  var g = parseInt(hex.substring(3, 5), 16);
  var b = parseInt(hex.substring(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// '06:50:00' -> '06:50'
function formatTime(t) {
  if (!t) return '';
  return t.substring(0, 5);
}

// 根据开学日期计算当前是第几周
function calcWeekNumber(termStart) {
  if (!termStart) return 1;
  var start = new Date(termStart + 'T00:00:00');
  var now = new Date();
  var diff = now - start;
  if (diff < 0) return 1;
  var days = Math.floor(diff / (24 * 60 * 60 * 1000));
  return Math.floor(days / 7) + 1;
}

// 计算本周各天的日期字符串
function getWeekDates() {
  var now = new Date();
  var day = now.getDay(); // 0=周日, 1=周一...
  var monday = new Date(now);
  if (day === 0) {
    monday.setDate(now.getDate() - 6);
  } else {
    monday.setDate(now.getDate() - (day - 1));
  }
  var dates = {};
  for (var i = 1; i <= 7; i++) {
    var d = new Date(monday);
    d.setDate(monday.getDate() + (i - 1));
    dates[i] = (d.getMonth() + 1) + '/' + d.getDate();
  }
  return dates;
}

// 核心构建函数：把 API 数据转成表格行
// weekType: 'odd'（单周）| 'even'（双周）
function buildTimetable(data, weekType) {
  var subjectsMap = {};
  if (data && data.subjects) {
    data.subjects.forEach(function(s) {
      subjectsMap[s.name] = s;
    });
  }

  // 按天筛选当前周次适用的 schedule
  // weeks='all' 总是适用；'odd'/'even' 仅对应周次适用
  var daySchedules = {};
  if (data && data.schedules) {
    data.schedules.forEach(function(sch) {
      if (sch.weeks === 'all' || sch.weeks === weekType) {
        daySchedules[sch.enable_day] = sch;
      }
    });
  }

  // 按天 -> 时段 -> 课节分组
  var dayPeriodClasses = {};
  for (var day = 1; day <= 7; day++) {
    dayPeriodClasses[day] = {};
    var sch = daySchedules[day];
    if (sch && sch.classes) {
      sch.classes.forEach(function(cls) {
        var period = getPeriodKey(cls.start_time);
        if (!dayPeriodClasses[day][period]) dayPeriodClasses[day][period] = [];
        dayPeriodClasses[day][period].push(cls);
      });
      // 每个时段内按开始时间排序
      Object.keys(dayPeriodClasses[day]).forEach(function(p) {
        dayPeriodClasses[day][p].sort(function(a, b) {
          return (a.start_time || '').localeCompare(b.start_time || '');
        });
      });
    }
  }

  // 找出每个时段的最大节次数（决定该时段占几行）
  var periodMaxSlots = {};
  PERIOD_ORDER.forEach(function(p) {
    var max = 0;
    for (var d = 1; d <= 7; d++) {
      var classes = dayPeriodClasses[d][p] || [];
      if (classes.length > max) max = classes.length;
    }
    periodMaxSlots[p] = max;
  });

  // 构建 rows：每个时段展开为 maxSlots 行，第一行带时段名
  var rows = [];
  PERIOD_ORDER.forEach(function(p) {
    if (periodMaxSlots[p] === 0) return; // 该时段全周均无课，跳过
    for (var slot = 0; slot < periodMaxSlots[p]; slot++) {
      var row = { period: slot === 0 ? p : '', periodKey: p, slotIndex: slot, cells: {} };
      for (var day = 1; day <= 7; day++) {
        var classes = dayPeriodClasses[day][p] || [];
        if (slot < classes.length) {
          var cls = classes[slot];
          var subj = subjectsMap[cls.subject] || { name: cls.subject, simplified_name: cls.subject };
          var color = SUBJECT_COLORS[cls.subject] || '#8E8E93';
          row.cells[day] = {
            subject: cls.subject,
            simplified: subj.simplified_name || cls.subject,
            start: cls.start_time,
            end: cls.end_time,
            color: color,
            bg: hexToRgba(color, 0.16)
          };
        } else {
          row.cells[day] = null;
        }
      }
      rows.push(row);
    }
  });

  return rows;
}

// 构建图例：只展示当前课表中实际出现的科目
function buildLegend(data, weekType) {
  if (!data || !data.schedules) return [];
  var appeared = {};
  data.schedules.forEach(function(sch) {
    if (sch.weeks === 'all' || sch.weeks === weekType) {
      (sch.classes || []).forEach(function(cls) {
        appeared[cls.subject] = true;
      });
    }
  });
  var result = [];
  Object.keys(appeared).forEach(function(name) {
    result.push({
      name: name,
      color: SUBJECT_COLORS[name] || '#8E8E93'
    });
  });
  result.sort(function(a, b) { return a.name.localeCompare(b.name, 'zh'); });
  return result;
}

export default {
  name: 'Timetable',
  components: { AppNavBar },
  data: function() {
    return {
      loading: false,
      error: '',
      raw: null,
      termStart: '',
      weekNumber: 1,
      weekType: 'odd',
      showTermStartPicker: false,
      weekDates: {},
      nowTime: Date.now()
    };
  },
  computed: {
    days: function() {
      var hasSchool = {};
      if (this.raw && this.raw.schedules) {
        var self = this;
        this.raw.schedules.forEach(function(sch) {
          if (sch.weeks === 'all' || sch.weeks === self.weekType) {
            hasSchool[sch.enable_day] = true;
          }
        });
      }
      var result = [];
      for (var i = 1; i <= 7; i++) {
        result.push({
          value: i,
          label: DAY_LABELS[i],
          dateStr: this.weekDates[i] || '',
          hasSchool: !!hasSchool[i]
        });
      }
      return result;
    },
    rows: function() {
      if (!this.raw) return [];
      return buildTimetable(this.raw, this.weekType);
    },
    legendSubjects: function() {
      return buildLegend(this.raw, this.weekType);
    },
    todayLabel: function() {
      var d = new Date();
      var day = d.getDay();
      var label = day === 0 ? '周日' : DAY_LABELS[day];
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + label;
    }
  },
  mounted: function() {
    // 不缓存：每次进入页面都重新请求后端
    this.termStart = localStorage.getItem('timetable_term_start') || this.guessTermStart();
    this.weekNumber = calcWeekNumber(this.termStart);
    this.weekType = this.weekNumber % 2 === 1 ? 'odd' : 'even';
    this.weekDates = getWeekDates();
    this.loadData();
    // 每分钟刷新当前时间，用于高亮"正在上的课"
    var self = this;
    this._timer = setInterval(function() { self.nowTime = Date.now(); }, 60000);
    // 页面重新可见时重新加载（不使用轮询，符合项目约定）
    this._visibilityHandler = function() {
      if (!document.hidden) self.loadData();
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  },
  beforeDestroy: function() {
    if (this._timer) clearInterval(this._timer);
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }
  },
  methods: {
    loadData: function() {
      var self = this;
      self.loading = true;
      self.error = '';
      api.get('/timetable').then(function(res) {
        self.loading = false;
        if (res.data && res.data.code === 200) {
          self.raw = res.data.data;
        } else {
          self.error = (res.data && res.data.message) || '加载课表失败';
        }
      }).catch(function(err) {
        self.loading = false;
        self.error = '网络错误：' + (err && err.message ? err.message : '请求失败');
      });
    },
    toggleWeekType: function() {
      this.weekType = this.weekType === 'odd' ? 'even' : 'odd';
    },
    onTermStartChange: function() {
      localStorage.setItem('timetable_term_start', this.termStart);
      this.weekNumber = calcWeekNumber(this.termStart);
      // 修改开学日期后同步当前周次类型
      this.weekType = this.weekNumber % 2 === 1 ? 'odd' : 'even';
    },
    // 猜测本学期开学日期：9月前用去年9月1日，9月后用今年9月1日
    guessTermStart: function() {
      var now = new Date();
      var year = now.getFullYear();
      if (now.getMonth() < 8) year = year - 1;
      return year + '-09-01';
    },
    isToday: function(dayValue) {
      var jsDay = new Date().getDay();
      // JS: 0=周日；本组件: 7=周日
      var target = jsDay === 0 ? 7 : jsDay;
      return target === dayValue;
    },
    isCurrentClass: function(cell, dayValue) {
      if (!cell || !this.isToday(dayValue)) return false;
      // 引用 nowTime 让 computed 响应
      var _ = this.nowTime;
      var now = new Date();
      var minutes = now.getHours() * 60 + now.getMinutes();
      var sp = cell.start.split(':');
      var ep = cell.end.split(':');
      var s = parseInt(sp[0], 10) * 60 + parseInt(sp[1], 10);
      var e = parseInt(ep[0], 10) * 60 + parseInt(ep[1], 10);
      return minutes >= s && minutes <= e;
    },
    formatTime: function(t) { return formatTime(t); }
  }
};
</script>

<style scoped>
.timetable-page {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-color, #f2f2f7);
  color: var(--text-color, #1d1d1f);
}

/* 单双周切换按钮 */
.week-toggle {
  height: 30px;
  padding: 0 14px;
  border-radius: 15px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.1));
  background: var(--card-bg, rgba(255,255,255,0.8));
  color: var(--text-color, #1d1d1f);
  font-size: var(--font-size-sm, 13px);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s var(--ease-standard, ease);
}
.week-toggle.odd {
  background: rgba(255, 69, 58, 0.15);
  color: #FF453A;
  border-color: rgba(255, 69, 58, 0.3);
}
.week-toggle.even {
  background: rgba(0, 122, 255, 0.15);
  color: #007AFF;
  border-color: rgba(0, 122, 255, 0.3);
}
.week-toggle:hover { transform: scale(1.05); }
.week-toggle:active { transform: scale(0.95); }

/* 状态条 */
.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.08));
  flex-shrink: 0;
  gap: 12px;
}
.week-info {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.week-num {
  font-size: var(--font-size-body, 15px);
  font-weight: 600;
}
.week-sep { opacity: 0.3; }
.week-type-label {
  font-size: var(--font-size-sm, 13px);
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 8px;
}
.week-type-label.odd {
  color: #FF453A;
  background: rgba(255, 69, 58, 0.1);
}
.week-type-label.even {
  color: #007AFF;
  background: rgba(0, 122, 255, 0.1);
}
.edit-icon {
  font-size: 11px;
  opacity: 0.4;
  margin-left: 2px;
}
.today-info {
  font-size: var(--font-size-sm, 13px);
  opacity: 0.5;
  white-space: nowrap;
}

/* 开学日期选择器 */
.term-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}
.picker-label {
  font-size: var(--font-size-sm, 13px);
  opacity: 0.7;
}
.term-picker input {
  padding: 5px 10px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.1));
  border-radius: 8px;
  background: var(--card-bg, #fff);
  color: var(--text-color, #1d1d1f);
  font-size: var(--font-size-sm, 13px);
}
.picker-confirm {
  padding: 5px 12px;
  border: none;
  border-radius: 8px;
  background: #007AFF;
  color: #fff;
  font-size: var(--font-size-sm, 13px);
  cursor: pointer;
}
.picker-confirm:active { transform: scale(0.95); }

/* 加载/错误/空状态 */
.loading-state, .error-state, .empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  opacity: 0.7;
}
.skeleton-pulse {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--card-bg, rgba(0,0,0,0.06));
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
.loading-text { font-size: var(--font-size-sm, 13px); opacity: 0.5; }
.error-state i, .empty-state i { font-size: 40px; opacity: 0.4; }
.btn-retry {
  padding: 6px 18px;
  min-height: 40px;
  background: var(--card-bg, rgba(0,0,0,0.06));
  border: 1px solid var(--border-color, rgba(0,0,0,0.1));
  border-radius: var(--radius-xl, 12px);
  color: var(--text-color, #1d1d1f);
  font-size: var(--font-size-sm, 13px);
  cursor: pointer;
  transition: all 0.2s;
}
.btn-retry:hover { background: var(--border-color, rgba(0,0,0,0.1)); }
.btn-retry:active { transform: scale(0.95); }

/* 课表主体 */
.timetable-scroll {
  flex: 1;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0;
}
.timetable-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
.timetable-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 2px; }

.timetable-table {
  border-collapse: separate;
  border-spacing: 0;
  width: max-content;
  min-width: 100%;
}

/* 表头 */
.corner-cell {
  position: sticky;
  top: 0;
  left: 0;
  z-index: 3;
  background: var(--bg-color, #f2f2f7);
  border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.08));
  border-right: 1px solid var(--border-color, rgba(0,0,0,0.08));
  width: 52px;
  min-width: 52px;
  height: 46px;
}
.day-header {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-color, #f2f2f7);
  border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.08));
  padding: 6px 4px;
  text-align: center;
  min-width: 68px;
  width: 68px;
  transition: background 0.2s;
}
.day-header.today {
  background: rgba(0, 122, 255, 0.08);
}
.day-header.today .day-name {
  color: #007AFF;
}
.day-header.weekend .day-name {
  opacity: 0.6;
}
.day-name {
  display: block;
  font-size: var(--font-size-sm, 13px);
  font-weight: 600;
}
.day-date {
  display: block;
  font-size: 10px;
  opacity: 0.45;
  margin-top: 2px;
}
.no-school-tag {
  display: block;
  font-size: 9px;
  color: #8E8E93;
  margin-top: 1px;
}

/* 时段列 */
.period-cell {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg-color, #f2f2f7);
  border-right: 1px solid var(--border-color, rgba(0,0,0,0.08));
  width: 52px;
  min-width: 52px;
  text-align: center;
  vertical-align: middle;
  padding: 4px 2px;
}
.period-name {
  font-size: var(--font-size-sm, 13px);
  font-weight: 600;
  color: var(--text-color, #1d1d1f);
  display: inline-block;
}

/* 课节单元格 */
.class-cell {
  padding: 3px;
  vertical-align: top;
  border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.04));
  min-width: 68px;
  width: 68px;
  height: 52px;
  text-align: center;
}
.class-cell.today {
  background: rgba(0, 122, 255, 0.03);
}
/* 时段起始行加粗上边框，视觉分组 */
tr.period-start td.class-cell {
  border-top: 1px solid var(--border-color, rgba(0,0,0,0.08));
}
tr.period-start .period-cell {
  border-top: 1px solid var(--border-color, rgba(0,0,0,0.08));
}

.class-item {
  border-radius: 8px;
  padding: 5px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 100%;
  box-sizing: border-box;
  transition: transform 0.15s, box-shadow 0.15s;
}
.class-item.current {
  box-shadow: 0 0 0 2px currentColor, 0 2px 8px rgba(0,0,0,0.15);
  animation: currentPulse 2s ease-in-out infinite;
}
@keyframes currentPulse {
  0%, 100% { box-shadow: 0 0 0 2px currentColor, 0 2px 8px rgba(0,0,0,0.15); }
  50% { box-shadow: 0 0 0 3px currentColor, 0 2px 12px rgba(0,0,0,0.2); }
}
.class-name {
  font-size: var(--font-size-body, 15px);
  font-weight: 700;
  line-height: 1.1;
}
.class-time {
  font-size: 10px;
  opacity: 0.65;
  font-weight: 500;
}

/* 科目图例 */
.legend {
  padding: 14px 16px 20px;
  border-top: 1px solid var(--border-color, rgba(0,0,0,0.08));
  margin-top: 4px;
}
.legend-title {
  font-size: var(--font-size-sm, 13px);
  font-weight: 600;
  opacity: 0.5;
  margin-bottom: 8px;
}
.legend-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}
.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.legend-text {
  font-size: var(--font-size-sm, 13px);
  opacity: 0.8;
}

/* 小屏适配 */
@media (max-width: 600px) {
  .corner-cell, .period-cell {
    width: 44px;
    min-width: 44px;
  }
  .day-header, .class-cell {
    min-width: 56px;
    width: 56px;
  }
  .class-cell { height: 46px; }
  .class-name { font-size: 14px; }
  .class-time { font-size: 9px; }
  .day-name { font-size: 12px; }
  .day-date { font-size: 9px; }
  .period-name { font-size: 12px; }
}

@media (max-width: 400px) {
  .corner-cell, .period-cell {
    width: 38px;
    min-width: 38px;
  }
  .day-header, .class-cell {
    min-width: 48px;
    width: 48px;
  }
  .class-cell { height: 42px; }
  .class-name { font-size: 13px; }
}
</style>
