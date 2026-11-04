/**
 * 远征 UI 探针（v0.29.0）：抽屉第 4 tab → 待出发 → 出发 → 进行中（深度点）。
 * 结果挂 window.__expProbe，工作台轮询读取。
 */
(function () {
  var R = { steps: [], pass: 0, fail: 0, done: false };
  window.__expProbe = R;
  function ok(cond, label) {
    if (cond) { R.pass++; R.steps.push('  ✓ ' + label); }
    else { R.fail++; R.steps.push('  ✗ ' + label); }
  }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function clickEl(el) {
    if (!el) return false;
    var ev = document.createEvent('MouseEvents');
    ev.initEvent('click', true, true);
    el.dispatchEvent(ev);
    return true;
  }
  function later(ms, fn) { setTimeout(function () { try { fn(); } catch (e) { R.fail++; R.steps.push('  ✗ 探针异常: ' + (e && e.message)); } }, ms); }

  // t≈1.9s：battle 页就绪 → 打开对战抽屉
  later(1900, function () {
    ok('对战页出现', !!q('.ci-pet-battle'));
    ok('指令条五颗入口', qa('.ci-pet-cmdbtn').length === 5);
    clickEl(qa('.ci-pet-cmdbtn')[0]);
  });
  // t≈2.3s：抽屉四标签
  later(2300, function () {
    ok('抽屉四标签', qa('.ci-pet-sheettab').length === 4, 'got ' + qa('.ci-pet-sheettab').length);
    ok('远征标签存在', qa('.ci-pet-sheettab').some(function (t) { return t.textContent === '远征'; }));
    var expTab = qa('.ci-pet-sheettab').filter(function (t) { return t.textContent === '远征'; })[0];
    clickEl(expTab);
  });
  // t≈2.7s：待出发态
  later(2700, function () {
    ok('远征面板出现', !!q('.ci-pet-exp'));
    ok('标题「🏕 远征」', !!qa('.ci-pet-tower-title').some(function (t) { return t.textContent.indexOf('远征') >= 0; }));
    ok('最佳深度 3 显示', !!qa('.ci-pet-tower-quota').some(function (t) { return t.textContent.indexOf('最佳深度 3') >= 0; }));
    ok('出发按钮在', !!q('.ci-pet-exp .ci-pet-foe-btn.is-abyss'));
    R.exp = !!q('.ci-pet-exp');
    clickEl(q('.ci-pet-exp .ci-pet-foe-btn.is-abyss'));
  });
  // t≈3.2s：stub start 已回 → 重新 openSheet → 进行中态
  later(3300, function () {
    ok('深度点 5 个', qa('.ci-pet-exp-pip').length === 5, 'got ' + qa('.ci-pet-exp-pip').length);
    ok('第 1 格是下一步（is-next）', !!q('.ci-pet-exp-pip.is-next') && q('.ci-pet-exp-pip.is-next').textContent === '1');
    ok('继续下探按钮', !!q('.ci-pet-exp .ci-pet-foe-btn.is-abyss') &&
      q('.ci-pet-exp .ci-pet-foe-btn.is-abyss').textContent.indexOf('第 1 层') >= 0);
    R.done = true;
  });
})();
