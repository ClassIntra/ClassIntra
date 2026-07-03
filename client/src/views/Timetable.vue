<template>
  <div class="timetable-page">
    <AppNavBar title="课程表">
      <template slot="actions">
        <div class="nav-actions">
          <div class="view-toggle">
            <button
              class="view-toggle-btn"
              :class="{ active: viewMode === 'week' }"
              @click="viewMode = 'week'"
            >周</button>
            <button
              class="view-toggle-btn"
              :class="{ active: viewMode === 'today' }"
              @click="viewMode = 'today'"
            >日</button>
          </div>
          <button class="week-toggle" :class="weekType" @click="toggleWeekType">
            {{ weekType === 'odd' ? '单周' : '双周' }}
          </button>
        </div>
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

    <!-- ========== 周视图 ========== -->
    <div v-else-if="viewMode === 'week' && rows.length" class="timetable-scroll">
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
              <span v-if="day.holiday" class="day-tag tag-holiday" :title="day.holiday.name">休</span>
              <span v-else-if="day.adjustment" class="day-tag tag-adjust" :title="day.adjustment.note">调</span>
              <span v-else-if="!day.hasSchool" class="no-school-tag">无课</span>
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

    <!-- ========== 当天视图 ========== -->
    <div v-else-if="viewMode === 'today' && raw" class="today-view">
      <!-- 节假日/调休横幅 -->
      <div v-if="todayHoliday" class="banner banner-holiday">
        <i class="fa-solid fa-umbrella-beach"></i>
        <span>今日放假 · {{ todayHoliday.name }}</span>
      </div>
      <div v-else-if="todayAdjustment" class="banner banner-adjust">
        <i class="fa-solid fa-shuffle"></i>
        <span>按{{ dayLabel(todayAdjustment.as_day) }}课表 · {{ todayAdjustment.note }}</span>
      </div>

      <!-- 下节课卡片 -->
      <div v-if="!todayHoliday" class="next-class-card" :class="nextClassInfo.status">
        <div class="next-class-header">
          <span class="next-class-label">{{ nextClassLabel }}</span>
          <span class="next-class-countdown" v-if="nextClassInfo.class">{{ nextClassCountdown }}</span>
        </div>
        <div v-if="nextClassInfo.class" class="next-class-body">
          <div
            class="next-class-subject"
            :style="{ background: getSubjectColor(nextClassInfo.class.subject), color: '#fff' }"
          >{{ getSimplified(nextClassInfo.class.subject) }}</div>
          <div class="next-class-time">
            <span class="ncs-name">{{ nextClassInfo.class.subject }}</span>
            <span class="ncs-time">{{ formatTime(nextClassInfo.class.start_time) }} - {{ formatTime(nextClassInfo.class.end_time) }}</span>
          </div>
        </div>
        <div v-else class="next-class-empty">
          <i class="fa-solid fa-circle-check"></i>
          <span>今日课程已结束</span>
        </div>
      </div>

      <!-- 今日课节列表 -->
      <div v-if="!todayHoliday" class="today-list">
        <div class="today-list-header">
          <span>今日课节（{{ todayClassesWithOverride.length }}节）</span>
          <button v-if="hasOverrides" class="reset-overrides-btn" @click="resetOverrides">
            <i class="fa-solid fa-rotate-left"></i> 重置调课
          </button>
        </div>
        <div class="today-list-body">
          <div
            v-for="(cls, idx) in todayClassesWithOverride"
            :key="idx"
            class="today-item"
            :class="{
              ongoing: isOngoingClass(cls),
              upcoming: isUpcomingClass(cls),
              ended: isEndedClass(cls),
              adjusted: cls._adjusted
            }"
          >
            <div class="today-item-time">
              <span class="ti-time-start">{{ formatTime(cls.start_time) }}</span>
              <span class="ti-time-end">{{ formatTime(cls.end_time) }}</span>
            </div>
            <div
              class="today-item-subject"
              :style="{ background: hexToRgba(getSubjectColor(cls.subject), 0.16), color: getSubjectColor(cls.subject) }"
            >
              <span class="ti-simplified">{{ getSimplified(cls.subject) }}</span>
              <span v-if="cls._adjusted" class="ti-adjusted-tag">调</span>
            </div>
            <button class="today-item-edit" @click="openOverrideEditor(idx)" title="调课">
              <i class="fa-solid fa-pen"></i>
            </button>
          </div>
          <div v-if="!todayClassesWithOverride.length" class="today-empty">
            <i class="fa-solid fa-calendar-xmark"></i>
            <p>今日无课</p>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <i class="fa-solid fa-calendar-xmark"></i>
      <p>暂无课表数据</p>
    </div>

    <!-- ========== 调课编辑弹窗 ========== -->
    <div v-if="overrideEditor.open" class="override-editor-mask" @click.self="closeOverrideEditor">
      <div class="override-editor">
        <div class="oe-header">
          <span class="oe-title">调课 · 第 {{ overrideEditor.idx + 1 }} 节</span>
          <button class="oe-close" @click="closeOverrideEditor"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="oe-body">
          <div class="oe-field">
            <label>科目</label>
            <select v-model="overrideEditor.form.subject">
              <option value="">-- 选择科目 --</option>
              <option v-for="s in raw.subjects" :key="s.name" :value="s.name">{{ s.name }}</option>
            </select>
          </div>
          <div class="oe-field-row">
            <div class="oe-field">
              <label>开始时间</label>
              <input type="time" v-model="overrideEditor.form.start_time" />
            </div>
            <div class="oe-field">
              <label>结束时间</label>
              <input type="time" v-model="overrideEditor.form.end_time" />
            </div>
          </div>
        </div>
        <div class="oe-actions">
          <button class="oe-btn oe-btn-delete" @click="deleteOverride" v-if="overrideEditor.idx !== null">
            <i class="fa-solid fa-trash"></i> 删除此节
          </button>
          <button class="oe-btn oe-btn-insert" @click="insertOverrideAfter" v-if="overrideEditor.idx !== null">
            <i class="fa-solid fa-plus"></i> 后插一节
          </button>
          <button class="oe-btn oe-btn-save" @click="saveOverride">保存</button>
          <button class="oe-btn oe-btn-cancel" @click="closeOverrideEditor">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import AppNavBar from '@/components/AppNavBar.vue';
