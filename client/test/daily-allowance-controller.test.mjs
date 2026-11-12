import assert from 'node:assert/strict';
import test from 'node:test';
import { createDailyAllowanceController } from '../src/core/daily-allowance-controller.mjs';

function createState(overrides = {}) {
  return {
    ready: false,
    loading: false,
    error: '',
    claimed: false,
    amount: 0,
    streak: 0,
    balance: 0,
    busy: false,
    ...overrides
  };
}

function walletResponse({ claimed = false, amount = 10, streak = 2, balance = 25 } = {}) {
  return {
    data: {
      code: 200,
      data: {
        account: { balance },
        daily: { claimed, amount, streak }
      }
    }
  };
}

function claimResponse({ duplicate = false, amount = 10, streak = 3, balance = 35 } = {}) {
  return {
    data: {
      code: 200,
      message: duplicate ? '今天已经领过了' : '津贴已到账',
      data: {
        duplicate,
        amount,
        streak,
        account: { balance },
        daily: { claimed: true, amount, streak }
      }
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('load failure shows a recoverable read error without enabling claim', async () => {
  const state = createState();
  const controller = createDailyAllowanceController({
    get: async () => { throw new Error('offline'); },
    post: async () => { throw new Error('claim must not run'); }
  }, state);

  await controller.load();

  assert.equal(state.ready, false);
  assert.equal(state.loading, false);
  assert.ok(state.error);
  assert.equal(controller.canClaim(), false);
  assert.equal((await controller.claim()).status, 'ignored');
});

test('malformed wallet response is not treated as a zero balance or unclaimed allowance', async () => {
  const state = createState({ amount: 7, streak: 4, balance: 123 });
  const controller = createDailyAllowanceController({
    get: async () => ({ data: { code: 200, data: { account: { balance: 0 } } } }),
    post: async () => { throw new Error('claim must not run'); }
  }, state);

  await controller.load();

  assert.deepEqual(
    { ready: state.ready, claimed: state.claimed, amount: state.amount, streak: state.streak, balance: state.balance },
    { ready: false, claimed: false, amount: 7, streak: 4, balance: 123 }
  );
  assert.ok(state.error);
  assert.equal(controller.canClaim(), false);
});

test('retry blocks claim until the refresh settles', async () => {
  const refresh = deferred();
  let getCount = 0;
  let postCount = 0;
  const state = createState();
  const controller = createDailyAllowanceController({
    get: () => (++getCount === 1 ? Promise.resolve(walletResponse()) : refresh.promise),
    post: async () => { postCount += 1; return claimResponse(); }
  }, state);

  await controller.load();
  const retry = controller.load();

  assert.equal(state.loading, true);
  assert.equal(controller.canClaim(), false);
  assert.equal((await controller.claim()).status, 'ignored');
  assert.equal(postCount, 0);

  refresh.resolve(walletResponse({ amount: 12, balance: 27 }));
  await retry;
  assert.equal(state.loading, false);
  assert.equal(controller.canClaim(), true);
});

test('failed refresh preserves last known allowance values and marks them unavailable', async () => {
  let getCount = 0;
  const state = createState();
  const controller = createDailyAllowanceController({
    get: async () => {
      getCount += 1;
      if (getCount === 1) return walletResponse({ amount: 14, streak: 5, balance: 82 });
      throw new Error('offline');
    },
    post: async () => claimResponse()
  }, state);

  await controller.load();
  await controller.load();

  assert.deepEqual(
    { ready: state.ready, claimed: state.claimed, amount: state.amount, streak: state.streak, balance: state.balance },
    { ready: true, claimed: false, amount: 14, streak: 5, balance: 82 }
  );
  assert.ok(state.error);
  assert.equal(controller.canClaim(), false);
});

test('duplicate claim is successful without crediting the returned balance twice', async () => {
  const state = createState();
  const controller = createDailyAllowanceController({
    get: async () => walletResponse({ amount: 10, streak: 2, balance: 25 }),
    post: async () => claimResponse({ duplicate: true, amount: 10, streak: 3, balance: 25 })
  }, state);

  await controller.load();
  const result = await controller.claim();

  assert.equal(result.status, 'duplicate');
  assert.equal(state.claimed, true);
  assert.equal(state.balance, 25);
  assert.equal(controller.canClaim(), false);
});

test('claim failure restores the unclaimed action and returns retry feedback', async () => {
  const state = createState();
  const controller = createDailyAllowanceController({
    get: async () => walletResponse(),
    post: async () => { throw new Error('网络不可用'); }
  }, state);

  await controller.load();
  const result = await controller.claim();

  assert.equal(result.status, 'failed');
  assert.equal(result.message, '网络不可用');
  assert.equal(state.busy, false);
  assert.equal(state.claimed, false);
  assert.equal(controller.canClaim(), true);
});

test('concurrent loads share one wallet request', async () => {
  const request = deferred();
  let getCount = 0;
  const state = createState();
  const controller = createDailyAllowanceController({
    get: () => { getCount += 1; return request.promise; },
    post: async () => claimResponse()
  }, state);

  const first = controller.load();
  const second = controller.load();
  await Promise.resolve();
  assert.equal(getCount, 1);

  request.resolve(walletResponse());
  await Promise.all([first, second]);
  assert.equal(state.ready, true);
});

test('concurrent claims issue one request and share the successful result', async () => {
  const request = deferred();
  let postCount = 0;
  const state = createState();
  const controller = createDailyAllowanceController({
    get: async () => walletResponse(),
    post: () => { postCount += 1; return request.promise; }
  }, state);

  await controller.load();
  const first = controller.claim();
  const second = controller.claim();
  await Promise.resolve();
  assert.equal(postCount, 1);

  request.resolve(claimResponse({ amount: 10, balance: 35 }));
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(result => result.status), ['claimed', 'claimed']);
  assert.equal(state.balance, 35);
  assert.equal(state.busy, false);
});

test('a wallet read started during claim cannot overwrite the authoritative claim result', async () => {
  const refresh = deferred();
  const claimRequest = deferred();
  let getCount = 0;
  const state = createState();
  const controller = createDailyAllowanceController({
    get: () => (++getCount === 1 ? Promise.resolve(walletResponse({ balance: 25 })) : refresh.promise),
    post: () => claimRequest.promise
  }, state);

  await controller.load();
  const claim = controller.claim();
  const staleRefresh = controller.load();
  await Promise.resolve();

  claimRequest.resolve(claimResponse({ balance: 35 }));
  const claimResult = await claim;
  assert.equal(claimResult.status, 'claimed');

  refresh.resolve(walletResponse({ claimed: false, amount: 10, streak: 2, balance: 25 }));
  await staleRefresh;

  assert.equal(state.claimed, true);
  assert.equal(state.balance, 35);
  assert.equal(controller.canClaim(), false);
});
