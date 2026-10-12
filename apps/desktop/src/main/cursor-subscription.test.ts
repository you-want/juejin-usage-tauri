import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCursorSessionCookie, extractCursorUserId } from './cursor-subscription';

function jwt(payload: object): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('extracts the Cursor user id from common JWT subjects', () => {
  assert.equal(extractCursorUserId(jwt({ sub: 'auth0|user_abc123' })), 'user_abc123');
  assert.equal(extractCursorUserId(jwt({ sub: 'google-oauth2|person-id' })), 'google-oauth2|person-id');
  assert.equal(extractCursorUserId('invalid'), null);
});

test('encodes the Cursor dashboard session cookie', () => {
  assert.equal(
    buildCursorSessionCookie('auth0|user', 'a.b-c_d'),
    'WorkosCursorSessionToken=auth0|user%3A%3Aa.b-c_d',
  );
});

test('desktop session user id prefers the JWT subject over CLI authId', () => {
  const token = jwt({ sub: 'auth0|user_live' });
  assert.equal(extractCursorUserId(token), 'user_live');
  assert.equal(extractCursorUserId(token) ?? 'auth0|user_stale', 'user_live');
});

test('fetches Auto/API and Grok Bot with the same account while keeping reset periods separate', async () => {
  const { fetchCursorSubscription } = await import('./cursor-subscription.js');
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return Response.json(url.endsWith('usage-summary') ? {
      billingCycleEnd: '2026-11-01T00:00:00Z', membershipType: 'pro',
      individualUsage: { plan: { autoPercentUsed: 20, apiPercentUsed: 40 } },
    } : { includedLimitZero: false, usagePercent: 70, nextResetTimestampUtc: '2026-10-08T00:00:00Z' });
  }) as typeof fetch;
  const snapshot = await fetchCursorSubscription({ userId: 'test-user', token: 'test-token' }, fetchImpl);
  assert.equal(snapshot.cursorModels?.usedPercent, 20);
  assert.equal(snapshot.otherModels?.usedPercent, 40);
  assert.equal(snapshot.grokBot?.usedPercent, 70);
  assert.notEqual(snapshot.cursorModels?.resetsAt, snapshot.grokBot?.resetsAt);
  assert.equal(calls.length, 2);
  const bot = calls.find(({ url }) => url.endsWith('get-sand-usage-status'))!;
  assert.equal(bot.init?.method, 'POST');
  assert.equal(bot.init?.body, '{}');
  for (const { init } of calls) assert.equal(new Headers(init?.headers).get('Cookie'), buildCursorSessionCookie('test-user', 'test-token'));
});

test('optional Grok Bot failures do not hide valid Cursor pools', async () => {
  const { fetchCursorSubscription } = await import('./cursor-subscription.js');
  for (const failure of ['network', 'auth', 'malformed', 'no-entitlement']) {
    const fetchImpl = (async (input: string | URL | Request) => {
      if (String(input).endsWith('usage-summary')) return Response.json({ individualUsage: { plan: { autoPercentUsed: 20 } } });
      if (failure === 'network') throw new Error('timeout');
      if (failure === 'auth') return new Response('', { status: 403 });
      if (failure === 'malformed') return new Response('invalid json');
      return Response.json({ includedLimitZero: true, usagePercent: 0 });
    }) as typeof fetch;
    const snapshot = await fetchCursorSubscription({ userId: 'test-user', token: 'test-token' }, fetchImpl);
    assert.equal(snapshot.status, 'ready', failure);
    assert.equal(snapshot.cursorModels?.usedPercent, 20, failure);
    assert.equal(snapshot.grokBot, undefined, failure);
  }
});
