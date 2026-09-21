import { TraeSubscriptionCard } from './TraeSubscriptionCard';
import type { TraeSubscriptionSnapshot } from '../../shared/trae-subscription';

/** Mounts TRAE and TRAE CN cards in the tray grid. */
export function TraeSubscriptionGroup() {
  return (
    <>
      <TraeSubscriptionCard
        region="global"
        title="TRAE"
        fetcher={() => window.tud.getTraeGlobalSubscription() as Promise<TraeSubscriptionSnapshot>}
      />
      <TraeSubscriptionCard
        region="mainland"
        title="TRAE CN"
        fetcher={() => window.tud.getTraeCnSubscription() as Promise<TraeSubscriptionSnapshot>}
      />
    </>
  );
}
