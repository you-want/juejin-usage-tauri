import { ipcMain } from 'electron';
import { readAntigravitySubscription } from './antigravity-subscription';

export const ANTIGRAVITY_SUBSCRIPTION_GET_CHANNEL = 'antigravity-subscription:get';

export function registerAntigravitySubscriptionIpc(): () => void {
  ipcMain.removeHandler(ANTIGRAVITY_SUBSCRIPTION_GET_CHANNEL);
  ipcMain.handle(ANTIGRAVITY_SUBSCRIPTION_GET_CHANNEL, (_event, options?: { forceRefresh?: boolean }) => readAntigravitySubscription({ forceRefresh: options?.forceRefresh === true }));
  return () => ipcMain.removeHandler(ANTIGRAVITY_SUBSCRIPTION_GET_CHANNEL);
}
