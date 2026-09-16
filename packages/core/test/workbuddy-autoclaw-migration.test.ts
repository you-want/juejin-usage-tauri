import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { autoclawProjectForPath } from '../src/parsers/autoclaw.js';
import {
  appendBuckets,
  dedupeBuckets,
  loadCursors,
  loadRecentBuckets,
  resetCursorsCache,
} from '../src/queue/index.js';
import { bucketKey } from '../src/queue/keys.js';
import { syncAutoclaw, syncWorkbuddy } from '../src/sync/index.js';
import type { CursorsFile, QueueBucket, TudConfig } from '../src/types.js';
import { isolateAgentHome } from './platform-fixtures.js';

const SINCE = '2020-01-01T00:00:00.000Z';
const WB_HOUR = '2026-07-24T11:00:00.000Z';

function baseConfig(dataDir: string): TudConfig {
  return {
    deviceId: 'test-device',
    statsSince: SINCE,
    localCollectSince: SINCE,
    dataDir,
    hostname: 'test-host',
    juejin: { enabled: false, apiUrl: '', authMode: 'device', token: null },
  } as TudConfig;
}

function workbuddyBucket(project: string, totalTokens: number, hourStart = WB_HOUR): QueueBucket {
  return {
    source: 'workbuddy',
    collector: 'workbuddy',
    model: 'wb-model',
    project,
    hour_start: hourStart,
    input_tokens: totalTokens,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: totalTokens,
    conversation_count: 1,
  };
}

async function makeDataDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), 'tud-mig-data-'));
  await mkdir(join(dataDir, 'queue'), { recursive: true });
  resetCursorsCache();
  return dataDir;
}

async function seedWorkbuddySession(
  home: string,
  opts?: { sessionId?: string; cwd?: string; promptTokens?: number; messageId?: string },
): Promise<string> {
  const sessionId = opts?.sessionId ?? 'sess-mig';
  const projects = join(home, '.workbuddy', 'projects');
  await mkdir(projects, { recursive: true });
  const filePath = join(projects, `${sessionId}.jsonl`);
  await writeFile(
    filePath,
    JSON.stringify({
      sessionId,
      id: opts?.messageId ?? 'm1',
      cwd: opts?.cwd ?? '/Users/me/wb-demo',
      timestamp: Date.parse(WB_HOUR),
      providerData: {
        model: 'wb-model',
        rawUsage: {
          prompt_tokens: opts?.promptTokens ?? 100,
          completion_tokens: 0,
        },
      },
    }) + '\n',
  );
  return filePath;
}

function workbuddyTotals(rows: QueueBucket[]): number {
  return dedupeBuckets(rows.filter((row) => row.source === 'workbuddy')).reduce(
    (sum, row) => sum + row.total_tokens,
    0,
  );
}

test('autoclawProjectForPath resolves unix repo roots and ignores state dirs', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'tud-acrepo-'));
  await mkdir(join(repo, '.git'), { recursive: true });
  const filePath = join(repo, 'src', 'Main.java');
  assert.equal(autoclawProjectForPath(filePath), repo.split('/').pop());

  const prev = process.env.AUTOCLAW_STATE_DIR;
  process.env.AUTOCLAW_STATE_DIR = repo;
  try {
    assert.equal(autoclawProjectForPath(join(repo, 'agents', 'main', 'workspace', 'foo.txt')), null);
  } finally {
    if (prev === undefined) delete process.env.AUTOCLAW_STATE_DIR;
    else process.env.AUTOCLAW_STATE_DIR = prev;
  }
});

test('syncWorkbuddy skips fullRescan when queue has no legacy unknown rows', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-wb-skip-'));
  const restore = isolateAgentHome(home);
  const dataDir = await makeDataDir();
  try {
    await seedWorkbuddySession(home);
    const first = await syncWorkbuddy(dataDir, baseConfig(dataDir));
    assert.ok(first.eventsParsed >= 1);
    assert.equal(first.bucketsWritten >= 1, true);

    const cursors = await loadCursors(dataDir);
    assert.equal(
      (cursors as { workbuddy?: { cwdProjects?: boolean } }).workbuddy?.cwdProjects,
      true,
    );

    const rows = dedupeBuckets(await loadRecentBuckets(dataDir, SINCE));
    assert.equal(rows.some((row) => row.source === 'workbuddy' && row.project === 'wb-demo'), true);
    assert.equal(workbuddyTotals(rows), 100);

    const second = await syncWorkbuddy(dataDir, baseConfig(dataDir));
    assert.equal(second.eventsParsed, 0);
    assert.equal(second.bucketsWritten, 0);
    assert.equal(workbuddyTotals(await loadRecentBuckets(dataDir, SINCE)), 100);
  } finally {
    restore();
  }
});

