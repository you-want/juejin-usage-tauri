import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  resetProjectNameCache,
  resolveProjectName,
} from '../src/project-name.js';

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], {
      stdio: 'ignore',
      timeout: 2_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** Temp dirs under OS tmp so they are not nested inside this monorepo's .git. */
function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('resolveProjectName returns unknown for empty input', () => {
  resetProjectNameCache();
  assert.equal(resolveProjectName(''), 'unknown');
  assert.equal(resolveProjectName('   '), 'unknown');
  assert.equal(resolveProjectName('unknown'), 'unknown');
});

test('resolveProjectName falls back to basename for non-git directory', () => {
  resetProjectNameCache();
  const root = makeTempDir('tud-proj-nongit-');
  try {
    const dir = join(root, 'my-app');
    mkdirSync(dir);
    assert.equal(resolveProjectName(dir), 'my-app');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'resolveProjectName uses git toplevel basename for nested cwd',
  { skip: !hasGit() },
  () => {
    resetProjectNameCache();
    const root = makeTempDir('tud-proj-git-');
    const repo = join(root, 'ai-usage');
    const nested = join(repo, 'packages', 'core');
    try {
      mkdirSync(nested, { recursive: true });
      execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '--template='], {
        cwd: repo,
        encoding: 'utf-8',
        timeout: 5_000,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
        },
      });
      writeFileSync(join(repo, 'README.md'), 'x\n');
      assert.equal(resolveProjectName(nested), 'ai-usage');
      assert.equal(resolveProjectName(repo), 'ai-usage');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('resolveProjectName caches by path', () => {
  resetProjectNameCache();
  const root = makeTempDir('tud-proj-cache-');
  try {
    const dir = join(root, 'cached-app');
    mkdirSync(dir);
    const first = resolveProjectName(dir);
    const second = resolveProjectName(dir);
    assert.equal(first, 'cached-app');
    assert.equal(second, first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
