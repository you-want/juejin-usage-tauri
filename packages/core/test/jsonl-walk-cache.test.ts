import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { findJsonlFiles, resetJsonlWalkCache } from '../src/parsers/shared.js';

test('findJsonlFiles reuses directory listing when mtime is unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tud-jsonl-walk-'));
  resetJsonlWalkCache();
  try {
    const nested = join(dir, 'sess');
    await mkdir(nested);
    const a = join(nested, 'a.jsonl');
    await writeFile(a, '{}\n', 'utf8');

    const first = await findJsonlFiles(dir);
    assert.deepEqual(first.sort(), [a]);

    // Same tree: second walk should still return the known file (cache hit).
    const second = await findJsonlFiles(dir);
    assert.deepEqual(second.sort(), [a]);

    const b = join(nested, 'b.jsonl');
    await writeFile(b, '{}\n', 'utf8');
    const third = await findJsonlFiles(dir);
    assert.deepEqual(third.sort(), [a, b]);
  } finally {
    resetJsonlWalkCache();
    await rm(dir, { recursive: true, force: true });
  }
});
