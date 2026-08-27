import { DEFAULT_STATS_SINCE_DAYS, daysAgoIso } from '../config.js';
import type { IngestBucket } from '../types.js';
import { ingestBucketKey } from '../queue/keys.js';
import { minIso } from './window.js';
import type { BackfillItem, UploadSlotState } from './state.js';

export const BACKFILL_BATCH_LIMIT = 500;
export const BACKFILL_GAP_MS = 3_000;
export const LIVE_LOOKBACK_MS = 48 * 60 * 60 * 1000;
export const BACKFILL_RETRY_LADDER_MS = [30_000, 60_000, 120_000, 300_000] as const;
export const BACKFILL_HOLD_MS = 60_000;

export function hourStartFromIngestKey(key: string): string | null {
  const i = key.lastIndexOf('|');
  if (i < 0) return null;
  const hour = key.slice(i + 1);
  return Number.isFinite(Date.parse(hour)) ? hour : null;
}

export function productWindowSinceIso(nowMs = Date.now()): string {
  return daysAgoIso(DEFAULT_STATS_SINCE_DAYS, nowMs);
}

export function oldestSlotHour(slot: UploadSlotState): string | null {
  let oldest: string | null = null;
  let oldestMs = Infinity;
  for (const key of Object.keys(slot.buckets)) {
    const hour = hourStartFromIngestKey(key);
    if (!hour) continue;
    const ms = Date.parse(hour);
    if (ms < oldestMs) {
      oldestMs = ms;
      oldest = hour;
    }
  }
  return oldest;
}

/** Live lane cutoff: union of slot range and last 48h (the earlier timestamp). */
export function liveCutoffIso(
  slot: UploadSlotState,
  nowMs = Date.now(),
): string {
  const recent = new Date(nowMs - LIVE_LOOKBACK_MS).toISOString();
  const slotOldest = oldestSlotHour(slot);
  return minIso(slotOldest, recent) ?? recent;
}

export function splitLiveAndBackfill(
  delta: IngestBucket[],
  slot: UploadSlotState,
  nowMs = Date.now(),
): { live: IngestBucket[]; backfill: IngestBucket[] } {
  const cutoffMs = Date.parse(liveCutoffIso(slot, nowMs));
  const live: IngestBucket[] = [];
  const backfill: IngestBucket[] = [];
  for (const bucket of delta) {
    const ms = Date.parse(bucket.hour_start);
    if (Number.isFinite(ms) && ms >= cutoffMs) live.push(bucket);
    else backfill.push(bucket);
  }
  return { live, backfill };
}

export function enqueueBackfillKeys(
  slot: UploadSlotState,
  keys: string[],
  enqueuedSince?: string | null,
): { slot: UploadSlotState; added: number } {
  const items = [...(slot.backfill?.items ?? [])];
  const seen = new Set(items.map((item) => item.key));
  let added = 0;
  for (const key of keys) {
    if (seen.has(key)) continue;
    items.push({ key, attempts: 0, nextRetryAt: null });
    seen.add(key);
    added += 1;
  }
  items.sort((a, b) => {
    const ah = hourStartFromIngestKey(a.key) ?? a.key;
    const bh = hourStartFromIngestKey(b.key) ?? b.key;
    return ah.localeCompare(bh);
  });
  return {
    slot: {
      buckets: { ...slot.buckets },
      backfill: {
        items,
        enqueuedSince: enqueuedSince ?? slot.backfill?.enqueuedSince ?? null,
      },
    },
    added,
  };
}

export function pruneBackfillItems(
  items: BackfillItem[],
  productSinceIso: string,
): { kept: BackfillItem[]; dropped: number } {
  const sinceMs = Date.parse(productSinceIso);
  const kept: BackfillItem[] = [];
  let dropped = 0;
  for (const item of items) {
    const hour = hourStartFromIngestKey(item.key);
    const ms = hour ? Date.parse(hour) : NaN;
    if (Number.isFinite(ms) && ms < sinceMs) {
      dropped += 1;
      continue;
    }
    kept.push(item);
  }
  return { kept, dropped };
}

export function backfillRetryDelayMs(attempts: number): number {
  const idx = Math.min(
    Math.max(attempts, 1) - 1,
    BACKFILL_RETRY_LADDER_MS.length - 1,
  );
  return BACKFILL_RETRY_LADDER_MS[idx]!;
}

