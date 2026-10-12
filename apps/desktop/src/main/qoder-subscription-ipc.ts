import { ipcMain } from 'electron';
import { readQoderSubscription } from './qoder-subscription';

export const QODER_SUBSCRIPTION_GET_CHANNEL = 'qoder-subscription:get';

export function registerQoderSubscriptionIpc(): () => void {
  ipcMain.removeHandler(QODER_SUBSCRIPTION_GET_CHANNEL);
  ipcMain.handle(QODER_SUBSCRIPTION_GET_CHANNEL, (_event, options?: { forceRefresh?: boolean }) => readQoderSubscription({ forceRefresh: options?.forceRefresh === true }));
  return () => ipcMain.removeHandler(QODER_SUBSCRIPTION_GET_CHANNEL);
}
