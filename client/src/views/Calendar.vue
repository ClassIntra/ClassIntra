<template>
  <div class="calendar-page">
    <AppNavBar title="日历">
      <template slot="actions">
        <div class="nav-actions">
          <button class="nav-btn" @click="prevMonth" title="上一月"><i class="fa-solid fa-chevron-left"></i></button>
          <span class="month-label">{{ year }}年{{ month }}月</span>
          <button class="nav-btn" @click="nextMonth" title="下一月"><i class="fa-solid fa-chevron-right"></i></button>
          <button class="today-btn" @click="goToday">今天</button>
          <button class="add-btn" @click="openEditor(null)" title="新建事件"><i class="fa-solid fa-plus"></i></button>
        </div>
      </template>
    </AppNavBar>

    <div class="calendar-body">
      <!-- 月视图网格 -->
      <div class="calendar-grid">
        <div class="weekday-row">
          <div v-for="(wd, i) in weekdays" :key="i" class="weekday-cell" :class="{ weekend: i === 0 || i === 6 }">{{ wd }}</div>
        </div>
        <div class="day-grid">
          <div
            v-for="(cell, idx) in calendarCells"
            :key="idx"
            class="day-cell"
            :class="{
              today: cell.isToday,
              'other-month': !cell.inMonth,
              selected: cell.dateStr === selectedDate,
              hasEvents: cell.events.length > 0
            }"
            @click="selectDate(cell)"
          >
            <div class="day-num-wrap">
              <span class="day-num">{{ cell.day }}</span>
            </div>
            <div class="day-lunar" v-if="cell.lunar">{{ cell.lunarLabel }}</div>
            <div class="day-festival" v-if="cell.festival">{{ cell.festival }}</div>
            <div class="day-solar-term" v-else-if="cell.solarTerm">{{ cell.solarTerm }}</div>
            <div class="day-events" v-if="cell.events.length || cell.birthdays.length">
              <span v-for="(ev, ei) in cell.events.slice(0, 3)" :key="ei" class="event-dot" :style="{ background: getCategoryColor(ev.category) }"></span>
              <span v-if="cell.events.length > 3" class="event-more">+{{ cell.events.length - 3 }}</span>
              <span v-if="cell.birthdays.length" class="birthday-icon" title="生日">🎂</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 当日详情 -->
      <div class="day-detail" v-if="selectedDate">
        <div class="day-detail-header">
          <div class="ddh-info">
            <span class="ddh-date">{{ selectedDateLabel }}</span>
            <span class="ddh-lunar" v-if="selectedDateLunar">{{ selectedDateLunar }}</span>
          </div>
          <button class="ddh-add" @click="openEditor({ event_date: selectedDate })" title="新建事件">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
        <div class="day-detail-body scrollbar-thin">
          <!-- 事件列表 -->
          <div
            v-for="(ev, idx) in selectedDateEvents"
            :key="idx"
            class="event-item"
            :style="{ borderLeftColor: getCategoryColor(ev.category) }"
          >
            <div class="event-main">
              <div class="event-time" v-if="ev.start_time">
                <i class="fa-regular fa-clock"></i>
                {{ ev.start_time }}{{ ev.end_time ? ' - ' + ev.end_time : '' }}
              </div>
              <div class="event-title">{{ ev.title }}</div>
              <div class="event-desc" v-if="ev.description">{{ ev.description }}</div>
              <div class="event-reminder" v-if="ev.reminder_minutes">
                <i class="fa-solid fa-bell"></i> 提前 {{ ev.reminder_minutes }} 分钟提醒
              </div>
            </div>
            <div class="event-actions">
              <button class="ea-btn" @click="openEditor(ev)" title="编辑"><i class="fa-solid fa-pen"></i></button>
              <button class="ea-btn ea-delete" @click="deleteEvent(ev)" title="删除"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
          <!-- 生日列表 -->
          <div v-for="(bd, bi) in selectedDateBirthdays" :key="'bd' + bi" class="birthday-item">
            <span class="bi-icon">🎂</span>
            <span class="bi-name">{{ bd.net_name || bd.real_name }}</span>
            <span class="bi-label">生日</span>
          </div>
          <!-- 空状态 -->
          <div v-if="!selectedDateEvents.length && !selectedDateBirthdays.length" class="empty-day">
            <i class="fa-regular fa-calendar-plus"></i>
            <span>今日无事件，点击 + 添加</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 事件编辑弹窗 -->
    <div v-if="editor.open" class="editor-mask" @click.self="closeEditor">
      <div class="editor">
        <div class="editor-header">
          <span class="editor-title">{{ editor.id ? '编辑事件' : '新建事件' }}</span>
          <button class="editor-close" @click="closeEditor"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="editor-body scrollbar-thin">
          <div class="form-row">
            <label>标题</label>
            <input v-model="editor.form.title" class="form-input" placeholder="事件标题" />
          </div>
          <div class="form-row">
            <label>日期</label>
            <input type="date" v-model="editor.form.event_date" class="form-input" />
          </div>
          <div class="form-row-inline">
            <div class="form-row half">
              <label>开始时间</label>
              <input type="time" v-model="editor.form.start_time" class="form-input" />
            </div>
            <div class="form-row half">
              <label>结束时间</label>
              <input type="time" v-model="editor.form.end_time" class="form-input" />
            </div>
          </div>
          <div class="form-row">
            <label>分类</label>
            <div class="category-picker">
              <button
                v-for="cat in categories"
                :key="cat.value"
                class="category-btn"
                :class="{ active: editor.form.category === cat.value }"
                :style="{ '--cat-color': cat.color }"
                @click="editor.form.category = cat.value"
              >
                <span class="cat-dot"></span>{{ cat.label }}
              </button>
            </div>
          </div>
          <div class="form-row">
            <label>提醒</label>
            <select v-model="editor.form.reminder_minutes" class="form-input">
              <option :value="0">不提醒</option>
              <option :value="5">提前 5 分钟</option>
              <option :value="15">提前 15 分钟</option>
              <option :value="30">提前 30 分钟</option>
              <option :value="60">提前 1 小时</option>
              <option :value="1440">提前 1 天</option>
            </select>
          </div>
          <div class="form-row">
            <label>描述</label>
            <textarea v-model="editor.form.description" class="form-input" placeholder="事件描述（可选）" rows="3"></textarea>
          </div>
          <div class="form-row">
            <label class="checkbox-label">
              <input type="checkbox" v-model="editor.form.show_in_countdown" />
              <span>同步显示到倒数日</span>
            </label>
          </div>
        </div>
        <div class="editor-actions">
          <button class="ea-save" @click="saveEvent">保存</button>
          <button class="ea-cancel" @click="closeEditor">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import AppNavBar from '@/components/AppNavBar.vue';
