/**
 * Typed accessor for the desktop shell bridge (`window.tud`).
 *
 * Both shells install the same surface — Electron via preload
 * `contextBridge`, Tauri via the injected init script (`bridge.rs`) for the
 * dashboard window and `renderer/bridge.ts` for shell windows. Components
 * consume it through this accessor instead of the ambient `window.tud` so the
 * package typechecks in any host without a global `.d.ts`.
 *
 * Members that only exist once a shell implements them (pet catalog scan /
 * remote install, tray usage capsule) are optional; UIs must feature-detect.
 */

import type { AutoUpdateState } from '../shared/auto-update';

export interface DesktopPetPreferences {
  enabled: boolean;
  selectedPetId: string;
  scale: number;
  frameIntervalMs: number;
  autoMoveEnabled: boolean;
  autoMoveIntervalMinutes: number;
  syncFeedbackEnabled?: boolean;
  syncFeedbackDurationSec?: number;
}

export interface DesktopPetCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  source: 'builtin' | 'local' | 'remote';
  /** Raw spritesheet URL (community pets before install). */
  previewUrl?: string;
}

export interface DesktopPetInvalidEntry {
  directory: string;
  reason: string;
}

export interface DesktopPetCatalog {
  pets: DesktopPetCatalogEntry[];
  invalidPets: DesktopPetInvalidEntry[];
  selectedPetId: string;
  remoteError?: string | null;
}

export type TrayUsageMode = 'both' | 'tokens' | 'cost';

export interface TudBridge {
  platform: string;
  version(): Promise<string>;

  /** Local-api transport ({ status, body } envelope). */
  api: {
    request(
      path: string,
      init?: {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
      },
    ): Promise<{ status: number; body: unknown }>;
  };

  openExternal(url: string): Promise<{ ok: boolean; message?: string }>;
  showMainWindow(): Promise<void>;
  resizeTrayPopover(height: number): Promise<void>;

  getTheme(): Promise<{ mode: string; resolved: string }>;
  setThemeMode(mode: string): Promise<void>;
  onThemeChanged(cb: (state: { mode: string; resolved: string }) => void): () => void;
  onDataSynced(cb: (payload?: unknown) => void): () => void;

  getDashboardRange(): Promise<string>;
  setDashboardRange(range: string): Promise<void>;
  onDashboardRange(cb: (range: string) => void): () => void;

  /** Loopback atlas URL for a locally installed pet; null for built-ins. */
  desktopPetSpritesheetUrl?(id: string): Promise<string | null>;

  setDesktopPetMouseIgnored(ignored: boolean): Promise<void>;
  beginDesktopPetDrag(): Promise<void>;
  endDesktopPetDrag(): Promise<void>;
  showPetContextMenu(x: number, y: number): Promise<void>;
  onDesktopPetAnimation(cb: (animation: string) => void): () => void;

  getDesktopPet(): Promise<DesktopPetPreferences>;
  setDesktopPetEnabled(enabled: boolean): Promise<unknown>;
  setSelectedDesktopPet(selectedPetId: string): Promise<unknown>;
  setDesktopPetPreferences(changes: Partial<Omit<DesktopPetPreferences, 'enabled' | 'selectedPetId'>>): Promise<DesktopPetPreferences>;
  onDesktopPetPreferences(cb: (pref: DesktopPetPreferences) => void): () => void;

  /** Local catalog scan (`~/.ai-usage/pets/`); absent = built-ins only. */
  refreshDesktopPetCatalog?(): Promise<DesktopPetCatalog>;
  /** Community catalog (Gitee/GitHub); absent = remote section hidden. */
  fetchRemoteDesktopPetCatalog?(force?: boolean): Promise<DesktopPetCatalog>;
  installRemoteDesktopPet?(id: string): Promise<DesktopPetCatalog>;
  openDesktopPetDirectory?(): Promise<string | null>;

  getOpenAtLogin(): Promise<boolean>;
  setOpenAtLogin(enabled: boolean): Promise<void>;
  getLaunchHidden(): Promise<boolean>;
  setLaunchHidden(hidden: boolean): Promise<void>;

  /** macOS menu-bar usage capsule; absent = section hidden. */
  getShowTrayUsage?(): Promise<boolean>;
  setShowTrayUsage?(enabled: boolean): Promise<void>;
  getTrayUsageMode?(): Promise<TrayUsageMode>;
  setTrayUsageMode?(mode: TrayUsageMode): Promise<void>;

  getAutoUpdateState(): Promise<AutoUpdateState>;
  checkForUpdates(): Promise<AutoUpdateState>;
  installDownloadedUpdate(): Promise<void>;
  acknowledgeUpdateCompleted(): Promise<void>;
  onAutoUpdateStateChanged(cb: (state: AutoUpdateState) => void): () => void;
}

/** The desktop shell bridge, when running inside a desktop webview. */
export function tud(): TudBridge | undefined {
  // `unknown` first: hosts with their own stricter `window.tud` ambient
  // declaration would otherwise fail the direct cast.
  return (window as unknown as { tud?: TudBridge }).tud;
}

export function isTrayUsageMode(value: unknown): value is TrayUsageMode {
  return value === 'both' || value === 'tokens' || value === 'cost';
}
