'use strict';
/**
 * 唯一名冲突消解（users.net_name / users.real_name 均有 UNIQUE 约束）
 *
 * 背景：跨班登录与跨班用户同步都会把对端用户写入本地 users 表。
 * 若对端用户与本班任一用户同名（网名或姓名），写入会触发 UNIQUE 约束失败：
 *   - 登录路径：跨班登录直接报错，用户登不上
 *   - 同步路径：该行同步被跳过，资料长期不同步
 * 冲突时追加班级标记（如「张伟(18班)」），既保证写入成功，也让跨班身份更明确。
 */

function resolveUniqueName(db, desired, userId, field, fallbackPrefix) {
  var name = String(desired || '').trim();
  if (!name) name = (fallbackPrefix || '用户') + String(userId || '').slice(-4);
  var row = db.prepare('SELECT user_id FROM users WHERE ' + field + ' = ?').get(name);
  if (!row || row.user_id === userId) return name;

  var cc = String(userId || '').substring(2, 4);
  var classTag = /^\d{2}$/.test(cc) ? '(' + cc + '班)' : '(跨班)';
  var base = name + classTag;
  var candidate = base;
  var n = 2;
  while (db.prepare('SELECT user_id FROM users WHERE ' + field + ' = ?').get(candidate)) {
    candidate = base + n;
    n++;
  }
  return candidate;
}

module.exports = { resolveUniqueName: resolveUniqueName };
