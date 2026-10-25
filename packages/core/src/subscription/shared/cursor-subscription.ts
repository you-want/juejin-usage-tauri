import { canonicalSubscriptionPlanLabel } from './subscription-plan.js';

export type CursorSubscriptionStatus =
  | 'ready'
  | 'not-installed'
  | 'not-signed-in'
  | 'temporarily-unavailable';

export interface CursorRateLimitWindow {
  /** Trial expiry is distinct from a recurring quota reset. */
  expiresAt?: number;
  startsAt?: number;
  usedPercent: number;
  /** Unix timestamp in seconds. */
  resetsAt: number | null;
}

export interface CursorSubscriptionSnapshot {
  status: CursorSubscriptionStatus;
  /** True when a local Cursor login was detected, even if Keychain decrypt is still pending. */
  hasAccount: boolean;
  planLabel: string | null;
  /** autoPercentUsed pool; UI label Auto. */
  cursorModels: CursorRateLimitWindow | null;
  /** apiPercentUsed pool; UI label API. */
  otherModels: CursorRateLimitWindow | null;
  grokBot?: CursorRateLimitWindow | null;
  /** Legacy Cursor responses expose one combined plan allowance. */
  plan: CursorRateLimitWindow | null;
  /** Unix timestamp in seconds. */
  fetchedAt: number | null;
  stale: boolean;
  message: string | null;
}

/** Keeps a confirmed Cursor login visible while Keychain decrypt or quota lookup is pending. */
export function cursorSubscriptionHasAccount(snapshot: CursorSubscriptionSnapshot): boolean {
  return snapshot.hasAccount === true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedPercent(value: unknown): number | null {
  const number = finiteNumber(value);
  return number === null ? null : Math.min(100, Math.max(0, number));
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value > 10_000_000_000 ? value / 1_000 : value);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d{10,13}$/.test(value.trim())) return parseTimestamp(Number(value));
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.floor(millis / 1_000) : null;
}

function normalizePlanLabel(value: unknown): string | null {
  return canonicalSubscriptionPlanLabel(value);
}

function selectUsage(root: Record<string, unknown>): Record<string, unknown> | null {
  const individual = asRecord(root.individualUsage);
  const team = asRecord(root.teamUsage);
  const individualPlan = asRecord(individual?.plan);
  const teamPlan = asRecord(team?.plan);

  if (individualPlan && Object.keys(individualPlan).length > 0) return individual;
  if (teamPlan && Object.keys(teamPlan).length > 0) return team;
  return individual ?? team;
}

/** Normalize Cursor's current dashboard response plus its older combined-plan shape. */
export function mapCursorUsageSummary(value: unknown): Pick<
  CursorSubscriptionSnapshot,
  'planLabel' | 'cursorModels' | 'otherModels' | 'plan'
> {
  const root = asRecord(value);
  if (!root) {
    return { planLabel: null, cursorModels: null, otherModels: null, plan: null };
  }
  const usage = selectUsage(root);
  const plan = asRecord(usage?.plan);
  const resetsAt = parseTimestamp(root.billingCycleEnd);
  const start = parseTimestamp(root.billingCycleStart);
  const startsAt = start === null ? {} : { startsAt: start };
  const cursorPercent = boundedPercent(plan?.autoPercentUsed);
  const otherPercent = boundedPercent(plan?.apiPercentUsed);

  let combinedPlan: CursorRateLimitWindow | null = null;
  if (cursorPercent === null && otherPercent === null) {
    const used = finiteNumber(plan?.used);
    const breakdown = asRecord(plan?.breakdown);
    const limit = [
      finiteNumber(plan?.limit),
      finiteNumber(breakdown?.total),
      finiteNumber(plan?.total),
    ].find((candidate): candidate is number => candidate !== null && candidate > 0);
    const totalPercent = boundedPercent(plan?.totalPercentUsed);
    const usedPercent = totalPercent ?? (
      used !== null && limit !== undefined
        ? Math.min(100, Math.max(0, used / limit * 100))
        : null
    );
    if (usedPercent !== null) combinedPlan = { usedPercent, resetsAt, ...startsAt };
  }

  return {
    planLabel: normalizePlanLabel(root.membershipType),
    cursorModels: cursorPercent === null ? null : { usedPercent: cursorPercent, resetsAt, ...startsAt },
    otherModels: otherPercent === null ? null : { usedPercent: otherPercent, resetsAt, ...startsAt },
    plan: combinedPlan,
  };
}

export function cursorRemainingPercent(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) return 0;
  return Math.min(100, Math.max(0, 100 - usedPercent));
}

/** Cursor's separate Grok Bot included/trial pool; a missing entitlement is not 0%. */
export function mapCursorGrokBotUsage(value: unknown, now = Date.now()): CursorRateLimitWindow | null {
  const root = asRecord(value);
  if (!root) return null;
  const usedPercent = boundedPercent(root.usagePercent);
  if (usedPercent === null) return null;
  const included = typeof root.includedLimitZero === 'boolean'
    ? !root.includedLimitZero : root.hasNonZeroIncludedLimit === true;
  const expiresAt = parseTimestamp(root.sandTrialExpiresAt);
  const trial = !included && expiresAt !== null && expiresAt * 1000 > now;
  if (!included && !trial) return null;
  const startsAt = parseTimestamp(root.currentPeriodStart);
  return {
    usedPercent,
    resetsAt: included ? parseTimestamp(root.nextResetTimestampUtc) : null,
    ...(startsAt === null ? {} : { startsAt }),
    ...(trial && expiresAt !== null ? { expiresAt } : {}),
  };
}

/** Premium and similar plans bill included usage weekly instead of Auto/API pools. */
export function isCursorWeeklyIncludedUsage(value: unknown): boolean {
  const root = asRecord(value);
  if (!root) return false;
  const planInfo = asRecord(root.planInfo) ?? root;
  const period = planInfo.includedUsagePeriod ?? planInfo.included_usage_period;
  if (period === 2 || period === 'INCLUDED_USAGE_PERIOD_WEEKLY') return true;
  if (typeof period !== 'string') return false;
  const normalized = period.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return normalized === 'weekly' || normalized === 'includedusageperiodweekly';
}

/** Normalize get-current-period-usage into the combined Plan window. */
export function mapCursorPeriodUsage(value: unknown): CursorRateLimitWindow | null {
  const root = asRecord(value);
  if (!root) return null;
  const planUsage = asRecord(root.planUsage) ?? root;
  const usedPercent = boundedPercent(planUsage.totalPercentUsed);
  if (usedPercent === null) return null;
  const resetsAt = parseTimestamp(
    root.billingCycleEnd ?? planUsage.billingCycleEnd ?? planUsage.includedUsageResetsAt,
  );
  const start = parseTimestamp(root.billingCycleStart ?? planUsage.billingCycleStart);
  return {
    usedPercent,
    resetsAt,
    ...(start === null ? {} : { startsAt: start }),
  };
}
