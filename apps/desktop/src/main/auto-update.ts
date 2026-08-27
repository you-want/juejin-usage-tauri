import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AUTO_UPDATE_ACK_COMPLETED_CHANNEL,
  AUTO_UPDATE_CHECK_CHANNEL,
  AUTO_UPDATE_GET_STATE_CHANNEL,
  AUTO_UPDATE_STATE_CHANGED_CHANNEL,
  type AutoUpdateState,
} from '../shared/auto-update';

const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_MARKER_FILENAME = 'auto-update.json';

const UPDATE_FEED_URL =
  'https://gitee.com/juejin-cn/juejin-usage/raw/main/releases/';

let state: AutoUpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
};
let periodicTimer: NodeJS.Timeout | null = null;
let initialized = false;
let installing = false;
let beforeInstall: (() => Promise<void>) | null = null;
let onInstallFailed: (() => Promise<void>) | null = null;

type PendingUpdateMarker = {
  pendingVersion: string;
};

function updateMarkerPath(): string {
  return join(app.getPath('userData'), UPDATE_MARKER_FILENAME);
}

async function clearUpdateMarker(): Promise<void> {
  try {
    await unlink(updateMarkerPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function writeUpdateMarker(version: string): Promise<void> {
  const marker: PendingUpdateMarker = { pendingVersion: version };
  await writeFile(updateMarkerPath(), `${JSON.stringify(marker)}\n`, 'utf8');
}

async function readCompletedVersion(): Promise<string | undefined> {
  try {
    const raw = await readFile(updateMarkerPath(), 'utf8');
    const marker = JSON.parse(raw) as Partial<PendingUpdateMarker>;
    if (
      typeof marker.pendingVersion === 'string' &&
      marker.pendingVersion === app.getVersion()
    ) {
      return marker.pendingVersion;
    }
    await clearUpdateMarker();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        '[jusage-desktop] failed to read update marker:',
        error instanceof Error ? error.message : error,
      );
      await clearUpdateMarker().catch(() => {});
    }
  }
  return undefined;
}

function broadcastState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(AUTO_UPDATE_STATE_CHANGED_CHANNEL, state);
    }
  }
}

function setState(next: AutoUpdateState): void {
  state = {
    ...next,
    ...(state.completedVersion
      ? { completedVersion: state.completedVersion }
      : {}),
  };
  broadcastState();
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : '检查更新失败，请稍后重试';
}

function installErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : '自动安装更新失败，请稍后重试';
}

async function checkForUpdates(): Promise<AutoUpdateState> {
  if (!app.isPackaged) return state;
  if (
    state.status === 'checking' ||
    state.status === 'downloading' ||
    state.status === 'installing'
  ) {
    return state;
  }

  setState({
    status: 'checking',
    currentVersion: app.getVersion(),
  });
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    // electron-updater emits `error` before rejecting. The event handler owns
    // the user-facing state; swallowing here avoids an unhandled rejection.
  }
  return state;
}

async function installDownloadedUpdate(version: string): Promise<void> {
  if (installing) return;
  installing = true;
  setState({
    status: 'installing',
    currentVersion: app.getVersion(),
    version,
    percent: 100,
    checkedAt: state.checkedAt,
  });
  try {
    await writeUpdateMarker(version);
    await beforeInstall?.();
    autoUpdater.quitAndInstall(false, true);
  } catch (error) {
    installing = false;
    await clearUpdateMarker().catch(() => {});
    await recoverFromInstallFailure();
    const message = installErrorMessage(error);
    setState({ ...state, status: 'error', message });
  }
}

async function recoverFromInstallFailure(): Promise<void> {
  try {
    await onInstallFailed?.();
  } catch (error) {
    console.error(
      '[jusage-desktop] failed to recover after update install error:',
      error instanceof Error ? error.message : error,
    );
  }
}

