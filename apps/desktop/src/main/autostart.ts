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
const AUTOSTART_GET_HIDDEN_CHANNEL = 'autostart:get-hidden';
const AUTOSTART_SET_HIDDEN_CHANNEL = 'autostart:set-hidden';

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
  /** 开机自启时是否静默启动（仅托盘，不显示主窗口）。默认开启。 */
  launchHidden: boolean;
  desktopPet?: DesktopPetPref;
}

export interface AutostartPref {
  openAtLogin: boolean;
  isFirstRun: boolean;
  launchHidden: boolean;
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
      launchHidden: typeof parsed.launchHidden === 'boolean'
        ? parsed.launchHidden
        : true,
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

function setOsLoginItem(enabled: boolean, launchHidden: boolean): void {
  if (!app.isPackaged) return;
  if (process.platform === 'darwin') {
    // openAsHidden / wasOpenedAsHidden 仅 macOS 支持。
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: launchHidden,
    });
    return;
  }
  // Windows/Linux：openAsHidden 会被忽略，改为让登录项命令携带
  // --hidden 参数，启动时经 shouldStartHidden() 检测 process.argv。
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: launchHidden ? ['--hidden'] : [],
  });
}

export async function loadAutostartPref(): Promise<AutostartPref> {
  const existing = await readPrefsFile();
  if (!existing) {
    return { openAtLogin: true, isFirstRun: true, launchHidden: true };
  }
  return {
    openAtLogin: existing.openAtLogin,
    isFirstRun: false,
    launchHidden: existing.launchHidden,
  };
}

export async function applyAutostart(
  enabled: boolean,
  launchHidden?: boolean,
): Promise<boolean> {
  const existing = await readPrefsFile();
  const hidden = launchHidden ?? existing?.launchHidden ?? true;
  await writePrefs({
    openAtLogin: enabled,
    launchHidden: hidden,
    desktopPet: existing?.desktopPet,
  });
  setOsLoginItem(enabled, hidden);
  return enabled;
}

/** 读取「开机静默启动」偏好，默认开启。 */
export async function loadLaunchHidden(): Promise<boolean> {
  const existing = await readPrefsFile();
  return existing?.launchHidden ?? true;
}

/** 切换「开机静默启动」偏好并同步到系统登录项。 */
export async function setLaunchHidden(hidden: boolean): Promise<boolean> {
  const existing = await readPrefsFile();
  const openAtLogin = existing?.openAtLogin ?? true;
  await writePrefs({
    openAtLogin,
    launchHidden: hidden,
    desktopPet: existing?.desktopPet,
  });
  setOsLoginItem(openAtLogin, hidden);
  return hidden;
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
    launchHidden: existing?.launchHidden ?? true,
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
  setOsLoginItem(pref.openAtLogin, pref.launchHidden);
  return pref.openAtLogin;
}

/**
 * True when OS launched us via a silent login item (tray-only startup).
 * macOS reports it via wasOpenedAsHidden; Windows/Linux detect the --hidden
 * arg that setOsLoginItem registers on the login-item command line.
 */
export function shouldStartHidden(): boolean {
  if (!app.isPackaged) return false;
  try {
    if (process.platform === 'darwin') {
      return Boolean(app.getLoginItemSettings().wasOpenedAsHidden);
    }
    return process.argv.includes('--hidden');
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

  ipcMain.removeHandler(AUTOSTART_GET_HIDDEN_CHANNEL);
  ipcMain.handle(AUTOSTART_GET_HIDDEN_CHANNEL, async () => loadLaunchHidden());

  ipcMain.removeHandler(AUTOSTART_SET_HIDDEN_CHANNEL);
  ipcMain.handle(AUTOSTART_SET_HIDDEN_CHANNEL, async (_event, hidden: unknown) => {
    if (typeof hidden !== 'boolean') {
      throw new Error('launchHidden must be a boolean');
    }
    return setLaunchHidden(hidden);
  });
}

export function unregisterAutostartIpc(): void {
  ipcMain.removeHandler(AUTOSTART_GET_CHANNEL);
  ipcMain.removeHandler(AUTOSTART_SET_CHANNEL);
  ipcMain.removeHandler(AUTOSTART_GET_HIDDEN_CHANNEL);
  ipcMain.removeHandler(AUTOSTART_SET_HIDDEN_CHANNEL);
}
