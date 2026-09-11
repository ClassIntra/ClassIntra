// 能力披露目录（capability catalog）
//
// 作用：把 manifest.capabilities 里的机器名（如 "data.realtime"）映射为
//       面向用户的中文说明与图标，供市场安装页渲染「这个应用会用到什么」。
//
// 设计要点：
//   - 纯数据，无副作用、无依赖，前后端均可 import。
//   - 与 shared/src/manifest-schema.js 的 KNOWN_CAPABILITIES 保持一致；
//     schema 增删能力时，本文件同步增删（schema-verify.mjs 会校验一致性）。
//   - 未知能力不丢弃：渲染层回退展示原始名 + 通用样式，保持开放模型。
//
// 命名与 SDK 命名空间对齐：context.data / context.system / context.ui / ...

var CAPABILITY_CATALOG = {
  // ---- 数据（context.data.*）----
  'data.storage': {
    label: '本地存储',
    description: '在本机保存该应用自己的数据（已按应用名隔离，不会读到其他应用的数据）',
    icon: 'fa-database',
    level: 'normal'
  },
  'data.realtime': {
    label: '实时通信',
    description: '与服务器保持实时连接，可接收推送消息与在线状态',
    icon: 'fa-bolt',
    level: 'normal'
  },
  'data.http': {
    label: '网络请求',
    description: '向服务器发起网络请求（仅限本系统接口）',
    icon: 'fa-globe',
    level: 'normal'
  },

  // ---- 系统（context.system.*）----
  'system.notification': {
    label: '发送通知',
    description: '向你推送通知提醒',
    icon: 'fa-bell',
    level: 'notice'
  },
  'system.clipboard': {
    label: '剪贴板',
    description: '读取或写入剪贴板内容',
    icon: 'fa-clipboard',
    level: 'notice'
  },
  'system.share': {
    label: '调用分享',
    description: '调起系统分享面板',
    icon: 'fa-share-nodes',
    level: 'normal'
  },
  'system.navigate': {
    label: '页面跳转',
    description: '跳转到系统内的其他页面',
    icon: 'fa-arrow-right-arrow-left',
    level: 'normal'
  },

  // ---- 界面（context.ui.*）----
  'ui.toast': {
    label: '轻提示',
    description: '显示短暂的提示条',
    icon: 'fa-comment-dots',
    level: 'normal'
  },
  'ui.modal': {
    label: '弹窗',
    description: '打开需要你确认的对话框',
    icon: 'fa-window-restore',
    level: 'normal'
  },
  'ui.sheet': {
    label: '底部面板',
    description: '从底部升起操作面板',
    icon: 'fa-bars-staggered',
    level: 'normal'
  },

  // ---- 应用自身（context.app.*）----
  'app.config': {
    label: '应用配置',
    description: '读写该应用自己的配置项',
    icon: 'fa-sliders',
    level: 'normal'
  },
  'app.storage': {
    label: '应用数据',
    description: '管理该应用自己产生的文件与数据',
    icon: 'fa-folder-open',
    level: 'normal'
  },

  // ---- 设备（context.device.*）----
  'device.info': {
    label: '设备信息',
    description: '读取设备型号、屏幕尺寸等基础信息',
    icon: 'fa-mobile-screen',
    level: 'normal'
  },
  'device.filePicker': {
    label: '选择文件',
    description: '打开文件选择器让你挑选文件',
    icon: 'fa-file-import',
    level: 'notice'
  },
  'device.camera': {
    label: '相机',
    description: '调用摄像头拍照或扫码',
    icon: 'fa-camera',
    level: 'notice'
  }
};

// 未知能力的兜底元数据
var UNKNOWN_CAPABILITY = {
  label: '',
  description: '该应用声明了一项本系统尚未登记的能力',
  icon: 'fa-circle-question',
  level: 'notice'
};

// 危险等级排序：notice（需留意）排在 normal 之前，便于 UI 优先展示
var LEVEL_ORDER = { notice: 0, normal: 1 };

/**
 * 取某个能力的展示元数据。
 * @param {string} name 能力机器名，如 "data.realtime"
 * @returns {{name:string,label:string,description:string,icon:string,level:string,known:boolean}}
 */
function describeCapability(name) {
  var key = String(name == null ? '' : name);
  var meta = CAPABILITY_CATALOG[key];
  if (meta) {
    return {
      name: key,
      label: meta.label,
      description: meta.description,
      icon: meta.icon,
      level: meta.level,
      known: true
    };
  }
  return {
    name: key,
    label: key,                       // 未知能力直接把机器名当标题
    description: UNKNOWN_CAPABILITY.description,
    icon: UNKNOWN_CAPABILITY.icon,
    level: UNKNOWN_CAPABILITY.level,
    known: false
  };
}

/**
 * 批量描述并排序（notice 在前，其余保持原有相对顺序）。
 * @param {string[]} names
 * @returns {Array} describeCapability 的结果数组
 */
function describeCapabilities(names) {
  if (!Array.isArray(names)) return [];
  var items = [];
  for (var i = 0; i < names.length; i++) {
    items.push(describeCapability(names[i]));
  }
  // 稳定排序：JS Array.sort 在现代引擎中稳定，Chrome 80 起已保证
  items.sort(function(a, b) {
    var la = LEVEL_ORDER[a.level];
    var lb = LEVEL_ORDER[b.level];
    if (la === undefined) la = 99;
    if (lb === undefined) lb = 99;
    return la - lb;
  });
  return items;
}

// 汇总统计：需要留意的能力条数（供卡片角标用）
function countNotices(names) {
  if (!Array.isArray(names)) return 0;
  var n = 0;
  for (var i = 0; i < names.length; i++) {
    var d = describeCapability(names[i]);
    if (d.level === 'notice') n++;
  }
  return n;
}

var KNOWN_CAPABILITY_NAMES = Object.keys(CAPABILITY_CATALOG);

export {
  CAPABILITY_CATALOG,
  KNOWN_CAPABILITY_NAMES,
  describeCapability,
  describeCapabilities,
  countNotices
};
export default {
  CAPABILITY_CATALOG: CAPABILITY_CATALOG,
  KNOWN_CAPABILITY_NAMES: KNOWN_CAPABILITY_NAMES,
  describeCapability: describeCapability,
  describeCapabilities: describeCapabilities,
  countNotices: countNotices
};