test('syncWorkbuddy ignores zero-token unknown rows when deciding migration', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-wb-zero-unknown-'));
  const restore = isolateAgentHome(home);
  const dataDir = await makeDataDir();
  try {
    const filePath = await seedWorkbuddySession(home);
    await appendBuckets(dataDir, [workbuddyBucket('unknown', 0)]);

    const consumed = statSync(filePath);
    await writeFile(
      join(dataDir, 'cursors.json'),
      `${JSON.stringify({
        workbuddy: {
          seenIds: ['m1'],
          fileOffsets: {
            [filePath]: { size: consumed.size, mtimeMs: consumed.mtimeMs, ino: consumed.ino },
          },
          sqliteSessions: {},
          detailedSessions: { 'sess-mig': true },
        },
      } as CursorsFile)}\n`,
    );
    resetCursorsCache();

    const result = await syncWorkbuddy(dataDir, baseConfig(dataDir));
    assert.equal(result.eventsParsed, 0);
    assert.equal(result.bucketsWritten, 0);

    const cursors = await loadCursors(dataDir);
    assert.equal(
      (cursors as { workbuddy?: { cwdProjects?: boolean } }).workbuddy?.cwdProjects,
      true,
    );
  } finally {
    restore();
  }
});

test('syncWorkbuddy fullRescan once migrates legacy unknown rows without doubling totals', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-wb-migrate-'));
  const restore = isolateAgentHome(home);
  const dataDir = await makeDataDir();
  try {
    const filePath = await seedWorkbuddySession(home);
    await appendBuckets(dataDir, [workbuddyBucket('unknown', 100)]);

    const consumed = statSync(filePath);
    await writeFile(
      join(dataDir, 'cursors.json'),
      `${JSON.stringify({
        workbuddy: {
          seenIds: ['m1'],
          fileOffsets: {
            [filePath]: { size: consumed.size, mtimeMs: consumed.mtimeMs, ino: consumed.ino },
          },
          sqliteSessions: {},
          detailedSessions: { 'sess-mig': true },
        },
      } as CursorsFile)}\n`,
    );
    resetCursorsCache();

    const first = await syncWorkbuddy(dataDir, baseConfig(dataDir));
    assert.ok(first.eventsParsed >= 1);
    assert.ok(first.bucketsWritten >= 1);

    const rows = dedupeBuckets(await loadRecentBuckets(dataDir, SINCE));
    const unknownKey = bucketKey(workbuddyBucket('unknown', 100));
    const demoKey = bucketKey(workbuddyBucket('wb-demo', 100));
    const unknownRow = rows.find((row) => bucketKey(row) === unknownKey);
    const demoRow = rows.find((row) => bucketKey(row) === demoKey);

    assert.equal(unknownRow?.total_tokens, 0);
    assert.equal(demoRow?.total_tokens, 100);
    assert.equal(workbuddyTotals(rows), 100);

    const cursors = await loadCursors(dataDir);
    assert.equal(
      (cursors as { workbuddy?: { cwdProjects?: boolean } }).workbuddy?.cwdProjects,
      true,
    );

    const second = await syncWorkbuddy(dataDir, baseConfig(dataDir));
    assert.equal(second.eventsParsed, 0);
    assert.equal(second.bucketsWritten, 0);
    assert.equal(workbuddyTotals(await loadRecentBuckets(dataDir, SINCE)), 100);
  } finally {
    restore();
  }
});

