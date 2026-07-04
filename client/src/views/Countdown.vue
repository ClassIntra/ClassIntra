<template>
  <div class="countdown-page">
    <AppNavBar title="倒数日">
      <template slot="actions">
        <div class="nav-actions">
          <button class="nav-btn today-nav-btn" @click="goToToday" title="跳到今天">
            <i class="fa-solid fa-calendar-day"></i>
          </button>
          <button class="nav-btn add-nav-btn" @click="openEditor(null)" title="新建倒数日">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
      </template>
    </AppNavBar>

    <div class="countdown-body scrollbar-thin">
      <!-- 加载中 -->
      <div v-if="loading && !events.length" class="state-block">
        <div class="state-spinner"></div>
        <p class="state-text">加载中...</p>
      </div>

      <!-- 错误 -->
      <div v-else-if="error" class="state-block">
        <i class="fa-solid fa-circle-exclamation state-icon"></i>
        <p class="state-text">{{ error }}</p>
        <button class="state-retry" @click="loadData">重试</button>
      </div>

      <!-- 空状态 -->
      <div v-else-if="!events.length" class="state-block">
        <i class="fa-solid fa-hourglass-half state-icon empty-icon"></i>
        <p class="state-text">还没有倒数日</p>
        <p class="state-sub">点击右上角 + 添加第一个倒数日</p>
        <button class="state-retry" @click="openEditor(null)">添加倒数日</button>
      </div>

      <template v-else>
        <!-- ========== 置顶卡片轮播 ========== -->
        <div v-if="pinnedEvents.length" class="pinned-section">
          <div class="section-label">
            <i class="fa-solid fa-thumbtack"></i>
            <span>置顶</span>
          </div>
          <div class="pinned-scroll scrollbar-thin">
            <div
              v-for="ev in pinnedEvents"
              :key="ev.id"
              class="pinned-card"
              :style="{ '--card-color': getEventColor(ev) }"
              @click="openEditor(ev)"
            >
              <div class="pc-header">
                <span class="pc-icon">{{ getEventIcon(ev) }}</span>
                <div class="pc-header-right">
                  <span v-if="isRepeat(ev)" class="pc-repeat" title="重复事件">
                    <i class="fa-solid fa-arrows-rotate"></i>
                  </span>
                  <button class="pc-unpin-btn" @click.stop="togglePin(ev)" title="取消置顶">
                    <i class="fa-solid fa-thumbtack"></i>
                  </button>
                </div>
              </div>
              <div class="pc-title">{{ ev.title }}</div>
              <div class="pc-countdown" :class="getCountdown(ev).status">
                <template v-if="getCountdown(ev).status === 'today'">
                  <span class="pc-days-num">今天</span>
                </template>
                <template v-else>
                  <span class="pc-days-num">{{ getCountdown(ev).days }}</span>
                  <span class="pc-days-unit">{{ getCountdown(ev).status === 'future' ? '天后' : '天前' }}</span>
                </template>
              </div>
              <div class="pc-date">{{ formatDateLabel(getEffectiveDate(ev)) }}</div>
              <div class="pc-note" v-if="ev.note">{{ ev.note }}</div>
            </div>
          </div>
        </div>

        <!-- ========== 分类筛选 ========== -->
        <div class="filter-bar scrollbar-thin">
          <button
            class="filter-chip"
            :class="{ active: activeCategory === 'all' }"
            @click="activeCategory = 'all'"
          >全部</button>
          <button
            v-for="cat in categoryList"
            :key="cat.value"
            class="filter-chip"
            :class="{ active: activeCategory === cat.value }"
            :style="{ '--chip-color': cat.color }"
            @click="activeCategory = cat.value"
          >
            <span class="chip-icon">{{ cat.icon }}</span>
            <span>{{ cat.label }}</span>
          </button>
        </div>

        <!-- ========== 事件列表 ========== -->
        <div class="list-section">
          <!-- 今天 -->
          <div v-if="todayEvents.length" class="group-block" ref="todayGroup">
            <div class="group-header today-header">
              <i class="fa-solid fa-star"></i>
              <span>今天</span>
              <span class="group-count">{{ todayEvents.length }}</span>
            </div>
            <div class="event-list">
              <div
                v-for="ev in todayEvents"
                :key="ev.id"
                class="event-row"
                :style="{ '--row-color': getEventColor(ev) }"
              >
                <div class="er-icon" :style="{ background: getEventColor(ev) }">{{ getEventIcon(ev) }}</div>
                <div class="er-main" @click="openEditor(ev)">
                  <div class="er-title">
                    {{ ev.title }}
                    <span v-if="isRepeat(ev)" class="er-repeat" title="重复事件"><i class="fa-solid fa-arrows-rotate"></i></span>
                  </div>
                  <div class="er-date">{{ formatDateLabel(getEffectiveDate(ev)) }}{{ ev.note ? ' · ' + ev.note : '' }}</div>
                </div>
                <div class="er-days today">今天</div>
                <div class="er-actions">
                  <button class="er-btn" @click="togglePin(ev)" :title="ev.pinned ? '取消置顶' : '置顶'">
                    <i :class="ev.pinned ? 'fa-solid fa-thumbtack' : 'fa-regular fa-star'"></i>
                  </button>
                  <button class="er-btn danger" @click="deleteEvent(ev)" title="删除">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 未来 -->
          <div v-if="futureEvents.length" class="group-block">
            <div class="group-header">
              <i class="fa-solid fa-clock"></i>
              <span>即将到来</span>
              <span class="group-count">{{ futureEvents.length }}</span>
            </div>
            <div class="event-list">
              <div
                v-for="ev in futureEvents"
                :key="ev.id"
                class="event-row"
                :style="{ '--row-color': getEventColor(ev) }"
              >
                <div class="er-icon" :style="{ background: getEventColor(ev) }">{{ getEventIcon(ev) }}</div>
                <div class="er-main" @click="openEditor(ev)">
                  <div class="er-title">
                    {{ ev.title }}
                    <span v-if="isRepeat(ev)" class="er-repeat" title="重复事件"><i class="fa-solid fa-arrows-rotate"></i></span>
                  </div>
                  <div class="er-date">{{ formatDateLabel(getEffectiveDate(ev)) }}{{ ev.note ? ' · ' + ev.note : '' }}</div>
                </div>
                <div class="er-days future">{{ getCountdown(ev).days }}<span class="er-unit">天</span></div>
                <div class="er-actions">
                  <button class="er-btn" @click="togglePin(ev)" :title="ev.pinned ? '取消置顶' : '置顶'">
                    <i :class="ev.pinned ? 'fa-solid fa-thumbtack' : 'fa-regular fa-star'"></i>
                  </button>
                  <button class="er-btn danger" @click="deleteEvent(ev)" title="删除">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 已过 -->
          <div v-if="pastEvents.length" class="group-block">
            <div class="group-header past-header">
              <i class="fa-solid fa-history"></i>
              <span>已过</span>
              <span class="group-count">{{ pastEvents.length }}</span>
            </div>
            <div class="event-list">
              <div
                v-for="ev in pastEvents"
                :key="ev.id"
                class="event-row past"
                :style="{ '--row-color': getEventColor(ev) }"
              >
                <div class="er-icon" :style="{ background: getEventColor(ev) }">{{ getEventIcon(ev) }}</div>
                <div class="er-main" @click="openEditor(ev)">
                  <div class="er-title">
                    {{ ev.title }}
                    <span v-if="isRepeat(ev)" class="er-repeat" title="重复事件"><i class="fa-solid fa-arrows-rotate"></i></span>
                  </div>
                  <div class="er-date">{{ formatDateLabel(getEffectiveDate(ev)) }}{{ ev.note ? ' · ' + ev.note : '' }}</div>
                </div>
                <div class="er-days past">{{ getCountdown(ev).days }}<span class="er-unit">天前</span></div>
                <div class="er-actions">
                  <button class="er-btn" @click="togglePin(ev)" :title="ev.pinned ? '取消置顶' : '置顶'">
                    <i :class="ev.pinned ? 'fa-solid fa-thumbtack' : 'fa-regular fa-star'"></i>
                  </button>
                  <button class="er-btn danger" @click="deleteEvent(ev)" title="删除">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 筛选无结果 -->
          <div v-if="!todayEvents.length && !futureEvents.length && !pastEvents.length" class="empty-filter">
            <i class="fa-solid fa-filter-circle-xmark"></i>
            <p>该分类下暂无倒数日</p>
          </div>
        </div>
      </template>
    </div>

    <!-- ========== 编辑弹窗 ========== -->
    <div v-if="editor.open" class="editor-mask" @click.self="closeEditor">
      <div class="editor">
        <div class="editor-header">
          <span class="editor-title">{{ editor.id ? '编辑倒数日' : '新建倒数日' }}</span>
          <button class="editor-close" @click="closeEditor"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="editor-body scrollbar-thin">
          <div class="form-row">
            <label>标题</label>
            <input v-model="editor.form.title" class="form-input" placeholder="如：期末考试" maxlength="50" />
          </div>
          <div class="form-row">
            <label>目标日期</label>
            <input type="date" v-model="editor.form.target_date" class="form-input" />
          </div>
          <div class="form-row">
            <label>分类</label>
            <div class="category-picker">
              <button
                v-for="cat in categoryList"
                :key="cat.value"
                class="category-btn"
                :class="{ active: editor.form.category === cat.value }"
                :style="{ '--cat-color': cat.color }"
                @click="editor.form.category = cat.value"
              >
                <span class="cat-icon">{{ cat.icon }}</span>{{ cat.label }}
              </button>
            </div>
          </div>
          <div class="form-row">
            <label>图标（emoji，留空用分类默认）</label>
            <input v-model="editor.form.icon" class="form-input" placeholder="如：🎉" maxlength="4" />
          </div>
          <div class="form-row">
            <label>颜色（留空用分类默认）</label>
            <div class="color-picker">
              <button
                class="color-btn"
                :class="{ active: !editor.form.color }"
                @click="editor.form.color = ''"
                title="默认"
              >
                <span class="color-dot auto"><i class="fa-solid fa-palette"></i></span>
              </button>
              <button
                v-for="c in presetColors"
                :key="c"
                class="color-btn"
                :class="{ active: editor.form.color === c }"
                @click="editor.form.color = c"
              >
                <span class="color-dot" :style="{ background: c }"></span>
              </button>
            </div>
          </div>
          <div class="form-row-inline">
            <div class="form-row half">
              <label>重复</label>
              <select v-model="editor.form.repeat_type" class="form-input">
                <option value="none">不重复</option>
                <option value="yearly">每年</option>
                <option value="monthly">每月</option>
              </select>
            </div>
            <div class="form-row half">
              <label>提醒</label>
              <select v-model="editor.form.reminder_minutes" class="form-input">
                <option v-for="r in reminderOptions" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <label class="checkbox-label">
              <input type="checkbox" v-model="editor.form.pinned" />
              <span>置顶（最多 3 个）</span>
            </label>
          </div>
          <div class="form-row">
            <label>备注</label>
            <textarea v-model="editor.form.note" class="form-input" placeholder="备注（可选）" rows="2" maxlength="100"></textarea>
          </div>
          <div class="form-row">
            <label class="checkbox-label">
              <input type="checkbox" v-model="editor.form.show_in_calendar" />
              <span>同步显示到日历</span>
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

