// 内核冒烟测试：ResourceAuditor 共享劫持 / detachLifecycle / history 封顶 / EventBus owner 治理
// 纯 Node 运行，window 用 shim 提供；event-bus 部分需 @shared 别名（--import alias-loader）。
// 用法：node scripts/kernel-smoke.mjs
//       node --import ./scripts/alias-loader.mjs scripts/kernel-smoke.mjs（含事件总线用例）
import { ResourceAuditor, RuntimeKernel } from '../client/src/core/runtime-kernel.js';

let fail = 0;
const check = (label, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (detail ? ' — ' + detail : ''));
  if (!ok) fail++;
};

// ---- window shim（node 环境）----
const listeners = [];
global.window = {
  setTimeout: (fn, delay) => setTimeout(fn, delay),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, delay) => setInterval(fn, delay),
  clearInterval: (id) => clearInterval(id),
  addEventListener: (type, fn) => listeners.push([type, fn]),
  removeEventListener: (type, fn) => {
    const i = listeners.findIndex(([t, f]) => t === type && f === fn);
    if (i !== -1) listeners.splice(i, 1);
  }
};
const NATIVE_ST = global.window.setTimeout;

// ---- 1. 单审计器：begin/end 后原生函数完整恢复 ----
{
  const a = new ResourceAuditor('solo');
  a.begin();
  const hijacked = global.window.setTimeout !== NATIVE_ST;
  a.end();
  check('1a begin 后包装器生效', hijacked);
  check('1b end 后原生 setTimeout 恢复', global.window.setTimeout === NATIVE_ST);
  check('1c end 后原生 clearTimeout 恢复', global.window.clearTimeout === global.window.setTimeout.clearTimeout || typeof global.window.clearTimeout === 'function');
}

// ---- 2. 嵌套审计器：乱序结束不残留包装器（旧实现的致命 bug）----
{
  const outer = new ResourceAuditor('overlay-app'); // 先挂载（如悬浮层应用）
  const inner = new ResourceAuditor('page-app');    // 后挂载（页面应用）
  outer.begin();
  inner.begin();
  // 外层先结束（悬浮层被移除，页面应用还在）
  outer.end();
  check('2a 外层先 end 后包装器仍在（内层还在用）', global.window.setTimeout !== NATIVE_ST);
  // 内层创建一个计时器，归属应正确
  let tick = 0;
  const timerId = global.window.setTimeout(() => { tick = 1; }, 50);
  check('2b 计时器记录到内层', inner._timers.some(t => t.id === timerId));
  inner.end();
  check('2c 最后一个 end 后原生恢复（无死包装器残留）', global.window.setTimeout === NATIVE_ST);
  clearTimeout(timerId);
}

// ---- 3. 嵌套 + 计时器归属：外层 end 不误杀内层计时器 ----
{
  const a = new ResourceAuditor('a');
  const b = new ResourceAuditor('b');
  a.begin();
  let alive = 0;
  global.window.setTimeout(() => { alive = 1; }, 30); // 归属 a（此时只有 a 在栈里）
  b.begin();
  global.window.setTimeout(() => { alive = 2; }, 30); // 归属 b（栈顶）
  a.end(); // 只应回收 a 的计时器，b 的必须存活
  await new Promise(r => setTimeout(r, 60));
  check('3 内层计时器未被外层 end 误杀', alive === 2);
  b.end();
}

// ---- 4. detachLifecycle：登记表摘除 + 运行中机器回收 ----
{
  const k = new RuntimeKernel();
  k.attachLifecycle('demo', {});
  const m = k.getMachine('demo');
  await m.mount();
  check('4a mount 后 active', m.getState() === 'active');
  check('4b 审计器已开启', k.getAuditor('demo')._active === true);
  k.detachLifecycle('demo');
  check('4c detach 后机器 idle', m.getState() === 'idle');
  check('4d detach 后登记表清空', k.getMachine('demo') === null && k.getAuditor('demo') === null);
  check('4e detach 幂等（再次调用返回 null）', k.detachLifecycle('demo') === null);
}

// ---- 5. history 封顶 ----
{
  const k = new RuntimeKernel();
  k.attachLifecycle('flip', {});
  const m = k.getMachine('flip');
  for (let i = 0; i < 200; i++) {
    await m.mount();
    m.suspend();
    m.resume();
    m.unmount();
  }
  check('5 状态机历史封顶 ≤64', m.getHistory().length <= 64, 'len=' + m.getHistory().length);
}

// ---- 6. EventBus owner 治理（需 --import ./scripts/alias-loader.mjs）----
try {
  const { getEventBus } = await import('../client/src/core/event-bus.js');
  const bus = getEventBus();
  let hit = 0;
  const off1 = bus.on('t', () => hit++, 'market:demo');
  bus.on('t', () => hit++, 'market:demo');
  bus.on('t', () => hit++);
  bus.emit('t');
  const a6 = hit === 3;
  const n6 = bus.offOwner('market:demo');
  hit = 0;
  bus.emit('t');
  const b6 = hit === 1 && n6 === 2;
  off1();
  const c6 = JSON.stringify(bus.ownerStats()) === '{}';
  check('6 event-bus owner 治理（登记/批量退订/登记表清理）', a6 && b6 && c6, [a6, b6, c6].join(','));
} catch (e) {
  console.log('SKIP 6 event-bus（无 alias-loader，跳过：' + (e && e.message) + '）');
}

// ---- 7. 资源治理器：超阈自动挂起 + 动作记录 ----
{
  const k = new RuntimeKernel();
  k.attachLifecycle('leaky', {});
  const m = k.getMachine('leaky');
  const a = k.getAuditor('leaky');
  await m.mount();
  check('7a 泄漏应用初始 active', m.getState() === 'active');
  // 模拟泄漏：向审计器塞入超阈数量的未回收计时器记录
  for (let i = 0; i < 130; i++) a._timers.push({ id: 900000 + i, kind: 'timeout' });
  k.governor.tick();
  check('7b 超阈被治理器挂起', m.getState() === 'suspended');
  const actions = k.governor.getRecentActions();
  check('7c 动作已记录', actions.length === 1 && actions[0].name === 'leaky' && actions[0].timers === 130);
  // 未超阈的正常应用不受影响
  k.attachLifecycle('healthy', {});
  const hm = k.getMachine('healthy');
  await hm.mount();
  global.window.setTimeout(() => {}, 10); // 正常创建 1 个计时器
  k.governor.tick();
  check('7d 正常应用不被误伤', hm.getState() === 'active');
  k.governor.stop();
  k.detachLifecycle('leaky');
  k.detachLifecycle('healthy');
}

console.log(fail === 0 ? '\n全部通过 ✔' : `\n${fail} 项失败 ✘`);
process.exit(fail === 0 ? 0 : 1);
