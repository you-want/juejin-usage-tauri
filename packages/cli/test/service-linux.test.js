import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLinuxUnit, systemdQuote } from '../dist/service-linux.js';

test('buildLinuxUnit writes ExecStart, Restart, and log paths', () => {
  const unit = buildLinuxUnit(
    '/usr/bin/node',
    ['/usr/lib/node_modules/@juejin-opensource/jusage/bin/jusage.js', 'start'],
    '/home/dev',
    '/home/dev/.ai-usage/logs/daemon.log',
  );

  assert.match(
    unit,
    /ExecStart=\/usr\/bin\/node \/usr\/lib\/node_modules\/@juejin-opensource\/jusage\/bin\/jusage\.js start/,
  );
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^RestartSec=3$/m);
  assert.match(unit, /^WorkingDirectory=\/home\/dev$/m);
  assert.match(unit, /^Environment=HOME=\/home\/dev$/m);
  assert.match(unit, /StandardOutput=append:\/home\/dev\/\.ai-usage\/logs\/daemon\.log/);
  assert.match(unit, /StandardError=append:\/home\/dev\/\.ai-usage\/logs\/daemon\.log/);
  assert.match(unit, /^WantedBy=default\.target$/m);
  assert.match(unit, /\/home\/dev\/\.local\/bin/);
});

test('systemdQuote and buildLinuxUnit escape spaces and percent', () => {
  assert.equal(systemdQuote('/usr/bin/node'), '/usr/bin/node');
  assert.equal(systemdQuote('/home/foo bar/node'), '"/home/foo bar/node"');
  assert.equal(systemdQuote('/tmp/100%ready/node'), '"/tmp/100%%ready/node"');

  const unit = buildLinuxUnit(
    '/home/foo bar/node',
    ['/home/foo bar/jusage.js', 'start'],
    '/home/foo bar',
    '/home/foo bar/.ai-usage/logs/daemon.log',
  );
  assert.match(unit, /ExecStart="\/home\/foo bar\/node" "\/home\/foo bar\/jusage\.js" start/);
  assert.match(unit, /WorkingDirectory="\/home\/foo bar"/);
  assert.match(unit, /StandardOutput=append:"\/home\/foo bar\/\.ai-usage\/logs\/daemon\.log"/);
});
