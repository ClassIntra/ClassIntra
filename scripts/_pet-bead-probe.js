/**
 * 拼豆工作台体检探针（基线 / 回归通用）
 * 小窝 → 换个样子 → 去画一只 → 量画板尺寸 → 拖一笔测耗时 → 检查新功能入口
 * 结果挂 window.__beadProbe，工作台会打印。
 */
(function () {
  var R = { steps: [], pass: 0, fail: 0, done: false };
  window.__beadProbe = R;
  function ok(cond, label, extra) {
    if (cond) { R.pass++; R.steps.push('  PASS ' + label + (extra ? '  ' + extra : '')); }
    else { R.fail++; R.steps.push('  FAIL ' + label + (extra ? '  ' + extra : '')); }
  }
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function click(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }
  function btnByText(re) {
    return qa('button').filter(function (b) { return re.test(b.textContent || ''); })[0] || null;
  }

  function metrics(tag) {
    var cv = q('.ci-pet-editcanvas');
    var wrap = q('.ci-pet-canvaswrap');
    var tools = q('.ci-pet-tools');
    var root = q('.ci-pethome');
    if (!cv || !root) return { err: 'no-editor' };
    var r = cv.getBoundingClientRect();
    var wr = wrap ? wrap.getBoundingClientRect() : null;
    var tr = tools ? tools.getBoundingClientRect() : null;
    return {
      tag: tag,
      vw: window.innerWidth, vh: window.innerHeight,
      canvas: Math.round(r.width) + 'x' + Math.round(r.height),
      canvasTop: Math.round(r.top),
      wrap: wr ? Math.round(wr.width) : null,
      tools: tr ? (Math.round(tr.width) + 'x' + Math.round(tr.height) + '@' + Math.round(tr.left)) : null,
      twoColumn: !!(wr && tr && Math.abs(wr.top - tr.top) < 40 && tr.left > wr.right - 4),
      rootW: root.clientWidth, rootScrollW: root.scrollWidth,
      overflow: root.scrollWidth > root.clientWidth + 1,
      boxes: (function () {
        var out = {};
        var pick = { root: root, head: '.ci-pet-edhead', kbd: '.ci-pet-kbdhint', bar: '.ci-pet-boardbar', wrap: '.ci-pet-canvaswrap', stage: '.ci-pet-boardstage', cap: '.ci-pet-boardcap' };
        Object.keys(pick).forEach(function (k) {
          var el = typeof pick[k] === 'string' ? q(pick[k]) : pick[k];
          if (!el) { out[k] = null; return; }
          var rr = el.getBoundingClientRect();
          out[k] = Math.round(rr.top) + '+' + Math.round(rr.height) + ' (y' + Math.round(rr.top) + '~' + Math.round(rr.bottom) + ')';
        });
        return out;
      })()
    };
  }

  function waitFor(fn, timeout, then) {
    var t0 = Date.now();
    (function poll() {
      var v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return then(v);
      if (Date.now() - t0 > timeout) return then(null);
      setTimeout(poll, 120);
    })();
  }

  waitFor(function () { return q('.world-obj[data-obj="bed"]'); }, 8000, function (bed) {
    ok(!!bed, '宠物屋里有小窝');
    click(bed);
    waitFor(function () { return btnByText(/换个样子/); }, 5000, function (look) {
      ok(!!look, '小窝里有「换个样子」');
      if (look) click(look);
      waitFor(function () { return btnByText(/去画一只|再改改|换回来/); }, 5000, function (entry) {
        R.steps.push('  · 形象抽屉按钮=' + qa('.ci-pet-stylecard button').map(function (b) { return b.textContent; }).join('|'));
        ok(!!entry, '形象抽屉有拼豆入口');
        if (entry) click(entry);
        waitFor(function () { return q('.ci-pet-editcanvas'); }, 6000, function (cv) {
          ok(!!cv, '进入拼豆工作台');
          if (!cv) { R.done = true; return; }
          setTimeout(function () { pixelTest(runChecks); }, 700);
        });
      });
    });
  });

  // ---- 像素级：落豆/擦除必须真的改到画布 ----
  function pixelTest(done) {
    var cv = q('.ci-pet-editcanvas');
    var g = cv.getContext('2d');
    var r = cv.getBoundingClientRect();
    var scale = cv.width / r.width;
    var cell = r.width / 16;
    // ⚠️ 不能取格子正中：拼豆中心是「豆孔」，露的是底板米色（上一版探针就栽在这，
    //    把「已经画上」误判成「没画」）。取豆身右侧 30% 处。
    function read(col, row) {
      var d = g.getImageData(
        Math.round((col + 0.80) * cell * scale),
        Math.round((row + 0.50) * cell * scale), 1, 1).data;
      return d[0] + ',' + d[1] + ',' + d[2];
    }
    function isRed(rgb) {
      var p = rgb.split(',').map(Number);
      return p[0] > 180 && p[1] < 130;
    }
    function fire(t, x, y) {
      cv.dispatchEvent(new PointerEvent(t, {
        bubbles: true, cancelable: true, pointerId: 21, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY: y, buttons: t === 'pointerup' ? 0 : 1
      }));
    }
    // A5 = #FF3B30，和米色底板对比强烈
    var red = qa('.ci-pet-swatchbox')[4];
    if (red) red.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    var x = r.left + 3 * cell + cell / 2;
    var y = r.top + 5 * cell + cell / 2;
    fire('pointerdown', x, y);
    fire('pointerup', x, y);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var c0 = read(3, 5);
        ok(isRed(c0), '像素级：点一下，画布真的出现豆子', 'rgb=' + c0);
        var c1 = read(10, 2);
        ok(!isRed(c1), '像素级：没点的格子没被误画', 'rgb=' + c1);

        // 橡皮：同一格擦掉后必须回到米色底板
        var er = btnByText(/^橡皮$/);
        if (er) er.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        fire('pointerdown', x, y);
        fire('pointerup', x, y);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            var c2 = read(3, 5);
            ok(!isRed(c2), '像素级：橡皮擦掉后画布复原', 'rgb=' + c2);
            var pen = btnByText(/^画笔$/);
            if (pen) pen.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            done();
          });
        });
      });
    });
  }

  function runChecks() {
    var m = metrics('base');
    R.metrics = m;
    ok(!m.overflow, '不横向溢出', 'rootW=' + m.rootW + ' scrollW=' + m.rootScrollW);
    var cw = parseInt(String(m.canvas).split('x')[0], 10);
    var expect = Math.min(520, Math.max(320, m.vw - 400));
    ok(cw >= expect, '画板吃满可用宽度', 'canvas=' + m.canvas + ' vw=' + m.vw + ' 期望>=' + expect);
    R.steps.push('  · 布局 twoColumn=' + m.twoColumn + ' canvasTop=' + m.canvasTop + ' tools=' + m.tools);
    R.steps.push('  · 量：innerH=' + window.innerHeight + ' wrapCW=' + (q('.ci-pet-canvaswrap') || {}).clientWidth + ' wrapTop=' + Math.round((q('.ci-pet-canvaswrap') || { getBoundingClientRect: function () { return {}; } }).getBoundingClientRect().top) + ' cell=' + (parseInt(String(m.canvas).split('x')[0], 10) / 16));
    if (m.boxes) { Object.keys(m.boxes).forEach(function (k) { R.steps.push('    · ' + k + ' = ' + m.boxes[k]); }); }

    var cv = q('.ci-pet-editcanvas');
    var r = cv.getBoundingClientRect();
    var n = 16;
    var cell = r.width / n;
    function pt(i) { return { x: r.left + i * cell + cell / 2, y: r.top + i * cell + cell / 2 }; }
    function fire(type, p) {
      cv.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true,
        clientX: p.x, clientY: p.y, buttons: type === 'pointerup' ? 0 : 1
      }));
    }
    var t0 = performance.now();
    fire('pointerdown', pt(0));
    for (var i = 1; i < 12; i++) fire('pointermove', pt(i));
    fire('pointerup', pt(11));
    var t1 = performance.now();
    R.strokeMs = Math.round(t1 - t0);
    R.steps.push('  · 12 格拖拽耗时 ' + R.strokeMs + 'ms');
    ok(R.strokeMs < 200, '拖拽一笔跟手（<200ms）', R.strokeMs + 'ms');

    setTimeout(function () {
      // 拖拽连续性：对角线上的每一格都该真的画上（不是只有按下/抬起两点）
      (function () {
        var g2 = cv.getContext('2d');
        var sc = cv.width / r.width;
        var cc = cv.width / n;
        function readAt(col, row) {
          var d = g2.getImageData(Math.round((col + 0.8) * cc), Math.round((row + 0.5) * cc), 1, 1).data;
          return d[0] > 180 && d[1] < 130;
        }
        var hits = [readAt(0, 0), readAt(3, 3), readAt(6, 6), readAt(11, 11)];
        ok(hits.every(Boolean), '拖拽连线：中间格也画上了', JSON.stringify(hits));
        ok(!readAt(0, 6), '拖拽连线：线外的格子没被误画');
      })();

      var line = q('.ci-pet-statline');
      ok(!!line && /共\s*\d+\s*颗豆/.test(line.textContent || ''), '备料统计已更新', line ? line.textContent : 'missing');
      var labels = qa('.ci-pet-btn, .ci-pet-minibtn, .ci-pet-movebtn').map(function (b) { return b.textContent.trim(); });
      R.buttons = labels.join(' | ');
      ok(labels.some(function (t) { return t.indexOf('铺满') >= 0; }), '有「铺满」');
      ok(labels.some(function (t) { return t.indexOf('翻转') >= 0; }), '有「翻转」');
      ok(labels.some(function (t) { return t.indexOf('云盘') >= 0; }), '有「☁ 云盘」');
      ok(!!q('.ci-pet-editfx'), '预览层存在（直线/矩形/涟漪走独立层）');
      var undo = btnByText(/^撤销$/);
      ok(!!undo && !undo.disabled, '撤销可用');
      ok(!q('.ci-pet-emptyhint.is-on'), '落豆后空板引导消失');
      ok(!!q('.ci-pet-curdot'), '当前色块在位');


      // ---- 32×32 大画板：尺寸 + 一整帧绘制耗时 ----
      var seg = qa('.ci-pet-seg-btn').filter(function (b) { return b.textContent === '32×32'; })[0];
      ok(!!seg, '有 32×32 档位');
      if (seg) seg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      setTimeout(function () {
        var m2 = metrics('32');
        R.metrics32 = m2;
        var w2 = parseInt(String(m2.canvas).split('x')[0], 10);
        ok(w2 >= 480, '32×32 画板也不缩成邮票', 'canvas=' + m2.canvas);
        ok(!m2.overflow, '32×32 仍不横向溢出', 'rootW=' + m2.rootW + ' scrollW=' + m2.rootScrollW);
        // 一整帧（含 rAF 绘制）耗时
        var cv2 = q('.ci-pet-editcanvas');
        var r2 = cv2.getBoundingClientRect();
        var cs = r2.width / 32;
        function p2(i) { return { x: r2.left + (i % 32) * cs + cs / 2, y: r2.top + i * cs + cs / 2 }; }
        var t0 = performance.now();
        cv2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: p2(0).x, clientY: p2(0).y, buttons: 1 }));
        for (var i = 1; i < 24; i++) {
          cv2.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: p2(i).x, clientY: p2(i).y, buttons: 1 }));
        }
        cv2.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: p2(23).x, clientY: p2(23).y, buttons: 0 }));
        var t1 = performance.now();
        requestAnimationFrame(function () {
          var t2 = performance.now();
          R.frameMs = Math.round(t2 - t1);
          R.stroke32Ms = Math.round(t1 - t0);
          R.steps.push('  · 32×32：输入 ' + R.stroke32Ms + 'ms + 一帧绘制 ' + R.frameMs + 'ms');
          ok(R.frameMs < 40, '32×32 一帧绘制 <40ms', R.frameMs + 'ms');

          // ---- 导出到云盘：必须真的把 PNG 塞进 FormData 传给 /cloud/upload ----
          var exp = btnByText(/云盘/);
          ok(!!exp, '有「☁ 云盘」按钮');
          if (exp) {
            exp.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            setTimeout(function () {
              var up = window.__cloudUp;
              R.cloudUp = up;
              ok(!!up && up.isFormData, '云盘接口收到 FormData');
              ok(!!up && /\.png$/i.test(String(up.name)), '文件名是 .png', up ? up.name : 'null');
              ok(!!up && up.size > 1000, 'PNG 有实际内容', up ? (up.size + ' bytes') : 'null');
              // 翻转 / 平移 / 换色 / 铺满 / 最近色
              var flip = btnByText(/翻转/);
              ok(!!flip, '有翻转按钮');
              var before = q('.ci-pet-statline').textContent;
              var fill = btnByText(/^铺满$/);
              if (fill) fill.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              setTimeout(function () {
                var after = q('.ci-pet-statline').textContent;
                ok(before !== after, '铺满改变了备料统计', before + ' → ' + after);
                // 点一个调色盘色块后，最近用色才应该出现
                var box = qa('.ci-pet-swatchbox')[6];
                if (box) box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                setTimeout(function () {
                  var recent = qa('.ci-pet-recent-dot');
                  ok(recent.length > 0, '最近用色出现', recent.length + ' 个');

                  // ---- 导入图片转拼豆：清空 → 导入纯红 4×4 → 整板应变红 ----
                  var clr = btnByText(/^清空$/);
                  if (clr) clr.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                  setTimeout(function () {
                    var emptyLine = q('.ci-pet-statline').textContent;
                    ok(/还没有落豆/.test(emptyLine), '清空后备料归零', emptyLine);
                    var src = document.createElement('canvas');
                    src.width = src.height = 4;
                    var sg = src.getContext('2d');
                    sg.fillStyle = '#FF3B30';
                    sg.fillRect(0, 0, 4, 4);
                    var handle = window.__ciBeadImport ? window.__ciBeadImport(src.toDataURL(), { dropBg: false, maxColors: 16 }) : null;
                    ok(!!handle, '导入入口可用（探针钩子）');
                    var tries = 0;
                    (function waitImport() {
                      tries++;
                      if (handle && handle.done()) {
                        ok(handle.ok(), '图片转换成功', String(window.__ciBeadImportErr || ''));
                        var impLine = q('.ci-pet-statline').textContent;
                        ok(/1024\s*颗/.test(impLine), '导入后整板铺满（32×32=1024）', impLine);
                        var cv3 = q('.ci-pet-editcanvas');
                        var g3 = cv3.getContext('2d');
                        var c3 = cv3.width / 32;
                        var d3 = g3.getImageData(Math.round(2.8 * c3), Math.round(2.5 * c3), 1, 1).data;
                        ok(d3[0] > 180 && d3[1] < 130, '导入后的豆子真的画在画布上',
                          'rgb=' + d3[0] + ',' + d3[1] + ',' + d3[2]);

                        // ---- 云盘选择器 ----
                        // 先清空：否则上一轮导入的 1024 颗会让「转成整板」立刻假通过
                        var clr2 = btnByText(/^清空$/);
                        if (clr2) clr2.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        var impBtn = btnByText(/导入图片/);
                        ok(!!impBtn, '有「导入图片」按钮');
                        if (impBtn) impBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        setTimeout(function () {
                          var modal = q('.ci-pet-cloudpick');
                          ok(!!modal, '打开云盘选择器');
                          var tiles = qa('.ci-pet-cloudtile');
                          ok(tiles.length === 2, '只列出图片（视频被过滤）', tiles.length + ' 张');
                          var loaded = qa('.ci-pet-cloudtile img').filter(function (im) {
                            return /^blob:/.test(im.src || '');
                          });
                          ok(loaded.length > 0, '缩略图已按 blob 加载', loaded.length + ' 张');
                          if (tiles[0]) tiles[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                          // 新版是「选中 → 预览调参 → 用它」两步
                          var tries2 = 0;
                          (function waitPreview() {
                            tries2++;
                            if (q('.ci-pet-pickpair') || tries2 > 40) {
                              ok(!!q('.ci-pet-pickpair'), '选中后进入预览');
                              ok(!!q('.ci-pet-pickcv') && q('.ci-pet-pickcv').width > 8, '预览画布已渲染',
                                q('.ci-pet-pickcv') ? q('.ci-pet-pickcv').width + 'px' : 'missing');
                              var optLabels = qa('.ci-pet-pickview .ci-pet-opts-label').map(function (x) { return x.textContent; });
                              ok(optLabels.length >= 5, '调参项齐全（尺寸/色号/增强/抖动/背景）', optLabels.join('/'));
                              var useBtn = btnByText(/用它/);
                              ok(!!useBtn, '有「用它」按钮', useBtn ? useBtn.textContent : '');
                              // 等转换完成（按钮可用 + 文案带尺寸）
                              var tw = 0;
                              (function waitConvert() {
                                tw++;
                                if ((useBtn && !useBtn.disabled && /×/.test(useBtn.textContent || '')) || tw > 40) {
                                  var pv = q('.ci-pet-pickview');
                                  var pvShown = qa('.ci-pet-pickview').filter(function (v) { return v.style.display !== 'none'; });
                                  ok(useBtn && !useBtn.disabled, '转换完成前「用它」不可点、完成后可点',
                                    (useBtn ? useBtn.textContent + '/' + useBtn.disabled : '') +
                                    ' 可见视图=' + pvShown.length + ' err=' + String(window.__ciPickErr || '').slice(0, 120));
                                  if (useBtn) useBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                  setTimeout(function () {
                                    var line2 = q('.ci-pet-statline') ? q('.ci-pet-statline').textContent : '';
                                    ok(/\d+\s*颗/.test(line2), '应用后整板落豆', line2);
                                    ok(!q('.ci-pet-cloudpick'), '应用后关闭选择器');
                                    afterImport();
                                  }, 600);
                                  return;
                                }
                                setTimeout(waitConvert, 100);
                              })();
                              return;
                            }
                            setTimeout(waitPreview, 100);
                          })();
                        }, 700);

                        function afterImport() {
                          // ---- 48 / 64 档 ----
                          var s48 = qa('.ci-pet-seg-btn').filter(function (b) { return b.textContent === '48×48'; })[0];
                          ok(!!s48, '有 48×48 档');
                          if (s48) s48.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                          setTimeout(function () {
                            var m48 = metrics('48');
                            ok(!m48.overflow, '48×48 不横向溢出', 'canvas=' + m48.canvas);
                            var s64 = qa('.ci-pet-seg-btn').filter(function (b) { return b.textContent === '64×64'; })[0];
                            ok(!!s64, '有 64×64 档');
                            if (s64) s64.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                            setTimeout(function () {
                              var m64 = metrics('64');
                              ok(!m64.overflow, '64×64 不横向溢出', 'canvas=' + m64.canvas);
                              var cv64 = q('.ci-pet-editcanvas');
                              var w64 = Math.round(cv64.getBoundingClientRect().width);
                              // ---- 缩放 ----
                              var zin = qa('.ci-pet-zoombtn').filter(function (b) { return b.textContent === '+'; })[0];
                              ok(!!zin, '有放大按钮');
                              if (zin) zin.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                              setTimeout(function () {
                                var lbl = q('.ci-pet-zoomlabel');
                                ok(lbl && lbl.textContent === '150%', '放大到 150%', lbl ? lbl.textContent : 'missing');
                                var view = q('.ci-pet-boardview');
                                var wZoom = Math.round(q('.ci-pet-editcanvas').getBoundingClientRect().width);
                                ok(wZoom > w64 + 20, '画板真的变大（可滚动查看）', w64 + ' → ' + wZoom);
                                ok(view && view.scrollWidth > view.clientWidth + 4, '视口可横向滚动',
                                  view ? (view.scrollWidth + '/' + view.clientWidth) : 'no-view');
                                // ---- 抓手 ----
                                var panBtn = btnByText(/^抓手$/);
                                ok(!!panBtn, '有「抓手」工具');
                                if (panBtn) panBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                if (view) {
                                  var before = view.scrollLeft;
                                  view.scrollLeft = 40;
                                  ok(view.scrollLeft >= 40, '抓手模式下可横向平移', 'scrollLeft=' + view.scrollLeft);
                                  view.scrollLeft = before;
                                }
                                // ---- 转换算法：白底 + 四色块 ----
                                var c64 = document.createElement('canvas');
                                c64.width = c64.height = 64;
                                var g64 = c64.getContext('2d');
                                g64.fillStyle = '#FFFFFF';
                                g64.fillRect(0, 0, 64, 64);
                                var quads = ['#E8B48A', '#87CEEB', '#4C9A2A', '#FF3B30'];
                                var qpos = [[16, 16], [48, 16], [16, 48], [48, 48]];
                                for (var qi = 0; qi < 4; qi++) {
                                  g64.fillStyle = quads[qi];
                                  g64.fillRect(qpos[qi][0] - 10, qpos[qi][1] - 10, 20, 20);
                                }
                                var s16 = qa('.ci-pet-seg-btn').filter(function (b) { return b.textContent === '16×16'; })[0];
                                if (s16) s16.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                setTimeout(function () {
                                  var hh = window.__ciBeadImport(c64.toDataURL(), { dropBg: true, maxColors: 16 });
                                  var t0 = Date.now();
                                  (function waitQuad() {
                                    if ((hh && hh.done()) || Date.now() - t0 > 3000) {
                                      var d = window.__ciBeadState().data, nn = 16;
                                      var corners = [d[0], d[nn - 1], d[nn * (nn - 1)], d[nn * nn - 1]];
                                      ok(corners.every(function (ch) { return ch === '.'; }), '白底自动留空', corners.join(''));
                                      var centers = [d[4 * nn + 4], d[4 * nn + 11], d[11 * nn + 4], d[11 * nn + 11]];
                                      ok(centers.every(function (ch) { return ch !== '.'; }), '四色块都转成了豆子', centers.join(''));
                                      ok(new Set(centers).size >= 3, '四色块映射到不同色号', centers.join(''));
                                      // ---- 笔尖粗细 / 网格开关 ----
                                      var clr3 = btnByText(/^清空$/);
                                      if (clr3) clr3.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                      var b3 = qa('.ci-pet-brushrow .ci-pet-chip').filter(function (x) { return x.textContent === '3×3'; })[0];
                                      ok(!!b3, '有「笔尖 3×3」');
                                      if (b3) b3.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                      var cvq = q('.ci-pet-editcanvas');
                                      var rq = cvq.getBoundingClientRect();
                                      var cq = rq.width / 16;
                                      var px0 = rq.left + 5 * cq + cq / 2, py0 = rq.top + 5 * cq + cq / 2;
                                      cvq.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 31, pointerType: 'touch', clientX: px0, clientY: py0, buttons: 1 }));
                                      cvq.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 31, pointerType: 'touch', clientX: px0, clientY: py0, buttons: 0 }));
                                      setTimeout(function () {
                                        var n3 = (window.__ciBeadState().data.match(/[^.]/g) || []).length;
                                        ok(n3 === 9, '3×3 笔尖一次落 9 颗', n3 + ' 颗');
                                        var gbtn = qa('.ci-pet-chip').filter(function (x) { return x.textContent === '网格'; })[0];
                                        ok(!!gbtn, '有「网格」开关');
                                        var on0 = !!(gbtn && gbtn.classList.contains('is-on'));
                                        if (gbtn) gbtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                        setTimeout(function () {
                                          var on1 = !!(gbtn && gbtn.classList.contains('is-on'));
                                          ok(on0 !== on1, '网格开关可切换', on0 + ' → ' + on1);
                                          if (gbtn) gbtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                          // ---- 最后：编辑器守卫 + 正常退出 ----
                                          try { window.__ciPetGo('home'); } catch (e) {}
                                          setTimeout(function () {
                                            ok(!!q('.ci-pet-editor') && !!q('.ci-pet-editcanvas'), '后台切页不会踢出编辑器');
                                            var back = btnByText(/先不换了/);
                                            if (back) back.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                                            setTimeout(function () {
                                              ok(!q('.ci-pet-editor') && !!q('.world-obj[data-obj="bed"]'), '「先不换了」正常回宠物屋');
                                              document.body.setAttribute('data-shot', 'after-exit');
                                              R.done = true;
                                            }, 700);
                                          }, 300);
                                        }, 400);
                                      }, 450);
                                      return;
                                    }
                                    setTimeout(waitQuad, 100);
                                  })();
                                }, 400);
                              }, 400);
                            }, 400);
                          }, 400);
                        }
                        return;
                      }
                      if (tries > 40) { ok(false, '图片转换超时'); R.done = true; return; }
                      setTimeout(waitImport, 100);
                    })();
                  }, 400);
                }, 260);
              }, 350);
            }, 700);
          } else {
            R.done = true;
          }
        });
      }, 400);
    }, 500);
  }
})();
