export const TRAY_USAGE_GET_CHANNEL = 'tray-usage:get';
export const TRAY_USAGE_SET_CHANNEL = 'tray-usage:set';
export const TRAY_USAGE_CHANGED_CHANNEL = 'tray-usage:changed';

export function formatCompactTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens >= 1_000_000_000) {
    const v = (tokens / 1_000_000_000).toFixed(1).replace(/\.0$/, '');
    return `${v}B`;
  }
  if (tokens >= 1_000_000) {
    const v = (tokens / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${v}M`;
  }
  if (tokens >= 1_000) {
    const v = (tokens / 1_000).toFixed(1).replace(/\.0$/, '');
    return `${v}K`;
  }
  return Math.round(tokens).toString();
}

export function formatTrayUsage(summary: {
  todayCostUsd?: number | null;
  todayTokens?: number | null;
}): string {
  const cost = Number(summary.todayCostUsd);
  const tokens = Number(summary.todayTokens);

  if (Number.isFinite(cost) && cost > 0) {
    if (cost < 0.01) {
      return '<$0.01';
    }
    return `$${cost.toFixed(2)}`;
  }

  if (Number.isFinite(tokens) && tokens > 0) {
    return `${formatCompactTokens(tokens)} tk`;
  }

  return '$0.00';
}
