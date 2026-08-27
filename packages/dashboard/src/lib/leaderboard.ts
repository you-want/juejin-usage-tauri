import type { LeaderboardMetric, LeaderboardRange } from '@/lib/api';

export type RankRange = LeaderboardRange;

export function formatRankPosition(rank: number | null | undefined): string {
  if (rank === null || rank === undefined || !Number.isFinite(rank) || rank < 1) {
    return '—';
  }
  return rank > 99 ? '> 99' : String(Math.floor(rank));
}

export function leaderboardMetricLabel(metric: LeaderboardMetric): string {
  return metric === 'cost' ? '按消费' : '按 Token';
}