// 分类预设
var CATEGORIES = [
  { value: 'anniversary', label: '纪念日', color: 'var(--danger-color)', icon: '❤️' },
  { value: 'birthday', label: '生日', color: 'var(--warning-color)', icon: '🎂' },
  { value: 'exam', label: '考试', color: 'var(--primary-color)', icon: '📝' },
  { value: 'festival', label: '节日', color: 'var(--success-color)', icon: '🎉' },
  { value: 'travel', label: '旅行', color: '#5856D6', icon: '✈️' },
  { value: 'other', label: '其他', color: 'var(--text-tertiary)', icon: '📌' }
];

// 预设颜色色板
var PRESET_COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
  '#007AFF', '#5856D6', '#AF52DE', '#FF2D55'
];

// 提醒选项（单位：分钟）
var REMINDER_OPTIONS = [
  { value: 0, label: '不提醒' },
  { value: 1440, label: '提前 1 天' },
  { value: 4320, label: '提前 3 天' },
  { value: 10080, label: '提前 7 天' }
];

// 根据分类值查找预设
function findCategory(value) {
  for (var i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].value === value) return CATEGORIES[i];
  }
  return CATEGORIES[CATEGORIES.length - 1];
}

// 格式化日期为 YYYY-MM-DD
function formatDate(d) {
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

export default {
  name: 'Countdown',
  components: { AppNavBar: AppNavBar },
  data: function() {
    return {
      events: [],
      linkedCalendarEvents: [],  // 来自日历的虚拟倒数日（show_in_countdown=1）
      loading: true,
      error: '',
      activeCategory: 'all',
      categoryList: CATEGORIES,
      presetColors: PRESET_COLORS,
      reminderOptions: REMINDER_OPTIONS,
      editor: {
        open: false,
        id: null,
        form: {
          title: '',
          target_date: formatDate(new Date()),
          category: 'anniversary',
          color: '',
          icon: '',
          pinned: false,
          repeat_type: 'none',
          reminder_minutes: 0,
          note: '',
          show_in_calendar: false
        }
      }
    };
  },
  computed: {
    // 合并原生倒数日 + 来自日历的虚拟倒数日
    // 虚拟事件标记 _source: 'linked'，原生事件标记 _source: 'native'
    allEventsWithLinked: function() {
      var native = this.events.map(function(e) {
        return Object.assign({}, e, { _source: 'native' });
      });
      var linked = this.linkedCalendarEvents.map(function(e) {
        // 为虚拟事件预计算 _countdown
        var copy = Object.assign({}, e, { _source: 'linked' });
        copy._countdown = this.calcDays(this.getEffectiveDate(copy));
        return copy;
      }.bind(this));
      return native.concat(linked);
    },
    // 置顶事件（仅原生倒数日可置顶；跟随分类筛选）
    pinnedEvents: function() {
      var self = this;
      return self.allEventsWithLinked.filter(function(ev) {
        return ev.pinned && ev._source === 'native' && (self.activeCategory === 'all' || ev.category === self.activeCategory);
      });
    },
    // 非置顶事件（含来自日历的虚拟事件；跟随分类筛选）
    nonPinnedEvents: function() {
      var self = this;
      return self.allEventsWithLinked.filter(function(ev) {
        return !ev.pinned && (self.activeCategory === 'all' || ev.category === self.activeCategory);
      });
    },
    todayEvents: function() {
      return this.nonPinnedEvents.filter(function(ev) {
        return ev._countdown.status === 'today';
      });
    },
    futureEvents: function() {
      return this.nonPinnedEvents
        .filter(function(ev) { return ev._countdown.status === 'future'; })
        .sort(function(a, b) { return a._countdown.days - b._countdown.days; });
    },
    pastEvents: function() {
      return this.nonPinnedEvents
        .filter(function(ev) { return ev._countdown.status === 'past'; })
        .sort(function(a, b) { return b._countdown.days - a._countdown.days; });
    }
  },
  mounted: function() {
    this.loadData();
  },
  activated: function() {
    // 页面重新可见时刷新（keep-alive 场景）
    this.loadData();
  },
  methods: {
    // 轻量提示 toast
    toast: function(message, type) {
      this.$store.commit('toast/SHOW_TOAST', { message: message, type: type || 'info' });
    },
    loadData: function() {
      var self = this;
      self.loading = true;
      self.error = '';
      api.get('/countdown/events').then(function(res) {
        if (res.data && res.data.code === 200) {
          self.events = (res.data.data || []).map(function(ev) {
            // 预计算倒计时，避免模板多次调用
            ev._countdown = self.calcDays(self.getEffectiveDate(ev));
            return ev;
          });
        } else {
          self.error = (res.data && res.data.message) || '加载失败';
        }
      }).catch(function() {
        self.error = '网络错误，加载失败';
      }).finally(function() {
        self.loading = false;
      });
    },
    // 获取生效日期（重复事件用 next_date）
    getEffectiveDate: function(ev) {
      return ev.next_date || ev.target_date;
    },
    // 计算倒计时天数
    calcDays: function(dateStr) {
      if (!dateStr) return { days: 0, status: 'future' };
      var parts = dateStr.split('-');
      var target = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      var now = new Date();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var diff = Math.round((target - today) / 86400000);
      if (diff > 0) return { days: diff, status: 'future' };
      if (diff === 0) return { days: 0, status: 'today' };
      return { days: -diff, status: 'past' };
    },
    // 模板辅助：获取倒计时（已预计算）
    getCountdown: function(ev) {
      return ev._countdown || this.calcDays(this.getEffectiveDate(ev));
    },
    // 是否重复事件
    isRepeat: function(ev) {
      return ev.repeat_type && ev.repeat_type !== 'none';
    },
    // 获取事件颜色（自定义 > 分类默认）
    getEventColor: function(ev) {
      if (ev.color) return ev.color;
      return findCategory(ev.category).color;
    },
    // 获取事件图标（自定义 > 分类默认）
    getEventIcon: function(ev) {
      if (ev.icon) return ev.icon;
      return findCategory(ev.category).icon;
    },
    // 格式化日期标签
    formatDateLabel: function(dateStr) {
      if (!dateStr) return '';
      var parts = dateStr.split('-');
      var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      var weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return (parseInt(parts[1], 10)) + '月' + parseInt(parts[2], 10) + '日 · ' + weekdays[d.getDay()];
    },
    // 跳到今天
    goToToday: function() {
      var el = this.$refs.todayGroup;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        // 没有今天的事件，提示
        this.toast('今天没有倒数日');
      }
    },
    openEditor: function(event) {
      var self = this;
      // 联动事件（来自日历）不可在倒数日中编辑，提示用户去日历编辑
      if (event && event._source === 'linked') {
        self.$store.commit('toast/SHOW_TOAST', { message: '此事件来自日历，请在日历应用中编辑', type: 'info' });
        return;
      }
      if (event && event.id) {
        // 编辑
        self.editor.id = event.id;
        self.editor.form = {
          title: event.title,
          target_date: event.target_date,
          category: event.category || 'other',
          color: event.color || '',
          icon: event.icon || '',
          pinned: !!event.pinned,
          repeat_type: event.repeat_type || 'none',
          reminder_minutes: event.reminder_minutes || 0,
          note: event.note || ''
        };
      } else {
        // 新建
        self.editor.id = null;
        self.editor.form = {
          title: '',
          target_date: formatDate(new Date()),
          category: 'anniversary',
          color: '',
          icon: '',
          pinned: false,
          repeat_type: 'none',
          reminder_minutes: 0,
          note: ''
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
      if (!form.target_date) {
        self.toast('请选择目标日期');
        return;
      }
      var payload = {
        title: form.title.trim(),
        target_date: form.target_date,
        category: form.category,
        color: form.color,
        icon: form.icon,
        pinned: form.pinned ? 1 : 0,
        repeat_type: form.repeat_type,
        reminder_minutes: parseInt(form.reminder_minutes, 10) || 0,
        note: form.note,
        show_in_calendar: form.show_in_calendar ? 1 : 0
      };
      if (self.editor.id) {
        api.put('/countdown/events/' + self.editor.id, payload).then(function(res) {
          if (res.data && res.data.code === 200) {
            self.closeEditor();
            self.loadData();
          } else {
            self.toast((res.data && res.data.message) || '保存失败', 'error');
          }
        }).catch(function() { self.toast('保存失败', 'error'); });
      } else {
        api.post('/countdown/events', payload).then(function(res) {
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
        title: '删除倒数日',
        message: '确定删除「' + ev.title + '」？此操作不可恢复。',
        confirmText: '删除',
        cancelText: '取消'
      }).then(function(result) {
        if (!result) return;
        api.delete('/countdown/events/' + ev.id).then(function(res) {
          if (res.data && res.data.code === 200) {
            self.loadData();
            self.toast('已删除', 'success');
          } else {
            self.toast((res.data && res.data.message) || '删除失败', 'error');
          }
        }).catch(function() { self.toast('删除失败', 'error'); });
      }).catch(function() {});
    },
    togglePin: function(ev) {
      var self = this;
      api.put('/countdown/events/' + ev.id + '/pin').then(function(res) {
        if (res.data && res.data.code === 200) {
          self.loadData();
        } else {
          self.toast((res.data && res.data.message) || '操作失败', 'error');
        }
      }).catch(function() { self.toast('操作失败', 'error'); });
    }
  }
};
</script>

<style scoped>
.countdown-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-color);
}

.nav-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.nav-btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: none;
  background: var(--surface-elevated);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s;
}
.nav-btn:hover { background: var(--primary-lighter); transform: scale(1.06); }
.nav-btn:active { transform: scale(0.94); }
.add-nav-btn { background: var(--primary-color); color: #fff; }
.add-nav-btn:hover { background: var(--primary-color); opacity: 0.9; }

.countdown-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  max-width: 960px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

/* ========== 状态块 ========== */
.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  gap: 12px;
  color: var(--text-secondary);
}
.state-spinner {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 3px solid var(--separator-color);
  border-top-color: var(--primary-color);
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.state-icon { font-size: 44px; color: var(--text-tertiary); }
.empty-icon { color: var(--primary-color); opacity: 0.5; }
.state-text { font-size: var(--font-size-body); color: var(--text-primary); margin: 0; }
.state-sub { font-size: var(--font-size-caption); color: var(--text-tertiary); margin: 0; }
.state-retry {
  margin-top: 8px;
  padding: 8px 20px;
  border-radius: 10px;
  border: none;
  background: var(--primary-color);
  color: #fff;
  font-size: var(--font-size-body);
  cursor: pointer;
  transition: transform 0.2s, opacity 0.2s;
}
.state-retry:hover { opacity: 0.9; }
.state-retry:active { transform: scale(0.96); }

/* ========== 置顶卡片轮播 ========== */
.pinned-section { margin-bottom: 18px; }
.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  margin-bottom: 10px;
  padding: 0 4px;
}
.section-label i { font-size: 11px; }

