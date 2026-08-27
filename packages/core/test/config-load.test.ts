import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadConfig,
  salvageIdentityFromCorruptConfig,
} from '../src/config.js';
import { configPath } from '../src/paths.js';

test('salvageIdentityFromCorruptConfig extracts deviceId and jau token', () => {
  const raw = `{
  "deviceId": "550e8400-e29b-41d4-a716-446655440000",
  "juejin": { "token": "jau.opaque-login", "enabled": true, }
}`;
  assert.deepEqual(salvageIdentityFromCorruptConfig(raw), {
    deviceId: '550e8400-e29b-41d4-a716-446655440000',
    token: 'jau.opaque-login',
  });
  assert.deepEqual(salvageIdentityFromCorruptConfig('{not json'), {});
});

test('loadConfig recovers from corrupt JSON and keeps salvaged login', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-cfg-'));
  await writeFile(
    configPath(dir),
    `{
  "deviceId": "550e8400-e29b-41d4-a716-446655440000",
  "juejin": { "token": "jau.keep-me", "enabled": true, }
`,
    'utf8',
  );
  const result = await loadConfig(dir);
  assert.ok(result.recoveredFromCorrupt);
  assert.equal(result.recoveredFromCorrupt?.tokenSalvaged, true);
  assert.equal(result.recoveredFromCorrupt?.deviceIdSalvaged, true);
  assert.equal(result.config.deviceId, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(result.config.juejin.token, 'jau.keep-me');
  const written = JSON.parse(await readFile(configPath(dir), 'utf8')) as {
    deviceId: string;
    juejin: { token: string };
  };
  assert.equal(written.deviceId, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(written.juejin.token, 'jau.keep-me');
  const names = await readdir(dir);
  assert.ok(names.some((name) => name.startsWith('config.json.bak.')));
});

test('loadConfig recovers from non-object JSON without salvaged token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-usage-cfg-'));
  await writeFile(configPath(dir), '[]', 'utf8');
  const result = await loadConfig(dir);
  assert.ok(result.recoveredFromCorrupt);
  assert.equal(result.recoveredFromCorrupt?.tokenSalvaged, false);
  assert.match(result.config.deviceId, /^[0-9a-f-]{36}$/i);
});