import api from '@/utils/api';
import { getDateInfo } from '@/utils/lunar-helper.js';

var WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

var CATEGORIES = [
  { value: 'general', label: '一般', color: 'var(--text-tertiary)' },
  { value: 'work', label: '工作', color: 'var(--primary-color)' },
  { value: 'study', label: '学习', color: '#AF52DE' },
  { value: 'anniversary', label: '纪念', color: 'var(--danger-color)' },
  { value: 'festival', label: '节日', color: 'var(--warning-color)' },
  { value: 'birthday', label: '生日', color: 'var(--success-color)' }
];

function getCategoryColor(category) {
  for (var i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].value === category) return CATEGORIES[i].color;
  }
  return CATEGORIES[0].color;
}

// 格式化日期为 YYYY-MM-DD
function formatDate(d) {
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

export default {
  name: 'Calendar',
  components: { AppNavBar: AppNavBar },
  data: function() {
    var now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      weekdays: WEEKDAYS,
      events: [],
      birthdays: [],
      linkedCountdowns: [],  // 来自倒数日的虚拟事件（show_in_calendar=1）
      selectedDate: formatDate(now),
      lunarCache: {},
      editor: {
        open: false,
        id: null,
        form: {
          title: '',
          event_date: '',
          start_time: '',
          end_time: '',
          category: 'general',
          reminder_minutes: 0,
          description: '',
          show_in_countdown: false
        }
      }
    };
  },
  computed: {
    // 当前月份的日历单元格（含上下月填充）
    calendarCells: function() {
      var self = this;
      var firstDay = new Date(self.year, self.month - 1, 1);
      var firstWeekday = firstDay.getDay();
      var daysInMonth = new Date(self.year, self.month, 0).getDate();
      var prevMonthDays = new Date(self.year, self.month - 1, 0).getDate();
      var todayStr = formatDate(new Date());
      var cells = [];
      // 前置填充（上月末尾）
      for (var i = firstWeekday - 1; i >= 0; i--) {
        var d = prevMonthDays - i;
        var prevDate = new Date(self.year, self.month - 2, d);
        cells.push(self.buildCell(prevDate, false, todayStr));
      }
      // 当月
      for (var j = 1; j <= daysInMonth; j++) {
        var curDate = new Date(self.year, self.month - 1, j);
        cells.push(self.buildCell(curDate, true, todayStr));
      }
      // 后置填充（下月开头，补齐 42 格 = 6 行）
      var remaining = 42 - cells.length;
      for (var k = 1; k <= remaining; k++) {
        var nextDate = new Date(self.year, self.month, k);
        cells.push(self.buildCell(nextDate, false, todayStr));
      }
      return cells;
    },
    selectedDateEvents: function() {
      var self = this;
      var native = self.events.filter(function(ev) {
        return ev.event_date === self.selectedDate;
      });
      var linked = self.linkedCountdowns.filter(function(ev) {
        return ev.event_date === self.selectedDate;
      });
      return native.concat(linked).sort(function(a, b) {
        return (a.start_time || '').localeCompare(b.start_time || '');
      });
    },
    selectedDateBirthdays: function() {
      var self = this;
      return self.birthdays.filter(function(bd) {
        if (!bd.birthday) return false;
        var parts = bd.birthday.split('-');
        return parts[1] + '-' + parts[2] === self.selectedDate.substring(5);
      });
    },
    selectedDateLabel: function() {
      var self = this;
      if (!self.selectedDate) return '';
      var parts = self.selectedDate.split('-');
      var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      return parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日 周' + WEEKDAYS[d.getDay()];
    },
    selectedDateLunar: function() {
      var self = this;
      var info = self.getLunarInfo(self.selectedDate);
      if (!info) return '';
      var parts = [];
      if (info.solarFestivals && info.solarFestivals.length) parts.push(info.solarFestivals[0]);
      if (info.lunarFestivals && info.lunarFestivals.length) parts.push(info.lunarFestivals[0]);
      if (info.solarTerm) parts.push(info.solarTerm);
      if (info.lunar) parts.push(info.lunar.lunarMonthName + '月' + info.lunar.lunarDayName);
      return parts.join(' · ');
    }
  },
  mounted: function() {
    var self = this;
    self.loadData();
    self.loadBirthdays();
    self.loadLinkedCountdowns();
  },
  methods: {
    // 轻量提示 toast
    toast: function(message, type) {
      this.$store.commit('toast/SHOW_TOAST', { message: message, type: type || 'info' });
    },
    getCategoryColor: getCategoryColor,
    buildCell: function(date, inMonth, todayStr) {
      var self = this;
      var dateStr = formatDate(date);
      var info = self.getLunarInfo(dateStr);
      // 农历标签：初一显示月名，其他显示日名
      var lunarLabel = '';
      if (info && info.lunar) {
        if (info.lunar.lunarDay === 1) {
          lunarLabel = info.lunar.lunarMonthName + '月';
        } else {
          lunarLabel = info.lunar.lunarDayName;
        }
      }
      // 节日优先级：公历节日 > 农历节日 > 节气
      var festival = '';
      if (info) {
        if (info.solarFestivals && info.solarFestivals.length) {
          festival = info.solarFestivals[0];
        } else if (info.lunarFestivals && info.lunarFestivals.length) {
          festival = info.lunarFestivals[0];
        }
      }
      var solarTerm = info ? info.solarTerm : '';
      // 当日事件
      var dayEvents = self.events.filter(function(ev) { return ev.event_date === dateStr; });
      // 合并联动倒数日（show_in_calendar=1 的倒数日虚拟事件）
      var linkedEvents = self.linkedCountdowns.filter(function(ev) { return ev.event_date === dateStr; });
      var mergedEvents = dayEvents.concat(linkedEvents);
      // 当日生日（按月-日匹配）
      var dayBirthdays = self.birthdays.filter(function(bd) {
        if (!bd.birthday) return false;
        var p = bd.birthday.split('-');
        return p[1] + '-' + p[2] === dateStr.substring(5);
      });
      return {
        day: date.getDate(),
        dateStr: dateStr,
        inMonth: inMonth,
        isToday: dateStr === todayStr,
        lunar: info ? info.lunar : null,
        lunarLabel: lunarLabel,
        festival: festival,
        solarTerm: solarTerm,
        events: mergedEvents,
        birthdays: dayBirthdays
      };
    },
    getLunarInfo: function(dateStr) {
      var self = this;
      if (self.lunarCache[dateStr]) return self.lunarCache[dateStr];
      var parts = dateStr.split('-');
      var date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      var info = getDateInfo(date);
      self.lunarCache[dateStr] = info;
      return info;
    },
    loadData: function() {
      var self = this;
      var monthStr = self.year + '-' + (self.month < 10 ? '0' + self.month : self.month);
      api.get('/calendar/events', { params: { month: monthStr } }).then(function(res) {
        if (res.data && res.data.code === 200) {
          self.events = res.data.data || [];
        }
      }).catch(function() {});
      self.loadLinkedCountdowns();
    },
    loadBirthdays: function() {
      var self = this;
      var monthStr = self.year + '-' + (self.month < 10 ? '0' + self.month : self.month);
      api.get('/calendar/birthdays', { params: { month: monthStr } }).then(function(res) {
        if (res.data && res.data.code === 200) {
          self.birthdays = res.data.data || [];
        }
      }).catch(function() {});
    },
    // 加载联动倒数日（show_in_calendar=1 的倒数日虚拟事件，按月过滤）
    loadLinkedCountdowns: function() {
      var self = this;
      var monthStr = self.year + '-' + (self.month < 10 ? '0' + self.month : self.month);
      api.get('/countdown/events/for-calendar', { params: { month: monthStr } }).then(function(res) {
        if (res.data && res.data.code === 200) {
          self.linkedCountdowns = res.data.data || [];
        }
      }).catch(function() {});
    },
    prevMonth: function() {
      var self = this;
      if (self.month === 1) {
        self.year--;
        self.month = 12;
      } else {
        self.month--;
      }
      self.loadData();
      self.loadBirthdays();
      self.loadLinkedCountdowns();
    },
    nextMonth: function() {
      var self = this;
      if (self.month === 12) {
        self.year++;
        self.month = 1;
      } else {
        self.month++;
      }
      self.loadData();
      self.loadBirthdays();
      self.loadLinkedCountdowns();
    },
    goToday: function() {
      var self = this;
      var now = new Date();
      self.year = now.getFullYear();
      self.month = now.getMonth() + 1;
      self.selectedDate = formatDate(now);
      self.loadData();
      self.loadBirthdays();
      self.loadLinkedCountdowns();
    },
    selectDate: function(cell) {
      this.selectedDate = cell.dateStr;
    },
    openEditor: function(event) {
      var self = this;
      if (event && event.id) {
        // 编辑现有事件
        self.editor.id = event.id;
        self.editor.form = {
          title: event.title,
          event_date: event.event_date,
          start_time: event.start_time || '',
          end_time: event.end_time || '',
          category: event.category || 'general',
          reminder_minutes: event.reminder_minutes || 0,
          description: event.description || '',
          show_in_countdown: !!event.show_in_countdown
        };
      } else if (event && event.event_date) {
        // 指定日期新建
        self.editor.id = null;
        self.editor.form = {
          title: '',
          event_date: event.event_date,
          start_time: '',
          end_time: '',
          category: 'general',
          reminder_minutes: 0,
          description: '',
          show_in_countdown: false
        };
      } else {
        // 全新新建
        self.editor.id = null;
        self.editor.form = {
          title: '',
          event_date: self.selectedDate,
          start_time: '',
          end_time: '',
          category: 'general',
          reminder_minutes: 0,
          description: '',
          show_in_countdown: false
        };
      }
      self.editor.open = true;
    },
    closeEditor: function() {
      this.editor.open = false;
    },
    saveEvent: function() {
      var self = this;
      var form = self.editor.form;
      if (!form.title.trim()) {
        self.toast('请输入标题');
        return;
      }
      if (!form.event_date) {
        self.toast('请选择日期');
        return;
      }
      var payload = {
        title: form.title.trim(),
        event_date: form.event_date,
        start_time: form.start_time,
        end_time: form.end_time,
        category: form.category,
        reminder_minutes: parseInt(form.reminder_minutes, 10) || 0,
        description: form.description,
        show_in_countdown: form.show_in_countdown ? 1 : 0
      };
      if (self.editor.id) {
        api.put('/calendar/events/' + self.editor.id, payload).then(function(res) {
          if (res.data && res.data.code === 200) {
            self.closeEditor();
            self.loadData();
          } else {
            self.toast((res.data && res.data.message) || '保存失败', 'error');
          }
        }).catch(function() { self.toast('保存失败', 'error'); });
      } else {
        api.post('/calendar/events', payload).then(function(res) {
          if (res.data && res.data.code === 200) {
            self.closeEditor();
            self.loadData();
          } else {
            self.toast((res.data && res.data.message) || '创建失败', 'error');
          }
        }).catch(function() { self.toast('创建失败', 'error'); });
      }
    },
    deleteEvent: function(ev) {
      var self = this;
      self.$modal.confirm({
        title: '删除事件',
        message: '确定删除「' + ev.title + '」？此操作不可恢复。',
        confirmText: '删除',
        cancelText: '取消'
      }).then(function(result) {
        if (!result) return;
        api.delete('/calendar/events/' + ev.id).then(function(res) {
          if (res.data && res.data.code === 200) {
            self.loadData();
            self.toast('已删除', 'success');
          } else {
            self.toast((res.data && res.data.message) || '删除失败', 'error');
          }
        }).catch(function() { self.toast('删除失败', 'error'); });
      }).catch(function() {});
    }
  }
};
</script>

