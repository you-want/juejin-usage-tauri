import assert from 'node:assert/strict';
import test from 'node:test';
import { mapZcodeResetCredits, mapZcodeQuota, zcodeRemainingPercent, zcodeResponseAuthFailed } from './zcode-subscription';

test('maps ZCode Coding Plan quota pools and retains MCP outside tray selection', () => {
  const result = mapZcodeQuota({
    success: true,
    data: {
      level: 'pro',
      limits: [
        { type: 'TIME_LIMIT', percentage: 12, nextResetTime: 1_900_000_000_000 },
        { type: 'CREDIT_LIMIT', unit: 6, percentage: 40, nextResetTime: 1_900_000_000_000 },
        { type: 'CREDIT_LIMIT', unit: 3, percentage: 25, nextResetTime: 1_900_000_000_000 },
      ],
    },
  });
  assert.equal(result.planLabel, 'Pro');
  assert.deepEqual(result.limits.map((limit) => [limit.id, limit.label, limit.usedPercent]), [
    ['five-hour', '5h', 25],
    ['weekly', '7d', 40],
    ['mcp', 'MCP', 12],
  ]);
});

test('clamps ZCode remaining percentage', () => {
  assert.equal(zcodeRemainingPercent(0), 100);
  assert.equal(zcodeRemainingPercent(81), 19);
  assert.equal(zcodeRemainingPercent(120), 0);
});

test('detects BigModel auth failures wrapped in HTTP 200 bodies', () => {
  assert.equal(zcodeResponseAuthFailed({ code: 401, msg: '令牌已过期或验证不正确', success: false }), true);
  assert.equal(zcodeResponseAuthFailed({ code: 200, success: true }), false);
  assert.equal(zcodeResponseAuthFailed({ code: 0, data: {} }), false);
  assert.equal(zcodeResponseAuthFailed(null), false);
});

test('reset card status preserves zero and normalizes reported expirations only', () => {
  assert.deepEqual(mapZcodeResetCredits({ code: 0, data: { available_five_hour_resets: [{ expire_at: 1900000000000 }], available_week_resets: [] } }), { fiveHour: [{ expiresAt: 1900000000 }], weekly: [] });
  assert.deepEqual(mapZcodeResetCredits({ code: 0, data: { available_five_hour_resets: [], available_week_resets: [] } }), { fiveHour: [], weekly: [] });
  for (const value of [{}, { code: 401 }, { code: 0, data: {} }, { code: 0, data: { available_five_hour_resets: [{}], available_week_resets: [] } }]) assert.equal(mapZcodeResetCredits(value), undefined);
});
test('missing ZCode percentages do not invent an MCP allowance', () => {
  for (const percentage of [null, '', false, undefined]) assert.equal(mapZcodeQuota({ limits: [{ type: 'TIME_LIMIT', percentage }] }).limits.length, 0);
});

test('MCP uses the monthly tool pool, not unrelated TIME_LIMIT windows', () => {
  const result = mapZcodeQuota({ limits: [
    { type: 'TIME_LIMIT', unit: 3, number: 5, percentage: 10 },
    { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 88 },
  ] });
  assert.equal(result.limits.length, 1);
  assert.equal(result.limits[0].usedPercent, 88);
});
