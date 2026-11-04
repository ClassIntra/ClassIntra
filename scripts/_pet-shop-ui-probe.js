// 小卖部货架 + 助战入口 UI 探针（注入用）：--jsfile=scripts/_pet-shop-ui-probe.js
// 路径：点食盆 → 「食盆 · 小卖部」弹层（普通饭 + 货架五件）→ 关弹层 → 点书架进图鉴 → 助战按钮。
// 结果挂 window.__shopProbe，工作台末尾统一读取。
(function () {
  var R = { steps: [], fail: 0, done: false };
  window.__shopProbe = R;
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

  // t≈0.2s：点食盆 → 弹层（食盆在脚边，不需要走过去）
  later(200, function () {
    ok('点食盆弹层', clickEl(q('.world-obj[data-obj="bowl"]')));
  });
  later(900, function () {
    ok('小卖部弹层出现', !!q('.world-sheet'));
    var shelf = q('.ci-pet-shoppe-shelf');
    ok('货架出现', !!shelf);
    var items = qa('.ci-pet-shoppe-item');
    R.itemCount = items.length;
    ok('普通饭 + 五件货 = 6 格', items.length === 6, 'got ' + items.length);
    var ids = [];
    items.forEach(function (it) { ids.push(it.getAttribute('data-shoppe')); });
    ok('普通饭在最上', ids[0] === 'normal');
    ok('大餐在货架', ids.indexOf('feast') >= 0);
    ok('铃铛在货架', ids.indexOf('bell') >= 0);
    var sold = q('.ci-pet-shoppe-item.is-soldout');
    ok('铃铛显示已购（售罄态）', !!(sold && sold.getAttribute('data-shoppe') === 'bell'));
    ok('库存角标存在', qa('.ci-pet-shoppe-item-charges').length >= 4);
    // 关弹层（点 scrim）
    clickEl(q('.ci-pet-sheet-scrim'));
    // 点书架进图鉴
    later(200, function () { clickEl(q('.world-obj[data-obj="shelf"]')); });
  });
  later(3400, function () {
    ok('图鉴页出现', !!q('.ci-pet-dex'));
    var assistBtns = qa('button[data-assist]');
    R.assistBtns = assistBtns.length;
    ok('助战按钮出现', assistBtns.length > 0);
    var on = q('button[data-assist].is-assist');
    ok('当前助战标记 is-assist', !!on);
    R.done = true;
  });
  later(12000, function () { R.done = true; });
  return 'shop-ui-probe armed';
})();
