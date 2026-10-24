/**
 * Desktop-shell pet catalog routes, mounted by `jusage desktop-host` at
 * `/functions/tud-desktop-pets/*` (sidecar-only; NOT part of the shared
 * core local-api contract, which stays upstream-pure).
 *
 * Routes:
 *   GET  /catalog            — local scan of `<dataDir>/pets/`
 *   GET  /remote?force=1     — community catalog (Gitee primary, GitHub fallback)
 *   POST /install  {id}      — download + validate + atomic install
 *   GET  /spritesheet/:id    — serve a local pet's WebP atlas (loopback URL
 *                              used by the Tauri webviews for previews and
 *                              the pet window; replaces Electron's pet-asset://)
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { DESKTOP_PET_ID_PATTERN, DESKTOP_PET_SPRITESHEET_NAME, scanDesktopPetDirectory } from './desktop-pets-scanner.js';
import { fetchRemoteDesktopPets, installRemoteDesktopPet } from './desktop-pets-remote.js';

const ok = (data: unknown) => ({ success: true, message: 'ok', data });
const fail = (message: string, status: 400 | 404 | 500 = 500) =>
  ({ body: { success: false, message, data: null }, status });

export function createDesktopPetsApi(petsRoot: string): Hono {
  const app = new Hono();

  app.get('/catalog', async (c) => {
    try {
      const scanned = await scanDesktopPetDirectory(petsRoot);
      const { spritesheets: _spritesheets, ...catalog } = scanned;
      return c.json(ok(catalog));
    } catch (error) {
      const result = fail(error instanceof Error ? error.message : 'PETS_SCAN_FAILED');
      return c.json(result.body, result.status);
    }
  });

  app.get('/remote', async (c) => {
    try {
      const scanned = await scanDesktopPetDirectory(petsRoot);
      const installed = new Set(scanned.pets.map((pet) => pet.id));
      const remote = await fetchRemoteDesktopPets({
        installedIds: installed,
        force: c.req.query('force') === '1',
      });
      return c.json(ok(remote));
    } catch (error) {
      const result = fail(error instanceof Error ? error.message : 'PETS_REMOTE_FAILED');
      return c.json(result.body, result.status);
    }
  });

  app.post('/install', async (c) => {
    let id = '';
    try {
      const body = (await c.req.json()) as { id?: unknown };
      id = typeof body.id === 'string' ? body.id : '';
    } catch {
      // fall through to the pattern check below
    }
    if (!DESKTOP_PET_ID_PATTERN.test(id)) {
      const result = fail('无效的宠物 id', 400);
      return c.json(result.body, result.status);
    }
    try {
      await installRemoteDesktopPet(id, petsRoot);
      const scanned = await scanDesktopPetDirectory(petsRoot);
      const { spritesheets: _spritesheets, ...catalog } = scanned;
      return c.json(ok(catalog));
    } catch (error) {
      const result = fail(error instanceof Error ? error.message : 'PETS_INSTALL_FAILED');
      return c.json(result.body, result.status);
    }
  });

  app.get('/spritesheet/:id', async (c) => {
    const id = c.req.param('id');
    if (!DESKTOP_PET_ID_PATTERN.test(id)) return c.text('invalid id', 400);
    try {
      const bytes = await readFile(join(petsRoot, id, DESKTOP_PET_SPRITESHEET_NAME));
      return c.body(new Uint8Array(bytes), 200, {
        'Content-Type': 'image/webp',
        'Cache-Control': 'no-cache',
      });
    } catch {
      return c.text('not found', 404);
    }
  });

  return app;
}