import api from '@/utils/api';
import {
  SUBJECT_COLORS,
  DAY_LABELS,
  PERIOD_ORDER,
  getPeriodKey,
  hexToRgba,
  formatTime,
  calcWeekNumber,
  getWeekDates,
  formatDateStr,
  jsDayToCompDay,
  getDayClasses,
  findHoliday,
  findAdjustment,
  getEffectiveDay,
  findNextClass,
  formatCountdown,
  timeStrToTodayMs,
  getSubjectColor
} from '@/widgets/timetable-helpers';

// 构建周视图表格行（保持原逻辑）
function buildTimetable(data, weekType) {
  var subjectsMap = {};
  if (data && data.subjects) {
    data.subjects.forEach(function(s) {
      subjectsMap[s.name] = s;
    });
  }

  // 按天筛选当前周次适用的 schedule
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
      Object.keys(dayPeriodClasses[day]).forEach(function(p) {
        dayPeriodClasses[day][p].sort(function(a, b) {
          return (a.start_time || '').localeCompare(b.start_time || '');
        });
      });
    }
  }

  // 找出每个时段的最大节次数
  var periodMaxSlots = {};
  PERIOD_ORDER.forEach(function(p) {
    var max = 0;
    for (var d = 1; d <= 7; d++) {
      var classes = dayPeriodClasses[d][p] || [];
      if (classes.length > max) max = classes.length;
    }
    periodMaxSlots[p] = max;
  });

  // 构建 rows
  var rows = [];
  PERIOD_ORDER.forEach(function(p) {
    if (periodMaxSlots[p] === 0) return;
    for (var slot = 0; slot < periodMaxSlots[p]; slot++) {
      var row = { period: slot === 0 ? p : '', periodKey: p, slotIndex: slot, cells: {} };
      for (var day2 = 1; day2 <= 7; day2++) {
        var classes = dayPeriodClasses[day2][p] || [];
        if (slot < classes.length) {
          var cls = classes[slot];
          var subj = subjectsMap[cls.subject] || { name: cls.subject, simplified_name: cls.subject };
          var color = getSubjectColor(cls.subject);
          row.cells[day2] = {
            subject: cls.subject,
            simplified: subj.simplified_name || cls.subject,
            start: cls.start_time,
            end: cls.end_time,
            color: color,
            bg: hexToRgba(color, 0.16)
          };
        } else {
          row.cells[day2] = null;
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
      color: getSubjectColor(name)
    });
  });
  result.sort(function(a, b) { return a.name.localeCompare(b.name, 'zh'); });
  return result;
}

