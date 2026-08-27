/**
 * Upload catch-up window helpers: local statsSince ∩ remote ingest floor ∩
 * per-device dataThrough (lastUploadAt).
 */

export function maxIso(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const v of values) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (!Number.isFinite(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = new Date(ms).toISOString();
    }
  }
  return best;
}

/** Earliest valid ISO among the arguments. */
export function minIso(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = Infinity;
  for (const v of values) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (!Number.isFinite(ms)) continue;
    if (ms < bestMs) {
      bestMs = ms;
      best = new Date(ms).toISOString();
    }
  }
  return best;
}

/** UTC hour floor (minutes/seconds/ms zeroed). */
export function hourFloorIso(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const t = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    0,
    0,
    0,
  );
  return new Date(t).toISOString();
}

export interface UploadWindow {
  /** max(localStatsSince, ingestMinOccurredAt) */
  effectiveSince: string;
  /** Remote per-device max(occurred_at); null if unknown / empty. */
  dataThrough: string | null;
  /**
   * Lower bound for buckets that still need hash-diff / POST:
   * max(effectiveSince, hourFloor(dataThrough)) when dataThrough set,
   * else effectiveSince.
   */
  scanFrom: string;
}

export function computeUploadWindow(input: {
  localStatsSince: string;
  ingestMinOccurredAt?: string | null;
  dataThrough?: string | null;
}): UploadWindow {
  const effectiveSince =
    maxIso(input.localStatsSince, input.ingestMinOccurredAt ?? null) ??
    input.localStatsSince;

  const dataThrough = input.dataThrough?.trim() || null;
  const throughHour = dataThrough ? hourFloorIso(dataThrough) : null;
  const scanFrom = maxIso(effectiveSince, throughHour) ?? effectiveSince;

  return { effectiveSince, dataThrough, scanFrom };
}

export function filterBucketsByScanFrom<T extends { hour_start: string }>(
  buckets: T[],
  scanFrom: string,
): T[] {
  const sinceMs = Date.parse(scanFrom);
  if (!Number.isFinite(sinceMs)) return buckets;
  return buckets.filter((b) => {
    const t = Date.parse(b.hour_start);
    return Number.isFinite(t) && t >= sinceMs;
  });
}
