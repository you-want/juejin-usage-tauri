#!/usr/bin/env node
/**
 * Stage the Tauri sidecar's bundled resources into `src-tauri/node-app/`.
 *
 * The packaged `.app` has no repo on disk, so the Node sidecar must be
 * self-contained: a portable Node runtime + the compiled sidecar entry + the
 * exact runtime dependencies it imports (all of which the core/sidecar dist
 * reference as bare specifiers or `node:` builtins).
 *
 * Resulting tree (bundled by `tauri.conf.json > bundle.resources`):
 *   node-app/
 *     node/            a Node binary for the target platform (dev: host node)
 *     app/dist/        index.js (the CLI desktop-host entry, renamed from
 *                      desktop-host.js) + evict-cli-autostart.js + dashboard/
 *                      (the dashboard dist the Tauri shell's webview loads
 *                      directly instead of a separate Electron-style React
 *                      renderer)
 *     app/node_modules/
 *       @juejin-opensource/jusage-core/   (dist + pricing.json + package.json)
 *       hono/  proper-lockfile/  graceful-fs/  retry/  signal-exit/
 *
 * This runs on the host at build time, so it always produces the host-arch
 * Node binary. On a release build you generate it per target (mac-arm64 /
 * mac-x64 / win-x64); the dev build reuses the local node.
 *
 * Run with: node apps/desktop-tauri/scripts/stage-node-app.mjs
 */
import { cpSync, rmSync, existsSync, chmodSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const outDir = path.join(here, '../src-tauri/node-app');

// (a) resolve the host Node runtime to bundle.
const nodeBin = process.env.TUD_NODE_BIN || process.execPath;
if (!existsSync(nodeBin)) {
  throw new Error(`node runtime not found: ${nodeBin}`);
}

// (b) the compiled CLI desktop-host entry + core. `desktop-host.js` is the
// embedded Node runtime for the Tauri app (replaces the former
// `@juejin-opensource/jusage-sidecar` package); it is staged under the same
// `app/dist/index.js` path the Rust sidecar loader expects, via a copy+rename
// below, so `sidecar.rs`'s bundled-path logic stays unchanged.
const cliDesktopHostDist = path.join(repoRoot, 'packages/cli/dist/desktop-host.js');
const coreDist = path.join(repoRoot, 'packages/core/dist');
const corePkg = path.join(repoRoot, 'packages/core/package.json');
if (!existsSync(cliDesktopHostDist)) {
  throw new Error('CLI not built — run `pnpm build:cli` first');
}
if (!existsSync(path.join(coreDist, 'index.js'))) {
  throw new Error('core not built — run `pnpm build:packages` (or pnpm build) first');
}

// (c) wipe + recreate the staging dir (a stale tree must not leak into the bundle).
rmSync(outDir, { recursive: true, force: true });

// node-app/node（Windows 必须带 .exe 后缀，sidecar.rs 按平台名解析）
const nodeRel = process.platform === 'win32' ? ['node', 'node.exe'] : ['node', 'node'];
cpSync(nodeBin, path.join(outDir, ...nodeRel));
if (process.platform !== 'win32') {
  chmodSync(path.join(outDir, ...nodeRel), 0o755);
}

// node-app/app/dist  (the whole compiled CLI dist/ — desktop-host.js,
// evict-cli-autostart.js + their transitive imports like service-linux.js /
// daemon.js, plus the interactive CLI's own index.js/args.js etc. We ship the
// full tree rather than a hand-maintained allowlist so a new transitive import
// can't silently break the staged bundle. The dashboard/ subdir is large but
// is the actual UI this bundle's host is meant to serve, so it belongs here
// anyway.)
const appDistDir = path.join(outDir, 'app', 'dist');
const cliDistDir = path.dirname(cliDesktopHostDist);
cpSync(cliDistDir, appDistDir, { recursive: true, dereference: true });
// The host only ever runs `node .../index.js`; rename desktop-host.js →
// index.js so Rust's bundled-path lookup stays identical to the old sidecar.
import { copyFileSync } from 'node:fs';
copyFileSync(cliDesktopHostDist, path.join(appDistDir, 'index.js'));

// node-app/app/dist/dashboard  (the UI the Tauri shell's webview loads
// directly — the same artifact `packages/cli/scripts/copy-dashboard.mjs`
// already stages under the CLI's own dist/ tree).
const cliDashboardDist = path.join(repoRoot, 'packages/cli/dist/dashboard');
if (!existsSync(cliDashboardDist)) {
  throw new Error(
    'CLI dashboard dist missing — run `pnpm build:cli` (builds dashboard + copies it into cli/dist/dashboard) first',
  );
}
cpSync(cliDashboardDist, path.join(appDistDir, 'dashboard'), { recursive: true, dereference: true });

// node-app/app/node_modules/@juejin-opensource/jusage-core  (dist + pricing + pkg)
const coreMod = path.join(outDir, 'app/node_modules/@juejin-opensource/jusage-core');
cpSync(coreDist, path.join(coreMod, 'dist'), { recursive: true, dereference: true });
cpSync(corePkg, path.join(coreMod, 'package.json'));
// the core's `main`/`exports` point at ./dist; pricing.json ships in dist/.

// node-app/app/node_modules/<runtime deps>
// Core's DIRECT dependencies are derived from its package.json so an upstream
// dependency addition (fzstd/yaml landed in v0.1.15 and broke v0.2.1 exactly
// this way) can never silently vanish from the bundle again. Versions resolve
// through the pnpm store; the hoisted root is the fallback.
// graceful-fs / retry / signal-exit are proper-lockfile's TRANSITIVE deps —
// pnpm's isolated layout does not expose them to the core package, so they
// stay listed here until upstream switches to a hoisted layout.
const coreDeps = Object.keys(
  JSON.parse(readFileSync(corePkg, 'utf8')).dependencies ?? {},
);
const transitiveDeps = ['graceful-fs', 'retry', 'signal-exit'];
const runtimeDeps = [...new Set([...coreDeps, ...transitiveDeps])];
const coreDir = path.join(repoRoot, 'packages/core');
const nmOut = path.join(outDir, 'app/node_modules');

/** Forward-slash normalize so marker matching works on Windows paths too. */
const norm = (p) => path.resolve(p).split(path.sep).join('/');

/**
 * Copy one package dir into nmOut unless already staged this run.
 * `dereference: true` is REQUIRED on Windows: pnpm's store entries are
 * junctions, and copying a junction as a junction makes the destination's
 * realpath equal the store source — a later stage of the same package then
 * trips cpSync's same-realpath guard (ERR_FS_CP_EINVAL).
 */
function stageDir(srcPkgDir, outRelName) {
  const dest = path.join(nmOut, outRelName);
  if (existsSync(dest)) return;
  cpSync(srcPkgDir, dest, { recursive: true, force: true, dereference: true });
}

/** `".pnpm/<name>@<ver>"` entries for package `name`, newest first. */
function storeEntriesFor(name) {
  const dir = path.join(repoRoot, 'node_modules/.pnpm');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.startsWith(`${name}@`))
    .filter((entry) => !entry.endsWith('-peer'))
    .sort(compareVersionsDesc);
}

