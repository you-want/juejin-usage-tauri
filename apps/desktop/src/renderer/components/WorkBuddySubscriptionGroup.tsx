import { WorkBuddySubscriptionCard } from './WorkBuddySubscriptionCard';
import type { WorkBuddySubscriptionSnapshot } from '../../shared/workbuddy-subscription';

/** Mounts Workbuddy and Workbuddy CN cards in the tray grid. */
export function WorkBuddySubscriptionGroup() {
  return (
    <>
      <WorkBuddySubscriptionCard
        region="global"
        title="Workbuddy"
        fetcher={() => window.tud.getWorkBuddyGlobalSubscription() as Promise<WorkBuddySubscriptionSnapshot>}
      />
      <WorkBuddySubscriptionCard
        region="mainland"
        title="Workbuddy CN"
        fetcher={() => window.tud.getWorkBuddyMainlandSubscription() as Promise<WorkBuddySubscriptionSnapshot>}
      />
    </>
  );
}
