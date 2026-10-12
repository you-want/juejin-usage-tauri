import { WorkBuddySubscriptionCard } from './WorkBuddySubscriptionCard';
import type { WorkBuddySubscriptionSnapshot } from '../../shared/workbuddy-subscription';

/** Mounts Workbuddy and Workbuddy CN cards in a subscription grid. */
export function WorkBuddySubscriptionGroup({
  showGlobal = true,
  showMainland = true,
}: {
  showGlobal?: boolean;
  showMainland?: boolean;
} = {}) {
  return (
    <>
      {showGlobal ? (
        <WorkBuddySubscriptionCard
          region="global"
          title="Workbuddy"
          fetcher={(options) => window.tud.getWorkBuddyGlobalSubscription(options) as Promise<WorkBuddySubscriptionSnapshot>}
        />
      ) : null}
      {showMainland ? (
        <WorkBuddySubscriptionCard
          region="mainland"
          title="Workbuddy CN"
          fetcher={(options) => window.tud.getWorkBuddyMainlandSubscription(options) as Promise<WorkBuddySubscriptionSnapshot>}
        />
      ) : null}
    </>
  );
}
