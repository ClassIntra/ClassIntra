// 前端核心：全局搜索的数据源装配（唯一注册入口）
// ============================================================
// 背景（2026-10-25 实测）：
//   SearchRegistry 早就设计了三层搜索源 —— 应用（内置读 APP_REGISTRY）、
//   命令（registerCommand）、自定义（registerProvider）。但**命令和 Provider 一处都没注册**，
//   于是 Ctrl+K 搜索框的 placeholder 写着「搜索应用、命令…」，实际只能搜到应用。
//   这是典型的「能力建好了、线没接」：文案向用户承诺了不存在的东西。
//
// 本文件是**唯一**的可搜内容注册入口。要新增可搜对象就改这里，
// 不要把 registerProvider / registerCommand 散落到各个组件里 ——
// 散落之后没人知道系统里到底能搜到什么，等于又回到「靠人记着」。
//
// 约定（与 search-registry 的 result 结构对齐）：
//   { id, title, description, icon, iconColor, category, action }
//   - icon 以 '/' 开头 → 渲染成 <img src>
//   - 否则视为 FontAwesome class → 渲染成 <i class>
//   - action 是无参函数，执行后搜索面板自动关闭
//
// 编码约定：var / function / 单引号 / 2 空格缩进（Chrome 80 兼容基线）

import { getSearchRegistry } from './search-registry';
import api from '@/utils/api';
import store from '@/store';

// Provider 的最小查询长度：单字（"的"、"我"）去扫全库既慢又没意义，
// 而且资源搜索是服务端同步遍历文件系统，必须挡在客户端。
var MIN_PROVIDER_QUERY = 2;
// 每个 Provider 最多回几条，避免一次搜索把面板撑爆
var MAX_ITEMS_PER_PROVIDER = 6;
// Provider 网络超时：搜索面板不该因为一个慢接口转 10 秒
var PROVIDER_TIMEOUT_MS = 3000;

function push(path) {
  try {
    if (window.__router) window.__router.push(path);
  } catch (e) {}
}

