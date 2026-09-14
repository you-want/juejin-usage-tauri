import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  mapMiniMaxQuota,
  type MiniMaxSubscriptionSnapshot,
} from '../shared/minimax-subscription';

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

const OFFICIAL_GLOBAL_ORIGIN = 'https://api.minimax.io';
const OFFICIAL_MAINLAND_ORIGIN = 'https://api.minimaxi.com';

interface MiniMaxCredentials {
  token: string;
  region: 'global' | 'mainland';
}

let lastSuccess: MiniMaxSubscriptionSnapshot | null = null;
let requestInFlight: Promise<MiniMaxSubscriptionSnapshot> | null = null;

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homedir(), value.slice(2));
  return path.resolve(value);
}

function minimaxCodeHome(): string {
  const configured = process.env.MINIMAX_CODE_HOME?.trim();
  return configured ? expandHome(configured) : path.join(homedir(), '.minimax-code');
}

function openCodeHome(): string {
  const configured = process.env.OPENCODE_HOME?.trim();
  if (configured) return expandHome(configured);
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'opencode');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim() || path.join(homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'opencode');
  }
  const xdg = process.env.XDG_DATA_HOME?.trim() || path.join(homedir(), '.local', 'share');
  return path.join(xdg, 'opencode');
}

function unavailable(
  status: Exclude<MiniMaxSubscriptionSnapshot['status'], 'ready'>,
  message: string,
): MiniMaxSubscriptionSnapshot {
  return {
    status,
    planLabel: null,
    region: null,
    limits: [],
    fetchedAt: null,
    stale: false,
    message,
  };
}

function staleFallback(message: string): MiniMaxSubscriptionSnapshot {
  if (!lastSuccess) return unavailable('temporarily-unavailable', message);
  return { ...lastSuccess, stale: true, message };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseMiniMaxCredentials(value: unknown): MiniMaxCredentials | null {
  if (typeof value === 'string') {
    const token = value.trim();
    return token.startsWith('sk-cp-') && token.length > 12
      ? { token, region: detectRegion(token) }
      : null;
  }
  const root = asRecord(value);
  if (!root) return null;
  const candidates = [
    root.api_key,
    root.apiKey,
    root.token,
    root.coding_plan_key,
    root.codingPlanKey,
    asRecord(root.auth)?.token,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().startsWith('sk-cp-') && candidate.trim().length > 12) {
      const token = candidate.trim();
      return { token, region: detectRegion(token) };
    }
  }
  return null;
}

function detectRegion(token: string): 'global' | 'mainland' {
  if (token.includes('cn') || token.includes('CN')) return 'mainland';
  return 'global';
}

async function readLocalCredentials(): Promise<MiniMaxCredentials | null> {
  const home = minimaxCodeHome();
  const candidates = [
    path.join(home, 'credentials.json'),
    path.join(home, 'auth.json'),
    path.join(home, 'config.json'),
  ];
  for (const candidate of candidates) {
    let text: string | null = null;
    try {
      text = await readFile(candidate, 'utf8');
    } catch {
      continue;
    }
    if (text === null) continue;
    try {
      const credentials = parseMiniMaxCredentials(JSON.parse(text));
      if (credentials) return credentials;
    } catch {
      const credentials = parseMiniMaxCredentials(text);
      if (credentials) return credentials;
    }
  }
  return null;
}

async function readOpenCodeAuth(): Promise<MiniMaxCredentials | null> {
  const authPath = path.join(openCodeHome(), 'auth.json');
  try {
    const text = await readFile(authPath, 'utf8');
    const root = JSON.parse(text) as unknown;
    const record = asRecord(root);
    const minimaxEntry = asRecord(record?.minimax) ?? asRecord(record?.['minimax-code']);
    return parseMiniMaxCredentials(minimaxEntry);
  } catch {
    return null;
  }
}

