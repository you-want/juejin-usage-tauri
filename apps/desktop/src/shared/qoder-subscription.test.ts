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