// 富文本 → 纯文本：社区帖子正文是 HTML，直接塞进 description 会露出标签
function plainText(html, max) {
  var s = String(html || '');
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  s = s.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  max = max || 60;
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ============================================================
// 一、命令（纯前端，零网络，永远可用）
// ============================================================
function buildCommands() {
  var cmds = [
    {
      id: 'open-cloud',
      title: '打开云盘',
      description: '班级资料 · 文件上传下载',
      icon: 'fas fa-cloud',
      keywords: ['云盘', '文件', '资料', '资源', '上传', '下载', 'yunpan', 'wenjian'],
      action: function() { push('/cloud'); }
    },
    {
      id: 'open-community',
      title: '打开社区',
      description: '帖子 · 讨论 · 广场',
      icon: 'fas fa-comments',
      keywords: ['社区', '帖子', '论坛', '广场', '讨论', 'shequ'],
      action: function() { push('/community'); }
    },
    {
      id: 'open-chat',
      title: '打开聊天',
      description: '会话 · 消息',
      icon: 'fas fa-message',
      keywords: ['聊天', '消息', '会话', '私聊', 'liaotian', 'xiaoxi'],
      action: function() { push('/chat'); }
    },
    {
      id: 'open-timetable',
      title: '打开课程表',
      description: '今天上什么课',
      icon: 'fas fa-table-cells',
      keywords: ['课程表', '课表', '课程', '上课', 'kebiao'],
      action: function() { push('/timetable'); }
    },
    {
      id: 'open-calendar',
      title: '打开日程',
      description: '日历 · 安排',
      icon: 'fas fa-calendar-days',
      keywords: ['日程', '日历', '安排', 'riqi'],
      action: function() { push('/calendar'); }
    },
    {
      id: 'open-countdown',
      title: '打开倒数日',
      description: '考试 · 纪念日倒计时',
      icon: 'fas fa-hourglass-half',
      keywords: ['倒数', '倒计时', '考试', '纪念日', 'daoshu'],
      action: function() { push('/countdown'); }
    },
    {
      id: 'open-music',
      title: '打开音乐',
      description: '播放 · 歌单',
      icon: 'fas fa-music',
      keywords: ['音乐', '歌', '播放', '歌单', 'yinyue'],
      action: function() { push('/music'); }
    },
    {
      id: 'lock-screen',
      title: '锁定屏幕',
      description: '离开座位时锁上',
      icon: 'fas fa-lock',
      keywords: ['锁屏', '锁定', '锁', '离开', 'suoping'],
      // 锁屏状态在 App.vue 的组件内（isLocked），不在 store。
      // 用自定义事件解耦：App.vue 监听后调用自己的 lockScreen()。
      action: function() {
        try { window.dispatchEvent(new CustomEvent('classintra:lock')); } catch (e) {}
      }
    }
  ];

  // 「我的主页」需要当前用户 id；未登录或拿不到就干脆不出现，
  // 而不是给一个点了会 404 的条目。
  var user = store && store.state && store.state.auth ? store.state.auth.user : null;
  if (user && user.user_id) {
    cmds.push({
      id: 'open-my-profile',
      title: '我的主页',
      description: '个人资料 · 装扮',
      icon: 'fas fa-user',
      keywords: ['主页', '个人', '我的', '资料', '头像', '装扮', 'profile'],
      action: function() { push('/profile/' + encodeURIComponent(user.user_id)); }
    });
  }

  // 管理员才有「管理后台」，避免普通学生搜到一个点进去被拒的入口
  var isAdmin = !!(user && user.is_admin === 1);
  if (isAdmin) {
    cmds.push({
      id: 'open-admin',
      title: '打开管理后台',
      description: '用户 · 公告 · 广播',
      icon: 'fas fa-shield-halved',
      keywords: ['管理', '后台', 'admin', '设置'],
      action: function() { push('/admin'); }
    });
  }

  return cmds;
}

// ============================================================
// 二、Provider —— 社区帖子
// ============================================================
var communityProvider = {
  id: 'community',
  category: '社区',
  search: function(q) {
    if (!q || q.length < MIN_PROVIDER_QUERY) return [];
    return api.get('/community/search', {
      params: { q: q, limit: MAX_ITEMS_PER_PROVIDER },
      timeout: PROVIDER_TIMEOUT_MS
    }).then(function(res) {
      var posts = (res && res.data && res.data.data && res.data.data.posts) || [];
      var items = [];
      for (var i = 0; i < posts.length && items.length < MAX_ITEMS_PER_PROVIDER; i++) {
        var p = posts[i];
        if (!p || !p.id) continue;
        // 匿名帖不显示作者，与列表页保持一致
        var author = p.anonymous === 1 ? '匿名' : (p.net_name || p.real_name || '');
        items.push({
          id: 'post:' + p.id,
          title: plainText(p.title || p.content, 40) || ('帖子 #' + p.id),
          description: (author ? author + ' · ' : '') + plainText(p.content, 50),
          icon: 'fas fa-message',
          category: '社区',
          // 社区页消费 ?post=<id> 会直接打开该帖
          action: function(postId) {
            return function() { push('/community?post=' + postId); };
          }(p.id)
        });
      }
      return items;
    }).catch(function() {
      // 搜索是辅助功能，任何失败都静默降级成「这一组没有结果」，
      // 绝不能让一个慢接口把整个搜索面板拖住
      return [];
    });
  }
};

// ============================================================
// 三、Provider —— 班级资料（云盘）
// ⚠️ 这个接口在服务端是**同步遍历文件系统**，重且有延迟。
//    所以：客户端先卡最小长度，再卡超时，最后只取前几条。
// ============================================================
var cloudProvider = {
  id: 'cloud',
  category: '文件',
  search: function(q) {
    if (!q || q.length < MIN_PROVIDER_QUERY) return [];
    return api.get('/resources/search', {
      params: { q: q },
      timeout: PROVIDER_TIMEOUT_MS
    }).then(function(res) {
      var list = (res && res.data && res.data.data && res.data.data.results) || [];
      var items = [];
      for (var i = 0; i < list.length && items.length < MAX_ITEMS_PER_PROVIDER; i++) {
        var f = list[i];
        if (!f || !f.name) continue;
        items.push({
          id: 'file:' + (f.path || f.name),
          title: f.name,
          description: (f.is_dir ? '文件夹' : (f.sizeFormatted || '')) +
            (f.path ? ' · ' + f.path : ''),
          icon: f.is_dir ? 'fas fa-folder' : 'fas fa-file',
          category: '文件',
          // 云盘页目前不消费 query，只能把用户带到云盘，
          // 至少让他知道「这个东西确实存在」。等云盘支持 ?focus=<path> 再升级成精确定位。
          action: function() { push('/cloud'); }
        });
      }
      return items;
    }).catch(function() {
      return [];
    });
  }
};

// ============================================================
// 四、装配
// ============================================================
var _installed = false;

function installSearchSources() {
  if (_installed) return;
  _installed = true;

  var registry = getSearchRegistry();

  var cmds = buildCommands();
  for (var i = 0; i < cmds.length; i++) {
    registry.registerCommand(cmds[i]);
  }

  registry.registerProvider(communityProvider);
  registry.registerProvider(cloudProvider);

  // 便于排查：控制台可查「系统里到底能搜到什么」
  try {
    console.log('[Search] 已注册 ' + cmds.length + ' 条命令 / 2 个数据源');
  } catch (e) {}
}

export {
  installSearchSources,
  buildCommands
};
