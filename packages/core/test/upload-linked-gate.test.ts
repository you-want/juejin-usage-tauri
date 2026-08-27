import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { uploadToServer } from '../src/upload/client.js';
import type { TudConfig } from '../src/types.js';

function configFor(dir: string, token: string): TudConfig {
  return {
    deviceId: '550e8400-e29b-41d4-a716-446655440000',
    statsSince: '2026-01-01T00:00:00.000Z',
    hostname: 'test',
    dataDir: dir,
    juejin: {
      enabled: true,
      apiUrl: 'https://example.invalid',
      authMode: 'tbd',
      token,
    },
  };
}

test('uploadToServer skips when token is still the deviceId placeholder', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tud-upload-gate-'));
  try {
    const deviceId = '550e8400-e29b-41d4-a716-446655440000';
    const result = await uploadToServer(dir, configFor(dir, deviceId));
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('uploadToServer skips when token is empty / missing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tud-upload-gate-'));
  try {
    const result = await uploadToServer(dir, configFor(dir, ''));
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
