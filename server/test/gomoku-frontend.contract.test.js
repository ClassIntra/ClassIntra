var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');

var entryPath = path.resolve(__dirname, '..', '..', '..', 'market', 'apps', 'gomoku', 'frontend', 'entry.js');
var stylePath = path.resolve(__dirname, '..', '..', '..', 'market', 'apps', 'gomoku', 'frontend', 'style.css');
var entry = fs.readFileSync(entryPath, 'utf8');
var style = fs.readFileSync(stylePath, 'utf8');

test('gomoku 前端应提供房间入口、规格选择和身份显示', function() {
  // 入口按钮由 t(tag, className, attrs, children) 的 DOM 构建器生成（不再走 innerHTML），
  // 故断言对象键写法 'data-action': 'xxx'，而不是 HTML 属性串 data-action="xxx"。
  assert.match(entry, /'data-action': 'create'/);
  assert.match(entry, /'data-action': 'join'/);
  assert.match(entry, /'data-action': 'watch'/);
  assert.match(entry, /'data-size': '15'/);
  assert.match(entry, /roomCode/);
  assert.match(entry, /复制房间码/);
  assert.match(entry, /观战/);
});

test('gomoku 前端应支持动态棋盘和结束后房主操作', function() {
  assert.match(entry, /state\.size/);
  // 「继续下一局」按钮：data-action 声明 + querySelector 取用（原 gomoku_continue 动作名已废弃）
  assert.match(entry, /data-action="continue"/);
  assert.match(entry, /换色/);
  assert.match(entry, /离开房间/);
  // 棋盘列数由 CSS 变量驱动，带默认值兜底 repeat(var(--gomoku-size, 15), ...)
  assert.match(style, /grid-template-columns: repeat\(var\(--gomoku-size/);
});

test('gomoku 前端应将落子坐标通过 HTTP 请求发送，并显示已有实时连接', function() {
  // 落子前先取出行列（人机/本地模式复用同一坐标提取），再统一发 HTTP
  assert.match(entry, /Number\(cell\.dataset\.row\)/);
  assert.match(entry, /Number\(cell\.dataset\.col\)/);
  assert.match(entry, /actionRequest\('\/move', '落子失败', \{ row: row, col: col \}\)/);
  assert.match(entry, /realtime\.isReady\(\)/);
  assert.match(style, /padding: 0/);
});

test('gomoku 前端应使用独立棋子元素和统一中心线绘制', function() {
  assert.match(entry, /gomoku-stone/);
  assert.match(style, /\.gomoku-cell::before/);
  assert.match(style, /\.gomoku-cell::after/);
  assert.match(style, /touch-action: manipulation/);
});