// 计算本周各天的 'YYYY-MM-DD' 字符串（用于节假日查询）
function getWeekDateStrs() {
  var now = new Date();
  var day = now.getDay();
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
    dates[i] = formatDateStr(d);
  }
  return dates;
}

// ===== 本地调课存储（按日期隔离）=====
function loadOverrides(dateStr) {
  if (!dateStr) return [];
  try {
    var raw = localStorage.getItem('timetable_overrides_' + dateStr);
    if (!raw) return [];
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveOverrides(dateStr, list) {
  if (!dateStr) return;
  try {
    localStorage.setItem('timetable_overrides_' + dateStr, JSON.stringify(list));
  } catch (e) {}
}

function clearOverrides(dateStr) {
  if (!dateStr) return;
  try {
    localStorage.removeItem('timetable_overrides_' + dateStr);
  } catch (e) {}
}

// 应用调课到今日课节数组
// overrides: [{ idx, action: 'replace'|'delete'|'insert', subject?, start_time?, end_time? }]
function applyOverrides(classes, overrides) {
  if (!overrides || !overrides.length) return classes.map(function(c) {
    return Object.assign({}, c, { _adjusted: false });
  });
  // 按 idx 排序，倒序处理 delete/insert 避免索引错乱
  // 这里采用顺序重建：先复制原数组，再逐个应用
  var result = classes.map(function(c) {
    return Object.assign({}, c, { _adjusted: false });
  });
  // 先处理 replace 和 delete
  var sortedReplaces = overrides.filter(function(o) { return o.action === 'replace'; }).sort(function(a, b) { return a.idx - b.idx; });
  var sortedDeletes = overrides.filter(function(o) { return o.action === 'delete'; }).sort(function(a, b) { return b.idx - a.idx; });
  var sortedInserts = overrides.filter(function(o) { return o.action === 'insert'; }).sort(function(a, b) { return a.idx - b.idx; });

  sortedReplaces.forEach(function(o) {
    if (o.idx >= 0 && o.idx < result.length) {
      result[o.idx] = Object.assign({}, result[o.idx], {
        subject: o.subject || result[o.idx].subject,
        start_time: o.start_time || result[o.idx].start_time,
        end_time: o.end_time || result[o.idx].end_time,
        _adjusted: true
      });
    }
  });

  sortedDeletes.forEach(function(o) {
    if (o.idx >= 0 && o.idx < result.length) {
      result.splice(o.idx, 1);
    }
  });

  sortedInserts.forEach(function(o) {
    var insertAt = o.idx + 1;
    if (insertAt < 0) insertAt = 0;
    if (insertAt > result.length) insertAt = result.length;
    result.splice(insertAt, 0, {
      subject: o.subject || '自习',
      start_time: o.start_time || '00:00:00',
      end_time: o.end_time || '00:00:00',
      _adjusted: true
    });
  });

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
      weekDateStrs: {},
      nowTime: Date.now(),
      viewMode: 'week',
      // 调课编辑器
      overrideEditor: {
        open: false,
        idx: null,
        form: {
          subject: '',
          start_time: '',
          end_time: ''
        }
      }
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
        var dateStr = this.weekDateStrs[i] || '';
        var holiday = findHoliday(dateStr, this.raw && this.raw.holidays);
        var adjustment = findAdjustment(dateStr, this.raw && this.raw.adjustments);
        result.push({
          value: i,
          label: DAY_LABELS[i],
          dateStr: this.weekDates[i] || '',
          hasSchool: !!hasSchool[i],
          holiday: holiday,
          adjustment: adjustment
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
    },
    // 今日日期字符串 'YYYY-MM-DD'
    todayDateStr: function() {
      return formatDateStr(new Date());
    },
    // 今日是节假日？
    todayHoliday: function() {
      if (!this.raw || !this.raw.holidays) return null;
      return findHoliday(this.todayDateStr, this.raw.holidays);
    },
    // 今日是调休日？
    todayAdjustment: function() {
      if (!this.raw || !this.raw.adjustments) return null;
      return findAdjustment(this.todayDateStr, this.raw.adjustments);
    },
    // 今日实际上课的 day 值（考虑调休）
    todayEffectiveDay: function() {
      var jsDay = new Date().getDay();
      var eff = getEffectiveDay(jsDay, this.todayDateStr, this.raw && this.raw.adjustments, this.weekType);
      return eff.day;
    },
    // 今日原始课表（不考虑调课覆盖）
    todayBaseClasses: function() {
      if (!this.raw) return [];
      if (this.todayHoliday) return [];
      var eff = getEffectiveDay(new Date().getDay(), this.todayDateStr, this.raw.adjustments, this.weekType);
      return getDayClasses(this.raw, eff.day, eff.weekType);
    },
    // 今日调课数据
    todayOverrides: function() {
      return loadOverrides(this.todayDateStr);
    },
    // 是否有调课
    hasOverrides: function() {
      return this.todayOverrides.length > 0;
    },
    // 应用调课后的今日课表
    todayClassesWithOverride: function() {
      return applyOverrides(this.todayBaseClasses, this.todayOverrides);
    },
    // 下节课信息
    nextClassInfo: function() {
      var _ = this.nowTime; // 触发响应
      return findNextClass(this.todayClassesWithOverride, this.nowTime);
    },
    nextClassLabel: function() {
      var status = this.nextClassInfo.status;
      if (status === 'ongoing') return '正在进行';
      if (status === 'upcoming') return '下节课';
      return '今日课程';
    },
    nextClassCountdown: function() {
      var info = this.nextClassInfo;
      if (!info.class) return '';
      if (info.status === 'ongoing') return '进行中';
      if (info.status === 'upcoming') {
        var targetMs = timeStrToTodayMs(info.class.start_time);
        return formatCountdown(targetMs, this.nowTime);
      }
      return '';
    }
  },
  mounted: function() {
    // 不缓存：每次进入页面都重新请求后端
    this.termStart = localStorage.getItem('timetable_term_start') || this.guessTermStart();
    this.weekNumber = calcWeekNumber(this.termStart);
    this.weekType = this.weekNumber % 2 === 1 ? 'odd' : 'even';
    this.weekDates = getWeekDates();
    this.weekDateStrs = getWeekDateStrs();
    this.loadData();
    // 每分钟刷新当前时间，用于高亮"正在上的课"和下节课倒计时
    var self = this;
    this._timer = setInterval(function() { self.nowTime = Date.now(); }, 60000);
    // 页面重新可见时重新加载（不使用轮询，符合项目约定）
    this._visibilityHandler = function() {
      if (!document.hidden) {
        self.weekDates = getWeekDates();
        self.weekDateStrs = getWeekDateStrs();
        self.loadData();
      }
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
      this.weekType = this.weekNumber % 2 === 1 ? 'odd' : 'even';
    },
    guessTermStart: function() {
      var now = new Date();
      var year = now.getFullYear();
      if (now.getMonth() < 8) year = year - 1;
      return year + '-09-01';
    },
    isToday: function(dayValue) {
      var target = jsDayToCompDay(new Date().getDay());
      return target === dayValue;
    },
    isCurrentClass: function(cell, dayValue) {
      if (!cell || !this.isToday(dayValue)) return false;
      var _ = this.nowTime;
      var now = new Date();
      var minutes = now.getHours() * 60 + now.getMinutes();
      var sp = cell.start.split(':');
      var ep = cell.end.split(':');
      var s = parseInt(sp[0], 10) * 60 + parseInt(sp[1], 10);
      var e = parseInt(ep[0], 10) * 60 + parseInt(ep[1], 10);
      return minutes >= s && minutes <= e;
    },
    dayLabel: function(dayValue) {
      return DAY_LABELS[dayValue] || '';
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
    formatTime: function(t) { return formatTime(t); },
    hexToRgba: function(hex, alpha) { return hexToRgba(hex, alpha); },
    getSubjectColor: function(name) { return getSubjectColor(name); },
    // 判断今日课节状态
    isOngoingClass: function(cls) {
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
    isUpcomingClass: function(cls) {
      var _ = this.nowTime;
      if (!cls || !cls.start_time) return false;
      if (this.isOngoingClass(cls)) return false;
      var now = new Date();
      var nowMin = now.getHours() * 60 + now.getMinutes();
      var sp = cls.start_time.split(':');
      var s = parseInt(sp[0], 10) * 60 + parseInt(sp[1], 10);
      return nowMin < s;
    },
    isEndedClass: function(cls) {
      if (!cls || !cls.end_time) return false;
      if (this.isOngoingClass(cls)) return false;
      var now = new Date();
      var nowMin = now.getHours() * 60 + now.getMinutes();
      var ep = cls.end_time.split(':');
      var e = parseInt(ep[0], 10) * 60 + parseInt(ep[1], 10);
      return nowMin > e;
    },
    // ===== 调课编辑器 =====
    openOverrideEditor: function(idx) {
      var cls = this.todayClassesWithOverride[idx];
      if (!cls) return;
      this.overrideEditor.idx = idx;
      this.overrideEditor.form.subject = cls.subject || '';
      this.overrideEditor.form.start_time = formatTime(cls.start_time);
      this.overrideEditor.form.end_time = formatTime(cls.end_time);
      this.overrideEditor.open = true;
    },
    closeOverrideEditor: function() {
      this.overrideEditor.open = false;
      this.overrideEditor.idx = null;
    },
    saveOverride: function() {
      if (this.overrideEditor.idx === null) return;
      var form = this.overrideEditor.form;
      if (!form.subject) {
        alert('请选择科目');
        return;
      }
      // 转换 'HH:MM' -> 'HH:MM:SS'
      var startTime = form.start_time.length === 5 ? form.start_time + ':00' : form.start_time;
      var endTime = form.end_time.length === 5 ? form.end_time + ':00' : form.end_time;
      var overrides = loadOverrides(this.todayDateStr);
      overrides.push({
        idx: this.overrideEditor.idx,
        action: 'replace',
        subject: form.subject,
        start_time: startTime,
        end_time: endTime
      });
      saveOverrides(this.todayDateStr, overrides);
      this.closeOverrideEditor();
    },
    deleteOverride: function() {
      if (this.overrideEditor.idx === null) return;
      var overrides = loadOverrides(this.todayDateStr);
      overrides.push({
        idx: this.overrideEditor.idx,
        action: 'delete'
      });
      saveOverrides(this.todayDateStr, overrides);
      this.closeOverrideEditor();
    },
    insertOverrideAfter: function() {
      if (this.overrideEditor.idx === null) return;
      var form = this.overrideEditor.form;
      if (!form.subject) {
        alert('请选择科目');
        return;
      }
      var startTime = form.start_time.length === 5 ? form.start_time + ':00' : form.start_time;
      var endTime = form.end_time.length === 5 ? form.end_time + ':00' : form.end_time;
      var overrides = loadOverrides(this.todayDateStr);
      overrides.push({
        idx: this.overrideEditor.idx,
        action: 'insert',
        subject: form.subject,
        start_time: startTime,
        end_time: endTime
      });
      saveOverrides(this.todayDateStr, overrides);
      this.closeOverrideEditor();
    },
    resetOverrides: function() {
      if (confirm('确定要清除今日所有调课吗？')) {
        clearOverrides(this.todayDateStr);
      }
    }
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
  color: var(--text-primary);
}

/* 顶部 nav 操作区 */
.nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 视图切换 segmented control */
.view-toggle {
  display: flex;
  background: var(--border-color, rgba(0,0,0,0.08));
  border-radius: 14px;
  padding: 2px;
  height: 28px;
}
.view-toggle-btn {
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-sm, 13px);
  font-weight: 600;
  padding: 0 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  opacity: 0.6;
}
.view-toggle-btn.active {
  background: var(--card-bg, #fff);
  opacity: 1;
  box-shadow: var(--shadow-sm);
}

/* 单双周切换按钮 */
.week-toggle {
  height: 30px;
  padding: 0 14px;
  border-radius: 15px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.1));
  background: var(--card-bg, rgba(255,255,255,0.8));
  color: var(--text-primary);
  font-size: var(--font-size-sm, 13px);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s var(--ease-standard, ease);
}
.week-toggle.odd {
  background: rgba(var(--danger-rgb), 0.15);
  color: var(--danger-color);
  border-color: rgba(var(--danger-rgb), 0.3);
}
.week-toggle.even {
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--primary-color);
  border-color: rgba(var(--primary-rgb), 0.3);
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
  color: var(--danger-color);
  background: rgba(var(--danger-rgb), 0.1);
}
.week-type-label.even {
  color: var(--primary-color);
  background: rgba(var(--primary-rgb), 0.1);
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
  color: var(--text-primary);
  font-size: var(--font-size-sm, 13px);
}
.picker-confirm {
  padding: 5px 12px;
  border: none;
  border-radius: 8px;
  background: var(--primary-color);
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
  color: var(--text-primary);
  font-size: var(--font-size-sm, 13px);
  cursor: pointer;
  transition: all 0.2s;
}
.btn-retry:hover { background: var(--border-color, rgba(0,0,0,0.1)); }
.btn-retry:active { transform: scale(0.95); }

/* ========== 周视图 ========== */
.timetable-scroll {
  flex: 1;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0;
}
.timetable-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
.timetable-scroll::-webkit-scrollbar-thumb { background: var(--separator-color); border-radius: 2px; }
[data-theme="dark"] .timetable-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); }

