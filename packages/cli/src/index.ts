import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';

import {
  appendJsonLog,
  BucketStore,
  createAggregateCache,
  createApplyAfterSync,
  createHttpServer,
  createLocalApiApp,
  createPollBackoff,
  DEFAULT_PORT,
  getHookStatus,
  getRunningOwner,
  listenServer,
  loadConfig,
  POLL_INTERVAL_MS,
  pollIntervalLabel,
  releaseRuntimeOwner,
  resolveLocalCollectSince,
  runtimeKindLabel,
  saveConfig,
  setupClaudeHook,
  setupCodexHook,
  syncAll,
  collectWrittenBuckets,
  syncLogPath,
  touchStatsSince,
  watchRuntimeSignals,
  watchSyncSignals,
  writeSyncDone,
  maybeUploadAfterSync,
  uploadToServer,
  kickBackfillDrain,
  stopBackfillDrain,
  drainBackfillUntilIdle,
  resolvePricingRefreshConfig,
  DEFAULT_PRICING_FIRST_FETCH_TIMEOUT_MS,
  startPricingRefresh,
  type AggregateCache,
  type SyncResult,
  type TudConfig,
} from '@juejin-opensource/jusage-core';

import { writePid } from './daemon.js';
import { cmdServiceStart, cmdServiceStatus, cmdServiceStop } from './service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let server: Server | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let syncWatcherStop: (() => void) | null = null;
let pricingRefreshStop: (() => void) | null = null;
let runSyncFn: ((reason: string, source?: string) => Promise<SyncResult[]>) | null =
  null;
let runtime: {
  dir: string;
  config: TudConfig;
  bucketStore: BucketStore;
  aggregateCache: AggregateCache;
} | null = null;
let runtimeDataDir: string | null = null;
/** True only when this process wrote `tud.pid` as sync/upload owner. */
let ownedPid = false;
let runtimeRole: 'owner' | 'observer' = 'owner';

async function startPricingOverlayRefresh(
  dir: string,
  config: TudConfig,
): Promise<void> {
  pricingRefreshStop?.();
  pricingRefreshStop = null;
  const { url, ttlMs } = resolvePricingRefreshConfig({
    url: config.pricing?.url,
    ttlMs: config.pricing?.ttlMs,
  });
  if (!url) return;
  const handle = startPricingRefresh({
    url,
    ttlMs,
    dataDir: dir,
    firstFetchTimeoutMs: DEFAULT_PRICING_FIRST_FETCH_TIMEOUT_MS,
    onUpdate: () => {
      const current = runtime;
      if (!current) return;
      void current.aggregateCache
        .rebuildFromRows(current.bucketStore.getRows())
        .catch((err) => {
          console.warn(
            '定价覆盖层刷新后重建缓存失败:',
            err instanceof Error ? err.message : err,
          );
        });
    },
    onError: (err) => {
      console.warn(
        '定价表远程刷新失败（继续用内置/上次覆盖）:',
        err instanceof Error ? err.message : err,
      );
    },
  });
  pricingRefreshStop = handle;
  console.log(`定价覆盖层: ${url}（TTL ${ttlMs}ms）`);
  await handle.ready;
}

function resolveDashboardDir(): string {
  return join(__dirname, 'dashboard');
}

function resolveCliBinPath(): string {
  return fileURLToPath(new URL('../bin/jusage.js', import.meta.url));
}

