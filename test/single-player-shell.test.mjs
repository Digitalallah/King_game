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
  assert.match(html, /id="continueButton"[^>]*>Продолжить игру</);
  assert.match(html, /id="newGameButton"[^>]*>Начать новую</);
});

test('unfinished matches are autosaved and can be resumed', () => {
  const source = readFileSync(new URL('../src/native-game.js', import.meta.url), 'utf8');
  const engine = readFileSync(new URL('../src/game-engine.js', import.meta.url), 'utf8');
  assert.match(source, /SAVE_STORAGE_KEY = 'king-single-player-save'/);
  assert.match(source, /function saveCurrentGame\(\)/);
  assert.match(source, /function loadSavedGame\(\)/);
  assert.match(source, /function continueSavedGame\(\)/);
  assert.match(source, /removeSavedGame\(\)/);
  assert.match(engine, /random\.getState/);
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

test('portrait hint is temporary and landscape requests mobile fullscreen', () => {
  const source = readFileSync(new URL('../src/native-game.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /ORIENTATION_HINT_MS = 3200/);
  assert.match(source, /setTimeout\(hideOrientationHint, ORIENTATION_HINT_MS\)/);
  assert.match(source, /tg\.requestFullscreen\(\)/);
  assert.match(source, /requestLandscapeFullscreen\(true\)/);
  assert.match(css, /\.orientation-hint\.is-visible/);
  assert.doesNotMatch(css, /@media[^}]+portrait[^}]+\.orientation-hint\s*\{\s*display:\s*block/s);
});

test('partner choice, player turn and completed trick are explicit', () => {
  const source = readFileSync(new URL('../src/native-game.js', import.meta.url), 'utf8');
  assert.match(source, /'ПАРТНЕР'/);
  assert.match(source, /\['ОН ИГРАЕТ', 'НЕПЛОХО'\]/);
  assert.match(source, /\['ОНА ИГРАЕТ', 'ОТЛИЧНО'\]/);
  assert.match(source, /'ОН ВСЕГДА'/);
  assert.match(source, /'МУХЛЮЕТ'/);
  assert.match(source, /'ВАШ ХОД'/);
  assert.match(source, /'ОБЩИЙ СЧЁТ'/);
  assert.match(source, /'ПОБЕДИТЕЛЬ'/);
  assert.match(source, /'НИЧЬЯ'/);
  assert.match(source, /game\.status = 'trick-await'/);
  assert.match(source, /collectCompletedTrick/);
  assert.match(source, /holdForOnePaint/);
  assert.match(source, /TRICK_COLLECT_HOLD_MS = 650/);
  assert.match(source, /gameDelay\(TRICK_COLLECT_HOLD_MS, token\)/);
  assert.match(source, /TRICK_STACK_STEPS/);
  assert.doesNotMatch(source, /TRICK_COLLECT_STEPS|trickCollectionProgress/);
  assert.match(source, /document\.addEventListener\('pointerup'/);
});

test('the native port uses restrained PC Speaker-style Web Audio cues', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../src/native-game.js', import.meta.url), 'utf8');
  assert.match(html, /id="soundButton"/);
  assert.match(html, /aria-pressed="true">Звук: вкл/);
  assert.match(source, /AudioContext/);
  assert.match(source, /oscillator\.type = 'square'/);
  assert.match(source, /playSelectionSound/);
  assert.match(source, /playCardSound/);
  assert.match(source, /playTrickSound/);
  assert.match(source, /frequency: 100, duration: 100/);
  assert.match(source, /SOUND_STORAGE_KEY = 'king-sound-enabled'/);
  assert.match(source, /if \(!soundEnabled\) return/);
});

test('Cloudflare assets exclude emulator files and repository internals', () => {
  const ignored = readFileSync(new URL('../.assetsignore', import.meta.url), 'utf8').split(/\r?\n/);
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.ok(ignored.includes('.git'));
  assert.ok(ignored.includes('.env'));
  assert.ok(ignored.includes('.env.*'));
  assert.ok(ignored.includes('.dev.vars'));
  assert.ok(ignored.includes('.wrangler'));
  assert.ok(ignored.includes('node_modules'));
  assert.ok(ignored.includes('*.pem'));
  assert.ok(ignored.includes('*.key'));
  assert.ok(ignored.includes('worker'));
  assert.ok(ignored.includes('test'));
  assert.ok(ignored.includes('vendor'));
  assert.ok(ignored.includes('kingrus.zip'));
  assert.ok(!ignored.includes('assets'));
  assert.match(wrangler, /"run_worker_first": true/);
  assert.match(wrangler, /"not_found_handling": "none"/);
});

test('health reports the native single-player build', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/health'), { ASSETS: {} });
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.mode, 'single-player');
  assert.equal(health.build, 'native-single-player-7');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('worker adds browser hardening headers without blocking Telegram fullscreen', async () => {
  const source = readFileSync(new URL('../src/native-game.js', import.meta.url), 'utf8');
  const assets = {
    async fetch() {
      return new Response('<!doctype html><title>Кинг</title>', {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      });
    },
  };
  const response = await worker.fetch(new Request('https://example.com/'), { ASSETS: assets });
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' https:\/\/telegram\.org/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self' https:\/\/telegram\.org https:\/\/\*\.telegram\.org/);
  assert.match(response.headers.get('permissions-policy'), /fullscreen=\(self\)/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.doesNotMatch(source, /\.style\./);
});

test('worker never serves repository and deployment internals through SPA fallback', async () => {
  let assetRequests = 0;
  const assets = {
    async fetch() {
      assetRequests += 1;
      return new Response('fallback');
    },
  };

  for (const pathname of ['/.git/config', '/wrangler.jsonc', '/kingrus.zip', '/vendor/emulators/emulators.js']) {
    const response = await worker.fetch(new Request(`https://example.com${pathname}`), { ASSETS: assets });
    assert.equal(response.status, 404, pathname);
  }
  assert.equal(assetRequests, 0);
});

test('network room API is disabled', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/rooms', { method: 'POST' }), {});
  assert.equal(response.status, 404);
});