.pinned-scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 4px 4px 8px;
  scroll-snap-type: x mandatory;
}
.pinned-card {
  flex: 0 0 200px;
  background: var(--card-bg);
  border-radius: 18px;
  padding: 16px;
  cursor: pointer;
  scroll-snap-align: start;
  border: 1px solid var(--separator-color);
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s;
}
.pinned-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: var(--card-color);
}
.pinned-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-md); }
.pinned-card:active { transform: scale(0.98); }

.pc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.pc-icon { font-size: 24px; }
.pc-header-right { display: flex; align-items: center; gap: 8px; }
.pc-repeat { color: var(--text-tertiary); font-size: 12px; }
.pc-unpin-btn {
  width: 24px; height: 24px;
  border-radius: 50%;
  border: none;
  background: var(--surface-elevated);
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  transition: all 0.2s;
  -webkit-tap-highlight-color: transparent;
}
.pc-unpin-btn:hover { background: var(--danger-color); color: #fff; transform: scale(1.1); }
.pc-unpin-btn:active { transform: scale(0.9); }
.pc-title {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 8px;
}
.pc-countdown {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 6px;
}
.pc-countdown.future .pc-days-num { color: var(--primary-color); }
.pc-countdown.past .pc-days-num { color: var(--text-tertiary); }
.pc-countdown.today .pc-days-num { color: var(--warning-color); }
.pc-days-num {
  font-size: 36px;
  font-weight: 700;
  line-height: 1;
}
.pc-days-unit {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}
.pc-date {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}
.pc-note {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ========== 分类筛选 ========== */
.filter-bar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 6px 4px 14px;
  margin-bottom: 4px;
}
.filter-chip {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: 16px;
  border: 1px solid var(--separator-color);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  transition: all 0.2s;
}
.filter-chip:hover { background: var(--surface-elevated); }
.filter-chip.active {
  background: var(--chip-color, var(--primary-color));
  color: #fff;
  border-color: transparent;
}
.chip-icon { font-size: 12px; }

/* ========== 事件列表 ========== */
.list-section { display: flex; flex-direction: column; gap: 18px; }

.group-block {}
.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  margin-bottom: 10px;
  padding: 0 4px;
}
.group-header i { font-size: 11px; }
.group-header.today-header { color: var(--warning-color); }
.group-header.past-header { color: var(--text-tertiary); }
.group-count {
  background: var(--surface-elevated);
  color: var(--text-secondary);
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 11px;
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.event-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--card-bg);
  border-radius: 14px;
  border: 1px solid var(--separator-color);
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s, box-shadow 0.2s;
}
.event-row:hover { box-shadow: var(--shadow-md); }
.event-row.past { opacity: 0.72; }