/** Stage every package inside one store entry's node_modules tree. */
function stageStoreEntryTree(entry) {
  const nmRoot = path.join(repoRoot, 'node_modules/.pnpm', entry, 'node_modules');
  for (const item of readdirSync(nmRoot)) {
    if (item.startsWith('.')) continue;
    if (item.startsWith('@')) {
      for (const inner of readdirSync(path.join(nmRoot, item))) {
        stageDir(path.join(nmRoot, item, inner), path.join(item, inner));
      }
    } else {
      stageDir(path.join(nmRoot, item), item);
    }
  }
}


/** Stage every package inside one store entry's node_modules tree. */

for (const name of runtimeDeps) {
  // Direct dep of core: ask core's own resolution for the exact store copy.
  let resolved = null;
  try {
    resolved = execFileSync(
      process.execPath,
      [
        '-e',
        'console.log(require.resolve(process.argv[1], { paths: [process.argv[2]] }))',
        name,
        coreDir,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    // transitive deps land here → store scan below
  }
  if (resolved) {
    const marker = `/node_modules/${name}`;
    const normalized = norm(resolved);
    const i = normalized.lastIndexOf(marker);
    if (i >= 0) {
      const pkgPath = normalized.slice(0, i + marker.length);
      stageDir(realpathSync(pkgPath), name);
      // Stage the store entry's own nested deps too: they are the versions
      // THIS consumer resolves (proper-lockfile@4.1.2 needs signal-exit@3 —
      // the store also holds a hoisted-unrelated @4 that must not win).
      const beforeMarker = normalized.slice(0, i);
      const pnpmIdx = beforeMarker.lastIndexOf('/.pnpm/');
      if (pnpmIdx >= 0) {
        const entry = beforeMarker.slice(pnpmIdx + '/.pnpm/'.length);
        if (entry && !entry.includes('/')) stageStoreEntryTree(entry);
      }
      continue;
    }
  }

  // Transitive dep: stage the full node_modules tree of every store entry for
  // that name — carries nested deps (proper-lockfile nests signal-exit@3)
  // with the versions core actually resolves at runtime.
  const entries = storeEntriesFor(name);
  if (entries.length === 0) {
    throw new Error(`missing runtime dep for sidecar bundle: ${name}`);
  }
  for (const entry of entries) {
    stageStoreEntryTree(entry);
  }
}

console.log(`[stage-node-app] staged Tauri desktop-host runtime → ${path.relative(repoRoot, outDir)}`);
console.log(`[stage-node-app]   node runtime: ${nodeBin} (host arch)`);
console.log(`[stage-node-app]   desktop-host: ${cliDesktopHostDist} (→ app/dist/index.js)`);
console.log(`[stage-node-app]   deps:         ${runtimeDeps.map(([n]) => n).join(', ')}`);

/** Semver-ish descending sort: higher version first (best effort). */

/** Semver-ish descending sort: higher version first (best effort). */
function compareVersionsDesc(a, b) {
  const pa = a.slice(a.indexOf('@', 1) + 1).split('.');
  const pb = b.slice(b.indexOf('@', 1) + 1).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = Number(pa[i] ?? 0);
    const nb = Number(pb[i] ?? 0);
    if (na !== nb) return nb - na;
  }
  return a < b ? 1 : a > b ? -1 : 0;
}

