import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMarketSdk } from './helpers/load-market-sdk.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const envelope = data => ({ data: { code: 200, data } });

test('typed requests unwrap JSON values while legacy HTTP calls keep raw responses', async () => {
  const { createContext } = loadMarketSdk();
  const response = envelope({ title: 'Saved note' });
  const calls = [];
  const context = createContext('notes-demo', { api: {
    request: async config => { calls.push(config); return response; },
    get: async () => response
  } });
  const options = { url: '/notes-demo/items', method: 'POST', data: { title: 'Draft' }, params: { page: 1 } };
  const value = await context.data.request(options);
  assert.equal(value.title, 'Saved note');
  assert.equal(calls[0].method, 'post');
  assert.equal(calls[0].url, '/notes-demo/items');
  assert.deepEqual(calls[0].data, { title: 'Draft' });
  assert.equal(options.signal, undefined);
  assert.equal(await context.data.get('/notes-demo/items'), response);
});

test('typed requests preserve business error codes without pretending a failed HTTP 200 is success', async () => {
  const { createContext } = loadMarketSdk();
  const context = createContext('notes-demo', { api: {
    request: async () => ({ status: 200, data: { code: 409, error_code: 'REVISION_CONFLICT', message: '草稿已被更新', data: { revision: 8 } } })
  } });
  await assert.rejects(context.data.request({ url: '/notes-demo/draft', method: 'put' }), error => {
    assert.equal(error.name, 'SdkRequestError');
    assert.equal(error.code, 'REVISION_CONFLICT');
    assert.equal(error.status, 409);
    assert.equal(error.message, '草稿已被更新');
    assert.equal(error.retryable, false);
    assert.equal(error.details.revision, 8);
    return true;
  });
});

test('typed requests provide retry metadata without automatically repeating a write', async () => {
  const { createContext } = loadMarketSdk();
  let calls = 0;
  const context = createContext('notes-demo', { api: { request: async () => {
    calls++;
    throw { response: { status: 429, headers: { 'retry-after': '3' }, data: { code: 429, message: '请稍后再试' } } };
  } } });
  await assert.rejects(context.data.request({ url: '/notes-demo/save', method: 'post' }), error =>
    error.code === 'SDK_HTTP_ERROR' && error.retryable && error.retryAfterMs === 3000 && error.status === 429);
  assert.equal(calls, 1);
});

test('typed requests report network, timeout and invalid-response failures distinctly', async () => {
  const { createContext } = loadMarketSdk();
  for (const [failure, code] of [[new Error('offline'), 'SDK_NETWORK_ERROR'], [{ code: 'ECONNABORTED' }, 'SDK_TIMEOUT']]) {
    const context = createContext('notes-demo', { api: { request: async () => { throw failure; } } });
    await assert.rejects(context.data.request({ url: '/notes-demo/items' }), error => error.code === code && error.retryable);
  }
  const context = createContext('notes-demo', { api: { request: async () => ({ status: 200, data: '<html>login</html>' }) } });
  await assert.rejects(context.data.request({ url: '/notes-demo/items' }), error => error.code === 'SDK_INVALID_RESPONSE');
});

test('typed requests reject external or malformed URLs and unsupported methods before transport', async () => {
  const { createContext } = loadMarketSdk();
  let calls = 0;
  const context = createContext('notes-demo', { api: { request: async () => { calls++; return envelope(null); } } });
  for (const url of ['https://example.invalid', '//example.invalid', '/\\example.invalid', '/notes/../auth', '/notes/%2e%2e/auth']) {
    await assert.rejects(context.data.request({ url }), error => error.code === 'SDK_INVALID_URL');
  }
  await assert.rejects(context.data.request({ url: '/notes', method: 'TRACE' }), error => error.code === 'SDK_INVALID_METHOD');
  assert.equal(calls, 0);
});

test('closing the app aborts typed requests immediately even if transport never settles', async () => {
  const started = deferred();
  const { createContext } = loadMarketSdk({ AbortController });
  let signal;
  const context = createContext('notes-demo', { api: { request: config => {
    signal = config.signal;
    started.resolve();
    return new Promise(() => {});
  } } });
  const operation = context.data.request({ url: '/notes-demo/items' });
  const rejected = assert.rejects(operation, error => error.code === 'SDK_DISPOSED' && !error.retryable);
  await started.promise;
  context.__internal.dispose();
  await rejected;
  assert.equal(signal.aborted, true);
});

