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
