/**
 * DeepSeek Harness (dsh) passive reader — source dsh, collector dsh.
 *
 * 数据源：~/.dsh/sessions/<workspace>/<sessionId>/session.jsonl(.zstd)。
 * 每个文件是 JSONL（默认 zstd 压缩），逐行一个事件；token 用量只出现在
 * assistant/message 事件的 data.usage（每个 assistant 消息的最终值）。模型优先
 * 取 data.message.source，回退到 request/header；项目根目录在 session 首行的 cwd。
 *
 * 增量策略：zstd 无法按字节偏移续读，因此按「会话文件 inode+size+mtime 变了
 * 才重读」短路；重读时用 sessionId|messageId 去重，避免把已统计的消息重复计数。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { decompress as fzstdDecompress } from 'fzstd';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { resolveProjectName } from '../project-name.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  type BucketAccumulator,
} from './shared.js';
import { diffGeminiTotals, sameGeminiTotals } from './gemini.js';

export const DSH_COLLECTOR = 'dsh';

const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const MAX_SEEN_MESSAGES = 50_000;

/** DSH 单个消息的去重快照（last-wins，与 opencode/zcode 对齐）。 */
type DshMessageTotals = Omit<TokenTotals, 'conversation_count'>;

interface DshSessionCursor {
  inode: number;
  size: number;
  mtimeMs: number;
  project: string;
}

interface DshCursors {
  files: Record<string, DshSessionCursor>;
  messages: Record<string, { lastTotals: DshMessageTotals }>;
}

/** DSH 数据目录（$DSH_HOME 或 ~/.dsh）。 */
export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.DSH_HOME?.trim();
  if (explicit) {
    return explicit.startsWith('~') ? join(homedir(), explicit.slice(1)) : explicit;
  }
  return join(homedir(), '.dsh');
}

/** DSH 会话文件名匹配模式（支持 session.v3.jsonl.zstd、session.jsonl 等格式）。 */
export const DSH_SESSION_FILE_RE = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/i;

interface DshFileCandidate {
  path: string;
  version: number;
  isZstd: boolean;
  mtimeMs: number;
}

function parseSessionCandidate(dir: string, filename: string): DshFileCandidate | null {
  const match = DSH_SESSION_FILE_RE.exec(filename);
  if (!match) return null;
  const version = match[1] !== undefined ? Number.parseInt(match[1], 10) : 0;
  const isZstd = filename.endsWith('.zstd');
  const fullPath = join(dir, filename);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(fullPath).mtimeMs;
  } catch {
    // ignore
  }
  return { path: fullPath, version, isZstd, mtimeMs };
}

function pickBestSessionFile(candidates: DshFileCandidate[]): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.path;
  const sorted = [...candidates].sort((a, b) => {
    if (a.version !== b.version) return b.version - a.version;
    const zstdA = a.isZstd ? 1 : 0;
    const zstdB = b.isZstd ? 1 : 0;
    if (zstdA !== zstdB) return zstdB - zstdA;
    return b.mtimeMs - a.mtimeMs;
  });
  return sorted[0]!.path;
}

function collectSessionFilesFromDir(dir: string, currentDepth: number, maxDepth: number): string[] {
  if (currentDepth > maxDepth) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: DshFileCandidate[] = [];
  const subdirs: string[] = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      const candidate = parseSessionCandidate(dir, entry.name);
      if (candidate) candidates.push(candidate);
    } else if (entry.isDirectory()) {
      subdirs.push(join(dir, entry.name));
    }
  }

  if (candidates.length > 0) {
    const best = pickBestSessionFile(candidates);
    return best ? [best] : [];
  }

  const results: string[] = [];
  for (const subdir of subdirs.sort()) {
    results.push(...collectSessionFilesFromDir(subdir, currentDepth + 1, maxDepth));
  }
  return results;
}

/** DSH 会话根目录（workspace 目录的父目录）。 */
function dshSessionsDir(home = dshHome()): string {
  return join(home, 'sessions');
}

/** 收集所有会话文件（递归支持多层/单层目录，同会话目录优先选最高版本与 zstd，按路径排序）。 */
export function listDshSessionFiles(home = dshHome()): string[] {
  const sessionsDir = dshSessionsDir(home);
  if (!existsSync(sessionsDir)) return [];
  return collectSessionFilesFromDir(sessionsDir, 0, 4).sort();
}

/** 解析 JSONL 前 10 行的 cwd。 */
function readSessionCwd(text: string): string | null {
  const lines = text.split('\n', 10);
  for (const line of lines) {
    if (!line.includes('"cwd"')) continue;
    try {
      const obj = JSON.parse(line) as { cwd?: unknown };
      if (typeof obj.cwd === 'string' && obj.cwd.trim()) {
        return obj.cwd.trim();
      }
    } catch {
      // 忽略无效行
    }
  }
  return null;
}

/**
 * 解压 DSH 会话文件 → UTF-8 文本。
 *
 * DSH 的 session.jsonl.zstd 是流式追加写入的「多帧」zstd 文件，Node 内置
 * zstdDecompressSync 只解压第一个帧；而逐帧推进的原生解码在 Electron 内置的
 * Node 上存在确定性原生崩溃——进程内累计解码约十几 MB 后 SIGTRAP，事件循环
 * wedge 成 100% CPU 僵尸（Node 22.15.0 官方版与 Electron 35.4/35.7 均实测触发，
 * 见 issue #187）。这里改用纯 JS 解码器 fzstd 一次解出整个多帧文件：不经过
 * 原生 zlib，输出与原生逐帧解码逐字节一致（含多帧 fixture 的测试覆盖）。
 */
