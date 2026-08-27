import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore, type LocalApiDeps } from '../src/server/state.js';
import type {
  LeaderboardOverviewResponse,
  LeaderboardResponse,
  TudConfig,
} from '../src/types.js';

function config(overrides?: Partial<TudConfig['juejin']>): TudConfig {
  return {
    deviceId: 'device-test',
    statsSince: '2026-01-01T00:00:00.000Z',
    hostname: 'test',
    dataDir: '/tmp/tud-test',
    juejin: {
      enabled: true,
      apiUrl: 'https://usage.example.com',
      authMode: 'bearer',
      token: '11111111-1111-1111-1111-111111111111',
      ...overrides,
    },
  };
}

function appFor(value: TudConfig) {
  const deps: LocalApiDeps = {
    dataDir: value.dataDir,
    getConfig: () => value,
    bucketStore: new BucketStore(),
  };
  return createLocalApiApp(deps);
}

async function envelope<T = LeaderboardResponse>(response: Response): Promise<{
  success: boolean;
  message: string;
  data: T | null;
}> {
  return response.json() as Promise<{
    success: boolean;
    message: string;
    data: T | null;
  }>;
}

test('leaderboard is unconfigured when cloud sync settings are incomplete', async () => {
  const cases = [
    config({ enabled: false }),
    config({ token: null }),
    config({ apiUrl: '' }),
  ];

  for (const value of cases) {
    const response = await appFor(value).request(
      '/functions/tud-leaderboard?days=0&limit=999',
    );
    const body = await envelope(response);
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data?.configured, false);
    assert.equal(body.data?.days, 1);
    assert.equal(body.data?.limit, 50);
    assert.equal(body.data?.metric, 'tokens');
  }
});

test('leaderboard proxy forwards clamped params and bearer token', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let authorization = '';
  const upstream: LeaderboardResponse = {
    configured: true,
    metric: 'cost',
    days: 365,
    limit: 1,
    generatedAt: '2026-07-17T00:00:00.000Z',
    totalUsers: 1,
    rows: [],
    currentUser: null,
  };

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get('Authorization') ?? '';
    return new Response(
      JSON.stringify({ success: true, message: 'ok', data: upstream }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const response = await appFor(config()).request(
      '/functions/tud-leaderboard?days=999&limit=-4&metric=cost',
    );
    const body = await envelope(response);
    assert.equal(response.status, 200);
    assert.equal(body.data?.configured, true);
    assert.equal(
      requestedUrl,
      'https://usage.example.com/functions/tud-leaderboard?days=365&limit=1&metric=cost',
    );
    assert.equal(
      authorization,
      'Bearer 11111111-1111-1111-1111-111111111111',
    );
    assert.equal(body.data?.metric, 'cost');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('leaderboard proxy maps upstream HTTP failures to stable errors', async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    { upstream: 401, status: 401, message: 'LEADERBOARD_UNAUTHENTICATED' },
    { upstream: 429, status: 429, message: 'LEADERBOARD_RATE_LIMITED' },
    { upstream: 500, status: 502, message: 'LEADERBOARD_UPSTREAM_ERROR' },
  ];

  try {
    for (const item of cases) {
      globalThis.fetch = async () => new Response('failed', { status: item.upstream });
      const response = await appFor(config()).request('/functions/tud-leaderboard');
      const body = await envelope(response);
      assert.equal(response.status, item.status);
      assert.equal(body.success, false);
      assert.equal(body.message, item.message);
      assert.equal(body.data, null);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('leaderboard proxy maps network failures to a stable error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('network unavailable');
  };

  try {
    const response = await appFor(config()).request('/functions/tud-leaderboard');
    const body = await envelope(response);
    assert.equal(response.status, 502);
    assert.equal(body.success, false);
    assert.equal(body.message, 'LEADERBOARD_UNAVAILABLE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('leaderboard rejects invalid query values before proxying', async () => {
  const cases = [
    '/functions/tud-leaderboard?days=seven',
    '/functions/tud-leaderboard?limit=1.5',
    '/functions/tud-leaderboard?metric=duration',
  ];

  for (const path of cases) {
    const response = await appFor(config()).request(path);
    const body = await envelope(response);
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.message, 'INVALID_REQUEST');
    assert.equal(body.data, null);
  }
});

test('leaderboard overview returns a stable unconfigured catalog shape', async () => {
  const response = await appFor(config({ enabled: false })).request(
    '/functions/tud-leaderboard-overview?range=all',
  );
  const body = await envelope<LeaderboardOverviewResponse>(response);

  assert.equal(response.status, 200);
  assert.equal(body.data?.configured, false);
  assert.equal(body.data?.range, 'all');
  assert.equal(body.data?.days, null);
  assert.equal(body.data?.limit, 50);
  assert.deepEqual(body.data?.tools, []);
  assert.equal(body.data?.global.tokens.totalUsers, 0);
});

test('leaderboard overview proxy forwards range and clamped limit', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  const emptyBoard = (metric: 'cost' | 'tokens') => ({
    metric,
    totalUsers: 0,
    rows: [],
    currentUser: null,
  });
  const upstream: LeaderboardOverviewResponse = {
    configured: true,
    range: 'month',
    days: 30,
    limit: 50,
    generatedAt: '2026-07-23T00:00:00.000Z',
    global: { cost: emptyBoard('cost'), tokens: emptyBoard('tokens') },
    tools: [],
  };

  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({ success: true, message: 'ok', data: upstream }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    const response = await appFor(config()).request(
      '/functions/tud-leaderboard-overview?range=month&limit=999',
    );
    const body = await envelope<LeaderboardOverviewResponse>(response);
    assert.equal(response.status, 200);
    assert.equal(
      requestedUrl,
      'https://usage.example.com/functions/tud-leaderboard-overview?range=month&limit=50',
    );
    assert.equal(body.data?.range, 'month');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('leaderboard overview rejects invalid range and limit values', async () => {
  for (const path of [
    '/functions/tud-leaderboard-overview?range=quarter',
    '/functions/tud-leaderboard-overview?limit=1.5',
  ]) {
    const response = await appFor(config()).request(path);
    const body = await envelope<LeaderboardOverviewResponse>(response);
    assert.equal(response.status, 400);
    assert.equal(body.message, 'INVALID_REQUEST');
    assert.equal(body.data, null);
  }
});
