import { useEffect, useState } from 'react';
import { Toast, ToastQueue } from '@heroui/react';
import { AutoUpdateNotice } from './AutoUpdateNotice';
import type { AppToastContent } from './AppToastProvider';
import { DesktopSettingsModal } from './SettingsModal';
import {
  OPEN_SETTINGS_EVENT,
  dispatchJuejinLinkChanged,
  type OpenSettingsDetail,
  type SettingsTabId,
} from '../lib/shell-events';
import { tud } from '../lib/tud-bridge';

/** Deep-link login receipt, re-published as DOM by the injected bridge. */
const JUEJIN_LINK_RESULT_EVENT = 'tud:juejin-link-result';
/** Config-reset receipt from the local runtime. */
const RUNTIME_NOTICE_EVENT = 'tud:runtime-notice';

type JuejinLinkResultDetail = {
  ok: boolean;
  message?: string;
};

type RuntimeNoticeDetail = {
  kind: 'config-reset';
  tokenSalvaged: boolean;
};

/**
 * Desktop shell layer mounted inside the dashboard page (Tauri build via
 * `VITE_DESKTOP_SHELL`, Electron AppShell equivalent). Owns everything the
 * shell adds on top of the shared dashboard: the 4-tab settings modal, update
 * completion toast, deep-link login receipt and runtime notices.
 */
export function DesktopShell() {
  const [toastQueue] = useState(
    () => new ToastQueue<AppToastContent>({ maxVisibleToasts: 1 }),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('pet');
  const hasBridge = Boolean(tud());

  // Shell requests (tray / pet menu / deep link / sidebar button) arrive as
  // the shared `tud:open-settings` DOM event.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenSettingsDetail>).detail;
      if (detail?.tab) setSettingsTab(detail.tab);
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
  }, []);

  // Deep-link login receipt: toast + refresh any「关联掘金」chrome.
  useEffect(() => {
    const onLinkResult = (event: Event) => {
      const detail = (event as CustomEvent<JuejinLinkResultDetail>).detail;
      if (detail?.ok) {
        toastQueue.add({ title: '掘金账号关联成功', variant: 'success' });
      } else {
        toastQueue.add({
          title: '关联失败',
          description: detail?.message,
          variant: 'danger',
        });
      }
      dispatchJuejinLinkChanged();
    };
    window.addEventListener(JUEJIN_LINK_RESULT_EVENT, onLinkResult);
    return () => window.removeEventListener(JUEJIN_LINK_RESULT_EVENT, onLinkResult);
  }, [toastQueue]);

  // Runtime notices (corrupt-config rebuild) from the local runtime.
  useEffect(() => {
    const onRuntimeNotice = (event: Event) => {
      const detail = (event as CustomEvent<RuntimeNoticeDetail>).detail;
      if (detail?.kind !== 'config-reset') return;
      toastQueue.add({
        title: '本地配置已重置',
        description: detail.tokenSalvaged
          ? '检测到配置损坏，已自动重建并保留上报凭据。'
          : '检测到配置损坏，已自动重建；上报凭据丢失，请重新登录关联。',
        variant: 'warning',
      });
    };
    window.addEventListener(RUNTIME_NOTICE_EVENT, onRuntimeNotice);
    return () => window.removeEventListener(RUNTIME_NOTICE_EVENT, onRuntimeNotice);
  }, [toastQueue]);

  if (!hasBridge) return null;

  return (
    <>
      <Toast.Provider placement="top end" queue={toastQueue} />
      <AutoUpdateNotice toastQueue={toastQueue} />
      <DesktopSettingsModal
        isOpen={settingsOpen}
        onOpenChange={setSettingsOpen}
        activeTab={settingsTab}
        onTabChange={setSettingsTab}
      />
    </>
  );
}
