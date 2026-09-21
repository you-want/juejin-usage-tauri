/**
 * Electron utilityProcess entry: parsers / sync / upload live here so the
 * main process event loop (IPC + window) is not blocked by JSONL / SQLite.
 */
import { Worker } from 'node:worker_threads';

import {
  appendJsonLog,
  createSyncRunner,
  kickBackfillDrain,
  loadConfig,
  resetCursorsCache,
  stopBackfillDrain,
  syncLogPath,
  type SyncResult,
  type TudConfig,
} from '@juejin-opensource/jusage-core';
import type { SyncWorkerRequest, SyncWorkerResponse } from './sync-worker-protocol';

process.title = 'tud-sync-worker';

/**
 * 硬看门狗：同步源里的原生故障（如 #187 的 zstd 多帧解码崩溃）可能把事件循环
 * wedge 成 100% CPU 自旋——此时本进程内的定时器永远不会触发，宿主的崩溃重启
 * （crashRestarts）也永远不生效，进程会僵死数小时。看门狗跑在独立事件循环的
 * worker 线程里，主线程定期喂活；超时未喂（事件循环卡死）就用 SIGKILL 结束整
 * 个进程，把僵死转化为宿主已有机制能处理的普通崩溃重启。
 */
const WATCHDOG_FEED_MS = 30_000;
const WATCHDOG_TIMEOUT_MS = 5 * 60_000;

function startWatchdog(): void {
  const workerSrc = `
const { parentPort } = require('node:worker_threads');
let lastFeedAt = Date.now();
parentPort.on('message', () => { lastFeedAt = Date.now(); });
setInterval(() => {
  if (Date.now() - lastFeedAt > ${WATCHDOG_TIMEOUT_MS}) {
    process.kill(process.pid, 'SIGKILL');
  }
}, 15_000);
`;
  try {
    const watchdog = new Worker(workerSrc, { eval: true });
    watchdog.unref();
    const feed = () => watchdog.postMessage('feed');
    feed();
    setInterval(feed, WATCHDOG_FEED_MS).unref();
  } catch {
    // 看门狗起不来只损失僵死自愈能力，不影响同步本身。
  }
}

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) {
  process.stderr.write('[tud-sync-worker] missing process.parentPort; exiting\n');
  process.exit(1);
}

let runSyncFn: ((reason: string, source?: string) => Promise<SyncResult[]>) | null = null;
let config: TudConfig | null = null;
let dataDir = '';

function post(msg: SyncWorkerResponse): void {
  parentPort!.postMessage(msg);
}

parentPort.on('message', (event) => {
  void handle(event.data as SyncWorkerRequest);
});

async function handle(msg: SyncWorkerRequest): Promise<void> {
  if (msg.type === 'init') {
    dataDir = msg.dataDir;
    const loaded = await loadConfig(dataDir);
    config = loaded.config;
    const { runSync } = createSyncRunner({
      dataDir,
      getConfig: () => config!,
      setConfig: (next) => {
        config = next;
      },
      loadConfig,
    });
    runSyncFn = runSync;
    kickBackfillDrain(dataDir, () => config!);
    await appendJsonLog(syncLogPath(dataDir), {
      event: 'cpu_phase',
      phase: 'worker_ready',
      pid: process.pid,
      role: 'sync-worker',
      wallMs: 0,
      cpuMs: 0,
    });
    process.stdout.write(`[tud-sync-worker] ready pid=${process.pid}\n`);
    startWatchdog();
    post({ type: 'ready', pid: process.pid });
    return;
  }

  if (msg.type === 'invalidateCursors') {
    // Main owns cursors.json (range expansion clears it) but parsers run here.
    // Without this the worker keeps serving its cached offsets, reports "no new
    // events" and the widened window never backfills.
    if (dataDir) resetCursorsCache(dataDir);
    return;
  }

  if (msg.type === 'stop') {
    stopBackfillDrain();
    runSyncFn = null;
    return;
  }

  if (msg.type === 'runSync') {
    if (!runSyncFn) {
      post({ type: 'syncError', id: msg.id, error: 'sync worker not initialized' });
      return;
    }
    try {
      const results = await runSyncFn(msg.reason, msg.source);
      post({ type: 'syncDone', id: msg.id, results });
    } catch (err) {
      post({
        type: 'syncError',
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
