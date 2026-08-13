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

test('native UI handles mobile taps and completes all fourteen contracts', { timeout: 15_000 }, async () => {
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
  const mobileRect = { left: 0, top: 0, width: 360, height: 196.875 };
  canvas.getBoundingClientRect = () => mobileRect;
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  let pointerId = 0;
  const pointerTap = (x, y, jitterX = 0, jitterY = 0) => {
    pointerId += 1;
    const clientX = mobileRect.left + x * mobileRect.width / 640;
    const clientY = mobileRect.top + y * mobileRect.height / 350;
    const shared = { isPrimary: true, pointerId, preventDefault() {} };
    canvas.emit('pointerdown', { ...shared, clientX, clientY });
    canvas.emit('pointerup', { ...shared, clientX: clientX + jitterX, clientY: clientY + jitterY });
  };

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

  pointerTap(200, 60, 18, 0);
  pointerTap(280, 60);
  pointerTap(360, 60);
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

  pointerTap(card.x + 2, 310, 0, 4);
  assert.equal(debug.snapshot().selectedCardId, legalId);
  await captureFrame(context, 'card-selected');
  pointerTap(card.x + 2, 310);
  assert.equal(debug.snapshot().game.handCounts[0], 7);
  assert.equal(debug.snapshot().selectedCardId, null);

  const gameDeadline = Date.now() + 12_000;
  while (Date.now() < gameDeadline) {
    const snapshot = debug.snapshot();
    if (snapshot.game?.status === 'game-over') break;
    if (snapshot.game?.status === 'playing' && snapshot.game.currentSeat === 0 && !snapshot.inputLocked) {
      const nextLegalId = snapshot.game.legalPlayerCardIds[0];
      const nextCard = snapshot.game.playerCards.find(candidate => candidate.id === nextLegalId);
      assert.ok(nextCard, `legal card ${nextLegalId} must have a visible position`);
      pointerTap(nextCard.x + 2, 310);
      pointerTap(nextCard.x + 2, 310);
    }
    await new Promise(resolve => setTimeout(resolve, 3));
  }

  const completed = debug.snapshot();
  assert.equal(completed.game.status, 'game-over');
  assert.equal(completed.game.contractIndex, 13);
  assert.deepEqual(completed.game.handCounts, [0, 0, 0, 0]);

  element('restartButton').emit('click');
  assert.equal(debug.snapshot().screen, 'partners');
});
