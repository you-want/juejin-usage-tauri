import { useCallback, useEffect, useState } from 'react';
import { ProviderIcon } from './ProviderIcon';
import { subscriptionDetails } from '../lib/subscription-details';
import { DATA_SYNCED_EVENT } from '../lib/shell-events';

/** Compact per-channel row for the tray popover (main window renders the
 *  full cards; this is the condensed Electron-popover parity section). */
const CHANNELS: Array<{ id: string; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'grok', label: 'Grok' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'qoder', label: 'Qoder' },
  { id: 'zcode', label: 'ZCode' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'deepseek', label: 'DeepSeek' },
];

interface ChannelState {
  loading: boolean;
  line: string | null;
}

function describeSnapshot(snapshot: unknown, label: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const status = (snapshot as { status?: unknown }).status;
  if (status === 'not-signed-in') return '未登录';
  if (status === 'not-installed') return null; // hide channels without a local install
  const sections = subscriptionDetails(snapshot as Parameters<typeof subscriptionDetails>[0], label);
  const quota = sections.find((section) => section.kind === 'quota');
  if (!quota || quota.rows.length === 0) {
    if (status === 'custom-provider') return '自定义模型，无配额';
    return '暂无额度数据';
  }
  const main = quota.rows[0]!;
  const used = quota.rows.find((row) => row.tag === '已用');
  const chosen = used ?? main;
  return `${quota.title ?? chosen.label} ${chosen.value}`.trim();
}

/**
 * Condensed subscription overview for the tray popover. Fetches each channel
 * through the shell bridge's loopback proxy (the subscription API's Origin
 * gate rejects a direct popover fetch), refreshes on every data sync.
 */
export function TraySubscriptions() {
  const [states, setStates] = useState<Record<string, ChannelState>>({});

  const refresh = useCallback(async () => {
    const snapshot = (
      window as {
        tud?: {
          subscriptionSnapshot?: (
            channel: string,
          ) => Promise<{ status: number; body: unknown }>;
        };
      }
    ).tud?.subscriptionSnapshot;
    if (typeof snapshot !== 'function') return;
    setStates((prev) => {
      const next: Record<string, ChannelState> = {};
      for (const channel of CHANNELS) {
        next[channel.id] = { loading: true, line: prev[channel.id]?.line ?? null };
      }
      return next;
    });
    await Promise.all(
      CHANNELS.map(async (channel) => {
        try {
          const { body } = await snapshot(channel.id);
          const data = (body as { data?: unknown } | null)?.data;
          setStates((prev) => ({
            ...prev,
            [channel.id]: { loading: false, line: describeSnapshot(data, channel.label) },
          }));
        } catch {
          setStates((prev) => ({ ...prev, [channel.id]: { loading: false, line: null } }));
        }
      }),
    );
  }, []);

  useEffect(() => {
    void refresh();
    const onSynced = () => void refresh();
    window.addEventListener(DATA_SYNCED_EVENT, onSynced);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(DATA_SYNCED_EVENT, onSynced);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const visible = CHANNELS.filter((channel) => {
    const state = states[channel.id];
    return state && state.line !== null;
  });
  if (visible.length === 0) return null;

  return (
    <div className="space-y-1">
      {visible.map((channel) => (
        <div
          key={channel.id}
          className="flex items-center gap-2 rounded-lg bg-black/3 px-2.5 py-1.5 text-xs dark:bg-white/5"
        >
          <ProviderIcon provider={channel.id} size={14} />
          <span className="w-16 shrink-0 text-foreground/80">{channel.label}</span>
          <span className="min-w-0 flex-1 truncate text-right text-muted">
            {states[channel.id]?.line}
          </span>
        </div>
      ))}
    </div>
  );
}
