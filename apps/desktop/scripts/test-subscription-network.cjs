// Run with Electron after compiling tsconfig.test.json; creates no windows.
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { app, session } = require('electron');
const { fetchSubscription } = require('../dist-test/main/subscription-fetch.js');
const { createCodexSubscriptionReader } = require('../dist-test/main/codex-subscription.js');

const userData = mkdtempSync(join(tmpdir(), 'jusage-subscription-network-'));
app.setPath('userData', userData);
const url = 'http://quota-regression.invalid/usage';
const payload = { plan_type: 'pro', rate_limit: {
  primary_window: { used_percent: 12, limit_window_seconds: 18000 },
  secondary_window: { used_percent: 34, limit_window_seconds: 604800 },
} };
const requests = [];
const proxy = createServer((req, res) => {
  requests.push({ url: req.url, headers: req.headers });
  if (req.url.endsWith('/stall')) return;
  if (req.url.endsWith('/redirect')) {
    res.writeHead(302, { Location: 'http://unexpected-destination.invalid/' });
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
});

app.whenReady().then(async () => {
  try {
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    await session.defaultSession.setProxy({
      mode: 'fixed_servers', proxyRules: `http://127.0.0.1:${proxy.address().port}`,
    });
    await session.defaultSession.cookies.set({ url, name: 'unrelated-session', value: 'must-not-send' });

    // The former Node transport bypasses this proxy and cannot resolve .invalid.
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(3000) }));
    assert.equal(requests.length, 0);

    const read = createCodexSubscriptionReader({
      readAuth: async () => JSON.stringify({ tokens: { access_token: 'test-only-token', account_id: 'test-only-account' } }),
      fetch: (_input, init) => fetchSubscription(url, init),
    });
    const snapshot = await read();
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.fiveHour.usedPercent, 12);
    assert.equal(snapshot.weekly.usedPercent, 34);
    assert.equal(requests[0].headers.authorization, 'Bearer test-only-token');
    assert.equal(requests[0].headers.cookie, undefined);
    assert.equal(JSON.stringify(snapshot).includes('test-only-token'), false);

    await assert.rejects(fetchSubscription(new URL(url.replace('/usage', '/redirect')), {
      redirect: 'error', signal: AbortSignal.timeout(3000),
    }));
    assert.equal(requests.some(request => request.url.includes('unexpected-destination')), false);
    await assert.rejects(fetchSubscription(url.replace('/usage', '/stall'), {
      signal: AbortSignal.timeout(100),
    }));
    console.log('PASS: proxy routing, Codex quota recovery, cookie isolation, redirect rejection and abort');
  } finally {
    proxy.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve));
    await session.defaultSession.closeAllConnections();
  }
}).then(() => app.quit()).catch(error => {
  console.error(error);
  app.exit(1);
});
app.on('quit', () => rmSync(userData, { recursive: true, force: true }));
