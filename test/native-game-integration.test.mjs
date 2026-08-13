import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

class MockImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class MockElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.open = false;
    this.textContent = '';
    this.style = {};
    this.href = 'https://t.me/oodalenka';
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  showModal() {
    this.open = true;
  }

  focus() {}
}

async function eventually(predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for native game state');
}

async function captureFrame(context, name) {
  const directory = process.env.KING_CAPTURE_DIR;
  if (!directory || !context.lastFrame) return;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/${name}.rgba`, context.lastFrame.data);
}

test('native UI selects three partners and plays a card with two direct taps', { timeout: 4000 }, async () => {
  const context = {
    imageSmoothingEnabled: false,
    lastFrame: null,
    putImageData(imageData) {
      this.lastFrame = imageData;
    },
  };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new MockElement(id));
    return elements.get(id);
  };
  const canvas = element('gameCanvas');
  canvas.width = 640;
  canvas.height = 350;
  canvas.getContext = () => context;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 350 });
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};

  const selectorIds = {
    '#gameCanvas': 'gameCanvas',
    '#loadingOverlay': 'loadingOverlay',
    '#loadingText': 'loadingText',
    '#loadingBar': 'loadingBar',
    '#retryButton': 'retryButton',
    '#restartButton': 'restartButton',
    '#rulesButton': 'rulesButton',
    '#aboutButton': 'aboutButton',
    '#rulesDialog': 'rulesDialog',
    '#aboutDialog': 'aboutDialog',
    '#aboutDialog a[href^="https://t.me/"]': 'aboutLink',
    '#gameHint': 'gameHint',
  };

  const documentListeners = new Map();
  globalThis.ImageData = MockImageData;
  globalThis.location = { search: '?seed=50057&speed=0.01' };
  globalThis.window = { location: globalThis.location };
  globalThis.document = {
    hidden: false,
    querySelector(selector) {
      return element(selectorIds[selector]);
    },
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
  };
  globalThis.fetch = async input => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.protocol !== 'file:') throw new Error(`Unexpected test URL: ${url}`);
    return new Response(await readFile(fileURLToPath(url)), { status: 200 });
  };

  await import(`../src/native-game.js?integration=${Date.now()}`);
  const debug = await eventually(() => window.__kingDebug);
  await eventually(() => debug.snapshot().screen === 'partners');
  assert.ok(context.lastFrame, 'the partner picker rendered a canvas frame');
  await captureFrame(context, 'partners');

  debug.tap(200, 60);
  debug.tap(280, 60);
  debug.tap(360, 60);
  await eventually(() => debug.snapshot().screen === 'table');
  assert.deepEqual(debug.snapshot().selectedPartnerIds, [0, 1, 2]);

  const playerTurn = await eventually(() => {
    const snapshot = debug.snapshot();
    return snapshot.game?.status === 'playing' && snapshot.game.currentSeat === 0 && !snapshot.inputLocked
      ? snapshot
      : null;
  });
  await captureFrame(context, 'table-player-turn');
  const legalId = playerTurn.game.legalPlayerCardIds[0];
  const card = playerTurn.game.playerCards.find(candidate => candidate.id === legalId);
  assert.ok(card);

  debug.tap(card.x + 2, 310);
  assert.equal(debug.snapshot().selectedCardId, legalId);
  await captureFrame(context, 'card-selected');
  debug.tap(card.x + 2, 310);
  assert.equal(debug.snapshot().game.handCounts[0], 7);
  assert.equal(debug.snapshot().selectedCardId, null);

  element('restartButton').emit('click');
  assert.equal(debug.snapshot().screen, 'partners');
});
