/**
 * Custom URL scheme: `juejin-usage://link?user_id=...&token=...&origin_user_id=...&user_name=...&avatar_large=...`
 *
 * Used by external hosts (e.g. Juejin web) to associate a user and auto-write
 * the opaque `jau.` upload token into ~/.ai-usage/config.json.
 */
import path from 'node:path';
import { app } from 'electron';
import { localApiRequest } from './local-runtime';

export const PROTOCOL_SCHEME = 'juejin-usage';

/** Opaque `jau.` tokens are longer than plain Juejin business ids. */
const TOKEN_MAX_LEN = 512;
const ORIGIN_USER_ID_MAX_LEN = 64;

export type DeepLinkPayload = {
  /** Encrypted upload identity (`jau.…`), written to `juejin.token`. */
  userId: string;
  token: string;
  /** Plain Juejin id for Settings display only. */
  originUserId?: string;
  userName?: string;
  avatarLarge?: string;
};

export type OpenSettingsPayload = {
  tab?: 'sync' | 'pet' | 'app';
  /** Ask the settings panel to re-fetch config. */
  reloadConfig?: boolean;
  /** @deprecated Deep-link uses silent notify; kept for tray/open-settings compat. */
  loginSuccess?: boolean;
  /** @deprecated Deep-link uses silent notify; kept for tray/open-settings compat. */
  loginError?: string;
};

/**
 * Register as the OS handler for `juejin-usage://`.
 * Dev (unpackaged) needs the electron binary + app entry path.
 */
export function registerProtocolClient(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      const appPath = path.resolve(process.argv[1]!);
      app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [
        appPath,
      ]);
      return;
    }
  }
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

/** Pull the first `juejin-usage://…` URL out of argv (Windows second-instance). */
export function findDeepLinkInArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith(`${PROTOCOL_SCHEME}://`)) {
      return arg;
    }
  }
  return null;
}

function isValidToken(value: string): boolean {
  return value.length > 0 && value.length <= TOKEN_MAX_LEN && !/\s/.test(value);
}

function isValidOriginUserId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= ORIGIN_USER_ID_MAX_LEN &&
    !/\s/.test(value)
  );
}

/**
 * Parse `juejin-usage://link?user_id=…&token=…&origin_user_id=…&user_name=…&avatar_large=…`.
 * When `token` is omitted, `user_id` (encrypted) is used as the upload token.
 */
export function parseDeepLink(raw: string): DeepLinkPayload | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== `${PROTOCOL_SCHEME}:`) return null;

  const hostOrPath = (url.hostname || url.pathname.replace(/^\//, '')).toLowerCase();
  if (hostOrPath !== 'link') return null;

  const stripQuotes = (value: string) => {
    const trimmed = value.trim();
    if (
      trimmed.length >= 2 &&
      ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  };

  const userId = stripQuotes(url.searchParams.get('user_id') ?? '');
  if (!isValidToken(userId)) return null;

  const tokenRaw = stripQuotes(url.searchParams.get('token') ?? '');
  const token = tokenRaw || userId;
  if (!isValidToken(token)) return null;

  const originUserId = stripQuotes(url.searchParams.get('origin_user_id') ?? '');
  const userName = (url.searchParams.get('user_name') ?? '').trim();
  const avatarLarge = (url.searchParams.get('avatar_large') ?? '').trim();

  return {
    userId,
    token,
    ...(originUserId && isValidOriginUserId(originUserId)
      ? { originUserId }
      : {}),
    ...(userName ? { userName } : {}),
    ...(avatarLarge ? { avatarLarge } : {}),
  };
}

/** Persist association via local-api (enables sync + writes token). */
export async function applyDeepLinkConfig(
  payload: DeepLinkPayload,
): Promise<{ ok: boolean; message?: string }> {
  const result = await localApiRequest('/functions/tud-config', {
    method: 'PUT',
    body: JSON.stringify({
      juejin: {
        enabled: true,
        token: payload.token,
        ...(payload.originUserId
          ? { originUserId: payload.originUserId }
          : {}),
        ...(payload.userName ? { userName: payload.userName } : {}),
        ...(payload.avatarLarge ? { avatarLarge: payload.avatarLarge } : {}),
      },
    }),
  });

  if (result.status < 200 || result.status >= 300) {
    const message =
      result.body &&
      typeof result.body === 'object' &&
      'message' in result.body &&
      typeof (result.body as { message: unknown }).message === 'string'
        ? (result.body as { message: string }).message
        : `HTTP ${result.status}`;
    return { ok: false, message };
  }

  return { ok: true };
}
