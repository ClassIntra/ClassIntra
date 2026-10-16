// 验证码发送链路探针（自签 token 打真实服务）
// 用途：区分三种失败 —— ① 服务端闸门拦下（429）② 上游/网易云限流（429，按出口 IP）
//      ③ 上游受理（200，但短信是否真到达本探针无法判断）
// 只用测试号 13800138000，绝不使用真实号码，避免消耗其当日短信额度。
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const REPO = 'D:/NetWork/Integration/ClassIntra';
const BASE = process.argv[2] || 'http://127.0.0.1:9001';
const USER_ID = process.argv[3] || '999999';
const PHONE = process.argv[4] || '13800138000';
const require = createRequire(REPO + '/server/node_modules/');
const jwt = require('jsonwebtoken');

let SECRET = null;
for (const line of readFileSync(REPO + '/server/.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*JWT_SECRET\s*=\s*(.*)$/.exec(line);
  if (m) { SECRET = m[1].trim().replace(/^["']|["']$/g, ''); break; }
}
const token = jwt.sign({ user_id: USER_ID, is_admin: 1, is_class_admin: 1, role: 'admin' }, SECRET, { expiresIn: '1h' });
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

async function send(label) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + '/api/netease-music/login/captcha/send', {
      method: 'POST', headers: H, body: JSON.stringify({ phone: PHONE, countrycode: '86' })
    });
    const text = await res.text();
    console.log('  ' + label.padEnd(22) + ' HTTP ' + res.status + '  ' + String(Date.now() - t0).padStart(5) + 'ms  ' + text.slice(0, 160));
  } catch (e) {
    console.log('  ' + label.padEnd(22) + ' ERR ' + e.message);
  }
}

async function main() {
  console.log('== 验证码发送链路（user=' + USER_ID + ' phone=' + PHONE + '）==');
  console.log('说明：第 1 次会真的触达上游；第 2 次应立即被服务端闸门拦住（429，且不再打扰上游）。\n');
  await send('第 1 次发送');
  await send('第 2 次（应被拦）');
  console.log('\n判读：');
  console.log('  两次都 200            → 上游受理了，短信是否到达需看手机（本探针测不到）');
  console.log('  1 次 429/上游限流文案  → 出口 IP 正被网易云限流，稍后再试，勿连点');
  console.log('  2 次 429「过于频繁」   → 服务端闸门生效');
}
// 用 exitCode 而非 process.exit()：后者会在 fetch/agent 还有句柄时触发
// libuv `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` 收尾噪声
main().then(() => { process.exitCode = 0; }, e => { console.error(e); process.exitCode = 1; });
