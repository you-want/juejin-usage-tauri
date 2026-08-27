import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SYNC_SOURCE_IDS, syncAllStaggered } from '../src/sync/index.js';
import type { TudConfig } from '../src/types.js';

function baseConfig(dataDir: string): TudConfig {
  return {
    deviceId: '550e8400-e29b-41d4-a716-446655440000',
    statsSince: '2026-01-01T00:00:00.000Z',
    hostname: 'test',
    dataDir,
    juejin: {
      enabled: false,
      apiUrl: 'http://127.0.0.1:8787',
      authMode: 'tbd',
      token: null,
    },
    serverPort: 8452,
    lastSyncAt: null,
  };
}

test('syncAllStaggered visits sources with gaps and skips missing installs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-stagger-'));
  try {
    const seen: string[] = [];
    const gaps: number[] = [];
    let last = Date.now();

    const results = await syncAllStaggered(dir, baseConfig(dir), {
      gapMs: 20,
      onSourceDone: async (result) => {
        const now = Date.now();
        gaps.push(now - last);
        last = now;
        seen.push(result.source);
      },
    });

    assert.equal(results.length, SYNC_SOURCE_IDS.length);
    assert.equal(seen.length, SYNC_SOURCE_IDS.length);
    assert.deepEqual(
      seen,
      SYNC_SOURCE_IDS.map((id) => id),
    );
    // Gaps between sources (ignore first) should be roughly >= gapMs.
    const between = gaps.slice(1);
    assert.ok(between.length > 0);
    assert.ok(between.every((g) => g >= 10));
    // At least claude always runs (not skipped via presence); skipped count is environment-dependent.
    assert.ok(results.some((r) => r.source === 'claude'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
