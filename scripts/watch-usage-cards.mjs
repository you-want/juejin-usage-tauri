#!/usr/bin/env node
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const cardsDir = path.join(root, 'cards');
const buildScript = path.join(root, 'scripts/build-usage-cards.mjs');
let timer = null;
let running = false;
let queued = false;

function run() {
  if (running) { queued = true; return; }
  running = true;
  const child = spawn(process.execPath, [buildScript], { stdio: 'inherit' });
  child.on('exit', (code) => {
    running = false;
    if (queued) { queued = false; run(); }
    else if (code) console.error(`cards:build exited ${code}`);
  });
}

run();
watch(cardsDir, { recursive: true }, (_event, filename) => {
  if (!filename || filename.startsWith('.')) return;
  clearTimeout(timer);
  timer = setTimeout(run, 120);
});
console.log(`Watching ${cardsDir}`);
