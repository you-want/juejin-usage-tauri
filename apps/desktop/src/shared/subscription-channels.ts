/** Dashboard / tray subscription channel ids and display preferences. */

export const SUBSCRIPTION_CHANNEL_VISIBILITY_KEY =
  'tud.subscriptionChannelVisibility';

export const SUBSCRIPTION_CHANNEL_VISIBILITY_EVENT =
  'tud:subscription-channel-visibility';

export const SUBSCRIPTION_CHANNELS = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'grok', label: 'Grok' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'zcode', label: 'ZCode' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'qoder', label: 'Qoder' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'workbuddy', label: 'Workbuddy' },
  { id: 'workbuddy-cn', label: 'Workbuddy CN' },
  { id: 'trae', label: 'TRAE' },
  { id: 'trae-cn', label: 'TRAE CN' },
] as const;

export type SubscriptionChannelId =
  (typeof SUBSCRIPTION_CHANNELS)[number]['id'];

/** Missing keys default to visible (`true`). */
export type SubscriptionChannelVisibility = Partial<
  Record<SubscriptionChannelId, boolean>
>;

export function isSubscriptionChannelId(
  value: unknown,
): value is SubscriptionChannelId {
  return (
    typeof value === 'string' &&
    SUBSCRIPTION_CHANNELS.some((channel) => channel.id === value)
  );
}

export function isSubscriptionChannelVisibility(
  value: unknown,
): value is SubscriptionChannelVisibility {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value as Record<string, unknown>).every(
    ([key, enabled]) =>
      isSubscriptionChannelId(key) && typeof enabled === 'boolean',
  );
}

/** Channels default to shown; only explicit `false` hides them. */
export function isSubscriptionChannelEnabled(
  visibility: SubscriptionChannelVisibility,
  id: SubscriptionChannelId,
): boolean {
  return visibility[id] !== false;
}

export function readSubscriptionChannelVisibility(): SubscriptionChannelVisibility {
  try {
    const raw = localStorage.getItem(SUBSCRIPTION_CHANNEL_VISIBILITY_KEY);
    if (raw == null) return {};
    const parsed: unknown = JSON.parse(raw);
    return isSubscriptionChannelVisibility(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSubscriptionChannelVisibility(
  visibility: SubscriptionChannelVisibility,
): void {
  try {
    localStorage.setItem(
      SUBSCRIPTION_CHANNEL_VISIBILITY_KEY,
      JSON.stringify(visibility),
    );
  } catch {
    // ignore private mode / quota
  }
  window.dispatchEvent(
    new CustomEvent(SUBSCRIPTION_CHANNEL_VISIBILITY_EVENT),
  );
}
