var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');

var entryPath = path.resolve(__dirname, '..', '..', '..', 'market', 'apps', 'gomoku', 'frontend', 'entry.js');
var stylePath = path.resolve(__dirname, '..', '..', '..', 'market', 'apps', 'gomoku', 'frontend', 'style.css');
var entry = fs.readFileSync(entryPath, 'utf8');
var style = fs.readFileSync(stylePath, 'utf8');

test('gomoku 前端应提供房间入口、规格选择和身份显示', function() {
  assert.match(entry, /data-action="create"/);
  assert.match(entry, /data-action="join"/);
  assert.match(entry, /data-action="watch"/);
  assert.match(entry, /data-size/);
  assert.match(entry, /roomCode/);
  assert.match(entry, /复制房间码/);
  assert.match(entry, /观战/);
});

test('gomoku 前端应支持动态棋盘和结束后房主操作', function() {
  assert.match(entry, /state\.size/);
  assert.match(entry, /gomoku_continue/);
  assert.match(entry, /换色/);
  assert.match(entry, /离开房间/);
  assert.match(style, /grid-template-columns: repeat\(var\(--gomoku-size\)/);
});

test('gomoku 前端应将落子坐标通过 HTTP 请求发送，并显示已有实时连接', function() {
  assert.match(entry, /actionRequest\('\/move', '落子失败', \{ row: Number\(cell\.dataset\.row\), col: Number\(cell\.dataset\.col\) \}\)/);
  assert.match(entry, /realtime\.isReady\(\)/);
  assert.match(style, /padding: 0/);
});

test('gomoku 前端应使用独立棋子元素和计算后的网格步长', function() {
  assert.match(entry, /gomoku-stone/);
  assert.match(entry, /gomoku-grid-step/);
  assert.match(style, /gomoku-board::before/);
  assert.match(style, /background-size: var\(--gomoku-grid-step\)/);
});
