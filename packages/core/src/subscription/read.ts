import type { SubscriptionChannelId, SubscriptionReadOptions } from './index.js';
import type { CodexSubscriptionSnapshot } from './shared/codex-subscription.js';
import { readCodexSubscription } from './readers/codex-subscription.js';
import type { ClaudeSubscriptionSnapshot } from './shared/claude-subscription.js';
import { readClaudeSubscription } from './readers/claude-subscription.js';
import type { CursorSubscriptionSnapshot } from './shared/cursor-subscription.js';
import { readCursorSubscription } from './readers/cursor-subscription.js';
import type { CopilotSubscriptionSnapshot } from './shared/copilot-subscription.js';
import { readCopilotSubscription } from './readers/copilot-subscription.js';
import type { GrokSubscriptionSnapshot } from './shared/grok-subscription.js';
import { readGrokSubscription } from './readers/grok-subscription.js';
import type { KimiSubscriptionSnapshot } from './shared/kimi-subscription.js';
import { readKimiSubscriptions } from './readers/kimi-subscription.js';
import type { ZcodeSubscriptionSnapshot } from './shared/zcode-subscription.js';
import { readZcodeSubscription } from './readers/zcode-subscription.js';
import type { AntigravitySubscriptionSnapshot } from './shared/antigravity-subscription.js';
import { readAntigravitySubscription } from './readers/antigravity-subscription.js';
import type { QoderSubscriptionSnapshot } from './shared/qoder-subscription.js';
import { readQoderSubscription } from './readers/qoder-subscription.js';
import type { MiniMaxSubscriptionSnapshot } from './shared/minimax-subscription.js';
import { readMiniMaxSubscription } from './readers/minimax-subscription.js';
import type { OpenCodeSubscriptionSnapshot } from './shared/opencode-subscription.js';
import { readOpenCodeSubscription } from './readers/opencode-subscription.js';
import type { DeepSeekSubscriptionSnapshot } from './shared/deepseek-subscription.js';
import { readDeepSeekSubscription } from './readers/deepseek-subscription.js';

export interface SubscriptionSnapshotByChannel {
  codex: CodexSubscriptionSnapshot;
  claude: ClaudeSubscriptionSnapshot;
  cursor: CursorSubscriptionSnapshot;
  copilot: CopilotSubscriptionSnapshot;
  grok: GrokSubscriptionSnapshot;
  kimi: KimiSubscriptionSnapshot[];
  zcode: ZcodeSubscriptionSnapshot;
  antigravity: AntigravitySubscriptionSnapshot;
  qoder: QoderSubscriptionSnapshot;
  minimax: MiniMaxSubscriptionSnapshot;
  opencode: OpenCodeSubscriptionSnapshot;
  deepseek: DeepSeekSubscriptionSnapshot;
}

const readers: { [K in SubscriptionChannelId]: (options?: SubscriptionReadOptions) => Promise<SubscriptionSnapshotByChannel[K]> } = {
  codex: readCodexSubscription,
  claude: readClaudeSubscription,
  cursor: readCursorSubscription,
  copilot: readCopilotSubscription,
  grok: readGrokSubscription,
  kimi: readKimiSubscriptions,
  zcode: readZcodeSubscription,
  antigravity: readAntigravitySubscription,
  qoder: readQoderSubscription,
  minimax: readMiniMaxSubscription,
  opencode: readOpenCodeSubscription,
  deepseek: readDeepSeekSubscription,
};

export function readSubscription<K extends SubscriptionChannelId>(
  channel: K,
  options?: SubscriptionReadOptions,
): Promise<SubscriptionSnapshotByChannel[K]> {
  return readers[channel](options);
}
