import { ipcMain } from 'electron';
import { readZcodeSubscription } from './zcode-subscription';

export const ZCODE_SUBSCRIPTION_GET_CHANNEL = 'zcode-subscription:get';

export function registerZcodeSubscriptionIpc(): () => void {
  ipcMain.removeHandler(ZCODE_SUBSCRIPTION_GET_CHANNEL);
  ipcMain.handle(ZCODE_SUBSCRIPTION_GET_CHANNEL, (_event, options?: { forceRefresh?: boolean }) => readZcodeSubscription({ forceRefresh: options?.forceRefresh === true }));
  return () => ipcMain.removeHandler(ZCODE_SUBSCRIPTION_GET_CHANNEL);
}
