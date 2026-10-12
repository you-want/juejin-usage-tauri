import assert from 'node:assert/strict';
import test from 'node:test';
import { nonNegativeNumber, subscriptionAmounts } from './subscription-amounts';
import { mapQoderQuota } from './qoder-subscription';
import { mapKimiUsage } from './kimi-subscription';
import { mapMiniMaxAccountQuota, mapMiniMaxQuota } from './minimax-subscription';
import { mapDeepSeekBalance } from './deepseek-subscription';
import { mapAntigravityModels } from './antigravity-subscription';
import { mapCursorUsageSummary } from './cursor-subscription';
import { mapGrokBilling } from './grok-subscription';
import { mapCodexUsage } from '../main/codex-subscription';

test('absolute quota values reject missing and non-numeric readings while preserving zero', () => {
  for (const value of [null, undefined, '', ' ', false, true, [], {}, -1, NaN, Infinity]) assert.equal(nonNegativeNumber(value), null);
  assert.equal(nonNegativeNumber('0'), 0);
  assert.deepEqual(subscriptionAmounts(100, undefined, 0), { total: 100, remaining: 0 });
  assert.equal(subscriptionAmounts(null, undefined, ''), undefined);
});

test('Qoder preserves envelope pools, literal counts and absent readings independently', () => {
  const mapped = mapQoderQuota({ displayMode: 'qoder', qoderUsage: {
    userType: 'personal_professional', expiresAt: 1900000000,
    userQuota: { cap: 1000, remaining: 600 },
    addOnQuota: { percentage: 0.2 },
    orgResourcePackage: { total: 500, used: 30 },
    dedicatedResourcePackages: [{ name: '项目包', total: 20, used: 5 }],
  } }, null);
  assert.equal(mapped.planLabel, 'Pro');
  assert.deepEqual(mapped.limits.map((item) => item.id), ['plan', 'add-on', 'shared', 'dedicated-0']);
  assert.deepEqual(mapped.limits[0].amounts, { total: 1000, remaining: 600, unit: 'Credits' });
  assert.equal(mapped.limits[0].usedPercent, 40);
  assert.equal(mapped.limits[1].amounts, undefined);
  assert.equal(mapped.limits[3].label, '项目包');
  for (const used of [null, false, '', undefined]) assert.deepEqual(mapQoderQuota({ userQuota: { total: 100, used } }, null).limits, []);
});

test('Kimi remaining-only detail windows retain counts without inventing used counts or units', () => {
  const mapped = mapKimiUsage({ limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', remaining: '75' } }] });
  assert.equal(mapped[0].usedPercent, 25);
  assert.deepEqual(mapped[0].amounts, { total: 100, remaining: 75 });
  assert.deepEqual(mapKimiUsage({ usage: { limit: 100, remaining: 101 } }), []);
});

test('MiniMax retains model-specific windows and verifies ambiguous counts against percentages', () => {
  const mapped = mapMiniMaxAccountQuota({ token_plan_tier: 'pro' }, { model_remains: [
    { model_name: 'general', current_interval_used_percent: '20%', current_interval_total_count: 0 },
    { model_name: 'image', current_interval_remaining_percent: 80, current_interval_total_count: 100, current_interval_usage_count: 80,
      current_weekly_status: 2, current_weekly_remaining_percent: 90 },
    { model_name: 'video', current_interval_status: 3, current_weekly_status: 3 },
    { model_name: 'bad-count', current_interval_remaining_percent: 80, current_interval_total_count: 100, current_interval_usage_count: 50 },
  ] });
  assert.equal(mapped.limits.length, 1);
  assert.equal(mapped.limits[0].modelName, 'general');
  assert.equal(mapped.limits[0].amounts, undefined);
  const image = mapped.modelLimits?.find((item) => item.modelName === 'image' && item.id === 'five-hour');
  assert.deepEqual(image?.amounts, { total: 100, used: 20, remaining: 80, unit: '次' });
  assert.equal(mapped.modelLimits?.find((item) => item.modelName === 'image' && item.id === 'weekly')?.usedPercent, 100);
  assert.equal(mapped.modelLimits?.find((item) => item.modelName === 'video')?.unlimited, true);
  assert.equal(mapped.modelLimits?.find((item) => item.modelName === 'bad-count')?.amounts, undefined);
});

test('DeepSeek keeps actual current balance and component balances, including zero and unavailable status', () => {
  const balance = mapDeepSeekBalance({ is_available: false, balance_infos: [{ currency: 'CNY', total_balance: '0', granted_balance: '0', topped_up_balance: '0' }] }).limits[0];
  assert.equal(balance.remaining, 0);
  assert.equal(balance.granted, 0);
  assert.equal(balance.toppedUp, 0);
  assert.equal(balance.available, false);
  assert.deepEqual(mapDeepSeekBalance({ total_balance: null, granted_balance: null, topped_up_balance: null }).limits, []);
  // A partial breakdown must not override the authoritative total balance.
  assert.equal(mapDeepSeekBalance({ total_balance: '10', granted_balance: '2' }).limits[0].remaining, 10);
});

test('Codex only preserves whitelisted credit fields and accepts numeric string balances', () => {
  const mapped = mapCodexUsage({ credits: { balance: '12.5', unlimited: false, has_credits: true, access_token: 'secret' } });
  assert.deepEqual(mapped.credits, { balance: 12.5, unlimited: false, hasCredits: true });
  assert.equal(mapCodexUsage({ credits: { balance: null } }).credits, undefined);
});

test('all model and period data survives normalization; absent model quotas stay absent', () => {
  assert.equal(mapAntigravityModels({ models: { unknown: { quotaInfo: { remainingFraction: null } } } }).length, 0);
  const limits = mapGrokBilling({ config: { usagePeriods: ['session', 'daily', 'weekly', 'monthly'].map((type) => ({ type, usagePercent: 10 })) } }).limits;
  assert.equal(limits.length, 4);
});

test('Cursor retains billing start and parses epoch milliseconds without treating null percentages as zero', () => {
  const snapshot = mapCursorUsageSummary({ billingCycleStart: '1790812800000', billingCycleEnd: '1793491200000', individualUsage: { plan: { autoPercentUsed: 40, apiPercentUsed: null } } });
  assert.equal(snapshot.cursorModels?.startsAt, 1790812800);
  assert.equal(snapshot.cursorModels?.resetsAt, 1793491200);
  assert.equal(snapshot.otherModels, null);
});

test('MiniMax Coding Plan key responses use the real model_remains schema too', () => {
  const snapshot = mapMiniMaxQuota({ model_remains: [{ model_name: 'general', current_interval_remaining_percent: 50, current_interval_status: 1, end_time: 1900000000000 }] });
  assert.equal(snapshot.limits[0].usedPercent, 50);
  assert.equal(snapshot.limits[0].resetsAt, 1900000000);
  assert.equal(snapshot.modelLimits?.length, 1);
});


test('MiniMax summary skips absent model groups instead of discarding valid model quotas', () => {
  const mapped = mapMiniMaxAccountQuota(null, { model_remains: [
    { model_name: 'unavailable', current_interval_status: 3, current_weekly_status: 3, current_interval_total_count: 0, current_weekly_total_count: 0 },
    { model_name: 'image', current_interval_used_percent: '25%' },
  ] });
  assert.equal(mapped.limits[0]?.modelName, 'image');
  assert.equal(mapped.limits[0]?.usedPercent, 25);
});
