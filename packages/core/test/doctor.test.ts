import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { DEFAULT_JUEJIN_API_URL } from '../src/config.js';
import { runDoctorDiagnostics } from '../src/doctor.js';
import { cursorsPath } from '../src/paths.js';
import { pidFilePath } from '../src/runtime-pid.js';
import { SYNC_SOURCE_IDS } from '../src/sync/index.js';
import type { TudConfig } from '../src/types.js';

function mockConfig(dir: string, overrides: Partial<TudConfig> = {}): TudConfig {
  return {
    deviceId: 'test-device-uuid',
    hostname: 'test-host',
    dataDir: dir,
    statsSince: '2026-01-01T00:00:00.000Z',
    juejin: {
      enabled: false,
      apiUrl: DEFAULT_JUEJIN_API_URL,
      authMode: 'manual',
      token: null,
    },
    ...overrides,
  };
}

async function withIsolatedConfigHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), 'jusage-doctor-cfg-home-'));
  const prev = process.env.JUSAGE_CONFIG_HOME;
  process.env.JUSAGE_CONFIG_HOME = home;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.JUSAGE_CONFIG_HOME;
    else process.env.JUSAGE_CONFIG_HOME = prev;
  }
}

function findItem(
  report: Awaited<ReturnType<typeof runDoctorDiagnostics>>,
  categoryId: string,
  itemId: string,
) {
  const category = report.categories.find((c) => c.id === categoryId);
  assert.ok(category, `missing category ${categoryId}`);
  const item = category.items.find((i) => i.id === itemId);
  assert.ok(item, `missing item ${itemId}`);
  return item;
}

test('runDoctorDiagnostics returns structured diagnostic report', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'jusage-doctor-test-'));
  const report = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    port: 65432,
    skipNetworkProbe: true,
  });

  assert.ok(report.timestamp);
  assert.equal(report.categories.length, 4);

  const nodeItem = findItem(report, 'runtime', 'runtime-node');
  assert.equal(nodeItem.status, 'ok');

  const dataDirItem = findItem(report, 'storage', 'storage-datadir');
  assert.equal(dataDirItem.status, 'ok');

  const collectorsCat = report.categories.find((c) => c.id === 'collectors');
  assert.ok(collectorsCat);
  assert.equal(report.collectors.total, SYNC_SOURCE_IDS.length);

  const networkCat = report.categories.find((c) => c.id === 'network');
  assert.ok(networkCat);

  assert.ok(report.summary.okCount > 0);
  assert.equal(typeof report.summary.errorCount, 'number');
  assert.equal(typeof report.summary.warnCount, 'number');
});

test('collectors use sync source ids, not catalog integration keys', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'jusage-doctor-collectors-'));
  const report = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    skipNetworkProbe: true,
  });

  const keys = report.collectors.items.map((item) => item.key);
  assert.deepEqual(keys, [...SYNC_SOURCE_IDS]);
  assert.equal(
    report.collectors.items.find((item) => item.key === 'claude-code'),
    undefined,
  );
  assert.equal(
    report.collectors.items.find((item) => item.key === 'qwen-code'),
    undefined,
  );

  const claude = report.collectors.items.find((item) => item.key === 'claude');
  assert.ok(claude);
  assert.equal(claude.displayName, 'Claude Code');
  assert.ok(claude.hookStatus === 'active' || claude.hookStatus === 'inactive');

  const qwen = report.collectors.items.find((item) => item.key === 'qwen');
  assert.ok(qwen);
  assert.equal(qwen.displayName, 'Qwen Code');
  assert.equal(qwen.hookStatus, undefined);

  const qwenwork = report.collectors.items.find((item) => item.key === 'qwenwork');
  assert.ok(qwenwork);
  assert.equal(qwenwork.displayName, 'QwenWork');

  const commandCode = report.collectors.items.find((item) => item.key === 'command-code');
  assert.ok(commandCode);
  assert.equal(commandCode.displayName, 'Command Code');
});

test('runDoctorDiagnostics clears a stale tud.pid lock', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'jusage-doctor-pid-test-'));
  const deadPid = 9999999;
  await writeFile(
    join(tempDir, 'tud.pid'),
    JSON.stringify({ pid: deadPid, kind: 'cli' }),
  );

  const report = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    skipNetworkProbe: true,
  });

  const pidItem = findItem(report, 'runtime', 'runtime-pid');
  assert.equal(pidItem.status, 'info');
  assert.match(pidItem.message, /已清理失效的锁文件/);
  assert.ok(pidItem.message.includes(String(deadPid)));
  assert.equal(existsSync(pidFilePath(tempDir)), false);
  assert.equal(
    report.summary.suggestions.some((s) => s.includes('rm') || s.includes('Remove-Item')),
    false,
  );
});