<style scoped>
.calendar-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.nav-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: var(--surface-elevated);
  color: var(--text-primary);
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.nav-btn:hover {
  background: var(--primary-lighter);
}
.month-label {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  min-width: 100px;
  text-align: center;
}
.today-btn {
  padding: 6px 14px;
  border: none;
  background: var(--primary-color);
  color: #fff;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s;
}
.today-btn:hover {
  opacity: 0.85;
}
.add-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: var(--surface-elevated);
  color: var(--primary-color);
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.add-btn:hover {
  background: var(--primary-lighter);
}

.calendar-body {
  flex: 1;
  display: flex;
  gap: 16px;
  padding: 16px;
  overflow: hidden;
}

/* 月视图网格 */
.calendar-grid {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--card-bg);
  border-radius: 18px;
  padding: 12px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.weekday-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 8px;
}
.weekday-cell {
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 8px 0;
}
.weekday-cell.weekend {
  color: var(--danger-color);
}
.day-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-auto-rows: 1fr;
  gap: 4px;
}
.day-cell {
  border-radius: 10px;
  padding: 6px 8px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  position: relative;
  border: 1px solid transparent;
}
.day-cell:hover {
  background: var(--primary-lighter);
}
.day-cell.other-month {
  opacity: 0.35;
}
.day-cell.today .day-num-wrap {
  background: var(--primary-color);
  color: #fff;
}
.day-cell.selected {
  border-color: var(--primary-color);
  background: var(--primary-lighter);
}
.day-num-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}
.day-lunar {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.2;
}
.day-festival {
  font-size: 11px;
  color: var(--danger-color);
  font-weight: 600;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.day-solar-term {
  font-size: 11px;
  color: var(--success-color);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.day-events {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
  margin-top: auto;
}
.event-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.event-more {
  font-size: 10px;
  color: var(--text-tertiary);
}
.birthday-icon {
  font-size: 12px;
  line-height: 1;
}

/* 当日详情 */
.day-detail {
  width: 280px;
  display: flex;
  flex-direction: column;
  background: var(--card-bg);
  border-radius: 18px;
  padding: 16px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.day-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--separator-color);
}
.ddh-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ddh-date {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}
.ddh-lunar {
  font-size: 12px;
  color: var(--text-tertiary);
}
.ddh-add {
  width: 32px;
  height: 32px;
  border: none;
  background: var(--primary-color);
  color: #fff;
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.ddh-add:hover {
  opacity: 0.85;
}
.day-detail-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.event-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  background: var(--surface-elevated);
  border-radius: 12px;
  border-left: 3px solid var(--text-tertiary);
}
.event-main {
  flex: 1;
  min-width: 0;
}
.event-time {
  font-size: 12px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}
.event-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.event-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.event-reminder {
  font-size: 11px;
  color: var(--warning-color);
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.event-actions {
  display: flex;
  gap: 6px;
}
.ea-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.ea-btn:hover {
  background: var(--primary-lighter);
  color: var(--primary-color);
}
.ea-delete:hover {
  background: rgba(var(--danger-rgb), 0.1);
  color: var(--danger-color);
}
.birthday-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(var(--success-rgb), 0.08);
  border-radius: 12px;
  border-left: 3px solid var(--success-color);
}
.bi-icon {
  font-size: 20px;
}
.bi-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.bi-label {
  font-size: 12px;
  color: var(--success-color);
}
.empty-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  gap: 8px;
  color: var(--text-tertiary);
}
.empty-day i {
  font-size: 32px;
  opacity: 0.5;
}
.empty-day span {
  font-size: 13px;
}