.timetable-table {
  border-collapse: separate;
  border-spacing: 0;
  width: max-content;
  min-width: 100%;
}

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
  background: rgba(var(--primary-rgb), 0.08);
}
.day-header.today .day-name {
  color: var(--primary-color);
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
/* 节假日/调休角标 */
.day-tag {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 9px;
  font-weight: 700;
  width: 14px;
  height: 14px;
  line-height: 14px;
  border-radius: 50%;
  color: #fff;
}
.tag-holiday {
  background: var(--danger-color);
}
.tag-adjust {
  background: #FF9500;
}

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
  color: var(--text-primary);
  display: inline-block;
}

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
  background: rgba(var(--primary-rgb), 0.03);
}
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

/* ========== 当天视图 ========== */
.today-view {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 横幅 */
.banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 14px;
  font-size: var(--font-size-body, 15px);
  font-weight: 600;
}
.banner i { font-size: 18px; }
.banner-holiday {
  background: rgba(var(--danger-rgb), 0.12);
  color: var(--danger-color);
}
.banner-adjust {
  background: rgba(var(--warning-rgb), 0.12);
  color: #FF9500;
}

/* 下节课卡片 */
.next-class-card {
  background: var(--card-bg, #fff);
  border-radius: 18px;
  padding: 18px 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  transition: all 0.3s;
}
.next-class-card.ongoing {
  box-shadow: 0 0 0 2px var(--success-color), 0 4px 16px rgba(var(--success-rgb), 0.2);
}
.next-class-card.upcoming {
  box-shadow: 0 0 0 2px var(--primary-color), 0 4px 16px rgba(var(--primary-rgb), 0.15);
}
.next-class-card.done {
  opacity: 0.7;
}
.next-class-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.next-class-label {
  font-size: var(--font-size-sm, 13px);
  font-weight: 600;
  color: var(--text-primary);
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.next-class-countdown {
  font-size: var(--font-size-body, 15px);
  font-weight: 700;
  color: var(--primary-color);
}
.next-class-card.ongoing .next-class-countdown {
  color: var(--success-color);
}
.next-class-body {
  display: flex;
  align-items: center;
  gap: 14px;
}
.next-class-subject {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 700;
  flex-shrink: 0;
}
.next-class-time {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ncs-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}
.ncs-time {
  font-size: var(--font-size-sm, 13px);
  opacity: 0.6;
}
.next-class-empty {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--success-color);
  font-size: var(--font-size-body, 15px);
  font-weight: 600;
}
.next-class-empty i { font-size: 22px; }

/* 今日课节列表 */
.today-list {
  background: var(--card-bg, #fff);
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.04);
}
.today-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: var(--font-size-sm, 13px);
  font-weight: 600;
  opacity: 0.7;
}
.reset-overrides-btn {
  border: none;
  background: rgba(var(--warning-rgb), 0.12);
  color: #FF9500;
  font-size: var(--font-size-sm, 13px);
  padding: 4px 10px;
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}
.reset-overrides-btn:active { transform: scale(0.95); }
.today-list-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.today-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--bg-color, rgba(0,0,0,0.02));
  transition: all 0.2s;
  position: relative;
}
.today-item.ongoing {
  background: rgba(var(--success-rgb), 0.1);
  box-shadow: 0 0 0 2px var(--success-color);
}
.today-item.upcoming {
  background: rgba(var(--primary-rgb), 0.06);
}
.today-item.ended {
  opacity: 0.45;
}
.today-item.adjusted::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 60%;
  background: #FF9500;
  border-radius: 2px;
}
.today-item-time {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  min-width: 42px;
  opacity: 0.7;
}
.ti-time-start { color: var(--text-primary); }
.ti-time-end { opacity: 0.5; }
.today-item-subject {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  font-weight: 600;
  position: relative;
}
.ti-simplified {
  font-size: 18px;
  font-weight: 700;
}
.ti-adjusted-tag {
  font-size: 9px;
  font-weight: 700;
  background: #FF9500;
  color: #fff;
  padding: 1px 5px;
  border-radius: 4px;
}
.today-item-edit {
  border: none;
  background: transparent;
  color: var(--text-primary);
  opacity: 0.4;
  font-size: 14px;
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  transition: all 0.2s;
}
.today-item-edit:hover {
  background: var(--border-color, rgba(0,0,0,0.06));
  opacity: 1;
}
.today-empty {
  text-align: center;
  padding: 30px 0;
  opacity: 0.5;
}
.today-empty i { font-size: 32px; margin-bottom: 8px; }
.today-empty p { font-size: var(--font-size-sm, 13px); }

