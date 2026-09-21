import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { daysAgoIso } from '../src/config.js';
import { appendBuckets } from '../src/queue/index.js';
import {
  DEFAULT_STATS_TIMEZONE,
  localDateAndHour,
} from '../src/timezone.js';
import type { QueueBucket, TudConfig } from '../src/types.js';
import {
  applyCalibrateSelectedDates,
  buildReconcileBatches,
  calibrateWindowSinceIso,
  diffCalibrateRows,
  rollupDayDiffs,
  shanghaiDayBounds,
  summarizeCalibrateDays,
  type CalibrateEventRow,
} from '../src/upload/calibrate.js';

function row(
  partial: Partial<CalibrateEventRow> &
    Pick<CalibrateEventRow, 'event_id' | 'occurred_at'>,
): CalibrateEventRow {
  return {
    integration: 'cursor',
    collector: 'cursor-composer',
    model: 'gpt-5',
    usage: {
      input_tokens: 10,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 0,
    },
    conversations_count: 1,
    reported_cost_usd: 1.5,
    ...partial,
  };
}

test('diffCalibrateRows classifies missing / only / mismatch including cost', () => {
  const local = [
    row({
      event_id: 'a',
      occurred_at: '2026-08-01T02:00:00.000Z',
    }),
    row({
      event_id: 'b',
      occurred_at: '2026-08-01T03:00:00.000Z',
      usage: {
        input_tokens: 20,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 5,
        reasoning_output_tokens: 0,
      },
    }),
  ];
  const remote = [
    row({
      event_id: 'b',
      occurred_at: '2026-08-01T03:00:00.000Z',
      reported_cost_usd: 2.5,
    }),
    row({
      event_id: 'c',
      occurred_at: '2026-08-02T02:00:00.000Z',
    }),
  ];
  const diffs = diffCalibrateRows(local, remote, null);
  assert.equal(diffs.filter((d) => d.kind === 'online_missing').length, 1);
  assert.equal(diffs.filter((d) => d.kind === 'online_only').length, 1);
  assert.equal(diffs.filter((d) => d.kind === 'mismatch').length, 1);

  const days = rollupDayDiffs(diffs);
  const summary = summarizeCalibrateDays(days);
  assert.equal(summary.diffDayCount, 2);
  assert.equal(summary.onlineMissingRows, 1);
  assert.equal(summary.onlineOnlyRows, 1);
  assert.equal(summary.mismatchRows, 1);
});

test('shanghaiDayBounds uses +08:00 half-open window', () => {
  const { from, to } = shanghaiDayBounds('2026-08-01');
  assert.equal(from, '2026-07-31T16:00:00.000Z');
  assert.equal(to, '2026-08-01T16:00:00.000Z');
});

test('calibrate window is the rolling 90-day online floor', () => {
  const now = Date.parse('2026-09-16T01:00:00.000Z');
  assert.equal(calibrateWindowSinceIso(now), daysAgoIso(90, now));
});

test('buildReconcileBatches emits empty events to clear online-only days', () => {
  const batches = buildReconcileBatches({
    deviceId: '550e8400-e29b-41d4-a716-446655440000',
    selectedDates: ['2026-08-01'],
    localRows: [],
  });
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0]?.events, []);
  assert.equal(batches[0]?.from, '2026-07-31T16:00:00.000Z');
});

const DEVICE_ID = '550e8400-e29b-41d4-a716-446655440000';
const API_URL = 'https://example.invalid';

function configFor(dir: string): TudConfig {
  return {
    deviceId: DEVICE_ID,
    statsSince: '2026-01-01T00:00:00.000Z',
    hostname: 'test',
    dataDir: dir,
    juejin: {
      enabled: true,
      apiUrl: API_URL,
      authMode: 'tbd',
      token: 'user-token-not-device',
    },
  };
}

function recentHourIso(): string {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function liveBucket(hourStart: string): QueueBucket {
  return {
    hour_start: hourStart,
    source: 'claude',
    model: 'claude-opus-4-6',
    project: '',
    input_tokens: 100,
    output_tokens: 20,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 120,
    conversation_count: 1,
  };
}

test('applyCalibrateSelectedDates reports the failing date and window on 422', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tud-calibrate-422-'));
  const hour = recentHourIso();
  const date = localDateAndHour(hour, DEFAULT_STATS_TIMEZONE).date;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        success: false,
        message: 'INVALID_USAGE_EVENT',
        data: null,
      }),
      { status: 422 },
    )) as typeof fetch;

  try {
    await appendBuckets(dir, [liveBucket(hour)]);
    await assert.rejects(
      () => applyCalibrateSelectedDates(dir, configFor(dir), [date]),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.startsWith(`${date} 校准失败`));
        assert.match(err.message, /1 条事件/);
        assert.match(err.message, /窗口 .*T16:00:00\.000Z ~ .*T16:00:00\.000Z/);
        assert.match(err.message, /INVALID_USAGE_EVENT/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