test('unreadable tud.pid is cleared and reported', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'jusage-doctor-pid-junk-'));
  await writeFile(join(tempDir, 'tud.pid'), 'not-a-pid');

  const report = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    skipNetworkProbe: true,
  });

  const pidItem = findItem(report, 'runtime', 'runtime-pid');
  assert.equal(pidItem.status, 'info');
  assert.match(pidItem.message, /已清理无法识别的 tud\.pid/);
  assert.equal(existsSync(pidFilePath(tempDir)), false);
});

test('cursors are read from cursorsPath, not queue/cursors.json', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'jusage-doctor-cursors-'));
  await mkdir(join(tempDir, 'queue'), { recursive: true });
  await writeFile(join(tempDir, 'queue', 'cursors.json'), '{"claude":{}}');

  const misplaced = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    skipNetworkProbe: true,
  });
  const misplacedItem = findItem(misplaced, 'storage', 'storage-cursors');
  assert.equal(misplacedItem.status, 'info');
  assert.match(misplacedItem.message, /尚未产生/);

  await writeFile(cursorsPath(tempDir), '{"claude":{},"codex":{}}');
  const placed = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir),
    skipNetworkProbe: true,
  });
  const placedItem = findItem(placed, 'storage', 'storage-cursors');
  assert.equal(placedItem.status, 'ok');
  assert.match(placedItem.message, /2 个数据源/);
});

test('placeholder deviceId token is treated as unlinked', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'jusage-doctor-token-'));
  const report = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir, {
      juejin: {
        enabled: true,
        apiUrl: DEFAULT_JUEJIN_API_URL,
        authMode: 'manual',
        token: 'test-device-uuid',
      },
    }),
    skipNetworkProbe: true,
  });

  const tokenItem = findItem(report, 'network', 'cloud-token');
  assert.equal(tokenItem.status, 'warn');
  assert.match(tokenItem.message, /尚未配置有效 Token/);
});

test('panel port falls back to config.serverPort', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'jusage-doctor-port-'));
  const report = await runDoctorDiagnostics({
    dataDir: tempDir,
    config: mockConfig(tempDir, { serverPort: 9000 }),
    skipNetworkProbe: true,
  });

  const portItem = findItem(report, 'runtime', 'runtime-port');
  assert.match(portItem.message, /9000/);
});

test('HTTP 5xx still counts as cloud API reachable', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'jusage-doctor-http-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
  try {
    const report = await runDoctorDiagnostics({
      dataDir: tempDir,
      config: mockConfig(tempDir),
    });
    const networkItem = findItem(report, 'network', 'cloud-network');
    assert.equal(networkItem.status, 'ok');
    assert.match(networkItem.message, /正常连通/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadConfig failure falls back to DEFAULT_JUEJIN_API_URL', async () => {
  const originalFetch = globalThis.fetch;
  const probed: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    probed.push(String(input));
    return new Response('', { status: 200 });
  }) as typeof fetch;
  try {
    const parent = await mkdtemp(join(tmpdir(), 'jusage-doctor-fallback-'));
    const badDir = join(parent, 'not-a-dir');
    await writeFile(badDir, 'not-a-directory');
    const report = await runDoctorDiagnostics({ dataDir: badDir });
    assert.equal(probed[0], DEFAULT_JUEJIN_API_URL);
    const configItem = findItem(report, 'storage', 'storage-config');
    assert.equal(configItem.status, 'error');
    assert.match(configItem.message, /config\.json/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('corrupt config.json is reported as recovered, not healthy', async () => {
  await withIsolatedConfigHome(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jusage-doctor-corrupt-'));
    await writeFile(join(dir, 'config.json'), '{not-json', 'utf8');
    const report = await runDoctorDiagnostics({
      dataDir: dir,
      skipNetworkProbe: true,
    });
    const configItem = findItem(report, 'storage', 'storage-config');
    assert.equal(configItem.status, 'warn');
    assert.match(configItem.message, /已自动恢复/);
    assert.match(configItem.detail ?? '', /config\.json\.bak/);
  });
});
