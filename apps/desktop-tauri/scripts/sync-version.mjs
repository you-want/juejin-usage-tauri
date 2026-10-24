#!/usr/bin/env node
/**
 * Keep the Tauri app's version in one place: `apps/desktop-tauri/package.json`.
 * This script propagates it into `src-tauri/tauri.conf.json` and
 * `src-tauri/Cargo.toml` (three-way drift caused the About panel to report
 * 0.1.0 while the app shipped 0.1.9). Runs as part of `pnpm build` in
 * apps/desktop-tauri, i.e. before every `tauri build`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, '..', 'package.json');
const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`[sync-version] invalid version in package.json: ${version}`);
  process.exit(1);
}

// tauri.conf.json
const confPath = join(here, '..', 'src-tauri', 'tauri.conf.json');
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
conf.version = version;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');

// Cargo.toml (top-level `version = "..."`)
const cargoPath = join(here, '..', 'src-tauri', 'Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8');
const patched = cargo.replace(
  /^version\s*=\s*"[^"]*"/m,
  `version = "${version}"`,
);
if (patched === cargo && !new RegExp(`^version\\s*=\\s*"${version}"`, 'm').test(cargo)) {
  console.error('[sync-version] Cargo.toml version line not found');
  process.exit(1);
}
writeFileSync(cargoPath, patched);
console.log(`[sync-version] package.json/tauri.conf.json/Cargo.toml -> ${version}`);
