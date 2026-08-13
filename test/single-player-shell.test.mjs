import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import worker from '../worker/index.js';

test('the active page contains the original canvas and no network lobby', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="gameCanvas"/);
  assert.match(html, /single-player\.js/);
  assert.doesNotMatch(html, /networkDialog|Создать игру|Пригласить друга/);
});

test('Cloudflare assets exclude repository internals', () => {
  const ignored = readFileSync(new URL('../.assetsignore', import.meta.url), 'utf8').split(/\r?\n/);
  assert.ok(ignored.includes('.git'));
  assert.ok(ignored.includes('worker'));
  assert.ok(ignored.includes('test'));
  assert.ok(!ignored.includes('kingrus.zip'));
});

test('health reports single-player mode', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/health'), { ASSETS: {} });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, 'single-player');
});

test('network room API is disabled', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/rooms', { method: 'POST' }), {});
  assert.equal(response.status, 404);
});
