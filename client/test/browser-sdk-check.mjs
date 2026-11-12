// Emit a self-contained browser smoke test for `agent-browser eval --stdin`.
// Uses real DOM and generated app code, with no host account or backend needed.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create } from '../../devkit/lib/create.mjs';

const ui = readFileSync(new URL('../src/core/market-sdk-ui.js', import.meta.url), 'utf8')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '');
const moduleSource = relative => readFileSync(new URL('../src/core/' + relative, import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace(/export\s*\{[\s\S]*?\};?\s*$/, '');
const sdk = moduleSource('market-sdk-request.js') + '\n' + moduleSource('token-injector.js') + '\nvar navbarStore = (function(){\n' + moduleSource('app-navbar-store.js') +
  '\nreturn {setTitle,setStatus,setActions,clear};})();\n' + moduleSource('market-sdk.js');
const root = mkdtempSync(path.join(os.tmpdir(), 'classintra-browser-sdk-'));
let entry;
const guide = readFileSync(new URL('../../devkit/SDK.md', import.meta.url), 'utf8');
const documentedEntry = guide.match(/```js\s*\n([\s\S]*?)```/)[1];
try {
  const app = create('app', 'browser-demo', { dir: root });
  entry = readFileSync(path.join(app.dir, 'frontend', 'entry.js'), 'utf8');
} finally { rmSync(root, { recursive: true, force: true }); }

const suite = async function() {
  const results = [];
  async function check(name, run) {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  }
  function assert(condition, message) { if (!condition) throw new Error(message); }
  await check('all UI factories return mountable fragments', () => {
    for (const name of ['button', 'card', 'list', 'badge', 'segmented', 'toggle', 'searchBar', 'emptyState', 'spinner', 'toast', 'sectionTitle', 'toolbar', 'navbar']) {
      const fragment = ui[name]();
      assert(fragment.root instanceof HTMLElement, name + ' root is not DOM');
      document.body.appendChild(fragment.root);
      fragment.destroy();
      assert(!fragment.root.isConnected, name + ' remains mounted');
    }
  });
  await check('searchBar destroy removes both keyboard and input handlers', () => {
    let searches = 0;
    const fragment = ui.searchBar({ onSearch: () => searches++ });
    const input = fragment.root.querySelector('input');
    document.body.appendChild(fragment.root);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fragment.destroy();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    assert(searches === 1, 'search callback survives destruction');
  });
  await check('generated application gives visible save feedback and disposes listeners', () => {
    const container = document.createElement('main');
    document.body.appendChild(container);
    const cleanups = [];
    const data = {};
    window.__sdkSmokeDefinition.mount(container, {
      ui,
      data: { storage: { get: () => 0, set: (key, value) => { data[key] = value; return true; } } },
      system: { getToken: () => '#0055aa' },
      app: { onDestroy: fn => cleanups.push(fn) }
    });
    const button = container.querySelector('button');
    button.click();
    assert(data.count === 1, 'click did not save');
    assert(container.textContent.includes('已保存：1'), 'save feedback is invisible');
    cleanups.reverse().forEach(fn => fn());
    button.click();
    assert(data.count === 1, 'app event listener leaked');
    container.remove();
  });
  await check('the distributed SDK guide example runs and reports storage failures truthfully', () => {
    const container = document.createElement('main');
    document.body.appendChild(container);
    const cleanups = [];
    let saved = 0;
    let canSave = true;
    window.__sdkGuideDefinition.mount(container, {
      ui,
      data: { storage: { get: () => saved, set: (key, value) => { if (!canSave) return false; saved = value; return true; } } },
      app: { onDestroy: fn => cleanups.push(fn) }
    });
    const button = container.querySelector('button');
    button.click();
    assert(saved === 1 && container.textContent.includes('已保存：1'), 'guide example did not save visibly');
    canSave = false;
    button.click();
    assert(saved === 1 && container.textContent.includes('保存失败'), 'guide example claimed a failed save succeeded');
    cleanups.reverse().forEach(fn => fn());
    assert(!container.querySelector('button'), 'guide example did not clean up DOM');
    container.remove();
  });
  for (const method of ['recordAudio', 'recordVideo']) {
    await check(method + ' closes its UI and releases active tracks on disposal', async () => {
      let stopped = 0;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const stream = canvas.captureStream(1);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { stopped++; stop(); };
      }
      const originalMedia = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
      const OriginalRecorder = window.MediaRecorder;
      function FakeRecorder() { this.state = 'inactive'; }
      FakeRecorder.prototype.start = function() { this.state = 'recording'; };
      FakeRecorder.prototype.stop = function() { this.state = 'inactive'; if (this.onstop) this.onstop(); };
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
      window.MediaRecorder = FakeRecorder;
      const context = createContext('media-demo', { api: { get: async () => ({ data: { code: 200, data: { granted: ['device.camera', 'device.microphone'] } } }) } });
      try {
        const operation = context.device[method]();
        const outcome = operation.then(() => '', error => error.message);
        await new Promise(resolve => setTimeout(resolve, 10));
        context.__internal.dispose();
        assert((await outcome).includes('已销毁'), 'pending operation did not reject on disposal');
        assert(stopped === 1, 'media tracks were not released exactly once');
        assert(!document.body.textContent.includes('取消'), 'media UI remains mounted');
      } finally {
        context.__internal.dispose();
        window.MediaRecorder = OriginalRecorder;
        if (originalMedia) Object.defineProperty(navigator, 'mediaDevices', originalMedia);
        else delete navigator.mediaDevices;
      }
    });
  }
  await check('permission UI closes and rejects its pending call on disposal', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => 'private' } });
    const context = createContext('permission-demo', { api: { get: async () => ({ data: { code: 200, data: { granted: [] } } }) } });
    try {
      const outcome = context.system.clipboard.read().then(() => 'allowed', error => error.message);
      await new Promise(resolve => setTimeout(resolve, 10));
      assert(document.querySelector('[role="dialog"]'), 'permission UI did not appear');
      context.__internal.dispose();
      const result = await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('pending'), 100))]);
      assert(result !== 'pending' && result !== 'allowed', 'permission call still pending after leaving app');
      assert(!document.querySelector('[role="dialog"]'), 'permission UI remains mounted');
    } finally {
      context.__internal.dispose();
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else delete navigator.clipboard;
    }
  });
  await check('file picker closes and resolves an empty selection on context disposal', async () => {
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function() {};
    const context = createContext('file-demo');
    try {
      const operation = context.device.filePicker();
      assert(document.querySelector('input[type="file"]'), 'file input did not mount');
      context.__internal.dispose();
      const files = await Promise.race([operation, new Promise(resolve => setTimeout(() => resolve(null), 100))]);
      assert(Array.isArray(files) && files.length === 0, 'file picker remains pending after leaving app');
      assert(!document.querySelector('input[type="file"]'), 'file input remains mounted');
    } finally {
      context.__internal.dispose();
      HTMLInputElement.prototype.click = originalClick;
    }
  });
  await check('typed requests cancel on disposal in the browser and keep legacy responses intact', async () => {
    let signal;
    const raw = { data: { code: 200, data: 7 } };
    const context = createContext('request-demo', { api: {
      request: config => { signal = config.signal; return new Promise(() => {}); },
      get: async () => raw
    } });
    assert(await context.data.get('/request-demo/item') === raw, 'legacy response changed');
    const outcome = context.data.request({ url: '/request-demo/item' }).then(() => 'success', error => error.code);
    await Promise.resolve();
    context.__internal.dispose();
    assert(await outcome === 'SDK_DISPOSED', 'request did not reject on disposal');
    assert(signal.aborted, 'transport signal remains active');
  });
  delete window.__sdkSmokeDefinition;
  delete window.__sdkGuideDefinition;
  delete window.ClassIntraMarket;
  return { passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, results };
};
process.stdout.write('(function() {\n' + ui + '\n' + sdk + '\nwindow.ClassIntraMarket = { define: function(def) { window.__sdkSmokeDefinition = def; } };\n' + entry + '\nwindow.ClassIntraMarket.define = function(def) { window.__sdkGuideDefinition = def; };\n' + documentedEntry + '\nreturn (' + suite.toString() + ')();\n})()');
