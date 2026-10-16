// 验证：未登录用户的本机收藏 → 列表 → 歌曲详情 全链路可渲染
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const REPO = 'D:/NetWork/Integration/ClassIntra';
const BASE = process.argv[2] || 'http://127.0.0.1:9001';
const USER_ID = process.argv[3] || '251837';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');
let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const H = { Authorization: 'Bearer ' + jwt.sign({ user_id: USER_ID, is_admin: 0 }, SECRET, { expiresIn: '1h' }) };

const list = await (await fetch(BASE + '/api/netease-music/like/list', { headers: H })).json();
console.log('like/list:', JSON.stringify(list).slice(0, 300));
const ids = (list.ids || []).slice(0, 500);
if (!ids.length) { console.log('（无收藏，跳过详情）'); process.exit(0); }
const d = await (await fetch(BASE + '/api/netease-music/song/detail?ids=' + ids.join(','), { headers: H })).json();
const songs = d.songs || [];
console.log('song/detail 请求 ' + ids.length + ' 首 → 返回 ' + songs.length + ' 首');
songs.slice(0, 5).forEach((s) => {
  const name = s.name || s.title || '(无名)';
  const ar = (s.ar && s.ar[0] && s.ar[0].name) || (s.artists && s.artists[0] && s.artists[0].name) || '?';
  const pic = (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || '(无封面)';
  console.log('  - ' + name + ' / ' + ar + ' / ' + pic.slice(0, 60));
});