.er-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}
.er-main {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.er-title {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 6px;
}
.er-repeat { color: var(--text-tertiary); font-size: 11px; }
.er-date {
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.er-days {
  font-size: 20px;
  font-weight: 700;
  flex-shrink: 0;
  min-width: 50px;
  text-align: right;
}
.er-days.future { color: var(--primary-color); }
.er-days.today { color: var(--warning-color); font-size: var(--font-size-body); }
.er-days.past { color: var(--text-tertiary); }
.er-unit { font-size: var(--font-size-caption); font-weight: 400; margin-left: 2px; }

.er-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.er-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  transition: all 0.2s;
}
.er-btn:hover { background: var(--surface-elevated); color: var(--text-primary); }
.er-btn.danger:hover { color: var(--danger-color); background: rgba(var(--danger-rgb), 0.1); }

/* ========== 空筛选 ========== */
.empty-filter {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-tertiary);
}
.empty-filter i { font-size: 32px; margin-bottom: 8px; }
.empty-filter p { font-size: var(--font-size-body); margin: 0; }

/* ========== 编辑弹窗 ========== */
.editor-mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.editor {
  width: 90%;
  max-width: 460px;
  max-height: 85vh;
  background: var(--bg-color);
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-xl);
  animation: slideUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  overflow: hidden;
}
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--separator-color);
}
.editor-title {
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--text-primary);
}
.editor-close {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.editor-close:hover { background: var(--separator-color); color: var(--text-primary); }

.editor-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}
.form-row {
  margin-bottom: 14px;
}
.form-row.half { flex: 1; }
.form-row label {
  display: block;
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.form-input {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--separator-color);
  background: var(--card-bg);
  color: var(--text-primary);
  font-size: var(--font-size-body);
  box-sizing: border-box;
  font-family: inherit;
}
.form-input:focus {
  outline: none;
  border-color: var(--primary-color);
}
textarea.form-input { resize: vertical; }
.form-row-inline {
  display: flex;
  gap: 12px;
}

