import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { IngestBucket } from '../src/types.js';
import {
  clearUploadSlot,
  diffUploadBuckets,
  getUploadSlot,
  loadUploadStateFile,
  normalizeApiUrl,
  saveUploadStateFile,
  setUploadSlot,
} from '../src/upload/state.js';
import {
  computeUploadWindow,
  filterBucketsByScanFrom,
  hourFloorIso,
  maxIso,
  minIso,
} from '../src/upload/window.js';

function bucket(hour: string, tokens = 10): IngestBucket {
  return {
    hour_start: hour,
    source: 'claude',
    model: 'claude-opus-4-6',
    input_tokens: tokens,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: tokens,
    conversation_count: 1,
  };
}

test('normalizeApiUrl strips trailing slash', () => {
  assert.equal(normalizeApiUrl('https://a.example/'), 'https://a.example');
  assert.equal(normalizeApiUrl(' https://a.example/// '), 'https://a.example');
});

test('maxIso picks the latest timestamp', () => {
  assert.equal(
    maxIso('2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
    '2026-06-01T00:00:00.000Z',
  );
});

test('minIso picks the earliest timestamp', () => {
  assert.equal(
    minIso('2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
    '2026-01-01T00:00:00.000Z',
  );
});

test('hourFloorIso zeros minutes', () => {
  assert.equal(
    hourFloorIso('2026-07-22T14:32:11.123Z'),
    '2026-07-22T14:00:00.000Z',
  );
});

test('computeUploadWindow uses max(local, ingestMin) and dataThrough', () => {
  const w = computeUploadWindow({
    localStatsSince: '2026-01-01T00:00:00.000Z',
    ingestMinOccurredAt: '2026-03-01T00:00:00.000Z',
    dataThrough: '2026-07-22T14:32:00.000Z',
  });
  assert.equal(w.effectiveSince, '2026-03-01T00:00:00.000Z');
  assert.equal(w.scanFrom, '2026-07-22T14:00:00.000Z');
});

test('computeUploadWindow without dataThrough uses effectiveSince', () => {
  const w = computeUploadWindow({
    localStatsSince: '2026-05-01T00:00:00.000Z',
    ingestMinOccurredAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(w.scanFrom, '2026-05-01T00:00:00.000Z');
});

test('filterBucketsByScanFrom keeps boundary hour', () => {
  const rows = [
    bucket('2026-07-22T13:00:00.000Z'),
    bucket('2026-07-22T14:00:00.000Z'),
    bucket('2026-07-22T15:00:00.000Z'),
  ];
  const filtered = filterBucketsByScanFrom(rows, '2026-07-22T14:00:00.000Z');
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0]!.hour_start, '2026-07-22T14:00:00.000Z');
});

test('upload slots are isolated per apiUrl and deviceId', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-upload-state-'));
  let file = await loadUploadStateFile(dir);

  const aUrl = 'https://a.example';
  const bUrl = 'https://b.example';
  const deviceA = '11111111-1111-1111-1111-111111111111';
  const deviceB = '22222222-2222-2222-2222-222222222222';

  const { nextState } = diffUploadBuckets(
    [bucket('2026-07-01T00:00:00.000Z', 5)],
    { buckets: {} },
  );
  file = setUploadSlot(file, aUrl, deviceA, nextState);
  await saveUploadStateFile(dir, file);

  file = await loadUploadStateFile(dir);
  assert.equal(Object.keys(getUploadSlot(file, aUrl, deviceA).buckets).length, 1);
  assert.equal(Object.keys(getUploadSlot(file, aUrl, deviceB).buckets).length, 0);
  assert.equal(Object.keys(getUploadSlot(file, bUrl, deviceA).buckets).length, 0);

  file = setUploadSlot(file, bUrl, deviceA, nextState);
  await saveUploadStateFile(dir, file);
  file = await loadUploadStateFile(dir);
  assert.equal(Object.keys(getUploadSlot(file, aUrl, deviceA).buckets).length, 1);
  assert.equal(Object.keys(getUploadSlot(file, bUrl, deviceA).buckets).length, 1);

  file = clearUploadSlot(file, bUrl, deviceA);
  await saveUploadStateFile(dir, file);
  file = await loadUploadStateFile(dir);
  assert.equal(Object.keys(getUploadSlot(file, aUrl, deviceA).buckets).length, 1);
  assert.equal(Object.keys(getUploadSlot(file, bUrl, deviceA).buckets).length, 0);
});

test('v1 upload.state migrates to empty v2 (no stale cross-remote hashes)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-upload-v1-'));
  await writeFile(
    join(dir, 'upload.state.json'),
    JSON.stringify({
      buckets: { 'claude|m|2026-07-01T00:00:00.000Z': 'deadbeefdeadbeef' },
    }),
  );
  const file = await loadUploadStateFile(dir);
  assert.equal(file.version, 2);
  assert.deepEqual(file.remotes, {});
  const raw = await readFile(join(dir, 'upload.state.json'), 'utf8');
  assert.match(raw, /deadbeef/);
});
