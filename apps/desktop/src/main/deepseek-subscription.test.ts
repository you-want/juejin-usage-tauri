import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCustomDeepSeekConfiguration,
  parseDeepSeekCredentials,
  parseDeepSeekHarnessCredentials,
  fetchDeepSeekBalance,
  mapHarnessWalletBalance,
} from './deepseek-subscription';
import { mapDeepSeekBalance } from '../shared/deepseek-subscription';

test('Harness account grant takes precedence over its API key; rejects foreign issuers', () => {
  const store = { version: 1, refs: { DEEPSEEK_API_KEY: 'sk-example-1234567890' }, records: {
    'deepseek-account-platform/default': { kind: 'grant', payload: {
      version: 1, token: 'test-account-token', issuer: 'https://platform.deepseek.com',
    } },
  } };
  assert.deepEqual(parseDeepSeekHarnessCredentials(JSON.stringify(store)), { token: 'test-account-token', kind: 'harness-account' });
  store.records['deepseek-account-platform/default'].payload.issuer = 'https://foreign.example';
  delete (store as { refs?: unknown }).refs;
  assert.equal(parseDeepSeekHarnessCredentials(JSON.stringify(store)), null);
  assert.deepEqual(parseDeepSeekHarnessCredentials('version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-example-1234567890'), { token: 'sk-example-1234567890', kind: 'harness-api-key' });
});

test('Harness sums CNY recharge and bonus wallets without treating malformed data as zero', () => {
  const value = mapHarnessWalletBalance({ normal_wallets: [{ currency: 'CNY', balance: '12.5' }, { currency: 'USD', balance: '30' }], bonus_wallets: [{ currency: 'CNY', balance: '6' }] });
  const balance = mapDeepSeekBalance(value).limits[0]!;
  assert.equal(balance.remaining, 18.5);
  assert.equal(balance.toppedUp, 12.5);
  assert.equal(balance.granted, 6);
  assert.equal(mapHarnessWalletBalance({ normal_wallets: [], bonus_wallets: null }), null);
  assert.equal(mapHarnessWalletBalance({ normal_wallets: [{ currency: 'CNY', balance: 'invalid' }], bonus_wallets: [] }), null);
  assert.equal(mapDeepSeekBalance(mapHarnessWalletBalance({ normal_wallets: [], bonus_wallets: [] })).limits[0]?.remaining, 0);
});

test('Harness uses its account header and fixed Platform endpoint without following redirects', async () => {
  const response = await fetchDeepSeekBalance({ kind: 'harness-account', token: 'test-account-token' }, (async (url, init) => {
    assert.equal(url, 'https://platform.deepseek.com/api/v0/users/get_user_summary');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-dsh-auth-token'), 'test-account-token');
    assert.equal(headers.has('authorization'), false);
    assert.equal(init?.redirect, 'error');
    return Response.json({ code: 0, data: { biz_code: 0, biz_data: { normal_wallets: [{ currency: 'CNY', balance: '7' }], bonus_wallets: [] } } });
  }) as typeof fetch);
  assert.equal(mapDeepSeekBalance(response.value).limits[0]?.remaining, 7);
  const rejected = await fetchDeepSeekBalance({ kind: 'harness-account', token: 'test-account-token' }, (async () => Response.json({ code: 40003 })) as typeof fetch);
  assert.equal(rejected.status, 401);
  assert.equal(rejected.ok, false);
});

test('accepts DeepSeek tokens from common credential fields but rejects BYOK markers', () => {
  assert.deepEqual(parseDeepSeekCredentials({ api_key: 'sk-deepseek-1234567890abcdef' }), {
    token: 'sk-deepseek-1234567890abcdef',
  });
  assert.deepEqual(parseDeepSeekCredentials({ auth: { token: 'sk-deepseek-abcdef1234567890' } }), {
    token: 'sk-deepseek-abcdef1234567890',
  });
  assert.equal(parseDeepSeekCredentials({ apiKey: '' }), null);
  assert.equal(parseDeepSeekCredentials(null), null);
});

test('accepts only the official DeepSeek API host', () => {
  assert.equal(hasCustomDeepSeekConfiguration({}), false);
  assert.equal(hasCustomDeepSeekConfiguration({ DEEPSEEK_BASE_URL: 'https://api.deepseek.com/' }), false);
  assert.equal(hasCustomDeepSeekConfiguration({ DEEPSEEK_BASE_URL: 'https://proxy.example/v1' }), true);
});