export function hasCustomMiniMaxConfiguration(env: NodeJS.ProcessEnv): boolean {
  const baseUrl = (env.MINIMAX_CODE_BASE_URL?.trim() || OFFICIAL_GLOBAL_ORIGIN).replace(/\/+$/, '');
  return baseUrl !== OFFICIAL_GLOBAL_ORIGIN && baseUrl !== OFFICIAL_MAINLAND_ORIGIN;
}

function originForRegion(region: 'global' | 'mainland'): string {
  return region === 'mainland' ? OFFICIAL_MAINLAND_ORIGIN : OFFICIAL_GLOBAL_ORIGIN;
}

async function fetchJson(
  origin: string,
  token: string,
): Promise<{ ok: boolean; status: number; value: unknown }> {
  const response = await fetch(`${origin}/v1/token_plan/remains`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return {
    ok: response.ok,
    status: response.status,
    value: response.ok ? await response.json() : null,
  };
}

async function fetchFreshMiniMaxSubscription(): Promise<MiniMaxSubscriptionSnapshot> {
  if (!existsSync(minimaxCodeHome())) {
    const openCodeCredentials = await readOpenCodeAuth();
    if (!openCodeCredentials) {
      return unavailable('not-installed', '未检测到本机 MiniMax Code');
    }
    return fetchQuota(openCodeCredentials);
  }

  const localCredentials = await readLocalCredentials();
  const credentials = localCredentials ?? (await readOpenCodeAuth());
  if (!credentials) return unavailable('not-signed-in', '请先登录 MiniMax Code');
  return fetchQuota(credentials);
}

async function fetchQuota(credentials: MiniMaxCredentials): Promise<MiniMaxSubscriptionSnapshot> {
  const origin = originForRegion(credentials.region);
  try {
    const response = await fetchJson(origin, credentials.token);
    if (response.status === 401 || response.status === 403) {
      return unavailable('expired', 'MiniMax Code 登录已过期，请重新登录');
    }
    if (response.status === 429) {
      return staleFallback('MiniMax Code 配额请求过于频繁，请稍后重试');
    }
    if (response.status >= 500) {
      return staleFallback('MiniMax 配额服务暂时不可用，请稍后重试');
    }
    if (!response.ok || response.status >= 400) {
      return staleFallback('暂时无法读取 MiniMax Code 订阅配额');
    }
    const mapped = mapMiniMaxQuota(response.value);
    if (mapped.limits.length === 0) {
      return staleFallback('MiniMax Code 暂未返回可用的订阅配额');
    }
    const snapshot: MiniMaxSubscriptionSnapshot = {
      status: 'ready',
      planLabel: mapped.planLabel,
      region: credentials.region,
      limits: mapped.limits,
      fetchedAt: Math.floor(Date.now() / 1_000),
      stale: false,
      message: null,
    };
    lastSuccess = snapshot;
    return snapshot;
  } catch {
    return staleFallback('网络异常，暂时无法读取 MiniMax Code 配额');
  }
}

/** Read-only MiniMax Code Coding Plan lookup; BYOK and pay-as-you-go keys are filtered. */
export async function readMiniMaxSubscription(
  options: { forceRefresh?: boolean } = {},
): Promise<MiniMaxSubscriptionSnapshot> {
  if (hasCustomMiniMaxConfiguration(process.env)) {
    return unavailable('custom-provider', '自定义模型无法获取配额');
  }
  const cacheAge = lastSuccess?.fetchedAt
    ? Date.now() - lastSuccess.fetchedAt * 1_000
    : Number.POSITIVE_INFINITY;
  if (!options.forceRefresh && lastSuccess && cacheAge <= CACHE_TTL_MS) return lastSuccess;
  if (requestInFlight) return requestInFlight;
  requestInFlight = fetchFreshMiniMaxSubscription();
  try {
    return await requestInFlight;
  } finally {
    requestInFlight = null;
  }
}

export { readOpenCodeAuth as readMiniMaxOpenCodeAuth, readLocalCredentials as readMiniMaxLocalCredentials };
