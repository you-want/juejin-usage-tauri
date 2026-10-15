import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapQoderQuota,
  qoderRemainingPercent,
  qoderSubscriptionHasAccount,
  type QoderSubscriptionSnapshot,
} from './qoder-subscription';

test('retains personal, add-on and shared Qoder pools separately', () => {
  const mapped = mapQoderQuota({
    data: {
      userQuota: { total: 1_000, used: 250 },
      addOnQuota: { percentage: 0.195 },
      orgResourcePackage: { percentage: 3 },
      expiresAt: 1_900_000_000,
    },
  }, { data: { planTierName: 'Qoder Pro' } });
  assert.equal(mapped.planLabel, 'Qoder Pro');
  assert.deepEqual(mapped.limits.map((limit) => [limit.id, limit.label, limit.usedPercent]), [
    ['plan', 'Credits', 25],
    ['add-on', 'Add-on Credits', 19.5],
    ['shared', 'Shared Credits', 3],
  ]);
  assert.equal(mapped.limits[0].resetsAt, 1_900_000_000);
});

test('uses the cached quota response membership type when the plan endpoint is unavailable', () => {
  const mapped = mapQoderQuota({
    userType: 'personal_professional',
    userQuota: { total: 1_000, used: 250 },
  }, null);

  assert.equal(mapped.planLabel, 'Pro');
});

test('keeps an empty plan and resource-package balance from Qoder App usage', () => {
  const mapped = mapQoderQuota({
    qoderUsage: {
      userQuota: { total: 0, used: 0, remaining: 0 },
      addOnQuota: { total: 200, used: 100, remaining: 100, percentage: 0.5 },
    },
  }, null);

  assert.deepEqual(mapped.limits.map((limit) => [limit.id, limit.usedPercent, limit.amounts]), [
    ['plan', 0, { total: 0, used: 0, remaining: 0, unit: 'Credits' }],
    ['add-on', 50, { total: 200, used: 100, remaining: 100, unit: 'Credits' }],
  ]);
});

test('uses amounts before percentages and preserves raw quota ratios', () => {
  const mapped = mapQoderQuota({
    data: {
      qoderUsage: {
        userQuota: { total: 200, used: 2, percentage: 1 },
        addOnQuota: { percentage: 0.01 },
        orgResourcePackage: { total: 200, remaining: 100, percentage: 0 },
        dedicatedResourcePackages: [{ percentage: 0.5 }],
      },
    },
  }, null);

  assert.deepEqual(mapped.limits.map((limit) => limit.usedPercent), [1, 1, 50, 50]);
});

test('omits Qoder unlimited-expiry placeholders in either timestamp unit or ISO format', () => {
  for (const expiresAt of [253_402_214_400, 253_402_214_400_000, '253402214400000', '9999-12-31T00:00:00Z']) {
    const mapped = mapQoderQuota({ qoderUsage: {
      userQuota: { total: 0, used: 0 },
      addOnQuota: { total: 200, used: 100 },
      expiresAt,
    } }, null);
    assert.deepEqual(mapped.limits.map((limit) => limit.resetsAt), [null, null], String(expiresAt));
  }
});

test('preserves normal Qoder expiry dates in either timestamp unit or ISO format', () => {
  for (const expiresAt of [1_900_000_000, 1_900_000_000_000, '1900000000000', new Date(1_900_000_000_000).toISOString()]) {
    const mapped = mapQoderQuota({ userQuota: { total: 200, used: 100 }, expiresAt }, null);
    assert.equal(mapped.limits[0].resetsAt, 1_900_000_000, String(expiresAt));
  }
});

test('clamps Qoder remaining percentage', () => {
  assert.equal(qoderRemainingPercent(0), 100);
  assert.equal(qoderRemainingPercent(71), 29);
  assert.equal(qoderRemainingPercent(150), 0);
});

test('keeps only confirmed Qoder accounts visible without quota data', () => {
  const snapshot = (status: QoderSubscriptionSnapshot['status']): QoderSubscriptionSnapshot => ({
    status,
    planLabel: null,
    limits: [],
    fetchedAt: null,
    stale: false,
    message: null,
  });

  assert.equal(qoderSubscriptionHasAccount(snapshot('not-installed')), false);
  assert.equal(qoderSubscriptionHasAccount(snapshot('not-signed-in')), false);
  assert.equal(qoderSubscriptionHasAccount(snapshot('temporarily-unavailable')), true);
  assert.equal(qoderSubscriptionHasAccount(snapshot('expired')), true);
  assert.equal(qoderSubscriptionHasAccount(snapshot('ready')), true);
});
