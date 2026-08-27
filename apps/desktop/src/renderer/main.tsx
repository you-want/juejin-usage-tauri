import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from './hooks/useTheme';
import { dispatchDataSynced } from './lib/shell-events';
import { router } from './router';
import { TrayPopoverView } from './components/TrayPopoverView';
import { DesktopPetView } from './components/DesktopPetView';
import './index.css';

/** Bridge main-process Core sync → same CustomEvent pages already listen for. */
if (typeof window.tud?.onDataSynced === 'function') {
  window.tud.onDataSynced(() => {
    dispatchDataSynced();
  });
}

const isTrayPopover = new URLSearchParams(window.location.search).get('view') === 'tray-popover';
const isDesktopPet = new URLSearchParams(window.location.search).get('view') === 'desktop-pet';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDesktopPet ? (
      <DesktopPetView />
    ) : isTrayPopover ? (
      <ThemeProvider>
        <TrayPopoverView />
      </ThemeProvider>
    ) : (
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    )}
  </StrictMode>,
);
