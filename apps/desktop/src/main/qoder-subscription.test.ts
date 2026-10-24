import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createQoderSubscriptionReader, loadQoderAccount, parseQoderAppLoginStatus, parseQoderCredentials, type QoderAccount } from './qoder-subscription';

test('accepts an official Qoder session token but ignores unrelated nested values', () => {
  assert.deepEqual(parseQoderCredentials({ auth: { security_oauth_token: 'official-qoder-session-token' } }), {
    token: 'official-qoder-session-token',
  });
  assert.equal(parseQoderCredentials('encrypted-qoder-local-auth-state'), null);
  assert.equal(parseQoderCredentials({ apiKey: 'custom-provider-key' }), null);
});

test('reads only explicit login state from the Qoder app status file', () => {
  assert.equal(parseQoderAppLoginStatus({ logged_in: true }), true);
  assert.equal(parseQoderAppLoginStatus({ loggedIn: false }), false);
  assert.equal(parseQoderAppLoginStatus({ logged_in: 'true' }), null);
  assert.equal(parseQoderAppLoginStatus({ status: 'ready' }), null);
});

const account: QoderAccount = {
  source: 'app', token: 'official-qoder-session-token', identity: 'account-a', expiresAt: null,
};
const usage = { displayMode: 'qoder', qoderUsage: {
  userType: 'Free', userQuota: { total: 0, used: 0 }, addOnQuota: { total: 200, used: 100 },
} };

test('a signed-in App takes precedence over leftover CLI credentials, including permission failures', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'qoder-sources-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, '.auth'));
  await writeFile(path.join(home, '.auth', 'user'), JSON.stringify({ token: 'outdated-cli-account-session-token' }));
  const appAccount = { kind: 'account' as const, ...account, userId: 'app-user', expiresAt: Date.now() + 60_000, validateIdentity: async () => true };
  const selected = await loadQoderAccount({ home, readAppAuth: async () => appAccount });
  assert.ok('token' in selected && selected.token === account.token && selected.source === 'app');
  const denied = await loadQoderAccount({ home, readAppAuth: async () => ({ kind: 'unavailable', message: 'permission required' }) });
  assert.ok('status' in denied && denied.status === 'temporarily-unavailable');
  const cli = await loadQoderAccount({ home, readAppAuth: async () => null });
  assert.ok('source' in cli && cli.source === 'cli');
});

test('reads App usage from its own endpoint and preserves zero and resource-package amounts', async () => {
  const requests: string[] = [];
  const reader = createQoderSubscriptionReader(async () => account, (async (url, init) => {
    requests.push(String(url));
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Cosy-ClientType'), '10');
    return Response.json(String(url).endsWith('/user/plan') ? { userType: 'Free' } : usage);
  }) as typeof fetch);
  const result = await reader({ forceRefresh: true });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.limits.map((limit) => limit.amounts), [
    { total: 0, used: 0, unit: 'Credits' }, { total: 200, used: 100, unit: 'Credits' },
  ]);
  assert.ok(requests.includes('https://openapi.qoder.sh/sash/api/v2/me/usage'));
  assert.equal(requests.some((url) => url.endsWith('/quota/usage')), false);
});

test('retains CLI endpoint compatibility and accepts quota when the optional plan fails', async () => {
  const reader = createQoderSubscriptionReader(async () => ({ ...account, source: 'cli' }), (async (url) => {
    if (String(url).endsWith('/user/plan')) throw new Error('plan failed');
    assert.equal(String(url), 'https://openapi.qoder.sh/api/v2/quota/usage');
    return Response.json(usage.qoderUsage);
  }) as typeof fetch);
  assert.equal((await reader()).status, 'ready');
});

test('does not reuse cached quota after logout or an account change', async () => {
  let selected: QoderAccount | null = account;
  let failing = false;
  const reader = createQoderSubscriptionReader(async () => selected ?? {
    status: 'not-signed-in', planLabel: null, limits: [], fetchedAt: null, stale: false, message: '请先登录 Qoder',
  }, (async () => { if (failing) throw new Error('offline'); return Response.json(usage); }) as typeof fetch);
  assert.equal((await reader()).status, 'ready');
  selected = null;
  assert.equal((await reader()).status, 'not-signed-in');
  selected = { ...account, identity: 'account-b' };
  failing = true;
  assert.deepEqual((await reader()).limits, []);
});

test('drops a successful response when the App identity changes during the request', async () => {
  const reader = createQoderSubscriptionReader(async () => ({ ...account, validateIdentity: async () => false }),
    (async () => Response.json(usage)) as typeof fetch);
  assert.deepEqual((await reader()).limits, []);
});

test('shares concurrent requests, refreshes explicitly and clears readings on auth failure', async () => {
  let calls = 0;
  let expired = false;
  const reader = createQoderSubscriptionReader(async () => account, (async () => {
    calls++;
    return expired ? new Response(null, { status: 401 }) : Response.json(usage);
  }) as typeof fetch);
  await Promise.all([reader(), reader()]);
  assert.equal(calls, 2);
  await reader();
  assert.equal(calls, 2);
  expired = true;
  assert.equal((await reader({ forceRefresh: true })).status, 'expired');
  assert.deepEqual((await reader()).limits, []);
});
