// 网易云插件端到端探测（自签 token 走真实 HTTP 服务）
// 覆盖用户反馈的三类问题：登录（扫码/验证码/密码）、未登录收藏列表、搜索
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const REPO = 'D:/NetWork/Integration/ClassIntra';
const BASE = process.argv[2] || 'http://127.0.0.1:9001';
const USER_ID = process.argv[3] || '999999';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: USER_ID, is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

async function call(label, method, path, body) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let j; try { j = JSON.parse(text); } catch (e) { j = null; }
    const sum = j ? JSON.stringify(j).slice(0, 260) : text.slice(0, 200);
    console.log('  ' + label.padEnd(30) + ' ' + res.status + ' ' + String(Date.now() - t0).padStart(5) + 'ms  ' + sum);
    return j;
  } catch (e) {
    console.log('  ' + label.padEnd(30) + ' ERR ' + e.message);
    return null;
  }
}

async function main() {
  console.log('== 目标 ' + BASE + '  user=' + USER_ID + ' ==');
  console.log('\n[A] 状态 / 搜索');
  await call('GET /status', 'GET', '/api/netease-music/status');
  await call('GET /search 周杰伦', 'GET', '/api/netease-music/search?keywords=' + encodeURIComponent('周杰伦') + '&limit=3');

  console.log('\n[B] 登录');
  await call('POST /login/qr/create', 'POST', '/api/netease-music/login/qr/create', {});
  const qr = await call('POST /login/qr/create(2)', 'POST', '/api/netease-music/login/qr/create', {});
  const key = qr && qr.unikey;
  if (key) await call('GET /login/qr/check', 'GET', '/api/netease-music/login/qr/check?key=' + encodeURIComponent(key));
  await call('POST /captcha/send', 'POST', '/api/netease-music/login/captcha/send', { phone: '13800138000', countrycode: '86' });
  await call('POST /login/cellphone pwd', 'POST', '/api/netease-music/login/cellphone', { phone: '13800138000', countrycode: '86', password: 'probe-invalid' });
  // 关键断言：验证码登录必须返回「验证码错误」，而不是「当前登录存在安全风险」
  await call('POST /login/cellphone captcha', 'POST', '/api/netease-music/login/cellphone', { phone: '13800138000', countrycode: '86', captcha: '0000' });
  await call('POST /login/cellphone captcha(2)', 'POST', '/api/netease-music/login/cellphone', { phone: '13800138000', countrycode: '86', captcha: '0001' });

  console.log('\n[C] 未登录收藏');
  await call('GET /like/list', 'GET', '/api/netease-music/like/list');
  await call('GET /like/check', 'GET', '/api/netease-music/like/check?ids=347230,186016');

  console.log('\n[D] 播放 / 歌词');
  await call('GET /song/url', 'GET', '/api/netease-music/song/url?id=347230');
  await call('GET /lyric', 'GET', '/api/netease-music/lyric?id=347230');
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
