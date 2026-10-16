// 内置通道（直连网易云）验证码下发探测 —— 判断 -462 IP 风控是否已衰减
// 只用测试号 13800138000；若返回 200 说明短信真的会发出（发到测试号）
import { createRequire } from 'module';
const require = createRequire('D:/NetWork/Integration/ClassIntra/');
const engine = require('./plugins/netease-music/backend/ncm/engine.js');
const PHONE = process.argv[2] || '13800138000';

const brief = (b) => 'code=' + b.code + ' | ' + ((b.message || b.msg) || JSON.stringify(b).slice(0, 80));

async function main() {
  console.log('== 内置 eapi /api/sms/captcha/sent  phone=' + PHONE + ' ==');
  try {
    const r = await engine.request('/api/sms/captcha/sent',
      { cellphone: PHONE, ctcode: '86', header: {} },
      { crypto: 'eapi', cookie: {}, bareAuth: true });
    console.log('  bareAuth=on  -> ' + brief(r.body));
  } catch (e) { console.log('  bareAuth=on  -> THROW ' + e.message); }

  // 对照：登录接口现在是什么状态（昨晚 503 验证码错误 = 放行）
  try {
    const r2 = await engine.request('/api/w/login/cellphone',
      { phone: PHONE, countrycode: '86', captcha: '0000', rememberLogin: 'true', header: {} },
      { crypto: 'eapi', cookie: {}, bareAuth: true });
    console.log('  login/cellphone（假验证码探路）-> ' + brief(r2.body));
  } catch (e) { console.log('  login/cellphone -> THROW ' + e.message); }

  console.log('\n判读：');
  console.log('  sms/captcha/sent = 200      → 内置通道已恢复，短信真的能发（应优先走内置）');
  console.log('  sms/captcha/sent = -462     → 仍需人机验证（网易云盾），内置通道不可用');
  console.log('  login/cellphone = 503/502   → 登录簇未被风控（业务码直通）');
  console.log('  login/cellphone = -462      → 登录簇仍被风控');
}
main().then(() => { process.exitCode = 0; }, e => { console.error(e); process.exitCode = 1; });