test('caller cancellation is isolated to its own request and works without host AbortController', async () => {
  const started = deferred();
  const request = deferred();
  const { createContext } = loadMarketSdk();
  const controller = new AbortController();
  const context = createContext('notes-demo', { api: { request: config => {
    if (config.url.endsWith('/slow')) { started.resolve(); return request.promise; }
    return Promise.resolve(envelope(0));
  } } });
  const operation = context.data.request({ url: '/notes-demo/slow', signal: controller.signal });
  const rejected = assert.rejects(operation, error => error.code === 'SDK_CANCELLED');
  await started.promise;
  controller.abort();
  await rejected;
  assert.equal(await context.data.request({ url: '/notes-demo/fast' }), 0);
  request.resolve(envelope('late'));
});

test('a typed response from the previous account cannot be delivered to the next user', async () => {
  const started = deferred();
  const request = deferred();
  const { createContext } = loadMarketSdk();
  const store = { state: { auth: { user: { user_id: 'alice' }, token: 'a' } } };
  const context = createContext('notes-demo', { store, api: { request: () => { started.resolve(); return request.promise; } } });
  const operation = context.data.request({ url: '/notes-demo/private' });
  const rejected = assert.rejects(operation, error => error.code === 'SDK_ACCOUNT_CHANGED');
  await started.promise;
  store.state.auth = { user: { user_id: 'bob' }, token: 'b' };
  request.resolve(envelope({ private: 'alice' }));
  await rejected;
});

test('asset URLs stay inside the package and encode filenames without changing queries', () => {
  const { createContext } = loadMarketSdk();
  const context = createContext('notes-demo');
  assert.equal(context.app.assetUrl('./frontend/my icon.png?v=2#image'), '/market-static/notes-demo/frontend/my%20icon.png?v=2#image');
  for (const input of ['../private', '%2e%2e/private', 'https://example.invalid/a', '//outside/file', 'frontend\\..\\secret', 'frontend/%2f..%2fsecret']) {
    assert.throws(() => context.app.assetUrl(input), /资源路径/);
  }
});

test('cleanup cancellation and disposal are idempotent even when callbacks unregister each other', () => {
  const { createContext } = loadMarketSdk();
  const context = createContext('notes-demo');
  const calls = [];
  const cancelFirst = context.app.onDestroy(() => calls.push('first'));
  context.app.onDestroy(() => { calls.push('second'); cancelFirst(); });
  context.app.onDestroy(() => calls.push('third'));
  context.__internal.dispose();
  context.__internal.dispose();
  context.app.onDestroy(() => calls.push('late'));
  assert.deepEqual(calls, ['third', 'second', 'first', 'late']);
});

test('page disposal preserves subscriptions from another context of the same application', () => {
  const { createContext, EventEmitter } = loadMarketSdk();
  const bus = new EventEmitter();
  const page = createContext('notes-demo', { eventBus: bus });
  const widget = createContext('notes-demo', { eventBus: bus });
  const seen = [];
  page.system.eventBus.on('tick', () => seen.push('page'));
  widget.system.eventBus.on('tick', () => seen.push('widget'));
  page.__internal.dispose();
  bus.emit('tick');
  assert.deepEqual(seen, ['widget']);
  widget.__internal.dispose();
  assert.equal(bus.listenerCount('tick'), 0);
});

test('the same event handler can be shared by two contexts without losing owner cleanup', () => {
  const { createContext, EventEmitter } = loadMarketSdk();
  const bus = new EventEmitter();
  const first = createContext('notes-demo', { eventBus: bus });
  const second = createContext('notes-demo', { eventBus: bus });
  let calls = 0;
  const handler = () => calls++;
  first.system.eventBus.on('tick', handler);
  second.system.eventBus.on('tick', handler);
  first.__internal.dispose();
  second.__internal.dispose();
  bus.emit('tick');
  assert.equal(calls, 0);
});

