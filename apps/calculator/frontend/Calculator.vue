<template>
  <div class="calc-page">
    <AppNavBar title="计算器">
      <template slot="actions">
        <div class="tab-bar">
          <button
            v-for="t in tabs"
            :key="t.value"
            class="tab-btn"
            :class="{ active: activeTab === t.value }"
            @click="switchTab(t.value)"
          >
            <i :class="t.icon"></i><span class="tab-label">{{ t.label }}</span>
          </button>
        </div>
      </template>
    </AppNavBar>

    <div class="tab-content">
      <CalcTab
        v-show="activeTab === 'calc'"
        :angle-mode="angleMode"
        :sci-mode="sciMode"
        :active="activeTab === 'calc'"
        @set-angle="setAngleMode"
        @set-sci="setSciMode"
      />
      <PlotTab
        v-show="activeTab === 'plot'"
        :angle-mode="angleMode"
        @set-angle="setAngleMode"
      />
      <ConvertTab v-show="activeTab === 'convert'" />
      <ToolsTab v-show="activeTab === 'tools'" />
    </div>
  </div>
</template>

<script>
import AppNavBar from '@/components/AppNavBar.vue';
import CalcTab from './components/CalcTab.vue';
import PlotTab from './components/PlotTab.vue';
import ConvertTab from './components/ConvertTab.vue';
import ToolsTab from './components/ToolsTab.vue';

var TABS = [
  { value: 'calc', label: '计算', icon: 'fa-solid fa-calculator' },
  { value: 'plot', label: '绘图', icon: 'fa-solid fa-chart-line' },
  { value: 'convert', label: '换算', icon: 'fa-solid fa-right-left' },
  { value: 'tools', label: '工具', icon: 'fa-solid fa-toolbox' }
];

var TAB_KEY = 'classintra_calc_tab';
var ANGLE_KEY = 'classintra_calc_angle';
var SCI_KEY = 'classintra_calc_keypad_mode';

export default {
  name: 'Calculator',
  components: {
    AppNavBar: AppNavBar,
    CalcTab: CalcTab,
    PlotTab: PlotTab,
    ConvertTab: ConvertTab,
    ToolsTab: ToolsTab
  },
  data: function() {
    return {
      tabs: TABS,
      activeTab: 'calc',
      angleMode: 'DEG',
      sciMode: true
    };
  },
  mounted: function() {
    // 恢复上次的页签 / 角度模式 / 键盘模式
    try {
      var tab = localStorage.getItem(TAB_KEY);
      for (var i = 0; i < TABS.length; i++) {
        if (TABS[i].value === tab) { this.activeTab = tab; break; }
      }
      var angle = localStorage.getItem(ANGLE_KEY);
      if (angle === 'DEG' || angle === 'RAD') this.angleMode = angle;
      var sci = localStorage.getItem(SCI_KEY);
      if (sci === '0') this.sciMode = false;
      else if (sci === '1') this.sciMode = true;
    } catch (e) {}
  },
  methods: {
    switchTab: function(tab) {
      this.activeTab = tab;
      try { localStorage.setItem(TAB_KEY, tab); } catch (e) {}
    },
    setAngleMode: function(mode) {
      if (mode !== 'DEG' && mode !== 'RAD') return;
      this.angleMode = mode;
      try { localStorage.setItem(ANGLE_KEY, mode); } catch (e) {}
    },
    setSciMode: function(on) {
      this.sciMode = !!on;
      try { localStorage.setItem(SCI_KEY, on ? '1' : '0'); } catch (e) {}
    }
  }
};
</script>

<style scoped>
.calc-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}
.tab-bar {
  display: flex;
  gap: 4px;
  align-items: center;
}
.tab-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  transition: background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}
.tab-btn i { font-size: 12px; }
.tab-btn:hover { background: rgba(var(--primary-rgb), 0.08); }
.tab-btn.active {
  background: var(--primary-color);
  color: #fff;
}
.tab-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* v-show 的页签需要占满剩余空间 */
.tab-content > * {
  flex: 1;
  min-height: 0;
}
@media (max-width: 480px) {
  .tab-label { display: none; }
  .tab-btn { padding: 6px 10px; }
}
</style>