export interface DrainSelection {
  send: BackfillItem[];
  hold: BackfillItem[];
  rest: BackfillItem[];
}

/** Valid ingest floor timestamp, or null when watermark is missing/unusable. */
export function parseIngestMinMs(ingestMinIso: string | null | undefined): number | null {
  if (!ingestMinIso) return null;
  const ms = Date.parse(ingestMinIso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Backfill may commit hashes / drop queue items only when the server floor is
 * known and every posted event is on or after that floor. All-duplicate with an
 * unknown floor is the 15d ingest reject, not idempotent success.
 */
export function shouldCommitBackfillBatch(input: {
  accepted: number;
  duplicate: number;
  ingestMinIso: string | null | undefined;
  eventHourStarts: Array<string | null | undefined>;
}): boolean {
  if (input.accepted === 0 && input.duplicate === 0) return false;
  const ingestMinMs = parseIngestMinMs(input.ingestMinIso);
  if (ingestMinMs == null) return false;
  for (const hour of input.eventHourStarts) {
    if (!hour) return false;
    const hourMs = Date.parse(hour);
    if (!Number.isFinite(hourMs) || hourMs < ingestMinMs) return false;
  }
  return true;
}

/**
 * Split items into: ready to POST (hour >= ingestMin, retry due),
 * hold (below ingestMin, or ingestMin unknown), and rest (retry in the future).
 */
export function selectDrainBatch(
  items: BackfillItem[],
  input: {
    ingestMinIso: string | null;
    productSinceIso: string;
    nowMs?: number;
    limit?: number;
  },
): DrainSelection {
  const nowMs = input.nowMs ?? Date.now();
  const limit = input.limit ?? BACKFILL_BATCH_LIMIT;
  const { kept } = pruneBackfillItems(items, input.productSinceIso);
  const ingestMinMs = parseIngestMinMs(input.ingestMinIso);
  if (ingestMinMs == null) {
    return { send: [], hold: kept, rest: [] };
  }
  const send: BackfillItem[] = [];
  const hold: BackfillItem[] = [];
  const rest: BackfillItem[] = [];

  for (const item of kept) {
    const hour = hourStartFromIngestKey(item.key);
    const hourMs = hour ? Date.parse(hour) : NaN;
    if (Number.isFinite(hourMs) && hourMs < ingestMinMs) {
      hold.push(item);
      continue;
    }
    const retryMs = item.nextRetryAt ? Date.parse(item.nextRetryAt) : 0;
    if (Number.isFinite(retryMs) && retryMs > nowMs) {
      rest.push(item);
      continue;
    }
    if (send.length < limit) send.push(item);
    else rest.push(item);
  }

  return { send, hold, rest };
}

export function applyIngestHold(
  items: BackfillItem[],
  nowMs = Date.now(),
): BackfillItem[] {
  const nextRetryAt = new Date(nowMs + BACKFILL_HOLD_MS).toISOString();
  return items.map((item) => ({ ...item, nextRetryAt }));
}

export function applyBackfillFailure(
  items: BackfillItem[],
  nowMs = Date.now(),
): BackfillItem[] {
  return items.map((item) => {
    const attempts = item.attempts + 1;
    return {
      key: item.key,
      attempts,
      nextRetryAt: new Date(nowMs + backfillRetryDelayMs(attempts)).toISOString(),
    };
  });
}

export function removeBackfillKeys(
  items: BackfillItem[],
  keys: Iterable<string>,
): BackfillItem[] {
  const drop = new Set(keys);
  return items.filter((item) => !drop.has(item.key));
}

export function earliestRetryMs(items: BackfillItem[], nowMs = Date.now()): number | null {
  let best: number | null = null;
  for (const item of items) {
    const ms = item.nextRetryAt ? Date.parse(item.nextRetryAt) : nowMs;
    if (!Number.isFinite(ms)) continue;
    if (best == null || ms < best) best = ms;
  }
  return best;
}

export function ingestKeySet(buckets: IngestBucket[]): Set<string> {
  return new Set(buckets.map((bucket) => ingestBucketKey(bucket)));
}
