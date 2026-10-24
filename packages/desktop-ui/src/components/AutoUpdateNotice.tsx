import type { ToastQueue } from '@heroui/react';
import { useEffect, useRef } from 'react';
import type { AutoUpdateState } from '../shared/auto-update';
import { tud } from '../lib/tud-bridge';
import type { AppToastContent } from './AppToastProvider';

type AutoUpdateNoticeProps = {
  toastQueue: ToastQueue<AppToastContent>;
};

/** Shows a one-time success toast after an automatic update restarts the app. */
export function AutoUpdateNotice({ toastQueue }: AutoUpdateNoticeProps) {
  const notifiedVersion = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const bridge = tud();
    if (!bridge) return;

    const showCompletedToast = (state: AutoUpdateState) => {
      const version = state.completedVersion;
      if (!version || notifiedVersion.current === version) return;

      notifiedVersion.current = version;
      toastQueue.add({
        title: `已更新至 v${version}`,
        description: '新版本已安装完成。',
        variant: 'success',
      });
      void bridge.acknowledgeUpdateCompleted().catch((reason) => {
        if (!cancelled) {
          console.warn('确认更新完成通知失败:', reason);
        }
      });
    };

    const unsubscribe = bridge.onAutoUpdateStateChanged(showCompletedToast);
    void bridge
      .getAutoUpdateState()
      .then((state) => {
        if (!cancelled) showCompletedToast(state);
      })
      .catch(() => {
        // Settings keeps the detailed error and retry flow for state failures.
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [toastQueue]);

  return null;
}
