import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { loadConfig } from '../src/config.js';
import { configPath } from '../src/paths.js';
import { createLocalApiApp } from '../src/server/local-api.js';
import { BucketStore } from '../src/server/state.js';
import type { TudConfig, TudConfigUpdate, TudConfigView } from '../src/types.js';

/** Wait until background profile fetch has settled far enough for cache writes. */
async function settleProfileRefresh(fetchMock: { mock: { callCount: () => number } }, calls = 1) {
  for (let i = 0; i < 50; i += 1) {
    if (fetchMock.mock.callCount() >= calls) {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`profile fetch did not reach ${calls} call(s)`);
}

async function fixture(
  t: TestContext,
  onConfigChange?: (config: TudConfig) => void,
) {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('offline fixture');
  });
  const dir = await mkdtemp(join(tmpdir(), 'tud-config-api-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { config } = await loadConfig(dir);
  const app = createLocalApiApp({
    dataDir: dir,
    getConfig: () => config,
    bucketStore: new BucketStore(),
    onConfigChange,
  });
  // Keep the intentional filesystem failure below out of the test console.
  app.onError(() => new Response('Internal Server Error', { status: 500 }));
  return {
    dir,
    config,
    app,
    fetchMock,
    readSaved: async () =>
      JSON.parse(await readFile(configPath(dir), 'utf8')) as TudConfig,
    update: (body: TudConfigUpdate) =>
      app.request('/functions/tud-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}

test('refreshes linked account profile in the background without blocking or writing credentials', async (t) => {
  const f = await fixture(t);
  await f.update({ juejin: {
    enabled: false,
    token: 'private-session-token',
    originUserId: '1234567890123456',
    userName: 'Old name',
    avatarLarge: 'https://example.invalid/old.png',
  } });
  const before = structuredClone(f.config);
  f.fetchMock.mock.mockImplementation(async (input, init) => {
    assert.equal(String(input), 'https://api.juejin.cn/user_api/v1/user/get?user_id=1234567890123456');
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    assert.equal(new Headers(init?.headers).get('cookie'), null);
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ err_no: 0, data: {
      user_id: '1234567890123456',
      user_name: 'New name',
      avatar_large: 'https://example.invalid/new.png',
    } });
  });

  const cold = await f.app.request('/functions/tud-config');
  const coldBody = await cold.json() as { data: TudConfigView };
  assert.equal(coldBody.data.juejin.userName, 'Old name');
  assert.equal(coldBody.data.juejin.avatarLarge, 'https://example.invalid/old.png');
  assert.equal(f.fetchMock.mock.callCount(), 1);

  await settleProfileRefresh(f.fetchMock);
  const warm = await f.app.request('/functions/tud-config');
  const body = await warm.json() as { data: TudConfigView };
  assert.equal(body.data.juejin.userName, 'New name');
  assert.equal(body.data.juejin.avatarLarge, 'https://example.invalid/new.png');
  assert.equal(body.data.juejin.originUserId, '1234567890123456');
  assert.deepEqual(f.config, before);
  assert.deepEqual(await f.readSaved(), before);
  assert.equal(f.fetchMock.mock.callCount(), 1);
});

test('deduplicates profile requests and keeps the cached view when toggling sync', async (t) => {
  const f = await fixture(t);
  // Legacy accounts keep the public user ID directly in token.
  await f.update({ juejin: { enabled: false, token: '12345678', userName: 'Old name' } });
  let release!: (response: Response) => void;
  f.fetchMock.mock.mockImplementation(() => new Promise<Response>((resolve) => { release = resolve; }));

  const first = await f.app.request('/functions/tud-config');
  const second = await f.app.request('/functions/tud-config');
  assert.equal(f.fetchMock.mock.callCount(), 1);
  assert.equal((await first.json() as { data: TudConfigView }).data.juejin.userName, 'Old name');
  assert.equal((await second.json() as { data: TudConfigView }).data.juejin.userName, 'Old name');

  release(Response.json({ err_no: 0, data: {
    user_id: '12345678', user_name: 'New name', avatar_large: 'https://example.invalid/new.png',
  } }));
  await settleProfileRefresh(f.fetchMock);

  // PUT returns the persisted snapshot; only GET overlays the refreshed cache.
  const toggle = await f.update({ juejin: { enabled: false } });
  assert.equal((await toggle.json() as { data: TudConfigView }).data.juejin.userName, 'Old name');
  const cached = await f.app.request('/functions/tud-config');
  assert.equal((await cached.json() as { data: TudConfigView }).data.juejin.userName, 'New name');
  assert.equal(f.fetchMock.mock.callCount(), 1);

  await f.update({ juejin: { userName: 'Explicit name' } });
  f.fetchMock.mock.mockImplementation(async () => { throw new Error('offline'); });
  const updated = await f.app.request('/functions/tud-config');
  assert.equal((await updated.json() as { data: TudConfigView }).data.juejin.userName, 'Explicit name');
  await settleProfileRefresh(f.fetchMock, 2);
  assert.equal(f.fetchMock.mock.callCount(), 2);
});

test('refreshes expired profile cache and preserves the last successful profile on failure', async (t) => {
  const f = await fixture(t);
  await f.update({ juejin: { enabled: false, token: '12345678', userName: 'Old name' } });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  f.fetchMock.mock.mockImplementation(async () => Response.json({ err_no: 0, data: {
    user_id: '12345678', user_name: 'New name', avatar_large: 'https://example.invalid/new.png',
  } }));
  await f.app.request('/functions/tud-config');
  await settleProfileRefresh(f.fetchMock);

  now += 5 * 60 * 1000 + 1;
  f.fetchMock.mock.mockImplementation(async () => { throw new Error('offline'); });
  const response = await f.app.request('/functions/tud-config');
  const body = await response.json() as { data: TudConfigView };
  assert.equal(body.data.juejin.userName, 'New name');
  assert.equal(body.data.juejin.avatarLarge, 'https://example.invalid/new.png');
  await settleProfileRefresh(f.fetchMock, 2);
  await f.app.request('/functions/tud-config');
  assert.equal(f.fetchMock.mock.callCount(), 2);
});

for (const [label, upstream] of [
  ['HTTP failure', () => new Response('unavailable', { status: 503 })],
  ['invalid JSON', () => new Response('invalid json')],
  ['upstream error', () => Response.json({ err_no: 1, data: null })],
  ['wrong account', () => Response.json({ err_no: 0, data: {
    user_id: '87654321', user_name: 'Wrong user', avatar_large: 'https://example.invalid/new.png',
  } })],
  ['invalid profile', () => Response.json({ err_no: 0, data: {
    user_id: '12345678', user_name: 'New name', avatar_large: 'javascript:alert(1)',
  } })],
] as const) {
  test(`profile ${label} preserves existing details and throttles retries`, async (t) => {
    const f = await fixture(t);
    await f.update({ juejin: {
      enabled: false,
      token: '12345678', userName: 'Old name', avatarLarge: 'https://example.invalid/old.png',
    } });
    f.fetchMock.mock.mockImplementation(async () => upstream());
    for (let i = 0; i < 2; i += 1) {
      const response = await f.app.request('/functions/tud-config');
      assert.equal(response.status, 200);
      const body = await response.json() as { data: TudConfigView };
      assert.equal(body.data.juejin.userName, 'Old name');
      assert.equal(body.data.juejin.avatarLarge, 'https://example.invalid/old.png');
    }
    await settleProfileRefresh(f.fetchMock);
    assert.equal(f.fetchMock.mock.callCount(), 1);
  });
}

test('skips profile requests for unlinked accounts or missing public user IDs', async (t) => {
  const f = await fixture(t);
  const cases = [
    { token: null, originUserId: '12345678' },
    { token: f.config.deviceId, originUserId: '12345678' },
    { token: 'private-session-token', originUserId: null },
    { token: 'private-session-token', originUserId: 'not-a-public-id' },
  ];
  for (const account of cases) {
    Object.assign(f.config.juejin, account);
    assert.equal((await f.app.request('/functions/tud-config')).status, 200);
  }
  assert.equal(f.fetchMock.mock.callCount(), 0);
});

for (const switchAccount of [false, true]) {
  test(`an in-flight profile cannot leak after ${switchAccount ? 'switching accounts' : 'logout'}`, async (t) => {
    const f = await fixture(t);
    await f.update({ juejin: { enabled: false, token: '12345678', userName: 'Old name' } });
    let release!: (response: Response) => void;
    f.fetchMock.mock.mockImplementation(() => new Promise<Response>((resolve) => { release = resolve; }));

    const cold = await f.app.request('/functions/tud-config');
    assert.equal((await cold.json() as { data: TudConfigView }).data.juejin.userName, 'Old name');
    assert.equal(f.fetchMock.mock.callCount(), 1);

    await f.update({ juejin: {
      token: switchAccount ? '87654321' : null,
      originUserId: switchAccount ? '87654321' : null,
      userName: switchAccount ? 'Other account' : null,
      avatarLarge: null,
    } });
    release(Response.json({ err_no: 0, data: {
      user_id: '12345678', user_name: 'Stale account', avatar_large: 'https://example.invalid/stale.png',
    } }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const after = await f.app.request('/functions/tud-config');
    const body = await after.json() as { data: TudConfigView };
    assert.equal(body.data.juejin.userName, switchAccount ? 'Other account' : null);
    assert.equal(body.data.juejin.avatarLarge, null);
    assert.equal(body.data.juejin.originUserId, switchAccount ? '87654321' : null);
  });
}

for (const apiUrl of ['invalid-url', 'file:///tmp/config', 'javascript:void(0)']) {
  test(`rejected API URL ${apiUrl} leaves the active and saved config unchanged`, async (t) => {
    let notifications = 0;
    const f = await fixture(t, () => { notifications += 1; });
    const before = structuredClone(f.config);

    const response = await f.update({ juejin: { enabled: false, apiUrl } });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { message: string }).message, 'INVALID_API_URL');
    assert.deepEqual(f.config, before);
    assert.deepEqual(await f.readSaved(), before);
    assert.equal(notifications, 0);

    const readback = await f.app.request('/functions/tud-config');
    const body = await readback.json() as { data: TudConfigView };
    assert.equal(body.data.juejin.enabled, before.juejin.enabled);
  });
}

test('a failed config save does not change active settings or notify listeners', async (t) => {
  let notifications = 0;
  const f = await fixture(t, () => { notifications += 1; });
  const before = structuredClone(f.config);
  // A directory at the destination deterministically rejects writeFile on all
  // platforms without depending on user privileges or filesystem permissions.
  await rm(configPath(f.dir));
  await mkdir(configPath(f.dir));

  const response = await f.update({
    juejin: { enabled: false, apiUrl: 'https://example.invalid/usage', userName: 'changed' },
  });
  assert.equal(response.status, 500);
  assert.deepEqual(f.config, before);
  assert.equal(notifications, 0);
});

for (const withListener of [false, true]) {
  test(`valid config updates persist and remain readable ${withListener ? 'with' : 'without'} a listener`, async (t) => {
    const notifications: TudConfig[] = [];
    const f = await fixture(t, withListener ? (next) => { notifications.push(next); } : undefined);
    const before = structuredClone(f.config);

    const response = await f.update({
      juejin: {
        enabled: false,
        apiUrl: ' https://example.invalid/usage ',
        token: ' "12345678" ',
        userName: ' Fixture User ',
        avatarLarge: ' https://example.invalid/avatar.png ',
      },
    });
    assert.equal(response.status, 200);
    const expected: TudConfig = {
      ...before,
      juejin: {
        ...before.juejin,
        enabled: false,
        apiUrl: 'https://example.invalid/usage',
        token: '12345678',
        originUserId: '12345678',
        userName: 'Fixture User',
        avatarLarge: 'https://example.invalid/avatar.png',
      },
    };
    assert.deepEqual(await f.readSaved(), expected);
    assert.deepEqual(f.config, expected);
    assert.equal(notifications.length, withListener ? 1 : 0);
    if (withListener) assert.strictEqual(notifications[0], f.config);

    const readback = await f.app.request('/functions/tud-config');
    assert.deepEqual(await readback.json(), await response.json());

    const clear = await f.update({
      juejin: { token: null, originUserId: null, userName: null, avatarLarge: null },
    });
    assert.equal(clear.status, 200);
    assert.equal(f.config.juejin.token, null);
    assert.equal(f.config.juejin.originUserId, null);
    assert.equal(f.config.juejin.userName, null);
    assert.equal(f.config.juejin.avatarLarge, null);
    assert.deepEqual(await f.readSaved(), f.config);
  });
}
