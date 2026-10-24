/**
 * Ambient global typings shared between preload and renderer.
 *
 * The preload script (src/preload/index.ts) calls
 * `contextBridge.exposeInMainWorld('tud', ...)`; the renderer reads it
 * off `window.tud`. Keeping the contract in a single ambient type makes
 * both ends stay in sync.
 */
declare global {
  interface Window {
    tud: {
      version: () => string;
      platform: NodeJS.Platform;
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      showMainWindow: () => void;
      quit: () => void;
      getAutoUpdateState: () => Promise<import('@juejin-opensource/jusage-desktop-ui/shared/auto-update').AutoUpdateState>;
      checkForUpdates: () => Promise<import('@juejin-opensource/jusage-desktop-ui/shared/auto-update').AutoUpdateState>;
      installDownloadedUpdate: () => Promise<import('@juejin-opensource/jusage-desktop-ui/shared/auto-update').AutoUpdateState>;
      acknowledgeUpdateCompleted: () => Promise<void>;
      onAutoUpdateStateChanged: (
        callback: (state: import('@juejin-opensource/jusage-desktop-ui/shared/auto-update').AutoUpdateState) => void,
      ) => () => void;
      copyImageToClipboard: (dataUrl: string) => Promise<boolean>;
      openExternal: (
        url: string,
      ) => Promise<{ ok: boolean; message?: string }>;
      resizeTrayPopover: (height: number) => void;
      getDashboardRange: () => Promise<
        import('@juejin-opensource/jusage-desktop-ui/shared/dashboard-range').DashboardRange
      >;
      setDashboardRange: (
        range: import('@juejin-opensource/jusage-desktop-ui/shared/dashboard-range').DashboardRange,
      ) => Promise<import('@juejin-opensource/jusage-desktop-ui/shared/dashboard-range').DashboardRange>;
      onDashboardRange: (
        callback: (range: import('@juejin-opensource/jusage-desktop-ui/shared/dashboard-range').DashboardRange) => void,
      ) => () => void;
      getTheme: () => Promise<{
        mode: import('@juejin-opensource/jusage-desktop-ui/shared/theme').ThemeMode;
        resolved: import('@juejin-opensource/jusage-desktop-ui/shared/theme').Theme;
      }>;
      setThemeMode: (mode: import('@juejin-opensource/jusage-desktop-ui/shared/theme').ThemeMode) => void;
      onThemeChanged: (
        callback: (state: {
          mode: import('@juejin-opensource/jusage-desktop-ui/shared/theme').ThemeMode;
          resolved: import('@juejin-opensource/jusage-desktop-ui/shared/theme').Theme;
        }) => void,
      ) => () => void;
      getOpenAtLogin: () => Promise<boolean>;
      setOpenAtLogin: (enabled: boolean) => Promise<boolean>;
      getLaunchHidden: () => Promise<boolean>;
      setLaunchHidden: (hidden: boolean) => Promise<boolean>;
      getDesktopPet: () => Promise<{
        enabled: boolean;
        selectedPetId: string;
        position?: { x: number; y: number };
        scale: number;
        frameIntervalMs: number;
        autoMoveEnabled: boolean;
        autoMoveIntervalMinutes: number;
        syncFeedbackEnabled?: boolean;
        syncFeedbackDurationSec?: number;
      }>;
      setDesktopPetEnabled: (enabled: boolean) => Promise<boolean>;
      setSelectedDesktopPet: (selectedPetId: string) => Promise<{
        enabled: boolean;
        selectedPetId: string;
        position?: { x: number; y: number };
        scale: number;
        frameIntervalMs: number;
        autoMoveEnabled: boolean;
        autoMoveIntervalMinutes: number;
        syncFeedbackEnabled?: boolean;
        syncFeedbackDurationSec?: number;
      }>;
      setDesktopPetPreferences: (changes: {
        scale?: number;
        frameIntervalMs?: number;
        autoMoveEnabled?: boolean;
        autoMoveIntervalMinutes?: number;
      }) => Promise<{
        enabled: boolean;
        selectedPetId: string;
        position?: { x: number; y: number };
        scale: number;
        frameIntervalMs: number;
        autoMoveEnabled: boolean;
        autoMoveIntervalMinutes: number;
        syncFeedbackEnabled?: boolean;
        syncFeedbackDurationSec?: number;
      }>;
      setDesktopPetMouseIgnored: (ignored: boolean) => void;
      beginDesktopPetDrag: () => void;
      endDesktopPetDrag: () => void;
      /** Tauri: right-click on the pet pops the native menu (Electron auto). */
      showPetContextMenu?: (x: number, y: number) => void;
      /** Built-ins + local scan of `~/.ai-usage/pets/` (sidecar proxied). */
      refreshDesktopPetCatalog: () => Promise<{
        pets: Array<{
          id: string;
          displayName: string;
          description: string;
          source: 'builtin' | 'local' | 'remote';
          previewUrl?: string;
        }>;
        invalidPets: Array<{ directory: string; reason: string }>;
        selectedPetId: string;
        remoteError?: string | null;
      }>;
      fetchRemoteDesktopPetCatalog: (force?: boolean) => Promise<{
        pets: Array<{
          id: string;
          displayName: string;
          description: string;
          source: 'builtin' | 'local' | 'remote';
          previewUrl?: string;
        }>;
        invalidPets: Array<{ directory: string; reason: string }>;
        selectedPetId: string;
        remoteError?: string | null;
      }>;
      installRemoteDesktopPet: (id: string) => Promise<{
        pets: Array<{
          id: string;
          displayName: string;
          description: string;
          source: 'builtin' | 'local' | 'remote';
          previewUrl?: string;
        }>;
        invalidPets: Array<{ directory: string; reason: string }>;
        selectedPetId: string;
        remoteError?: string | null;
      }>;
      openDesktopPetDirectory: () => Promise<void>;
      /** Loopback URL for a local pet's atlas; null for built-ins. */
      desktopPetSpritesheetUrl: (id: string) => Promise<string | null>;
      onDesktopPetAnimation: (
        callback: (animation: 'idle' | 'running-left' | 'running-right') => void,
      ) => () => void;
      onDesktopPetPreferences: (callback: (preferences: {
        enabled: boolean;
        selectedPetId: string;
        position?: { x: number; y: number };
        scale: number;
        frameIntervalMs: number;
        autoMoveEnabled: boolean;
        autoMoveIntervalMinutes: number;
        syncFeedbackEnabled?: boolean;
        syncFeedbackDurationSec?: number;
      }) => void) => () => void;
      onDataSynced?: (
        callback: (payload?: {
          addedTokens?: number;
          isDailyRecord?: boolean;
          activeStreakDays?: number;
        }) => void,
      ) => () => void;
      getShowTrayUsage?: () => Promise<boolean>;
      setShowTrayUsage?: (enabled: boolean) => Promise<boolean>;
      getTrayUsageMode?: () => Promise<'both' | 'tokens' | 'cost'>;
      setTrayUsageMode?: (mode: 'both' | 'tokens' | 'cost') => Promise<string>;
      subscriptionSnapshot?: (
        channel: string,
      ) => Promise<{ status: number; body: unknown }>;
      onMaximized: (callback: (isMaximized: boolean) => void) => () => void;
      api: {
        request: (
          path: string,
          init?: {
            method?: string;
            body?: string;
            headers?: Record<string, string>;
          },
        ) => Promise<{ status: number; body: unknown }>;
      };
      onDataSynced: (callback: () => void) => () => void;
      onOpenSettings: (
        callback: (detail?: {
          tab?: 'sync' | 'pet' | 'app';
          reloadConfig?: boolean;
          loginSuccess?: boolean;
          loginError?: string;
        }) => void,
      ) => () => void;
      onJuejinLinkResult: (
        callback: (detail: { ok: boolean; message?: string }) => void,
      ) => () => void;
      onRuntimeNotice: (
        callback: (detail: { kind: 'config-reset'; tokenSalvaged: boolean }) => void,
      ) => () => void;
    };
  }
}

export {};
