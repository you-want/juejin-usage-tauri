/**
 * CodeBuddy passive JSONL reader (source `codebuddy`, collector `codebuddy`).
 *
 * Scans ~/.codebuddy/projects/ (recursive .jsonl) for assistant messages with
 * providerData.rawUsage. MVP is JSONL-only; IDE extension logs are
 * omitted here until needed.
 */
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { stat } from 'node:fs/promises';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  computeTotalTokens,
  type BucketAccumulator,
} from './shared.js';

export const CODEBUDDY_COLLECTOR = 'codebuddy';

type CodebuddyExtCursors = CursorsFile & {
  codebuddy?: {
    seenIds?: string[];
    fileOffsets?: Record<string, { size: number; mtimeMs: number; ino: number }>;
  };
};

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function resolveCodebuddyHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CODEBUDDY_HOME?.trim();
  if (override) return expandHome(override);
  return join(homedir(), '.codebuddy');
}

export function resolveCodebuddyDefaultModel(env: NodeJS.ProcessEnv = process.env): string {
  const fallback = 'codebuddy-unknown';
  try {
    const home = resolveCodebuddyHome(env);
    const raw = readFileSync(join(home, 'settings.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { model?: unknown };
    if (typeof parsed.model === 'string' && parsed.model.trim()) return parsed.model.trim();
  } catch {
    // settings missing or malformed
  }
  return fallback;
}

function walkJsonlFiles(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (!isDir && !isFile) {
      try {
        const st = statSync(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
    }
    if (isDir) walkJsonlFiles(full, out);
    else if (isFile && entry.name.endsWith('.jsonl')) out.push(full);
  }
}

export function resolveCodebuddyProjectFiles(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = resolveCodebuddyHome(env);
  const files: string[] = [];
  const projectsDir = join(home, 'projects');
  if (existsSync(projectsDir)) walkJsonlFiles(projectsDir, files);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function normalizeModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toNonNeg(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

function normalizeCodebuddyUsage(
  rawUsage: Record<string, unknown>,
): Omit<TokenTotals, 'conversation_count'> | null {
  const promptTokens = toNonNeg(rawUsage.prompt_tokens);
  const completionTokens = toNonNeg(rawUsage.completion_tokens);
  const details =
    rawUsage.prompt_tokens_details && typeof rawUsage.prompt_tokens_details === 'object'
      ? (rawUsage.prompt_tokens_details as Record<string, unknown>)
      : {};
  const cachedTokens = toNonNeg(details.cached_tokens);
  const cacheReadAlt = toNonNeg(rawUsage.cache_read_input_tokens);
  const cacheCreation = toNonNeg(rawUsage.cache_creation_input_tokens);
  const reasoningTokens = toNonNeg(details.reasoning_tokens);

  const cacheRead = Math.max(cachedTokens, cacheReadAlt);
  const inputTokens = Math.max(0, promptTokens - cacheRead);

  if (inputTokens === 0 && completionTokens === 0 && cacheRead === 0 && cacheCreation === 0) {
    return null;
  }

  const body = {
    input_tokens: inputTokens,
    cached_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
    output_tokens: completionTokens,
    reasoning_output_tokens: reasoningTokens,
  };
  return { ...body, total_tokens: computeTotalTokens(body) };
}

export interface ParseCodebuddyResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseCodebuddyIncremental(
  cursors: CursorsFile,
  statsSince: string,
  opts?: { env?: NodeJS.ProcessEnv; projectFiles?: string[]; defaultModel?: string },
): Promise<{ result: ParseCodebuddyResult; cursors: CursorsFile }> {
  const env = opts?.env ?? process.env;
  const sinceMs = new Date(statsSince).getTime();
  const ext = cursors as CodebuddyExtCursors;
  if (!ext.codebuddy) ext.codebuddy = { seenIds: [], fileOffsets: {} };
  if (!ext.codebuddy.fileOffsets) ext.codebuddy.fileOffsets = {};
  const seenIds = new Set(ext.codebuddy.seenIds ?? []);
  const fileOffsets = ext.codebuddy.fileOffsets;
  const bucketState: BucketAccumulator = new Map();
  const fallbackModel = opts?.defaultModel ?? resolveCodebuddyDefaultModel(env);
  const files = opts?.projectFiles ?? resolveCodebuddyProjectFiles(env);

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const filePath of files) {
    const st = await stat(filePath).catch(() => null);
    if (!st?.isFile()) continue;

    const prev = fileOffsets[filePath];
    const prevSize = prev?.size ?? 0;
    const inodeChanged = typeof prev?.ino === 'number' && prev.ino !== st.ino;
    const startOffset = st.size < prevSize || inodeChanged ? 0 : prevSize;
    if (st.size <= startOffset) continue;

    const stream = createReadStream(filePath, { start: startOffset });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (entry.type !== 'message' || entry.role !== 'assistant') continue;

      const provider =
        entry.providerData && typeof entry.providerData === 'object'
          ? (entry.providerData as Record<string, unknown>)
          : null;
      const rawUsage =
        provider?.rawUsage && typeof provider.rawUsage === 'object'
          ? (provider.rawUsage as Record<string, unknown>)
          : null;
      if (!rawUsage) continue;

      const sessionId =
        typeof entry.sessionId === 'string' && entry.sessionId
          ? entry.sessionId
          : basename(filePath, '.jsonl');
      const tsMs =
        Number.isFinite(Number(entry.timestamp)) && Number(entry.timestamp) > 0
          ? Number(entry.timestamp)
          : null;
      const messageId =
        typeof entry.uuid === 'string' && entry.uuid
          ? entry.uuid
          : typeof entry.id === 'string' && entry.id
            ? entry.id
            : tsMs != null
              ? `${sessionId}:${tsMs}`
              : null;
      if (!messageId || seenIds.has(messageId)) continue;

      const delta = normalizeCodebuddyUsage(rawUsage);
      if (!delta) {
        seenIds.add(messageId);
        continue;
      }
      if (tsMs == null) {
        seenIds.add(messageId);
        continue;
      }

      const hourStart = toUtcHalfHourStart(new Date(tsMs).toISOString());
      if (!hourStart || new Date(hourStart).getTime() < sinceMs) {
        seenIds.add(messageId);
        continue;
      }

      const model =
        normalizeModel(provider?.model) ??
        normalizeModel(entry.model) ??
        fallbackModel;

      accumulateBucket(
        bucketState,
        'codebuddy',
        model,
        'unknown',
        hourStart,
        { ...delta, conversation_count: 1 },
        CODEBUDDY_COLLECTOR,
      );
      seenIds.add(messageId);
      eventsParsed += 1;
    }

    const postStat = await stat(filePath).catch(() => st);
    fileOffsets[filePath] = {
      size: postStat.size,
      mtimeMs: postStat.mtimeMs,
      ino: postStat.ino,
    };
    filesProcessed += 1;
  }

  ext.codebuddy.seenIds = Array.from(seenIds).slice(-10_000);

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'codebuddy'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