function decodeDsh(compressed: Buffer): string | null {
  try {
    const out = fzstdDecompress(compressed);
    if (out.length === 0 || out.length > MAX_DECODED_BYTES) return null;
    return Buffer.from(out).toString('utf8');
  } catch {
    // 损坏/截断文件 → null，调用方保留旧游标下轮重试。
    return null;
  }
}

function coerceEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  }
  return null;
}

function toNonNeg(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function capMessages(messages: Record<string, { lastTotals: DshMessageTotals }>): void {
  const keys = Object.keys(messages);
  if (keys.length <= MAX_SEEN_MESSAGES) return;
  for (const k of keys.slice(0, keys.length - MAX_SEEN_MESSAGES)) {
    delete messages[k];
  }
}

export interface ParseDshResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseDshIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseDshResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  const dshRoot = (cursors as CursorsFile & { dsh?: DshCursors }).dsh;
  if (!dshRoot) {
    (cursors as CursorsFile & { dsh: DshCursors }).dsh = { files: {}, messages: {} };
  }
  const dsh = (cursors as CursorsFile & { dsh: DshCursors }).dsh;
  if (!dsh.files) dsh.files = {};
  if (!dsh.messages) dsh.messages = {};

  const bucketState: BucketAccumulator = new Map();
  const files = listDshSessionFiles();

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const filePath of files) {
    let st;
    try {
      st = statSync(filePath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;

    const prev = dsh.files[filePath];
    const unchanged =
      prev && prev.inode === st.ino && prev.size === st.size && prev.mtimeMs === st.mtimeMs;
    if (unchanged) {
      filesProcessed += 1;
      continue;
    }

    // 文件有变化：全量读取并逐行解析，靠 message 去重只计增量。
    let contents: Buffer;
    try {
      contents = readFileSync(filePath);
    } catch {
      continue;
    }
    const text = filePath.endsWith('.zstd') ? decodeDsh(contents) : contents.toString('utf8');
    if (!text) {
      // 解码失败（损坏或写入中的文件）—— 保留旧游标，下次重试。
      continue;
    }

    let project = prev?.project;
    if (!project) {
      const cwd = readSessionCwd(text);
      project = cwd ? resolveProjectName(cwd) : 'unknown';
    }

    let requestModel = 'unknown';
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      if (!line.includes('"usage"') && !line.includes('"request/header"')) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (obj.type === 'request/header') {
        const data = obj.data as Record<string, unknown> | undefined;
        const header = data?.header as Record<string, unknown> | undefined;
        const config = header?.config as Record<string, unknown> | undefined;
        if (typeof config?.model === 'string' && config.model.trim()) {
          requestModel = config.model.trim();
        }
        continue;
      }
      if (obj.type !== 'assistant/message') continue;

      const data = obj.data as Record<string, unknown> | undefined;
      if (!data || typeof data !== 'object') continue;
      const usage = data.usage as Record<string, unknown> | undefined;
      if (!usage || typeof usage !== 'object') continue;

      const message = data.message as Record<string, unknown> | undefined;
      const source = (message?.source as Record<string, unknown> | undefined) ?? {};
      const model = typeof source.model === 'string' && source.model.trim()
        ? source.model.trim()
        : requestModel;
      const msgId = typeof message?.id === 'string' && message.id ? message.id : null;

      const input = toNonNeg(usage.inputTokens);
      const output = toNonNeg(usage.outputTokens);
      const cacheRead = toNonNeg(usage.cacheReadTokens);
      const cacheWrite = toNonNeg(usage.cacheWriteTokens);
      const reasoning = toNonNeg(usage.reasoningTokens);
      const reportedTotal = toNonNeg(usage.totalTokens);
      const computedTotal = input + output + cacheRead + cacheWrite;
      const total = Math.max(reportedTotal, computedTotal);
      const totals: DshMessageTotals = {
        input_tokens: input,
        output_tokens: output,
        cached_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
        reasoning_output_tokens: reasoning,
        total_tokens: total,
      };
      if (totals.total_tokens === 0) continue;

      const tsMs = coerceEpochMs(obj.time);
      if (!tsMs) continue;
      const hourStart = toUtcHalfHourStart(new Date(tsMs).toISOString());
      if (!hourStart) continue;
      if (new Date(hourStart).getTime() < sinceMs) continue;

      const key = `${filePath}|${msgId ?? line.slice(0, 64)}`;
      const prevTotals = dsh.messages[key]?.lastTotals;
      const tokenDelta = diffGeminiTotals(totals, prevTotals);
      if (!sameGeminiTotals(totals, prevTotals)) {
        dsh.messages[key] = { lastTotals: totals };
      }
      if (!tokenDelta) continue;

      // 文件变化时会重扫历史消息；只计新消息或同一消息增长的 token 差值。
      const delta: TokenTotals = {
        ...tokenDelta,
        conversation_count: prevTotals ? 0 : 1,
      };
      accumulateBucket(bucketState, 'dsh', model, project, hourStart, delta, DSH_COLLECTOR);
      eventsParsed += 1;
    }

    dsh.files[filePath] = { inode: st.ino, size: st.size, mtimeMs: st.mtimeMs, project };
    filesProcessed += 1;
  }

  capMessages(dsh.messages);

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'dsh'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