export function parseArgs(argv: string[]): {
  command: string;
  serviceAction?: string;
  port: number;
  source?: string;
  force?: boolean;
  reconcile?: boolean;
  /** Hidden debug: seed statsSince to N days ago when missing. Not shown in --help. */
  days?: number;
} {
  const args = argv.slice(2);
  let command = args[0] ?? 'start';
  let serviceAction: string | undefined;
  let port = DEFAULT_PORT;
  let source: string | undefined;
  let force = false;
  let reconcile = false;
  let days: number | undefined;

  if (command === 'help' || command === '--help' || command === '-h' || args.includes('--help') || args.includes('-h')) {
    return { command: 'help', port, source, force, reconcile };
  }

  if (command === 'service') {
    serviceAction = args[1];
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = Number(args[i + 1]) || DEFAULT_PORT;
      i += 1;
    } else if (args[i] === '--source' && args[i + 1]) {
      source = args[i + 1];
      i += 1;
    } else if (args[i]?.startsWith('--source=')) {
      source = args[i].slice('--source='.length);
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--reconcile') {
      reconcile = true;
    } else if (args[i] === '--days' && args[i + 1]) {
      days = Number(args[i + 1]);
      i += 1;
    } else if (args[i]?.startsWith('--days=')) {
      days = Number(args[i].slice('--days='.length));
    }
  }
  if (command.startsWith('-')) command = 'start';
  return { command, serviceAction, port, source, force, reconcile, days };
}

function resolveDaysAgo(days: number | undefined): number | undefined {
  if (days === undefined) return undefined;
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`--days 须为正整数，收到: ${days}`);
  }
  return days;
}

function printHelp(): void {
  console.log(`Usage: jusage <command> [options]

Commands:
  start                 前台启动本地面板与同步（默认；桌面已运行时为观察模式）
  stop                  停止当前进程内的服务
  status                查看 CLI / 面板当前启动状态
  sync                  手动同步本地用量数据
  upload                上报数据到云端
  service <action>      后台服务与开机自启（macOS / Windows / Linux）
                        action: start | stop | status
  help                  显示帮助

Options:
  --port <number>       面板端口（默认 ${DEFAULT_PORT}）
  --source <name>       sync 数据源：claude | codex | cursor | qoder | trae | gemini | opencode | copilot | antigravity | openclaw | hermes | zcode | pi | kimi | roocode | droid | kiro | cline | amp | qwen | codebuddy | workbuddy | grok | mimo | every-code | omp | kilo-cli | kilocode | goose | zed | warp | all
  --force               upload 时忽略云端同步开关，强制上报
  --reconcile           upload 时做全量对账
  -h, --help            显示帮助

Examples:
  jusage
  jusage start --port 8452
  jusage status
  jusage sync --source=claude
  jusage upload --force
  jusage service start`);
}

