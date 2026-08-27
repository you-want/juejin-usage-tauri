import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { LOG_MAX_BYTES } from './paths.js';

export async function rotateLogIfNeeded(logPath: string): Promise<void> {
  if (!existsSync(logPath)) return;
  const st = await stat(logPath);
  if (st.size < LOG_MAX_BYTES) return;
  const backupPath = `${logPath}.1`;
  if (existsSync(backupPath)) {
    await unlink(backupPath);
  }
  await rename(logPath, backupPath);
}

export async function appendJsonLog(
  logPath: string,
  entry: Record<string, unknown>,
): Promise<void> {
  try {
    await mkdir(dirname(logPath), { recursive: true });
    await rotateLogIfNeeded(logPath);
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
    await appendFile(logPath, line, 'utf8');
  } catch {
    // debug logging must never throw
  }
}
