import assert from 'node:assert/strict';
import test from 'node:test';

import type { IngestBucket } from '../src/types.js';
import {
  BACKFILL_HOLD_MS,
  applyBackfillFailure,
  applyIngestHold,
  backfillRetryDelayMs,
  enqueueBackfillKeys,
  hourStartFromIngestKey,
  liveCutoffIso,
  pruneBackfillItems,
  selectDrainBatch,
  shouldCommitBackfillBatch,
  splitLiveAndBackfill,
} from '../src/upload/backfill.js';
import type { UploadSlotState } from '../src/upload/state.js';

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

test('hourStartFromIngestKey reads the last ISO field', () => {
  assert.equal(
    hourStartFromIngestKey('claude||claude-opus-4-6|2026-05-21T00:00:00.000Z'),
    '2026-05-21T00:00:00.000Z',
  );
});

test('splitLiveAndBackfill sends last 48h live when slot is empty', () => {
  const nowMs = Date.parse('2026-08-19T12:00:00.000Z');
  const slot: UploadSlotState = { buckets: {} };
  const { live, backfill } = splitLiveAndBackfill(
    [
      bucket('2026-08-18T12:00:00.000Z'),
      bucket('2026-07-01T00:00:00.000Z'),
    ],
    slot,
    nowMs,
  );
  assert.equal(live.length, 1);
  assert.equal(live[0]!.hour_start, '2026-08-18T12:00:00.000Z');
  assert.equal(backfill.length, 1);
  assert.equal(backfill[0]!.hour_start, '2026-07-01T00:00:00.000Z');
});

test('liveCutoffIso unions slot range with last 48h', () => {
  const nowMs = Date.parse('2026-08-19T12:00:00.000Z');
  const slot: UploadSlotState = {
    buckets: {
      'claude||m|2026-08-12T00:00:00.000Z': 'abc',
    },
  };
  const cutoff = liveCutoffIso(slot, nowMs);
  assert.equal(cutoff, '2026-08-12T00:00:00.000Z');
});

test('enqueueBackfillKeys dedupes against existing items', () => {
  const slot: UploadSlotState = {
    buckets: { 'claude||m|2026-07-01T00:00:00.000Z': 'hash' },
    backfill: {
      items: [
        { key: 'claude||m|2026-07-02T00:00:00.000Z', attempts: 0, nextRetryAt: null },
      ],
    },
  };
  const { added, slot: next } = enqueueBackfillKeys(slot, [
    'claude||m|2026-07-01T00:00:00.000Z',
    'claude||m|2026-07-02T00:00:00.000Z',
    'claude||m|2026-07-03T00:00:00.000Z',
  ]);
  assert.equal(added, 2);
  assert.equal(next.backfill?.items.length, 3);
});

test('pruneBackfillItems drops keys older than the 90d product window', () => {
  const { kept, dropped } = pruneBackfillItems(
    [
      { key: 'claude||m|2026-01-01T00:00:00.000Z', attempts: 0, nextRetryAt: null },
      { key: 'claude||m|2026-07-01T00:00:00.000Z', attempts: 0, nextRetryAt: null },
    ],
    '2026-05-21T00:00:00.000Z',
  );
  assert.equal(dropped, 1);
  assert.equal(kept.length, 1);
  assert.match(kept[0]!.key, /2026-07-01/);
});

test('selectDrainBatch holds items below ingestMin and respects retry time', () => {
  const nowMs = Date.parse('2026-08-19T12:00:00.000Z');
  const selected = selectDrainBatch(
    [
      { key: 'claude||m|2026-07-01T00:00:00.000Z', attempts: 0, nextRetryAt: null },
      { key: 'claude||m|2026-08-18T00:00:00.000Z', attempts: 0, nextRetryAt: null },
      {
        key: 'claude||m|2026-08-17T00:00:00.000Z',
        attempts: 1,
        nextRetryAt: '2026-08-19T13:00:00.000Z',
      },
    ],
    {
      ingestMinIso: '2026-08-04T00:00:00.000Z',
      productSinceIso: '2026-05-21T00:00:00.000Z',
      nowMs,
      limit: 500,
    },
  );
  assert.equal(selected.hold.length, 1);
  assert.match(selected.hold[0]!.key, /2026-07-01/);
  assert.equal(selected.send.length, 1);
  assert.match(selected.send[0]!.key, /2026-08-18/);
  assert.equal(selected.rest.length, 1);
});

