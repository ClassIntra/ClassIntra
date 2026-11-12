// SDK 兼容矩阵奇偶校验：devkit/COMPAT.md 登记的每个成员必须在真实 context 上可解析。
// 这张表是 context.host.supports() 特性探测的依据——SDK 成员删改或矩阵漏登记都会在这里暴露。
// 新增 SDK 方法时同步在 devkit/COMPAT.md 登记引入宿主版本（见该文件头部约定）。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadMarketSdk } from './helpers/load-market-sdk.mjs';

const MATRIX_PATH = new URL('../../devkit/COMPAT.md', import.meta.url);

// COMPAT.md 单张成员表：行格式 | `path` | 版本 | 说明 |（值成员与方法同表，说明列区分）
function parseMatrix() {
  const rows = [];
  for (const line of readFileSync(MATRIX_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*(v1|\d+\.\d+\.\d+)\s*\|/);
    if (m) rows.push({ path: m[1], version: m[2] });
  }
  return rows;
}

test('compat matrix registers every member with a valid introduced version', () => {
  const rows = parseMatrix();
  assert.ok(rows.length >= 80, 'matrix should cover the SDK surface, got ' + rows.length);
  const seen = new Set();
  for (const row of rows) {
    assert.ok(!seen.has(row.path), 'duplicate matrix row: ' + row.path);
    seen.add(row.path);
    assert.match(row.version, /^(v1|\d+\.\d+\.\d+)$/, 'bad version for ' + row.path);
  }
  // 关键新成员必须显式登记（探测机制的样板）
  for (const required of ['host.version', 'host.atLeast', 'host.supports', 'data.request']) {
    assert.ok(seen.has(required), 'matrix must register ' + required);
  }
});

test('every matrix member resolves on a real SDK context', () => {
  const { createContext } = loadMarketSdk();
  const envelope = { data: { code: 200, data: {} } };
  const context = createContext('compat-demo', {
    api: { request: async () => envelope, get: async () => envelope },
    websocket: { on() {}, off() {}, emit() {}, send() {} },
    realtime: { join() {}, leave() {}, publish() {}, subscribe() { return function() {}; } },
    router: { push() {}, currentRoute: { path: '/' } },
    store: { state: {}, commit() {}, dispatch: async () => {} },
    eventBus: { on() {}, off() {}, once() {}, emit() {} },
    modal: { alert() {}, confirm() {}, prompt() {} },
    manifest: { name: 'compat-demo', version: '0.0.0' }
  });
  assert.ok(context && context.ui && context.host, 'createContext should build a full context');

  const problems = [];
  for (const row of parseMatrix()) {
    let cur = context;
    for (const part of row.path.split('.')) {
      if (!cur || typeof cur !== 'object' || !(part in Object(cur))) {
        problems.push(row.path + ' (missing at "' + part + '")');
        break;
      }
      cur = cur[part];
    }
  }
  assert.deepEqual(problems, [], 'matrix members must all resolve on the real context');
});

test('context.host works: version, atLeast, supports', () => {
  const { createContext, setHostVersion } = loadMarketSdk();
  setHostVersion('1.7.0');
  const context = createContext('host-demo', { api: { get: async () => ({ data: { code: 200, data: {} } }) } });
  assert.equal(context.host.version, '1.7.0');
  assert.equal(context.host.atLeast('1.6.0'), true);
  assert.equal(context.host.atLeast('1.8.0'), false);
  assert.equal(context.host.supports('data.request'), true);
  assert.equal(context.host.supports('data.noSuchMethod'), false);
  assert.equal(context.host.supports('ui.hostNavbar.setTitle'), true);

  // 未知宿主版本（fresh 实例，从未登记）：宁可报不满足，也不要假装满足
  const fresh = loadMarketSdk();
  const freshContext = fresh.createContext('host-demo', { api: {} });
  assert.equal(freshContext.host.version, '');
  assert.equal(freshContext.host.atLeast('1.0.0'), false);
});
