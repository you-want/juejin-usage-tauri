import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexSubscriptionSnapshot } from '../../shared/codex-subscription';
import {
  INITIAL_CODEX_SUBSCRIPTION_STATE,
  updateCodexSubscriptionState,
} from './codex-subscription-state';

const ready: CodexSubscriptionSnapshot = {
  status: 'ready',
  planLabel: 'Plus',
  fiveHour: { usedPercent: 20, resetsAt: 1_800_000_000 },
  weekly: { usedPercent: 40, resetsAt: 1_800_500_000 },
  message: null,
};
const unavailable: CodexSubscriptionSnapshot = {
  status: 'unavailable', planLabel: null, fiveHour: null, weekly: null,
  message: '无法启动本机 Codex CLI',
};

test('a first failure is visible without inventing allowance data', () => {
  const state = updateCodexSubscriptionState(INITIAL_CODEX_SUBSCRIPTION_STATE, unavailable, 100);
  assert.equal(state.snapshot, unavailable);
  assert.equal(state.lastUpdatedAt, null);
});

test('transient and repeated failures retain the last allowance and success time', () => {
  const loaded = updateCodexSubscriptionState(INITIAL_CODEX_SUBSCRIPTION_STATE, ready, 100);
  const failed = updateCodexSubscriptionState(loaded, unavailable, 200);
  const failedAgain = updateCodexSubscriptionState(failed, unavailable, 300);
  assert.equal(failedAgain.snapshot?.status, 'unavailable');
  assert.equal(failedAgain.snapshot?.message, unavailable.message);
  assert.equal(failedAgain.snapshot?.planLabel, 'Plus');
  assert.deepEqual(failedAgain.snapshot?.fiveHour, ready.fiveHour);
  assert.deepEqual(failedAgain.snapshot?.weekly, ready.weekly);
  assert.equal(failedAgain.lastUpdatedAt, 100);

  const recovered = updateCodexSubscriptionState(failedAgain, { ...ready, weekly: null }, 400);
  assert.equal(recovered.snapshot?.status, 'ready');
  assert.equal(recovered.snapshot?.message, null);
  assert.equal(recovered.snapshot?.weekly, null);
  assert.equal(recovered.lastUpdatedAt, 400);
});

test('sign-out, unsupported accounts and missing CLI hide the card and clear stale allowance', () => {
  const loaded = updateCodexSubscriptionState(INITIAL_CODEX_SUBSCRIPTION_STATE, ready, 100);
  const failed = updateCodexSubscriptionState(loaded, unavailable, 150);
  for (const status of ['not-signed-in', 'unsupported-account', 'not-installed'] as const) {
    for (const previous of [INITIAL_CODEX_SUBSCRIPTION_STATE, loaded, failed]) {
      const cleared = updateCodexSubscriptionState(previous, { ...unavailable, status }, 200);
      assert.deepEqual(cleared, INITIAL_CODEX_SUBSCRIPTION_STATE, status);
      const repeated = updateCodexSubscriptionState(cleared, { ...unavailable, status }, 300);
      assert.deepEqual(repeated, INITIAL_CODEX_SUBSCRIPTION_STATE, status);
      const laterFailure = updateCodexSubscriptionState(cleared, unavailable, 400);
      assert.equal(laterFailure.snapshot?.fiveHour, null);
      assert.equal(laterFailure.snapshot?.weekly, null);
      assert.equal(laterFailure.lastUpdatedAt, null);
    }
  }
});

test('a ChatGPT subscription becomes visible after a hidden account or missing CLI', () => {
  for (const status of ['not-signed-in', 'unsupported-account', 'not-installed'] as const) {
    const hidden = updateCodexSubscriptionState(INITIAL_CODEX_SUBSCRIPTION_STATE, { ...unavailable, status }, 100);
    const loaded = updateCodexSubscriptionState(hidden, ready, 200);
    assert.equal(loaded.snapshot, ready);
    assert.equal(loaded.lastUpdatedAt, 200);
    const failed = updateCodexSubscriptionState(hidden, { ...unavailable, planLabel: 'Plus' }, 300);
    assert.equal(failed.snapshot?.status, 'unavailable');
    assert.equal(failed.snapshot?.planLabel, 'Plus');
    assert.equal(failed.lastUpdatedAt, null);
  }
});

test('a changed plan cannot reuse previous allowance', () => {
  const loaded = updateCodexSubscriptionState(INITIAL_CODEX_SUBSCRIPTION_STATE, ready, 100);
  const changed = updateCodexSubscriptionState(loaded, { ...unavailable, planLabel: 'Pro' }, 200);
  assert.equal(changed.snapshot?.fiveHour, null);
  assert.equal(changed.lastUpdatedAt, null);
});
