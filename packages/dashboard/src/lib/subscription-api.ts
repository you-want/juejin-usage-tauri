import type { SubscriptionReadOptions, SubscriptionSnapshotByChannel } from '@juejin-opensource/jusage-core/subscription';
import { isCliBackend } from './api';
import { createSubscriptionClient } from './subscription-request';

/**
 * Desktop shells (Tauri main window) load the dashboard from a non-HTTP
 * origin (`tauri://localhost`), so a bare relative fetch can never reach the
 * sidecar's local-api. Route through the `window.tud` bridge when present;
 * plain `fetch` otherwise (CLI panel / web are same-origin or proxied).
 */
function bridgeAwareFetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const bridgeRequest = (
    (window as Window & {
      tud?: {
        api?: {
          request?: (
            path: string,
            init?: { method?: string },
          ) => Promise<{ status: number; body: unknown }>;
        };
      };
    }).tud?.api?.request
  );
  if (typeof bridgeRequest !== 'function' || typeof input !== 'string') {
    return fetch(input, init);
  }
  return bridgeRequest(input, { method: init?.method ?? 'GET' }).then(
    ({ status, body }) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }) as unknown as Response,
  );
}

const read = createSubscriptionClient(isCliBackend(), bridgeAwareFetcher as typeof fetch);

export const subscriptionApi = {
  getCodexSubscription: (options?: SubscriptionReadOptions): Promise<SubscriptionSnapshotByChannel['codex']> => read('codex', options),
  getClaudeSubscription: (options?: SubscriptionReadOptions & { allowCredentialAccess?: boolean }): Promise<SubscriptionSnapshotByChannel['claude']> => read('claude', options),
  getCursorSubscription: (options?: SubscriptionReadOptions): Promise<SubscriptionSnapshotByChannel['cursor']> => read('cursor', options),
  getCopilotSubscription: (options?: SubscriptionReadOptions): Promise<SubscriptionSnapshotByChannel['copilot']> => read('copilot', options),
  getGrokSubscription: (options?: SubscriptionReadOptions): Promise<SubscriptionSnapshotByChannel['grok']> => read('grok', options),
  getKimiSubscription: (options?: SubscriptionReadOptions): Promise<SubscriptionSnapshotByChannel['kimi']> => read('kimi', options),
  getZcodeSubscription: (options?: SubscriptionReadOptions): Promise<SubscriptionSnapshotByChannel['zcode']> => read('zcode', options),
  getAntigravitySubscription: (options?: SubscriptionReadOptions): Promise<SubscriptionSnapshotByChannel['antigravity']> => read('antigravity', options),
  getQoderSubscription: (options?: SubscriptionReadOptions): Promise<SubscriptionSnapshotByChannel['qoder']> => read('qoder', options),
  getMiniMaxSubscription: (options?: SubscriptionReadOptions): Promise<SubscriptionSnapshotByChannel['minimax']> => read('minimax', options),
  getOpenCodeSubscription: (options?: SubscriptionReadOptions): Promise<SubscriptionSnapshotByChannel['opencode']> => read('opencode', options),
  getDeepSeekSubscription: (options?: SubscriptionReadOptions): Promise<SubscriptionSnapshotByChannel['deepseek']> => read('deepseek', options),
};
