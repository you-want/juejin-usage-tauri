#!/usr/bin/env node
/**
 * Overwrite-sync juejin-usage/cards → ai-usage server.
 * - copies cards/ directory (full replace of target cards/)
 * - regenerates apps/server/src/embed/template-artwork.ts
 *
 * Env:
 *   USAGE_CARDS_SERVER_ROOT  absolute or relative path to ai-usage/apps/server
 *                            default: ../ai-usage/apps/server (sibling checkout)
 */
import { cp, mkdir, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const cardsSrc = path.join(root, 'cards');
const serverRoot = path.resolve(
  root,
  process.env.USAGE_CARDS_SERVER_ROOT ?? '../ai-usage/apps/server',
);
const cardsDst = path.join(serverRoot, 'cards');
const artworkOut = path.join(serverRoot, 'src/embed/template-artwork.ts');

await access(cardsSrc, constants.R_OK);
try {
  await access(serverRoot, constants.W_OK);
} catch {
  console.error(`Server root not writable: ${serverRoot}`);
  console.error('Set USAGE_CARDS_SERVER_ROOT to your ai-usage/apps/server path.');
  process.exit(1);
}

await rm(cardsDst, { recursive: true, force: true });
await mkdir(path.dirname(cardsDst), { recursive: true });
await cp(cardsSrc, cardsDst, { recursive: true });
console.log(`Copied cards/ → ${cardsDst}`);

const build = spawnSync(
  process.execPath,
  [path.join(root, 'scripts/build-usage-cards.mjs'), artworkOut],
  { stdio: 'inherit' },
);
if (build.status !== 0) process.exit(build.status ?? 1);
console.log(`Wrote ${artworkOut}`);
