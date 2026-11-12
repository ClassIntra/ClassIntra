/**
 * 会话恢复探针：模拟「编辑器被宿主重挂」（刷新/切后台被回收的等价情形），
 * 断言回来时直接续上草稿，而不是掉回宠物屋。
 */
(async function () {
  var R = { steps: [], pass: 0, fail: 0, done: false };
  window.__restoreProbe = R;
  function ok(cond, label, extra) {
    if (cond) { R.pass++; R.steps.push('  PASS ' + label + (extra ? '  ' + extra : '')); }
    else { R.fail++; R.steps.push('  FAIL ' + label + (extra ? '  ' + extra : '')); }
  }
  function q(s) { return document.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function click(el) { if (!el) return; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  async function until(fn, ms) {
    var t0 = Date.now();
    while (Date.now() - t0 < ms) { var v = null; try { v = fn(); } catch (e) {} if (v) return v; await sleep(150); }
    return null;
  }

  await until(function () { return q('.world-obj[data-obj="bed"]'); }, 8000);
  click(q('.world-obj[data-obj="bed"]'));
  await until(function () { return qa('button').filter(function (b) { return (b.textContent || '').indexOf('换个样子') >= 0; })[0]; }, 5000);
  click(qa('button').filter(function (b) { return (b.textContent || '').indexOf('换个样子') >= 0; })[0]);
  await until(function () { return qa('.ci-pet-stylecard button').filter(function (b) { return /去画一只|再改改|换回来/.test(b.textContent || ''); })[0]; }, 5000);
  click(qa('.ci-pet-stylecard button').filter(function (b) { return /去画一只|再改改|换回来/.test(b.textContent || ''); })[0]);
  await until(function () { return q('.ci-pet-editcanvas'); }, 6000);
  await sleep(600);

  // 画三颗豆（红）
  click(qa('.ci-pet-swatchbox')[4]);
  var cv = q('.ci-pet-editcanvas');
  var r = cv.getBoundingClientRect();
  var n = Math.round(Math.sqrt(window.__ciBeadState().data.length));
  var c = r.width / n;
  for (var i = 0; i < 3; i++) {
    var x = r.left + (2 + i) * c + c / 2, y = r.top + 2 * c + c / 2;
    cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 5, pointerType: 'touch', clientX: x, clientY: y, buttons: 1 }));
    cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 5, pointerType: 'touch', clientX: x, clientY: y, buttons: 0 }));
  }
  await sleep(1400);   // 等草稿落盘（900ms 防抖）
  var before = window.__ciBeadState().data;
  var beforeBeads = (before.match(/[^.]/g) || []).length;

  // 模拟宿主重挂：unmount → mount
  var host = q('#host') || document.getElementById('host');
  var def = window.__ci.appDef;
  try { def.unmount(host); } catch (e) {}
  await sleep(300);
  ok(!q('.ci-pethome'), '卸载后页面已清空');
  try { def.mount(host, window.ClassIntraMarket.createContext('pet', {})); } catch (e) {}
  await sleep(2200);   // 等状态加载 + 会话恢复

  ok(!!q('.ci-pet-editor'), '重挂后自动回到编辑器');
  ok(!!q('.ci-pet-editcanvas'), '画板已重建');
  var after = window.__ciBeadState ? window.__ciBeadState().data : '';
  var afterBeads = (after.match(/[^.]/g) || []).length;
  ok(afterBeads === beforeBeads && afterBeads > 0, '草稿原样续上（含刚才画的豆）',
    beforeBeads + ' → ' + afterBeads);

  // 明确离开后，再重挂不应再回到编辑器
  var back = qa('button').filter(function (b) { return /先不换了/.test(b.textContent || ''); })[0];
  if (back) back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(800);
  try { def.unmount(host); } catch (e) {}
  await sleep(200);
  try { def.mount(host, window.ClassIntraMarket.createContext('pet', {})); } catch (e) {}
  await sleep(2000);
  ok(!q('.ci-pet-editor') && !!q('.world-obj[data-obj="bed"]'), '明确离开后重挂回宠物屋');

  R.done = true;
  return JSON.stringify({ pass: R.pass, fail: R.fail, steps: R.steps });
})()
