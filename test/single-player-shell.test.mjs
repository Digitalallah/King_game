import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import worker from '../worker/index.js';

test('the active page runs the native canvas game and no network lobby', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="gameCanvas"/);
  assert.match(html, /src="\.\/src\/native-game\.js/);
  assert.doesNotMatch(html, /inputOverlay|single-player\.js|emulators\.js/);
  assert.doesNotMatch(html, /networkDialog|Создать игру|Пригласить друга/);
});

test('loading copy is only the word requested by the user', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../src/native-game.js', import.meta.url), 'utf8');
  assert.match(html, /id="loadingText">Загрузка</);
  assert.match(html, /id="gameHint">Загрузка</);
  assert.match(source, /loadingText\.textContent = 'Загрузка'/);
  assert.doesNotMatch(`${html}\n${source}`, /Распаковываем|Читаем оригинальные файлы|Запускаем .*EXE/);
});

test('rules and adaptation credits are present without the removed executable paragraph', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="rulesButton"/);
  assert.match(html, /id="aboutButton"/);
  assert.match(html, /Адаптацию для Telegram сделал канал/);
  assert.match(html, /https:\/\/t\.me\/oodalenka/);
  assert.doesNotMatch(html, /В этой версии запускается|KING\.EXE/);
  assert.doesNotMatch(html, /zoomButton|fullscreenButton|Масштаб 1:1|На весь экран/);
});

test('native pointer input uses CSS-space jitter tolerance and has no moving hand cursor', () => {
  const source = readFileSync(new URL('../src/native-game.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /TAP_MOVE_LIMIT_CSS = 28/);
  assert.match(source, /event\.clientX - start\.clientX/);
  assert.match(source, /updateCardTapSelection/);
  assert.doesNotMatch(source, /pointermove|sendMouse|moveOriginalPointer/);
  assert.match(css, /#gameCanvas\s*\{[^}]*cursor:\s*default/s);
  assert.doesNotMatch(css, /cursor:\s*url/);
});

test('Cloudflare assets exclude emulator files and repository internals', () => {
  const ignored = readFileSync(new URL('../.assetsignore', import.meta.url), 'utf8').split(/\r?\n/);
  assert.ok(ignored.includes('.git'));
  assert.ok(ignored.includes('worker'));
  assert.ok(ignored.includes('test'));
  assert.ok(ignored.includes('vendor'));
  assert.ok(ignored.includes('kingrus.zip'));
  assert.ok(!ignored.includes('assets'));
});

test('health reports the native single-player build', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/health'), { ASSETS: {} });
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.mode, 'single-player');
  assert.equal(health.build, 'native-single-player-1');
});

test('network room API is disabled', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/rooms', { method: 'POST' }), {});
  assert.equal(response.status, 404);
});
