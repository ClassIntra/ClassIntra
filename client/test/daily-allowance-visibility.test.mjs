import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDailyAllowanceHiddenKey,
  isDailyAllowanceHidden
} from '../src/core/daily-allowance-visibility.mjs';

test('daily allowance dismissal is isolated per account on a shared device', () => {
  const aliceKey = getDailyAllowanceHiddenKey('2026-11-12', { user_id: 'A-1001' });
  const bobKey = getDailyAllowanceHiddenKey('2026-11-12', { user_id: 'B-2002' });

  assert.notEqual(aliceKey, bobKey);
  assert.equal(aliceKey, 'ci:txy:hidden:2026-11-12:A-1001');
  assert.equal(isDailyAllowanceHidden({ 'ci:txy:hidden:2026-11-12:A-1001': '1' }, '2026-11-12', { user_id: 'A-1001' }), true);
  assert.equal(isDailyAllowanceHidden({ 'ci:txy:hidden:2026-11-12:A-1001': '1' }, '2026-11-12', { user_id: 'B-2002' }), false);
});
