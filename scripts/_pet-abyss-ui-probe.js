// 深渊可发现性 UI 探针（注入用）：--jsfile=scripts/_pet-abyss-ui-probe.js
// v0.28.1 路径：点门进对战 → 直接点一级「试炼塔」按钮 → 塔 pane 直达。
// 默认（stub 通关态）断言深渊面板；?towerlock=1 断言锁定预告（两轮分开跑）。
(function () {
  var R = { steps: [], fail: 0, done: false, mode: 'open' };
  window.__abyssProbe = R;
  if (/towerlock=1/.test(String(window.location.search))) R.mode = 'locked';
  function ok(name, cond) {
    R.steps.push((cond ? '✓ ' : '✗ ') + name);
    if (!cond) R.fail++;
  }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return document.querySelectorAll(sel); }
  function clickEl(el) { if (el) { el.click(); return true; } return false; }
  function later(ms, fn) {
    setTimeout(function () {
      try { fn(); } catch (e) { R.err = String((e && e.message) || e); R.done = true; }
    }, ms);
  }

  later(200, function () {
    ok('点门进入对战页', clickEl(q('.world-obj[data-obj="door"]')));
  });
  // t≈1.9s：对战页就绪，直接点一级「试炼塔」按钮（不再需要翻抽屉标签）
  later(1900, function () {
    var towerBtn = null;
    var btns = qa('.ci-pet-cmdbtn');
    ok('五颗一级按钮', btns.length === 5, 'got ' + btns.length);
    for (var i = 0; i < btns.length; i++) {
      if (String(btns[i].textContent).indexOf('试炼塔') >= 0) towerBtn = btns[i];
    }
    ok('试炼塔一级按钮存在', !!towerBtn);
    clickEl(towerBtn);
  });
  // t≈2.4s：塔 pane 应该已经直开（不用再切标签）
  later(2500, function () {
    ok('抽屉打开', !!q('.ci-pet-sheet'));
    ok('塔 pane 直达', (function () {
      var on = q('.ci-pet-sheettab.is-on');
      return !!on && String(on.textContent).indexOf('试炼') >= 0;
    })());
    ok('今日规则条可见', !!q('.ci-pet-modrow'));
    if (R.mode === 'locked') {
      // 未通关：锁定预告必须在——目标不可见就等于不存在
      var lock = q('.ci-pet-abyss.is-locked');
      ok('锁定预告出现', !!lock);
      ok('预告写明还差几层', !!lock &&
        String(lock.textContent).indexOf('还差 3 层') >= 0);
      ok('没有下潜按钮', !q('.ci-pet-foe-btn.is-abyss'));
    } else {
      var panel = q('.ci-pet-abyss');
      ok('深渊面板出现', !!panel);
      ok('当前深度显示', !!panel &&
        String(panel.textContent).indexOf('当前深度 4 层') >= 0);
      ok('下潜按钮出现', !!q('.ci-pet-foe-btn.is-abyss'));
      ok('锁定态不存在', !q('.ci-pet-abyss.is-locked'));
    }
    R.done = true;
  });
  later(10000, function () { R.done = true; });
  return 'abyss-ui-probe armed';
})();
