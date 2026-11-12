// 开发预览的客户端合并逻辑：预览应用与已装应用共用路由/桌面清单，
// 但独立清理（预览注销不清本地数据、已装应用同步不误卸预览资源）。
// 用 VM 跑真实 market-registry.js 源码，只注入 api / kernel / DOM 桩。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadRegistry({ api, kernel }) {
  const appended = [];
  const sandbox = vm.createContext({
    console, setTimeout, clearTimeout,
    document: {
      createElement: (tag) => ({ tag, dataset: {}, setAttribute() {}, onload: null, onerror: null }),
      head: { appendChild(node) { appended.push(node); } }
    },
    window: {},
    localStorage: (() => {
      const store = {};
      return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        key: (i) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length; }
      };
    })()
  });
  const file = new URL('../src/core/market-registry.js', import.meta.url);
  const source = readFileSync(file, 'utf8')
    .replace(/^import .*;\r?$/gm, '')
    .replace(/registry as marketRegistry/, 'marketRegistry: registry')
    .replace(/export\s*\{([\s\S]*?)\};?\s*$/, 'return {$1};');
  const registry = new vm.Script('(function(api, getRuntimeKernel) {\n' + source + '\n})', { filename: file.pathname })
    .runInContext(sandbox)(api, () => kernel);
  // loadScript 的 promise 靠 <script>.onload 收尾：测试里手动触发，模拟浏览器加载完成
  const flushScripts = () => appended.forEach((el) => { if (el.tag === 'script' && typeof el.onload === 'function') el.onload(); });
  return { ...registry, flushScripts, appended, sandbox };
}

const INSTALLED = {
  name: 'chess', label: '象棋', version: '1.2.0', route: '/chess',
  frontendEntry: './frontend/entry.js', enabled: true
};
const PREVIEW = {
  name: 'preview-app', label: '预览应用', version: '0.1.0', route: '/preview-app',
  frontendEntry: './frontend/entry.js', enabled: true,
  _preview: true, _staticBase: '/market-static-dev/preview-app/', _previewAt: 1000
};

function makeApi() {
  const calls = [];
  return {
    calls,
    get(url) { calls.push(url); return Promise.resolve({ data: { code: 200, data: { apps: [] } } }); }
  };
}

function makeKernel() {
  const events = [];
  return {
    events,
    getMachine: () => null,
    detachLifecycle(name) { events.push('detach:' + name); },
    modules: { remove(kind, name) { events.push('remove:' + kind + ':' + name); } }
  };
}

test('preview apps merge into the shared list without entering the uninstall-purge ledger', async () => {
  const api = makeApi();
  const kernel = makeKernel();
  const { marketRegistry } = loadRegistry({ api, kernel });

  marketRegistry.syncInstalled([INSTALLED]);
  marketRegistry.syncPreviews([PREVIEW]);

  const apps = marketRegistry.getInstalledApps();
  assert.deepEqual(apps.map(a => a.name), ['chess', 'preview-app']);
  assert.equal(marketRegistry.getInstalled('preview-app'), PREVIEW);

  // 卸载识别账本只收已装应用：预览注销走资源卸载，不触发本地数据清除
  marketRegistry.syncPreviews([]);
  assert.deepEqual(kernel.events, [], 'preview unmount must not detach/purge kernel state');
  assert.deepEqual(marketRegistry.getInstalledApps().map(a => a.name), ['chess']);
});

test('installed-list syncs do not unload preview assets while a preview is mounted', async () => {
  const api = makeApi();
  const kernel = makeKernel();
  const { marketRegistry } = loadRegistry({ api, kernel });

  marketRegistry.syncInstalled([INSTALLED]);
  marketRegistry.syncPreviews([PREVIEW]);
  marketRegistry.syncInstalled([INSTALLED]); // 任意一次 /market/installed 刷新
  assert.deepEqual(marketRegistry.getInstalledApps().map(a => a.name), ['chess', 'preview-app'],
    'preview must survive installed-list refreshes');

  // 反向：预览注销后，应用从清单消失且不可再加载（本地数据保留是既定行为：
  // 资源卸载不触发内核 purge —— purge 只属于完整卸载链路）
  marketRegistry.syncPreviews([]);
  assert.equal(marketRegistry.getInstalled('preview-app'), null);
  await assert.rejects(marketRegistry.ensureLoaded('preview-app'), /应用未安装/);
});

test('preview assets reload when the devkit re-mounts (new _previewAt), not on version change', async () => {
  const api = makeApi();
  const kernel = makeKernel();
  const reg = loadRegistry({ api, kernel });
  const { marketRegistry, define, flushScripts, appended } = reg;

  const scriptCount = () => appended.filter(el => el.tag === 'script').length;
  define({ name: 'preview-app', mount() {} });

  const preview = Object.assign({}, PREVIEW);
  marketRegistry.syncPreviews([preview]);
  const first = marketRegistry.ensureLoaded('preview-app');
  flushScripts();
  assert.ok(await first, 'preview app loads like an installed app');
  assert.equal(scriptCount(), 1);

  // devkit 重挂：版本号不变、_previewAt 前进 → 卸载旧资源 + 重新加载脚本
  //（真实时序：ensureLoaded 先卸旧资源，新脚本「执行 → define → onload」——
  //  测试按同一顺序：先补 define 再触发 onload）
  preview._previewAt = 2000;
  marketRegistry.syncPreviews([preview]);
  const second = marketRegistry.ensureLoaded('preview-app');
  define({ name: 'preview-app', mount() {} });
  flushScripts();
  await second;
  assert.equal(scriptCount(), 2, 'a fresh _previewAt must force a script reload');

  // _previewAt 未变 → 不重复加载
  const third = marketRegistry.ensureLoaded('preview-app');
  flushScripts();
  await third;
  assert.equal(scriptCount(), 2);
});

test('refresh() opportunistically fetches the preview list and survives 403', async () => {
  const api = makeApi();
  api.get = (url) => {
    api.calls.push(url);
    if (url === '/market/dev-preview') {
      return Promise.reject(new Error('403'));
    }
    return Promise.resolve({ data: { code: 200, data: { apps: [INSTALLED] } } });
  };
  const kernel = makeKernel();
  const { marketRegistry } = loadRegistry({ api, kernel });

  await marketRegistry.refresh();
  assert.ok(api.calls.includes('/market/dev-preview'), 'refresh must also refresh previews');
  assert.deepEqual(marketRegistry.getInstalledApps().map(a => a.name), ['chess'],
    'a failed preview fetch clears previews and never breaks the installed flow');
});

test('student sessions never issue the doomed dev-preview request', async () => {
  const api = makeApi();
  api.get = (url) => {
    api.calls.push(url);
    return Promise.resolve({ data: { code: 200, data: { apps: [INSTALLED] } } });
  };
  const kernel = makeKernel();
  const reg = loadRegistry({ api, kernel });
  // 学生身份写入 localStorage（与真实客户端一致）：无 is_admin / is_class_admin
  reg.sandbox.localStorage.setItem('user', JSON.stringify({ user_id: '123456', net_name: '同学' }));
  reg.sandbox.localStorage.setItem('token', 'tok');

  await reg.marketRegistry.refresh();
  assert.ok(!api.calls.includes('/market/dev-preview'),
    'student sessions must skip the dev-preview fetch entirely');
  assert.deepEqual(reg.marketRegistry.getInstalledApps().map(a => a.name), ['chess']);
});
