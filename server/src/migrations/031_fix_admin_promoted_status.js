// 迁移 031：修复被「升 / 降管理员」写坏的用户状态
//
// ---- 问题 ----
// 旧版 PATCH /api/admin/users/:id 在改动 is_admin 时，会通过继电器广播
// admin_user_status_changed，并把 status 写成 admin_promoted / admin_demoted。
// 对端班级收到后直接用 payload.status 覆盖 users.status，用户的账号状态
// 从此不再等于 active（本班库里也有历史脏值）。
//
// 后果（2026-11-05 生产实测：转不了账给班管）：
//   · /wallet/people 选人列表看不到他
//   · /wallet/transfer 抛「没找到这个学号」
//   · /wallet/cross/whois 与跨班收款校验判他「不是有效用户」
//
// ---- 处理 ----
// users.status 的合法取值只有 active / disabled（见 admin 的状态校验）。
// 这里把历史脏值回填成 active。这些行原本的状态已被覆盖、ban_reason 也被清空，
// 无法还原成封禁态，只能按「未封禁」处理；确需封禁的由班管再操作一次即可。
// 事件本身已在 relay-handlers / admin 路由里改掉，不会再产生新的脏值。

function up(db) {
  db.exec([
    "UPDATE users SET status = 'active'",
    "WHERE status IN ('admin_promoted', 'admin_demoted')"
  ].join(' '));
}

module.exports = {
  version: 31,
  name: 'fix_admin_promoted_status',
  up: up
};
