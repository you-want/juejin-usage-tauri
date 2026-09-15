import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCompactTokens, formatTrayUsage } from './tray-usage';

test('formats compact token counts', () => {
  assert.equal(formatCompactTokens(0), '0');
  assert.equal(formatCompactTokens(-10), '0');
  assert.equal(formatCompactTokens(500), '500');
  assert.equal(formatCompactTokens(1000), '1K');
  assert.equal(formatCompactTokens(1500), '1.5K');
  assert.equal(formatCompactTokens(25000), '25K');
  assert.equal(formatCompactTokens(1200000), '1.2M');
  assert.equal(formatCompactTokens(1000000000), '1B');
});

test('formats tray usage with cost and tokens', () => {
  // Empty or zero
  assert.equal(formatTrayUsage({}), '$0.00');
  assert.equal(formatTrayUsage({ todayCostUsd: 0, todayTokens: 0 }), '$0.00');

  // Normal positive cost
  assert.equal(formatTrayUsage({ todayCostUsd: 1.25, todayTokens: 45000 }), '$1.25');
  assert.equal(formatTrayUsage({ todayCostUsd: 12.8, todayTokens: 100000 }), '$12.80');

  // Sub-cent cost
  assert.equal(formatTrayUsage({ todayCostUsd: 0.004, todayTokens: 500 }), '<$0.01');

  // Free model (cost 0, but tokens > 0)
  assert.equal(formatTrayUsage({ todayCostUsd: 0, todayTokens: 45200 }), '45.2K tk');
  assert.equal(formatTrayUsage({ todayCostUsd: 0, todayTokens: 800 }), '800 tk');
});
