import { AntigravitySubscriptionCard } from './AntigravitySubscriptionCard';
import { ClaudeSubscriptionCard } from './ClaudeSubscriptionCard';
import { CodexSubscriptionCard } from './CodexSubscriptionCard';
import { CursorSubscriptionCard } from './CursorSubscriptionCard';
import { DeepSeekSubscriptionCard } from './DeepSeekSubscriptionCard';
import { GrokSubscriptionCard } from './GrokSubscriptionCard';
import { KimiSubscriptionCard } from './KimiSubscriptionCard';
import { MiniMaxSubscriptionCard } from './MiniMaxSubscriptionCard';
import { OpenCodeSubscriptionCard } from './OpenCodeSubscriptionCard';
import { QoderSubscriptionCard } from './QoderSubscriptionCard';
import { TraeSubscriptionGroup } from './TraeSubscriptionGroup';
import { WorkBuddySubscriptionGroup } from './WorkBuddySubscriptionGroup';
import { ZcodeSubscriptionCard } from './ZcodeSubscriptionCard';

interface SubscriptionUsageGridProps {
  className?: string;
}

/** Shared subscription allowance cards used by the macOS tray and dashboard. */
export function SubscriptionUsageGrid({ className = '' }: SubscriptionUsageGridProps) {
  return (
    <section
      aria-label="订阅额度"
      className={`grid empty:hidden ${className}`.trim()}
    >
      <CodexSubscriptionCard />
      <ClaudeSubscriptionCard />
      <CursorSubscriptionCard />
      <GrokSubscriptionCard />
      <KimiSubscriptionCard />
      <ZcodeSubscriptionCard />
      <AntigravitySubscriptionCard />
      <QoderSubscriptionCard />
      <MiniMaxSubscriptionCard />
      <OpenCodeSubscriptionCard />
      <DeepSeekSubscriptionCard />
      <WorkBuddySubscriptionGroup />
      <TraeSubscriptionGroup />
    </section>
  );
}
