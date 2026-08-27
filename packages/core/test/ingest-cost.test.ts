import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateForIngest } from '../src/aggregate.js';
import { bucketToIngestEvent } from '../src/upload/events.js';
import type { QueueBucket } from '../src/types.js';

function makeRow(
  partial: Partial<QueueBucket> & Pick<QueueBucket, 'source' | 'model'>,
): QueueBucket {
  return {
    hour_start: '2026-07-09T10:00:00.000Z',
    project: 'unknown',
    input_tokens: 100,
    output_tokens: 50,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 150,
    conversation_count: 1,
    ...partial,
  };
}

test('aggregateForIngest sums reported_cost_usd across matching buckets', () => {
  const buckets = aggregateForIngest([
    makeRow({
      source: 'cursor',
      model: 'composer-1',
      reported_cost_usd: 0.05,
    }),
    makeRow({
      source: 'cursor',
      model: 'composer-1',
      reported_cost_usd: 0.02,
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    }),
  ]);

  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]!.reported_cost_usd, 0.07);
  assert.equal(buckets[0]!.input_tokens, 110);
});

test('bucketToIngestEvent includes reported_cost_usd when present', () => {
  const deviceId = '550e8400-e29b-41d4-a716-446655440000';
  const [bucket] = aggregateForIngest([
    makeRow({
      source: 'cursor',
      model: 'composer-1',
      reported_cost_usd: 1.25,
    }),
  ]);
  const event = bucketToIngestEvent(bucket!, deviceId);
  assert.ok(event);
  assert.equal(event.reported_cost_usd, 1.25);
  assert.equal(event.integration, 'cursor');
});

test('bucketToIngestEvent omits reported_cost_usd when absent', () => {
  const deviceId = '550e8400-e29b-41d4-a716-446655440000';
  const [bucket] = aggregateForIngest([
    makeRow({ source: 'claude', model: 'claude-opus-4-6' }),
  ]);
  const event = bucketToIngestEvent(bucket!, deviceId);
  assert.ok(event);
  assert.equal(event.reported_cost_usd, undefined);
});

test('bucketToIngestEvent event_id differs per deviceId', () => {
  const [bucket] = aggregateForIngest([
    makeRow({ source: 'claude', model: 'claude-opus-4-6' }),
  ]);
  const a = bucketToIngestEvent(bucket!, '550e8400-e29b-41d4-a716-446655440000');
  const b = bucketToIngestEvent(bucket!, '550e8400-e29b-41d4-a716-446655440001');
  assert.ok(a && b);
  assert.notEqual(a.event_id, b.event_id);
});

test('aggregateForIngest merges across projects and omits project from ingest', () => {
  const buckets = aggregateForIngest([
    makeRow({
      source: 'claude',
      model: 'claude-opus-4-6',
      project: 'ai-usage',
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    }),
    makeRow({
      source: 'claude',
      model: 'claude-opus-4-6',
      project: 'docs-site',
      input_tokens: 200,
      output_tokens: 100,
      total_tokens: 300,
    }),
  ]);

  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]!.total_tokens, 450);
  assert.equal('project' in buckets[0]!, false);

  const event = bucketToIngestEvent(
    buckets[0]!,
    '550e8400-e29b-41d4-a716-446655440000',
  );
  assert.ok(event);
  assert.equal('project' in event, false);
  assert.equal('hostname' in event, false);
});
