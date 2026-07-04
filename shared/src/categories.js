// 共享层：倒数日分类与提醒选项
// 注意：CATEGORIES 的 color 字段使用 CSS 变量，仅供前端使用
// 后端如需分类数据，应使用 getCategoriesPure() 获取不带 CSS 变量的版本

var CATEGORIES = [
  { value: 'anniversary', label: '纪念日', color: 'var(--danger-color)', icon: '❤️' },
  { value: 'birthday', label: '生日', color: 'var(--warning-color)', icon: '🎂' },
  { value: 'exam', label: '考试', color: 'var(--primary-color)', icon: '📝' },
  { value: 'festival', label: '节日', color: 'var(--success-color)', icon: '🎉' },
  { value: 'travel', label: '旅行', color: '#5856D6', icon: '✈️' },
  { value: 'other', label: '其他', color: 'var(--text-tertiary)', icon: '📌' }
];

// 不带 CSS 变量的纯色版本（后端可用）
var CATEGORIES_PURE = [
  { value: 'anniversary', label: '纪念日', color: '#FF3B30', icon: '❤️' },
  { value: 'birthday', label: '生日', color: '#FF9500', icon: '🎂' },
  { value: 'exam', label: '考试', color: '#007AFF', icon: '📝' },
  { value: 'festival', label: '节日', color: '#34C759', icon: '🎉' },
  { value: 'travel', label: '旅行', color: '#5856D6', icon: '✈️' },
  { value: 'other', label: '其他', color: '#8E8E93', icon: '📌' }
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

export {
  CATEGORIES,
  CATEGORIES_PURE,
  REMINDER_OPTIONS,
  findCategory
};
