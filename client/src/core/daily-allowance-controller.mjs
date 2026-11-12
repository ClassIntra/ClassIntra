const READ_ERROR = '学元状态暂时读不到';

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getWalletSnapshot(response) {
  const body = response && response.data;
  const data = body && body.data;
  if (Number(body && body.code) !== 200 || !isObject(data)) return null;

  const accountBalance = isObject(data.account) ? finiteNumber(data.account.balance) : null;
  const dailyAmount = isObject(data.daily) ? finiteNumber(data.daily.amount) : null;
  const dailyStreak = isObject(data.daily) ? finiteNumber(data.daily.streak) : null;
  if (accountBalance === null || dailyAmount === null || dailyStreak === null ||
      typeof data.daily.claimed !== 'boolean') {
    return null;
  }

  return {
    balance: accountBalance,
    amount: dailyAmount,
    streak: dailyStreak,
    claimed: data.daily.claimed
  };
}

function errorMessage(error, fallback) {
  return error && typeof error.message === 'string' && error.message
    ? error.message
    : fallback;
}

export function createDailyAllowanceController(api, state) {
  let loadPromise = null;
  let claimPromise = null;
  let operationVersion = 0;

  function canClaim() {
    return state.ready && !state.loading && !state.busy && !state.error && !state.claimed;
  }

  function load() {
    if (loadPromise) return loadPromise;

    const version = operationVersion;
    state.loading = true;
    state.error = '';
    loadPromise = Promise.resolve()
      .then(function () { return api.get('/wallet'); })
      .then(function (response) {
        if (version !== operationVersion) return { status: 'stale' };
        const snapshot = getWalletSnapshot(response);
        if (!snapshot) {
          state.error = READ_ERROR;
          return { status: 'failed', message: READ_ERROR };
        }

        state.balance = snapshot.balance;
        state.amount = snapshot.amount;
        state.streak = snapshot.streak;
        state.claimed = snapshot.claimed;
        state.ready = true;
        state.error = '';
        return { status: 'loaded' };
      })
      .catch(function () {
        state.error = READ_ERROR;
        return { status: 'failed', message: READ_ERROR };
      })
      .then(function (result) {
        state.loading = false;
        loadPromise = null;
        return result;
      });

    return loadPromise;
  }

  function claim() {
    if (claimPromise) return claimPromise;
    if (!canClaim()) return Promise.resolve({ status: 'ignored' });

    operationVersion += 1;
    state.busy = true;
    claimPromise = Promise.resolve()
      .then(function () { return api.post('/wallet/daily'); })
      .then(function (response) {
        const body = response && response.data;
        const data = body && body.data;
        if (Number(body && body.code) !== 200 || !isObject(data)) {
          return {
            status: 'failed',
            message: (body && body.message) || '领取失败，稍后再试'
          };
        }

        const duplicate = data.duplicate === true;
        if (!duplicate && (!isObject(data.daily) || data.daily.claimed !== true)) {
          return { status: 'failed', message: '无法确认领取结果，请刷新钱包后重试' };
        }

        state.claimed = true;
        const amount = isObject(data.daily) ? finiteNumber(data.daily.amount) : null;
        const streak = isObject(data.daily) ? finiteNumber(data.daily.streak) : finiteNumber(data.streak);
        const balance = isObject(data.account) ? finiteNumber(data.account.balance) : null;
        if (amount !== null) state.amount = amount;
        if (streak !== null) state.streak = streak;
        if (balance !== null) state.balance = balance;

        return {
          status: duplicate ? 'duplicate' : 'claimed',
          message: body.message || (duplicate ? '今天已经领过了' : '津贴已到账')
        };
      })
      .catch(function (error) {
        return { status: 'failed', message: errorMessage(error, '领取失败，稍后再试') };
      })
      .then(function (result) {
        operationVersion += 1;
        state.busy = false;
        claimPromise = null;
        return result;
      });

    return claimPromise;
  }

  return { load: load, claim: claim, canClaim: canClaim };
}