test('realtime subscriptions are automatically released without stopping the shared connection', () => {
  const { createContext, EventEmitter } = loadMarketSdk();
  const realtime = new EventEmitter();
  realtime.subscribe = function(event, handler) {
    return this.on('extension_event', message => { if (message.event === event) handler(message.payload, message); });
  };
  const page = createContext('notes-demo', { realtime });
  const seen = [];
  page.data.realtime.subscribe('updated', payload => seen.push(payload));
  realtime.emit('extension_event', { event: 'updated', payload: 1 });
  page.__internal.dispose();
  realtime.emit('extension_event', { event: 'updated', payload: 2 });
  assert.deepEqual(seen, [1]);
  assert.equal(realtime.listenerCount('extension_event'), 0);
});

test('realtime off retains the v1 event-and-handler unsubscribe contract', () => {
  const { createContext, EventEmitter } = loadMarketSdk();
  const realtime = new EventEmitter();
  const context = createContext('notes-demo', { realtime });
  let calls = 0;
  const handler = () => calls++;
  context.data.realtime.on('tick', handler);
  context.data.realtime.off('tick', handler);
  realtime.emit('tick');
  assert.equal(calls, 0);
});

test('unknown roles never grant UI access', () => {
  const { createContext } = loadMarketSdk();
  const context = createContext('notes-demo');
  assert.equal(context.system.can('typo-role'), false);
});

test('theme tokens accept canonical CSS names and documented short names', () => {
  const computed = { 0: '--ci-color-primary', length: 1, getPropertyValue: name => name === '--ci-color-primary' ? '#123456' : '' };
  const { createContext } = loadMarketSdk({
    document: { documentElement: { getAttribute: () => 'light' } },
    window: { getComputedStyle: () => computed }
  });
  const context = createContext('notes-demo');
  assert.equal(context.system.getToken('--ci-color-primary'), '#123456');
  assert.equal(context.system.getToken('color-primary'), '#123456');
  assert.equal(context.theme.getToken('color-primary'), '#123456');
});

test('search providers unregister on context disposal', async () => {
  const { createContext, SearchRegistry } = loadMarketSdk();
  const searchRegistry = new SearchRegistry();
  const context = createContext('notes-demo', { searchRegistry });
  context.system.registerSearchProvider({ search: () => [{ title: 'Meeting note' }] });
  assert.equal((await searchRegistry.search('meeting')).total, 1);
  context.__internal.dispose();
  assert.equal((await searchRegistry.search('meeting')).total, 0);
});

test('late search registration after disposal leaves no provider behind', async () => {
  const { createContext, SearchRegistry } = loadMarketSdk();
  const searchRegistry = new SearchRegistry();
  const context = createContext('notes-demo', { searchRegistry });
  context.__internal.dispose();
  const stop = context.system.registerSearchProvider({ search: () => [{ title: 'Stale note' }] });
  stop();
  assert.equal((await searchRegistry.search('note')).total, 0);
});

test('local storage round-trips strings that look like JSON', () => {
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
  const { createContext } = loadMarketSdk({ localStorage });
  const context = createContext('notes-demo');
  for (const value of ['42', 'true', 'null', '{"a":1}', 'hello']) {
    assert.equal(context.data.storage.set('value', value), true);
    assert.equal(context.data.storage.get('value'), value);
  }
});

test('datastore keeps uninstalled-app errors distinct from a missing key', async () => {
  const { createContext } = loadMarketSdk();
  const error = { response: { status: 404, data: { code: 404, message: '应用未安装: notes-demo' } } };
  const context = createContext('notes-demo', { api: { get: () => Promise.reject(error) } });
  await assert.rejects(context.data.store.get('draft'), err => err === error);
  error.response.data.message = '键不存在';
  assert.equal(await context.data.store.get('draft'), null);
});

test('datastore rejects business errors returned with HTTP 200', async () => {
  const { createContext } = loadMarketSdk();
  const context = createContext('notes-demo', { api: {
    get: async () => ({ data: { code: 403, message: '应用已停用' } }),
    put: async () => ({ data: { code: 400, message: '超出配额' } })
  } });
  await assert.rejects(context.data.store.keys(), /应用已停用/);
  await assert.rejects(context.data.store.set('draft', 'text'), /超出配额/);
});

test('a blob request completing after disposal cannot create a leaking object URL', async () => {
  const request = deferred();
  let created = 0;
  const { createContext } = loadMarketSdk({ URL: { createObjectURL: () => { created++; return 'blob:late'; }, revokeObjectURL() {} } });
  const context = createContext('notes-demo', { api: { get: () => request.promise } });
  const result = context.data.store.getBlobUrl('photo');
  context.__internal.dispose();
  request.resolve({ data: {} });
  await assert.rejects(result, /已销毁/);
  assert.equal(created, 0);
});

