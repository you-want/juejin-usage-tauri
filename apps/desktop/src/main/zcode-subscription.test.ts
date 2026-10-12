import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readZcodeResetCredits, decryptZcodeCredential, extractBillingPlan, readOpenCodeAuth } from './zcode-subscription';

function encrypt(plain: string, secret: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), nonce);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `enc:v1:${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

test('decrypts ZCode credentials only with the current device secret', () => {
  const encrypted = encrypt('zcode-jwt', 'current-device-secret');
  assert.equal(decryptZcodeCredential(encrypted, 'current-device-secret'), 'zcode-jwt');
  assert.equal(decryptZcodeCredential(encrypted, 'other-device-secret'), null);
});

test('maps an active ZCode billing tier without exposing plan payload', () => {
  assert.equal(extractBillingPlan({
    data: { plans: [{ status: 'active', plan_id: 'zai-pro-monthly' }] },
  }), 'Pro');
  assert.equal(extractBillingPlan({ data: { plans: [] } }), null);
});

test('reads Z.ai and BigModel credentials from OpenCode auth.json', async (t) => {
  const tempHome = mkdtempSync(path.join(tmpdir(), 'zcode-opencode-'));
  const authPath = path.join(tempHome, 'auth.json');
  t.after(() => {
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true });
  });

  writeFileSync(authPath, JSON.stringify({
    zai: { token: 'opencode-zai-credential-1234567890' },
    zhipuai: { apiKey: 'opencode-bigmodel-credential-1234567890' },
  }));
  process.env.OPENCODE_HOME = tempHome;

  const zai = await readOpenCodeAuth();
  assert.equal(zai?.provider, 'zai');
  assert.ok(zai?.token.startsWith('opencode-zai-credential'));

  writeFileSync(authPath, JSON.stringify({
    zhipuai: { token: 'opencode-bigmodel-credential-0987654321' },
  }));
  const bigmodel = await readOpenCodeAuth();
  assert.equal(bigmodel?.provider, 'bigmodel');
  assert.ok(bigmodel?.token.startsWith('opencode-bigmodel-credential'));

  writeFileSync(authPath, JSON.stringify({ openai: { token: 'unrelated-token' } }));
  assert.equal(await readOpenCodeAuth(), null);

  rmSync(authPath);
  assert.equal(await readOpenCodeAuth(), null);

  delete process.env.OPENCODE_HOME;
});


test('reset cards use only GET with both local account tokens, failures remain unknown', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://zcode.z.ai/api/v1/coding-plan/reset/status');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer fake-zcode');
    assert.equal(headers['X-Bigmodel-Authorization'], 'fake-platform');
    return Response.json({ code: 0, data: { available_five_hour_resets: [], available_week_resets: [{ expire_at: 1900000000 }] } });
  };
  const credentials = { token: 'fake', provider: 'bigmodel' as const };
  assert.equal(await readZcodeResetCredits(credentials, fetcher), undefined);
  assert.equal(calls, 0);
  const result = await readZcodeResetCredits({ ...credentials, resetAuth: { zcodeToken: 'fake-zcode', platformToken: 'fake-platform' } }, fetcher);
  assert.equal(result?.weekly.length, 1);
  assert.equal(calls, 1);
  assert.equal(await readZcodeResetCredits({ ...credentials, resetAuth: { zcodeToken: 'fake-zcode', platformToken: 'fake-platform' } }, async () => { throw new Error('timeout'); }), undefined);
});
