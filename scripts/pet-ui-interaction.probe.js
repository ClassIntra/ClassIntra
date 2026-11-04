// 桌宠交互探针（页面内执行）：
//   node scripts/pet-ui-workbench.mjs --tag=ix --only=home --w=960 --h=680 --touch=1
//     --jsfile=scripts/pet-ui-interaction.probe.js
//
// 为什么必须 --touch=1：桌面 Chrome 是 hover:hover + pointer:fine，
// 触屏那一整条分支（按压、标签、避免 hover 粘住）在这里根本不会触发 ——
// 不模拟触摸，等于永远在「不是目标设备」上验证交互。
(async function () {
  var out = [];
  var pass = 0, fail = 0;
  function ok(name, cond, extra) {
    if (cond) { pass++; out.push('  PASS ' + name + (extra ? '  [' + extra + ']' : '')); }
    else { fail++; out.push('  FAIL ' + name + (extra ? '  [' + extra + ']' : '')); }
  }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var q = function (s) { return document.querySelector(s); };
  function mx(el) {
    if (!el || !el.isConnected) return { x: NaN, y: NaN };
    var t = getComputedStyle(el).transform;
    if (!t || t === 'none') return { x: 0, y: 0 };
    var m = new DOMMatrixReadOnly(t);
    return { x: m.m41, y: m.m42 };
  }
  // 角色中心占房间宽度的百分比 —— 这就是 worldPetX 的地面真值
  function petCenterPct() {
    var p = q('.world-pet'), w = q('.ci-pet-world');
    if (!p || !w) return NaN;
    var pr = p.getBoundingClientRect(), wr = w.getBoundingClientRect();
    return +((((pr.left + pr.right) / 2) - wr.left) / wr.width * 100).toFixed(1);
  }
  function tap(el, type) {
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: 'touch',
      pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0
    }));
  }

  // 等首屏稳定再开始：mount 之后还有 loadStory / loadBattle 两轮回调会 renderHome。
  // 固定 sleep 靠不住（它们谁先回来不确定），改成「同一个节点连续两次采样都没被换掉」。
  async function waitStable() {
    var last = null;
    for (var i = 0; i < 25; i++) {
      var cur = q('.world-obj[data-obj="shelf"]');
      if (cur && cur === last) return true;
      last = cur;
      await sleep(200);
    }
    return false;
  }
  await waitStable();

  // ---- 0. 设备语义：确认这次跑的是「触屏」 ----
  ok('媒体查询 hover:none', matchMedia('(hover: none)').matches);
  ok('媒体查询 pointer:coarse', matchMedia('(pointer: coarse)').matches);

  var shelf = q('.world-obj[data-obj="shelf"]');
  if (!shelf) return '找不到书柜物件，探针中止';
  var nameEl = shelf.querySelector('.world-obj-name');

  // ---- 1. 触屏默认不显示标签（hover 不成立） ----
  ok('默认不显示物件名', getComputedStyle(nameEl).opacity === '0');

  // ---- 2. 按下：下沉 3px + 出名字 ----
  tap(shelf, 'pointerdown');
  await sleep(30);
  // ⚠️ 30ms 太早：CSS transition 要等下一帧才启动，此刻 opacity 还是 0。
  // 采样点定在 130ms（0.12s 过渡的中点之后），看的是「有没有开始出现」。
  var m1 = mx(shelf);
  ok('按下加 .is-press', shelf.classList.contains('is-press'));
  ok('按下位移为整数 3px', m1.y === 3 && m1.x === 0, 'y=' + m1.y);
  var liveN = q('.world-obj[data-obj="shelf"] .world-obj-name');
  ok('按下挂上「显示名字」规则', !!liveN && liveN.matches('.ci-pethome .world-obj.is-press .world-obj-name'));
  await sleep(420);   // 过渡在无头环境里会被拖慢，给足时间看终值
  ok('按下时名字真的可见', parseFloat(getComputedStyle(liveN).opacity) > 0.9,
    'opacity=' + getComputedStyle(liveN).opacity);
  var artFilter = getComputedStyle(shelf.querySelector('.world-obj-art')).filter;
  ok('按下时硬投影收起', artFilter === 'none' || /26, 14, 6, 0\)/.test(artFilter), artFilter);

  // ---- 3. 松手：回弹 + 名字保留 ----
  tap(shelf, 'pointerup');
  await sleep(60);
  ok('松手移除 .is-press', !shelf.classList.contains('is-press'));
  ok('松手触发回弹 .is-bump', shelf.classList.contains('is-bump'));
  await sleep(420);
  var liveName = q('.world-obj[data-obj="shelf"] .world-obj-name');
  ok('松手后名字仍然可见', !!liveName && parseFloat(getComputedStyle(liveName).opacity) > 0.9,
    liveName && getComputedStyle(liveName).opacity);
  await sleep(400);
  ok('回弹动画结束自动清类', !shelf.classList.contains('is-bump'));

  // ---- 4. 点地板：落点 + 角色走过去 ----
  var world = q('.ci-pet-world');
  var r = world.getBoundingClientRect();
  // 取「角色脚下之外」的地板：角色盒子 bottom 7% + 高 205px，0.965 已在它下方
  var curPct = petCenterPct();
  var tapPct = curPct > 50 ? 18 : 82;         // 站右边就往左点，反之亦然
  var px = r.left + r.width * tapPct / 100, py = r.top + r.height * 0.965;
  var hitEl = document.elementFromPoint(px, py);
  out.push('  地板命中元素: ' + (hitEl ? (hitEl.className || hitEl.tagName) : 'null'));
  ok('落点在空地上（不是物件/角色）', !!(hitEl && /world-floor|world-baseboard|world-rug|ci-pet-world/.test(hitEl.className || '')));
  var before = mx(q('.world-pet')).x;
  hitEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: px, clientY: py }));
  await sleep(80);
  var mark = q('.world-tap');
  ok('点地板出现落点标记', !!mark);
  ok('落点位置=点击位置', mark && Math.abs(parseFloat(mark.style.left) - tapPct) < 2, mark && mark.style.left);
  ok('走路时有 is-walk', q('.world-pet').classList.contains('is-walk'));
  await sleep(1000);
  var after = mx(q('.world-pet')).x;
  ok('角色真的走过去', Math.abs(after - before) > 20, Math.round(before) + ' → ' + Math.round(after));

  // ---- 5. 走动中点角色：应当停下并回应（原来直接 return） ----
  var backPct = curPct > 50 ? 88 : 12;        // 反向再点一次，保证有距离可走
  hitEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * backPct / 100, clientY: py }));
  await sleep(120);
  ok('第二次点击进入走动', q('.world-pet').classList.contains('is-walk'));
  q('.world-pet').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(90);
  ok('点角色打断走动', !q('.world-pet').classList.contains('is-walk'));
  ok('点角色触发开心跳', q('.world-pet').classList.contains('is-hop'));
  var stopped = mx(q('.world-pet')).x;
  await sleep(260);
  // 容差 10px：偶尔闲逛会在这 260ms 内起一步，断言的是「没有继续奔向旧目标」
  // （未修复时是 180px 级别的漂移），不是「像素级冻结」。
  ok('停下后不再位移', Math.abs(mx(q('.world-pet')).x - stopped) < 10,
    Math.round(stopped) + ' → ' + Math.round(mx(q('.world-pet')).x));

  // ---- 6. 角色站位 = walkX（这条以前是错的，偏右 24%） ----
  var bed = q('.world-obj[data-obj="bed"]');
  bed.click();                        // walkX 21，最远 1.5s
  await sleep(1900);
  var pc = petCenterPct();
  // walkX 跟着布局走（v0.24.0 把小窝挪到 16.7%，walkX=23）。
  // 从 DOM 的 data-walk 读，别在脚本里写死数字 —— 否则改一次布局就要改一次探针。
  var bedEl = q('.world-obj[data-obj="bed"]');
  var expectX = bedEl ? parseFloat(bedEl.getAttribute('data-walk')) : null;
  ok('走到小窝后站位=walkX', expectX === null || Math.abs(pc - expectX) <= 5,
    'center=' + pc + '%  walkX=' + (expectX === null ? '-' : expectX));

  // ---- 7. 弹层：能开出、能带退场关掉 ----
  var sheet = q('.world-sheet');
  ok('点小窝打开面板', !!sheet);
  if (sheet) {
    var st = getComputedStyle(sheet);
    out.push('  面板入场: ' + st.animationName + ' ' + st.animationDuration + ' ' + st.animationTimingFunction);
    q('.world-sheet-x').click();
    await sleep(45);
    ok('关闭时有退场类', !!q('.world-sheet-wrap.is-closing'));
    ok('关闭瞬间面板还在（有动画）', !!q('.world-sheet'));
    await sleep(240);
    ok('170ms 后真正移除', !q('.world-sheet-wrap'));
  }

  out.unshift('交互探针：' + pass + ' 通过 / ' + fail + ' 失败');
  return out.join('\n');
})();