test('syncWorkbuddy does not fullRescan again when zeroed unknown rows remain', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-wb-linger-'));
  const restore = isolateAgentHome(home);
  const dataDir = await makeDataDir();
  try {
    const filePath = await seedWorkbuddySession(home);
    await appendBuckets(dataDir, [
      workbuddyBucket('unknown', 0),
      workbuddyBucket('wb-demo', 100),
    ]);
    const consumed = statSync(filePath);
    await writeFile(
      join(dataDir, 'cursors.json'),
      `${JSON.stringify({
        workbuddy: {
          cwdProjects: true,
          seenIds: ['m1'],
          fileOffsets: {
            [filePath]: { size: consumed.size, mtimeMs: consumed.mtimeMs, ino: consumed.ino },
          },
          sqliteSessions: {},
          detailedSessions: { 'sess-mig': true },
        },
      } as CursorsFile)}\n`,
    );
    resetCursorsCache();

    const result = await syncWorkbuddy(dataDir, baseConfig(dataDir));
    assert.equal(result.eventsParsed, 0);
    assert.equal(result.bucketsWritten, 0);
    assert.equal(workbuddyTotals(await loadRecentBuckets(dataDir, SINCE)), 100);
  } finally {
    restore();
  }
});

test('syncWorkbuddy ignores unknown rows outside collect window', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-wb-old-unknown-'));
  const restore = isolateAgentHome(home);
  const dataDir = await makeDataDir();
  try {
    const filePath = await seedWorkbuddySession(home);
    await appendBuckets(dataDir, [workbuddyBucket('unknown', 80, '2026-01-01T00:00:00.000Z')]);

    const consumed = statSync(filePath);
    await writeFile(
      join(dataDir, 'cursors.json'),
      `${JSON.stringify({
        workbuddy: {
          seenIds: ['m1'],
          fileOffsets: {
            [filePath]: { size: consumed.size, mtimeMs: consumed.mtimeMs, ino: consumed.ino },
          },
          sqliteSessions: {},
          detailedSessions: { 'sess-mig': true },
        },
      } as CursorsFile)}\n`,
    );
    resetCursorsCache();

    const config = baseConfig(dataDir);
    config.localCollectSince = '2026-07-01T00:00:00.000Z';

    const result = await syncWorkbuddy(dataDir, config);
    assert.equal(result.eventsParsed, 0);
    assert.equal(result.bucketsWritten, 0);

    const cursors = await loadCursors(dataDir);
    assert.equal(
      (cursors as { workbuddy?: { cwdProjects?: boolean } }).workbuddy?.cwdProjects,
      true,
    );

    const rows = dedupeBuckets(await loadRecentBuckets(dataDir, config.localCollectSince!));
    const staleUnknown = rows.find(
      (row) => row.source === 'workbuddy' && row.project === 'unknown' && row.total_tokens > 0,
    );
    assert.equal(staleUnknown, undefined);
  } finally {
    restore();
  }
});

test('syncAutoclaw marks repoProjects after first sync and stays incremental', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tud-ac-sync-'));
  const dataDir = await makeDataDir();
  const prev = process.env.AUTOCLAW_STATE_DIR;
  process.env.AUTOCLAW_STATE_DIR = home;
  try {
    const sessions = join(home, 'agents', 'main', 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      join(sessions, 's1.jsonl'),
      JSON.stringify({
        type: 'message',
        timestamp: WB_HOUR,
        message: {
          role: 'assistant',
          model: 'glm-5.3-flash',
          usage: { input: 40, output: 6 },
        },
      }) + '\n',
    );

    const first = await syncAutoclaw(dataDir, baseConfig(dataDir));
    assert.ok(first.eventsParsed >= 1);
    assert.ok(first.bucketsWritten >= 1);

    const cursors = await loadCursors(dataDir);
    assert.equal(
      (cursors as { autoclaw?: { repoProjects?: boolean } }).autoclaw?.repoProjects,
      true,
    );

    const second = await syncAutoclaw(dataDir, baseConfig(dataDir));
    assert.equal(second.eventsParsed, 0);
    assert.equal(second.bucketsWritten, 0);

    const rows = dedupeBuckets(await loadRecentBuckets(dataDir, SINCE));
    assert.equal(rows.filter((row) => row.source === 'autoclaw').length, 1);
    assert.equal(rows.find((row) => row.source === 'autoclaw')?.total_tokens, 46);
  } finally {
    if (prev === undefined) delete process.env.AUTOCLAW_STATE_DIR;
    else process.env.AUTOCLAW_STATE_DIR = prev;
  }
});
