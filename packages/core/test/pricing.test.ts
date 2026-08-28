import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import type { QueueBucket } from '../src/types.js';
import {
  applyRemotePricingOverlay,
  computeRowCost,
  getModelPricing,
  roundCostUsd,
  getPricingStatus,
  isModelPriced,
  loadCachedPricingOverlay,
  resetPricingRuntime,
  startPricingRefresh,
  validatePricingData,
} from '../src/pricing/index.js';
import { lookupPricingStacked, type PricingData } from '../src/pricing/matcher.js';
import { pricingOverlayPath } from '../src/paths.js';

function makeRow(partial: Partial<QueueBucket> & Pick<QueueBucket, 'source' | 'model'>): QueueBucket {
  return {
    hour_start: '2026-07-09T10:00:00.000Z',
    project: 'unknown',
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    conversation_count: 1,
    ...partial,
  };
}

describe('pricing runtime', { concurrency: false }, () => {
test.afterEach(() => {
  resetPricingRuntime();
});

test('getModelPricing resolves claude-opus-4-6 from pricing table', () => {
  const p = getModelPricing('claude-opus-4-6');
  assert.ok(p.input > 0);
  assert.ok(p.output > 0);
});

test('cursor auto uses the Cursor-specific price instead of a global alias', () => {
  const p = getModelPricing('auto', { source: 'cursor' });
  assert.equal(p.input, 1.25);
  assert.equal(p.output, 6);
  assert.equal(p.cache_read, 0.25);
});

test('cursor composer without a concrete version does not resolve to MiniMax', () => {
  const p = getModelPricing('composer', { source: 'cursor' });
  assert.notEqual(p.input, 0.3);
  assert.notEqual(p.output, 1.2);
});

test('auto does not globally resolve to MiniMax', () => {
  const p = getModelPricing('auto');
  assert.notEqual(p.input, 0.3);
  assert.notEqual(p.output, 1.2);
});

test('codex row folds reasoning into output cost only', () => {
  const row = makeRow({
    source: 'codex',
    model: 'gpt-5.4',
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    reasoning_output_tokens: 500_000,
    total_tokens: 2_500_000,
  });
  const withReasoning = computeRowCost(row);
  const withoutReasoning = computeRowCost({
    ...row,
    reasoning_output_tokens: 0,
  });
  assert.equal(withReasoning, withoutReasoning);
});

test('cursor row prefers reported_cost_usd over pricing table', () => {
  const row = makeRow({
    source: 'cursor',
    model: 'claude-4-sonnet',
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    total_tokens: 2_000_000,
    reported_cost_usd: 12.34,
  });
  assert.equal(computeRowCost(row), 12.34);
});

test('cursor row without reported_cost falls back to pricing table', () => {
  const row = makeRow({
    source: 'cursor',
    model: 'auto',
    input_tokens: 1_000_000,
    output_tokens: 0,
    total_tokens: 1_000_000,
  });
  const cost = computeRowCost(row);
  assert.ok(Math.abs(cost - 1.25) < 0.001);
});

test('unknown model uses builtin default rates', () => {
  assert.equal(isModelPriced('totally-unknown-model-xyz'), true);
  const p = getModelPricing('totally-unknown-model-xyz');
  assert.equal(p.input, 1);
  assert.equal(p.output, 5);
  const row = makeRow({
    source: 'claude',
    model: 'totally-unknown-model-xyz',
    input_tokens: 1_000_000,
    total_tokens: 1_000_000,
  });
  assert.equal(computeRowCost(row), 1);
});

test('overlay exact overrides builtin same key', () => {
  applyRemotePricingOverlay({
    exact: {
      'composer-1': { input: 99, output: 100 },
    },
  });
  const p = getModelPricing('composer-1');
  assert.equal(p.input, 99);
  assert.equal(p.output, 100);
});

test('overlay miss falls back to builtin', () => {
  applyRemotePricingOverlay({
    exact: {
      'brand-new-overlay-only': { input: 2, output: 8 },
    },
  });
  const overlayHit = getModelPricing('brand-new-overlay-only');
  assert.equal(overlayHit.input, 2);
  const builtinHit = getModelPricing('anthropic/claude-sonnet-4-5');
  assert.equal(builtinHit.input, 3);
});

test('overlay alias can resolve to builtin exact', () => {
  applyRemotePricingOverlay({
    exact: {},
    alias: {
      'my-auto-alias': 'anthropic/claude-sonnet-4-5',
    },
  });
  const p = getModelPricing('my-auto-alias');
  assert.equal(p.input, 3);
  assert.equal(p.output, 15);
});

test('default applies when both overlay and builtin miss', () => {
  applyRemotePricingOverlay({
    exact: {},
    default: { input: 7, output: 9, cache_read: 0.5 },
  });
  const p = getModelPricing('totally-unknown-model-xyz-default');
  assert.equal(p.input, 7);
  assert.equal(p.output, 9);
  assert.equal(p.cache_read, 0.5);
  assert.equal(isModelPriced('totally-unknown-model-xyz-default'), true);
});

test('remote default preferred over builtin default in stacked lookup', () => {
  const builtin: PricingData = {
    exact: {},
    default: { input: 1, output: 2 },
  };
  const overlay: PricingData = {
    exact: {},
    default: { input: 3, output: 4 },
  };
  const hit = lookupPricingStacked('unknown-x', overlay, builtin);
  assert.equal(hit.source, 'default');
  assert.equal(hit.value?.input, 3);
});

test('validatePricingData accepts empty exact and alias-only overlay', () => {
  const ok = validatePricingData({
    exact: {},
    alias: { foo: 'composer-1' },
  });
  assert.equal(ok.ok, true);
});

test('validatePricingData rejects bad rates', () => {
  const bad = validatePricingData({
    exact: { m: { input: -1, output: 1 } },
  });
  assert.equal(bad.ok, false);
});

test('failed refresh does not clear existing overlay', async () => {
  applyRemotePricingOverlay({
    exact: { 'keep-me': { input: 11, output: 22 } },
  });
  assert.equal(getModelPricing('keep-me').input, 11);

  let calls = 0;
  const stop = startPricingRefresh({
    url: 'https://example.invalid/pricing.json',
    ttlMs: 60_000,
    firstFetchTimeoutMs: 1_000,
    fetchImpl: (async () => {
      calls += 1;
      return new Response('nope', { status: 500 });
    }) as typeof fetch,
  });

  assert.equal(await stop.ready, false);
  assert.ok(calls >= 1);
  assert.equal(getModelPricing('keep-me').input, 11);
  assert.equal(getPricingStatus().hasOverlay, true);
  stop();
});

test('successful refresh replaces overlay', async () => {
  const body = JSON.stringify({
    exact: { 'from-remote': { input: 5, output: 6 } },
  });
  const stop = startPricingRefresh({
    url: 'https://cdn.example/pricing.json',
    ttlMs: 60_000,
    firstFetchTimeoutMs: 1_000,
    fetchImpl: (async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch,
  });

  assert.equal(await stop.ready, true);
  assert.equal(getPricingStatus().hasOverlay, true);
  assert.equal(getModelPricing('from-remote').input, 5);
  assert.equal(getModelPricing('anthropic/claude-sonnet-4-5').input, 3);
  stop();
});

test('successful refresh persists overlay for the next cold start', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-pricing-'));
  try {
    const body = JSON.stringify({
      exact: { 'cached-model': { input: 4, output: 8 } },
    });
    const stop = startPricingRefresh({
      url: 'https://cdn.example/pricing.json',
      ttlMs: 60_000,
      dataDir: dir,
      firstFetchTimeoutMs: 1_000,
      fetchImpl: (async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    });
    assert.equal(await stop.ready, true);
    stop();

    const saved = JSON.parse(await readFile(pricingOverlayPath(dir), 'utf8')) as {
      exact: { 'cached-model': { input: number } };
    };
    assert.equal(saved.exact['cached-model']?.input, 4);

    resetPricingRuntime();
    assert.equal(getPricingStatus().hasOverlay, false);
    assert.equal(loadCachedPricingOverlay(dir), true);
    assert.equal(getModelPricing('cached-model').input, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('first fetch timeout does not drop a later overlay', async () => {
  let finish: ((value: Response) => void) | undefined;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const stop = startPricingRefresh({
    url: 'https://cdn.example/slow.json',
    ttlMs: 60_000,
    firstFetchTimeoutMs: 40,
    fetchImpl: (async () => pending) as typeof fetch,
  });

  assert.equal(await stop.ready, false);
  assert.equal(getPricingStatus().hasOverlay, false);

  finish!(
    new Response(JSON.stringify({ exact: { 'late-model': { input: 3, output: 9 } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(getModelPricing('late-model').input, 3);
  stop();
});

test('loadCachedPricingOverlay ignores missing or invalid files', () => {
  assert.equal(loadCachedPricingOverlay('/tmp/tud-pricing-does-not-exist'), false);
});

test('roundCostUsd keeps 8 decimals instead of rounding to cents', () => {
  assert.equal(roundCostUsd(4.516), 4.516);
  assert.equal(roundCostUsd(4.516 + 4.516), 9.032);
  assert.equal(Math.round(4.516 * 100) / 100, 4.52);
  assert.notEqual(roundCostUsd(4.516), 4.52);
});
});

