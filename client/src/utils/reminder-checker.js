/**
 * 提醒检查器
 * 每分钟检查日历和倒数日的到期待提醒事件，通过灵动岛推送通知
 */
import api from './api';
import islandNotify from './island-notify';

var timer = null;
var running = false;

// 检查所有到期待提醒事件
function checkAll() {
  if (running) return;
  running = true;
  Promise.all([
    api.get('/calendar/reminders/due').catch(function() { return { data: { data: [] } }; }),
    api.get('/countdown/reminders/due').catch(function() { return { data: { data: [] } }; })
  ]).then(function(results) {
    var calReminders = (results[0].data && results[0].data.data) || [];
    var cdReminders = (results[1].data && results[1].data.data) || [];
    // 日历日程提醒（紧急）
    for (var i = 0; i < calReminders.length; i++) {
      var ev = calReminders[i];
      islandNotify.notify({
        icon: 'fa-solid fa-calendar-day',
        color: 'rgba(255, 59, 48, 0.25)',
        title: '日程提醒',
        text: ev.title + (ev.start_time ? ' ' + ev.start_time : ''),
        route: '/calendar',
        type: 'calendar',
        category: 'system',
        priority: 'urgent'
      });
    }
    // 倒数日提醒（普通）
    for (var j = 0; j < cdReminders.length; j++) {
      var cd = cdReminders[j];
      islandNotify.notify({
        icon: 'fa-solid fa-hourglass-half',
        color: 'rgba(255, 149, 0, 0.25)',
        title: '倒数日提醒',
        text: cd.title + ' 今天',
        route: '/countdown',
        type: 'countdown',
        category: 'system',
        priority: 'normal'
      });
    }
  }).catch(function() {}).finally(function() {
    running = false;
  });
}

// 启动定时检查（App.vue mounted 时调用）
function start() {
  if (timer) return;
  // 启动时立即检查一次
  checkAll();
  // 每分钟检查一次
  timer = setInterval(checkAll, 60000);
}

// 停止定时检查（App.vue beforeDestroy 时调用）
function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export default { start, stop, checkNow: checkAll };
