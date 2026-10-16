import { ipcMain, net, safeStorage } from 'electron';
import { createQoderSubscriptionReader, loadQoderAccount } from './qoder-subscription';

export const QODER_SUBSCRIPTION_GET_CHANNEL = 'qoder-subscription:get';

export function registerQoderSubscriptionIpc(): () => void {
  const readQoderSubscription = createQoderSubscriptionReader(
    (options) => loadQoderAccount({ ...options, decryptString: (value) => safeStorage.decryptString(value) }),
    (url, init) => net.fetch(url instanceof URL ? url.href : url, init),
  );
  ipcMain.removeHandler(QODER_SUBSCRIPTION_GET_CHANNEL);
  ipcMain.handle(QODER_SUBSCRIPTION_GET_CHANNEL, (_event, options?: { forceRefresh?: boolean }) => readQoderSubscription({ forceRefresh: options?.forceRefresh === true }));
  return () => ipcMain.removeHandler(QODER_SUBSCRIPTION_GET_CHANNEL);
}
