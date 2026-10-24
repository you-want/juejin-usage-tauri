import { TraeSubscriptionCard } from './TraeSubscriptionCard';
import type { TraeSubscriptionSnapshot } from '../../shared/trae-subscription';

/** Mounts TRAE and TRAE CN cards in a subscription grid. */
export function TraeSubscriptionGroup({
  showGlobal = true,
  showMainland = true,
}: {
  showGlobal?: boolean;
  showMainland?: boolean;
} = {}) {
  return (
    <>
      {showGlobal ? (
        <TraeSubscriptionCard
          region="global"
          title="TRAE"
          fetcher={(options) => window.tud.getTraeGlobalSubscription(options) as Promise<TraeSubscriptionSnapshot>}
        />
      ) : null}
      {showMainland ? (
        <TraeSubscriptionCard
          region="mainland"
          title="TRAE CN"
          fetcher={(options) => window.tud.getTraeCnSubscription(options) as Promise<TraeSubscriptionSnapshot>}
        />
      ) : null}
    </>
  );
}
