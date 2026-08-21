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
    this.disabled = false;
    this.textContent = '';
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.children = [];
    this.href = 'https://t.me/oodalenka';
    this.listeners = new Map();
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
    };
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

  close() {
    this.open = false;
    this.emit('close');
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  replaceWith() {}
  remove() {}

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
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

test('native UI handles mobile taps and completes all fourteen contracts', { timeout: 25_000 }, async () => {
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
    '#avatarLayer': 'avatarLayer',
    '#orientationHint': 'orientationHint',
    '#loadingOverlay': 'loadingOverlay',
    '#loadingText': 'loadingText',
    '#loadingBar': 'loadingBar',
    '#retryButton': 'retryButton',
    '#startOverlay': 'startOverlay',
    '#modeDialog': 'modeDialog',
    '#classicModeButton': 'classicModeButton',
    '#orderedModeButton': 'orderedModeButton',
    '#contractDialog': 'contractDialog',
    '#contractChoiceTitle': 'contractChoiceTitle',
    '#contractChoiceLead': 'contractChoiceLead',
    '#contractChoices': 'contractChoices',
    '#savedGameInfo': 'savedGameInfo',
    '#continueButton': 'continueButton',
    '#continueNetworkButton': 'continueNetworkButton',
    '#newGameButton': 'newGameButton',
    '#restartButton': 'restartButton',
    '#soundButton': 'soundButton',
    '#rulesButton': 'rulesButton',
    '#aboutButton': 'aboutButton',
    '#rulesDialog': 'rulesDialog',
    '#aboutDialog': 'aboutDialog',
    '#networkDialog': 'networkDialog',
    '#networkDialogTitle': 'networkDialogTitle',
    '#networkLead': 'networkLead',
    '#networkNameInput': 'networkNameInput',
    '#networkConnectButton': 'networkConnectButton',
    '#networkCloseButton': 'networkCloseButton',
    '#networkStatus': 'networkStatus',
    '#networkLobby': 'networkLobby',
    '#networkRoomCode': 'networkRoomCode',
    '#networkPlayers': 'networkPlayers',
    '#networkInviteButton': 'networkInviteButton',
    '#networkCopyButton': 'networkCopyButton',
    '#networkStartButton': 'networkStartButton',
    '#aboutDialog a[href^="https://t.me/"]': 'aboutLink',
    '#gameHint': 'gameHint',
  };

  const documentListeners = new Map();
  const orientationListeners = [];
  const landscapeQuery = {
    matches: false,
    addEventListener(type, listener) {
      if (type === 'change') orientationListeners.push(listener);
    },
  };
  let fullscreenRequests = 0;
  const storedValues = new Map();
  globalThis.ImageData = MockImageData;
  globalThis.location = { search: '?seed=50057&speed=0.01', origin: 'https://example.com' };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 1 },
  });
  globalThis.window = {
    location: globalThis.location,
    innerWidth: 360,
    innerHeight: 640,
    matchMedia(query) {
      if (query === '(orientation: landscape)') return landscapeQuery;
      if (query === '(pointer: coarse)') return { matches: true };
      return { matches: false };
    },
    addEventListener() {},
    localStorage: {
      getItem(key) { return storedValues.get(key) ?? null; },
      setItem(key, value) { storedValues.set(key, String(value)); },
      removeItem(key) { storedValues.delete(key); },
    },
    Telegram: {
      WebApp: {
        platform: 'android',
        isFullscreen: false,
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        unlockOrientation() {},
        setHeaderColor() {},
        setBackgroundColor() {},
        isVersionAtLeast() { return true; },
        requestFullscreen() { fullscreenRequests += 1; },
        onEvent() {},
      },
    },
  };
  globalThis.document = {
    hidden: false,
    fullscreenElement: null,
    documentElement: {},
    querySelector(selector) {
      return element(selectorIds[selector]);
    },
    createElement(tagName) {
      return new MockElement(tagName);
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
  assert.equal(element('orientationHint').classList.contains('is-visible'), true);
  landscapeQuery.matches = true;
  window.innerWidth = 640;
  window.innerHeight = 360;
  for (const listener of orientationListeners) listener({ matches: true });
  assert.equal(element('orientationHint').classList.contains('is-visible'), false);
  assert.equal(fullscreenRequests, 1);

  const debug = await eventually(() => window.__kingDebug);
  await eventually(() => debug.snapshot().screen === 'start');
  assert.equal(element('continueButton').disabled, true);
  assert.equal(element('savedGameInfo').textContent, 'Сохранённой игры нет');
  element('newGameButton').emit('click');
  assert.equal(element('modeDialog').open, true);
  element('classicModeButton').emit('click');
  await eventually(() => debug.snapshot().screen === 'partners');
  assert.equal(element('soundButton').textContent, 'Звук: вкл');
  element('soundButton').emit('click');
  assert.equal(element('soundButton').textContent, 'Звук: выкл');
  assert.equal(element('soundButton').attributes.get('aria-pressed'), 'false');
  assert.equal(storedValues.get('king-sound-enabled'), 'false');
  element('soundButton').emit('click');
  assert.equal(element('soundButton').textContent, 'Звук: вкл');
  assert.equal(storedValues.get('king-sound-enabled'), 'true');
  assert.ok(context.lastFrame, 'the partner picker rendered a canvas frame');
  await captureFrame(context, 'partners');

  pointerTap(200, 60, 18, 0);
  await captureFrame(context, 'partner-selected');
  pointerTap(280, 60);
  pointerTap(360, 60);
  await eventually(() => debug.snapshot().screen === 'table');
  assert.deepEqual(debug.snapshot().selectedPartnerIds, [0, 1, 2]);

  let playerTurn = await eventually(() => {
    const snapshot = debug.snapshot();
    return snapshot.game?.status === 'playing' && snapshot.game.currentSeat === 0 && !snapshot.inputLocked
      ? snapshot
      : null;
  });
  assert.match(element('gameHint').textContent, /^Ваш ход\./);
  const saveBeforeReload = JSON.parse(storedValues.get('king-single-player-save'));
  assert.equal(saveBeforeReload.version, 2);
  assert.equal(saveBeforeReload.mode, 'classic');
  assert.equal(saveBeforeReload.contractIndex, playerTurn.game.contractIndex);
  assert.deepEqual(saveBeforeReload.scores, playerTurn.game.scores);

  element('retryButton').emit('click');
  await eventually(() => debug.snapshot().screen === 'start');
  assert.equal(element('continueButton').disabled, false);
  assert.match(element('savedGameInfo').textContent, /контракт 1 из 14/);
  element('continueButton').emit('click');
  playerTurn = await eventually(() => {
    const snapshot = debug.snapshot();
    return snapshot.game?.status === 'playing' && snapshot.game.currentSeat === 0 && !snapshot.inputLocked
      ? snapshot
      : null;
  });
  assert.deepEqual(playerTurn.game.scores, saveBeforeReload.scores);
  assert.deepEqual(playerTurn.game.handCounts, saveBeforeReload.hands.map(hand => hand.length));
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

  const waitingTrick = await eventually(() => {
    const snapshot = debug.snapshot();
    return snapshot.game?.status === 'trick-await' ? snapshot : null;
  });
  assert.equal(waitingTrick.game.trick.length, 4);
  await captureFrame(context, 'trick-await');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(debug.snapshot().game.status, 'trick-await');
  assert.equal(debug.snapshot().game.trick.length, 4);
  documentListeners.get('pointerup')?.({ target: element('gameHint') });
  const collectingTrick = debug.snapshot().game;
  assert.equal(collectingTrick.status, 'trick-collecting');
  assert.equal(collectingTrick.trick.length, 4);
  assert.equal(collectingTrick.trickWinnerSeat, collectingTrick.currentSeat);
  const anchors = [
    { x: 295, y: 182 },
    { x: 243, y: 151 },
    { x: 295, y: 120 },
    { x: 347, y: 151 },
  ];
  const winnerPosition = collectingTrick.trickVisualPositions
    .find(cardPosition => cardPosition.seat === collectingTrick.trickWinnerSeat);
  assert.deepEqual(
    { x: winnerPosition.x, y: winnerPosition.y },
    anchors[collectingTrick.trickWinnerSeat],
  );
  assert.ok(collectingTrick.trickVisualPositions.every(cardPosition => (
    Math.abs(cardPosition.x - winnerPosition.x) <= 12
      && Math.abs(cardPosition.y - winnerPosition.y) <= 9
  )));
  await captureFrame(context, 'trick-collecting');

  const gameDeadline = Date.now() + 20_000;
  while (Date.now() < gameDeadline) {
    const snapshot = debug.snapshot();
    if (snapshot.game?.status === 'game-over') break;
    if (snapshot.game?.status === 'trick-await' && !snapshot.inputLocked) {
      pointerTap(20, 20);
    } else if (snapshot.game?.status === 'playing' && snapshot.game.currentSeat === 0 && !snapshot.inputLocked) {
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
  assert.equal(completed.game.winningScore, Math.max(...completed.game.scores));
  assert.ok(completed.game.winnerSeats.length >= 1);
  assert.ok(completed.game.winnerSeats.every(seat => (
    completed.game.scores[seat] === completed.game.winningScore
  )));
  assert.equal(storedValues.has('king-single-player-save'), false);
  await captureFrame(context, 'game-over');

  element('restartButton').emit('click');
  assert.equal(debug.snapshot().screen, 'partners');
});
