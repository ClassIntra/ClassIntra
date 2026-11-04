// 默契指令 UI 探针（注入用）：pet-ui-workbench.mjs --page=battle --touch=1 --jsfile=scripts/_pet-cmd-ui-probe.js
// 走真实用户路径：点门 → 点「对战」→ 选对手 → 播放中按一张牌 → 等结算。
// 结果挂在 window.__cmdProbe，工作台末尾会轮询读取并打印。
(function () {
  var R = { steps: [], fail: 0, done: false };
  window.__cmdProbe = R;
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

  // t≈0.2s：从家进对战页（门 = 对战入口，dock 已删）
  later(200, function () {
    ok('点门进入对战页', clickEl(q('.world-obj[data-obj="door"]')));
  });
  // t≈1.9s：battle 页已就绪，点 ⚔️ 对战 → 抽屉
  later(1900, function () {
    ok('对战页出现', !!q('.ci-pet-battle'));
    ok('指令条五颗入口', qa('.ci-pet-cmdbtn').length === 5);
    clickEl(qa('.ci-pet-cmdbtn')[0]);
  });
  // t≈2.15s：抽屉里点第一个可点的对手 → 开打
  later(2150, function () {
    var foe = q('.ci-pet-foe-btn:not([disabled])');
    ok('对手列表有可点的对手', !!foe);
    clickEl(foe);
  });
  // t≈2.6s：合并断言 + 按牌（工作台 t≈2.8 拍截图，正好拍在特写/播放中）
  later(2600, function () {
    var row = q('.ci-pet-cmdrow');
    ok('默契指令条出现', !!row);
    R.cards = qa('.ci-pet-cmd').length;
    ok('三张默契牌 + 两张技能牌', R.cards === 5, 'got ' + R.cards);
    ok('技能牌行出现', !!q('.ci-pet-cmdrow.is-skills'));
    ok('剩余额度 ×3', (q('.ci-pet-cmdrow-count') || {}).textContent === '×3');
    var card = q('.ci-pet-cmd[data-cmd="strike"]');
    ok('能找到「全力一击」', !!card);
    R.pressed = clickEl(card);
  });
  // t≈3.1s：钉住工作台的「回首页清理」——重播还没结束，别让页面被切走。
  // 结算断言完成后立刻恢复并自己清场，不耽误后面的走动采样。
  later(3100, function () {
    if (window.__ciPetGo && !window.__ciPetGoReal) {
      window.__ciPetGoReal = window.__ciPetGo;
      window.__ciPetGo = function () {};
    }
    var card = q('.ci-pet-cmd[data-cmd="strike"]');
    ok('用过的牌标记 is-used', !!(card && String(card.className).indexOf('is-used') >= 0));
    ok('额度变成 ×2', (q('.ci-pet-cmdrow-count') || {}).textContent === '×2');
  });
  // t≈3.5s：跳过剩余动画 → finish → settle（stub 即时返回）
  later(3500, function () {
    ok('跳过动画按钮在', !!q('.ci-pet-arena-skip'));
    clickEl(q('.ci-pet-arena-skip'));
  });
  // t≈4.1s：结算横幅应该出现
  later(4100, function () {
    ok('结算横幅出现', !!q('.ci-pet-arena-result'));
    if (!q('.ci-pet-arena-result')) {
      var arena = q('.ci-pet-arena');
      R.steps.push('  诊断 arenaKids=' + JSON.stringify(arena ? Array.prototype.slice.call(arena.children).map(function (c) { return c.className; }) : null));
      R.steps.push('  诊断 log=' + JSON.stringify((q('.ci-pet-arena-log') || {}).textContent || null));
    }
    // 放行清场钩子，把页面还回去
    if (window.__ciPetGoReal) {
      window.__ciPetGo = window.__ciPetGoReal;
      delete window.__ciPetGoReal;
      window.__ciPetGo('home');
    }
    R.done = true;
  });
  // 兜底：无论如何 12s 后结束，别让工作台白等
  later(12000, function () { R.done = true; });
  return 'cmd-ui-probe armed';
})();
