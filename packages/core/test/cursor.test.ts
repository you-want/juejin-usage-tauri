import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCursorCsv,
  parseCursorIncremental,
  recordsToBuckets,
} from '../src/parsers/cursor.js';

const SAMPLE_CSV = `Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
2026-07-09T10:15:00.000Z,Usage-based,claude-4-sonnet,No,1200,1000,500,800,3500,0.05
2026-07-09T10:45:00.000Z,Usage-based,gpt-4.1,No,300,200,100,150,750,0.01
`;

test('parseCursorCsv maps columns by header name', () => {
  const records = parseCursorCsv(SAMPLE_CSV);
  assert.equal(records.length, 2);
  assert.equal(records[0]!.model, 'claude-4-sonnet');
  assert.equal(records[0]!.inputTokens, 1000);
  assert.equal(records[0]!.cacheWriteTokens, 200);
  assert.equal(records[0]!.cacheReadTokens, 500);
  assert.equal(records[0]!.outputTokens, 800);
  assert.equal(records[0]!.costUsd, 0.05);
});

test('parseCursorIncremental skips the remote fetch when lastSyncAt is fresh', async () => {
  const cursors = {
    cursor: { lastSyncAt: new Date().toISOString(), lastError: null },
  };
  const { result } = await parseCursorIncremental(cursors, '2026-01-01T00:00:00.000Z', {
    minFetchIntervalMs: 5 * 60_000,
  });
  assert.equal(result.skipped, true);
  assert.match(result.error ?? '', /节流/);
  // Throttling is not a failure: lastError must stay untouched.
  assert.equal(cursors.cursor.lastError, null);
});

test('recordsToBuckets aggregates into half-hour UTC buckets', () => {
  const records = parseCursorCsv(SAMPLE_CSV);
  const buckets = recordsToBuckets(records, '2026-01-01T00:00:00.000Z');
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0]!.source, 'cursor');
  assert.equal(buckets[0]!.project, 'unknown');
  assert.equal(buckets[0]!.hour_start, '2026-07-09T10:00:00.000Z');
  assert.equal(buckets[1]!.hour_start, '2026-07-09T10:30:00.000Z');
  assert.equal(buckets[0]!.cache_creation_input_tokens, 200);
  assert.equal(buckets[0]!.cached_input_tokens, 500);
  assert.equal(buckets[0]!.reported_cost_usd, 0.05);
  assert.equal(buckets[1]!.reported_cost_usd, 0.01);
});