.category-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.category-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 14px;
  border: 1px solid var(--separator-color);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  cursor: pointer;
  transition: all 0.2s;
}
.category-btn .cat-icon { font-size: 13px; }
.category-btn.active {
  border-color: var(--cat-color);
  color: var(--text-primary);
  background: rgba(var(--primary-rgb), 0.08);
}

.color-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.color-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid transparent;
  background: var(--card-bg);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s;
}
.color-btn:hover { transform: scale(1.1); }
.color-btn.active { border-color: var(--text-primary); }
.color-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #fff;
}
.color-dot.auto { background: var(--separator-color); color: var(--text-secondary); }

.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  margin-bottom: 0 !important;
  color: var(--text-primary) !important;
}
.checkbox-label input { width: 18px; height: 18px; cursor: pointer; }

.editor-actions {
  display: flex;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--separator-color);
}
.ea-save, .ea-cancel {
  flex: 1;
  padding: 11px;
  border-radius: 12px;
  border: none;
  font-size: var(--font-size-body);
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.2s, opacity 0.2s;
}
.ea-save { background: var(--primary-color); color: #fff; }
.ea-save:hover { opacity: 0.9; }
.ea-cancel { background: var(--surface-elevated); color: var(--text-primary); }
.ea-cancel:hover { background: var(--separator-color); }
.ea-save:active, .ea-cancel:active { transform: scale(0.97); }

/* ========== 响应式 ========== */
@media (max-width: 600px) {
  .countdown-body { padding: 12px; }
  .pinned-card { flex: 0 0 170px; padding: 14px; }
  .pc-days-num { font-size: 30px; }
  .event-row { padding: 10px 12px; gap: 10px; }
  .er-icon { width: 36px; height: 36px; font-size: 18px; }
  .er-days { font-size: 18px; min-width: 42px; }
  .er-btn { width: 28px; height: 28px; }
}
</style>