async function refreshRuntimeFromDisk(
  results?: SyncResult[],
): Promise<void> {
  if (!runtime) return;
  try {
    const { config } = await loadConfig(runtime.dir);
    runtime.config = config;
    if (results) {
      const written = collectWrittenBuckets(results);
      if (written.length > 0) {
        runtime.bucketStore.apply(written);
      }
      await runtime.aggregateCache.onBucketsChanged(
        runtime.bucketStore.getRows(),
        written,
      );
      await appendJsonLog(syncLogPath(runtime.dir), {
        event: 'bucket_apply',
        written: written.length,
        statsSince: config.statsSince,
        localCollectSince: resolveLocalCollectSince(config),
        lastSyncAt: config.lastSyncAt,
      });
      return;
    }
    await runtime.bucketStore.refresh(
      runtime.dir,
      resolveLocalCollectSince(config),
    );
    await runtime.aggregateCache.rebuildFromRows(runtime.bucketStore.getRows());
    await appendJsonLog(syncLogPath(runtime.dir), {
      event: 'bucket_refresh',
      statsSince: config.statsSince,
      localCollectSince: resolveLocalCollectSince(config),
      lastSyncAt: config.lastSyncAt,
    });
  } catch (err) {
    await appendJsonLog(syncLogPath(runtime.dir), {
      event: 'bucket_refresh_error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function cmdStart(port: number, daysAgo?: number): Promise<void> {
  const { dir, config } = await loadConfig();

  const existing = await getRunningOwner(dir);
  if (existing != null && existing.pid !== process.pid && existing.kind === 'cli') {
    throw new Error(
      `服务已在运行（CLI pid ${existing.pid}），请先 jusage service stop 或结束该进程`,
    );
  }

  // Desktop already owns sync/upload → serve panel only (observer).
  const isObserver =
    existing != null && existing.pid !== process.pid && existing.kind === 'desktop';
  runtimeRole = isObserver ? 'observer' : 'owner';
  ownedPid = false;
  runtimeDataDir = dir;

  // Claim ownership before hook/bucket/listen work so `jusage service start`
  // can observe the pid file within its wait window.
  if (!isObserver) {
    await writePid(process.pid, dir, 'cli');
    ownedPid = true;
  }

  await touchStatsSince(dir, config, daysAgo != null ? { daysAgo } : undefined);
  config.serverPort = port;
  await saveConfig(dir, config);

  console.log(`设备 UUID: ${config.deviceId}`);
  console.log(`上报 Token: ${config.juejin.token ?? '(未配置)'}`);
  console.log(`云端地址: ${config.juejin.apiUrl}`);
  console.log(`云端同步: ${config.juejin.enabled ? '已开启' : '未开启'}`);

  if (isObserver && existing) {
    console.log(
      `\n◎ 观察模式：${runtimeKindLabel(existing.kind)} (pid ${existing.pid}) 负责同步/上报`,
    );
    console.log('  本进程只提供面板读数，不抢占 runtime、不轮询、不上报\n');
  }

  const { hookOk: claudeHookOk } = await setupClaudeHook(dir);
  const { hookOk: codexHookOk } = await setupCodexHook(dir);
  if (!isObserver) {
    if (!claudeHookOk) {
      console.warn(`⚠ Claude Hook 未注册成功，将使用定时轮询（${pollIntervalLabel()}）同步`);
    }
    if (!codexHookOk) {
      console.warn(`⚠ Codex Hook 未注册成功，将使用定时轮询（${pollIntervalLabel()}）同步`);
    }
  }

  const { config: refreshed } = await loadConfig(dir);
  await startPricingOverlayRefresh(dir, refreshed);

  const bucketStore = new BucketStore();
  await bucketStore.reload(dir, resolveLocalCollectSince(refreshed));
  const aggregateCache = await createAggregateCache(dir, bucketStore.getRows());
  runtime = { dir, config: refreshed, bucketStore, aggregateCache };
  runtimeDataDir = dir;

  // Idle rounds back off 1min → 2min → 5min; hook/manual activity re-arms at 1min.
  const pollBackoff = createPollBackoff();
  let reArmPoll: (() => void) | null = null;
  const resetPollBackoffToFast = () => {
    const wasSlow = pollBackoff.currentDelayMs() > POLL_INTERVAL_MS;
    pollBackoff.reset();
    if (wasSlow) reArmPoll?.();
  };

  if (isObserver) {
    syncWatcherStop = watchSyncSignals(dir, async (filename) => {
      if (filename === 'sync.done') {
        await refreshRuntimeFromDisk();
      }
    });
    runSyncFn = null;
  } else {
    const applyAfterSync = createApplyAfterSync({
      getBucketStore: () => runtime!.bucketStore,
      getAggregateCache: () => runtime?.aggregateCache,
    });
    const { stop, runSync } = watchRuntimeSignals({
      dataDir: dir,
      getConfig: () => runtime!.config,
      setConfig: (next: TudConfig) => {
        if (runtime) runtime.config = next;
      },
      refreshFromDisk: async (results, opts) => {
        // Non-quiet result delivery means a hook/manual sync ran: user active.
        if (results && results.length > 0 && !opts?.quiet) {
          resetPollBackoffToFast();
        }
        if (!results) {
          await refreshRuntimeFromDisk();
          return;
        }
        await applyAfterSync(results, opts);
      },
      isOwner: () => runtimeRole === 'owner',
      loadConfig,
    });
    syncWatcherStop = stop;
    runSyncFn = runSync;
  }

  const getConfig = () => runtime!.config;

  const app = createLocalApiApp({
    dataDir: dir,
    getConfig,
    bucketStore,
    aggregateCache,
    runSyncViaRunner: runSyncFn
      ? (reason, source) => runSyncFn!(reason, source)
      : undefined,
    getHookStatus: () => getHookStatus(dir),
    onConfigChange: (next) => {
      if (runtime) runtime.config = next;
    },
  });

  const httpServer = createHttpServer({
    honoApp: app,
    staticDir: resolveDashboardDir(),
    port,
  });

  let actualPort: number;
  try {
    ({ port: actualPort } = await listenServer(httpServer, '127.0.0.1', port));
  } catch (err) {
    if (ownedPid) {
      await releaseRuntimeOwner(dir);
      ownedPid = false;
    }
    throw err;
  }
  server = httpServer;

  if (!isObserver) {
    // Schedule next poll only after the previous one settles (avoid overlap).
    const scheduleNextPoll = (delayMs = pollBackoff.currentDelayMs()) => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
      if (!runtime || runtimeRole !== 'owner' || !runSyncFn) return;
      pollTimer = setTimeout(() => {
        void (async () => {
          let nextDelayMs = pollBackoff.currentDelayMs();
          try {
            if (!runtime || runtimeRole !== 'owner' || !runSyncFn) return;
            const results = await runSyncFn('poll');
            const wroteAny = results.some((r) => r.writtenBuckets.length > 0);
            nextDelayMs = pollBackoff.noteRound(wroteAny);
          } catch (err) {
            console.error(
              '轮询同步失败:',
              err instanceof Error ? err.message : err,
            );
          } finally {
            scheduleNextPoll(nextDelayMs);
          }
        })();
      }, delayMs);
    };
    reArmPoll = () => scheduleNextPoll();

    console.log('后台同步 Claude / Codex / Cursor 数据…');
    kickBackfillDrain(dir, () => runtime!.config);
    void runSyncFn?.('startup')
      .catch((err) => {
        console.error('启动同步失败:', err instanceof Error ? err.message : err);
      })
      .finally(scheduleNextPoll);
  }

  const url = `http://127.0.0.1:${actualPort}`;
  console.log(`\n✓ Juejin Usage 已启动${isObserver ? '（观察模式）' : ''}`);
  console.log(`  面板: ${url}`);
  console.log(`  数据: ${dir}`);
  console.log(`  调试日志: ${join(dir, 'logs')}`);
  if (isObserver) {
    console.log('  同步/上报: 由桌面端负责');
  } else {
    console.log(`  Claude Hook: ${claudeHookOk ? '已注册' : '轮询模式'}`);
    console.log(`  Codex Hook: ${codexHookOk ? '已注册' : '轮询模式'}`);
  }
  console.log(`\n按 Ctrl+C 停止\n`);
}

async function cmdSync(source?: string): Promise<void> {
  const { dir, config } = await loadConfig();
  await touchStatsSince(dir, config);
  const scope = source ?? 'all';
  const started = Date.now();
  const logPath = syncLogPath(dir);

  await appendJsonLog(logPath, { event: 'start', source: scope });

  try {
    const results = await syncAll(dir, config, source);
    await writeSyncDone(dir);
    await maybeUploadAfterSync(dir, config, collectWrittenBuckets(results));
    await appendJsonLog(logPath, {
      event: 'done',
      source: scope,
      durationMs: Date.now() - started,
      results: results.map((r) => ({
        source: r.source,
        eventsParsed: r.eventsParsed,
        bucketsWritten: r.bucketsWritten,
        filesProcessed: r.filesProcessed,
      })),
    });
    for (const r of results) {
      console.log(
        `${r.source}: ${r.eventsParsed} 条消息, ${r.bucketsWritten} 个桶写入, ${r.filesProcessed} 个文件`,
      );
    }
  } catch (err) {
    await appendJsonLog(logPath, {
      event: 'error',
      source: scope,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function cmdStatus(): Promise<void> {
  const { dir, config } = await loadConfig();
  const hooks = await getHookStatus(dir);
  const owner = await getRunningOwner(dir);
  const panelUp = server != null;
  const port = config.serverPort || DEFAULT_PORT;

  if (owner != null) {
    console.log(
      `Runtime: ${runtimeKindLabel(owner.kind)} pid ${owner.pid}（同步/上报）`,
    );
  } else {
    console.log('Runtime: 未运行');
  }
  if (panelUp) {
    console.log(
      `本进程面板: 运行中${runtimeRole === 'observer' ? '（观察模式，只读）' : ''}`,
    );
  }
  console.log(`面板: http://127.0.0.1:${port}`);
  console.log(`数据目录: ${dir}`);
  console.log(`设备 UUID: ${config.deviceId}`);
  console.log(`上报 Token: ${config.juejin.token ?? '(未配置)'}`);
  console.log(`statsSince: ${config.statsSince}`);
  console.log(`上次同步: ${config.lastSyncAt ?? '从未'}`);
  console.log(`Claude Hook: ${hooks.claude ? 'active' : 'poll 模式'}`);
  console.log(`Codex Hook: ${hooks.codex ? 'active' : 'poll 模式'}`);
  console.log(`Cursor: 轮询模式（无 Hook）`);
  console.log(`云端同步: ${config.juejin.enabled ? '已开启' : '未开启'} → ${config.juejin.apiUrl}`);
  console.log(`上次上报: ${config.lastUploadAt ?? '从未'}`);
  console.log(`调试日志: ${join(dir, 'logs')}`);
}

async function cmdUpload(force = false, reconcile = false): Promise<void> {
  const { dir, config } = await loadConfig();
  await touchStatsSince(dir, config);
  const result = await uploadToServer(dir, config, {
    force,
    fullScan: true,
    reconcile,
    skipDrain: true,
  });
  await drainBackfillUntilIdle(dir, config);

  if (result === null && !force && !config.juejin.enabled) {
    console.log('云端同步未开启（config.juejin.enabled = false）');
    console.log('使用 --force 可强制上报');
    return;
  }

  if (!result || (result.uploaded === 0 && !(result.backfillEnqueued))) {
    console.log('无新数据需上报');
    return;
  }

  console.log(
    `上报完成: ${result.uploaded} 条即时事件, ${result.requestCount} 个请求, accepted=${result.accepted}, duplicate=${result.duplicate}` +
      (result.backfillEnqueued
        ? `, 补报入队 ${result.backfillEnqueued} 条`
        : ''),
  );
}

async function cmdStop(): Promise<void> {
  if (pricingRefreshStop) {
    pricingRefreshStop();
    pricingRefreshStop = null;
  }
  if (syncWatcherStop) {
    syncWatcherStop();
    syncWatcherStop = null;
  }
  runSyncFn = null;
  stopBackfillDrain();
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  const wasObserver = runtimeRole === 'observer';
  if (ownedPid && runtimeDataDir) {
    await releaseRuntimeOwner(runtimeDataDir);
  }
  ownedPid = false;
  runtimeDataDir = null;
  runtime = null;
  runtimeRole = 'owner';
  console.log(wasObserver ? '观察面板已停止' : '服务已停止');
}

async function cmdService(action: string | undefined, daysAgo?: number): Promise<void> {
  const cliBinPath = resolveCliBinPath();
  switch (action) {
    case 'start':
      await cmdServiceStart(cliBinPath, daysAgo);
      break;
    case 'stop':
      await cmdServiceStop();
      break;
    case 'status':
      await cmdServiceStatus();
      break;
    default:
      console.error('用法: jusage service <start|stop|status>');
      process.exit(1);
  }
}

async function main(): Promise<void> {
  const { command, serviceAction, port, source, force, reconcile, days } = parseArgs(process.argv);

  try {
    const daysAgo = resolveDaysAgo(days);
    switch (command) {
      case 'help':
        printHelp();
        break;
      case 'start':
        await cmdStart(port, daysAgo);
        break;
      case 'sync':
        await cmdSync(source);
        break;
      case 'status':
        await cmdStatus();
        break;
      case 'upload':
        await cmdUpload(force, reconcile);
        break;
      case 'stop':
        await cmdStop();
        break;
      case 'service':
        await cmdService(serviceAction, daysAgo);
        break;
      default:
        console.error(`未知命令: ${command}`);
        console.error('使用 jusage --help 查看可用命令');
        process.exit(1);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function shutdownFromSignal(): Promise<void> {
  await cmdStop();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdownFromSignal();
});
process.on('SIGTERM', () => {
  void shutdownFromSignal();
});

main();
