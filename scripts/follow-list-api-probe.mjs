// 验证：关注/粉丝名单接口 + 被禁用用户在个人页的表现
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const REPO = 'D:/NetWork/Integration/ClassIntra';
const APP = 'http://127.0.0.1:9001';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let S = '';
for (const l of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(l);
  if (m) { S = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const ME = '251801';
const H = { Authorization: 'Bearer ' + jwt.sign({ user_id: ME }, S, { expiresIn: '1h' }), 'Content-Type': 'application/json' };
const j = async (p, o = {}) => {
  const r = await fetch(APP + p, o);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t.slice(0, 100); }
  return { s: r.status, d };
};

// 先造两条关注关系用于观察
await j('/api/user/follow/251800', { method: 'POST', headers: H });
await j('/api/user/follow/250840', { method: 'POST', headers: H });

const following = await j('/api/user/follow/' + ME + '/following?limit=5', { headers: H });
console.log('1 我的关注列表:', following.s, 'total=', following.d.data && following.d.data.total,
  '| 首条:', following.d.data && following.d.data.users[0] ? JSON.stringify({
    uid: following.d.data.users[0].user_id,
    name: following.d.data.users[0].net_name,
    following: following.d.data.users[0].is_following,
    self: following.d.data.users[0].is_self,
    hasAvatar: following.d.data.users[0].has_avatar
  }) : null);

const followers = await j('/api/user/follow/251800/followers?limit=5', { headers: H });
console.log('2 251800 的粉丝:', followers.s, 'total=', followers.d.data && followers.d.data.total,
  '| 我是否关注他:', followers.d.data && followers.d.data.users.map(u => u.user_id + ':' + u.is_following).join(','));

console.log('3 空列表:', JSON.stringify((await j('/api/user/follow/299999/followers', { headers: H })).d.data));
console.log('4 不存在的用户 ID 格式:', (await j('/api/user/follow//followers', { headers: H })).s);

// 复原
await j('/api/user/follow/251800', { method: 'DELETE', headers: H });
await j('/api/user/follow/250840', { method: 'DELETE', headers: H });
console.log('5 已复原');