test('selectDrainBatch holds every item when ingestMin is missing', () => {
  const selected = selectDrainBatch(
    [
      { key: 'claude||m|2026-08-18T00:00:00.000Z', attempts: 0, nextRetryAt: null },
      { key: 'claude||m|2026-07-01T00:00:00.000Z', attempts: 0, nextRetryAt: null },
    ],
    {
      ingestMinIso: null,
      productSinceIso: '2026-05-21T00:00:00.000Z',
      nowMs: Date.parse('2026-08-19T12:00:00.000Z'),
    },
  );
  assert.equal(selected.send.length, 0);
  assert.equal(selected.hold.length, 2);
  assert.equal(selected.rest.length, 0);
});

test('selectDrainBatch holds every item when ingestMin is unparseable', () => {
  const selected = selectDrainBatch(
    [{ key: 'claude||m|2026-08-18T00:00:00.000Z', attempts: 0, nextRetryAt: null }],
    {
      ingestMinIso: 'not-a-date',
      productSinceIso: '2026-05-21T00:00:00.000Z',
      nowMs: Date.parse('2026-08-19T12:00:00.000Z'),
    },
  );
  assert.equal(selected.send.length, 0);
  assert.equal(selected.hold.length, 1);
});

test('shouldCommitBackfillBatch rejects unknown floor and floored events', () => {
  assert.equal(
    shouldCommitBackfillBatch({
      accepted: 0,
      duplicate: 500,
      ingestMinIso: null,
      eventHourStarts: ['2026-07-01T00:00:00.000Z'],
    }),
    false,
  );
  assert.equal(
    shouldCommitBackfillBatch({
      accepted: 38,
      duplicate: 123,
      ingestMinIso: null,
      eventHourStarts: ['2026-07-01T00:00:00.000Z', '2026-08-18T00:00:00.000Z'],
    }),
    false,
  );
  assert.equal(
    shouldCommitBackfillBatch({
      accepted: 0,
      duplicate: 10,
      ingestMinIso: '2026-08-04T00:00:00.000Z',
      eventHourStarts: ['2026-07-01T00:00:00.000Z'],
    }),
    false,
  );
  assert.equal(
    shouldCommitBackfillBatch({
      accepted: 0,
      duplicate: 10,
      ingestMinIso: '2026-08-04T00:00:00.000Z',
      eventHourStarts: ['2026-08-18T00:00:00.000Z'],
    }),
    true,
  );
  assert.equal(
    shouldCommitBackfillBatch({
      accepted: 4,
      duplicate: 0,
      ingestMinIso: '2026-08-04T00:00:00.000Z',
      eventHourStarts: ['2026-08-18T00:00:00.000Z'],
    }),
    true,
  );
});

test('ingest hold and failure backoff keep items on the list', () => {
  const nowMs = Date.parse('2026-08-19T12:00:00.000Z');
  const held = applyIngestHold(
    [{ key: 'claude||m|2026-07-01T00:00:00.000Z', attempts: 0, nextRetryAt: null }],
    nowMs,
  );
  assert.equal(held[0]!.attempts, 0);
  assert.equal(
    Date.parse(held[0]!.nextRetryAt!),
    nowMs + BACKFILL_HOLD_MS,
  );

  const failed = applyBackfillFailure(
    [{ key: 'claude||m|2026-07-01T00:00:00.000Z', attempts: 0, nextRetryAt: null }],
    nowMs,
  );
  assert.equal(failed[0]!.attempts, 1);
  assert.equal(
    Date.parse(failed[0]!.nextRetryAt!),
    nowMs + backfillRetryDelayMs(1),
  );
});
