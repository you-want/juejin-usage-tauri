import type { CodexSubscriptionSnapshot } from '../../shared/codex-subscription';

export interface CodexSubscriptionState {
  snapshot: CodexSubscriptionSnapshot | null;
  lastUpdatedAt: number | null;
  hasDetectedCodex: boolean;
}

export const INITIAL_CODEX_SUBSCRIPTION_STATE: CodexSubscriptionState = {
  snapshot: null,
  lastUpdatedAt: null,
  hasDetectedCodex: false,
};

/** Retain in-memory allowance only across transient failures, never sign-out. */
export function updateCodexSubscriptionState(
  previous: CodexSubscriptionState,
  snapshot: CodexSubscriptionSnapshot,
  now: number,
): CodexSubscriptionState {
  const old = previous.snapshot;
  const keepAllowance = snapshot.status === 'unavailable'
    && old !== null
    && previous.lastUpdatedAt !== null
    && (snapshot.planLabel === null || snapshot.planLabel === old.planLabel);

  return {
    snapshot: keepAllowance ? {
      ...snapshot,
      planLabel: old.planLabel,
      fiveHour: old.fiveHour,
      weekly: old.weekly,
    } : snapshot,
    lastUpdatedAt: snapshot.status === 'ready'
      ? now
      : keepAllowance ? previous.lastUpdatedAt : null,
    hasDetectedCodex: previous.hasDetectedCodex || snapshot.status !== 'not-installed',
  };
}
