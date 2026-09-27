import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import { createJsonlLineReader } from './jsonl-tail.js';
import { findJsonlFiles, accumulateBucket, bucketsFromState, type BucketAccumulator } from './shared.js';
import { queryDbJson, readSqliteWithSnapshot } from './sqlite.js';

export const MINIMAX_CODE_SOURCE = 'minimax-code';

type MiniMaxCursor = {
  databases: Record<string, number>;
  files: Record<string, { offset: number; inode?: number }>;
  seenMessageIds?: string[];
};

function expandHome(value: string): string {
  return value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
}

/** Both mcode CLI and MiniMax Code desktop use the same local runtime home. */
export function miniMaxCodeHomes(): string[] {
  return [...new Set([
    process.env.MINIMAX_CODE_HOME,
    process.env.MINIMAX_DATA_DIR,
    process.env.MAVIS_DATA_DIR,
    join(homedir(), '.minimax'),
    join(homedir(), '.minimax-code'),
  ].filter((value): value is string => Boolean(value?.trim())).map((value) => expandHome(value.trim())))];
}

export function miniMaxCodeDataPaths(): string[] {
  return miniMaxCodeHomes().flatMap((home) => [join(home, 'v2', 'sqlite', 'runtime-state.sqlite'), join(home, 'v2', 'sessions')]);
}

function nonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function usageTotals(input: unknown, output: unknown, reasoning: unknown, cacheRead: unknown, cacheWrite: unknown): TokenTotals | null {
  const input_tokens = nonNegative(input);
  const output_tokens = nonNegative(output);
  const reasoning_output_tokens = nonNegative(reasoning);
  const cached_input_tokens = nonNegative(cacheRead);
  const cache_creation_input_tokens = nonNegative(cacheWrite);
  const total_tokens = input_tokens + output_tokens + reasoning_output_tokens + cached_input_tokens + cache_creation_input_tokens;
  if (total_tokens === 0) return null;
  return { input_tokens, output_tokens, reasoning_output_tokens, cached_input_tokens, cache_creation_input_tokens, total_tokens, conversation_count: 1 };
}

function recordBucket(state: BucketAccumulator, model: unknown, project: unknown, timestamp: unknown, sinceMs: number, totals: TokenTotals | null): boolean {
  if (!totals) return false;
  const ts = typeof timestamp === 'number' ? timestamp : typeof timestamp === 'string' && /^\d+$/.test(timestamp)
    ? Number(timestamp) : Date.parse(String(timestamp));
  if (!Number.isFinite(ts) || ts < sinceMs) return false;
  const hour = toUtcHalfHourStart(new Date(ts).toISOString());
  if (!hour) return false;
  accumulateBucket(state, MINIMAX_CODE_SOURCE, typeof model === 'string' && model.trim() ? model : 'unknown',
    typeof project === 'string' && project.trim() ? resolveProjectName(project) : 'unknown', hour, totals, MINIMAX_CODE_SOURCE);
  return true;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readSqliteUsage(dbPath: string, afterId: number, sinceMs: number, state: BucketAccumulator): { lastId: number; events: number } {
  const rows = readSqliteWithSnapshot(dbPath, (path) => queryDbJson(path, `SELECT u.id, u.model, u.ts, u.input_tokens, u.output_tokens,
    u.reasoning_tokens, u.cache_read_tokens, u.cache_write_tokens,
    s.workspace_dir, s.project_workspace_dir
    FROM local_runtime_token_usage u
    LEFT JOIN local_runtime_sessions s ON s.session_id = u.session_id
    WHERE u.id > ${Math.max(0, Math.floor(afterId))}
    ORDER BY u.id`));
  let lastId = afterId;
  let events = 0;
  for (const row of rows) {
    const id = nonNegative(row.id);
    if (id > lastId) lastId = id;
    const totals = usageTotals(row.input_tokens, row.output_tokens, row.reasoning_tokens, row.cache_read_tokens, row.cache_write_tokens);
    if (recordBucket(state, row.model, row.project_workspace_dir ?? row.workspace_dir, row.ts, sinceMs, totals)) events++;
  }
  return { lastId, events };
}

async function readLegacyMessages(sessionsDir: string, cursor: MiniMaxCursor, sinceMs: number, state: BucketAccumulator): Promise<{ events: number; files: number }> {
  const files = (await findJsonlFiles(sessionsDir)).filter((file) => basename(file) === 'messages.jsonl');
  const seenIds = new Set(cursor.seenMessageIds ?? []);
  let events = 0;
  for (const file of files) {
    let fileStat;
    try { fileStat = statSync(file); } catch { continue; }
    const previous = cursor.files[file];
    const start = previous && previous.inode === fileStat.ino && previous.offset <= fileStat.size ? previous.offset : 0;
    const reader = createJsonlLineReader(file, start);
    for await (const line of reader) {
      let record: Record<string, unknown> | null;
      try { record = asObject(JSON.parse(line)); } catch { continue; }
      const message = asObject(record?.message) ?? record;
      if (message?.role !== 'assistant') continue;
      const usage = asObject(message.usage);
      if (!usage) continue;
      const cache = asObject(usage.cache);
      const totals = usageTotals(usage.input ?? usage.input_tokens, usage.output ?? usage.output_tokens,
        usage.reasoning ?? usage.reasoning_tokens, usage.cacheRead ?? usage.cache_read ?? cache?.read,
        usage.cacheWrite ?? usage.cache_write ?? cache?.write);
      const messageId = typeof record?.message_id === 'string' ? record.message_id : null;
      const dedupKey = messageId ? `${sessionsDir}|${messageId}` : null;
      if (dedupKey && seenIds.has(dedupKey)) continue;
      if (recordBucket(state, message.model ?? record?.model, 'unknown', message.timestamp ?? record?.timestamp, sinceMs, totals)) {
        events++;
        if (dedupKey) seenIds.add(dedupKey);
      }
    }
    cursor.files[file] = { offset: reader.nextOffset, inode: fileStat.ino };
  }
  cursor.seenMessageIds = [...seenIds].slice(-50_000);
  return { events, files: files.length };
}

export async function parseMiniMaxCodeIncremental(cursors: CursorsFile, since: string): Promise<{
  result: { buckets: QueueBucket[]; eventsParsed: number; filesProcessed: number };
  cursors: CursorsFile;
}> {
  const state: BucketAccumulator = new Map();
  const ext = cursors as CursorsFile & { minimaxCode?: MiniMaxCursor };
  const cursor = ext.minimaxCode ?? (ext.minimaxCode = { databases: {}, files: {} });
  const sinceMs = Date.parse(since);
  let eventsParsed = 0;
  let filesProcessed = 0;
  for (const home of miniMaxCodeHomes()) {
    const dbPath = join(home, 'v2', 'sqlite', 'runtime-state.sqlite');
    if (existsSync(dbPath)) {
      try {
        const result = readSqliteUsage(dbPath, cursor.databases[dbPath] ?? 0, sinceMs, state);
        cursor.databases[dbPath] = result.lastId;
        eventsParsed += result.events;
        filesProcessed++;
        continue;
      } catch {
        // Older runtimes may not have the usage projection table yet.
      }
    }
    const legacy = await readLegacyMessages(join(home, 'v2', 'sessions'), cursor, sinceMs, state);
    eventsParsed += legacy.events;
    filesProcessed += legacy.files;
  }
  return { result: { buckets: bucketsFromState(state, MINIMAX_CODE_SOURCE), eventsParsed, filesProcessed }, cursors };
}
