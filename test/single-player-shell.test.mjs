import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import worker from '../worker/index.js';

test('the active page contains the original canvas and no network lobby', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="gameCanvas"/);
  assert.match(html, /id="inputOverlay"/);
  assert.match(html, /single-player\.js/);
  assert.doesNotMatch(html, /networkDialog|Создать игру|Пригласить друга/);
});

test('the shell exposes rules and adaptation credits without manual scaling controls', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="rulesButton"/);
  assert.match(html, /id="aboutButton"/);
  assert.match(html, /Адаптацию для Telegram сделал канал/);
  assert.match(html, /https:\/\/t\.me\/oodalenka/);
  assert.doesNotMatch(html, /zoomButton|fullscreenButton|Масштаб 1:1|На весь экран/);
});

test('browser pointer movement is never forwarded to the DOS cursor', () => {
  const source = readFileSync(new URL('../src/single-player.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /addEventListener\(['"]pointermove/);
  assert.doesNotMatch(source, /sendMouseMotion/);
  assert.match(source, /moveOriginalPointer/);
  assert.match(source, /playerCardAtPoint/);
  assert.match(source, /Карта выбрана/);
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
  const health = await response.json();
  assert.equal(health.mode, 'single-player');
  assert.equal(health.build, 'single-player-controls-2');
});

test('network room API is disabled', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/rooms', { method: 'POST' }), {});
  assert.equal(response.status, 404);
});