/* 编辑弹窗 */
.editor-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}
.editor {
  width: 90%;
  max-width: 460px;
  max-height: 85vh;
  background: var(--card-bg);
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 20px;
  border-bottom: 1px solid var(--separator-color);
}
.editor-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
}
.editor-close {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 18px;
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.editor-close:hover {
  background: var(--surface-elevated);
}
.editor-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-row label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.checkbox-label {
  display: flex !important;
  flex-direction: row !important;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  margin-bottom: 0 !important;
  color: var(--text-primary) !important;
  font-size: 14px !important;
  font-weight: 400 !important;
}
.checkbox-label input { width: 18px; height: 18px; cursor: pointer; }
.form-row-inline {
  display: flex;
  gap: 12px;
}
.form-row.half {
  flex: 1;
}
.form-input {
  padding: 10px 12px;
  border: 1px solid var(--separator-color);
  border-radius: 10px;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}
.form-input:focus {
  border-color: var(--primary-color);
}
textarea.form-input {
  resize: vertical;
  font-family: inherit;
}
.category-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.category-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--separator-color);
  border-radius: 10px;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}
.category-btn.active {
  border-color: var(--cat-color);
  background: rgba(var(--primary-rgb), 0.05);
  color: var(--text-primary);
}
.cat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cat-color);
}
.editor-actions {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--separator-color);
}
.ea-save {
  flex: 1;
  padding: 12px;
  border: none;
  background: var(--primary-color);
  color: #fff;
  border-radius: 12px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  transition: all 0.2s;
}
.ea-save:hover {
  opacity: 0.85;
}
.ea-cancel {
  flex: 1;
  padding: 12px;
  border: 1px solid var(--separator-color);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 12px;
  cursor: pointer;
  font-size: 15px;
  transition: all 0.2s;
}
.ea-cancel:hover {
  background: var(--surface-elevated);
}

/* 响应式 */
@media (max-width: 768px) {
  .calendar-body {
    flex-direction: column;
    padding: 10px;
  }
  .day-detail {
    width: 100%;
    max-height: 240px;
  }
  .day-grid {
    grid-auto-rows: minmax(50px, 1fr);
  }
  .day-lunar, .day-festival, .day-solar-term {
    font-size: 10px;
  }
  .month-label {
    font-size: 14px;
    min-width: 80px;
  }
}
</style>
