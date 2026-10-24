import assert from 'node:assert/strict';
import test from 'node:test';
import { cursorRemainingPercent, mapCursorUsageSummary } from './cursor-subscription';

test('maps current Cursor model pools from individual usage', () => {
  assert.deepEqual(mapCursorUsageSummary({
    billingCycleEnd: '2026-10-01T00:00:00Z',
    membershipType: 'ultra',
    individualUsage: {
      plan: { autoPercentUsed: 21.5, apiPercentUsed: 72 },
    },
  }), {
    planLabel: 'Ultra',
    cursorModels: { usedPercent: 21.5, resetsAt: 1_790_812_800 },
    otherModels: { usedPercent: 72, resetsAt: 1_790_812_800 },
    plan: null,
  });
});

test('falls back to team usage and bounds pool percentages', () => {
  const result = mapCursorUsageSummary({
    billingCycleEnd: 1_800_000_000_000,
    teamUsage: { plan: { autoPercentUsed: -5, apiPercentUsed: 130 } },
  });
  assert.deepEqual(result.cursorModels, { usedPercent: 0, resetsAt: 1_800_000_000 });
  assert.deepEqual(result.otherModels, { usedPercent: 100, resetsAt: 1_800_000_000 });
});

test('maps legacy used and limit response into one plan window', () => {
  assert.deepEqual(mapCursorUsageSummary({
    membershipType: 'pro',
    individualUsage: { plan: { used: 125, breakdown: { total: 500 } } },
  }), {
    planLabel: 'Pro',
    cursorModels: null,
    otherModels: null,
    plan: { usedPercent: 25, resetsAt: null },
  });
});

test('normalizes Cursor Pro+ membership labels', () => {
  const result = mapCursorUsageSummary({
    membershipType: 'pro_plus',
    individualUsage: { plan: { used: 1, total: 2 } },
  });
  assert.equal(result.planLabel, 'Pro+');
});

test('converts Cursor usage to remaining allowance', () => {
  assert.equal(cursorRemainingPercent(0), 100);
  assert.equal(cursorRemainingPercent(66.5), 33.5);
  assert.equal(cursorRemainingPercent(120), 0);
});

test('Grok Bot preserves its own weekly period and only reports confirmed entitlements', async () => {
  const { mapCursorGrokBotUsage } = await import('./cursor-subscription.js');
  assert.deepEqual(mapCursorGrokBotUsage({
    includedLimitZero: false, usagePercent: 35,
    currentPeriodStart: '2026-10-01T00:00:00Z', nextResetTimestampUtc: '2026-10-08T00:00:00Z',
  }), { usedPercent: 35, startsAt: 1790812800, resetsAt: 1791417600 });
  assert.equal(mapCursorGrokBotUsage({ usagePercent: 0 }), null);
  assert.equal(mapCursorGrokBotUsage({ includedLimitZero: true, hasNonZeroIncludedLimit: true, usagePercent: 10 }), null);
  assert.equal(mapCursorGrokBotUsage({ hasNonZeroIncludedLimit: true, usagePercent: 100, hasAvailableUsage: false })?.usedPercent, 100);
  for (const usagePercent of [null, '', false, [], NaN, Infinity]) {
    assert.equal(mapCursorGrokBotUsage({ includedLimitZero: false, usagePercent }), null);
  }
});

test('Grok Bot trial expiry is never displayed as a recurring reset', async () => {
  const { mapCursorGrokBotUsage } = await import('./cursor-subscription.js');
  const trial = { includedLimitZero: true, usagePercent: 25, sandTrialExpiresAt: '2026-10-08T00:00:00Z', nextResetTimestampUtc: '2026-10-10T00:00:00Z' };
  const now = Date.parse('2026-10-01T00:00:00Z');
  assert.deepEqual(mapCursorGrokBotUsage(trial, now), { usedPercent: 25, resetsAt: null, expiresAt: 1791417600 });
  assert.equal(mapCursorGrokBotUsage(trial, Date.parse('2026-10-09T00:00:00Z')), null);
  assert.equal(mapCursorGrokBotUsage({ ...trial, includedLimitZero: false }, now)?.resetsAt, 1791590400);
});