async function acknowledgeCompletedUpdate(): Promise<void> {
  await clearUpdateMarker();
  if (!state.completedVersion) return;
  const { completedVersion: _completedVersion, ...next } = state;
  state = next;
  broadcastState();
}

function registerIpc(): void {
  ipcMain.removeHandler(AUTO_UPDATE_GET_STATE_CHANNEL);
  ipcMain.removeHandler(AUTO_UPDATE_CHECK_CHANNEL);
  ipcMain.removeHandler(AUTO_UPDATE_ACK_COMPLETED_CHANNEL);
  ipcMain.handle(AUTO_UPDATE_GET_STATE_CHANNEL, () => state);
  ipcMain.handle(AUTO_UPDATE_CHECK_CHANNEL, () => checkForUpdates());
  ipcMain.handle(AUTO_UPDATE_ACK_COMPLETED_CHANNEL, () =>
    acknowledgeCompletedUpdate(),
  );
}

export async function initializeAutoUpdate(options: {
  beforeInstall: () => Promise<void>;
  onInstallFailed: () => Promise<void>;
}): Promise<void> {
  if (initialized) return;
  initialized = true;
  installing = false;
  beforeInstall = options.beforeInstall;
  onInstallFailed = options.onInstallFailed;
  const completedVersion = app.isPackaged
    ? await readCompletedVersion()
    : undefined;
  state = {
    status: app.isPackaged ? 'idle' : 'unsupported',
    currentVersion: app.getVersion(),
    ...(completedVersion ? { completedVersion } : {}),
    ...(!app.isPackaged
      ? { message: '开发环境不检查更新，请安装正式构建包后测试' }
      : {}),
  };
  registerIpc();

  if (!app.isPackaged) return;

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: UPDATE_FEED_URL,
  });
  autoUpdater.channel = app.getVersion().includes('-') ? 'beta' : 'latest';
  // channel setter forces allowDowngrade=true; turn it back off so a
  // mis-published older yml cannot overwrite a newer install.
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoDownload = true;
  // We install explicitly after releasing the local runtime owner.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = app.getVersion().includes('-');

  autoUpdater.on('checking-for-update', () => {
    setState({
      status: 'checking',
      currentVersion: app.getVersion(),
    });
  });
  autoUpdater.on('update-available', (info) => {
    setState({
      status: 'available',
      currentVersion: app.getVersion(),
      version: info.version,
      checkedAt: new Date().toISOString(),
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    setState({
      status: 'not-available',
      currentVersion: app.getVersion(),
      version: info.version,
      checkedAt: new Date().toISOString(),
    });
  });
  autoUpdater.on('download-progress', (progress) => {
    setState({
      status: 'downloading',
      currentVersion: app.getVersion(),
      version: state.version,
      percent: Math.max(0, Math.min(100, progress.percent)),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
      checkedAt: state.checkedAt,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    void installDownloadedUpdate(info.version);
  });
  autoUpdater.on('error', (error) => {
    if (installing) {
      installing = false;
      void clearUpdateMarker().catch(() => {});
      void recoverFromInstallFailure();
    }
    setState({
      status: 'error',
      currentVersion: app.getVersion(),
      version: state.version,
      message: errorMessage(error),
      checkedAt: new Date().toISOString(),
    });
  });

  void checkForUpdates();
  periodicTimer = setInterval(() => {
    void checkForUpdates();
  }, PERIODIC_CHECK_INTERVAL_MS);
  periodicTimer.unref();
}

export function disposeAutoUpdate(): void {
  if (periodicTimer) clearInterval(periodicTimer);
  periodicTimer = null;
  ipcMain.removeHandler(AUTO_UPDATE_GET_STATE_CHANNEL);
  ipcMain.removeHandler(AUTO_UPDATE_CHECK_CHANNEL);
  ipcMain.removeHandler(AUTO_UPDATE_ACK_COMPLETED_CHANNEL);
  autoUpdater.removeAllListeners();
  installing = false;
  beforeInstall = null;
  onInstallFailed = null;
  initialized = false;
}
