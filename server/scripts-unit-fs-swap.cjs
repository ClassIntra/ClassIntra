// 单测：目录原子替换（core/fs-swap.js）
// 覆盖「首装 / 更新成功 / 更新失败回滚 / 残留备份」四类场景。
// 运行：node server/scripts-unit-fs-swap.cjs
//
// 为什么值得单独测：市场更新最危险的回归是「旧版本被提前删掉」，
// 这种 bug 在 UI 上只表现为「应用不见了」，极难在人工点击中稳定复现。

var fs = require('fs');
var os = require('os');
var path = require('path');
var beginSwap = require('./src/core/fs-swap').beginSwap;

var passed = 0;
var failed = 0;

function ok(name) {
  passed++;
  console.log('  PASS ' + name);
}

function bad(name, detail) {
  failed++;
  console.error('  FAIL ' + name + (detail ? ' — ' + detail : ''));
}

function assert(name, cond, detail) {
  if (cond) ok(name);
  else bad(name, detail);
}

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

function mkTmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ci-swap-' + label + '-'));
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function listBak(dir) {
  try {
    return fs.readdirSync(dir).filter(function (n) { return n.indexOf('.bak-') === 0; });
  } catch (e) {
    return [];
  }
}

console.log('\n目录原子替换单测');
console.log('='.repeat(48));

// ---------- 1. 首装：没有旧目录 ----------
(function () {
  var root = mkTmp('first');
  var finalDir = path.join(root, 'my-app');
  var tmpDir = path.join(root, '.tmp-my-app-1');
  writeFile(path.join(tmpDir, 'manifest.json'), '{"version":"1.0.0"}');

  var swap = beginSwap(tmpDir, finalDir, 'my-app');
  assert('首装：新目录就位', read(path.join(finalDir, 'manifest.json')) === '{"version":"1.0.0"}');
  assert('首装：没有备份目录', swap.backupDir === '' && listBak(root).length === 0);
  assert('首装：commit 返回 false（无备份可删）', swap.commit() === false);
  assert('首装：rollback 返回 false（无备份可回）', swap.rollback() === false);
  fs.rmSync(root, { recursive: true, force: true });
})();

// ---------- 2. 更新成功：旧目录变备份，commit 后清理 ----------
(function () {
  var root = mkTmp('update-ok');
  var finalDir = path.join(root, 'my-app');
  writeFile(path.join(finalDir, 'old.txt'), 'v1');
  var tmpDir = path.join(root, '.tmp-my-app-2');
  writeFile(path.join(tmpDir, 'new.txt'), 'v2');

  var swap = beginSwap(tmpDir, finalDir, 'my-app');
  assert('更新：新版本就位', read(path.join(finalDir, 'new.txt')) === 'v2');
  assert('更新：旧文件不再出现在最终目录', read(path.join(finalDir, 'old.txt')) === null);
  assert('更新：备份目录存在且保留旧文件',
    !!swap.backupDir && read(path.join(swap.backupDir, 'old.txt')) === 'v1');

  swap.commit();
  assert('更新：commit 后备份消失', !fs.existsSync(swap.backupDir) && listBak(root).length === 0);
  assert('更新：commit 幂等（第二次 false）', swap.commit() === false);
  fs.rmSync(root, { recursive: true, force: true });
})();

// ---------- 3. 更新失败：rollback 恢复旧版本 ----------
(function () {
  var root = mkTmp('rollback');
  var finalDir = path.join(root, 'my-app');
  writeFile(path.join(finalDir, 'old.txt'), 'v1');
  writeFile(path.join(finalDir, 'data.txt'), 'user-data');
  var tmpDir = path.join(root, '.tmp-my-app-3');
  writeFile(path.join(tmpDir, 'broken.txt'), 'v2-broken');

  var swap = beginSwap(tmpDir, finalDir, 'my-app');
  // 模拟「新版本初始化失败」
  var rolled = swap.rollback();
  assert('回滚：rollback 返回 true', rolled === true);
  assert('回滚：旧文件恢复', read(path.join(finalDir, 'old.txt')) === 'v1');
  assert('回滚：旧数据仍在', read(path.join(finalDir, 'data.txt')) === 'user-data');
  assert('回滚：坏版本文件不在', read(path.join(finalDir, 'broken.txt')) === null);
  assert('回滚：不留备份垃圾', listBak(root).length === 0);
  assert('回滚：rollback 后 commit 不误删', swap.commit() === false && read(path.join(finalDir, 'old.txt')) === 'v1');
  fs.rmSync(root, { recursive: true, force: true });
})();

// ---------- 4. 连续两次更新：不累积备份 ----------
(function () {
  var root = mkTmp('twice');
  var finalDir = path.join(root, 'my-app');
  writeFile(path.join(finalDir, 'v.txt'), 'v1');

  var t1 = path.join(root, '.tmp-a');
  writeFile(path.join(t1, 'v.txt'), 'v2');
  beginSwap(t1, finalDir, 'my-app').commit();

  var t2 = path.join(root, '.tmp-b');
  writeFile(path.join(t2, 'v.txt'), 'v3');
  beginSwap(t2, finalDir, 'my-app').commit();

  assert('连续更新：最终为新版本', read(path.join(finalDir, 'v.txt')) === 'v3');
  assert('连续更新：没有残留 .bak 目录', listBak(root).length === 0);
  fs.rmSync(root, { recursive: true, force: true });
})();

console.log('='.repeat(48));
console.log('结果：通过 ' + passed + '，失败 ' + failed);
process.exitCode = failed ? 1 : 0;