/* ========== 调课编辑弹窗 ========== */
.override-editor-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
}
.override-editor {
  background: var(--card-bg, #fff);
  border-radius: 16px;
  width: 100%;
  max-width: 360px;
  overflow: hidden;
  box-shadow: var(--shadow-xl);
}
.oe-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.08));
}
.oe-title {
  font-size: var(--font-size-body, 15px);
  font-weight: 700;
}
.oe-close {
  border: none;
  background: transparent;
  font-size: 18px;
  color: var(--text-primary);
  opacity: 0.5;
  cursor: pointer;
  padding: 4px;
}
.oe-close:hover { opacity: 1; }
.oe-body {
  padding: 16px 18px;
}
.oe-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
  flex: 1;
}
.oe-field-row {
  display: flex;
  gap: 12px;
}
.oe-field label {
  font-size: var(--font-size-sm, 13px);
  opacity: 0.6;
  font-weight: 600;
}
.oe-field select,
.oe-field input {
  padding: 8px 12px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.12));
  border-radius: 10px;
  background: var(--bg-color, #f2f2f7);
  color: var(--text-primary);
  font-size: var(--font-size-body, 15px);
  outline: none;
  transition: border-color 0.2s;
}
.oe-field select:focus,
.oe-field input:focus {
  border-color: var(--primary-color);
}
.oe-actions {
  display: flex;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border-color, rgba(0,0,0,0.08));
  flex-wrap: wrap;
}
.oe-btn {
  flex: 1;
  min-width: 80px;
  padding: 10px 12px;
  border: none;
  border-radius: 10px;
  font-size: var(--font-size-sm, 13px);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.oe-btn:active { transform: scale(0.96); }
.oe-btn-save {
  background: var(--primary-color);
  color: #fff;
}
.oe-btn-cancel {
  background: var(--border-color, rgba(0,0,0,0.08));
  color: var(--text-primary);
}
.oe-btn-delete {
  background: rgba(var(--danger-rgb), 0.12);
  color: var(--danger-color);
}
.oe-btn-insert {
  background: rgba(var(--success-rgb), 0.12);
  color: var(--success-color);
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
  .next-class-subject { width: 48px; height: 48px; font-size: 20px; }
  .ncs-name { font-size: 18px; }
  .today-view { padding: 12px; gap: 10px; }
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
