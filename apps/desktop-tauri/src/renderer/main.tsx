import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@juejin-opensource/jusage-desktop-ui/hooks/useTheme';
import { dispatchDataSynced } from '@juejin-opensource/jusage-desktop-ui/lib/shell-events';
import { TrayPopoverView } from '@juejin-opensource/jusage-desktop-ui/components/TrayPopoverView';
import { initTudBridge } from './bridge';
import './index.css';

/** Install the Tauri-backed `window.tud` before anything reads it. */
initTudBridge();

/** Bridge main-process Core sync → same CustomEvent the tray view listens for. */
if (typeof window.tud?.onDataSynced === 'function') {
  window.tud.onDataSynced(() => {
    dispatchDataSynced();
  });
}

// This entry only hosts the tray popover (`?view=tray-popover`) and the pet
// window (`pet.html`, separate entry). The main dashboard window loads the
// bundled dashboard dist as a Tauri static resource (`tauri://localhost/
// dashboard/index.html`, embedded from `src/renderer/public/dashboard/`); its
// `window.tud` bridge is injected by `bridge.rs`'s init script, not this file.
const isTrayPopover = new URLSearchParams(window.location.search).get('view') === 'tray-popover';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isTrayPopover ? (
      <ThemeProvider>
        <TrayPopoverView />
      </ThemeProvider>
    ) : (
      <div data-tud-shell-fallback />
    )}
  </StrictMode>,
);
