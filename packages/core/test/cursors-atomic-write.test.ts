import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resetCursorsCache, saveCursors } from '../src/queue/index.js';

test('saveCursors replaces cursors.json without leaving a temp file behind', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-cursors-atomic-'));
  resetCursorsCache(dir);
  try {
    await saveCursors(dir, { claude: { files: {}, seenHashes: ['a'], seenUsage: {} } });
    await saveCursors(dir, { claude: { files: {}, seenHashes: ['b'], seenUsage: {} } });
    const raw = await readFile(join(dir, 'cursors.json'), 'utf8');
    assert.deepEqual(JSON.parse(raw).claude.seenHashes, ['b']);
    assert.deepEqual(await readdir(dir), ['cursors.json']);
  } finally {
    resetCursorsCache(dir);
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveCursors still persists when the temp file cannot be created', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-cursors-fallback-'));
  resetCursorsCache(dir);
  try {
    // A directory squatting on the temp path makes the temp write fail.
    await mkdir(join(dir, `cursors.json.${process.pid}.tmp`));
    await saveCursors(dir, { claude: { files: {}, seenHashes: ['c'], seenUsage: {} } });
    const raw = await readFile(join(dir, 'cursors.json'), 'utf8');
    assert.deepEqual(JSON.parse(raw).claude.seenHashes, ['c']);
  } finally {
    resetCursorsCache(dir);
    await rm(dir, { recursive: true, force: true });
  }
});