test('blob URLs can be released early without revoking foreign URLs or double cleanup', async () => {
  const revoked = [];
  const { createContext } = loadMarketSdk({ URL: { createObjectURL: () => 'blob:owned', revokeObjectURL: url => revoked.push(url) } });
  const context = createContext('notes-demo', { api: { get: async () => ({ data: {} }) } });
  const url = await context.data.store.getBlobUrl('photo');
  assert.equal(context.data.store.releaseBlobUrl('blob:other-app'), false);
  assert.equal(context.data.store.releaseBlobUrl(url), true);
  assert.equal(context.data.store.releaseBlobUrl(url), false);
  context.__internal.dispose();
  assert.deepEqual(revoked, ['blob:owned']);
});

test('clipboard grants are isolated by account on shared devices', async () => {
  let reads = 0;
  const { createContext } = loadMarketSdk({ navigator: { clipboard: { readText: async () => { reads++; return 'private'; } } } });
  const store = { state: { auth: { user: { user_id: 'alice' }, token: 'alice-session' } } };
  const context = createContext('notes-demo', { store, api: {
    get: async () => envelope({ granted: store.state.auth.user.user_id === 'alice' ? ['system.clipboard.read'] : [] })
  } });
  assert.equal((await context.system.clipboard.read()).text, 'private');
  store.state.auth = { user: { user_id: 'bob' }, token: 'bob-session' };
  await assert.rejects(context.system.clipboard.read(), /拒绝|权限|登录/);
  assert.equal(reads, 1);
});

test('an account change while checking permissions cannot authorize the next user', async () => {
  const request = deferred();
  let reads = 0;
  const { createContext } = loadMarketSdk({ navigator: { clipboard: { readText: async () => { reads++; return 'private'; } } } });
  const store = { state: { auth: { user: { user_id: 'alice' }, token: 'alice-session' } } };
  const context = createContext('notes-demo', { store, api: { get: () => request.promise } });
  const result = context.system.clipboard.read();
  store.state.auth = { user: { user_id: 'bob' }, token: 'bob-session' };
  request.resolve(envelope({ granted: ['system.clipboard.read'] }));
  await assert.rejects(result, /账号|登录/);
  assert.equal(reads, 0);
});

test('a disposed context cannot reuse a cached clipboard grant', async () => {
  let reads = 0;
  const { createContext } = loadMarketSdk({ navigator: { clipboard: { readText: async () => { reads++; return 'value'; } } } });
  const context = createContext('notes-demo', { api: { get: async () => envelope({ granted: ['system.clipboard.read'] }) } });
  await context.system.clipboard.read();
  context.__internal.dispose();
  await assert.rejects(context.system.clipboard.read(), /已销毁/);
  assert.equal(reads, 1);
});

for (const method of ['camera', 'recordAudio', 'recordVideo']) {
  test(method + ' stops a late media stream if the app was closed while permission was pending', async () => {
    const request = deferred();
    const started = deferred();
    let stopped = 0;
    const { createContext } = loadMarketSdk({
      window: { MediaRecorder: function() {} },
      navigator: { mediaDevices: { getUserMedia: () => { started.resolve(); return request.promise; } } }
    });
    const context = createContext('notes-demo', { api: {
      get: async () => envelope({ granted: ['device.camera', 'device.microphone'] })
    } });
    const result = context.device[method]();
    await started.promise;
    context.__internal.dispose();
    request.resolve({ getTracks: () => [{ stop: () => stopped++ }] });
    await assert.rejects(result, /已销毁/);
    assert.equal(stopped, 1);
  });
}

test('share payloads are delivered only to the target and stop after unsubscribe', async () => {
  const { createContext } = loadMarketSdk();
  const target = createContext('notes-demo', { router: { currentRoute: { query: { ci_share: '1', ci_share_text: 'private note' } } } });
  const another = createContext('other-demo');
  const seen = [];
  target.app.onShare(data => seen.push(data.text));
  const stop = target.app.onShare(() => seen.push('cancelled'));
  stop();
  another.app.onShare(() => seen.push('other'));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(seen, ['private note']);
});
