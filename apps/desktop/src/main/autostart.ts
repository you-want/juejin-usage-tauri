/**
 * Desktop open-at-login preference + OS login item registration.
 *
 * Preference lives in Electron userData (not ~/.ai-usage/config.json).
 * setLoginItemSettings only runs when packaged so `electron-vite dev`
 * does not register the Electron binary itself.
 */
import { app, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const AUTOSTART_GET_CHANNEL = 'autostart:get';
const AUTOSTART_SET_CHANNEL = 'autostart:set';

export interface DesktopPetPosition {
  x: number;
  y: number;
}

export interface DesktopPetPref {
  enabled: boolean;
  selectedPetId: string;
  position?: DesktopPetPosition;
  scale: number;
  frameIntervalMs: number;
  autoMoveEnabled: boolean;
  autoMoveIntervalMinutes: number;
}

export const DEFAULT_DESKTOP_PET_SCALE = 0.5;
export const DEFAULT_DESKTOP_PET_FRAME_INTERVAL_MS = 180;
export const DEFAULT_DESKTOP_PET_AUTO_MOVE_ENABLED = true;
export const DEFAULT_DESKTOP_PET_AUTO_MOVE_INTERVAL_MINUTES = 2;

interface DesktopPrefs {
  openAtLogin: boolean;
  desktopPet?: DesktopPetPref;
}

export interface AutostartPref {
  openAtLogin: boolean;
  isFirstRun: boolean;
}

function prefsPath(): string {
  return join(app.getPath('userData'), 'desktop-prefs.json');
}

async function readPrefsFile(): Promise<DesktopPrefs | null> {
  const path = prefsPath();
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DesktopPrefs>;
    if (typeof parsed.openAtLogin !== 'boolean') return null;
    const desktopPet = parsed.desktopPet;
    const hasValidPosition = desktopPet?.position
      && Number.isFinite(desktopPet.position.x)
      && Number.isFinite(desktopPet.position.y);
    return {
      openAtLogin: parsed.openAtLogin,
      desktopPet: desktopPet && typeof desktopPet.enabled === 'boolean'
        ? {
            enabled: desktopPet.enabled,
            selectedPetId: typeof desktopPet.selectedPetId === 'string'
              ? desktopPet.selectedPetId
              : 'hawking',
            ...(hasValidPosition ? { position: desktopPet.position } : {}),
            scale: isDesktopPetScale(desktopPet.scale)
              ? desktopPet.scale
              : DEFAULT_DESKTOP_PET_SCALE,
            frameIntervalMs: isDesktopPetFrameInterval(desktopPet.frameIntervalMs)
              ? desktopPet.frameIntervalMs
              : DEFAULT_DESKTOP_PET_FRAME_INTERVAL_MS,
            autoMoveEnabled: typeof desktopPet.autoMoveEnabled === 'boolean'
              ? desktopPet.autoMoveEnabled
              : DEFAULT_DESKTOP_PET_AUTO_MOVE_ENABLED,
            autoMoveIntervalMinutes: isDesktopPetAutoMoveInterval(desktopPet.autoMoveIntervalMinutes)
              ? desktopPet.autoMoveIntervalMinutes
              : DEFAULT_DESKTOP_PET_AUTO_MOVE_INTERVAL_MINUTES,
          }
        : undefined,
    };
  } catch {
    return null;
  }
}

async function writePrefs(prefs: DesktopPrefs): Promise<void> {
  await writeFile(prefsPath(), `${JSON.stringify(prefs, null, 2)}\n`, 'utf8');
}

function setOsLoginItem(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
  });
}

export async function loadAutostartPref(): Promise<AutostartPref> {
  const existing = await readPrefsFile();
  if (!existing) {
    return { openAtLogin: true, isFirstRun: true };
  }
  return { openAtLogin: existing.openAtLogin, isFirstRun: false };
}

export async function applyAutostart(enabled: boolean): Promise<boolean> {
  const existing = await readPrefsFile();
  await writePrefs({ openAtLogin: enabled, desktopPet: existing?.desktopPet });
  setOsLoginItem(enabled);
  return enabled;
}

export async function loadDesktopPetPref(): Promise<DesktopPetPref> {
  const existing = await readPrefsFile();
  return existing?.desktopPet ?? {
    enabled: false,
    selectedPetId: 'hawking',
    scale: DEFAULT_DESKTOP_PET_SCALE,
    frameIntervalMs: DEFAULT_DESKTOP_PET_FRAME_INTERVAL_MS,
    autoMoveEnabled: DEFAULT_DESKTOP_PET_AUTO_MOVE_ENABLED,
    autoMoveIntervalMinutes: DEFAULT_DESKTOP_PET_AUTO_MOVE_INTERVAL_MINUTES,
  };
}

export async function saveDesktopPetPref(pref: DesktopPetPref): Promise<DesktopPetPref> {
  const existing = await readPrefsFile();
  await writePrefs({
    openAtLogin: existing?.openAtLogin ?? true,
    desktopPet: pref,
  });
  return pref;
}

function isDesktopPetScale(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.35 && value <= 0.75;
}

function isDesktopPetFrameInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 120 && value <= 320;
}

function isDesktopPetAutoMoveInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 120;
}

/** First launch: enable + register. Later: re-apply stored preference. */
export async function initAutostartOnLaunch(): Promise<boolean> {
  const pref = await loadAutostartPref();
  if (pref.isFirstRun) {
    await applyAutostart(true);
    return true;
  }
  setOsLoginItem(pref.openAtLogin);
  return pref.openAtLogin;
}

/** True when OS launched us via login item with openAsHidden. */
export function shouldStartHidden(): boolean {
  if (!app.isPackaged) return false;
  try {
    return Boolean(app.getLoginItemSettings().wasOpenedAsHidden);
  } catch {
    return false;
  }
}

export function registerAutostartIpc(): void {
  ipcMain.removeHandler(AUTOSTART_GET_CHANNEL);
  ipcMain.handle(AUTOSTART_GET_CHANNEL, async () => {
    const pref = await loadAutostartPref();
    return pref.openAtLogin;
  });

  ipcMain.removeHandler(AUTOSTART_SET_CHANNEL);
  ipcMain.handle(AUTOSTART_SET_CHANNEL, async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('openAtLogin must be a boolean');
    }
    return applyAutostart(enabled);
  });
}

export function unregisterAutostartIpc(): void {
  ipcMain.removeHandler(AUTOSTART_GET_CHANNEL);
  ipcMain.removeHandler(AUTOSTART_SET_CHANNEL);
}
